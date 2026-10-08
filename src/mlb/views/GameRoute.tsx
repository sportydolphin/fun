// Opens Game Center from an ADDRESS, where every other opener does it from a tap.
//
// /mlb/games/<pk> is the address of the game sheet itself (see routes.ts and the top of
// sheetHistory.ts): a sheet opened from the scoreboard, the bracket or the team card pushes it, and
// Back takes it away. This component covers the ways of arriving at that address with no sheet up:
//
//   cold     a shared link, a search result, a push. Lands on the bare address.
//   in-app   the bell's navigate() to a game, which pushes the address and fires popstate.
//   Forward  onto a game entry a sheet once had, after Back closed it.
//   legacy   `/mlb?open=game&gamePk=…`, through deepLink.ts. Production 301s these at the edge,
//            but the bell's own store still holds them and `npm run dev` has no edge.
//
// The first two land on an entry with no sheet marker, and that entry is RESEATED as Scores with
// the game's entry pushed on top. Left as it was, Back would close Game Center onto the same
// address, and this component would open it again: a sheet Back could never get rid of.
//
// ON A DESKTOP A GAME ARRIVED AT IS THE FULL PAGE (Oct 2026), not the sheet: the side panel is for a
// game looked at from a list, and a cold link has no list. The panel's Expand leads here too. The
// page is a history entry marked with the game (state/gamePage.ts), and it is drawn for exactly as
// long as the entry on top carries that marker, which a player's panel opened over it inherits, so
// the page stays under a player looked at from its box score and goes as soon as anything else is
// the page. The page draws in the section's own column, so MlbStats hides the tabs while it is up.
//
// It took over the team card's own handling of the game-start push (ScheduleStrip), which only
// opened the game when it was the followed club's and dropped it otherwise.
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMediaQuery, useTheme } from '@mui/material'
import { fetchGameSummary } from './FinalGames'
import type { FinalGameSummary } from './FinalGames'
import { useDeepLink } from '../state/deepLink'
import { openSheetCount, sheetOpenAt } from '../state/sheetHistory'
import { gamePageOf, setGamePageShowing, GAME_PAGE_KEY, type GameTab } from '../state/gamePage'
import { mlbGamePath, mlbGamePkFromPath, MLB_VIEW_PATHS, MLB_PATH_EVENT } from '../routes'

const GameCenterModal = lazy(() => import('./LiveGameCenter').then(m => ({ default: m.GameCenterModal })))
const GameCenterPage = lazy(() => import('./LiveGameCenter').then(m => ({ default: m.GameCenterPage })))
const GamePageSkeleton = lazy(() => import('./LiveGameCenter').then(m => ({ default: m.GamePageSkeleton })))

/** Whether this address, with this entry, is the full page: a page entry for its game, or a game
 *  arrived at (no sheet's entry) on a desktop. The same test `open` makes, asked once more at the
 *  first render so the page is there from the first frame instead of Scores flashing under it. */
function landsAsPage(desktop: boolean): number | null {
  if (!desktop) return null
  const pk = mlbGamePkFromPath(window.location.pathname)
  if (pk == null) return null
  const st = window.history.state as Record<string, unknown> | null
  const pageOf = gamePageOf(st)
  if (pageOf) return pageOf.gamePk === pk ? pk : null
  return st?.mlbSheet != null ? null : pk
}
// Lazy for the reason Game Center is: this route rides in MlbStats, which every MLB page loads.
const GamePreviewModal = lazy(() => import('./GamePreview').then(m => ({ default: m.GamePreviewModal })))

export function GameRoute({ onPlayerClick, onTeamClick, onPage }: {
  onPlayerClick: (id: number) => void
  onTeamClick:   (id: number) => void
  /** Whether the full page is up, so the section can stand its tabs down beneath it. */
  onPage?:       (open: boolean) => void
}) {
  // `noSsr` so the first render already knows, which the first-frame page below depends on. The same
  // query as ModalShell's useOpensAsPanel.
  const desktop = useMediaQuery(useTheme().breakpoints.up('md'), { noSsr: true })
  const [game, setGame] = useState<FinalGameSummary | null>(null)
  // `game` is null while the summary is read: the page's frame is drawn from the gamePk alone.
  const [page, setPage] = useState<{ gamePk: number; game: FinalGameSummary | null; tab?: GameTab } | null>(
    () => { const pk = landsAsPage(desktop); return pk != null ? { gamePk: pk, game: null, tab: gamePageOf(window.history.state)?.tab } : null })
  // The game being fetched, so a second request for it (React's double effect, the bell's
  // navigate plus its deep link) does not open it twice, and a Back during the fetch cancels it.
  const pending = useRef<number | null>(null)
  const desktopRef = useRef(desktop)
  desktopRef.current = desktop
  const pageRef = useRef(page)
  pageRef.current = page

  // Before paint, so the section's tabs are gone in the same frame the page appears.
  useLayoutEffect(() => {
    onPage?.(page != null)
    setGamePageShowing(page?.gamePk ?? null)
  }, [page, onPage])
  useEffect(() => () => setGamePageShowing(null), [])

  const openPage = useCallback((pk: number, tab: GameTab | undefined) => {
    if ((pageRef.current?.gamePk === pk && pageRef.current.game) || pending.current === pk) return
    setPage(p => p?.gamePk === pk ? p : { gamePk: pk, game: null, tab })
    pending.current = pk
    fetchGameSummary(pk).then(g => {
      if (pending.current !== pk) return
      pending.current = null
      // Off the page by now (a tab tapped while it loaded): drawing it would cover the page chosen.
      if (gamePageOf(window.history.state)?.gamePk !== pk) return
      if (!g) { setPage(null); window.history.back(); return }
      // A game not yet played has no box score or plays to lay out, so it is the preview sheet at
      // every width: the entry becomes the sheet's, which the preview adopts as it mounts.
      if (g.state === 'preview' || g.state === 'postponed') {
        const { [GAME_PAGE_KEY]: _page, ...rest } = window.history.state as Record<string, unknown>
        window.history.replaceState({ ...rest, mlbSheet: openSheetCount() + 1, mlbSheetUrl: mlbGamePath(pk) }, '', mlbGamePath(pk))
        setPage(null)
        setGame(g)
        return
      }
      setPage({ gamePk: pk, game: g, tab })
    })
  }, [])

  const open = useCallback((pk: number) => {
    const url = mlbGamePath(pk)
    const st = window.history.state as Record<string, unknown> | null
    const pageOf = gamePageOf(st)
    if (desktopRef.current && pageOf?.gamePk === pk) { openPage(pk, pageOf.tab); return }
    if (pending.current === pk || sheetOpenAt(url)) return
    if (window.location.pathname === url && !(st?.mlbSheet != null && st.mlbSheetUrl === url) && !pageOf) {
      window.history.replaceState({ view: 'scores' }, '', MLB_VIEW_PATHS.scores)
      if (desktopRef.current) {
        // Arrived at on a desktop: the full page, over Scores for Back to land on.
        window.history.pushState({ view: 'scores', [GAME_PAGE_KEY]: pk }, '', url)
        window.dispatchEvent(new Event(MLB_PATH_EVENT))
        openPage(pk, undefined)
        return
      }
      // Seated ahead of the sheet, which adopts it on mount, so the address never flickers to
      // Scores while the game loads. The depth is the one the sheet will take.
      window.history.pushState({ view: 'scores', mlbSheet: openSheetCount() + 1, mlbSheetUrl: url }, '', url)
    }
    pending.current = pk
    const seated = window.location.pathname === url
    fetchGameSummary(pk).then(g => {
      if (pending.current !== pk) return
      pending.current = null
      // Off the game's address by now (a tab tapped while it loaded): opening it would cover a page
      // the reader chose. Not asked of a legacy deep link, which the bell publishes BEFORE it
      // navigates, so the address always moves under it.
      if (seated && window.location.pathname !== url) return
      if (g) setGame(g)
      // No such game, or not one the scoreboard shows: step off the seated entry onto Scores.
      else if (seated) window.history.back()
    })
  }, [openPage])

  useEffect(() => {
    const check = () => {
      const pk = mlbGamePkFromPath(window.location.pathname)
      if (pk == null) pending.current = null
      else open(pk)
      // The page goes as soon as the entry on top stops naming it: Back, a tab, a link out. Asked
      // after `open`, which is what seats a cold landing's page entry.
      const pageOf = gamePageOf(window.history.state)
      if (pageRef.current && pageOf?.gamePk !== pageRef.current.gamePk) setPage(null)
    }
    check()
    window.addEventListener('popstate', check)
    // A navigation from the page pushes (pushEntry) and fires no popstate; it announces this.
    window.addEventListener(MLB_PATH_EVENT, check)
    return () => {
      window.removeEventListener('popstate', check)
      window.removeEventListener(MLB_PATH_EVENT, check)
    }
  }, [open])

  useDeepLink('game', link => open(link.gamePk))

  const close = () => setGame(null)
  const sheet = !game ? null
    : game.state === 'preview' || game.state === 'postponed'
      ? <Suspense fallback={null}><GamePreviewModal game={game} onClose={close} onPlayerClick={onPlayerClick} onTeamClick={onTeamClick} /></Suspense>
      : (
        <Suspense fallback={null}>
          <GameCenterModal game={game} onClose={close} onPlayerClick={onPlayerClick} onTeamClick={onTeamClick} />
        </Suspense>
      )
  return (
    <>
      {page && !page.game && (
        <Suspense fallback={null}>
          <GamePageSkeleton gamePk={page.gamePk} onBack={() => window.history.back()} />
        </Suspense>
      )}
      {page?.game && (
        <Suspense fallback={null}>
          <GameCenterPage
            game={page.game}
            initialTab={page.tab}
            onClose={() => setPage(null)}
            onBack={() => window.history.back()}
            onPlayerClick={onPlayerClick}
            onTeamClick={onTeamClick}
          />
        </Suspense>
      )}
      {sheet}
    </>
  )
}

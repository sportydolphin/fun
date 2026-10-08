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
// the sheet's entry pushed on top. Left as it was, Back would close Game Center onto the same
// address, and this component would open it again: a sheet Back could never get rid of.
//
// It took over the team card's own handling of the game-start push (ScheduleStrip), which only
// opened the game when it was the followed club's and dropped it otherwise.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { fetchGameSummary } from './FinalGames'
import type { FinalGameSummary } from './FinalGames'
import { useDeepLink } from '../state/deepLink'
import { openSheetCount, sheetOpenAt } from '../state/sheetHistory'
import { mlbGamePath, mlbGamePkFromPath, MLB_VIEW_PATHS } from '../routes'

const GameCenterModal = lazy(() => import('./LiveGameCenter').then(m => ({ default: m.GameCenterModal })))
// Lazy for the reason Game Center is: this route rides in MlbStats, which every MLB page loads.
const GamePreviewModal = lazy(() => import('./GamePreview').then(m => ({ default: m.GamePreviewModal })))

export function GameRoute({ onPlayerClick, onTeamClick }: {
  onPlayerClick: (id: number) => void
  onTeamClick:   (id: number) => void
}) {
  const [game, setGame] = useState<FinalGameSummary | null>(null)
  // The game being fetched, so a second request for it (React's double effect, the bell's
  // navigate plus its deep link) does not open it twice, and a Back during the fetch cancels it.
  const pending = useRef<number | null>(null)

  const open = useCallback((pk: number) => {
    const url = mlbGamePath(pk)
    if (pending.current === pk || sheetOpenAt(url)) return
    const st = window.history.state as Record<string, unknown> | null
    if (window.location.pathname === url && !(st?.mlbSheet != null && st.mlbSheetUrl === url)) {
      window.history.replaceState({ view: 'scores' }, '', MLB_VIEW_PATHS.scores)
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
  }, [])

  useEffect(() => {
    const check = () => {
      const pk = mlbGamePkFromPath(window.location.pathname)
      if (pk == null) { pending.current = null; return }
      open(pk)
    }
    check()
    window.addEventListener('popstate', check)
    return () => window.removeEventListener('popstate', check)
  }, [open])

  useDeepLink('game', link => open(link.gamePk))

  if (!game) return null
  const close = () => setGame(null)
  if (game.state === 'preview' || game.state === 'postponed') {
    return <Suspense fallback={null}><GamePreviewModal game={game} onClose={close} onPlayerClick={onPlayerClick} onTeamClick={onTeamClick} /></Suspense>
  }
  return (
    <Suspense fallback={null}>
      <GameCenterModal game={game} onClose={close} onPlayerClick={onPlayerClick} onTeamClick={onTeamClick} />
    </Suspense>
  )
}

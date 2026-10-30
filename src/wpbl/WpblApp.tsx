import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Box, useMediaQuery } from '@mui/material'
import { useTheme as useMuiTheme } from '@mui/material/styles'
import {
  fetchWpblTeams, fetchWpblSchedule, fetchWpblAllPlayers,
  fetchWpblAllLines, fetchWpblTrackedGameIds, fetchWpblArticles, fetchWpblSiteGames, fetchWpblFanPhotoIndex, fetchWpblVideos,
  getCachedWpblTeams, getCachedWpblSchedule, getCachedWpblSiteGames,
} from './api'
import { applyLeagueStartTimes } from './startTimes'
import { chromePx } from './ui'
import { panelShiftSx, useSidePanelOpen } from '../ui/ModalShell'
import { fetchWpblAwardResults } from './awardVotes'
import { HOME_WIDE_W, STATS_FULL_BLEED_W, GAME_PAGE_W, PLAYER_PAGE_W } from './layoutWidths'
import { PHONE_COLUMN_W } from '../ui/layoutWidths'
import type { WpblTeam, WpblPlayer, WpblGame, WpblSiteGame } from './types'
import { track, EVENTS } from '../lib/analytics'
import { useFeatureDots } from '../lib/seen'
import WpblHome, { homeLandingReadsLines } from './home/WpblHome'
import { WpblHomeSkeleton } from './home/Skeletons'
import FanAwardsSheet from './FanAwardsSheet'
import { awardsResultsShowOnHome } from './awards'
import WpblStatsView, { warmStatsReads, type WpblStatsFocus } from './stats/StatsView'
import { StatsSkeleton } from './stats/Skeleton'
import SwipeableViews from './SwipeableViews'
import WpblBottomNav, { BOTTOM_NAV_SPACE, MORE_KEY } from './BottomNav'
import {
  WPBL_NAV, wpblPathFor, WPBL_PATH_EVENT, wpblPlayerSlugFromPath, findWpblPlayerBySlug, wpblAppOwnsPath, wpblGameSlugFromPath, findWpblGameBySlug,
  wpblTeamPath, wpblTeamSlugFromPath, findWpblTeamBySlug,
  WPBL_SHORT_REF_PARAM, WPBL_SHORT_REF_VALUE,
  type WpblView,
} from './routes'
import { publishSectionNav, clearSectionNav } from '../sectionNav'
import { WpblLinkProvider } from './LinkContext'
import { WpblSeasonProvider } from './SeasonContext'
import { WPBL_MORE_PAGES } from './morePages'
import { MoreSheet as SharedMoreSheet } from '../ui/MoreMenu'
import { useForegroundInterval } from '../lib/foregroundInterval'
import { PanelActiveContext, useSectionActive, useSectionSearch } from '../lib/panelActive'
import { WpblHeadingOwnerProvider } from './PageHeading'
import { AppErrorBoundary } from '../AppErrorBoundary'
import { ModalChunkFallback, DetailPageSkeleton, TabSkeleton } from './app/Placeholders'
import { ScheduleView } from './app/ScoresTab'
import { StandingsView } from './app/StandingsTab'
import { TeamsView } from './app/TeamsTab'
import type { WpblSnap } from './app/snapshot'
import { normalizeView, viewFromLocation, snapFromLocation, wpblUrlFor } from './app/snapshot'
import { useWpblSearch } from './app/useWpblSearch'
import { usePageSeo } from './app/usePageSeo'

// The two detail modals, split out of the section's chunk.
//
// Neither is on screen when /wpbl loads (both open on a tap), and together they are a large share
// of what the landing view would otherwise download and parse. GameDetail is the biggest single
// file in the section (line score, box score, play-by-play, pitch data, recap tab) and it drags
// Highlights, GamePreview and the live poller along with it.
const GameDetailModal = lazy(() => import('./gameDetail/GameDetailModal'))
/**
 * The same import, run while the section is idle.
 *
 * Opening a game is the primary act in this section: every row on Home and Schedule leads there.
 * Waiting until the tap to fetch the chunk buys nothing and costs the one thing an opening
 * animation cannot survive, a gap before it starts: a spinner in the middle of the screen and
 * then, a beat later, a sheet sliding up from the bottom edge, two unrelated movements for one
 * gesture. Warmed here, the sheet is simply there on the first frame and the fallback below is a
 * formality.
 */
function usePreloadGameDetail() {
  useEffect(() => {
    // The player card too: it is reached from every leaderboard, roster and box score, and cold its
    // chunk cost the first open a fetch, a Suspense tick and a parse before the sheet could move.
    const warm = () => { void import('./gameDetail/GameDetailModal'); void import('./PlayerDetail') }
    const hasRIC = typeof window.requestIdleCallback === 'function'
    const id = hasRIC ? window.requestIdleCallback(warm, { timeout: 2000 }) : window.setTimeout(warm, 800)
    return () => { if (hasRIC) window.cancelIdleCallback(id as number); else window.clearTimeout(id as number) }
  }, [])
}
const PlayerDetailModal = lazy(() => import('./PlayerDetail'))

// WPBL section root. Reads the official-feed mirror from Supabase (games, box scores,
// play-by-play, live state) and renders it; everything shows a friendly empty state until
// the feed has been ingested. Self-contained (no MLB/StatsAPI coupling).

// The view list and the path map live in ./routes, which App.tsx and seo.ts also read.
// See the note there for why it is a separate, import-free module.
const NAV = WPBL_NAV

// The WPBL pages that are not tabs. The footer links them, which is a fine crawl path and a poor
// way for a reader to find anything, so this menu is one discovery surface for all of them,
// WITHOUT a sixth tab: WPBL_NAV, the pager and the mobile bottom bar all stay at five, because a
// sixth does not fit a phone's bar (see BottomNav.tsx and the note on WPBL_LEAGUE_PAGE).
//
// Not a tab and switches nothing in the pager: it opens a menu (the toolbar's, src/ToolbarNav.tsx,
// above a phone; the sheet below on one). Each item is a real <a href> via linkTo, so it is
// crawlable and cmd/middle-click opens it in a new tab. The list itself lives in morePages.ts,
// shared with the footer, so the desktop menu, the phone sheet and the footer cannot disagree
// about what a reader is offered.
const useMorePages = () => WPBL_MORE_PAGES

// The phone's counterpart to the toolbar's More panel (ToolbarNav): the same grouped pages, from the
// bottom bar's More slot as a bottom sheet (src/ui/MoreMenu). The toolbar carries no tabs on a phone;
// this is how those pages stay reachable without a footer scroll.
function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows = useMorePages().map(p => ({ ...p, key: p.href }))
  return <SharedMoreSheet open={open} onClose={onClose} rows={rows} />
}

function WpblApp({ renderFooter }: { renderFooter?: () => ReactNode } = {}) {
  // Section is public and read-only (feed-driven), so it needs no admin flag; ingest-health
  // freshness lives in the site Admin panel.

  // Seed from the snapshot already on this history entry (Back/refresh into a deep state),
  // then the URL's path, else home. Read once per state (history.state is stable at mount).
  const seed = (): WpblSnap => {
    const s = (window.history.state?.wpbl ?? null) as WpblSnap | null
    if (s) return { ...s, view: normalizeView(s.view).view }
    return snapFromLocation()
  }
  // A legacy ?view=tracking (or a restored snapshot) should open Stats already on the
  // tracking group, with token 1 so the panel treats it as a real request on first mount.
  const seedTracking = () =>
    normalizeView(window.history.state?.wpbl?.view ?? viewFromLocation()).wasTracking
  const [view, setView] = useState<WpblView>(() => seed().view)
  const [selectedTeam, setSelectedTeam] = useState<WpblTeam | null>(() => seed().team)
  const [detailGame, setDetailGame] = useState<WpblGame | null>(() => seed().game)
  const [detailPlayer, setDetailPlayer] = useState<WpblPlayer | null>(() => seed().player)
  const [awardsOpen, setAwardsOpen] = useState<boolean>(() => !!seed().awards)
  const [gamePage, setGamePage] = useState<boolean>(() => !!seed().gamePage)
  const [playerPage, setPlayerPage] = useState<boolean>(() => !!seed().playerPage)
  // The season the reader picked, null for the current one. A ref beside it so `stamp` and
  // `urlFor` read the newest pick without joining every navigation callback's dependencies.
  const [pickedSeason, setPickedSeason] = useState<number | null>(() => seed().season ?? null)
  const pickedSeasonRef = useRef(pickedSeason)
  pickedSeasonRef.current = pickedSeason
  /** The snapshot with the year it was taken in, for storing: see WpblSnap.season. */
  const stamp = useCallback((s: WpblSnap): WpblSnap => (s.season !== undefined ? s : { ...s, season: pickedSeasonRef.current }), [])
  // Whether a player or a game opens as the desktop side panel: always, on a desktop, including from
  // the ballot and the series view. ModalShell lifts the panel over whichever of those it was opened
  // from, and a player opened from the Game Center panel lands exactly over it with a back control.
  // The `md` test is ModalShell's own, so the two cannot disagree about which it is.
  const playerAsPanel = useMediaQuery(useMuiTheme().breakpoints.up('md'))
  // The full Game Center is a desktop layout; on a phone the same entry is the sheet.
  const showGamePage = gamePage && !!detailGame && playerAsPanel
  // The player's full page, the same way. The game page wins if both are somehow set: a player over
  // it is the panel beside it, which is the arrangement every route into that state means.
  const showPlayerPage = playerPage && !!detailPlayer && playerAsPanel && !showGamePage
  // A cold landing on a player's or a game's address, until the roster or the schedule resolves it
  // (the two effects that read pendingPlayerSlug and pendingGameSlug clear it). Without it the page
  // drew Home's skeleton at Home's width until then, and swapped to the page a second or two later
  // at another width and depth: up to 1.4 of field CLS on a desktop in October 2026.
  const [landingPage, setLandingPage] = useState<'player' | 'game' | null>(() =>
    window.history.state?.wpbl ? null
      : wpblGameSlugFromPath(window.location.pathname) ? 'game'
        : wpblPlayerSlugFromPath(window.location.pathname) ? 'player' : null)
  const landingAsPage = landingPage != null && playerAsPanel && !showGamePage && !showPlayerPage
  // The fan-award tally, started now for a player's address rather than when the card mounts. The
  // card draws the awards a player won as a row in its band, from this tally once it has landed;
  // asked for only at mount it landed after the band had drawn and grew it by a row. The roster
  // the card waits on is the slower read, so by the time it mounts the tally is in.
  useEffect(() => {
    if (landingPage === 'player') void fetchWpblAwardResults()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the address landed on
  }, [])
  // The page moves aside for the side panel (see panelShiftSx), by the width of the widest thing on
  // the current surface: the column itself, or one of the surfaces that break out of it.
  const panelOpen = useSidePanelOpen()
  const contentW = showGamePage || (landingAsPage && landingPage === 'game') ? GAME_PAGE_W
    : showPlayerPage || landingAsPage ? PLAYER_PAGE_W : view === 'home' ? HOME_WIDE_W : view === 'stats' ? STATS_FULL_BLEED_W : view === 'schedule' ? HOME_WIDE_W : chromePx(720)
  // The page takes the window's scroll, so it opens at its top and hands the tab back its place.
  // Layout effect, so neither the page nor the returning tab paints a frame at the wrong depth.
  // Keyed on the game as well: one page can lead to another (a player's log beside it), and the
  // next game should open at its own top, not at the depth the last one was read to. Only the
  // first page remembers the tab's depth, since that is where Back eventually lands.
  const scrollBeforePage = useRef<number | null>(null)
  // Either full page, by what it shows, so moving from one page to another lands at the new top.
  const pageGameId = showGamePage ? `g:${detailGame?.id}` : showPlayerPage ? `p:${detailPlayer?.id}` : null
  // The panel's board, handed to the page Expand turned it into (see expandGame). Spent once the
  // page has mounted with it: Game Center reads its initial tab once, at mount.
  const expandTab = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (pageGameId) {
      expandTab.current = null
      if (scrollBeforePage.current === null) scrollBeforePage.current = window.scrollY
      window.scrollTo(0, 0)
    } else if (scrollBeforePage.current !== null) {
      window.scrollTo(0, scrollBeforePage.current)
      scrollBeforePage.current = null
    }
  }, [pageGameId])
  // Mirror of the MLB game-center event, fired whenever the opened game changes. `from` is the
  // surface the game was tapped on: without it the busiest modal in the section is one flat
  // count that cannot say whether the Home scoreboard, the schedule grid or a team page is
  // what actually feeds it, which is the question any change to those three has to answer.
  useEffect(() => {
    if (detailGame) {
      track(EVENTS.GAME_CENTER_OPENED, {
        league: 'wpbl', gameId: detailGame.id, status: detailGame.status,
        from: view === 'teams' && selectedTeam ? 'team' : view,
      })
    }
    // Deliberately keyed on the game alone: `view` and `selectedTeam` are read for the label
    // and must not re-fire this when a reader swipes tabs with a game still open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailGame?.id])
  // What the Stats tab should be showing when it's opened from another surface ("View all",
  // "Full stats"). `token` is the part that matters: the Stats panel stays MOUNTED once visited
  // (SwipeableViews keeps visited tabs alive), so a plain prop can't re-seed its state on a second
  // visit. Bumping the token on every jump gives the panel an unambiguous "re-focus now" signal, and
  // leaves it alone when the reader reaches Stats by tapping the tab or swiping.
  const [statsFocus, setStatsFocus] = useState<WpblStatsFocus>(
    () => (seedTracking() ? { group: 'tracking', token: 1 } : { group: 'hitting', token: 0 }))

  // "Something new here" dots, all derived from the registry in lib/seen.ts: a nav pill lights
  // while a live feature under its tab is unreached, and the board chips inside light the same
  // way. Arriving on a tab, by a tap, a swipe or a deep link, puts out its pill; the chips keep
  // pointing until their board opens (reported by StatsView via onBoardSeen).
  const featureDots = useFeatureDots()
  const { visit: visitPlace } = featureDots
  const { dotsUnder } = featureDots
  const newBoards = useMemo(() => dotsUnder('wpbl/stats'), [dotsUnder])
  const markBoardSeen = useCallback((key: string) => visitPlace(`wpbl/stats/${key}`), [visitPlace])
  const navBadge = (key: string): boolean => featureDots.dot(`wpbl/${key}`)
  useEffect(() => { visitPlace(`wpbl/${view}`) }, [view, visitPlace])

  // SEEDED FROM THE LAST GOOD READS, the way the overlay hosts are. This component unmounts
  // whenever the reader opens a page from the More menu (App renders those instead of it), so
  // without a seed every Back from one repainted the whole Home skeleton while it re-read two
  // tables it had read seconds earlier. The reads below still run on every mount, so the seed is
  // only ever what paints first, never what stays.
  const [teams, setTeams] = useState<WpblTeam[]>(() => getCachedWpblTeams() ?? [])
  const [feedGames, setFeedGames] = useState<WpblGame[]>(() => getCachedWpblSchedule() ?? [])
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  // The league's own website calendar, mirrored nightly. It answers two questions the stats
  // feed answers worse: for a postseason game the feed has not published yet, which club bats
  // last, and for one it HAS published, when the game actually starts (see
  // applyLeagueStartTimes). Held here rather than fetched twice, because the Schedule tab and
  // Home's Next game card build their postseason rows from the same function and must not
  // disagree about who is at home. An empty list is a working state, not a broken one: see
  // postseasonScheduleRows.
  const [siteGames, setSiteGames] = useState<WpblSiteGame[]>(() => getCachedWpblSiteGames() ?? [])
  /**
   * THE SCHEDULE THE WHOLE SECTION RENDERS, which is the feed's with the league's own published
   * first pitches over it. Every start time, countdown and reminder below reads `games`.
   *
   * HERE AND NOT AT `fetchWpblSchedule`, WHICH IS WHERE THE OTHER THREE SCHEDULE RULES LIVE, for
   * one reason: this rule needs a second table and the section deliberately does not wait on that
   * table (see the fetch below). Applying it at the read would either block the first paint on
   * the calendar or run before the calendar had landed, which is the same as not running. A memo
   * over both pieces of state is the version that corrects itself the moment the calendar
   * arrives, without anything else in the section knowing that it did.
   */
  const games = useMemo(() => applyLeagueStartTimes(feedGames, siteGames), [feedGames, siteGames])
  // Only the first visit waits. A return with both reads cached paints at once (see the seed).
  const [loading, setLoading] = useState(() => !(getCachedWpblTeams() && getCachedWpblSchedule()))
  // `noSsr` so this is right on the FIRST render, not one tick late. Without it MUI returns `false`
  // on the initial client render and corrects in an effect, so the bottom bar would be absent from
  // the first paint and inserted a frame later into an already laid-out page. Reading matchMedia synchronously keeps the bar in the initial layout.
  const isMobileView = useMediaQuery('(max-width:600px)', { noSsr: true })
  // Bottom tab bar, phones only. Above a phone the tabs are in the shell's toolbar instead (see
  // the publish below selectTab), because a bottom bar is wrong at 1280px.
  const bottomNav = isMobileView
  // The bottom bar's More sheet (the mobile way into the non-tab pages). Owned here, not in the
  // bar, because the sheet renders above the bar and outlives a tab swipe.
  const [moreSheetOpen, setMoreSheetOpen] = useState(false)

  // False while the section is kept mounted behind MLB (App.tsx). Everything that reaches outside
  // the section (the toolbar's search and tabs, the page's tags) waits for it, or the hidden section
  // would answer MLB's search box with WPBL players.
  const active = useSectionActive()
  // Whether this section answers the toolbar's search, which it also does hidden behind one of its
  // own standalone pages (see SectionSearchContext). The search bridge effects key on this.
  const searchActive = useSectionSearch()

  // ── History-driven navigation ────────────────────────────────────────────────
  const apply = useCallback((s: WpblSnap) => {
    // Normalize on the way in too: history entries pushed before Tracking folded into Stats
    // are still in the reader's back stack, and Back must not land on a tab that's gone.
    const { view: v, wasTracking } = normalizeView(s.view)
    if (wasTracking) setStatsFocus(f => ({ group: 'tracking', token: f.token + 1 }))
    setView(v); setSelectedTeam(s.team); setDetailGame(s.game); setDetailPlayer(s.player)
    setAwardsOpen(!!s.awards)
    setGamePage(!!s.gamePage)
    setPlayerPage(!!s.playerPage)
    if (s.season !== undefined) setPickedSeason(s.season)
  }, [])
  // Memoized on `players` and threaded through push's deps below: it reads the roster now,
  // so leaving it out would freeze `push` around the empty roster of the first render and
  // every player URL would come out in the legacy query form.
  const urlFor = useCallback((s: WpblSnap) =>
    wpblUrlFor(s, { players, games, teams, pickedSeason: pickedSeasonRef.current }), [players, games, teams])
  // A ?player=<id> / ?game=<id> from a pasted or shared link, resolved once the data they
  // name has loaded. Both are read at mount only: a restored history snapshot already
  // carries the real objects, so the query string is the cold-start path.
  const pendingParam = (key: string) =>
    window.history.state?.wpbl ? null : new URLSearchParams(window.location.search).get(key)
  const pendingPlayerId = useRef<string | null>(pendingParam('player'))
  const pendingGameId = useRef<string | null>(pendingParam('game'))
  // The same idea for /wpbl/players/<slug>, which is the canonical form. Read from the path
  // rather than the query, and likewise only on a cold load: a restored history entry
  // already carries the player object.
  const pendingPlayerSlug = useRef<string | null>(
    window.history.state?.wpbl ? null : wpblPlayerSlugFromPath(window.location.pathname),
  )
  /** The same, for /wpbl/games/<slug>. */
  const pendingGameSlug = useRef<string | null>(
    window.history.state?.wpbl ? null : wpblGameSlugFromPath(window.location.pathname),
  )
  /**
   * Which board a shared game link asked for, captured HERE rather than read by GameDetail.
   *
   * It has to be. `urlFor` builds a game's URL from its slug alone and carries no query, so by
   * the time the modal mounts the address bar has already been rewritten and `?tab=` is gone.
   * Every other cold-start parameter in this file is read at mount for the same reason; this is
   * one more of them. Validated in GameDetail, which is the half that knows which boards this
   * particular game actually has.
   */
  const pendingGameTab = useRef<string | null>(pendingParam('tab'))
  /** The box score's club (`?side=home`), dropped by `urlFor` for the same reason as the tab. */
  const pendingGameSide = useRef<string | null>(pendingParam('side'))
  /** And for /wpbl/teams/<slug>, which selects a club on the Teams tab rather than opening a
   *  modal, so it is applied with the tab itself rather than through `openFromLink`. */
  const pendingTeamSlug = useRef<string | null>(
    window.history.state?.wpbl ? null : wpblTeamSlugFromPath(window.location.pathname),
  )
  /** `?ref=short` on the landing URL means a short link (functions/p, functions/g) sent this
   *  reader here. Read at mount before `urlFor` rewrites the address bar and drops it, so the
   *  open can be counted through the ordinary analytics path rather than the edge taking on a
   *  write of its own. Only human loads run this JS, which is the point: it counts opens, never
   *  the crawler fetches that unfurl the card. */
  const arrivedViaShort = useRef(pendingParam(WPBL_SHORT_REF_PARAM) === WPBL_SHORT_REF_VALUE)
  // Count the short-link open once, on the load it happened. `kind` comes from what the landing
  // path names, which the edge resolved the code into: a player slug, a game slug, or neither.
  useEffect(() => {
    if (!arrivedViaShort.current) return
    arrivedViaShort.current = false
    const kind = pendingPlayerSlug.current ? 'player' : pendingGameSlug.current ? 'game' : 'other'
    track(EVENTS.WPBL_SHARE_OPENED, { kind })
  }, [])
  // Every forward navigation = one history entry (apply state + push a matching snapshot).
  const push = useCallback((s: WpblSnap) => {
    apply(s)
    window.history.pushState({ ...window.history.state, wpbl: stamp(s) }, '', urlFor(s))
    // Tell the shell the path moved, so useSeo re-runs for the tab we just landed on.
    window.dispatchEvent(new Event(WPBL_PATH_EVENT))
  }, [apply, stamp, urlFor])

  /**
   * Open a modal that a shared link asked for, on a cold load.
   *
   * THIS IS NOT `push`, AND IT IS NOT `replaceState` EITHER. Opening the modal with replaceState
   * would make the whole session history a single entry that already has the modal open, and
   * `closeTop` is `history.back()`, so the X, the backdrop and Escape would have nothing to walk
   * back to: from the only entry in the session, back() either does nothing or leaves the site,
   * trapping anyone who arrived on a player from a pasted link.
   *
   * So seat a modal-less entry underneath first, then push the modal on top. Back and the X
   * then behave exactly as they would had the reader opened the player themselves, which is
   * the invariant closeTop is built on.
   *
   * Both halves run in the same synchronous block on purpose: seating the base at mount
   * instead would leave the address bar showing a bare /wpbl for as long as the roster took
   * to load, and a link copied in that window would have lost its player.
   *
   * The base is seated ONCE. A link can name a game and a player at the same time
   * (?game=X&player=Y is what the address bar holds once you open a player from a game), and
   * those arrive as two independent effects racing on two different fetches. Seating a fresh
   * base on the second one would throw away the first one's entry.
   */
  const linkBaseSeated = useRef(false)
  // Whether this entry was reached by a click inside the site rather than by arriving
  // directly. src/App.tsx's `navigate` pushes `{}`, a cold load has null, and a restored
  // WPBL entry never reaches openFromLink at all, so the three cases are distinguishable.
  //
  // It matters because seating a base is only correct when there is nothing behind us. The
  // players index at /wpbl/players is a separate route, so following a link from it remounts
  // this component and lands here: seating a base there would REPLACE the index entry with a
  // bare /wpbl, and Back from a player would return to the section root instead of the list the
  // reader was just reading.
  const arrivedByInAppLink = useRef(window.history.state != null)
  const openFromLink = useCallback((s: WpblSnap) => {
    // Came from a link inside the site: the shell already pushed an entry for this exact
    // URL, so FILL IT IN rather than seating a base under it or pushing a second entry with
    // the same address. Pushing would leave two /wpbl/players/<slug> entries back to back,
    // the lower one carrying no snapshot, so Back would render Home under a player's URL.
    if (arrivedByInAppLink.current) {
      arrivedByInAppLink.current = false
      apply(s)
      window.history.replaceState({ ...window.history.state, wpbl: stamp(s) }, '', urlFor(s))
      window.dispatchEvent(new Event(WPBL_PATH_EVENT))
      return
    }
    if (!linkBaseSeated.current) {
      linkBaseSeated.current = true
      const base: WpblSnap = { view: s.view, team: s.team, game: null, player: null }
      window.history.replaceState({ ...window.history.state, wpbl: stamp(base) }, '', urlFor(base))
    }
    push(s)
  }, [push, apply, urlFor, stamp])

  // Navigation intents. Tab/team switches clear any open modal; opening a player keeps the
  // game beneath it (so Back closes the player first, then the game).
  // Tab switches carry HOW the reader got there. Cloudflare already counts the tab paths, so
  // this deliberately isn't a page-view log (see analytics.ts): the part Cloudflare can't answer
  // is the `via`. A pill tap is a deliberate choice, a swipe often just passes through on the
  // way somewhere else, and a card link is the Home feed doing its job, which is what says
  // whether the nav is actually working on a phone. Back/forward navigations go through
  // popstate, not here, and aren't counted.
  const selectTab = useCallback((v: WpblView, via: 'pill' | 'swipe' | 'link' = 'pill') => {
    if (v !== view) track(EVENTS.WPBL_TAB_VIEWED, { view: v, via, from: view })
    // Tapping the tab you are already on returns it to its root. This matters for Teams and
    // nowhere else: `selectedTeam` rides along through every tab switch (so swiping out to
    // Stats and back keeps the team page you were reading), and without this nothing would clear
    // it, so once any team page had been opened the four-team grid would be unreachable. A team
    // opened from the Stats table is the stuck case: Back goes to Stats, and the Teams pill would
    // just re-open the same team.
    const backToRoot = v === view && via === 'pill'
    push({ view: v, team: backToRoot ? null : selectedTeam, game: null, player: null })
  }, [push, selectedTeam, view])
  // THE TOOLBAR'S TABS ABOVE A PHONE. The shell draws them (src/sectionNav.ts); this says which is
  // lit, carries the Stats dot, and routes a tap through selectTab so it is tracked as a pill and
  // a second tap on Teams still returns to the grid. The handler goes through a ref so the publish
  // is keyed on the two values that change, not on a fresh closure per render: every publish
  // re-renders the shell.
  const selectTabRef = useRef(selectTab)
  selectTabRef.current = selectTab
  const statsBadge = navBadge('stats')
  const statsBadgeNote = featureDots.note('wpbl/stats')
  useEffect(() => {
    if (!active) return
    publishSectionNav({
      section: 'wpbl',
      tabs: NAV.map(n => ({ key: n.key, label: n.label, href: wpblPathFor(n.key), badge: n.key === 'stats' && statsBadge, badgeNote: n.key === 'stats' ? statsBadgeNote : undefined })),
      active: view,
      onSelect: k => selectTabRef.current(k as WpblView, 'pill'),
    })
  }, [view, statsBadge, statsBadgeNote, active])
  useEffect(() => active ? () => clearSectionNav('wpbl') : undefined, [active])
  // Every team-page open in the section funnels through here, so it is the only place that can
  // count them all: the Teams grid, the standings table, the Stats table, the bracket and the
  // header search all reach a team page through it.
  //
  // `from` names the SURFACE, not the widget, and card-level events stay where they are because
  // they carry extra detail (the seed), so a bracket click lands in both. That is deliberate:
  // `wpbl_team_opened` is the total, `wpbl_bracket_team` is that card's own funnel. Adding the
  // two together double-counts.
  const selectTeam = useCallback(
    (t: WpblTeam | null, from = 'unknown') => {
      if (t) track(EVENTS.WPBL_TEAM_OPENED, { teamId: t.id, from })
      push({ view: 'teams', team: t, game: null, player: null })
    },
    [push],
  )
  // Bound per surface rather than as an inline arrow at each render site: StatsView takes
  // `onOpenTeam` into a useMemo dependency list, and a fresh identity on every render would
  // rebuild its whole table whenever anything else in the tree changed.
  const selectTeamFromHome      = useCallback((t: WpblTeam | null) => selectTeam(t, 'home'), [selectTeam])
  const selectTeamFromStandings = useCallback((t: WpblTeam | null) => selectTeam(t, 'standings'), [selectTeam])
  const selectTeamFromStats     = useCallback((t: WpblTeam | null) => selectTeam(t, 'stats'), [selectTeam])
  const selectTeamFromTeams     = useCallback((t: WpblTeam | null) => selectTeam(t, 'teams'), [selectTeam])
  const selectTeamFromSchedule  = useCallback((t: WpblTeam | null) => selectTeam(t, 'schedule'), [selectTeam])
  // From a game: the score lines at the top of Game Center, the box score's own team rows,
  // and the preview card's legend chips. Like `openGame` from a player, this closes the game
  // as it goes, so Back walks off the team page and lands back on the game.
  const selectTeamFromGame      = useCallback((t: WpblTeam) => selectTeam(t, 'game'), [selectTeam])
  // `opts` is how the team page asks for a specific board: the four-team comparison, or the
  // player table already filtered to one club. Omitted by every other caller, which keeps
  // the leader-card jumps behaving exactly as they did.
  const openStats  = useCallback((
    g: WpblStatsFocus['group'],
    sortKey?: string,
    opts?: Pick<WpblStatsFocus, 'mode' | 'teamId' | 'qualified' | 'playerId'>,
  ) => {
    setStatsFocus(f => ({ group: g, sortKey, ...opts, token: f.token + 1 }))
    selectTab('stats', 'link')
  }, [selectTab])
  // Tracking is a Stats group now, so "view the tracking boards" means "open Stats on it".
  const openTracking = useCallback(() => openStats('tracking'), [openStats])
  // A rank on a player's card: the full player board, unfiltered by club, so the row is there to
  // pick out. Pushed like any tab switch, so Back closes the board and reopens the card.
  const openBoardFromPlayer = useCallback((g: 'hitting' | 'pitching', sortKey: string, o: { qualified: boolean; playerId: string }) =>
    openStats(g, sortKey, { mode: 'players', teamId: null, ...o }), [openStats])
  // `awards` rides along on both of these: a player opened from the ballot leaves the ballot
  // open underneath, so her X returns to /wpbl/awards rather than dropping the reader on Home
  // with the sheet shut and their place in it lost.
  //
  // WHERE THE CLICK CAME FROM decides the history, on a desktop, because the side panel leaves the
  // page clickable. A row clicked on the PAGE while a panel is open is the reader working down a
  // list, so it SWAPS the panel (one entry, replaced, whatever was in it: a game or a player). A
  // link followed INSIDE a card (a player in Game Center's box score, a game in a player's log) is
  // a trip from that card, so it STACKS, and Back returns to the card. The cards are handed their
  // own openers below (openPlayerFromGame, openGameFromPlayer) for that; everything else on the page
  // calls these. Until Oct 6, 2026 a player clicked on the page with a game panel open landed over
  // the game behind a "‹ Game" control, which went back to a game the reader had not come from.
  const swapTo = useCallback((s: WpblSnap) => {
    apply(s)
    window.history.replaceState({ ...window.history.state, wpbl: stamp(s) }, '', urlFor(s))
    window.dispatchEvent(new Event(WPBL_PATH_EVENT))
  }, [apply, stamp, urlFor])
  // A season picked from any tab's menu. Its own history entry, since `?season=2026` is a different
  // page from the current year's and Back should undo the pick; whatever is open over the page stays.
  const pickSeason = useCallback((season: number | null) => {
    push({ view, team: selectedTeam, game: detailGame, player: detailPlayer, awards: awardsOpen, gamePage, playerPage, season })
  }, [push, view, selectedTeam, detailGame, detailPlayer, awardsOpen, gamePage, playerPage])
  // A panel on screen right now, which a click on the page swaps rather than stacks on.
  const panelShowing = playerAsPanel && ((!!detailPlayer && !showPlayerPage) || (!!detailGame && !showGamePage))
  const openGameAt = useCallback((g: WpblGame, fromCard: boolean) => {
    // From a full page, a game opens as a page too: another game from beside the Game Center (a
    // player's log), or a game from the log on a player's own page. Page to page, so it pushes.
    const s: WpblSnap = { view, team: selectedTeam, game: g, player: null, awards: awardsOpen, gamePage: (gamePage && !!detailGame) || showPlayerPage }
    // Never from the full page, which is a PAGE: following a link from one page to another adds a
    // step to Back everywhere else on the web, and a reader who went from game 4 of a series to
    // game 5 expects Back to return to game 4, not to the schedule they started on.
    if (!fromCard && panelShowing && !showGamePage) { swapTo(s); return }
    push(s)
  }, [push, swapTo, view, selectedTeam, awardsOpen, detailGame, gamePage, panelShowing, showGamePage, showPlayerPage])
  const openGame = useCallback((g: WpblGame) => openGameAt(g, false), [openGameAt])
  const openGameFromPlayer = useCallback((g: WpblGame) => openGameAt(g, true), [openGameAt])
  /**
   * The side panel's Expand: the same entry, now the full page. REPLACED rather than pushed, so
   * Back from the page goes where Back from the panel would have, to the tab underneath, rather
   * than shrinking the page back into a panel.
   */
  const expandGame = useCallback((tab: string | null) => {
    if (!detailGame) return
    // The board the panel was showing, so the page opens scrolled to it. A ref of its own rather
    // than pendingGameTab, which a cold link fills and every later game would then inherit.
    expandTab.current = tab
    const s: WpblSnap = { view, team: selectedTeam, game: detailGame, player: null, awards: awardsOpen, gamePage: true }
    apply(s)
    window.history.replaceState({ ...window.history.state, wpbl: stamp(s) }, '', urlFor(s))
    window.dispatchEvent(new Event(WPBL_PATH_EVENT))
  }, [apply, urlFor, stamp, view, selectedTeam, detailGame, awardsOpen])
  /** The player panel's Expand, on expandGame's terms: the same entry, now the full page, so Back
   *  from the page goes where Back from the panel would have. Whatever the panel sat over (a game
   *  panel, the ballot) goes with it: the page replaces the view, and a dialog over a page that has
   *  replaced the tabs would be over nothing. */
  const expandPlayer = useCallback(() => {
    if (!detailPlayer) return
    swapTo({ view, team: selectedTeam, game: null, player: detailPlayer, awards: false, playerPage: true })
  }, [swapTo, view, selectedTeam, detailPlayer])
  // `from` defaults to the surface the reader is standing on, which is right for every in-page
  // link. The header search has to override it: search works from every tab, so left to the
  // default a player opened from the search box reports whichever tab happened to be behind it.
  // Opening a player page is the retention event, which makes that the one attribution error
  // here worth spending a parameter on.
  const openPlayerAt = useCallback((p: WpblPlayer, from: string | undefined, fromCard: boolean) => {
    track(EVENTS.WPBL_PLAYER_OPENED, { playerId: p.id, teamId: p.team_id, from: from ?? (fromCard || showGamePage ? 'game' : view) })
    // The game stays under the player when the player came FROM it (the "‹ Game" panel), and when
    // the game is the full page, which is still on screen beside the panel; closing the player
    // then returns to the page rather than demoting the game to a panel. A player clicked on the
    // page over a game PANEL replaces the game instead.
    const keepGame = fromCard || showGamePage || !playerAsPanel
    const s: WpblSnap = { view, team: selectedTeam, game: keepGame ? detailGame : null, player: p, awards: awardsOpen, gamePage: keepGame && gamePage }
    // A player already open in the side panel is SWAPPED, not stacked: the panel leaves the page
    // clickable precisely so a reader can go down a leaderboard row by row, and a push per row
    // would make Back walk every one of them before it closed the panel. Replacing keeps the one
    // entry the panel opened with, so Back (and the X, which is Back) closes it in one step.
    if (!fromCard && panelShowing) { swapTo(s); return }
    push(s)
  }, [push, swapTo, view, selectedTeam, detailGame, awardsOpen, playerAsPanel, gamePage, panelShowing, showGamePage])
  const openPlayer = useCallback((p: WpblPlayer, from?: string) => openPlayerAt(p, from, false), [openPlayerAt])
  const openPlayerFromGame = useCallback((p: WpblPlayer) => openPlayerAt(p, undefined, true), [openPlayerAt])
  /**
   * Open the ballot, which is a push like any other modal so that Back closes it.
   *
   * `view` IS CARRIED RATHER THAN FORCED TO HOME. The card that opens this only exists on Home,
   * so in practice it is always 'home'; carrying it means that if the ballot ever gets a second
   * entry point, Back from it returns to the tab the reader was actually on rather than teleporting
   * them. A cold load of /wpbl/awards seeds Home underneath, which is where the ballot lives.
   */
  const openAwards = useCallback(() => {
    push({ view, team: selectedTeam, game: null, player: null, awards: true })
  }, [push, view, selectedTeam])
  // Closing a modal (X or Escape) walks history back, so it and the browser Back button are
  // the same action and never fall out of sync.
  const closeTop   = useCallback(() => window.history.back(), [])
  /**
   * The ballot's own ✕ and backdrop, which on a desktop can be clicked while a player panel opened
   * FROM the ballot is still on screen beside it. Plain Back would close the panel, the entry on
   * top, and leave the ballot open: the control the reader pressed would be the one thing that did
   * not close. Two steps instead, the player's entry and the ballot's under it, which is exactly
   * how the two were opened (openPlayer pushes over the ballot and only ever replaces after that).
   * Escape still takes the panel first, as the newest shell.
   */
  const closeAwards = useCallback(() => {
    if (detailPlayer && playerAsPanel) window.history.go(-2)
    else window.history.back()
  }, [detailPlayer, playerAsPanel])
  usePreloadGameDetail()

  // Full roster of every player, loaded once: the pool the header search filters over.
  useEffect(() => { fetchWpblAllPlayers().then(setPlayers).catch(() => {}) }, [])

  // Warm the datasets the landing view will ask for, in parallel with the teams/schedule
  // read above rather than after it.
  //
  // Home owns these reads, but Home cannot mount until `loading` clears, and `loading`
  // clears only when teams+schedule resolve, so without this they queue behind that round trip:
  // a serialized second of latency that buys nothing, since none of these reads depend on teams
  // or games. Firing them here overlaps the two waves.
  //
  // This is a warm-up, not a load: the results land in the api layer's session cache and the
  // rest is unchanged. Home still owns the fetching, still renders from the same cache
  // getters, and still revalidates on its own schedule. If Home mounts while these are in
  // flight, `once()` hands it the same promises instead of issuing a second set; if they have
  // already settled, Home seeds straight from cache and skips the round trip entirely.
  //
  // Deliberately scoped to a Home landing. Deep links (a shared ?game=, or ?view=stats) open
  // a view that wants a different, smaller slice, so this should not be speculative. The
  // whole-season play log is not warmed here: it is the most expensive read on the section and
  // Home fetches it last on purpose (see the play-log effect in home/WpblHome.tsx). Nor are the box-score
  // lines when the calendar says Home will not draw them (homeLandingReadsLines): warming a read
  // nothing consumes is the whole cost and none of the benefit.
  const landsOnHome = useRef(view === 'home')
  useEffect(() => {
    if (!landsOnHome.current) return
    void Promise.all([
      homeLandingReadsLines() ? fetchWpblAllLines() : null,
      fetchWpblTrackedGameIds(),
      fetchWpblArticles(),
      // The gallery, which leads Home in the offseason and so is the card most in need of the
      // head start.
      fetchWpblFanPhotoIndex(),
      // The Watch card's posters. It sits on Home in both halves of the year and second from the
      // top in the offseason, and without this its read queued behind the Home chunk, starting
      // half a second after everything else.
      fetchWpblVideos(),
    ]).catch(() => { /* Home's own effect surfaces failures; this is only a head start */ })
  }, [])

  // Open the game named in a shared ?game=<id> link, once the schedule is available. A
  // final opens on its Recap tab by itself (see GameDetailModal), which is what the Discord
  // recap link is pointing at.
  //
  // Two spellings, as with a player: the canonical /wpbl/games/<slug> path, and the legacy
  // ?game=<uuid> still carried by shared links, push payloads and the Discord bot's posts.
  // A slug naming no game is left alone rather than falling back to the tab: the edge has
  // already answered a real 404 for it, and rendering the section instead would turn a dead
  // link into a soft 404. The slug needs the clubs as well as the schedule, because the
  // matchup half of it is nicknames.
  useEffect(() => {
    const id = pendingGameId.current
    const slug = pendingGameSlug.current
    if ((!id && !slug) || detailGame || games.length === 0) return
    if (slug && teams.length === 0) return
    pendingGameId.current = null
    pendingGameSlug.current = null
    setLandingPage(null)
    const g = slug ? findWpblGameBySlug(slug, games, teams) : games.find(gm => gm.id === id)
    if (!g) return
    // A game arrived at, rather than opened from a row, is the full page. See WpblSnap.gamePage.
    openFromLink({ view, team: selectedTeam, game: g, player: detailPlayer, gamePage: true })
  }, [games, teams, detailGame, view, selectedTeam, detailPlayer, openFromLink])

  // Open the player named by the URL, once the roster is available. Two spellings: the
  // canonical /wpbl/players/<slug> path, and the legacy ?player=<uuid> that shared links and
  // the Discord bot still carry (the edge 301s those, but a client-side entry can skip it).
  //
  // A slug that resolves to nobody is left alone rather than falling back to Home: the edge
  // has already answered 404 for it on a cold load, and quietly showing the section instead
  // would turn a dead link into a soft 404.
  useEffect(() => {
    if (detailPlayer || players.length === 0) return
    const slug = pendingPlayerSlug.current
    const id = pendingPlayerId.current
    if (!slug && !id) return
    pendingPlayerSlug.current = null
    pendingPlayerId.current = null
    if (!pendingGameSlug.current) setLandingPage(null)
    const p = slug ? findWpblPlayerBySlug(slug, players) : players.find(pl => pl.id === id)
    if (!p) return
    // Arrived at, so the full page, unless the link names a game as well (`?game=`): then the game
    // is the page and the player the panel beside it, whichever of the two resolves first.
    const withGame = !!detailGame || !!pendingGameSlug.current || !!pendingGameId.current
    openFromLink({ view, team: selectedTeam, game: detailGame, player: p, gamePage, playerPage: !withGame })
  }, [players, detailPlayer, view, selectedTeam, detailGame, gamePage, openFromLink])

  // A cold load on /wpbl/teams/<slug>: select that club once the clubs are in.
  //
  // `replaceState` rather than `openFromLink`, which is the whole difference between this and
  // the player effect above. A club is not a modal over a tab, it is the tab in a particular
  // state, so there is nothing for Back to unwind to and nothing to seat an entry under: the
  // reader is already where the URL says. Pushing here would make Back a no-op that appears
  // to do nothing, which is the trap openFromLink exists to avoid in the other direction.
  //
  // A slug that names no club is left alone rather than falling back to the bare tab. The
  // edge never sees these (they are enumerated in _redirects, so an unknown one is a real 404
  // before the app loads), but a stale link from a renamed club should not quietly render the
  // Teams tab under a URL claiming to be a club that no longer exists.
  useEffect(() => {
    if (teams.length === 0) return
    const slug = pendingTeamSlug.current
    if (!slug) return
    pendingTeamSlug.current = null
    const t = findWpblTeamBySlug(slug, teams)
    if (!t) return
    setSelectedTeam(t)
    setView('teams')
    // Stamp the entry the shell already created, which was seated before the clubs loaded and
    // so carries `team: null`. Without this the club is on screen and absent from the
    // snapshot, and the first Back or a refresh drops it while the address bar still names it.
    const snap: WpblSnap = { view: 'teams', team: t, game: null, player: null }
    // The club's own path, NOT `window.location.href`: anything that ran before the roster
    // landed has already had a chance to rewrite the bar, and re-stamping whatever is in it
    // would make that rewrite permanent. This is the one place that knows the URL is right.
    window.history.replaceState({ ...window.history.state, wpbl: stamp(snap) }, '',
      wpblTeamPath(t, teams) + (pickedSeasonRef.current != null ? `?season=${pickedSeasonRef.current}` : ''))
    window.dispatchEvent(new Event(WPBL_PATH_EVENT))
  }, [teams, stamp])

  usePageSeo({
    active, detailPlayer, detailGame, players, games, teams, view, awardsOpen, pickedSeason, selectedTeam,
  })

  const { openingSeason } = useWpblSearch({ searchActive, players, teams, games, openPlayer, selectTeam })

  // Stamp the entry App created for /wpbl with the initial snapshot the first time we land,
  // so the first Back leaves the section and a refresh restores the view. On a Back/remount
  // the entry already carries a snapshot: leave it untouched.
  //
  // NOT FROM BEHIND A STANDALONE PAGE. A search opened on /wpbl/league mounts this section hidden
  // (App.tsx), and stamping then would rewrite the address to the section root under the reader.
  useEffect(() => {
    if (!window.history.state?.wpbl && wpblAppOwnsPath(window.location.pathname)) {
      // `awards` IS LOAD-BEARING HERE. This runs on a cold load, before anything else, and `urlFor`
      // of a snapshot without it returns /wpbl: landing on /wpbl/awards would rewrite the address bar
      // to the section root in the first tick, so a copied link would lose the ballot before the page
      // had drawn. Same failure the Teams branch of `seed` describes.
      const s: WpblSnap = {
        view, team: selectedTeam, game: detailGame, player: detailPlayer, awards: awardsOpen,
      }
      // A LINK STRAIGHT TO THE BALLOT NEEDS SOMETHING TO CLOSE BACK ONTO, which is the whole of
      // what `openFromLink` exists to do for a player link, spelled out here because the ballot
      // needs none of the rest of it: there is nothing to resolve out of the URL, so it never
      // reaches that function. Stamped as one entry that already has the sheet open, the session
      // would have a single history entry, and `closeTop` is `history.back()`, so the X, the
      // backdrop and Escape would walk the reader out of the site instead of onto Home. So seat a
      // sheet-less entry underneath and push the ballot on top, and closing behaves exactly as it
      // would had they opened it themselves. Both halves run in this one synchronous block, so
      // nothing paints on /wpbl.
      if (s.awards) {
        const base: WpblSnap = { ...s, awards: false }
        window.history.replaceState({ ...window.history.state, wpbl: stamp(base) }, '', urlFor(base))
        window.history.pushState({ ...window.history.state, wpbl: stamp(s) }, '', urlFor(s))
      } else {
        window.history.replaceState({ ...window.history.state, wpbl: stamp(s) }, '', urlFor(s))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply snapshots as the user moves through history. Pops that land outside /wpbl are the
  // App router swapping sections (MLB|WPBL): ignore them here.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      // Any path the section renders, which is every tab AND a player page. Comparing
      // against '/wpbl' alone would ignore every Back/Forward taken from /wpbl/standings and
      // friends; testing the tabs alone dropped every pop that LANDED on /wpbl/players/<slug>,
      // leaving the modals frozen while the address bar moved. See wpblAppOwnsPath.
      if (!wpblAppOwnsPath(window.location.pathname)) {
        // Left for a page the section does not draw. The section stays mounted behind it when that
        // is MLB (App.tsx), and its panels and sheets portal out of the hidden column, so close
        // them; the tab underneath stays as it was. Back to this entry reopens them from its
        // snapshot, and a fresh /wpbl is Home either way.
        setDetailGame(null); setDetailPlayer(null); setAwardsOpen(false)
        setGamePage(false); setPlayerPage(false)
        return
      }
      // No snapshot means nobody in the section pushed this entry, so the address is all there is
      // to go on. It was Home, which was right only while every way in from outside was /wpbl;
      // the league switch now lands on the tab the reader was on in MLB.
      apply((e.state?.wpbl as WpblSnap | undefined) ?? snapFromLocation())
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [apply])

  // The single in-progress game (there is only ever one at a time). The Game Center
  // (GameDetail) handles live + final alike, so opening any game routes there.
  const liveGame = useMemo(() => games.find(g => g.status === 'live') ?? null, [games])

  const reload = useCallback(() => {
    let cancelled = false
    // Don't spin forever if the backend is slow/overloaded: reveal the section (its views
    // show friendly empty states) after a few seconds. The reads still resolve and populate
    // teams/games when they land, so late data just fills in.
    const revealTimer = setTimeout(() => { if (!cancelled) setLoading(false) }, 10000)
    Promise.all([fetchWpblTeams(), fetchWpblSchedule()]).then(([t, g]) => {
      if (cancelled) return
      clearTimeout(revealTimer)
      setTeams(t); setFeedGames(g); setLoading(false)
    })
    // Deliberately NOT in that Promise.all: nothing waits on the mirrored calendar, and the
    // section must not sit behind it. It fills in the home clubs on the postseason rows when
    // it lands, and if it never lands those rows print exactly what they printed before the
    // table existed.
    fetchWpblSiteGames().then(rows => { if (!cancelled) setSiteGames(rows) }).catch(() => { /* keep last-good */ })
    return () => { cancelled = true; clearTimeout(revealTimer) }
  }, [])

  useEffect(() => reload(), [reload])
  // Stats' own reads beside the section's, not after them: see warmStatsReads. Only while the
  // section is still loading, since after that the tab mounts and asks for itself.
  // The year picked as the section opened; a year picked later is the tab's own read.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (loading && view === 'stats') warmStatsReads(pickedSeason) }, [loading, view])

  // Keep the schedule / scoreboard / standings live as the official-feed ingest writes scores
  // and status changes. Teams are static, so only the schedule is re-fetched. Faster while a
  // game is in progress; `useForegroundInterval` owns the rest of the policy (front-of-screen
  // only, and a pull the moment the page comes back, bfcache restores included) for this and
  // the section's other live polls.
  //
  // THIS IS ALSO THE POLL THAT DISCOVERS A GAME HAS STARTED. The live surfaces below only ever
  // refresh a row they already believe is live, so a page opened before first pitch learns
  // about it here or not at all: whatever stops this loop freezes the whole section on a
  // pre-game schedule while every countdown on it keeps ticking.
  useForegroundInterval(
    () => { fetchWpblSchedule().then(setFeedGames).catch(() => {}) },
    liveGame ? 20000 : 60000,
  )

  return (
    // The roster the whole section links players by. It sits at the top because a slug needs
    // the FULL roster to know whether a name is ambiguous, and a board holding only its own
    // club's list would mint a bare slug for a name someone on another club also holds. See
    // LinkContext.tsx.
    <WpblLinkProvider roster={players} schedule={games} teams={teams}>
    <WpblSeasonProvider picked={pickedSeason} onPick={pickSeason} schedule={games}>
    {/* While a player or game modal is open it IS the page, so the tab underneath stops
        rendering an <h1> and the modal supplies it. See PageHeading.tsx. */}
    <WpblHeadingOwnerProvider owned={!detailPlayer && !detailGame}>
    {/* Cap + center on wide screens (site convention); full width on mobile. */}
    {/* THE COLUMN TRACKS THE SCALE, it is not a fixed screen width. What a text column is
        designed against is its own type, so pinning it at a screen width while the desktop
        scale moves makes every row wider than the words in it: club names on the left of a
        Teams card with their record marooned at the far right, a schedule row with a gulf
        between the matchup and the time. Home and the stats table break out of this column on
        purpose and DO spend extra width, on another chip and more columns; a list has nothing
        to spend it on. `chromePx` keeps the ratio the design was drawn at whatever the scale
        becomes. */}
    {/* A little room under the toolbar on a phone, where the first block (the scoreboard) would
        otherwise sit ~4px from it. A -1.5 tuck lived here for the pill row the phone used to pin
        up there, which the bottom bar replaced. */}
    <Box sx={{
      maxWidth: { xs: PHONE_COLUMN_W, md: chromePx(720) }, mx: 'auto', mt: { xs: 0.5, sm: 0 },
      ...panelShiftSx(panelOpen, contentW),
    }}>
      {/* No tab row here: on a phone the tabs are the bottom bar, and above that the shell's
          toolbar draws them from what this section publishes (src/sectionNav.ts). */}

      {/* Floor the view height on mobile so even a short tab (e.g. Standings) is tall enough to
          scroll the app toolbar fully off, so the page can keep it hidden (matching the tucked
          state the tab pager restores) instead of springing the toolbar back.
          ABOVE A PHONE TOO, a screen tall, as MLB holds its tabs (MlbStats.tsx). The Suspense
          fallback in App.tsx is a screen tall, and a skeleton shorter than that pulled the shared
          footer up into view and then the loaded tab shoved it back off: on Schedule at 760px,
          by five thousand pixels. */}
      <Box sx={{
        minHeight: { xs: 'calc(100dvh - 24px)', sm: '100dvh' },
        // Scroll room under the floating bar, plus the device's own safe-area inset, so the
        // last card in a tab can always be scrolled clear of it.
        pb: bottomNav ? `calc(${BOTTOM_NAV_SPACE} + env(safe-area-inset-bottom, 0px))` : 0,
      }}>
      {/* THE FULL GAME CENTER, in place of the tabs rather than over them. The pager below stays
          mounted, hidden, so the tab a reader came from is exactly as they left it when Back
          closes the page. */}
      {showGamePage && detailGame && (
        <AppErrorBoundary inline where="tab">
          <Suspense fallback={<DetailPageSkeleton width={GAME_PAGE_W} />}>
            <GameDetailModal
              key={detailGame.id}
              layout="page"
              game={detailGame}
              initialTab={expandTab.current ?? pendingGameTab.current}
              initialSide={pendingGameSide.current}
              teams={teams}
              games={games}
              onClose={closeTop}
              onOpenPlayer={openPlayer}
              onOpenTeam={selectTeamFromGame}
            />
          </Suspense>
        </AppErrorBoundary>
      )}
      {/* A PLAYER'S FULL PAGE, on the same terms. Its game log opens games as pages too (see
          openGameAt), so a reader can go page to page and Back walks them in order. */}
      {showPlayerPage && detailPlayer && (
        <AppErrorBoundary inline where="tab">
          <Suspense fallback={<DetailPageSkeleton width={PLAYER_PAGE_W} />}>
            <PlayerDetailModal
              key={detailPlayer.id}
              layout="page"
              player={detailPlayer}
              openingSeason={openingSeason?.playerId === detailPlayer.id ? openingSeason.season : null}
              teams={teams}
              games={games}
              players={players}
              onClose={closeTop}
              onOpenGame={openGameFromPlayer}
              onOpenBoard={openBoardFromPlayer}
            />
          </Suspense>
        </AppErrorBoundary>
      )}
      {landingAsPage && <DetailPageSkeleton width={landingPage === 'game' ? GAME_PAGE_W : PLAYER_PAGE_W} />}
      {loading
        ? (showGamePage || showPlayerPage || landingAsPage ? null : view === 'home' ? <WpblHomeSkeleton /> : view === 'stats' ? <StatsSkeleton newBoards={newBoards} /> : <TabSkeleton view={view} />)
        : (
          // One panel per nav tab, in NAV order, so mobile can swipe between them. The `active` flag lets a
          // view react to becoming current after a swipe reuses its already-mounted node (e.g. Schedule
          // re-snapping to the next game); SwipeableViews keeps visited tabs mounted but hidden.
          // Full-bleed the swipe track to the screen edge on mobile (cancel the app's p:2 gutter), then hand
          // that 16px back to each pane via `padX`, so a swiped pane slides fully off-screen instead of
          // disappearing under a padded barrier.
          <Box sx={{ mx: { xs: -2, sm: 0 }, display: showGamePage || showPlayerPage || landingAsPage ? 'none' : undefined }}>
          <SwipeableViews
            index={NAV.findIndex(n => n.key === view)}
            onIndexChange={i => selectTab(NAV[i].key, 'swipe')}
            minHeight={isMobileView ? 'calc(100dvh - 24px)' : undefined}
            padX={isMobileView ? 16 : 0}
            // KEPT ALIVE ON A DESKTOP TOO, as MLB's are. Without it the pager renders the active tab
            // alone above a phone's width, so every switch to Home threw away the gallery, Reading,
            // Watch and the rest and rebuilt them from their fetches: a waste the reader saw, since
            // each card redrew from its skeleton. A hidden tab neither polls nor holds the <h1>
            // (PanelActiveContext below, lib/panelActive.ts).
            keepAlive
            warmNeighborsFirst
            panels={NAV.map(n => {
              // EACH TAB HOLDS ITS OWN ERRORS. The pager keeps every visited tab mounted, so without
              // this a crash in one board took the bottom nav and the other four tabs down with it.
              const content = <AppErrorBoundary inline where="tab">{(() => {
                switch (n.key) {
                  case 'home':      return <WpblHome teams={teams} games={games} siteGames={siteGames} liveGame={liveGame} onOpenGame={openGame} onOpenPlayer={openPlayer} onOpenTeam={selectTeamFromHome} onViewStats={openStats} onViewTracking={openTracking} awardsOpen={awardsOpen} onOpenAwards={openAwards} onCloseAwards={closeAwards} />
                  case 'schedule':  return <ScheduleView teams={teams} games={games} siteGames={siteGames} onOpenGame={openGame} onOpenTeam={selectTeamFromSchedule} onOpenPlayer={openPlayer} active={view === 'schedule'} />
                  case 'standings': return <StandingsView teams={teams} games={games} onOpenTeam={selectTeamFromStandings} />
                  case 'stats':     return <WpblStatsView teams={teams} games={games} focus={statsFocus} active={view === 'stats'} newBoards={newBoards} onBoardSeen={markBoardSeen} onOpenPlayer={openPlayer} onOpenTeam={selectTeamFromStats} onOpenGame={openGame} />
                  case 'teams':     return <TeamsView teams={teams} games={games} selected={selectedTeam} onSelect={selectTeamFromTeams} onOpenGame={openGame} onOpenPlayer={openPlayer} onOpenStats={openStats} />
                }
              })()}</AppErrorBoundary>
              // On mobile the footer lives at the bottom of each tab pane rather than as one shared element
              // below the swipe area, so it slides with its page. Swiping lands on the new tab's top (its
              // footer off-screen) and a partial swipe that springs back moves nothing; no shared footer
              // reflows or pops mid-swipe. `mt: auto` pins it to the bottom of the floored pane on short tabs,
              // right after content on tall ones.
              const panel = (body: React.ReactNode) => (
                <PanelActiveContext.Provider key={n.key} value={n.key === view}>{body}</PanelActiveContext.Provider>
              )
              if (!isMobileView || !renderFooter) return panel(content)
              return panel(
                // Short tabs (Standings) don't scroll, so the footer pinned to the bottom of this
                // floored column landed underneath the floating bar. Shorten the floor by the
                // bar's height when it's on, so the footer comes to rest just above it.
                <Box sx={{ display: 'flex', flexDirection: 'column',
                  minHeight: bottomNav
                    ? `calc(100dvh - 24px - (${BOTTOM_NAV_SPACE}) - env(safe-area-inset-bottom, 0px))`
                    : 'calc(100dvh - 24px)' }}>
                  {content}
                  <Box sx={{ mt: 'auto' }}>{renderFooter()}</Box>
                </Box>
              )
            })}
          />
          </Box>
        )}
      </Box>

      {bottomNav && (
        <WpblBottomNav
          items={[
            ...NAV.map(n => ({ key: n.key, label: n.label, badge: navBadge(n.key) })),
            // The sixth slot: opens the sheet of non-tab pages (the phone's counterpart to the
            // toolbar's More menu).
            { key: MORE_KEY, label: 'More' },
          ]}
          value={view}
          onChange={k => selectTab(k as WpblView, 'pill')}
          onMore={() => setMoreSheetOpen(true)}
          moreOpen={moreSheetOpen}
        />
      )}
      {bottomNav && <MoreSheet open={moreSheetOpen} onClose={() => setMoreSheetOpen(false)} />}

      {/* /wpbl/awards after the ballot card has left Home: see FanAwardsSheet. Before that date the
          card draws the sheet itself, so exactly one of the two ever does. */}
      {awardsOpen && !awardsResultsShowOnHome() && (
        <FanAwardsSheet teams={teams} games={games} scheduleSettled={!loading}
          onOpenPlayer={openPlayer} onOpenTeam={selectTeamFromHome}
          onOpen={openAwards} onClose={closeTop} />
      )}

      {detailPlayer && !showPlayerPage && (
        <Suspense fallback={<ModalChunkFallback />}>
          <PlayerDetailModal
            player={detailPlayer}
            openingSeason={openingSeason?.playerId === detailPlayer.id ? openingSeason.season : null}
            teams={teams}
            games={games}
            players={players}
            onClose={closeTop}
            onOpenGame={openGameFromPlayer}
            onOpenBoard={openBoardFromPlayer}
            panel={playerAsPanel}
            // Over the Game Center panel, this is one panel that navigated: Back is the way out.
            // Not beside the full page, which is still on screen and needs no way back to.
            onBack={detailGame && playerAsPanel && !showGamePage ? closeTop : undefined}
            backLabel="Game"
            onExpand={expandPlayer}
          />
        </Suspense>
      )}

      {detailGame && !showGamePage && (
        <Suspense fallback={<ModalChunkFallback />}>
          <GameDetailModal
            // Keyed, so a swap to another game remounts it (see GameOverlayHost).
            key={detailGame.id}
            game={detailGame}
            initialTab={pendingGameTab.current}
            initialSide={pendingGameSide.current}
            teams={teams}
            games={games}
            onClose={closeTop}
            onOpenPlayer={openPlayerFromGame}
            onOpenTeam={selectTeamFromGame}
            panel={playerAsPanel}
            onExpand={expandGame}
          />
        </Suspense>
      )}
    </Box>
    </WpblHeadingOwnerProvider>
    </WpblSeasonProvider>
    </WpblLinkProvider>
  )
}

// Memoized, as MlbStats is: the shell re-renders on every path change, which is the end of every
// tab click, and the section follows the address through its own popstate listener, so a shell
// render has nothing to tell it. Its one prop is a stable callback (App's renderWpblFooter).
export default memo(WpblApp)

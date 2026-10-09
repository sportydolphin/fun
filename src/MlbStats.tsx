import React, { memo, Suspense, useEffect, useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Box, Typography, useMediaQuery, SwipeableDrawer } from '@mui/material'
import { useMlbState } from './mlb/state/useMlbState'
import type { MlbView } from './mlb/state/useMlbState'
import { ACCENT_TEXT } from './mlb/constants'
import BottomNav, { BOTTOM_NAV_SPACE, MORE_KEY } from './ui/BottomNav'
import { requestDeepLink } from './mlb/state/deepLink'
import type { DeepLink } from './mlb/state/deepLink'
import { FinalGamesSection } from './mlb/views/FinalGames'
import { GameRoute } from './mlb/views/GameRoute'
import { SeriesRoute } from './mlb/views/SeriesRoute'
import { mlbTargetFromPath, MLB_SHORT_REF_PARAM, MLB_SHORT_REF_VALUE } from './mlb/routes'

// `?ref=short` means a short link (functions/m) sent this reader here. Read when the chunk loads,
// before the section's first address rewrite drops the query, and counted once on mount. Only a
// human load runs this, so it counts opens and never the crawler fetches behind an unfurl.
let arrivedViaShort = new URLSearchParams(window.location.search).get(MLB_SHORT_REF_PARAM) === MLB_SHORT_REF_VALUE
const arrivedAt = window.location.pathname
import { SegControl } from './mlb/components/ui'
import { HomeView, Standings, TeamsView, LeaderboardView, StatsView, VizView, SearchView, MlbPlayerDetail, MlbPlayerPanel, preloadAllMlbViews } from './mlb/views/lazyViews'
import { saveDataOn } from './lib/saveData'
import { useSearchBridgeQuery, updateSearchBridge, setSearchQuery } from './mlb/state/SearchBridgeContext'
import { clearHomeOverlay } from './mlb/state/homeOverlay'
import { fetchSuggestions } from './mlb/views/SuggestedPlayers'
import { MLB_VIEW_PATHS, MLB_NAV, MLB_MORE_PAGES, mlbUrlFor, mlbPlayerPath, mlbGamePath, type MlbNavKey } from './mlb/routes'
import { linkTo } from './nav'
import { setDynamicSeo } from './seo'
import { track, EVENTS } from './lib/analytics'
import { chromePx } from './ui/scale'
import { HOME_W, PHONE_COLUMN_W } from './ui/layoutWidths'
import { MlbPageH1 } from './mlb/components/PageHeading'
import SwipeableViews from './ui/SwipeableViews'
import { useSwipeNav } from './AccessibilityContext'
import { AppErrorBoundary } from './AppErrorBoundary'
import { pushEntry, sheetOpenAt, stackNextPanel } from './mlb/state/sheetHistory'
import { usePlayerPanel, closePlayerPanel, usePlayerPanelRestore } from './mlb/state/playerPanel'
import { gamePageShowing } from './mlb/state/gamePage'
import { panelShiftSx, useSidePanelOpen, useOpensAsPanel } from './ui/ModalShell'
import { PanelActiveContext, useSectionActive } from './lib/panelActive'
import { publishSectionNav, clearSectionNav } from './sectionNav'

// ─── Navigation ───────────────────────────────────────────────────────────────
//
// FIVE TABS, THE SAME SHAPE AS WPBL (Sep 28, 2026). There were six pills in a sideways scroller,
// and at 375px wide two of them (Stats, Search) were off the screen. Now:
//   - Scores and Teams are tabs of their own; neither had one.
//   - Leaderboard, Stats and Visualize were three tabs over the same numbers. They are the three
//     BOARDS of one Stats tab. They stay separate views underneath, each with its own address
//     (/mlb/leaders, /mlb/stats, /mlb/charts; see mlb/routes.ts).
//   - Search is the toolbar's alone; the player and team pages it opens are the view 'search'.
//   - Everything that is a board inside a Home card (Predictions, Survivor, Milestones, Roster
//     moves) or a mode of another tab (Odds, Charts) is one tap away under More.
// On a phone the tabs are WPBL's floating bottom bar (src/ui/BottomNav); above that, pills.

type NavKey = MlbNavKey
const NAV = MLB_NAV
const STATS_BOARDS: { view: MlbView; label: string }[] = [
  { view: 'leaderboard', label: 'Leaders' },
  { view: 'stats',       label: 'Table' },
  { view: 'viz',         label: 'Charts' },
]
const navKeyFor = (v: MlbView): NavKey | null =>
  v === 'leaderboard' || v === 'viz' ? 'stats' : v === 'search' ? null : v
/** The h1 of a tab that draws no title of its own. Close to the <title> in seo.ts, without the
 *  pitch: the heading names the page, the title also sells it. */
const TAB_H1: Partial<Record<MlbView, string>> = {
  // Home draws its own, visibly (HomeView).
  standings:   'MLB Standings',
  leaderboard: 'MLB Stat Leaders',
  stats:       'MLB Player Stats',
  viz:         'MLB Charts',
}

/** A tab's address, for its href and for the history entry it pushes. */
const viewHref = (v: MlbView): string => v === 'search' ? MLB_VIEW_PATHS.home : MLB_VIEW_PATHS[v]

// Under More: each opens a board that lives inside another view, by a deep link that view's
// owner already listens for (state/deepLink.ts), so nothing here reaches into a component.
interface MoreItem { key: string; label: string; hint: string; view: MlbView; link?: DeepLink; charts?: boolean }
const MORE: MoreItem[] = [
  { key: 'predictions', label: 'Predictions',      hint: 'Pick the winners, against the bots',            view: 'home',      link: { kind: 'predictor' } },
  { key: 'survivor',    label: 'Streak Survivor',  hint: 'One hitter a day: the leaderboard',              view: 'home',      link: { kind: 'survivor' } },
  { key: 'milestones',  label: 'Milestone Watch',  hint: 'Who is closing in on a round number',            view: 'home',      link: { kind: 'milestones' } },
  { key: 'moves',       label: 'Roster moves',     hint: 'Trades, signings, call-ups and DFAs',            view: 'home',      link: { kind: 'rosterMoves' } },
  { key: 'bracket',     label: 'Postseason bracket', hint: 'Every series, game by game',                 view: 'standings', link: { kind: 'bracket' } },
  { key: 'odds',        label: 'Playoff odds',     hint: 'Every club, simulated nightly',                  view: 'standings', link: { kind: 'odds' } },
  { key: 'charts',      label: 'Charts & payroll', hint: 'Run differential, ERA vs OPS, payroll vs wins',  view: 'viz',       charts: true },
]

const moreRowSx = {
  display: 'flex', flexDirection: 'column', gap: 0.1, cursor: 'pointer',
  py: 1, borderBottom: '1px solid', borderColor: 'divider',
  // last-child, not last-of-type: the page rows after the boards are anchors, so of-type would
  // drop the rule under the last board as well as under the last row.
  '&:last-child': { borderBottom: 'none' },
} as const

/** A callback with one identity forever that always calls the latest `fn`. For props handed to a
 *  memoized child, where a fresh function each time would undo the memo. */
function useLatest<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn)
  ref.current = fn
  return useCallback((...args: A) => ref.current(...args), [])
}

// MEMOIZED, so the app shell re-rendering (which it does on every toolbar change) does not
// re-render the whole section. Its one prop is a stable callback in App.tsx; keep it that way.
export default memo(MlbStats)

// The data tabs' column on a desktop, in SCREEN pixels: 1280 as it was drawn under the old
// `zoom: 1.4` (Oct 2026). Fixed rather than chromePx because it is a column with somewhere to put
// the room, more stat columns, so when the scale came down to 1.25 the content inside got smaller
// and the column kept its width. Home's column is WPBL's (src/ui/layoutWidths.ts).
const PAGE_W = 1792
// The full Game Center page's own column (GamePageLayout in LiveGameCenter.tsx), which is what moves
// aside for a player's panel opened from its box score.
const GAME_PAGE_W = chromePx(1200)

function MlbStats({ renderFooter }: { renderFooter?: () => ReactNode } = {}) {
  const state = useMlbState()
  // False while the reader is in WPBL and this section is kept mounted behind it (App.tsx). Every
  // effect below that reaches outside the section (the toolbar's search and tabs, the page's tags)
  // waits for it, or the hidden section would answer the other one's search box.
  const active = useSectionActive()
  const panelPlayer = usePlayerPanel()
  usePlayerPanelRestore(useOpensAsPanel())
  // The full Game Center page (GameRoute) draws in this column, in place of the tabs and pages.
  const [gamePageOpen, setGamePageOpen] = useState(false)
  // `noSsr` so the bar is in the very first layout rather than inserted a frame later (the same
  // note as WpblApp's). The width matches App.tsx's isDesktop, which decides where the footer goes:
  // the bar and the section's own footer must switch at exactly the same width.
  const isDesktop = useMediaQuery('(min-width: 600px)', { noSsr: true })
  const bottomNav = !isDesktop
  // Whether the tabs are a finger-driven pager, by the same two tests SwipeableViews makes: a phone,
  // and the reader not having turned swiping off. When it is, the pager owns each tab's scroll.
  const isMobileView = useMediaQuery('(max-width:600px)')
  const swipeNav = useSwipeNav()
  const pagerOn = isMobileView && swipeNav
  useEffect(() => {
    if (!arrivedViaShort) return
    arrivedViaShort = false
    const t = mlbTargetFromPath(arrivedAt)
    track(EVENTS.MLB_SHARE_OPENED, { kind: t?.series ? 'series' : t?.gamePk ? 'game' : t?.playerId ? 'player' : 'other' })
  }, [])
  const canHover = useMediaQuery('(hover: hover)')
  // The query alone. This section PUBLISHES the rest of the bridge, so subscribing to all of it
  // re-rendered the section on its own every publish.
  const bridgeQuery = useSearchBridgeQuery()

  // Sync query typed in the toolbar → useMlbState debounced search
  useEffect(() => {
    if (active) state.setQuery(bridgeQuery)
  }, [bridgeQuery, active]) // eslint-disable-line react-hooks/exhaustive-deps

  // Push current result state + selection handlers up to the toolbar bridge
  const handleBridgeSelect = useCallback((fn: () => void, dest: Record<string, any>) => {
    state.stampCurrentEntry()
    pushEntry(dest, mlbUrlFor(dest as { view: MlbView }))
    fn()
    setSearchQuery('')
    state.setView('search')
  }, [state.stampCurrentEntry, state.setView]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!active) return
    updateSearchBridge({
      playerResults: state.playerResults,
      teamResults: state.teamResults,
      searching: state.searching,
      handleSelectPlayer: p => {
        track(EVENTS.MLB_PLAYER_OPENED, { playerId: (p as any).id, from: 'header_search' })
        handleBridgeSelect(() => state.selectPlayer(p as any, { recordRecent: true }), { view: 'search', playerId: (p as any).id })
      },
      handleSelectTeam: t => {
        track(EVENTS.MLB_TEAM_OPENED, { teamId: (t as any).id, from: 'header_search' })
        handleBridgeSelect(() => state.selectTeam(t as any, { recordRecent: true }), { view: 'search', teamId: (t as any).id })
      },
      isRegistered: true,
    })
  }, [state.playerResults, state.teamResults, state.searching, handleBridgeSelect, active]) // eslint-disable-line react-hooks/exhaustive-deps

  // A player page's title and description. seo.ts describes the tabs and the thirty clubs from a
  // table; a player cannot be in one, since the name arrives with a fetch. Keyed on the player's
  // canonical path, which is the address the URL sync writes, so it cannot outlive the page.
  const seoPlayer = active && state.view === 'search' ? state.player : null
  useEffect(() => {
    if (!seoPlayer) return
    const pos = seoPlayer.primaryPosition?.abbreviation
    const club = seoPlayer.currentTeam?.name
    const who = [pos, club].filter(Boolean).join(', ')
    setDynamicSeo({
      path: mlbPlayerPath(seoPlayer),
      seo: {
        title: `${seoPlayer.fullName} stats, game log and career | sportydolphin.fun`,
        description: `${seoPlayer.fullName}${who ? ` (${who})` : ''}: season and career stats, where they rank in the majors, the game log, career trends and contract.`,
      },
    })
    return () => setDynamicSeo(null)
  }, [seoPlayer])

  // Fetch toolbar suggestions whenever the followed team changes
  useEffect(() => {
    if (!active) return
    let live = true
    fetchSuggestions(state.followedTeamId ?? 0, [])
      .then(sugs => { if (live) updateSearchBridge({ toolbarSuggestions: sugs }) })
      .catch(() => {})
    return () => { live = false }
  }, [state.followedTeamId, active])

  // Push recent searches + their re-open / clear handlers up to the toolbar
  const { recentSearches, handleTeamSearchClick, handleFollowedPlayerClick, clearRecentSearches } = state
  useEffect(() => {
    if (!active) return
    updateSearchBridge({
      recentSearches,
      handleSelectRecent: (item) => {
        setSearchQuery('')
        if (item.type === 'team') handleTeamSearchClick(item.id, 'recent')
        else handleFollowedPlayerClick(item.id, 'recent')
      },
      clearRecentSearches,
    })
  }, [recentSearches, handleTeamSearchClick, handleFollowedPlayerClick, clearRecentSearches, active])

  // Unregister from the toolbar when this section unmounts or is hidden behind WPBL. Within one
  // commit React runs every cleanup before any setup, so this lands before WPBL registers.
  useEffect(() => {
    if (!active) return
    return () => {
      updateSearchBridge({ isRegistered: false, playerResults: [], teamResults: [], searching: false, handleSelectPlayer: null, handleSelectTeam: null, toolbarSuggestions: [], recentSearches: [], handleSelectRecent: null, clearRecentSearches: null })
      setSearchQuery('')
    }
  }, [active])

  // Warm every other view once this one has had the network to itself, on the same few-second
  // footing as App.tsx's warming of the other section, so a later tab tap does not wait on a chunk.
  // Skipped under Data Saver, as that one is: a tab tap then waits on its chunk, which is the trade
  // the reader asked for.
  useEffect(() => {
    if (saveDataOn()) return
    const t = window.setTimeout(preloadAllMlbViews, 4000)
    return () => window.clearTimeout(t)
  }, [])

  // Tab changes, with how they happened. A pill tap marks itself; every other change of view is a
  // card or stat link doing its job, EXCEPT Back and Forward, which restore a view rather than
  // choose one and are not counted (the same rule as wpbl_tab_viewed). Landing on the section is
  // not a tab change either. And a link into 'search' is a player or team opening, already
  // counted with its source by mlb_player_opened / mlb_team_opened, so it is not counted twice.
  const tabVia = useRef<'pill' | 'swipe' | 'back' | null>(null)
  const prevView = useRef(state.view)
  useEffect(() => {
    // Cleared once the pop has settled: a Back that lands on the same view (player to player)
    // never runs the effect below, and a flag left standing would swallow the next real change.
    const onPop = () => {
      tabVia.current = 'back'
      setTimeout(() => { if (tabVia.current === 'back') tabVia.current = null }, 0)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  useEffect(() => {
    const from = prevView.current
    const via = tabVia.current ?? 'link'
    prevView.current = state.view
    tabVia.current = null
    if (from === state.view || via === 'back') return
    if (via === 'link' && state.view === 'search') return
    track(EVENTS.MLB_TAB_VIEWED, { view: state.view, via, from })
  }, [state.view])

  // Which tab is lit. A player or team page is the view 'search', which is no tab: a team page
  // lights Teams, and a player lights the tab the reader came from, so a player opened from the
  // Stats leaders still reads as being inside Stats.
  const lastTab = useRef<NavKey>(navKeyFor(state.view) ?? 'home')
  const direct = navKeyFor(state.view)
  if (direct) lastTab.current = direct
  const activeTab: NavKey = direct ?? (state.team && !state.player ? 'teams' : lastTab.current)
  // The Stats tab returns to whichever board was last open, Leaders the first time.
  const lastBoard = useRef<MlbView>(state.view === 'stats' || state.view === 'viz' ? state.view : 'leaderboard')
  if (state.view === 'leaderboard' || state.view === 'stats' || state.view === 'viz') lastBoard.current = state.view

  // Every deliberate move to another view: a fresh start (never let a stale Home modal reopen
  // from a prior Back-restore path, see homeOverlay), a history entry, and the tab event's `via`.
  const go = useCallback((v: MlbView, via: 'pill' | 'swipe' | 'link' = 'pill') => {
    clearHomeOverlay()
    if (via !== 'link') tabVia.current = via
    state.stampCurrentEntry()
    // The destination's own address, not the current one, and through pushEntry, which closes a
    // game side panel open beside the page and takes its entry. See sheetHistory.ts.
    pushEntry({ view: v }, viewHref(v))
    // On a phone the pager returns each tab to where the reader left it, so a move from one tab to
    // another leaves the scroll to it. Everything else (a desktop, a board within Stats, a page that
    // is no tab) starts the destination at its top.
    const pagerScrolls = pagerOn && state.view !== 'search' && v !== 'search' && navKeyFor(v) !== navKeyFor(state.view)
    if (v !== 'search') state.clearSelection()
    state.setView(v)
    if (!pagerScrolls) requestAnimationFrame(() => window.scrollTo({ top: 0 }))
  }, [state.stampCurrentEntry, state.setView, state.clearSelection, state.view, pagerOn]) // eslint-disable-line react-hooks/exhaustive-deps
  const tabView = (k: NavKey): MlbView => k === 'stats' ? lastBoard.current : k
  const goTab = (k: NavKey, via: 'pill' | 'swipe' = 'pill') => {
    const target = tabView(k)
    if (target === state.view) return
    go(target, via)
  }

  const [moreOpen, setMoreOpen] = useState(false)
  const openMore = (item: MoreItem) => {
    setMoreOpen(false)
    if (item.charts) state.setVizDefaultTab('graphs')
    if (item.view !== state.view) go(item.view, 'link')
    // Published after the view change: the board's owner takes it when it mounts, or at once if
    // it already is. See useDeepLink.
    if (item.link) requestDeepLink(item.link)
  }

  // THE TOOLBAR'S TABS ON A DESKTOP. The shell draws them (src/sectionNav.ts); this says which is
  // lit, where Stats currently points, and routes a tap through goTab so the tab change is tracked
  // and a player page closes the way a pill tap always closed it. Keyed on the two values that can
  // change, not on a fresh object per render, since every publish re-renders the shell.
  const selectNav = useLatest((k: string) => goTab(k as NavKey))
  const selectMore = useLatest((key: string) => { const m = MORE.find(x => x.key === key); if (m) openMore(m) })
  const statsHref = viewHref(tabView('stats'))
  useEffect(() => {
    if (!active) return
    publishSectionNav({
      section: 'mlb',
      tabs: NAV.map(n => ({ key: n.key, label: n.label, href: n.key === 'stats' ? statsHref : viewHref(n.key) })),
      active: activeTab,
      onSelect: selectNav,
      more: MORE.map(m => ({ key: m.key, label: m.label, hint: m.hint, onSelect: () => selectMore(m.key) })),
    })
  }, [activeTab, statsHref, selectNav, selectMore, active])
  useEffect(() => active ? () => clearSectionNav('mlb') : undefined, [active])

  // ONE IDENTITY FOR THE LIFE OF THE SECTION, calling whatever the handler is now. The real
  // handlers are rebuilt whenever what they close over changes, and opening a team does exactly
  // that the instant it is tapped (the team is set before the page switches), so a memoized Home
  // was handed new props and re-rendered in full, inside the tap, a frame before being replaced.
  const homeTeamClick     = useLatest(state.handleTeamSearchClick)
  const homePlayerClick   = useLatest(state.handleFollowedPlayerClick)
  const homeFollowTeam    = useLatest(state.followTeam)
  const homeUnfollowTeam  = useLatest(state.unfollowTeam)
  const homeFollowPlayer  = useLatest(state.followPlayer)
  const homeUnfollowPlayer = useLatest(state.unfollowPlayer)

  // The same footing as the handlers above: stampCurrentEntry is rebuilt with the view state.
  const openReportCards = useLatest(() => {
    state.stampCurrentEntry()
    pushEntry({ view: 'viz' }, MLB_VIEW_PATHS.viz)
    state.clearSelection()
    state.setVizDefaultTab('report-card')
    state.setView('viz')
    // Land at the top of the report cards, not wherever the home page was scrolled.
    requestAnimationFrame(() => window.scrollTo({ top: 0 }))
  })

  // The Home dashboard reads best at a tighter width; the data-dense views
  // (search/stats/leaderboard/viz) use the full width for side-by-side columns.
  // HOME IS SIZED, NOT CAPPED: its width is WPBL Home's, which is wider than the shell's padding
  // leaves below about 1300px, so a maxWidth would stop short and the two Homes would not line up.
  // Centred with a margin rather than WPBL's transform, which would also move the sticky bars and
  // the fixed-position sheets inside it.
  const onHome = state.view === 'home'
  const columnSx = onHome
    ? { maxWidth: { xs: PHONE_COLUMN_W, md: 'none' }, width: { md: HOME_W }, mx: { xs: 'auto', md: 0 }, ml: { md: `calc((100% - ${HOME_W}) / 2)` } }
    : { maxWidth: { xs: PHONE_COLUMN_W, md: PAGE_W }, mx: 'auto' }
  // The page moves aside for a game's side panel as far as its left gutter allows (panelShiftSx).
  // These columns are wide, so below about 1900px it barely moves and the panel covers their right
  // edge, which is the trade WPBL's Home and stats table make too.
  const panelOpen = useSidePanelOpen()
  const shift = panelShiftSx(panelOpen, gamePageOpen ? GAME_PAGE_W : onHome ? HOME_W : `${PAGE_W}px`)
  const onSearch = state.view === 'search'
  const tabIndex = NAV.findIndex(n => n.key === activeTab)
  // The pager mounts with the first tab the reader is shown, and stays mounted from then on.
  const pagerMounted = useRef(false)
  if (!onSearch) pagerMounted.current = true
  // The player page's Back. Within the section it is the browser's, so it returns to the exact
  // board the player was opened from; landed on cold (a shared link, a search result) there is
  // nothing of ours behind it, so it goes to the tab the page lights instead of off the site.
  const playerBack = () => {
    if (pagerMounted.current) window.history.back()
    else go(tabView(lastTab.current), 'link')
  }

  // On a phone the site footer ends each page, inside it, so it slides with its tab rather than
  // reflowing under a swipe; the column is floored to the screen less the bar, so on a short page
  // the footer comes to rest just above the bar rather than under it. The same arrangement as WPBL.
  //
  // The Suspense is OUTSIDE the footer, so the footer waits for the page's chunk with it. Inside,
  // an empty page drew the footer resting on the bar, and the page landing shoved it 900px down
  // the screen: invisible on a fast machine, where the chunk is in before first paint, and caught
  // by the layout sweep on CI's slower runner on Oct 9, 2026. Callers must not add their own
  // Suspense around the content, or that one catches the suspension and the footer shows again.
  const withFooter = (content: ReactNode): ReactNode => {
    if (!bottomNav || !renderFooter) return <Suspense fallback={null}>{content}</Suspense>
    return (
      <Suspense fallback={null}>
        <Box sx={{ display: 'flex', flexDirection: 'column',
          minHeight: `calc(100dvh - 24px - (${BOTTOM_NAV_SPACE}) - env(safe-area-inset-bottom, 0px))` }}>
          {content}
          <Box sx={{ mt: 'auto', pt: 4 }}>{renderFooter()}</Box>
        </Box>
      </Suspense>
    )
  }

  const tabContent = (k: NavKey): ReactNode => {
    switch (k) {
      case 'home': return (
        <HomeView
          allTeams={state.allTeams}
          followedTeamId={state.followedTeamId}
          onFollowTeam={homeFollowTeam}
          onUnfollowTeam={homeUnfollowTeam}
          followedPlayerIds={state.followedPlayerIds}
          onFollowPlayer={homeFollowPlayer}
          onUnfollowPlayer={homeUnfollowPlayer}
          onPlayerClick={homePlayerClick}
          onTeamClick={homeTeamClick}
          onViz={openReportCards}
        />
      )
      case 'scores': return (
        <FinalGamesSection
          layout="page"
          followedTeamId={state.followedTeamId}
          onPlayerClick={state.handleFollowedPlayerClick}
          onTeamClick={state.handleTeamSearchClick}
        />
      )
      case 'standings': return (
        <Standings season={state.season} onTeamClick={state.handleVizNavigate} highlightTeamId={state.followedTeamId} />
      )
      case 'teams': return (
        <TeamsView followedTeamId={state.followedTeamId} onTeamClick={id => state.handleTeamSearchClick(id)} />
      )
      case 'stats': {
        // The board last open, which is the one on screen whenever this tab is.
        const board = lastBoard.current
        return (
          <>
            <Box sx={{ display: 'flex', justifyContent: { xs: 'flex-start', sm: 'center' }, mb: 2 }}>
              <SegControl
                options={STATS_BOARDS.map(b => ({ value: b.view, label: b.label, href: viewHref(b.view) }))}
                value={board}
                onChange={v => go(v as MlbView)}
              />
            </Box>
            {board === 'viz' && (
              <VizView
                vizSeason={state.vizSeason}
                setVizSeason={state.setVizSeason}
                teamSummaries={state.teamSummaries}
                loadingViz={state.loadingViz}
                nameMap={state.nameMap}
                handleVizNavigate={state.handleVizNavigate}
                handleLbPlayerClick={state.handleLbPlayerClick}
                canHover={canHover}
                defaultTab={state.vizDefaultTab}
              />
            )}
            {board === 'leaderboard' && (
              <LeaderboardView
                lbGroup={state.lbGroup}
                setLbGroup={state.setLbGroup}
                vizSeason={state.vizSeason}
                setVizSeason={state.setVizSeason}
                gameScope={state.lbGameScope}
                setGameScope={state.setLbGameScope}
                lbData={state.lbData}
                loadingLb={state.loadingLb}
                lbSelectedKeys={state.lbSelectedKeys}
                setLbSelectedKeys={state.setLbSelectedKeys}
                isDesktop={isDesktop}
                canHover={canHover}
                handleLbPlayerClick={state.handleLbPlayerClick}
                onOpenStats={state.openStatsBoard}
              />
            )}
            {board === 'stats' && (
              <StatsView
                lbGroup={state.lbGroup}
                setLbGroup={state.setLbGroup}
                vizSeason={state.vizSeason}
                setVizSeason={state.setVizSeason}
                allTime={state.statsAllTime}
                setAllTime={state.setStatsAllTime}
                gameScope={state.lbGameScope}
                setGameScope={state.setLbGameScope}
                lbData={state.lbData}
                lbFullscreen={state.lbFullscreen}
                setLbFullscreen={state.setLbFullscreen}
                lbStatsLimit={state.lbStatsLimit}
                setLbStatsLimit={state.setLbStatsLimit}
                lbQualified={state.lbQualified}
                setLbQualified={state.setLbQualified}
                isDesktop={isDesktop}
                canHover={canHover}
                handleLbPlayerClick={state.handleLbPlayerClick}
                highlightPlayerId={state.statsHighlightPlayerId}
                highlightStatKey={state.statsHighlightStatKey}
                setHighlightPlayerId={state.setStatsHighlightPlayerId}
                setHighlightStatKey={state.setStatsHighlightStatKey}
              />
            )}
          </>
        )
      }
    }
  }

  return (
    // Scaled up on a desktop by the root's --app-type / --app-chrome (styles.css), as WPBL is.
    <Box sx={{
      ...columnSx, ...shift,
      // Scroll room under the floating bar, plus the device's safe-area inset, so the last card and
      // the footer can always be scrolled clear of it.
      pb: bottomNav ? `calc(${BOTTOM_NAV_SPACE} + env(safe-area-inset-bottom, 0px))` : 0,
    }}>

      {/* The dev-settings gear + mobile-device preview now live app-wide in App.tsx
          (src/dev/DevSettings.tsx) so they cover both the MLB and WPBL sections. */}

      {/* No tab row here above a phone's width: the shell's toolbar draws the tabs and More there,
          from what the effect above publishes (src/sectionNav.ts). */}

      {/* THE TAB'S CONTENT, AT LEAST A SCREEN TALL. On a phone the site footer renders inside it
          (withFooter), so while a tab is still loading the footer sat just under a few lines of
          placeholder and was shoved off the screen as the content arrived: 0.14 of layout shift on
          the Leaders board, the most visited MLB tab. Holding the content a screen tall keeps the
          footer below the fold from the first paint. */}
      <Box sx={{ minHeight: '100dvh' }}>
      {/* The tabs whose name only the nav says. Scores and Teams draw their own; a player or club
          page and a game sheet supply theirs (mlb/components/PageHeading.tsx). */}
      {TAB_H1[state.view] && <MlbPageH1>{TAB_H1[state.view]}</MlbPageH1>}

      {/* THE FIVE TABS, KEPT MOUNTED ONCE VISITED, the way WPBL's are. Each view fetched on mount,
          so every tab change unmounted the one being left and refetched the one arrived at:
          Standings and Scores re-read StatsAPI and redrew from a skeleton on every visit, and Back
          from a player opened off Home rebuilt Home from nothing. On a phone the same pager is the
          swipe between tabs. A player or club page is no tab, so it draws over the pager, which
          stays mounted and hidden beneath it; it is first mounted by a tab, so a reader who lands
          on a player page from a search result does not pay for Home behind it. A hidden tab
          neither polls nor holds the page's h1 (lib/panelActive.ts). */}
      {pagerMounted.current && (
        // Full-bleed on a phone, with the 16px gutter handed back inside each pane (padX), so a
        // swiped pane slides all the way off the screen rather than vanishing at the gutter.
        <Box sx={{ display: onSearch || gamePageOpen ? 'none' : 'block', mx: { xs: -2, sm: 0 } }}>
          <SwipeableViews
            index={tabIndex}
            onIndexChange={i => goTab(NAV[i].key, 'swipe')}
            minHeight={isMobileView ? 'calc(100dvh - 24px)' : undefined}
            padX={isMobileView ? 16 : 0}
            keepAlive
            panels={NAV.map((n, i) => (
              <PanelActiveContext.Provider key={n.key} value={!onSearch && i === tabIndex}>
                {/* Its own boundary, so one tab crashing cannot take the bar and the other four with
                    it, and its own Suspense (in withFooter), so a chunk still loading for a tab
                    warmed behind the reader never blanks the one on screen. */}
                {withFooter(
                  <AppErrorBoundary inline where="tab">{tabContent(n.key)}</AppErrorBoundary>,
                )}
              </PanelActiveContext.Provider>
            ))}
          />
        </Box>
      )}

      {/* A PLAYER'S PAGE: the card fetches its own data (views/MlbPlayerDetail), the section only
          says which player and which season. Keyed by player, so the next one starts at its own top
          rather than inheriting the last one's role tab and scope. */}
      {onSearch && state.player && !gamePageOpen && withFooter(
        <AppErrorBoundary inline where="tab">
          <MlbPlayerDetail
            key={state.player.id}
            playerId={state.player.id}
            player={state.player}
            season={state.playerSeason}
            onSeasonChange={state.setPlayerSeason}
            onBack={playerBack}
            onOpenBoard={(key, group) => state.handleStatCardClick(key, group)}
            onOpenGame={pk => requestDeepLink({ kind: 'game', gamePk: pk })}
            followed={state.followedPlayerIds.includes(state.player.id)}
            onToggleFollow={() => {
              const id = state.player!.id
              if (state.followedPlayerIds.includes(id)) state.unfollowPlayer(id)
              else state.followPlayer(id)
            }}
          />
        </AppErrorBoundary>,
      )}

      {onSearch && !state.player && !gamePageOpen && withFooter(
        <SearchView
          query={state.query}
          setQuery={state.setQuery}
          playerResults={state.playerResults}
          teamResults={state.teamResults}
          searching={state.searching}
          dropdownOpen={state.dropdownOpen}
          setDropdownOpen={state.setDropdownOpen}
          selectTeam={state.selectTeam}
          onPlayerClick={state.handleFollowedPlayerClick}
          onTeamClick={state.handleTeamSearchClick}
          team={state.team}
          palette={state.palette}
          setPalette={state.setPalette}
          season={state.season}
          loadingStats={state.loadingStats}
          hasStats={state.hasStats}
          rankMode={state.rankMode}
          setRankMode={state.setRankMode}
          currentAvailableSeasons={state.currentAvailableSeasons}
          handleSeasonChange={state.handleSeasonChange}
          teamHitting={state.teamHitting}
          teamPitching={state.teamPitching}
          selectedTeamHitStats={state.selectedTeamHitStats}
          setSelectedTeamHitStats={state.setSelectedTeamHitStats}
          selectedTeamPitStats={state.selectedTeamPitStats}
          setSelectedTeamPitStats={state.setSelectedTeamPitStats}
          toggleTeamHitStat={state.toggleTeamHitStat}
          toggleTeamPitStat={state.toggleTeamPitStat}
          teamHitLeaders={state.teamHitLeaders}
          teamPitLeaders={state.teamPitLeaders}
          teamCardProps={state.teamCardProps}
          showFeaturedRight={state.showFeaturedRight}
          featuredPlayers={state.featuredPlayers}
          featuredHitLeaders={state.featuredHitLeaders}
          featuredPitLeaders={state.featuredPitLeaders}
          divisionStandings={state.divisionStandings}
          teamRoster={state.teamRoster}
        />,
      )}

      {/* A player as the desktop side panel, opened from a row on the page or from Game Center.
          Keyed by player, so another one is a remount, which sheetHistory reads as a swap. */}
      {panelPlayer && (
        <AppErrorBoundary inline where="tab">
          <Suspense fallback={null}>
            <MlbPlayerPanel
              key={panelPlayer.id}
              playerId={panelPlayer.id}
              player={panelPlayer.player}
              stacked={panelPlayer.stacked}
              path={panelPlayer.path}
              initialSeason={panelPlayer.season}
              onClose={() => closePlayerPanel(panelPlayer.id)}
              onExpand={season => state.openPlayerPage(panelPlayer.id, season)}
              onOpenBoard={(key, group, season) => state.handleStatCardClick(key, group, false, { playerId: panelPlayer.id, season })}
              onOpenGame={pk => {
                // The game this player was opened from is still beneath, as a panel or the page:
                // going back is the way there.
                if (sheetOpenAt(mlbGamePath(pk)) || gamePageShowing(pk)) { window.history.back(); return }
                // Otherwise a trip from the card: Game Center draws over it, and Back returns.
                stackNextPanel()
                requestDeepLink({ kind: 'game', gamePk: pk })
              }}
              followed={state.followedPlayerIds.includes(panelPlayer.id)}
              onToggleFollow={() => {
                const id = panelPlayer.id
                if (state.followedPlayerIds.includes(id)) state.unfollowPlayer(id)
                else state.followPlayer(id)
              }}
            />
          </Suspense>
        </AppErrorBoundary>
      )}

      {/* Game Center reached by its address, /mlb/games/<pk>, over whichever tab is up. */}
      <GameRoute onPlayerClick={homePlayerClick} onTeamClick={homeTeamClick} onPage={setGamePageOpen} />
      {/* A postseason series reached by its address, /mlb/postseason/<season>/<slot>. */}
      <SeriesRoute onPlayerClick={homePlayerClick} onTeamClick={homeTeamClick} />

      </Box>

      {bottomNav && (
        <BottomNav
          items={[...NAV.map(n => ({ key: n.key, label: n.label, href: viewHref(tabView(n.key)) })), { key: MORE_KEY, label: 'More' }]}
          value={activeTab}
          onChange={k => goTab(k as NavKey)}
          onMore={() => setMoreOpen(true)}
          moreOpen={moreOpen}
          // The active tab is a label, so it takes the text-safe accent: the raw #60a5fa read at
          // 2.5:1 on the light bar. The "new" dot is a fill, which wants the solid one.
          accent={ACCENT_TEXT}
          badgeColor="var(--wpbl-accent-solid)"
          label="MLB sections"
          moreLabel="More MLB pages"
        />
      )}
      {bottomNav && (
        <SwipeableDrawer
          anchor="bottom"
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          onOpen={() => {}}
          disableSwipeToOpen
          // The same sheet as WPBL's More: capped to the bar's width, rounded top corners, clear of
          // the iOS home indicator, flicked down to dismiss.
          PaperProps={{ sx: {
            maxWidth: chromePx(460), mx: 'auto', left: 0, right: 0,
            borderTopLeftRadius: 16, borderTopRightRadius: 16,
            bgcolor: 'background.paper',
            pb: 'calc(env(safe-area-inset-bottom, 0px) + 8px)',
          } }}
        >
          <Box sx={{ px: 2, pt: 1 }}>
            <Box aria-hidden sx={{ width: chromePx(36), height: chromePx(4), borderRadius: 2, bgcolor: 'divider', mx: 'auto', mb: 1.5 }} />
            {MORE.map(m => (
              <Box key={m.key} role="button" onClick={() => openMore(m)} sx={moreRowSx}>
                <Typography sx={{ fontSize: '0.95rem', fontWeight: 700 }}>{m.label}</Typography>
                <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', lineHeight: 1.35 }}>{m.hint}</Typography>
              </Box>
            ))}
            {/* The section's standalone pages, after its boards. Real links, since they are pages. */}
            {MLB_MORE_PAGES.map(pg => {
              const link = linkTo(pg.href)
              return (
                <Box key={pg.href} component="a" href={link.href}
                  onClick={(e: React.MouseEvent<HTMLAnchorElement>) => { link.onClick(e); if (e.defaultPrevented) setMoreOpen(false) }}
                  sx={{ ...moreRowSx, textDecoration: 'none', color: 'inherit' }}>
                  <Typography sx={{ fontSize: '0.95rem', fontWeight: 700 }}>{pg.label}</Typography>
                  <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', lineHeight: 1.35 }}>{pg.hint}</Typography>
                </Box>
              )
            })}
          </Box>
        </SwipeableDrawer>
      )}
    </Box>
  )
}

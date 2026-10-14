import React, { memo, Suspense, useEffect, useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Box, useMediaQuery } from '@mui/material'
import { useMlbState } from './mlb/state/useMlbState'
import type { MlbView } from './mlb/state/useMlbState'
import { ACCENT_TEXT } from './mlb/constants'
import BottomNav, { BOTTOM_NAV_SPACE, MORE_KEY } from './ui/BottomNav'
import { requestDeepLink, parseDeepLink } from './mlb/state/deepLink'
import { MoreSheet } from './ui/MoreMenu'
import { FinalGamesSection } from './mlb/views/FinalGames'
import { GameRoute } from './mlb/views/GameRoute'
import { SeriesRoute } from './mlb/views/SeriesRoute'
import { mlbTargetFromPath, MLB_SHORT_REF_PARAM, MLB_SHORT_REF_VALUE, MLB_MORE, type MlbMoreRow } from './mlb/routes'

// `?ref=short` means a short link (functions/m) sent this reader here. Read when the chunk loads,
// before the section's first address rewrite drops the query, and counted once on mount. Only a
// human load runs this, so it counts opens and never the crawler fetches behind an unfurl.
let arrivedViaShort = new URLSearchParams(window.location.search).get(MLB_SHORT_REF_PARAM) === MLB_SHORT_REF_VALUE
const arrivedAt = window.location.pathname
import { PageTabs } from './ui/PageTabs'
import { PillGroup } from './ui/PillGroup'
import { HomeView, Standings, TeamsView, LeaderboardView, StatsView, VizView, SeasonGridView, MlbBestsView, MlbFindView, SearchView, MlbPlayerDetail, MlbPlayerPanel, preloadAllMlbViews } from './mlb/views/lazyViews'
import { saveDataOn } from './lib/saveData'
import { useSearchBridgeQuery, updateSearchBridge, setSearchQuery } from './mlb/state/SearchBridgeContext'
import { clearHomeOverlay } from './mlb/state/homeOverlay'
import { fetchSuggestions } from './mlb/views/SuggestedPlayers'
import { MLB_VIEW_PATHS, MLB_NAV, MLB_STATS_TABS, isMlbStatsBoard, type MlbStatsBoard, type MlbStatsTab, mlbUrlFor, mlbPlayerPath, mlbGamePath, type MlbNavKey } from './mlb/routes'
import { navigate } from './nav'
import { setDynamicSeo } from './seo'
import { track, EVENTS } from './lib/analytics'
import { chromePx } from './ui/scale'
import { HOME_W, PHONE_COLUMN_W, STATS_W } from './ui/layoutWidths'
import { MlbTabTitle } from './mlb/components/PageHeading'
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
//   - Leaderboard, Stats and Visualize were three tabs over the same numbers. They became BOARDS of
//     one Stats tab, each still its own view and address (/mlb/leaders, /mlb/stats; see routes.ts).
//     Charts (/mlb/charts) moved on to Standings in Oct 2026: it was the one Stats board with no
//     Hitting / Pitching / Fielding side, and run differential and payroll are standings questions.
//   - Search is the toolbar's alone; the player and team pages it opens are the view 'search'.
//   - Everything that is a board inside a Home card (Predictions, Survivor, Milestones, Roster
//     moves) or a mode of another tab (Odds, Charts) is one tap away under More, and so is the one
//     page that is no tab, the report cards (MLB_MORE in routes.ts).
// On a phone the tabs are WPBL's floating bottom bar (src/ui/BottomNav); above that, pills.

type NavKey = MlbNavKey
const NAV = MLB_NAV
// WPBL's first five boards in WPBL's order, so the row reads the same in both sections. Bests and
// Find read the mirrored box scores (seasonLines.ts); WPBL's Analysis boards need every play stored
// on our side, which MLB does not have yet: see "WPBL's Stats boards on MLB" in ROADMAP.md.
const STATS_BOARD_LABEL: Record<MlbStatsTab, string> = {
  leaderboard: 'Leaders',
  stats:       'Players',
  teamStats:   'Teams',
  bests:       'Bests',
  find:        'Find',
}
const STATS_BOARDS = MLB_STATS_TABS.map(view => ({ view, label: STATS_BOARD_LABEL[view] }))
/** The row's tab for a Stats view: Players on its Fielding side is the 'fielding' view. */
const statsTabFor = (v: MlbStatsBoard): MlbStatsTab => (v === 'fielding' ? 'stats' : v)
const navKeyFor = (v: MlbView): NavKey | null =>
  isMlbStatsBoard(v) ? 'stats' : v === 'viz' ? 'standings' : v === 'search' || v === 'reportCards' ? null : v

/** The side of the game every Stats board switches between. */
type StatsSide = 'hitting' | 'pitching' | 'fielding'
/** The views with a fielding answer: Leaders, Teams, and Players (whose fielding side is its own view). */
const FIELDING_VIEWS = new Set<MlbView>(['leaderboard', 'stats', 'teamStats', 'fielding'])

/** A tab's address, for its href and for the history entry it pushes. */
const viewHref = (v: MlbView): string => v === 'search' ? MLB_VIEW_PATHS.home : MLB_VIEW_PATHS[v]

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
  const lastBoard = useRef<MlbStatsBoard>(isMlbStatsBoard(state.view) ? state.view : 'leaderboard')
  if (isMlbStatsBoard(state.view)) lastBoard.current = state.view

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
    const pagerScrolls = pagerOn && !!navKeyFor(state.view) && !!navKeyFor(v) && navKeyFor(v) !== navKeyFor(state.view)
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
  // A More row, opened in place: the view its address names, then the board its `?open=` names,
  // published after the view change so the board's owner takes it when it mounts, or at once if it
  // already is (useDeepLink). A row that is no view of this section (Compare, the glossary) is a
  // page the shell draws, so it is a navigation.
  const openMore = (row: MlbMoreRow) => {
    setMoreOpen(false)
    const target = mlbTargetFromPath(row.href.split('?')[0])
    if (!target || target.view === 'search') { navigate(row.href); return }
    if (target.view !== state.view) go(target.view, 'link')
    const link = parseDeepLink(row.href)
    if (link) requestDeepLink(link)
  }

  // THE TOOLBAR'S TABS ON A DESKTOP. The shell draws them (src/sectionNav.ts); this says which is
  // lit, where Stats currently points, and routes a tap through goTab so the tab change is tracked
  // and a player page closes the way a pill tap always closed it. Keyed on the two values that can
  // change, not on a fresh object per render, since every publish re-renders the shell.
  const selectNav = useLatest((k: string) => goTab(k as NavKey))
  const selectMore = useLatest((key: string) => { const m = MLB_MORE.find(x => x.key === key); if (m) openMore(m) })
  const statsHref = viewHref(tabView('stats'))
  const onReportCards = state.view === 'reportCards'
  useEffect(() => {
    if (!active) return
    publishSectionNav({
      section: 'mlb',
      tabs: NAV.map(n => ({ key: n.key, label: n.label, href: n.key === 'stats' ? statsHref : viewHref(n.key) })),
      // The report cards are no tab, so none is lit and More is (ToolbarNav).
      active: onReportCards ? null : activeTab,
      onSelect: selectNav,
      more: MLB_MORE.map(m => ({ key: m.key, onSelect: () => selectMore(m.key) })),
    })
  }, [activeTab, onReportCards, statsHref, selectNav, selectMore, active])
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

  // Home's report card boards, "All boards": the report cards page.
  const openReportCards = useLatest(() => go('reportCards', 'link'))

  // The Home dashboard reads best at a tighter width; the data-dense views
  // (search/stats/leaderboard/viz) use the full width for side-by-side columns.
  // HOME IS SIZED, NOT CAPPED: its width is WPBL Home's, which is wider than the shell's padding
  // leaves below about 1300px, so a maxWidth would stop short and the two Homes would not line up.
  // Centred with a margin rather than WPBL's transform, which would also move the sticky bars and
  // the fixed-position sheets inside it.
  const onHome = state.view === 'home'
  // The Stats boards take WPBL Stats' width from `sm` up, centred the same way as Home. Below `sm`
  // the pager's full-bleed panes need the phone column as it is.
  const onStatsBoard = isMlbStatsBoard(state.view)
  const columnSx = onHome
    ? { maxWidth: { xs: PHONE_COLUMN_W, md: 'none' }, width: { md: HOME_W }, mx: { xs: 'auto', md: 0 }, ml: { md: `calc((100% - ${HOME_W}) / 2)` } }
    : onStatsBoard
    ? { maxWidth: { xs: PHONE_COLUMN_W, sm: 'none' }, width: { sm: STATS_W }, mx: { xs: 'auto', sm: 0 }, ml: { sm: `calc((100% - ${STATS_W}) / 2)` } }
    : { maxWidth: { xs: PHONE_COLUMN_W, md: PAGE_W }, mx: 'auto' }
  // The page moves aside for a game's side panel as far as its left gutter allows (panelShiftSx).
  // These columns are wide, so below about 1900px it barely moves and the panel covers their right
  // edge, which is the trade WPBL's Home and stats table make too.
  const panelOpen = useSidePanelOpen()
  const shift = panelShiftSx(panelOpen, gamePageOpen ? GAME_PAGE_W : onHome ? HOME_W : onStatsBoard ? STATS_W : `${PAGE_W}px`)
  const onSearch = state.view === 'search'
  // A page that is no tab, drawn over the pager as a player page is.
  const offPager = onSearch || onReportCards
  const tabIndex = NAV.findIndex(n => n.key === activeTab)
  // The pager mounts with the first tab the reader is shown, and stays mounted from then on.
  const pagerMounted = useRef(false)
  if (!offPager) pagerMounted.current = true
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
          {/* No gap above a footer that has stepped aside for the phone's stats table (SiteFooter):
              it would be 32px of nothing the pinned board has to leave room for. */}
          <Box sx={{ mt: 'auto', pt: 4, 'html[data-mlb-stats-table] &': { pt: 0 } }}>{renderFooter()}</Box>
        </Box>
      </Suspense>
    )
  }

  // ─── The Stats boards' side, and the switch every board draws ──────────────
  // ONE SWITCH, BUILT HERE, handed to each board, so the five boards cannot draw five versions of it
  // (they did: Players and Leaders had Hitting / Pitching, Fielding had none, Charts had its own).
  // Fielding is drawn on every board, so the switch is the same width and in the same place
  // everywhere, and pressed on a board with no fielding answer it goes to Leaders on Fielding. It
  // was drawn disabled until Oct 2026, faded under the contrast floor and doing nothing when pressed.
  const statsSide: StatsSide = state.view === 'fielding'
    || (state.statsFielding && (state.view === 'leaderboard' || state.view === 'teamStats')) ? 'fielding' : state.lbGroup
  const pickSide = (next: StatsSide) => {
    if (next === statsSide) return
    // What each board reset for itself when it owned the switch: a sort is a column of one side,
    // Find's conditions are fields of one side, and a picked-out row belonged to the old question.
    state.setLbFullscreen(null)
    state.setLbStatsLimit(50)
    state.setTeamGridSort(null)
    state.setGridHighlightId(null)
    if (state.view === 'find') state.setFindQuery(q => ({ ...q, conditions: [] }))
    if (next === 'fielding') {
      state.setStatsFielding(true)
      if (state.view === 'stats') go('fielding')
      else if (!FIELDING_VIEWS.has(state.view)) go('leaderboard')
      return
    }
    state.setStatsFielding(false)
    state.setLbGroup(next)
    if (state.view === 'fielding') go('stats')
  }
  const sideSwitch = (
    <PillGroup
      options={[
        { value: 'hitting', label: 'Hitting' }, { value: 'pitching', label: 'Pitching' },
        FIELDING_VIEWS.has(state.view)
          ? { value: 'fielding', label: 'Fielding' }
          : { value: 'fielding', label: 'Fielding', hint: 'Fielding is on Leaders, Players and Teams: opens Leaders' },
      ]}
      value={statsSide}
      onChange={v => pickSide(v as StatsSide)}
    />
  )
  // A board tab keeps the side where the board has it, and drops back to the last of Hitting and
  // Pitching where it does not, as WPBL's does (selectBoard in src/wpbl/StatsView.tsx).
  const pickBoard = (tab: MlbStatsTab) => {
    let target: MlbView = tab
    if (statsSide === 'fielding') {
      if (tab === 'stats') target = 'fielding'
      else state.setStatsFielding(tab === 'leaderboard' || tab === 'teamStats')
    }
    if (target !== state.view) go(target)
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
          date={state.scoresDate}
          onDateChange={state.setScoresDate}
          followedTeamId={state.followedTeamId}
          onPlayerClick={state.handleFollowedPlayerClick}
          onTeamClick={state.handleTeamSearchClick}
        />
      )
      // Charts is a mode of Standings with an address of its own (/mlb/charts): the same element in
      // both views, so the mode the reader left Standings on is still there when they come back.
      case 'standings': return (
        <>
          <MlbTabTitle sx={{ mb: 2 }}>MLB Standings</MlbTabTitle>
          <Standings season={state.season} onTeamClick={state.handleVizNavigate} highlightTeamId={state.followedTeamId}
            chartsHref={MLB_VIEW_PATHS.viz}
            onCharts={() => { if (state.view !== 'viz') go('viz') }}
            onLeaveCharts={() => { if (state.view === 'viz') go('standings') }}
            charts={state.view === 'viz' ? (
              <VizView
                show="graphs"
                boardTabs={null}
                isDesktop={isDesktop}
                vizSeason={state.vizSeason}
                setVizSeason={state.setVizSeason}
                teamSummaries={state.teamSummaries}
                loadingViz={state.loadingViz}
                nameMap={state.nameMap}
                handleVizNavigate={state.handleVizNavigate}
                handleLbPlayerClick={state.handleLbPlayerClick}
                canHover={canHover}
              />
            ) : null} />
        </>
      )
      case 'teams': return (
        <TeamsView followedTeamId={state.followedTeamId} onTeamClick={id => state.handleTeamSearchClick(id)} />
      )
      case 'stats': {
        // The board last open, which is the one on screen whenever this tab is.
        const board = lastBoard.current
        // WPBL's board row (src/ui/PageTabs): each board is its own address, so these are pages, and
        // they do not share a look with the Hitting / Pitching switch under them. Each board draws it
        // inside its pinned bar (views/StatsBar). On a phone it sits above the bar, whose top padding
        // makes up the rest of WPBL's gap.
        const boardTabs = (
          <PageTabs
            options={STATS_BOARDS.map(b => ({
              value: b.view, label: b.label,
              href: viewHref(statsSide === 'fielding' && b.view === 'stats' ? 'fielding' : b.view),
            }))}
            value={statsTabFor(board)}
            onChange={v => pickBoard(v as MlbStatsTab)}
            mb={{ xs: 1.25, sm: 1.25 }}
          />
        )
        return (
          // 4px past the pane's gutter on a phone, which is where WPBL Stats sits: its boards bleed to
          // 12px from the screen's edge, where every other tab keeps 16, for the width a name needs.
          // A flex column at least a screen tall, which the board's root grows into (StatsBar), so the
          // pinned bar and board have room to hold their place while the page scrolls.
          <Box sx={{
            mx: { xs: '-4px', sm: 0 }, display: 'flex', flexDirection: 'column', flexGrow: 1,
            minHeight: { sm: 'calc(100dvh - var(--app-header-h, 0px))' },
            // The phone's full table: a screen tall, so the section's own screen-tall floor (the box
            // around the pager) has no slack left to put AFTER the board, where the board's height
            // cap cannot know about it and the board would stop pinned short of the page's end.
            '@media (max-width:599.95px)': { 'html[data-mlb-stats-table] &': { minHeight: '100dvh' } },
          }}>
            {/* One title for the three boards, as WPBL's "WPBL Stats" is for its nine: the board row
                under it names the board, and a title that changed with it ("MLB Stat Leaders", "MLB
                Player Stats") was the one line that moved when the league switch kept the page.
                Each board keeps its own <title> in seo.ts. */}
            {/* 10px of the 20 under it moved into the pinned bar's top padding on a desktop, so a
                pinned bar does not sit hard against the toolbar. */}
            <MlbTabTitle sx={{ mb: { xs: 2, sm: 1 } }}>MLB Stats</MlbTabTitle>
            {(board === 'teamStats' || board === 'fielding') && (
              <SeasonGridView
                kind={board === 'teamStats' ? 'teams' : 'fielding'}
                boardTabs={boardTabs}
                isDesktop={isDesktop}
                lbGroup={state.lbGroup}
                fielding={statsSide === 'fielding'}
                sideSwitch={sideSwitch}
                vizSeason={state.vizSeason}
                setVizSeason={state.setVizSeason}
                gameScope={state.lbGameScope}
                setGameScope={state.setLbGameScope}
                onOpenPlayer={state.handleLbPlayerClick}
                onOpenTeam={state.handleVizNavigate}
                sort={board === 'teamStats' ? state.teamGridSort : state.fieldingSort}
                setSort={board === 'teamStats' ? state.setTeamGridSort : state.setFieldingSort}
                position={state.fieldingPos}
                setPosition={state.setFieldingPos}
                club={state.fieldingClub}
                setClub={state.setFieldingClub}
                highlightId={state.gridHighlightId}
                setHighlightId={state.setGridHighlightId}
              />
            )}
            {(board === 'bests' || board === 'find') && (() => {
              const lines = {
                boardTabs, isDesktop,
                lbGroup: state.lbGroup, sideSwitch,
                vizSeason: state.vizSeason, setVizSeason: state.setVizSeason,
                gameScope: state.lbGameScope, setGameScope: state.setLbGameScope,
                onOpenPlayer: state.handleLbPlayerClick,
                onOpenGame: (pk: number) => requestDeepLink({ kind: 'game', gamePk: pk }),
              }
              return board === 'bests'
                ? <MlbBestsView {...lines} />
                : <MlbFindView {...lines} query={state.findQuery} onQuery={state.setFindQuery} />
            })()}
            {board === 'leaderboard' && (
              <LeaderboardView
                boardTabs={boardTabs}
                lbGroup={state.lbGroup}
                fielding={statsSide === 'fielding'}
                sideSwitch={sideSwitch}
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
                onOpenFielding={key => state.openGridBoard({ view: 'fielding', sort: key, games: state.lbGameScope })}
              />
            )}
            {board === 'stats' && (
              <StatsView
                boardTabs={boardTabs}
                lbGroup={state.lbGroup}
                sideSwitch={sideSwitch}
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
          </Box>
        )
      }
    }
  }

  return (
    // Scaled up on a desktop by the root's --app-type / --app-chrome (styles.css), as WPBL is.
    <Box sx={{
      // A little room under the toolbar on a phone, WPBL's 4px (WpblApp), so a section switch does
      // not move every title 4px.
      mt: { xs: 0.5, sm: 0 },
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
        <Box sx={{ display: offPager || gamePageOpen ? 'none' : 'block', mx: { xs: -2, sm: 0 } }}>
          <SwipeableViews
            index={tabIndex}
            onIndexChange={i => goTab(NAV[i].key, 'swipe')}
            minHeight={isMobileView ? 'calc(100dvh - 24px)' : undefined}
            padX={isMobileView ? 16 : 0}
            keepAlive
            panels={NAV.map((n, i) => (
              <PanelActiveContext.Provider key={n.key} value={!offPager && i === tabIndex}>
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

      {/* THE REPORT CARDS, a page of their own under More (/mlb/report-cards). They were the first
          half of Charts, behind a switch inside a mode of Standings, three levels down for the boards
          Home links to most. */}
      {onReportCards && !gamePageOpen && withFooter(
        <AppErrorBoundary inline where="tab">
          <MlbTabTitle sx={{ mb: 2 }}>MLB Report Cards</MlbTabTitle>
          <VizView
            show="report-card"
            boardTabs={null}
            isDesktop={isDesktop}
            vizSeason={state.vizSeason}
            setVizSeason={state.setVizSeason}
            teamSummaries={state.teamSummaries}
            loadingViz={state.loadingViz}
            nameMap={state.nameMap}
            handleVizNavigate={state.handleVizNavigate}
            handleLbPlayerClick={state.handleLbPlayerClick}
            canHover={canHover}
          />
        </AppErrorBoundary>,
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
            onOpenFielding={(pos, season) => state.openGridBoard({ view: 'fielding', pos, season, highlight: state.player?.id ?? null })}
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
          onOpenGrid={state.openGridBoard}
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
              onOpenFielding={(pos, season) => state.openGridBoard({ view: 'fielding', pos, season, highlight: panelPlayer.id, overSheet: true })}
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
        <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)}
          rows={MLB_MORE.map(m => ({ ...m, onSelect: () => openMore(m) }))} />
      )}
    </Box>
  )
}

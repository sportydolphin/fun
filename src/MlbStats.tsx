import React, { memo, Suspense, useEffect, useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Box, Typography, useMediaQuery, Menu, MenuItem, SwipeableDrawer } from '@mui/material'
import { useMlbState } from './mlb/state/useMlbState'
import type { MlbView } from './mlb/state/useMlbState'
import { ACCENT } from './mlb/constants'
import BottomNav, { BOTTOM_NAV_SPACE, MORE_KEY } from './ui/BottomNav'
import { hoverOnly, FOCUS_RING } from './ui/interaction'
import { requestDeepLink } from './mlb/state/deepLink'
import type { DeepLink } from './mlb/state/deepLink'
import { FinalGamesSection } from './mlb/views/FinalGames'
import { GameRoute } from './mlb/views/GameRoute'
import { SegControl } from './mlb/components/ui'
import { HomeView, Standings, TeamsView, LeaderboardView, StatsView, VizView, SearchView, preloadAllMlbViews } from './mlb/views/lazyViews'
import { useSearchBridgeQuery, updateSearchBridge, setSearchQuery } from './mlb/state/SearchBridgeContext'
import { clearHomeOverlay } from './mlb/state/homeOverlay'
import { fetchSuggestions } from './mlb/views/SuggestedPlayers'
import { MLB_VIEW_PATHS, mlbUrlFor, mlbPlayerPath } from './mlb/routes'
import { setDynamicSeo } from './seo'
import { track, EVENTS } from './lib/analytics'
import { chromePx } from './ui/scale'

// ─── Navigation ───────────────────────────────────────────────────────────────
//
// FIVE TABS, THE SAME SHAPE AS WPBL (Sep 28, 2026). There were six pills in a sideways scroller,
// and at 375px wide two of them (Stats, Search) were simply off the screen. Now:
//   - Scores and Teams are tabs of their own; neither had one.
//   - Leaderboard, Stats and Visualize were three tabs over the same numbers. They are the three
//     BOARDS of one Stats tab. They stay separate views underneath, each with its own address
//     (/mlb/leaders, /mlb/stats, /mlb/charts; see mlb/routes.ts).
//   - Search is the toolbar's alone; the player and team pages it opens are the view 'search'.
//   - Everything that is a board inside a Home card (Predictions, Survivor, Milestones, Roster
//     moves) or a mode of another tab (Odds, Charts) is one tap away under More.
// On a phone the tabs are WPBL's floating bottom bar (src/ui/BottomNav); above that, pills.

type NavKey = 'home' | 'scores' | 'standings' | 'stats' | 'teams'
const NAV: { key: NavKey; label: string }[] = [
  { key: 'home',      label: 'Home' },
  { key: 'scores',    label: 'Scores' },
  { key: 'standings', label: 'Standings' },
  { key: 'stats',     label: 'Stats' },
  { key: 'teams',     label: 'Teams' },
]
const STATS_BOARDS: { view: MlbView; label: string }[] = [
  { view: 'leaderboard', label: 'Leaders' },
  { view: 'stats',       label: 'Table' },
  { view: 'viz',         label: 'Charts' },
]
const navKeyFor = (v: MlbView): NavKey | null =>
  v === 'leaderboard' || v === 'viz' ? 'stats' : v === 'search' ? null : v
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

// The section's columns on a desktop, in SCREEN pixels: 980 and 1280 as they were drawn under the
// old `zoom: 1.4` (Oct 2026). Fixed rather than chromePx because these are the columns that have
// somewhere to put the room, another scoreboard chip or more stat columns, so when the scale came
// down to 1.25 the content inside got smaller and the column kept its width. WPBL's Home and stats
// table break out of its reading column the same way. Below md the phone column is 640.
const HOME_W = 1372
const PAGE_W = 1792

function MlbStats({ renderFooter }: { renderFooter?: () => ReactNode } = {}) {
  const state = useMlbState()
  // `noSsr` so the bar is in the very first layout rather than inserted a frame later (the same
  // note as WpblApp's). The width matches App.tsx's isDesktop, which decides where the footer goes:
  // the bar and the section's own footer must switch at exactly the same width.
  const isDesktop = useMediaQuery('(min-width: 600px)', { noSsr: true })
  const bottomNav = !isDesktop
  const canHover = useMediaQuery('(hover: hover)')
  // The query alone. This section PUBLISHES the rest of the bridge, so subscribing to all of it
  // re-rendered the section on its own every publish.
  const bridgeQuery = useSearchBridgeQuery()

  // Sync query typed in the toolbar â†’ useMlbState debounced search
  useEffect(() => {
    state.setQuery(bridgeQuery)
  }, [bridgeQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  // Push current result state + selection handlers up to the toolbar bridge
  const handleBridgeSelect = useCallback((fn: () => void, dest: Record<string, any>) => {
    state.stampCurrentEntry()
    window.history.pushState(dest, '', mlbUrlFor(dest as { view: MlbView }))
    fn()
    setSearchQuery('')
    state.setView('search')
  }, [state.stampCurrentEntry, state.setView]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
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
  }, [state.playerResults, state.teamResults, state.searching, handleBridgeSelect]) // eslint-disable-line react-hooks/exhaustive-deps

  // A player page's title and description. seo.ts describes the tabs and the thirty clubs from a
  // table; a player cannot be in one, since the name arrives with a fetch. Keyed on the player's
  // canonical path, which is the address the URL sync writes, so it cannot outlive the page.
  const seoPlayer = state.view === 'search' ? state.player : null
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
    fetchSuggestions(state.followedTeamId ?? 0, [])
      .then(sugs => updateSearchBridge({ toolbarSuggestions: sugs }))
      .catch(() => {})
  }, [state.followedTeamId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Push recent searches + their re-open / clear handlers up to the toolbar
  useEffect(() => {
    updateSearchBridge({
      recentSearches: state.recentSearches,
      handleSelectRecent: (item) => {
        setSearchQuery('')
        if (item.type === 'team') state.handleTeamSearchClick(item.id, 'recent')
        else state.handleFollowedPlayerClick(item.id, 'recent')
      },
      clearRecentSearches: state.clearRecentSearches,
    })
  }, [state.recentSearches, state.handleTeamSearchClick, state.handleFollowedPlayerClick, state.clearRecentSearches])

  // Unregister from toolbar when this component unmounts
  useEffect(() => {
    return () => {
      updateSearchBridge({ isRegistered: false, playerResults: [], teamResults: [], searching: false, handleSelectPlayer: null, handleSelectTeam: null, toolbarSuggestions: [], recentSearches: [], handleSelectRecent: null, clearRecentSearches: null })
      setSearchQuery('')
    }
  }, [])

  // Warm every other view once this one has had the network to itself, on the same few-second
  // footing as App.tsx's warming of the other section, so a later tab tap does not wait on a chunk.
  useEffect(() => {
    const t = window.setTimeout(preloadAllMlbViews, 4000)
    return () => window.clearTimeout(t)
  }, [])

  // Tab changes, with how they happened. A pill tap marks itself; every other change of view is a
  // card or stat link doing its job, EXCEPT Back and Forward, which restore a view rather than
  // choose one and are not counted (the same rule as wpbl_tab_viewed). Landing on the section is
  // not a tab change either. And a link into 'search' is a player or team opening, already
  // counted with its source by mlb_player_opened / mlb_team_opened, so it is not counted twice.
  const tabVia = useRef<'pill' | 'back' | null>(null)
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
  const go = useCallback((v: MlbView, via: 'pill' | 'link' = 'pill') => {
    clearHomeOverlay()
    if (via === 'pill') tabVia.current = 'pill'
    state.stampCurrentEntry()
    // The destination's own address, not the current one: see pushEntry in sheetHistory.ts.
    window.history.pushState({ view: v }, '', viewHref(v))
    if (v !== 'search') state.clearSelection()
    state.setView(v)
    requestAnimationFrame(() => window.scrollTo({ top: 0 }))
  }, [state.stampCurrentEntry, state.setView, state.clearSelection]) // eslint-disable-line react-hooks/exhaustive-deps
  const tabView = (k: NavKey): MlbView => k === 'stats' ? lastBoard.current : k
  const goTab = (k: NavKey) => {
    const target = tabView(k)
    if (target === state.view) return
    go(target)
  }

  const [moreOpen, setMoreOpen] = useState(false)
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null)
  const openMore = (item: MoreItem) => {
    setMoreOpen(false); setMoreAnchor(null)
    if (item.charts) state.setVizDefaultTab('graphs')
    if (item.view !== state.view) go(item.view, 'link')
    // Published after the view change: the board's owner takes it when it mounts, or at once if
    // it already is. See useDeepLink.
    if (item.link) requestDeepLink(item.link)
  }

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
    window.history.pushState({ view: 'viz' }, '', MLB_VIEW_PATHS.viz)
    state.clearSelection()
    state.setVizDefaultTab('report-card')
    state.setView('viz')
    // Land at the top of the report cards, not wherever the home page was scrolled.
    requestAnimationFrame(() => window.scrollTo({ top: 0 }))
  })

  // The Home dashboard reads best at a tighter width; the data-dense views
  // (search/stats/leaderboard/viz) use the full width for side-by-side columns.
  const containerMaxWidth = state.view === 'home' ? { xs: 640, md: HOME_W } : { xs: 640, md: PAGE_W }
  const onStatsTab = activeTab === 'stats' && state.view !== 'search'

  return (
    // Scaled up on a desktop by the root's --app-type / --app-chrome (styles.css), as WPBL is.
    <Box sx={{
      maxWidth: containerMaxWidth, mx: 'auto', position: 'relative',
      // Scroll room under the floating bar, plus the device's safe-area inset, so the last card and
      // the footer can always be scrolled clear of it.
      pb: bottomNav ? `calc(${BOTTOM_NAV_SPACE} + env(safe-area-inset-bottom, 0px))` : 0,
    }}>

      {/* The dev-settings gear + mobile-device preview now live app-wide in App.tsx
          (src/dev/DevSettings.tsx) so they cover both the MLB and WPBL sections. */}

      {/* Tab pills, above a phone's width. On a phone the bottom bar replaces them: two navs for
          the same five destinations would be worse than either. */}
      {/* WPBL's nav row, laid out the same way so the switch between the sections moves nothing:
          the same 720 column (scaled on a desktop), the pills centred in it and More pinned to its
          right edge, a lighter bordered chip with a ▾ so it reads as a menu rather than a sixth tab.
          See NavMore in WpblApp.tsx. The menu keeps MLB's one-line hints, which WPBL's desktop menu
          drops: "Streak Survivor" or "Milestone Watch" says nothing on its own, and both sections'
          phone sheets already carry a hint under every item. */}
      {!bottomNav && (
        <Box sx={{ maxWidth: { xs: 720, md: chromePx(720) }, mx: 'auto', display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center' }}>
            <SegControl
              options={NAV.map(n => ({ value: n.key, label: n.label, href: viewHref(tabView(n.key)) }))}
              value={activeTab}
              onChange={v => goTab(v as NavKey)}
            />
          </Box>
          <Box
            component="button"
            type="button"
            aria-haspopup="menu"
            aria-expanded={!!moreAnchor}
            aria-label="More MLB pages"
            onClick={e => setMoreAnchor(e.currentTarget)}
            sx={{
              ...FOCUS_RING,
              flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', gap: 0.25,
              px: 1.25, py: 0.5, borderRadius: 999, cursor: 'pointer',
              border: '1px solid', borderColor: 'divider', bgcolor: 'transparent',
              color: moreAnchor ? 'text.primary' : 'text.secondary',
              fontSize: '0.75rem', fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap',
              ...hoverOnly({ color: 'text.primary', borderColor: 'text.secondary' }),
            }}
          >
            More
            <Box component="span" aria-hidden sx={{ fontSize: '0.6rem' }}>▾</Box>
          </Box>
          <Menu
            anchorEl={moreAnchor}
            open={!!moreAnchor}
            onClose={() => setMoreAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            MenuListProps={{ dense: true }}
          >
            {MORE.map(m => (
              <MenuItem key={m.key} onClick={() => openMore(m)} sx={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, lineHeight: 1.35 }}>{m.label}</Typography>
                <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', lineHeight: 1.35 }}>{m.hint}</Typography>
              </MenuItem>
            ))}
          </Menu>
        </Box>
      )}

      {/* THE TAB'S CONTENT, AT LEAST A SCREEN TALL. On a phone the site footer renders right after
          it (below), so while a tab is still loading the footer sat just under a few lines of
          placeholder and was shoved off the screen as the content arrived: 0.14 of layout shift on
          the Leaders board, the most visited MLB tab. Holding the content a screen tall keeps the
          footer below the fold from the first paint. */}
      <Box sx={{ minHeight: '100dvh' }}>
      {/* The Stats tab's three boards. */}
      {onStatsTab && (
        <Box sx={{ display: 'flex', justifyContent: { xs: 'flex-start', sm: 'center' }, mb: 2 }}>
          <SegControl
            options={STATS_BOARDS.map(b => ({ value: b.view, label: b.label, href: viewHref(b.view) }))}
            value={state.view}
            onChange={v => go(v as MlbView)}
          />
        </Box>
      )}

      {/* No fallback: the screen-tall box above already holds the room, so a view whose chunk is
          still on the wire leaves the tab bar and footer exactly where they will be. */}
      <Suspense fallback={null}>
      {state.view === 'scores' && (
        <FinalGamesSection
          layout="page"
          followedTeamId={state.followedTeamId}
          onPlayerClick={state.handleFollowedPlayerClick}
          onTeamClick={state.handleTeamSearchClick}
        />
      )}

      {state.view === 'teams' && (
        <TeamsView followedTeamId={state.followedTeamId} onTeamClick={id => state.handleTeamSearchClick(id)} />
      )}

      {state.view === 'home' && (
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
      )}

      {state.view === 'standings' && (
        <Standings season={state.season} onTeamClick={state.handleVizNavigate} highlightTeamId={state.followedTeamId} />
      )}

      {state.view === 'viz' && (
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

      {state.view === 'leaderboard' && (
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
          onOpenStats={(fullscreen) => {
            state.setLbFullscreen(fullscreen)
            state.setLbStatsLimit(50)
            state.setView('stats')
          }}
        />
      )}

      {state.view === 'stats' && (
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

      {state.view === 'search' && (
        <SearchView
          query={state.query}
          setQuery={state.setQuery}
          playerResults={state.playerResults}
          teamResults={state.teamResults}
          searching={state.searching}
          dropdownOpen={state.dropdownOpen}
          setDropdownOpen={state.setDropdownOpen}
          selectPlayer={state.selectPlayer}
          selectTeam={state.selectTeam}
          onTeamClick={state.handleTeamSearchClick}
          player={state.player}
          team={state.team}
          palette={state.palette}
          setPalette={state.setPalette}
          season={state.season}
          loadingStats={state.loadingStats}
          hasStats={state.hasStats}
          rankMode={state.rankMode}
          setRankMode={state.setRankMode}
          showPosition={state.showPosition}
          setShowPosition={state.setShowPosition}
          showTeam={state.showTeam}
          setShowTeam={state.setShowTeam}
          showAge={state.showAge}
          setShowAge={state.setShowAge}
          showNumber={state.showNumber}
          setShowNumber={state.setShowNumber}
          statsView={state.statsView}
          setStatsView={state.setStatsView}
          currentAvailableSeasons={state.currentAvailableSeasons}
          handleSeasonChange={state.handleSeasonChange}
          careerHittingTotals={state.careerHittingTotals}
          careerPitchingTotals={state.careerPitchingTotals}
          seasonSelectorStyle={state.seasonSelectorStyle}
          hittingStats={state.hittingStats}
          pitchingStats={state.pitchingStats}
          teamHitting={state.teamHitting}
          teamPitching={state.teamPitching}
          selectedHitStats={state.selectedHitStats}
          setSelectedHitStats={state.setSelectedHitStats}
          selectedPitStats={state.selectedPitStats}
          setSelectedPitStats={state.setSelectedPitStats}
          selectedTeamHitStats={state.selectedTeamHitStats}
          setSelectedTeamHitStats={state.setSelectedTeamHitStats}
          selectedTeamPitStats={state.selectedTeamPitStats}
          setSelectedTeamPitStats={state.setSelectedTeamPitStats}
          toggleHitStat={state.toggleHitStat}
          togglePitStat={state.togglePitStat}
          toggleTeamHitStat={state.toggleTeamHitStat}
          toggleTeamPitStat={state.toggleTeamPitStat}
          hitLeaders={state.hitLeaders}
          pitLeaders={state.pitLeaders}
          teamHitLeaders={state.teamHitLeaders}
          teamPitLeaders={state.teamPitLeaders}
          playerCardProps={state.playerCardProps}
          teamCardProps={state.teamCardProps}
          showTrends={state.showTrends}
          playerContract={state.playerContract}
          careerSplits={state.careerSplits}
          loadingCareer={state.loadingCareer}
          recentGames={state.recentGames}
          loadingRecent={state.loadingRecent}
          recentGamesOpen={state.recentGamesOpen}
          setRecentGamesOpen={state.setRecentGamesOpen}
          highlightedGameDate={state.highlightedGameDate}
          setHighlightedGameDate={state.setHighlightedGameDate}
          showFeaturedRight={state.showFeaturedRight}
          featuredPlayers={state.featuredPlayers}
          featuredHitLeaders={state.featuredHitLeaders}
          featuredPitLeaders={state.featuredPitLeaders}
          divisionStandings={state.divisionStandings}
          teamRoster={state.teamRoster}
        />
      )}
      </Suspense>

      {/* Game Center reached by its address, /mlb/games/<pk>, over whichever tab is up. */}
      <GameRoute onPlayerClick={homePlayerClick} onTeamClick={homeTeamClick} />

      </Box>

      {/* On a phone the site footer sits here, inside the room reserved for the bar, rather than
          below the section where the bar would cover it. App.tsx drops its own copy at this width. */}
      {bottomNav && renderFooter && <Box sx={{ mt: 4 }}>{renderFooter()}</Box>}

      {bottomNav && (
        <BottomNav
          items={[...NAV.map(n => ({ key: n.key, label: n.label, href: viewHref(tabView(n.key)) })), { key: MORE_KEY, label: 'More' }]}
          value={activeTab}
          onChange={k => goTab(k as NavKey)}
          onMore={() => setMoreOpen(true)}
          moreOpen={moreOpen}
          accent={ACCENT}
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
              <Box key={m.key} role="button" onClick={() => openMore(m)} sx={{
                display: 'flex', flexDirection: 'column', gap: 0.1, cursor: 'pointer',
                py: 1, borderBottom: '1px solid', borderColor: 'divider',
                '&:last-of-type': { borderBottom: 'none' },
              }}>
                <Typography sx={{ fontSize: '0.95rem', fontWeight: 700 }}>{m.label}</Typography>
                <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', lineHeight: 1.35 }}>{m.hint}</Typography>
              </Box>
            ))}
          </Box>
        </SwipeableDrawer>
      )}
    </Box>
  )
}

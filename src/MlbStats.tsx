import React, { useEffect, useCallback } from 'react'
import { Box, Typography, Popover, Tooltip, Divider, Button, useMediaQuery } from '@mui/material'
import { Settings } from '@mui/icons-material'
import { useAuth, simulateDevLogin } from './AuthContext'
import { useMlbState } from './mlb/useMlbState'
import { SegControl } from './mlb/ui'
import { Standings } from './mlb/Standings'
import { VizView } from './mlb/views/VizView'
import { LeaderboardView } from './mlb/views/LeaderboardView'
import { StatsView } from './mlb/views/StatsView'
import { SearchView } from './mlb/views/SearchView'
import { HomeView } from './mlb/views/HomeView'
import { useSearchBridge, updateSearchBridge, setSearchQuery } from './mlb/SearchBridgeContext'
import { clearHomeOverlay } from './mlb/homeOverlay'
import { fetchSuggestions } from './mlb/views/SuggestedPlayers'
import { useDevSim, setDevSimEnabled, regenerateDevSim, decideDevSimWinners, reopenDevSim } from './mlb/devSim'

export default function MlbStats() {
  const state = useMlbState()
  const isDesktop = useMediaQuery('(min-width: 600px)')
  const canHover = useMediaQuery('(hover: hover)')
  const bridge = useSearchBridge()

  // Sync query typed in the toolbar → useMlbState debounced search
  useEffect(() => {
    state.setQuery(bridge.query)
  }, [bridge.query]) // eslint-disable-line react-hooks/exhaustive-deps

  // Push current result state + selection handlers up to the toolbar bridge
  const handleBridgeSelect = useCallback((fn: () => void) => {
    window.history.pushState({ returnView: state.view }, '', window.location.href)
    fn()
    setSearchQuery('')
    state.setView('search')
  }, [state.view, state.setView]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    updateSearchBridge({
      playerResults: state.playerResults,
      teamResults: state.teamResults,
      searching: state.searching,
      handleSelectPlayer: p => handleBridgeSelect(() => state.selectPlayer(p as any)),
      handleSelectTeam: t => handleBridgeSelect(() => state.selectTeam(t as any)),
      isRegistered: true,
    })
  }, [state.playerResults, state.teamResults, state.searching, handleBridgeSelect]) // eslint-disable-line react-hooks/exhaustive-deps

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
        if (item.type === 'team') state.handleTeamSearchClick(item.id)
        else state.handleFollowedPlayerClick(item.id)
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

  // The Home dashboard reads best at a tighter width; the data-dense views
  // (search/stats/leaderboard/viz) use the full width for side-by-side columns.
  const containerMaxWidth = state.view === 'home' ? { xs: 640, md: 980 } : { xs: 640, md: 1280 }

  return (
    // The desktop `zoom` that scales this content up lives on the app root (App.tsx)
    // so the toolbar scales with it; the `--app-zoom` CSS var it sets inherits down
    // here (see StatsView's scroll-height cap).
    <Box sx={{ maxWidth: containerMaxWidth, mx: 'auto', position: 'relative' }}>

      {/* Local-dev-only settings menu (never rendered in production builds) */}
      {import.meta.env.DEV && (
        <DevSettings
          seasonSelectorStyle={state.seasonSelectorStyle}
          setSeasonSelectorStyle={state.setSeasonSelectorStyle}
        />
      )}

      {/* Tab switcher — scrollable on mobile so tabs don't overflow the viewport */}
      <Box sx={{
        display: 'flex', justifyContent: { xs: 'flex-start', sm: 'center' }, mb: 3,
        overflowX: 'auto',
        '&::-webkit-scrollbar': { display: 'none' },
        msOverflowStyle: 'none', scrollbarWidth: 'none',
      }}>
        <SegControl
          options={[
            { value: 'home',        label: 'Home' },
            { value: 'standings',   label: 'Standings' },
            { value: 'viz',         label: 'Visualize' },
            { value: 'leaderboard', label: 'Leaderboard' },
            { value: 'stats',       label: 'Stats' },
            { value: 'search',      label: 'Search' },
          ]}
          value={state.view}
          onChange={v => {
            // A deliberate tab navigation is a fresh start — never let a stale
            // Home modal reopen from a prior Back-restore path (see homeOverlay).
            clearHomeOverlay()
            window.history.pushState({ returnView: state.view }, '', window.location.href)
            state.setView(v as any)
          }}
        />
      </Box>

      {state.view === 'home' && (
        <HomeView
          allTeams={state.allTeams}
          followedTeamId={state.followedTeamId}
          onFollowTeam={state.followTeam}
          onUnfollowTeam={state.unfollowTeam}
          followedPlayerIds={state.followedPlayerIds}
          onFollowPlayer={state.followPlayer}
          onUnfollowPlayer={state.unfollowPlayer}
          onPlayerClick={state.handleFollowedPlayerClick}
          onTeamClick={state.handleTeamSearchClick}
          onViz={() => {
            window.history.pushState({ returnView: state.view }, '', window.location.href)
            state.setVizDefaultTab('report-card')
            state.setView('viz')
            // Land at the top of the report cards, not wherever the home page was scrolled.
            requestAnimationFrame(() => window.scrollTo({ top: 0 }))
          }}
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

    </Box>
  )
}

// ─── Local-dev-only settings ──────────────────────────────────────────────────
// Rendered only under import.meta.env.DEV. A small gear at the top-right opens a
// menu of settings that only exist during local development.
function DevSettings({ seasonSelectorStyle, setSeasonSelectorStyle }: {
  seasonSelectorStyle: 'dropdown' | 'buttons'
  setSeasonSelectorStyle: (s: 'dropdown' | 'buttons') => void
}) {
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null)
  const { user, signOut } = useAuth()
  return (
    <>
      <Tooltip title="Dev settings (local only)">
        <Box
          onClick={e => setAnchor(e.currentTarget)}
          sx={{
            position: 'absolute', top: 0, right: 0, zIndex: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 30, height: 30, borderRadius: '50%', cursor: 'pointer',
            color: anchor ? 'warning.main' : 'text.disabled',
            border: '1px solid', borderColor: anchor ? 'warning.main' : 'divider',
            '&:hover': { color: 'warning.main', borderColor: 'warning.main' },
            transition: 'color 0.15s, border-color 0.15s',
          }}
        >
          <Settings sx={{ fontSize: '1rem' }} />
        </Box>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { borderRadius: 2.5, p: 2, mt: 0.75, width: 260, boxShadow: '0 8px 32px rgba(0,0,0,0.14)' } }}
      >
        <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'warning.main', mb: 1.5 }}>
          🛠 Dev Settings · local only
        </Typography>
        <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'text.secondary', mb: 0.75 }}>
          Player-card season selector
        </Typography>
        <SegControl
          options={[{ value: 'dropdown', label: 'Dropdown' }, { value: 'buttons', label: 'Buttons' }]}
          value={seasonSelectorStyle}
          onChange={v => setSeasonSelectorStyle(v as 'dropdown' | 'buttons')}
        />

        <Divider sx={{ my: 1.75 }} />

        <PredSimControls />

        <Divider sx={{ my: 1.75 }} />

        <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'text.secondary', mb: 0.75 }}>
          Simulated login
        </Typography>
        {user ? (
          <Box>
            <Typography sx={{ fontSize: '0.75rem', color: 'text.primary', mb: 1 }}>
              Signed in as{' '}
              <Box component="span" sx={{ fontWeight: 700 }}>
                {user.user_metadata?.full_name ?? user.email}
              </Box>
            </Typography>
            <Button
              fullWidth size="small" variant="outlined" color="warning"
              onClick={() => { signOut() }}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Sign out
            </Button>
          </Box>
        ) : (
          <Button
            fullWidth size="small" variant="contained" color="warning"
            onClick={() => simulateDevLogin()}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Simulate login as random user
          </Button>
        )}
      </Popover>
    </>
  )
}

// ─── Prediction-slate simulator (dev only) ─────────────────────────────────────
// Fabricate a random day of games, then decide their winners, to exercise the
// Predictor's picks + correct/wrong feedback without waiting on the real schedule.
// State lives in the devSim module singleton, which PredictorWidget reads.
function PredSimControls() {
  const sim = useDevSim()
  const decided = sim.games.length > 0 && sim.games.every(g => g.state === 'final')
  return (
    <>
      <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'text.secondary', mb: 0.75 }}>
        Prediction simulator
      </Typography>
      <SegControl
        options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]}
        value={sim.enabled ? 'on' : 'off'}
        onChange={v => setDevSimEnabled(v === 'on')}
      />
      {sim.enabled && (
        <Box sx={{ mt: 1.25, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>
            {sim.games.length} fake game{sim.games.length === 1 ? '' : 's'}
            {' · '}{decided ? 'winners decided' : 'awaiting picks'}
          </Typography>
          <Button
            fullWidth size="small" variant="outlined"
            onClick={() => regenerateDevSim()}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            🎲 New random slate
          </Button>
          {decided ? (
            <Button
              fullWidth size="small" variant="outlined"
              onClick={() => reopenDevSim()}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              ↩ Reopen for picks
            </Button>
          ) : (
            <Button
              fullWidth size="small" variant="contained"
              onClick={() => decideDevSimWinners()}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              🏆 Decide winners
            </Button>
          )}
        </Box>
      )}
    </>
  )
}

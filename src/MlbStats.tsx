import React, { useEffect, useCallback } from 'react'
import { Box, useMediaQuery } from '@mui/material'
import { useMlbState } from './mlb/useMlbState'
import { SegControl } from './mlb/ui'
import { Standings } from './mlb/Standings'
import { VizView } from './mlb/views/VizView'
import { LeaderboardView } from './mlb/views/LeaderboardView'
import { StatsView } from './mlb/views/StatsView'
import { SearchView } from './mlb/views/SearchView'
import { HomeView } from './mlb/views/HomeView'
import { useSearchBridge, updateSearchBridge, setSearchQuery } from './mlb/SearchBridgeContext'
import { fetchSuggestions } from './mlb/views/SuggestedPlayers'

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
    window.history.pushState({ returnView: state.view, returnHomeTab: state.homeTab }, '', window.location.href)
    fn()
    setSearchQuery('')
    state.setView('search')
  }, [state.view, state.homeTab, state.setView]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Unregister from toolbar when this component unmounts
  useEffect(() => {
    return () => {
      updateSearchBridge({ isRegistered: false, playerResults: [], teamResults: [], searching: false, handleSelectPlayer: null, handleSelectTeam: null, toolbarSuggestions: [] })
      setSearchQuery('')
    }
  }, [])

  // The Home dashboard reads best at a tighter width; the data-dense views
  // (search/stats/leaderboard/viz) use the full width for side-by-side columns.
  const containerMaxWidth = state.view === 'home' ? { xs: 640, md: 980 } : { xs: 640, md: 1280 }

  return (
    <Box sx={{ maxWidth: containerMaxWidth, mx: 'auto' }}>

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
            window.history.pushState({ returnView: state.view, returnHomeTab: state.homeTab }, '', window.location.href)
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
          homeTab={state.homeTab}
          onHomeTabChange={state.setHomeTab}
          onLeaderboard={() => state.setView('leaderboard')}
          onViz={() => {
            window.history.pushState({ returnView: state.view, returnHomeTab: state.homeTab }, '', window.location.href)
            state.setVizDefaultTab('report-card')
            state.setView('viz')
          }}
        />
      )}

      {state.view === 'standings' && (
        <Standings season={state.season} onTeamClick={state.handleVizNavigate} />
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
        />
      )}

    </Box>
  )
}

import React from 'react'
import { Box, useMediaQuery } from '@mui/material'
import { useMlbState } from './mlb/useMlbState'
import { SegControl } from './mlb/ui'
import { Standings } from './mlb/Standings'
import { VizView } from './mlb/views/VizView'
import { LeaderboardView } from './mlb/views/LeaderboardView'
import { StatsView } from './mlb/views/StatsView'
import { SearchView } from './mlb/views/SearchView'
import { HomeView } from './mlb/views/HomeView'

export default function MlbStats() {
  const state = useMlbState()
  const isDesktop = useMediaQuery('(min-width: 600px)')
  const canHover = useMediaQuery('(hover: hover)')

  return (
    <Box sx={{ maxWidth: { xs: 640, md: 1280 }, mx: 'auto' }}>

      {/* Tab switcher — scrollable on mobile so 5 tabs don't overflow the viewport */}
      <Box sx={{
        display: 'flex', justifyContent: { xs: 'flex-start', sm: 'center' }, mb: 3,
        overflowX: 'auto',
        '&::-webkit-scrollbar': { display: 'none' },
        msOverflowStyle: 'none', scrollbarWidth: 'none',
      }}>
        <SegControl
          options={[
            { value: 'home', label: 'Home' },
            { value: 'search', label: 'Search' },
            { value: 'standings', label: 'Standings' },
            { value: 'viz', label: 'Visualize' },
            { value: 'leaderboard', label: 'Leaderboard' },
            { value: 'stats', label: 'Stats' },
          ]}
          value={state.view}
          onChange={v => {
            window.history.pushState({}, '', window.location.href)
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

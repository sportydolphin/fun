import React, { useState, useEffect, useRef } from 'react'
import { Box, useMediaQuery, Paper, List, ListItemButton, Divider, Typography, CircularProgress, ClickAwayListener } from '@mui/material'
import { Search } from '@mui/icons-material'
import { useMlbState } from './mlb/useMlbState'
import { SegControl } from './mlb/ui'
import { ACCENT, HEADSHOT, TEAM_BG, TEAM_ABBR } from './mlb/constants'
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

  // ── Top search bar state ───────────────────────────────────────────────────
  const [topQuery, setTopQuery]       = useState('')
  const [topOpen,  setTopOpen]        = useState(false)
  const topRef = useRef<HTMLDivElement>(null)

  // Reuse the same search results & searching flag from state when the top bar is active
  useEffect(() => {
    state.setQuery(topQuery)
  }, [topQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setTopOpen(topQuery.length >= 2 && (state.playerResults.length > 0 || state.teamResults.length > 0 || state.searching))
  }, [topQuery, state.playerResults, state.teamResults, state.searching])

  const handleTopSelect = (fn: () => void) => {
    fn()
    setTopQuery('')
    setTopOpen(false)
    window.history.pushState({}, '', window.location.href)
    state.setView('search')
  }

  return (
    <Box sx={{ maxWidth: { xs: 640, md: 1280 }, mx: 'auto' }}>

      {/* ── Persistent search bar ─────────────────────────────────────────── */}
      <ClickAwayListener onClickAway={() => { setTopOpen(false) }}>
        <Box ref={topRef} sx={{ position: 'relative', mb: 2 }}>
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 1,
            px: 2, py: 0.9,
            borderRadius: 999,
            border: '1.5px solid',
            borderColor: topOpen ? ACCENT : 'divider',
            bgcolor: 'background.paper',
            transition: 'border-color 0.2s, box-shadow 0.2s',
            boxShadow: topOpen ? `0 0 0 3px ${ACCENT}22` : 'none',
          }}>
            {state.searching && topQuery.length >= 2
              ? <CircularProgress size={15} sx={{ color: 'text.disabled', flexShrink: 0 }} />
              : <Search sx={{ fontSize: '1rem', color: 'text.disabled', flexShrink: 0 }} />
            }
            <Box
              component="input"
              value={topQuery}
              onChange={(e: any) => setTopQuery(e.target.value)}
              onFocus={() => { if (topQuery.length >= 2) setTopOpen(true) }}
              onKeyDown={(e: any) => e.key === 'Escape' && (setTopQuery(''), setTopOpen(false))}
              placeholder="Search player or team…"
              sx={{
                flex: 1, border: 'none', outline: 'none', bgcolor: 'transparent',
                fontSize: '0.88rem', color: 'text.primary', p: 0, fontFamily: 'inherit',
                '&::placeholder': { color: 'text.disabled' },
              }}
            />
          </Box>
          {topOpen && (state.playerResults.length > 0 || state.teamResults.length > 0) && (
            <Paper elevation={8} sx={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 300, borderRadius: 2.5, overflow: 'hidden' }}>
              <List dense disablePadding>
                {state.playerResults.slice(0, 6).map((p, i) => {
                  const pos = p.primaryPosition?.abbreviation ?? p.primaryPosition?.name ?? ''
                  const teamAbbr = p.currentTeam?.id != null ? TEAM_ABBR[p.currentTeam.id] : undefined
                  const sub = p.active === false
                    ? [pos, 'Retired'].filter(Boolean).join(' | ')
                    : [pos, teamAbbr].filter(Boolean).join(' | ')
                  return (
                    <React.Fragment key={`p-${p.id}`}>
                      {i > 0 && <Divider />}
                      <ListItemButton onClick={() => handleTopSelect(() => state.selectPlayer(p))} sx={{ gap: 1.25, py: 0.75 }}>
                        <Box sx={{ width: 38, height: 38, borderRadius: 1.5, flexShrink: 0, backgroundImage: `url(${HEADSHOT(p.id)})`, backgroundSize: 'cover', backgroundPosition: 'center 20%', bgcolor: 'grey.200' }} />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography sx={{ fontWeight: 600, fontSize: '0.85rem', lineHeight: 1.2 }}>{p.fullName}</Typography>
                          {sub && <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>{sub}</Typography>}
                        </Box>
                      </ListItemButton>
                    </React.Fragment>
                  )
                })}
                {state.playerResults.length > 0 && state.teamResults.length > 0 && <Divider sx={{ borderStyle: 'dashed' }} />}
                {state.teamResults.slice(0, 3).map((t, i) => {
                  const divShort = t.division?.name?.replace(/American League |National League /, '') ?? ''
                  const leagueShort = t.league?.name?.includes('American') ? 'AL' : t.league?.name?.includes('National') ? 'NL' : ''
                  const sub = [leagueShort, divShort].filter(Boolean).join(' · ')
                  return (
                    <React.Fragment key={`t-${t.id}`}>
                      {i > 0 && <Divider />}
                      <ListItemButton onClick={() => handleTopSelect(() => state.selectTeam(t))} sx={{ gap: 1.25, py: 0.75 }}>
                        <Box sx={{ width: 38, height: 38, borderRadius: 1.5, flexShrink: 0, bgcolor: TEAM_BG[t.id] ?? 'grey.700', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                          <Box component="img" src={`https://www.mlbstatic.com/team-logos/team-cap-on-dark/${t.id}.svg`} alt={t.abbreviation} sx={{ width: 26, height: 26, objectFit: 'contain' }} />
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography sx={{ fontWeight: 600, fontSize: '0.85rem', lineHeight: 1.2 }}>{t.name}</Typography>
                          {sub && <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>{sub}</Typography>}
                        </Box>
                      </ListItemButton>
                    </React.Fragment>
                  )
                })}
              </List>
            </Paper>
          )}
        </Box>
      </ClickAwayListener>

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

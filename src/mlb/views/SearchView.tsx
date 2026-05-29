import React, { useRef, useEffect } from 'react'
import {
  Box, Typography, Paper, CircularProgress,
  List, ListItemButton, Divider, ClickAwayListener,
  Popover, Menu, MenuItem, Tooltip,
} from '@mui/material'
import { Search, Shuffle, FileDownload, InfoOutlined, OpenInFull, Tune } from '@mui/icons-material'
import html2canvas from 'html2canvas'
import { Player, Team, Palette, RankMode, TeamPlayerStat, CareerStatSplit, RecentGameEntry, StandingsDivision } from '../types'
import { ACCENT, HITTING_STAT_DEFS, PITCHING_STAT_DEFS, TEAM_HITTING_DEFS, TEAM_PITCHING_DEFS, HEADSHOT, TEAM_BG, TEAM_ABBR, BBREF_ABBR, DEFAULT_HIT_STATS, DEFAULT_PIT_STATS, DEFAULT_TEAM_HIT_STATS, DEFAULT_TEAM_PIT_STATS, randomPalette } from '../constants'
import { SegControl, PillChip, pillActionSx, linkPillSx, SectionLabel } from '../ui'
import { CardInner, CardInnerProps, TeamCardInner, TeamCardInnerProps, FeaturedMiniCard, DivisionStandingsCard } from '../cards'
import { PlayerTrendsChart } from '../PlayerTrendsChart'
import { RecentGamesTable } from '../RecentGamesTable'
import { CareerStatsTable } from '../CareerStatsTable'
import { fetchPlayerDetails } from '../api'

export interface SearchViewProps {
  // Search
  query: string
  setQuery: (q: string) => void
  playerResults: Player[]
  teamResults: Team[]
  searching: boolean
  dropdownOpen: boolean
  setDropdownOpen: (o: boolean) => void
  selectPlayer: (p: Player) => void
  selectTeam: (t: Team) => void

  // Display state
  player: Player | null
  team: Team | null
  palette: Palette
  setPalette: (p: Palette) => void
  season: number
  loadingStats: boolean
  hasStats: boolean | null

  // Player display options
  rankMode: RankMode
  setRankMode: (m: RankMode) => void
  showPosition: boolean
  setShowPosition: (v: boolean | ((prev: boolean) => boolean)) => void
  showTeam: boolean
  setShowTeam: (v: boolean | ((prev: boolean) => boolean)) => void
  showAge: boolean
  setShowAge: (v: boolean | ((prev: boolean) => boolean)) => void
  showNumber: boolean
  setShowNumber: (v: boolean | ((prev: boolean) => boolean)) => void

  // Season selector
  statsView: 'season' | 'career'
  setStatsView: (v: 'season' | 'career') => void
  currentAvailableSeasons: number[]
  handleSeasonChange: (s: number) => void
  careerHittingTotals: any
  careerPitchingTotals: any

  // Stats
  hittingStats: any
  pitchingStats: any
  teamHitting: any
  teamPitching: any
  selectedHitStats: string[]
  setSelectedHitStats: (s: string[]) => void
  selectedPitStats: string[]
  setSelectedPitStats: (s: string[]) => void
  selectedTeamHitStats: string[]
  setSelectedTeamHitStats: (s: string[]) => void
  selectedTeamPitStats: string[]
  setSelectedTeamPitStats: (s: string[]) => void
  toggleHitStat: (key: string) => void
  togglePitStat: (key: string) => void
  toggleTeamHitStat: (key: string) => void
  toggleTeamPitStat: (key: string) => void
  hitLeaders: Map<string, number[]>
  pitLeaders: Map<string, number[]>
  teamHitLeaders: Map<string, number[]>
  teamPitLeaders: Map<string, number[]>

  // Card props
  playerCardProps: CardInnerProps | null
  teamCardProps: TeamCardInnerProps | null

  // Trends
  showTrends: boolean
  careerSplits: CareerStatSplit[] | null
  loadingCareer: boolean
  recentGames: RecentGameEntry[]
  loadingRecent: boolean
  recentGamesOpen: boolean
  setRecentGamesOpen: (o: boolean | ((prev: boolean) => boolean)) => void
  highlightedGameDate: string | null
  setHighlightedGameDate: (d: string | null | ((prev: string | null) => string | null)) => void

  // Featured players (team view)
  showFeaturedRight: boolean
  featuredPlayers: Array<TeamPlayerStat & { isPitcher: boolean; awardLabel: string; highlightStat: string }>
  featuredHitLeaders: Map<string, number[]>
  featuredPitLeaders: Map<string, number[]>
  divisionStandings: StandingsDivision | null
}

export function SearchView({
  query, setQuery, playerResults, teamResults,
  searching, dropdownOpen, setDropdownOpen, selectPlayer, selectTeam,
  player, team, palette, setPalette, season, loadingStats, hasStats,
  rankMode, setRankMode, showPosition, setShowPosition, showTeam, setShowTeam,
  showAge, setShowAge, showNumber, setShowNumber,
  statsView, setStatsView, currentAvailableSeasons, handleSeasonChange,
  careerHittingTotals, careerPitchingTotals,
  hittingStats, pitchingStats, teamHitting, teamPitching,
  selectedHitStats, setSelectedHitStats, selectedPitStats, setSelectedPitStats,
  selectedTeamHitStats, setSelectedTeamHitStats, selectedTeamPitStats, setSelectedTeamPitStats,
  toggleHitStat, togglePitStat, toggleTeamHitStat, toggleTeamPitStat,
  hitLeaders, pitLeaders, teamHitLeaders, teamPitLeaders,
  playerCardProps, teamCardProps,
  showTrends, careerSplits, loadingCareer,
  recentGames, loadingRecent, recentGamesOpen, setRecentGamesOpen,
  highlightedGameDate, setHighlightedGameDate,
  showFeaturedRight, featuredPlayers, featuredHitLeaders, featuredPitLeaders, divisionStandings,
}: SearchViewProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = React.useState(false)
  const [exportAnchor, setExportAnchor] = React.useState<HTMLElement | null>(null)
  const [downloading, setDownloading] = React.useState(false)
  const [cardOptionsAnchor, setCardOptionsAnchor] = React.useState<HTMLElement | null>(null)
  const [highlightedCareerYear, setHighlightedCareerYear] = React.useState<number | null>(null)
  const [careerTableOpen, setCareerTableOpen] = React.useState(true)

  // Reset career highlight when player changes
  useEffect(() => { setHighlightedCareerYear(null) }, [player?.id])

  const handleDownload = async (mode: 'centered' | 'tiktok') => {
    if (!cardRef.current) return
    setExportAnchor(null)
    setDownloading(true)
    try {
      const imgEls = Array.from(cardRef.current.querySelectorAll<HTMLImageElement>('img'))
      const svgImgs = imgEls.filter(img => img.src.includes('.svg'))
      const restoreSrcs: Array<[HTMLImageElement, string]> = []
      await Promise.all(svgImgs.map(async img => {
        try {
          const res = await fetch(img.src, { mode: 'cors' })
          const blob = await res.blob()
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(blob)
          })
          const origSrc = img.src
          restoreSrcs.push([img, origSrc])
          img.src = dataUrl
          await new Promise<void>(resolve => { img.onload = () => resolve(); img.onerror = () => resolve() })
        } catch { /* fall back to original */ }
      }))

      const captured = await html2canvas(cardRef.current, { useCORS: true, scale: 2, logging: false, backgroundColor: null })
      restoreSrcs.forEach(([img, src]) => { img.src = src })
      const out = document.createElement('canvas')
      out.width = 1080; out.height = 1920
      const ctx = out.getContext('2d')!
      ctx.fillStyle = palette.bg
      ctx.fillRect(0, 0, 1080, 1920)
      let dx: number, dy: number, dw: number, dh: number
      if (mode === 'tiktok') {
        const scale = (1080 * 0.92) / captured.width
        dw = captured.width * scale; dh = captured.height * scale
        dx = (1080 - dw) / 2; dy = 60
      } else {
        const scale = Math.min((1080 * 0.92) / captured.width, (1920 * 0.85) / captured.height)
        dw = captured.width * scale; dh = captured.height * scale
        dx = (1080 - dw) / 2; dy = (1920 - dh) / 2
      }
      ctx.drawImage(captured, dx, dy, dw, dh)
      const suffix = mode === 'tiktok' ? '-tiktok' : ''
      const subject = player?.fullName ?? team?.name ?? 'stats'
      const link = document.createElement('a')
      link.download = `${subject}-${season}${suffix}.png`
      link.href = out.toDataURL('image/png')
      link.click()
    } catch (e) {
      console.error('Download failed:', e)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <>
      {/* Fullscreen overlay */}
      {fullscreen && hasStats && (
        <Box onClick={() => setFullscreen(false)} sx={{
          position: 'fixed', inset: 0, zIndex: 9999, bgcolor: palette.bg,
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}>
          <Box sx={{ width: '100%', maxWidth: 520, px: 4 }}>
            {playerCardProps && <CardInner {...playerCardProps} large onToggleHitStat={undefined} onTogglePitStat={undefined} />}
            {teamCardProps && <TeamCardInner {...teamCardProps} large onToggleHitStat={undefined} onTogglePitStat={undefined} />}
          </Box>
        </Box>
      )}

      {/* Search + year picker row */}
      <Box sx={{ display: 'flex', gap: 1, mb: 1.5, alignItems: 'flex-start' }}>
      <ClickAwayListener onClickAway={() => setDropdownOpen(false)}>
        <Box sx={{ position: 'relative', flex: 1 }}>
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 1,
            px: 2, py: 1.1,
            borderRadius: 999,
            border: '2px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
            transition: 'border-color 0.2s, box-shadow 0.2s',
            '&:focus-within': {
              borderColor: ACCENT,
              boxShadow: `0 0 0 3px ${ACCENT}28`,
            },
          }}>
            {searching
              ? <CircularProgress size={16} sx={{ color: 'text.disabled', flexShrink: 0 }} />
              : <Search sx={{ fontSize: '1.1rem', color: 'text.disabled', flexShrink: 0 }} />
            }
            <Box
              component="input"
              value={query}
              onChange={(e: any) => setQuery(e.target.value)}
              onFocus={() => setQuery('')}
              placeholder="Search player or team…"
              sx={{
                flex: 1, border: 'none', outline: 'none', bgcolor: 'transparent',
                fontSize: '0.92rem', color: 'text.primary', p: 0,
                fontFamily: 'inherit',
                '&::placeholder': { color: 'text.disabled' },
              }}
            />
          </Box>

          {dropdownOpen && (
            <Paper elevation={8} sx={{ position: 'absolute', width: '100%', zIndex: 20, mt: 0.75, borderRadius: 2.5, overflow: 'hidden' }}>
              <List dense disablePadding>
                {playerResults.map((p, i) => {
                  const pos = p.primaryPosition?.abbreviation ?? p.primaryPosition?.name ?? ''
                  const teamAbbr = p.currentTeam?.id != null ? TEAM_ABBR[p.currentTeam.id] : undefined
                  const sub = p.active === false
                    ? [pos, 'Retired'].filter(Boolean).join(' | ')
                    : [pos, teamAbbr].filter(Boolean).join(' | ')
                  return (
                    <React.Fragment key={`p-${p.id}`}>
                      {i > 0 && <Divider />}
                      <ListItemButton onClick={() => { window.history.pushState({ returnView: 'search' }, '', window.location.href); selectPlayer(p) }} sx={{ gap: 1.5, py: 1 }}>
                        <Box sx={{
                          width: 48, height: 48, borderRadius: 1.5, flexShrink: 0,
                          backgroundImage: `url(${HEADSHOT(p.id)})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center 20%',
                          bgcolor: 'grey.200',
                        }} />
                        <Box>
                          <Typography sx={{ fontWeight: 600, fontSize: '0.9rem', lineHeight: 1.2 }}>{p.fullName}</Typography>
                          {sub && <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', mt: 0.25 }}>{sub}</Typography>}
                        </Box>
                      </ListItemButton>
                    </React.Fragment>
                  )
                })}
                {playerResults.length > 0 && teamResults.length > 0 && <Divider sx={{ borderStyle: 'dashed' }} />}
                {teamResults.map((t, i) => {
                  const divShort = t.division?.name?.replace(/American League |National League /, '') ?? ''
                  const leagueShort = t.league?.name?.includes('American') ? 'AL' : t.league?.name?.includes('National') ? 'NL' : ''
                  const sub = [leagueShort, divShort].filter(Boolean).join(' · ')
                  return (
                    <React.Fragment key={`t-${t.id}`}>
                      {i > 0 && <Divider />}
                      <ListItemButton onClick={() => { window.history.pushState({ returnView: 'search' }, '', window.location.href); selectTeam(t) }} sx={{ gap: 1.5, py: 1 }}>
                        <Box sx={{
                          width: 48, height: 48, borderRadius: 1.5, flexShrink: 0,
                          bgcolor: TEAM_BG[t.id] ?? 'grey.700',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          overflow: 'hidden',
                        }}>
                          <Box
                            component="img"
                            src={`https://www.mlbstatic.com/team-logos/team-cap-on-dark/${t.id}.svg`}
                            alt={t.abbreviation}
                            sx={{ width: 32, height: 32, objectFit: 'contain', display: 'block' }}
                          />
                        </Box>
                        <Box>
                          <Typography sx={{ fontWeight: 600, fontSize: '0.9rem', lineHeight: 1.2 }}>{t.name}</Typography>
                          {sub && <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', mt: 0.25 }}>{sub}</Typography>}
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
      </Box>{/* end search + year row */}

      {loadingStats && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>}

      {/* Unified season / career selector */}
      {(hasStats || loadingStats) && (
        <Box sx={{
          display: 'flex', gap: 0.75, mb: 1.5, overflowX: 'auto', pb: 0.5,
          msOverflowStyle: 'none', scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}>
          {/* Career pill */}
          {player && (careerHittingTotals != null || careerPitchingTotals != null) && (() => {
            const active = statsView === 'career'
            return (
              <Box
                onClick={() => setStatsView('career')}
                sx={{
                  flexShrink: 0, px: 1.5, py: 0.55, borderRadius: 999,
                  cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700,
                  userSelect: 'none', whiteSpace: 'nowrap',
                  bgcolor: active ? ACCENT : 'transparent',
                  color: active ? '#000' : 'text.secondary',
                  border: '1.5px solid', borderColor: active ? ACCENT : 'divider',
                  transition: 'all 0.15s',
                }}
              >
                Career
              </Box>
            )
          })()}
          {/* Year pills */}
          {currentAvailableSeasons.map(y => {
            const active = statsView === 'season' && season === y
            return (
              <Box key={y}
                onClick={() => { setStatsView('season'); handleSeasonChange(y) }}
                sx={{
                  flexShrink: 0, px: 1.5, py: 0.55, borderRadius: 999,
                  cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700,
                  userSelect: 'none', whiteSpace: 'nowrap',
                  bgcolor: active ? ACCENT : 'transparent',
                  color: active ? '#000' : 'text.secondary',
                  border: '1.5px solid', borderColor: active ? ACCENT : 'divider',
                  transition: 'all 0.15s',
                }}
              >
                {y}
              </Box>
            )
          })}
        </Box>
      )}

      {hasStats && (
        <Box sx={{
          display: { xs: 'block', md: (showTrends || showFeaturedRight || (!!team && !!divisionStandings)) ? 'grid' : 'block' },
          gridTemplateColumns: { md: 'minmax(0, 460px) 1fr' },
          gap: { md: 4 },
          alignItems: 'start',
          mb: 2,
        }}>
          {/* Left column: card + actions */}
          <Box>
            <Box sx={{ position: 'relative' }}>
              <Paper ref={cardRef} elevation={4} sx={{
                borderRadius: 4, overflow: 'hidden', background: palette.bg,
                transition: 'background 0.45s ease', p: { xs: 2, sm: 2.5 },
              }}>
                {playerCardProps && <CardInner {...playerCardProps} />}
                {teamCardProps && <TeamCardInner {...teamCardProps} />}
              </Paper>
              {/* Icon bar: download · options · fullscreen */}
              <Box sx={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 0.5 }}>
                {(() => {
                  const iconBtnSx = {
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    p: 0.5, borderRadius: 1.5,
                    bgcolor: 'rgba(0,0,0,0.22)', color: 'rgba(255,255,255,0.7)',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'rgba(0,0,0,0.42)', color: '#fff' },
                    transition: 'background 0.15s, color 0.15s',
                  }
                  return (<>
                    <Tooltip title={downloading ? 'Saving…' : 'Download'}>
                      <Box onClick={!downloading ? (e => setExportAnchor(e.currentTarget as HTMLElement)) : undefined} sx={{ ...iconBtnSx, opacity: downloading ? 0.55 : 1 }}>
                        {downloading ? <CircularProgress size={13} sx={{ color: 'rgba(255,255,255,0.6)' }} /> : <FileDownload sx={{ fontSize: '0.88rem' }} />}
                      </Box>
                    </Tooltip>
                    <Tooltip title="Options">
                      <Box onClick={e => setCardOptionsAnchor(e.currentTarget as HTMLElement)} sx={{ ...iconBtnSx, bgcolor: cardOptionsAnchor ? 'rgba(0,0,0,0.42)' : 'rgba(0,0,0,0.22)' }}>
                        <Tune sx={{ fontSize: '0.88rem' }} />
                      </Box>
                    </Tooltip>
                    <Tooltip title="Fullscreen">
                      <Box onClick={() => setFullscreen(true)} sx={iconBtnSx}>
                        <OpenInFull sx={{ fontSize: '0.88rem' }} />
                      </Box>
                    </Tooltip>
                  </>)
                })()}
              </Box>
              {/* Export menu */}
              <Menu
                anchorEl={exportAnchor}
                open={Boolean(exportAnchor)}
                onClose={() => setExportAnchor(null)}
                PaperProps={{ sx: { borderRadius: 2, mt: 0.5, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', minWidth: 180 } }}
              >
                <MenuItem onClick={() => handleDownload('centered')} sx={{ fontSize: '0.85rem' }}>Download centered</MenuItem>
                <MenuItem onClick={() => handleDownload('tiktok')} sx={{ fontSize: '0.85rem' }}>Download for TikTok</MenuItem>
              </Menu>
              {/* Options popover */}
              <Popover
                open={Boolean(cardOptionsAnchor)}
                anchorEl={cardOptionsAnchor}
                onClose={() => setCardOptionsAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                PaperProps={{ sx: { borderRadius: 2.5, p: 2, mt: 0.75, width: 290, boxShadow: '0 8px 32px rgba(0,0,0,0.14)' } }}
              >
                {/* Colors */}
                <Box sx={{ mb: 1.75 }}>
                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.6, color: 'text.disabled', mb: 0.75 }}>
                    Colors
                  </Typography>
                  <Box
                    onClick={() => setPalette(randomPalette())}
                    sx={{
                      display: 'inline-flex', alignItems: 'center', gap: 0.5,
                      cursor: 'pointer', px: 1.5, py: 0.5, borderRadius: 999,
                      border: '1.5px solid', borderColor: 'divider',
                      fontSize: '0.8rem', fontWeight: 600, color: 'text.secondary',
                      '&:hover': { borderColor: ACCENT, color: ACCENT },
                      transition: 'border-color 0.15s, color 0.15s',
                    }}
                  >
                    <Shuffle sx={{ fontSize: '0.88rem' }} /> Shuffle
                  </Box>
                </Box>

                {/* Batting stats */}
                {(hittingStats || teamHitting) && (() => {
                  const hitDefs = player ? HITTING_STAT_DEFS : TEAM_HITTING_DEFS
                  const hitSel = player ? selectedHitStats : selectedTeamHitStats
                  const setHitSel = player ? setSelectedHitStats : setSelectedTeamHitStats
                  const hitDefaults = player ? DEFAULT_HIT_STATS : DEFAULT_TEAM_HIT_STATS
                  const allHit = hitDefs.every(d => hitSel.includes(d.key))
                  return (
                    <Box sx={{ mb: 1.75 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                        <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.6, color: 'text.disabled' }}>
                          Batting stats
                        </Typography>
                        <Box onClick={() => setHitSel(allHit ? hitDefaults : hitDefs.map(d => d.key))} sx={{ fontSize: '0.68rem', fontWeight: 700, color: ACCENT, cursor: 'pointer', userSelect: 'none' }}>
                          {allHit ? 'Reset' : 'All'}
                        </Box>
                      </Box>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
                        {hitDefs.map(def => (
                          <PillChip key={def.key} label={def.label} selected={hitSel.includes(def.key)} onChange={() => (player ? toggleHitStat : toggleTeamHitStat)(def.key)} />
                        ))}
                      </Box>
                    </Box>
                  )
                })()}

                {/* Pitching stats */}
                {(pitchingStats || teamPitching) && (() => {
                  const pitDefs = player ? PITCHING_STAT_DEFS : TEAM_PITCHING_DEFS
                  const pitSel = player ? selectedPitStats : selectedTeamPitStats
                  const setPitSel = player ? setSelectedPitStats : setSelectedTeamPitStats
                  const pitDefaults = player ? DEFAULT_PIT_STATS : DEFAULT_TEAM_PIT_STATS
                  const allPit = pitDefs.every(d => pitSel.includes(d.key))
                  return (
                    <Box sx={{ mb: 1.75 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                        <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.6, color: 'text.disabled' }}>
                          Pitching stats
                        </Typography>
                        <Box onClick={() => setPitSel(allPit ? pitDefaults : pitDefs.map(d => d.key))} sx={{ fontSize: '0.68rem', fontWeight: 700, color: ACCENT, cursor: 'pointer', userSelect: 'none' }}>
                          {allPit ? 'Reset' : 'All'}
                        </Box>
                      </Box>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
                        {pitDefs.map(def => (
                          <PillChip key={def.key} label={def.label} selected={pitSel.includes(def.key)} onChange={() => (player ? togglePitStat : toggleTeamPitStat)(def.key)} />
                        ))}
                      </Box>
                    </Box>
                  )
                })()}

                {/* League rank */}
                <Box sx={{ mb: player ? 1.75 : 0 }}>
                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.6, color: 'text.disabled', mb: 0.75 }}>
                    League rank
                  </Typography>
                  <SegControl
                    options={[{ value: 'none', label: 'None' }, { value: 'top5', label: 'Top 5' }, { value: 'all', label: 'All' }]}
                    value={rankMode}
                    onChange={v => setRankMode(v as RankMode)}
                  />
                </Box>

                {/* Portrait toggles */}
                {player && (
                  <Box>
                    <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.6, color: 'text.disabled', mb: 0.75 }}>
                      Show under portrait
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap' }}>
                      {[
                        { label: 'Position', val: showPosition, set: setShowPosition },
                        { label: 'Team', val: showTeam, set: setShowTeam },
                        { label: 'Age', val: showAge, set: setShowAge },
                        { label: 'Number', val: showNumber, set: setShowNumber },
                      ].map(({ label, val, set }) => (
                        <PillChip key={label} label={label} selected={val} onChange={() => set((v: boolean) => !v)} />
                      ))}
                    </Box>
                  </Box>
                )}
              </Popover>
            </Box>

            {/* Links — desktop only, left column below card */}
            {(player || team) && (
              <Box sx={{ display: { xs: 'none', md: 'flex' }, gap: 0.6, flexWrap: 'wrap', mt: 1.5 }}>
                {player && (<>
                  <Box component="a" href={`https://www.baseball-reference.com/search/search.fcgi?search=${encodeURIComponent(player.fullName)}`} target="_blank" rel="noopener noreferrer" sx={linkPillSx}>Baseball Ref ↗</Box>
                  <Box component="a" href={`https://baseballsavant.mlb.com/savant-player/${player.fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${player.id}`} target="_blank" rel="noopener noreferrer" sx={linkPillSx}>Baseball Savant ↗</Box>
                </>)}
                {team && (() => {
                  const bbrefAbbr = BBREF_ABBR[team.abbreviation] ?? team.abbreviation
                  return (<>
                    <Box component="a" href={`https://www.baseball-reference.com/teams/${bbrefAbbr}/${season}.shtml`} target="_blank" rel="noopener noreferrer" sx={linkPillSx}>Baseball Ref ↗</Box>
                    <Box component="a" href={`https://baseballsavant.mlb.com/team/${team.id}`} target="_blank" rel="noopener noreferrer" sx={linkPillSx}>Baseball Savant ↗</Box>
                  </>)
                })()}
              </Box>
            )}

          </Box>

          {/* Right column: Trends + Recent Games (player) OR Featured Players (team) */}
          {showTrends && (
            <Box sx={{ mt: { xs: 2, md: 0 } }}>
              <Box sx={{ mb: 1.25 }}>
                <SectionLabel>Trends</SectionLabel>
              </Box>
              {loadingCareer ? (
                <Box sx={{ textAlign: 'center', py: 3 }}><CircularProgress size={22} /></Box>
              ) : (
                <Box sx={{
                  borderRadius: { xs: 0, sm: 3 },
                  border: '1px solid', borderColor: 'divider',
                  p: { xs: 0.75, sm: 1.5 },
                  mx: { xs: -2, sm: 0 },
                }}>
                  <PlayerTrendsChart
                    splits={careerSplits!}
                    isPitcher={player!.primaryPosition?.code === '1'}
                    isTwoWay={player!.primaryPosition?.type === 'Two-Way Player'}
                    gameLog={recentGames}
                    season={season}
                    chartMode={statsView === 'season' ? 'rolling' : 'career'}
                    onGameSelect={date => setHighlightedGameDate(d => d === date ? null : date)}
                    onYearSelect={statsView === 'career' ? (s => setHighlightedCareerYear(y => y === s ? null : s)) : undefined}
                  />
                </Box>
              )}

              {/* Career Year-by-Year — shown when in career mode */}
              {player && statsView === 'career' && (careerSplits?.length ?? 0) > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Box
                    onClick={() => setCareerTableOpen(o => !o)}
                    sx={{
                      mb: careerTableOpen ? 1.25 : 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      cursor: 'pointer', userSelect: 'none',
                      '&:hover .ct-chevron': { color: 'text.primary' },
                    }}
                  >
                    <SectionLabel>Year by Year</SectionLabel>
                    <Box className="ct-chevron" sx={{
                      fontSize: '0.75rem', color: 'text.disabled',
                      transition: 'transform 0.18s, color 0.15s',
                      transform: careerTableOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                    }}>▾</Box>
                  </Box>

                  {careerTableOpen && (
                    <CareerStatsTable
                      splits={careerSplits!}
                      isPitcher={player.primaryPosition?.code === '1'}
                      isTwoWay={player.primaryPosition?.type === 'Two-Way Player'}
                      highlightYear={highlightedCareerYear}
                    />
                  )}
                </Box>
              )}

              {/* Recent Games — shown when in season mode */}
              {player && statsView === 'season' && (loadingRecent || recentGames.length > 0) && (
                <Box sx={{ mt: 2 }}>
                  <Box
                    onClick={() => setRecentGamesOpen(o => !o)}
                    sx={{
                      mb: recentGamesOpen ? 1.25 : 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      cursor: 'pointer', userSelect: 'none',
                      '&:hover .rg-chevron': { color: 'text.primary' },
                    }}
                  >
                    <SectionLabel>Recent Games</SectionLabel>
                    <Box className="rg-chevron" sx={{
                      fontSize: '0.75rem', color: 'text.disabled',
                      transition: 'transform 0.18s, color 0.15s',
                      transform: recentGamesOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                    }}>▾</Box>
                  </Box>

                  {recentGamesOpen && (
                    loadingRecent && recentGames.length === 0 ? (
                      <Box sx={{ textAlign: 'center', py: 2 }}><CircularProgress size={20} /></Box>
                    ) : recentGames.length > 0 ? (
                      <Box sx={{ mx: { xs: -2, sm: 0 } }}>
                        <RecentGamesTable
                          games={recentGames}
                          isPitcher={player.primaryPosition?.code === '1'}
                          isTwoWay={player.primaryPosition?.type === 'Two-Way Player'}
                          highlightDate={highlightedGameDate ?? undefined}
                        />
                      </Box>
                    ) : null
                  )}
                </Box>
              )}
            </Box>
          )}

          {/* Team right column: division standings + award player cards */}
          {!!team && (showFeaturedRight || !!divisionStandings) && (
            <Box sx={{ mt: { xs: 2, md: 0 }, display: 'flex', flexDirection: 'column', gap: 2 }}>

              {/* Division standings card */}
              {divisionStandings && (
                <Box>
                  <Box sx={{ mb: 1.25 }}><SectionLabel>Division</SectionLabel></Box>
                  <DivisionStandingsCard
                    division={divisionStandings}
                    highlightTeamId={team.id}
                    season={season}
                  />
                </Box>
              )}

              {/* Award leader cards — 2×2 grid */}
              {showFeaturedRight && (
                <Box>
                  <Box sx={{ mb: 1.25 }}><SectionLabel>Team Leaders</SectionLabel></Box>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1 }}>
                    {featuredPlayers.map(p => (
                      <FeaturedMiniCard
                        key={`${p.playerId}-${p.highlightStat}`}
                        entry={p}
                        teamId={team.id}
                        hitLeaders={featuredHitLeaders}
                        pitLeaders={featuredPitLeaders}
                        awardLabel={p.awardLabel}
                        highlightStat={p.highlightStat}
                        onClick={() => {
                          const params = new URLSearchParams()
                          params.set('tid', String(team.id))
                          window.history.pushState({}, '', `/mlb?${params.toString()}`)
                          fetchPlayerDetails(p.playerId)
                            .then(details => { if (details) selectPlayer(details) })
                            .catch(() => {})
                        }}
                      />
                    ))}
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </Box>
      )}

      {/* Career year-by-year fallback — player only, when Trends column not shown and career mode */}
      {hasStats && player && !showTrends && statsView === 'career' && (careerSplits?.length ?? 0) > 0 && (
        <Box sx={{ mb: 2 }}>
          <Box
            onClick={() => setCareerTableOpen(o => !o)}
            sx={{
              mb: careerTableOpen ? 1.25 : 0,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: 'pointer', userSelect: 'none',
              '&:hover .ct-chevron': { color: 'text.primary' },
            }}
          >
            <SectionLabel>Year by Year</SectionLabel>
            <Box className="ct-chevron" sx={{
              fontSize: '0.75rem', color: 'text.disabled',
              transition: 'transform 0.18s, color 0.15s',
              transform: careerTableOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
            }}>▾</Box>
          </Box>
          {careerTableOpen && (
            <CareerStatsTable
              splits={careerSplits!}
              isPitcher={player.primaryPosition?.code === '1'}
              isTwoWay={player.primaryPosition?.type === 'Two-Way Player'}
              highlightYear={highlightedCareerYear}
            />
          )}
        </Box>
      )}

      {/* Recent games fallback — player only, when Trends column not shown and season mode */}
      {hasStats && player && !showTrends && statsView === 'season' && (loadingRecent || recentGames.length > 0) && (
        <Box sx={{ mb: 2 }}>
          <Box
            onClick={() => setRecentGamesOpen(o => !o)}
            sx={{
              mb: recentGamesOpen ? 1.25 : 0,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: 'pointer', userSelect: 'none',
            }}
          >
            <SectionLabel>Recent Games</SectionLabel>
            <Box sx={{
              fontSize: '0.75rem', color: 'text.disabled',
              transition: 'transform 0.18s',
              transform: recentGamesOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
            }}>▾</Box>
          </Box>
          {recentGamesOpen && (
            loadingRecent && recentGames.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 2 }}><CircularProgress size={20} /></Box>
            ) : recentGames.length > 0 ? (
              <Box sx={{ mx: { xs: -2, sm: 0 } }}>
                <RecentGamesTable
                  games={recentGames}
                  isPitcher={player.primaryPosition?.code === '1'}
                  isTwoWay={player.primaryPosition?.type === 'Two-Way Player'}
                  highlightDate={highlightedGameDate ?? undefined}
                />
              </Box>
            ) : null
          )}
        </Box>
      )}

      {/* Links — bottom of page */}
      {hasStats && (player || team) && (
        <Box sx={{ display: { xs: 'flex', md: 'none' }, gap: 0.6, flexWrap: 'wrap', mb: 3 }}>
          {player && (<>
            <Box component="a" href={`https://www.baseball-reference.com/search/search.fcgi?search=${encodeURIComponent(player.fullName)}`} target="_blank" rel="noopener noreferrer" sx={linkPillSx}>Baseball Ref ↗</Box>
            <Box component="a" href={`https://baseballsavant.mlb.com/savant-player/${player.fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${player.id}`} target="_blank" rel="noopener noreferrer" sx={linkPillSx}>Baseball Savant ↗</Box>
          </>)}
          {team && (() => {
            const bbrefAbbr = BBREF_ABBR[team.abbreviation] ?? team.abbreviation
            return (<>
              <Box component="a" href={`https://www.baseball-reference.com/teams/${bbrefAbbr}/${season}.shtml`} target="_blank" rel="noopener noreferrer" sx={linkPillSx}>Baseball Ref ↗</Box>
              <Box component="a" href={`https://baseballsavant.mlb.com/team/${team.id}`} target="_blank" rel="noopener noreferrer" sx={linkPillSx}>Baseball Savant ↗</Box>
            </>)
          })()}
        </Box>
      )}

      {!loadingStats && (player && !hittingStats && !pitchingStats || team && !teamHitting && !teamPitching) && (
        <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
          No {season} season stats available.
        </Typography>
      )}
    </>
  )
}

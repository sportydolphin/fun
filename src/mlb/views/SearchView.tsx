import React, { useRef, useEffect, useLayoutEffect, lazy, Suspense } from 'react'
import {
  Box, Typography, Paper, CircularProgress,
  List, ListItemButton, Divider, ClickAwayListener,
  Popover, Menu, MenuItem, Tooltip, useMediaQuery,
} from '@mui/material'
import { Search, Shuffle, FileDownload, InfoOutlined, OpenInFull, Tune, ChevronLeft, ChevronRight, MoreVert } from '@mui/icons-material'
import html2canvas from 'html2canvas'
import { Player, Team, Palette, RankMode, TeamPlayerStat, CareerStatSplit, RecentGameEntry, RosterEntry, StandingsDivision } from '../types'
import { ACCENT, HITTING_STAT_DEFS, PITCHING_STAT_DEFS, TEAM_HITTING_DEFS, TEAM_PITCHING_DEFS, HEADSHOT, TEAM_BG, TEAM_ABBR, BBREF_ABBR, DEFAULT_HIT_STATS, DEFAULT_PIT_STATS, DEFAULT_TEAM_HIT_STATS, DEFAULT_TEAM_PIT_STATS, randomPalette } from '../constants'
import { SegControl, PillChip, pillActionSx, linkPillSx, SectionLabel } from '../ui'
import { CardInner, CardInnerProps, TeamCardInner, TeamCardInnerProps, FeaturedMiniCard, DivisionStandingsCard } from '../cards'
// ~1,000-line chart module — lazy so it only loads once a player card is open.
const PlayerTrendsChart = lazy(() => import('../PlayerTrendsChart').then(m => ({ default: m.PlayerTrendsChart })))
import { RecentGamesTable } from '../RecentGamesTable'
import { TeamRoster } from '../TeamRoster'
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
  // History-pushing cross-link nav (for opponent/division team links within this view)
  onTeamClick?: (id: number) => void

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
  seasonSelectorStyle: 'dropdown' | 'buttons'

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
  teamRoster: RosterEntry[]
}

export function SearchView({
  query, setQuery, playerResults, teamResults,
  searching, dropdownOpen, setDropdownOpen, selectPlayer, selectTeam, onTeamClick,
  player, team, palette, setPalette, season, loadingStats, hasStats,
  rankMode, setRankMode, showPosition, setShowPosition, showTeam, setShowTeam,
  showAge, setShowAge, showNumber, setShowNumber,
  statsView, setStatsView, currentAvailableSeasons, handleSeasonChange,
  careerHittingTotals, careerPitchingTotals, seasonSelectorStyle,
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
  teamRoster,
}: SearchViewProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const isMobile = !useMediaQuery('(min-width: 600px)')
  const [fullscreen, setFullscreen] = React.useState(false)
  const [cardMenuAnchor, setCardMenuAnchor] = React.useState<HTMLElement | null>(null)
  const [downloading, setDownloading] = React.useState(false)
  const [cardOptionsAnchor, setCardOptionsAnchor] = React.useState<HTMLElement | null>(null)
  const [highlightedCareerYear, setHighlightedCareerYear] = React.useState<number | null>(null)
  const [careerTableOpen, setCareerTableOpen] = React.useState(true)
  const [rosterOpen, setRosterOpen] = React.useState(true)

  // Open a player from within a team page. Pushes a ?tid= history entry first so the
  // browser Back button returns to this team (mirrors the Team Leaders cards below).
  const openPlayerFromTeam = React.useCallback((playerId: number) => {
    if (!team) return
    window.history.pushState({}, '', `/mlb?tid=${team.id}`)
    fetchPlayerDetails(playerId)
      .then(details => { if (details) selectPlayer(details) })
      .catch(() => {})
  }, [team, selectPlayer])

  // Position of the card's year text (relative to the card's positioned wrap), so the
  // prev/next-year arrows sit right beside the value they're changing — vertically
  // centered on it and flanking it left/right — instead of pinned to the card edges.
  const cardWrapRef = useRef<HTMLDivElement>(null)
  const [yearRect, setYearRect] = React.useState<{ top: number; left: number; right: number } | null>(null)
  useLayoutEffect(() => {
    const wrap = cardWrapRef.current
    if (!wrap) return
    const measure = () => {
      const yearEl = wrap.querySelector('[data-card-year]') as HTMLElement | null
      if (!yearEl) { setYearRect(null); return }
      const wr = wrap.getBoundingClientRect()
      // The year text is centered inside a full-width block, so the element's own
      // getBoundingClientRect() returns the whole (wide) box, not the digits — a Range
      // over its text content gives the tight bounds of the actual rendered glyphs.
      const range = document.createRange()
      range.selectNodeContents(yearEl)
      const yr = range.getBoundingClientRect()
      // The app root applies a desktop CSS `zoom` (see App.tsx / --app-zoom), so
      // getBoundingClientRect() returns zoom-scaled screen coordinates. These deltas are
      // then used as left/top on the arrow Box, which lives INSIDE the same zoomed
      // subtree and so gets scaled a second time — divide back down by --app-zoom to
      // cancel the double-scale and keep the arrows flanking the year. On mobile /
      // non-/mlb routes --app-zoom is 1, so this is a no-op.
      const zoom = parseFloat(getComputedStyle(wrap).getPropertyValue('--app-zoom')) || 1
      setYearRect({
        top:   (yr.top - wr.top + yr.height / 2) / zoom,
        left:  (yr.left - wr.left) / zoom,
        right: (yr.right - wr.left) / zoom,
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [player?.id, season, statsView, hasStats])

  // Reset career highlight when player changes
  useEffect(() => { setHighlightedCareerYear(null) }, [player?.id])

  const handleDownload = async (mode: 'centered' | 'tiktok') => {
    if (!cardRef.current) return
    setCardMenuAnchor(null)
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

      {loadingStats && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>}

      {/* Nothing selected yet — prompt to search instead of auto-loading a player */}
      {!hasStats && !loadingStats && (
        <Box sx={{ textAlign: 'center', py: { xs: 6, sm: 10 }, px: 2, color: 'text.disabled' }}>
          <Search sx={{ fontSize: '2.6rem', opacity: 0.5, mb: 1 }} />
          <Typography sx={{ fontSize: '0.98rem', fontWeight: 700, color: 'text.secondary' }}>
            Search for a player or team
          </Typography>
          <Typography sx={{ fontSize: '0.78rem', mt: 0.5 }}>
            Use the search bar above to look someone up.
          </Typography>
        </Box>
      )}

      {/* Unified season / career selector — dropdown by default; year pills when the
          dev setting flips it to 'buttons'. Career is always its own emphasized toggle. */}
      {(hasStats || loadingStats) && (() => {
        const hasCareer = player && (careerHittingTotals != null || careerPitchingTotals != null)
        const careerActive = statsView === 'career'

        const careerToggle = hasCareer && (
          <Box
            onClick={() => setStatsView('career')}
            sx={{
              flexShrink: 0, px: 1.6, py: 0.6, borderRadius: 999,
              cursor: 'pointer', fontSize: '0.82rem', fontWeight: 800, letterSpacing: 0.2,
              userSelect: 'none', whiteSpace: 'nowrap',
              display: 'inline-flex', alignItems: 'center', gap: 0.5,
              bgcolor: careerActive ? ACCENT : 'transparent',
              color: careerActive ? '#000' : 'text.secondary',
              border: '1.5px solid', borderColor: careerActive ? ACCENT : 'divider',
              transition: 'all 0.15s',
              '&:hover': careerActive ? {} : { borderColor: ACCENT, color: ACCENT },
            }}
          >
            ★ Career
          </Box>
        )

        if (seasonSelectorStyle === 'buttons') {
          // Legacy pills (kept for the dev toggle)
          return (
            <Box sx={{
              display: 'flex', justifyContent: 'center', gap: 0.75, mb: 1.5, overflowX: 'auto', pb: 0.5,
              msOverflowStyle: 'none', scrollbarWidth: 'none',
              '&::-webkit-scrollbar': { display: 'none' },
            }}>
              {careerToggle}
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
          )
        }

        // Dropdown mode (default)
        return (
          <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mb: 1.5, alignItems: 'center' }}>
            {careerToggle}
            <Box sx={{
              display: 'inline-flex', alignItems: 'center', borderRadius: 999,
              border: '1.5px solid', borderColor: 'divider',
              opacity: careerActive ? 0.55 : 1,
              transition: 'opacity 0.15s, border-color 0.15s',
              '&:focus-within': { borderColor: ACCENT },
            }}>
              <select
                value={careerActive ? '' : String(season)}
                onChange={e => { setStatsView('season'); handleSeasonChange(Number(e.target.value)) }}
                style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', color: 'inherit', padding: '6px 14px', borderRadius: 999, fontFamily: 'inherit' }}
              >
                {careerActive && <option value="" disabled>Jump to season…</option>}
                {currentAvailableSeasons.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </Box>
          </Box>
        )
      })()}

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
            <Box ref={cardWrapRef} sx={{ position: 'relative' }}>
              <Paper ref={cardRef} elevation={4} sx={{
                borderRadius: 4, overflow: 'hidden', background: palette.bg,
                transition: 'background 0.45s ease', p: { xs: 2, sm: 2.5 },
              }}>
                {playerCardProps && <CardInner {...playerCardProps} />}
                {teamCardProps && <TeamCardInner {...teamCardProps} />}
              </Paper>
              {/* Prev/next-year arrows — player season card only (hidden on career).
                  Siblings of the Paper so they're excluded from the image export.
                  Flank the big year title directly (yearRect), rather than pinning to
                  the card's outer edges. */}
              {playerCardProps && statsView === 'season' && yearRect != null && (() => {
                const idx = currentAvailableSeasons.indexOf(season)
                const olderYear = idx >= 0 && idx < currentAvailableSeasons.length - 1 ? currentAvailableSeasons[idx + 1] : null
                const newerYear = idx > 0 ? currentAvailableSeasons[idx - 1] : null
                const navBtnSx = {
                  position: 'absolute' as const, top: `${yearRect.top}px`, transform: 'translateY(-50%)',
                  zIndex: 2, width: 30, height: 30, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  bgcolor: 'rgba(0,0,0,0.32)', color: '#fff', cursor: 'pointer',
                  backdropFilter: 'blur(2px)',
                  '&:hover': { bgcolor: 'rgba(0,0,0,0.55)' },
                  transition: 'background 0.15s',
                }
                return (<>
                  {olderYear != null && (
                    <Tooltip title={`${olderYear} season`} placement="top">
                      <Box onClick={() => handleSeasonChange(olderYear)} sx={{ ...navBtnSx, left: `${yearRect.left - 38}px` }}>
                        <ChevronLeft sx={{ fontSize: '1.3rem' }} />
                      </Box>
                    </Tooltip>
                  )}
                  {newerYear != null && (
                    <Tooltip title={`${newerYear} season`} placement="top">
                      <Box onClick={() => handleSeasonChange(newerYear)} sx={{ ...navBtnSx, left: `${yearRect.right + 8}px` }}>
                        <ChevronRight sx={{ fontSize: '1.3rem' }} />
                      </Box>
                    </Tooltip>
                  )}
                </>)
              })()}
              {/* Card actions — collapsed into a single ⋮ menu */}
              <Box sx={{ position: 'absolute', top: 8, right: 8 }}>
                <Tooltip title={downloading ? 'Saving…' : 'Card options'}>
                  <Box
                    onClick={e => setCardMenuAnchor(e.currentTarget as HTMLElement)}
                    sx={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      p: 0.5, borderRadius: 1.5,
                      bgcolor: (cardMenuAnchor || cardOptionsAnchor) ? 'rgba(0,0,0,0.42)' : 'rgba(0,0,0,0.22)',
                      color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
                      '&:hover': { bgcolor: 'rgba(0,0,0,0.42)', color: '#fff' },
                      transition: 'background 0.15s, color 0.15s',
                    }}
                  >
                    {downloading ? <CircularProgress size={13} sx={{ color: 'rgba(255,255,255,0.6)' }} /> : <MoreVert sx={{ fontSize: '0.95rem' }} />}
                  </Box>
                </Tooltip>
              </Box>
              {/* Actions menu */}
              <Menu
                anchorEl={cardMenuAnchor}
                open={Boolean(cardMenuAnchor)}
                onClose={() => setCardMenuAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                PaperProps={{ sx: { borderRadius: 2, mt: 0.5, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', minWidth: 190 } }}
              >
                <MenuItem
                  onClick={() => { const el = cardMenuAnchor; setCardMenuAnchor(null); setCardOptionsAnchor(el) }}
                  sx={{ fontSize: '0.85rem', gap: 1 }}
                >
                  <Tune sx={{ fontSize: '1rem' }} /> Customize card
                </MenuItem>
                <MenuItem onClick={() => { setCardMenuAnchor(null); setFullscreen(true) }} sx={{ fontSize: '0.85rem', gap: 1 }}>
                  <OpenInFull sx={{ fontSize: '1rem' }} /> Fullscreen
                </MenuItem>
                <Divider />
                <MenuItem disabled={downloading} onClick={() => handleDownload('centered')} sx={{ fontSize: '0.85rem', gap: 1 }}>
                  <FileDownload sx={{ fontSize: '1rem' }} /> Download centered
                </MenuItem>
                <MenuItem disabled={downloading} onClick={() => handleDownload('tiktok')} sx={{ fontSize: '0.85rem', gap: 1 }}>
                  <FileDownload sx={{ fontSize: '1rem' }} /> Download for TikTok
                </MenuItem>
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
              {loadingCareer ? (
                <Box sx={{ textAlign: 'center', py: 3 }}><CircularProgress size={22} /></Box>
              ) : (
                <Box sx={{
                  borderRadius: { xs: 0, sm: 3 },
                  border: '1px solid', borderColor: 'divider',
                  p: { xs: 0.75, sm: 1.5 },
                  mx: { xs: -2, sm: 0 },
                }}>
                  <Suspense fallback={<Box sx={{ textAlign: 'center', py: 3 }}><CircularProgress size={22} /></Box>}>
                    <PlayerTrendsChart
                      splits={careerSplits!}
                      isPitcher={player!.primaryPosition?.code === '1'}
                      isTwoWay={player!.primaryPosition?.type === 'Two-Way Player'}
                      gameLog={recentGames}
                      season={season}
                      chartMode={statsView === 'season' ? 'rolling' : 'career'}
                      onGameSelect={isMobile ? undefined : (date => setHighlightedGameDate(d => d === date ? null : date))}
                      onYearSelect={statsView === 'career' ? (s => setHighlightedCareerYear(y => y === s ? null : s)) : undefined}
                    />
                  </Suspense>
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
                    <SectionLabel strong>Recent Games</SectionLabel>
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
                          onTeamClick={onTeamClick}
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
                    onTeamClick={onTeamClick}
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

      {/* Team roster — full-width, below the card + standings/leaders grid */}
      {hasStats && !!team && teamRoster.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Box
            onClick={() => setRosterOpen(o => !o)}
            sx={{
              mb: rosterOpen ? 1.25 : 0,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: 'pointer', userSelect: 'none',
              '&:hover .rs-chevron': { color: 'text.primary' },
            }}
          >
            <SectionLabel strong>Roster</SectionLabel>
            <Box className="rs-chevron" sx={{
              fontSize: '0.75rem', color: 'text.disabled',
              transition: 'transform 0.18s, color 0.15s',
              transform: rosterOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
            }}>▾</Box>
          </Box>
          {rosterOpen && (
            <TeamRoster roster={teamRoster} teamId={team.id} onPlayerClick={openPlayerFromTeam} />
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
            <SectionLabel strong>Recent Games</SectionLabel>
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

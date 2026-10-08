import React, { useRef, useEffect, lazy, Suspense } from 'react'
import {
  Box, Typography, Paper, CircularProgress,
  List, ListItemButton, Divider, ClickAwayListener,
  Popover, Menu, MenuItem, Tooltip,
} from '@mui/material'
import { Search, Shuffle, FileDownload, OpenInFull, Tune, MoreVert } from '@mui/icons-material'
import { Player, Team, Palette, RankMode, TeamPlayerStat, RosterEntry, StandingsDivision } from '../types'
import { ACCENT, ACCENT_TEXT, TEAM_HITTING_DEFS, TEAM_PITCHING_DEFS, TEAM_BG, BBREF_ABBR, DEFAULT_TEAM_HIT_STATS, DEFAULT_TEAM_PIT_STATS, randomPalette } from '../constants'
import { PillChip, linkPillSx, SectionLabel } from '../components/ui'
import { FullscreenEntry } from '../components/MlbSheet'
import { TeamCardInner, TeamCardInnerProps, FeaturedMiniCard, DivisionStandingsCard } from '../components/cards'
// Team schedule (live/next game cards + full-schedule modal, today highlighted). Lazy so
// the ScheduleStrip module only loads when a team page is actually opened.
const TeamScheduleStrip = lazy(() => import('./ScheduleStrip').then(m => ({ default: m.TeamScheduleStrip })))
import { TeamRoster } from '../components/TeamRoster'
import { fetchPlayerDetails } from '../api'
import { track, EVENTS } from '../../lib/analytics'
import { mlbPlayerPath } from '../routes'
import { pushEntry } from '../state/sheetHistory'
import { chromePx, typePx } from '../../ui/scale'
import { PillGroup } from '../../ui/PillGroup'
import { MlbPageH1 } from '../components/PageHeading'

// THE TEAM PAGE. It was the player page too until Oct 2026, when the player moved to its own
// self-fetching card (MlbPlayerDetail); the view is still called 'search' because that is the name
// every history entry and address already carries for both.

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
  team: Team | null
  palette: Palette
  setPalette: (p: Palette) => void
  season: number
  loadingStats: boolean
  hasStats: boolean | null

  // Season selector
  rankMode: RankMode
  setRankMode: (m: RankMode) => void
  currentAvailableSeasons: number[]
  handleSeasonChange: (s: number) => void

  // Stats
  teamHitting: any
  teamPitching: any
  selectedTeamHitStats: string[]
  setSelectedTeamHitStats: (s: string[]) => void
  selectedTeamPitStats: string[]
  setSelectedTeamPitStats: (s: string[]) => void
  toggleTeamHitStat: (key: string) => void
  toggleTeamPitStat: (key: string) => void
  teamHitLeaders: Map<string, number[]>
  teamPitLeaders: Map<string, number[]>

  // Card props
  teamCardProps: TeamCardInnerProps | null

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
  team, palette, setPalette, season, loadingStats, hasStats,
  rankMode, setRankMode, currentAvailableSeasons, handleSeasonChange,
  teamHitting, teamPitching,
  selectedTeamHitStats, setSelectedTeamHitStats, selectedTeamPitStats, setSelectedTeamPitStats,
  toggleTeamHitStat, toggleTeamPitStat,
  teamHitLeaders, teamPitLeaders,
  teamCardProps,
  showFeaturedRight, featuredPlayers, featuredHitLeaders, featuredPitLeaders, divisionStandings,
  teamRoster,
}: SearchViewProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = React.useState(false)
  const exitFullscreen = useRef<(() => void) | null>(null)
  const [cardMenuAnchor, setCardMenuAnchor] = React.useState<HTMLElement | null>(null)
  const [downloading, setDownloading] = React.useState(false)
  const [cardOptionsAnchor, setCardOptionsAnchor] = React.useState<HTMLElement | null>(null)
  const [rosterOpen, setRosterOpen] = React.useState(true)
  const [scheduleOpen, setScheduleOpen] = React.useState(true)
  const [showFullSchedule, setShowFullSchedule] = React.useState(false)
  // Open a player from within a team page. Pushes the player's entry so the browser Back
  // button returns to this team (mirrors the Team Leaders cards below); the team's own entry
  // already carries its snapshot from the URL sync.
  const openPlayerFromTeam = React.useCallback((playerId: number) => {
    if (!team) return
    track(EVENTS.MLB_PLAYER_OPENED, { playerId, from: 'team_page' })
    pushEntry({ view: 'search', playerId }, mlbPlayerPath({ id: playerId }))
    fetchPlayerDetails(playerId)
      .then(details => { if (details) selectPlayer(details) })
      .catch(() => {})
  }, [team, selectPlayer])

  // Close the full-schedule modal when switching teams, so it doesn't linger open.
  useEffect(() => { setShowFullSchedule(false) }, [team?.id])

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

      // Loaded here, not with the view: this chunk is prefetched on every WPBL visit, and the
      // library is ~48 KB gzipped for a button few readers press.
      const { default: html2canvas } = await import('html2canvas')
      const captured = await html2canvas(cardRef.current!, { useCORS: true, scale: 2, logging: false, backgroundColor: null })
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
      const subject = team?.name ?? 'stats'
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
      {/* The page's name. Drawn only inside the card, which is a picture of the player as far as
          the outline goes; see PageHeading.tsx. */}
      {team && <MlbPageH1>{`${team.name}: stats and roster`}</MlbPageH1>}
      {/* Fullscreen overlay */}
      {fullscreen && hasStats && <FullscreenEntry onClose={() => setFullscreen(false)} exitRef={exitFullscreen} />}
      {fullscreen && hasStats && (
        <Box onClick={() => (exitFullscreen.current ?? (() => setFullscreen(false)))()} sx={{
          position: 'fixed', inset: 0, zIndex: 9999, bgcolor: palette.bg,
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}>
          <Box sx={{ width: '100%', maxWidth: chromePx(520), px: 4 }}>
            {teamCardProps && <TeamCardInner {...teamCardProps} large onToggleHitStat={undefined} onTogglePitStat={undefined} />}
          </Box>
        </Box>
      )}

      {loadingStats && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>}

      {/* Nothing selected yet: prompt to search instead of auto-loading a player */}
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

      {/* The season selector. Career is its own emphasized toggle. */}
      {(hasStats || loadingStats) && (() => {
        return (
          <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mb: 1.5, alignItems: 'center' }}>
            <Box sx={{
              display: 'inline-flex', alignItems: 'center', borderRadius: 999,
              border: '1.5px solid', borderColor: 'divider',
              transition: 'border-color 0.15s',
              '&:focus-within': { borderColor: ACCENT },
            }}>
              <select
                value={String(season)}
                onChange={e => handleSeasonChange(Number(e.target.value))}
                style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', color: 'inherit', padding: `${chromePx(6)} ${chromePx(14)}`, borderRadius: 999, fontFamily: 'inherit' }}
              >
                {currentAvailableSeasons.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </Box>
          </Box>
        )
      })()}

      {hasStats && (
        <Box sx={{
          display: { xs: 'block', md: (showFeaturedRight || (!!team && !!divisionStandings)) ? 'grid' : 'block' },
          gridTemplateColumns: { md: `minmax(0, ${chromePx(460)}) 1fr` },
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
                {teamCardProps && <TeamCardInner {...teamCardProps} />}
              </Paper>
              {/* Card actions, collapsed into a single ⋮ menu. */}
              <Box sx={{ position: 'absolute', top: chromePx(8), right: chromePx(8), display: 'flex', gap: 0.5 }}>
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
                PaperProps={{ sx: { borderRadius: 2, mt: 0.5, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', minWidth: chromePx(190) } }}
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
                PaperProps={{ sx: { borderRadius: 2.5, p: 2, mt: 0.75, width: chromePx(290), boxShadow: '0 8px 32px rgba(0,0,0,0.14)' } }}
              >
                {/* Colors */}
                <Box sx={{ mb: 1.75 }}>
                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: typePx(1.6), color: 'text.disabled', mb: 0.75 }}>
                    Colors
                  </Typography>
                  <Box
                    onClick={() => setPalette(randomPalette())}
                    sx={{
                      display: 'inline-flex', alignItems: 'center', gap: 0.5,
                      cursor: 'pointer', px: 1.5, py: 0.5, borderRadius: 999,
                      border: '1.5px solid', borderColor: 'divider',
                      fontSize: '0.8rem', fontWeight: 600, color: 'text.secondary',
                      '&:hover': { borderColor: ACCENT, color: ACCENT_TEXT },
                      transition: 'border-color 0.15s, color 0.15s',
                    }}
                  >
                    <Shuffle sx={{ fontSize: '0.88rem' }} /> Shuffle
                  </Box>
                </Box>

                {/* Batting stats */}
                {teamHitting && (() => {
                  const hitDefs = TEAM_HITTING_DEFS
                  const hitSel = selectedTeamHitStats
                  const setHitSel = setSelectedTeamHitStats
                  const hitDefaults = DEFAULT_TEAM_HIT_STATS
                  const allHit = hitDefs.every(d => hitSel.includes(d.key))
                  return (
                    <Box sx={{ mb: 1.75 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                        <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: typePx(1.6), color: 'text.disabled' }}>
                          Batting stats
                        </Typography>
                        <Box onClick={() => setHitSel(allHit ? hitDefaults : hitDefs.map(d => d.key))} sx={{ fontSize: '0.68rem', fontWeight: 700, color: ACCENT_TEXT, cursor: 'pointer', userSelect: 'none' }}>
                          {allHit ? 'Reset' : 'All'}
                        </Box>
                      </Box>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
                        {hitDefs.map(def => (
                          <PillChip key={def.key} label={def.label} selected={hitSel.includes(def.key)} onChange={() => toggleTeamHitStat(def.key)} />
                        ))}
                      </Box>
                    </Box>
                  )
                })()}

                {/* Pitching stats */}
                {teamPitching && (() => {
                  const pitDefs = TEAM_PITCHING_DEFS
                  const pitSel = selectedTeamPitStats
                  const setPitSel = setSelectedTeamPitStats
                  const pitDefaults = DEFAULT_TEAM_PIT_STATS
                  const allPit = pitDefs.every(d => pitSel.includes(d.key))
                  return (
                    <Box sx={{ mb: 1.75 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                        <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: typePx(1.6), color: 'text.disabled' }}>
                          Pitching stats
                        </Typography>
                        <Box onClick={() => setPitSel(allPit ? pitDefaults : pitDefs.map(d => d.key))} sx={{ fontSize: '0.68rem', fontWeight: 700, color: ACCENT_TEXT, cursor: 'pointer', userSelect: 'none' }}>
                          {allPit ? 'Reset' : 'All'}
                        </Box>
                      </Box>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
                        {pitDefs.map(def => (
                          <PillChip key={def.key} label={def.label} selected={pitSel.includes(def.key)} onChange={() => toggleTeamPitStat(def.key)} />
                        ))}
                      </Box>
                    </Box>
                  )
                })()}

                {/* League rank */}
                <Box>
                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: typePx(1.6), color: 'text.disabled', mb: 0.75 }}>
                    League rank
                  </Typography>
                  <PillGroup
                    options={[{ value: 'none', label: 'None' }, { value: 'top5', label: 'Top 5' }, { value: 'all', label: 'All' }]}
                    value={rankMode}
                    onChange={v => setRankMode(v as RankMode)}
                  />
                </Box>

              </Popover>
            </Box>

            {/* Links: desktop only, left column below card */}
            {team && (
              <Box sx={{ display: { xs: 'none', md: 'flex' }, gap: 0.6, flexWrap: 'wrap', mt: 1.5 }}>
                {(() => {
                  const bbrefAbbr = BBREF_ABBR[team.abbreviation] ?? team.abbreviation
                  return (<>
                    <Box component="a" href={`https://www.baseball-reference.com/teams/${bbrefAbbr}/${season}.shtml`} target="_blank" rel="noopener noreferrer" sx={linkPillSx}>Baseball Ref ↗</Box>
                    <Box component="a" href={`https://baseballsavant.mlb.com/team/${team.id}`} target="_blank" rel="noopener noreferrer" sx={linkPillSx}>Baseball Savant ↗</Box>
                  </>)
                })()}
              </Box>
            )}

          </Box>

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

              {/* Award leader cards in a 2×2 grid */}
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
                          track(EVENTS.MLB_PLAYER_OPENED, { playerId: p.playerId, from: 'team_page' })
                          pushEntry({ view: 'search', playerId: p.playerId }, mlbPlayerPath({ id: p.playerId }))
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

      {/* Team schedule: full-width, live/next game cards (today's game highlighted)
          with a full-schedule modal. Team pages only. */}
      {hasStats && !!team && (
        <Box sx={{ mb: 2 }}>
          <Box
            onClick={() => setScheduleOpen(o => !o)}
            sx={{
              mb: scheduleOpen ? 1.25 : 0,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: 'pointer', userSelect: 'none',
              '&:hover .sc-chevron': { color: 'text.primary' },
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <SectionLabel strong>Schedule</SectionLabel>
              <Box
                onClick={e => { e.stopPropagation(); setShowFullSchedule(true) }}
                sx={{ fontSize: '0.68rem', fontWeight: 700, color: ACCENT_TEXT, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
              >
                Full schedule →
              </Box>
            </Box>
            <Box className="sc-chevron" sx={{
              fontSize: '0.75rem', color: 'text.disabled',
              transition: 'transform 0.18s, color 0.15s',
              transform: scheduleOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
            }}>▾</Box>
          </Box>
          {scheduleOpen && (
            <Box sx={{ borderRadius: { xs: 0, sm: 3 }, border: '1px solid', borderColor: 'divider', overflow: 'hidden', mx: { xs: -2, sm: 0 } }}>
              <Suspense fallback={<Typography sx={{ fontSize: '0.7rem', color: 'text.disabled', px: 1.5, py: 1 }}>Loading schedule…</Typography>}>
                <TeamScheduleStrip
                  teamId={team.id}
                  teamColor={TEAM_BG[team.id] ?? ACCENT}
                  showSchedule={showFullSchedule}
                  onScheduleClose={() => setShowFullSchedule(false)}
                  onPlayerClick={openPlayerFromTeam}
                  onTeamClick={onTeamClick}
                />
              </Suspense>
            </Box>
          )}
        </Box>
      )}

      {/* Team roster: full-width, below the card + standings/leaders grid */}
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

      {/* Links at the bottom of the page */}
      {hasStats && team && (
        <Box sx={{ display: { xs: 'flex', md: 'none' }, gap: 0.6, flexWrap: 'wrap', mb: 3 }}>
          {(() => {
            const bbrefAbbr = BBREF_ABBR[team.abbreviation] ?? team.abbreviation
            return (<>
              <Box component="a" href={`https://www.baseball-reference.com/teams/${bbrefAbbr}/${season}.shtml`} target="_blank" rel="noopener noreferrer" sx={linkPillSx}>Baseball Ref ↗</Box>
              <Box component="a" href={`https://baseballsavant.mlb.com/team/${team.id}`} target="_blank" rel="noopener noreferrer" sx={linkPillSx}>Baseball Savant ↗</Box>
            </>)
          })()}
        </Box>
      )}

      {!loadingStats && team && !teamHitting && !teamPitching && (
        <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
          No {season} season stats available.
        </Typography>
      )}
    </>
  )
}

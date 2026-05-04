import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  Box, TextField, Typography, CircularProgress, Paper,
  InputAdornment, List, ListItemButton, ListItemText,
  Divider, ClickAwayListener, Button, Menu, MenuItem, Select, FormControl,
} from '@mui/material'
import { Search, SportsBaseball, Shuffle, FileDownload } from '@mui/icons-material'
import html2canvas from 'html2canvas'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Player {
  id: number
  fullName: string
  active: boolean
  primaryPosition: { code: string; name: string; type: string }
  currentTeam?: { name: string }
}

interface Palette {
  bg: string
  text: string
  sub: string
  rank: string
  divider: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CURRENT_SEASON = new Date().getFullYear()

const HEADSHOT = (id: number) =>
  `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_426,q_auto:best/v1/people/${id}/headshot/67/current`

const TEAM_ABBR: Record<number, string> = {
  108: 'LAA', 109: 'ARI', 110: 'BAL', 111: 'BOS', 112: 'CHC',
  113: 'CIN', 114: 'CLE', 115: 'COL', 116: 'DET', 117: 'HOU',
  118: 'KC',  119: 'LAD', 120: 'WSH', 121: 'NYM', 133: 'OAK',
  134: 'PIT', 135: 'SD',  136: 'SEA', 137: 'SF',  138: 'STL',
  139: 'TB',  140: 'TEX', 141: 'TOR', 142: 'MIN', 143: 'PHI',
  144: 'ATL', 145: 'CWS', 146: 'MIA', 147: 'NYY', 158: 'MIL',
}

const HIT_CATEGORIES = ['battingAverage', 'homeRuns', 'runsBattedIn', 'stolenBases', 'onBasePlusSlugging']
const PIT_CATEGORIES = ['earnedRunAverage', 'strikeouts', 'walksAndHitsPerInningPitched', 'inningsPitched']

// ─── Palette ─────────────────────────────────────────────────────────────────

function randomPalette(): Palette {
  const hue = Math.floor(Math.random() * 360)
  const sat = 65 + Math.floor(Math.random() * 30)
  const dark = Math.random() > 0.3
  const lightness = dark
    ? 10 + Math.floor(Math.random() * 28)
    : 62 + Math.floor(Math.random() * 20)
  return {
    bg: `hsl(${hue}, ${sat}%, ${lightness}%)`,
    text: dark ? '#ffffff' : '#0a0a0a',
    sub: dark ? 'rgba(255,255,255,0.58)' : 'rgba(0,0,0,0.52)',
    rank: dark ? 'rgba(255,255,255,0.42)' : 'rgba(0,0,0,0.32)',
    divider: dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)',
  }
}

const DEFAULT_PALETTE: Palette = {
  bg: 'hsl(220, 70%, 15%)',
  text: '#ffffff',
  sub: 'rgba(255,255,255,0.58)',
  rank: 'rgba(255,255,255,0.42)',
  divider: 'rgba(255,255,255,0.14)',
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function searchPlayers(name: string): Promise<Player[]> {
  const r = await fetch(`https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}&sportId=1`)
  const d = await r.json()
  return (d.people ?? []).filter((p: Player) => p.active !== false)
}

async function fetchPlayerDetails(id: number): Promise<Player | null> {
  const r = await fetch(`https://statsapi.mlb.com/api/v1/people/${id}?hydrate=currentTeam`)
  const d = await r.json()
  return d.people?.[0] ?? null
}

async function fetchStats(id: number, group: 'hitting' | 'pitching', season: number) {
  const r = await fetch(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=season&group=${group}&season=${season}`)
  const d = await r.json()
  return d.stats?.[0]?.splits?.[0]?.stat ?? null
}

async function fetchCareerData(id: number, groups: Array<'hitting' | 'pitching'>): Promise<{
  seasons: number[]
  teamsBySeason: Map<number, string[]>
}> {
  const results = await Promise.all(groups.map(group =>
    fetch(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=yearByYear&group=${group}&sportId=1`)
      .then(r => r.json())
      .then(d => d.stats?.[0]?.splits ?? [])
      .catch(() => [])
  ))
  const allSplits = results.flat()
  const teamsBySeason = new Map<number, string[]>()
  const seasons = new Set<number>()
  for (const split of allSplits) {
    const s = Number(split.season)
    if (!s) continue
    seasons.add(s)
    const abbr = TEAM_ABBR[split.team?.id]
    if (abbr) {
      const existing = teamsBySeason.get(s) ?? []
      if (!existing.includes(abbr)) teamsBySeason.set(s, [...existing, abbr])
    }
  }
  return { seasons: [...seasons].sort((a, b) => b - a), teamsBySeason }
}

async function fetchLeaderIds(categories: string[], statGroup: string, season: number): Promise<Map<string, number[]>> {
  try {
    const q = new URLSearchParams({ leaderCategories: categories.join(','), sportId: '1', season: String(season), limit: '20', statGroup })
    const r = await fetch(`https://statsapi.mlb.com/api/v1/stats/leaders?${q}`)
    const d = await r.json()
    const map = new Map<string, number[]>()
    for (const cat of d.leagueLeaders ?? []) {
      if (cat.statGroup !== statGroup) continue
      map.set(cat.leaderCategory, (cat.leaders ?? []).map((l: any) => l.person?.id).filter(Boolean))
    }
    return map
  } catch {
    return new Map()
  }
}

function fmt(v: any): string {
  return v == null || v === '' ? '—' : String(v)
}

function fmtDecimal(v: any, places = 2): string {
  if (v == null || v === '') return '—'
  const n = Number(v)
  return isNaN(n) ? '—' : n.toFixed(places)
}

// ─── Stat item ───────────────────────────────────────────────────────────────

interface StatItemProps {
  label: string
  value: string
  playerId: number
  category: string
  leaders: Map<string, number[]>
  palette: Palette
  large?: boolean
}

function StatItem({ label, value, playerId, category, leaders, palette, large }: StatItemProps) {
  const ids = leaders.get(category) ?? []
  const rank = ids.indexOf(playerId)
  const inTop20 = rank !== -1

  return (
    <Box sx={{ textAlign: 'center' }}>
      <Typography sx={{
        color: palette.text,
        fontWeight: 800,
        fontSize: large ? { xs: '0.8rem', sm: '0.9rem' } : { xs: '0.7rem', sm: '0.8rem' },
        textTransform: 'uppercase',
        letterSpacing: 1.5,
        opacity: 0.7,
        mb: 0.4,
      }}>
        {label}
      </Typography>
      <Typography sx={{
        color: palette.text,
        fontWeight: 700,
        fontSize: large ? { xs: '2rem', sm: '2.4rem' } : { xs: '1.75rem', sm: '2.1rem' },
        lineHeight: 1,
        letterSpacing: '-0.5px',
      }}>
        {value}
      </Typography>
      <Typography sx={{
        color: palette.rank,
        fontSize: '0.63rem',
        fontWeight: 700,
        mt: 0.4,
        height: '1rem',
        letterSpacing: 0.5,
      }}>
        {inTop20 ? `${rank < 5 ? '🔥 ' : ''}#${rank + 1}` : ''}
      </Typography>
    </Box>
  )
}

// ─── Card inner content (shared by normal + fullscreen) ──────────────────────

interface CardInnerProps {
  player: Player
  hittingStats: any
  pitchingStats: any
  leaders: Map<string, number[]>
  palette: Palette
  season: number
  teamDisplay: string
  large?: boolean
}

function CardInner({ player, hittingStats, pitchingStats, leaders, palette, season, teamDisplay, large }: CardInnerProps) {
  const photoSize = large ? 200 : 155
  return (
    <>
      {/* Photo */}
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2.5 }}>
        <Box sx={{
          width: photoSize,
          height: Math.round(photoSize * 1.2),
          borderRadius: 3,
          overflow: 'hidden',
          border: `3px solid ${palette.text}`,
          flexShrink: 0,
          bgcolor: palette.divider,
        }}>
          <img
            src={HEADSHOT(player.id)}
            alt={player.fullName}
            crossOrigin="anonymous"
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 12%', display: 'block' }}
            onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
          />
        </Box>
      </Box>

      {/* Name */}
      <Typography sx={{
        textAlign: 'center', color: palette.text, fontWeight: 800,
        fontSize: large ? { xs: '2rem', sm: '2.4rem' } : { xs: '1.6rem', sm: '2rem' },
        lineHeight: 1.1, letterSpacing: '-0.3px', mb: 0.5,
      }}>
        {player.fullName}
      </Typography>

      {/* Team / position */}
      <Typography sx={{
        textAlign: 'center', color: palette.sub,
        fontSize: large ? '1rem' : { xs: '0.82rem', sm: '0.9rem' },
        fontWeight: 500, mb: 3.5,
      }}>
        {[player.primaryPosition?.name, teamDisplay].filter(Boolean).join(' · ')}
      </Typography>

      {/* Hitting */}
      {hittingStats && (
        <Box sx={{ borderTop: `1px solid ${palette.divider}`, pt: 2.5 }}>
          <Typography sx={{
            textAlign: 'center', color: palette.rank, fontSize: '0.6rem', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: 2.5, mb: 2,
          }}>
            {season} Hitting
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: { xs: 0.5, sm: 1 } }}>
            <StatItem label="AVG" value={fmt(hittingStats.avg)} playerId={player.id} category="battingAverage" leaders={leaders} palette={palette} large={large} />
            <StatItem label="OPS" value={fmt(hittingStats.ops)} playerId={player.id} category="onBasePlusSlugging" leaders={leaders} palette={palette} large={large} />
            <StatItem label="HR" value={fmt(hittingStats.homeRuns)} playerId={player.id} category="homeRuns" leaders={leaders} palette={palette} large={large} />
            <StatItem label="RBI" value={fmt(hittingStats.rbi)} playerId={player.id} category="runsBattedIn" leaders={leaders} palette={palette} large={large} />
            <StatItem label="SB" value={fmt(hittingStats.stolenBases)} playerId={player.id} category="stolenBases" leaders={leaders} palette={palette} large={large} />
          </Box>
        </Box>
      )}

      {/* Pitching */}
      {pitchingStats && (
        <Box sx={{ borderTop: `1px solid ${palette.divider}`, pt: 2.5, mt: hittingStats ? 2.5 : 0 }}>
          <Typography sx={{
            textAlign: 'center', color: palette.rank, fontSize: '0.6rem', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: 2.5, mb: 2,
          }}>
            {season} Pitching
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: { xs: 0.5, sm: 1 } }}>
            <StatItem label="IP" value={fmt(pitchingStats.inningsPitched)} playerId={player.id} category="inningsPitched" leaders={leaders} palette={palette} large={large} />
            <StatItem label="ERA" value={fmtDecimal(pitchingStats.era)} playerId={player.id} category="earnedRunAverage" leaders={leaders} palette={palette} large={large} />
            <StatItem label="SO" value={fmt(pitchingStats.strikeOuts)} playerId={player.id} category="strikeouts" leaders={leaders} palette={palette} large={large} />
            <StatItem label="BB" value={fmt(pitchingStats.baseOnBalls)} playerId={player.id} category="" leaders={leaders} palette={palette} large={large} />
            <StatItem label="WHIP" value={fmtDecimal(pitchingStats.whip)} playerId={player.id} category="walksAndHitsPerInningPitched" leaders={leaders} palette={palette} large={large} />
          </Box>
        </Box>
      )}
    </>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MlbStats() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Player[]>([])
  const [searching, setSearching] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const [player, setPlayer] = useState<Player | null>(null)
  const [hittingStats, setHittingStats] = useState<any>(null)
  const [pitchingStats, setPitchingStats] = useState<any>(null)
  const [leaders, setLeaders] = useState<Map<string, number[]>>(new Map())
  const [loadingStats, setLoadingStats] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [palette, setPalette] = useState<Palette>(DEFAULT_PALETTE)
  const [season, setSeason] = useState(CURRENT_SEASON)
  const [availableSeasons, setAvailableSeasons] = useState<number[]>([CURRENT_SEASON])
  const [seasonTeams, setSeasonTeams] = useState<Map<number, string[]>>(new Map())
  const [fullscreen, setFullscreen] = useState(false)
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null)
  const [downloading, setDownloading] = useState(false)

  const cardRef = useRef<HTMLDivElement>(null)

  // Debounced search
  useEffect(() => {
    if (query.length < 2) { setResults([]); setDropdownOpen(false); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const players = await searchPlayers(query)
        setResults(players.slice(0, 8))
        setDropdownOpen(players.length > 0)
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [query])

  const loadStats = useCallback(async (p: Player, s: number, initial = true) => {
    if (initial) {
      setLoadingStats(true)
      setHittingStats(null)
      setPitchingStats(null)
      setLeaders(new Map())
    } else {
      setRefreshing(true)
    }
    try {
      const isPitcher = p.primaryPosition?.code === '1'
      const isTwoWay = p.primaryPosition?.type === 'Two-Way Player'
      const wantHitting = !isPitcher || isTwoWay
      const wantPitching = isPitcher || isTwoWay

      const [hitting, pitching] = await Promise.all([
        wantHitting ? fetchStats(p.id, 'hitting', s) : null,
        wantPitching ? fetchStats(p.id, 'pitching', s) : null,
      ])
      setHittingStats(hitting)
      setPitchingStats(pitching)

      const [hLeaders, pLeaders] = await Promise.all([
        hitting ? fetchLeaderIds(HIT_CATEGORIES, 'hitting', s) : Promise.resolve(new Map<string, number[]>()),
        pitching ? fetchLeaderIds(PIT_CATEGORIES, 'pitching', s) : Promise.resolve(new Map<string, number[]>()),
      ])
      setLeaders(new Map([...hLeaders, ...pLeaders]))
    } finally {
      setLoadingStats(false)
      setRefreshing(false)
    }
  }, [])

  const selectPlayer = useCallback(async (p: Player) => {
    setDropdownOpen(false)
    setQuery(p.fullName)
    setPalette(randomPalette())
    setLoadingStats(true)
    const isPitcher = p.primaryPosition?.code === '1'
    const isTwoWay = p.primaryPosition?.type === 'Two-Way Player'
    const groups: Array<'hitting' | 'pitching'> = isTwoWay
      ? ['hitting', 'pitching']
      : isPitcher ? ['pitching'] : ['hitting']

    const [details, careerData] = await Promise.all([
      fetchPlayerDetails(p.id),
      fetchCareerData(p.id, groups),
    ])
    const resolved = details ?? p
    const { seasons, teamsBySeason } = careerData
    const latestSeason = seasons[0] ?? CURRENT_SEASON
    setPlayer(resolved)
    setAvailableSeasons(seasons.length ? seasons : [CURRENT_SEASON])
    setSeasonTeams(teamsBySeason)
    setSeason(latestSeason)
    await loadStats(resolved, latestSeason)
  }, [season, loadStats])

  const handleSeasonChange = useCallback((s: number) => {
    setSeason(s)
    if (player) loadStats(player, s, false)
  }, [player, loadStats])

  const handleDownload = useCallback(async () => {
    if (!cardRef.current) return
    setExportAnchor(null)
    setDownloading(true)
    try {
      const captured = await html2canvas(cardRef.current, {
        useCORS: true,
        scale: 2,
        logging: false,
        backgroundColor: null,
      })

      // Build 9:16 canvas with full bg color
      const out = document.createElement('canvas')
      out.width = 1080
      out.height = 1920
      const ctx = out.getContext('2d')!
      ctx.fillStyle = palette.bg
      ctx.fillRect(0, 0, 1080, 1920)

      const scale = Math.min((1080 * 0.92) / captured.width, (1920 * 0.85) / captured.height)
      const dw = captured.width * scale
      const dh = captured.height * scale
      ctx.drawImage(captured, (1080 - dw) / 2, (1920 - dh) / 2, dw, dh)

      const link = document.createElement('a')
      link.download = `${player?.fullName ?? 'player'}-${season}-stats.png`
      link.href = out.toDataURL('image/png')
      link.click()
    } catch (e) {
      console.error('Download failed:', e)
    } finally {
      setDownloading(false)
    }
  }, [palette.bg, player, season])

  const hasStats = !loadingStats && player && (hittingStats || pitchingStats)
  const teamDisplay = seasonTeams.get(season)?.join('/') ?? player?.currentTeam?.name ?? ''

  return (
    <Box sx={{ maxWidth: 600, mx: 'auto' }}>

      {/* Fullscreen overlay */}
      {fullscreen && player && (hittingStats || pitchingStats) && (
        <Box
          onClick={() => setFullscreen(false)}
          sx={{
            position: 'fixed', inset: 0, zIndex: 9999,
            bgcolor: palette.bg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <Box sx={{ width: '100%', maxWidth: 520, px: 4 }}>
            <CardInner
              player={player} hittingStats={hittingStats} pitchingStats={pitchingStats}
              leaders={leaders} palette={palette} season={season} teamDisplay={teamDisplay} large
            />
          </Box>
        </Box>
      )}

      {/* Search */}
      <ClickAwayListener onClickAway={() => setDropdownOpen(false)}>
        <Box sx={{ position: 'relative', mb: 3 }}>
          <TextField
            fullWidth
            placeholder="Search player name…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  {searching ? <CircularProgress size={18} /> : <Search fontSize="small" color="action" />}
                </InputAdornment>
              ),
            }}
          />
          {dropdownOpen && results.length > 0 && (
            <Paper elevation={6} sx={{ position: 'absolute', width: '100%', zIndex: 20, mt: 0.5, borderRadius: 2, overflow: 'hidden' }}>
              <List dense disablePadding>
                {results.map((p, i) => (
                  <React.Fragment key={p.id}>
                    {i > 0 && <Divider />}
                    <ListItemButton onClick={() => selectPlayer(p)}>
                      <ListItemText primary={p.fullName} secondary={p.primaryPosition?.name} />
                    </ListItemButton>
                  </React.Fragment>
                ))}
              </List>
            </Paper>
          )}
          {dropdownOpen && results.length === 0 && !searching && (
            <Paper elevation={6} sx={{ position: 'absolute', width: '100%', zIndex: 20, mt: 0.5, borderRadius: 2, p: 2 }}>
              <Typography color="text.secondary" variant="body2">No players found</Typography>
            </Paper>
          )}
        </Box>
      </ClickAwayListener>

      {loadingStats && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>}

      {hasStats && (
        <>
          {/* Stats card */}
          <Paper
            ref={cardRef}
            elevation={4}
            sx={{
              borderRadius: 4,
              overflow: 'hidden',
              background: palette.bg,
              transition: 'background 0.45s ease',
              p: { xs: 3, sm: 4 },
            }}
          >
            <CardInner
              player={player!} hittingStats={hittingStats} pitchingStats={pitchingStats}
              leaders={leaders} palette={palette} season={season} teamDisplay={teamDisplay}
            />
          </Paper>

          {/* Controls */}
          <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mt: 2, flexWrap: 'wrap' }}>
            <Button variant="outlined" startIcon={<Shuffle />} size="small" onClick={() => setPalette(randomPalette())}>
              Randomize
            </Button>

            {/* Year selector */}
            <FormControl size="small">
              <Select
                value={season}
                onChange={e => handleSeasonChange(Number(e.target.value))}
                sx={{ fontSize: '0.8rem' }}
              >
                {availableSeasons.map(y => (
                  <MenuItem key={y} value={y}>{y}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Export */}
            <Button
              variant="outlined"
              startIcon={<FileDownload />}
              size="small"
              disabled={downloading}
              onClick={e => setExportAnchor(e.currentTarget)}
            >
              {downloading ? 'Saving…' : 'Export'}
            </Button>
            <Menu anchorEl={exportAnchor} open={Boolean(exportAnchor)} onClose={() => setExportAnchor(null)}>
              <MenuItem onClick={() => { setFullscreen(true); setExportAnchor(null) }}>
                View fullscreen
              </MenuItem>
              <MenuItem onClick={handleDownload}>
                Download PNG
              </MenuItem>
            </Menu>
          </Box>
        </>
      )}

      {!loadingStats && player && !hittingStats && !pitchingStats && (
        <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
          No {season} season stats available.
        </Typography>
      )}
    </Box>
  )
}

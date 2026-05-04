import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  Box, TextField, Typography, CircularProgress, Paper,
  InputAdornment, List, ListItemButton, ListItemText,
  Divider, ClickAwayListener, Button, Menu, MenuItem, Select, FormControl,
  Popover, FormGroup, FormControlLabel, Checkbox,
} from '@mui/material'
import { Search, Shuffle, FileDownload } from '@mui/icons-material'
import html2canvas from 'html2canvas'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Player {
  id: number
  fullName: string
  active: boolean
  primaryPosition: { code: string; name: string; type: string }
  currentTeam?: { id: number; name: string }
}

interface Palette {
  bg: string
  text: string
  sub: string
  rank: string
  divider: string
}

interface StatDef {
  key: string
  label: string
  getValue: (stat: any) => any
  format: (v: any) => string
  leaderCategory: string
  defaultSelected: boolean
  poop?: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(v: any): string {
  return v == null || v === '' ? '—' : String(v)
}

function fmtDecimal(v: any, places = 2): string {
  if (v == null || v === '') return '—'
  const n = Number(v)
  return isNaN(n) ? '—' : n.toFixed(places)
}

// Given N stats, return column count that avoids a single orphan on the last row
function statCols(n: number): number {
  if (n <= 5) return n || 1
  for (let cols = 5; cols >= 2; cols--) {
    if (n % cols !== 1) return cols
  }
  return 2
}

// ─── Stat definitions ─────────────────────────────────────────────────────────

const HITTING_STAT_DEFS: StatDef[] = [
  { key: 'ab',   label: 'AB',   getValue: s => s.atBats,        format: fmt,  leaderCategory: '',                    defaultSelected: false },
  { key: 'h',    label: 'H',    getValue: s => s.hits,          format: fmt,  leaderCategory: 'hits',                defaultSelected: false },
  { key: 'avg',  label: 'AVG',  getValue: s => s.avg,           format: fmt,  leaderCategory: 'battingAverage',      defaultSelected: true  },
  { key: '1b',   label: '1B',   getValue: s => s.hits != null ? s.hits - (s.doubles ?? 0) - (s.triples ?? 0) - (s.homeRuns ?? 0) : null, format: fmt, leaderCategory: '', defaultSelected: false },
  { key: '2b',   label: '2B',   getValue: s => s.doubles,       format: fmt,  leaderCategory: 'doubles',             defaultSelected: false },
  { key: '3b',   label: '3B',   getValue: s => s.triples,       format: fmt,  leaderCategory: 'triples',             defaultSelected: false },
  { key: 'hr',   label: 'HR',   getValue: s => s.homeRuns,      format: fmt,  leaderCategory: 'homeRuns',            defaultSelected: true  },
  { key: 'rbi',  label: 'RBI',  getValue: s => s.rbi,           format: fmt,  leaderCategory: 'runsBattedIn',        defaultSelected: true  },
  { key: 'obp',  label: 'OBP',  getValue: s => s.obp,           format: fmt,  leaderCategory: 'onBasePercentage',    defaultSelected: false },
  { key: 'slg',  label: 'SLG',  getValue: s => s.slg,           format: fmt,  leaderCategory: 'sluggingPercentage',  defaultSelected: false },
  { key: 'ops',  label: 'OPS',  getValue: s => s.ops,           format: fmt,  leaderCategory: 'onBasePlusSlugging',  defaultSelected: true  },
  { key: 'k',    label: 'K',    getValue: s => s.strikeOuts,    format: fmt,  leaderCategory: 'strikeouts',          defaultSelected: false, poop: true },
  { key: 'bb',   label: 'BB',   getValue: s => s.baseOnBalls,   format: fmt,  leaderCategory: 'walks',               defaultSelected: false },
  { key: 'sb',   label: 'SB',   getValue: s => s.stolenBases,   format: fmt,  leaderCategory: 'stolenBases',         defaultSelected: false },
  { key: 'cs',   label: 'CS',   getValue: s => s.caughtStealing, format: fmt, leaderCategory: 'caughtStealing',      defaultSelected: false, poop: true },
]

const PITCHING_STAT_DEFS: StatDef[] = [
  { key: 'wl',   label: 'W-L',  getValue: s => s.wins != null ? `${s.wins}-${s.losses ?? 0}` : null, format: v => v ?? '—', leaderCategory: 'wins',                         defaultSelected: true  },
  { key: 'era',  label: 'ERA',  getValue: s => s.era,              format: fmt,                   leaderCategory: 'earnedRunAverage',             defaultSelected: true  },
  { key: 'g',    label: 'G',    getValue: s => s.gamesPlayed,      format: fmt,                   leaderCategory: '',                             defaultSelected: false },
  { key: 'gs',   label: 'GS',   getValue: s => s.gamesStarted,     format: fmt,                   leaderCategory: '',                             defaultSelected: false },
  { key: 'ip',   label: 'IP',   getValue: s => s.inningsPitched,   format: fmt,                   leaderCategory: 'inningsPitched',               defaultSelected: true  },
  { key: 'whip', label: 'WHIP', getValue: s => s.whip,             format: fmt,                   leaderCategory: 'walksAndHitsPerInningPitched',  defaultSelected: true  },
  { key: 'sv',   label: 'SV',   getValue: s => s.saves,            format: fmt,                   leaderCategory: 'saves',                        defaultSelected: false },
  { key: 'h',    label: 'H',    getValue: s => s.hits,             format: fmt,                   leaderCategory: '',                             defaultSelected: false },
  { key: 'r',    label: 'R',    getValue: s => s.runs,             format: fmt,                   leaderCategory: '',                             defaultSelected: false },
  { key: 'er',   label: 'ER',   getValue: s => s.earnedRuns,       format: fmt,                   leaderCategory: '',                             defaultSelected: false },
  { key: 'hr',   label: 'HR',   getValue: s => s.homeRuns,         format: fmt,                   leaderCategory: '',                             defaultSelected: false },
  { key: 'bb',   label: 'BB',   getValue: s => s.baseOnBalls,      format: fmt,                   leaderCategory: '',                             defaultSelected: false },
  { key: 'k',    label: 'K',    getValue: s => s.strikeOuts,       format: fmt,                   leaderCategory: 'strikeouts',                   defaultSelected: true  },
  { key: 'so9',  label: 'SO/9', getValue: s => s.strikeoutsPer9Inn, format: v => fmtDecimal(v, 2), leaderCategory: 'strikeoutsPer9Inn',            defaultSelected: false },
]

const HIT_LEADER_CATS = [...new Set(HITTING_STAT_DEFS.map(d => d.leaderCategory).filter(Boolean))]
const PIT_LEADER_CATS = [...new Set(PITCHING_STAT_DEFS.map(d => d.leaderCategory).filter(Boolean))]
const DEFAULT_HIT_STATS = HITTING_STAT_DEFS.filter(d => d.defaultSelected).map(d => d.key)
const DEFAULT_PIT_STATS = PITCHING_STAT_DEFS.filter(d => d.defaultSelected).map(d => d.key)

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

// ─── Palette ─────────────────────────────────────────────────────────────────

const TEAM_BG: Record<number, string> = {
  108: '#BA0021',  // LAA Angels
  109: '#A71930',  // ARI Diamondbacks
  110: '#DF4601',  // BAL Orioles
  111: '#BD3039',  // BOS Red Sox
  112: '#0E3386',  // CHC Cubs
  113: '#C6011F',  // CIN Reds
  114: '#00385D',  // CLE Guardians
  115: '#33006F',  // COL Rockies
  116: '#0C2340',  // DET Tigers
  117: '#002D62',  // HOU Astros
  118: '#004687',  // KC Royals
  119: '#005A9C',  // LAD Dodgers
  120: '#AB0003',  // WSH Nationals
  121: '#002D72',  // NYM Mets
  133: '#003831',  // OAK Athletics
  134: '#27251F',  // PIT Pirates
  135: '#2F241D',  // SD Padres
  136: '#005C5C',  // SEA Mariners
  137: '#27251F',  // SF Giants
  138: '#C41E3A',  // STL Cardinals
  139: '#092C5C',  // TB Rays
  140: '#003278',  // TEX Rangers
  141: '#134A8E',  // TOR Blue Jays
  142: '#002B5C',  // MIN Twins
  143: '#E81828',  // PHI Phillies
  144: '#CE1141',  // ATL Braves
  145: '#27251F',  // CWS White Sox
  146: '#272525',  // MIA Marlins
  147: '#132448',  // NYY Yankees
  158: '#12284B',  // MIL Brewers
}

function teamPalette(teamId?: number): Palette {
  const bg = (teamId != null && TEAM_BG[teamId]) || DEFAULT_PALETTE.bg
  return {
    bg,
    text: '#ffffff',
    sub: 'rgba(255,255,255,0.62)',
    rank: 'rgba(255,255,255,0.42)',
    divider: 'rgba(255,255,255,0.16)',
  }
}

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

// ─── Stat item ───────────────────────────────────────────────────────────────

interface StatItemProps {
  label: string
  value: string
  playerId: number
  leaderCategory: string
  leaders: Map<string, number[]>
  palette: Palette
  large?: boolean
  poop?: boolean
}

function StatItem({ label, value, playerId, leaderCategory, leaders, palette, large, poop }: StatItemProps) {
  const ids = leaderCategory ? (leaders.get(leaderCategory) ?? []) : []
  const rank = ids.indexOf(playerId)
  const inTop5 = rank !== -1 && rank < 5
  const inTop20 = rank !== -1

  let badge = ''
  if (inTop20) {
    if (inTop5) badge = `${poop ? '💩' : '🔥'} #${rank + 1}`
    else badge = `#${rank + 1}`
  }

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
        {badge}
      </Typography>
    </Box>
  )
}

// ─── Stat picker popover ─────────────────────────────────────────────────────

interface StatPickerProps {
  defs: StatDef[]
  selected: string[]
  onToggle: (key: string) => void
  label: string
}

function StatPicker({ defs, selected, onToggle, label }: StatPickerProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <Button variant="outlined" size="small" onClick={e => setAnchor(e.currentTarget)}>
        {label} ▾
      </Button>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ p: 1, maxHeight: 340, overflowY: 'auto', minWidth: 140 }}>
          <FormGroup>
            {defs.map(def => (
              <FormControlLabel
                key={def.key}
                control={
                  <Checkbox
                    size="small"
                    checked={selected.includes(def.key)}
                    onChange={() => onToggle(def.key)}
                    sx={{ py: 0.3 }}
                  />
                }
                label={<Typography sx={{ fontSize: '0.82rem' }}>{def.label}</Typography>}
                sx={{ mx: 0 }}
              />
            ))}
          </FormGroup>
        </Box>
      </Popover>
    </>
  )
}

// ─── Card inner content (shared by normal + fullscreen) ──────────────────────

interface CardInnerProps {
  player: Player
  hittingStats: any
  pitchingStats: any
  hitLeaders: Map<string, number[]>
  pitLeaders: Map<string, number[]>
  palette: Palette
  season: number
  teamDisplay: string
  large?: boolean
  selectedHitStats: string[]
  selectedPitStats: string[]
  onToggleHitStat?: (key: string) => void
  onTogglePitStat?: (key: string) => void
}

function CardInner({ player, hittingStats, pitchingStats, hitLeaders, pitLeaders, palette, season, teamDisplay, large, selectedHitStats, selectedPitStats, onToggleHitStat, onTogglePitStat }: CardInnerProps) {
  const photoSize = large ? 200 : 155

  const visibleHitDefs = HITTING_STAT_DEFS.filter(d => selectedHitStats.includes(d.key))
  const visiblePitDefs = PITCHING_STAT_DEFS.filter(d => selectedPitStats.includes(d.key))
  const hitCols = statCols(visibleHitDefs.length)
  const pitCols = statCols(visiblePitDefs.length)

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
          backgroundImage: `url(${HEADSHOT(player.id)})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center 12%',
        }} />
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
      {hittingStats && visibleHitDefs.length > 0 && (
        <Box sx={{ borderTop: `1px solid ${palette.divider}`, pt: 2.5 }}>
          <Typography sx={{
            textAlign: 'center', color: palette.rank, fontSize: '0.6rem', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: 2.5, mb: 2,
          }}>
            {season} Hitting
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
            {visibleHitDefs.map(def => (
              <Box
                key={def.key}
                onClick={() => onToggleHitStat?.(def.key)}
                sx={{
                  width: `${100 / hitCols}%`,
                  pb: 2,
                  cursor: onToggleHitStat ? 'pointer' : 'default',
                  transition: 'opacity 0.15s',
                  '&:hover': onToggleHitStat ? { opacity: 0.6 } : {},
                }}
              >
                <StatItem
                  label={def.label}
                  value={def.format(def.getValue(hittingStats))}
                  playerId={player.id}
                  leaderCategory={def.leaderCategory}
                  leaders={hitLeaders}
                  palette={palette}
                  large={large}
                  poop={def.poop}
                />
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Pitching */}
      {pitchingStats && visiblePitDefs.length > 0 && (
        <Box sx={{ borderTop: `1px solid ${palette.divider}`, pt: 2.5, mt: hittingStats && visibleHitDefs.length > 0 ? 1 : 0 }}>
          <Typography sx={{
            textAlign: 'center', color: palette.rank, fontSize: '0.6rem', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: 2.5, mb: 2,
          }}>
            {season} Pitching
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
            {visiblePitDefs.map(def => (
              <Box
                key={def.key}
                onClick={() => onTogglePitStat?.(def.key)}
                sx={{
                  width: `${100 / pitCols}%`,
                  pb: 2,
                  cursor: onTogglePitStat ? 'pointer' : 'default',
                  transition: 'opacity 0.15s',
                  '&:hover': onTogglePitStat ? { opacity: 0.6 } : {},
                }}
              >
                <StatItem
                  label={def.label}
                  value={def.format(def.getValue(pitchingStats))}
                  playerId={player.id}
                  leaderCategory={def.leaderCategory}
                  leaders={pitLeaders}
                  palette={palette}
                  large={large}
                  poop={def.poop}
                />
              </Box>
            ))}
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
  const [hitLeaders, setHitLeaders] = useState<Map<string, number[]>>(new Map())
  const [pitLeaders, setPitLeaders] = useState<Map<string, number[]>>(new Map())
  const [loadingStats, setLoadingStats] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [palette, setPalette] = useState<Palette>(DEFAULT_PALETTE)
  const [season, setSeason] = useState(CURRENT_SEASON)
  const [availableSeasons, setAvailableSeasons] = useState<number[]>([CURRENT_SEASON])
  const [seasonTeams, setSeasonTeams] = useState<Map<number, string[]>>(new Map())
  const [fullscreen, setFullscreen] = useState(false)
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [selectedHitStats, setSelectedHitStats] = useState<string[]>(DEFAULT_HIT_STATS)
  const [selectedPitStats, setSelectedPitStats] = useState<string[]>(DEFAULT_PIT_STATS)

  const cardRef = useRef<HTMLDivElement>(null)

  const toggleHitStat = useCallback((key: string) => {
    setSelectedHitStats(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }, [])

  const togglePitStat = useCallback((key: string) => {
    setSelectedPitStats(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }, [])

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
      setHitLeaders(new Map())
      setPitLeaders(new Map())
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
        hitting ? fetchLeaderIds(HIT_LEADER_CATS, 'hitting', s) : Promise.resolve(new Map<string, number[]>()),
        pitching ? fetchLeaderIds(PIT_LEADER_CATS, 'pitching', s) : Promise.resolve(new Map<string, number[]>()),
      ])
      setHitLeaders(hLeaders)
      setPitLeaders(pLeaders)
    } finally {
      setLoadingStats(false)
      setRefreshing(false)
    }
  }, [])

  const selectPlayer = useCallback(async (p: Player) => {
    setDropdownOpen(false)
    setQuery(p.fullName)
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
    setPalette(teamPalette(resolved.currentTeam?.id))
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

  const handleDownload = useCallback(async (mode: 'centered' | 'tiktok') => {
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

      const out = document.createElement('canvas')
      out.width = 1080
      out.height = 1920
      const ctx = out.getContext('2d')!
      ctx.fillStyle = palette.bg
      ctx.fillRect(0, 0, 1080, 1920)

      let dx: number, dy: number, dw: number, dh: number
      if (mode === 'tiktok') {
        // Scale to full width, snap to top so the person can stand below and point up
        const scale = (1080 * 0.92) / captured.width
        dw = captured.width * scale
        dh = captured.height * scale
        dx = (1080 - dw) / 2
        dy = 60
      } else {
        // Centered
        const scale = Math.min((1080 * 0.92) / captured.width, (1920 * 0.85) / captured.height)
        dw = captured.width * scale
        dh = captured.height * scale
        dx = (1080 - dw) / 2
        dy = (1920 - dh) / 2
      }
      ctx.drawImage(captured, dx, dy, dw, dh)

      const suffix = mode === 'tiktok' ? '-tiktok' : ''
      const link = document.createElement('a')
      link.download = `${player?.fullName ?? 'player'}-${season}-stats${suffix}.png`
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

  const cardInnerProps = {
    player: player!,
    hittingStats,
    pitchingStats,
    hitLeaders,
    pitLeaders,
    palette,
    season,
    teamDisplay,
    selectedHitStats,
    selectedPitStats,
    onToggleHitStat: toggleHitStat,
    onTogglePitStat: togglePitStat,
  }

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
            <CardInner {...cardInnerProps} large onToggleHitStat={undefined} onTogglePitStat={undefined} />
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
            <CardInner {...cardInnerProps} />
          </Paper>

          {/* External links */}
          <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, mt: 2 }}>
            <Typography
              component="a"
              href={`https://www.baseball-reference.com/search/search.fcgi?search=${encodeURIComponent(player!.fullName)}`}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ fontSize: '0.8rem', color: 'text.secondary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
            >
              Baseball Reference ↗
            </Typography>
            <Typography
              component="a"
              href={`https://baseballsavant.mlb.com/savant-player/${player!.fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${player!.id}`}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ fontSize: '0.8rem', color: 'text.secondary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
            >
              Baseball Savant ↗
            </Typography>
          </Box>

          {/* Controls */}
          <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mt: 2, flexWrap: 'wrap' }}>
            <Button variant="outlined" startIcon={<Shuffle />} size="small" onClick={() => setPalette(randomPalette())}>
              Colors
            </Button>

            {hittingStats && (
              <StatPicker
                defs={HITTING_STAT_DEFS}
                selected={selectedHitStats}
                onToggle={toggleHitStat}
                label="Batting"
              />
            )}

            {pitchingStats && (
              <StatPicker
                defs={PITCHING_STAT_DEFS}
                selected={selectedPitStats}
                onToggle={togglePitStat}
                label="Pitching"
              />
            )}

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
              <MenuItem onClick={() => handleDownload('centered')}>
                Download centered
              </MenuItem>
              <MenuItem onClick={() => handleDownload('tiktok')}>
                Download for TikTok
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

import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  Box, TextField, Typography, CircularProgress, Paper,
  InputAdornment, List, ListItemButton, ListItemText,
  Divider, ClickAwayListener, Button, Menu, MenuItem, Select, FormControl,
  Popover, FormGroup, FormControlLabel, Checkbox,
  ToggleButtonGroup, ToggleButton,
} from '@mui/material'
import { Search, Shuffle, FileDownload } from '@mui/icons-material'
import html2canvas from 'html2canvas'

// ─── Types ───────────────────────────────────────────────────────────────────


type RankMode = 'all' | 'top20' | 'none'

interface Player {
  id: number
  fullName: string
  active: boolean
  primaryPosition: { code: string; name: string; type: string; abbreviation?: string }
  currentTeam?: { id: number; name: string }
  currentAge?: number
  primaryNumber?: string
}

interface Team {
  id: number
  name: string
  abbreviation: string
  division?: { name: string }
  league?: { name: string }
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

function statCols(n: number): number {
  if (n <= 3) return n || 1
  for (let cols = 3; cols >= 2; cols--) {
    if (n % cols !== 1) return cols
  }
  return 3
}

// ─── Player stat definitions ──────────────────────────────────────────────────

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

// ─── Team stat definitions ────────────────────────────────────────────────────

const TEAM_HITTING_DEFS: StatDef[] = [
  { key: 'avg', label: 'AVG', getValue: s => s.avg,          format: fmt, leaderCategory: '', defaultSelected: true  },
  { key: 'obp', label: 'OBP', getValue: s => s.obp,          format: fmt, leaderCategory: '', defaultSelected: true  },
  { key: 'slg', label: 'SLG', getValue: s => s.slg,          format: fmt, leaderCategory: '', defaultSelected: false },
  { key: 'ops', label: 'OPS', getValue: s => s.ops,          format: fmt, leaderCategory: '', defaultSelected: true  },
  { key: 'r',   label: 'R',   getValue: s => s.runs,         format: fmt, leaderCategory: '', defaultSelected: true  },
  { key: 'hr',  label: 'HR',  getValue: s => s.homeRuns,     format: fmt, leaderCategory: '', defaultSelected: true  },
  { key: 'h',   label: 'H',   getValue: s => s.hits,         format: fmt, leaderCategory: '', defaultSelected: false },
  { key: 'sb',  label: 'SB',  getValue: s => s.stolenBases,  format: fmt, leaderCategory: '', defaultSelected: false },
  { key: 'bb',  label: 'BB',  getValue: s => s.baseOnBalls,  format: fmt, leaderCategory: '', defaultSelected: false },
  { key: 'k',   label: 'K',   getValue: s => s.strikeOuts,   format: fmt, leaderCategory: '', defaultSelected: false, poop: true },
]

const TEAM_PITCHING_DEFS: StatDef[] = [
  { key: 'era',  label: 'ERA',  getValue: s => s.era,             format: fmt,                    leaderCategory: '', defaultSelected: true  },
  { key: 'whip', label: 'WHIP', getValue: s => s.whip,            format: fmt,                    leaderCategory: '', defaultSelected: true  },
  { key: 'k',    label: 'K',    getValue: s => s.strikeOuts,      format: fmt,                    leaderCategory: '', defaultSelected: true  },
  { key: 'bb',   label: 'BB',   getValue: s => s.baseOnBalls,     format: fmt,                    leaderCategory: '', defaultSelected: false },
  { key: 'hr',   label: 'HR',   getValue: s => s.homeRuns,        format: fmt,                    leaderCategory: '', defaultSelected: false },
  { key: 'sv',   label: 'SV',   getValue: s => s.saves,           format: fmt,                    leaderCategory: '', defaultSelected: false },
  { key: 'h',    label: 'H',    getValue: s => s.hits,            format: fmt,                    leaderCategory: '', defaultSelected: false },
  { key: 'k9',   label: 'K/9',  getValue: s => s.strikeoutsPer9Inn, format: v => fmtDecimal(v, 2), leaderCategory: '', defaultSelected: false },
]

const HIT_LEADER_CATS = [...new Set(HITTING_STAT_DEFS.map(d => d.leaderCategory).filter(Boolean))]
const PIT_LEADER_CATS = [...new Set(PITCHING_STAT_DEFS.map(d => d.leaderCategory).filter(Boolean))]
const DEFAULT_HIT_STATS = HITTING_STAT_DEFS.filter(d => d.defaultSelected).map(d => d.key)
const DEFAULT_PIT_STATS = PITCHING_STAT_DEFS.filter(d => d.defaultSelected).map(d => d.key)
const DEFAULT_TEAM_HIT_STATS = TEAM_HITTING_DEFS.filter(d => d.defaultSelected).map(d => d.key)
const DEFAULT_TEAM_PIT_STATS = TEAM_PITCHING_DEFS.filter(d => d.defaultSelected).map(d => d.key)

// ─── Constants ───────────────────────────────────────────────────────────────

const CURRENT_SEASON = new Date().getFullYear()
const TEAM_SEASONS = Array.from({ length: CURRENT_SEASON - 2000 + 1 }, (_, i) => CURRENT_SEASON - i)

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

// BBRef uses different codes for some franchises
const BBREF_ABBR: Record<string, string> = {
  CWS: 'CHW', WSH: 'WSN', SF: 'SFG', KC: 'KCR', SD: 'SDP', TB: 'TBR',
}

// ─── Palette ─────────────────────────────────────────────────────────────────

const TEAM_BG: Record<number, string> = {
  108: '#BA0021',  // LAA
  109: '#A71930',  // ARI
  110: '#DF4601',  // BAL
  111: '#BD3039',  // BOS
  112: '#0E3386',  // CHC
  113: '#C6011F',  // CIN
  114: '#00385D',  // CLE
  115: '#33006F',  // COL
  116: '#0C2340',  // DET
  117: '#002D62',  // HOU
  118: '#004687',  // KC
  119: '#005A9C',  // LAD
  120: '#AB0003',  // WSH
  121: '#002D72',  // NYM
  133: '#003831',  // OAK
  134: '#27251F',  // PIT
  135: '#2F241D',  // SD
  136: '#005C5C',  // SEA
  137: '#27251F',  // SF
  138: '#C41E3A',  // STL
  139: '#092C5C',  // TB
  140: '#003278',  // TEX
  141: '#134A8E',  // TOR
  142: '#002B5C',  // MIN
  143: '#E81828',  // PHI
  144: '#CE1141',  // ATL
  145: '#27251F',  // CWS
  146: '#272525',  // MIA
  147: '#132448',  // NYY
  158: '#12284B',  // MIL
}

function teamPalette(teamId?: number): Palette {
  const bg = (teamId != null && TEAM_BG[teamId]) || DEFAULT_PALETTE.bg
  return { bg, text: '#ffffff', sub: 'rgba(255,255,255,0.62)', rank: 'rgba(255,255,255,0.42)', divider: 'rgba(255,255,255,0.16)' }
}

function randomPalette(): Palette {
  const hue = Math.floor(Math.random() * 360)
  const sat = 65 + Math.floor(Math.random() * 30)
  const dark = Math.random() > 0.3
  const lightness = dark ? 10 + Math.floor(Math.random() * 28) : 62 + Math.floor(Math.random() * 20)
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
  const r = await fetch(`https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}&sportId=1&hydrate=currentTeam`)
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
    const q = new URLSearchParams({ leaderCategories: categories.join(','), sportId: '1', season: String(season), limit: '300', statGroup })
    const r = await fetch(`https://statsapi.mlb.com/api/v1/stats/leaders?${q}`)
    const d = await r.json()
    const map = new Map<string, number[]>()
    for (const cat of d.leagueLeaders ?? []) {
      map.set(cat.leaderCategory, (cat.leaders ?? []).map((l: any) => Number(l.person?.id)).filter(Boolean))
    }
    return map
  } catch {
    return new Map()
  }
}

async function fetchAllTeams(): Promise<Team[]> {
  const r = await fetch('https://statsapi.mlb.com/api/v1/teams?sportId=1&activeStatus=Active')
  const d = await r.json()
  return (d.teams ?? []).sort((a: Team, b: Team) => a.name.localeCompare(b.name))
}

async function fetchTeamStats(id: number, group: 'hitting' | 'pitching', season: number) {
  const r = await fetch(`https://statsapi.mlb.com/api/v1/teams/${id}/stats?stats=season&group=${group}&season=${season}`)
  const d = await r.json()
  return d.stats?.[0]?.splits?.[0]?.stat ?? null
}

// ─── Stat item ───────────────────────────────────────────────────────────────

interface StatItemProps {
  label: string
  value: string
  playerId: number
  leaderCategory: string
  leaders: Map<string, number[]>
  palette: Palette
  rankMode: RankMode
  large?: boolean
  poop?: boolean
}

function StatItem({ label, value, playerId, leaderCategory, leaders, palette, rankMode, large, poop }: StatItemProps) {
  const ids = leaderCategory ? (leaders.get(leaderCategory) ?? []) : []
  const rank = ids.indexOf(playerId)
  const inTop5 = rank !== -1 && rank < 5
  const inTop20 = rank !== -1

  let badge = ''
  if (rankMode !== 'none' && rank !== -1) {
    const showBadge = rankMode === 'all' || (rankMode === 'top20' && rank < 20)
    if (showBadge) badge = inTop5 ? `${poop ? '💩' : '🔥'} #${rank + 1}` : `#${rank + 1}`
  }

  return (
    <Box sx={{ textAlign: 'center' }}>
      <Typography sx={{
        color: palette.text, fontWeight: 800,
        fontSize: large ? { xs: '0.8rem', sm: '0.9rem' } : { xs: '0.7rem', sm: '0.8rem' },
        textTransform: 'uppercase', letterSpacing: 1.5, opacity: 0.7, mb: 0.4,
      }}>
        {label}
      </Typography>
      <Typography sx={{
        color: palette.text, fontWeight: 700,
        fontSize: large ? { xs: '2rem', sm: '2.4rem' } : { xs: '1.75rem', sm: '2.1rem' },
        lineHeight: 1, letterSpacing: '-0.5px',
      }}>
        {value}
      </Typography>
      <Typography sx={{ color: palette.rank, fontSize: '0.63rem', fontWeight: 700, mt: 0.4, height: '1rem', letterSpacing: 0.5 }}>
        {badge}
      </Typography>
    </Box>
  )
}

// ─── Stat picker ─────────────────────────────────────────────────────────────

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
                control={<Checkbox size="small" checked={selected.includes(def.key)} onChange={() => onToggle(def.key)} sx={{ py: 0.3 }} />}
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

// ─── Stat grid (shared) ───────────────────────────────────────────────────────

interface StatGridProps {
  defs: StatDef[]
  stats: any
  selected: string[]
  palette: Palette
  rankMode: RankMode
  playerId: number
  leaders: Map<string, number[]>
  season: number
  label: string
  large?: boolean
  onToggle?: (key: string) => void
  mt?: number
}

function StatGrid({ defs, stats, selected, palette, rankMode, playerId, leaders, season, label, large, onToggle, mt }: StatGridProps) {
  const visible = defs.filter(d => selected.includes(d.key))
  if (!stats || visible.length === 0) return null
  const cols = statCols(visible.length)
  return (
    <Box sx={{ borderTop: `1px solid ${palette.divider}`, pt: 2.5, mt: mt ?? 0 }}>
      <Typography sx={{ textAlign: 'center', color: palette.rank, fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2.5, mb: 2 }}>
        {season} {label}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
        {visible.map(def => (
          <Box
            key={def.key}
            onClick={() => onToggle?.(def.key)}
            sx={{
              width: `${100 / cols}%`, pb: 2,
              cursor: onToggle ? 'pointer' : 'default',
              transition: 'opacity 0.15s',
              '&:hover': onToggle ? { opacity: 0.6 } : {},
            }}
          >
            <StatItem
              label={def.label}
              value={def.format(def.getValue(stats))}
              playerId={playerId}
              leaderCategory={def.leaderCategory}
              leaders={leaders}
              palette={palette}
              rankMode={rankMode}
              large={large}
              poop={def.poop}
            />
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// ─── Player card inner ────────────────────────────────────────────────────────

interface CardInnerProps {
  player: Player
  hittingStats: any
  pitchingStats: any
  hitLeaders: Map<string, number[]>
  pitLeaders: Map<string, number[]>
  palette: Palette
  season: number
  teamDisplay: string
  rankMode: RankMode
  showPosition: boolean
  showTeam: boolean
  showAge: boolean
  showNumber: boolean
  large?: boolean
  selectedHitStats: string[]
  selectedPitStats: string[]
  onToggleHitStat?: (key: string) => void
  onTogglePitStat?: (key: string) => void
}

function CardInner({ player, hittingStats, pitchingStats, hitLeaders, pitLeaders, palette, season, teamDisplay, rankMode, showPosition, showTeam, showAge, showNumber, large, selectedHitStats, selectedPitStats, onToggleHitStat, onTogglePitStat }: CardInnerProps) {
  const photoSize = large ? 200 : 155
  const hasHitting = hittingStats && HITTING_STAT_DEFS.some(d => selectedHitStats.includes(d.key))

  const subtitleParts: string[] = []
  if (showPosition && player.primaryPosition?.name) subtitleParts.push(player.primaryPosition.name)
  if (showTeam && teamDisplay) subtitleParts.push(teamDisplay)
  if (showAge && player.currentAge != null) subtitleParts.push(`Age ${player.currentAge}`)
  if (showNumber && player.primaryNumber) subtitleParts.push(`#${player.primaryNumber}`)

  return (
    <>
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
          backgroundPosition: 'center 20%',
        }} />
      </Box>

      <Typography sx={{
        textAlign: 'center', color: palette.text, fontWeight: 800,
        fontSize: large ? { xs: '2rem', sm: '2.4rem' } : { xs: '1.6rem', sm: '2rem' },
        lineHeight: 1.1, letterSpacing: '-0.3px', mb: 0.5,
      }}>
        {player.fullName}
      </Typography>

      {subtitleParts.length > 0 ? (
        <Typography sx={{
          textAlign: 'center', color: palette.sub,
          fontSize: large ? '1rem' : { xs: '0.82rem', sm: '0.9rem' },
          fontWeight: 500, mb: 3.5,
        }}>
          {subtitleParts.join(' · ')}
        </Typography>
      ) : <Box sx={{ mb: 3.5 }} />}

      <StatGrid
        defs={HITTING_STAT_DEFS} stats={hittingStats} selected={selectedHitStats}
        palette={palette} rankMode={rankMode} playerId={player.id} leaders={hitLeaders}
        season={season} label="Hitting" large={large} onToggle={onToggleHitStat}
      />
      <StatGrid
        defs={PITCHING_STAT_DEFS} stats={pitchingStats} selected={selectedPitStats}
        palette={palette} rankMode={rankMode} playerId={player.id} leaders={pitLeaders}
        season={season} label="Pitching" large={large} onToggle={onTogglePitStat}
        mt={hasHitting ? 1 : 0}
      />
    </>
  )
}

// ─── Team card inner ──────────────────────────────────────────────────────────

interface TeamCardInnerProps {
  team: Team
  hittingStats: any
  pitchingStats: any
  palette: Palette
  season: number
  large?: boolean
  selectedHitStats: string[]
  selectedPitStats: string[]
  onToggleHitStat?: (key: string) => void
  onTogglePitStat?: (key: string) => void
}

function TeamCardInner({ team, hittingStats, pitchingStats, palette, season, large, selectedHitStats, selectedPitStats, onToggleHitStat, onTogglePitStat }: TeamCardInnerProps) {
  const abbr = team.abbreviation
  const logoSize = large ? 160 : 120

  const wins = pitchingStats?.wins ?? hittingStats?.wins
  const losses = pitchingStats?.losses ?? hittingStats?.losses
  const gp = wins != null && losses != null ? wins + losses : null
  const pct = gp ? (wins / gp).toFixed(3).replace(/^0/, '') : null

  const divisionLabel = team.division?.name
    ? team.division.name.replace(/American League |National League /, '')
    : ''
  const leagueShort = team.league?.name?.includes('American') ? 'AL' : team.league?.name?.includes('National') ? 'NL' : ''
  const subtitle = [leagueShort, divisionLabel].filter(Boolean).join(' · ')

  const hasHitting = hittingStats && TEAM_HITTING_DEFS.some(d => selectedHitStats.includes(d.key))

  return (
    <>
      {/* Logo circle */}
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2.5 }}>
        <Box sx={{
          width: logoSize,
          height: logoSize,
          borderRadius: '50%',
          border: `3px solid ${palette.text}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'rgba(255,255,255,0.1)',
          flexShrink: 0,
        }}>
          <Typography sx={{
            color: palette.text, fontWeight: 900,
            fontSize: Math.round(logoSize * 0.34),
            letterSpacing: '-1px', lineHeight: 1,
          }}>
            {abbr}
          </Typography>
        </Box>
      </Box>

      <Typography sx={{
        textAlign: 'center', color: palette.text, fontWeight: 800,
        fontSize: large ? { xs: '1.8rem', sm: '2.2rem' } : { xs: '1.4rem', sm: '1.8rem' },
        lineHeight: 1.1, letterSpacing: '-0.3px', mb: 0.5,
      }}>
        {team.name}
      </Typography>

      {subtitle && (
        <Typography sx={{
          textAlign: 'center', color: palette.sub,
          fontSize: large ? '1rem' : '0.85rem',
          fontWeight: 500, mb: 2.5,
        }}>
          {subtitle}
        </Typography>
      )}

      {/* Record */}
      {wins != null && losses != null && (
        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 4, mb: 2.5 }}>
          {[['W', wins], ['L', losses], ...(pct ? [['PCT', pct]] : [])].map(([lbl, val]) => (
            <Box key={lbl as string} sx={{ textAlign: 'center' }}>
              <Typography sx={{ color: palette.rank, fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2, mb: 0.5 }}>
                {lbl}
              </Typography>
              <Typography sx={{ color: palette.text, fontWeight: 800, fontSize: large ? '2.2rem' : '1.8rem', lineHeight: 1 }}>
                {val}
              </Typography>
            </Box>
          ))}
        </Box>
      )}

      <StatGrid
        defs={TEAM_HITTING_DEFS} stats={hittingStats} selected={selectedHitStats}
        palette={palette} rankMode="none" playerId={0} leaders={new Map()}
        season={season} label="Hitting" large={large} onToggle={onToggleHitStat}
      />
      <StatGrid
        defs={TEAM_PITCHING_DEFS} stats={pitchingStats} selected={selectedPitStats}
        palette={palette} rankMode="none" playerId={0} leaders={new Map()}
        season={season} label="Pitching" large={large} onToggle={onTogglePitStat}
        mt={hasHitting ? 1 : 0}
      />
    </>
  )
}

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, color: 'text.disabled', mb: 1 }}>
      {children}
    </Typography>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MlbStats() {
  // Search
  const [query, setQuery] = useState('')
  const [playerResults, setPlayerResults] = useState<Player[]>([])
  const [teamResults, setTeamResults] = useState<Team[]>([])
  const [allTeams, setAllTeams] = useState<Team[]>([])
  const [searching, setSearching] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // Player state
  const [player, setPlayer] = useState<Player | null>(null)
  const [hittingStats, setHittingStats] = useState<any>(null)
  const [pitchingStats, setPitchingStats] = useState<any>(null)
  const [hitLeaders, setHitLeaders] = useState<Map<string, number[]>>(new Map())
  const [pitLeaders, setPitLeaders] = useState<Map<string, number[]>>(new Map())
  const [availableSeasons, setAvailableSeasons] = useState<number[]>([CURRENT_SEASON])
  const [seasonTeams, setSeasonTeams] = useState<Map<number, string[]>>(new Map())
  const [selectedHitStats, setSelectedHitStats] = useState<string[]>(DEFAULT_HIT_STATS)
  const [selectedPitStats, setSelectedPitStats] = useState<string[]>(DEFAULT_PIT_STATS)

  // Team state
  const [team, setTeam] = useState<Team | null>(null)
  const [teamHitting, setTeamHitting] = useState<any>(null)
  const [teamPitching, setTeamPitching] = useState<any>(null)
  const [selectedTeamHitStats, setSelectedTeamHitStats] = useState<string[]>(DEFAULT_TEAM_HIT_STATS)
  const [selectedTeamPitStats, setSelectedTeamPitStats] = useState<string[]>(DEFAULT_TEAM_PIT_STATS)

  // Shared
  const [loadingStats, setLoadingStats] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [palette, setPalette] = useState<Palette>(DEFAULT_PALETTE)
  const [season, setSeason] = useState(CURRENT_SEASON)
  const [fullscreen, setFullscreen] = useState(false)
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null)
  const [downloading, setDownloading] = useState(false)

  // Player options
  const [rankMode, setRankMode] = useState<RankMode>('all')
  const [showPosition, setShowPosition] = useState(true)
  const [showTeam, setShowTeam] = useState(true)
  const [showAge, setShowAge] = useState(false)
  const [showNumber, setShowNumber] = useState(false)

  const cardRef = useRef<HTMLDivElement>(null)

  const toggleHitStat = useCallback((key: string) => setSelectedHitStats(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]), [])
  const togglePitStat = useCallback((key: string) => setSelectedPitStats(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]), [])
  const toggleTeamHitStat = useCallback((key: string) => setSelectedTeamHitStats(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]), [])
  const toggleTeamPitStat = useCallback((key: string) => setSelectedTeamPitStats(prev => prev.filter(k => k !== key).concat(prev.includes(key) ? [] : [key])), [])

  // Load all teams on mount
  useEffect(() => {
    fetchAllTeams().then(setAllTeams).catch(() => {})
  }, [])

  // Combined search: instant team filter + debounced player search
  useEffect(() => {
    if (query.length < 1) {
      setPlayerResults([])
      setTeamResults([])
      setDropdownOpen(false)
      return
    }

    // Team filter (instant, client-side)
    const q = query.toLowerCase()
    const teamMatches = allTeams.filter(t =>
      t.name.toLowerCase().includes(q) || t.abbreviation.toLowerCase().includes(q)
    ).slice(0, 5)
    setTeamResults(teamMatches)
    if (teamMatches.length > 0) setDropdownOpen(true)

    if (query.length < 2) {
      setPlayerResults([])
      return
    }

    // Player search (debounced)
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const players = await searchPlayers(query)
        const playerSlice = players.slice(0, 6)
        setPlayerResults(playerSlice)
        if (playerSlice.length > 0 || teamMatches.length > 0) setDropdownOpen(true)
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [query, allTeams])

  const loadStats = useCallback(async (p: Player, s: number, initial = true) => {
    if (initial) { setLoadingStats(true); setHittingStats(null); setPitchingStats(null); setHitLeaders(new Map()); setPitLeaders(new Map()) }
    else setRefreshing(true)
    try {
      const isPitcher = p.primaryPosition?.code === '1'
      const isTwoWay = p.primaryPosition?.type === 'Two-Way Player'
      const [hitting, pitching] = await Promise.all([
        (!isPitcher || isTwoWay) ? fetchStats(p.id, 'hitting', s) : null,
        (isPitcher || isTwoWay) ? fetchStats(p.id, 'pitching', s) : null,
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

  const loadTeamStats = useCallback(async (t: Team, s: number, initial = true) => {
    if (initial) { setLoadingStats(true); setTeamHitting(null); setTeamPitching(null) }
    else setRefreshing(true)
    try {
      const [hitting, pitching] = await Promise.all([
        fetchTeamStats(t.id, 'hitting', s),
        fetchTeamStats(t.id, 'pitching', s),
      ])
      setTeamHitting(hitting)
      setTeamPitching(pitching)
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
    const groups: Array<'hitting' | 'pitching'> = isTwoWay ? ['hitting', 'pitching'] : isPitcher ? ['pitching'] : ['hitting']
    const [details, careerData] = await Promise.all([fetchPlayerDetails(p.id), fetchCareerData(p.id, groups)])
    const resolved = details ?? p
    setPalette(teamPalette(resolved.currentTeam?.id))
    const { seasons, teamsBySeason } = careerData
    const latestSeason = seasons[0] ?? CURRENT_SEASON
    setPlayer(resolved)
    setTeam(null)
    setAvailableSeasons(seasons.length ? seasons : [CURRENT_SEASON])
    setSeasonTeams(teamsBySeason)
    setSeason(latestSeason)
    await loadStats(resolved, latestSeason)
  }, [loadStats])

  const selectTeam = useCallback(async (t: Team) => {
    setDropdownOpen(false)
    setQuery(t.name)
    setPalette(teamPalette(t.id))
    setTeam(t)
    setPlayer(null)
    setSeason(CURRENT_SEASON)
    setAvailableSeasons(TEAM_SEASONS)
    await loadTeamStats(t, CURRENT_SEASON)
  }, [loadTeamStats])

  const handleSeasonChange = useCallback((s: number) => {
    setSeason(s)
    if (player) loadStats(player, s, false)
    else if (team) loadTeamStats(team, s, false)
  }, [player, team, loadStats, loadTeamStats])

  const handleDownload = useCallback(async (mode: 'centered' | 'tiktok') => {
    if (!cardRef.current) return
    setExportAnchor(null)
    setDownloading(true)
    try {
      const captured = await html2canvas(cardRef.current, { useCORS: true, scale: 2, logging: false, backgroundColor: null })
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
  }, [palette.bg, player, team, season])

  const hasStats = !loadingStats && (
    (player && (hittingStats || pitchingStats)) ||
    (team && (teamHitting || teamPitching))
  )
  const teamDisplay = seasonTeams.get(season)?.join('/') ?? player?.currentTeam?.name ?? ''
  const currentAvailableSeasons = player ? availableSeasons : TEAM_SEASONS

  const playerCardProps = player ? {
    player, hittingStats, pitchingStats, hitLeaders, pitLeaders, palette, season, teamDisplay,
    rankMode, showPosition, showTeam, showAge, showNumber, selectedHitStats, selectedPitStats,
    onToggleHitStat: toggleHitStat, onTogglePitStat: togglePitStat,
  } : null

  const teamCardProps = team ? {
    team, hittingStats: teamHitting, pitchingStats: teamPitching, palette, season,
    selectedHitStats: selectedTeamHitStats, selectedPitStats: selectedTeamPitStats,
    onToggleHitStat: toggleTeamHitStat, onTogglePitStat: toggleTeamPitStat,
  } : null

  return (
    <Box sx={{ maxWidth: 600, mx: 'auto' }}>

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

      {/* Search */}
      <ClickAwayListener onClickAway={() => setDropdownOpen(false)}>
        <Box sx={{ position: 'relative', mb: 3 }}>
          <TextField
            fullWidth
            placeholder="Search player or team…"
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
          {dropdownOpen && (
            <Paper elevation={6} sx={{ position: 'absolute', width: '100%', zIndex: 20, mt: 0.5, borderRadius: 2, overflow: 'hidden' }}>
              <List dense disablePadding>
                {playerResults.map((p, i) => {
                  const pos = p.primaryPosition?.abbreviation ?? p.primaryPosition?.name ?? ''
                  const teamAbbr = p.currentTeam?.id != null ? TEAM_ABBR[p.currentTeam.id] : undefined
                  const sub = [pos, teamAbbr].filter(Boolean).join(' | ')
                  return (
                    <React.Fragment key={`p-${p.id}`}>
                      {i > 0 && <Divider />}
                      <ListItemButton onClick={() => selectPlayer(p)} sx={{ gap: 1.5, py: 1 }}>
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
                  const abbr = t.abbreviation
                  const divShort = t.division?.name?.replace(/American League |National League /, '') ?? ''
                  const leagueShort = t.league?.name?.includes('American') ? 'AL' : t.league?.name?.includes('National') ? 'NL' : ''
                  const sub = [leagueShort, divShort].filter(Boolean).join(' · ')
                  return (
                    <React.Fragment key={`t-${t.id}`}>
                      {i > 0 && <Divider />}
                      <ListItemButton onClick={() => selectTeam(t)} sx={{ gap: 1.5, py: 1 }}>
                        <Box sx={{
                          width: 48, height: 48, borderRadius: 1.5, flexShrink: 0,
                          bgcolor: TEAM_BG[t.id] ?? 'grey.700',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Typography sx={{ color: '#fff', fontWeight: 900, fontSize: abbr.length > 2 ? '0.65rem' : '0.8rem', letterSpacing: '-0.5px' }}>
                            {abbr}
                          </Typography>
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

      {loadingStats && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>}

      {hasStats && (
        <>
          {/* Card */}
          <Paper ref={cardRef} elevation={4} sx={{
            borderRadius: 4, overflow: 'hidden', background: palette.bg,
            transition: 'background 0.45s ease', p: { xs: 3, sm: 4 },
          }}>
            {playerCardProps && <CardInner {...playerCardProps} />}
            {teamCardProps && <TeamCardInner {...teamCardProps} />}
          </Paper>

          {/* Action controls */}
          <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mt: 2.5, flexWrap: 'wrap' }}>
            <Button variant="outlined" startIcon={<Shuffle />} size="small" onClick={() => setPalette(randomPalette())}>
              Colors
            </Button>
            <FormControl size="small">
              <Select value={season} onChange={e => handleSeasonChange(Number(e.target.value))} sx={{ fontSize: '0.8rem' }}>
                {currentAvailableSeasons.map(y => <MenuItem key={y} value={y}>{y}</MenuItem>)}
              </Select>
            </FormControl>
            <Button variant="outlined" startIcon={<FileDownload />} size="small" disabled={downloading} onClick={e => setExportAnchor(e.currentTarget)}>
              {downloading ? 'Saving…' : 'Export'}
            </Button>
            <Menu anchorEl={exportAnchor} open={Boolean(exportAnchor)} onClose={() => setExportAnchor(null)}>
              <MenuItem onClick={() => { setFullscreen(true); setExportAnchor(null) }}>View fullscreen</MenuItem>
              <MenuItem onClick={() => handleDownload('centered')}>Download centered</MenuItem>
              <MenuItem onClick={() => handleDownload('tiktok')}>Download for TikTok</MenuItem>
            </Menu>
          </Box>

          {/* Options */}
          <Box sx={{ mt: 3 }}>
            <SectionLabel>Options</SectionLabel>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: player ? 2 : 0 }}>
                {(hittingStats || teamHitting) && (
                  <StatPicker
                    defs={player ? HITTING_STAT_DEFS : TEAM_HITTING_DEFS}
                    selected={player ? selectedHitStats : selectedTeamHitStats}
                    onToggle={player ? toggleHitStat : toggleTeamHitStat}
                    label="Batting"
                  />
                )}
                {(pitchingStats || teamPitching) && (
                  <StatPicker
                    defs={player ? PITCHING_STAT_DEFS : TEAM_PITCHING_DEFS}
                    selected={player ? selectedPitStats : selectedTeamPitStats}
                    onToggle={player ? togglePitStat : toggleTeamPitStat}
                    label="Pitching"
                  />
                )}
              </Box>

              {player && (
                <>
                  <Box sx={{ mb: 2 }}>
                    <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', mb: 0.75, fontWeight: 500 }}>League rank</Typography>
                    <ToggleButtonGroup value={rankMode} exclusive onChange={(_, v) => { if (v) setRankMode(v) }} size="small">
                      <ToggleButton value="all" sx={{ fontSize: '0.72rem', px: 1.5, py: 0.4 }}>All</ToggleButton>
                      <ToggleButton value="top20" sx={{ fontSize: '0.72rem', px: 1.5, py: 0.4 }}>Top 20</ToggleButton>
                      <ToggleButton value="none" sx={{ fontSize: '0.72rem', px: 1.5, py: 0.4 }}>None</ToggleButton>
                    </ToggleButtonGroup>
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', mb: 0.75, fontWeight: 500 }}>Show under portrait</Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {[
                        { label: 'Position', val: showPosition, set: setShowPosition },
                        { label: 'Team', val: showTeam, set: setShowTeam },
                        { label: 'Age', val: showAge, set: setShowAge },
                        { label: 'Number', val: showNumber, set: setShowNumber },
                      ].map(({ label, val, set }) => (
                        <ToggleButton key={label} value={label} selected={val} onChange={() => set(v => !v)} size="small" sx={{ fontSize: '0.72rem', px: 1.5, py: 0.4 }}>
                          {label}
                        </ToggleButton>
                      ))}
                    </Box>
                  </Box>
                </>
              )}
            </Paper>
          </Box>

          {/* Links */}
          <Box sx={{ mt: 2.5 }}>
            <SectionLabel>Links</SectionLabel>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              {player && (<>
                <Typography component="a"
                  href={`https://www.baseball-reference.com/search/search.fcgi?search=${encodeURIComponent(player.fullName)}`}
                  target="_blank" rel="noopener noreferrer"
                  sx={{ fontSize: '0.82rem', color: 'text.secondary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                  Baseball Reference ↗
                </Typography>
                <Typography component="a"
                  href={`https://baseballsavant.mlb.com/savant-player/${player.fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${player.id}`}
                  target="_blank" rel="noopener noreferrer"
                  sx={{ fontSize: '0.82rem', color: 'text.secondary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                  Baseball Savant ↗
                </Typography>
              </>)}
              {team && (() => {
                const abbr = team.abbreviation
                const bbrefAbbr = BBREF_ABBR[abbr] ?? abbr
                return (<>
                  <Typography component="a"
                    href={`https://www.baseball-reference.com/teams/${bbrefAbbr}/${season}.shtml`}
                    target="_blank" rel="noopener noreferrer"
                    sx={{ fontSize: '0.82rem', color: 'text.secondary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                    Baseball Reference ↗
                  </Typography>
                  <Typography component="a"
                    href={`https://baseballsavant.mlb.com/team/${team.id}`}
                    target="_blank" rel="noopener noreferrer"
                    sx={{ fontSize: '0.82rem', color: 'text.secondary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                    Baseball Savant ↗
                  </Typography>
                </>)
              })()}
            </Box>
          </Box>
        </>
      )}

      {!loadingStats && (player && !hittingStats && !pitchingStats || team && !teamHitting && !teamPitching) && (
        <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
          No {season} season stats available.
        </Typography>
      )}
    </Box>
  )
}

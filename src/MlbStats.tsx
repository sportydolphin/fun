import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  Box, Typography, CircularProgress, Paper,
  List, ListItemButton, Divider, ClickAwayListener,
  Popover, Menu, MenuItem,
} from '@mui/material'
import { Search, Shuffle, FileDownload, KeyboardArrowDown } from '@mui/icons-material'
import html2canvas from 'html2canvas'

// ─── Design token ─────────────────────────────────────────────────────────────

const ACCENT = '#60a5fa'

// ─── Types ───────────────────────────────────────────────────────────────────


type RankMode = 'all' | 'top5' | 'none'

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
  lowerIsBetter?: boolean
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
  { key: 'avg', label: 'AVG', getValue: s => s.avg,          format: fmt, leaderCategory: 'avg', defaultSelected: true  },
  { key: 'obp', label: 'OBP', getValue: s => s.obp,          format: fmt, leaderCategory: 'obp', defaultSelected: true  },
  { key: 'slg', label: 'SLG', getValue: s => s.slg,          format: fmt, leaderCategory: 'slg', defaultSelected: false },
  { key: 'ops', label: 'OPS', getValue: s => s.ops,          format: fmt, leaderCategory: 'ops', defaultSelected: true  },
  { key: 'r',   label: 'R',   getValue: s => s.runs,         format: fmt, leaderCategory: 'r',   defaultSelected: true  },
  { key: 'hr',  label: 'HR',  getValue: s => s.homeRuns,     format: fmt, leaderCategory: 'hr',  defaultSelected: true  },
  { key: 'h',   label: 'H',   getValue: s => s.hits,         format: fmt, leaderCategory: 'h',   defaultSelected: false },
  { key: 'sb',  label: 'SB',  getValue: s => s.stolenBases,  format: fmt, leaderCategory: 'sb',  defaultSelected: false },
  { key: 'bb',  label: 'BB',  getValue: s => s.baseOnBalls,  format: fmt, leaderCategory: 'bb',  defaultSelected: false },
  { key: 'k',   label: 'K',   getValue: s => s.strikeOuts,   format: fmt, leaderCategory: 'k',   defaultSelected: false, poop: true },
]

const TEAM_PITCHING_DEFS: StatDef[] = [
  { key: 'era',  label: 'ERA',  getValue: s => s.era,               format: fmt,                    leaderCategory: 'era',  defaultSelected: true,  lowerIsBetter: true  },
  { key: 'whip', label: 'WHIP', getValue: s => s.whip,              format: fmt,                    leaderCategory: 'whip', defaultSelected: true,  lowerIsBetter: true  },
  { key: 'k',    label: 'K',    getValue: s => s.strikeOuts,        format: fmt,                    leaderCategory: 'pk',   defaultSelected: true   },
  { key: 'bb',   label: 'BB',   getValue: s => s.baseOnBalls,       format: fmt,                    leaderCategory: 'pbb',  defaultSelected: false, lowerIsBetter: true  },
  { key: 'hr',   label: 'HR',   getValue: s => s.homeRuns,          format: fmt,                    leaderCategory: 'phr',  defaultSelected: false, lowerIsBetter: true  },
  { key: 'sv',   label: 'SV',   getValue: s => s.saves,             format: fmt,                    leaderCategory: 'sv',   defaultSelected: false  },
  { key: 'h',    label: 'H',    getValue: s => s.hits,              format: fmt,                    leaderCategory: 'ph',   defaultSelected: false, lowerIsBetter: true  },
  { key: 'k9',   label: 'K/9',  getValue: s => s.strikeoutsPer9Inn, format: v => fmtDecimal(v, 2),  leaderCategory: 'k9',   defaultSelected: false  },
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

async function fetchTeamRankings(group: 'hitting' | 'pitching', season: number, defs: StatDef[]): Promise<Map<string, number[]>> {
  try {
    const teamIds = Object.keys(TEAM_ABBR).map(Number)
    const results = await Promise.all(
      teamIds.map(id =>
        fetch(`https://statsapi.mlb.com/api/v1/teams/${id}/stats?stats=season&group=${group}&season=${season}`)
          .then(r => r.json())
          .then(d => ({ id, stat: d.stats?.[0]?.splits?.[0]?.stat ?? null }))
          .catch(() => ({ id, stat: null }))
      )
    )
    const valid = results.filter(r => r.stat != null)
    const map = new Map<string, number[]>()
    for (const def of defs) {
      if (!def.leaderCategory) continue
      const entries = valid
        .map(r => ({ id: r.id, val: def.getValue(r.stat) }))
        .filter(x => x.val != null && x.val !== '' && !isNaN(Number(x.val)))
      const asc = def.lowerIsBetter || def.poop
      entries.sort((a, b) => asc ? Number(a.val) - Number(b.val) : Number(b.val) - Number(a.val))
      map.set(def.leaderCategory, entries.map(x => x.id))
    }
    return map
  } catch {
    return new Map()
  }
}

// ─── Visualization data ───────────────────────────────────────────────────────

interface TeamSummary {
  id: number
  abbr: string
  ops: number
  era: number
  rs: number
  ra: number
  wins: number
  losses: number
}

async function fetchTeamSummaryData(season: number): Promise<TeamSummary[]> {
  const teamIds = Object.keys(TEAM_ABBR).map(Number)
  const results = await Promise.all(
    teamIds.map(id =>
      Promise.all([
        fetchTeamStats(id, 'hitting', season).catch(() => null),
        fetchTeamStats(id, 'pitching', season).catch(() => null),
      ]).then(([hitting, pitching]) => ({ id, hitting, pitching }))
    )
  )
  return results
    .map(r => ({
      id: r.id,
      abbr: TEAM_ABBR[r.id],
      ops: r.hitting?.ops != null ? Number(r.hitting.ops) : NaN,
      era: r.pitching?.era != null ? Number(r.pitching.era) : NaN,
      rs: r.hitting?.runs != null ? Number(r.hitting.runs) : NaN,
      ra: r.pitching?.runs != null ? Number(r.pitching.runs) : NaN,
      wins: r.pitching?.wins != null ? Number(r.pitching.wins) : NaN,
      losses: r.pitching?.losses != null ? Number(r.pitching.losses) : NaN,
    }))
    .filter(p => p.abbr)
}

// ─── UI primitives ────────────────────────────────────────────────────────────

function SegControl({ options, value, onChange }: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <Box sx={{
      display: 'inline-flex',
      bgcolor: 'action.hover',
      borderRadius: 999,
      p: '3px',
      gap: 0,
    }}>
      {options.map(opt => (
        <Box
          key={opt.value}
          onClick={() => onChange(opt.value)}
          sx={{
            px: 1.75, py: 0.5,
            borderRadius: 999,
            cursor: 'pointer',
            fontSize: '0.75rem',
            fontWeight: 600,
            lineHeight: 1.4,
            transition: 'all 0.15s',
            userSelect: 'none',
            bgcolor: value === opt.value ? ACCENT : 'transparent',
            color: value === opt.value ? '#fff' : 'text.secondary',
            '&:hover': value !== opt.value ? { color: 'text.primary' } : {},
          }}
        >
          {opt.label}
        </Box>
      ))}
    </Box>
  )
}

function PillChip({ label, selected, onChange }: {
  label: string; selected: boolean; onChange: () => void
}) {
  return (
    <Box
      onClick={onChange}
      sx={{
        px: 1.75, py: 0.45,
        borderRadius: 999,
        border: '1.5px solid',
        borderColor: selected ? ACCENT : 'divider',
        bgcolor: selected ? `${ACCENT}20` : 'transparent',
        color: selected ? ACCENT : 'text.secondary',
        fontSize: '0.75rem',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.15s',
        userSelect: 'none',
        '&:hover': !selected ? { borderColor: ACCENT, color: ACCENT } : {},
      }}
    >
      {label}
    </Box>
  )
}

// Shared pill button style for action row
const pillActionSx = {
  display: 'inline-flex', alignItems: 'center', gap: 0.6,
  px: 2, py: 0.75,
  borderRadius: 999,
  border: '1.5px solid',
  borderColor: 'divider',
  cursor: 'pointer',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: 'text.secondary',
  transition: 'all 0.15s',
  userSelect: 'none' as const,
  '&:hover': { borderColor: ACCENT, color: ACCENT },
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
  const bottomN = ids.length > 0 && ids.length <= 30 ? 5 : 20
  const inBottom = rank !== -1 && ids.length > 0 && rank >= ids.length - bottomN

  let badge = ''
  if (rankMode !== 'none' && rank !== -1) {
    const showBadge = rankMode === 'all' || (rankMode === 'top5' && (inTop5 || inBottom))
    if (showBadge) {
      if (inTop5) badge = `${poop ? '💩' : '🔥'} #${rank + 1}`
      else if (inBottom) badge = `${poop ? '🔥' : '💩'} #${rank + 1}`
      else badge = `#${rank + 1}`
    }
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
      <Box
        onClick={e => setAnchor(e.currentTarget as HTMLElement)}
        sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.4,
          px: 1.75, py: 0.5,
          borderRadius: 999,
          border: '1.5px solid',
          borderColor: anchor ? ACCENT : 'divider',
          cursor: 'pointer',
          fontSize: '0.75rem',
          fontWeight: 600,
          color: anchor ? ACCENT : 'text.secondary',
          transition: 'all 0.15s',
          userSelect: 'none',
          '&:hover': { borderColor: ACCENT, color: ACCENT },
        }}
      >
        {label}
        <KeyboardArrowDown sx={{ fontSize: '0.9rem', mt: '1px' }} />
      </Box>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        PaperProps={{ sx: { borderRadius: 2.5, p: 1.5, mt: 0.75, maxWidth: 210, boxShadow: '0 8px 32px rgba(0,0,0,0.14)' } }}
      >
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {defs.map(def => (
            <PillChip
              key={def.key}
              label={def.label}
              selected={selected.includes(def.key)}
              onChange={() => onToggle(def.key)}
            />
          ))}
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
  rankMode: RankMode
  hitLeaders: Map<string, number[]>
  pitLeaders: Map<string, number[]>
  large?: boolean
  selectedHitStats: string[]
  selectedPitStats: string[]
  onToggleHitStat?: (key: string) => void
  onTogglePitStat?: (key: string) => void
}

function TeamCardInner({ team, hittingStats, pitchingStats, palette, season, rankMode, hitLeaders, pitLeaders, large, selectedHitStats, selectedPitStats, onToggleHitStat, onTogglePitStat }: TeamCardInnerProps) {
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
      {/* Team logo */}
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2.5 }}>
        <Box sx={{
          width: logoSize, height: logoSize,
          borderRadius: '50%',
          border: `3px solid ${palette.text}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: '#fff',
          overflow: 'hidden',
          flexShrink: 0,
        }}>
          <Box
            component="img"
            src={`https://www.mlbstatic.com/team-logos/${team.id}.svg`}
            alt={team.abbreviation}
            crossOrigin="anonymous"
            sx={{ width: '82%', height: '82%', objectFit: 'contain' }}
          />
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
        palette={palette} rankMode={rankMode} playerId={team.id} leaders={hitLeaders}
        season={season} label="Hitting" large={large} onToggle={onToggleHitStat}
      />
      <StatGrid
        defs={TEAM_PITCHING_DEFS} stats={pitchingStats} selected={selectedPitStats}
        palette={palette} rankMode={rankMode} playerId={team.id} leaders={pitLeaders}
        season={season} label="Pitching" large={large} onToggle={onTogglePitStat}
        mt={hasHitting ? 1 : 0}
      />
    </>
  )
}

// ─── Shared chart helpers ─────────────────────────────────────────────────────

function useChartTooltip<T>(boxRef: React.RefObject<HTMLDivElement>) {
  const [hovered, setHovered] = useState<T | null>(null)
  const [tipPos, setTipPos] = useState({ x: 0, y: 0, flip: false })
  const onEnter = (item: T, e: React.MouseEvent) => {
    const rect = boxRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    setTipPos({ x, y: e.clientY - rect.top, flip: x > rect.width * 0.58 })
    setHovered(item)
  }
  return { hovered, setHovered, tipPos, onEnter }
}

function ChartTooltip({ tipPos, children }: { tipPos: { x: number; y: number; flip: boolean }; children: React.ReactNode }) {
  return (
    <Box sx={{
      position: 'absolute',
      left: tipPos.flip ? undefined : tipPos.x + 14,
      right: tipPos.flip ? `calc(100% - ${tipPos.x}px + 14px)` : undefined,
      top: tipPos.y - 36,
      bgcolor: 'background.paper',
      border: '1px solid', borderColor: 'divider',
      borderRadius: 2, px: 1.5, py: 1,
      pointerEvents: 'none',
      boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
      zIndex: 10, minWidth: 148,
    }}>
      {children}
    </Box>
  )
}

function TeamDot({ team, x, y, hovered, onEnter, onLeave }: {
  team: TeamSummary; x: number; y: number; hovered: boolean
  onEnter: (t: TeamSummary, e: React.MouseEvent) => void
  onLeave: () => void
}) {
  const color = TEAM_BG[team.id] ?? '#555'
  return (
    <g transform={`translate(${x},${y})`} style={{ cursor: 'default' }}
      onMouseEnter={e => onEnter(team, e)} onMouseLeave={onLeave}>
      <circle r={hovered ? 18 : 14} fill={color}
        stroke={hovered ? '#fff' : 'rgba(255,255,255,0.7)'}
        strokeWidth={hovered ? 2.5 : 1.5}
        style={{ transition: 'r 0.1s' }} />
      <text textAnchor="middle" dy="3.5" fill="#fff"
        fontSize={team.abbr.length > 2 ? 6.5 : 7.5} fontWeight={800}
        style={{ pointerEvents: 'none' }}>{team.abbr}</text>
    </g>
  )
}

// ─── ERA vs OPS Scatter Plot ─────────────────────────────────────────────────

function TeamEraOpsPlot({ data, nameMap }: { data: TeamSummary[]; nameMap: Map<number, string> }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const { hovered, setHovered, tipPos, onEnter } = useChartTooltip<TeamSummary & { name: string }>(boxRef as React.RefObject<HTMLDivElement>)

  const pts = data.filter(d => !isNaN(d.ops) && !isNaN(d.era))
  if (pts.length === 0) return null

  const W = 560, H = 400
  const m = { t: 32, r: 24, b: 52, l: 54 }
  const iW = W - m.l - m.r, iH = H - m.t - m.b

  const opsVals = pts.map(d => d.ops), eraVals = pts.map(d => d.era)
  const opsPad = (Math.max(...opsVals) - Math.min(...opsVals)) * 0.16
  const eraPad = (Math.max(...eraVals) - Math.min(...eraVals)) * 0.16
  const xMin = Math.min(...opsVals) - opsPad, xMax = Math.max(...opsVals) + opsPad
  const yMin = Math.min(...eraVals) - eraPad, yMax = Math.max(...eraVals) + eraPad
  const avgOps = opsVals.reduce((a, b) => a + b, 0) / opsVals.length
  const avgEra = eraVals.reduce((a, b) => a + b, 0) / eraVals.length

  // Lower ERA → lower y value → higher on screen (correct: good pitching at top)
  const sx = (v: number) => m.l + ((v - xMin) / (xMax - xMin)) * iW
  const sy = (v: number) => m.t + ((v - yMin) / (yMax - yMin)) * iH
  const ax = sx(avgOps), ay = sy(avgEra)

  const xTicks = Array.from({ length: 6 }, (_, i) => xMin + (i / 5) * (xMax - xMin))
  const yTicks = Array.from({ length: 6 }, (_, i) => yMin + (i / 5) * (yMax - yMin))

  return (
    <Box ref={boxRef} sx={{ position: 'relative', userSelect: 'none' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseLeave={() => setHovered(null)}>
        {/* Quadrant fills — top = low ERA = good pitching */}
        <rect x={m.l} y={m.t} width={ax - m.l} height={ay - m.t} fill="#3b82f6" fillOpacity={0.05} />
        <rect x={ax} y={m.t} width={m.l + iW - ax} height={ay - m.t} fill="#22c55e" fillOpacity={0.07} />
        <rect x={m.l} y={ay} width={ax - m.l} height={m.t + iH - ay} fill="#ef4444" fillOpacity={0.05} />
        <rect x={ax} y={ay} width={m.l + iW - ax} height={m.t + iH - ay} fill="#f59e0b" fillOpacity={0.05} />

        {xTicks.map((v, i) => <line key={i} x1={sx(v)} y1={m.t} x2={sx(v)} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.07} strokeWidth={1} />)}
        {yTicks.map((v, i) => <line key={i} x1={m.l} y1={sy(v)} x2={m.l + iW} y2={sy(v)} stroke="currentColor" strokeOpacity={0.07} strokeWidth={1} />)}

        <line x1={ax} y1={m.t} x2={ax} y2={m.t + iH} stroke="#60a5fa" strokeWidth={1.5} strokeDasharray="6 4" strokeOpacity={0.55} />
        <line x1={m.l} y1={ay} x2={m.l + iW} y2={ay} stroke="#60a5fa" strokeWidth={1.5} strokeDasharray="6 4" strokeOpacity={0.55} />
        <text x={ax + 4} y={m.t + 11} fill="#60a5fa" fillOpacity={0.65} fontSize={8} fontWeight={700}>avg OPS</text>
        <text x={m.l + iW - 4} y={ay - 5} fill="#60a5fa" fillOpacity={0.65} fontSize={8} fontWeight={700} textAnchor="end">avg ERA</text>

        <text x={m.l + 7} y={m.t + 17} fill="#3b82f6" fillOpacity={0.4} fontSize={9} fontWeight={800}>PITCHING-LED</text>
        <text x={m.l + iW - 7} y={m.t + 17} fill="#22c55e" fillOpacity={0.5} fontSize={9} fontWeight={800} textAnchor="end">ELITE</text>
        <text x={m.l + 7} y={m.t + iH - 9} fill="#ef4444" fillOpacity={0.4} fontSize={9} fontWeight={800}>REBUILDING</text>
        <text x={m.l + iW - 7} y={m.t + iH - 9} fill="#f59e0b" fillOpacity={0.45} fontSize={9} fontWeight={800} textAnchor="end">OFFENSE-LED</text>

        <line x1={m.l} y1={m.t} x2={m.l} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.18} strokeWidth={1.5} />
        <line x1={m.l} y1={m.t + iH} x2={m.l + iW} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.18} strokeWidth={1.5} />

        {xTicks.map((v, i) => (
          <g key={i}>
            <line x1={sx(v)} y1={m.t + iH} x2={sx(v)} y2={m.t + iH + 5} stroke="currentColor" strokeOpacity={0.25} strokeWidth={1} />
            <text x={sx(v)} y={m.t + iH + 16} textAnchor="middle" fill="currentColor" fillOpacity={0.45} fontSize={9}>{v.toFixed(3)}</text>
          </g>
        ))}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={m.l - 5} y1={sy(v)} x2={m.l} y2={sy(v)} stroke="currentColor" strokeOpacity={0.25} strokeWidth={1} />
            <text x={m.l - 8} y={sy(v) + 3.5} textAnchor="end" fill="currentColor" fillOpacity={0.45} fontSize={9}>{v.toFixed(2)}</text>
          </g>
        ))}

        <text x={m.l + iW / 2} y={H - 5} textAnchor="middle" fill="currentColor" fillOpacity={0.5} fontSize={10} fontWeight={700} letterSpacing="1.2">OPS (offense) →</text>
        <text transform={`translate(13,${m.t + iH / 2}) rotate(-90)`} textAnchor="middle" fill="currentColor" fillOpacity={0.5} fontSize={10} fontWeight={700} letterSpacing="1.2">ERA (lower = better ↑)</text>

        {pts.map(team => (
          <TeamDot key={team.id} team={team} x={sx(team.ops)} y={sy(team.era)}
            hovered={hovered?.id === team.id}
            onEnter={(t, e) => onEnter({ ...t, name: nameMap.get(t.id) ?? t.abbr }, e)}
            onLeave={() => setHovered(null)} />
        ))}
      </svg>

      {hovered && (
        <ChartTooltip tipPos={tipPos}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: TEAM_BG[hovered.id] ?? 'grey.500', flexShrink: 0 }} />
            <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', lineHeight: 1.2 }}>{hovered.name}</Typography>
          </Box>
          <Typography sx={{ fontSize: '0.73rem', color: 'text.secondary' }}>OPS <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{hovered.ops.toFixed(3)}</Box></Typography>
          <Typography sx={{ fontSize: '0.73rem', color: 'text.secondary' }}>ERA <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{hovered.era.toFixed(2)}</Box></Typography>
        </ChartTooltip>
      )}
    </Box>
  )
}

// ─── Win% vs Run Differential (Pythagorean) ───────────────────────────────────

function TeamWinRDPlot({ data, nameMap }: { data: TeamSummary[]; nameMap: Map<number, string> }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const { hovered, setHovered, tipPos, onEnter } = useChartTooltip<TeamSummary & { name: string; winPct: number; rd: number; pythPct: number }>(boxRef as React.RefObject<HTMLDivElement>)

  const pts = data.filter(d => !isNaN(d.rs) && !isNaN(d.ra) && !isNaN(d.wins) && !isNaN(d.losses) && d.wins + d.losses > 0)
    .map(d => ({ ...d, rd: d.rs - d.ra, winPct: d.wins / (d.wins + d.losses) }))
  if (pts.length === 0) return null

  const W = 560, H = 400
  const m = { t: 32, r: 24, b: 52, l: 54 }
  const iW = W - m.l - m.r, iH = H - m.t - m.b

  const rdVals = pts.map(d => d.rd), wpVals = pts.map(d => d.winPct)
  const rdPad = (Math.max(...rdVals) - Math.min(...rdVals)) * 0.14
  const wpPad = (Math.max(...wpVals) - Math.min(...wpVals)) * 0.14
  const xMin = Math.min(...rdVals) - rdPad, xMax = Math.max(...rdVals) + rdPad
  const yMin = Math.max(0.25, Math.min(...wpVals) - wpPad)
  const yMax = Math.min(0.75, Math.max(...wpVals) + wpPad)

  // Lower win% → lower on screen (conventional orientation)
  const sx = (v: number) => m.l + ((v - xMin) / (xMax - xMin)) * iW
  const sy = (v: number) => m.t + ((yMax - v) / (yMax - yMin)) * iH
  const x0 = sx(0), y500 = sy(0.5)

  // Pythagorean expected W% curve: W% = RS^1.83 / (RS^1.83 + RA^1.83)
  // Use average RS as the baseline, vary RA = avgRS - RD
  const avgRS = pts.reduce((s, d) => s + d.rs, 0) / pts.length
  const pyth = (rd: number) => {
    const ra = avgRS - rd
    if (ra <= 0) return 0.99
    const e = 1.83
    return Math.pow(avgRS, e) / (Math.pow(avgRS, e) + Math.pow(ra, e))
  }
  const curvePts = Array.from({ length: 61 }, (_, i) => {
    const rd = xMin + (i / 60) * (xMax - xMin)
    const wp = pyth(rd)
    return wp >= yMin && wp <= yMax ? `${sx(rd).toFixed(1)},${sy(wp).toFixed(1)}` : null
  }).filter(Boolean).join(' ')

  // Per-team Pythagorean expected W% (using their actual RS)
  const withPyth = pts.map(d => {
    const ra = d.rs - d.rd
    const e = 1.83
    const pythPct = ra > 0 ? Math.pow(d.rs, e) / (Math.pow(d.rs, e) + Math.pow(ra, e)) : 0.99
    return { ...d, pythPct, name: nameMap.get(d.id) ?? d.abbr }
  })

  const xTicks = Array.from({ length: 7 }, (_, i) => xMin + (i / 6) * (xMax - xMin))
  const yTicks = Array.from({ length: 6 }, (_, i) => yMin + (i / 5) * (yMax - yMin))

  return (
    <Box ref={boxRef} sx={{ position: 'relative', userSelect: 'none' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseLeave={() => setHovered(null)}>
        {/* Half shading: above .500 vs below */}
        <rect x={x0} y={m.t} width={m.l + iW - x0} height={m.t + iH - m.t} fill="#22c55e" fillOpacity={0.04} />
        <rect x={m.l} y={m.t} width={x0 - m.l} height={m.t + iH - m.t} fill="#ef4444" fillOpacity={0.04} />

        {xTicks.map((v, i) => <line key={i} x1={sx(v)} y1={m.t} x2={sx(v)} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.07} strokeWidth={1} />)}
        {yTicks.map((v, i) => <line key={i} x1={m.l} y1={sy(v)} x2={m.l + iW} y2={sy(v)} stroke="currentColor" strokeOpacity={0.07} strokeWidth={1} />)}

        {/* RD=0 and W%=.500 references */}
        <line x1={x0} y1={m.t} x2={x0} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.2} strokeWidth={1.5} strokeDasharray="5 3" />
        <line x1={m.l} y1={y500} x2={m.l + iW} y2={y500} stroke="currentColor" strokeOpacity={0.2} strokeWidth={1.5} strokeDasharray="5 3" />
        <text x={x0 + 4} y={m.t + 11} fill="currentColor" fillOpacity={0.35} fontSize={8} fontWeight={700}>RD = 0</text>
        <text x={m.l + iW - 4} y={y500 - 5} fill="currentColor" fillOpacity={0.35} fontSize={8} fontWeight={700} textAnchor="end">.500</text>

        {/* Pythagorean expectation curve */}
        <polyline points={curvePts} fill="none" stroke="#60a5fa" strokeWidth={2} strokeDasharray="6 3" strokeOpacity={0.7} strokeLinejoin="round" />
        {/* Curve label near right edge */}
        {(() => {
          const labelRD = xMax * 0.72
          const labelWP = pyth(labelRD)
          if (labelWP < yMin || labelWP > yMax) return null
          return <text x={sx(labelRD)} y={sy(labelWP) - 7} fill="#60a5fa" fillOpacity={0.8} fontSize={8} fontWeight={700} textAnchor="middle">Pythagorean expected</text>
        })()}

        {/* Axes */}
        <line x1={m.l} y1={m.t} x2={m.l} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.18} strokeWidth={1.5} />
        <line x1={m.l} y1={m.t + iH} x2={m.l + iW} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.18} strokeWidth={1.5} />

        {xTicks.map((v, i) => (
          <g key={i}>
            <line x1={sx(v)} y1={m.t + iH} x2={sx(v)} y2={m.t + iH + 5} stroke="currentColor" strokeOpacity={0.25} strokeWidth={1} />
            <text x={sx(v)} y={m.t + iH + 16} textAnchor="middle" fill="currentColor" fillOpacity={0.45} fontSize={9}>{v > 0 ? `+${Math.round(v)}` : Math.round(v)}</text>
          </g>
        ))}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={m.l - 5} y1={sy(v)} x2={m.l} y2={sy(v)} stroke="currentColor" strokeOpacity={0.25} strokeWidth={1} />
            <text x={m.l - 8} y={sy(v) + 3.5} textAnchor="end" fill="currentColor" fillOpacity={0.45} fontSize={9}>{v.toFixed(3)}</text>
          </g>
        ))}

        <text x={m.l + iW / 2} y={H - 5} textAnchor="middle" fill="currentColor" fillOpacity={0.5} fontSize={10} fontWeight={700} letterSpacing="1.2">Run Differential (RS − RA) →</text>
        <text transform={`translate(13,${m.t + iH / 2}) rotate(-90)`} textAnchor="middle" fill="currentColor" fillOpacity={0.5} fontSize={10} fontWeight={700} letterSpacing="1.2">Win %</text>

        {withPyth.map(team => (
          <TeamDot key={team.id} team={team} x={sx(team.rd)} y={sy(team.winPct)}
            hovered={hovered?.id === team.id}
            onEnter={(t, e) => onEnter(withPyth.find(w => w.id === t.id)!, e)}
            onLeave={() => setHovered(null)} />
        ))}
      </svg>

      {hovered && (
        <ChartTooltip tipPos={tipPos}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: TEAM_BG[hovered.id] ?? 'grey.500', flexShrink: 0 }} />
            <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', lineHeight: 1.2 }}>{hovered.name}</Typography>
          </Box>
          <Typography sx={{ fontSize: '0.73rem', color: 'text.secondary' }}>Record <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{hovered.wins}–{hovered.losses}</Box></Typography>
          <Typography sx={{ fontSize: '0.73rem', color: 'text.secondary' }}>Win% <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{hovered.winPct.toFixed(3)}</Box></Typography>
          <Typography sx={{ fontSize: '0.73rem', color: 'text.secondary' }}>Expected <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{hovered.pythPct.toFixed(3)}</Box></Typography>
          <Typography sx={{ fontSize: '0.73rem', color: hovered.winPct >= hovered.pythPct ? 'success.main' : 'error.main', fontWeight: 700 }}>
            {hovered.winPct >= hovered.pythPct ? '+' : ''}{(hovered.winPct - hovered.pythPct).toFixed(3)} vs expected
          </Typography>
        </ChartTooltip>
      )}
    </Box>
  )
}

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{ fontSize: '0.63rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.8, color: 'text.disabled', mb: 1 }}>
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
  const [teamHitLeaders, setTeamHitLeaders] = useState<Map<string, number[]>>(new Map())
  const [teamPitLeaders, setTeamPitLeaders] = useState<Map<string, number[]>>(new Map())
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

  const [view, setView] = useState<'search' | 'viz'>('search')
  const [vizSeason, setVizSeason] = useState(CURRENT_SEASON)
  const [teamSummaries, setTeamSummaries] = useState<TeamSummary[]>([])
  const [loadingViz, setLoadingViz] = useState(false)
  const nameMap = useMemo(() => new Map(allTeams.map(t => [t.id, t.name])), [allTeams])

  const cardRef = useRef<HTMLDivElement>(null)

  const toggleHitStat = useCallback((key: string) => setSelectedHitStats(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]), [])
  const togglePitStat = useCallback((key: string) => setSelectedPitStats(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]), [])
  const toggleTeamHitStat = useCallback((key: string) => setSelectedTeamHitStats(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]), [])
  const toggleTeamPitStat = useCallback((key: string) => setSelectedTeamPitStats(prev => prev.filter(k => k !== key).concat(prev.includes(key) ? [] : [key])), [])

  // Load all teams on mount
  useEffect(() => {
    fetchAllTeams().then(setAllTeams).catch(() => {})
  }, [])

  // Load visualization data when switching to viz tab or changing season
  useEffect(() => {
    if (view !== 'viz') return
    setLoadingViz(true)
    setTeamSummaries([])
    fetchTeamSummaryData(vizSeason)
      .then(setTeamSummaries)
      .catch(() => {})
      .finally(() => setLoadingViz(false))
  }, [view, vizSeason])

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
    if (initial) { setLoadingStats(true); setTeamHitting(null); setTeamPitching(null); setTeamHitLeaders(new Map()); setTeamPitLeaders(new Map()) }
    else setRefreshing(true)
    try {
      const [hitting, pitching, hLeaders, pLeaders] = await Promise.all([
        fetchTeamStats(t.id, 'hitting', s),
        fetchTeamStats(t.id, 'pitching', s),
        fetchTeamRankings('hitting', s, TEAM_HITTING_DEFS),
        fetchTeamRankings('pitching', s, TEAM_PITCHING_DEFS),
      ])
      setTeamHitting(hitting)
      setTeamPitching(pitching)
      setTeamHitLeaders(hLeaders)
      setTeamPitLeaders(pLeaders)
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
      // Preload SVG images as data URLs so html2canvas can render them
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
    rankMode, hitLeaders: teamHitLeaders, pitLeaders: teamPitLeaders,
    selectedHitStats: selectedTeamHitStats, selectedPitStats: selectedTeamPitStats,
    onToggleHitStat: toggleTeamHitStat, onTogglePitStat: toggleTeamPitStat,
  } : null

  const linkPillSx = {
    display: 'inline-flex', alignItems: 'center',
    px: 1.75, py: 0.45,
    borderRadius: 999,
    border: '1.5px solid',
    borderColor: 'divider',
    color: 'text.secondary',
    fontSize: '0.75rem',
    fontWeight: 600,
    textDecoration: 'none',
    transition: 'all 0.15s',
    '&:hover': { borderColor: ACCENT, color: ACCENT },
  }

  return (
    <Box sx={{ maxWidth: 640, mx: 'auto' }}>

      {/* Tab switcher */}
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
        <SegControl
          options={[
            { value: 'search', label: 'Search' },
            { value: 'viz', label: 'Visualize' },
          ]}
          value={view}
          onChange={v => setView(v as 'search' | 'viz')}
        />
      </Box>

      {/* Visualizations tab */}
      {view === 'viz' && (
        <Box>
          {/* Season picker */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
            <Typography sx={{ fontWeight: 700, fontSize: '0.85rem', color: 'text.secondary' }}>
              All 30 teams · hover any bubble to inspect
            </Typography>
            <Box sx={{ ...pillActionSx, p: 0, '&:hover': { borderColor: ACCENT }, '&:focus-within': { borderColor: ACCENT } }}>
              <select value={vizSeason} onChange={e => setVizSeason(Number(e.target.value))}
                style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', color: 'inherit', padding: '6px 16px', borderRadius: 999, fontFamily: 'inherit' }}>
                {TEAM_SEASONS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </Box>
          </Box>

          {loadingViz && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress size={28} /></Box>}

          {!loadingViz && teamSummaries.length > 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Chart 1: ERA vs OPS */}
              <Box>
                <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px', mb: 0.25 }}>ERA vs OPS</Typography>
                <Typography sx={{ color: 'text.secondary', fontSize: '0.72rem', mb: 1.5 }}>
                  Pitching quality vs offensive output · top-right = elite
                </Typography>
                <Paper elevation={2} sx={{ borderRadius: 3, overflow: 'hidden', p: { xs: 1.5, sm: 2 } }}>
                  <TeamEraOpsPlot data={teamSummaries} nameMap={nameMap} />
                </Paper>
              </Box>

              {/* Chart 2: Win% vs Run Differential */}
              <Box>
                <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px', mb: 0.25 }}>Win% vs Run Differential</Typography>
                <Typography sx={{ color: 'text.secondary', fontSize: '0.72rem', mb: 1.5 }}>
                  Are teams over or underperforming their Pythagorean expected record? Above the curve = winning more than their run differential predicts.
                </Typography>
                <Paper elevation={2} sx={{ borderRadius: 3, overflow: 'hidden', p: { xs: 1.5, sm: 2 } }}>
                  <TeamWinRDPlot data={teamSummaries} nameMap={nameMap} />
                </Paper>
              </Box>
            </Box>
          )}

          {!loadingViz && teamSummaries.length === 0 && (
            <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>No team stats available for {vizSeason}.</Typography>
          )}
        </Box>
      )}

      {view === 'search' && <>

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

          {/* Action row */}
          <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mt: 2.5, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Colors */}
            <Box onClick={() => setPalette(randomPalette())} sx={pillActionSx}>
              <Shuffle sx={{ fontSize: '0.9rem' }} /> Colors
            </Box>

            {/* Season */}
            <Box sx={{
              ...pillActionSx,
              p: 0,
              '&:hover': { borderColor: ACCENT },
              '&:focus-within': { borderColor: ACCENT, color: ACCENT },
            }}>
              <select
                value={season}
                onChange={e => handleSeasonChange(Number(e.target.value))}
                style={{
                  border: 'none', outline: 'none', background: 'transparent',
                  fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                  color: 'inherit', padding: '6px 16px', borderRadius: 999,
                  fontFamily: 'inherit',
                }}
              >
                {currentAvailableSeasons.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </Box>

            {/* Export */}
            <Box
              onClick={!downloading ? (e => setExportAnchor(e.currentTarget as HTMLElement)) : undefined}
              sx={{ ...pillActionSx, opacity: downloading ? 0.55 : 1, cursor: downloading ? 'default' : 'pointer' }}
            >
              <FileDownload sx={{ fontSize: '0.9rem' }} />
              {downloading ? 'Saving…' : 'Export'}
              <KeyboardArrowDown sx={{ fontSize: '0.85rem' }} />
            </Box>
            <Menu
              anchorEl={exportAnchor}
              open={Boolean(exportAnchor)}
              onClose={() => setExportAnchor(null)}
              PaperProps={{ sx: { borderRadius: 2, mt: 0.5, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', minWidth: 180 } }}
            >
              <MenuItem onClick={() => { setFullscreen(true); setExportAnchor(null) }} sx={{ fontSize: '0.85rem' }}>View fullscreen</MenuItem>
              <MenuItem onClick={() => handleDownload('centered')} sx={{ fontSize: '0.85rem' }}>Download centered</MenuItem>
              <MenuItem onClick={() => handleDownload('tiktok')} sx={{ fontSize: '0.85rem' }}>Download for TikTok</MenuItem>
            </Menu>
          </Box>

          {/* Options */}
          <Box sx={{ mt: 3 }}>
            <SectionLabel>Options</SectionLabel>

            {/* Stat pickers */}
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 2 }}>
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

            {/* League rank */}
            <Box sx={{ mb: player ? 2 : 0 }}>
              <Typography sx={{ fontSize: '0.63rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.8, color: 'text.disabled', mb: 0.75 }}>
                League rank
              </Typography>
              <SegControl
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'top5', label: 'Top 5' },
                  { value: 'all', label: 'All' },
                ]}
                value={rankMode}
                onChange={v => setRankMode(v as RankMode)}
              />
            </Box>

            {/* Portrait toggles (player only) */}
            {player && (
              <Box>
                <Typography sx={{ fontSize: '0.63rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.8, color: 'text.disabled', mb: 0.75 }}>
                  Show under portrait
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
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
          </Box>

          {/* Links */}
          <Box sx={{ mt: 2.5, mb: 1 }}>
            <SectionLabel>Links</SectionLabel>
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
              {player && (<>
                <Box
                  component="a"
                  href={`https://www.baseball-reference.com/search/search.fcgi?search=${encodeURIComponent(player.fullName)}`}
                  target="_blank" rel="noopener noreferrer"
                  sx={linkPillSx}
                >
                  Baseball Ref ↗
                </Box>
                <Box
                  component="a"
                  href={`https://baseballsavant.mlb.com/savant-player/${player.fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${player.id}`}
                  target="_blank" rel="noopener noreferrer"
                  sx={linkPillSx}
                >
                  Baseball Savant ↗
                </Box>
              </>)}
              {team && (() => {
                const abbr = team.abbreviation
                const bbrefAbbr = BBREF_ABBR[abbr] ?? abbr
                return (<>
                  <Box
                    component="a"
                    href={`https://www.baseball-reference.com/teams/${bbrefAbbr}/${season}.shtml`}
                    target="_blank" rel="noopener noreferrer"
                    sx={linkPillSx}
                  >
                    Baseball Ref ↗
                  </Box>
                  <Box
                    component="a"
                    href={`https://baseballsavant.mlb.com/team/${team.id}`}
                    target="_blank" rel="noopener noreferrer"
                    sx={linkPillSx}
                  >
                    Baseball Savant ↗
                  </Box>
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

      </>}
    </Box>
  )
}

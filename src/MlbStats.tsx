import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  Box, Typography, CircularProgress, Paper,
  List, ListItemButton, Divider, ClickAwayListener,
  Popover, Menu, MenuItem, Tooltip,
} from '@mui/material'
import { Search, Shuffle, FileDownload, KeyboardArrowDown, InfoOutlined, OpenInFull, Close, Tune } from '@mui/icons-material'
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
  leaderLabel?: string        // Full name shown as leaderboard card header
  getValue: (stat: any) => any
  leaderValue?: (stat: any) => any  // Numeric value for leaderboard sort/filter when getValue returns a display string
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
  if (isNaN(n)) return '—'
  const s = n.toFixed(places)
  return s.startsWith('0.') ? s.slice(1) : s
}

// Format a numeric rate (strips leading zero for values < 1, e.g. 0.285 → .285)
const fmtR = (v: number, d: number) => { const s = v.toFixed(d); return s.startsWith('0.') ? s.slice(1) : s }

// Parse MLB innings-pitched string: "6.1" = 6⅓ innings, "6.2" = 6⅔ (the .N is outs, not a decimal fraction)
function parseIP(ip: any): number {
  const n = Number(ip)
  if (isNaN(n) || n < 0) return 0
  const whole = Math.floor(n)
  const outs = Math.round((n - whole) * 10)   // 0, 1, or 2 outs
  return whole + outs / 3
}

function statCols(n: number): number {
  if (n <= 3) return n || 1
  for (let cols = 3; cols >= 2; cols--) {
    if (n % cols !== 1) return cols
  }
  return 3
}

/**
 * Generate ≈target human-friendly tick values that span [dataMin, dataMax].
 * Steps are always "nice" numbers: 1, 2, 2.5, 5, or 10 × a power of 10.
 */
function niceTicks(dataMin: number, dataMax: number, target = 5): number[] {
  if (!isFinite(dataMin) || !isFinite(dataMax) || dataMin >= dataMax) {
    return isFinite(dataMin) ? [dataMin] : []
  }
  const range = dataMax - dataMin
  const roughStep = range / Math.max(2, target - 1)
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)))
  const norm = roughStep / mag
  let step: number
  if      (norm <= 1)   step = mag
  else if (norm <= 2)   step = 2 * mag
  else if (norm <= 2.5) step = 2.5 * mag
  else if (norm <= 5)   step = 5 * mag
  else                  step = 10 * mag

  const lo = Math.ceil(dataMin  / step - 1e-9) * step
  const hi = Math.floor(dataMax / step + 1e-9) * step
  const count = Math.round((hi - lo) / step)
  const ticks: number[] = []
  for (let i = 0; i <= count; i++) {
    ticks.push(parseFloat((lo + i * step).toPrecision(12)))
  }
  return ticks.length ? ticks : [dataMin, dataMax]
}

// ─── Player stat definitions ──────────────────────────────────────────────────

const HITTING_STAT_DEFS: StatDef[] = [
  { key: 'ab',   label: 'AB',   getValue: s => s.atBats,        format: fmt,  leaderCategory: '',                    defaultSelected: false },
  { key: 'h',    label: 'H',    leaderLabel: 'Hits',            getValue: s => s.hits,          format: fmt,  leaderCategory: 'hits',                defaultSelected: false },
  { key: 'avg',  label: 'AVG',  leaderLabel: 'Batting Average', getValue: s => s.avg,           format: fmt,  leaderCategory: 'battingAverage',      defaultSelected: true  },
  { key: '1b',   label: '1B',   getValue: s => s.hits != null ? s.hits - (s.doubles ?? 0) - (s.triples ?? 0) - (s.homeRuns ?? 0) : null, format: fmt, leaderCategory: '', defaultSelected: false },
  { key: '2b',   label: '2B',   leaderLabel: 'Doubles',         getValue: s => s.doubles,       format: fmt,  leaderCategory: 'doubles',             defaultSelected: false },
  { key: '3b',   label: '3B',   leaderLabel: 'Triples',         getValue: s => s.triples,       format: fmt,  leaderCategory: 'triples',             defaultSelected: false },
  { key: 'hr',   label: 'HR',   leaderLabel: 'Home Runs',       getValue: s => s.homeRuns,      format: fmt,  leaderCategory: 'homeRuns',            defaultSelected: true  },
  { key: 'rbi',  label: 'RBI',  leaderLabel: 'RBIs',            getValue: s => s.rbi,           format: fmt,  leaderCategory: 'runsBattedIn',        defaultSelected: true  },
  { key: 'obp',  label: 'OBP',  leaderLabel: 'On-Base %',       getValue: s => s.obp,           format: fmt,  leaderCategory: 'onBasePercentage',    defaultSelected: false },
  { key: 'slg',  label: 'SLG',  leaderLabel: 'Slugging %',      getValue: s => s.slg,           format: fmt,  leaderCategory: 'sluggingPercentage',  defaultSelected: false },
  { key: 'ops',  label: 'OPS',  getValue: s => s.ops,           format: fmt,  leaderCategory: 'onBasePlusSlugging',  defaultSelected: true  },
  { key: 'k',    label: 'K',    leaderLabel: 'Strikeouts',      getValue: s => s.strikeOuts,    format: fmt,  leaderCategory: 'strikeouts',          defaultSelected: false, poop: true },
  { key: 'bb',   label: 'BB',   leaderLabel: 'Walks',           getValue: s => s.baseOnBalls,   format: fmt,  leaderCategory: 'walks',               defaultSelected: false },
  { key: 'sb',   label: 'SB',   leaderLabel: 'Stolen Bases',    getValue: s => s.stolenBases,   format: fmt,  leaderCategory: 'stolenBases',         defaultSelected: false },
  { key: 'cs',   label: 'CS',   getValue: s => s.caughtStealing, format: fmt, leaderCategory: '',                    defaultSelected: false, poop: true },
]

const PITCHING_STAT_DEFS: StatDef[] = [
  { key: 'wl',   label: 'W-L',  leaderLabel: 'Wins',              getValue: s => s.wins != null ? `${s.wins}-${s.losses ?? 0}` : null, leaderValue: s => s.wins != null ? Number(s.wins) : null, format: v => v ?? '—', leaderCategory: 'wins', defaultSelected: true  },
  { key: 'era',  label: 'ERA',  leaderLabel: 'ERA',               getValue: s => s.era,              format: fmt,                   leaderCategory: 'earnedRunAverage',             defaultSelected: true,  lowerIsBetter: true },
  { key: 'g',    label: 'G',    getValue: s => s.gamesPlayed,      format: fmt,                   leaderCategory: '',                             defaultSelected: false },
  { key: 'gs',   label: 'GS',   getValue: s => s.gamesStarted,     format: fmt,                   leaderCategory: '',                             defaultSelected: false },
  { key: 'ip',   label: 'IP',   leaderLabel: 'Innings Pitched',   getValue: s => s.inningsPitched,   format: fmt,                   leaderCategory: 'inningsPitched',               defaultSelected: true  },
  { key: 'whip', label: 'WHIP', leaderLabel: 'WHIP',              getValue: s => s.whip,             format: fmt,                   leaderCategory: 'walksAndHitsPerInningPitched',  defaultSelected: true,  lowerIsBetter: true },
  { key: 'sv',   label: 'SV',   leaderLabel: 'Saves',             getValue: s => s.saves,            format: fmt,                   leaderCategory: 'saves',                        defaultSelected: false },
  { key: 'h',    label: 'H',    getValue: s => s.hits,             format: fmt,                   leaderCategory: '',                             defaultSelected: false },
  { key: 'r',    label: 'R',    getValue: s => s.runs,             format: fmt,                   leaderCategory: '',                             defaultSelected: false },
  { key: 'er',   label: 'ER',   getValue: s => s.earnedRuns,       format: fmt,                   leaderCategory: '',                             defaultSelected: false },
  { key: 'hr',   label: 'HR',   getValue: s => s.homeRuns,         format: fmt,                   leaderCategory: '',                             defaultSelected: false },
  { key: 'bb',   label: 'BB',   getValue: s => s.baseOnBalls,      format: fmt,                   leaderCategory: '',                             defaultSelected: false },
  { key: 'k',    label: 'K',    leaderLabel: 'Strikeouts',        getValue: s => s.strikeOuts,       format: fmt,                   leaderCategory: 'strikeouts',                   defaultSelected: true  },
  { key: 'so9',  label: 'SO/9', leaderLabel: 'K per 9',          getValue: s => s.strikeoutsPer9Inn, format: v => fmtDecimal(v, 2), leaderCategory: 'strikeoutsPer9Inn',            defaultSelected: false },
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

const DEFAULT_HIT_STATS = HITTING_STAT_DEFS.filter(d => d.defaultSelected).map(d => d.key)
const DEFAULT_PIT_STATS = PITCHING_STAT_DEFS.filter(d => d.defaultSelected).map(d => d.key)
const DEFAULT_TEAM_HIT_STATS = TEAM_HITTING_DEFS.filter(d => d.defaultSelected).map(d => d.key)
const DEFAULT_TEAM_PIT_STATS = TEAM_PITCHING_DEFS.filter(d => d.defaultSelected).map(d => d.key)

// ─── Constants ───────────────────────────────────────────────────────────────

const CURRENT_SEASON = new Date().getFullYear()
const TEAM_SEASONS = Array.from({ length: CURRENT_SEASON - 2000 + 1 }, (_, i) => CURRENT_SEASON - i)

// Featured leaderboard stat keys shown by default (fewer = less overwhelming)
const LB_FEATURED: Record<'hitting' | 'pitching', string[]> = {
  hitting:  ['ops', 'hr', 'sb'],
  pitching: ['era', 'whip', 'so9'],
}

// Curated list of notable active players for random auto-load on Search tab
const FEATURED_PLAYER_IDS = [
  660271,  // Shohei Ohtani
  518692,  // Freddie Freeman
  605141,  // Mookie Betts
  665742,  // Juan Soto
  665487,  // Fernando Tatis Jr.
  670541,  // Yordan Alvarez
  624413,  // Pete Alonso
  665489,  // Vladimir Guerrero Jr.
  660670,  // Ronald Acuña Jr.
  677594,  // Julio Rodríguez
  675911,  // Spencer Strider
  694497,  // Paul Skenes
  668939,  // Gunnar Henderson
  682998,  // Bobby Witt Jr.
  673357,  // Corbin Carroll
  676801,  // Elly De La Cruz
  592518,  // Corey Seager
  663728,  // Kyle Tucker
  666971,  // Dylan Cease
  641154,  // Gerrit Cole
]

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

// Cache raw yearByYear splits so fetchCareerData and fetchPlayerCareerStats share one request per player/group
const yearByYearCache = new Map<string, Promise<any[]>>()

function fetchYearByYearSplits(id: number, group: 'hitting' | 'pitching'): Promise<any[]> {
  const key = `${id}-${group}`
  if (!yearByYearCache.has(key)) {
    yearByYearCache.set(key,
      fetch(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=yearByYear&group=${group}&sportId=1`)
        .then(r => r.json())
        .then((d: any) => d.stats?.[0]?.splits ?? [])
        .catch(() => [])
    )
  }
  return yearByYearCache.get(key)!
}

async function fetchCareerData(id: number, groups: Array<'hitting' | 'pitching'>): Promise<{
  seasons: number[]
  teamsBySeason: Map<number, string[]>
}> {
  const results = await Promise.all(groups.map(group => fetchYearByYearSplits(id, group)))
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

// Fetch all players' season stats for a group, then rank locally per stat def.
// Replaces the old stats/leaders endpoint which silently drops most categories
// when more than ~3 are batched in one request.
async function fetchAndRankPlayers(
  group: 'hitting' | 'pitching',
  season: number,
  defs: StatDef[]
): Promise<Map<string, number[]>> {
  try {
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1/stats?stats=season&group=${group}&season=${season}&sportId=1&limit=2000`
    )
    const d = await r.json()
    const splits: any[] = d.stats?.[0]?.splits ?? []
    const map = new Map<string, number[]>()
    for (const def of defs) {
      if (!def.leaderCategory) continue
      const entries = splits
        .map(s => ({ id: Number(s.player?.id), val: def.getValue(s.stat) }))
        .filter(x => x.id > 0 && x.val != null && x.val !== '' && !isNaN(Number(x.val)))
      // Sort ascending only for stats where lower is better (ERA, WHIP); all others descending
      const asc = def.lowerIsBetter ?? false
      entries.sort((a, b) => asc ? Number(a.val) - Number(b.val) : Number(b.val) - Number(a.val))
      map.set(def.leaderCategory, entries.map(x => x.id))
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

const teamStatsCache = new Map<string, Promise<any>>()

async function fetchTeamStats(id: number, group: 'hitting' | 'pitching', season: number): Promise<any> {
  const key = `${id}-${group}-${season}`
  if (!teamStatsCache.has(key)) {
    teamStatsCache.set(key,
      fetch(`https://statsapi.mlb.com/api/v1/teams/${id}/stats?stats=season&group=${group}&season=${season}`)
        .then(r => r.json())
        .then((d: any) => d.stats?.[0]?.splits?.[0]?.stat ?? null)
        .catch(() => null)
    )
  }
  return teamStatsCache.get(key)!
}

// Fetch all player stats for a season and return structured entries for leaderboard display
async function fetchLeaderboardData(
  group: 'hitting' | 'pitching',
  season: number
): Promise<Array<{ playerId: number; playerName: string; teamAbbr: string; stat: any }>> {
  try {
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1/stats?stats=season&group=${group}&season=${season}&sportId=1&limit=2000`
    )
    const d = await r.json()
    return (d.stats?.[0]?.splits ?? []).map((s: any) => ({
      playerId: Number(s.player?.id),
      playerName: s.player?.fullName ?? '—',
      teamAbbr: s.team?.abbreviation ?? TEAM_ABBR[s.team?.id] ?? '—',
      stat: s.stat,
    })).filter((e: any) => e.playerId > 0)
  } catch {
    return []
  }
}

async function fetchTeamRankings(group: 'hitting' | 'pitching', season: number, defs: StatDef[]): Promise<Map<string, number[]>> {
  try {
    const teamIds = Object.keys(TEAM_ABBR).map(Number)
    const results = await Promise.all(
      teamIds.map(id => fetchTeamStats(id, group, season).then(stat => ({ id, stat })))
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

// ─── Career trends data ───────────────────────────────────────────────────────

interface CareerStatSplit {
  season: number
  teamId: number | null
  teamAbbr: string | null
  hitting: any | null
  pitching: any | null
}

async function fetchPlayerCareerStats(id: number, groups: Array<'hitting' | 'pitching'>): Promise<CareerStatSplit[]> {
  const results = await Promise.all(
    groups.map(async group => ({ group, splits: await fetchYearByYearSplits(id, group) }))
  )

  const bySeasonHit = new Map<number, any>()
  const bySeasonPit = new Map<number, any>()
  const bySeasonTeam = new Map<number, { id: number | null; abbr: string | null }>()

  for (const { group, splits } of results) {
    const seasonMap = new Map<number, any[]>()
    for (const split of splits) {
      const s = Number(split.season)
      if (!s) continue
      if (!seasonMap.has(s)) seasonMap.set(s, [])
      seasonMap.get(s)!.push(split)
    }
    for (const [season, seasonSplits] of seasonMap) {
      // Pick the split with the most games (handles traded players — biggest sample = combined/primary)
      const best = seasonSplits.reduce((a, b) =>
        (Number(b.stat?.gamesPlayed ?? b.stat?.gamesStarted ?? 0) >
         Number(a.stat?.gamesPlayed ?? a.stat?.gamesStarted ?? 0)) ? b : a
      )
      if (!bySeasonTeam.has(season)) {
        bySeasonTeam.set(season, {
          id: best.team?.id ?? null,
          abbr: (best.team?.id ? TEAM_ABBR[best.team.id] : null) ?? best.team?.abbreviation ?? null,
        })
      }
      if (group === 'hitting') bySeasonHit.set(season, best.stat)
      else bySeasonPit.set(season, best.stat)
    }
  }

  const allSeasons = [...new Set([...bySeasonHit.keys(), ...bySeasonPit.keys()])].sort((a, b) => a - b)
  return allSeasons.map(season => ({
    season,
    teamId: bySeasonTeam.get(season)?.id ?? null,
    teamAbbr: bySeasonTeam.get(season)?.abbr ?? null,
    hitting: bySeasonHit.get(season) ?? null,
    pitching: bySeasonPit.get(season) ?? null,
  }))
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

// Shared style for external link pills in the options bar
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

function TeamDot({ team, x, y, hovered, dimmed, highlighted, onEnter, onLeave, onSelect }: {
  team: TeamSummary; x: number; y: number; hovered: boolean
  dimmed?: boolean; highlighted?: boolean
  onEnter: (t: TeamSummary, e: React.MouseEvent) => void
  onLeave: () => void
  onSelect?: (id: number) => void
}) {
  const color = TEAM_BG[team.id] ?? '#555'
  const r = hovered ? 20 : highlighted ? 17 : 14
  return (
    <g transform={`translate(${x},${y})`}
      style={{ cursor: 'pointer', opacity: dimmed ? 0.14 : 1, transition: 'opacity 0.25s' }}
      onMouseEnter={e => onEnter(team, e)} onMouseLeave={onLeave}
      onClick={() => onSelect?.(team.id)}>
      {highlighted && !hovered && (
        <circle r={r + 5} fill={color} fillOpacity={0.18} />
      )}
      <circle r={r} fill={color}
        stroke={hovered || highlighted ? '#fff' : 'rgba(255,255,255,0.7)'}
        strokeWidth={hovered ? 2.5 : highlighted ? 2 : 1.5}
        style={{ transition: 'r 0.12s' }} />
      <text textAnchor="middle" dy="3.5" fill="#fff"
        fontSize={team.abbr.length > 2 ? 6.5 : 7.5} fontWeight={800}
        style={{ pointerEvents: 'none' }}>{team.abbr}</text>
    </g>
  )
}

// ─── ERA vs OPS Scatter Plot ─────────────────────────────────────────────────

function TeamEraOpsPlot({ data, nameMap, highlightTeamId, onSelectTeam }: { data: TeamSummary[]; nameMap: Map<number, string>; highlightTeamId: number | null; onSelectTeam: (id: number) => void }) {
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

  const xTicks = niceTicks(xMin, xMax, 6)
  const yTicks = niceTicks(yMin, yMax, 6)

  return (
    <Box ref={boxRef} sx={{ position: 'relative', userSelect: 'none' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseLeave={() => setHovered(null)}>
        {/* Quadrant fills — top = low ERA = good pitching */}
        <rect x={m.l} y={m.t} width={ax - m.l} height={ay - m.t} fill="#3b82f6" fillOpacity={0.05} />
        <rect x={ax} y={m.t} width={m.l + iW - ax} height={ay - m.t} fill="#22c55e" fillOpacity={0.07} />
        <rect x={m.l} y={ay} width={ax - m.l} height={m.t + iH - ay} fill="#ef4444" fillOpacity={0.05} />
        <rect x={ax} y={ay} width={m.l + iW - ax} height={m.t + iH - ay} fill="#f59e0b" fillOpacity={0.05} />

        {xTicks.map((v, i) => <line key={i} x1={sx(v)} y1={m.t} x2={sx(v)} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.1} strokeWidth={1} />)}
        {yTicks.map((v, i) => <line key={i} x1={m.l} y1={sy(v)} x2={m.l + iW} y2={sy(v)} stroke="currentColor" strokeOpacity={0.1} strokeWidth={1} />)}

        <line x1={ax} y1={m.t} x2={ax} y2={m.t + iH} stroke="#60a5fa" strokeWidth={1.5} strokeDasharray="6 4" strokeOpacity={0.7} />
        <line x1={m.l} y1={ay} x2={m.l + iW} y2={ay} stroke="#60a5fa" strokeWidth={1.5} strokeDasharray="6 4" strokeOpacity={0.7} />
        <text x={ax + 4} y={m.t + 11} fill="#60a5fa" fillOpacity={0.82} fontSize={8.5} fontWeight={700}>avg OPS</text>
        <text x={m.l + iW - 4} y={ay - 5} fill="#60a5fa" fillOpacity={0.82} fontSize={8.5} fontWeight={700} textAnchor="end">avg ERA</text>

        <text x={m.l + 7} y={m.t + 17} fill="#3b82f6" fillOpacity={0.55} fontSize={9.5} fontWeight={800}>PITCHING-LED</text>
        <text x={m.l + iW - 7} y={m.t + 17} fill="#22c55e" fillOpacity={0.65} fontSize={9.5} fontWeight={800} textAnchor="end">ELITE</text>
        <text x={m.l + 7} y={m.t + iH - 9} fill="#ef4444" fillOpacity={0.55} fontSize={9.5} fontWeight={800}>REBUILDING</text>
        <text x={m.l + iW - 7} y={m.t + iH - 9} fill="#f59e0b" fillOpacity={0.6} fontSize={9.5} fontWeight={800} textAnchor="end">OFFENSE-LED</text>

        <line x1={m.l} y1={m.t} x2={m.l} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1.5} />
        <line x1={m.l} y1={m.t + iH} x2={m.l + iW} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1.5} />

        {xTicks.map((v, i) => (
          <g key={i}>
            <line x1={sx(v)} y1={m.t + iH} x2={sx(v)} y2={m.t + iH + 5} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} />
            <text x={sx(v)} y={m.t + iH + 16} textAnchor="middle" fill="currentColor" fillOpacity={0.72} fontSize={10}>{fmtR(v, 3)}</text>
          </g>
        ))}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={m.l - 5} y1={sy(v)} x2={m.l} y2={sy(v)} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} />
            <text x={m.l - 8} y={sy(v) + 3.5} textAnchor="end" fill="currentColor" fillOpacity={0.72} fontSize={10}>{v.toFixed(2)}</text>
          </g>
        ))}

        <text x={m.l + iW / 2} y={H - 4} textAnchor="middle" fill="currentColor" fillOpacity={0.78} fontSize={11} fontWeight={700} letterSpacing="0.8">OPS (offense) →</text>
        <text transform={`translate(13,${m.t + iH / 2}) rotate(-90)`} textAnchor="middle" fill="currentColor" fillOpacity={0.78} fontSize={11} fontWeight={700} letterSpacing="0.8">ERA (lower = better ↑)</text>

        {[...pts].sort((a, b) => (a.id === highlightTeamId ? 1 : 0) - (b.id === highlightTeamId ? 1 : 0)).map(team => (
          <TeamDot key={team.id} team={team} x={sx(team.ops)} y={sy(team.era)}
            hovered={hovered?.id === team.id}
            dimmed={highlightTeamId != null && team.id !== highlightTeamId}
            highlighted={highlightTeamId === team.id}
            onEnter={(t, e) => onEnter({ ...t, name: nameMap.get(t.id) ?? t.abbr }, e)}
            onLeave={() => setHovered(null)}
            onSelect={onSelectTeam} />
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

function TeamWinRDPlot({ data, nameMap, highlightTeamId, onSelectTeam }: { data: TeamSummary[]; nameMap: Map<number, string>; highlightTeamId: number | null; onSelectTeam: (id: number) => void }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const { hovered, setHovered, tipPos, onEnter } = useChartTooltip<TeamSummary & { name: string; winPct: number; rd: number; pythPct: number; pythWins: number; pythLosses: number }>(boxRef as React.RefObject<HTMLDivElement>)

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
    const games = d.wins + d.losses
    const pythWins = Math.round(pythPct * games)
    const pythLosses = games - pythWins
    return { ...d, pythPct, pythWins, pythLosses, name: nameMap.get(d.id) ?? d.abbr }
  })

  const xTicks = niceTicks(xMin, xMax, 7)
  const yTicks = niceTicks(yMin, yMax, 6)

  return (
    <Box ref={boxRef} sx={{ position: 'relative', userSelect: 'none' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseLeave={() => setHovered(null)}>
        {/* Half shading: above .500 vs below */}
        <rect x={x0} y={m.t} width={m.l + iW - x0} height={m.t + iH - m.t} fill="#22c55e" fillOpacity={0.04} />
        <rect x={m.l} y={m.t} width={x0 - m.l} height={m.t + iH - m.t} fill="#ef4444" fillOpacity={0.04} />

        {xTicks.map((v, i) => <line key={i} x1={sx(v)} y1={m.t} x2={sx(v)} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.1} strokeWidth={1} />)}
        {yTicks.map((v, i) => <line key={i} x1={m.l} y1={sy(v)} x2={m.l + iW} y2={sy(v)} stroke="currentColor" strokeOpacity={0.1} strokeWidth={1} />)}

        {/* RD=0 and W%=.500 references */}
        <line x1={x0} y1={m.t} x2={x0} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="5 3" />
        <line x1={m.l} y1={y500} x2={m.l + iW} y2={y500} stroke="currentColor" strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="5 3" />
        <text x={x0 + 4} y={m.t + 11} fill="currentColor" fillOpacity={0.6} fontSize={8.5} fontWeight={700}>RD = 0</text>
        <text x={m.l + iW - 4} y={y500 - 5} fill="currentColor" fillOpacity={0.6} fontSize={8.5} fontWeight={700} textAnchor="end">.500</text>

        {/* Pythagorean expectation curve */}
        <polyline points={curvePts} fill="none" stroke="#60a5fa" strokeWidth={2} strokeDasharray="6 3" strokeOpacity={0.85} strokeLinejoin="round" />
        {(() => {
          const labelRD = xMax * 0.72
          const labelWP = pyth(labelRD)
          if (labelWP < yMin || labelWP > yMax) return null
          return <text x={sx(labelRD)} y={sy(labelWP) - 7} fill="#60a5fa" fillOpacity={0.9} fontSize={8.5} fontWeight={700} textAnchor="middle">Pythagorean expected</text>
        })()}

        {/* Axes */}
        <line x1={m.l} y1={m.t} x2={m.l} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1.5} />
        <line x1={m.l} y1={m.t + iH} x2={m.l + iW} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1.5} />

        {xTicks.map((v, i) => (
          <g key={i}>
            <line x1={sx(v)} y1={m.t + iH} x2={sx(v)} y2={m.t + iH + 5} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} />
            <text x={sx(v)} y={m.t + iH + 16} textAnchor="middle" fill="currentColor" fillOpacity={0.72} fontSize={10}>{v > 0 ? `+${Math.round(v)}` : Math.round(v)}</text>
          </g>
        ))}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={m.l - 5} y1={sy(v)} x2={m.l} y2={sy(v)} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} />
            <text x={m.l - 8} y={sy(v) + 3.5} textAnchor="end" fill="currentColor" fillOpacity={0.72} fontSize={10}>{fmtR(v, 3)}</text>
          </g>
        ))}

        <text x={m.l + iW / 2} y={H - 4} textAnchor="middle" fill="currentColor" fillOpacity={0.78} fontSize={11} fontWeight={700} letterSpacing="0.8">Run Differential (RS − RA) →</text>
        <text transform={`translate(13,${m.t + iH / 2}) rotate(-90)`} textAnchor="middle" fill="currentColor" fillOpacity={0.78} fontSize={11} fontWeight={700} letterSpacing="0.8">Win %</text>

        {[...withPyth].sort((a, b) => (a.id === highlightTeamId ? 1 : 0) - (b.id === highlightTeamId ? 1 : 0)).map(team => (
          <TeamDot key={team.id} team={team} x={sx(team.rd)} y={sy(team.winPct)}
            hovered={hovered?.id === team.id}
            dimmed={highlightTeamId != null && team.id !== highlightTeamId}
            highlighted={highlightTeamId === team.id}
            onEnter={(t, e) => onEnter(withPyth.find(w => w.id === t.id)!, e)}
            onLeave={() => setHovered(null)}
            onSelect={onSelectTeam} />
        ))}
      </svg>

      {hovered && (
        <ChartTooltip tipPos={tipPos}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: TEAM_BG[hovered.id] ?? 'grey.500', flexShrink: 0 }} />
            <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', lineHeight: 1.2 }}>{hovered.name}</Typography>
          </Box>
          <Typography sx={{ fontSize: '0.73rem', color: 'text.secondary' }}>Actual <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{hovered.wins}–{hovered.losses}</Box></Typography>
          <Typography sx={{ fontSize: '0.73rem', color: 'text.secondary' }}>Exp. W-L <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{hovered.pythWins}–{hovered.pythLosses}</Box></Typography>
          {(() => {
            const diff = hovered.wins - hovered.pythWins
            return (
              <Typography sx={{ fontSize: '0.73rem', color: diff >= 0 ? 'success.main' : 'error.main', fontWeight: 700 }}>
                {diff >= 0 ? '+' : ''}{diff} wins vs expected
              </Typography>
            )
          })()}
        </ChartTooltip>
      )}
    </Box>
  )
}

// ─── Luck / Pythagorean delta bar chart ──────────────────────────────────────

function TeamLuckChart({ data, nameMap, highlightTeamId, onSelectTeam }: {
  data: TeamSummary[]
  nameMap: Map<number, string>
  highlightTeamId: number | null
  onSelectTeam: (id: number) => void
}) {
  const withDelta = data
    .filter(d => !isNaN(d.rs) && !isNaN(d.ra) && d.wins + d.losses > 0)
    .map(d => {
      const e = 1.83
      const pythPct = d.ra > 0 ? Math.pow(d.rs, e) / (Math.pow(d.rs, e) + Math.pow(d.ra, e)) : 0.99
      const games = d.wins + d.losses
      const pythWins = Math.round(pythPct * games)
      const delta = d.wins - pythWins
      return { ...d, pythWins, delta, name: nameMap.get(d.id) ?? d.abbr }
    })

  if (!withDelta.length) return null

  const over = [...withDelta].filter(t => t.delta > 0).sort((a, b) => b.delta - a.delta)
  const under = [...withDelta].filter(t => t.delta < 0).sort((a, b) => a.delta - b.delta)
  const even = [...withDelta].filter(t => t.delta === 0)
  const maxAbs = Math.max(...withDelta.map(t => Math.abs(t.delta)), 1)

  const rowH = 15, rowGap = 3
  const dotR = 8
  const dotX = dotR + 2
  const barStartX = dotR * 2 + 7
  const barMaxW = 100
  const numW = 22
  const colW = barStartX + barMaxW + numW + 4
  const gutter = 20
  const headH = 26
  const nRows = Math.max(over.length, under.length)
  const W = colW * 2 + gutter
  const H = headH + nRows * (rowH + rowGap) + (even.length ? 20 : 4)

  const renderTeam = (team: typeof over[0], i: number, isOver: boolean, offsetX: number) => {
    const y = headH + i * (rowH + rowGap)
    const cy = y + rowH / 2
    const teamColor = TEAM_BG[team.id] ?? '#555'
    const barW = (Math.abs(team.delta) / maxAbs) * barMaxW
    const accent = isOver ? '#22c55e' : '#ef4444'
    const isHighlighted = highlightTeamId === team.id
    const isDimmed = highlightTeamId != null && !isHighlighted
    return (
      <g key={team.id} onClick={() => onSelectTeam(team.id)}
        style={{ cursor: 'pointer', opacity: isDimmed ? 0.18 : 1, transition: 'opacity 0.22s' }}>
        {isHighlighted && <circle cx={offsetX + dotX} cy={cy} r={dotR + 4} fill={teamColor} fillOpacity={0.18} />}
        <circle cx={offsetX + dotX} cy={cy} r={isHighlighted ? dotR + 1 : dotR} fill={teamColor} />
        <text x={offsetX + dotX} y={cy + 3.5} textAnchor="middle" fill="#fff"
          fontSize={team.abbr.length > 2 ? 4.5 : 5.5} fontWeight={800}
          style={{ pointerEvents: 'none' }}>{team.abbr}</text>
        <rect
          x={offsetX + barStartX} y={cy - 4}
          width={Math.max(barW, 1.5)} height={8}
          fill={accent} fillOpacity={isHighlighted ? 0.9 : 0.5} rx={2.5} />
        <text
          x={offsetX + barStartX + barW + 3} y={cy + 3.5}
          fill={accent} fillOpacity={0.95}
          fontSize={8.5} fontWeight={700}
          style={{ pointerEvents: 'none' }}>
          {team.delta > 0 ? `+${team.delta}` : `${team.delta}`}
        </text>
      </g>
    )
  }

  return (
    <Box sx={{ userSelect: 'none' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {/* Column headers */}
        <text x={colW / 2} y={17} textAnchor="middle"
          fill="#22c55e" fillOpacity={0.75} fontSize={7.5} fontWeight={800} letterSpacing={0.8}>
          OVERPERFORMING ▲
        </text>
        <text x={colW + gutter + colW / 2} y={17} textAnchor="middle"
          fill="#ef4444" fillOpacity={0.75} fontSize={7.5} fontWeight={800} letterSpacing={0.8}>
          UNDERPERFORMING ▼
        </text>
        {/* Divider */}
        <line
          x1={colW + gutter / 2} y1={22} x2={colW + gutter / 2} y2={H - 4}
          stroke="currentColor" strokeOpacity={0.1} strokeWidth={1} />

        {over.map((t, i) => renderTeam(t, i, true, 0))}
        {under.map((t, i) => renderTeam(t, i, false, colW + gutter))}

        {/* Even teams row */}
        {even.length > 0 && (
          <text x={W / 2} y={H - 4} textAnchor="middle"
            fill="currentColor" fillOpacity={0.3} fontSize={7} fontWeight={600}>
            On pace: {even.map(t => t.abbr).join(', ')}
          </text>
        )}
      </svg>
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

// ─── Career trend stat definitions ───────────────────────────────────────────

interface TrendStatDef {
  key: string
  label: string
  get: (s: any) => number | null
  fmt: (v: number) => string
  lowerBetter?: boolean
  counting?: boolean   // true = project to 162-game pace for current season
  careerAvg?: (statObjs: any[]) => number | null  // weighted avg for rate stats
  noAvg?: boolean      // suppress avg line / summary even if counting=true
}

const TREND_HIT_DEFS: TrendStatDef[] = [
  { key: 'ops',  label: 'OPS',  get: s => s?.ops != null ? Number(s.ops) : null,                   fmt: v => fmtR(v, 3),
    careerAvg: objs => {
      let h = 0, bb = 0, hbp = 0, ab = 0, sf = 0, tb = 0
      for (const o of objs) { h += Number(o?.hits ?? 0); bb += Number(o?.baseOnBalls ?? 0); hbp += Number(o?.hitByPitch ?? 0); ab += Number(o?.atBats ?? 0); sf += Number(o?.sacFlies ?? 0); tb += Number(o?.totalBases ?? 0) }
      if (ab === 0) return null
      return (h + bb + hbp) / (ab + bb + hbp + sf) + tb / ab
    },
  },
  { key: 'avg',  label: 'AVG',  get: s => s?.avg != null ? Number(s.avg) : null,                   fmt: v => fmtR(v, 3),
    careerAvg: objs => {
      let h = 0, ab = 0
      for (const o of objs) { h += Number(o?.hits ?? 0); ab += Number(o?.atBats ?? 0) }
      return ab === 0 ? null : h / ab
    },
  },
  { key: 'obp',  label: 'OBP',  get: s => s?.obp != null ? Number(s.obp) : null,                   fmt: v => fmtR(v, 3),
    careerAvg: objs => {
      let h = 0, bb = 0, hbp = 0, ab = 0, sf = 0
      for (const o of objs) { h += Number(o?.hits ?? 0); bb += Number(o?.baseOnBalls ?? 0); hbp += Number(o?.hitByPitch ?? 0); ab += Number(o?.atBats ?? 0); sf += Number(o?.sacFlies ?? 0) }
      const denom = ab + bb + hbp + sf
      return denom === 0 ? null : (h + bb + hbp) / denom
    },
  },
  { key: 'slg',  label: 'SLG',  get: s => s?.slg != null ? Number(s.slg) : null,                   fmt: v => fmtR(v, 3),
    careerAvg: objs => {
      let tb = 0, ab = 0
      for (const o of objs) { tb += Number(o?.totalBases ?? 0); ab += Number(o?.atBats ?? 0) }
      return ab === 0 ? null : tb / ab
    },
  },
  { key: 'hr',    label: 'HR',   get: s => s?.homeRuns != null ? Number(s.homeRuns) : null,         fmt: v => String(Math.round(v)), counting: true },
  { key: 'rbi',   label: 'RBI',  get: s => s?.rbi != null ? Number(s.rbi) : null,                   fmt: v => String(Math.round(v)), counting: true, noAvg: true },
  { key: 'kpct',  label: 'K%',   lowerBetter: true,
    get: s => {
      const k = Number(s?.strikeOuts ?? null); const pa = Number(s?.plateAppearances ?? null)
      return (s?.strikeOuts != null && s?.plateAppearances != null && pa > 0) ? k / pa : null
    },
    fmt: v => (v * 100).toFixed(1) + '%',
    careerAvg: objs => {
      let k = 0, pa = 0
      for (const o of objs) { k += Number(o?.strikeOuts ?? 0); pa += Number(o?.plateAppearances ?? 0) }
      return pa === 0 ? null : k / pa
    },
  },
  { key: 'bbpct', label: 'BB%',
    get: s => {
      const bb = Number(s?.baseOnBalls ?? null); const pa = Number(s?.plateAppearances ?? null)
      return (s?.baseOnBalls != null && s?.plateAppearances != null && pa > 0) ? bb / pa : null
    },
    fmt: v => (v * 100).toFixed(1) + '%',
    careerAvg: objs => {
      let bb = 0, pa = 0
      for (const o of objs) { bb += Number(o?.baseOnBalls ?? 0); pa += Number(o?.plateAppearances ?? 0) }
      return pa === 0 ? null : bb / pa
    },
  },
  { key: 'sb',    label: 'SB',   get: s => s?.stolenBases != null ? Number(s.stolenBases) : null,   fmt: v => String(Math.round(v)), counting: true },
]

const TREND_PIT_DEFS: TrendStatDef[] = [
  { key: 'era',  label: 'ERA',  get: s => s?.era != null ? Number(s.era) : null,                          fmt: v => v.toFixed(2), lowerBetter: true,
    careerAvg: objs => {
      let er = 0, ip = 0
      for (const o of objs) { er += Number(o?.earnedRuns ?? 0); ip += parseIP(o?.inningsPitched) }
      return ip === 0 ? null : (er * 9) / ip
    },
  },
  { key: 'whip', label: 'WHIP', get: s => s?.whip != null ? Number(s.whip) : null,                        fmt: v => fmtR(v, 3), lowerBetter: true,
    careerAvg: objs => {
      let h = 0, bb = 0, ip = 0
      for (const o of objs) { h += Number(o?.hits ?? 0); bb += Number(o?.baseOnBalls ?? 0); ip += parseIP(o?.inningsPitched) }
      return ip === 0 ? null : (h + bb) / ip
    },
  },
  { key: 'k',    label: 'SO',   get: s => s?.strikeOuts != null ? Number(s.strikeOuts) : null,            fmt: v => String(Math.round(v)), counting: true },
  { key: 'ip',   label: 'IP',   get: s => s?.inningsPitched != null ? Number(s.inningsPitched) : null,    fmt: v => v.toFixed(1), counting: true },
  { key: 'sv',   label: 'SV',   get: s => s?.saves != null ? Number(s.saves) : null,                      fmt: v => String(Math.round(v)), counting: true },
  { key: 'bb',   label: 'BB',   get: s => s?.baseOnBalls != null ? Number(s.baseOnBalls) : null,          fmt: v => String(Math.round(v)), lowerBetter: true, counting: true },
  { key: 'so9',  label: 'K/9',  get: s => s?.strikeoutsPer9Inn != null ? Number(s.strikeoutsPer9Inn) : null, fmt: v => v.toFixed(2),
    careerAvg: objs => {
      let k = 0, ip = 0
      for (const o of objs) { k += Number(o?.strikeOuts ?? 0); ip += parseIP(o?.inningsPitched) }
      return ip === 0 ? null : (k * 9) / ip
    },
  },
]

// ─── League avg cache (module-level, keyed "hitting-2023") ────────────────────

const leagueStatsCache = new Map<string, Promise<any[]>>()
const LEAGUE_CACHE_MAX = 30

function fetchLeagueStatsBySeason(season: number, group: 'hitting' | 'pitching'): Promise<any[]> {
  const key = `${group}-${season}`
  if (!leagueStatsCache.has(key)) {
    if (leagueStatsCache.size >= LEAGUE_CACHE_MAX) {
      // Evict oldest entry (Map iteration order = insertion order)
      leagueStatsCache.delete(leagueStatsCache.keys().next().value!)
    }
    leagueStatsCache.set(key,
      fetch(`https://statsapi.mlb.com/api/v1/stats?stats=season&group=${group}&season=${season}&sportId=1&limit=2000`)
        .then(r => r.json())
        .then((d: any) => (d.stats?.[0]?.splits ?? []).map((s: any) => s.stat))
        .catch(() => [])
    )
  }
  return leagueStatsCache.get(key)!
}

// ─── Player trends chart ──────────────────────────────────────────────────────

// Shared native-select style used in PlayerTrendsChart range pickers (module-scope, stable reference)
const trendSelSx: React.CSSProperties = {
  border: 'none', outline: 'none', background: 'transparent',
  fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
  color: 'inherit', padding: '4px 10px', borderRadius: 999, fontFamily: 'inherit',
}

function PlayerTrendsChart({ splits, isPitcher, isTwoWay }: {
  splits: CareerStatSplit[]
  isPitcher: boolean
  isTwoWay: boolean
}) {
  const initGroup: 'hitting' | 'pitching' = (isPitcher && !isTwoWay) ? 'pitching' : 'hitting'
  const [group, setGroup] = useState<'hitting' | 'pitching'>(initGroup)
  const [statKey, setStatKey] = useState(initGroup === 'pitching' ? 'era' : 'ops')
  const boxRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const rafRef = useRef<number | null>(null)
  const [hovIdx, setHovIdx] = useState<number | null>(null)
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 })
  const [rangeStart, setRangeStart] = useState<number | null>(null)
  const [rangeEnd, setRangeEnd] = useState<number | null>(null)

  const [leagueAvgPts, setLeagueAvgPts] = useState<Map<number, number>>(new Map())

  // Reset to sensible default when group changes
  useEffect(() => { setStatKey(group === 'pitching' ? 'era' : 'ops') }, [group])
  // Reset all when player changes (splits identity changes)
  useEffect(() => {
    const g: 'hitting' | 'pitching' = (isPitcher && !isTwoWay) ? 'pitching' : 'hitting'
    setGroup(g)
    setStatKey(g === 'pitching' ? 'era' : 'ops')
    setRangeStart(null)
    setRangeEnd(null)
    setLeagueAvgPts(new Map())
  }, [splits]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch per-year league averages (must be before any early return — React hook rule)
  useEffect(() => {
    const defs = group === 'hitting' ? TREND_HIT_DEFS : TREND_PIT_DEFS
    const def = defs.find(d => d.key === statKey) ?? defs[0]
    if (!def?.careerAvg) { setLeagueAvgPts(new Map()); return }
    const seasonsSorted = splits
      .map(s => { const stat = group === 'hitting' ? s.hitting : s.pitching; return stat != null && def.get(stat) != null ? s.season : null })
      .filter((s): s is number => s != null)
    if (seasonsSorted.length < 2) return
    const start = rangeStart ?? seasonsSorted[0]
    const end = rangeEnd ?? seasonsSorted[seasonsSorted.length - 1]
    const seasons = seasonsSorted.filter(s => s >= start && s <= end)
    let cancelled = false
    Promise.all(seasons.map(async season => {
      const objs = await fetchLeagueStatsBySeason(season, group)
      return [season, def.careerAvg!(objs)] as [number, number | null]
    })).then(results => {
      if (cancelled) return
      const m = new Map<number, number>()
      for (const [s, v] of results) { if (v != null) m.set(s, v) }
      setLeagueAvgPts(m)
    })
    return () => { cancelled = true }
  }, [group, statKey, rangeStart, rangeEnd, splits]) // eslint-disable-line react-hooks/exhaustive-deps

  // Touch drag support — non-passive so we can preventDefault scroll while dragging along the chart
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !boxRef.current) return
    const W_SVG = 560, M_L = 56, IW = W_SVG - M_L - 22
    const handleTouch = (e: TouchEvent) => {
      e.preventDefault()
      const touch = e.touches[0] ?? e.changedTouches[0]
      if (!touch || !boxRef.current) return
      const rect = boxRef.current.getBoundingClientRect()
      const relX = ((touch.clientX - rect.left) / rect.width) * W_SVG - M_L
      const frac = Math.max(0, Math.min(1, relX / IW))
      // n captured at effect time via closure; effect re-runs whenever n changes
      setHovIdx(Math.round(frac * (currentN.current - 1)))
      setTipPos({ x: (touch.clientX - rect.left) / rect.width * 100, y: (touch.clientY - rect.top) / rect.height * 100 })
    }
    const handleTouchEnd = () => setHovIdx(null)
    svg.addEventListener('touchstart', handleTouch, { passive: false })
    svg.addEventListener('touchmove',  handleTouch, { passive: false })
    svg.addEventListener('touchend',   handleTouchEnd)
    return () => {
      svg.removeEventListener('touchstart', handleTouch)
      svg.removeEventListener('touchmove',  handleTouch)
      svg.removeEventListener('touchend',   handleTouchEnd)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Stable ref so the touch handler always sees the current point count without re-registering
  const currentN = useRef(0)

  const allDefs = group === 'hitting' ? TREND_HIT_DEFS : TREND_PIT_DEFS

  // Only expose stats that have real data for at least 1 season
  const availableDefs = allDefs.filter(def =>
    splits.some(s => { const stat = group === 'hitting' ? s.hitting : s.pitching; return stat != null && def.get(stat) != null })
  )
  const currentDef = availableDefs.find(d => d.key === statKey) ?? availableDefs[0]
  if (!currentDef) return null

  // For pitchers: compute career-median games-played so the pace projection uses the player's own
  // typical workload (starters ≈ 30 games/season, relievers ≈ 65) rather than the meaningless 162.
  // Requires history to project; with no prior seasons we skip pace entirely to avoid absurd numbers.
  const pitcherMedianGP = group === 'pitching' ? (() => {
    const gps = splits
      .filter(s => s.season !== CURRENT_SEASON && s.pitching?.gamesPlayed != null)
      .map(s => Number(s.pitching!.gamesPlayed))
      .filter(g => g > 0)
    if (!gps.length) return null
    const sorted = [...gps].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  })() : null

  // Build data points — project current-season counting stats to full-season pace
  const pts = splits
    .map(s => {
      const stat = group === 'hitting' ? s.hitting : s.pitching
      const val = stat != null ? currentDef.get(stat) : null
      if (val == null) return null
      let value = val
      let actual: number | undefined
      let isPace = false
      if (currentDef.counting && s.season === CURRENT_SEASON) {
        const gp = Number(stat?.gamesPlayed ?? 0)
        if (gp > 0 && val > 0) {
          if (group === 'pitching') {
            // Pitchers: use career-median games as the "full season" denominator.
            // Require ≥15% of that typical season played to avoid wild early-season projections.
            if (pitcherMedianGP != null && gp >= Math.max(3, Math.round(pitcherMedianGP * 0.15))) {
              actual = val
              value = val * pitcherMedianGP / gp
              isPace = true
            }
          } else {
            // Hitters: project to 162 games; require ≥24 games played (~15% of season).
            if (gp >= 24) {
              actual = val
              value = val * 162 / gp
              isPace = true
            }
          }
        }
      }
      // Volume: AB for hitters, IP for pitchers (shown in tooltip)
      const vol = group === 'hitting'
        ? (stat?.atBats != null ? Number(stat.atBats) : null)
        : (stat?.inningsPitched != null ? parseIP(stat.inningsPitched) : null)
      return { season: s.season, value, actual, isPace, teamId: s.teamId, teamAbbr: s.teamAbbr, statObj: stat, vol }
    })
    .filter((p): p is NonNullable<typeof p> => p != null)

  if (pts.length < 2) {
    return (
      <Box sx={{ py: 3, textAlign: 'center' }}>
        <Typography color="text.secondary" sx={{ fontSize: '0.85rem' }}>Not enough seasons to show a trend</Typography>
      </Box>
    )
  }

  // Season range — null means "use full extent"
  const allSeasonsList = pts.map(p => p.season)
  const minSeason = allSeasonsList[0], maxSeason = allSeasonsList[allSeasonsList.length - 1]
  const effStart = rangeStart ?? minSeason
  const effEnd = rangeEnd ?? maxSeason
  const isRangeModified = effStart !== minSeason || effEnd !== maxSeason
  const fptsRaw = pts.filter(p => p.season >= effStart && p.season <= effEnd)
  const fpts = fptsRaw.length >= 2 ? fptsRaw : pts // fall back to all if range too narrow

  // SVG layout
  const W = 560, H = 295
  const m = { t: 30, r: 24, b: 52, l: 56 }
  const iW = W - m.l - m.r, iH = H - m.t - m.b
  const n = fpts.length
  currentN.current = n   // keep touch handler in sync without re-registering

  const vals = fpts.map(p => p.value)
  const leagueValsInRange = fpts.map(p => leagueAvgPts.get(p.season)).filter((v): v is number => v != null)
  const allVals = leagueValsInRange.length > 0 ? [...vals, ...leagueValsInRange] : vals
  const minVal = Math.min(...allVals), maxVal = Math.max(...allVals)
  const range = maxVal - minVal || (maxVal * 0.1) || 1
  const yPad = range * 0.28
  const yMin = Math.max(0, minVal - yPad), yMax = maxVal + yPad

  const sx = (i: number) => m.l + (n === 1 ? iW / 2 : (i / (n - 1)) * iW)
  const sy = (v: number) => m.t + ((yMax - v) / (yMax - yMin)) * iH

  // Short-season detection: career-median volume × 0.4, with an absolute floor.
  // Pitchers with very few IP (injury/TJ) and hitters with few AB should look visually distinct.
  const careerVolMedian = (() => {
    const vols = fpts
      .filter(p => !p.isPace && p.vol != null && p.season !== CURRENT_SEASON)
      .map(p => p.vol!)
    if (!vols.length) return null
    const sorted = [...vols].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  })()
  const shortFloor = group === 'pitching' ? 30 : 100
  const shortThreshold = careerVolMedian != null
    ? Math.max(shortFloor, careerVolMedian * 0.4)
    : shortFloor
  // A point is "short" if it has volume data that falls below the threshold (and isn't a pace projection)
  const isShort = (p: typeof fpts[0]) => !p.isPace && p.vol != null && p.vol < shortThreshold

  // Line segments — switch to dashed + faded when either endpoint is a short season
  const lineSegs = fpts.slice(1).map((_, rawI) => {
    const i = rawI + 1
    return {
      d: `M${sx(i-1).toFixed(1)},${sy(fpts[i-1].value).toFixed(1)} L${sx(i).toFixed(1)},${sy(fpts[i].value).toFixed(1)}`,
      short: isShort(fpts[i-1]) || isShort(fpts[i]),
    }
  })

  // Fill area — uses full polyline regardless of short seasons (background only)
  const fillD = `${fpts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(p.value).toFixed(1)}`).join(' ')} L${sx(n - 1).toFixed(1)},${(m.t + iH).toFixed(1)} L${m.l.toFixed(1)},${(m.t + iH).toFixed(1)} Z`

  // Career avg for summary row (player's own weighted avg for rate stats, mean for counting)
  const statObjs = fpts.map(p => p.statObj)
  const avg: number | null = currentDef.noAvg
    ? null
    : currentDef.careerAvg
      ? currentDef.careerAvg(statObjs)
      : currentDef.counting
        ? vals.reduce((s, v) => s + v, 0) / vals.length
        : null
  // Horizontal avg line only shown for counting stats; rate stats get league avg line instead
  const showHorizAvg = avg != null && !!currentDef.counting
  const showLeagueAvgLine = !!currentDef.careerAvg && leagueValsInRange.length >= 2
  const volLabel = group === 'hitting' ? 'AB' : 'IP'
  const avgY = showHorizAvg ? sy(avg!) : 0

  const yTicks = niceTicks(yMin, yMax, 5)
  const xLabelStep = Math.max(1, Math.ceil(n / 10))
  const gradId = `trendgrad-${group}-${statKey}`

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!boxRef.current) return
    const clientX = e.clientX, clientY = e.clientY
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      if (!boxRef.current) return
      const rect = boxRef.current.getBoundingClientRect()
      const relX = ((clientX - rect.left) / rect.width) * W - m.l
      const frac = Math.max(0, Math.min(1, relX / iW))
      setHovIdx(Math.round(frac * (n - 1)))
      setTipPos({ x: (clientX - rect.left) / rect.width * 100, y: (clientY - rect.top) / rect.height * 100 })
    })
  }

  const hov = hovIdx != null ? fpts[hovIdx] : null
  // Best season — never a pace projection or a short/injury season
  const bestIdx = (() => {
    const cands = fpts.map((p, i) => ({ i, v: p.value, p })).filter(c => !c.p.isPace && !isShort(c.p))
    const pool = cands.length ? cands : fpts.map((p, i) => ({ i, v: p.value, p })) // fallback: all points
    return (currentDef.lowerBetter
      ? pool.reduce((a, b) => b.v < a.v ? b : a)
      : pool.reduce((a, b) => b.v > a.v ? b : a)
    ).i
  })()



  return (
    <Box>
      {/* Group toggle for two-way players */}
      {isTwoWay && (
        <Box sx={{ mb: 1.5 }}>
          <SegControl
            options={[{ value: 'hitting', label: 'Batting' }, { value: 'pitching', label: 'Pitching' }]}
            value={group}
            onChange={v => setGroup(v as 'hitting' | 'pitching')}
          />
        </Box>
      )}

      {/* Stat selector chips */}
      <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap', mb: 1.5 }}>
        {availableDefs.map(def => (
          <PillChip key={def.key} label={def.label} selected={currentDef.key === def.key} onChange={() => setStatKey(def.key)} />
        ))}
      </Box>

      {/* Season range selector */}
      {pts.length >= 3 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.75, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', fontWeight: 600 }}>Season range</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ border: '1.5px solid', borderColor: 'divider', borderRadius: 999, '&:hover': { borderColor: ACCENT } }}>
              <select value={effStart} onChange={e => { setRangeStart(Number(e.target.value)); setHovIdx(null) }} style={trendSelSx}>
                {allSeasonsList.filter(y => y <= effEnd).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </Box>
            <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled' }}>–</Typography>
            <Box sx={{ border: '1.5px solid', borderColor: 'divider', borderRadius: 999, '&:hover': { borderColor: ACCENT } }}>
              <select value={effEnd} onChange={e => { setRangeEnd(Number(e.target.value)); setHovIdx(null) }} style={trendSelSx}>
                {allSeasonsList.filter(y => y >= effStart).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </Box>
          </Box>
          {isRangeModified && (
            <Box onClick={() => { setRangeStart(null); setRangeEnd(null); setHovIdx(null) }}
              sx={{ fontSize: '0.72rem', color: ACCENT, fontWeight: 600, cursor: 'pointer', '&:hover': { opacity: 0.7 } }}>
              Reset
            </Box>
          )}
        </Box>
      )}

      {/* Summary row */}
      <Box sx={{ display: 'flex', gap: 3, mb: 1.5, flexWrap: 'wrap' }}>
        {avg != null && (
          <Box>
            <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, color: 'text.disabled' }}>
              {currentDef.counting ? 'Avg / yr' : isRangeModified ? 'Range avg' : 'Career avg'}
            </Typography>
            <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', color: ACCENT, lineHeight: 1.2 }}>{currentDef.fmt(avg)}</Typography>
          </Box>
        )}
        <Box>
          <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, color: 'text.disabled' }}>Best season</Typography>
          <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', lineHeight: 1.2 }}>
            {currentDef.fmt(fpts[bestIdx].isPace ? fpts[bestIdx].actual! : fpts[bestIdx].value)}
            <Typography component="span" sx={{ fontSize: '0.72rem', color: 'text.secondary', fontWeight: 600, ml: 0.75 }}>({fpts[bestIdx].season})</Typography>
          </Typography>
        </Box>
        <Box>
          <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, color: 'text.disabled' }}>Seasons</Typography>
          <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', lineHeight: 1.2 }}>{n}</Typography>
        </Box>
      </Box>

      {/* Chart */}
      <Box ref={boxRef} sx={{ position: 'relative', userSelect: 'none' }}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => {
            if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
            setHovIdx(null)
          }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.22} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0.01} />
            </linearGradient>
          </defs>

          {/* Grid */}
          {yTicks.map((v, i) => (
            <line key={i} x1={m.l} y1={sy(v)} x2={m.l + iW} y2={sy(v)} stroke="currentColor" strokeOpacity={0.10} strokeWidth={1} />
          ))}

          {/* Hover vertical guide */}
          {hovIdx != null && (
            <line x1={sx(hovIdx)} y1={m.t} x2={sx(hovIdx)} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.22} strokeWidth={1.5} />
          )}

          {/* Fill */}
          <path d={fillD} fill={`url(#${gradId})`} />

          {/* Horizontal avg line — counting stats only */}
          {showHorizAvg && (
            <>
              <line x1={m.l} y1={avgY} x2={m.l + iW} y2={avgY} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3" strokeOpacity={0.6} />
              <text x={m.l + 4} y={avgY - 6} fill="#f59e0b" fillOpacity={0.78} fontSize={10} fontWeight={700}>avg {currentDef.fmt(avg!)}</text>
            </>
          )}

          {/* League avg line — rate stats, one point per season */}
          {showLeagueAvgLine && (() => {
            const lgPts = fpts.map((p, i) => {
              const v = leagueAvgPts.get(p.season)
              return v != null ? `${i === 0 || !fpts[i - 1] || leagueAvgPts.get(fpts[i - 1].season) == null ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}` : null
            }).filter(Boolean).join(' ')
            const lastPt = [...fpts].reverse().find(p => leagueAvgPts.has(p.season))
            const lastIdx = lastPt ? fpts.indexOf(lastPt) : -1
            return (
              <>
                <path d={lgPts} fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3" strokeOpacity={0.6} strokeLinejoin="round" />
                {lastPt && lastIdx >= 0 && (
                  <text x={sx(lastIdx) + 4} y={sy(leagueAvgPts.get(lastPt.season)!) - 5}
                    fill="#f59e0b" fillOpacity={0.78} fontSize={9.5} fontWeight={700}>lg avg</text>
                )}
              </>
            )
          })()}

          {/* Line — solid for normal seasons, dashed+faded when either endpoint is a short season */}
          {lineSegs.map((seg, i) => (
            <path key={i} d={seg.d} fill="none"
              stroke={ACCENT} strokeWidth={2.5} strokeLinecap="round"
              strokeDasharray={seg.short ? '5 5' : undefined}
              strokeOpacity={seg.short ? 0.3 : 1}
            />
          ))}

          {/* Dots */}
          {fpts.map((p, i) => {
            const isHov = hovIdx === i
            const isBest = i === bestIdx
            const short = isShort(p)
            const color = p.teamId ? (TEAM_BG[p.teamId] ?? ACCENT) : ACCENT
            return (
              <g key={p.season} opacity={short && !isHov ? 0.45 : 1}>
                {isBest && !isHov && (
                  <circle cx={sx(i)} cy={sy(p.value)} r={10} fill={color} fillOpacity={0.18} />
                )}
                <circle cx={sx(i)} cy={sy(p.value)} r={isHov ? 8 : (isBest ? 6.5 : 5)}
                  fill={short ? 'transparent' : color}
                  stroke={color} strokeWidth={isHov ? 2.5 : short ? 2 : 2} />
              </g>
            )
          })}

          {/* Best season star annotation */}
          {!hov && (
            <text x={sx(bestIdx)} y={sy(fpts[bestIdx].value) - 13}
              fill="currentColor" fillOpacity={0.55} fontSize={10} textAnchor="middle">★ {fpts[bestIdx].season}</text>
          )}

          {/* Current-year pace label on the dot */}
          {(() => {
            const paceIdx = fpts.findIndex(p => p.isPace)
            if (paceIdx === -1 || hovIdx === paceIdx) return null
            const pp = fpts[paceIdx]
            return (
              <text x={sx(paceIdx)} y={sy(pp.value) - 13}
                fill={ACCENT} fillOpacity={0.8} fontSize={9.5} fontWeight={700} textAnchor="middle">
                ~{currentDef.fmt(pp.value)} pace
              </text>
            )
          })()}

          {/* Axes */}
          <line x1={m.l} y1={m.t} x2={m.l} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.28} strokeWidth={1.5} />
          <line x1={m.l} y1={m.t + iH} x2={m.l + iW} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.28} strokeWidth={1.5} />

          {/* Y ticks */}
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={m.l - 5} y1={sy(v)} x2={m.l} y2={sy(v)} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1} />
              <text x={m.l - 8} y={sy(v) + 4} textAnchor="end" fill="currentColor" fillOpacity={0.68} fontSize={11}>{currentDef.fmt(v)}</text>
            </g>
          ))}

          {/* X ticks */}
          {fpts.map((p, i) => {
            const showLabel = i % xLabelStep === 0 || i === n - 1
            return (
              <g key={p.season}>
                <line x1={sx(i)} y1={m.t + iH} x2={sx(i)} y2={m.t + iH + 5} stroke="currentColor" strokeOpacity={0.25} strokeWidth={1} />
                {showLabel && (
                  <text x={sx(i)} y={m.t + iH + 18} textAnchor="middle" fill="currentColor" fillOpacity={0.68} fontSize={11}>{p.season}</text>
                )}
              </g>
            )
          })}

          {/* Y axis label */}
          <text transform={`translate(14,${m.t + iH / 2}) rotate(-90)`} textAnchor="middle"
            fill="currentColor" fillOpacity={0.55} fontSize={11} fontWeight={700} letterSpacing="1">
            {currentDef.label}
          </text>
        </svg>

        {/* Tooltip */}
        {hov && (() => {
          const tipLeft = Math.min(Math.max(tipPos.x, 12), 82)
          const tipAbove = tipPos.y > 40
          return (
            <Box sx={{
              position: 'absolute',
              left: `${tipLeft}%`,
              top: tipAbove ? `${tipPos.y - 4}%` : `${tipPos.y + 4}%`,
              transform: tipAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 8px)',
              pointerEvents: 'none',
              bgcolor: 'background.paper',
              border: '1.5px solid',
              borderColor: 'divider',
              borderRadius: 2,
              px: 1.5, py: 1,
              boxShadow: '0 4px 18px rgba(0,0,0,0.13)',
              minWidth: 90,
              zIndex: 10,
            }}>
              <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', lineHeight: 1 }}>{hov.season}</Typography>
              {hov.teamAbbr && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.3 }}>
                  {hov.teamId && <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: TEAM_BG[hov.teamId] ?? 'grey.500', flexShrink: 0 }} />}
                  <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>{hov.teamAbbr}</Typography>
                </Box>
              )}
              {hov.isPace ? (
                <>
                  <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: ACCENT, mt: 0.25, lineHeight: 1 }}>
                    {currentDef.fmt(hov.value)} <Typography component="span" sx={{ fontSize: '0.65rem', color: 'text.disabled', fontWeight: 600 }}>pace</Typography>
                  </Typography>
                  <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', mt: 0.2 }}>
                    {currentDef.fmt(hov.actual!)} actual ({Math.round((hov.actual! / hov.value) * 162)}g played)
                  </Typography>
                </>
              ) : (
                <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: ACCENT, mt: 0.25, lineHeight: 1 }}>
                  {currentDef.fmt(hov.value)}
                </Typography>
              )}
              {showLeagueAvgLine && leagueAvgPts.has(hov.season) && (
                <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mt: 0.3 }}>
                  lg avg {currentDef.fmt(leagueAvgPts.get(hov.season)!)}
                </Typography>
              )}
              {hov.vol != null && (
                <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mt: 0.15 }}>
                  {group === 'hitting' ? Math.round(hov.vol) : hov.vol.toFixed(1)} {volLabel}
                </Typography>
              )}
              {isShort(hov) && (
                <Typography sx={{ fontSize: '0.65rem', color: 'warning.main', mt: 0.25, fontWeight: 600 }}>
                  limited sample
                </Typography>
              )}
            </Box>
          )
        })()}
      </Box>

      {currentDef.lowerBetter && (
        <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mt: 0.75, textAlign: 'right' }}>
          ↓ lower is better for {currentDef.label}
        </Typography>
      )}
    </Box>
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

  const [view, setView] = useState<'search' | 'viz' | 'leaderboard'>('search')
  const [vizSeason, setVizSeason] = useState(CURRENT_SEASON)
  const [teamSummaries, setTeamSummaries] = useState<TeamSummary[]>([])
  const [loadingViz, setLoadingViz] = useState(false)
  const [vizHighlightId, setVizHighlightId] = useState<number | null>(null)
  const [vizSearch, setVizSearch] = useState('')
  const [vizSearchOpen, setVizSearchOpen] = useState(false)

  const [lbGroup, setLbGroup] = useState<'hitting' | 'pitching'>('hitting')
  const [lbData, setLbData] = useState<Array<{ playerId: number; playerName: string; teamAbbr: string; stat: any }> | null>(null)
  const [loadingLb, setLoadingLb] = useState(false)
  const [lbHoverId, setLbHoverId] = useState<number | null>(null)
  const [lbSelectedKeys, setLbSelectedKeys] = useState<string[]>(LB_FEATURED.hitting)
  const [lbPickerAnchor, setLbPickerAnchor] = useState<HTMLElement | null>(null)
  const [cardOptionsAnchor, setCardOptionsAnchor] = useState<HTMLElement | null>(null)
  const [lbExportMenu, setLbExportMenu] = useState<{
    anchor: HTMLElement
    def: StatDef
    entries: Array<{ playerId: number; playerName: string; teamAbbr: string; val: any }>
  } | null>(null)
  const [lbFullscreen, setLbFullscreen] = useState<{
    def: StatDef
    entries: Array<{ playerId: number; playerName: string; teamAbbr: string; val: any }>
  } | null>(null)
  const [lbDownloading, setLbDownloading] = useState(false)

  // Career trends
  const [careerSplits, setCareerSplits] = useState<CareerStatSplit[] | null>(null)
  const [loadingCareer, setLoadingCareer] = useState(false)
  const nameMap = useMemo(() => new Map(allTeams.map(t => [t.id, t.name])), [allTeams])

  const cardRef = useRef<HTMLDivElement>(null)
  const lbCardRef = useRef<HTMLDivElement>(null)
  const blockDropdownRef = useRef(false)  // prevents dropdown re-opening after programmatic query set
  const loadGenRef = useRef(0)            // incremented each load; stale async callbacks bail out early

  const toggleHitStat = useCallback((key: string) => setSelectedHitStats(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]), [])
  const togglePitStat = useCallback((key: string) => setSelectedPitStats(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]), [])
  const toggleTeamHitStat = useCallback((key: string) => setSelectedTeamHitStats(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]), [])
  const toggleTeamPitStat = useCallback((key: string) => setSelectedTeamPitStats(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]), [])

  // Load all teams on mount
  useEffect(() => {
    fetchAllTeams().then(setAllTeams).catch(() => {})
  }, [])

  // Load visualization data when switching to viz tab or changing season
  useEffect(() => {
    if (view !== 'viz') return
    setLoadingViz(true)
    setTeamSummaries([])
    setVizHighlightId(null)
    setVizSearch('')
    fetchTeamSummaryData(vizSeason)
      .then(setTeamSummaries)
      .catch(() => {})
      .finally(() => setLoadingViz(false))
  }, [view, vizSeason])

  useEffect(() => {
    if (view !== 'leaderboard') return
    setLoadingLb(true)
    setLbData(null)
    fetchLeaderboardData(lbGroup, vizSeason)
      .then(setLbData)
      .finally(() => setLoadingLb(false))
  }, [view, lbGroup, vizSeason])

  // Reset to featured defaults whenever the leaderboard group switches
  useEffect(() => {
    setLbSelectedKeys(LB_FEATURED[lbGroup])
  }, [lbGroup])

  // Combined search: instant team filter + debounced player search
  useEffect(() => {
    // Consume the block flag — set by selectPlayer/selectTeam to prevent dropdown re-opening
    const blocked = blockDropdownRef.current
    if (blocked) blockDropdownRef.current = false

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
    if (teamMatches.length > 0 && !blocked) setDropdownOpen(true)

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
        if (!blocked && (playerSlice.length > 0 || teamMatches.length > 0)) setDropdownOpen(true)
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [query, allTeams])

  const loadStats = useCallback(async (p: Player, s: number, initial = true) => {
    const gen = ++loadGenRef.current
    if (initial) { setLoadingStats(true); setHittingStats(null); setPitchingStats(null); setHitLeaders(new Map()); setPitLeaders(new Map()) }
    else setRefreshing(true)
    try {
      const isPitcher = p.primaryPosition?.code === '1'
      const isTwoWay = p.primaryPosition?.type === 'Two-Way Player'
      const [hitting, pitching] = await Promise.all([
        (!isPitcher || isTwoWay) ? fetchStats(p.id, 'hitting', s) : null,
        (isPitcher || isTwoWay) ? fetchStats(p.id, 'pitching', s) : null,
      ])
      if (gen !== loadGenRef.current) return
      setHittingStats(hitting)
      setPitchingStats(pitching)
      const [hLeaders, pLeaders] = await Promise.all([
        hitting ? fetchAndRankPlayers('hitting', s, HITTING_STAT_DEFS) : Promise.resolve(new Map<string, number[]>()),
        pitching ? fetchAndRankPlayers('pitching', s, PITCHING_STAT_DEFS) : Promise.resolve(new Map<string, number[]>()),
      ])
      if (gen !== loadGenRef.current) return
      setHitLeaders(hLeaders)
      setPitLeaders(pLeaders)
    } finally {
      if (gen === loadGenRef.current) { setLoadingStats(false); setRefreshing(false) }
    }
  }, [])

  const loadTeamStats = useCallback(async (t: Team, s: number, initial = true) => {
    const gen = ++loadGenRef.current
    if (initial) { setLoadingStats(true); setTeamHitting(null); setTeamPitching(null); setTeamHitLeaders(new Map()); setTeamPitLeaders(new Map()) }
    else setRefreshing(true)
    try {
      const [hitting, pitching, hLeaders, pLeaders] = await Promise.all([
        fetchTeamStats(t.id, 'hitting', s),
        fetchTeamStats(t.id, 'pitching', s),
        fetchTeamRankings('hitting', s, TEAM_HITTING_DEFS),
        fetchTeamRankings('pitching', s, TEAM_PITCHING_DEFS),
      ])
      if (gen !== loadGenRef.current) return
      setTeamHitting(hitting)
      setTeamPitching(pitching)
      setTeamHitLeaders(hLeaders)
      setTeamPitLeaders(pLeaders)
    } finally {
      if (gen === loadGenRef.current) { setLoadingStats(false); setRefreshing(false) }
    }
  }, [])

  const selectPlayer = useCallback(async (p: Player) => {
    blockDropdownRef.current = true
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
    blockDropdownRef.current = true
    setDropdownOpen(false)
    setQuery(t.name)
    setPalette(teamPalette(t.id))
    setTeam(t)
    setPlayer(null)
    setSeason(CURRENT_SEASON)
    setAvailableSeasons(TEAM_SEASONS)
    await loadTeamStats(t, CURRENT_SEASON)
  }, [loadTeamStats])

  const handleLbPlayerClick = useCallback((playerId: number) => {
    fetchPlayerDetails(playerId).then(p => {
      if (p) { selectPlayer(p); setView('search') }
    }).catch(() => {})
  }, [selectPlayer])

  const handleLbTikTok = useCallback(async () => {
    if (!lbCardRef.current || !lbFullscreen) return
    setLbDownloading(true)
    try {
      const captured = await html2canvas(lbCardRef.current, { useCORS: true, scale: 3, logging: false, backgroundColor: null })
      const out = document.createElement('canvas')
      out.width = 1080; out.height = 1920
      const ctx = out.getContext('2d')!
      ctx.fillStyle = '#0f172a'
      ctx.fillRect(0, 0, 1080, 1920)
      const scale = (1080 * 0.88) / captured.width
      const dw = captured.width * scale; const dh = captured.height * scale
      const dx = (1080 - dw) / 2; const dy = 80
      ctx.drawImage(captured, dx, dy, dw, dh)
      const subject = (lbFullscreen.def.leaderLabel ?? lbFullscreen.def.label ?? 'leaderboard').replace(/\s+/g, '-').toLowerCase()
      const link = document.createElement('a')
      link.download = `${subject}-${vizSeason}-tiktok.png`
      link.href = out.toDataURL('image/png')
      link.click()
    } catch (e) {
      console.error('Download failed:', e)
    } finally {
      setLbDownloading(false)
    }
  }, [lbFullscreen, vizSeason])

  // Fetch career splits whenever the selected player changes
  useEffect(() => {
    if (!player) { setCareerSplits(null); return }
    setLoadingCareer(true)
    setCareerSplits(null)
    const isPitcher = player.primaryPosition?.code === '1'
    const isTwoWay = player.primaryPosition?.type === 'Two-Way Player'
    const groups: Array<'hitting' | 'pitching'> = isTwoWay ? ['hitting', 'pitching'] : isPitcher ? ['pitching'] : ['hitting']
    fetchPlayerCareerStats(player.id, groups)
      .then(setCareerSplits)
      .catch(() => setCareerSplits([]))
      .finally(() => setLoadingCareer(false))
  }, [player])

  // Sync URL whenever view/player/team/lb state changes
  useEffect(() => {
    const params = new URLSearchParams()
    if (player) params.set('pid', String(player.id))
    else if (team) params.set('tid', String(team.id))
    if (view !== 'search') params.set('view', view)
    if (view === 'leaderboard' || view === 'viz') {
      if (lbGroup !== 'hitting') params.set('lb', lbGroup)
      if (vizSeason !== CURRENT_SEASON) params.set('season', String(vizSeason))
    }
    const qs = params.toString()
    window.history.replaceState({}, '', `/mlb${qs ? '?' + qs : ''}`)
  }, [view, player, team, lbGroup, vizSeason])

  const autoLoadedRef = useRef(false)
  const urlViewReadRef = useRef(false)
  useEffect(() => {
    if (autoLoadedRef.current) return
    const params = new URLSearchParams(window.location.search)

    // Restore view/lb/season once from URL (before player loads)
    if (!urlViewReadRef.current) {
      urlViewReadRef.current = true
      const viewParam = params.get('view')
      if (viewParam === 'viz' || viewParam === 'leaderboard') setView(viewParam as 'viz' | 'leaderboard')
      const lbParam = params.get('lb')
      if (lbParam === 'pitching') setLbGroup('pitching')
      const seasonParam = params.get('season')
      if (seasonParam) setVizSeason(Number(seasonParam))
    }

    const pid = params.get('pid')
    const tid = params.get('tid')
    if (pid) {
      autoLoadedRef.current = true
      fetchPlayerDetails(Number(pid)).then(p => { if (p) selectPlayer(p) }).catch(() => {})
    } else if (tid && allTeams.length > 0) {
      autoLoadedRef.current = true
      const t = allTeams.find(t => t.id === Number(tid))
      if (t) selectTeam(t)
    } else if (!pid && !tid && allTeams.length > 0) {
      autoLoadedRef.current = true
      const randomId = FEATURED_PLAYER_IDS[Math.floor(Math.random() * FEATURED_PLAYER_IDS.length)]
      fetchPlayerDetails(randomId).then(p => { if (p) selectPlayer(p) }).catch(() => {})
    }
  }, [allTeams, selectPlayer, selectTeam])

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
  const showTrends = !!player && (loadingCareer || !!(careerSplits && careerSplits.length > 0))
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

  const handleVizSelect = (id: number) => setVizHighlightId(prev => prev === id ? null : id)

  return (
    <Box sx={{ maxWidth: { xs: 640, md: 1280 }, mx: 'auto' }}>

      {/* Tab switcher */}
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
        <SegControl
          options={[
            { value: 'search', label: 'Search' },
            { value: 'viz', label: 'Visualize' },
            { value: 'leaderboard', label: 'Leaderboard' },
          ]}
          value={view}
          onChange={v => setView(v as 'search' | 'viz' | 'leaderboard')}
        />
      </Box>

      {/* Visualizations tab */}
      {view === 'viz' && (
        <Box>
          {/* Season picker + team highlight search */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', flex: 1 }}>
              <Typography sx={{ fontWeight: 700, fontSize: '0.85rem', color: 'text.secondary', whiteSpace: 'nowrap' }}>
                All 30 teams · click to focus · hover to inspect
              </Typography>

              {/* Team highlight */}
              {vizHighlightId != null ? (
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.55, borderRadius: 999, bgcolor: TEAM_BG[vizHighlightId] ?? 'grey.700' }}>
                  <Typography sx={{ color: '#fff', fontSize: '0.78rem', fontWeight: 700, lineHeight: 1 }}>
                    {nameMap.get(vizHighlightId) ?? teamSummaries.find(t => t.id === vizHighlightId)?.abbr}
                  </Typography>
                  <Box
                    onClick={() => { setVizHighlightId(null); setVizSearch('') }}
                    sx={{ color: 'rgba(255,255,255,0.75)', fontSize: '1rem', lineHeight: 1, cursor: 'pointer', ml: 0.25, '&:hover': { color: '#fff' } }}
                  >×</Box>
                </Box>
              ) : (
                <ClickAwayListener onClickAway={() => setVizSearchOpen(false)}>
                  <Box sx={{ position: 'relative', minWidth: 180 }}>
                    <Box sx={{
                      display: 'flex', alignItems: 'center', gap: 0.75,
                      px: 1.25, py: 0.6, borderRadius: 999,
                      border: '1.5px solid', borderColor: 'divider', bgcolor: 'background.paper',
                      transition: 'border-color 0.15s',
                      '&:focus-within': { borderColor: ACCENT },
                    }}>
                      <Search sx={{ fontSize: '0.85rem', color: 'text.disabled', flexShrink: 0 }} />
                      <Box
                        component="input"
                        value={vizSearch}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setVizSearch(e.target.value); setVizSearchOpen(true) }}
                        placeholder="Highlight a team…"
                        sx={{
                          flex: 1, border: 'none', outline: 'none', bgcolor: 'transparent',
                          fontSize: '0.8rem', color: 'text.primary', p: 0, fontFamily: 'inherit',
                          '&::placeholder': { color: 'text.disabled' },
                        }}
                      />
                    </Box>
                    {vizSearchOpen && vizSearch.length > 0 && (() => {
                      const q = vizSearch.toLowerCase()
                      const matches = teamSummaries.filter(t => {
                        const name = nameMap.get(t.id) ?? ''
                        return name.toLowerCase().includes(q) || t.abbr.toLowerCase().includes(q)
                      }).slice(0, 6)
                      if (matches.length === 0) return null
                      return (
                        <Paper elevation={8} sx={{ position: 'absolute', width: '100%', zIndex: 20, mt: 0.5, borderRadius: 2, overflow: 'hidden' }}>
                          <List dense disablePadding>
                            {matches.map((t, i) => (
                              <React.Fragment key={t.id}>
                                {i > 0 && <Divider />}
                                <ListItemButton
                                  onClick={() => { setVizHighlightId(t.id); setVizSearch(''); setVizSearchOpen(false) }}
                                  sx={{ gap: 1.25, py: 0.6 }}
                                >
                                  <Box sx={{ width: 26, height: 26, borderRadius: '50%', bgcolor: TEAM_BG[t.id] ?? 'grey.700', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    <Typography sx={{ color: '#fff', fontWeight: 800, fontSize: t.abbr.length > 2 ? '0.52rem' : '0.62rem', lineHeight: 1 }}>{t.abbr}</Typography>
                                  </Box>
                                  <Typography sx={{ fontSize: '0.85rem', fontWeight: 600 }}>{nameMap.get(t.id) ?? t.abbr}</Typography>
                                </ListItemButton>
                              </React.Fragment>
                            ))}
                          </List>
                        </Paper>
                      )
                    })()}
                  </Box>
                </ClickAwayListener>
              )}
            </Box>

            <Box sx={{ ...pillActionSx, p: 0, '&:hover': { borderColor: ACCENT }, '&:focus-within': { borderColor: ACCENT } }}>
              <select value={vizSeason} onChange={e => setVizSeason(Number(e.target.value))}
                style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', color: 'inherit', padding: '6px 16px', borderRadius: 999, fontFamily: 'inherit' }}>
                {TEAM_SEASONS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </Box>
          </Box>

          {loadingViz && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress size={28} /></Box>}

          {!loadingViz && teamSummaries.length > 0 && (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
              {/* Chart 1: ERA vs OPS */}
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
                  <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>ERA vs OPS</Typography>
                  <Tooltip arrow placement="top" title={
                    <Box sx={{ maxWidth: 260, p: 0.5 }}>
                      <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5 }}>What this shows</Typography>
                      <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>
                        Each bubble is a team plotted by their pitching (ERA, vertical) vs their offense (OPS, horizontal).
                        Low ERA = better pitching, so the top of the chart is elite pitching.
                        High OPS = better hitting, so the right side is elite offense.
                        The quadrants label each team archetype — top-right is the most complete, well-rounded teams.
                      </Typography>
                    </Box>
                  }>
                    <InfoOutlined sx={{ fontSize: '0.95rem', color: 'text.disabled', cursor: 'help', mt: '1px' }} />
                  </Tooltip>
                </Box>
                <Typography sx={{ color: 'text.secondary', fontSize: '0.72rem', mb: 1.5 }}>
                  Pitching quality vs offensive output · top-right = elite
                </Typography>
                <Paper elevation={2} sx={{ borderRadius: 3, overflow: 'hidden', p: { xs: 1.5, sm: 2 } }}>
                  <TeamEraOpsPlot data={teamSummaries} nameMap={nameMap} highlightTeamId={vizHighlightId} onSelectTeam={handleVizSelect} />
                </Paper>
              </Box>

              {/* Chart 2: Win% vs Run Differential */}
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
                  <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>Win% vs Run Differential</Typography>
                  <Tooltip arrow placement="top" title={
                    <Box sx={{ maxWidth: 280, p: 0.5 }}>
                      <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5 }}>What this shows</Typography>
                      <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>
                        Each bubble is a team's actual win% plotted against their run differential (runs scored minus runs allowed).
                        The blue dashed curve is the Pythagorean expectation — the win% a team "should" have based on their run differential alone.
                        Teams above the curve are winning more games than their runs predict (often luck or clutch performance).
                        Teams below the curve are underperforming — they're outscoring opponents overall but losing too many close games.
                        Hover a team to see their actual record vs expected W-L.
                      </Typography>
                    </Box>
                  }>
                    <InfoOutlined sx={{ fontSize: '0.95rem', color: 'text.disabled', cursor: 'help', mt: '1px' }} />
                  </Tooltip>
                </Box>
                <Typography sx={{ color: 'text.secondary', fontSize: '0.72rem', mb: 1.5 }}>
                  Actual record vs Pythagorean expected W-L · above the curve = outperforming run differential
                </Typography>
                <Paper elevation={2} sx={{ borderRadius: 3, overflow: 'hidden', p: { xs: 1.5, sm: 2 } }}>
                  <TeamWinRDPlot data={teamSummaries} nameMap={nameMap} highlightTeamId={vizHighlightId} onSelectTeam={handleVizSelect} />
                </Paper>
              </Box>

            {/* Chart 3: Over/Underperforming */}
            <Box sx={{ gridColumn: { md: '1 / -1' } }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
                <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>Over / Underperforming</Typography>
                <Tooltip arrow placement="top" title={
                  <Box sx={{ maxWidth: 260, p: 0.5 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5 }}>What this shows</Typography>
                    <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>
                      Bars show how many wins each team has above (+) or below (−) their Pythagorean expectation.
                      Positive teams are winning more than their run differential predicts — often the result of a strong bullpen or clutch performance.
                      Negative teams are being "unlucky" — they're scoring and allowing runs efficiently but losing close games.
                    </Typography>
                  </Box>
                }>
                  <InfoOutlined sx={{ fontSize: '0.95rem', color: 'text.disabled', cursor: 'help', mt: '1px' }} />
                </Tooltip>
              </Box>
              <Typography sx={{ color: 'text.secondary', fontSize: '0.72rem', mb: 1.5 }}>
                Wins above/below Pythagorean expectation · click to highlight across all charts
              </Typography>
              <Paper elevation={2} sx={{ borderRadius: 3, overflow: 'hidden', p: { xs: 1.5, sm: 2 } }}>
                <TeamLuckChart data={teamSummaries} nameMap={nameMap} highlightTeamId={vizHighlightId} onSelectTeam={handleVizSelect} />
              </Paper>
            </Box>
          </Box>
          )}

          {!loadingViz && teamSummaries.length === 0 && (
            <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>No team stats available for {vizSeason}.</Typography>
          )}
        </Box>
      )}

      {/* Leaderboard tab */}
      {view === 'leaderboard' && (() => {
        // Compute sorted defs outside IIFE so the Stats button can use them
        const lbAllDefs = (lbGroup === 'hitting' ? HITTING_STAT_DEFS : PITCHING_STAT_DEFS).filter(d => d.leaderCategory)
        const lbFeatured = LB_FEATURED[lbGroup]
        const lbSortedDefs = [...lbAllDefs].sort((a, b) => {
          const ai = lbFeatured.indexOf(a.key), bi = lbFeatured.indexOf(b.key)
          if (ai !== -1 && bi !== -1) return ai - bi
          if (ai !== -1) return -1
          if (bi !== -1) return 1
          return (a.leaderLabel ?? a.label).localeCompare(b.leaderLabel ?? b.label)
        })
        const lbIsDefault = lbFeatured.length === lbSelectedKeys.length && lbFeatured.every(k => lbSelectedKeys.includes(k))
        return (
        <Box>
          {/* Controls row */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5, flexWrap: 'wrap', gap: 1.5 }}>
            <SegControl
              options={[{ value: 'hitting', label: 'Hitting' }, { value: 'pitching', label: 'Pitching' }]}
              value={lbGroup}
              onChange={v => setLbGroup(v as 'hitting' | 'pitching')}
            />
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Box sx={{ ...pillActionSx, p: 0, '&:hover': { borderColor: ACCENT }, '&:focus-within': { borderColor: ACCENT } }}>
                <select value={vizSeason} onChange={e => setVizSeason(Number(e.target.value))}
                  style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', color: 'inherit', padding: '6px 16px', borderRadius: 999, fontFamily: 'inherit' }}>
                  {TEAM_SEASONS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </Box>
              {/* Stats picker button */}
              <Box
                onClick={e => setLbPickerAnchor(e.currentTarget as HTMLElement)}
                sx={{
                  ...pillActionSx,
                  borderColor: lbPickerAnchor ? ACCENT : lbIsDefault ? 'divider' : ACCENT,
                  color: lbPickerAnchor ? ACCENT : lbIsDefault ? 'text.secondary' : ACCENT,
                  bgcolor: lbPickerAnchor || !lbIsDefault ? `${ACCENT}10` : 'transparent',
                }}
              >
                <Tune sx={{ fontSize: '0.85rem' }} />
                Stats{!lbIsDefault ? ` (${lbSelectedKeys.length})` : ''}
                <KeyboardArrowDown sx={{ fontSize: '0.85rem' }} />
              </Box>
              <Popover
                open={Boolean(lbPickerAnchor)}
                anchorEl={lbPickerAnchor}
                onClose={() => setLbPickerAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                PaperProps={{ sx: { borderRadius: 2.5, p: 1.75, mt: 0.75, width: 280, boxShadow: '0 8px 32px rgba(0,0,0,0.14)' } }}
              >
                <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.6, color: 'text.disabled', mb: 1 }}>
                  Leaderboard stats
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.65 }}>
                  {lbSortedDefs.map((def, i) => {
                    const isFeatured = lbFeatured.includes(def.key)
                    const prevFeatured = i > 0 && lbFeatured.includes(lbSortedDefs[i - 1].key)
                    return (
                      <React.Fragment key={def.key}>
                        {!isFeatured && prevFeatured && (
                          <Box sx={{ width: '100%', borderTop: '1px solid', borderColor: 'divider', my: 0.5 }} />
                        )}
                        <PillChip
                          label={def.leaderLabel ?? def.label}
                          selected={lbSelectedKeys.includes(def.key)}
                          onChange={() => setLbSelectedKeys(prev =>
                            prev.includes(def.key)
                              ? prev.filter(k => k !== def.key)
                              : [...prev, def.key]
                          )}
                        />
                      </React.Fragment>
                    )
                  })}
                </Box>
                {!lbIsDefault && (
                  <Box
                    onClick={() => setLbSelectedKeys([...lbFeatured])}
                    sx={{ mt: 1.25, pt: 1, borderTop: '1px solid', borderColor: 'divider', fontSize: '0.7rem', color: 'text.disabled', cursor: 'pointer', fontWeight: 600, '&:hover': { color: ACCENT } }}
                  >
                    ↩ Reset to featured
                  </Box>
                )}
              </Popover>
            </Box>
          </Box>

          {loadingLb && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress size={28} /></Box>}

          {!loadingLb && lbData && (() => {
            const defs = lbSortedDefs.filter(d => lbSelectedKeys.includes(d.key))
            const MEDALS = ['🥇', '🥈', '🥉']
            return (
              <Box
                onMouseLeave={() => setLbHoverId(null)}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
                  gap: 2,
                }}
              >
                {defs.map(def => {
                  const asc = def.lowerIsBetter ?? false
                  const entries = lbData
                    .map(e => {
                      const sortVal = def.leaderValue ? def.leaderValue(e.stat) : def.getValue(e.stat)
                      return { ...e, val: def.getValue(e.stat), sortVal }
                    })
                    .filter(e => e.sortVal != null && !isNaN(Number(e.sortVal)))
                    .sort((a, b) => asc ? Number(a.sortVal) - Number(b.sortVal) : Number(b.sortVal) - Number(a.sortVal))
                    .slice(0, 5)
                  if (!entries.length) return null
                  return (
                    <Paper key={def.key} elevation={2} sx={{ borderRadius: 3, overflow: 'hidden' }}>
                      {/* Card header with gradient */}
                      <Box sx={{
                        px: 2, py: 1.25,
                        background: `linear-gradient(135deg, ${ACCENT}22 0%, transparent 100%)`,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        display: 'flex', alignItems: 'center',
                      }}>
                        <Box sx={{ flex: 1 }}>
                          <Typography sx={{ fontWeight: 800, fontSize: '0.92rem', letterSpacing: '-0.2px', lineHeight: 1.2 }}>
                            {def.leaderLabel ?? def.label}
                          </Typography>
                          {def.lowerIsBetter && (
                            <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', fontWeight: 600, mt: 0.15 }}>
                              lower = better
                            </Typography>
                          )}
                        </Box>
                        <Tooltip title="Export">
                          <Box
                            onClick={(ev: React.MouseEvent) => {
                              ev.stopPropagation()
                              setLbExportMenu({ anchor: ev.currentTarget as HTMLElement, def, entries })
                            }}
                            sx={{
                              cursor: 'pointer', color: 'text.disabled', ml: 1, p: 0.5, borderRadius: 1,
                              display: 'flex', alignItems: 'center',
                              '&:hover': { color: ACCENT, bgcolor: `${ACCENT}18` },
                              transition: 'color 0.15s, background 0.15s',
                            }}
                          >
                            <OpenInFull sx={{ fontSize: '0.8rem' }} />
                          </Box>
                        </Tooltip>
                      </Box>

                      {/* Player rows */}
                      <Box sx={{ px: 1.5, py: 0.75 }}>
                        {entries.map((e, rank) => {
                          const isHovered = lbHoverId === e.playerId
                          const dimmed = lbHoverId !== null && !isHovered
                          return (
                            <Box
                              key={e.playerId}
                              onMouseEnter={() => setLbHoverId(e.playerId)}
                              onClick={() => handleLbPlayerClick(e.playerId)}
                              sx={{
                                display: 'flex', alignItems: 'center', gap: 1.25,
                                py: 0.7,
                                borderBottom: rank < 4 ? '1px solid' : 'none',
                                borderColor: 'divider',
                                borderRadius: 1.5,
                                px: 0.5,
                                cursor: 'pointer',
                                transition: 'opacity 0.18s, background 0.18s',
                                opacity: dimmed ? 0.28 : 1,
                                bgcolor: isHovered ? `${ACCENT}14` : 'transparent',
                              }}
                            >
                              {/* Medal / rank indicator */}
                              <Typography sx={{
                                fontSize: rank < 3 ? '1rem' : '0.65rem',
                                fontWeight: 800,
                                color: 'text.disabled',
                                width: 22,
                                flexShrink: 0,
                                textAlign: 'center',
                                lineHeight: 1,
                              }}>
                                {rank < 3 ? MEDALS[rank] : `${rank + 1}`}
                              </Typography>

                              {/* Portrait */}
                              <Box
                                component="img"
                                src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${e.playerId}/headshot/67/current`}
                                alt={e.playerName}
                                sx={{
                                  width: 34, height: 34,
                                  borderRadius: '50%',
                                  objectFit: 'cover',
                                  flexShrink: 0,
                                  border: isHovered ? `2px solid ${ACCENT}` : '2px solid transparent',
                                  transition: 'border-color 0.18s',
                                  bgcolor: 'action.hover',
                                }}
                              />

                              {/* Name + team */}
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography sx={{
                                  fontSize: '0.8rem', fontWeight: 700, lineHeight: 1.2,
                                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                  color: isHovered ? ACCENT : 'text.primary',
                                  transition: 'color 0.18s',
                                }}>
                                  {e.playerName}
                                </Typography>
                                <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', fontWeight: 600 }}>
                                  {e.teamAbbr}
                                </Typography>
                              </Box>

                              {/* Stat value */}
                              <Typography sx={{
                                fontSize: '0.9rem', fontWeight: 800, flexShrink: 0,
                                color: rank === 0 ? ACCENT : isHovered ? ACCENT : 'text.primary',
                                transition: 'color 0.18s',
                              }}>
                                {def.format(e.val)}
                              </Typography>
                            </Box>
                          )
                        })}
                      </Box>
                    </Paper>
                  )
                })}
              </Box>
            )
          })()}

          {/* Export menu per leaderboard card */}
          <Menu
            anchorEl={lbExportMenu?.anchor}
            open={Boolean(lbExportMenu)}
            onClose={() => setLbExportMenu(null)}
            PaperProps={{ sx: { borderRadius: 2, mt: 0.5, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', minWidth: 190 } }}
          >
            <MenuItem
              onClick={() => {
                if (lbExportMenu) setLbFullscreen({ def: lbExportMenu.def, entries: lbExportMenu.entries })
                setLbExportMenu(null)
              }}
              sx={{ fontSize: '0.85rem', gap: 1 }}
            >
              <OpenInFull sx={{ fontSize: '0.95rem', color: 'text.secondary' }} /> View fullscreen
            </MenuItem>
            <MenuItem
              onClick={() => {
                if (lbExportMenu) setLbFullscreen({ def: lbExportMenu.def, entries: lbExportMenu.entries })
                setLbExportMenu(null)
              }}
              sx={{ fontSize: '0.85rem', gap: 1 }}
            >
              <FileDownload sx={{ fontSize: '0.95rem', color: 'text.secondary' }} /> Download for TikTok
            </MenuItem>
          </Menu>

          {/* Leaderboard fullscreen modal */}
          {lbFullscreen && (
            <Box
              onClick={(ev) => { if ((ev.target as HTMLElement) === ev.currentTarget) setLbFullscreen(null) }}
              sx={{
                position: 'fixed', inset: 0, zIndex: 9999,
                bgcolor: 'rgba(0,0,0,0.85)',
                backdropFilter: 'blur(10px)',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                p: 2,
              }}
            >
              <Paper
                ref={lbCardRef}
                elevation={24}
                sx={{
                  borderRadius: 4, overflow: 'hidden',
                  width: '100%', maxWidth: 440,
                  bgcolor: '#0f172a',
                }}
              >
                {/* Fullscreen card header */}
                <Box sx={{
                  px: 3, py: 2.5,
                  background: `linear-gradient(135deg, ${ACCENT}40 0%, transparent 100%)`,
                  borderBottom: `1px solid ${ACCENT}33`,
                }}>
                  <Typography sx={{ fontWeight: 900, fontSize: '1.35rem', color: '#fff', letterSpacing: '-0.5px', lineHeight: 1.15 }}>
                    {lbFullscreen.def.leaderLabel ?? lbFullscreen.def.label}
                  </Typography>
                  <Typography sx={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.38)', fontWeight: 600, mt: 0.3, textTransform: 'uppercase', letterSpacing: 1.2 }}>
                    {vizSeason} MLB Season{lbFullscreen.def.lowerIsBetter ? ' · lower = better' : ''}
                  </Typography>
                </Box>

                {/* Player rows */}
                <Box sx={{ px: 2, py: 1.5 }}>
                  {lbFullscreen.entries.map((e, rank) => {
                    const MEDALS_FS = ['🥇', '🥈', '🥉']
                    return (
                      <Box
                        key={e.playerId}
                        onClick={() => { handleLbPlayerClick(e.playerId); setLbFullscreen(null) }}
                        sx={{
                          display: 'flex', alignItems: 'center', gap: 2,
                          py: 1.4,
                          borderBottom: rank < lbFullscreen.entries.length - 1 ? '1px solid rgba(255,255,255,0.07)' : 'none',
                          cursor: 'pointer',
                          borderRadius: 2, px: 1,
                          transition: 'background 0.15s',
                          '&:hover': { bgcolor: `${ACCENT}22` },
                        }}
                      >
                        <Typography sx={{
                          fontSize: rank < 3 ? '1.35rem' : '0.8rem',
                          fontWeight: 800, width: 30, textAlign: 'center',
                          color: 'rgba(255,255,255,0.45)', lineHeight: 1, flexShrink: 0,
                        }}>
                          {rank < 3 ? MEDALS_FS[rank] : `${rank + 1}`}
                        </Typography>
                        <Box
                          component="img"
                          src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_426,q_auto:best/v1/people/${e.playerId}/headshot/67/current`}
                          alt={e.playerName}
                          sx={{
                            width: 54, height: 54, borderRadius: '50%',
                            objectFit: 'cover', flexShrink: 0,
                            bgcolor: 'rgba(255,255,255,0.08)',
                            border: `2.5px solid ${rank === 0 ? ACCENT : 'rgba(255,255,255,0.15)'}`,
                          }}
                        />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography sx={{
                            fontWeight: 800, fontSize: '1rem', color: '#fff', lineHeight: 1.2,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {e.playerName}
                          </Typography>
                          <Typography sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.38)', fontWeight: 600 }}>
                            {e.teamAbbr}
                          </Typography>
                        </Box>
                        <Typography sx={{
                          fontSize: '1.3rem', fontWeight: 900, flexShrink: 0,
                          color: rank === 0 ? ACCENT : 'rgba(255,255,255,0.85)',
                        }}>
                          {lbFullscreen.def.format(e.val)}
                        </Typography>
                      </Box>
                    )
                  })}
                </Box>
              </Paper>

              {/* Action buttons */}
              <Box sx={{ display: 'flex', gap: 1.5, mt: 2.5 }}>
                <Box
                  onClick={!lbDownloading ? handleLbTikTok : undefined}
                  sx={{
                    px: 3, py: 1.25, borderRadius: 999,
                    bgcolor: ACCENT, color: '#000',
                    fontWeight: 700, fontSize: '0.85rem',
                    cursor: lbDownloading ? 'default' : 'pointer',
                    opacity: lbDownloading ? 0.6 : 1,
                    display: 'flex', alignItems: 'center', gap: 0.75,
                    transition: 'opacity 0.15s',
                  }}
                >
                  <FileDownload sx={{ fontSize: '1rem' }} />
                  {lbDownloading ? 'Saving…' : 'Download for TikTok'}
                </Box>
                <Box
                  onClick={() => setLbFullscreen(null)}
                  sx={{
                    px: 3, py: 1.25, borderRadius: 999,
                    bgcolor: 'rgba(255,255,255,0.1)', color: '#fff',
                    fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 0.75,
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.18)' },
                    transition: 'background 0.15s',
                  }}
                >
                  <Close sx={{ fontSize: '1rem' }} /> Close
                </Box>
              </Box>
            </Box>
          )}
        </Box>
        )
      })()}

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
          {/* ── Top row: card (left) + career trends (right at md+) ── */}
          <Box sx={{
            display: { xs: 'block', md: showTrends ? 'grid' : 'block' },
            gridTemplateColumns: { md: 'minmax(0, 460px) 1fr' },
            gap: { md: 4 },
            alignItems: 'start',
            mb: 3,
          }}>
            {/* Card */}
            <Paper ref={cardRef} elevation={4} sx={{
              borderRadius: 4, overflow: 'hidden', background: palette.bg,
              transition: 'background 0.45s ease', p: { xs: 3, sm: 4 },
            }}>
              {playerCardProps && <CardInner {...playerCardProps} />}
              {teamCardProps && <TeamCardInner {...teamCardProps} />}
            </Paper>

            {/* Career Trends */}
            {showTrends && (
              <Box sx={{ mt: { xs: 3, md: 0 } }}>
                <Box sx={{ mb: 2 }}>
                  <SectionLabel>Career Trends</SectionLabel>
                  <Typography sx={{ color: 'text.secondary', fontSize: '0.75rem', mt: 0.25 }}>
                    Year-by-year stats · dots colored by team · hover any season to inspect
                  </Typography>
                </Box>
                {loadingCareer ? (
                  <Box sx={{ textAlign: 'center', py: 3 }}><CircularProgress size={22} /></Box>
                ) : (
                  <Paper elevation={2} sx={{ borderRadius: 3, p: { xs: 1.5, sm: 2 } }}>
                    <PlayerTrendsChart
                      splits={careerSplits!}
                      isPitcher={player!.primaryPosition?.code === '1'}
                      isTwoWay={player!.primaryPosition?.type === 'Two-Way Player'}
                    />
                  </Paper>
                )}
              </Box>
            )}
          </Box>

          {/* ── Actions row ── */}
          <Divider sx={{ mb: 2 }} />
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <Box onClick={() => setPalette(randomPalette())} sx={pillActionSx}>
              <Shuffle sx={{ fontSize: '0.9rem' }} /> Colors
            </Box>
            <Box sx={{
              ...pillActionSx, p: 0,
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

            {/* Customize button — all secondary options in one Popover */}
            <Box
              onClick={e => setCardOptionsAnchor(e.currentTarget as HTMLElement)}
              sx={{
                ...pillActionSx,
                borderColor: cardOptionsAnchor ? ACCENT : 'divider',
                color: cardOptionsAnchor ? ACCENT : 'text.secondary',
                bgcolor: cardOptionsAnchor ? `${ACCENT}10` : 'transparent',
              }}
            >
              <Tune sx={{ fontSize: '0.85rem' }} /> Customize
              <KeyboardArrowDown sx={{ fontSize: '0.85rem' }} />
            </Box>
            <Popover
              open={Boolean(cardOptionsAnchor)}
              anchorEl={cardOptionsAnchor}
              onClose={() => setCardOptionsAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
              transformOrigin={{ vertical: 'top', horizontal: 'left' }}
              PaperProps={{ sx: { borderRadius: 2.5, p: 2, mt: 0.75, width: 290, boxShadow: '0 8px 32px rgba(0,0,0,0.14)' } }}
            >
              {/* Batting stats */}
              {(hittingStats || teamHitting) && (
                <Box sx={{ mb: 1.75 }}>
                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.6, color: 'text.disabled', mb: 0.75 }}>
                    Batting stats
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
                    {(player ? HITTING_STAT_DEFS : TEAM_HITTING_DEFS).map(def => (
                      <PillChip
                        key={def.key}
                        label={def.label}
                        selected={(player ? selectedHitStats : selectedTeamHitStats).includes(def.key)}
                        onChange={() => (player ? toggleHitStat : toggleTeamHitStat)(def.key)}
                      />
                    ))}
                  </Box>
                </Box>
              )}

              {/* Pitching stats */}
              {(pitchingStats || teamPitching) && (
                <Box sx={{ mb: 1.75 }}>
                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.6, color: 'text.disabled', mb: 0.75 }}>
                    Pitching stats
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
                    {(player ? PITCHING_STAT_DEFS : TEAM_PITCHING_DEFS).map(def => (
                      <PillChip
                        key={def.key}
                        label={def.label}
                        selected={(player ? selectedPitStats : selectedTeamPitStats).includes(def.key)}
                        onChange={() => (player ? togglePitStat : toggleTeamPitStat)(def.key)}
                      />
                    ))}
                  </Box>
                </Box>
              )}

              {/* League rank */}
              <Box sx={{ mb: player ? 1.75 : 1.25 }}>
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.6, color: 'text.disabled', mb: 0.75 }}>
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
                <Box sx={{ mb: 1.75 }}>
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

              {/* Links */}
              <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1.25 }}>
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.6, color: 'text.disabled', mb: 0.75 }}>
                  Links
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap' }}>
                  {player && (<>
                    <Box component="a"
                      href={`https://www.baseball-reference.com/search/search.fcgi?search=${encodeURIComponent(player.fullName)}`}
                      target="_blank" rel="noopener noreferrer" sx={linkPillSx}
                    >Baseball Ref ↗</Box>
                    <Box component="a"
                      href={`https://baseballsavant.mlb.com/savant-player/${player.fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${player.id}`}
                      target="_blank" rel="noopener noreferrer" sx={linkPillSx}
                    >Baseball Savant ↗</Box>
                  </>)}
                  {team && (() => {
                    const bbrefAbbr = BBREF_ABBR[team.abbreviation] ?? team.abbreviation
                    return (<>
                      <Box component="a"
                        href={`https://www.baseball-reference.com/teams/${bbrefAbbr}/${season}.shtml`}
                        target="_blank" rel="noopener noreferrer" sx={linkPillSx}
                      >Baseball Ref ↗</Box>
                      <Box component="a"
                        href={`https://baseballsavant.mlb.com/team/${team.id}`}
                        target="_blank" rel="noopener noreferrer" sx={linkPillSx}
                      >Baseball Savant ↗</Box>
                    </>)
                  })()}
                </Box>
              </Box>
            </Popover>
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

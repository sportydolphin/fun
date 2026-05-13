import { StatDef, Palette } from './types'
import { fmt, fmtDecimal } from './utils'

// ─── Design token ─────────────────────────────────────────────────────────────

export const ACCENT = '#60a5fa'

// ─── Player stat definitions ──────────────────────────────────────────────────

export const HITTING_STAT_DEFS: StatDef[] = [
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

export const PITCHING_STAT_DEFS: StatDef[] = [
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

export const TEAM_HITTING_DEFS: StatDef[] = [
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

export const TEAM_PITCHING_DEFS: StatDef[] = [
  { key: 'era',  label: 'ERA',  getValue: s => s.era,               format: fmt,                    leaderCategory: 'era',  defaultSelected: true,  lowerIsBetter: true  },
  { key: 'whip', label: 'WHIP', getValue: s => s.whip,              format: fmt,                    leaderCategory: 'whip', defaultSelected: true,  lowerIsBetter: true  },
  { key: 'k',    label: 'K',    getValue: s => s.strikeOuts,        format: fmt,                    leaderCategory: 'pk',   defaultSelected: true   },
  { key: 'bb',   label: 'BB',   getValue: s => s.baseOnBalls,       format: fmt,                    leaderCategory: 'pbb',  defaultSelected: false, lowerIsBetter: true  },
  { key: 'hr',   label: 'HR',   getValue: s => s.homeRuns,          format: fmt,                    leaderCategory: 'phr',  defaultSelected: false, lowerIsBetter: true  },
  { key: 'sv',   label: 'SV',   getValue: s => s.saves,             format: fmt,                    leaderCategory: 'sv',   defaultSelected: false  },
  { key: 'h',    label: 'H',    getValue: s => s.hits,              format: fmt,                    leaderCategory: 'ph',   defaultSelected: false, lowerIsBetter: true  },
  { key: 'k9',   label: 'K/9',  getValue: s => s.strikeoutsPer9Inn, format: v => fmtDecimal(v, 2),  leaderCategory: 'k9',   defaultSelected: false  },
]

export const DEFAULT_HIT_STATS = HITTING_STAT_DEFS.filter(d => d.defaultSelected).map(d => d.key)
export const DEFAULT_PIT_STATS = PITCHING_STAT_DEFS.filter(d => d.defaultSelected).map(d => d.key)
export const DEFAULT_TEAM_HIT_STATS = TEAM_HITTING_DEFS.filter(d => d.defaultSelected).map(d => d.key)
export const DEFAULT_TEAM_PIT_STATS = TEAM_PITCHING_DEFS.filter(d => d.defaultSelected).map(d => d.key)

// ─── Constants ───────────────────────────────────────────────────────────────

export const CURRENT_SEASON = new Date().getFullYear()
export const TEAM_SEASONS = Array.from({ length: CURRENT_SEASON - 2000 + 1 }, (_, i) => CURRENT_SEASON - i)

// Featured leaderboard stat keys shown by default (fewer = less overwhelming)
export const LB_FEATURED: Record<'hitting' | 'pitching', string[]> = {
  hitting:  ['ops', 'hr', 'sb'],
  pitching: ['era', 'whip', 'so9'],
}

// Curated list of notable active players for random auto-load on Search tab
export const FEATURED_PLAYER_IDS = [
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

export const HEADSHOT = (id: number) =>
  `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_426,q_auto:best/v1/people/${id}/headshot/67/current`

export const TEAM_ABBR: Record<number, string> = {
  108: 'LAA', 109: 'ARI', 110: 'BAL', 111: 'BOS', 112: 'CHC',
  113: 'CIN', 114: 'CLE', 115: 'COL', 116: 'DET', 117: 'HOU',
  118: 'KC',  119: 'LAD', 120: 'WSH', 121: 'NYM', 133: 'OAK',
  134: 'PIT', 135: 'SD',  136: 'SEA', 137: 'SF',  138: 'STL',
  139: 'TB',  140: 'TEX', 141: 'TOR', 142: 'MIN', 143: 'PHI',
  144: 'ATL', 145: 'CWS', 146: 'MIA', 147: 'NYY', 158: 'MIL',
}

// BBRef uses different codes for some franchises
export const BBREF_ABBR: Record<string, string> = {
  CWS: 'CHW', WSH: 'WSN', SF: 'SFG', KC: 'KCR', SD: 'SDP', TB: 'TBR',
}

// ─── Palette ─────────────────────────────────────────────────────────────────

export const TEAM_BG: Record<number, string> = {
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

export const DEFAULT_PALETTE: Palette = {
  bg: 'hsl(220, 70%, 15%)',
  text: '#ffffff',
  sub: 'rgba(255,255,255,0.58)',
  rank: 'rgba(255,255,255,0.42)',
  divider: 'rgba(255,255,255,0.14)',
}

export function teamPalette(teamId?: number): Palette {
  const bg = (teamId != null && TEAM_BG[teamId]) || DEFAULT_PALETTE.bg
  return { bg, text: '#ffffff', sub: 'rgba(255,255,255,0.62)', rank: 'rgba(255,255,255,0.42)', divider: 'rgba(255,255,255,0.16)' }
}

export function randomPalette(): Palette {
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

// ─── Types ───────────────────────────────────────────────────────────────────


export type RankMode = 'all' | 'top5' | 'none'

export interface Player {
  id: number
  fullName: string
  active: boolean
  primaryPosition: { code: string; name: string; type: string; abbreviation?: string }
  currentTeam?: { id: number; name: string }
  currentAge?: number
  primaryNumber?: string
}

export interface Team {
  id: number
  name: string
  abbreviation: string
  division?: { name: string }
  league?: { name: string }
}

export interface Palette {
  bg: string
  text: string
  sub: string
  rank: string
  divider: string
}

export interface StatDef {
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

// ─── Visualization data ───────────────────────────────────────────────────────

export interface TeamSummary {
  id: number
  abbr: string
  ops: number
  era: number
  rs: number
  ra: number
  wins: number
  losses: number
}

// ─── Career trends data ───────────────────────────────────────────────────────

export interface CareerStatSplit {
  season: number
  teamId: number | null
  teamAbbr: string | null
  hitting: any | null
  pitching: any | null
}

export interface TrendStatDef {
  key: string
  label: string
  get: (s: any) => number | null
  fmt: (v: number) => string
  lowerBetter?: boolean
  counting?: boolean   // true = project to 162-game pace for current season
  careerAvg?: (statObjs: any[]) => number | null  // weighted avg for rate stats
  noAvg?: boolean      // suppress avg line / summary even if counting=true
}

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
  mlbDebutDate?: string   // e.g. "2001-04-02" — used to show a career span for retired players
  lastPlayedDate?: string // e.g. "2019-03-21"
}

export interface Team {
  id: number
  name: string
  abbreviation: string
  teamName?: string       // e.g. "Red Sox" (from MLB API)
  locationName?: string  // e.g. "Boston" (from MLB API)
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
  isRate?: boolean   // true = only show rank badge for qualified players
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

export interface RecentGameEntry {
  date: string
  isHome: boolean
  opponentAbbr: string
  opponentId: number | null
  hitting: any | null
  pitching: any | null
}

// ─── Team roster ──────────────────────────────────────────────────────────────

export interface RosterEntry {
  playerId: number
  fullName: string
  jerseyNumber: string          // '' when unassigned
  positionAbbr: string          // e.g. 'SS', 'RHP' → we use the position abbreviation
  positionType: string          // 'Pitcher' | 'Catcher' | 'Infielder' | 'Outfielder' | 'Hitter' | 'Two-Way Player'
  positionCode: string          // '1' = pitcher, etc.
  bats?: string                 // 'L' | 'R' | 'S'
  throws?: string               // 'L' | 'R'
  statusCode: string            // 'A' active, 'D10'/'D60' IL, etc.
  statusDescription: string
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

// ─── Standings data ───────────────────────────────────────────────────────────

export interface StandingsTeamRecord {
  teamId: number
  teamName: string
  abbr: string
  wins: number
  losses: number
  pct: string        // e.g. ".571"
  gamesBack: string  // "-" for leader
  wcGamesBack: string
  wcRank: number      // 1–3 = holds a WC spot; 0 = not applicable
  divisionRank: number
  streakCode: string // "W3" or "L2"
  lastTen: string    // "8-2"
  runsScored: number
  runsAllowed: number
  runDiff: number
  divisionLeader: boolean
}

// ─── Featured team players ────────────────────────────────────────────────────

export interface TeamPlayerStat {
  playerId: number
  playerName: string
  /** Abbreviated position from the API: SP, RP, OF, 3B, etc. */
  position: string
  /** > 0 for starters */
  gamesStarted: number
  saves: number
  stat: any
}

export interface StandingsDivision {
  divisionId: number
  divisionName: string
  leagueId: number   // 103=AL, 104=NL
  teams: StandingsTeamRecord[]
}

// ─── Team standing ────────────────────────────────────────────────────────────

export interface TeamStandingInfo {
  divisionRank: number
  divisionName: string
  gamesBack: string    // "-" when leading
  wcGamesBack: string  // "-" when leading or division leader
  wcRank: number       // 1–3 = holds a WC spot; 0 = not applicable
  divisionLeader: boolean
}

// ─── Strength of Schedule ─────────────────────────────────────────────────────

export interface SosEntry {
  teamId: number
  abbr: string
  teamName: string
  remainingGames: number
  oppWinPct: number    // average opponent win% across remaining games
  wins: number
  losses: number
}

// ─── Player contracts ─────────────────────────────────────────────────────────

/** One season of a contract — or of team control beyond it (arb years, free agency). */
export interface ContractYear {
  season: number
  /** Normalised at scrape time; see normaliseYearType in scripts/update-payrolls.mjs. */
  kind:   'guaranteed' | 'arb' | 'pre-arb' | 'option' | 'free-agent' | 'other'
  /** FanGraphs' own label, e.g. "CLUB OPTION" — shown on hover. */
  label:  string
  /** Whole dollars. Zero for future arb/FA years, which aren't yet negotiated. */
  salary: number
}

export interface PlayerContract {
  mlbamId:         number
  playerName:      string
  teamId:          number
  contractType:    string | null   // Extension / Free Agent / Arbitration / Pre-Arbitration
  yearsTotal:      number | null
  totalValue:      number | null   // whole dollars
  aav:             number | null
  startSeason:     number | null
  endSeason:       number | null
  serviceTime:     string | null   // "5.028" = 5 years, 28 days
  /** Null when the deal ends on an option — the market date depends on the decision. */
  freeAgentSeason: number | null
  description:     string | null   // "6 yr, $170M (2026-31); can opt out after 2030"
  years:           ContractYear[]
  updatedAt:       string | null
}

// ─── Leaderboard entries ──────────────────────────────────────────────────────

/** One player row in the Stats / Leaderboard tables, season or all-time. */
export interface LeaderboardEntry {
  playerId:   number
  playerName: string
  teamAbbr:   string
  teamId:     number
  stat:       any
  /**
   * All-time only: the player cleared the career PA/IP minimum (they came back
   * from a Qualified-pool request). Absent for season data, where qualification
   * is computed locally from the season's own thresholds instead.
   */
  qualified?: boolean
}

// ─── Leaderboard fullscreen state ─────────────────────────────────────────────

export interface LbFullscreenState {
  def: StatDef
  group: 'hitting' | 'pitching'
  sortKey: string
  sortAsc: boolean
  entries: Array<{ playerId: number; playerName: string; teamAbbr: string; val: any }>
}

// Row shapes for the WPBL section — mirror scripts/create_wpbl.sql. Unlike the MLB
// side (StatsAPI-shaped), these are our own Supabase tables, so the types are ours.

export type WpblGameStatus = 'scheduled' | 'live' | 'final'

export interface WpblTeam {
  id: string                 // short slug/abbr, e.g. 'BOS'
  city: string
  name: string               // nickname, 'Hunters'
  abbr: string
  color: string | null
  color_secondary: string | null
  logo_url: string | null
  sort_order: number
  created_at: string
}

export interface WpblPlayer {
  id: string
  team_id: string | null
  name: string
  position: string | null
  bats: string | null
  throws: string | null
  jersey_number: string | null
  age: number | null
  hometown: string | null
  status: string | null          // 'Signed' | 'Drafted'
  draft_round: number | null
  draft_pick: number | null
  bio: string | null
  active: boolean
  created_at: string
}

export interface WpblGame {
  id: string
  game_date: string          // 'YYYY-MM-DD'
  start_time: string | null
  home_team_id: string
  away_team_id: string
  venue: string | null
  status: WpblGameStatus
  home_score: number | null
  away_score: number | null
  innings: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface WpblBattingLine {
  id: string
  game_id: string
  player_id: string
  team_id: string | null
  batting_order: number | null
  position: string | null
  ab: number
  r: number
  h: number
  doubles: number
  triples: number
  hr: number
  rbi: number
  bb: number
  so: number
  hbp: number
  sb: number
  cs: number
  created_at: string
}

export interface WpblPitchingLine {
  id: string
  game_id: string
  player_id: string
  team_id: string | null
  outs: number               // innings pitched, in outs (3 = 1.0 IP)
  bf: number | null
  h: number
  r: number
  er: number
  bb: number
  so: number
  hr: number
  pitches: number | null
  decision: 'W' | 'L' | 'S' | 'H' | null
  created_at: string
}

// Derived standings row (computed client-side from final games — not stored).
export interface WpblStandingRow {
  team: WpblTeam
  wins: number
  losses: number
  runsFor: number
  runsAgainst: number
}

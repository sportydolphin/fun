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

export type WpblHalf = 'top' | 'bottom'

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
  // ─── Live-situation columns (added in add_wpbl_live.sql). Present once the game
  // has been touched by the live scorer; the DB defaults them so they are never null.
  live_inning?: number
  live_half?: WpblHalf
  live_outs?: number
  live_balls?: number
  live_strikes?: number
  runner_first?: string | null       // player_id on 1st (null = empty)
  runner_second?: string | null
  runner_third?: string | null
  away_batting_order?: number         // next lineup slot due up for each side
  home_batting_order?: number
  away_pitcher_id?: string | null     // current pitcher for each side
  home_pitcher_id?: string | null
  last_play_at?: string | null
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
  sub_out?: boolean          // true = replaced in this slot; active batter is the sub_out=false row
  created_at: string
}

// One logged play in the play-by-play (mirrors wpbl_plays). Stat fields drive the box
// recompute; *_after fields snapshot the resulting game state for undo.
export interface WpblPlay {
  id: string
  game_id: string
  seq: number
  inning: number
  half: WpblHalf
  batting_team_id: string | null
  batter_id: string | null           // null for baserunning-only plays (SB/CS)
  pitcher_id: string | null
  runner_id: string | null           // subject of an SB/CS
  outcome: string                    // scorer code — see live.ts OUTCOMES
  rbi: number
  runs: number
  outs_recorded: number
  scored_ids: string[]
  description: string
  away_score_after: number
  home_score_after: number
  inning_after: number
  half_after: WpblHalf
  outs_after: number
  runner_first_after: string | null
  runner_second_after: string | null
  runner_third_after: string | null
  away_order_after: number
  home_order_after: number
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

// Insert shapes for the box-score entry form (the DB fills id/created_at; game_id is
// supplied by the save call).
export type WpblBattingInput = Omit<WpblBattingLine, 'id' | 'game_id' | 'created_at'>
export type WpblPitchingInput = Omit<WpblPitchingLine, 'id' | 'game_id' | 'created_at'>

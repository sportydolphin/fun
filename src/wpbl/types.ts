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
  api_id: string | null      // official-feed team id (reconciliation key)
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
  api_id: string | null          // official-feed player id (reconciliation key)
  created_at: string
}

export type WpblHalf = 'top' | 'bottom'

// One cell of the line score (runs in a given inning), as stored on the game row.
export interface WpblLineScoreEntry { inning: number; runs: number }

// Live game situation, mirrored verbatim from the official feed's boxscore `status`
// object and stored on the game row (wpbl_games.live_state) while a game is in progress.
// Null once the game is scheduled or final.
export interface WpblLiveState {
  complete: boolean
  inning: number
  half: string                // 'top' | 'bottom' | '' (when not in play)
  batting_team_id: string     // feed team id
  outs: number
  balls: number
  strikes: number
  batter_name: string
  pitcher_name: string
  first_base: string          // runner name, '' when empty
  second_base: string
  third_base: string
  bases_occupied: string[]
  bases_loaded: boolean
  away_runs: number
  home_runs: number
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
  // ─── Official-feed mirror fields (added in add_wpbl_api_ingest.sql). Present once
  // the game has been ingested; older/manual rows may leave them null.
  api_game_id?: string | null
  season_id?: string | null
  game_type?: string | null
  status_detail?: string | null      // verbatim feed status ('Final - Weather Delay')
  counts_in_standings?: boolean | null
  home_hits?: number | null
  away_hits?: number | null
  home_errors?: number | null
  away_errors?: number | null
  home_lob?: number | null
  away_lob?: number | null
  home_line?: WpblLineScoreEntry[] | null
  away_line?: WpblLineScoreEntry[] | null
  live_state?: WpblLiveState | null   // feed situation while in progress; null otherwise
  source_updated_at?: string | null
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
  sf: number                 // sac fly (feed)
  sh: number                 // sac hit / bunt (feed)
  ibb: number                // intentional walk (feed)
  gdp: number                // grounded into DP (feed)
  tb: number                 // total bases (feed-computed)
  lob: number                // left on base (feed)
  sub_out?: boolean          // true = replaced in this slot; active batter is the sub_out=false row
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
  gs: number                 // 1 if this pitcher started (feed)
  hbp: number
  ibb: number
  wp: number                 // wild pitches
  bk: number                 // balks
  strikes: number            // strikes thrown
  doubles: number            // 2B allowed
  triples: number            // 3B allowed
  created_at: string
}

// One player's fielding line for a game (mirrors wpbl_fielding_lines).
export interface WpblFieldingLine {
  id: string
  game_id: string
  player_id: string
  team_id: string | null
  po: number                 // putouts
  a: number                  // assists
  e: number                  // errors
  pb: number                 // passed balls
  sba: number                // stolen bases allowed (catcher)
  ci: number                 // catcher's interference
  dp: number                 // double plays turned
  created_at: string
}

// One pitch-by-pitch event within a play (feed shape).
export interface WpblPitchEvent { sequence: number; code: string; type: string; description: string }

// One play in the official-feed play-by-play (mirrors wpbl_game_plays).
export interface WpblGamePlay {
  id: string
  game_id: string
  sequence: number
  inning: number
  half: WpblHalf
  team_id: string | null             // batting side (slug)
  batter_name: string | null
  batter_id: string | null           // resolved to our player, when matched
  pitcher_name: string | null
  pitcher_id: string | null
  outs: number
  first_base: string | null
  second_base: string | null
  third_base: string | null
  bases_loaded: boolean
  narrative: string
  event_type: string | null
  is_hit: boolean
  is_scoring_play: boolean
  runs_scored: number
  pitch_sequence: string | null
  balls: number
  strikes: number
  fouls: number
  pitch_events: WpblPitchEvent[] | null
  created_at: string
}

// One tracked pitch/hit event (TrackMan; mirrors wpbl_pitch_tracking).
export interface WpblPitchTracking {
  activity_id: string
  game_id: string
  play_id: string | null
  session_id: string | null
  kind: string | null
  event_type: string | null
  sequence: number | null
  occurred_at: string | null
  release_speed: number | null
  speed_unit: string | null
  spin_rate_rpm: number | null
  extension: number | null
  vertical_break: number | null
  horizontal_break: number | null
  plate_location_height: number | null
  raw: unknown
  created_at: string
}

// One ingest run's health summary (mirrors wpbl_ingest_runs). Written by the wpbl-ingest
// Edge Function at the end of every run; read by the admin freshness indicator.
export interface WpblIngestRun {
  id: string
  ran_at: string
  mode: string | null
  ok: boolean
  games: number
  boxscores: number
  error_count: number
  errors: string[] | null
  duration_ms: number | null
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
// supplied by the save call). The feed-only stat columns carry DB defaults, so they are
// optional on manual inserts.
type WpblBattingFeedOnly = 'sf' | 'sh' | 'ibb' | 'gdp' | 'tb' | 'lob'
type WpblPitchingFeedOnly = 'gs' | 'hbp' | 'ibb' | 'wp' | 'bk' | 'strikes' | 'doubles' | 'triples'
export type WpblBattingInput =
  Omit<WpblBattingLine, 'id' | 'game_id' | 'created_at' | WpblBattingFeedOnly>
  & Partial<Pick<WpblBattingLine, WpblBattingFeedOnly>>
export type WpblPitchingInput =
  Omit<WpblPitchingLine, 'id' | 'game_id' | 'created_at' | WpblPitchingFeedOnly>
  & Partial<Pick<WpblPitchingLine, WpblPitchingFeedOnly>>

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
  /** From the community birthdays doc, or the BDay sheet where the doc is silent
   *  (scripts/ingest-wpbl-birthdays.mjs). Null for the dozen players neither one knows. */
  birth_date: string | null
  /** How much to trust birth_date. Settled: 'doc' (the doc gave a sourced date) and 'sheet'
   *  (the doc does not list them, the sheet agreed with itself). Unsettled, so good for a
   *  star sign and never for a greeting: 'doc-unsettled' (the doc lists them and says the
   *  date is not known) and 'sheet-conflict' (the sheet listed two dates and the zodiac grid
   *  was taken as the tiebreak). Null when there is no date at all. */
  birth_date_source: string | null
  /** Generated in the database from birth_date; null when the date is unknown. */
  zodiac_sign: string | null
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

// A mirror of one WPBL official-YouTube upload (see scripts/sync-wpbl-youtube.mjs and
// create_wpbl_videos.sql). `game_id` is set for a highlight whose title parsed to a known
// game; null for podcasts, league features, or an unmatched matchup.
export interface WpblVideo {
  video_id: string           // YouTube 11-char id (watch?v=…)
  title: string
  published_at: string       // ISO timestamp
  thumbnail_url: string | null
  kind: 'highlight' | 'podcast' | 'other'
  game_id: string | null
  away_hint?: string | null
  home_hint?: string | null
  game_date_hint?: string | null
}

/** One post from the WPBL reading feed: a mirror of an independent writer's Substack
 *  (scripts/sync-wpbl-substack.ts). Deliberately carries no body text. The feed publishes
 *  the full article, and we store a headline, a dek and a link so every surface sends the
 *  reader to her post rather than standing in for it. */
export interface WpblArticle {
  post_id: number            // Substack's stable numeric post id
  slug: string
  url: string                // what every card opens, in a new tab
  title: string
  subtitle: string | null    // her dek
  cover_url: string | null
  published_at: string       // ISO timestamp
  word_count: number | null  // with video_count, drives the "N min read" label
  /** Baseball clips embedded in the post. Null means "not counted", not "none": only posts
   *  still inside the RSS window have a body for the sync to count embeds in. */
  video_count: number | null
  tags: string[]
  game_id: string | null     // the game this post recaps, when all the signals agreed
  team_ids: string[]         // clubs the post is ABOUT, not merely mentions
  player_ids: string[]       // rostered players named by full name
}

/** One photograph from the Wikimedia Commons mirror (scripts/sync-wpbl-commons.mjs): the
 *  archive gallery, which is the only WPBL surface that still has something to show once the
 *  league's feed stops.
 *
 *  Only approved rows ever reach the client, enforced in RLS rather than in the query, so a
 *  future caller cannot forget the filter and publish the unreviewed backlog.
 *
 *  Every string here is PLAIN TEXT. Commons serves the description and attribution as HTML
 *  written by whoever uploaded the file, and the sync strips it: nothing on this type may be
 *  rendered as markup. */
export interface WpblPhoto {
  page_id: number            // Commons' stable numeric page id
  title: string              // "File:…", as Commons names it
  description: string | null // Commons' own description, often archive boilerplate
  caption: string | null     // a curator's replacement, shown instead when set
  file_url: string           // 1280px render, for the lightbox
  thumb_url: string          // 500px render, for cards
  width: number | null       // the ORIGINAL's dimensions, for aspect ratio
  height: number | null
  description_url: string    // the Commons file page; the licences require pointing at it
  artist: string | null      // who took it, where Commons knows
  license_short: string      // "Public domain", "CC BY-SA 4.0"
  license_url: string | null
  date_original: string | null // verbatim from Commons, and unreliable. See the migration
  sort_order: number | null
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
  /** Absent from the bulk season reads, which omit it: nothing in the section reads it and
   *  it is 12% of the payload. The per-game reads still return it. */
  created_at?: string
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
  /** Absent from the bulk season reads, which omit it: nothing in the section reads it and
   *  it is 12% of the payload. The per-game reads still return it. */
  created_at?: string
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

// The slim projection of a play the Hall of Firsts (computeFirsts) actually reads. The
// league-wide play fetch on Home uses this instead of select('*') so it never ships the
// heavy per-play columns — notably `pitch_events` (a JSON array of every pitch) plus the
// base/count fields — none of which the firsts computation touches. The full-fat
// WpblGamePlay is still used for a single game's play-by-play (fetchWpblGamePlays).
// The slim projection the game recap reads. buildRecap touches the play log for exactly one
// question — were there back-to-back home runs — which needs the batting side, the event, the
// narrative (for classifyPa's reached-on-error case) and the inning to report. Fetching a
// finished game's full play rows for that shipped every pitch of every at-bat: about 80 KB
// for a question answered by four columns.
export type WpblRecapPlay = Pick<WpblGamePlay,
  // `game_id` is not read by buildRecap. It is here so the correction overlay can match on
  // (game_id, sequence), which is the feed's identifier for a play; one uuid per row is
  // nothing beside the narrative text this projection already carries.
  'game_id' | 'sequence' | 'inning' | 'team_id' | 'event_type' | 'narrative'
>

export type WpblFirstsPlay = Pick<WpblGamePlay,
  | 'game_id' | 'sequence' | 'team_id'
  | 'batter_id' | 'batter_name' | 'pitcher_id' | 'pitcher_name'
  | 'narrative' | 'event_type' | 'is_hit' | 'runs_scored'
>

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

// Slim projection of wpbl_pitch_tracking for the season-wide velocity / tracking board.
// Pulls the top-level numeric columns plus the raw-payload fields we need (pitcher/batter
// identity, pitch type, batted-ball metrics), so we never ship the whole `raw` blob for
// every pitch. `kind` is 'pitch' (not put in play) or 'hit' (batted ball, carries exit data).
export interface WpblTrackRow {
  game_id: string
  kind: string | null
  release_speed: number | null      // pitch velocity, mph
  spin_rate_rpm: number | null
  pitch_type: string | null         // feed label (Fastball / Slider / …), 'Undefined' when unknown
  pitcher_id: string | null         // feed player id (= our wpbl_players.api_id)
  pitcher_name: string | null       // "Last, First"; null on the unnamed-starter rows
  batter_id: string | null
  batter_name: string | null
  exit_speed: number | null         // batted-ball exit velocity, mph
  launch_angle: number | null       // degrees
  distance: number | null           // feet
  hit_type: string | null           // GroundBall / FlyBall / LineDrive / … or 'Undefined'
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
  pct: number                                          // win% 0..1 (0 with no games)
  gamesBack: number                                    // games behind the leader (0 = leading)
  streak: { type: 'W' | 'L'; count: number } | null    // current streak, null before any game
  lastTen: { wins: number; losses: number }            // record over the last up-to-10 games
  /** The last up-to-five decisive results, OLDEST FIRST: the sequence `lastTen` collapses
   *  into a count. A 2–3 stretch reads very differently as LLWWL than as WWLLL, and the
   *  five-dot form strip on the Teams cards is the only place that difference shows. */
  recent: ('W' | 'L')[]
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

/** One player's slot + position in one game, from the wpbl_lineup_history view.
 *  `started` is resolved by play sequence when several players share a lineup slot —
 *  see the view's migration for why the box score alone can't answer it. */
export interface WpblLineupHistoryRow {
  game_id: string
  team_id: string | null
  player_id: string
  game_date: string
  game_status: string
  opponent_team_id: string | null
  /** The opposing starter — named, not just handed, because "vs L" alone reads as if it
   *  might describe a whole staff rather than the one pitcher the card was written for. */
  opp_starter_name: string | null
  opp_starter_throws: string | null
  lineup_spot: number
  position: string | null
  started: boolean
  slot_shared: boolean
}

/** One pitcher's appearance in one game, from the wpbl_pitching_usage view.
 *  `days_rest` is the gap since that pitcher's PREVIOUS outing — null on their first. */
export interface WpblPitchingUsageRow {
  game_id: string
  team_id: string | null
  player_id: string
  game_date: string
  game_status: string
  opponent_team_id: string | null
  started: boolean
  outs: number
  pitches: number | null
  bf: number | null
  er: number
  so: number
  bb: number
  decision: string | null
  days_rest: number | null
}

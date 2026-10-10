import type { SeasonGame } from './season'

/**
 * What the league-neutral engines read, and nothing more.
 *
 * WHY THESE SHAPES AND NOT NEW ONES. The engines in this folder were written against WPBL's
 * mirror tables and have run on them all season, so the field names here are those tables'
 * column names. A WPBL row satisfies each of these structurally and needs no adapter at all; an
 * MLB row does after the MLB mirror (ROADMAP item 6, step 3) writes its tables in the same
 * columns, which is a decision about that migration rather than a translation layer on every
 * read. What genuinely differs between the leagues is not the shape of a line but the rules
 * around it, and those are `League`, below.
 *
 * Every engine is generic over the league's own player and game types, so a board row hands back
 * the caller's own `WpblPlayer` or MLB player rather than a narrowed copy of it.
 */

/** A player, as far as a board row needs one. */
export interface LeaguePlayer {
  id: string
  name: string
  /** The club NOW. Never the club a line was played for: that is on the line. */
  team_id: string | null
}

/** One inning of one side's line score. */
export interface LineScoreEntry { inning: number; runs: number }

/** A game, as far as the engines need one. `status` is 'final' once it has finished, in either
 *  league; the MLB adapter maps StatsAPI's `abstractGameState` onto that word. */
export interface LeagueGame extends SeasonGame {
  game_date: string
  status: string
  home_team_id: string
  away_team_id: string
  home_score: number | null
  away_score: number | null
  home_line?: LineScoreEntry[] | null
  away_line?: LineScoreEntry[] | null
}

/** One batter's line for one game. `team_id` is the club played for THAT DAY. */
export interface BattingGameLine {
  id: string
  game_id: string
  player_id: string
  team_id: string | null
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
  sf: number
  sh: number
  gdp?: number | null
  tb: number
}

/** One pitcher's line for one game. Innings are stored as OUTS. */
export interface PitchingGameLine {
  id: string
  game_id: string
  player_id: string
  team_id: string | null
  outs: number
  bf: number | null
  h: number
  r: number
  er: number
  bb: number
  so: number
  hr: number
  pitches: number | null
  strikes?: number | null
  hbp: number
  wp: number
  bk: number
}

/**
 * One row of the play log, as the pitch-code boards read it.
 *
 * `pitch_sequence` is ONE CHARACTER PER PITCH, in the league's own alphabet (`League.pitchCodes`).
 * `event_type` is the snake_case vocabulary WPBL's feed uses ('home_run', 'strikeout', 'walk',
 * 'groundout', 'stolen_base', ...); the MLB mirror normalises StatsAPI's `eventType` onto it at
 * ingest, so no engine has to know two vocabularies.
 */
export interface PitchPlay {
  game_id: string
  sequence: number
  /** The BATTING side. A play never names the club in the field. */
  team_id: string | null
  batter_id: string | null
  batter_name: string | null
  pitcher_id: string | null
  pitcher_name: string | null
  event_type: string | null
  pitch_sequence: string | null
}

/** One row of the play log with its base-out state, which is the state BEFORE the play. */
export interface RunValuePlay extends PitchPlay {
  inning: number
  half: 'top' | 'bottom'
  outs: number
  /** Whoever is on the base, or empty/null for nobody. An EMPTY STRING is empty: see `baseCode`. */
  first_base: string | null
  second_base: string | null
  third_base: string | null
  /** As the league's feed reports it, which is NOT always the runs the play scored. Read it
   *  through `League.runsOnPlay`, never directly. */
  runs_scored: number | null
  narrative: string | null
}

/** What one pitch was, whatever letter a league spells it with. */
export type PitchKind = 'ball' | 'called' | 'swinging' | 'foul' | 'inplay' | 'hbp'

/**
 * The pitch-code boards' sample bars, per game the club has played.
 *
 * Per league because both the game length and the pitches a plate appearance takes differ, and a
 * bar set in one league's units is either nobody or everybody in the other's.
 */
export interface PitchBars {
  pitcherPerGame: number
  batterPerGame: number
  pitcherFloor: number
  batterFloor: number
}

/**
 * The rules an engine needs from a league. One of these per league, in that league's section
 * (`src/wpbl/league.ts`, `src/mlb/league.ts`), and NEVER a literal in an engine.
 *
 * The reason is the one CLAUDE.md gives for the ERA basis: a seven written into a run-expectancy
 * walk reads perfectly, measures WPBL correctly, and silently drops the last two innings of every
 * MLB game. Nothing would report it. A constant that has to be passed in cannot be forgotten.
 */
export interface League {
  id: 'wpbl' | 'mlb'
  /** Innings in a regulation game: 7 or 9. Anything past it is extras. */
  regulationInnings: number
  /** Every letter `pitch_sequence` can hold, and what it means. A letter missing from here is
   *  counted as unknown rather than guessed at. */
  pitchCodes: Readonly<Record<string, PitchKind>>
  pitchBars: PitchBars
  /** The runs a play put on the board. A league function because WPBL's feed leaves the
   *  batter out of `runs_scored` (a solo home run reads 0), and MLB's does not. */
  runsOnPlay(p: Pick<RunValuePlay, 'event_type' | 'runs_scored'>): number
}

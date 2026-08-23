import { regularSeasonLines, type WpblSeasonGame } from '../season'
import { runsOnPlay } from './playByPlay'
import type { WpblGame, WpblPlayer, WpblRunValuePlay } from '../types'

/** What this module needs to know about a game: whether it counts, whether it has finished,
 *  and who was on the other side of it. A play names only the batting club, so the pitcher's
 *  club is the other one in the pair. */
export type RunValueGame = WpblSeasonGame & Pick<WpblGame, 'status' | 'home_team_id' | 'away_team_id'>

/**
 * Run expectancy, and what each play was worth, from our own play log.
 *
 * WHY THIS IS POSSIBLE WITH NO NEW DATA. Every row in `wpbl_game_plays` carries the outs and
 * all three bases, so the 24 base-out states are already there; summing runs forward to the
 * end of each half-inning turns them into a run-expectancy table, and the difference across a
 * play is what that play was worth. No feed field, no table and no model is involved.
 *
 * WHY THE LEAGUE'S OWN TABLE AND NOT A BORROWED ONE. This is a seven-inning league that has
 * scored 15.2 runs a game across its first 18: run expectancy with nobody on and nobody out
 * comes out around 1.1, against roughly 0.5 in the majors. Valuing a WPBL play against a
 * major-league table would be measuring it in somebody else's run environment and would
 * misprice every state. The cost of doing it honestly is sample: see `ReTable.n`, which is
 * carried per cell precisely so a surface can say how thin a cell is instead of implying all
 * 24 are equally well measured.
 *
 * PURE. Arrays in, plain shapes out, no supabase and no React, like stats.ts and pitches.ts.
 */

// ── The state ────────────────────────────────────────────────────────────────────

/** Bases as a bitmask: 1 = first, 2 = second, 4 = third. Index into `BASE_LABELS`. */
export type BaseCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

/**
 * Every base state in words, because the scoreboard spelling is a code.
 *
 * The first version of the table used "1-3" and "-23" down its left edge, which is how a run
 * expectancy table has always been printed and is unreadable to anyone who has not seen one
 * before. That is most of this league's audience: the WPBL is two months old, and the whole
 * point of the board is to explain what a situation is worth to somebody who knows what an RBI
 * is and has never met run expectancy. Nothing is lost by writing it out.
 */
export const BASE_SHORT: Readonly<Record<BaseCode, string>> = {
  0: 'Nobody on', 1: '1st', 2: '2nd', 3: '1st & 2nd',
  4: '3rd', 5: '1st & 3rd', 6: '2nd & 3rd', 7: 'Loaded',
}

/** The same states in a sentence: "bases loaded, 2 out". */
export const BASE_PHRASE: Readonly<Record<BaseCode, string>> = {
  0: 'nobody on', 1: 'runner on 1st', 2: 'runner on 2nd', 3: 'runners on 1st and 2nd',
  4: 'runner on 3rd', 5: 'runners on 1st and 3rd', 6: 'runners on 2nd and 3rd', 7: 'bases loaded',
}

/** Rows in the order a fan would count them off: nobody on, one runner, two, then loaded.
 *  The bitmask order puts "1st & 2nd" above "3rd", which is arithmetic showing through. */
export const BASE_ROW_ORDER: readonly BaseCode[] = [0, 1, 2, 4, 3, 5, 6, 7]

/** "bases loaded, 2 out" — the situation a play started from, in the words a broadcast uses. */
export function describeState(bases: BaseCode, outs: number): string {
  return `${BASE_PHRASE[bases]}, ${outs} out`
}

/**
 * The bases occupied BEFORE this play.
 *
 * Two things about the columns. The state on a row is the state the play started from, not
 * what it left behind (verified against a full half-inning: the leadoff row is always empty
 * bases, and the runner appears on the row after the single that put him there). And the
 * ingest writes `s(p.first_base)`, so an empty base is an EMPTY STRING rather than null, which
 * a `!= null` test would read as occupied.
 */
export function baseCode(p: Pick<WpblRunValuePlay, 'first_base' | 'second_base' | 'third_base'>): BaseCode {
  const on = (v: string | null) => (v ?? '').trim().length > 0
  return ((on(p.first_base) ? 1 : 0) | (on(p.second_base) ? 2 : 0) | (on(p.third_base) ? 4 : 0)) as BaseCode
}

// ── The table ────────────────────────────────────────────────────────────────────

export interface ReCell {
  /** Mean runs scored from this state to the end of the half-inning. Null when never seen. */
  re: number | null
  /** Plate appearances this cell was measured from. A surface that draws the table should
   *  show it: with one season of a four-team league, "nobody on, nobody out" and "bases
   *  loaded, nobody out" differ by a factor of twenty in how well they are known. */
  n: number
}

export interface ReTable {
  /** [outs 0..2][bases 0..7]. Always 3x8, so a caller can index without a guard. */
  cells: ReCell[][]
  /** Plate appearances the table was built from. */
  pa: number
  /** Complete half-innings measured. */
  halfInnings: number
  games: number
  /** Runs per complete half-inning: the run environment in one number. */
  runsPerHalfInning: number
}

const emptyCells = (): ReCell[][] =>
  Array.from({ length: 3 }, () => Array.from({ length: 8 }, () => ({ re: null, n: 0 })))

/** Run expectancy for a state, or null when the season has not produced that state yet. */
export function reOf(table: ReTable, outs: number, bases: BaseCode): number | null {
  if (outs < 0 || outs > 2) return null
  return table.cells[outs][bases].re
}

/** A half-inning's plays, in order, with the two facts every caller below needs about how
 *  it ended. They are different questions and the answers differ: see `groupHalfInnings`. */
interface HalfInning {
  gameId: string
  plays: WpblRunValuePlay[]
  /** The last half-inning of its game, and so the only one whose ending is in question. */
  last: boolean
  /** Whether the game it belongs to has finished. */
  gameFinal: boolean
}

/**
 * Split the play log into half-innings, in order, and say how each one sits in its game.
 *
 * HOW AN INNING ENDED IS TWO QUESTIONS, and they are decided without reading outs off the
 * last play, which the data does not state. Every half-inning followed by another one in the
 * same game ended with three outs; the only one that might not is a game's last.
 *
 * For VALUING a play, what matters is whether the inning is over at all: a walk-off ends it
 * as surely as a third out, and in both cases nothing more could be expected, so zero is
 * right. `gameFinal` answers that, and it is why the schedule is consulted here beyond the
 * postseason filter at all.
 *
 * For MEASURING the table, that is not enough. A walk-off inning stops because the winning
 * run scored, so its runs are censored by the end of the GAME rather than by the inning, and
 * averaging it in drags every state it contains downward. There is no column saying which of
 * the two happened, so the table drops every game's last half-inning rather than guessing:
 * about one in fourteen, applied uniformly, which is cheap next to a bias that would land
 * hardest on exactly the late high-leverage states the boards are most about.
 *
 * Order is not assumed. The rows are sorted by (game, sequence) on the way in, because every
 * number below is a walk forward through an inning and a caller handing them over in some
 * other order would produce a plausible table rather than an error.
 */
function groupHalfInnings(plays: WpblRunValuePlay[], finalGames: Set<string>): HalfInning[] {
  const sorted = [...plays].sort((a, b) =>
    a.game_id === b.game_id ? a.sequence - b.sequence : (a.game_id < b.game_id ? -1 : 1))

  const out: HalfInning[] = []
  let current: HalfInning | null = null
  let key = ''
  for (const p of sorted) {
    const k = `${p.game_id}|${p.inning}|${p.half}`
    if (k !== key) {
      current = { gameId: p.game_id, plays: [], last: false, gameFinal: finalGames.has(p.game_id) }
      out.push(current)
      key = k
    }
    current!.plays.push(p)
  }

  const lastOf = new Map<string, HalfInning>()
  for (const h of out) lastOf.set(h.gameId, h)
  for (const h of lastOf.values()) h.last = true
  return out
}

/** Runs scored from each play to the end of its half-inning, index-aligned with `plays`. */
function runsToEnd(plays: WpblRunValuePlay[]): number[] {
  const out = new Array<number>(plays.length + 1).fill(0)
  for (let i = plays.length - 1; i >= 0; i--) out[i] = out[i + 1] + runsOnPlay(plays[i])
  return out.slice(0, plays.length)
}

/** The games whose plays may be measured at all: regular season, and how each one ended. */
function seasonContext(games: RunValueGame[]) {
  const final = new Set<string>()
  for (const g of games) if (g.status === 'final') final.add(g.id)
  return final
}

/**
 * Build the league's run-expectancy table from its own plays.
 *
 * Measured from PLATE APPEARANCES only (a row with a `pitch_sequence`, which is the feed's
 * marker for one completed PA), not from every row. Counting every row would count a state
 * once per steal and pickoff throw that happened inside it, so the long innings, which are
 * also the high-scoring ones, would weigh more than the short ones and every cell would read
 * high. The baserunning rows still contribute their runs to the totals; they just do not each
 * open a new observation.
 *
 * The half-inning a game stopped in the middle of is left out entirely: its runs are censored
 * by the final out of the game rather than by the inning, so counting it would drag every
 * state it contains downward.
 */
export function buildRunExpectancy(
  plays: WpblRunValuePlay[],
  games: RunValueGame[],
): ReTable {
  const inSeason = regularSeasonLines(plays, games)
  const halves = groupHalfInnings(inSeason, seasonContext(games))

  const sums = Array.from({ length: 3 }, () => new Array<number>(8).fill(0))
  const counts = Array.from({ length: 3 }, () => new Array<number>(8).fill(0))
  let pa = 0, measuredHalves = 0, runs = 0
  const gameIds = new Set<string>()

  for (const h of halves) {
    if (h.last) continue
    measuredHalves++
    gameIds.add(h.gameId)
    const rest = runsToEnd(h.plays)
    runs += rest[0] ?? 0
    for (let i = 0; i < h.plays.length; i++) {
      const p = h.plays[i]
      if (!p.pitch_sequence) continue
      const outs = p.outs
      if (outs == null || outs < 0 || outs > 2) continue
      const bases = baseCode(p)
      sums[outs][bases] += rest[i]
      counts[outs][bases]++
      pa++
    }
  }

  const cells = emptyCells()
  for (let o = 0; o < 3; o++) {
    for (let b = 0; b < 8; b++) {
      const n = counts[o][b]
      cells[o][b] = { re: n > 0 ? sums[o][b] / n : null, n }
    }
  }

  return {
    cells,
    pa,
    halfInnings: measuredHalves,
    games: gameIds.size,
    runsPerHalfInning: measuredHalves > 0 ? runs / measuredHalves : 0,
  }
}

// ── What a play was worth ────────────────────────────────────────────────────────

export interface PlayRunValue {
  play: WpblRunValuePlay
  /** Runs the play itself put on the board. From `runsOnPlay`, never `runs_scored`. */
  runs: number
  outs: number
  bases: BaseCode
  before: number
  /** Zero when the play ended the half-inning: nothing more could be expected from it. */
  after: number
  /** The club in the field, worked out from the schedule. The play itself names only the club
   *  batting, and a pitcher's leaderboard row has to show the club she was pitching for. */
  fieldingTeamId: string | null
  /** runs + after - before. Positive means the batting side gained. */
  value: number
}

/**
 * Value every play we can, in run-expectancy terms.
 *
 * THE STATE AFTER A PLAY IS THE NEXT PLAY'S STATE, which is why nothing here parses a
 * narrative. Working out where the runners ended up from prose ("advanced to third on an
 * error by c") would be a second, worse source for something the next row already states
 * exactly, and every sentence the parser missed would silently become a mispriced play. The
 * only case with no next row is the end of a half-inning, and a half-inning that has ended is
 * worth nothing by definition.
 *
 * An unfinished half-inning is skipped, not guessed at, because its last play has neither a
 * next row nor an ending.
 */
export function playRunValues(
  plays: WpblRunValuePlay[],
  games: RunValueGame[],
  table: ReTable,
): PlayRunValue[] {
  const inSeason = regularSeasonLines(plays, games)
  const halves = groupHalfInnings(inSeason, seasonContext(games))
  const sides = new Map(games.map(g => [g.id, [g.home_team_id, g.away_team_id]] as const))
  const out: PlayRunValue[] = []

  for (const h of halves) {
    for (let i = 0; i < h.plays.length; i++) {
      const p = h.plays[i]
      const next = h.plays[i + 1]
      // The last play of an inning nobody has finished: no next state, and no ending either.
      if (!next && h.last && !h.gameFinal) continue
      const outs = p.outs
      if (outs == null || outs < 0 || outs > 2) continue
      const bases = baseCode(p)
      const before = reOf(table, outs, bases)
      if (before == null) continue
      let after = 0
      if (next) {
        const nOuts = next.outs
        if (nOuts == null || nOuts < 0 || nOuts > 2) continue
        const a = reOf(table, nOuts, baseCode(next))
        if (a == null) continue
        after = a
      }
      const runs = runsOnPlay(p)
      const pair = sides.get(p.game_id)
      const fieldingTeamId = pair && p.team_id
        ? (p.team_id === pair[0] ? pair[1] : p.team_id === pair[1] ? pair[0] : null)
        : null
      out.push({ play: p, runs, outs, bases, before, after, fieldingTeamId, value: runs + after - before })
    }
  }
  return out
}

/**
 * The plays that moved the needle most, biggest first.
 *
 * Ranked on the SIZE of the swing rather than its sign, so a bases-loaded strikeout ranks with
 * a bases-loaded double: both are the moment the inning turned, and which one reads as good
 * depends only on which dugout you are sitting in.
 *
 * Plate appearances only. On a steal or a wild pitch the feed still fills `batter_name` with
 * whoever is standing at the plate, not the runner who did the thing, so a board built from
 * every row would caption "Sarah Edwards" over "Maggie Foxx stole second" and make her name
 * the tappable one. The runs those plays produce are still in every total; they just cannot
 * be credited to a player from these columns.
 */
export function biggestSwings(values: PlayRunValue[], limit = 10): PlayRunValue[] {
  return values
    .filter(v => v.play.pitch_sequence)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, limit)
}

// ── Per player ───────────────────────────────────────────────────────────────────

export interface RunValueLine {
  /** Null when the play log names somebody we cannot resolve to a roster row. */
  player: WpblPlayer | null
  name: string
  teamId: string | null
  pa: number
  /** Total run value, from this side's point of view: runs added for a hitter, runs prevented
   *  for a pitcher. */
  value: number
  /** The single biggest one, for the subtitle. */
  best: PlayRunValue | null
}

/**
 * Roll play values up per player, in whichever direction is good news for the side asked for.
 *
 * A pitcher's number is the batting side's swing NEGATED: the same play that adds half a run
 * to an offence took half a run away from the pitcher who allowed it, and a board that
 * ranked pitchers by the batting side's sign would put the worst of them on top.
 */
export function runValueLeaders(
  values: PlayRunValue[],
  players: WpblPlayer[],
  side: 'hitting' | 'pitching',
): RunValueLine[] {
  const byId = new Map(players.map(p => [p.id, p]))
  const rows = new Map<string, RunValueLine>()

  for (const v of values) {
    // Same reason as biggestSwings: only a plate appearance names its own actors.
    if (!v.play.pitch_sequence) continue
    const id = side === 'hitting' ? v.play.batter_id : v.play.pitcher_id
    const name = (side === 'hitting' ? v.play.batter_name : v.play.pitcher_name) ?? ''
    if (!name) continue
    const key = id ?? `name:${name.toLowerCase()}`
    const signed = side === 'hitting' ? v.value : -v.value
    let row = rows.get(key)
    if (!row) {
      row = {
        player: id ? byId.get(id) ?? null : null,
        name,
        // The club that was batting is on the play. A traded player's July has to read as the
        // club she played it for, which her roster row no longer knows.
        teamId: side === 'hitting' ? v.play.team_id : v.fieldingTeamId,
        pa: 0, value: 0, best: null,
      }
      rows.set(key, row)
    }
    row.pa++
    row.value += signed
    if (!row.best || Math.abs(signed) > Math.abs(side === 'hitting' ? row.best.value : -row.best.value)) {
      row.best = v
    }
  }

  return [...rows.values()].sort((a, b) => b.value - a.value)
}

/** One decimal place and an explicit sign, which is how a run value is always written. */
export function fmtRunValue(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const r = Math.round(v * 10) / 10
  // Keeps "-0.0" off the board, which reads as a measurement of nothing.
  const z = Object.is(r, -0) ? 0 : r
  return `${z > 0 ? '+' : ''}${z.toFixed(1)}`
}

/** Two decimals, no sign: the table's own cells are expectations, not changes. */
export function fmtRe(v: number | null): string {
  return v == null ? '—' : v.toFixed(2)
}

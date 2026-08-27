import { regularSeasonLines, type WpblSeasonGame } from '../season'
import { runsOnPlay } from './playByPlay'
import type { WpblBattingLine, WpblGame, WpblPlayer, WpblRunValuePlay } from '../types'

/** What this module needs to know about a game: whether it counts, whether it has finished,
 *  who was on the other side of it, and how it came out. A play names only the batting club,
 *  so the pitcher's club is the other one in the pair; the score is what lets the last
 *  half-inning of a finished game be measured at all (see `halfInningEndings`). */
export type RunValueGame = WpblSeasonGame &
  Pick<WpblGame, 'status' | 'home_team_id' | 'away_team_id' | 'home_score' | 'away_score'
    | 'home_line' | 'away_line'>

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
  /**
   * The same observations as a histogram: `dist[r]` is how many of the `n` produced exactly
   * r more runs, with everything at or above `DIST_MAX` piled into the last bucket.
   *
   * The mean answers "what is this situation worth", which is the run-value board's question.
   * A win model asks a different one: from two down in the last inning, a state's average is
   * worthless and the only thing that matters is the chance it produces two or more. Same
   * walk, same sample, one extra counter, so the shape is kept rather than thrown away and
   * re-derived by a second pass over the season.
   */
  dist: number[]
}

/** Runs in one half-inning, bucketed. Seven has happened three times in 263 half-innings and
 *  nothing has reached eight, so the tail beyond this is noise being given a bucket. */
export const DIST_MAX = 8

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
  Array.from({ length: 3 }, () => Array.from({ length: 8 }, () => (
    { re: null, n: 0, dist: new Array<number>(DIST_MAX + 1).fill(0) })))

/** Regulation is seven innings here. Anything past it is a different game: see the walk. */
export const REGULATION_INNINGS = 7

/** Run expectancy for a state, or null when the season has not produced that state yet. */
export function reOf(table: ReTable, outs: number, bases: BaseCode): number | null {
  if (outs < 0 || outs > 2) return null
  return table.cells[outs][bases].re
}

/** A half-inning's plays, in order, with the facts every caller below needs about how it
 *  ended. They are different questions and the answers differ: see `groupHalfInnings`. */
interface HalfInning {
  gameId: string
  plays: WpblRunValuePlay[]
  /** The last half-inning of its game, and so the only one whose ending is in question. */
  last: boolean
  /** Whether the game it belongs to has finished. */
  gameFinal: boolean
  /** Whether the runs that followed each state here might NOT all be in the log, which is
   *  what makes a half-inning unmeasurable. Only ever true of a `last`, and only when the
   *  evidence in `halfInningEndings` fails to rule it out. */
  censored: boolean
}

/** Where a game's play log is missing runs, as precisely as the feed's own numbers can say. */
interface GameEnding {
  final: boolean
  /** Both scores published. Without them nothing here can be evaluated: not whether runs are
   *  missing, and not whether the home side won while batting. */
  scored: boolean
  /** `${half}|${inning}` for each half-inning whose log is SHORT of its line-score cell. */
  shortHalves: Set<string>
  /** A side whose missing runs could not be pinned on any inning: the line score and the log
   *  agree with each other and both fall short of the final score. Nothing says where, so the
   *  whole of that side's half-innings go, and only that side's. */
  unplaced: { top: boolean; bottom: boolean }
  /** The home side finished level or ahead, so a bottom half it was batting in may have been
   *  cut short by the game being won or called rather than by a third out. */
  homeNotBeaten: boolean
}

const halfKey = (half: string | null, inning: number) =>
  `${half === 'bottom' ? 'bottom' : 'top'}|${inning}`

/**
 * Where each game's log is missing runs, using the feed's own three views of the same game.
 *
 * A RECONCILIATION, NOT A GUESS, and done at two levels because the feed publishes both. The
 * line score gives runs per inning per side, so a half-inning whose logged runs fall short of
 * its own cell is missing rows, and it is the only half-inning we know that about. Whatever
 * gap is left between the log and the FINAL score after those shortfalls are accounted for is
 * missing from somewhere nobody can name, and that is the only case that costs a whole side of
 * a game. One half-inning in the season is in the first class (Aug 20, top of the 7th, the
 * hit-by-pitch with the bases loaded that RetroWPBL has and the feed does not) and none is in
 * the second.
 *
 * Being able to place a gap is what lets the rest of a damaged game stay. The Aug 20 log goes
 * blank from the middle of the 5th, fourteen rows with no batter, no event and outs frozen at
 * 0, and every one of its other half-innings still reconciles cell by cell.
 *
 * SHORT, not merely different. A half-inning whose log has MORE runs than its line-score cell
 * is not censored: the runs that followed each state in it are all present, which is the only
 * property the table needs. That also keeps a correction from being self-defeating, since a
 * correction adding a run the feed never scored would otherwise disqualify the inning it fixed.
 *
 * It is deliberately NOT "did the last play make the third out". The log does not state the
 * outs a play made, so that question can only be answered by classifying `event_type`, which
 * gets the ordinary endings right and then quietly drops the inning that ended on a double
 * play or on a runner thrown out stretching, both of which the feed files under the batter's
 * own result. Those are innings with runners on base, so excluding them would bias the exact
 * cells they belong to, which is the failure this whole rule exists to avoid.
 */
function halfInningEndings(
  plays: WpblRunValuePlay[],
  games: RunValueGame[],
): Map<string, GameEnding> {
  const logged = new Map<string, Map<string, number>>()
  for (const p of plays) {
    let byHalf = logged.get(p.game_id)
    if (!byHalf) logged.set(p.game_id, byHalf = new Map())
    const k = halfKey(p.half, p.inning)
    byHalf.set(k, (byHalf.get(k) ?? 0) + runsOnPlay(p))
  }

  const out = new Map<string, GameEnding>()
  for (const g of games) {
    const byHalf = logged.get(g.id) ?? new Map<string, number>()
    const shortHalves = new Set<string>()
    const unplaced = { top: false, bottom: false }

    for (const half of ['top', 'bottom'] as const) {
      const line = half === 'bottom' ? g.home_line : g.away_line
      const score = half === 'bottom' ? g.home_score : g.away_score
      let inLog = 0
      for (const [k, runs] of byHalf) if (k.startsWith(`${half}|`)) inLog += runs

      let missing = 0
      for (const cell of line ?? []) {
        const k = halfKey(half, cell.inning)
        const short = (cell.runs ?? 0) - (byHalf.get(k) ?? 0)
        if (short > 0) { shortHalves.add(k); missing += short }
      }

      // Positive evidence only. No score published (an older row, or a caller holding a slice
      // of the season) leaves this false, and the game keeps the old behaviour of losing just
      // its last half-inning. Wrong in the safe direction: a smaller table, not a biased one.
      if (score != null) unplaced[half] = score - inLog - missing > 0
    }

    out.set(g.id, {
      final: g.status === 'final',
      scored: g.home_score != null && g.away_score != null,
      shortHalves,
      unplaced,
      homeNotBeaten: (g.home_score ?? 0) >= (g.away_score ?? 0),
    })
  }
  return out
}

/**
 * Split the play log into half-innings, in order, and say how each one sits in its game.
 *
 * HOW AN INNING ENDED IS TWO QUESTIONS, and neither is decided by reading outs off the last
 * play, which the data does not state. Every half-inning followed by another one in the same
 * game ended with three outs; the only one that might not is a game's last.
 *
 * For VALUING a play, what matters is whether the inning is over at all: a walk-off ends it
 * as surely as a third out, and in both cases nothing more could be expected, so zero is
 * right. `gameFinal` answers that, and it is why the schedule is consulted here beyond the
 * postseason filter at all.
 *
 * For MEASURING the table the question is narrower: are all the runs that followed each state
 * actually in the log? A walk-off inning stops because the winning run scored, so its runs are
 * censored by the end of the GAME rather than by the inning, and averaging it in drags every
 * state it contains downward.
 *
 * This used to answer that by dropping EVERY game's last half-inning, and that was not merely
 * cautious, it was BIASED, in the direction nobody was watching. Whether a half-inning ends a
 * game is not independent of the runs in it: a top of the 7th ends the game only if the side
 * batting failed to catch up, and a bottom of the 7th is followed by another inning only if
 * the game was still level after it. So the old rule kept the top 7ths that scored (0.75 runs
 * against 0.38 for the ones it dropped) and, for bottom 7ths, kept two half-innings in the
 * whole season, both of them scoreless by definition, to stand for every bottom of the 7th
 * played. The table came out about 4% high overall: 1.13 runs a half-inning against 1.08
 * measured on all of them, and 3.20 against 3.00 with the bases loaded and nobody out.
 *
 * The fix for a conditioned sample is not a better condition, it is to stop conditioning:
 * measure every half-inning whose runs are all in the log, last or not. So a last half-inning
 * is now measured when three things together rule censoring out:
 *
 *   1. the game is FINAL and its score is published, so nothing about it is still to come and
 *      there is something to check it against;
 *   2. no runs are missing from it or from its side of that game (`halfInningEndings`);
 *   3. it is a top half, or a bottom half the home side LOST. A walk-off is the one ending
 *      that stops a half-inning with runs still owed to it, and it takes the home side
 *      batting and finishing level or ahead. Stated as "the home side was beaten" rather than
 *      "the last play scored" so that a game called early with the home side up falls out
 *      too: same censoring, different cause.
 *
 * The season's first 21 games contain no walk-off at all, so in practice every last
 * half-inning is now measured, and the table went from 265 half-innings to 283 and from 1,407
 * plate appearances to 1,467. What is NOT measured, across the whole season, is one
 * half-inning: the top of the 7th on Aug 20, where the line score has a run the play log does
 * not. If the postseason produces a walk-off it comes out on evidence rather than on suspicion.
 *
 * Order is not assumed. The rows are sorted by (game, sequence) on the way in, because every
 * number below is a walk forward through an inning and a caller handing them over in some
 * other order would produce a plausible table rather than an error.
 */
function groupHalfInnings(
  plays: WpblRunValuePlay[],
  endings: Map<string, GameEnding>,
): HalfInning[] {
  const sorted = [...plays].sort((a, b) =>
    a.game_id === b.game_id ? a.sequence - b.sequence : (a.game_id < b.game_id ? -1 : 1))

  const out: HalfInning[] = []
  let current: HalfInning | null = null
  let key = ''
  for (const p of sorted) {
    const k = `${p.game_id}|${p.inning}|${p.half}`
    if (k !== key) {
      current = {
        gameId: p.game_id, plays: [], last: false, censored: false,
        gameFinal: endings.get(p.game_id)?.final ?? false,
      }
      out.push(current)
      key = k
    }
    current!.plays.push(p)
  }

  const lastOf = new Map<string, HalfInning>()
  for (const h of out) lastOf.set(h.gameId, h)
  for (const h of lastOf.values()) h.last = true

  for (const h of out) {
    const e = endings.get(h.gameId)
    const bottom = h.plays[0]?.half === 'bottom'
    // Missing runs, as narrowly as they can be placed: this half-inning is short of its own
    // line-score cell, or its SIDE of this game is short by runs no inning will own up to.
    // Everything else in a damaged game still counts, which is the whole point of asking the
    // line score rather than only the final score.
    if (e && (e.shortHalves.has(halfKey(bottom ? 'bottom' : 'top', h.plays[0]?.inning ?? 0)) ||
              e.unplaced[bottom ? 'bottom' : 'top'])) { h.censored = true; continue }
    if (!h.last) continue
    // In progress: this half-inning has not finished, whatever the score says. And with no
    // score published there is no way to tell a walk-off from a third out, so the last
    // half-inning of such a game stays out, which is where every game was before any of this.
    if (!e?.final || !e.scored) { h.censored = true; continue }
    h.censored = bottom && e.homeNotBeaten
  }
  return out
}

/** Runs scored from each play to the end of its half-inning, index-aligned with `plays`. */
function runsToEnd(plays: WpblRunValuePlay[]): number[] {
  const out = new Array<number>(plays.length + 1).fill(0)
  for (let i = plays.length - 1; i >= 0; i--) out[i] = out[i + 1] + runsOnPlay(plays[i])
  return out.slice(0, plays.length)
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
 * A half-inning a game stopped in the middle of is left out entirely: its runs are censored by
 * the end of the game rather than by the inning, so counting it would drag every state it
 * contains downward. Which last half-innings those actually are is `groupHalfInnings`, and it
 * is a narrower set than "all of them", which is what this used to assume.
 *
 * EXTRA INNINGS ARE LEFT OUT TOO, and that one is not obvious. This league starts them with a
 * runner already on second, and the feed records the placement as its own row whose base state
 * is still EMPTY, because a row's bases are the ones it began with. So an extra inning handed
 * the table a "nobody on, nobody out" observation that was followed by the runs of an inning
 * which did, in fact, have somebody on second. Six of those against 248 honest ones in the
 * cell the whole board leans on. They are 2% of the season's half-innings and they are not the
 * same game, so the walk skips them, and anything that needs to know what a free runner on
 * second is worth reads the cell for a runner on second, measured on regulation baseball.
 */
export function buildRunExpectancy(
  plays: WpblRunValuePlay[],
  games: RunValueGame[],
): ReTable {
  const inSeason = regularSeasonLines(plays, games)
  const halves = groupHalfInnings(inSeason, halfInningEndings(inSeason, games))

  const sums = Array.from({ length: 3 }, () => new Array<number>(8).fill(0))
  const counts = Array.from({ length: 3 }, () => new Array<number>(8).fill(0))
  const dists = Array.from({ length: 3 }, () =>
    Array.from({ length: 8 }, () => new Array<number>(DIST_MAX + 1).fill(0)))
  let pa = 0, measuredHalves = 0, runs = 0
  const gameIds = new Set<string>()

  for (const h of halves) {
    // Not "is it the last one" but "could it be short of runs": see `groupHalfInnings`.
    if (h.censored) continue
    if ((h.plays[0]?.inning ?? 0) > REGULATION_INNINGS) continue
    measuredHalves++
    gameIds.add(h.gameId)
    const rest = runsToEnd(h.plays)
    runs += rest[0] ?? 0
    for (let i = 0; i < h.plays.length; i++) {
      const p = h.plays[i]
      // A PITCH SEQUENCE ALONE IS NOT A PLATE APPEARANCE. The feed serves rows with a pitch
      // sequence and nothing else on it: no batter, no event, no narrative, outs frozen where
      // the last real row left them. Aug 20 has thirteen of them across the 6th and 7th, and
      // read as PAs they were thirteen observations of "nobody on, nobody out, no runs
      // followed" in the cell the whole board leans on. A row that names no batter is not a
      // trip to the plate, and the runner-advance rows that legitimately name none are not
      // either.
      if (!p.pitch_sequence || !p.batter_name) continue
      const outs = p.outs
      if (outs == null || outs < 0 || outs > 2) continue
      const bases = baseCode(p)
      sums[outs][bases] += rest[i]
      counts[outs][bases]++
      dists[outs][bases][Math.min(Math.max(rest[i], 0), DIST_MAX)]++
      pa++
    }
  }

  const cells = emptyCells()
  for (let o = 0; o < 3; o++) {
    for (let b = 0; b < 8; b++) {
      const n = counts[o][b]
      cells[o][b] = { re: n > 0 ? sums[o][b] / n : null, n, dist: dists[o][b] }
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
  const halves = groupHalfInnings(inSeason, halfInningEndings(inSeason, games))
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
/**
 * What the running game is worth to the league, priced on its own run environment.
 *
 * THE POINT OF THIS, AND WHY IT IS NOT A RATE. A stolen-base percentage says how often it
 * worked, never whether it was worth trying. Those are different questions and they come apart
 * here: a base gained is worth a little and an out given away is worth a lot, so the rate that
 * breaks even depends entirely on how much a run costs, and in a league scoring fifteen a game
 * an out is dear. The league runs at 82% and needs 86%, which no rate on any other board could
 * show, and which is only computable because the run-expectancy table exists.
 *
 * Priced from the PLAY ROWS rather than the box score's SB and CS columns, because the price is
 * a property of the state the play changed, and only the play knows that. A double steal is one
 * row and one price, which is right: it moved the bases once. It also means the attempt count
 * here is a shade under the box score's, which is why nothing on this card prints a league SB
 * total beside a player's.
 */
export interface StealEconomy {
  /** Attempts, as priced: rows, not runners, so a double steal counts once. */
  steals: number
  caught: number
  /** Runs added by the steals, and lost to the outs (negative), and the two together. */
  gained: number
  lost: number
  net: number
  /** What one of each is worth on average. `perCaught` is negative. */
  perSteal: number
  perCaught: number
  /** The share of attempts that has to succeed for the running game to be worth nothing at
   *  all, and the share that actually did. Null when there is not one of each yet, or when a
   *  steal is somehow not worth anything, which would make the question meaningless. */
  breakEven: number | null
  successRate: number | null
}

export function stealEconomy(values: PlayRunValue[]): StealEconomy {
  let steals = 0, caught = 0, gained = 0, lost = 0
  for (const v of values) {
    if (v.play.event_type === 'stolen_base') { steals++; gained += v.value }
    else if (v.play.event_type === 'caught_stealing') { caught++; lost += v.value }
  }
  const perSteal = steals > 0 ? gained / steals : 0
  const perCaught = caught > 0 ? lost / caught : 0
  const spread = perSteal - perCaught
  return {
    steals, caught, gained, lost, net: gained + lost, perSteal, perCaught,
    breakEven: steals > 0 && caught > 0 && perSteal > 0 && spread > 0 ? -perCaught / spread : null,
    successRate: steals + caught > 0 ? steals / (steals + caught) : null,
  }
}

/**
 * What each KIND of play has been worth this season: the league's own linear weights.
 *
 * The same numbers everyone quotes from the majors (a walk is worth about .3 of a run, a home
 * run about 1.4) computed on a seven-inning league that scores fifteen a game, where they are
 * not the same numbers. It is one `reduce` over values that are already computed, and until
 * now nothing showed it.
 *
 * A CURATED LIST, NOT EVERY `event_type`. The feed's vocabulary includes `unknown`, which is
 * 383 substitutions and runner advances, and several labels that mean the same thing to a
 * reader. A card that ranks "what a play is worth" cannot have a row called "unknown" on it,
 * and an allow-list also means a label the feed invents next week is left off rather than
 * shown raw. Anything named here that has not happened yet is simply absent from the result.
 */
export interface EventValue { event: string; label: string; n: number; total: number; per: number }

/** The events worth showing, in the order a reader thinks about them, with the words the
 *  narrative would use rather than the feed's snake_case. */
const EVENT_LABELS: readonly (readonly [string, string])[] = [
  ['home_run', 'Home run'], ['triple', 'Triple'], ['double', 'Double'], ['single', 'Single'],
  ['walk', 'Walk'], ['hit_by_pitch', 'Hit by pitch'], ['wild_pitch', 'Wild pitch'],
  ['stolen_base', 'Stolen base'], ['sacrifice', 'Sacrifice'],
  ['fielders_choice', "Fielder's choice"], ['groundout', 'Groundout'], ['flyout', 'Flyout'],
  ['popup', 'Pop up'], ['lineout', 'Lineout'], ['strikeout', 'Strikeout'],
  ['caught_stealing', 'Caught stealing'],
]

export function eventValues(values: PlayRunValue[], minPlays = 10): EventValue[] {
  const byEvent = new Map<string, { n: number; total: number }>()
  for (const v of values) {
    const k = v.play.event_type
    if (!k) continue
    const e = byEvent.get(k) ?? { n: 0, total: 0 }
    e.n++; e.total += v.value; byEvent.set(k, e)
  }
  const out: EventValue[] = []
  for (const [event, label] of EVENT_LABELS) {
    const e = byEvent.get(event)
    if (!e || e.n < minPlays) continue
    out.push({ event, label, n: e.n, total: e.total, per: e.total / e.n })
  }
  return out.sort((a, b) => b.per - a.per)
}

/** The runners themselves, from the box scores rather than the play log.
 *
 *  `wpbl_batting_lines` carries SB and CS per player per game and the play log names the
 *  runner only inside its prose, so this is the column that already exists against a sentence
 *  that would have to be parsed. It also keeps a player's steal count here identical to the
 *  one on the Players board, which is where a reader will go to check it.
 *
 *  Takes the schedule for the reason every aggregate here does: a line carries a `game_id` and
 *  cannot say by itself whether its game counts. */
export interface RunnerLine { player: WpblPlayer | null; name: string; sb: number; cs: number }

export function topRunners(
  lines: Pick<WpblBattingLine, 'game_id' | 'player_id' | 'sb' | 'cs'>[],
  games: WpblSeasonGame[],
  players: WpblPlayer[],
  limit = 5,
): RunnerLine[] {
  const byId = new Map(players.map(p => [p.id, p]))
  const rows = new Map<string, RunnerLine>()
  for (const l of regularSeasonLines(lines, games)) {
    const sb = l.sb ?? 0, cs = l.cs ?? 0
    if (sb === 0 && cs === 0) continue
    const player = byId.get(l.player_id) ?? null
    let row = rows.get(l.player_id)
    if (!row) rows.set(l.player_id, row = { player, name: player?.name ?? '', sb: 0, cs: 0 })
    row.sb += sb; row.cs += cs
  }
  return [...rows.values()]
    .filter(r => r.name)
    .sort((a, b) => (b.sb + b.cs) - (a.sb + a.cs) || b.sb - a.sb)
    .slice(0, limit)
}

/** `digits` is 2 for the value of ONE play, where the whole point is often the gap between two
 *  of them: a strikeout and a groundout are -0.52 and -0.43, and at one decimal that reading
 *  is a rounding artefact. Season totals stay at 1, where a second decimal is noise. */
export function fmtRunValue(v: number | null | undefined, digits: 1 | 2 = 1): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const scale = digits === 2 ? 100 : 10
  const r = Math.round(v * scale) / scale
  // Keeps "-0.0" off the board, which reads as a measurement of nothing.
  const z = Object.is(r, -0) ? 0 : r
  return `${z > 0 ? '+' : ''}${z.toFixed(digits)}`
}

/** Two decimals, no sign: the table's own cells are expectations, not changes. */
export function fmtRe(v: number | null): string {
  return v == null ? '—' : v.toFixed(2)
}

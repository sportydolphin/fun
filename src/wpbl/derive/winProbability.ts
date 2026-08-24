import { runsOnPlay } from './playByPlay'
import {
  baseCode, buildRunExpectancy, DIST_MAX, REGULATION_INNINGS,
  type BaseCode, type ReTable, type RunValueGame,
} from './runExpectancy.ts'
import type { WpblGame, WpblRunValuePlay } from '../types'

/**
 * Win probability, and what each play did to it, from this league's own plays.
 *
 * WHY THIS IS POSSIBLE WITH NO HISTORY. The usual way to get win probability is to look up
 * how often teams in this exact situation went on to win, across decades of games. That is
 * out of reach here by three orders of magnitude: the state space is inning x half x outs x
 * eight base states x score margin, about seven thousand cells, and the league has played
 * 1,820 plays in total. Any cell-by-cell estimate would be one game's worth of noise.
 *
 * So nothing here is looked up. Two DISTRIBUTIONS are measured, both of which the
 * run-expectancy walk already produces, and the rest is arithmetic:
 *
 *   1. how many runs a half-inning still produces from each base-out state (`ReCell.dist`)
 *   2. how many a whole one produces, which is the same thing from nobody on, nobody out
 *
 * Given those, win probability is exact. Work backwards from the last out, and at each
 * half-inning convolve the run distribution against the win probability of every score the
 * next half could start from. No simulation, no sampling noise, no seed: the same game state
 * always returns the same number, which matters for a chart somebody might screenshot.
 *
 * WHAT IT DOES NOT KNOW. It is team-neutral, like every published win-probability model: it
 * has no idea who is pitching, who is up, or that one club has outscored the league by fifty
 * runs. It is a statement about the situation, not about the two teams in it. And the
 * distributions behind it come from 263 half-innings, so the tail is thin, which is why the
 * runs axis is capped (see DIST_MAX) rather than pretending to know the shape of a nine-run
 * inning. Both of those belong on any surface that draws this.
 *
 * PURE. Arrays in, plain shapes out, no supabase and no React, like the rest of the derive
 * layer. The `.ts` on the import above is deliberate: see the note in CLAUDE.md.
 */

/** Score margins the table is built over, from the home team's side. A seven-inning league
 *  that scores fifteen a game does produce double-digit margins; past this the answer is 0 or
 *  1 to more decimal places than anyone needs. */
const MAX_MARGIN = 15
const MARGINS = MAX_MARGIN * 2 + 1

/** The state an extra inning starts from: this league places a runner on second. Both halves
 *  of every extra inning begin there, which is why extras need no distribution of their own. */
const EXTRA_START: BaseCode = 2

export interface WinProbModel {
  /** P(home team wins) before a play, by [inning-1][half][outs][bases][margin + MAX_MARGIN].
   *  Regulation innings only; extras are the fixed point below. */
  readonly reg: Float64Array
  /** The same for a generic extra inning, which is the same every time: [half][outs][bases][margin]. */
  readonly extra: Float64Array
  /** The table it was built from, so a surface can say how thin the sample is. */
  readonly table: ReTable
}

const HALVES = 2, OUTS = 3, BASES = 8
const regIndex = (inning: number, half: number, outs: number, bases: number, m: number) =>
  ((((inning - 1) * HALVES + half) * OUTS + outs) * BASES + bases) * MARGINS + m + MAX_MARGIN
const extraIndex = (half: number, outs: number, bases: number, m: number) =>
  (((half * OUTS) + outs) * BASES + bases) * MARGINS + m + MAX_MARGIN

const clampMargin = (m: number) => (m > MAX_MARGIN ? MAX_MARGIN : m < -MAX_MARGIN ? -MAX_MARGIN : m)

/** A cell's histogram as probabilities, falling back to the whole-inning shape when a state is
 *  too rare to have one of its own. A cell with two observations is worse than no cell. */
function probsOf(table: ReTable, outs: number, bases: number, fallback: number[]): number[] {
  const cell = table.cells[outs][bases]
  if (cell.n < 5) return fallback
  const out = new Array<number>(DIST_MAX + 1)
  for (let r = 0; r <= DIST_MAX; r++) out[r] = cell.dist[r] / cell.n
  return out
}

/**
 * Build the model.
 *
 * THE WALK-OFF NEEDS NO SPECIAL CASE, which is the one thing about this that looks wrong and
 * is not. A home team batting last stops the moment it goes ahead, so its inning is cut short
 * and the runs it "would have" scored never happen. That truncation cannot change WHO won:
 * runs only accumulate, so the home team ends an uninterrupted inning ahead exactly when it
 * would have gone ahead at some point during it. Since this model is only ever asked for the
 * probability of winning, the uninterrupted distribution is the right one to convolve, and
 * the score it implies is simply never rendered.
 */
export function buildWinProbModel(plays: WpblRunValuePlay[], games: RunValueGame[]): WinProbModel {
  const table = buildRunExpectancy(plays, games)
  const leadoff = table.cells[0][0]
  const wholeInning: number[] = new Array(DIST_MAX + 1).fill(0)
  if (leadoff.n > 0) for (let r = 0; r <= DIST_MAX; r++) wholeInning[r] = leadoff.dist[r] / leadoff.n
  else wholeInning[0] = 1

  // Every state's run distribution, resolved once.
  const dist: number[][][] = Array.from({ length: OUTS }, (_, o) =>
    Array.from({ length: BASES }, (_, b) => probsOf(table, o, b, wholeInning)))

  const reg = new Float64Array(REGULATION_INNINGS * HALVES * OUTS * BASES * MARGINS)
  const extra = new Float64Array(HALVES * OUTS * BASES * MARGINS)

  // ── Extras first, because regulation ends by handing a tie to them ──────────────
  //
  // An extra inning looks exactly like the one before it, so its value is a fixed point:
  // the chance the home team wins from a tie at the top of one depends on the chance it wins
  // from a tie at the top of the NEXT one. Iterating converges geometrically, at the rate
  // both halves score the same number of runs, which is well under a half here. Fifty passes
  // is far past the point where it stops moving in double precision.
  let tieValue = 0.5
  for (let pass = 0; pass < 50; pass++) {
    // Bottom of an extra inning: the home team is done the moment it leads.
    for (let o = 0; o < OUTS; o++) {
      for (let b = 0; b < BASES; b++) {
        const d = dist[o][b]
        for (let m = -MAX_MARGIN; m <= MAX_MARGIN; m++) {
          let p = 0
          for (let r = 0; r <= DIST_MAX; r++) {
            if (!d[r]) continue
            const y = m + r
            p += d[r] * (y > 0 ? 1 : y < 0 ? 0 : tieValue)
          }
          extra[extraIndex(1, o, b, m)] = p
        }
      }
    }
    // Top of an extra inning: the away team bats, then the home team gets its half.
    for (let o = 0; o < OUTS; o++) {
      for (let b = 0; b < BASES; b++) {
        const d = dist[o][b]
        for (let m = -MAX_MARGIN; m <= MAX_MARGIN; m++) {
          let p = 0
          for (let r = 0; r <= DIST_MAX; r++) {
            if (!d[r]) continue
            p += d[r] * extra[extraIndex(1, 0, EXTRA_START, clampMargin(m - r))]
          }
          extra[extraIndex(0, o, b, m)] = p
        }
      }
    }
    const next = extra[extraIndex(0, 0, EXTRA_START, 0)]
    if (Math.abs(next - tieValue) < 1e-12) { tieValue = next; break }
    tieValue = next
  }

  // ── Regulation, backwards from the seventh ─────────────────────────────────────
  for (let inning = REGULATION_INNINGS; inning >= 1; inning--) {
    const last = inning === REGULATION_INNINGS
    // Bottom half.
    for (let o = 0; o < OUTS; o++) {
      for (let b = 0; b < BASES; b++) {
        const d = dist[o][b]
        for (let m = -MAX_MARGIN; m <= MAX_MARGIN; m++) {
          let p = 0
          for (let r = 0; r <= DIST_MAX; r++) {
            if (!d[r]) continue
            const y = clampMargin(m + r)
            p += d[r] * (last
              ? (y > 0 ? 1 : y < 0 ? 0 : tieValue)
              : reg[regIndex(inning + 1, 0, 0, 0, y)])
          }
          reg[regIndex(inning, 1, o, b, m)] = p
        }
      }
    }
    // Top half. A home team already ahead after it does not bat, which is the only place the
    // format shows up in the arithmetic.
    for (let o = 0; o < OUTS; o++) {
      for (let b = 0; b < BASES; b++) {
        const d = dist[o][b]
        for (let m = -MAX_MARGIN; m <= MAX_MARGIN; m++) {
          let p = 0
          for (let r = 0; r <= DIST_MAX; r++) {
            if (!d[r]) continue
            const y = clampMargin(m - r)
            p += d[r] * (last && y > 0 ? 1 : reg[regIndex(inning, 1, 0, 0, y)])
          }
          reg[regIndex(inning, 0, o, b, m)] = p
        }
      }
    }
  }

  return { reg, extra, table }
}

/** P(home wins) from a state, before the play. `margin` is home runs less away runs so far. */
export function winProbability(
  model: WinProbModel,
  inning: number,
  half: 'top' | 'bottom',
  outs: number,
  bases: BaseCode,
  margin: number,
): number {
  const h = half === 'bottom' ? 1 : 0
  const o = Math.min(Math.max(outs, 0), 2)
  const m = clampMargin(margin)
  return inning > REGULATION_INNINGS
    ? model.extra[extraIndex(h, o, bases, m)]
    : model.reg[regIndex(Math.max(inning, 1), h, o, bases, m)]
}

// ── One game, play by play ───────────────────────────────────────────────────────

export interface WinProbPoint {
  play: WpblRunValuePlay
  /** P(home wins) before the play, and after it. */
  before: number
  after: number
  /** after - before, from the HOME team's side. A play good for the away team is negative. */
  swing: number
  /** Runs the play put on the board, from `runsOnPlay`, never the feed's column. */
  runs: number
  /** Home runs less away runs, before the play. */
  margin: number
  /** The scoreboard AFTER the play, summed from `runsOnPlay` the same way the margin is.
   *  A play row does not carry the score, and a surface that shows one moment of a game
   *  wants it: 60% means something different at 1-0 than at 8-7. */
  homeScore: number
  awayScore: number
}

export interface GameWinProb {
  points: WinProbPoint[]
  /**
   * The play that did most to win it: the largest swing TOWARD the team that actually won.
   *
   * Not the largest swing full stop, which is `biggest` below and is a different question
   * with a worse answer. A game can be turned by a three-run homer and then lost anyway, and
   * "swing of the game" over a sentence about the losing team going from 70% to 30% reads as
   * a mistake. This is the play a broadcast would call the play of the game.
   *
   * Null until the game is final, because until then there is no winner to swing towards.
   */
  decisive: WinProbPoint | null
  /** The play that moved it furthest in either direction. The most VOLATILE moment, which in
   *  a one-run game is usually the last out. Kept for a live game, which has no winner yet. */
  biggest: WinProbPoint | null
  /** Every step added up, ignoring direction: how much this game moved in total. The
   *  season's tightest game and its 12-run walkover differ by a factor of five on this. */
  excitement: number
  /** Where it finished, or where it stands. */
  final: number
}

/** What the walk needs to know about the game itself, as opposed to its plays. */
export type GameForWinProb =
  Pick<WpblGame, 'home_team_id' | 'status' | 'home_score' | 'away_score'>

/**
 * Walk one game and price every play.
 *
 * THE SCORE IS RECONSTRUCTED, not read. A play row carries the state it began with but not the
 * scoreboard, so the margin comes from summing `runsOnPlay()` forward. That is the same
 * function the run-value board uses and the same reason: the feed's `runs_scored` does not
 * count the batter, so a solo home run reads as zero (see CLAUDE.md).
 *
 * A play's "after" is the next play's "before", exactly as in `playRunValues`, except at the
 * end of the game, where the result is known and the probability is 1 or 0 rather than a
 * model output. Anything else would leave a chart whose last point disagreed with the score.
 */
export function gameWinProb(
  model: WinProbModel,
  plays: WpblRunValuePlay[],
  game: GameForWinProb,
): GameWinProb {
  const homeTeamId = game.home_team_id
  const isFinal = game.status === 'final'
  const ordered = [...plays].sort((a, b) => a.sequence - b.sequence)
  const points: WinProbPoint[] = []
  let home = 0, away = 0

  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i]
    const outs = p.outs
    if (outs == null || outs < 0 || outs > 2) continue
    const runs = runsOnPlay(p)
    const margin = home - away
    const before = winProbability(model, p.inning, p.half === 'bottom' ? 'bottom' : 'top', outs, baseCode(p), margin)

    if (p.team_id === homeTeamId) home += runs
    else away += runs

    points.push({ play: p, before, after: before, swing: 0, runs, margin, homeScore: home, awayScore: away })
  }

  // Is the log the whole game? A final game whose last recorded play is in the seventh or
  // later is; one that stops earlier is a log the feed never finished. Both exist: on Aug 19
  // the 11-8 at San Francisco has 83 plays and ends in the bottom of the sixth.
  //
  // THAT DISTINCTION HAS TO BE MADE HERE, because the line is snapped to the result at the
  // end, and snapping a game that is missing its last inning does not tidy the chart, it
  // invents a play. San Francisco's last recorded out was a routine fly ball, and pinning the
  // result to it credited that fly ball with a 28-point swing and made it, by a distance, the
  // biggest play of the game. A chart that stops where the evidence stops is the honest
  // ending; a fabricated cliff is not.
  const lastPlay = points[points.length - 1]
  const complete = isFinal && (lastPlay?.play.inning ?? 0) >= REGULATION_INNINGS
  const homeWon = (game.home_score ?? home) > (game.away_score ?? away)
  const tied = (game.home_score ?? home) === (game.away_score ?? away)

  // Second pass for `after`, so each play is valued by the state its successor actually
  // reached rather than by a guess at where the runners ended up.
  for (let i = 0; i < points.length; i++) {
    const next = points[i + 1]
    if (next) points[i].after = next.before
    else points[i].after = complete ? (tied ? 0.5 : homeWon ? 1 : 0) : points[i].before
    points[i].swing = points[i].after - points[i].before
  }

  let biggest: WinProbPoint | null = null
  let decisive: WinProbPoint | null = null
  let excitement = 0
  // Toward the winner: the home team's swing as it stands, or its negation when the visitors
  // won, so "best" is one comparison either way.
  const towardWinner = (pt: WinProbPoint) => (homeWon ? pt.swing : -pt.swing)
  for (const pt of points) {
    excitement += Math.abs(pt.swing)
    if (!biggest || Math.abs(pt.swing) > Math.abs(biggest.swing)) biggest = pt
    if (isFinal && !tied && towardWinner(pt) > 0
      && (!decisive || towardWinner(pt) > towardWinner(decisive))) decisive = pt
  }

  return {
    points,
    decisive,
    biggest,
    excitement,
    final: points.length > 0 ? points[points.length - 1].after : 0.5,
  }
}

/** "34%" — the only rounding anyone should see. A win model that prints a decimal place is
 *  claiming a precision 263 half-innings cannot support. */
export function fmtWinPct(p: number): string {
  return `${Math.round(p * 100)}%`
}

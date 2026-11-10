import { baseCode, playRunValues, type BaseCode, type RunValueGame } from './runExpectancy.ts'
import { gameWinProb, winProbability, type WinProbModel, type WinProbPoint } from './winProbability.ts'
import { REGULATION_INNINGS } from '../innings'
import { countsInStandings } from '../../league/season.ts'
import type { WpblRunValuePlay } from '../types'

/**
 * Leverage index: how much the game can swing on the next plate appearance, against the average
 * one. 1.0 is a typical plate appearance, 2.0 twice the usual stakes, 0.2 a rout.
 *
 * THE DEFINITION IS TANGO'S, so the number means what it means everywhere else: the expected
 * ABSOLUTE change in win probability over every way the plate appearance could end, divided by
 * the same expectation averaged over every plate appearance in the league. Absolute, because a
 * strikeout and a double in the same spot are both what makes it tense.
 *
 * THE WAYS A PLATE APPEARANCE ENDS ARE THIS LEAGUE'S OWN. From each of the 24 base-out states,
 * the play log says where the next row stood and how many scored (`playRunValues`, which reads the
 * next row's state rather than parsing prose). Those transitions are pooled over every inning and
 * score, which is the standard simplification and the only affordable one: the win model already
 * showed the full state space is three orders of magnitude bigger than the log. Each transition is
 * then priced by the win model at the inning and margin actually in question, so the scoreboard
 * still decides everything. A seven-inning league with a runner on second in extras gets its own
 * numbers from both halves for free.
 *
 * WHY NOT BORROW A TABLE. A major-league LI table is built on 0.5 runs from nobody on, nobody out;
 * this league is 1.13, and on nine innings, not seven. A sixth-inning tie here is a seventh or an
 * eighth there. Nothing borrowed would be right.
 *
 * PURE, like the rest of the derive layer, and the `.ts` imports are deliberate (CLAUDE.md).
 */

/** One way a plate appearance from a given state ended, and how often. */
interface Transition {
  /** Outs and bases handed on, or null when the play ended the half-inning. */
  outs: number | null
  bases: BaseCode
  runs: number
  p: number
}

export interface LeverageModel {
  wp: WinProbModel
  /** [outs][bases]: every observed outcome, as probabilities. Empty for a state the log never saw. */
  transitions: Transition[][][]
  /** The league's average expected swing per plate appearance: the denominator of every index. */
  mean: number
}

const half01 = (half: string | null | undefined): 'top' | 'bottom' => (half === 'bottom' ? 'bottom' : 'top')

/** Where the next half-inning starts: this league puts a runner on second in extras. */
const startBases = (inning: number): BaseCode => (inning > REGULATION_INNINGS ? 2 : 0)

/**
 * P(home wins) after one outcome. The three places the game can END on a play are priced as the
 * result, not as a model cell, because a cell for "bottom of the seventh, home ahead" does not
 * exist in the sense that matters: nobody bats in it.
 */
function afterWp(
  wp: WinProbModel, inning: number, half: 'top' | 'bottom', margin: number, t: Transition,
): number {
  const m = half === 'bottom' ? margin + t.runs : margin - t.runs
  const late = inning >= REGULATION_INNINGS
  // A walk-off: the home team stops the moment it leads.
  if (half === 'bottom' && late && m > 0) return 1
  if (t.outs != null) return winProbability(wp, inning, half, t.outs, t.bases, m)
  // The half is over.
  if (half === 'top') {
    // A home team ahead after the top of the last inning does not bat.
    if (late && m > 0) return 1
    return winProbability(wp, inning, 'bottom', 0, startBases(inning), m)
  }
  if (late && m !== 0) return m > 0 ? 1 : 0
  return winProbability(wp, inning + 1, 'top', 0, startBases(inning + 1), m)
}

/** The expected absolute swing from a state, before dividing by the league's mean. */
function rawLeverage(
  model: Pick<LeverageModel, 'wp' | 'transitions'>,
  inning: number, half: 'top' | 'bottom', outs: number, bases: BaseCode, margin: number,
): number {
  const ts = model.transitions[outs]?.[bases]
  if (!ts || ts.length === 0) return 0
  const before = winProbability(model.wp, inning, half, outs, bases, margin)
  let s = 0
  for (const t of ts) s += t.p * Math.abs(afterWp(model.wp, inning, half, margin, t) - before)
  return s
}

/**
 * Build the leverage model from the same plays and schedule as the win model it sits on. The
 * mean is taken over every regular-season plate appearance in that log, at the state it was
 * actually played in, so the league's average plate appearance is 1.00 by construction.
 */
export function buildLeverageModel(
  wp: WinProbModel, plays: WpblRunValuePlay[], games: RunValueGame[],
): LeverageModel {
  const counts: Map<string, { t: Omit<Transition, 'p'>; n: number }>[][] =
    Array.from({ length: 3 }, () => Array.from({ length: 8 }, () => new Map()))
  for (const v of playRunValues(plays, games, wp.table)) {
    if (!(v.pa ?? !!v.play.pitch_sequence)) continue
    const key = `${v.afterOuts ?? 'x'}|${v.afterBases ?? 0}|${v.runs}`
    const cell = counts[v.outs][v.bases]
    const hit = cell.get(key)
    if (hit) hit.n++
    else cell.set(key, { t: { outs: v.afterOuts, bases: v.afterBases ?? 0, runs: v.runs }, n: 1 })
  }
  const transitions = counts.map(row => row.map(cell => {
    let n = 0
    for (const c of cell.values()) n += c.n
    return [...cell.values()].map(c => ({ ...c.t, p: c.n / n }))
  }))

  const partial = { wp, transitions }
  let sum = 0, n = 0
  for (const pt of regularSeasonPoints(wp, plays, games)) {
    if (!pt.play.pitch_sequence) continue
    sum += rawAt(partial, pt)
    n++
  }
  return { wp, transitions, mean: n > 0 ? sum / n : 0 }
}

function rawAt(model: Pick<LeverageModel, 'wp' | 'transitions'>, pt: WinProbPoint): number {
  const p = pt.play
  return rawLeverage(model, p.inning, half01(p.half), pt.play.outs ?? 0, baseCode(p), pt.margin)
}

/** Every priced play of every regular-season final, game by game, with the schedule row. */
function* regularSeasonPoints(
  wp: WinProbModel, plays: WpblRunValuePlay[], games: RunValueGame[],
): Generator<WinProbPoint & { game: RunValueGame }> {
  const byGame = new Map<string, WpblRunValuePlay[]>()
  for (const p of plays) {
    const arr = byGame.get(p.game_id)
    if (arr) arr.push(p); else byGame.set(p.game_id, [p])
  }
  for (const g of games) {
    if (g.status !== 'final' || !countsInStandings(g)) continue
    const gp = byGame.get(g.id)
    if (!gp?.length) continue
    for (const pt of gameWinProb(wp, gp, g).points) yield { ...pt, game: g }
  }
}

/** The index at a state. `margin` is home runs less away runs, before the play. */
export function leverageIndex(
  model: LeverageModel, inning: number, half: 'top' | 'bottom', outs: number, bases: BaseCode, margin: number,
): number {
  if (model.mean <= 0) return 1
  return rawLeverage(model, inning, half, Math.min(Math.max(outs, 0), 2), bases, margin) / model.mean
}

/** The index of the state a priced play began in. */
export function leverageOfPoint(model: LeverageModel, pt: WinProbPoint): number {
  return model.mean > 0 ? rawAt(model, pt) / model.mean : 1
}

/**
 * The words a broadcast would use, on Tango's own bands: under 0.85 low, 2.0 and up high. A
 * label, so a surface never has to pick its own cutoffs.
 */
export function leverageBand(li: number): 'Low' | 'Medium' | 'High' {
  return li >= 2 ? 'High' : li < 0.85 ? 'Low' : 'Medium'
}

/** "1.84": two places, as every published leverage index prints it. */
export function fmtLeverage(li: number | null | undefined): string {
  return li == null || !Number.isFinite(li) ? '—' : li.toFixed(2)
}

// ─── By player ────────────────────────────────────────────────────────────────

export interface LeverageLine {
  /** Plate appearances, batted or faced. */
  pa: number
  /** Average leverage of those plate appearances: pLI. */
  pli: number
  /** Relief appearances, and the leverage of the first batter faced in each: gmLI. A pitcher who
   *  only ever started has none, and a null, since a starter does not choose the moment. */
  reliefApps: number
  gmli: number | null
}

/**
 * pLI for every hitter or pitcher, and gmLI for every reliever, keyed by player id. A plate
 * appearance belongs to its batter and its pitcher, as in `wpaLeaders`; a row with no id is
 * nobody's here, because a name with no page has nowhere to show the number.
 *
 * gmLI is the reliever's number because it is the MANAGER'S choice: the leverage of the moment a
 * pitcher was sent in, which is how a bullpen's pecking order shows up in the numbers. A starter
 * enters the first inning of a tie every time and would read 0.9 forever.
 */
export function leverageLines(
  model: LeverageModel, plays: WpblRunValuePlay[], games: RunValueGame[], side: 'hitting' | 'pitching',
): Map<string, LeverageLine> {
  const acc = new Map<string, { pa: number; sum: number; apps: number; entry: number }>()
  const row = (id: string) => {
    let r = acc.get(id)
    if (!r) acc.set(id, r = { pa: 0, sum: 0, apps: 0, entry: 0 })
    return r
  }
  // Per game and fielding side: the pitchers already seen, the first of them being the starter.
  let gameId: string | null = null
  let seen = new Map<string, Set<string>>()
  for (const pt of regularSeasonPoints(model.wp, plays, games)) {
    const p = pt.play
    if (!p.pitch_sequence) continue
    if (pt.game.id !== gameId) { gameId = pt.game.id; seen = new Map() }
    const li = leverageOfPoint(model, pt)
    if (side === 'hitting') {
      if (!p.batter_id) continue
      const r = row(p.batter_id); r.pa++; r.sum += li
      continue
    }
    if (!p.pitcher_id) continue
    const r = row(p.pitcher_id); r.pa++; r.sum += li
    const fielding = p.team_id === pt.game.home_team_id ? 'home' : 'away'
    let used = seen.get(fielding)
    if (!used) seen.set(fielding, used = new Set())
    if (!used.has(p.pitcher_id)) {
      if (used.size > 0) { r.apps++; r.entry += li }
      used.add(p.pitcher_id)
    }
  }
  const out = new Map<string, LeverageLine>()
  for (const [id, r] of acc) {
    out.set(id, { pa: r.pa, pli: r.sum / r.pa, reliefApps: r.apps, gmli: r.apps > 0 ? r.entry / r.apps : null })
  }
  return out
}

/**
 * The model, built once per play log, for the same reason and with the same key as
 * `winProbModel`: the log is one cached array for the session.
 */
let cached: { wp: WinProbModel; plays: unknown; model: LeverageModel } | null = null
export function leverageModel(wp: WinProbModel, plays: WpblRunValuePlay[], games: RunValueGame[]): LeverageModel {
  if (cached && cached.wp === wp && cached.plays === plays) return cached.model
  const model = buildLeverageModel(wp, plays, games)
  cached = { wp, plays, model }
  return model
}

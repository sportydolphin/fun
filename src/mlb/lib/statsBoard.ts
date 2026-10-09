import type { LeaderboardEntry, StatDef } from '../types'
import { parseIP } from './utils'

// The arithmetic of the Stats board, kept out of the component so the phone's ranked list and
// the desktop grid are provably ranking the same rows, and so a test can reach it.

export type StatsGroup = 'hitting' | 'pitching'

/** A leaderboard row with the number it was ranked on. */
export type RankedEntry = LeaderboardEntry & { _v: number }

/** How many rows a phone's list shows before it asks. Ten is a leaderboard; fifty is a directory,
 *  and everything under an uncapped list (the sort control's footer, the switch to the grid) ends
 *  up two thousand pixels down where nobody finds it. */
export const LIST_CAP = 10

/** The number a stat is ranked on: `leaderValue` where the display value is a string ("12-5"). */
export function rankValue(def: StatDef, stat: unknown): number {
  return Number(def.leaderValue ? def.leaderValue(stat) : def.getValue(stat))
}

/** Rows with a rankable value for `def`, best end first for `asc` false. NaN is dropped rather
 *  than sorted: a "—" has no place on a leaderboard, and `NaN - x` makes a comparator
 *  inconsistent, which scrambles the rows around it. */
export function sortBoard(entries: LeaderboardEntry[], def: StatDef, asc: boolean): RankedEntry[] {
  return entries
    .map(e => ({ ...e, _v: rankValue(def, e.stat) }))
    .filter(e => !isNaN(e._v))
    .sort((a, b) => (asc ? a._v - b._v : b._v - a._v))
}

/** A row's place on the board, and whether it shares it. */
export interface RankMark { n: number; tied: boolean }

/** Competition ranking over values already in rank order: 1, T-2, T-2, 4. The table numbers rows
 *  by position, which is right for a grid you read across; a list that prints "3" beside two
 *  players on 40 home runs is claiming one of them is better. */
export function rankMarks(values: number[]): RankMark[] {
  const out: RankMark[] = []
  values.forEach((v, i) => {
    const firstOfRun = i > 0 && values[i - 1] === v ? out[i - 1].n : i + 1
    out.push({ n: firstOfRun, tied: false })
  })
  const count = new Map<number, number>()
  out.forEach(m => count.set(m.n, (count.get(m.n) ?? 0) + 1))
  return out.map(m => ({ n: m.n, tied: (count.get(m.n) ?? 0) > 1 }))
}

// What a row says under the name. A leaderboard answers "how good" with the big number, and the
// player page behind one tap answers the rest, so this is three supporting numbers and no more.
const CONTEXT_ORDER: Record<StatsGroup, string[]> = {
  hitting:  ['ops', 'avg', 'hr', 'rbi', 'sb'],
  pitching: ['era', 'whip', 'ip', 'k'],
}

/** The supporting stats for a list ranked by `sortKey`: the preference order minus the stat that
 *  is already the big number, so the row never says the same figure twice. */
export function contextKeys(group: StatsGroup, sortKey: string): string[] {
  return CONTEXT_ORDER[group].filter(k => k !== sortKey).slice(0, 3)
}

/** Whether `asc` is the order a reader would call "best first" for this stat. ERA and WHIP are
 *  the reason this is a function: best is the SMALL end, and "ascending" is a fact about the sort
 *  rather than what the reader wants. */
export const isBestFirst = (def: StatDef, asc: boolean): boolean => asc === (def.lowerIsBetter ?? false)

/** The `asc` that puts the best (or worst) end first. */
export const ascFor = (def: StatDef, bestFirst: boolean): boolean => (def.lowerIsBetter ?? false) === bestFirst

/** A number the way StatsAPI prints a rate: ".245", "1.012", "3.85". */
const apiRate = (n: number, places: number): string => {
  const s = n.toFixed(places)
  return s.startsWith('0.') ? s.slice(1) : s
}

/**
 * THE LEAGUE'S OWN LINE for the rate columns, as a stat object the board's defs read like any
 * player's, so the table's header can print the league average under each label (WPBL's table
 * does). Counting columns get nothing: a league total of home runs is not an average of anything.
 *
 * Summed from the board's own rows, which is only right because a season board's rows are the
 * whole league: `fetchSeasonPlayerStats` asks for playerPool=All, and on Oct 9, 2026 those rows
 * summed to the 30 clubs' totals exactly (163,329 at-bats, 39,849 hits). Never call it on a
 * career board, whose rows are a union of leaders and would print the leaders' average.
 */
export function leagueLine(entries: LeaderboardEntry[], group: StatsGroup): Record<string, string> | null {
  const sum = (k: string) => entries.reduce((n, e) => n + (Number((e.stat as Record<string, unknown>)?.[k]) || 0), 0)
  if (group === 'hitting') {
    const ab = sum('atBats'), h = sum('hits'), bb = sum('baseOnBalls'), hbp = sum('hitByPitch'), sf = sum('sacFlies')
    const tb = h + sum('doubles') + 2 * sum('triples') + 3 * sum('homeRuns')
    const obpDen = ab + bb + hbp + sf
    if (!ab || !obpDen) return null
    const obp = (h + bb + hbp) / obpDen, slg = tb / ab
    return { avg: apiRate(h / ab, 3), obp: apiRate(obp, 3), slg: apiRate(slg, 3), ops: apiRate(obp + slg, 3) }
  }
  const ip = entries.reduce((n, e) => n + parseIP((e.stat as Record<string, unknown>)?.inningsPitched), 0)
  if (!ip) return null
  return {
    era: apiRate(9 * sum('earnedRuns') / ip, 2),
    whip: apiRate((sum('baseOnBalls') + sum('hits')) / ip, 2),
    strikeoutsPer9Inn: apiRate(9 * sum('strikeOuts') / ip, 2),
  }
}

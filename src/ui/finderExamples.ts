import type { FinderCondition } from '../league/finder'
import type { FinderExample } from './finderBoard'

/**
 * THE EXAMPLES FIT WHAT HAPPENED. A fixed bar written before a season has been played reads "0 games"
 * as often as not: on the 2026 WPBL board, 8+ strikeouts, 6+ IP with no runs, 4+ wins, 30+ strikeouts
 * and 30+ innings all found nobody, five tiles saying "this board has nothing" (Nov 9, 2026). A
 * laddered example tries its bars from the most impressive down and shows the highest one that at
 * least two lines reach, or one, or failing that its last. So the tile names the best the slice on
 * screen actually holds, and moves with it: a club picked, a year changed, the playoffs on.
 *
 * NO TILE IS DROPPED, even at zero: the counts land after the grid draws, and a tile leaving would
 * reflow it. Only the words change. A fixed example (Immaculate, Walk-offs) is a yes-or-no question
 * whose zero is itself the answer.
 */

export interface ExampleLadder {
  /** Which condition the bar is. The first unless said. */
  at?: number
  /** The bars, the most impressive first, in the engine's stored units (outs, last printed digit). */
  values: number[]
  label: (value: number) => string
}

/** The example at one bar of its ladder. */
export function atRung(ex: FinderExample, value: number): FinderExample {
  const ladder = ex.ladder!
  const at = ladder.at ?? 0
  const conditions: FinderCondition[] = ex.conditions.map((c, i) => (i === at ? { ...c, value } : c))
  return { ...ex, label: ladder.label(value), conditions }
}

/**
 * Each example at the bar the counts favor, with its count. `count` runs one example in the slice on
 * screen, or says null while it cannot (the play log not read yet): then the example stays as written.
 */
export function fitExamples(examples: FinderExample[], count: (ex: FinderExample) => number | null): { ex: FinderExample; n: number | null }[] {
  return examples.map(ex => {
    if (!ex.ladder) return { ex, n: count(ex) }
    const rungs = ex.ladder.values.map(v => {
      const r = atRung(ex, v)
      return { ex: r, n: count(r) }
    })
    if (rungs.some(r => r.n == null)) return { ex, n: count(ex) }
    const pick = rungs.find(r => r.n! >= 2) ?? rungs.find(r => r.n! >= 1) ?? rungs[rungs.length - 1]
    return pick
  })
}

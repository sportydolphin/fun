// THE NEAREST QUESTIONS THAT HAVE AN ANSWER, for a Find question that has none.
//
// "0 games" was a dead end (Nov 10, 2026 audit): "8 strikeouts and at most 1 walk" on Hitting, or one
// strikeout too many on Pitching, read exactly like "nobody has ever done this", and the way out was a
// guess at which control to move. So the board asks the engine a few questions next to the one that
// failed, and offers each that finds something, with its count:
//
//   1. the same question on the other sides ("Pitching"), which is the commonest miss of all;
//   2. each number eased one step at a time, to the first that finds anything ("Strikeouts ≥ 7");
//   3. each condition dropped, when there are two or more;
//   4. each who, where or when dropped ("Any opponent").
//
// LEAGUE-NEUTRAL, like the engine: the section hands in how to count a question (`count`), which is
// the same engine call that draws its board, so a suggestion's count is the board's own once tapped.
// A count the section cannot make without a read it has not done (the play log, for the other side)
// comes back null, and that suggestion is left out rather than guessed at.

import {
  describeFinderConditions, finderFields, finderLowerBetter, finderStep,
  type FinderBoardSide, type FinderCondition, type FinderQuery,
} from './finder'

export interface FinderNearMiss {
  /** What changed, as a chip says it: "Strikeouts ≥ 7", "Any opponent", "Pitching". */
  text: string
  side: FinderBoardSide
  query: FinderQuery
  total: number
}

/** How many steps a number is eased before giving up on it. */
const MAX_STEPS = 6
const SIDE_LABEL: Record<FinderBoardSide, string> = { hitting: 'Hitting', pitching: 'Pitching', fielding: 'Fielding' }

/** `c` eased `k` steps toward more matches, or null where it cannot go further (below zero, or an
 *  exact value other than none, which names a situation rather than a count: a 0-2 count, a walk-off). */
export function easeCondition(side: FinderBoardSide, c: FinderCondition, k: number): FinderCondition | null {
  const step = finderStep(side, c.field)
  if (c.op === 'gte') {
    const v = c.value - k * step
    return v > 0 ? { ...c, value: v } : null
  }
  if (c.op === 'lte') return { ...c, value: c.value + k * step }
  // Exactly none eases to at most a few; any other exact value is left alone.
  return c.value === 0 && !finderLowerBetter(side, c.field) ? { ...c, op: 'lte', value: k * step } : null
}

export function finderNearMisses(
  side: FinderBoardSide, query: FinderQuery, sides: readonly FinderBoardSide[],
  count: (side: FinderBoardSide, q: FinderQuery) => number | null, max = 4,
): FinderNearMiss[] {
  const out: FinderNearMiss[] = []
  const said = (conditions: FinderCondition[]) => describeFinderConditions(side, { conditions, per: query.per }, true).map(p => p.text).join(', ')
  const offer = (text: string, s: FinderBoardSide, q: FinderQuery): boolean => {
    const total = count(s, q)
    if (total == null || total <= 0) return false
    if (!out.some(o => o.text === text)) out.push({ text, side: s, query: q, total })
    return true
  }

  // The same question on another side first, where every stat in it means something there: asking a
  // pitcher's line on Hitting is the commonest way to get nothing.
  for (const s of sides) {
    if (s === side) continue
    const keys = new Set(finderFields(s, query.per).map(f => f.key))
    if (!query.conditions.length || !query.conditions.every(c => keys.has(c.field))) continue
    offer(SIDE_LABEL[s], s, { ...query, playerId: null, batterId: null, pitcherId: null })
  }
  // 2. Each number, eased to the first step that finds anything.
  query.conditions.forEach((c, i) => {
    for (let k = 1; k <= MAX_STEPS; k++) {
      const eased = easeCondition(side, c, k)
      if (!eased) break
      const q = { ...query, conditions: query.conditions.map((x, j) => (j === i ? eased : x)) }
      if (offer(said([eased]), side, q)) break
    }
  })
  // 3. Each condition dropped, where another is left to ask.
  if (query.conditions.length > 1) {
    query.conditions.forEach((c, i) => {
      offer(`Without ${said([c])}`, side, { ...query, conditions: query.conditions.filter((_, j) => j !== i) })
    })
  }
  // 4. Each who, where or when dropped.
  const scopes: [boolean, string, Partial<FinderQuery>][] = [
    [!!query.oppId, 'Any opponent', { oppId: null }],
    [!!query.teamId, 'Any club', { teamId: null }],
    [query.venue !== 'any', 'Home or away', { venue: 'any' }],
    [!!query.playerId, 'Any player', { playerId: null }],
    [!!query.pitcherId, 'Any pitcher', { pitcherId: null }],
    [!!query.batterId, 'Any batter', { batterId: null }],
    [!!query.last, 'Every game', { last: null }],
    [!!(query.from || query.to), 'Whole season', { from: null, to: null }],
    [!!query.hand, 'Either arm', { hand: null }],
  ]
  for (const [set, text, change] of scopes) if (set) offer(text, side, { ...query, ...change })
  return out.slice(0, max)
}

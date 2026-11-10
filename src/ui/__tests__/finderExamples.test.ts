import { describe, expect, it } from 'vitest'
import { fitExamples } from '../finderExamples'
import type { FinderExample } from '../finderBoard'

// A laddered example shows the highest bar the slice reaches, so a tile never says "0 games" when a
// lower bar would have had an answer; a fixed one stays as written, zero and all.

const so: FinderExample = {
  label: '8+ strikeouts', conditions: [{ field: 'so', op: 'gte', value: 8 }],
  ladder: { values: [10, 9, 8, 7, 6], label: v => `${v}+ strikeouts` },
}
// How many lines reach each bar, as the engine would count them.
const reach = (byBar: Record<number, number>) => (ex: FinderExample) => byBar[ex.conditions[0].value] ?? 0

describe('fitExamples', () => {
  it('takes the highest bar at least two lines reach', () => {
    const [f] = fitExamples([so], reach({ 10: 0, 9: 1, 8: 1, 7: 3, 6: 9 }))
    expect(f).toMatchObject({ n: 3, ex: { label: '7+ strikeouts', conditions: [{ value: 7 }] } })
  })

  it('settles for one, then for the last bar', () => {
    expect(fitExamples([so], reach({ 9: 1 }))[0].ex.label).toBe('9+ strikeouts')
    expect(fitExamples([so], reach({}))[0]).toMatchObject({ n: 0, ex: { label: '6+ strikeouts' } })
  })

  it('moves the bar named by `at`', () => {
    const errorless: FinderExample = {
      label: 'Errorless', conditions: [{ field: 'e', op: 'eq', value: 0 }, { field: 'tc', op: 'gte', value: 30 }],
      ladder: { at: 1, values: [60, 30], label: v => `Errorless, ${v}+` },
    }
    const [f] = fitExamples([errorless], ex => (ex.conditions[1].value === 30 ? 4 : 0))
    expect(f.ex.conditions).toEqual([{ field: 'e', op: 'eq', value: 0 }, { field: 'tc', op: 'gte', value: 30 }])
  })

  it('keeps the example as written while it cannot be counted, and a fixed one at zero', () => {
    expect(fitExamples([so], () => null)[0]).toEqual({ ex: so, n: null })
    const immaculate: FinderExample = { label: 'Immaculate', conditions: [{ field: 'so', op: 'gte', value: 3 }] }
    expect(fitExamples([immaculate], () => 0)[0]).toEqual({ ex: immaculate, n: 0 })
  })
})

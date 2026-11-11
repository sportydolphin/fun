import { describe, expect, it } from 'vitest'
import { EMPTY_FINDER_QUERY, type FinderQuery } from '../finder'
import { easeCondition, finderNearMisses } from '../finderNearMiss'

// A question that found nothing offers the nearest that find something. A wrong one here reads as an
// answer to a question nobody asked, so each kind is pinned: the other side, a number eased, a
// condition dropped, a scope dropped.

const q = (o: Partial<FinderQuery>): FinderQuery => ({ ...EMPTY_FINDER_QUERY, ...o })

describe('easing a condition', () => {
  it('lowers a floor and raises a ceiling, one step at a time, never to zero', () => {
    expect(easeCondition('pitching', { field: 'so', op: 'gte', value: 8 }, 2)).toEqual({ field: 'so', op: 'gte', value: 6 })
    expect(easeCondition('pitching', { field: 'bb', op: 'lte', value: 0 }, 1)).toEqual({ field: 'bb', op: 'lte', value: 1 })
    expect(easeCondition('hitting', { field: 'h', op: 'gte', value: 1 }, 1)).toBeNull()
  })

  it('eases "none" to "at most", and leaves any other exact value alone', () => {
    expect(easeCondition('hitting', { field: 'bb', op: 'eq', value: 0 }, 1)).toEqual({ field: 'bb', op: 'lte', value: 1 })
    expect(easeCondition('hitting', { field: 'balls', op: 'eq', value: 3 }, 1)).toBeNull()
  })

  it('steps an innings figure by an out and an average by .010', () => {
    expect(easeCondition('pitching', { field: 'ip', op: 'gte', value: 21 }, 1)).toMatchObject({ value: 20 })
    expect(easeCondition('hitting', { field: 'avg', op: 'gte', value: 400 }, 1)).toMatchObject({ value: 390 })
  })
})

describe('the nearest questions', () => {
  const asked = q({ conditions: [{ field: 'so', op: 'gte', value: 8 }, { field: 'bb', op: 'lte', value: 0 }], oppId: 'BOS' })

  it('offers the other side first', () => {
    const misses = finderNearMisses('hitting', asked, ['hitting', 'pitching'], side => (side === 'pitching' ? 5 : 0))
    expect(misses[0]).toMatchObject({ text: 'Pitching', side: 'pitching', total: 5 })
  })

  it('eases each number to the first step that finds anything, and drops a condition', () => {
    // Nobody struck out more than 6, and dropping the walks finds the 8s.
    const count = (_side: string, x: FinderQuery) => {
      const so = x.conditions.find(c => c.field === 'so')
      const bb = x.conditions.find(c => c.field === 'bb')
      if (!bb) return 2
      return so && so.value <= 6 ? 3 : 0
    }
    expect(finderNearMisses('pitching', asked, ['pitching'], count).map(m => [m.text, m.total]))
      .toEqual([['Strikeouts ≥ 6', 3], ['Without Walks allowed ≤ 0', 2]])
  })

  it('drops a condition or a scope where that is what finds something', () => {
    const lenient = (_side: string, x: FinderQuery) => (x.oppId ? 0 : 1)
    expect(finderNearMisses('pitching', asked, ['pitching'], lenient).map(m => m.text)).toEqual(['Any opponent'])
  })

  it('leaves out what the section cannot count', () => {
    expect(finderNearMisses('hitting', asked, ['hitting', 'pitching'], () => null)).toEqual([])
  })
})

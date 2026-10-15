import { describe, expect, it } from 'vitest'
import { defaultCondition, finderFieldGroups, finderFields, type FinderCondition } from '../finder'

describe('finder stat picker groups', () => {
  for (const side of ['hitting', 'pitching', 'fielding'] as const) {
    for (const per of ['game', 'season'] as const) {
      it(`offers every ${side} field exactly once per ${per}`, () => {
        const grouped = finderFieldGroups(side, per).flatMap(g => g.fields.map(f => f.key))
        expect([...grouped].sort()).toEqual(finderFields(side, per).map(f => f.key).sort())
        expect(new Set(grouped).size).toBe(grouped.length)
      })
    }
  }
})

describe('defaultCondition', () => {
  it('never repeats a stat already asked', () => {
    for (const side of ['hitting', 'pitching', 'fielding'] as const) {
      for (const per of ['game', 'season'] as const) {
        const taken: FinderCondition[] = []
        for (let i = 0; i < 6; i++) taken.push(defaultCondition(side, per, taken))
        expect(new Set(taken.map(c => c.field)).size).toBe(6)
      }
    }
  })
})

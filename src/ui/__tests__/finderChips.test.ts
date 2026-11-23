import { describe, expect, it } from 'vitest'
import { startCondition } from '../finderChips'

// A stat added from "+ Add" starts at a number someone would ask, so the first answer is a list rather
// than every line in the league or none of them.
describe('a condition added from the menu', () => {
  it('asks a yes-or-no on a play as exactly one', () => {
    expect(startCondition('hitting', 'walkoff')).toEqual({ field: 'walkoff', op: 'eq', value: 1 })
  })

  it('starts a rate at a good season, from its good end', () => {
    expect(startCondition('hitting', 'avg')).toEqual({ field: 'avg', op: 'gte', value: 300 })
    expect(startCondition('pitching', 'era')).toMatchObject({ field: 'era', op: 'lte' })
  })

  it('starts innings at five, in outs, and a count at one', () => {
    expect(startCondition('pitching', 'ip')).toEqual({ field: 'ip', op: 'gte', value: 15 })
    expect(startCondition('hitting', 'hr')).toEqual({ field: 'hr', op: 'gte', value: 1 })
  })
})

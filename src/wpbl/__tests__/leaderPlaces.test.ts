import { describe, it, expect } from 'vitest'
import { leaderPlaces } from '../ui'

// Boards numbered their rows by position, so two players on the same printed figure read as
// first and second. The places now come from the figure as printed, as the Leaders board's do.
describe('leaderPlaces', () => {
  it('shares a place between rows that print the same, and widens the whole board for it', () => {
    const p = leaderPlaces(['+3.1', '+3.1', '+2.0', '+1.5', '+1.5'])
    expect(p.map(x => [x.rank, x.tied])).toEqual([[1, true], [1, true], [3, false], [4, true], [4, true]])
    expect(p.every(x => x.wide)).toBe(true)
    expect(p.map(x => x.first)).toEqual([true, false, false, false, false])
  })

  it('leaves a board with no tie as it was', () => {
    const p = leaderPlaces(['.400', '.350', '.300'])
    expect(p.map(x => x.rank)).toEqual([1, 2, 3])
    expect(p.some(x => x.tied || x.wide)).toBe(false)
  })
})

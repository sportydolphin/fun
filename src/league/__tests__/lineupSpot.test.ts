import { describe, expect, it } from 'vitest'
import { parseLineupSpot } from '../lineupSpot'

// The Nov 20, 2026 probe: "batting 9th" read as the 9th inning, and "cleanup hitters" offered nothing.
describe('parseLineupSpot', () => {
  it('reads a spot in the order however it is said', () => {
    expect(parseLineupSpot('cleanup hitters')).toEqual({ spot: 4, rest: '' })
    expect(parseLineupSpot('batting 9th')).toEqual({ spot: 9, rest: '' })
    expect(parseLineupSpot('leadoff hitters')).toEqual({ spot: 1, rest: '' })
    expect(parseLineupSpot('who bats third for the queens')).toEqual({ spot: 3, rest: 'queens' })
    expect(parseLineupSpot('Hunters 3 hole')).toEqual({ spot: 3, rest: 'hunters' })
    expect(parseLineupSpot('2nd in the order 2026')).toEqual({ spot: 2, rest: '2026' })
  })
  it('leaves an inning and the first batter of an inning to Find', () => {
    for (const t of ['9th inning hr', 'leading off', 'first inning', 'hits in the 3rd inning', 'whitmore']) expect(parseLineupSpot(t), t).toBeNull()
  })
})

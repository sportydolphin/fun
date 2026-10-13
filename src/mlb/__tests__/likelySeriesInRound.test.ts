import { describe, expect, it } from 'vitest'
import { likelySeriesInRound } from '../postseason'

// The bracket skeleton reserves this many series. Four held two rows on a phone through the LCS and
// the World Series, which take one, and every cold MLB Home dropped 136px when the bracket landed.
describe('likelySeriesInRound', () => {
  const on = (m: number, d: number) => likelySeriesInRound(new Date(2026, m - 1, d, 12))
  it('holds four through the Wild Card and Division Series', () => {
    expect(on(9, 30)).toBe(4)
    expect(on(10, 11)).toBe(4)
  })
  it('holds two for the League Championship Series', () => {
    expect(on(10, 12)).toBe(2)
    expect(on(10, 22)).toBe(2)
  })
  it('holds one for the World Series and the winter after it', () => {
    expect(on(10, 23)).toBe(1)
    expect(on(11, 15)).toBe(1)
    expect(on(2, 1)).toBe(1)
  })
})

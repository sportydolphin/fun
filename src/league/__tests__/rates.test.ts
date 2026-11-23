import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { avgOf, obpOf, opsOf, perInnings, slgOf, totalBasesOf, whipOf } from '../rates'
import { hittingCounts, pitchingCounts } from '../../mlb/lib/statCounts'

// The one definition of each rate for every league on the site. Hand-worked cases for the
// definitions, then properties for what has to hold on any counts.

describe('the definitions', () => {
  // 150 for 500 with 60 walks, 5 HBP and 5 sac flies; 30 doubles, 3 triples, 20 home runs.
  const line = { h: 150, ab: 500, bb: 60, hbp: 5, sf: 5, doubles: 30, triples: 3, hr: 20 }
  const tb = totalBasesOf(line)

  it('counts total bases one per single, two per double and so on', () => {
    expect(tb).toBe(97 + 2 * 30 + 3 * 3 + 4 * 20)
  })

  it('puts sacrifice flies in OBP and leaves the rest of the line out', () => {
    expect(avgOf(line)).toBeCloseTo(0.3, 12)
    expect(obpOf(line)).toBeCloseTo(215 / 570, 12)
    expect(slgOf({ tb, ab: 500 })).toBeCloseTo(tb / 500, 12)
    expect(opsOf({ ...line, tb })).toBeCloseTo(215 / 570 + tb / 500, 12)
  })

  it('reads innings as outs, on the basis asked for', () => {
    // 20 earned runs in 60.1 innings (181 outs): per nine, and per seven for the WPBL.
    expect(perInnings(20, 181, 9)).toBeCloseTo((20 * 9) / (181 / 3), 12)
    expect(perInnings(20, 181, 7)).toBeCloseTo((20 * 7) / (181 / 3), 12)
    expect(whipOf({ h: 50, bb: 20, outs: 181 })).toBeCloseTo(70 / (181 / 3), 12)
  })

  it('has no value, not zero, where there is nothing underneath', () => {
    expect(avgOf({ h: 0, ab: 0 })).toBeNull()
    expect(obpOf({ h: 0, ab: 0, bb: 0, hbp: 0, sf: 0 })).toBeNull()
    expect(slgOf({ tb: 0, ab: 0 })).toBeNull()
    // Walks and no at-bats: an OBP, and no SLG, so no OPS.
    expect(obpOf({ h: 0, ab: 0, bb: 2, hbp: 0, sf: 0 })).toBe(1)
    expect(opsOf({ h: 0, ab: 0, bb: 2, hbp: 0, sf: 0, tb: 0 })).toBeNull()
    expect(perInnings(3, 0, 9)).toBeNull()
    expect(whipOf({ h: 2, bb: 1, outs: 0 })).toBeNull()
  })
})

describe('on any counts', () => {
  const counts = fc.record({
    ab: fc.nat(700), bb: fc.nat(150), hbp: fc.nat(30), sf: fc.nat(15),
    doubles: fc.nat(50), triples: fc.nat(10), hr: fc.nat(60), singles: fc.nat(200),
  }).map(c => ({ ...c, h: Math.min(c.ab, c.singles + c.doubles + c.triples + c.hr) }))
    .filter(c => c.h === c.singles + c.doubles + c.triples + c.hr)

  it('keeps AVG, OBP and SLG in range and OPS their sum', () => {
    fc.assert(fc.property(counts, c => {
      const tb = totalBasesOf(c), avg = avgOf(c), obp = obpOf(c), slg = slgOf({ tb, ab: c.ab })
      if (avg != null) { expect(avg).toBeGreaterThanOrEqual(0); expect(avg).toBeLessThanOrEqual(1) }
      if (obp != null) { expect(obp).toBeGreaterThanOrEqual(0); expect(obp).toBeLessThanOrEqual(1) }
      if (slg != null) { expect(slg).toBeGreaterThanOrEqual(avg ?? 0); expect(slg).toBeLessThanOrEqual(4) }
      const ops = opsOf({ ...c, tb })
      expect(ops == null).toBe(obp == null || slg == null)
      if (ops != null) expect(ops).toBeCloseTo(obp! + slg!, 12)
    }))
  })

  it('scales a per-innings rate linearly with the basis', () => {
    fc.assert(fc.property(fc.nat(100), fc.integer({ min: 1, max: 900 }), (count, outs) => {
      expect(perInnings(count, outs, 9)! * 7).toBeCloseTo(perInnings(count, outs, 7)! * 9, 9)
    }))
  })
})

describe('MLB stat objects summed into counts', () => {
  it('rebuilds total bases only where StatsAPI leaves them out, and reads innings as outs', () => {
    const h = hittingCounts([
      { hits: 2, atBats: 4, doubles: 1, homeRuns: 1, baseOnBalls: 1, totalBases: 7 },
      { hits: 1, atBats: 3, triples: 1 },
      null,
    ])
    expect(h).toEqual({ h: 3, ab: 7, bb: 1, hbp: 0, sf: 0, tb: 7 + 3 })
    expect(pitchingCounts([{ inningsPitched: '6.2', earnedRuns: 2 }, { inningsPitched: '1.1', strikeOuts: 3 }]))
      .toEqual({ h: 0, bb: 0, er: 2, so: 3, outs: 24 })
  })
})

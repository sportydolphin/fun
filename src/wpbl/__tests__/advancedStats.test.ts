import { describe, it, expect } from 'vitest'
import { sumBatting, sumPitching, fip, fipConstant, scaleToBasis, ERA_BASIS_CANONICAL } from '../stats'
import type { WpblBattingLine, WpblPitchingLine, WpblGame } from '../types'

// The derived rates added beside the box-score stats. Each pins the denominator, because every
// one of these has a near-miss spelling that looks right on the board: K% over at-bats instead of
// plate appearances, BABIP with the sac bunt in it, FIP on a per-9 scale beside a per-7 ERA.

const G = 'g1'
const games: WpblGame[] = [{ id: G, game_type: 'regular', counts_in_standings: true } as WpblGame]

const bat = (o: Partial<WpblBattingLine> = {}): WpblBattingLine => ({
  id: Math.random().toString(36).slice(2), game_id: G, player_id: 'b1', team_id: 'SF',
  ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0, hbp: 0, sb: 0, cs: 0,
  sf: 0, sh: 0, ibb: 0, gdp: 0, tb: 0, lob: 0, ...o,
} as WpblBattingLine)

const pit = (o: Partial<WpblPitchingLine> = {}): WpblPitchingLine => ({
  id: Math.random().toString(36).slice(2), game_id: G, player_id: 'p1', team_id: 'SF',
  outs: 21, bf: 28, h: 5, r: 2, er: 2, bb: 2, so: 7, hr: 1, hbp: 1, pitches: 90, decision: null, ...o,
} as WpblPitchingLine)

describe('batting rates', () => {
  // 10 AB, 3 H (a double and a home run among them), 2 SO, 1 BB, 1 SF, 1 SH: 13 PA.
  const t = sumBatting([bat({ ab: 10, h: 3, doubles: 1, hr: 1, so: 2, bb: 1, ibb: 1, sf: 1, sh: 1, sb: 2, cs: 1 })], games)

  it('takes ISO as SLG minus AVG', () => {
    // TB = 1 + 2 + 4 = 7, SLG .700, AVG .300.
    expect(t.iso).toBeCloseTo(0.4, 6)
  })

  it('keeps the sac fly in BABIP and the sac bunt out', () => {
    // (H - HR) / (AB - SO - HR + SF) = 2 / 8.
    expect(t.babip).toBeCloseTo(0.25, 6)
  })

  it('takes K% and BB% over plate appearances, bunts included', () => {
    expect(t.kPct).toBeCloseTo(2 / 13, 6)
    expect(t.bbPct).toBeCloseTo(1 / 13, 6)
  })

  it('reads SB% as a dash, not zero, with no attempt', () => {
    expect(t.sbPct).toBeCloseTo(2 / 3, 6)
    expect(sumBatting([bat({ ab: 4 })], games).sbPct).toBeNull()
  })

  it('sums intentional walks', () => {
    expect(t.ibb).toBe(1)
  })
})

describe('pitching rates', () => {
  const t = sumPitching([pit()], games)

  it('takes K% and BB% per batter faced', () => {
    expect(t.kPct).toBeCloseTo(7 / 28, 6)
    expect(t.bbPct).toBeCloseTo(2 / 28, 6)
    expect(t.kbbPct).toBeCloseTo(5 / 28, 6)
  })

  it('stores the HR rate on the canonical basis, like K', () => {
    expect(t.hr9).toBeCloseTo(1 * ERA_BASIS_CANONICAL / 7, 6)
  })

  it('takes BABIP against from batters faced', () => {
    // BIP = 28 - 2 BB - 1 HBP - 7 SO - 1 HR = 17; (5 - 1) / 17.
    expect(t.babip).toBeCloseTo(4 / 17, 6)
  })
})

describe('FIP', () => {
  // MLB's weights expressed in runs per event, so the arithmetic below is checkable by hand.
  const w = { hr: 13 / 9, bb: 3 / 9, k: -2 / 9 }
  const lines = [
    pit({ player_id: 'a', outs: 21, er: 1, so: 10, bb: 1, hbp: 0, hr: 0 }),
    pit({ player_id: 'b', outs: 18, er: 5, so: 2, bb: 4, hbp: 1, hr: 2 }),
  ]
  const lg = sumPitching(lines, games)
  const c = fipConstant(lg, w)

  it('centres the league on its own ERA', () => {
    expect(fip(lg, w, c)).toBeCloseTo(lg.era!, 6)
  })

  it('ranks the strikeout pitcher ahead of the walk-and-homer one', () => {
    const a = sumPitching([lines[0]], games), b = sumPitching([lines[1]], games)
    expect(fip(a, w, c)!).toBeLessThan(fip(b, w, c)!)
  })

  // Weights are runs per event; the basis turns them into runs per game. MLB's 13 is 13/9 of a
  // run per home run times nine innings, so on the canonical basis one homer an inning adds
  // 13/9 x basis.
  it('puts the weights on the stored basis', () => {
    const one = sumPitching([pit({ outs: 3, so: 0, bb: 0, hbp: 0, hr: 1 })], games)
    const none = sumPitching([pit({ outs: 3, so: 0, bb: 0, hbp: 0, hr: 0 })], games)
    expect(fip(one, w, 0)! - fip(none, w, 0)!).toBeCloseTo(13 * ERA_BASIS_CANONICAL / 9, 6)
  })

  it('rescales with ERA, so the league line still matches on the other basis', () => {
    const other = ERA_BASIS_CANONICAL === 7 ? 9 : 7
    expect(scaleToBasis(fip(lg, w, c), other)).toBeCloseTo(scaleToBasis(lg.era, other)!, 6)
  })

  it('is null before an inning, and until the weights exist', () => {
    expect(fip(sumPitching([pit({ outs: 0 })], games), w, c)).toBeNull()
    expect(fipConstant(sumPitching([], games), w)).toBeNull()
    expect(fipConstant(lg, null)).toBeNull()
    expect(fip(lg, null, c)).toBeNull()
  })
})

describe('XBH', () => {
  it('counts doubles, triples and home runs', () => {
    expect(sumBatting([bat({ ab: 10, h: 5, doubles: 2, triples: 1, hr: 1 })], games).xbh).toBe(4)
  })
})

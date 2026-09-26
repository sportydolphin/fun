import { describe, it, expect } from 'vitest'
import { sumBatting } from '../stats'
import { wobaWeights, fipWeights, wobaContext, woba, wrcPlus, WOBA_MIN_EVENTS } from '../derive/linearWeights'
import type { PlayRunValue } from '../derive/runExpectancy'
import type { WpblBattingLine, WpblGame } from '../types'

// wOBA prices each event by its run value above an out, then stretches the scale so the league
// reads like OBP. The two properties that make it trustworthy are that the league centres on its
// own OBP (wOBA) and on 100 (wRC+), and that an event too rare to measure gets a sane price.

const rv = (event_type: string, value: number, pitch_sequence: string | null = 'BCX'): PlayRunValue =>
  ({ play: { event_type, pitch_sequence }, value } as unknown as PlayRunValue)

const many = (e: string, v: number, n: number) => Array.from({ length: n }, () => rv(e, v))

const values: PlayRunValue[] = [
  ...many('strikeout', -0.3, 30), ...many('groundout', -0.2, 30),
  ...many('walk', 0.4, 30), ...many('hit_by_pitch', 0.45, 30), ...many('single', 0.6, 30),
  ...many('double', 0.9, 30), ...many('home_run', 1.5, 30),
  // Two triples, priced absurdly: under the minimum, so they must be ignored.
  ...many('triple', 0.1, 2),
  // A steal carries the batter's name but no pitch sequence of its own; it is not a PA.
  rv('strikeout', -50, null),
]

describe('weights', () => {
  const w = wobaWeights(values)!

  it('prices each event above an average out', () => {
    // Average out = -0.25.
    expect(w.bb).toBeCloseTo(0.65, 6)
    expect(w.single).toBeCloseTo(0.85, 6)
    expect(w.hr).toBeCloseTo(1.75, 6)
  })

  it('places a triple between a double and a home run until there are enough to measure', () => {
    expect(w.n.triple).toBeLessThan(WOBA_MIN_EVENTS)
    expect(w.triple).toBeCloseTo((w.double + w.hr) / 2, 6)
  })

  it('ignores rows that are not plate appearances', () => {
    expect(w.n.out).toBe(60)
  })

  it('is null with nothing to price', () => {
    expect(wobaWeights([])).toBeNull()
  })
})

describe('the league baseline', () => {
  const G = 'g1'
  const games: WpblGame[] = [{ id: G, game_type: 'regular', counts_in_standings: true } as WpblGame]
  const bat = (o: Partial<WpblBattingLine>): WpblBattingLine => ({
    id: Math.random().toString(36).slice(2), game_id: G, player_id: 'b1', team_id: 'SF',
    ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0, hbp: 0, sb: 0, cs: 0,
    sf: 0, sh: 0, ibb: 0, gdp: 0, tb: 0, lob: 0, ...o,
  } as WpblBattingLine)
  const slugger = bat({ player_id: 'a', ab: 20, h: 8, doubles: 2, hr: 3, bb: 4, r: 7 })
  const slap = bat({ player_id: 'b', ab: 20, h: 5, bb: 1, hbp: 1, r: 3 })
  const lg = sumBatting([slugger, slap], games)
  const w = wobaWeights(values)
  const ctx = wobaContext(lg, w)!

  it('reads the league wOBA as the league OBP', () => {
    expect(woba(lg, w, ctx)).toBeCloseTo(lg.obp!, 6)
  })

  it('centres wRC+ on 100 and ranks the slugger above it', () => {
    expect(wrcPlus(lg, w, ctx)).toBeCloseTo(100, 6)
    expect(wrcPlus(sumBatting([slugger], games), w, ctx)!).toBeGreaterThan(100)
    expect(wrcPlus(sumBatting([slap], games), w, ctx)!).toBeLessThan(100)
  })

  it('takes intentional walks out of both halves', () => {
    const withIbb = sumBatting([bat({ ab: 10, h: 3, bb: 2, ibb: 2 })], games)
    const without = sumBatting([bat({ ab: 10, h: 3 })], games)
    expect(woba(withIbb, w, ctx)).toBeCloseTo(woba(without, w, ctx)!, 6)
  })

  it('dashes until the weights arrive', () => {
    expect(woba(lg, null, null)).toBeNull()
    expect(wrcPlus(lg, null, null)).toBeNull()
  })
})

describe('FIP weights', () => {
  // Balls in play average: groundouts at -0.2, singles at 0.6, doubles at 0.9, triples at 0.1
  // (30 + 30 + 30 + 2 plays), so the baseline sits between the outs and the hits.
  const bipAvg = (30 * -0.2 + 30 * 0.6 + 30 * 0.9 + 2 * 0.1) / 92
  const w = fipWeights(values)!

  it('prices each outcome against an average ball in play', () => {
    expect(w.hr).toBeCloseTo(1.5 - bipAvg, 6)
    expect(w.k).toBeCloseTo(-0.3 - bipAvg, 6)
  })

  it('gives walks and hit batters one shared weight', () => {
    expect(w.bb).toBeCloseTo((0.4 + 0.45) / 2 - bipAvg, 6)
  })

  // On a realistic mix, where most balls in play are outs, which the fixture above is not.
  it('reproduces the MLB shape on a realistic mix: homers cost most, strikeouts save', () => {
    const r = fipWeights([
      ...many('groundout', -0.25, 70), ...many('single', 0.5, 25), ...many('double', 0.8, 5),
      ...many('strikeout', -0.3, 25), ...many('walk', 0.35, 10), ...many('home_run', 1.4, 3),
    ])!
    expect(r.hr).toBeGreaterThan(r.bb)
    expect(r.bb).toBeGreaterThan(0)
    expect(r.k).toBeLessThan(0)
  })

  it('is null with nothing to price', () => {
    expect(fipWeights([])).toBeNull()
  })
})

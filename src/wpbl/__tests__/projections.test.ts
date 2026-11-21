import { describe, expect, it } from 'vitest'
import {
  BAT_KEYS, MAX_POINT, MIN_POINT, PIT_KEYS, batCounts, batEvents, batShape, mean, posterior, projectHitter,
  projectPitcher, regressionPoints, returningProduction, rng, worldCupTranslation, type BatKey, type Events,
} from '../derive/projections'
import { battingFromCounts, type WpblBattingCounts, type WpblPitchingCounts } from '../stats'

const LEAGUE_BAT: WpblBattingCounts = {
  g: 120, ab: 3400, r: 900, h: 1000, doubles: 160, triples: 20, hr: 110, rbi: 850, bb: 650, so: 480, sb: 200,
  hbp: 80, cs: 40, sf: 30, sh: 40, gdp: 50, ibb: 10,
}
const LEAGUE_PIT: WpblPitchingCounts = {
  g: 300, outs: 2520, h: 1000, r: 900, er: 780, bb: 650, so: 480, hr: 110, w: 60, l: 60, s: 20, bf: 4200,
  pitches: 0, strikes: 0, gs: 120, hbp: 80, wp: 60, bk: 5,
}
const WOBA = { bb: 0.4, hbp: 0.42, single: 0.6, double: 0.95, triple: 1.2, hr: 1.5, n: { bb: 1, hbp: 1, single: 1, double: 1, triple: 1, hr: 1, out: 1 } }
const FIP = { hr: 1.6, bb: 0.4, k: -0.35 }

const hitter = (n: number, rate: Partial<Record<BatKey, number>>): Events<BatKey> => ({
  n, k: n * (rate.k ?? 0.12), bb: n * (rate.bb ?? 0.16), s1: n * (rate.s1 ?? 0.2), xbh: n * (rate.xbh ?? 0.05), hr: n * (rate.hr ?? 0.03),
})

describe('regressionPoints', () => {
  it('finds no talent where every player is the league, and stops at the cap', () => {
    const m = regressionPoints(BAT_KEYS, Array.from({ length: 30 }, () => hitter(100, {})))
    for (const k of BAT_KEYS) expect(m.point[k]).toBe(MAX_POINT)
  })

  it('regresses less as the talent spread widens, never under the floor', () => {
    const narrow = regressionPoints(BAT_KEYS, Array.from({ length: 40 }, (_, i) => hitter(100, { k: 0.1 + (i % 2) * 0.04 })))
    const wide = regressionPoints(BAT_KEYS, Array.from({ length: 40 }, (_, i) => hitter(100, { k: 0.04 + (i % 2) * 0.2 })))
    expect(wide.point.k).toBeLessThan(narrow.point.k)
    expect(wide.point.k).toBeGreaterThanOrEqual(MIN_POINT)
  })

  it('leaves out players under the measuring floor', () => {
    expect(regressionPoints(BAT_KEYS, [hitter(5, {}), hitter(100, {})]).players).toBe(1)
  })
})

describe('posterior', () => {
  const model = { lg: { k: 0.12, bb: 0.16, s1: 0.2, xbh: 0.05, hr: 0.03 }, point: { k: 50, bb: 50, s1: 50, xbh: 50, hr: 50 }, players: 40 }

  it('is the league with no evidence, and halfway at the point', () => {
    expect(mean(posterior(BAT_KEYS, model, null, null), 'k')).toBeCloseTo(0.12)
    expect(mean(posterior(BAT_KEYS, model, hitter(50, { k: 0.3 }), null), 'k')).toBeCloseTo(0.21)
  })

  it('counts a translated World Cup at its weight, and not at all at zero', () => {
    const t = { factor: { k: 2, bb: 1, s1: 1, xbh: 1, hr: 1 }, r: { k: null, bb: null, s1: null, xbh: null, hr: null }, players: 0 }
    const wc = hitter(50, { k: 0.1 })
    expect(mean(posterior(BAT_KEYS, model, null, { events: wc, translation: t, weight: 0 }), 'k')).toBeCloseTo(0.12)
    // 50 PA at half is 25 PA of a 0.2 K rate (0.1 doubled), against 50 of the league's 0.12.
    expect(mean(posterior(BAT_KEYS, model, null, { events: wc, translation: t, weight: 0.5 }), 'k')).toBeCloseTo((25 * 0.2 + 50 * 0.12) / 75)
  })
})

describe('worldCupTranslation', () => {
  it('is the ratio between the two settings for the same players', () => {
    const pairs = Array.from({ length: 6 }, (_, i) => ({ wpbl: hitter(60, { hr: 0.03 + i * 0.005 }), wc: hitter(40, { hr: 0.015 + i * 0.0025 }) }))
    const t = worldCupTranslation(BAT_KEYS, pairs)
    expect(t.factor.hr).toBeCloseTo(2)
    expect(t.r.hr).toBeCloseTo(1)
    expect(t.players).toBe(6)
  })

  it('reads 1 and no correlation with too little to go on', () => {
    const t = worldCupTranslation(BAT_KEYS, [{ wpbl: hitter(10, {}), wc: hitter(10, {}) }])
    expect(t.factor.k).toBe(1)
    expect(t.r.k).toBeNull()
  })
})

describe('projections', () => {
  const lg = regressionPoints(BAT_KEYS, [batEvents(LEAGUE_BAT)])

  it('rebuilds the league line from the league rates', () => {
    const t = battingFromCounts(batCounts(batEvents(LEAGUE_BAT), batShape(LEAGUE_BAT)))
    const real = battingFromCounts(LEAGUE_BAT)
    expect(t.obp!).toBeCloseTo(real.obp!, 3)
    expect(t.slg!).toBeCloseTo(real.slg!, 2)
  })

  it('projects a league-average hitter at 100 wRC+, inside the range, and repeats itself', () => {
    const post = posterior(BAT_KEYS, lg, null, null)
    const league = { counts: LEAGUE_BAT, weights: WOBA }
    const a = projectHitter(post, lg, league, { n: 100, draws: 400, seed: 7 })
    expect(a.wrcPlus!).toBeCloseTo(100, 0)
    expect(a.wrcRange!.p10).toBeLessThan(100)
    expect(a.wrcRange!.p90).toBeGreaterThan(100)
    expect(projectHitter(post, lg, league, { n: 100, draws: 400, seed: 7 })).toEqual(a)
  })

  it('projects a league-average pitcher at the league ERA', () => {
    const pm = regressionPoints(PIT_KEYS, [])
    const avg = { lg: { k: 480 / 4200, bb: 730 / 4200, hr: 110 / 4200, h: 890 / 4200 }, point: pm.point, players: 0 }
    const p = projectPitcher(posterior(PIT_KEYS, avg, null, null), avg, { counts: LEAGUE_PIT, weights: FIP }, { n: 120, draws: 300 })
    expect(p.fip!).toBeCloseTo((780 * 7) / 840, 1)
  })

  it('seeds the same stream', () => {
    const a = rng(3), b = rng(3)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
})

describe('returningProduction', () => {
  it('splits each club by who is back, and dashes WAR it cannot trust', () => {
    const rows = [
      { teamId: 'BOS', playerId: 'a', pa: 100, outs: 0, war: 1.5 },
      { teamId: 'BOS', playerId: 'b', pa: 50, outs: 60, war: 0.5 },
      { teamId: 'SF', playerId: 'c', pa: 80, outs: 0, war: null },
    ]
    const [bos, sf] = returningProduction(rows, new Set(['a']))
    expect(bos).toMatchObject({ players: 2, back: 1, pa: { back: 100, total: 150 }, outs: { back: 0, total: 60 }, war: { back: 1.5, total: 2 } })
    expect(sf.war).toBeNull()
  })
})

import { ipToOuts } from '../../league/innings'
import { totalBasesOf } from '../../league/rates'

// StatsAPI stat objects (a season, a game, a club) summed into the counts src/league/rates.ts
// takes. The career trend, the rolling-window chart and the followed players' sparklines each
// summed these by hand until Nov 23, 2026, and not alike: the trend read StatsAPI's `totalBases`,
// where the other two rebuilt it from the hits.

const num = (v: unknown): number => Number(v ?? 0) || 0

/** Batting counts. Total bases from the hits when an object leaves them out. */
export function hittingCounts(stats: readonly unknown[]) {
  const t = { h: 0, ab: 0, bb: 0, hbp: 0, sf: 0, tb: 0 }
  for (const raw of stats) {
    const s = raw as Record<string, unknown> | null | undefined
    if (!s) continue
    t.h += num(s.hits); t.ab += num(s.atBats); t.bb += num(s.baseOnBalls); t.hbp += num(s.hitByPitch); t.sf += num(s.sacFlies)
    t.tb += s.totalBases != null ? num(s.totalBases)
      : totalBasesOf({ h: num(s.hits), doubles: num(s.doubles), triples: num(s.triples), hr: num(s.homeRuns) })
  }
  return t
}

/** Pitching counts, innings as outs ("6.2" is 20). */
export function pitchingCounts(stats: readonly unknown[]) {
  const t = { h: 0, bb: 0, er: 0, so: 0, outs: 0 }
  for (const raw of stats) {
    const s = raw as Record<string, unknown> | null | undefined
    if (!s) continue
    t.h += num(s.hits); t.bb += num(s.baseOnBalls); t.er += num(s.earnedRuns); t.so += num(s.strikeOuts)
    t.outs += ipToOuts(s.inningsPitched as string | number | null | undefined)
  }
  return t
}

// The Charts board's points (stats/ChartsBoard → ChartsView.tsx): every player placed on two stats
// at once, which a table sorted by one column cannot show. Pure, so the share-image renderer can
// build the same points the page draws.
//
// EACH CHART IS A QUESTION A FAN ALREADY ASKS, and its two axes are the two halves of the answer:
// on base against power, the swing decision against the contact, ERA against what the pitcher
// controlled (FIP). Every one of them is a season figure the Stats tab already prints; nothing here invents a
// stat, so a dot can always be checked against the table one tab over.
//
// REGULAR SEASON ONLY, like the Run value and Draft boards: a playoff series is four clubs' best
// arms against each other, and mixing it into a season rate is the leak CLAUDE.md warns about.
// The callers hand in seasons already cut to the regular season and the year on screen.

import type { PitchProfile } from './pitches'
import {
  fip, fipConstant, plateAppearances, scaleToBasis,
  type EraBasis, type FipWeights, type WpblBatSeason, type WpblPitSeason, type WpblPitchingTotals,
} from '../stats'
import type { WpblPlayer } from '../types'

export interface ChartDatum {
  player: WpblPlayer
  x: number
  y: number
  /** Playing time, for the dot's area. */
  weight: number
  /** "212 PA", "31.1 IP", "640 pitches": the sample, for the card. */
  sample: string
  /** Over the playing-time bar the rate boards use, so "regulars only" agrees with the table. */
  qualified: boolean
}

export interface ChartData {
  points: ChartDatum[]
  /** The league's line on both axes, where a crosshair means something. */
  avg: { x: number; y: number } | null
  /** Who gets a direct label, most notable first. The plot drops any that would collide. */
  notable: string[]
}

const ipText = (outs: number) => `${Math.floor(outs / 3)}.${outs % 3} IP`

/** The ids of the top `n` points by `score`, highest first. */
function topBy(points: ChartDatum[], score: (p: ChartDatum) => number, n: number): string[] {
  return [...points].sort((a, b) => score(b) - score(a)).slice(0, n).map(p => p.player.id)
}
// How many names a chart offers. The plot draws as many as fit, up to its own cap (five on a
// phone, nine beside another chart), so this is the pool it chooses from, most notable first.
const NOTABLE_POOL = 12

/** Notable from several orderings, each taking its top `n` in turn, without repeats, then the
 *  rest by how far each dot sits from the middle of the cloud. The leaders alone named four or
 *  five dots and left the odd ones out (the hitter who never swings, the pitcher far off the
 *  diagonal), which are the dots a reader is asking about. Distance is in standard deviations on
 *  each axis, so neither stat's units decide it. Regulars only, even with everyone drawn: a 1.000
 *  OPS in three trips is the extreme of every ordering and the least worth naming. Before the bar
 *  is in force (minimum 0) everyone is a regular. */
function notableFrom(points: ChartDatum[], orders: { score: (p: ChartDatum) => number; n: number }[]): string[] {
  const pool = points.filter(p => p.qualified)
  const out: string[] = []
  for (const o of orders) for (const id of topBy(pool, o.score, o.n)) if (!out.includes(id)) out.push(id)
  if (pool.length < 2) return out
  const spread = (vs: number[]) => {
    const m = vs.reduce((a, v) => a + v, 0) / vs.length
    return { m, sd: Math.sqrt(vs.reduce((a, v) => a + (v - m) ** 2, 0) / vs.length) || 1 }
  }
  const sx = spread(pool.map(p => p.x)), sy = spread(pool.map(p => p.y))
  const far = (p: ChartDatum) => Math.hypot((p.x - sx.m) / sx.sd, (p.y - sy.m) / sy.sd)
  for (const id of topBy(pool, far, NOTABLE_POOL)) {
    if (out.length >= NOTABLE_POOL) break
    if (!out.includes(id)) out.push(id)
  }
  return out
}

/** On base (x) against slugging (y). The diagonal lines across it are OPS. */
export function obpSlgChart(seasons: WpblBatSeason[], league: { obp: number | null; slg: number | null }, minPa: number): ChartData {
  const points: ChartDatum[] = []
  for (const { player, totals: t } of seasons) {
    const pa = plateAppearances(t)
    if (pa === 0 || t.obp == null || t.slg == null) continue
    points.push({ player, x: t.obp, y: t.slg, weight: pa, sample: `${pa} PA`, qualified: pa >= minPa })
  }
  return {
    points,
    avg: league.obp != null && league.slg != null ? { x: league.obp, y: league.slg } : null,
    notable: notableFrom(points, [
      { score: p => p.x + p.y, n: 4 },
      { score: p => p.x, n: 1 },
      { score: p => p.y, n: 1 },
    ]),
  }
}

/**
 * FIP (x) against ERA (y), both on the reader's basis. The diagonal is "ERA equals FIP": above it
 * a pitcher allowed more runs than their strikeouts, walks and home runs say they should have,
 * which is the defense behind them and the sequencing as much as anything they did. Empty until
 * the league's own FIP weights are in, rather than borrowing MLB's.
 */
export function eraFipChart(
  seasons: WpblPitSeason[], league: WpblPitchingTotals, weights: FipWeights | null, minOuts: number, basis: EraBasis,
): ChartData {
  const c = fipConstant(league, weights)
  const points: ChartDatum[] = []
  for (const { player, totals: t } of seasons) {
    if (t.outs === 0 || t.era == null) continue
    const f = fip(t, weights, c)
    if (f == null) continue
    points.push({
      player, x: scaleToBasis(f, basis)!, y: scaleToBasis(t.era, basis)!,
      weight: t.outs, sample: ipText(t.outs), qualified: t.outs >= minOuts,
    })
  }
  return {
    points,
    avg: null,
    notable: notableFrom(points, [
      { score: p => -p.x, n: 2 },
      { score: p => p.y - p.x, n: 2 },
      { score: p => p.x - p.y, n: 2 },
    ]),
  }
}

/** How often a hitter swings (x) against how often a swing makes contact (y), from every pitch. */
export function swingContactChart(batters: PitchProfile[], league: PitchProfile | null, minPitches: number): ChartData {
  const points: ChartDatum[] = []
  for (const b of batters) {
    if (!b.player || b.swingPct == null || b.contactPct == null) continue
    points.push({
      player: b.player, x: b.swingPct, y: b.contactPct, weight: b.pitches,
      sample: `${b.pitches} pitches seen`, qualified: b.pitches >= minPitches,
    })
  }
  return {
    points,
    avg: league?.swingPct != null && league.contactPct != null ? { x: league.swingPct, y: league.contactPct } : null,
    notable: notableFrom(points, [
      { score: p => p.y, n: 2 },
      { score: p => -p.y, n: 1 },
      { score: p => p.x, n: 1 },
      { score: p => -p.x, n: 1 },
    ]),
  }
}

/** How often a hitter walks (x) against how often they strike out (y, drawn upside down so fewer
 *  strikeouts is higher). The plate discipline the OBP chart only shows the result of. */
export function walkStrikeoutChart(seasons: WpblBatSeason[], league: { bbPct: number | null; kPct: number | null }, minPa: number): ChartData {
  const points: ChartDatum[] = []
  for (const { player, totals: t } of seasons) {
    const pa = plateAppearances(t)
    if (pa === 0 || t.bbPct == null || t.kPct == null) continue
    points.push({ player, x: t.bbPct, y: t.kPct, weight: pa, sample: `${pa} PA`, qualified: pa >= minPa })
  }
  return {
    points,
    avg: league.bbPct != null && league.kPct != null ? { x: league.bbPct, y: league.kPct } : null,
    notable: notableFrom(points, [
      { score: p => p.x - p.y, n: 2 },
      { score: p => p.y - p.x, n: 2 },
    ]),
  }
}

/** Batting average (x) against isolated power (y): how often a hitter gets a hit, and how many
 *  extra bases the hits carry. Two hitters with one OPS can sit at opposite corners. */
export function averagePowerChart(seasons: WpblBatSeason[], league: { avg: number | null; iso: number | null }, minPa: number): ChartData {
  const points: ChartDatum[] = []
  for (const { player, totals: t } of seasons) {
    const pa = plateAppearances(t)
    if (pa === 0 || t.avg == null || t.iso == null) continue
    points.push({ player, x: t.avg, y: t.iso, weight: pa, sample: `${pa} PA`, qualified: pa >= minPa })
  }
  return {
    points,
    avg: league.avg != null && league.iso != null ? { x: league.avg, y: league.iso } : null,
    notable: notableFrom(points, [
      { score: p => p.y, n: 2 },
      { score: p => p.x, n: 2 },
    ]),
  }
}

/** A pitcher's strikeouts (x) against walks (y, upside down so fewer walks is higher), both per
 *  batter faced. The two things a pitcher controls most, without the defense behind them. */
export function pitcherStrikeoutWalkChart(seasons: WpblPitSeason[], league: WpblPitchingTotals, minOuts: number): ChartData {
  const points: ChartDatum[] = []
  for (const { player, totals: t } of seasons) {
    if (t.bf === 0 || t.kPct == null || t.bbPct == null) continue
    points.push({
      player, x: t.kPct, y: t.bbPct, weight: t.bf,
      sample: `${t.bf} BF · ${ipText(t.outs)}`, qualified: t.outs >= minOuts,
    })
  }
  return {
    points,
    avg: league.kPct != null && league.bbPct != null ? { x: league.kPct, y: league.bbPct } : null,
    notable: notableFrom(points, [
      { score: p => p.x - p.y, n: 3 },
      { score: p => p.y - p.x, n: 1 },
    ]),
  }
}

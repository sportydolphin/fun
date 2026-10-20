// The Charts board's points (stats/ChartsBoard → ChartsView.tsx): every player placed on two stats
// at once, which a table sorted by one column cannot show. Pure, so the share-image renderer can
// build the same points the page draws.
//
// EACH CHART IS A QUESTION A FAN ALREADY ASKS, and its two axes are the two halves of the answer:
// on base against power, the swing decision against the contact, ERA against what the pitcher
// controlled (FIP), getting ahead against walking people, and a two-way player's value on each
// side. Every one of them is a season figure the Stats tab already prints; nothing here invents a
// stat, so a dot can always be checked against the table one tab over.
//
// REGULAR SEASON ONLY, like the Run value and Draft boards: a playoff series is four clubs' best
// arms against each other, and mixing it into a season rate is the leak CLAUDE.md warns about.
// The callers hand in seasons already cut to the regular season and the year on screen.

import type { PitchProfile } from './pitches'
import type { PlayerValueSeason } from './playerValue'
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
/** Notable from several orderings, each taking its top `n` in turn, without repeats. Regulars
 *  only, even with everyone drawn: a 1.000 OPS in three trips is the extreme of every ordering
 *  and the least worth naming. Before the bar is in force (minimum 0) everyone is a regular. */
function notableFrom(points: ChartDatum[], orders: { score: (p: ChartDatum) => number; n: number }[]): string[] {
  const pool = points.filter(p => p.qualified)
  const out: string[] = []
  for (const o of orders) for (const id of topBy(pool, o.score, o.n)) if (!out.includes(id)) out.push(id)
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

/** How often a pitcher's first pitch is a strike (x) against how often they walk a batter (y,
 *  drawn upside down so fewer walks is higher). Getting ahead is the cause, the walks the effect. */
export function firstStrikeWalkChart(pitchers: PitchProfile[], league: PitchProfile | null, minPitches: number): ChartData {
  const points: ChartDatum[] = []
  for (const p of pitchers) {
    if (!p.player || p.firstStrikePct == null || p.bbPct == null) continue
    points.push({
      player: p.player, x: p.firstStrikePct, y: p.bbPct, weight: p.pitches,
      sample: `${p.pitches} pitches`, qualified: p.pitches >= minPitches,
    })
  }
  return {
    points,
    avg: league?.firstStrikePct != null && league.bbPct != null ? { x: league.firstStrikePct, y: league.bbPct } : null,
    notable: notableFrom(points, [
      { score: p => p.x - p.y, n: 2 },
      { score: p => p.y - p.x, n: 2 },
    ]),
  }
}

/**
 * Wins above replacement as a hitter (x, the glove and the bases included) against as a pitcher
 * (y), for everyone who did both. The question this league can ask and MLB barely can. A regular
 * is a regular on EITHER side: a starting pitcher who hit twice a week is the point of the chart.
 */
export function twoWayChart(seasons: PlayerValueSeason<WpblPlayer>[], minPa: number, minOuts: number): ChartData {
  const points: ChartDatum[] = []
  for (const s of seasons) {
    const { pa, outs } = s.totals
    if (pa === 0 || outs === 0) continue
    points.push({
      player: s.player, x: s.totals.batWar, y: s.totals.pitWar, weight: pa + outs,
      sample: `${pa} PA · ${ipText(outs)}`, qualified: pa >= minPa || outs >= minOuts,
    })
  }
  return {
    points,
    avg: null,
    notable: notableFrom(points, [{ score: p => p.x + p.y, n: 5 }]),
  }
}

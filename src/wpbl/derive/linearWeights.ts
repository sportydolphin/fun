import { plateAppearances, type WpblBattingTotals, type FipWeights } from '../stats'
import type { PlayRunValue } from './runExpectancy'

/**
 * Linear weights from the league's own plays: wOBA and wRC+ for hitters, FIP for pitchers.
 *
 * wOBA and wRC+, weighted by what each way of reaching base is worth IN THIS LEAGUE.
 *
 * WHY NOT THE PUBLISHED WEIGHTS. The familiar wOBA coefficients (a walk near 0.7, a home run
 * near 2.0) are major-league run values, and this is a seven-inning league scoring about fifteen
 * runs a game, where every base is worth more because more runners are coming behind it. The
 * weights here are the average run value of each event from `playRunValues`, which is the same
 * pass the Run value board draws, so the two surfaces price a single identically and cannot
 * drift apart.
 *
 * THE SHAPE IS TANGO'S. Each weight is the event's value ABOVE an average out, since a batter
 * who made an out still used up the trip; then the whole scale is stretched so the league's
 * wOBA equals the league's OBP, which is what lets a reader read .400 as they would an OBP.
 *
 * PURE, like stats.ts: arrays in, numbers out, no fetch and no React.
 */

/** Weights above an out, before the OBP stretch. Null for an event that has never happened. */
export interface WobaWeights {
  bb: number; hbp: number; single: number; double: number; triple: number; hr: number
  /** How many plays priced each weight, so a surface can say how well measured it is. */
  n: Record<'bb' | 'hbp' | 'single' | 'double' | 'triple' | 'hr' | 'out', number>
}

/** Every event the feed uses for a batter put out, strikeouts included. A fielder's choice is
 *  an out for the batter's purposes: the trip cost the side an out, whoever it was charged to.
 *  `sacrifice` is left out on purpose: it is fly balls and bunts together, and both are outs
 *  made on purpose in a situation that flatters them, which would drag the baseline up. */
const OUT_EVENTS = new Set([
  'strikeout', 'groundout', 'flyout', 'popup', 'lineout', 'foul_out', 'out', 'fielders_choice',
])

const EVENT_KEY: Record<string, keyof Omit<WobaWeights, 'n'>> = {
  walk: 'bb', hit_by_pitch: 'hbp', single: 'single', double: 'double', triple: 'triple', home_run: 'hr',
}

/** Below this many plays an event's average is noise rather than a price. Only the triple is
 *  under it: the 2026 season had two. */
export const WOBA_MIN_EVENTS = 20

/** A ball in play for FIP's purposes: anything the defence had a chance to field. Sacrifices
 *  are in, unlike the wOBA out pool above: whatever the batter meant by it, a sacrifice is a
 *  ball the defence fielded, and that is all FIP's baseline asks. Home runs are out, as one of
 *  the three outcomes FIP isolates, and `unknown` is out because it is not known to be in play. */
const BIP_EVENTS = new Set([
  'single', 'double', 'triple', 'groundout', 'flyout', 'popup', 'lineout', 'foul_out', 'out',
  'fielders_choice', 'sacrifice',
])

/**
 * FIP's three weights, measured the way the MLB ones were: each outcome's average run value
 * minus that of an average ball in play. Measured on the 2026 season they came out near
 * 14.8 / 4.4 / -4.2 per nine innings against MLB's 13 / 3 / -2. The gap is the league: at
 * fifteen runs a game every baserunner is worth more, so a walk costs half as much again and a
 * strikeout saves twice as much, and FIP on MLB's weights undersold strikeout pitchers and let
 * wild ones off lightly. Walks and hit batters share a weight, as they do in the standard
 * formula.
 */
export function fipWeights(values: PlayRunValue[]): FipWeights | null {
  const acc = { hr: [0, 0], bb: [0, 0], k: [0, 0], bip: [0, 0] }
  for (const v of values) {
    if (!v.play.pitch_sequence) continue
    const e = v.play.event_type
    const k = e === 'home_run' ? 'hr'
      : e === 'walk' || e === 'hit_by_pitch' ? 'bb'
      : e === 'strikeout' ? 'k'
      : e && BIP_EVENTS.has(e) ? 'bip' : null
    if (!k) continue
    acc[k][0] += v.value; acc[k][1]++
  }
  if (acc.hr[1] === 0 || acc.bb[1] === 0 || acc.k[1] === 0 || acc.bip[1] === 0) return null
  const avg = (k: keyof typeof acc) => acc[k][0] / acc[k][1]
  const bip = avg('bip')
  return { hr: avg('hr') - bip, bb: avg('bb') - bip, k: avg('k') - bip }
}

export function wobaWeights(values: PlayRunValue[]): WobaWeights | null {
  const sum: Record<string, number> = {}
  const n: WobaWeights['n'] = { bb: 0, hbp: 0, single: 0, double: 0, triple: 0, hr: 0, out: 0 }
  let outSum = 0
  for (const v of values) {
    // Plate appearances only. A stolen base or a wild pitch carries the batter's name too but is
    // not something the batter did, and a single "event" row without a pitch sequence is a
    // runner advance the feed labelled after the play it happened on.
    if (!v.play.pitch_sequence) continue
    const e = v.play.event_type
    if (!e) continue
    if (OUT_EVENTS.has(e)) { outSum += v.value; n.out++; continue }
    const k = EVENT_KEY[e]
    if (!k) continue
    sum[k] = (sum[k] ?? 0) + v.value
    n[k]++
  }
  if (n.out === 0) return null
  const out = outSum / n.out
  const above = (k: keyof typeof n): number | null => (n[k] > 0 ? sum[k] / n[k] - out : null)
  const bb = above('bb'), hbp = above('hbp'), single = above('single')
  const double = above('double'), hr = above('hr')
  if (bb == null || single == null || double == null || hr == null) return null
  // A triple measured on a handful of plays can land anywhere, including below a double. Half
  // way between a double and a home run is where it sits in every run environment that has
  // enough of them to measure, so that is the price until this one does.
  const tripleMeasured = n.triple >= WOBA_MIN_EVENTS ? above('triple') : null
  const triple = tripleMeasured ?? (double + hr) / 2
  return { bb, hbp: hbp ?? bb, single, double, triple, hr, n }
}

/** The numerator and denominator, unscaled. Intentional walks come out of both: a walk the
 *  defence chose to give says nothing about the batter, which is the standard definition. */
function wobaParts(t: WpblBattingTotals, w: WobaWeights): { num: number; den: number } {
  const singles = t.h - t.doubles - t.triples - t.hr
  const ubb = t.bb - t.ibb
  const num = w.bb * ubb + w.hbp * t.hbp + w.single * singles + w.double * t.doubles
    + w.triple * t.triples + w.hr * t.hr
  return { num, den: t.ab + ubb + t.sf + t.hbp }
}

/** What the league baseline needs, built from the SAME slice as the rows it is applied to, the
 *  rule OPS+ and FIP follow, so a playoff wRC+ is not centred on a season it is not part of. */
export interface WobaContext {
  /** Multiplier from runs above an out to the OBP-like scale. */
  scale: number
  /** League wOBA, equal to league OBP by construction. */
  lgWoba: number
  /** League runs per plate appearance: wRC+'s 100. */
  lgRPerPA: number
}

export function wobaContext(league: WpblBattingTotals, w: WobaWeights | null): WobaContext | null {
  if (!w || league.obp == null) return null
  const { num, den } = wobaParts(league, w)
  const pa = plateAppearances(league)
  if (num <= 0 || den <= 0 || pa <= 0 || league.r <= 0) return null
  const raw = num / den
  return { scale: league.obp / raw, lgWoba: league.obp, lgRPerPA: league.r / pa }
}

export function woba(t: WpblBattingTotals, w: WobaWeights | null, ctx: WobaContext | null): number | null {
  if (!w || !ctx) return null
  const { num, den } = wobaParts(t, w)
  return den > 0 ? (num / den) * ctx.scale : null
}

/** Runs created per plate appearance against the league's, as an index: 100 is average, 150 is
 *  half as many runs again. No park factor, for the reason OPS+ gives in StatsView: one season
 *  in unmeasured parks gives nothing reliable to adjust by. */
export function wrcPlus(t: WpblBattingTotals, w: WobaWeights | null, ctx: WobaContext | null): number | null {
  const v = woba(t, w, ctx)
  if (v == null || !ctx) return null
  // (wOBA - lgwOBA) / scale is runs above average per wOBA-denominator trip, the wRAA rate.
  return 100 * ((v - ctx.lgWoba) / ctx.scale + ctx.lgRPerPA) / ctx.lgRPerPA
}

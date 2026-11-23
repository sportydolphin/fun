// Projections for the next season: each player's rates pulled toward the league by how much a
// season this short can be trusted, with World Cup lines as extra, discounted evidence, and a range
// from simulating the season many times. Owner-only on /admin until the 2027 rosters fill out.
//
// HOW FAR TO PULL IS MEASURED, NOT BORROWED. Marcel's 1200 PA, and MLB's stabilization points
// (K% near 60 PA, OBP near 460), assume MLB's talent spread. This league's is much wider: measured
// on the 2026 season, K% needs about 35 PA and OBP about 94 before a player's own line counts for
// half. Borrowed constants would flatten every 2026 regular into the league average. So
// `regressionPoints` measures each rate's point every time it runs, by method of moments: the
// spread of players' rates, minus the spread pure chance would give them at their PA, is the
// spread in talent, and the point is p(1 - p) over that. The floor and the cap keep one odd
// season from turning regression off or swallowing everyone; both are wide of anything measured.
//
// ONE PRIOR PER PLAYER FROM THE WORLD CUP, TRANSLATED AND DISCOUNTED. A World Cup line is a
// different environment (2026: slugging about 20% lower, walks higher), so each rate is first
// scaled by the ratio between the two settings for the players who have both, then counted at
// `wcWeight` of its PA. The same 18 players showed walks and slugging carrying over (r .53, .59)
// and K% and OBP barely (.21, .16), which is why the weight is a setting the page shows beside that
// check rather than a constant.
//
// THE RANGE IS A SEASON, NOT TALENT ALONE. Each draw picks a talent from each rate's posterior and
// then plays a season of PAs at it, so the 10th to 90th percentile carries both what we do not know
// about the player and the luck of 30 games. That is the honest width: most of it is the luck.
//
// The slash line and wOBA go through `battingFromCounts` and `woba`, FIP through
// `pitchingFromCounts` and `fip`, so a projection reads on the same definitions as every stat on
// the site. No runtime imports beyond pure modules.
import {
  battingFromCounts, fip, fipConstant, pitchingFromCounts,
  type FipWeights, type WpblBattingCounts, type WpblPitchingCounts,
} from '../stats'
import { woba, wobaContext, wrcPlus, type WobaWeights } from './linearWeights'

// ─── Events ───────────────────────────────────────────────────────────────────

/** A hitter's line as the outcomes the model projects, per plate appearance. `bb` carries HBP:
 *  both put the batter on first without a ball in play, and HBP alone is too rare to measure. */
export const BAT_KEYS = ['k', 'bb', 's1', 'xbh', 'hr'] as const
/** A pitcher's, per batter faced. `h` is hits other than home runs. */
export const PIT_KEYS = ['k', 'bb', 'hr', 'h'] as const
export type BatKey = typeof BAT_KEYS[number]
export type PitKey = typeof PIT_KEYS[number]

export type Events<K extends string> = { n: number } & Record<K, number>

interface BatCountsLike { ab: number; h: number; doubles: number; triples: number; hr: number; bb: number; hbp: number; so: number; sf: number; sh: number }
interface PitCountsLike { bf: number; h: number; hr: number; bb: number; hbp: number; so: number }

export function batEvents(c: BatCountsLike): Events<BatKey> {
  return {
    n: c.ab + c.bb + c.hbp + c.sf + c.sh,
    k: c.so, bb: c.bb + c.hbp, s1: c.h - c.doubles - c.triples - c.hr, xbh: c.doubles + c.triples, hr: c.hr,
  }
}

export function pitEvents(c: PitCountsLike): Events<PitKey> {
  return { n: c.bf, k: c.so, bb: c.bb + c.hbp, hr: c.hr, h: c.h - c.hr }
}

export function addEvents<K extends string>(keys: readonly K[], a: Events<K> | null, b: Events<K> | null): Events<K> | null {
  if (!a || !b) return a ?? b
  const out = { n: a.n + b.n } as Events<K>
  for (const k of keys) (out as Record<K, number>)[k] = a[k] + b[k]
  return out
}

// ─── Regression ───────────────────────────────────────────────────────────────

/** Below this, a player's rate is mostly noise and only blurs the talent spread being measured. */
export const MEASURE_MIN_N = 10
/** The point is never under this, so a season with a freak spread still regresses everyone. */
export const MIN_POINT = 20
/** Nor over this: a rate whose talent spread measures as nothing still lets a full season speak. */
export const MAX_POINT = 1200

export interface RateModel<K extends string> {
  /** League rate per PA (or per BF). */
  lg: Record<K, number>
  /** PA (or BF) at which a player's own rate counts for half. */
  point: Record<K, number>
  /** Players the points were measured from. */
  players: number
}

/** Each rate's league average and regression point, measured from this season's players. */
export function regressionPoints<K extends string>(keys: readonly K[], players: Events<K>[]): RateModel<K> {
  const used = players.filter(p => p.n >= MEASURE_MIN_N)
  const total = used.reduce((s, p) => s + p.n, 0)
  const lg = {} as Record<K, number>
  const point = {} as Record<K, number>
  for (const k of keys) {
    const p = total > 0 ? used.reduce((s, x) => s + x[k], 0) / total : 0
    lg[k] = p
    // PA-weighted spread of the players' rates, and what binomial chance alone would give.
    const observed = total > 0 ? used.reduce((s, x) => s + x.n * (x[k] / x.n - p) ** 2, 0) / total : 0
    const chance = total > 0 ? (used.length / total) * p * (1 - p) : 0
    const talent = observed - chance
    const raw = talent > 0 ? (p * (1 - p)) / talent : MAX_POINT
    point[k] = Math.min(MAX_POINT, Math.max(MIN_POINT, raw))
  }
  return { lg, point, players: used.length }
}

// ─── World Cup translation ────────────────────────────────────────────────────

/** A player counts toward the translation with at least this much of each. */
export const TRANSLATE_MIN_WPBL = 30
export const TRANSLATE_MIN_WC = 15
/** A ratio outside this says the sample is broken, not that the settings differ that much. */
const FACTOR_RANGE: [number, number] = [0.25, 4]

export interface Translation<K extends string> {
  /** Multiply a World Cup rate by this to read it in WPBL terms. 1 where nothing could be measured. */
  factor: Record<K, number>
  /** Correlation between the two settings' rates, null with too few players: the evidence for `wcWeight`. */
  r: Record<K, number | null>
  players: number
}

export interface TranslationPair<K extends string> { wpbl: Events<K>; wc: Events<K> }

function corr(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 5) return null
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2 }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null
}

/** The ratio between the settings, from the SAME players in both, so it is the setting that differs
 *  and not who was in it. */
export function worldCupTranslation<K extends string>(keys: readonly K[], pairs: TranslationPair<K>[]): Translation<K> {
  const used = pairs.filter(p => p.wpbl.n >= TRANSLATE_MIN_WPBL && p.wc.n >= TRANSLATE_MIN_WC)
  const factor = {} as Record<K, number>
  const r = {} as Record<K, number | null>
  const wN = used.reduce((s, p) => s + p.wpbl.n, 0)
  const cN = used.reduce((s, p) => s + p.wc.n, 0)
  for (const k of keys) {
    const w = wN > 0 ? used.reduce((s, p) => s + p.wpbl[k], 0) / wN : 0
    const c = cN > 0 ? used.reduce((s, p) => s + p.wc[k], 0) / cN : 0
    factor[k] = w > 0 && c > 0 ? Math.min(FACTOR_RANGE[1], Math.max(FACTOR_RANGE[0], w / c)) : 1
    r[k] = corr(used.map(p => p.wc[k] / p.wc.n), used.map(p => p.wpbl[k] / p.wpbl.n))
  }
  return { factor, r, players: used.length }
}

// ─── Posterior ────────────────────────────────────────────────────────────────

export interface Posterior<K extends string> {
  /** Beta parameters per rate: the regressed rate is a / (a + b). */
  a: Record<K, number>
  b: Record<K, number>
  /** The player's own PA (or BF), the World Cup's before its discount, and after it. */
  own: number
  wc: number
  wcEff: number
}

/** The regressed rates, from the player's own line, the World Cup at `wcWeight`, and the league. */
export function posterior<K extends string>(
  keys: readonly K[], model: RateModel<K>, own: Events<K> | null,
  wc: { events: Events<K>; translation: Translation<K>; weight: number } | null,
): Posterior<K> {
  const a = {} as Record<K, number>
  const b = {} as Record<K, number>
  const ownN = own?.n ?? 0
  const wcN = wc && wc.weight > 0 ? wc.events.n * wc.weight : 0
  for (const k of keys) {
    const ownX = own?.[k] ?? 0
    const wcX = wc && wcN > 0 ? Math.min(wc.events[k] * wc.translation.factor[k], wc.events.n) * wc.weight : 0
    const prior = model.point[k]
    a[k] = ownX + wcX + prior * model.lg[k]
    b[k] = ownN + wcN + prior - a[k]
  }
  return { a, b, own: ownN, wc: wc?.events.n ?? 0, wcEff: wcN }
}

export const mean = <K extends string>(p: Posterior<K>, k: K): number => p.a[k] / (p.a[k] + p.b[k])

// ─── Simulation ───────────────────────────────────────────────────────────────

/** Seeded, so the page draws the same ranges on every load and a test can pin them. */
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function normal(r: () => number): number {
  const u = 1 - r()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r())
}

// Marsaglia and Tsang. Shape under 1 is boosted, which the league prior keeps rare.
function gamma(shape: number, r: () => number): number {
  if (shape < 1) return gamma(shape + 1, r) * Math.pow(r(), 1 / shape)
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x: number, v: number
    do { x = normal(r); v = 1 + c * x } while (v <= 0)
    v = v * v * v
    const u = r()
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

function beta(a: number, b: number, r: () => number): number {
  const x = gamma(Math.max(a, 1e-3), r)
  const y = gamma(Math.max(b, 1e-3), r)
  return x / (x + y)
}

/** One season's outcomes: a talent from each rate's posterior, then `n` trips at it. */
function drawSeason<K extends string>(keys: readonly K[], p: Posterior<K>, n: number, r: () => number): Events<K> {
  const rates = keys.map(k => beta(p.a[k], p.b[k], r))
  // Independent draws can sum past every trip; scale back rather than let "an out" go negative.
  const sum = rates.reduce((s, x) => s + x, 0)
  if (sum > 0.95) for (let i = 0; i < rates.length; i++) rates[i] *= 0.95 / sum
  const out = { n } as Events<K>
  for (const k of keys) (out as Record<K, number>)[k] = 0
  for (let t = 0; t < n; t++) {
    let u = r()
    for (let i = 0; i < keys.length; i++) {
      if (u < rates[i]) { (out as Record<K, number>)[keys[i]]++; break }
      u -= rates[i]
    }
  }
  return out
}

export interface Range { p10: number; p50: number; p90: number }

function range(xs: number[]): Range | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]
  return { p10: at(0.1), p50: at(0.5), p90: at(0.9) }
}

// ─── Hitters ──────────────────────────────────────────────────────────────────

/** The league's shape the model does not project, held at the league's own: how a ball in play
 *  that went for extra bases splits into doubles and triples, and how many trips are sacrifices. */
export interface BatShape { tripleShare: number; hbpShare: number; sfPerPa: number; shPerPa: number }

export function batShape(league: WpblBattingCounts): BatShape {
  const pa = league.ab + league.bb + league.hbp + league.sf + league.sh
  const xbh = league.doubles + league.triples
  const onFree = league.bb + league.hbp
  return {
    tripleShare: xbh > 0 ? league.triples / xbh : 0,
    hbpShare: onFree > 0 ? league.hbp / onFree : 0,
    sfPerPa: pa > 0 ? league.sf / pa : 0,
    shPerPa: pa > 0 ? league.sh / pa : 0,
  }
}

/** Events back into a counting line, so `battingFromCounts` computes the slash line exactly as the
 *  site does. Fractional counts are fine: every rate is a ratio of sums. */
export function batCounts(e: Events<BatKey>, shape: BatShape): WpblBattingCounts {
  const sf = e.n * shape.sfPerPa
  const sh = e.n * shape.shPerPa
  const hbp = e.bb * shape.hbpShare
  const triples = e.xbh * shape.tripleShare
  return {
    g: 0, ab: e.n - e.bb - sf - sh, r: 0, h: e.s1 + e.xbh + e.hr, doubles: e.xbh - triples, triples, hr: e.hr,
    rbi: 0, bb: e.bb - hbp, so: e.k, sb: 0, hbp, cs: 0, sf, sh, gdp: 0, ibb: 0,
  }
}

export interface BatLeague {
  counts: WpblBattingCounts
  /** The league's runs, which wRC+ is centered on. */
  weights: WobaWeights | null
}

export interface BatProjection {
  avg: number | null; obp: number | null; slg: number | null; ops: number | null
  kPct: number; bbPct: number
  woba: number | null; wrcPlus: number | null
  /** A season's OPS and wRC+, 10th to 90th percentile. */
  opsRange: Range | null
  wrcRange: Range | null
  /** How much of the projection is the player's own line: own / (own + league), by OBP's point. */
  ownShare: number
}

export interface ProjectOptions {
  /** Trips in the simulated season. */
  n: number
  draws?: number
  seed?: number
}

export function projectHitter(
  post: Posterior<BatKey>, model: RateModel<BatKey>, league: BatLeague, opts: ProjectOptions,
): BatProjection {
  const shape = batShape(league.counts)
  const lgTotals = battingFromCounts(league.counts)
  const ctx = wobaContext(lgTotals, league.weights)
  const expected = { n: 1000 } as Events<BatKey>
  for (const k of BAT_KEYS) expected[k] = 1000 * mean(post, k)
  const t = battingFromCounts(batCounts(expected, shape))

  const r = rng(opts.seed ?? 1)
  const ops: number[] = []
  const wrc: number[] = []
  for (let i = 0; i < (opts.draws ?? 1000); i++) {
    const s = battingFromCounts(batCounts(drawSeason(BAT_KEYS, post, opts.n, r), shape))
    if (s.ops != null) ops.push(s.ops)
    const w = wrcPlus(s, league.weights, ctx)
    if (w != null) wrc.push(w)
  }
  // The OBP-ish rates' points average near one another, so on-base's own point stands for the line.
  const pt = (model.point.bb + model.point.s1 + model.point.k) / 3
  const evidence = post.own + post.wcEff
  return {
    avg: t.avg, obp: t.obp, slg: t.slg, ops: t.ops,
    kPct: mean(post, 'k'), bbPct: mean(post, 'bb'),
    woba: woba(t, league.weights, ctx), wrcPlus: wrcPlus(t, league.weights, ctx),
    opsRange: range(ops), wrcRange: range(wrc),
    ownShare: evidence / (evidence + pt),
  }
}

// ─── Pitchers ─────────────────────────────────────────────────────────────────

export interface PitLeague {
  counts: WpblPitchingCounts
  weights: FipWeights | null
}

/** Events back into a pitching line. Outs come from the league's outs per non-hit, non-free trip,
 *  so double plays and errors stay at the league's rate rather than vanishing. HBP is split off
 *  `bb` at the league's share, as FIP counts both. */
export function pitCounts(e: Events<PitKey>, league: WpblPitchingCounts): WpblPitchingCounts {
  const lgOther = league.bf - league.h - league.bb - league.hbp
  const outsPer = lgOther > 0 ? league.outs / lgOther : 1
  const free = league.bb + league.hbp
  const hbpShare = free > 0 ? league.hbp / free : 0
  const hbp = e.bb * hbpShare
  const h = e.h + e.hr
  const outs = (e.n - h - e.bb) * outsPer
  return {
    g: 0, outs, h, r: 0, er: 0, bb: e.bb - hbp, so: e.k, hr: e.hr, w: 0, l: 0, s: 0, bf: e.n,
    pitches: 0, strikes: 0, gs: 0, hbp, wp: 0, bk: 0, sh: 0,
  }
}

export interface PitProjection {
  kPct: number; bbPct: number; hrPct: number
  /** Opponents' on-base, from the projected hits and free passes. */
  oppObp: number
  fip: number | null
  /** A season's FIP, 10th to 90th percentile. On the canonical basis, like the stored ERA. */
  fipRange: Range | null
  ownShare: number
}

export function projectPitcher(
  post: Posterior<PitKey>, model: RateModel<PitKey>, league: PitLeague, opts: ProjectOptions,
): PitProjection {
  const lgTotals = pitchingFromCounts(league.counts)
  const constant = fipConstant(lgTotals, league.weights)
  const expected = { n: 1000 } as Events<PitKey>
  for (const k of PIT_KEYS) expected[k] = 1000 * mean(post, k)
  const t = pitchingFromCounts(pitCounts(expected, league.counts))

  const r = rng(opts.seed ?? 1)
  const fips: number[] = []
  for (let i = 0; i < (opts.draws ?? 1000); i++) {
    const s = pitchingFromCounts(pitCounts(drawSeason(PIT_KEYS, post, opts.n, r), league.counts))
    const f = fip(s, league.weights, constant)
    if (f != null) fips.push(f)
  }
  const pt = (model.point.k + model.point.bb + model.point.hr) / 3
  const evidence = post.own + post.wcEff
  return {
    kPct: mean(post, 'k'), bbPct: mean(post, 'bb'), hrPct: mean(post, 'hr'),
    oppObp: mean(post, 'bb') + mean(post, 'h') + mean(post, 'hr'),
    fip: fip(t, league.weights, constant),
    fipRange: range(fips),
    ownShare: evidence / (evidence + pt),
  }
}

// ─── Returning production ─────────────────────────────────────────────────────

export interface ClubShareInput {
  teamId: string
  playerId: string
  pa: number
  outs: number
  /** Null when the stored WAR is not current: the share then reads as a dash, never as zero. */
  war: number | null
}

export interface ClubReturning {
  teamId: string
  players: number
  back: number
  pa: { back: number; total: number }
  outs: { back: number; total: number }
  war: { back: number; total: number } | null
}

/** What share of each club's 2026 the players it still holds account for. A player is filed under the club
 *  their lines were for, the club that held their rights to re-sign. */
export function returningProduction(rows: ClubShareInput[], back: ReadonlySet<string>): ClubReturning[] {
  const by = new Map<string, ClubReturning & { warOk: boolean }>()
  for (const r of rows) {
    let c = by.get(r.teamId)
    if (!c) by.set(r.teamId, c = {
      teamId: r.teamId, players: 0, back: 0, pa: { back: 0, total: 0 }, outs: { back: 0, total: 0 },
      war: { back: 0, total: 0 }, warOk: true,
    })
    const isBack = back.has(r.playerId)
    c.players++
    if (isBack) c.back++
    c.pa.total += r.pa; c.outs.total += r.outs
    if (isBack) { c.pa.back += r.pa; c.outs.back += r.outs }
    if (r.war == null) c.warOk = false
    else if (c.war) { c.war.total += r.war; if (isBack) c.war.back += r.war }
  }
  return [...by.values()].map(({ warOk, ...c }) => ({ ...c, war: warOk ? c.war : null }))
}

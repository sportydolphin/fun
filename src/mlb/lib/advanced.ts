import type { LeaderboardEntry, StatDef } from '../types'
import { fmt, fmtDecimal, parseIP } from './utils'

// THE ADVANCED VIEW OF MLB'S STATS TABLE, WPBL's (VIEW_ORDER in src/wpbl/StatsView.tsx) column for
// column, so the Standard / Advanced switch means the same thing in both sections.
//
// EVERYTHING BUT wOBA AND wRC+ IS COMPUTED HERE from the season line the table already holds, which
// is what lets it work on every scope: the playoffs, the two summed, a career. StatsAPI's
// `seasonAdvanced` has some of these, but only for one season's regular season, and a column that
// goes blank when the reader picks Playoffs reads as broken. wOBA and wRC+ need the year's linear
// weights and park factors, which only StatsAPI's `sabermetrics` has, and only for a regular
// season: those two columns are offered there and nowhere else (`sabermetricsApply`).
//
// THE LEAGUE CONTEXT IS THE TABLE'S OWN POOL, everyone in it rather than the qualified rows, as the
// header's league line is (leagueLine). OPS+ and ERA+ are not park adjusted, so they are close to
// Baseball-Reference's and not equal to it; FIP's constant is derived from the same pool, so the
// league's FIP equals its ERA by construction, as FanGraphs sets it up.
//
// A value that cannot be computed is UNDEFINED, never null or 0: `rankValue` takes Number() of it,
// and Number(null) is 0, which would put a pitcher with no innings at the top of the FIP board.

type Stat = Record<string, unknown>
type Derived = Record<string, number | undefined>

const n = (s: Stat, k: string): number => { const v = Number(s?.[k]); return Number.isFinite(v) ? v : 0 }
const ratio = (a: number, b: number): number | undefined => (b > 0 ? a / b : undefined)

/** The league figures the indexes are measured against. */
export interface AdvancedContext { obp?: number; slg?: number; era?: number; fipConstant?: number }

/** One player's wOBA and wRC+, from StatsAPI's sabermetrics. */
export interface Sabermetric { woba?: number; wrcPlus?: number }

function hittingLine(s: Stat): Derived {
  const pa = n(s, 'plateAppearances'), ab = n(s, 'atBats'), h = n(s, 'hits'), bb = n(s, 'baseOnBalls')
  const k = n(s, 'strikeOuts'), hr = n(s, 'homeRuns'), sf = n(s, 'sacFlies'), hbp = n(s, 'hitByPitch')
  const d2 = n(s, 'doubles'), d3 = n(s, 'triples'), sb = n(s, 'stolenBases'), cs = n(s, 'caughtStealing')
  const tb = s?.totalBases != null ? n(s, 'totalBases') : h + d2 + 2 * d3 + 3 * hr
  return {
    obp: ratio(h + bb + hbp, ab + bb + hbp + sf), slg: ratio(tb, ab),
    bbPct: ratio(bb, pa), kPct: ratio(k, pa), iso: ratio(tb - h, ab), xbh: d2 + d3 + hr,
    babip: ratio(h - hr, ab - k - hr + sf), sbPct: ratio(sb, sb + cs),
  }
}

function pitchingLine(s: Stat): Derived {
  const ip = parseIP(s?.inningsPitched), bf = n(s, 'battersFaced'), k = n(s, 'strikeOuts'), bb = n(s, 'baseOnBalls')
  const hbp = n(s, 'hitBatsmen'), hr = n(s, 'homeRuns'), h = n(s, 'hits'), ab = n(s, 'atBats'), sf = n(s, 'sacFlies')
  const kPct = ratio(k, bf), bbPct = ratio(bb, bf)
  return {
    ip, era: ip > 0 ? 9 * n(s, 'earnedRuns') / ip : undefined,
    kPct, bbPct, kbbPct: kPct != null && bbPct != null ? kPct - bbPct : undefined,
    kbb: ratio(k, bb), hr9: ip > 0 ? 9 * hr / ip : undefined,
    strikePct: ratio(n(s, 'strikes'), n(s, 'numberOfPitches')),
    babip: ratio(h - hr, ab - k - hr + sf),
    fipCore: ip > 0 ? (13 * hr + 3 * (bb + hbp) - 2 * k) / ip : undefined,
  }
}

/** The pool summed into one line, so the league's rates are recomputed from its counts. */
function totals(entries: LeaderboardEntry[]): Stat {
  const out: Record<string, number> = {}
  let outs = 0
  for (const e of entries) {
    const s = e.stat as Stat
    if (!s) continue
    for (const [k, v] of Object.entries(s)) if (typeof v === 'number') out[k] = (out[k] ?? 0) + v
    if (s.inningsPitched != null) outs += Math.round(parseIP(s.inningsPitched) * 3)
  }
  return { ...out, inningsPitched: outs ? `${Math.floor(outs / 3)}.${outs % 3}` : undefined }
}

export function advancedContext(entries: LeaderboardEntry[], group: 'hitting' | 'pitching'): AdvancedContext {
  const t = totals(entries)
  if (group === 'hitting') {
    const l = hittingLine(t)
    return { obp: l.obp, slg: l.slg }
  }
  const l = pitchingLine(t)
  return { era: l.era, fipConstant: l.era != null && l.fipCore != null ? l.era - l.fipCore : undefined }
}

/** One stat line's advanced figures. The keys are the advanced defs' own. */
export function advancedFor(stat: unknown, group: 'hitting' | 'pitching', ctx: AdvancedContext, saber?: Sabermetric): Derived {
  const s = (stat ?? {}) as Stat
  if (group === 'hitting') {
    const l = hittingLine(s)
    return {
      bbPct: l.bbPct, kPct: l.kPct, iso: l.iso, xbh: l.xbh, babipCalc: l.babip, sbPct: l.sbPct,
      opsPlus: l.obp != null && l.slg != null && ctx.obp && ctx.slg ? 100 * (l.obp / ctx.obp + l.slg / ctx.slg - 1) : undefined,
      woba: saber?.woba, wrcPlus: saber?.wrcPlus,
    }
  }
  const l = pitchingLine(s)
  // ERA+ off the ERA the row prints, so the two cannot disagree in the last digit.
  const era = Number(s.era)
  return {
    kPct: l.kPct, bbPct: l.bbPct, kbbPct: l.kbbPct, kbb: l.kbb, hr9: l.hr9, strikePct: l.strikePct, babipCalc: l.babip,
    eraPlus: era > 0 && ctx.era ? 100 * ctx.era / era : undefined,
    fip: l.fipCore != null && ctx.fipConstant != null ? l.fipCore + ctx.fipConstant : undefined,
  }
}

/** Every row with its advanced figures folded into its stat line, beside StatsAPI's own fields. */
export function withAdvanced(
  entries: LeaderboardEntry[], group: 'hitting' | 'pitching', saber?: Map<number, Sabermetric> | null,
): LeaderboardEntry[] {
  const ctx = advancedContext(entries, group)
  return entries.map(e => ({ ...e, stat: { ...e.stat, ...advancedFor(e.stat, group, ctx, saber?.get(e.playerId)) } }))
}

/** The league line's advanced half, for the header: the same arithmetic over the pool's totals. The
 *  indexes are 100 by definition, and the league's wOBA is the plate-appearance weighted mean of the
 *  players StatsAPI rates. */
export function advancedLeague(
  entries: LeaderboardEntry[], group: 'hitting' | 'pitching', saber?: Map<number, Sabermetric> | null,
): Record<string, number | undefined> {
  const ctx = advancedContext(entries, group)
  const own = advancedFor(totals(entries), group, ctx)
  if (group === 'pitching') return { ...own, eraPlus: 100, fip: ctx.era }
  let pa = 0, w = 0
  if (saber) for (const e of entries) {
    const s = saber.get(e.playerId), p = Number((e.stat as Stat)?.plateAppearances) || 0
    if (s?.woba != null && p) { pa += p; w += s.woba * p }
  }
  return { ...own, opsPlus: 100, woba: pa ? w / pa : undefined, wrcPlus: saber ? 100 : undefined }
}

const pct = (places: number) => (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? '—' : `${(Number(v) * 100).toFixed(places)}%`)
const rate3 = (v: unknown) => fmtDecimal(v, 3)
const two = (v: unknown) => fmtDecimal(v, 2)
const whole = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? '—' : String(Math.round(Number(v))))
const def = (key: string, label: string, format: (v: unknown) => string, extra: Partial<StatDef> = {}): StatDef =>
  ({ key, label, getValue: s => s?.[key], format, leaderCategory: '', defaultSelected: false, isRate: true, ...extra })

export const HITTING_ADVANCED_DEFS: StatDef[] = [
  def('bbPct', 'BB%', pct(1)),
  def('kPct', 'K%', pct(1), { lowerIsBetter: true }),
  def('opsPlus', 'OPS+', whole),
  def('iso', 'ISO', rate3),
  def('xbh', 'XBH', fmt, { isRate: false }),
  { ...def('babip', 'BABIP', rate3), getValue: s => s?.babipCalc },
  def('sbPct', 'SB%', pct(0)),
  def('woba', 'wOBA', rate3),
  def('wrcPlus', 'wRC+', whole),
]

export const PITCHING_ADVANCED_DEFS: StatDef[] = [
  def('kbb', 'K/BB', two),
  def('hr9', 'HR/9', two, { lowerIsBetter: true }),
  def('kPct', 'K%', pct(1)),
  def('bbPct', 'BB%', pct(1), { lowerIsBetter: true }),
  def('kbbPct', 'K-BB%', pct(1)),
  def('strikePct', 'STR%', pct(0)),
  { ...def('babip', 'BABIP', rate3, { lowerIsBetter: true }), getValue: s => s?.babipCalc },
  def('eraPlus', 'ERA+', whole),
  def('fip', 'FIP', two, { lowerIsBetter: true }),
]

/** The two stats only StatsAPI's sabermetrics can supply. */
export const SABERMETRIC_KEYS: ReadonlySet<string> = new Set(['woba', 'wrcPlus'])

export type StatsView = 'standard' | 'advanced'

/** Advanced's columns, in WPBL's order. Standard is the defs' own order (constants.ts). */
export const ADVANCED_ORDER: Record<'hitting' | 'pitching', readonly string[]> = {
  hitting: ['pa', 'bbPct', 'kPct', 'avg', 'obp', 'slg', 'ops', 'opsPlus', 'iso', 'xbh', 'babip', 'sbPct', 'woba', 'wrcPlus'],
  pitching: ['ip', 'bf', 'so9', 'kbb', 'hr9', 'kPct', 'bbPct', 'kbbPct', 'strikePct', 'whip', 'babip', 'eraPlus', 'era', 'fip'],
}

import {
  fip, fipConstant, fmtPct, fmtRate, fmtTwo, kRateLabel, plateAppearances, scaleToBasis, sumBatting, sumPitching,
  type EraBasis, type FipWeights, type WpblBattingTotals, type WpblPitchingTotals,
} from './stats'
import { outsToIp } from './innings'
import { woba, wobaContext, wrcPlus, type WobaWeights } from './derive/linearWeights'
import { fmtRunValue } from './derive/runExpectancy'
import type { WpblValueTotals } from './derive/playerValue'
import type { SeasonScope, WpblSeasonGame } from './season'
import type { WpblBattingLine, WpblPitchingLine } from './types'

// The stats table's hitting and pitching columns: what each sorts on and how each cell prints.
// Out of StatsView.tsx so the search box can answer "Whitmore avg" and name a ranking's leader
// from the same definitions, and so cannot print a number the table a tap away disagrees with.
// The columns that need the league (OPS+, wOBA, wRC+, ERA+, FIP) or the reader (the ERA basis) are
// built by `hittingColumns` and `pitchingColumns` below, for the same reason.

export interface Col<T> {
  key: string
  label: string
  value: (t: T) => number | null      // sort value (null = sorts to the bottom)
  display?: (t: T) => string          // cell text (defaults to the value)
  rate?: boolean                      // rate stat → dash when null, eligible for the qualified filter
  lowerBetter?: boolean               // ERA/WHIP sort ascending by default
}

// Since the Standard/Advanced split this order is only the Rank by sheet's; the table's
// left-to-right order is `VIEW_ORDER` below, and the column a side opens on is `HEADLINE`.
export const HIT_COLS: Col<WpblBattingTotals>[] = [
  { key: 'avg', label: 'AVG', value: t => t.avg, display: t => fmtRate(t.avg), rate: true },
  { key: 'obp', label: 'OBP', value: t => t.obp, display: t => fmtRate(t.obp), rate: true },
  { key: 'slg', label: 'SLG', value: t => t.slg, display: t => fmtRate(t.slg), rate: true },
  { key: 'ops', label: 'OPS', value: t => t.ops, display: t => fmtRate(t.ops), rate: true },
  // OPS+ is spliced in after OPS at render time, so these two land right behind it: power on
  // its own, then the luck check on the average.
  { key: 'iso', label: 'ISO', value: t => t.iso, display: t => fmtRate(t.iso), rate: true },
  { key: 'babip', label: 'BABIP', value: t => t.babip, display: t => fmtRate(t.babip), rate: true },
  { key: 'hr',  label: 'HR',  value: t => t.hr },
  { key: 'rbi', label: 'RBI', value: t => t.rbi },
  { key: 'r',   label: 'R',   value: t => t.r },
  { key: 'h',   label: 'H',   value: t => t.h },
  { key: 'sb',  label: 'SB',  value: t => t.sb },
  // CS beside SB, because a steal total on its own cannot say whether the running was any
  // good, and this league runs constantly. Same reason the steal card on Run value prices it.
  { key: 'cs',  label: 'CS',  value: t => t.cs },
  { key: 'sbPct', label: 'SB%', value: t => t.sbPct, display: t => fmtPct(t.sbPct), rate: true },
  { key: '2b',  label: '2B',  value: t => t.doubles },
  { key: '3b',  label: '3B',  value: t => t.triples },
  { key: 'xbh', label: 'XBH', value: t => t.xbh },
  { key: 'tb',  label: 'TB',  value: t => t.tb },
  { key: 'bb',  label: 'BB',  value: t => t.bb },
  { key: 'so',  label: 'SO',  value: t => t.so },
  { key: 'bbPct', label: 'BB%', value: t => t.bbPct, display: t => fmtPct(t.bbPct), rate: true },
  { key: 'kPct', label: 'K%', value: t => t.kPct, display: t => fmtPct(t.kPct), rate: true, lowerBetter: true },
  { key: 'ibb', label: 'IBB', value: t => t.ibb },
  // The rest of the trips to the plate that AB does not count. All four arrive on every line
  // and were shown nowhere: HBP is 54 of them this season, GDP 28, and the two sacrifices
  // are how a bunt or a fly ball shows up at all.
  { key: 'hbp', label: 'HBP', value: t => t.hbp },
  { key: 'gdp', label: 'GDP', value: t => t.gdp },
  { key: 'sf',  label: 'SF',  value: t => t.sf },
  { key: 'sh',  label: 'SH',  value: t => t.sh },
  // Trips to the plate, and the unit the qualifier is set in. See `plateAppearances`.
  { key: 'pa',  label: 'PA',  value: t => plateAppearances(t) },
  { key: 'ab',  label: 'AB',  value: t => t.ab },
  { key: 'g',   label: 'G',   value: t => t.g },
]

export const PIT_COLS: Col<WpblPitchingTotals>[] = [
  { key: 'era',  label: 'ERA',  value: t => t.era,  display: t => fmtTwo(t.era),  rate: true, lowerBetter: true },
  { key: 'whip', label: 'WHIP', value: t => t.whip, display: t => fmtTwo(t.whip), rate: true, lowerBetter: true },
  { key: 'w',    label: 'W',    value: t => t.w },
  { key: 'l',    label: 'L',    value: t => t.l },
  { key: 'sv',   label: 'SV',   value: t => t.s },
  { key: 'so',   label: 'SO',   value: t => t.so },
  { key: 'ip',   label: 'IP',   value: t => t.outs, display: t => outsToIp(t.outs) },
  { key: 'h',    label: 'H',    value: t => t.h },
  { key: 'r',    label: 'R',    value: t => t.r },
  { key: 'er',   label: 'ER',   value: t => t.er },
  { key: 'bb',   label: 'BB',   value: t => t.bb },
  { key: 'hr',   label: 'HR',   value: t => t.hr },
  { key: 'hbp',  label: 'HBP',  value: t => t.hbp },
  { key: 'wp',   label: 'WP',   value: t => t.wp },
  { key: 'bk',   label: 'BK',   value: t => t.bk },
  // How much work the outing WAS, as opposed to what it gave up. Every one of these is on the
  // feed's line, and without them the board could say a pitcher allowed two runs but not that they
  // faced nine batters or threw ninety pitches.
  { key: 'kbb',  label: 'K/BB', value: t => t.kbb, display: t => fmtTwo(t.kbb), rate: true },
  // Per batter faced rather than per inning; see `kPct` in stats.ts.
  { key: 'kPct', label: 'K%', value: t => t.kPct, display: t => fmtPct(t.kPct), rate: true },
  { key: 'bbPct', label: 'BB%', value: t => t.bbPct, display: t => fmtPct(t.bbPct), rate: true, lowerBetter: true },
  { key: 'kbbPct', label: 'K-BB%', value: t => t.kbbPct, display: t => fmtPct(t.kbbPct), rate: true },
  { key: 'strikePct', label: 'STR%', value: t => t.strikePct,
    display: t => (t.strikePct == null ? '—' : `${Math.round(t.strikePct * 100)}%`), rate: true },
  { key: 'babip', label: 'BABIP', value: t => t.babip, display: t => fmtRate(t.babip), rate: true, lowerBetter: true },
  { key: 'bf',   label: 'BF',   value: t => t.bf },
  { key: 'p',    label: 'P',    value: t => t.pitches },
  { key: 'gs',   label: 'GS',   value: t => t.gs },
  { key: 'g',    label: 'G',    value: t => t.g },
]

/** The whole league's line over the slice the rows come from (one season, or every season for a
 *  career), which is the baseline the league-relative columns measure against: a playoff hitter's
 *  OPS+ is measured against the playoffs. Summed from the lines here, or rebuilt from the stored
 *  season rows' counts (derive/playerSeasons.ts), which come to the same totals. */
export interface WpblLeagueLine { batting: WpblBattingTotals; pitching: WpblPitchingTotals }

export function leagueLine(batting: WpblBattingLine[], pitching: WpblPitchingLine[], games: WpblSeasonGame[], scope: SeasonScope): WpblLeagueLine {
  return { batting: sumBatting(batting, games, scope), pitching: sumPitching(pitching, games, scope) }
}

/** What the league-relative columns are measured against, and how the reader wants ERA. */
export interface WpblColumnContext {
  league: WpblLeagueLine
  /** The league's own run values (derive/linearWeights.ts). Null until they land, when wOBA, wRC+
   *  and FIP read as a dash rather than borrowing MLB's. */
  wWeights: WobaWeights | null
  fWeights: FipWeights | null
  fmtEra: (v: number | null) => string
  eraBasis: EraBasis
}

// OPS+ normalizes a hitter's OBP+SLG to the league (100 = league average, 150 = 50% better), so
// it needs the league's rates, from every batting line in the slice (`ctx.league`) regardless of the
// table's team or qualified filters. No park factors: the classic formula includes them, but this league's
// unmeasured parks give no reliable adjustment, so it is omitted (implicitly 1.0). Sits after OPS.
export function hittingColumns(ctx: WpblColumnContext): Col<WpblBattingTotals>[] {
  const lg = ctx.league.batting
  const lgObp = lg.obp, lgSlg = lg.slg
  const opsPlus = (t: WpblBattingTotals): number | null =>
    t.obp != null && t.slg != null && lgObp != null && lgObp > 0 && lgSlg != null && lgSlg > 0
      ? 100 * (t.obp / lgObp + t.slg / lgSlg - 1)
      : null
  const w = ctx.wWeights
  const wCtx = wobaContext(lg, w)
  const cols = [...HIT_COLS]
  cols.splice(cols.findIndex(c => c.key === 'ops') + 1, 0, {
    key: 'opsPlus', label: 'OPS+',
    value: opsPlus,
    display: t => { const v = opsPlus(t); return v == null ? '—' : String(Math.round(v)) },
    rate: true,
  }, {
    // After OPS+ because they answer the same question better: OPS adds two rates with different
    // denominators and weighs a point of OBP the same as a point of SLG, which undersells walks.
    // Weighted by this league's own run values; see derive/woba.ts.
    key: 'woba', label: 'wOBA',
    value: t => woba(t, w, wCtx),
    display: t => fmtRate(woba(t, w, wCtx)),
    rate: true,
  }, {
    key: 'wrcPlus', label: 'wRC+',
    value: t => wrcPlus(t, w, wCtx),
    display: t => { const v = wrcPlus(t, w, wCtx); return v == null ? '—' : String(Math.round(v)) },
    rate: true,
  })
  return cols
}

// ERA+ mirrors OPS+ for pitchers: league ERA over the pitcher's ERA, x100 (100 = league average,
// higher is better; it inverts ERA, so unlike ERA it sorts descending). No park factor, same
// reasoning as OPS+. A 0.00 ERA has no finite ratio, so it reads "∞" and sorts to the top rather
// than dashing to the bottom. Sits right after ERA.
export function pitchingColumns(ctx: WpblColumnContext): Col<WpblPitchingTotals>[] {
  const { fmtEra, eraBasis, fWeights } = ctx
  const lgTotals = ctx.league.pitching
  const lgEra = lgTotals.era
  const fipC = fipConstant(lgTotals, fWeights)
  const eraPlus = (t: WpblPitchingTotals): number | null => {
    if (t.era == null || lgEra == null || lgEra <= 0) return null
    return t.era === 0 ? Infinity : 100 * lgEra / t.era
  }
  const cols = [...PIT_COLS]
  const eraIdx = cols.findIndex(c => c.key === 'era')
  // ERA is stored on the league's own basis (`ERA_BASIS_CANONICAL` in stats.ts) and shown on
  // whatever the reader chose. Swapped in here rather than in PIT_COLS because that list is a
  // module constant with no reader to ask. `value` is left on the stored number on purpose: the
  // sort is identical either way, and leaving it alone keeps ERA+ below reading the same figure
  // the league does.
  cols[eraIdx] = { ...cols[eraIdx], display: t => fmtEra(t.era) }
  // The strikeout rate belongs beside ERA for the same reason ERA is swapped in here: it is
  // stored on the canonical basis and shown on whatever the reader chose, so even its LABEL
  // is not knowable in a module constant, which is why `kRateLabel` builds it. Do not write
  // 'K/9' or 'K/7' anywhere: the heading follows the league's basis. `value` stays on the stored
  // number, which sorts identically.
  const soIdx = cols.findIndex(c => c.key === 'so')
  cols.splice(soIdx + 1, 0, {
    key: 'k9', label: kRateLabel(eraBasis),
    value: t => t.k9,
    display: t => fmtTwo(scaleToBasis(t.k9, eraBasis)),
    rate: true,
  }, {
    // Same arrangement as the K rate: stored on the canonical basis, labelled and scaled for
    // the reader's.
    key: 'hr9', label: `HR/${eraBasis}`,
    value: t => t.hr9,
    display: t => fmtTwo(scaleToBasis(t.hr9, eraBasis)),
    rate: true, lowerBetter: true,
  })
  cols.splice(eraIdx + 1, 0, {
    key: 'eraPlus', label: 'ERA+',
    value: eraPlus,
    display: t => { const v = eraPlus(t); return v == null ? '—' : !isFinite(v) ? '∞' : String(Math.round(v)) },
    rate: true,
  }, {
    // Beside ERA+ so the gap between what a pitcher allowed and what they controlled reads in
    // one glance. Centred on the same slice's ERA, so the league line reads the same in both.
    // `fmtEra` rescales it with ERA, which is correct because FIP is linear in the basis.
    key: 'fip', label: 'FIP',
    value: t => fip(t, fWeights, fipC),
    display: t => fmtEra(fip(t, fWeights, fipC)),
    rate: true, lowerBetter: true,
  })
  return cols
}

// The Overall side's columns: WAR and every part it is made of (derive/war.ts, docs/WAR.md), then
// wins added. Runs are signed, because each is measured against an average player and below
// average is a real answer; runs to one place, and wins to two. FanGraphs prints WAR to one, on a
// scale where a season is worth 1,000 of them; this league's is worth about 12, so one place would
// tie half the board.
//
// A half of the game a player never played reads as a dash, not a zero: "0.0" under Pitching Runs
// for a hitter claims a measurement. The fielding columns are numbers for everyone who fielded.
const wpaText = (v: number | null) => fmtRunValue(v, 2)
const runs = (v: number | null) => fmtRunValue(v)
const warText = (v: number | null) => (v == null ? '—' : (Math.round(v * 100) / 100 || 0).toFixed(2).replace('-', '\u2212'))
const batting = (t: WpblValueTotals, v: number) => (t.pa ? v : null)
const pitching = (t: WpblValueTotals, v: number) => (t.outs ? v : null)
const catching = (t: WpblValueTotals, v: number) => (t.armAtt || t.cBlk ? v : null)
export const OVR_COLS: Col<WpblValueTotals>[] = [
  { key: 'war',    label: 'WAR',    value: t => t.war,    display: t => warText(t.war) },
  // A pure pitcher has none: their fielding counts toward pitching WAR (war.ts, `fldP`).
  { key: 'batWar', label: 'Pos WAR', value: t => (t.pa ? t.batWar : null), display: t => warText(t.pa ? t.batWar : null) },
  { key: 'pitWar', label: 'Pit WAR', value: t => pitching(t, t.pitWar), display: t => warText(pitching(t, t.pitWar)) },
  { key: 'bat',    label: 'Bat',    value: t => batting(t, t.bat), display: t => runs(batting(t, t.bat)) },
  { key: 'bsr',    label: 'BsR',    value: t => batting(t, t.bsr), display: t => runs(batting(t, t.bsr)) },
  { key: 'fld',    label: 'Fld',    value: t => t.fld,    display: t => runs(t.fld) },
  { key: 'pos',    label: 'Pos',    value: t => t.pos,    display: t => runs(t.pos) },
  { key: 'pit',    label: 'Pit',    value: t => pitching(t, t.pit), display: t => runs(pitching(t, t.pit)) },
  { key: 'wpa',    label: 'WPA',    value: t => t.wpa,    display: t => wpaText(t.wpa) },
  // The glove, part by part, for the Advanced view.
  { key: 'rng',    label: 'Rng',    value: t => t.rng,    display: t => runs(t.rng) },
  { key: 'err',    label: 'Err',    value: t => t.err,    display: t => runs(t.err) },
  { key: 'dp',     label: 'DP',     value: t => t.dp,     display: t => runs(t.dp) },
  { key: 'ofArm',  label: 'OF Arm', value: t => t.ofArm,  display: t => runs(t.ofArm) },
  { key: 'cArm',   label: 'C Arm',  value: t => catching(t, t.cArm), display: t => runs(catching(t, t.cArm)) },
  { key: 'cBlk',   label: 'C Blk',  value: t => catching(t, t.cBlk), display: t => runs(catching(t, t.cBlk)) },
  { key: 'gdp',    label: 'GDP',    value: t => batting(t, t.gdp), display: t => runs(batting(t, t.gdp)) },
  { key: 'lgAdj',  label: 'Lg',     value: t => batting(t, t.lgAdj), display: t => runs(batting(t, t.lgAdj)) },
  { key: 'rep',    label: 'Rep',    value: t => t.rep,    display: t => runs(t.rep) },
  { key: 'pa',     label: 'PA',     value: t => t.pa },
  { key: 'ip',     label: 'IP',     value: t => t.outs,   display: t => (t.outs ? outsToIp(t.outs) : '—') },
]

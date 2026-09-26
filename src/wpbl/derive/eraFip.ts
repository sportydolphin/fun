import { fip, fipConstant, type FipWeights, type WpblPitchingTotals, type WpblPitSeason } from '../stats'

/**
 * The qualified pitchers whose ERA sits furthest from their FIP, each side, with the one
 * box-score fact that accounts for most of the gap.
 *
 * WHY A FACT AND NOT A VERDICT. A gap between ERA and FIP has two usual causes and the box score
 * can tell them apart: runs that were unearned (ERA drops them, FIP never counted them either way,
 * so a pitcher behind errors reads far better on ERA), and hits on balls in play (FIP leaves them
 * out, so a pitcher who allowed a lot of them reads better on FIP). Stating which number it was is
 * checkable; calling it "luck" is not, and a season this short cannot settle the question anyway.
 *
 * PURE, like stats.ts: seasons, league totals and weights in, rows out.
 */

/** Which fact the row shows, and the numbers to state it with. */
export type EraFipReason =
  | { kind: 'unearned'; unearned: number; runs: number }
  | { kind: 'babip'; babip: number; league: number }
  | { kind: 'rates'; kPct: number; bbPct: number }

export interface EraFipRow {
  season: WpblPitSeason
  era: number
  fip: number
  /** ERA minus FIP: negative when ERA is the lower of the two. */
  gap: number
  reason: EraFipReason
}

/** A gap smaller than this is inside what one bad inning moves in a 15-inning season, so a row
 *  for it would be listing noise as a finding. */
export const ERA_FIP_MIN_GAP = 1

/** At least this share of the runs unearned before unearned runs are the stated reason. */
const UNEARNED_SHARE = 1 / 3
/** BABIP at least this far above the league's before it is the stated reason. */
const BABIP_MARGIN = 0.03

export const ERA_FIP_TOP_N = 3

function reasonFor(t: WpblPitchingTotals, eraLower: boolean, leagueBabip: number | null): EraFipReason {
  const unearned = t.r - t.er
  if (eraLower && t.r > 0 && unearned / t.r >= UNEARNED_SHARE) {
    return { kind: 'unearned', unearned, runs: t.r }
  }
  if (!eraLower && t.babip != null && leagueBabip != null && t.babip >= leagueBabip + BABIP_MARGIN) {
    return { kind: 'babip', babip: t.babip, league: leagueBabip }
  }
  return { kind: 'rates', kPct: t.kPct ?? 0, bbPct: t.bbPct ?? 0 }
}

export function eraFipGaps(
  seasons: WpblPitSeason[],
  league: WpblPitchingTotals,
  weights: FipWeights | null,
  minOuts: number,
): { eraLower: EraFipRow[]; eraHigher: EraFipRow[] } | null {
  const c = fipConstant(league, weights)
  if (!weights || c == null) return null
  const rows: EraFipRow[] = []
  for (const s of seasons) {
    if (s.totals.outs < minOuts || s.totals.era == null) continue
    const f = fip(s.totals, weights, c)
    if (f == null) continue
    const gap = s.totals.era - f
    if (Math.abs(gap) < ERA_FIP_MIN_GAP) continue
    rows.push({ season: s, era: s.totals.era, fip: f, gap, reason: reasonFor(s.totals, gap < 0, league.babip) })
  }
  return {
    eraLower: rows.filter(r => r.gap < 0).sort((a, b) => a.gap - b.gap).slice(0, ERA_FIP_TOP_N),
    eraHigher: rows.filter(r => r.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, ERA_FIP_TOP_N),
  }
}

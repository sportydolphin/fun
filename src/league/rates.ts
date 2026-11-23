// The rate stats, once, for every league on the site: the WPBL's totals (src/wpbl/stats.ts), MLB's
// season, rolling and career lines (src/mlb/), and the World Cup's tables (src/intl/).
//
// WHY ONE FILE. Until Nov 23, 2026 OBP, SLG, OPS and ERA were written out by hand in about a dozen
// places across the three sections. Every copy was right, which is exactly the danger: the day one
// drifts (a denominator that drops `sf`, a 0 where there is no value), nothing on screen looks wrong.
// Each function here takes the counts and returns the raw rate, or null when the denominator is 0,
// because a rate with nothing under it is no value, not zero. Rounding and printing stay with the
// caller, which knows whether it wants ".312" or the API's own string.
//
// No imports, so the WPBL's Deno-shared modules, the edge Pages Functions and the scripts can all
// take it.

/** Total bases from the hits: one per single, two per double, and so on. */
export const totalBasesOf = (c: { h: number; doubles: number; triples: number; hr: number }): number =>
  c.h + c.doubles + 2 * c.triples + 3 * c.hr

export const avgOf = (c: { h: number; ab: number }): number | null => (c.ab > 0 ? c.h / c.ab : null)

/** Sacrifice flies are in the denominator and sacrifice bunts are not, the official definition. */
export const obpOf = (c: { h: number; bb: number; hbp: number; ab: number; sf: number }): number | null => {
  const d = c.ab + c.bb + c.hbp + c.sf
  return d > 0 ? (c.h + c.bb + c.hbp) / d : null
}

export const slgOf = (c: { tb: number; ab: number }): number | null => (c.ab > 0 ? c.tb / c.ab : null)

/** OBP plus SLG at full precision: adding two rounded figures is off by a point about one time in three. */
export const opsOf = (c: { h: number; bb: number; hbp: number; ab: number; sf: number; tb: number }): number | null => {
  const obp = obpOf(c), slg = slgOf(c)
  return obp != null && slg != null ? obp + slg : null
}

/**
 * A count per `basis` innings, from outs: ERA from earned runs, K/9 from strikeouts, HR/9 and the
 * rest. `basis` is the league's: 9 for MLB, the WPBL's `ERA_BASIS_CANONICAL` (7), the World Cup's
 * edition length. Outs, never decimal innings: "6.2" is 20 outs, not 6.2 innings.
 */
export const perInnings = (count: number, outs: number, basis: number): number | null =>
  (outs > 0 ? (count * basis * 3) / outs : null)

export const whipOf = (c: { h: number; bb: number; outs: number }): number | null =>
  (c.outs > 0 ? ((c.h + c.bb) * 3) / c.outs : null)

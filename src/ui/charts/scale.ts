// ─── The arithmetic under a scatter plot, with no React in it ─────────────────────────────────
// Shared by both sections' charts. Kept free of React and MUI so the share-image renderer in
// scripts/visuals/ (resvg, plain SVG strings) can draw the same axes and guides as the page does.

/**
 * Generate ≈target human-friendly tick values that span [dataMin, dataMax].
 * Steps are always "nice" numbers: 1, 2, 2.5, 5, or 10 × a power of 10.
 */
export function niceTicks(dataMin: number, dataMax: number, target = 5): number[] {
  if (!isFinite(dataMin) || !isFinite(dataMax) || dataMin >= dataMax) {
    return isFinite(dataMin) ? [dataMin] : []
  }
  const range = dataMax - dataMin
  const roughStep = range / Math.max(2, target - 1)
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)))
  const norm = roughStep / mag
  let step: number
  if      (norm <= 1)   step = mag
  else if (norm <= 2)   step = 2 * mag
  else if (norm <= 2.5) step = 2.5 * mag
  else if (norm <= 5)   step = 5 * mag
  else                  step = 10 * mag

  const lo = Math.ceil(dataMin  / step - 1e-9) * step
  const hi = Math.floor(dataMax / step + 1e-9) * step
  const count = Math.round((hi - lo) / step)
  const ticks: number[] = []
  for (let i = 0; i <= count; i++) {
    ticks.push(parseFloat((lo + i * step).toPrecision(12)))
  }
  return ticks.length ? ticks : [dataMin, dataMax]
}

export interface Domain { lo: number; hi: number; ticks: number[] }

/**
 * An axis that holds every value with a margin, widened out to whole ticks so the first and last
 * gridlines close the plot. `floor` stops the margin opening a stretch below a stat's natural
 * minimum: a gridline at "-.050 OBP" reads as data, not as padding. `include` pulls in a value the
 * points may not reach (the league average a crosshair is drawn at, a zero line).
 */
export function niceDomain(values: readonly number[], opts: { pad?: number; floor?: number; include?: readonly number[]; target?: number } = {}): Domain {
  const all = [...values, ...(opts.include ?? [])].filter(Number.isFinite)
  if (all.length === 0) return { lo: 0, hi: 1, ticks: [0, 1] }
  let lo = Math.min(...all), hi = Math.max(...all)
  // One value, or every value the same: open a window around it rather than dividing by zero.
  if (hi - lo < 1e-9) { const w = Math.abs(lo) * 0.1 || 0.5; lo -= w; hi += w }
  const pad = (hi - lo) * (opts.pad ?? 0.08)
  lo -= pad; hi += pad
  if (opts.floor != null) lo = Math.max(opts.floor, lo)
  // Six by default: at five, a slugging axis from .100 to 1.200 steps by .500 and reads as three lines.
  const first = niceTicks(lo, hi, opts.target ?? 6)
  if (first.length < 2) return { lo, hi, ticks: first }
  const step = first[1] - first[0]
  lo = Math.floor(lo / step + 1e-9) * step
  hi = Math.ceil(hi / step - 1e-9) * step
  if (opts.floor != null) lo = Math.max(opts.floor, lo)
  const ticks: number[] = []
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(parseFloat(t.toPrecision(12)))
  return { lo: ticks[0], hi: ticks[ticks.length - 1], ticks }
}

/** One domain for both axes, for a plot whose diagonal means "the two are equal" (ERA against
 *  FIP). Two separate domains would tilt the y = x line off 45° and move it with the data. */
export function sharedDomain(xs: readonly number[], ys: readonly number[], opts: { pad?: number; floor?: number; target?: number } = {}): Domain {
  return niceDomain([...xs, ...ys], opts)
}

export interface Segment { x1: number; y1: number; x2: number; y2: number }

/**
 * Where the line x + y = c crosses the box, in data units, or null if it misses. The guide that
 * makes OBP against SLG readable: every point on one of these lines has the same OPS.
 */
export function sumSegment(c: number, x: { lo: number; hi: number }, y: { lo: number; hi: number }): Segment | null {
  const eps = 1e-9
  const pts: { x: number; y: number }[] = []
  const add = (px: number, py: number) => {
    if (px < x.lo - eps || px > x.hi + eps || py < y.lo - eps || py > y.hi + eps) return
    if (pts.some(p => Math.abs(p.x - px) < eps && Math.abs(p.y - py) < eps)) return
    pts.push({ x: px, y: py })
  }
  add(x.lo, c - x.lo)
  add(x.hi, c - x.hi)
  add(c - y.lo, y.lo)
  add(c - y.hi, y.hi)
  if (pts.length < 2) return null
  pts.sort((a, b) => a.x - b.x)
  const a = pts[0], b = pts[pts.length - 1]
  if (Math.abs(a.x - b.x) < eps) return null // touches a corner only
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
}

/** The sum lines worth drawing across a box: round values of x + y that actually cross it, about
 *  `target` of them. */
export function sumLevels(x: { lo: number; hi: number }, y: { lo: number; hi: number }, target = 3): number[] {
  const lo = x.lo + y.lo, hi = x.hi + y.hi
  // Inset, so a line clipping a corner by a hair is not one of them.
  const inset = (hi - lo) * 0.15
  return niceTicks(lo + inset, hi - inset, target).filter(c => sumSegment(c, x, y) != null)
}

export interface LabelBox { x: number; y: number; w: number; h: number }

/** Whether two boxes overlap. */
const boxesMeet = (a: LabelBox, b: LabelBox): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/**
 * Greedy label placement: each candidate in order takes the first of its spots whose box clears
 * every label already placed and every box in `blocked` (the labeled dots, so a name never sits on
 * someone else's dot). Order the candidates by how much each label matters, so a crowd drops the
 * lesser one. Every spot offered sits beside its own dot, so a label never drifts away from it.
 */
export function placeLabels<T>(candidates: readonly { item: T; spots: readonly LabelBox[]; own?: LabelBox }[], blocked: readonly LabelBox[] = []): { item: T; spot: number }[] {
  const kept: LabelBox[] = []
  const out: { item: T; spot: number }[] = []
  for (const c of candidates) {
    const spot = c.spots.findIndex(b =>
      !kept.some(k => boxesMeet(k, b)) && !blocked.some(d => d !== c.own && boxesMeet(d, b)))
    if (spot < 0) continue
    kept.push(c.spots[spot])
    out.push({ item: c.item, spot })
  }
  return out
}

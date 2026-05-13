// ─── Helpers ─────────────────────────────────────────────────────────────────

export function fmt(v: any): string {
  return v == null || v === '' ? '—' : String(v)
}

export function fmtDecimal(v: any, places = 2): string {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (isNaN(n)) return '—'
  const s = n.toFixed(places)
  return s.startsWith('0.') ? s.slice(1) : s
}

// Format a numeric rate (strips leading zero for values < 1, e.g. 0.285 → .285)
export const fmtR = (v: number, d: number) => { const s = v.toFixed(d); return s.startsWith('0.') ? s.slice(1) : s }

// Parse MLB innings-pitched string: "6.1" = 6⅓ innings, "6.2" = 6⅔ (the .N is outs, not a decimal fraction)
export function parseIP(ip: any): number {
  const n = Number(ip)
  if (isNaN(n) || n < 0) return 0
  const whole = Math.floor(n)
  const outs = Math.round((n - whole) * 10)   // 0, 1, or 2 outs
  return whole + outs / 3
}

export function statCols(n: number): number {
  if (n <= 3) return n || 1
  for (let cols = 3; cols >= 2; cols--) {
    if (n % cols !== 1) return cols
  }
  return 3
}

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

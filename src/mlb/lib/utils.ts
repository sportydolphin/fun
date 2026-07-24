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

/**
 * The years a player was in the majors, e.g. "1954 – 1976", "2011 – Present",
 * or just "2015" for a single-season career.
 *
 * Derived from debut/last-played rather than from the year-by-year splits: those
 * only cover seasons the player recorded stats in, so a year lost to injury would
 * silently shorten the span. StatsAPI omits lastPlayedDate for active players,
 * which is what distinguishes an open-ended career from a closed one.
 *
 * Returns null when the debut is unknown — better to show nothing than a
 * half-invented range.
 */
export function careerSpan(player: {
  mlbDebutDate?:  string
  lastPlayedDate?: string
  active?:        boolean
}): string | null {
  const first = player.mlbDebutDate?.slice(0, 4)
  if (!first) return null
  // An active player has no end yet, even if a lastPlayedDate happens to be set.
  if (player.active || !player.lastPlayedDate) return `${first} – Present`
  const last = player.lastPlayedDate.slice(0, 4)
  return last === first ? first : `${first} – ${last}`
}

// Parse MLB innings-pitched string: "6.1" = 6⅓ innings, "6.2" = 6⅔ (the .N is outs, not a decimal fraction)
export function parseIP(ip: any): number {
  const n = Number(ip)
  if (isNaN(n) || n < 0) return 0
  const whole = Math.floor(n)
  const outs = Math.round((n - whole) * 10)   // 0, 1, or 2 outs
  return whole + outs / 3
}

// Filter a leaderboard pool down to "qualified" players — enough plate
// appearances (hitting) or innings pitched (pitching) relative to the season's
// leader, so a player with 3 ABs can't camp the top of a rate-stat board.
export function filterQualified<T extends { stat: any }>(entries: T[], group: 'hitting' | 'pitching'): T[] {
  if (group === 'hitting') {
    const maxPA = Math.max(0, ...entries.map(e => Number(e.stat?.plateAppearances ?? 0)))
    const estGames = maxPA > 0 ? Math.round(maxPA / 4.3) : 162
    const threshold = Math.max(30, Math.round(estGames * 3.1))
    return entries.filter(e => Number(e.stat?.plateAppearances ?? 0) >= threshold)
  } else {
    const maxGS = Math.max(0, ...entries.map(e => Number(e.stat?.gamesStarted ?? 0)))
    const estGames = maxGS > 0 ? maxGS * 5 : 162
    const ipThreshold = Math.max(20, Math.round(estGames * 1.0))
    const ipOf = (e: any) => parseFloat(String(e.stat?.inningsPitched ?? 0)) || 0
    return entries.filter(e => ipOf(e) >= ipThreshold)
  }
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

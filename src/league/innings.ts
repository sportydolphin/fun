// Innings pitched, in either league. Stored as OUTS everywhere, because a third of an inning is
// not a decimal: "5.2" is five and two thirds. No imports, because Deno loads this through
// src/wpbl/innings.ts for the recap engine.

// Innings pitched (stored as outs) → the familiar "5.2" display.
export function outsToIp(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`
}

// The inverse: parse an IP entry ("5.2" = 5 innings + 2 outs) into total outs.
// Accepts "5", "5.0", "5.1", "5.2"; clamps an invalid fraction (.3+) down to .2.
export function ipToOuts(ip: string): number {
  const t = ip.trim()
  if (!t) return 0
  const [wholeStr, fracStr] = t.split('.')
  const whole = parseInt(wholeStr || '0', 10) || 0
  let frac = fracStr ? parseInt(fracStr, 10) || 0 : 0
  if (frac > 2) frac = 2
  return whole * 3 + frac
}

// Pure color arithmetic, no imports, so constants.ts can use it without a cycle through
// colorUtils (which imports constants).

// ─── Readable text tones ──────────────────────────────────────────────────────
//
// The section's status colors (green for a win, orange for a streak, yellow for a payroll, red for
// a loss) are Tailwind 400/500s chosen on the dark theme, where they read at 5 to 8:1. On the light
// theme the same hex is 1.9 to 3.8:1 on white: "IRON MAN" in yellow, a win's "W" in green, a
// streak's length in orange were all close to invisible. textTone keeps the HUE and moves only the
// lightness, toward black on a light surface and toward white on a dark one, by the least that
// reaches AA (4.5:1), so a color that already passes comes back untouched. Fills, bars, borders
// and tints keep the raw hex: they are not read, and darkening them would muddy the dark theme.

type Rgb = [number, number, number]
const hexRgb = (hex: string): Rgb | null => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const cssRgb = (c: string): Rgb | null => {
  const h = hexRgb(c)
  if (h) return h
  const m = c.match(/rgba?\(([^)]+)\)/)
  if (!m) return null
  const [r, g, b] = m[1].split(',').map(v => parseFloat(v))
  return [r, g, b]
}
const luminance = ([r, g, b]: Rgb) => {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
/** WCAG contrast ratio between two opaque colors. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
const toHex = (c: Rgb) => `#${c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`
const toneCache = new Map<string, string>()

/** `hex` moved toward black (light theme) or white (dark theme) by the least that makes it read at
 *  `target`:1 on `bg`. Anything that is not a 6-digit hex (a CSS var, a theme key) is returned as
 *  is, so callers can pass whatever color they hold. */
export function textTone(hex: string, isDark: boolean, bg?: string, target = 4.5): string {
  const fg = hexRgb(hex)
  if (!fg) return hex
  const key = `${hex}|${isDark}|${bg ?? ''}|${target}`
  const hit = toneCache.get(key)
  if (hit) return hit
  const surface = (bg && cssRgb(bg)) || (isDark ? [24, 27, 34] as Rgb : [255, 255, 255] as Rgb)
  const toward: Rgb = isDark ? [255, 255, 255] : [0, 0, 0]
  let out = fg
  for (let t = 0; t <= 1.0001 && contrastRatio(out, surface) < target; t += 0.04) {
    out = fg.map((v, i) => v + (toward[i] - v) * t) as Rgb
  }
  const res = out === fg ? hex : toHex(out)
  toneCache.set(key, res)
  return res
}

/** The lowest white alpha, at least `min`, that reads at `target`:1 on `bg` (a hex or hsl() card
 *  color); 1 when even solid white cannot. For the team-colored cards, whose secondary text was a
 *  fixed 0.42 or 0.62 white: fine on navy, 2.1:1 on Boston red. */
export function whiteAlphaOn(bg: string, min: number, target = 4.5): number {
  const b = hexRgb(bg) ?? hslRgb(bg)
  if (!b) return min
  for (let a = min; a < 1; a += 0.02) {
    const fg = b.map(v => 255 * a + v * (1 - a)) as Rgb
    if (contrastRatio(fg, b) >= target) return Math.round(a * 100) / 100
  }
  return 1
}
function hslRgb(c: string): Rgb | null {
  const m = /hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/i.exec(c)
  if (!m) return null
  const h = Number(m[1]) / 360, s = Number(m[2]) / 100, l = Number(m[3]) / 100
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
  const ch = (t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [ch(h + 1 / 3) * 255, ch(h) * 255, ch(h - 1 / 3) * 255]
}

/** `hex` darkened by the least that lets solid white read at `target`:1 on it. For a card painted in
 *  a club color: Baltimore's #DF4601 and Philadelphia's #E81828 carry white at 4.2 and 4.6, so
 *  their small print failed even at full white. Every darker club color comes back unchanged. */
export function cardBgForWhite(hex: string, target = 4.5): string {
  const b = hexRgb(hex)
  if (!b) return hex
  const white: Rgb = [255, 255, 255]
  let out = b
  for (let t = 0; t <= 1.0001 && contrastRatio(white, out) < target + 0.15; t += 0.02) {
    out = b.map(v => v * (1 - t)) as Rgb
  }
  return out === b ? hex : toHex(out)
}

/**
 * A color as the EDGE of something (a card, a ring, a chip): the same hue, moved toward white on
 * the dark theme or black on the light one by the least that reaches 3:1 on the page and on a card,
 * so most colors come back untouched. CLAUDE.md, "Borders".
 *
 * WHY NOT AN ALPHA. Card borders used to be the team color at 80% (dark) or 27% (light), and
 * most clubs' primaries are navy, brown or deep red: on the dark page a decided bracket series or
 * a Home game card measured 1.2:1, an edge nobody could see. Fading a color can only lower its
 * contrast; this is the one direction that raises it. Opaque, so it composes the same over any
 * surface.
 */
export function edgeTone(hex: string, isDark: boolean): string {
  return isDark
    ? textTone(textTone(hex, true, EDGE_SURFACES.dark[0], 3), true, EDGE_SURFACES.dark[1], 3)
    : textTone(textTone(hex, false, EDGE_SURFACES.light[0], 3), false, EDGE_SURFACES.light[1], 3)
}

/** The page and the lifted sheet in each theme, which are the two surfaces an edge sits on. */
const EDGE_SURFACES = { dark: ['#0f1115', '#191b1f'], light: ['#f6f7f9', '#ffffff'] } as const

/** `a` mixed into `b`, `t` of the way (0 is all `b`): an opaque tone, so text drawn on it can be
 *  measured against it. Both 6-digit hex. */
export function mixHex(a: string, b: string, t: number): string {
  const x = hexRgb(a), y = hexRgb(b)
  if (!x || !y) return a
  return toHex(x.map((v, i) => v * t + y[i] * (1 - t)) as Rgb)
}

/** A heatmap cell's fill and ink: white or near-black, whichever reads better on `bg`, and the fill
 *  stepped away from that ink by the least that clears 4.6:1. A ramp that passes through a mid tone
 *  has a band where neither ink reaches AA, and the cell giving way a few shades is the only fix
 *  that keeps the figure readable without changing the scale's hue. */
export function heatCell(bg: string): { fill: string; ink: string } {
  let c = hexRgb(bg)
  if (!c) return { fill: bg, ink: '#ffffff' }
  const white: Rgb = [255, 255, 255], dark: Rgb = [17, 20, 26]
  const ink = contrastRatio(c, white) >= contrastRatio(c, dark) ? white : dark
  const away: Rgb = ink === white ? [0, 0, 0] : [255, 255, 255]
  for (let k = 0; k < 20 && contrastRatio(c, ink) < 4.6; k++) c = c.map((v, i) => v + (away[i] - v) * 0.03) as Rgb
  return { fill: toHex(c), ink: toHex(ink) }
}

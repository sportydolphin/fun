import { useTheme } from '@mui/material'
import { TEAM_BG, TEAM_COLOR_PALETTE, TEAM_ICON_STYLE, TEAM_ICON_STYLE_LIGHT, DEFAULT_ICON_BG_DARK, teamLogoUrl, teamLogoTransform } from '../constants'

export function useIsDark(): boolean {
  return useTheme().palette.mode === 'dark'
}

// Mix hex color toward white so dark team colors are readable on dark backgrounds.
// Mix ratio 0.55 → midway between the color and white.
export function brightColor(hex: string): string {
  if (!hex.startsWith('#') || hex.length < 7) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const mix = 0.55
  const br = Math.round(r + (255 - r) * mix)
  const bg = Math.round(g + (255 - g) * mix)
  const bb = Math.round(b + (255 - b) * mix)
  return `#${br.toString(16).padStart(2, '0')}${bg.toString(16).padStart(2, '0')}${bb.toString(16).padStart(2, '0')}`
}

export { textTone, contrastRatio, whiteAlphaOn } from './contrast'
import { textTone, contrastRatio } from './contrast'

/** textTone bound to the current theme and its card surface. */
/** `target` above 4.5 for text on a tint of its own colour (a "Signed" chip on 11% green), which
 *  sits a little closer to the text than the plain card does. */
export function useTextTone(): (hex: string, bg?: string, target?: number) => string {
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const paper = theme.palette.background.paper
  const page = theme.palette.background.default
  // With no surface named, pass on BOTH the card and the page: a lot of this text sits on a card
  // with a transparent background, so the page is what is actually behind it.
  return (hex, bg, target) => bg
    ? textTone(hex, dark, bg, target)
    : textTone(textTone(hex, dark, paper, target), dark, page, target)
}

// Team color appropriate for text/icons in the current theme.
// Then held to AA on the theme's page: a club's raw primary is 4.2:1 on white for Baltimore, and
// the brightened one can fall short on a dark card the same way. A colour that passes is untouched.
export function accentColor(hex: string, isDark: boolean): string {
  return textTone(isDark ? brightColor(hex) : hex, isDark, isDark ? undefined : '#f6f7f9')
}

// Team logo-bubble ring color for the current theme, from the per-team locked-in
// icon style for that mode. Dark falls back to a brightened primary; light falls
// back to the team's primary color.
export function ringColor(teamId: number, isDark: boolean): string {
  const base = TEAM_BG[teamId] ?? '#888'
  if (isDark) return TEAM_ICON_STYLE[teamId]?.ring ?? brightColor(base)
  return TEAM_ICON_STYLE_LIGHT[teamId]?.ring ?? base
}

// Team logo-bubble center from the per-team locked-in icon style. Dark falls back
// to a neutral gray, light falls back to plain white.
export function teamLogoBg(teamId: number, isDark: boolean): string {
  if (isDark) return TEAM_ICON_STYLE[teamId]?.bg ?? DEFAULT_ICON_BG_DARK
  return TEAM_ICON_STYLE_LIGHT[teamId]?.bg ?? '#fff'
}

// Team logo image source: the per-team locked-in logo variant for the mode.
// Dark falls back to cap-on-dark, light falls back to the full-color primary.
export function teamLogoSrc(teamId: number, isDark: boolean): string {
  if (isDark) return teamLogoUrl(teamId, TEAM_ICON_STYLE[teamId]?.logo ?? 'capDark')
  return teamLogoUrl(teamId, TEAM_ICON_STYLE_LIGHT[teamId]?.logo ?? 'primary')
}

// Standings-row left-border accent, from the per-team locked-in icon style.
// Both modes fall back to the team's primary color.
export function highlightColor(teamId: number, isDark: boolean): string {
  const base = TEAM_BG[teamId] ?? '#888'
  if (isDark) return TEAM_ICON_STYLE[teamId]?.highlight ?? base
  return TEAM_ICON_STYLE_LIGHT[teamId]?.highlight ?? base
}

// CSS transform for a team's logo crop (nudge + zoom) in the current mode.
// 'none' when uncropped. Apply to the logo <img> with transformOrigin: 'center'.
export function teamLogoCrop(teamId: number, isDark: boolean): string {
  return teamLogoTransform(isDark ? TEAM_ICON_STYLE[teamId] : TEAM_ICON_STYLE_LIGHT[teamId])
}

// Opacity-suffixed hex for card borders.
export function borderAlpha(hex: string, isDark: boolean): string {
  return `${hex}${isDark ? 'cc' : '45'}`
}

// Default (non-team-colored) card border. The values of `CARD_BORDER` in src/ui/card.tsx, so the
// MLB cards not yet on `SectionCard` draw the same outline as the ones that are, on one page.
export function defaultBorder(isDark: boolean): string {
  return isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.34)'
}

// Opacity-suffixed hex for photo/avatar ring borders.
export function photoBorderAlpha(hex: string, isDark: boolean): string {
  return `${hex}${isDark ? '99' : '40'}`
}

// Background gradient string for team-colored cards.
export function cardGradient(hex: string, isDark: boolean): string {
  return `linear-gradient(155deg, ${hex}${isDark ? '28' : '18'} 0%, ${hex}${isDark ? '10' : '08'} 55%, transparent 80%)`
}

// Format a games-back string to always show one decimal place ("1" → "1.0", "0.5" → "0.5", "-" → "-").
export function fmtGB(gb: string): string {
  if (!gb || gb === '-') return gb
  const n = parseFloat(gb)
  return isNaN(n) ? gb : n.toFixed(1)
}

// Background gradient for left-accented team cards (135deg variant).
export function cardGradient135(hex: string, isDark: boolean): string {
  return `linear-gradient(135deg, ${hex}${isDark ? '2e' : '1a'} 0%, ${hex}${isDark ? '10' : '08'} 50%, transparent 75%)`
}

// ─── Two clubs on one chart ───────────────────────────────────────────────────
//
// The win probability chart fills each club's share of the game in its colour, and a club's
// PRIMARY is the wrong colour for that about half the time. Eleven primaries are near-black navy
// or brown (SD #2F241D, MIL #12284B, PIT, CWS, SF, DET, ...), and at the 30% a fill is drawn at
// they all come out the same grey: Padres at Brewers was two shades of mud with nothing to tell
// the halves apart. So each club gets its most vivid BRAND colour instead (the Padres' gold, the
// Giants' orange), the pair is chosen so the two hues are clearly different (the Padres and the
// Brewers both own a gold, so one of them has to give it up), and both are evened out to one
// saturation and lightness so no matchup draws one club loud and the other faint.

const rgbOf = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]

function hslOf(hex: string): [number, number, number] {
  const [r, g, b] = rgbOf(hex)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  const l = (max + min) / 2
  if (d === 0) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [(h * 60 + 360) % 360, s, l]
}

function hslHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return '#' + [r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')
}

/** A colour with a hue worth naming: not black, white, grey or silver. Chroma, not HSL
 *  saturation, which calls a navy nearly black "saturated". */
const isChromatic = (hex: string) => { const [r, g, b] = rgbOf(hex); return Math.max(r, g, b) - Math.min(r, g, b) >= 0.15 }

const hueGap = (a: number, b: number) => { const d = Math.abs(a - b); return Math.min(d, 360 - d) }

/** [away, home]: one fill colour per club, distinct from each other, readable on the theme. */
export function chartPairColors(awayId: number, homeId: number, isDark: boolean): [string, string] {
  const vivid = (id: number) => (TEAM_COLOR_PALETTE[id] ?? [TEAM_BG[id] ?? '#888888']).filter(isChromatic)
  const even = (hex: string) => {
    const [h, s] = hslOf(hex)
    return hslHex(h, Math.min(0.7, Math.max(0.55, s)), isDark ? 0.62 : 0.46)
  }
  // A club with no colour at all (the White Sox are black and silver) takes a slate, which
  // clashes with nobody.
  const slate = isDark ? '#9aa4b2' : '#64707f'
  const a = vivid(awayId), h = vivid(homeId)
  if (!a.length || !h.length) return [a.length ? even(a[0]) : slate, h.length ? even(h[0]) : slate]
  // Every pairing of the two palettes, each club's earlier colours first (a palette lists the
  // club's primary first), and the first whose hues sit clearly apart.
  const pairs = a.flatMap((ac, i) => h.map((hc, j) => ({ ac, hc, rank: i + j, worst: Math.max(i, j) })))
    .sort((p, q) => p.rank - q.rank || p.worst - q.worst)
  const hit = pairs.find(p => hueGap(hslOf(p.ac)[0], hslOf(p.hc)[0]) >= 40)
  // Nothing apart (every colour either club owns is the same red): the colourblind-safe pair.
  if (!hit) return [hslHex(217, 0.7, isDark ? 0.62 : 0.48), hslHex(25, 0.85, isDark ? 0.62 : 0.48)]
  return [even(hit.ac), even(hit.hc)]
}

/** Ink for a number printed ON one of those fills: white where it reads, near-black where the
 *  fill is a light gold or orange that white disappears into. */
export const inkOn = (hex: string): string =>
  contrastRatio([255, 255, 255], rgbOf(hex).map(v => v * 255) as [number, number, number]) >= 3 ? '#ffffff' : '#141414'

import { useTheme } from '@mui/material'
import { TEAM_BG, TEAM_ICON_STYLE, TEAM_ICON_STYLE_LIGHT, DEFAULT_ICON_BG_DARK, teamLogoUrl, teamLogoTransform } from '../constants'

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
import { textTone } from './contrast'

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

// Team logo image source — the per-team locked-in logo variant for the mode.
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

// Default (non-team-colored) card border — darker than MUI's default 'divider'
// (~12% opacity) so plain card outlines read more defined.
export function defaultBorder(isDark: boolean): string {
  return isDark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.28)'
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

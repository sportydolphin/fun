import { useTheme } from '@mui/material'

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

// Team color appropriate for text/icons in the current theme.
export function accentColor(hex: string, isDark: boolean): string {
  return isDark ? brightColor(hex) : hex
}

// Opacity-suffixed hex for card borders.
export function borderAlpha(hex: string, isDark: boolean): string {
  return `${hex}${isDark ? 'cc' : '45'}`
}

// Opacity-suffixed hex for photo/avatar ring borders.
export function photoBorderAlpha(hex: string, isDark: boolean): string {
  return `${hex}${isDark ? '99' : '40'}`
}

// Background gradient string for team-colored cards.
export function cardGradient(hex: string, isDark: boolean): string {
  return `linear-gradient(155deg, ${hex}${isDark ? '28' : '18'} 0%, ${hex}${isDark ? '10' : '08'} 55%, transparent 80%)`
}

// Background gradient for left-accented team cards (135deg variant).
export function cardGradient135(hex: string, isDark: boolean): string {
  return `linear-gradient(135deg, ${hex}${isDark ? '2e' : '1a'} 0%, ${hex}${isDark ? '10' : '08'} 50%, transparent 75%)`
}

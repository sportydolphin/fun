import { useTheme } from '@mui/material'

/**
 * Is the app in dark mode? For a colour that has to be picked per theme in JS (a club's
 * foreground-safe accent, a logo variant, a chart fill), where a theme token cannot reach.
 *
 * One hook for both sections. Each had its own (`useWpblDark`, `useIsDark`), identical to the
 * character, until Oct 2026.
 */
export function useDark(): boolean {
  return useTheme().palette.mode === 'dark'
}

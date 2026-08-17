import { createContext, useContext, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useTheme } from '@mui/material'
import { WPBL_ACCENT, wpblAccent, wpblColor } from './constants'
import { useWpblFavoriteTeam } from './favoriteTeam'

// The WPBL section's colour identity — league blue by default, the reader's team once they
// pick one. This is the whole payoff of the favourite: the section wears your colours, and
// nothing is hidden, reordered, or prioritised to make room for it. In a 30-game, four-team
// season that matters — every game is a big slice of the whole, so a favourite that demoted
// the other three would take more away than it gave.
//
// The context hands back a real hex string, deliberately, rather than a CSS variable.
// Roughly forty call sites build translucent variants by concatenation (`${accent}24`,
// `${accent}0d`, …), and `var(--wpbl-accent)24` is not a colour. Surface-level theming that
// ISN'T concatenated — the card hairline — does go through a CSS variable, because that one
// is read from 28 call sites that only ever pass it straight to `borderColor`.
//
// Per-team hues come from the curated WPBL_ACCENTS map in constants.ts, which already has
// light and dark variants tuned so all four teams stay legible in both themes.

interface AccentValue {
  /** Foreground hue: text, borders, bars. Safe to append an alpha suffix to. */
  accent: string
  /** The favourite's team id, or null. For the masthead and browser chrome. */
  teamId: string | null
}

const AccentContext = createContext<AccentValue>({ accent: WPBL_ACCENT, teamId: null })

/** The current section accent as a hex string. Safe to concatenate an alpha suffix onto. */
export function useWpblAccent(): string {
  return useContext(AccentContext).accent
}

/** The favourite team id, or null when there is no favourite. */
export function useWpblTeamId(): string | null {
  return useContext(AccentContext).teamId
}

// The browser's own chrome — the phone status bar, and the title bar of the installed PWA.
// index.html ships a fixed slate default; this points it at the team's PRIMARY (not the
// accent) because that bar is a large flat fill and every WPBL primary is a deep near-black
// that suits it, where the vivid accent would read as a highlighter stripe across the top of
// the phone. Restored on unmount so leaving /wpbl doesn't leave MLB wearing someone's colours.
const DEFAULT_THEME_COLOR = '#0f172a'

function useThemeColor(teamId: string | null) {
  useEffect(() => {
    const el = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (!el) return
    const previous = el.getAttribute('content') ?? DEFAULT_THEME_COLOR
    el.setAttribute('content', teamId ? wpblColor(teamId) : DEFAULT_THEME_COLOR)
    return () => { el.setAttribute('content', previous) }
  }, [teamId])
}

export function WpblAccentProvider({ teamIds, children }: {
  /** The teams that currently exist, so a stale favourite falls back instead of colouring nothing. */
  teamIds?: ReadonlySet<string>
  children: ReactNode
}) {
  // Reads the theme directly rather than through ui.tsx's useWpblDark: ui.tsx consumes this
  // module's hook, and importing back into it would close a cycle for one boolean.
  const isDark = useTheme().palette.mode === 'dark'
  const { favoriteTeamId } = useWpblFavoriteTeam(teamIds)
  useThemeColor(favoriteTeamId)
  const value = useMemo<AccentValue>(
    () => ({
      accent: favoriteTeamId ? wpblAccent(favoriteTeamId, isDark) : WPBL_ACCENT,
      teamId: favoriteTeamId,
    }),
    [favoriteTeamId, isDark],
  )
  return <AccentContext.Provider value={value}>{children}</AccentContext.Provider>
}

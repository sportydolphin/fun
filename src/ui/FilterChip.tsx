import React from 'react'
import { Box } from '@mui/material'
import { pressable, hoverOnly, FOCUS_RING } from './interaction'
import { CARD_BORDER, ACCENT_EDGE } from './card'
import { chromePx } from './scale'

// A FILTER on the board in front of the reader: a club, a slice of the season, the qualifying
// bar. Moved out of WPBL's StatsView in Oct 2026 for MLB's stats table, which drew its qualifying
// bar as a "✓ Qual" pill of its own. The third of the boards' three visual languages: PageTabs
// for pages, PillGroup for a switch, this for a filter. WPBL's browse pages (the gallery, Reading,
// Watch) had a second chip, filled solid and a size larger, until Oct 2026; it is this one now,
// with its row and its new-item dot, so a filter reads the same on every page of both sections.

/** Both sections' accent, raw, for the 7% tint. The EDGE takes the foreground-safe var with the
 *  text: raw #60a5fa measured 2.37:1 on the light page, under the 3:1 an outline needs (CLAUDE.md,
 *  "Borders"), and the var is the same blue in dark mode, where it already passed. */
const ACCENT = '#60a5fa'

/** The chip's look, for the two controls in the same row that are not toggles: a select (the
 *  season) and a button that opens a picker. Until Oct 2026 MLB drew those as pills of their own,
 *  a size and a border weight larger, so its control row read as two sets of controls. */
export const filterChipSx = (active: boolean) => ({
  ...FOCUS_RING,
  display: 'inline-flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none',
  flexShrink: 0, whiteSpace: 'nowrap',
  px: 1, py: 0.4, borderRadius: 999, fontSize: '0.74rem', fontWeight: 700,
  border: '1px solid', transition: 'all 0.15s',
  borderColor: active ? ACCENT_EDGE : CARD_BORDER,
  color: active ? 'var(--wpbl-accent-fg)' : 'text.secondary',
  bgcolor: active ? `${ACCENT}12` : 'transparent',
  ...hoverOnly({ borderColor: ACCENT_EDGE }),
  // 25px tall suits a cursor and not a thumb, and these rows are how a browse page is narrowed on
  // a phone. Taller on a touch screen only, so a desktop row stays compact.
  '@media (pointer: coarse)': { py: 0.7 },
}) as const

/** `dot` marks a chip with something new behind it (newSince.ts). */
export function FilterChip({ active, onClick, children, dot }: { active: boolean; onClick: () => void; children: React.ReactNode; dot?: boolean }) {
  return (
    <Box {...pressable(onClick)} aria-pressed={active} sx={filterChipSx(active)}>
      {children}
      {dot && (
        <Box component="span" role="img" aria-label="new" sx={{
          display: 'inline-block', width: 6, height: 6, borderRadius: '50%', ml: 0.6, flexShrink: 0,
          bgcolor: 'var(--wpbl-accent-solid)',
        }} />
      )}
    </Box>
  )
}

/** A row of filter chips: ONE LINE THAT SCROLLS SIDEWAYS ON A PHONE, wrapping from sm up.
 *
 *  Wrapped at 375px the gallery's subject row was twenty-odd pills stacked eleven lines deep, a full
 *  screen of names in front of the first photo, on the page whose whole point is the photos. One
 *  swipeable line costs one line, and the chip cut off at the right edge is what says there is more.
 *  Full-bleed on a phone (cancelling the page's gutter and handing it back as padding) so a chip
 *  scrolls out under the screen edge rather than being clipped at an invisible margin. From sm up
 *  there is room for a few rows and wrapping shows every name at once. */
export function ChipRow({ mb, children }: { mb: number; children: React.ReactNode }) {
  return (
    <Box sx={{
      display: 'flex', gap: 0.75, mb,
      flexWrap: { xs: 'nowrap', sm: 'wrap' },
      overflowX: { xs: 'auto', sm: 'visible' },
      // `50% - 50vw` rather than a fixed -16px: the page sits inside two 16px gutters (the
      // section's and the page's), and this reaches the screen edge whatever they add up to.
      mx: { xs: 'calc(50% - 50vw)', sm: 0 }, px: { xs: 'calc(50vw - 50%)', sm: 0 },
      scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' },
    }}>
      {children}
    </Box>
  )
}

/** A chip that picks one of many (a season), as a native select so the list is the platform's.
 *  Lit while it is off its default, as a filter chip is while it is on. */
export function FilterSelect({ value, options, onChange, active, ariaLabel }: {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  active: boolean
  ariaLabel: string
}) {
  return (
    <Box sx={{ ...filterChipSx(active), position: 'relative', p: 0, '&:focus-within': { borderColor: ACCENT_EDGE } }}>
      <Box component="select" value={value} aria-label={ariaLabel} onChange={e => onChange((e.target as HTMLSelectElement).value)}
        sx={{
          appearance: 'none', border: 'none', outline: 'none', bgcolor: 'transparent', color: 'inherit',
          font: 'inherit', cursor: 'pointer', borderRadius: 999,
          // The chip's own padding, with room on the right for the caret drawn over it.
          py: 0.4, pl: 1, pr: 2.25,
          '& option': { color: 'text.primary', bgcolor: 'background.paper' },
        }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Box>
      <Box component="span" aria-hidden sx={{ position: 'absolute', right: chromePx(8), fontSize: '0.6rem', pointerEvents: 'none' }}>▾</Box>
    </Box>
  )
}

/** A filter that is ON and has no picker of its own on the board, said in words with a way out:
 *  "Catchers ✕". The search sets these (`?pos=` from "best catcher"), and a board narrowed by
 *  something the reader cannot see would read as a board missing most of its players. */
export function ActiveFilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <Box component="button" type="button" onClick={onClear} aria-label={`${label}: remove filter`}
      sx={{ ...filterChipSx(true), font: 'inherit', fontSize: '0.74rem', fontWeight: 700, gap: 0.5 }}>
      {label}
      <Box component="span" aria-hidden sx={{ fontSize: '0.9em', lineHeight: 1 }}>✕</Box>
    </Box>
  )
}

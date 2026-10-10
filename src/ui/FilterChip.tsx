import React from 'react'
import { Box } from '@mui/material'
import { pressable, hoverOnly, FOCUS_RING } from './interaction'
import { CARD_BORDER } from './card'
import { chromePx } from './scale'

// A FILTER on the board in front of the reader: a club, a slice of the season, the qualifying
// bar. Moved out of WPBL's StatsView in Oct 2026 for MLB's stats table, which drew its qualifying
// bar as a "✓ Qual" pill of its own. The third of the boards' three visual languages: PageTabs
// for pages, PillGroup for a switch, this for a filter.

/** Both sections' accent, raw: a border and a 7% tint, neither of them text. The text takes the
 *  foreground-safe var. */
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
  borderColor: active ? ACCENT : CARD_BORDER,
  color: active ? 'var(--wpbl-accent-fg)' : 'text.secondary',
  bgcolor: active ? `${ACCENT}12` : 'transparent',
  ...hoverOnly({ borderColor: ACCENT }),
}) as const

export function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Box {...pressable(onClick)} aria-pressed={active} sx={filterChipSx(active)}>
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
    <Box sx={{ ...filterChipSx(active), position: 'relative', p: 0, '&:focus-within': { borderColor: ACCENT } }}>
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

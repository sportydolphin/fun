import React from 'react'
import { Box } from '@mui/material'
import { pressable, hoverOnly, FOCUS_RING } from './interaction'
import { CARD_BORDER } from './card'

// A FILTER on the board in front of the reader: a club, a slice of the season, the qualifying
// bar. Moved out of WPBL's StatsView in Oct 2026 for MLB's stats table, which drew its qualifying
// bar as a "✓ Qual" pill of its own. The third of the boards' three visual languages: PageTabs
// for pages, PillGroup for a switch, this for a filter.

/** Both sections' accent, raw: a border and a 7% tint, neither of them text. The text takes the
 *  foreground-safe var. */
const ACCENT = '#60a5fa'

export function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Box {...pressable(onClick)} aria-pressed={active} sx={{
      ...FOCUS_RING,
      display: 'inline-flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none',
      flexShrink: 0, whiteSpace: 'nowrap',
      px: 1, py: 0.4, borderRadius: 999, fontSize: '0.74rem', fontWeight: 700,
      border: '1px solid', transition: 'all 0.15s',
      borderColor: active ? ACCENT : CARD_BORDER,
      color: active ? 'var(--wpbl-accent-fg)' : 'text.secondary',
      bgcolor: active ? `${ACCENT}12` : 'transparent',
      ...hoverOnly({ borderColor: ACCENT }),
    }}>
      {children}
    </Box>
  )
}

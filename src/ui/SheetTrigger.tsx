import React from 'react'
import { Box } from '@mui/material'
import { ExpandMore } from '@mui/icons-material'
import { pressable, hoverOnly, FOCUS_RING } from './interaction'
import { TYPE_SCALE } from './card'
import { typePx } from './scale'

// THE PHONE'S ONE CONTROL that opens a stats board's sheet: "Sort WAR", "Filters". Both sections'
// stats pages draw it beside a PillGroup (Hitting / Pitching), so it is drawn as that switch's
// twin: the same gray track, height and type. Until Nov 2026 each section drew its own, and all of
// them were an outlined chip lit in the accent whenever it sorted, a size of type larger than the
// switch, with a 5px "▾" for a caret. It looked selected when nothing was, and the row read as two
// components from two pages. The accent is now only the dot, which says a filter is set, so a
// filter is never silently on.

/** `lead` is the secondary word before the label ("Sort", or "Worst" when reversed). */
export function SheetTrigger({ lead, label, set, open, onOpen, ariaLabel }: {
  lead?: string
  label: React.ReactNode
  /** Something in the sheet is off its default: draws the dot. */
  set: boolean
  open: boolean
  onOpen: () => void
  ariaLabel: string
}) {
  return (
    <Box {...pressable(onOpen)} aria-haspopup="dialog" aria-expanded={open} aria-label={ariaLabel} sx={{
      ...FOCUS_RING,
      display: 'inline-flex', alignItems: 'center', gap: 0.5, flexShrink: 0,
      cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
      // 34 is the PillGroup's height beside it: 28 per segment plus its 3px track on each side.
      minHeight: 34, pl: 1.25, pr: 0.75, borderRadius: 999, bgcolor: 'action.hover',
      fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: typePx(0.3),
      color: 'text.primary', transition: 'background-color 0.15s',
      ...hoverOnly({ bgcolor: 'action.selected' }),
    }}>
      {lead && <Box component="span" sx={{ color: 'text.secondary' }}>{lead}</Box>}
      {label}
      {set && <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'var(--wpbl-accent-solid)' }} />}
      <ExpandMore aria-hidden sx={{ fontSize: '1.15em', color: 'text.secondary', ml: -0.25 }} />
    </Box>
  )
}

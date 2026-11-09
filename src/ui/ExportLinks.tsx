import { useEffect, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { TYPE_SCALE } from './card'
import { pressable, FOCUS_RING } from './interaction'

// The stats boards' export controls, both sections'. The files themselves are `exportTable.ts`.

/** What the foot's export controls ask for: a CSV file, or the board on the clipboard. */
export type ExportKind = 'csv' | 'copy'

/**
 * "CSV · Copy": the board as a file, and the board as cells to paste into a sheet.
 *
 * SET AS THE FOOT'S OWN LINE OF TYPE, not as pills, so the foot is the height it always was: the
 * desktop skeletons reserve the board's foot as one line of micro type (WPBL's `DESKTOP_BOARD_SKELETON`),
 * and a 34px pill would push everything under the board down when it lands. On a phone the row
 * already holds the 34px "Full table" pill, so there the two get the same height as a tap target.
 */
export function ExportLinks({ onExport, isNarrow }: { onExport: (kind: ExportKind) => Promise<boolean>; isNarrow: boolean }) {
  const [said, setSaid] = useState<'Copied' | 'Copy failed' | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const run = (kind: ExportKind) => {
    void onExport(kind).then(ok => {
      if (kind !== 'copy') return
      setSaid(ok ? 'Copied' : 'Copy failed')
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setSaid(null), 1600)
    })
  }
  const link = {
    ...FOCUS_RING, cursor: 'pointer', whiteSpace: 'nowrap', color: 'var(--wpbl-accent-fg)', fontWeight: 800,
    display: 'inline-flex', alignItems: 'center', minHeight: isNarrow ? 34 : undefined, borderRadius: 1,
    '@media (hover: hover)': { '&:hover': { textDecoration: 'underline' } },
  } as const
  return (
    <Typography component="div" sx={{
      fontSize: TYPE_SCALE.micro, color: 'text.secondary', fontWeight: 600, flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', gap: 0.75, ml: 'auto',
    }}>
      <Box {...pressable(() => run('csv'))} aria-label="Download CSV" sx={link}>CSV</Box>
      <Box component="span" aria-hidden>·</Box>
      {/* The confirmation replaces the label in place rather than opening a toast: the reader is
          looking right here, and a toast at the foot of a phone sits behind the bottom nav. */}
      <Box {...pressable(() => run('copy'))} aria-live="polite" sx={link}>{said ?? 'Copy'}</Box>
    </Typography>
  )
}

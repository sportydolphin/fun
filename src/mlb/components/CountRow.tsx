import type React from 'react'
import { Box, Typography } from '@mui/material'
import { TYPE_SCALE } from '../../ui/card'
import { pressable } from '../../ui/interaction'

/**
 * A card's way into a sheet: a label, what the sheet holds, and the whole row is the target. The same
 * row on the awards, games and team cards, so a reader learns it once.
 */
export function CountRow({ label, value, onOpen }: { label: string; value: React.ReactNode; onOpen: () => void }) {
  return (
    <Box {...pressable(onOpen)} sx={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1, py: 0.75,
      cursor: 'pointer', borderTop: '1px solid', borderColor: 'divider',
    }}>
      <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700 }}>{label}</Typography>
      <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
        {value} ›
      </Typography>
    </Box>
  )
}

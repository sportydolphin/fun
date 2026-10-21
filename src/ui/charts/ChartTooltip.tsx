import React, { useState } from 'react'
import { Box } from '@mui/material'
import { chromePx } from '../scale'

// MLB's chart tooltip, shared since WPBL's scatter plots draw the same card: a reader moving
// between the sections' charts should see one tooltip, not two that drifted.

/** Hover state for a chart whose tooltip follows the pointer. */
export function useChartTooltip<T>(boxRef: React.RefObject<HTMLDivElement>) {
  const [hovered, setHovered] = useState<T | null>(null)
  const [tipPos, setTipPos] = useState({ x: 0, y: 0, flip: false })
  const onEnter = (item: T, e: React.MouseEvent) => {
    const rect = boxRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    setTipPos({ x, y: e.clientY - rect.top, flip: x > rect.width * 0.58 })
    setHovered(item)
  }
  return { hovered, setHovered, tipPos, onEnter }
}

/** The card, placed in px from the chart box's top left. `flip` puts it to the left of the point,
 *  for a point in the right of the chart where the card would run off the edge. */
export function ChartTooltip({ tipPos, children }: { tipPos: { x: number; y: number; flip: boolean }; children: React.ReactNode }) {
  return (
    <Box sx={{
      position: 'absolute',
      left: tipPos.flip ? undefined : tipPos.x + 14,
      right: tipPos.flip ? `calc(100% - ${tipPos.x}px + 14px)` : undefined,
      top: tipPos.y - 36,
      bgcolor: 'background.paper',
      border: '1px solid', borderColor: 'outline',
      borderRadius: 2, px: 1.5, py: 1,
      pointerEvents: 'none',
      boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
      zIndex: 10, minWidth: chromePx(148),
    }}>
      {children}
    </Box>
  )
}

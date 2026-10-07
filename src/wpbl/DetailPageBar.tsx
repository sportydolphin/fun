import type React from 'react'
import { Box, Typography } from '@mui/material'
import { pressable, hoverOnly, FOCUS_RING } from './ui'
import { typePx } from '../ui/scale'

/**
 * The top line of a full desktop detail page (a game, a player): Back, the eyebrow the panel's
 * header carries, and the same actions beside it.
 *
 * ONE COMPONENT FOR BOTH PAGES so they cannot drift: the panel and the page are the same card at
 * two sizes, and a reader who expands one should find Back, the label and Copy link where the
 * panel had them. It is the panel's header laid flat on the page, without the close button, since
 * a page is left by Back like any other page.
 */
export function DetailPageBar({ onBack, eyebrow, actions }: {
  onBack: () => void
  eyebrow: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.25 }}>
      <Box {...pressable(onBack)} aria-label="Back" sx={{
        display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5, ml: -1, borderRadius: 999,
        cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, color: 'text.secondary',
        ...hoverOnly({ bgcolor: 'action.hover', color: 'text.primary' }),
        ...FOCUS_RING,
      }}>
        <Box component="span" aria-hidden sx={{ fontSize: '1rem', lineHeight: 1 }}>‹</Box>
        Back
      </Box>
      <Typography component="div" sx={{
        flex: 1, minWidth: 0, fontWeight: 800, fontSize: '0.72rem', color: 'text.secondary',
        textTransform: 'uppercase', letterSpacing: typePx(1), lineHeight: 1,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {eyebrow}
      </Typography>
      {actions}
    </Box>
  )
}

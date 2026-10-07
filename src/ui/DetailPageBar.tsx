import type React from 'react'
import { Box, Typography } from '@mui/material'
import { HeaderBack, HEADER_EYEBROW_SX } from './headerBar'

/**
 * The top line of a full desktop detail page (a game, a player): Back, the eyebrow the panel's
 * header carries, and the same actions beside it.
 *
 * ONE COMPONENT FOR BOTH PAGES so they cannot drift: the panel and the page are the same card at
 * two sizes, and a reader who expands one should find Back, the label and Copy link where the
 * panel had them. It is the panel's header laid flat on the page, without the close button, since
 * a page is left by Back like any other page. Set in the header bar's one voice (see headerBar).
 */
export function DetailPageBar({ onBack, eyebrow, actions }: {
  onBack: () => void
  eyebrow: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25 }}>
      <HeaderBack onBack={onBack} />
      <Typography component="div" sx={HEADER_EYEBROW_SX}>{eyebrow}</Typography>
      {actions}
    </Box>
  )
}

// The side panel's way up to a full page, for a sheet header's `actions` slot beside Copy link.
//
// Drawn as Copy link's twin (same chip, same size, same receding idle colour) because the two sit
// side by side and do the same kind of thing: neither changes what is shown, both change where it
// lives. Shared rather than WPBL's own for the same reason that control is: MLB's Game Center is
// meant to follow.
import { Box, Typography } from '@mui/material'
import { hoverOnly, FOCUS_RING, pressable } from './interaction'
import { typePx } from './scale'

export function ExpandButton({ onExpand, title = 'Open as a full page' }: {
  onExpand: () => void
  title?: string
}) {
  return (
    <Box
      {...pressable(onExpand)}
      title={title}
      aria-label={title}
      sx={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0.5,
        height: 26, px: 0.9, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
        color: 'text.disabled',
        ...hoverOnly({ bgcolor: 'action.hover', color: 'text.primary' }),
        ...FOCUS_RING,
      }}
    >
      <Typography sx={{ fontSize: '0.8rem', lineHeight: 1 }} aria-hidden>⤢</Typography>
      <Typography sx={{
        fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: typePx(0.6),
        lineHeight: 1, whiteSpace: 'nowrap',
      }}>
        Expand
      </Typography>
    </Box>
  )
}

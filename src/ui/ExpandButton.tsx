// The side panel's way up to a full page, for a sheet header's `actions` slot beside Copy link.
//
// Drawn as Copy link's twin (same chip, same size, same receding idle colour) because the two sit
// side by side and do the same kind of thing: neither changes what is shown, both change where it
// lives. Shared rather than WPBL's own for the same reason that control is: MLB's Game Center is
// meant to follow.
import { Box } from '@mui/material'
import { OpenInFull } from '@mui/icons-material'
import { pressable } from './interaction'
import { HeaderChipLabel, HEADER_ICON_SX, headerChipSx } from './headerBar'

export function ExpandButton({ onExpand, title = 'Open as a full page' }: {
  onExpand: () => void
  title?: string
}) {
  return (
    <Box
      {...pressable(onExpand)}
      title={title}
      aria-label={title}
      sx={headerChipSx}
    >
      <HeaderChipLabel icon={<OpenInFull aria-hidden sx={{ ...HEADER_ICON_SX, fontSize: '0.85rem' }} />}>Expand</HeaderChipLabel>
    </Box>
  )
}

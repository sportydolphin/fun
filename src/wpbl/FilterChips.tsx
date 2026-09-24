import React from 'react'
import { Box } from '@mui/material'

// The filter chips shared by the standalone browse pages (the gallery, Reading): one definition
// so a chip looks and behaves the same wherever a reader narrows a list.

/** A row of filter chips: ONE LINE THAT SCROLLS SIDEWAYS ON A PHONE, wrapping from sm up.
 *
 *  Wrapped at 375px the subject row was twenty-odd pills stacked eleven lines deep, a full screen of
 *  names in front of the first photo, on the page whose whole point is the photos. One swipeable
 *  line costs one line, and the chip cut off at the right edge is what says there is more.
 *  Full-bleed on a phone (cancelling the page's gutter and handing it back as padding) so a
 *  chip scrolls out under the screen edge rather than being clipped at an invisible margin. From
 *  sm up there is room for a few rows and wrapping shows every name at once. */
export function ChipRow({ mb, children }: { mb: number; children: React.ReactNode }) {
  return (
    <Box sx={{
      display: 'flex', gap: 0.75, mb,
      flexWrap: { xs: 'nowrap', sm: 'wrap' },
      overflowX: { xs: 'auto', sm: 'visible' },
      // `50% - 50vw` rather than a fixed -16px: the page sits inside two 16px gutters (the
      // section's and WpblPage's), and this reaches the screen edge whatever they add up to.
      mx: { xs: 'calc(50% - 50vw)', sm: 0 }, px: { xs: 'calc(50vw - 50%)', sm: 0 },
      scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' },
      '& > *': { flexShrink: 0, whiteSpace: 'nowrap' },
    }}>
      {children}
    </Box>
  )
}

export function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Box onClick={onClick} role="button" tabIndex={0} aria-pressed={active}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      sx={{
        px: 1.3, py: 0.5, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
        fontSize: '0.76rem', fontWeight: 700, lineHeight: 1.5, border: '1px solid',
        borderColor: active ? 'primary.main' : 'divider',
        bgcolor: active ? 'primary.main' : 'background.paper',
        color: active ? 'primary.contrastText' : 'text.secondary',
        '&:hover': { borderColor: active ? 'primary.main' : 'text.secondary' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2 },
      }}>
      {label}
    </Box>
  )
}

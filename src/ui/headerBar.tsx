// The one voice of a detail header: the page's bar (DetailPageBar) and a sheet's or panel's
// (ModalShell's ShellHeader), and every control that sits in either (Back, Follow, Compare, Copy
// link, Expand, Close).
//
// ONE SIZE, ONE WEIGHT, ONE CASE, AND COLOUR FOR THE HIERARCHY. These grew up separately: Back in
// sentence case at 0.8rem, the label at 0.72rem with wide tracking, the chips at 0.62rem in the
// faintest grey with emoji for icons, so a bar of four things read as three typefaces. Now every
// word in the bar is set the same, the label that names the page is the one thing in full ink, the
// controls around it are the secondary grey, and the icons are all from the same set.
import type React from 'react'
import { Box, Typography } from '@mui/material'
import { ChevronLeft } from '@mui/icons-material'
import { hoverOnly, FOCUS_RING, pressable } from './interaction'
import { chromePx, typePx } from './scale'

/** Every word in a header bar. */
export const HEADER_TEXT_SX = {
  fontSize: '0.66rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: typePx(0.6),
  lineHeight: 1, whiteSpace: 'nowrap',
} as const

/** The label naming what the page or sheet is: the same type, in full ink, and the one part of the
 *  bar that gives way when it is short of room. */
export const HEADER_EYEBROW_SX = {
  ...HEADER_TEXT_SX, flex: 1, minWidth: 0, color: 'text.primary',
  overflow: 'hidden', textOverflow: 'ellipsis',
} as const

/** An icon beside a header word. */
export const HEADER_ICON_SX = { fontSize: '1rem', flexShrink: 0 } as const

/** A control in a header bar: the same pill as the scope pills on the card (28px, the chrome scale). */
export const headerChipSx = {
  flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0.5,
  height: chromePx(28), px: 1, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
  textDecoration: 'none', color: 'text.secondary', transition: 'color 0.15s, background-color 0.15s',
  ...hoverOnly({ bgcolor: 'action.hover', color: 'text.primary' }),
  ...FOCUS_RING,
} as const

/** A chip's icon and word. */
export function HeaderChipLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      {icon}
      <Typography component="span" sx={HEADER_TEXT_SX}>{children}</Typography>
    </>
  )
}

/** Back, pulled left by its own padding so the chevron sits on the page's edge. */
export function HeaderBack({ onBack, label = 'Back', ariaLabel }: {
  onBack: () => void
  label?: string
  ariaLabel?: string
}) {
  return (
    <Box {...pressable(onBack)} aria-label={ariaLabel ?? label} sx={{ ...headerChipSx, ml: -1, pl: 0.5, gap: 0.25 }}>
      <HeaderChipLabel icon={<ChevronLeft aria-hidden sx={{ fontSize: '1.15rem' }} />}>{label}</HeaderChipLabel>
    </Box>
  )
}

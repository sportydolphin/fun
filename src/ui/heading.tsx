import React from 'react'
import { Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'
import { TAB_TITLE_SX } from './card'

// The drawing half of a page's heading, for both sections. WHO owns the page's one <h1> is each
// section's own question and stays there (a context in WPBL's PageHeading.tsx, the address in
// MLB's), because their overlays are built differently; what a title looks like, and how a heading
// is read but not drawn, is the same answer in both. Until Oct 2026 the hidden style alone had four
// copies across the site, one of them missing the margin that keeps it from nudging its neighbours.

/**
 * Read but not drawn. `clipPath` rather than `display: none`, which would take the element out
 * of the accessibility tree and leave the page with no heading at all.
 *
 * Every unit is a STRING, because MUI's `sx` reads a bare `width: 1` as 100%. That makes this
 * safe to spread into an `sx` as well as into a `style`.
 */
export const VISUALLY_HIDDEN = {
  position: 'absolute', width: '1px', height: '1px',
  overflow: 'hidden', clipPath: 'inset(50%)',
  padding: 0, margin: '-1px', border: 0, whiteSpace: 'nowrap',
} as const

/** An <h1> that is read and not drawn, for a page whose real heading is a graphic (a line score,
 *  a player's card). Matches the page's <title>. */
export function VisuallyHiddenH1({ children }: { children: React.ReactNode }) {
  return <h1 style={{ ...VISUALLY_HIDDEN, font: 'inherit' }}>{children}</h1>
}

/** A tab's drawn title, in the one style both sections share, so a switch between
 *  /wpbl/standings and /mlb/standings changes the words and not the type. `tag` is the section's
 *  answer to whether the tab is the page right now; it looks the same either way. `sx` is the
 *  tab's own spacing. */
export function TabTitleText({ tag, children, sx }: { tag: 'h1' | 'div'; children: React.ReactNode; sx?: SxProps<Theme> }) {
  return (
    <Typography component={tag} sx={[TAB_TITLE_SX, ...(Array.isArray(sx) ? sx : [sx])]}>
      {children}
    </Typography>
  )
}

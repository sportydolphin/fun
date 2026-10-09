import React from 'react'
import { Box, Typography } from '@mui/material'
import { navBack } from '../nav'
import { TYPE_SCALE } from './card'
import { hoverOnly, FOCUS_RING } from './interaction'
import { panelShiftSx, useSidePanelOpen } from './ModalShell'
import { typePx } from './scale'

// The shell every STANDALONE page wears: in WPBL the league, the season recap, scorigami, the
// players index, the glossary, the data sources; in MLB the glossary. They are sibling routes to
// the section's app, each drawn on its own, and before this each rolled its own header: some had a Back pill and some did not,
// some centred a 56.25rem column and some ran full-bleed, and the title ranged from a bold 1.5rem
// down to a 1.05rem barely above body text. That is five near-copies drifting apart, and it read
// as five different sites. This is the one header, so they cannot.
//
// It does NOT touch a page's content: everything below the standfirst is the page's own, cards or
// tables or a grid, unchanged. This unifies the frame, not the picture inside it.
//
// Shared since Oct 9, 2026 (it was WPBL's alone), so the section's own parts come in as props:
// where Back goes and what it says, and whether the title is the page's <h1>.

const isModified = (e: React.MouseEvent) =>
  e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0

export default function StandalonePage({ title, standfirst, maxWidth = '56.25rem', back, headingTag = 'h1', children }: {
  /** The page's own name, rendered as `headingTag`: its <h1>, or a <div> while a modal owns the
   *  heading (harmless on these pages, which are never under a modal, and correct if one ever is). */
  title: React.ReactNode
  /** The one line under the title. Omit it on a page whose heading needs no gloss (Sources). */
  standfirst?: React.ReactNode
  /** Content column width. The default is the section's standard reading column; a tool with its
   *  own layout (Compare) can narrow it. */
  maxWidth?: number | string
  /** The section's root, which the phone-only Back pill returns to when there is no history. */
  back: { href: string; label: string }
  headingTag?: 'h1' | 'div'
  children: React.ReactNode
}) {
  const panelOpen = useSidePanelOpen()
  return (
    // NO SIDE PADDING OF ITS OWN ON A PHONE. The shell already pads every page 16px a side (App.tsx),
    // and this added another 16, so the standalone pages read in a 311px column on a 375px phone
    // while the tabs beside them had 343: a fifth of the screen spent on gutters, on the pages with
    // the widest tables. On a phone the shell's 16 is the gutter, the same one the tabs use; a block
    // that wants the screen's full width bleeds with `mx: { xs: -2 }` (the shell's padding) and insets
    // its own content, as Scorigami's grid and the matchups table do.
    //
    // Moves aside for the side panel a player or a game opens in over these pages (see panelShiftSx),
    // by the column's own width: nothing on these pages breaks out of it.
    <Box sx={{ maxWidth, mx: 'auto', px: { xs: 0, sm: 3 }, pb: 6, ...panelShiftSx(panelOpen, typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth) }}>
      {/* Back to the section, not to a fixed root: `navBack` returns the reader to wherever they
          opened this from (a tab, a player), and only falls back to the section root when they
          arrived cold. A real <a href> so a crawler follows it and cmd-click opens a new tab.

          PHONES ONLY. Above 600px the toolbar carries the section's tabs on these pages too
          (ToolbarNav), so a pill saying "back to the section" sat directly under the section's
          own nav. On a phone the tabs are the bottom bar, which is the section's and absent here, so
          this is still the way back, and an installed app has no browser Back button to fall
          back on. */}
      <Box
        component="a"
        href={back.href}
        onClick={e => { if (!isModified(e)) { e.preventDefault(); navBack(back.href) } }}
        sx={{
          textDecoration: 'none', display: { xs: 'inline-flex', sm: 'none' }, alignItems: 'center', gap: 0.5, mb: 2,
          color: 'text.secondary', fontSize: TYPE_SCALE.body, fontWeight: 700,
          px: 1.25, py: 0.6, borderRadius: 999, border: '1px solid', borderColor: 'divider',
          bgcolor: 'background.paper',
          ...hoverOnly({ color: 'text.primary', borderColor: 'text.secondary' }), ...FOCUS_RING,
        }}
      >← {back.label}</Box>

      <Typography component={headingTag} sx={{
        fontSize: TYPE_SCALE.page, fontWeight: 800, letterSpacing: typePx(-0.3), lineHeight: 1.2,
        mb: standfirst ? 0.5 : 3,
      }}>
        {title}
      </Typography>
      {standfirst && (
        <Typography sx={{ color: 'text.secondary', fontSize: TYPE_SCALE.body, lineHeight: 1.5, mb: 3 }}>
          {standfirst}
        </Typography>
      )}

      {children}
    </Box>
  )
}

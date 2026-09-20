import React from 'react'
import { Box, Typography } from '@mui/material'
import { navBack } from '../nav'
import { useWpblHeadingTag } from './PageHeading'
import { TYPE_SCALE, hoverOnly, FOCUS_RING } from './ui'

// The shell every STANDALONE WPBL page wears: the league, the season recap, scorigami, the
// players index, the glossary, the data sources. They are sibling routes to WpblApp, each drawn
// on its own, and before this each rolled its own header: some had a Back pill and some did not,
// some centred a 56.25rem column and some ran full-bleed, and the title ranged from a bold 1.5rem
// down to a 1.05rem barely above body text. That is five near-copies drifting apart, and it read
// as five different sites. This is the one header, so they cannot.
//
// It does NOT touch a page's content: everything below the standfirst is the page's own, cards or
// tables or a grid, unchanged. This unifies the frame, not the picture inside it.

const isModified = (e: React.MouseEvent) =>
  e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0

export default function WpblPage({ title, standfirst, maxWidth = '56.25rem', children }: {
  /** The page's own name, rendered as its <h1> (or a <div> while a modal owns the heading, via
   *  useWpblHeadingTag; harmless on these pages, which are never under a modal, and correct if one
   *  ever is). */
  title: React.ReactNode
  /** The one line under the title. Omit it on a page whose heading needs no gloss (Sources). */
  standfirst?: React.ReactNode
  /** Content column width. The default is the section's standard reading column; a tool with its
   *  own layout (Compare) can narrow it. */
  maxWidth?: number | string
  children: React.ReactNode
}) {
  const headingTag = useWpblHeadingTag()
  return (
    <Box sx={{ maxWidth, mx: 'auto', px: { xs: 2, sm: 3 }, pb: 6 }}>
      {/* Back to the section, not to a fixed /wpbl: `navBack` returns the reader to wherever they
          opened this from (a tab, a player), and only falls back to the section root when they
          arrived cold. A real <a href> so a crawler follows it and cmd-click opens a new tab. */}
      <Box
        component="a"
        href="/wpbl"
        onClick={e => { if (!isModified(e)) { e.preventDefault(); navBack('/wpbl') } }}
        sx={{
          textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 2,
          color: 'text.secondary', fontSize: TYPE_SCALE.body, fontWeight: 700,
          px: 1.25, py: 0.6, borderRadius: 999, border: '1px solid', borderColor: 'divider',
          bgcolor: 'background.paper',
          ...hoverOnly({ color: 'text.primary', borderColor: 'text.secondary' }), ...FOCUS_RING,
        }}
      >← Back to WPBL</Box>

      <Typography component={headingTag} sx={{
        fontSize: TYPE_SCALE.page, fontWeight: 800, letterSpacing: '-0.3px', lineHeight: 1.2,
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

/**
 * A heading WITHIN a page, above a section of it. One definition so "Final standings", "How the
 * league works" and the rest read the same everywhere; it snaps to TYPE_SCALE.heading, which is
 * what that token names. Was a local copy in SeasonPage set a step too large by hand.
 */
export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Typography component="h2" sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 800, mt: 4, mb: 1.5 }}>
      {children}
    </Typography>
  )
}

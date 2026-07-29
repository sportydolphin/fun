import React from 'react'
import { Box, Typography } from '@mui/material'
import { APP_VERSION } from './version'
import { ACCENT } from './mlb/constants'

const KOFI_URL = 'https://ko-fi.com/sportydolphin'

// Shared style for the footer's clickable text bits (buttons + links). Muted by
// default, brand accent on hover. Works in both themes via text.* tokens.
const linkSx = {
  cursor: 'pointer', userSelect: 'none' as const, whiteSpace: 'nowrap' as const,
  fontSize: '0.72rem', fontWeight: 600, color: 'text.secondary',
  textDecoration: 'none', transition: 'color 0.15s',
  '&:hover': { color: ACCENT },
}

// Slim site-wide footer. Home for the meta bits that used to crowd the toolbar:
// the version + "What's new" changelog, plus a feedback box and a Ko-fi support
// link. Caps + centers on wide screens, wraps and centers on mobile.
export function SiteFooter({ onOpenChangelog, onOpenFeedback }: {
  onOpenChangelog: () => void
  onOpenFeedback: () => void
}) {
  return (
    <Box
      component="footer"
      sx={{
        borderTop: '1px solid', borderColor: 'divider',
        mt: 4, px: 2, py: 2,
      }}
    >
      {/* Everything on one line — centered, dot-separated, wraps only if the
          screen is too narrow to fit it all. */}
      <Box sx={{
        maxWidth: 1100, mx: 'auto',
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
        columnGap: 1, rowGap: 0.5,
        fontSize: '0.72rem', color: 'text.disabled',
      }}>
        <Box component="span" sx={{ fontWeight: 700 }}>sportydolphin.fun</Box>
        <Dot />
        <Box component="span" onClick={onOpenChangelog} sx={linkSx}>v{APP_VERSION} · What's new</Box>
        <Dot />
        <Box component="span" onClick={onOpenFeedback} sx={linkSx}>Send feedback</Box>
        <Dot />
        <Box component="a" href={KOFI_URL} target="_blank" rel="noopener noreferrer" sx={linkSx}>Support on Ko-fi ♥</Box>
        <Dot />
        <Box component="span">Not affiliated with MLB. Data from the MLB Stats API.</Box>
      </Box>
    </Box>
  )
}

// Faint dot divider between footer items.
function Dot() {
  return <Box component="span" sx={{ color: 'text.disabled', opacity: 0.5, userSelect: 'none' }}>·</Box>
}

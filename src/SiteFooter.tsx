import React from 'react'
import { Box, Typography } from '@mui/material'
import { APP_VERSION } from './version'
import { ACCENT } from './mlb/constants'
import { track, EVENTS } from './lib/analytics'
import { WPBL_PLAYERS_INDEX, WPBL_LEAGUE_PAGE, WPBL_GLOSSARY_PAGE } from './wpbl/routes'

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
const WPBL_DISCORD_INVITE = 'https://discord.gg/hTaZKFzk6H'

export function SiteFooter({ onOpenChangelog, onOpenFeedback, onNavigate, isWpbl = false }: {
  onOpenChangelog: () => void
  onOpenFeedback: () => void
  onNavigate: (path: string) => void
  isWpbl?: boolean
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
        {/* The other section, with its name spelled out. The header's league switch is a
            toggle rather than a pair of links, so before this the only crawlable door to
            a section was whichever one you happened to land on: Google had indexed /wpbl
            and had never heard of /mlb. Keep the wording keyword-shaped rather than
            "Switch" — anchor text is most of what tells a search engine what a page is. */}
        <Box
          component="a"
          href={isWpbl ? '/mlb' : '/wpbl'}
          onClick={e => { e.preventDefault(); onNavigate(isWpbl ? '/mlb' : '/wpbl') }}
          sx={linkSx}
        >{isWpbl ? 'MLB stats' : 'WPBL stats'}</Box>
        <Dot />
        <Box component="a" href="/privacy" onClick={e => { e.preventDefault(); onNavigate('/privacy') }} sx={linkSx}>Privacy</Box>
        <Dot />
        <Box component="a" href="/terms" onClick={e => { e.preventDefault(); onNavigate('/terms') }} sx={linkSx}>Terms</Box>
        <Dot />
        {isWpbl && (
          <>
            {/* The fan Discord's only remaining door. It had a promo card on the WPBL home
                screen for weeks, which is long enough for anyone who wanted it to have taken
                it; what is left is the standing link, not the pitch. Still tracked as a join,
                so the one number worth keeping survives the card being retired. */}
            <Box
              component="a" href={WPBL_DISCORD_INVITE} target="_blank" rel="noopener noreferrer"
              onClick={() => track(EVENTS.DISCORD_JOINED, { from: 'footer' })}
              sx={linkSx}
            >Fan Discord</Box>
            <Dot />
            {/* The players index, and the reason it is HERE. It is the one page carrying a real
                <a href> to each of the 118 player pages, and until this line nothing on the
                site linked to it: the nav has no Players tab and the boards reach a player
                through a modal. So every player URL sat in the sitemap with no internal link
                pointing anywhere near it, which is the orphan-page shape Google discounts.
                The footer is the proven door for exactly this: it is how /privacy and /terms
                got found while /mlb did not. Keyword-shaped anchor text for the same reason
                as the section switch above. */}
            <Box component="a" href={WPBL_PLAYERS_INDEX} onClick={e => { e.preventDefault(); onNavigate(WPBL_PLAYERS_INDEX) }} sx={linkSx}>WPBL players</Box>
            <Dot />
            <Box component="a" href={WPBL_LEAGUE_PAGE} onClick={e => { e.preventDefault(); onNavigate(WPBL_LEAGUE_PAGE) }} sx={linkSx}>The league</Box>
            <Dot />
            <Box component="a" href={WPBL_GLOSSARY_PAGE} onClick={e => { e.preventDefault(); onNavigate(WPBL_GLOSSARY_PAGE) }} sx={linkSx}>Rules &amp; glossary</Box>
            <Dot />
            <Box component="a" href="/wpbl/api" onClick={e => { e.preventDefault(); onNavigate('/wpbl/api') }} sx={linkSx}>API for developers</Box>
            <Dot />
          </>
        )}
        <Box component="span">
          {isWpbl
            ? 'Not affiliated with the WPBL. Data from the official WPBL stats feed.'
            : 'Not affiliated with MLB. Data from the MLB Stats API.'}
        </Box>
      </Box>
    </Box>
  )
}

// Faint dot divider between footer items.
function Dot() {
  return <Box component="span" sx={{ color: 'text.disabled', opacity: 0.5, userSelect: 'none' }}>·</Box>
}

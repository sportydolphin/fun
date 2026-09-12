import React from 'react'
import { Box, Typography } from '@mui/material'
import { APP_VERSION } from './version'
import { ACCENT } from './mlb/constants'
import { track, EVENTS } from './lib/analytics'
import { WPBL_PLAYERS_INDEX, WPBL_LEAGUE_PAGE, WPBL_GLOSSARY_PAGE, WPBL_SOURCES_PAGE } from './wpbl/routes'

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
      {/* THREE ROWS, NOT ONE LIST, and the audit that produced them is worth keeping because the
          obvious fix was the wrong one. On a 375px phone this was fourteen items wrapping to five
          rows of undifferentiated dot-separated words, with "Privacy" sitting between "MLB stats"
          and "Terms". The instinct is to delete some.

          ALMOST NOTHING HERE CAN BE DELETED. Checked link by link: `/wpbl/glossary` and the
          players index have NO other internal link anywhere on the site, so cutting either
          orphans a real page, and the players index is the only page carrying an `<a href>` to
          each of the 118 player pages. The section switch exists because Google had indexed
          /wpbl and never heard of /mlb. Privacy and Terms in a footer are how those two got found
          at all. Every one of these is a fix for an indexing failure that actually happened.

          So the count was mostly not the problem and the flatness was: twelve links of four
          different kinds presented as one run of words. They are grouped now, by what a reader is
          looking for, pages first. The ONE link that could move did: the API docs are reached
          from the sources page, since where the data came from and how to take it are the same
          conversation, and that is what gets the first row onto one line on a phone. */}
      <Box sx={{
        maxWidth: 1100, mx: 'auto',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75,
        fontSize: '0.72rem', color: 'text.disabled',
      }}>
        {isWpbl && (
          <FooterRow>
            {/* The players index, and the reason it leads. It is the one page carrying a real
                <a href> to each of the 118 player pages, and until this line nothing on the
                site linked to it: the nav has no Players tab and the boards reach a player
                through a modal. So every player URL sat in the sitemap with no internal link
                pointing anywhere near it, which is the orphan-page shape Google discounts.
                Keyword-shaped anchor text for the same reason as the section switch below. */}
            <Box component="a" href={WPBL_PLAYERS_INDEX} onClick={e => { e.preventDefault(); onNavigate(WPBL_PLAYERS_INDEX) }} sx={linkSx}>WPBL players</Box>
            <Dot />
            <Box component="a" href={WPBL_LEAGUE_PAGE} onClick={e => { e.preventDefault(); onNavigate(WPBL_LEAGUE_PAGE) }} sx={linkSx}>The league</Box>
            <Dot />
            <Box component="a" href={WPBL_GLOSSARY_PAGE} onClick={e => { e.preventDefault(); onNavigate(WPBL_GLOSSARY_PAGE) }} sx={linkSx}>Rules &amp; glossary</Box>
            <Dot />
            {/* THE API DOCS USED TO SIT HERE AND NOW LIVE ON THE SOURCES PAGE, which is the one
                consolidation this footer had available: the two say where the data came from and
                how to take it, which is the same conversation, and four links fit a phone on one
                line where five did not. It means `/wpbl/api` is now reached through this page
                rather than directly, so this link is load-bearing for both of them. */}
            <Box component="a" href={WPBL_SOURCES_PAGE} onClick={e => { e.preventDefault(); onNavigate(WPBL_SOURCES_PAGE) }} sx={linkSx}>Data sources</Box>
          </FooterRow>
        )}

        <FooterRow>
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
          {isWpbl && (
            <>
              <Dot />
              {/* The fan Discord's only remaining door. It had a promo card on the WPBL home
                  screen for weeks, which is long enough for anyone who wanted it to have taken
                  it; what is left is the standing link, not the pitch. Still tracked as a join,
                  so the one number worth keeping survives the card being retired. */}
              <Box
                component="a" href={WPBL_DISCORD_INVITE} target="_blank" rel="noopener noreferrer"
                onClick={() => track(EVENTS.DISCORD_JOINED, { from: 'footer' })}
                sx={linkSx}
              >Fan Discord</Box>
            </>
          )}
          <Dot />
          <Box component="span" onClick={onOpenFeedback} sx={linkSx}>Feedback</Box>
          <Dot />
          {/* "SUPPORT" STAYS, and trimming it to "Ko-fi ♥" to save a line was the wrong trade. A
              heading is a label and an action link is not: here the verb IS the information, and
              Ko-fi is a name creators know and a general sports reader does not, so the short
              version asks somebody to guess before following an external link. The line came back
              off "Send feedback" instead, where the noun alone says the whole thing. */}
          <Box component="a" href={KOFI_URL} target="_blank" rel="noopener noreferrer" sx={linkSx}>Support on Ko-fi &hearts;</Box>
        </FooterRow>

        {/* The fine print, last, where a reader stops looking. The disclaimer belongs at the end
            of it rather than on a line of its own: it is the sentence that closes the footer. */}
        <FooterRow>
          <Box component="span" sx={{ fontWeight: 700 }}>sportydolphin.fun</Box>
          <Dot />
          <Box component="span" onClick={onOpenChangelog} sx={linkSx}>v{APP_VERSION} &middot; What's new</Box>
          <Dot />
          <Box component="a" href="/privacy" onClick={e => { e.preventDefault(); onNavigate('/privacy') }} sx={linkSx}>Privacy</Box>
          <Dot />
          <Box component="a" href="/terms" onClick={e => { e.preventDefault(); onNavigate('/terms') }} sx={linkSx}>Terms</Box>
          <Dot />
          {/* THE DATA CREDIT CAME OFF THIS LINE, and only because it now has somewhere better
              to be: "Data from the official WPBL stats feed" was the whole of the site's
              provenance until /wpbl/sources existed, and a sentence in the smallest type on the
              page was never the right home for it. What has to stay is the disclaimer, which is
              a different claim and is the one a reader needs. Two lines back on a phone. */}
          <Box component="span">
            {isWpbl ? 'Not affiliated with the WPBL.' : 'Not affiliated with MLB.'}
          </Box>
        </FooterRow>
      </Box>
    </Box>
  )
}

/** One row of the footer: centred, dot-separated, wrapping only when it has to. */
function FooterRow({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
      columnGap: 1, rowGap: 0.5,
    }}>{children}</Box>
  )
}

// Faint dot divider between footer items.
function Dot() {
  return <Box component="span" sx={{ color: 'text.disabled', opacity: 0.5, userSelect: 'none' }}>·</Box>
}

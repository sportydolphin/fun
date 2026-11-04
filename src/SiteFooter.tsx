import React from 'react'
import { pressable } from './ui/interaction'
import { Box } from '@mui/material'
import { APP_VERSION } from './version'
import { track, EVENTS } from './lib/analytics'
import { WPBL_FOOTER_PAGES } from './wpbl/morePages'
import { MLB_MORE_PAGES } from './mlb/routes'
import { TYPE_SCALE, DISPLAY_FONT, AGATE_SX, SECTION_RULE } from './ui/card'
import { groupMoreRows } from './ui/MoreMenu'

const KOFI_URL = 'https://ko-fi.com/sportydolphin'
const BLUESKY_URL = 'https://bsky.app/profile/sportydolphin.fun'

// Shared style for the footer's clickable text bits (buttons + links): the agate face, like the
// index at the foot of a sports page. Secondary ink, the full ink and an underline on hover.
const linkSx = {
  cursor: 'pointer', userSelect: 'none' as const, whiteSpace: 'nowrap' as const,
  ...AGATE_SX, fontSize: TYPE_SCALE.body, color: 'text.secondary',
  textDecoration: 'none', transition: 'color 0.15s',
  '&:hover': { color: 'text.primary', textDecoration: 'underline' },
}

// Site-wide footer: the page links a crawler must reach, plus the meta bits that used to crowd
// the toolbar (the changelog, feedback, Ko-fi).
const WPBL_DISCORD_INVITE = 'https://discord.gg/hTaZKFzk6H'

export function SiteFooter({ onOpenChangelog, onOpenFeedback, onNavigate, isWpbl = false, isMlb = false }: {
  onOpenChangelog: () => void
  onOpenFeedback: () => void
  onNavigate: (path: string) => void
  isWpbl?: boolean
  /** Off both sections (/privacy, /admin) neither league's pages are listed. */
  isMlb?: boolean
}) {
  // MLB's standalone pages are listed here since Oct 9, 2026, for the same reason as WPBL's: the
  // toolbar's More menu is not in the DOM until it opens, so this is the crawlable link.
  const pages: { href: string; label: string; group: string }[] = isWpbl
    ? WPBL_FOOTER_PAGES.map(pg => ({ href: pg.href, label: pg.footerLabel ?? pg.label, group: pg.group }))
    : isMlb ? MLB_MORE_PAGES.map(pg => ({ href: pg.href, label: pg.label, group: 'Pages' })) : []
  // WPBL's eleven pages split by the More menu's own groups, so a column here is a heading a reader
  // has already met in the menu. MLB's four stay one column: split by group they would be four
  // columns of one link each.
  const groups = groupMoreRows(pages).map(g => ({ title: g.group, pages: g.rows }))
  const pageLink = (href: string, label: string) => (
    <Box component="a" href={href} onClick={e => { e.preventDefault(); onNavigate(href) }} sx={linkSx}>{label}</Box>
  )
  return (
    <Box
      component="footer"
      sx={{
        mt: 4, px: 2, pt: 1.5, pb: 2.5,
        // Out of the way of either stats board's full table on a phone, which needs the height to
        // stay pinned; the attributes' owners (each section's StatsView) explain why that is safe
        // for crawling.
        '@media (max-width:600px)': {
          'html[data-wpbl-stats-table] &, html[data-mlb-stats-table] &': { display: 'none' },
        },
      }}
    >
      {/* THE FOOT OF A SPORTS PAGE, NOT A SITE MAP (Nov 4, 2026, ROADMAP-UI.md's audit). It was six
          labeled columns of links, the most generic block on the site. Now the site's name under the
          section rule, and an index: one line per group, the group in capitals and its links in the
          agate face, the way a paper prints its index of sections.

          NOTHING HERE CAN BE DELETED, and the audit that showed it is worth keeping. The glossary
          and the players index have no other internal link anywhere on the site, and the players
          index is the only page with an `<a href>` to each player page. The section switch exists
          because Google had indexed /wpbl and never heard of /mlb. Privacy and Terms were found
          only through this footer. Every link is a fix for an indexing failure that happened, so
          each stays a real anchor: an onClick-only control is invisible to a crawler. */}
      <Box sx={{ maxWidth: 1100, mx: 'auto' }}>
        <Box sx={{
          ...SECTION_RULE, pt: 1, mb: 1.5,
          display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: 2, rowGap: 0.5,
        }}>
          <Box component="span" sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: TYPE_SCALE.page, textTransform: 'uppercase', letterSpacing: '0.02em', lineHeight: 1.1 }}>
            sportydolphin.fun
          </Box>
          {/* The fine print beside the name rather than under the links, where a reader stops
              looking. The data credit lives on the sources page; the disclaimer is a different
              claim and stays. */}
          <Box component="span" sx={{ ...AGATE_SX, fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
            v{APP_VERSION} · {isWpbl ? 'Not affiliated with the WPBL.' : 'Not affiliated with MLB.'}
          </Box>
        </Box>

        <Box component="nav" aria-label="Site" sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 1.25, sm: 0.75 } }}>
          {groups.map(g => (
            <FooterLine key={g.title} title={g.title}>
              {g.pages.map(pg => <React.Fragment key={pg.href}>{pageLink(pg.href, pg.label)}</React.Fragment>)}
            </FooterLine>
          ))}
          <FooterLine title="Connect">
            {isWpbl && (
              // The fan Discord's only remaining door, after its promo card on the WPBL home screen
              // was retired. Still tracked as a join, so that number survives the card.
              <Box
                component="a" href={WPBL_DISCORD_INVITE} target="_blank" rel="noopener noreferrer"
                onClick={() => track(EVENTS.DISCORD_JOINED, { from: 'footer' })}
                sx={linkSx}
              >Fan Discord</Box>
            )}
            <Box component="a" href={BLUESKY_URL} target="_blank" rel="noopener noreferrer" sx={linkSx}>Bluesky</Box>
            <Box component="span" {...pressable(onOpenFeedback)} sx={linkSx}>Feedback</Box>
            {/* "Support" stays in front of Ko-fi: the verb is the information, and Ko-fi is a name
                a general sports reader may not know before following an external link. */}
            <Box component="a" href={KOFI_URL} target="_blank" rel="noopener noreferrer" sx={linkSx}>Support on Ko-fi &hearts;</Box>
          </FooterLine>
          <FooterLine title="Site">
            {/* The other section, with its name spelled out. The header's league switch is a
                toggle rather than a pair of links, so before this the only crawlable door to
                a section was whichever one you happened to land on. Keep the wording
                keyword-shaped: anchor text is most of what tells a search engine what a page is. */}
            {pageLink(isWpbl ? '/mlb' : '/wpbl', isWpbl ? 'MLB stats' : 'WPBL stats')}
            <Box component="span" {...pressable(onOpenChangelog)} sx={linkSx}>What's new</Box>
            {pageLink('/privacy', 'Privacy')}
            {pageLink('/terms', 'Terms')}
          </FooterLine>
        </Box>
      </Box>
    </Box>
  )
}

/** One line of the index: the group in capitals in a fixed column, its links after it, wrapping
 *  under themselves. On a phone the group sits over its links, since a fixed column would leave
 *  the links half the screen. */
function FooterLine({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '7rem minmax(0, 1fr)' }, columnGap: 2, rowGap: 0.25, alignItems: 'baseline' }}>
      <Box sx={{ ...AGATE_SX, fontSize: TYPE_SCALE.meta, color: 'text.primary', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 0.5, minWidth: 0 }}>{children}</Box>
    </Box>
  )
}

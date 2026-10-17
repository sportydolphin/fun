import React from 'react'
import { pressable } from './ui/interaction'
import { Box } from '@mui/material'
import { APP_VERSION } from './version'
import { ACCENT } from './mlb/constants'
import { track, EVENTS } from './lib/analytics'
import { WPBL_FOOTER_PAGES } from './wpbl/morePages'
import { MLB_MORE_PAGES } from './mlb/routes'
import { TYPE_SCALE } from './ui/card'

const KOFI_URL = 'https://ko-fi.com/sportydolphin'
const BLUESKY_URL = 'https://bsky.app/profile/sportydolphin.fun'

// Shared style for the footer's clickable text bits (buttons + links). Muted by
// default, brand accent on hover. Works in both themes via text.* tokens.
const linkSx = {
  cursor: 'pointer', userSelect: 'none' as const, whiteSpace: 'nowrap' as const,
  fontSize: TYPE_SCALE.meta, fontWeight: 600, color: 'text.secondary',
  textDecoration: 'none', transition: 'color 0.15s',
  '&:hover': { color: ACCENT },
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
  const groups: { title: string; pages: typeof pages }[] = []
  for (const pg of pages) {
    const last = groups[groups.length - 1]
    if (last?.title === pg.group) last.pages.push(pg)
    else groups.push({ title: pg.group, pages: [pg] })
  }
  const pageLink = (href: string, label: string) => (
    <Box component="a" href={href} onClick={e => { e.preventDefault(); onNavigate(href) }} sx={linkSx}>{label}</Box>
  )
  const columns = groups.length + 2
  return (
    <Box
      component="footer"
      sx={{
        borderTop: '1px solid', borderColor: 'divider',
        mt: 4, px: 2, py: 2.5,
        // Out of the way of either stats board's full table on a phone, which needs the height to
        // stay pinned; the attributes' owners (each section's StatsView) explain why that is safe
        // for crawling.
        '@media (max-width:600px)': {
          'html[data-wpbl-stats-table] &, html[data-mlb-stats-table] &': { display: 'none' },
        },
      }}
    >
      {/* COLUMNS UNDER HEADINGS, NOT CENTRED ROWS OF DOTTED WORDS. Three centred rows wrapped
          differently at every width, so the same link sat in a new place on each page size and
          nothing lined up with anything. A column per kind of link gives every item a fixed
          place, and it let the page links come out of the `More pages` expander they were folded
          into: a labelled column is as quiet as a closed disclosure and costs a reader no tap.

          NOTHING HERE CAN BE DELETED, and the audit that showed it is worth keeping. The glossary
          and the players index have no other internal link anywhere on the site, and the players
          index is the only page with an `<a href>` to each player page. The section switch exists
          because Google had indexed /wpbl and never heard of /mlb. Privacy and Terms were found
          only through this footer. Every link is a fix for an indexing failure that happened, so
          each stays a real anchor: an onClick-only control is invisible to a crawler. */}
      <Box sx={{
        maxWidth: 1100, mx: 'auto',
        display: 'grid', columnGap: 3, rowGap: 2.5,
        // Two across on a phone: the longest anchor ("WPBL batter vs pitcher") needs half of a
        // 375px screen and no less, and the links do not wrap.
        gridTemplateColumns: {
          xs: 'repeat(2, minmax(0, 1fr))',
          sm: 'repeat(3, minmax(0, 1fr))',
          md: `repeat(${columns}, minmax(0, 1fr))`,
        },
      }}>
        {groups.map(g => (
          <FooterColumn key={g.title} title={g.title}>
            {g.pages.map(pg => <React.Fragment key={pg.href}>{pageLink(pg.href, pg.label)}</React.Fragment>)}
          </FooterColumn>
        ))}

        <FooterColumn title="Connect">
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
        </FooterColumn>

        {/* The section switch sits here rather than under Connect, which Bluesky filled to five:
            four links a column keeps the columns level on WPBL, and the switch is about the site. */}
        <FooterColumn title="Site">
          {/* The other section, with its name spelled out. The header's league switch is a
              toggle rather than a pair of links, so before this the only crawlable door to
              a section was whichever one you happened to land on. Keep the wording
              keyword-shaped: anchor text is most of what tells a search engine what a page is. */}
          {pageLink(isWpbl ? '/mlb' : '/wpbl', isWpbl ? 'MLB stats' : 'WPBL stats')}
          <Box component="span" {...pressable(onOpenChangelog)} sx={linkSx}>What's new</Box>
          {pageLink('/privacy', 'Privacy')}
          {pageLink('/terms', 'Terms')}
        </FooterColumn>
      </Box>

      {/* The fine print, last and centred under the columns, where a reader stops looking. The
          data credit lives on the sources page; the disclaimer is a different claim and stays. */}
      <Box sx={{
        maxWidth: 1100, mx: 'auto', mt: 2.5, pt: 2,
        borderTop: '1px solid', borderColor: 'divider',
        fontSize: TYPE_SCALE.meta, color: 'text.secondary',
      }}>
        <FooterRow>
          <Box component="span" sx={{ fontWeight: 700 }}>sportydolphin.fun</Box>
          <Dot />
          <Box component="span">v{APP_VERSION}</Box>
          <Dot />
          <Box component="span">
            {isWpbl ? 'Not affiliated with the WPBL.' : 'Not affiliated with MLB.'}
          </Box>
        </FooterRow>
      </Box>
    </Box>
  )
}

/** One labelled column of footer links, stacked and left-aligned so every column starts on the
 *  same line whatever its length. */
function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.75, minWidth: 0 }}>
      <Box sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.primary', mb: 0.25 }}>{title}</Box>
      {children}
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

import {
  WPBL_SEASON_PAGE, WPBL_READING_PAGE, WPBL_WATCH_PAGE, WPBL_PHOTOS_PAGE, WPBL_LEAGUE_PAGE, WPBL_SCORIGAMI_PAGE, WPBL_MATCHUPS_PAGE,
  WPBL_COMPARE_BASE, WPBL_PLAYERS_INDEX, WPBL_GLOSSARY_PAGE, WPBL_SOURCES_PAGE,
} from './routes'
import { EVENTS } from '../lib/analytics'

// THE ONE LIST OF THE WPBL PAGES THAT ARE NOT TABS, read by the section's More menu, its phone
// sheet and the site footer. The footer used to carry its own hand-kept copy, which is the shape
// that drifts: a page added to the menu and not the footer loses its only crawlable link (the menu
// is a MUI Menu, absent from the DOM until opened), and one added to the footer alone is invisible
// to a reader on a phone.
//
// GROUPED, AND THE GROUPS ORDERED BY WHAT A READER COMES FOR in the offseason. It was grouped once
// before (Explore, Tools, Reference), dropped because Tools held one page and "Data sources" got the
// same billing as the season recap; by Oct 2026 Tools held three and the flat list was ten rows a
// reader had to read top to bottom. The recap leads because once the feed stops it is the question
// most readers arrive with. Data sources stays out of the menu, in the footer's list below.
//
// `hint` is the line under each name, in the desktop panel and the phone sheet alike. `group` is the
// heading a row sits under; rows of one group are adjacent, in the order drawn.
// `footerLabel` is the anchor text in the footer where it differs, keyword-shaped because anchor
// text is most of what tells a search engine what a page is.

export interface MorePage {
  href: string
  label: string
  hint: string
  group: string
  footerLabel?: string
  event?: (typeof EVENTS)[keyof typeof EVENTS]
  eventProps?: Record<string, unknown>
}

export const WPBL_MORE_PAGES: MorePage[] = [
  { group: 'Season',    href: WPBL_SEASON_PAGE,    label: '2026 season recap', hint: 'The season and the postseason, read back', footerLabel: '2026 season' },
  { group: 'Season',    href: WPBL_WATCH_PAGE,     label: 'Watch',             hint: 'Highlights, condensed games and clips', footerLabel: 'WPBL video' },
  { group: 'Season',    href: WPBL_PHOTOS_PAGE,    label: 'Photos',            hint: "Fans' photos from 2026, and women's baseball history", footerLabel: 'WPBL photos' },
  { group: 'Season',    href: WPBL_READING_PAGE,   label: 'Reading',           hint: 'Two writers on the league: mary mustard and D.A. Espinoza', footerLabel: 'WPBL reading' },
  // The picker with nobody chosen. `from: 'more'` joins the same funnel the Home card and the
  // player-modal chip report into (WPBL_COMPARE_OPENED).
  { group: 'Tools',     href: WPBL_COMPARE_BASE,   label: 'Compare players',   hint: 'Any two players, side by side',
    event: EVENTS.WPBL_COMPARE_OPENED, eventProps: { from: 'more', pair: false } },
  { group: 'Tools',     href: WPBL_MATCHUPS_PAGE,  label: 'Batter vs pitcher', hint: "Every batter's record against every pitcher", footerLabel: 'WPBL batter vs pitcher' },
  { group: 'Tools',     href: WPBL_SCORIGAMI_PAGE, label: 'Scorigami',         hint: 'Every final score the league has produced' },
  // The players index is the one page carrying a real <a href> to each player page, so it must
  // stay in the footer even though a reader mostly reaches players through a club.
  { group: 'Reference', href: WPBL_PLAYERS_INDEX,  label: 'All players',       hint: 'Every roster, by club', footerLabel: 'WPBL players' },
  { group: 'Reference', href: WPBL_LEAGUE_PAGE,    label: 'About the league',  hint: 'How it works, the four clubs, and where the players are from' },
  { group: 'Reference', href: WPBL_GLOSSARY_PAGE,  label: 'Rules & glossary',  hint: 'The rules, and what each stat means' },
]

/** The footer's list: the menu's pages plus Data sources, which a reader rarely wants and a
 *  crawler must still reach (the API docs hang off it). Not in the menu for that reason. */
export const WPBL_FOOTER_PAGES: MorePage[] = [
  ...WPBL_MORE_PAGES,
  { group: 'Reference', href: WPBL_SOURCES_PAGE, label: 'Data sources', hint: 'Where this site’s data comes from' },
]

import {
  WPBL_SEASON_PAGE, WPBL_READING_PAGE, WPBL_PHOTOS_PAGE, WPBL_LEAGUE_PAGE, WPBL_SCORIGAMI_PAGE,
  WPBL_COMPARE_BASE, WPBL_PLAYERS_INDEX, WPBL_GLOSSARY_PAGE, WPBL_SOURCES_PAGE,
} from './routes'
import { EVENTS } from '../lib/analytics'

// THE ONE LIST OF THE WPBL PAGES THAT ARE NOT TABS, read by the section's More menu, its phone
// sheet and the site footer. The footer used to carry its own hand-kept copy, which is the shape
// that drifts: a page added to the menu and not the footer loses its only crawlable link (the menu
// is a MUI Menu, absent from the DOM until opened), and one added to the footer alone is invisible
// to a reader on a phone.
//
// ORDERED BY WHAT A READER COMES FOR in the offseason, not by what kind of page it is. It used to
// be grouped (Explore, Tools, Reference), which put one item under Tools and gave "Data sources"
// the same billing as the season recap. The recap leads because once the feed stops it is the
// question most readers arrive with.
//
// `hint` is drawn only in the phone sheet, which has room for a line under each name.
// `footerLabel` is the anchor text in the footer where it differs, keyword-shaped because anchor
// text is most of what tells a search engine what a page is.

export interface MorePage {
  href: string
  label: string
  hint: string
  footerLabel?: string
  event?: (typeof EVENTS)[keyof typeof EVENTS]
  eventProps?: Record<string, unknown>
}

export const WPBL_MORE_PAGES: MorePage[] = [
  { href: WPBL_SEASON_PAGE,    label: '2026 season recap', hint: 'The season and the postseason, read back', footerLabel: '2026 season' },
  { href: WPBL_READING_PAGE,   label: 'Reading',           hint: 'Every post mary mustard has written about the league', footerLabel: 'WPBL reading' },
  { href: WPBL_PHOTOS_PAGE,    label: 'Photos',            hint: "Fans' photos from 2026, and women's baseball history", footerLabel: 'WPBL photos' },
  { href: WPBL_LEAGUE_PAGE,    label: 'About the league',  hint: 'How it works, the four clubs, and where the players are from' },
  { href: WPBL_SCORIGAMI_PAGE, label: 'Scorigami',         hint: 'Every final score the league has produced' },
  // The picker with nobody chosen. `from: 'more'` joins the same funnel the Home card and the
  // player-modal chip report into (WPBL_COMPARE_OPENED).
  { href: WPBL_COMPARE_BASE,   label: 'Compare players',   hint: 'Any two players, side by side',
    event: EVENTS.WPBL_COMPARE_OPENED, eventProps: { from: 'more', pair: false } },
  // The players index is the one page carrying a real <a href> to each player page, so it must
  // stay in the footer even though a reader mostly reaches players through a club.
  { href: WPBL_PLAYERS_INDEX,  label: 'All players',       hint: 'Every roster, by club', footerLabel: 'WPBL players' },
  { href: WPBL_GLOSSARY_PAGE,  label: 'Rules & glossary',  hint: 'The rules, and what each stat means' },
]

/** The footer's list: the menu's pages plus Data sources, which a reader rarely wants and a
 *  crawler must still reach (the API docs hang off it). Not in the menu for that reason. */
export const WPBL_FOOTER_PAGES: MorePage[] = [
  ...WPBL_MORE_PAGES,
  { href: WPBL_SOURCES_PAGE, label: 'Data sources', hint: 'Where this site’s data comes from' },
]

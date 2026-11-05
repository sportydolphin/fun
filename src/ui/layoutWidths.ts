import { chromePx } from './scale'

// The Home page's column, shared by both sections so a section switch on the toolbar lands on a
// page with the same edges. Until Oct 2026 MLB's Home was 1372px (980 drawn under the old
// `zoom: 1.4`) and WPBL's 1260, so the cards jumped 56px each side on every switch, and on a tablet
// the two phone columns were 640 and 720.
//
// Raw px with a viewport cap, like the rest of WPBL's breakout widths (src/wpbl/layoutWidths.ts):
// a cap on a wide layout rather than structure inside it, so not chromePx. The column is centered on
// its parent (a transform on WPBL, a margin on MLB) rather than capped by the shell's padding.

/** The page's margin each side above a phone, counted in `100vw` (which includes a classic
 *  scrollbar, so the margin drawn is a few px less on Windows).
 *
 *  32, NOT 12 (Nov 5, 2026, the redesign's page frame). The column used to take everything but 24px
 *  of slack, so from 900 to 1284 Home's text and its rules ran to within about 5px of the window,
 *  tighter than a phone's 16px gutter; a printed page's margin is what makes its columns read as
 *  columns. */
export const DESKTOP_GUTTER = 32

/** THE PAGE FRAME: Home, the Scores grid, Game Center and both Stats tabs share it, so every page's
 *  title and first rule start on one left edge.
 *
 *  THE WIDE GUTTER ONLY PAST THE PHONE COLUMN. The Stats bleed is this width on a phone too, where it
 *  must stay `100vw - 24px` (wider than the 343px column at 375; see stats/Boards.tsx). The inner
 *  `min` holds that until the frame reaches PHONE_COLUMN_W, the `max` takes the desktop gutter once
 *  it is wider, and between the two the frame rests at 720px, so it never jumps at a breakpoint. */
export const PAGE_FRAME_W = `min(1260px, max(calc(100vw - ${DESKTOP_GUTTER * 2}px), min(calc(100vw - 24px), 720px)))`

/** Home's column above a phone: the scoreboard, the cards and everything between. */
export const HOME_W = PAGE_FRAME_W

/** The column below `md`, for both sections: WPBL's whole section is built on 720. */
export const PHONE_COLUMN_W = 720

/** Both Stats tabs above a phone: the page frame (Nov 5, 2026). They were wider than it, up to
 *  1540px, "so every column of the Players table is in view", which put the WPBL Stats title 5px from
 *  the window at 1440 and 78px left of every other page's. The table fits its 24 columns without a
 *  scroll down to 1000px (measured at 1440, Nov 5), so the frame costs it nothing. MLB's three boards
 *  share it, as they have since Oct 9, 2026, so a switch between the two tabs moves nothing. */
export const STATS_W = PAGE_FRAME_W

/**
 * The page column the Stats boards that are prose and lists sit in, and the wider measure the
 * ones that can use a second column take on a large desktop.
 *
 * NARROW IS NOT A DEFAULT TO BE ESCAPED, it is the right answer for one column of anything: a
 * list stretched across 1,400px puts a name at one edge and its number at the other and stops
 * being a row. What a wide screen buys is a SECOND column, not a longer one, so the wide value
 * is two list measures and the gap between them rather than one long one.
 *
 * An over-generous cap is harmless: `max-width` cannot make an element wider than the box it
 * is in, so on a viewport smaller than the cap this simply means "all of it".
 */
export const BOARD_COLUMN = chromePx(720)
export const BOARD_COLUMN_WIDE = chromePx(1150)

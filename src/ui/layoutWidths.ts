import { chromePx } from './scale'

// The Home page's column, shared by both sections so a section switch on the toolbar lands on a
// page with the same edges. Until Oct 2026 MLB's Home was 1372px (980 drawn under the old
// `zoom: 1.4`) and WPBL's 1260, so the cards jumped 56px each side on every switch, and on a tablet
// the two phone columns were 640 and 720.
//
// Raw px with a viewport cap, like the rest of WPBL's breakout widths (src/wpbl/layoutWidths.ts):
// a cap on a wide layout rather than structure inside it. A Home this wide breaks out of the shell's
// padding, so the column is centered on its parent (a transform on WPBL, a margin on MLB) rather than
// capped.
//
// THE GUTTER IS THE TOOLBAR'S. Under the cap the column is the viewport less the scrollbar
// (`--sd-scrollbar-w`, lib/scrollbarWidth.ts: `100vw` counts a classic one) and less the toolbar's
// own side padding on each side, MUI's `spacing(3)` in chrome px, so the page's left edge and the
// logo's are one line. It was a flat 24px, which put the Stats heading about 20px left of the logo,
// and 4.5px from the window's edge on Windows (Nov 7, 2026 audit).
const VIEWPORT_COLUMN = `calc(100vw - var(--sd-scrollbar-w, 0px) - 2 * ${chromePx(24)})`

/** Home's column above a phone: the scoreboard, the cards and everything between. */
export const HOME_W = `min(1260px, ${VIEWPORT_COLUMN})`

/** The column below `md`, for both sections: WPBL's whole section is built on 720. */
export const PHONE_COLUMN_W = 720

/** Both Stats tabs above a phone: wider than the page column. MLB's three boards since Oct 9, 2026,
 *  when the two tabs were 1416 and 1385 wide at 1440 and the title, tabs and cards moved 15px on a
 *  switch. Home's width since Nov 2026 (1540 before): the tables size to their columns now
 *  (SeasonTable), so the extra width was a stretched name column, and the page width jumped between
 *  Home and Stats. */
export const STATS_W = HOME_W

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

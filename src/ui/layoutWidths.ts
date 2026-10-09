// The Home page's column, shared by both sections so a section switch on the toolbar lands on a
// page with the same edges. Until Oct 2026 MLB's Home was 1372px (980 drawn under the old
// `zoom: 1.4`) and WPBL's 1260, so the cards jumped 56px each side on every switch, and on a tablet
// the two phone columns were 640 and 720.
//
// Raw px with a viewport cap, like the rest of WPBL's breakout widths (src/wpbl/layoutWidths.ts):
// a cap on a wide layout rather than structure inside it, so not chromePx. The 24px of slack stops
// `100vw` (which counts a classic scrollbar) from giving the site a horizontal scrollbar, and it is
// LESS than the shell's own padding on purpose: a Home this wide breaks out of that padding, so
// the column is centred on its parent (a transform on WPBL, a margin on MLB) rather than capped.

/** Home's column above a phone: the scoreboard, the cards and everything between. */
export const HOME_W = 'min(1260px, calc(100vw - 24px))'

/** The column below `md`, for both sections: WPBL's whole section is built on 720. */
export const PHONE_COLUMN_W = 720

// The widths of the WPBL surfaces that break out of the 720px page column, in one place.
//
// Each was its own constant in its own file until the desktop side panel had to know them too:
// WpblApp moves the page aside for the panel only as far as the widest thing on screen leaves room
// for, and a copy of these numbers that drifted from the real ones would slide Home or the stats
// table off the left edge of the window. Raw px with a viewport cap, on purpose: these are caps on
// a wide layout rather than structure inside it (see chromePx).

import { chromePx } from '../ui/scale'

/** Home's breakout row (the scoreboard, the grid of cards and the league strip above them). */
export const HOME_WIDE_W = 'min(1260px, calc(100vw - 24px))'
/** The stats table, which takes the width so every column is visible. */
export const STATS_FULL_BLEED_W = 'min(1540px, calc(100vw - 24px))'
/** The full-page Game Center. Home's width, so the two pages a game link lands between line up. */
export const GAME_PAGE_W = 'min(1260px, calc(100vw - 24px))'
/**
 * A player's full page: the width the desktop player dialog was measured at (the batting season
 * line is the widest block, about 666px of it), so the layout built for that dialog lands at the
 * size it was drawn for. Through `chromePx`, unlike the caps above, because this is that layout's
 * own structure rather than a cap on a wide one.
 */
export const PLAYER_PAGE_W = `min(${chromePx(880)}, calc(100vw - 24px))`

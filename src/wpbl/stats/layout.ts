import { STATS_FULL_BLEED_W } from '../layoutWidths'

// Break the table out of the 720px page column so every stat column is visible. The page
// is horizontally centered, so centering a viewport-wide box on it reads as full-bleed.
// Capped so it doesn't sprawl on huge monitors.
const FULL_BLEED_W = STATS_FULL_BLEED_W

// The chrome pinned above this view: the toolbar, which above a phone carries the section's tabs
// too (ToolbarNav), so its height is the whole of it. 0 on a phone, where the toolbar scrolls away
// and the section nav is the fixed bottom bar, pinning nothing at the top; what that takes at the
// BOTTOM is `BOTTOM_NAV_SPACE`, which the board's cap subtracts on its own. There was a second term
// for the WPBL pill row until v1.124.0 moved the tabs into the toolbar.
export const PINNED_CHROME = 'var(--app-header-h, 0px)'
export const fullBleedSx = {
  width: FULL_BLEED_W,
  position: 'relative',
  left: '50%',
  transform: 'translateX(-50%)',
} as const

// The sticky control bar, which is wider than everything else on purpose. Centered with a
// margin rather than left + transform: the bar is the one full-bleed block here that also has
// to stick, and those two can't share a box, since sticky spends `left` on its own threshold
// and a transformed ancestor becomes the containing block for anything positioned inside it.
//
// EDGE TO EDGE ON A PHONE, WITH THE GUTTER AS PADDING. At the cards' width the bar would stop
// 12px short of each side of the screen, so its background and the hairline under it would end
// in mid-air while the nav bar directly above runs the whole way across. Content still lines up
// with the cards below, because the 12px the bar gives back as padding is exactly the gutter the
// cards keep as margin.
//
// PHONE ONLY, and `100vw` is the reason. It measures the viewport INCLUDING a classic
// scrollbar, so on a desktop with one it is a dozen pixels wider than the page can hold and
// the whole site gains a horizontal scrollbar. Touch scrollbars are overlaid and take no
// width, so the phone is exactly where the unit is safe. It is also the only place the fix is
// wanted: the nav above goes full-bleed on xs alone (`mx: { xs: -2, sm: 0 }`), so above sm
// there is no mismatch to correct.
const FULL_BLEED_GUTTER = 12
const BAR_W = `min(${1540 + 2 * FULL_BLEED_GUTTER}px, calc(100vw))`
/** Where the board pins: the bottom of the control bar, which is itself pinned under the
 *  shell's chrome. `--wpbl-stats-bar-h` is published by the bar (see the effect that sets it).
 *
 *  IT IS ONLY EVER A STICKY OFFSET, never a height, and that is what makes measuring it safe.
 *  A cap derived from a measurement can render a board that is not there; an offset derived
 *  from one can at worst pin a few pixels high or low. */
export const BOARD_TOP = `calc(${PINNED_CHROME} + var(--wpbl-stats-bar-h, 0px))`

/** What is left under the board once everything that can change size is measured: the card's
 *  own two borders and the page's bottom gutter, plus two pixels of slack so a rounding error
 *  cannot tip the board past the point where it stays pinned.
 *
 *  TWO VALUES, because the site footer steps aside for the phone's player table (see the effect
 *  that sets `data-wpbl-stats-table`), and the 32 between them is the footer's top margin, which
 *  goes with it. Read off the same flag that hides the footer, so the two cannot be out of step.
 *  `--wpbl-foot-h` measures whatever footer is laid out, and reads 0 while it is hidden.
 *
 *  THE BOARD'S OWN FOOTER IS NOT IN HERE ANY MORE. It was, as a constant, until v1.98.0 gave the
 *  phone's full table a second row (the Standard/Advanced switch) and the constant came up 25px
 *  short. Its height depends on the text size and on whether the count wraps, not on the board,
 *  so it is measured and published as `--wpbl-board-foot-h` beside the site footer's.
 *
 *  STILL A CONSTANT FOR THE REST, BECAUSE IT IS FURNITURE. Deriving it from the document's
 *  height would mean reading the swipe pager's floor and any blank the board is itself leaving,
 *  so the board's height would feed back into its own cap and iterate away to nothing. */
export const BOARD_TAIL_PX = 52
export const BOARD_TAIL_BARE_PX = 20

/** The header (27px) and five rows (43px each): the least that is still a table.
 *
 *  THE FLOOR BEATS THE FIT, so where it binds the headers can slide behind the bar at the bottom
 *  of the page again. It was 320 until the bottom nav was counted, which left a 667px phone (an
 *  iPhone SE) needing 271 and getting 320, headers gone. At 240 the fit wins on any phone from
 *  about 636px tall. */
export const MIN_BOARD_PX = 240

/** Full-bleed for a box that ALSO has to stick. Centered with a margin rather than
 *  `left: 50%` + a transform, because sticky spends `left` on its own threshold: given the
 *  centring rule, the board would try to stick sideways. Same reason the bar has its own. */
export const fullBleedStickyCardSx = {
  width: FULL_BLEED_W,
  marginLeft: `calc(50% - (${FULL_BLEED_W}) / 2)`,
} as const

export const fullBleedStickySx = {
  width: { xs: BAR_W, sm: FULL_BLEED_W },
  marginLeft: { xs: `calc(50% - (${BAR_W}) / 2)`, sm: `calc(50% - (${FULL_BLEED_W}) / 2)` },
  px: { xs: `${FULL_BLEED_GUTTER}px`, sm: 0 },
} as const

// The two frozen columns are separate table cells, so the join between them is a seam, and a
// fractional device pixel can open it into a 1px window onto the stats scrolling underneath.
//
// NOT CLOSED BY OVERLAPPING. Sticking the pinned column a couple of pixels left of where the
// table puts it covers the seam at rest, but sticky does not clamp until you have scrolled past
// its threshold, so the column would creep those pixels left over the start of every horizontal
// scroll, in the one place the design promises nothing moves. So the offset is exact
// (`left: nameW`, precisely the cell's own offsetLeft, since the collapsed border adds nothing),
// and the seam is covered by something that cannot move anything, drawn by the pinned column
// over the last of the name column beside it.
//
// NOT A BOX-SHADOW, WHICH IS THE TRAP HERE. `box-shadow` does not apply to internal table
// elements when `border-collapse` is `collapse`, and this table collapses its borders. A
// shadow set on one of these cells computes, inspects and reads back exactly as if it worked,
// and paints nothing at all. That is also why FROZEN_EDGE below is a pseudo-element.
//
// The cover redraws the divider at its right edge, because it lands on top of the name cell's
// own border. 3px wide so rounding at any device pixel ratio has somewhere to land: the name
// column's last 8px are padding, so there is nothing under there to hide.
export const SEAM_COVER = {
  content: '""',
  position: 'absolute' as const,
  top: 0, bottom: 0, right: '100%', width: 3,
  bgcolor: 'background.paper',
  borderRight: '1px solid',
  borderColor: 'divider',
  pointerEvents: 'none' as const,
}

// The frozen columns' rightward shadow onto the scrolling stats once you are off the left
// edge: the "these columns float over the rest" cue.
export const FROZEN_EDGE = {
  content: '""',
  position: 'absolute' as const,
  top: 0, bottom: 0, left: '100%', width: 6,
  background: 'linear-gradient(to right, rgba(0,0,0,0.25), rgba(0,0,0,0))',
  pointerEvents: 'none' as const,
}

// Fixed width of the frozen Player column on mobile, so the pinned sort-value column can sit
// flush against it with a constant `left`: no measurement to drift and let the two frozen
// columns overlap the name when scrolled. Names ellipsize within it.
//
// IN REM, because the column is reserving room for a name: a box sized in px around type sized
// in rem holds what it held while the text inside it grows (see CLAUDE.md on px in /wpbl). The
// stats table shortens names to "F. Last" in JS, and the few surnames still too long for it
// (Leguizamon, Geldenhuis) ellipsize ON PURPOSE: every rem added here is a stat column pushed
// off a phone screen, and the full name is one tap away.
//
// The same rem on `left` as on the width, and that is load-bearing rather than tidy. These two
// numbers are the same number by construction (see the note above on the frozen columns' seam:
// the pinned column's `left` is precisely the name cell's own offsetLeft), so they have to
// scale together or the two frozen columns drift apart and overlap the name under a scroll.
export const NAME_W = '9.375rem'
// NAME_W minus rank + badge + gaps + padding, so the column can't grow past NAME_W.
//
// An APPROXIMATION, deliberately on the safe side. What is subtracted is not all type: the
// badge and the padding are chrome and hold still when the reader enlarges text, so the inner
// budget should really grow by more than the type does, not exactly with it. Scaling it in
// step therefore leaves it a few pixels tight at Large text, which spends one more character
// of a name than it strictly must. That is the right direction to be wrong in: too small only
// ellipsizes a hair early, while too large lets the column outgrow NAME_W and take the sticky
// offset with it.
// 5.125 since the rank column grew by 0.125rem for tied ranks; the two move together.
export const NAME_INNER_MAX = '5.125rem'
/** The table's rank column. In rem, since it reserves room for a number (see NAME_W). */
export const RANK_W = '1.25rem'
/** The focus ring for a column heading, drawn INSIDE the cell: the headings sit at the top of a
 *  scroll box, which would clip the usual ring that sits outside. */
export const HEAD_FOCUS = {
  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-2px' },
} as const
// Teams mode gets a narrower frozen column. There are only four rows, each with a distinct
// badge, and the nickname alone identifies them, so the width a player's full name needs is
// dead space here, and every pixel of it is a stat column pushed off a phone screen.
// No rank number in this mode (see the row), so the budget is padding + badge + gap + label.
export const TEAM_NAME_W = '6.5rem'
export const TEAM_NAME_INNER_MAX = '3.875rem'

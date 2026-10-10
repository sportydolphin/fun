import { chromePx } from './scale'

// THE STATS TABLE'S HEADER, both sections': two rows, the labels and then the league.
//
// It was one row until Oct 2026, each label with the league's figure on a second line under it.
// Only the rates have a league figure, so half the headings had two lines and half had one with a
// blank under it, and every label sat at the top of a cell twice its height: "PLAYER" in one corner
// of the first cell and "League avg" in the opposite one. Splitting it gives every label the same
// line, at the foot of its row where a heading meets its column, and makes the league a row of its
// own, named at its start like every row under it, with a blank where a count has no average. The
// header is the same height it was, so the board under it does not move.
//
// THE LABEL ROW HAS A FIXED HEIGHT because the league row pins under it at that offset: both are
// sticky, and a row whose top is a guess either leaves a strip of scrolling rows showing between
// the two or slides under the first. Chrome px, a whole number of pixels at both scales (24 and
// 30), so the two edges meet on a pixel rather than across a fraction of one. It holds a label at
// the Large text setting with room to spare; the label is bottom-aligned, so the spare is above it.

/** The label row's height, and so the league row's sticky offset. */
export const HEAD_LABEL_H = chromePx(24)

/** Spread over a label cell's own sticky header styles, after them. */
export const HEAD_LABEL_SX = {
  height: HEAD_LABEL_H, pt: 0, pb: 0.5, verticalAlign: 'bottom',
} as const

/** The league row's tint, under the sorted column's accent where that column has one. */
export const HEAD_LEAGUE_TINT = 'linear-gradient(rgba(128,128,128,0.07), rgba(128,128,128,0.07))'

/** A league cell: pinned under the label row, the figure in the label's small type. Spread over the
 *  cell's own sticky styles (background, z-index, left), after them. */
export const HEAD_LEAGUE_SX = {
  position: 'sticky', top: HEAD_LABEL_H,
  py: 0.25, fontSize: '0.58rem', fontWeight: 600, letterSpacing: 0, lineHeight: 1.1,
  color: 'text.secondary', textTransform: 'none', whiteSpace: 'nowrap', verticalAlign: 'middle',
  fontVariantNumeric: 'tabular-nums',
} as const

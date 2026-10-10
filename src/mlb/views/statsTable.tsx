import { Box } from '@mui/material'
import { CARD_BORDER } from '../../ui/card'
import { STATS_BOARD_TOP } from './StatsBar'

// THE STATS TAB'S TABLE FRAME, shared by every MLB board that is a grid (Players, Teams, Fielding),
// so a switch between them moves nothing but the columns. Lifted out of StatsView.tsx when Teams and
// Fielding arrived, rather than copied into them: two copies of a frame are how the boards drift.

// Inset with its border on a phone too, as WPBL's is. It ran edge to edge until Oct 2026, and once
// the tab's gutter came in to 12px its -16px reached 4px past the screen's left edge, cutting the
// "T-" off a tied rank.
export const TABLE_FRAME_SX = {
  border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, overflow: 'hidden',
  bgcolor: 'background.paper',
  // PINNED UNDER THE BAR, as WPBL's board is, so the page cannot carry the column headings up behind
  // it. UNDER, never over: the bar is z-index 6.
  position: 'sticky', top: STATS_BOARD_TOP, zIndex: 1,
} as const
/** The scroll box's cap, WPBL's own (its season table's desktop measure), so the two tables are the
 *  same height on a switch: they were 593 and 683 at 1440x900. One value for the board and its
 *  skeleton. */
export const TABLE_MAX_H = 'calc(100dvh - 260px)'
/** WPBL's NAME_W and NAME_INNER_MAX (src/wpbl/StatsView.tsx), which explains both: rem, because
 *  they reserve room for a name, and the frozen column's `left` is this same width. */
export const NAME_W = '9.375rem'
export const NAME_INNER_MAX = '5.125rem'
/** A row's highlight (picked out, or under the pointer), set on the row and layered into each
 *  cell's background-image over its own opaque paper. See the row's sx in StatsView. */
export const ROW_TINT_VAR = '--mlb-row-tint'
export const ROW_TINT = `linear-gradient(var(${ROW_TINT_VAR}, transparent), var(${ROW_TINT_VAR}, transparent))`
export const TABLE_FOOT_SX = { px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 } as const
export const FOOT_TEXT_SX = { fontSize: '0.66rem', color: 'text.disabled', fontWeight: 600, minWidth: 0 } as const

/** The frozen sorted column on a phone, pinned flush against a name column `left` wide, so the
 *  number the board is ranked on never scrolls away. */
export const frozenSx = (left: string) => ({
  position: 'sticky', left, bgcolor: 'background.paper',
  borderRight: '1px solid', borderColor: 'divider', px: 0.5, whiteSpace: 'nowrap',
  // WPBL's SEAM_COVER: the two frozen cells are separate cells, and at a fractional device pixel
  // the join between them opens onto the stats scrolling underneath. 3px of paint over the name
  // cell's last padding, redrawing its divider, closes it without moving anything.
  '&::before': {
    content: '""', position: 'absolute', top: 0, bottom: 0, right: '100%', width: 3,
    bgcolor: 'background.paper', borderRight: '1px solid', borderColor: 'divider', pointerEvents: 'none',
  },
} as const)
/** The frozen columns' shadow onto the scrolling stats once the table is off its left edge. */
export const FROZEN_EDGE = {
  content: '""', position: 'absolute', top: 0, bottom: 0, left: '100%', width: 6,
  background: 'linear-gradient(to right, rgba(0,0,0,0.25), rgba(0,0,0,0))', pointerEvents: 'none',
} as const

/** A tied rank, "T-12", with the "T-" a size down, as the list draws it, so a two-digit tie fits the
 *  rank column; centred on the number rather than on its baseline, where it reads as a superscript. */
export function RankMarkText({ rank }: { rank: { rank: number; tied: boolean } }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center' }}>
      {rank.tied && <Box component="span" sx={{ fontSize: '0.8em', lineHeight: 1 }}>T-</Box>}
      <Box component="span" sx={{ lineHeight: 1 }}>{rank.rank}</Box>
    </Box>
  )
}

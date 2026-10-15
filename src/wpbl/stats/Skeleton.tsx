import { Box, CircularProgress, Skeleton } from '@mui/material'
import { chromePx } from '../ui'
import { TabTitle } from '../PageHeading'
import { PageTabs } from '../../ui/PageTabs'
import { TABLE_CAP } from '../../ui/ExpandRow'
import { LeadersBoardSkeleton } from '../LeadersBoard'
import { defaultSide } from './axes'
import { ANALYSIS_TABS, ANALYSIS_SOURCES, boardTabOptions } from './boardTabs'
import { axesFromQuery } from './address'
import { fullBleedSx, fullBleedStickySx } from './layout'

// The loaded desktop board: two header rows, TABLE_CAP body rows (each with a 1px rule), the
// "Show all" row, the footer and the card's two borders. A sideways scrollbar, where the platform
// draws one, is the 15px this leaves out.
const DESKTOP_BOARD_SKELETON = `calc(${TABLE_CAP} * (1.56rem + ${chromePx(8.06)} + 1px)`
  + ` + 0.64rem + ${chromePx(28.36)} + 48px + 0.99rem + ${chromePx(16.8)} + 2px)`

// Placeholder while a sub-tab's chunk arrives. These views render in place under the group
// bar, so a centred spinner in the content area is what the reader already sees while their
// data loads, and the switch reads as slow rather than broken.
export function SubViewFallback() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
      <CircularProgress size={26} sx={{ color: 'var(--wpbl-accent-fg)' }} />
    </Box>
  )
}

/** This tab while the section's first read is in flight: its title, its control bar and its table,
 *  at the same full-bleed measure the loaded tab draws them at, so nothing moves when it lands.
 *  Desktop measurements over the 1.25 scale, in chromePx. See TabSkeleton in WpblApp.tsx. */
export function StatsSkeleton({ newBoards }: { newBoards?: ReadonlySet<string> }) {
  // The board the address will open on: Leaders, unless it names another (axesFromQuery). Only
  // the leaders and the table have skeletons of their own; any other board draws the table's.
  const q = axesFromQuery()
  const source = q.source ?? 'leaders'
  const analysis = ANALYSIS_SOURCES.has(source)
  const board = source === 'season' ? (q.mode ?? 'players') : analysis ? 'analysis' : source
  return (
    <Box sx={{ flexGrow: 1 }}>
      <TabTitle sx={{ ...fullBleedSx, mb: 1 }}>WPBL Stats</TabTitle>
      {/* THE BOARD ROWS THEMSELVES, not a block the size of them: the words need no data, and a row
          that is the real component cannot come out a different height from the loaded one, which
          the Analysis row under it made a second number to keep in step. Inert until the tab lands. */}
      <Box aria-hidden sx={{ ...fullBleedStickySx, pt: 1, pointerEvents: 'none' }}>
        <PageTabs options={boardTabOptions(newBoards)} value={board} onChange={() => {}} />
        {analysis && <PageTabs sub options={ANALYSIS_TABS.map(b => ({ value: b.key, label: b.label }))} value={source} onChange={() => {}} />}
      </Box>
      {/* The controls row: on a phone the bar's 4px top, the 34px pill and its 8px foot; above
          one, the switch's chrome-scaled height and the row's foot. The table's top border tucks
          under its last pixel. */}
      <Skeleton variant="rounded" sx={{ ...fullBleedSx, height: { xs: '46px', sm: `calc(${chromePx(28)} + 6px + ${chromePx(12)})` }, borderRadius: 2 }} />
      {source === 'leaders' ? (
        <Box sx={fullBleedSx}>
          <Box>
            <LeadersBoardSkeleton side={q.side ?? defaultSide('leaders')} />
          </Box>
        </Box>
      ) : (
        // Above a phone the table is as tall as its rows, TABLE_CAP of them on the default board
        // (every qualified hitter), plus the 48px "Show all" row and the board's footer. Each part is
        // type plus chrome, so the box tracks the reader's text size: measured at two text scales.
        <Skeleton variant="rounded" sx={{ ...fullBleedSx, height: { xs: '593px', sm: DESKTOP_BOARD_SKELETON }, borderRadius: 2, mt: '-1px' }} />
      )}
    </Box>
  )
}

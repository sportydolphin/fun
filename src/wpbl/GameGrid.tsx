import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, useMediaQuery } from '@mui/material'
import { pressable, FOCUS_RING, wpblNameStages } from './ui'

/**
 * The scrolling game-by-game grid shared by the lineup-history and pitching-usage cards:
 * a pinned player column on the left, one column per game across the top, newest first.
 *
 * Presentational only — callers supply the columns, the rows, and a renderer for each cell.
 * It exists so the two cards can't drift apart, and because the sticky-column CSS below has
 * two non-obvious traps that are easy to reintroduce (both flagged inline).
 */

/** How many games either grid shows on a phone. Fangraphs shows six on a depth chart, and six
 *  fits a phone with a sticky name column. */
const GRID_GAMES = 6

/** Desktop shows twice as many. Both view queries already pull the team's whole season — the
 *  count here is purely how much of it to draw — and a card that is ~980px wide was spending
 *  more than half of that on nothing. Twelve columns land at a natural ~68px each once a team
 *  has played that many; until then they simply grow to fill (see the flex sizing below). */
const GRID_GAMES_WIDE = 12

/** The window either grid covers, for the viewport it's on. Shared so the two cards always
 *  cover the SAME window — reading one against the other is most of the point of having both
 *  on the page, and that breaks silently if they ever disagree. */
export function useGridGames(): number {
  return useMediaQuery('(max-width:600px)') ? GRID_GAMES : GRID_GAMES_WIDE
}

/** The one colour either grid uses to flag something the reader should not skim past: a
 *  left-handed start in the lineup grid, an outing on short rest in the pitching grid.
 *  Shared so a flag always looks like a flag, and so nothing else in these cards is orange. */
export const GRID_FLAG = '#c2410c'

export interface GameGridColumn {
  id: string
  /** Top line of the header, e.g. "Sa 8/15" — always from formatGameColumn. */
  title: string
  /** Second line: who they played, "vs SF". Both grids put the opponent here. */
  sub?: string
  subColor?: string
  /** Optional third line, e.g. the opposing starter and hand, "Castillo L". */
  sub2?: string
  sub2Color?: string
}

export interface GameGridRow {
  id: string
  /** The player's FULL name. The grid fits it to the pinned column itself (see GridName) —
   *  callers must not pre-shorten it, or the fitter has nothing left to work with. */
  label: string
  /** Optional short figure pinned to the right of the name (e.g. a workload total). Kept in
   *  its own slot rather than appended to `label`, so a long name truncates the NAME and
   *  never the number — the number is usually the reason the column is there. */
  meta?: string
  onClick?: () => void
}

// Defaults suit the lineup grid; the pitching grid overrides both, because its cells hold a
// pitch count rather than a position-and-slot string and it can therefore be much tighter.
// Sized from measured text at 375px, not guessed: see each caller.
const DEFAULT_NAME_W = 128
const DEFAULT_COL_W = 66

/** How far past its minimum a column may grow to soak up spare width. A cell holds at most
 *  "DH/LF (8)" or "102*", so past roughly double the minimum the extra is just air between
 *  the numbers — better to leave a margin at the right of an early-season grid than to draw
 *  four enormous columns. Bites only while a team has played few games. */
const GROW_CAP = 2

export default function GameGrid({ columns, rows, renderCell, colWidth, nameWidth }: {
  columns: GameGridColumn[]
  rows: GameGridRow[]
  /** Return null for "did not appear" — the grid draws the placeholder dash itself. */
  renderCell: (rowId: string, columnId: string) => React.ReactNode
  /** MINIMUM per-game column width — narrow enough to fit several on a phone before
   *  scrolling. Where there is spare width (desktop) columns grow past it to fill, capped at
   *  GROW_CAP× so an early-season grid of two games doesn't stretch into giant blocks. */
  colWidth?: number
  /** Pinned name column width. Responsive, because this is the one column that wants a
   *  phone's frugality and a desktop's room for a whole name. */
  nameWidth?: number | { xs: number; sm: number }
}) {
  const COL_W = colWidth ?? DEFAULT_COL_W
  // The xs value drives the scroll threshold below; on wider screens there is spare room by
  // definition, so under-counting the name column there costs nothing.
  const NAME_W = typeof nameWidth === 'number' ? { xs: nameWidth, sm: nameWidth }
    : nameWidth ?? { xs: DEFAULT_NAME_W, sm: DEFAULT_NAME_W }

  // One sizing rule for both viewports. The track's `minWidth` is the phone's fixed layout,
  // so on a narrow screen there is no free space and `flexGrow` does nothing — columns stay
  // exactly COL_W and the grid scrolls, as before. On a wide screen `width: 100%` exceeds
  // that minimum and the same rule spends the surplus on the columns instead of leaving it
  // blank to the right of the card.
  const colSize = {
    flexGrow: 1, flexShrink: 0, flexBasis: COL_W,
    minWidth: COL_W, maxWidth: COL_W * GROW_CAP,
  }
  return (
    // The grid is wider than a phone, so it scrolls sideways while the name column stays
    // pinned — otherwise you lose track of whose row you're reading.
    // TRAP 1: no horizontal padding here. `position: sticky; left: 0` pins to the
    // scrollport's PADDING edge, so any px leaves a strip the pinned column never covers,
    // and the scrolled cells show through beside the names.
    <Box sx={{ overflowX: 'auto', pb: 0.5 }}>
      {/* `width: 100%` is what makes the columns fill a wide card; `minWidth` is the phone's
          fixed layout and the point at which the grid starts scrolling instead. */}
      <Box sx={{ minWidth: NAME_W.xs + columns.length * COL_W, width: '100%', display: 'inline-block' }}>

        <Box sx={{ display: 'flex', alignItems: 'flex-end' }}>
          {/* TRAP 2: alignSelf:stretch is load-bearing on this spacer. With no children it
              collapses to zero height, and the scrolled-under header labels show through
              beside the pinned names. */}
          <Box sx={{
            width: NAME_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 2,
            bgcolor: 'background.paper', alignSelf: 'stretch',
            borderRight: '1px solid', borderColor: 'divider',
          }} />
          {columns.map(c => (
            <Box key={c.id} sx={{
              ...colSize, textAlign: 'center', pb: 0.5, overflow: 'hidden',
            }}>
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, lineHeight: 1.2 }}>
                {c.title}
              </Typography>
              <Typography sx={{
                fontSize: '0.55rem', fontWeight: 700, lineHeight: 1.3,
                color: c.subColor ?? 'text.disabled',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {c.sub ?? '—'}
              </Typography>
              {c.sub2 && (
                <Typography sx={{
                  fontSize: '0.5rem', fontWeight: 800, lineHeight: 1.3,
                  letterSpacing: 0.2,
                  color: c.sub2Color ?? 'text.disabled',
                  // sub2 carries a pitcher's surname in the lineup grid, not just "LHP",
                  // so it can overrun the column the same way sub can.
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {c.sub2}
                </Typography>
              )}
            </Box>
          ))}
        </Box>

        {rows.map(r => (
          <Box
            key={r.id}
            {...pressable(r.onClick)}
            sx={{
              display: 'flex', alignItems: 'stretch',
              borderTop: '1px solid', borderColor: 'divider',
              cursor: r.onClick ? 'pointer' : 'default',
              '&:hover': r.onClick ? { bgcolor: 'action.hover' } : undefined,
              // The row scrolls sideways inside the grid, so a focus ring drawn at its own
              // edges can sit off-screen. Keeping the pinned name column in view is what
              // makes tabbing through legible.
              ...FOCUS_RING,
            }}
          >
            <Box sx={{
              width: NAME_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 2,
              bgcolor: 'background.paper', display: 'flex', alignItems: 'center',
              py: 0.55, pr: 0.5,
              borderRight: '1px solid', borderColor: 'divider',
            }}>
              <GridName name={r.label} fitKey={NAME_W.xs + NAME_W.sm} />
              {r.meta && (
                <Typography sx={{
                  flexShrink: 0, pl: 0.5,
                  fontSize: '0.66rem', fontWeight: 700, color: 'text.disabled',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {r.meta}
                </Typography>
              )}
            </Box>
            {columns.map(c => {
              const cell = renderCell(r.id, c.id)
              return (
                <Box key={c.id} sx={{
                  ...colSize, display: 'flex',
                  alignItems: 'center', justifyContent: 'center', py: 0.55,
                  overflow: 'hidden',
                }}>
                  {cell ?? (
                    <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled', opacity: 0.4 }}>
                      &mdash;
                    </Typography>
                  )}
                </Box>
              )
            })}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

/**
 * A player's name fitted to the pinned column by MEASUREMENT, degrading
 * "Suzuka Yamamoto" → "S. Yamamoto" rather than letting CSS cut it to "Suzuka Yam…".
 *
 * Why the grid does this instead of the caller: these cards used `useWpblName()`, whose budget
 * is a CHARACTER count (20 on desktop). "Suzuka Yamamoto" is 15 characters, so it passed the
 * budget untouched and then overflowed a column that is a fixed number of PIXELS wide — the
 * exact trap ui.tsx warns about where wpblShortName is defined. Characters don't predict
 * pixels, and only the grid knows the pixels, so the fitting belongs here.
 *
 * Walks wpblNameStages (full → "F. Last Names" → "F. Surname"), stepping down one stage per
 * pass while the text overflows. Converges in at most two passes. Ellipsis stays as the final
 * backstop for a surname that is itself too long for the column.
 */
function GridName({ name, fitKey }: { name: string; fitKey: number }) {
  const ref = useRef<HTMLElement | null>(null)
  const stages = useMemo(() => wpblNameStages(name), [name])
  const [stage, setStage] = useState(0)

  // Re-measure from the top whenever the name or the column width changes — the latter is what
  // restores a full name when the viewport grows, instead of leaving it abbreviated forever.
  useLayoutEffect(() => { setStage(0) }, [name, fitKey])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // +1 absorbs sub-pixel rounding, which would otherwise abbreviate a name that just fits.
    if (el.scrollWidth > el.clientWidth + 1 && stage < stages.length - 1) setStage(stage + 1)
  })

  return (
    <Typography ref={ref} title={name} sx={{
      flex: 1, minWidth: 0,
      fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap',
      overflow: 'hidden', textOverflow: 'ellipsis',
    }}>
      {stages[stage]}
    </Typography>
  )
}

/** "2026-08-15" → "Sa 8/15".
 *
 *  Both grids use this one function, so a column is labelled the same way wherever you meet
 *  it. The weekday is two letters rather than three because of the pitching grid: measured
 *  at 16px Inter, "Wed 8/15" is 44px against a 38px column, so three letters simply did not
 *  fit and that grid used to drop the weekday altogether. Two letters is 32–38px across the
 *  whole week, which does fit — the weekday survives in both grids for the price of six
 *  pixels of column width, instead of being dropped from one of them.
 *
 *  Parsed as parts, not `new Date(str)`, which would shift the date backwards for anyone
 *  west of UTC. */
export function formatGameColumn(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const day = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][dt.getDay()]
  return `${day} ${m}/${d}`
}

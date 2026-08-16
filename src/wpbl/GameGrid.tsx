import { Box, Typography } from '@mui/material'
import { pressable, FOCUS_RING } from './ui'

/**
 * The scrolling game-by-game grid shared by the lineup-history and pitching-usage cards:
 * a pinned player column on the left, one column per game across the top, newest first.
 *
 * Presentational only — callers supply the columns, the rows, and a renderer for each cell.
 * It exists so the two cards can't drift apart, and because the sticky-column CSS below has
 * two non-obvious traps that are easy to reintroduce (both flagged inline).
 */

export interface GameGridColumn {
  id: string
  /** Top line of the header, e.g. "Sat 8/15". */
  title: string
  /** Second line, e.g. a pitcher's name or "vs SF". */
  sub?: string
  subColor?: string
  /** Optional third line, e.g. "LHP". */
  sub2?: string
  sub2Color?: string
}

export interface GameGridRow {
  id: string
  label: string
  /** Optional short figure pinned to the right of the name (e.g. a workload total). Kept in
   *  its own slot rather than appended to `label`, so a long name truncates the NAME and
   *  never the number — the number is usually the reason the column is there. */
  meta?: string
  onClick?: () => void
}

const NAME_W = 128
const COL_W = 66

export default function GameGrid({ columns, rows, renderCell }: {
  columns: GameGridColumn[]
  rows: GameGridRow[]
  /** Return null for "did not appear" — the grid draws the placeholder dash itself. */
  renderCell: (rowId: string, columnId: string) => React.ReactNode
}) {
  return (
    // The grid is wider than a phone, so it scrolls sideways while the name column stays
    // pinned — otherwise you lose track of whose row you're reading.
    // TRAP 1: no horizontal padding here. `position: sticky; left: 0` pins to the
    // scrollport's PADDING edge, so any px leaves a strip the pinned column never covers,
    // and the scrolled cells show through beside the names.
    <Box sx={{ overflowX: 'auto', pb: 0.5 }}>
      <Box sx={{ minWidth: NAME_W + columns.length * COL_W, display: 'inline-block' }}>

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
              width: COL_W, flexShrink: 0, textAlign: 'center', pb: 0.5, overflow: 'hidden',
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
              <Typography sx={{
                flex: 1, minWidth: 0,
                fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {r.label}
              </Typography>
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
                  width: COL_W, flexShrink: 0, display: 'flex',
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

/** "2026-08-15" → "Sat 8/15". Parsed as parts, not `new Date(str)`, which would shift the
 *  date backwards for anyone west of UTC. */
export function formatGameColumn(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()]
  return `${day} ${m}/${d}`
}

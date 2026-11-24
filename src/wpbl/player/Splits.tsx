import { Box, Skeleton } from '@mui/material'
import { fmtRate } from '../stats'
import { useEraBasis } from '../EraBasisContext'
import { TapTip } from '../ui'
import { SectionHead } from '../cardParts'
import {
  isZeroStat, ZERO_SX, bleedSx, BLOCK_GAP,
  useCollapsibleTable, ExpandToggle, thSx, tdSx, TIP_Z,
} from '../../ui/playerCard'
import { useEdgeFade } from '../../ui/edgeFade'
import { playerSplits, splitRates, type SplitGroup, type SplitSide } from '../derive/splits'
import { statTip } from './pieces'

const HEADS = ['PA', 'AB', 'H', '2B', '3B', 'HR', 'BB', 'SO', 'AVG', 'OBP', 'SLG', 'OPS']
// Widths of typical figures, so a loading row is as wide as a loaded one.
const SAMPLES = ['00', '00', '00', '0', '0', '0', '0', '00', '.000', '.000', '.000', '.000']

/** The groups the table opens on: the hand and the base-out situation. The count, the inning and
 *  the lineup spot are behind the toggle, which keeps the closed table near the log's height. */
const OPEN_GROUPS = 2

// The fixed shape, for the loading state: every group but the lineup spots, which only the box
// scores can name and which sit behind the toggle anyway.
const shapeOf = (side: SplitSide) => playerSplits(side, [], () => null)

/**
 * The player's season by split, under the matchup table. `groups` is null until the season's play
 * log lands, and the table is drawn with its real labels and bars for figures until then (the
 * loading rule in src/CLAUDE.md), since the play log is a second read after the player's lines.
 */
export function SplitsTable({ side, groups, accent }: {
  side: SplitSide
  groups: SplitGroup[] | null
  accent: string
}) {
  const { basis: eraBasis } = useEraBasis()
  const { expanded, toggle, sectionRef, scrollerRef } = useCollapsibleTable()
  const fade = useEdgeFade(scrollerRef)
  const loading = groups == null
  const all = groups ?? shapeOf(side)
  // A player the play log never names (a pinch runner, a pitcher with no recorded plate
  // appearance) has no splits worth a table of dashes.
  if (!loading && all.every(g => g.rows.every(r => r.line.pa === 0))) return null
  const shown = expanded ? all : all.slice(0, OPEN_GROUPS)
  // Counted off the loading shape too, so the toggle is there from the first frame.
  const hidden = all.slice(OPEN_GROUPS).reduce((n, g) => n + g.rows.length, 0)
  return (
    <Box ref={sectionRef} sx={{ mt: BLOCK_GAP }}>
      <SectionHead title="Splits" part="splits" />
      <Box ref={scrollerRef} sx={{ ...bleedSx(0.85), overflowX: 'auto', ...fade }}>
        <Box component="table" sx={{ width: '100%', minWidth: 'max-content', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
          <Box component="thead">
            <Box component="tr">
              <Box component="th" sx={{ ...thSx, textAlign: 'left' }}>Split</Box>
              {HEADS.map(h => (
                <TapTip key={h} title={statTip(h, eraBasis)} component="th" popperZIndex={TIP_Z} sx={thSx}>{h}</TapTip>
              ))}
            </Box>
          </Box>
          {shown.map(g => (
            <Box component="tbody" key={g.key}>
              <Box component="tr">
                <Box component="th" scope="colgroup" colSpan={HEADS.length + 1}
                  sx={{ ...thSx, position: 'static', textAlign: 'left', pt: 1.2, boxShadow: 'none' }}>
                  {g.label}
                </Box>
              </Box>
              {g.rows.map((r, i) => {
                const rates = splitRates(r.line)
                const s = r.line
                const rate = (v: number | null) => (v == null ? '—' : fmtRate(v))
                const cells: (string | number)[] = [s.pa, s.ab, s.h, s.doubles, s.triples, s.hr, s.bb, s.so,
                  rate(rates.avg), rate(rates.obp), rate(rates.slg), rate(rates.ops)]
                return (
                  <Box component="tr" key={r.key} sx={i % 2 === 1 ? { bgcolor: 'action.hover' } : undefined}>
                    <Box component="th" scope="row" sx={{ ...tdSx, textAlign: 'left', fontWeight: 700 }}>{r.label}</Box>
                    {cells.map((c, j) => (
                      <Box component="td" key={j} sx={!loading && isZeroStat(c) ? { ...tdSx, ...ZERO_SX } : tdSx}>
                        {loading
                          ? <Skeleton variant="text" sx={{ display: 'inline-block', width: `${SAMPLES[j].length * 0.62}em` }} />
                          : c}
                      </Box>
                    ))}
                  </Box>
                )
              })}
            </Box>
          ))}
        </Box>
      </Box>
      <ExpandToggle expanded={expanded} hidden={hidden} noun={['split', 'splits']} onToggle={toggle} accent={accent} />
    </Box>
  )
}

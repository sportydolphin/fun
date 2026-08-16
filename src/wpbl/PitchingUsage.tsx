import { useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { SectionCard } from './ui'
import GameGrid, { formatGameColumn, useGridGames, GRID_FLAG } from './GameGrid'
import { buildUsageGrid, outsToIpShort } from './derive/pitchingUsage'
import type { WpblPitchingUsageRow, WpblPlayer } from './types'

/**
 * Bullpen usage — who has been worked, and who should be available tonight.
 *
 * The companion to the lineup grid. One row per pitcher, one column per game, each cell
 * showing the pitch count over the innings thrown. Pitches rather than innings is the
 * headline number on purpose: a one-inning outing can be twelve pitches or thirty-five,
 * and it's the pitch count that decides whether they can go again tomorrow.
 *
 * Rows read rotation-first, then bullpen by workload — see rankPitcher.
 *
 * Back-to-back outings are flagged, because that's the one thing in here a manager
 * genuinely can't do twice more without consequence.
 */

export default function PitchingUsage({
  rows, roster, accent, onOpenPlayer,
}: {
  rows: WpblPitchingUsageRow[]
  roster: WpblPlayer[]
  accent: string
  onOpenPlayer: (p: WpblPlayer) => void
}) {
  const gridGames = useGridGames()
  const playerById = useMemo(() => new Map(roster.map(p => [p.id, p])), [roster])
  const { games, pitchers, cells, windowPitches } = useMemo(
    () => buildUsageGrid(rows, gridGames), [rows, gridGames])

  if (!games.length) {
    return (
      <SectionCard title="Pitching usage" subtitle={`Last ${gridGames} games`}>
        <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled', py: 1 }}>
          No pitching recorded yet.
        </Typography>
      </SectionCard>
    )
  }

  const totalPitches = [...windowPitches.values()].reduce((a, b) => a + b, 0)

  return (
    <SectionCard
      title="Pitching usage"
      subtitle={`Last ${games.length} games · pitches (IP)`}
    >
      <GameGrid
        // The widest thing in a column here is 3 digits and an asterisk ("102*", 28px), so
        // most of the original 66px was air. What sets the width is the header: a two-letter
        // weekday and date is 32–38px across the week ("Mo"/"We" being the wide ones), and 44
        // leaves a 6px gutter so adjacent headers don't run together. That shows ~4.4 games on
        // a 375px screen. The column was 38 while this grid dropped the weekday to save the
        // room; carrying the same date label as the lineup grid is worth the half-column.
        colWidth={44}
        // 116 = widest abbreviated name (84) + the workload total (19) + gaps. At 112 the
        // longest names clipped to "Jamie Mack…"; the extra 4px costs no column. Desktop gets
        // 200 — 180 for a full name, matching the lineup grid, plus the workload total's slot.
        nameWidth={{ xs: 116, sm: 200 }}
        columns={games.map(g => ({
          id: g.id,
          title: formatGameColumn(g.date),
          sub: g.opp ? `vs ${g.opp}` : undefined,
        }))}
        rows={pitchers.map(pid => {
          const player = playerById.get(pid)
          const total = windowPitches.get(pid) ?? 0
          return {
            id: pid,
            // Full name — GameGrid fits it to the column itself (see GridName).
            label: player ? player.name : '—',
            // Her total across the window, pinned beside the name so it stays visible while
            // the game columns scroll.
            meta: String(total),
            onClick: player ? () => onOpenPlayer(player) : undefined,
          }
        })}
        renderCell={(pid, gid) => {
          const c = cells.get(pid)?.get(gid)
          if (!c) return null
          // One day between outings (or two the same day) is the fatigue signal worth
          // surfacing; anything longer is ordinary rest and shouldn't shout.
          const backToBack = c.daysRest != null && c.daysRest <= 1
          return (
            <Box sx={{ textAlign: 'center', lineHeight: 1.15 }}>
              <Typography sx={{
                fontSize: '0.72rem', fontWeight: c.started ? 800 : 600,
                fontVariantNumeric: 'tabular-nums',
                color: c.started ? accent : 'text.primary',
              }}>
                {c.pitches ?? '?'}
                {backToBack && (
                  <Box component="span" sx={{ color: GRID_FLAG, fontWeight: 900 }}>*</Box>
                )}
              </Typography>
              <Typography sx={{
                fontSize: '0.55rem', fontWeight: 600, color: 'text.disabled',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {outsToIpShort(c.outs)}
              </Typography>
            </Box>
          )
        }}
      />
      <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', pt: 1, lineHeight: 1.5 }}>
        Pitches thrown over innings pitched, newest first. The number beside each name is their
        total across these {games.length} games ({totalPitches} staff-wide). <b>Bold</b> started;
        <Box component="span" sx={{ color: GRID_FLAG, fontWeight: 900 }}> *</Box> came back on
        one day of rest or less.
      </Typography>
    </SectionCard>
  )
}

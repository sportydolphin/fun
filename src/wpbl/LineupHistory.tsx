import { useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { SectionCard, useWpblName } from './ui'
import GameGrid, { formatGameColumn } from './GameGrid'
import { buildLineupGrid } from './derive/lineupGrid'
import type { WpblLineupHistoryRow, WpblPlayer } from './types'

/**
 * "Last N lineups" — the grid Fangraphs' Roster Resource keeps on the right of a depth
 * chart, built from our own data instead of by hand.
 *
 * One row per player, one column per game (most recent first), each cell reading
 * POSITION (lineup spot). Read down a column and you get that night's card; read across a
 * row and you get how a manager actually feels about a player — which is the thing a
 * season-totals table can never show.
 *
 * Each column is labelled with the opposing starter's hand, because that's usually the
 * reason a lineup changed shape. Without it the grid looks like random shuffling.
 */

const MAX_GAMES = 6      // Fangraphs shows six; it fits a phone with a sticky name column.

export default function LineupHistory({
  rows, roster, accent, onOpenPlayer,
}: {
  rows: WpblLineupHistoryRow[]
  roster: WpblPlayer[]
  accent: string
  onOpenPlayer: (p: WpblPlayer) => void
}) {
  const shortName = useWpblName()
  const playerById = useMemo(() => new Map(roster.map(p => [p.id, p])), [roster])
  const { games, players, cells } = useMemo(() => buildLineupGrid(rows, MAX_GAMES), [rows])

  if (!games.length) {
    return (
      <SectionCard title="Lineup history" subtitle="Last 6 games">
        <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled', py: 1 }}>
          No lineups recorded yet.
        </Typography>
      </SectionCard>
    )
  }

  return (
    <SectionCard title="Lineup history" subtitle={`Last ${games.length} games · position (spot)`}>
      <GameGrid
        // Measured at 375px: widest cell "DH/LF (8)" is 51px and the widest header line
        // (a pitcher surname) 43px, so 58 clears both. The name column holds an abbreviated
        // name at 84px. Together that shows ~4 games before scrolling instead of ~3.
        colWidth={58}
        nameWidth={92}
        columns={games.map(g => ({
          id: g.id,
          title: formatGameColumn(g.date),
          // The starter by name. A bare "vs L" reads as if it might describe the whole
          // staff; a name can only be one person, which is the whole point of the column.
          sub: g.starter ? lastName(g.starter) : g.opp ? `vs ${g.opp}` : undefined,
          sub2: g.hand ? `${g.hand}HP` : undefined,
          // A lefty start is the usual reason a card looks different, so it's the one
          // header worth colouring.
          sub2Color: g.hand === 'L' ? '#c2410c' : undefined,
        }))}
        rows={players.map(pid => {
          const player = playerById.get(pid)
          return {
            id: pid,
            label: player ? shortName(player.name) : '—',
            onClick: player ? () => onOpenPlayer(player) : undefined,
          }
        })}
        renderCell={(pid, gid) => {
          const c = cells.get(pid)?.get(gid)
          if (!c) return null
          return (
            <Typography sx={{
              fontSize: '0.68rem', lineHeight: 1.2, textAlign: 'center',
              fontVariantNumeric: 'tabular-nums',
              // A start is stated plainly; a substitute appearance is dimmed and italic, so
              // scanning a row shows regular usage at a glance.
              fontWeight: c.started ? 800 : 500,
              fontStyle: c.started ? 'normal' : 'italic',
              color: c.started ? accent : 'text.disabled',
            }}>
              {(c.position ?? '?').toUpperCase()}
              <Box component="span" sx={{ fontWeight: 500, opacity: 0.75 }}>{` (${c.spot})`}</Box>
            </Typography>
          )
        }}
      />
      <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', pt: 1, lineHeight: 1.5 }}>
        Position and lineup spot per game, newest first. <b>Bold</b> started; <i>italic</i> entered
        as a substitute. Each column is headed by the pitcher who <i>started</i> for the other
        side and their throwing hand &mdash; relievers who followed them aren't shown here.
      </Typography>
    </SectionCard>
  )
}

/** "Rosi del Castillo" → "Castillo". Header columns are 66px, so the surname alone is all
 *  that fits; every starter so far is 8 characters or fewer. */
function lastName(full: string): string {
  return full.trim().split(/\s+/).slice(-1)[0]
}

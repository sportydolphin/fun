import { useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { SectionCard } from './ui'
import GameGrid, { formatGameColumn, useGridGames, GRID_FLAG } from './GameGrid'
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
 * Column headers match the pitching-usage grid line for line — date, then opponent — with a
 * third line here for the opposing starter and their throwing hand, because that's usually
 * the reason a lineup changed shape. Without it the grid looks like random shuffling.
 */

export default function LineupHistory({
  rows, roster, accent, onOpenPlayer,
}: {
  rows: WpblLineupHistoryRow[]
  roster: WpblPlayer[]
  accent: string
  onOpenPlayer: (p: WpblPlayer) => void
}) {
  const gridGames = useGridGames()
  const playerById = useMemo(() => new Map(roster.map(p => [p.id, p])), [roster])
  const { games, players, cells } = useMemo(() => buildLineupGrid(rows, gridGames), [rows, gridGames])

  if (!games.length) {
    return (
      <SectionCard title="Lineup history" subtitle={`Last ${gridGames} games`}>
        <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled', py: 1 }}>
          No lineups recorded yet.
        </Typography>
      </SectionCard>
    )
  }

  return (
    <SectionCard title="Lineup history" subtitle={`Last ${games.length} games · position (spot)`}>
      <GameGrid
        // REM, NOT PIXELS: 3.625rem is the 58px this was measured at, and passing the pixel
        // number made the grid twenty times too wide. Measured at 375px, the widest cell
        // "DH/LF (8)" is 51px and the widest header line (a pitcher surname) 43px, so 58
        // clears both; in rem it now grows with the type instead of clipping at Large text.
        colWidthRem={3.625}
        // Desktop gets 11.25rem (the old 180px): enough for "Gabrielle Haas" or "Suzuka
        // Yamamoto" in full, which is most of the roster, so the fitter only has to abbreviate
        // the genuine outliers.
        nameWidthRem={{ xs: 5.75, sm: 11.25 }}
        columns={games.map(g => ({
          id: g.id,
          title: formatGameColumn(g.date),
          // Line 2 is the opponent in both grids, so the same slot always answers the same
          // question. It used to hold the pitcher here, which meant this card was the one
          // place on the team page that never told you who they played.
          sub: g.opp ? `vs ${g.opp}` : undefined,
          // The starter, by name and hand together on one line — a bare "vs L" reads as if
          // it might describe the whole staff, and a name can only be one person, which is
          // the whole point of the column.
          sub2: g.starter
            ? `${lastName(g.starter)}${g.hand ? ` ${g.hand}` : ''}`
            : g.hand ? `${g.hand}HP` : undefined,
          // A lefty start is the usual reason a card looks different, so it's the one
          // header worth colouring.
          sub2Color: g.hand === 'L' ? GRID_FLAG : undefined,
        }))}
        rows={players.map(pid => {
          const player = playerById.get(pid)
          return {
            id: pid,
            // Full name — GameGrid fits it to the column itself (see GridName).
            label: player ? player.name : '—',
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
        Position and lineup spot per game, oldest to newest. <b>Bold</b> started; <i>italic</i> entered
        as a substitute. Under each date is the opponent, then the pitcher who <i>started</i> for
        them and their throwing hand &mdash; relievers who followed aren't shown here.
      </Typography>
    </SectionCard>
  )
}

/** "Rosi del Castillo" → "Castillo". The column is 58px and the surname shares its line with
 *  the throwing hand, so the surname alone is all that fits; "Castillo L" measures 38px at the
 *  header's 8px type, and anything longer ellipsises rather than pushing the column wider. */
function lastName(full: string): string {
  return full.trim().split(/\s+/).slice(-1)[0]
}

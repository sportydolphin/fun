import React, { useMemo } from 'react'
import { Box, Typography, useMediaQuery, useTheme } from '@mui/material'
import { SectionCard, TYPE_SCALE } from './card'
import { BOARD_COLUMN, BOARD_COLUMN_WIDE } from './layoutWidths'

// The Bests board's body, for both sections: the best single game anyone had, by each of a handful
// of measures. The arithmetic is src/league/bests.ts and the row is src/ui/gameLine.tsx; this is
// the layout between them, which each section drew for itself until Oct 2026. Each section keeps
// what is its own: where the lines come from, its controls, and its own row parts.

/** The shape of a board as src/league/bests.ts returns it, whatever the league's own types. */
export interface BestsBoardShape<R> {
  key: string
  label: string
  unit: string
  rows: R[]
  /** Rows tied past the card's cap, counted rather than dropped. Zero where nothing is capped. */
  more: number
}

export function BestsBoards<R extends { display: string }>({
  boards, finals, gamesWord, renderRow, loading = false, skeleton,
}: {
  boards: BestsBoardShape<R>[]
  /** Final games in the slice the boards are drawn from. MUST be the scoped count: a playoff
   *  record book under a line claiming the whole season is the page contradicting itself. */
  finals: number
  /** "regular-season games", "playoff games" or "games", matching the slice. */
  gamesWord: string
  renderRow: (row: R, i: number, board: BestsBoardShape<R>) => React.ReactNode
  /** While the lines are still coming (MLB reads them; WPBL already holds them). */
  loading?: boolean
  /** A card's loading shape: the real title and the rows it nearly always has. */
  skeleton?: (board: BestsBoardShape<R>) => React.ReactNode
}) {
  const theme = useTheme()
  // Two columns only where the layout below actually splits into two. `noSsr` because this is a
  // client-only SPA and the default would render the one-column branch first and then jump.
  const twoCol = useMediaQuery(theme.breakpoints.up('lg'), { noSsr: true })
  // Even boards down the left, odd down the right: two INDEPENDENT columns. A CSS grid locks each
  // row to the height of its taller card, so a short board beside a tall one grew a gap under it;
  // stacking each column on its own lets the cards butt straight up against each other. The split is
  // desktop-only, so the phone keeps the natural board order rather than all-lefts-then-rights.
  const columns = useMemo(
    () => twoCol ? [boards.filter((_, i) => i % 2 === 0), boards.filter((_, i) => i % 2 === 1)] : [boards],
    [boards, twoCol])
  const anyRows = boards.some(b => b.rows.length > 0)
  const gap = { xs: 1.5, sm: 2 }

  return (
    // CAPPED AND CENTRED: a list has nothing to spend width on, but six lists queued in one column
    // on a wide screen is half a screen of nothing down each side. One list measure below `lg`, two
    // and the gap between them from there (layoutWidths.ts).
    <Box sx={{ display: 'flex', flexDirection: 'column', gap, maxWidth: { xs: BOARD_COLUMN, lg: BOARD_COLUMN_WIDE }, mx: 'auto', width: '100%' }}>
      {/* ONE SENTENCE, NO HEADING, AND NO PER-CARD SUBTITLE. The board tab already says "Bests" and
          each card title says what it measures. The one thing none of those carry is that these are
          single GAMES on a tab of season totals; the game count is the other half, since a record
          out of 30 games is a different thing from one out of 3,000. */}
      <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', lineHeight: 1.5, maxWidth: '70ch' }}>
        Single-game totals, not season totals
        {/* Reserved, invisibly, while the lines load: on a phone it is what wraps the sentence to a
            second line, and the cards would drop by that line when it landed. */}
        {loading
          ? <Box component="span" sx={{ visibility: 'hidden' }}>, from 2,430 {gamesWord}</Box>
          : finals > 0 ? `, from ${finals.toLocaleString()} ${gamesWord}` : ''}.
      </Typography>
      {!loading && !anyRows ? (
        <Box sx={{ textAlign: 'center', py: 5, px: 2, color: 'text.secondary' }}>
          <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700, mb: 0.5 }}>No games in this slice yet</Typography>
          <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled' }}>Records fill in as games go final.</Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap }}>
          {columns.map((col, ci) => (
            <Box key={ci} sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap }}>
              {col.map(b => loading && skeleton
                ? <React.Fragment key={b.key}>{skeleton(b)}</React.Fragment>
                : (
                  <SectionCard key={b.key} title={b.label}>
                    {b.rows.length === 0
                      ? <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled', py: 1 }}>Nothing here yet.</Typography>
                      : b.rows.map((r, i) => renderRow(r, i, b))}
                    {b.more > 0 && (
                      <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled', textAlign: 'center', pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                        And {b.more} more with {b.rows[b.rows.length - 1].display} {b.unit}
                      </Typography>
                    )}
                  </SectionCard>
                ))}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

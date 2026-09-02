import { useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { SectionCard, TeamBadge, FOCUS_RING, TAPPABLE } from './ui'
import { useWpblTeamLink } from './LinkContext'
import { headToHead } from './derive/matchups'
import type { WpblTeam, WpblGame, WpblStandingRow } from './types'

// Washes behind a cell rather than coloured text. The record is spelled out in the cell
// already, so the tint is pure reinforcement, which is what lets it be this quiet, and what
// keeps the grid readable for anyone who can't separate the two hues.
const CELL_WIN = 'rgba(34,197,94,0.15)'
const CELL_LOSS = 'rgba(239,68,68,0.15)'

/**
 * The four-by-four matchup grid: read a row across and you get how that club has fared
 * against each of the other three.
 *
 * This is the one artifact a four-team league can have and a thirty-team league cannot. Over
 * a 15-game season every club plays every other constantly, so a bare "4–3" hides the shape
 * of a record completely: a team can be unbeaten against two opponents and swept by the
 * third, and that is the thing worth knowing before the next meeting. Sixteen cells is the
 * entire league, and at four columns it fits a phone with no sideways scrolling.
 *
 * Rows are in standings order, matching the cards above, so the eye can carry a club from one
 * to the other. Built from the shared `headToHead` derivation over the `games` already in
 * memory, so no extra read.
 *
 * Deliberately no run differential in the cells. Across the two or three meetings a given
 * pair has had by midseason it is noise, and sixteen cells carrying two numbers each is more
 * ink than a phone can spend on a card whose whole job is to be scanned.
 */
export default function HeadToHead({ rows, games, onSelect, title = 'Head to head' }: {
  /** Clubs in the order they should appear, rows and columns alike. Callers pass their own
   *  standings rows so the grid always matches the order of whatever it sits under. */
  rows: WpblStandingRow[]
  games: WpblGame[]
  onSelect: (t: WpblTeam) => void
  title?: string
}) {
  const grid = useMemo(() => headToHead(games), [games])
  const teams = rows.map(r => r.team)
  const teamLink = useWpblTeamLink()

  const head = {
    fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 0.4,
    color: 'text.disabled', textAlign: 'center' as const, py: 0.5,
  }

  return (
    <SectionCard title={title} subtitle="Each row's record against the columns">
      {/* Capped on a wide screen, and LEFT-aligned rather than centred. The grid is sized by
          what a phone can hold, and the matrix reads as a block so it should stay block-shaped.
          Centring the capped block was worse than either: it split the leftover space either
          side and read as a mistake. Aligned left, it shares a margin with the card's own title
          and every pixel of slack lands in one place, which is whitespace rather than an
          accident.

          THE CAP WAS TOO TIGHT AND THE SLACK STOPPED READING AS A MARGIN. At 560 inside an
          898px card the grid held the left 62% and left 338px of nothing beside it, under a
          2x2 of team cards that fills the row above: not a margin, a void, and the eye reads
          the card as broken rather than as roomy. The old note worried that letting four cells
          share the width stretches each into empty wash, which is true at the full 858 and
          overstated before it. 780 puts a cell at 141px against 105, and 118px is left over,
          which is a margin again. The corner column widens with it so the labels keep their
          gutter and the four matchup columns stay even.

          Rows get their height back at the same breakpoint. Four cells 141px wide and 40 tall
          is a letterbox; the extra padding makes each nearer a square, which is the shape a
          matrix wants and the reason this is a grid rather than a list. */}
      <Box component="table" sx={{
        width: '100%', maxWidth: { xs: 'none', sm: 560, md: 780 },
        borderCollapse: 'separate', borderSpacing: '3px', tableLayout: 'fixed',
      }}>
        <Box component="thead">
          <Box component="tr">
            {/* Corner cell. Fixed so the four matchup columns split what's left evenly and
                every cell in the grid is the same width. Wider on a big screen, where the row
                labels spell the club out (see below). */}
            <Box component="th" sx={{ width: { xs: 58, sm: 124, md: 200 } }} />
            {teams.map(t => (
              <Box component="th" key={t.id} sx={head}>{t.abbr}</Box>
            ))}
          </Box>
        </Box>
        <Box component="tbody">
          {teams.map(rowTeam => (
            <Box component="tr" key={rowTeam.id}>
              <Box component="th" scope="row" sx={{ p: 0 }}>
                {/* The row label is also the way into that club's page: the badge is right
                    there, and a reader who has just spotted a 0–3 wants to go look. */}
                {/* The label is the second way into a club, and now the second crawlable one:
                    a reader who has just spotted an 0-3 wants to go and look. */}
                <Box {...teamLink(rowTeam, () => onSelect(rowTeam))} sx={{
                  ...FOCUS_RING,
                  display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer',
                  borderRadius: 1, py: 0.4, ...TAPPABLE,
                }}>
                  <TeamBadge team={rowTeam} size={20} />
                  {/* The abbreviation is all a phone can hold. A wide screen has room the
                      grid would otherwise spend on empty wash, so it gets the nickname
                      instead, which is also what the standings table above these rows uses.
                      Columns stay abbreviated in both: they are only as wide as a cell. */}
                  <Typography sx={{
                    fontSize: '0.62rem', fontWeight: 800, letterSpacing: 0.3, color: 'text.secondary',
                    display: { xs: 'block', sm: 'none' },
                  }}>
                    {rowTeam.abbr}
                  </Typography>
                  <Typography sx={{
                    fontSize: '0.78rem', fontWeight: 700, color: 'text.secondary', minWidth: 0,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    display: { xs: 'none', sm: 'block' },
                  }}>
                    {rowTeam.name}
                  </Typography>
                </Box>
              </Box>
              {teams.map(colTeam => {
                // The diagonal: a club has no record against itself, and leaving it blank is
                // what makes the grid read as a matrix rather than as a table with a hole.
                if (colTeam.id === rowTeam.id) {
                  return (
                    <Box component="td" key={colTeam.id} sx={{ textAlign: 'center', color: 'text.disabled', fontSize: '0.8rem', py: { xs: 0.75, md: 1.25 } }}>
                      —
                    </Box>
                  )
                }
                const c = grid.get(rowTeam.id, colTeam.id)
                const met = !!c && (c.wins + c.losses) > 0
                const ahead = met && c!.wins > c!.losses
                const behind = met && c!.wins < c!.losses
                return (
                  <Box
                    component="td"
                    key={colTeam.id}
                    sx={{
                      textAlign: 'center', py: { xs: 0.75, md: 1.25 }, borderRadius: 1,
                      bgcolor: ahead ? CELL_WIN : behind ? CELL_LOSS : met ? 'action.hover' : 'transparent',
                    }}
                  >
                    <Typography sx={{
                      fontSize: '0.82rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                      color: met ? 'text.primary' : 'text.disabled',
                    }}>
                      {/* An unplayed pairing is a dot, not "0–0": the two look identical at a
                          glance and mean opposite things (nobody has won vs they split). */}
                      {met ? `${c!.wins}–${c!.losses}` : '·'}
                    </Typography>
                  </Box>
                )
              })}
            </Box>
          ))}
        </Box>
      </Box>
    </SectionCard>
  )
}

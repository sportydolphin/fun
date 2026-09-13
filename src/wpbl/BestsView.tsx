import { useMemo } from 'react'
import { Box, Typography, useMediaQuery, useTheme } from '@mui/material'
import { wpblBestGames, type WpblBestBoard } from './derive/bests'
import { wpblAccentFg } from './constants'
import { SectionCard, BOARD_COLUMN, BOARD_COLUMN_WIDE, TYPE_SCALE, useWpblDark } from './ui'
import GameLineRow from './GameLineRow'
import { scopedGames, type SeasonScope } from './season'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer } from './types'

// The Bests board: the best single game anyone had, by each of a handful of measures.
//
// It sits beside Players and Teams on the Stats tab because it answers a question those two
// cannot. The season table ranks people by what they accumulated; this ranks INDIVIDUAL
// NIGHTS, which is what a record book is and what a fan actually asks out loud ("what is the
// most strikeouts anyone has thrown in a game"). Nothing in the section answered that before.
//
// THE ARITHMETIC IS ALL IN derive/bests.ts, which is also where the reasoning about what is
// ranked and what is deliberately missing lives. The ROW is in GameLineRow.tsx, shared with the
// Find board, which asks a different question and returns the same kind of answer. What is left
// here is the layout.
//
// IT COSTS NO FETCH. StatsView already holds every box-score line in the league and every
// player, both cached app-wide, and a line carries its own `game_id`. So this board is a sort
// over arrays that were on the page the moment the tab opened; it takes no props it did not
// already have and adds no request, no table and no column.

function BoardCard({ board, accent, onOpenPlayer, onOpenGame }: {
  board: WpblBestBoard
  accent: string
  onOpenPlayer?: (p: WpblPlayer) => void
  onOpenGame?: (g: WpblGame) => void
}) {
  return (
    <SectionCard title={board.label}>
      {board.rows.length === 0
        ? (
          <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled', py: 1 }}>
            Nothing here yet.
          </Typography>
        )
        : board.rows.map((r, i) => (
          <GameLineRow key={r.key} rank={r.rank} name={r.name} player={r.player} teamId={r.teamId}
            game={r.game} detail={r.detail} value={r.display} unit={board.unit} accent={accent}
            divider={i > 0} compactDate onOpenPlayer={onOpenPlayer} onOpenGame={onOpenGame} />
        ))}
    </SectionCard>
  )
}

export default function WpblBestsView({
  side, players, batting, pitching, games, scope, onOpenPlayer, onOpenGame,
}: {
  side: 'hitting' | 'pitching'
  players: WpblPlayer[]
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
  games: WpblGame[]
  scope: SeasonScope
  onOpenPlayer?: (p: WpblPlayer) => void
  /** The board's second destination, and the reason StatsView had to start taking one: every
   *  other board on the tab opens a person, and this one opens the NIGHT as well. */
  onOpenGame?: (g: WpblGame) => void
}) {
  const isDark = useWpblDark()
  const accent = wpblAccentFg(isDark)
  const theme = useTheme()
  // Two columns only where the layout below actually splits into two. `noSsr` because this is a
  // client-only SPA and the default would render the one-column branch first and then jump.
  const twoCol = useMediaQuery(theme.breakpoints.up('lg'), { noSsr: true })
  const boards = useMemo(
    () => wpblBestGames(side, batting, pitching, players, games, scope),
    [side, batting, pitching, players, games, scope])
  // Even boards down the left, odd down the right: the same pairing the grid produced, but as two
  // INDEPENDENT columns. A CSS grid locks each row to the height of its taller card, so a short
  // board sitting beside a tall one grew a gap under it to the next row; stacking each column on
  // its own lets the cards butt straight up against each other. The split is desktop-only, so the
  // single-column phone view keeps the natural board order rather than reading all-lefts-then-rights.
  const columns = useMemo(() => {
    if (!twoCol) return [boards]
    const left: WpblBestBoard[] = []
    const right: WpblBestBoard[] = []
    boards.forEach((b, i) => (i % 2 === 0 ? left : right).push(b))
    return [left, right]
  }, [boards, twoCol])

  const anyRows = boards.some(b => b.rows.length > 0)
  // THE COUNT HAS TO BE THE SCOPED ONE. The sentence under the tabs says how many games these
  // records are drawn from, and on Playoffs that is four, not the season's thirty-four: a
  // playoff record book under a line claiming the whole season is the page contradicting
  // itself, and the two slices are exactly the case where nobody would think to check.
  const finals = useMemo(
    () => scopedGames(games.filter(g => g.status === 'final'), scope).length, [games, scope])
  const gamesWord = scope === 'regular' ? 'regular-season games'
    : scope === 'postseason' ? 'playoff games'
    : 'games'

  if (!anyRows) {
    return (
      <Box sx={{ textAlign: 'center', py: 5, px: 2, color: 'text.secondary' }}>
        <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700, mb: 0.5 }}>No games in this slice yet</Typography>
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled' }}>
          Records fill in as games go final.
        </Typography>
      </Box>
    )
  }

  return (
    /* CAPPED AND CENTRED inside the full-bleed box StatsView puts this board in, and two
       columns on a large desktop, for the same reasons written out on RunValueView: a list has
       nothing to spend width on, but six lists queued in one column on a 1780px screen is half
       a screen of nothing down each side. Below `lg` it is one column, and below `sm` the cap
       never binds at all, since the bleed is the wider of the two there. */
    <Box sx={{
      display: 'flex', flexDirection: 'column', gap: { xs: 1.5, sm: 2 },
      maxWidth: { xs: BOARD_COLUMN, lg: BOARD_COLUMN_WIDE }, mx: 'auto',
    }}>
      {/* ONE SENTENCE, NO HEADING, AND NO PER-CARD SUBTITLE. The board tab above says "Bests"
          already, and the card titles ("Total bases", "Strikeouts") say what each measures. The
          one thing none of those carry is that these are single GAMES, because every other board
          on the tab is a season total and a reader arriving on a column of small numbers will
          read them as one: this line's whole job is to say that once, up front. The game count is
          the other half, since a record out of 30 games is a different thing from one out of 300. */}
      <Box sx={{ maxWidth: '70ch' }}>
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', lineHeight: 1.5 }}>
          Single-game totals, not season totals{finals > 0 ? `, from ${finals} ${gamesWord} so far` : ''}.
        </Typography>
      </Box>

      <Box sx={{
        display: 'flex', alignItems: 'flex-start',
        gap: { xs: 1.5, sm: 2 },
      }}>
        {columns.map((col, ci) => (
          <Box key={ci} sx={{
            flex: 1, minWidth: 0,
            display: 'flex', flexDirection: 'column', gap: { xs: 1.5, sm: 2 },
          }}>
            {col.map(b => (
              <BoardCard key={b.key} board={b} accent={accent}
                onOpenPlayer={onOpenPlayer} onOpenGame={onOpenGame} />
            ))}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

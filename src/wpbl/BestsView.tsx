import { useDark } from '../ui/useDark'
import { useMemo } from 'react'
import { wpblBestGames } from './derive/bests'
import { wpblAccentFg } from './constants'
import { BestsBoards } from '../ui/bestsBoards'
import GameLineRow from './GameLineRow'
import { scopedGames, type SeasonScope } from './season'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer } from './types'

// The Bests board: the best single game anyone had, by each of a handful of measures.
//
// It sits beside Players and Teams on the Stats tab because it answers a question those two
// cannot. The season table ranks people by what they accumulated; this ranks INDIVIDUAL
// NIGHTS, which is what a record book is and what a fan actually asks out loud ("what is the
// most strikeouts anyone has thrown in a game").
//
// THE ARITHMETIC IS ALL IN derive/bests.ts, which is also where the reasoning about what is
// ranked and what is deliberately missing lives. The layout is src/ui/bestsBoards.tsx and the row
// src/ui/gameLine.tsx, both shared with MLB's board. What is left here is WPBL's own inputs.
//
// IT COSTS NO FETCH. StatsView already holds every box-score line in the league and every
// player, both cached app-wide, and a line carries its own `game_id`. So this board is a sort
// over arrays that were on the page the moment the tab opened; it takes no props it did not
// already have and adds no request, no table and no column.

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
  const isDark = useDark()
  const accent = wpblAccentFg(isDark)
  const boards = useMemo(
    () => wpblBestGames(side, batting, pitching, players, games, scope),
    [side, batting, pitching, players, games, scope])
  // THE COUNT HAS TO BE THE SCOPED ONE. The sentence under the tabs says how many games these
  // records are drawn from, and on Playoffs that is four, not the season's thirty-four: a
  // playoff record book under a line claiming the whole season is the page contradicting
  // itself, and the two slices are exactly the case where nobody would think to check.
  const finals = useMemo(
    () => scopedGames(games.filter(g => g.status === 'final'), scope).length, [games, scope])
  const gamesWord = scope === 'regular' ? 'regular-season games'
    : scope === 'postseason' ? 'playoff games'
    : 'games'

  return (
    <BestsBoards boards={boards} finals={finals} gamesWord={gamesWord}
      renderRow={(r, i, b) => (
        <GameLineRow key={r.key} rank={r.rank} name={r.name} player={r.player} teamId={r.teamId}
          game={r.game} detail={r.detail} value={r.display} unit={b.unit} accent={accent}
          divider={i > 0} compactDate onOpenPlayer={onOpenPlayer} onOpenGame={onOpenGame} />
      )} />
  )
}

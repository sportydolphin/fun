import { useMemo } from 'react'
import { runWpblFinder, type FinderQuery, type FinderSide } from './derive/finder'
import { wpblAccentFg, wpblFullName } from './constants'
import { PlayerPortrait, TeamBadge, useWpblDark, useWpblName } from './ui'
import { useWpblPlayerLink } from './LinkContext'
import { FinderBoard } from '../ui/finderBoard'
import { PORTRAIT_PX } from '../ui/leaders'
import GameLineRow from './GameLineRow'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblTeam } from './types'

// The Find board: every game line in the league that matches what you asked for.
//
// WHY IT EXISTS. Every other board answers a question somebody thought to put on a board. This
// answers the ones nobody did, which is most of them: how often has anyone struck out five in a
// game, who has gone four for four more than once, has a pitcher ever walked nobody through
// five. Without it the only way to settle one of those is to read thirty box scores.
//
// THE ENGINE IS src/league/finder.ts, with the reasoning about what can be asked, why every
// condition is AND, and why the query encodes into one query param rather than seven. The board is
// src/ui/finderBoard.tsx, shared with MLB's; what is here is WPBL's own inputs and parts.
//
// IT COSTS NO FETCH, for the same reason the Bests board does not: the season's ~750 box-score
// lines are already in memory when this tab opens. Baseball Reference built Stathead because
// MLB has millions of these and no browser can sort them; at this league's size the query engine
// is a filter and a sort, which is why this is a board rather than a backend.

export default function WpblFindView({
  side, teams, players, batting, pitching, games, query, onQuery, onOpenPlayer, onOpenGame,
}: {
  side: FinderSide
  teams: WpblTeam[]
  players: WpblPlayer[]
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
  games: WpblGame[]
  /** Owned by StatsView, which mirrors the conditions into the address bar. */
  query: FinderQuery
  onQuery: (q: FinderQuery) => void
  onOpenPlayer?: (p: WpblPlayer) => void
  onOpenGame?: (g: WpblGame) => void
}) {
  const isDark = useWpblDark()
  const accent = wpblAccentFg(isDark)
  const shortName = useWpblName(18)
  const playerLink = useWpblPlayerLink()
  const result = useMemo(
    () => runWpblFinder(side, batting, pitching, players, games, query),
    [side, batting, pitching, players, games, query])
  const clubs = useMemo(
    () => [...teams].sort((a, b) => a.abbr.localeCompare(b.abbr)).map(t => ({ value: t.id, label: wpblFullName(t) })),
    [teams])

  return (
    <FinderBoard side={side} query={query} onQuery={onQuery} result={result} clubs={clubs}
      clubAbbr={id => teams.find(t => t.id === id)?.abbr ?? id}
      intro="Search every box-score line for the games that match."
      renderRow={(r, i, unit) => (
        <GameLineRow key={r.key} rank={i + 1} name={r.name} player={r.player}
          teamId={r.teamId} game={r.game} detail={r.detail}
          value={r.headlineDisplay} unit={unit} accent={accent} divider={i > 0}
          nameOpens="game" compactDate emphasizeRank={false}
          onOpenPlayer={onOpenPlayer} onOpenGame={onOpenGame} />
      )}
      tallyParts={t => ({
        key: t.player?.id ?? t.name,
        name: shortName(t.name),
        portrait: <PlayerPortrait name={t.name} teamId={t.teamId} size={PORTRAIT_PX} />,
        badge: t.teamId ? <TeamBadge team={{ id: t.teamId, abbr: t.teamId }} size={16} /> : undefined,
        linkProps: t.player ? playerLink(t.player, onOpenPlayer) : undefined,
      })} />
  )
}

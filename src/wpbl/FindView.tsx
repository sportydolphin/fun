import { useDark } from '../ui/useDark'
import { useMemo, useState } from 'react'
import { runWpblFinder, validFinderSort, type FinderQuery, type FinderSide, type FinderSort } from './derive/finder'
import { wpblAccentFg, wpblFullName } from './constants'
import { PlayerPortrait, TeamBadge } from './ui'
import { useWpblGameLink, useWpblPlayerLink } from './LinkContext'
import { FinderBoard, type FinderExample } from '../ui/finderBoard'
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

// THE ONE-TAP QUESTIONS, in a seven-inning league's terms: a long start here is five or six innings,
// where MLB's are seven or eight. Innings are in outs, as every stored innings value is.
const EXAMPLES: Record<FinderSide, FinderExample[]> = {
  pitching: [
    { label: '8+ strikeouts', conditions: [{ field: 'so', op: 'gte', value: 8 }] },
    { label: '5+ IP, no walks', conditions: [{ field: 'ip', op: 'gte', value: 15 }, { field: 'bb', op: 'eq', value: 0 }] },
    { label: '6+ IP, no runs', conditions: [{ field: 'ip', op: 'gte', value: 18 }, { field: 'r', op: 'eq', value: 0 }] },
    { label: '3+ IP, no hits', conditions: [{ field: 'ip', op: 'gte', value: 9 }, { field: 'h', op: 'eq', value: 0 }] },
    { label: '2+ wild pitches', conditions: [{ field: 'wp', op: 'gte', value: 2 }] },
  ],
  hitting: [
    { label: '3-hit games', conditions: [{ field: 'h', op: 'gte', value: 3 }] },
    { label: 'Multi-homer games', conditions: [{ field: 'hr', op: 'gte', value: 2 }] },
    { label: '4+ RBI', conditions: [{ field: 'rbi', op: 'gte', value: 4 }] },
    { label: '2+ steals', conditions: [{ field: 'sb', op: 'gte', value: 2 }] },
    { label: 'On base 4+ times', conditions: [{ field: 'ob', op: 'gte', value: 4 }] },
  ],
}

/** Under the toolbar and the Stats controls bar, both pinned: StatsView's BOARD_TOP, which this
 *  lazy chunk cannot import without importing StatsView itself. */
const STICKY_TOP = 'calc(var(--app-header-h, 0px) + var(--wpbl-stats-bar-h, 0px))'

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
  const isDark = useDark()
  const accent = wpblAccentFg(isDark)
  const playerLink = useWpblPlayerLink()
  const gameLink = useWpblGameLink()
  // The table's column sort. Here rather than in the board because the engine sorts before it caps
  // at fifty; not on the address, since it is how a reader looks at an answer, not the question.
  const [sortPick, setSort] = useState<FinderSort | null>(null)
  const sort = validFinderSort(side, query, sortPick)
  const result = useMemo(
    () => runWpblFinder(side, batting, pitching, players, games, query, 50, sort),
    [side, batting, pitching, players, games, query, sort])
  const clubs = useMemo(
    () => [...teams].sort((a, b) => a.abbr.localeCompare(b.abbr)).map(t => ({ value: t.id, label: wpblFullName(t) })),
    [teams])

  return (
    <FinderBoard side={side} query={query} onQuery={onQuery} result={result} clubs={clubs}
      clubAbbr={id => teams.find(t => t.id === id)?.abbr ?? id}
      intro="Search every box-score line for the games that match."
      sort={sort} onSort={setSort} examples={EXAMPLES[side]} stickyTop={STICKY_TOP}
      renderRow={(r, i, unit) => (
        <GameLineRow key={r.key} rank={i + 1} name={r.name} player={r.player}
          teamId={r.teamId} game={r.game} detail={r.detail}
          value={r.headlineDisplay} unit={unit} accent={accent} divider={i > 0}
          nameOpens="game" compactDate emphasizeRank={false}
          onOpenPlayer={onOpenPlayer} onOpenGame={onOpenGame} />
      )}
      rowParts={r => ({
        portrait: <PlayerPortrait name={r.name} teamId={r.teamId} size={PORTRAIT_PX} />,
        club: r.teamId ? <TeamBadge team={{ id: r.teamId, abbr: r.teamId }} size={16} /> : undefined,
        playerLink: r.player ? playerLink(r.player, onOpenPlayer) : undefined,
        gameLink: r.game ? gameLink(r.game, onOpenGame) : undefined,
      })}
      tallyParts={t => ({
        key: t.player?.id ?? t.name,
        name: t.name,
        portrait: <PlayerPortrait name={t.name} teamId={t.teamId} size={PORTRAIT_PX} />,
        badge: t.teamId ? <TeamBadge team={{ id: t.teamId, abbr: t.teamId }} size={16} /> : undefined,
        linkProps: t.player ? playerLink(t.player, onOpenPlayer) : undefined,
      })} />
  )
}

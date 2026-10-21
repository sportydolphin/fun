import { useDark } from '../ui/useDark'
import { useMemo, useState } from 'react'
import { runWpblFinder, validFinderSort, type FinderBoardSide, type FinderQuery, type FinderSort } from './derive/finder'
import { wpblAccentFg, wpblFullName } from './constants'
import { PlayerPortrait, TeamBadge } from './ui'
import { useWpblGameLink, useWpblPlayerLink } from './LinkContext'
import { FinderBoard, type FinderExample, type FinderReading } from '../ui/finderBoard'
import { PORTRAIT_PX } from '../ui/leaders'
import { parseFinderText } from '../league/finderParse'
import { navigate } from '../nav'
import GameLineRow from './GameLineRow'
import { useEraBasis } from './EraBasisContext'
import { WPBL_FINDER_CLUBS, WPBL_FINDER_SIDES, wpblFinderHref } from './finderLink'
import { wpblQualifiers } from './stats'
import type { WpblBattingLine, WpblFieldingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblTeam } from './types'

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
// where MLB's are seven or eight, and a season is thirty games, so its counts are a fifth of MLB's.
// Innings are in outs and rates in their last printed digit, as the engine stores both.
const EXAMPLES: Record<FinderBoardSide, FinderExample[]> = {
  pitching: [
    { label: '8+ strikeouts', conditions: [{ field: 'so', op: 'gte', value: 8 }] },
    { label: '5+ IP, no walks', conditions: [{ field: 'ip', op: 'gte', value: 15 }, { field: 'bb', op: 'eq', value: 0 }] },
    { label: '6+ IP, no runs', conditions: [{ field: 'ip', op: 'gte', value: 18 }, { field: 'r', op: 'eq', value: 0 }] },
    { label: '3+ IP, no hits', conditions: [{ field: 'ip', op: 'gte', value: 9 }, { field: 'h', op: 'eq', value: 0 }] },
    { label: '2+ wild pitches', conditions: [{ field: 'wp', op: 'gte', value: 2 }] },
    { per: 'season', label: 'ERA under 3.00', conditions: [{ field: 'era', op: 'lte', value: 299 }] },
    { per: 'season', label: 'WHIP under 1.20', conditions: [{ field: 'whip', op: 'lte', value: 119 }] },
    { per: 'season', label: '4+ wins', conditions: [{ field: 'w', op: 'gte', value: 4 }] },
    { per: 'season', label: '30+ strikeouts', conditions: [{ field: 'so', op: 'gte', value: 30 }] },
    { per: 'season', label: '30+ innings', conditions: [{ field: 'ip', op: 'gte', value: 90 }] },
  ],
  hitting: [
    { label: '3-hit games', conditions: [{ field: 'h', op: 'gte', value: 3 }] },
    { label: 'Multi-homer games', conditions: [{ field: 'hr', op: 'gte', value: 2 }] },
    { label: '4+ RBI', conditions: [{ field: 'rbi', op: 'gte', value: 4 }] },
    { label: '2+ steals', conditions: [{ field: 'sb', op: 'gte', value: 2 }] },
    { label: 'On base 4+ times', conditions: [{ field: 'ob', op: 'gte', value: 4 }] },
    { per: 'season', label: '.300 hitters', conditions: [{ field: 'avg', op: 'gte', value: 300 }] },
    { per: 'season', label: '.900+ OPS', conditions: [{ field: 'ops', op: 'gte', value: 900 }] },
    { per: 'season', label: '3+ home runs', conditions: [{ field: 'hr', op: 'gte', value: 3 }] },
    { per: 'season', label: '10+ steals', conditions: [{ field: 'sb', op: 'gte', value: 10 }] },
  ],
  // A fielding line exists only for a night with a play to make, so "no errors" alone would be most
  // of them: it is asked with a busy night beside it.
  fielding: [
    { label: '2+ errors', conditions: [{ field: 'e', op: 'gte', value: 2 }] },
    { label: '12+ putouts', conditions: [{ field: 'po', op: 'gte', value: 12 }] },
    { label: '5+ assists', conditions: [{ field: 'a', op: 'gte', value: 5 }] },
    { label: '2+ double plays', conditions: [{ field: 'dp', op: 'gte', value: 2 }] },
    { label: '8+ chances, no errors', conditions: [{ field: 'tc', op: 'gte', value: 8 }, { field: 'e', op: 'eq', value: 0 }] },
    { per: 'season', label: 'Errorless seasons', conditions: [{ field: 'e', op: 'eq', value: 0 }, { field: 'tc', op: 'gte', value: 30 }] },
    { per: 'season', label: '.980+ fielding', conditions: [{ field: 'fpct', op: 'gte', value: 980 }] },
    { per: 'season', label: '5+ errors', conditions: [{ field: 'e', op: 'gte', value: 5 }] },
    { per: 'season', label: '10+ double plays', conditions: [{ field: 'dp', op: 'gte', value: 10 }] },
  ],
}

/** Under the toolbar and the Stats controls bar, both pinned: StatsView's BOARD_TOP, which this
 *  lazy chunk cannot import without importing StatsView itself. */
const STICKY_TOP = 'calc(var(--app-header-h, 0px) + var(--wpbl-stats-bar-h, 0px))'

export default function WpblFindView({
  side, teams, players, batting, pitching, fielding, games, query, onQuery, onOpenPlayer, onOpenGame,
}: {
  side: FinderBoardSide
  teams: WpblTeam[]
  players: WpblPlayer[]
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
  /** Read only for the Fielding side; empty until StatsView's fielding read lands. */
  fielding: WpblFieldingLine[]
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
  // A season's ERA on the basis the reader has the site set to, so a number here matches the one
  // beside it on every other board. The bar for a rate is the leaderboards' own (wpblQualifiers),
  // over the schedule on screen, which StatsView has already cut to one year.
  const { basis: eraInnings } = useEraBasis()
  const qualify = useMemo(() => {
    const q = wpblQualifiers(teams, games, query.scope)
    return q.active ? { minPa: q.minPa, minOuts: q.minOuts, minG: q.minG } : null
  }, [teams, games, query.scope])
  const result = useMemo(
    () => runWpblFinder(side, batting, pitching, players, games, query, 50, sort, { eraInnings, qualify, fielding }),
    [side, batting, pitching, fielding, players, games, query, sort, eraInnings, qualify])
  // A reading on this side is asked in place, which keeps the season and slice on screen; one on
  // the other side goes through the address, the way the search box sends it, since the side is
  // StatsView's to switch.
  const onAsk = (r: FinderReading) => {
    if (r.side === side) onQuery({ ...query, per: r.per, conditions: r.conditions, teamId: r.teamId, oppId: r.oppId, venue: r.venue })
    else navigate(wpblFinderHref(r))
  }
  const clubs = useMemo(
    () => [...teams].sort((a, b) => a.abbr.localeCompare(b.abbr)).map(t => ({ value: t.id, label: wpblFullName(t) })),
    [teams])

  return (
    <FinderBoard side={side} query={query} onQuery={onQuery} result={result} clubs={clubs}
      clubAbbr={id => teams.find(t => t.id === id)?.abbr ?? id}
      intro="Search every box-score line for the games that match."
      sort={sort} onSort={setSort} examples={EXAMPLES[side]} stickyTop={STICKY_TOP} accent={accent}
      parse={text => parseFinderText(text, WPBL_FINDER_CLUBS, WPBL_FINDER_SIDES)} onAsk={onAsk}
      renderRow={(r, i, unit) => (
        <GameLineRow key={r.key} rank={i + 1} name={r.name} player={r.player}
          teamId={r.teamId} game={r.game} detail={r.detail}
          value={r.headlineDisplay} unit={unit} accent={accent} divider={i > 0}
          nameOpens="game" emphasizeRank={false}
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

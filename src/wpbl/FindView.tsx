import { useDark } from '../ui/useDark'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { runWpblFinder, validFinderSort, type FinderBoardSide, type FinderQuery, type FinderSort } from './derive/finder'
import { conditionsForPer, type FinderPer, type FinderRow } from '../league/finder'
import { requestPlay } from './entryUrl'
import { inningPitchingLines, plateAppearanceLines, teamInningLines } from '../league/inningLines'
import { WPBL_LEAGUE } from './league'
import { fetchWpblPlayLog, getCachedWpblPlayLog } from './api/plays'
import { useWpblSeason } from './SeasonContext'
import { wpblAccentFg, wpblFullName } from './constants'
import { PlayerPortrait, TeamBadge } from './ui'
import { useWpblGameLink, useWpblPlayerLink } from './LinkContext'
import { FinderBoard, type FinderExample, type FinderReading } from '../ui/finderBoard'
import { PORTRAIT_PX } from '../ui/leaders'
import { parseFinderText } from '../league/finderParse'
import { navigate } from '../nav'
import GameLineRow from './GameLineRow'
import { useEraBasis } from './EraBasisContext'
import { WPBL_FINDER_CLUBS, WPBL_FINDER_OPTS, WPBL_FINDER_SIDES, wpblFinderHref } from './finderLink'
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
    { per: 'inning', label: '3+ strikeouts', conditions: [{ field: 'so', op: 'gte', value: 3 }] },
    { per: 'inning', label: 'Immaculate', conditions: [{ field: 'so', op: 'gte', value: 3 }, { field: 'pitches', op: 'lte', value: 9 }] },
    { per: 'inning', label: '1-2-3', conditions: [{ field: 'bf', op: 'eq', value: 3 }, { field: 'outs', op: 'eq', value: 3 }, { field: 'baserunners', op: 'eq', value: 0 }] },
    { per: 'inning', label: '3+ runs', conditions: [{ field: 'r', op: 'gte', value: 3 }] },
    { per: 'inning', label: '25+ pitches', conditions: [{ field: 'pitches', op: 'gte', value: 25 }] },
    { per: 'pa', label: '10+ pitches', conditions: [{ field: 'pitches', op: 'gte', value: 10 }] },
    { per: 'pa', label: 'Strikeout on 3-2', conditions: [{ field: 'so', op: 'gte', value: 1 }, { field: 'balls', op: 'eq', value: 3 }, { field: 'scount', op: 'eq', value: 2 }] },
    { per: 'pa', label: 'Bases-loaded walks', conditions: [{ field: 'bb', op: 'gte', value: 1 }, { field: 'on', op: 'eq', value: 3 }] },
    { per: 'pa', label: 'Home runs on 0-2', conditions: [{ field: 'hr', op: 'gte', value: 1 }, { field: 'balls', op: 'eq', value: 0 }, { field: 'scount', op: 'eq', value: 2 }] },
    { per: 'pa', label: 'Walk-offs', conditions: [{ field: 'walkoff', op: 'eq', value: 1 }] },
    { per: 'pa', label: '9+ retired in a row', conditions: [{ field: 'retired', op: 'gte', value: 9 }] },
    { per: 'pa', label: '3+ strikeouts in a row', conditions: [{ field: 'krow', op: 'gte', value: 3 }] },
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
    { per: 'inning', label: '4+ run innings', conditions: [{ field: 'r', op: 'gte', value: 4 }] },
    { per: 'inning', label: 'Comebacks', conditions: [{ field: 'trail', op: 'gte', value: 1 }, { field: 'tooklead', op: 'eq', value: 1 }] },
    { per: 'inning', label: 'Two-out rallies', conditions: [{ field: 'r2', op: 'gte', value: 2 }] },
    { per: 'inning', label: '2+ home runs', conditions: [{ field: 'hr', op: 'gte', value: 2 }] },
    { per: 'pa', label: '10+ pitches', conditions: [{ field: 'pitches', op: 'gte', value: 10 }] },
    { per: 'pa', label: 'Home runs on 0-2', conditions: [{ field: 'hr', op: 'gte', value: 1 }, { field: 'balls', op: 'eq', value: 0 }, { field: 'scount', op: 'eq', value: 2 }] },
    { per: 'pa', label: 'Bases-loaded hits', conditions: [{ field: 'h', op: 'gte', value: 1 }, { field: 'on', op: 'eq', value: 3 }] },
    { per: 'pa', label: 'Hits with RISP', conditions: [{ field: 'h', op: 'gte', value: 1 }, { field: 'risp', op: 'eq', value: 1 }] },
    { per: 'pa', label: '2-out run-scoring hits', conditions: [{ field: 'h', op: 'gte', value: 1 }, { field: 'paouts', op: 'eq', value: 2 }, { field: 'runs', op: 'gte', value: 1 }] },
    { per: 'pa', label: 'Walk-offs', conditions: [{ field: 'walkoff', op: 'eq', value: 1 }] },
    { per: 'pa', label: 'Back-to-back home runs', conditions: [{ field: 'hrrow', op: 'gte', value: 2 }] },
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

/** The grains each side can be asked at. An inning is a pitcher's on Pitching and a club's turn at the
 *  plate on Hitting; a plate appearance has no fielder. */
const GRAINS: Record<FinderBoardSide, FinderPer[]> = {
  hitting: ['game', 'inning', 'pa', 'season'],
  pitching: ['game', 'inning', 'pa', 'season'],
  fielding: ['game', 'season'],
}

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
  // THE PLAY-LOG GRAINS ARE THE ONE QUESTION HERE THAT COSTS A READ: a pitcher's half-innings and
  // every plate appearance are built from the play log, which this board otherwise never touches, so
  // it is read only once one of them is asked for, one season of it (fetchWpblPlayLog), and held with
  // the season it was read for so a year picked from the menu reads again rather than cutting the old
  // year to nothing.
  const { season, cut } = useWpblSeason()
  const grains = GRAINS[side]
  const askInnings = query.per === 'inning' && grains.includes('inning')
  const askPas = query.per === 'pa' && grains.includes('pa')
  // Switched to a side without the grain on screen (Fielding has neither, Hitting has no innings),
  // the board would have no grain lit and an empty list. The question goes back to single games,
  // keeping what that grain can ask.
  useEffect(() => {
    if (!grains.includes(query.per)) onQuery({ ...query, per: 'game', conditions: conditionsForPer(side, 'game', query.conditions) })
  }, [grains, side, query, onQuery])
  const [playRead, setPlayRead] = useState(() => ({ season, plays: getCachedWpblPlayLog(season) }))
  const plays = playRead.season === season ? playRead.plays : null
  const askPlays = askInnings || askPas
  useEffect(() => {
    if (!askPlays || plays) return
    let cancelled = false
    // An empty log on failure, so the board says it found nothing rather than spinning for good.
    fetchWpblPlayLog(season).then(p => { if (!cancelled) setPlayRead({ season, plays: p }) })
      .catch(() => { if (!cancelled) setPlayRead({ season, plays: [] }) })
    return () => { cancelled = true }
  }, [askPlays, plays, season])
  const innings = useMemo(
    () => (askInnings && side === 'pitching' && plays ? inningPitchingLines(WPBL_LEAGUE, cut(plays), games) : undefined),
    [askInnings, side, plays, cut, games])
  const teamInnings = useMemo(
    () => (askInnings && side === 'hitting' && plays ? teamInningLines(WPBL_LEAGUE, cut(plays), games) : undefined),
    [askInnings, side, plays, cut, games])
  // Hitting by the inning is a club's half-inning, so its rows and its tally are clubs, not players.
  const clubRows = side === 'hitting' && query.per === 'inning'
  // THE NICKNAME, NOT THE FULL NAME: every name column here steps a name down the way it does a
  // person's, so "Los Angeles Queens" came out "L. Queens", which reads as a player. One word has no
  // stage to step to, and four clubs never share a nickname.
  const clubName = useCallback((id: string) => teams.find(x => x.id === id)?.name ?? id, [teams])
  const plateAppearances = useMemo(
    () => (askPas && plays ? plateAppearanceLines(WPBL_LEAGUE, cut(plays), games) : undefined),
    [askPas, plays, cut, games])
  const result = useMemo(
    () => runWpblFinder(side, batting, pitching, players, games, query, 50, sort, { eraInnings, qualify, fielding, innings, plateAppearances, teamInnings, clubName }),
    [side, batting, pitching, fielding, players, games, query, sort, eraInnings, qualify, innings, plateAppearances, teamInnings, clubName])
  // THE EXAMPLES' COUNTS, for the board before a question: each one run in the scope on screen. A
  // play-log example counts only once the log is in hand (cached, or read for a play-log grain),
  // since the start screen must not cost the read the play-log grains are careful to defer.
  const startScreen = query.conditions.length === 0
  const countPlays = startScreen ? plays : null
  const exInnings = useMemo(
    () => innings ?? (countPlays && side === 'pitching' ? inningPitchingLines(WPBL_LEAGUE, cut(countPlays), games) : undefined),
    [innings, countPlays, side, cut, games])
  const exTeamInnings = useMemo(
    () => teamInnings ?? (countPlays && side === 'hitting' ? teamInningLines(WPBL_LEAGUE, cut(countPlays), games) : undefined),
    [teamInnings, countPlays, side, cut, games])
  const exPas = useMemo(
    () => plateAppearances ?? (countPlays && side !== 'fielding' ? plateAppearanceLines(WPBL_LEAGUE, cut(countPlays), games) : undefined),
    [plateAppearances, countPlays, side, cut, games])
  const exampleCounts = useMemo(() => {
    if (!startScreen) return null
    const opts = { eraInnings, qualify, fielding, innings: exInnings, plateAppearances: exPas, teamInnings: exTeamInnings, clubName }
    return new Map(EXAMPLES[side].map(ex => {
      const per = ex.per ?? 'game'
      const missing = (per === 'pa' && !exPas) || (per === 'inning' && !(side === 'pitching' ? exInnings : exTeamInnings))
      return [ex.label, missing ? null : runWpblFinder(side, batting, pitching, players, games, { ...query, per, conditions: ex.conditions }, 0, null, opts).total]
    }))
  }, [startScreen, side, batting, pitching, players, games, query, eraInnings, qualify, fielding, exInnings, exPas, exTeamInnings, clubName])
  const exampleHref = (ex: FinderExample) => wpblFinderHref({
    side, per: ex.per ?? 'game', conditions: ex.conditions, teamId: query.teamId, oppId: query.oppId, venue: query.venue, ignored: [], season,
  })
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
  // AN INNING ROW OPENS ITS INNING, not the top of the game: the answer to "three strikeouts in an
  // inning" is those three at-bats. In the app the play is handed to Game Center (requestPlay); a
  // new tab gets it as the `#play-N` fragment a link to one at-bat already uses.
  const openRowGame = (r: FinderRow<WpblPlayer, WpblGame>) => (r.inning
    ? (g: WpblGame) => { requestPlay(g.id, r.inning!.sequence); onOpenGame?.(g) }
    : onOpenGame)
  const rowGameLink = (r: FinderRow<WpblPlayer, WpblGame>) => {
    const link = gameLink(r.game, openRowGame(r))
    return r.inning && link.href ? { ...link, href: `${link.href}#play-${r.inning.sequence}` } : link
  }

  return (
    <FinderBoard side={side} query={query} onQuery={onQuery} result={result} clubs={clubs}
      clubAbbr={id => teams.find(t => t.id === id)?.abbr ?? id}
      sort={sort} onSort={setSort} examples={EXAMPLES[side]} stickyTop={STICKY_TOP} accent={accent}
      exampleCount={ex => exampleCounts?.get(ex.label) ?? null} exampleHref={exampleHref}
      exampleCounted={plays || askPlays ? grains : ['game', 'season']}
      grains={grains} loading={askPlays && !plays}
      parse={text => parseFinderText(text, WPBL_FINDER_CLUBS, WPBL_FINDER_SIDES, WPBL_FINDER_OPTS)} onAsk={onAsk}
      renderRow={(r, i, unit, rank) => (
        <GameLineRow key={r.key} rank={rank.rank} tied={rank.tied} name={r.name} player={r.player}
          teamId={r.teamId} game={r.game} detail={r.detail}
          value={r.headlineDisplay} unit={unit} accent={accent} divider={i > 0}
          nameOpens="game" emphasizeRank={false} club={clubRows}
          onOpenPlayer={onOpenPlayer} onOpenGame={openRowGame(r)} />
      )}
      rowParts={r => ({
        portrait: clubRows && r.teamId ? <TeamBadge team={{ id: r.teamId, abbr: r.teamId }} size={PORTRAIT_PX} />
          : <PlayerPortrait name={r.name} teamId={r.teamId} size={PORTRAIT_PX} />,
        club: r.teamId && !clubRows ? <TeamBadge team={{ id: r.teamId, abbr: r.teamId }} size={16} /> : undefined,
        playerLink: r.player ? playerLink(r.player, onOpenPlayer) : undefined,
        gameLink: r.game ? rowGameLink(r) : undefined,
      })}
      tallyParts={t => ({
        key: t.player?.id ?? t.name,
        name: t.name,
        portrait: clubRows && t.teamId ? <TeamBadge team={{ id: t.teamId, abbr: t.teamId }} size={PORTRAIT_PX} />
          : <PlayerPortrait name={t.name} teamId={t.teamId} size={PORTRAIT_PX} />,
        badge: t.teamId && !clubRows ? <TeamBadge team={{ id: t.teamId, abbr: t.teamId }} size={16} /> : undefined,
        linkProps: t.player ? playerLink(t.player, onOpenPlayer) : undefined,
      })} />
  )
}

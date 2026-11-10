import { useDark } from '../ui/useDark'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { runWpblFinder, validFinderSort, type FinderBoardSide, type FinderQuery, type FinderSort } from './derive/finder'
import { conditionsForPer, finderNeedsPlays, hasPlayerFilter, type FinderPer, type FinderRow } from '../league/finder'
import { requestPlay } from './entryUrl'
import { fieldingInningLines, inningPitchingLines, plateAppearanceLines, playTotals as buildPlayTotals, teamInningLines, type FielderSource } from '../league/inningLines'
import { wpblFielderSource } from './fielders'
import { WPBL_LEAGUE } from './league'
import { fetchWpblPlayLog, getCachedWpblPlayLog } from './api/plays'
import { useWpblSeason } from './SeasonContext'
import { wpblAccentFg, wpblFullName } from './constants'
import { PlayerPortrait, TeamBadge } from './ui'
import { useWpblGameLink, useWpblPlayerLink } from './LinkContext'
import { FinderBoard, type FinderExample, type FinderPlayerPicks, type FinderReading } from '../ui/finderBoard'
import { fitExamples } from '../ui/finderExamples'
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
const plus = (noun: string) => (v: number) => `${v}+ ${noun}`
const inningsOf = (outs: number) => outs / 3
/** A rate's bar ("under 3.00") from its stored last digit (299). */
const under = (v: number) => ((v + 1) / 100).toFixed(2)
/** ".300", "1.100": an average or OPS as it is printed. */
const avgText = (v: number) => (v >= 1000 ? (v / 1000).toFixed(3) : `.${String(v).padStart(3, '0')}`)
/** Innings in outs, so every bar is a whole inning. */
const OUTS = (...ip: number[]) => ip.map(i => i * 3)

const EXAMPLES: Record<FinderBoardSide, FinderExample[]> = {
  pitching: [
    { label: '8+ strikeouts', conditions: [{ field: 'so', op: 'gte', value: 8 }], ladder: { values: [12, 11, 10, 9, 8, 7, 6, 5], label: plus('strikeouts') } },
    { label: '5+ IP, no walks', conditions: [{ field: 'ip', op: 'gte', value: 15 }, { field: 'bb', op: 'eq', value: 0 }], ladder: { values: OUTS(7, 6, 5, 4, 3), label: v => `${inningsOf(v)}+ IP, no walks` } },
    { label: '6+ IP, no runs', conditions: [{ field: 'ip', op: 'gte', value: 18 }, { field: 'r', op: 'eq', value: 0 }], ladder: { values: OUTS(7, 6, 5, 4, 3), label: v => `${inningsOf(v)}+ IP, no runs` } },
    { label: '3+ IP, no hits', conditions: [{ field: 'ip', op: 'gte', value: 9 }, { field: 'h', op: 'eq', value: 0 }], ladder: { values: OUTS(7, 6, 5, 4, 3, 2), label: v => `${inningsOf(v)}+ IP, no hits` } },
    { label: '2+ wild pitches', conditions: [{ field: 'wp', op: 'gte', value: 2 }], ladder: { values: [5, 4, 3, 2], label: plus('wild pitches') } },
    { per: 'inning', label: '3+ strikeouts', conditions: [{ field: 'so', op: 'gte', value: 3 }], ladder: { values: [4, 3], label: plus('strikeouts') } },
    // The one rarity kept as written: nobody threw one in 2026, and that is worth seeing.
    { per: 'inning', label: 'Immaculate', conditions: [{ field: 'so', op: 'gte', value: 3 }, { field: 'pitches', op: 'lte', value: 9 }] },
    { per: 'inning', label: '1-2-3', conditions: [{ field: 'bf', op: 'eq', value: 3 }, { field: 'outs', op: 'eq', value: 3 }, { field: 'baserunners', op: 'eq', value: 0 }] },
    { per: 'inning', label: '3+ runs', conditions: [{ field: 'r', op: 'gte', value: 3 }], ladder: { values: [8, 7, 6, 5, 4, 3], label: plus('runs') } },
    { per: 'inning', label: '25+ pitches', conditions: [{ field: 'pitches', op: 'gte', value: 25 }], ladder: { values: [45, 40, 35, 30, 25], label: plus('pitches') } },
    { per: 'pa', label: '10+ pitches', conditions: [{ field: 'pitches', op: 'gte', value: 10 }], ladder: { values: [14, 13, 12, 11, 10, 9], label: plus('pitches') } },
    { per: 'pa', label: 'Strikeout on 3-2', conditions: [{ field: 'so', op: 'gte', value: 1 }, { field: 'balls', op: 'eq', value: 3 }, { field: 'scount', op: 'eq', value: 2 }] },
    { per: 'pa', label: 'Bases-loaded walks', conditions: [{ field: 'bb', op: 'gte', value: 1 }, { field: 'on', op: 'eq', value: 3 }] },
    { per: 'pa', label: 'Home runs on 0-2', conditions: [{ field: 'hr', op: 'gte', value: 1 }, { field: 'balls', op: 'eq', value: 0 }, { field: 'scount', op: 'eq', value: 2 }] },
    { per: 'pa', label: 'Walk-offs', conditions: [{ field: 'walkoff', op: 'eq', value: 1 }] },
    { per: 'pa', label: '9+ retired in a row', conditions: [{ field: 'retired', op: 'gte', value: 9 }], ladder: { values: [18, 15, 12, 10, 9, 8, 7, 6], label: v => `${v}+ retired in a row` } },
    { per: 'pa', label: '3+ strikeouts in a row', conditions: [{ field: 'krow', op: 'gte', value: 3 }], ladder: { values: [7, 6, 5, 4, 3], label: v => `${v}+ strikeouts in a row` } },
    { per: 'club', label: 'Shutouts', conditions: [{ field: 'r', op: 'eq', value: 0 }] },
    { per: 'club', label: 'No-hitters', conditions: [{ field: 'h', op: 'eq', value: 0 }] },
    { per: 'club', label: '12+ strikeouts', conditions: [{ field: 'so', op: 'gte', value: 12 }], ladder: { values: [18, 16, 15, 14, 13, 12, 11, 10], label: plus('strikeouts') } },
    { per: 'club', label: '8+ walks', conditions: [{ field: 'bb', op: 'gte', value: 8 }], ladder: { values: [12, 11, 10, 9, 8, 7, 6], label: plus('walks') } },
    { per: 'season', label: 'ERA under 3.00', conditions: [{ field: 'era', op: 'lte', value: 299 }], ladder: { values: [99, 149, 199, 249, 299, 349, 399, 449, 499], label: v => `ERA under ${under(v)}` } },
    { per: 'season', label: 'WHIP under 1.20', conditions: [{ field: 'whip', op: 'lte', value: 119 }], ladder: { values: [89, 99, 109, 119, 129, 139, 149, 169, 199], label: v => `WHIP under ${under(v)}` } },
    { per: 'season', label: '4+ wins', conditions: [{ field: 'w', op: 'gte', value: 4 }], ladder: { values: [8, 7, 6, 5, 4, 3, 2], label: plus('wins') } },
    { per: 'season', label: '30+ strikeouts', conditions: [{ field: 'so', op: 'gte', value: 30 }], ladder: { values: [80, 70, 60, 50, 40, 30, 25, 20, 15, 10], label: plus('strikeouts') } },
    { per: 'season', label: '30+ innings', conditions: [{ field: 'ip', op: 'gte', value: 90 }], ladder: { values: OUTS(80, 70, 60, 50, 40, 30, 25, 20, 15, 10), label: v => `${inningsOf(v)}+ innings` } },
  ],
  hitting: [
    { label: '3-hit games', conditions: [{ field: 'h', op: 'gte', value: 3 }], ladder: { values: [5, 4, 3], label: v => `${v}-hit games` } },
    { label: 'Multi-homer games', conditions: [{ field: 'hr', op: 'gte', value: 2 }], ladder: { values: [3, 2], label: v => (v === 2 ? 'Multi-homer games' : `${v}-homer games`) } },
    { label: '4+ RBI', conditions: [{ field: 'rbi', op: 'gte', value: 4 }], ladder: { values: [8, 7, 6, 5, 4], label: plus('RBI') } },
    { label: '2+ steals', conditions: [{ field: 'sb', op: 'gte', value: 2 }], ladder: { values: [5, 4, 3, 2], label: plus('steals') } },
    { label: 'On base 4+ times', conditions: [{ field: 'ob', op: 'gte', value: 4 }], ladder: { values: [6, 5, 4], label: v => `On base ${v}+ times` } },
    { per: 'inning', label: '4+ run innings', conditions: [{ field: 'r', op: 'gte', value: 4 }], ladder: { values: [10, 9, 8, 7, 6, 5, 4], label: v => `${v}+ run innings` } },
    { per: 'inning', label: 'Comebacks', conditions: [{ field: 'trail', op: 'gte', value: 1 }, { field: 'tooklead', op: 'eq', value: 1 }] },
    { per: 'inning', label: 'Two-out rallies', conditions: [{ field: 'r2', op: 'gte', value: 2 }] },
    { per: 'inning', label: '2+ home runs', conditions: [{ field: 'hr', op: 'gte', value: 2 }], ladder: { values: [4, 3, 2], label: plus('home runs') } },
    { per: 'pa', label: '10+ pitches', conditions: [{ field: 'pitches', op: 'gte', value: 10 }], ladder: { values: [14, 13, 12, 11, 10, 9], label: plus('pitches') } },
    { per: 'pa', label: 'Home runs on 0-2', conditions: [{ field: 'hr', op: 'gte', value: 1 }, { field: 'balls', op: 'eq', value: 0 }, { field: 'scount', op: 'eq', value: 2 }] },
    { per: 'pa', label: 'Bases-loaded hits', conditions: [{ field: 'h', op: 'gte', value: 1 }, { field: 'on', op: 'eq', value: 3 }] },
    { per: 'pa', label: 'Hits with RISP', conditions: [{ field: 'h', op: 'gte', value: 1 }, { field: 'risp', op: 'eq', value: 1 }] },
    { per: 'pa', label: '2-out run-scoring hits', conditions: [{ field: 'h', op: 'gte', value: 1 }, { field: 'paouts', op: 'eq', value: 2 }, { field: 'runs', op: 'gte', value: 1 }] },
    { per: 'pa', label: 'Walk-offs', conditions: [{ field: 'walkoff', op: 'eq', value: 1 }] },
    { per: 'pa', label: 'Back-to-back home runs', conditions: [{ field: 'hrrow', op: 'gte', value: 2 }], ladder: { values: [4, 3, 2], label: v => (v === 2 ? 'Back-to-back home runs' : `${v} home runs in a row`) } },
    { per: 'club', label: '10+ runs', conditions: [{ field: 'r', op: 'gte', value: 10 }], ladder: { values: [20, 18, 16, 15, 14, 12, 10], label: plus('runs') } },
    { per: 'club', label: '15+ hits', conditions: [{ field: 'h', op: 'gte', value: 15 }], ladder: { values: [22, 20, 18, 16, 15, 14, 12], label: plus('hits') } },
    { per: 'club', label: 'Won by 10+', conditions: [{ field: 'margin', op: 'gte', value: 10 }], ladder: { values: [15, 12, 10, 8], label: v => `Won by ${v}+` } },
    { per: 'club', label: '4+ steals', conditions: [{ field: 'sb', op: 'gte', value: 4 }], ladder: { values: [8, 7, 6, 5, 4, 3], label: plus('steals') } },
    { per: 'season', label: '.300 hitters', conditions: [{ field: 'avg', op: 'gte', value: 300 }], ladder: { values: [450, 400, 350, 300, 275, 250], label: v => `${avgText(v)} hitters` } },
    { per: 'season', label: '.900+ OPS', conditions: [{ field: 'ops', op: 'gte', value: 900 }], ladder: { values: [1300, 1200, 1100, 1000, 900, 800, 700], label: v => `${avgText(v)}+ OPS` } },
    { per: 'season', label: '3+ home runs', conditions: [{ field: 'hr', op: 'gte', value: 3 }], ladder: { values: [12, 10, 8, 6, 5, 4, 3, 2], label: plus('home runs') } },
    { per: 'season', label: '10+ steals', conditions: [{ field: 'sb', op: 'gte', value: 10 }], ladder: { values: [25, 20, 15, 12, 10, 8, 6, 5], label: plus('steals') } },
  ],
  // A fielding line exists only for a night with a play to make, so "no errors" alone would be most
  // of them: it is asked with a busy night beside it.
  fielding: [
    { label: '2+ errors', conditions: [{ field: 'e', op: 'gte', value: 2 }], ladder: { values: [4, 3, 2], label: plus('errors') } },
    { label: '12+ putouts', conditions: [{ field: 'po', op: 'gte', value: 12 }], ladder: { values: [16, 15, 14, 13, 12, 11, 10], label: plus('putouts') } },
    { label: '5+ assists', conditions: [{ field: 'a', op: 'gte', value: 5 }], ladder: { values: [9, 8, 7, 6, 5, 4], label: plus('assists') } },
    { label: '2+ double plays', conditions: [{ field: 'dp', op: 'gte', value: 2 }], ladder: { values: [4, 3, 2], label: plus('double plays') } },
    { label: '8+ chances, no errors', conditions: [{ field: 'tc', op: 'gte', value: 8 }, { field: 'e', op: 'eq', value: 0 }], ladder: { values: [16, 14, 12, 10, 8], label: v => `${v}+ chances, no errors` } },
    { per: 'club', label: '3+ errors', conditions: [{ field: 'e', op: 'gte', value: 3 }], ladder: { values: [6, 5, 4, 3], label: plus('errors') } },
    { per: 'club', label: 'Errorless wins', conditions: [{ field: 'e', op: 'eq', value: 0 }, { field: 'won', op: 'eq', value: 1 }] },
    { per: 'club', label: '3+ double plays', conditions: [{ field: 'dp', op: 'gte', value: 3 }], ladder: { values: [5, 4, 3, 2], label: plus('double plays') } },
    { per: 'inning', label: '2+ errors', conditions: [{ field: 'e', op: 'gte', value: 2 }], ladder: { values: [4, 3, 2], label: plus('errors') } },
    { per: 'inning', label: 'Double plays', conditions: [{ field: 'dp', op: 'gte', value: 1 }] },
    { per: 'inning', label: '2+ steals allowed', conditions: [{ field: 'sba', op: 'gte', value: 2 }], ladder: { values: [4, 3, 2], label: v => `${v}+ steals allowed` } },
    { per: 'season', label: 'Errorless seasons', conditions: [{ field: 'e', op: 'eq', value: 0 }, { field: 'tc', op: 'gte', value: 30 }], ladder: { at: 1, values: [100, 75, 60, 45, 30, 20], label: v => (v === 30 ? 'Errorless seasons' : `Errorless, ${v}+ chances`) } },
    { per: 'season', label: '.980+ fielding', conditions: [{ field: 'fpct', op: 'gte', value: 980 }], ladder: { values: [1000, 995, 990, 980, 970], label: v => (v === 1000 ? '1.000 fielding' : `${avgText(v)}+ fielding`) } },
    { per: 'season', label: '5+ errors', conditions: [{ field: 'e', op: 'gte', value: 5 }], ladder: { values: [12, 10, 8, 6, 5, 4], label: plus('errors') } },
    { per: 'season', label: '10+ double plays', conditions: [{ field: 'dp', op: 'gte', value: 10 }], ladder: { values: [25, 20, 15, 12, 10, 8, 6], label: plus('double plays') } },
  ],
}


/** The grains each side can be asked at. An inning is a pitcher's on Pitching, a club's turn at the
 *  plate on Hitting and a club's turn in the field on Fielding; a plate appearance has no fielder. A
 *  club's whole game sits beside the player's, the grain a "by a team" question asks. */
const GRAINS: Record<FinderBoardSide, FinderPer[]> = {
  hitting: ['game', 'club', 'inning', 'pa', 'season'],
  pitching: ['game', 'club', 'inning', 'pa', 'season'],
  fielding: ['game', 'club', 'inning', 'season'],
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
  // A game or a season asking a count only the plays hold (pickoffs, pitches seen) reads them too.
  const askTotals = (query.per === 'game' || query.per === 'season') && finderNeedsPlays(side, query, sort)
  const askPlays = askInnings || askPas || askTotals
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
  // WHO WAS AT EACH POSITION, for a fielder's inning: the lineup cards, read once that is asked for.
  const askFielders = askInnings && side === 'fielding'
  const [fielders, setFielders] = useState<FielderSource | null>(null)
  useEffect(() => {
    if (!askFielders || fielders) return
    let cancelled = false
    wpblFielderSource(teams, players, [batting, pitching, fielding])
      .then(src => { if (!cancelled) setFielders(src) })
      .catch(() => { if (!cancelled) setFielders({ starts: [], byName: () => null, teamOf: () => null }) })
    return () => { cancelled = true }
  }, [askFielders, fielders, teams, players, batting, pitching, fielding])
  const fieldInnings = useMemo(
    () => (askFielders && plays && fielders ? fieldingInningLines(cut(plays), games, fielders) : undefined),
    [askFielders, plays, fielders, cut, games])
  // A club's game, and a club's half-inning at the plate: rows and tally are clubs.
  const clubRows = query.per === 'club' || (query.per === 'inning' && side === 'hitting')
  // THE NICKNAME, NOT THE FULL NAME: every name column here steps a name down the way it does a
  // person's, so "Los Angeles Queens" came out "L. Queens", which reads as a player. One word has no
  // stage to step to, and four clubs never share a nickname.
  const clubName = useCallback((id: string) => teams.find(x => x.id === id)?.name ?? id, [teams])
  const playTotals = useMemo(
    () => (askTotals && plays ? buildPlayTotals(WPBL_LEAGUE, cut(plays), games) : undefined),
    [askTotals, plays, cut, games])
  const plateAppearances = useMemo(
    () => (askPas && plays ? plateAppearanceLines(WPBL_LEAGUE, cut(plays), games) : undefined),
    [askPas, plays, cut, games])
  // THE PLAYER PICKERS: whoever has a line on the side on screen (one player), and everyone who came
  // to the plate and everyone who pitched to them in the plays on screen (the matchup), each under the
  // club they did it for most, so no list holds somebody with nothing to find. The matchup's lists are
  // empty until the plays land, which the board shows as only "Any batter".
  const picks = useMemo((): FinderPlayerPicks => {
    const byId = new Map(players.map(p => [p.id, p]))
    const clubOf = (id: string) => teams.find(t => t.id === id)
    const groups = (pairs: Iterable<[string | null, string | null]>, keep: string | null | undefined) => {
      const clubs = new Map<string, Map<string, number>>()
      for (const [id, club] of pairs) {
        if (!id || !byId.has(id)) continue
        const counts = clubs.get(id) ?? new Map<string, number>()
        counts.set(club ?? '', (counts.get(club ?? '') ?? 0) + 1)
        clubs.set(id, counts)
      }
      // The player a link names stays pickable even with no line here (a hitter asked about on
      // Pitching), so the picker reads that name rather than "Any player" over an empty answer.
      if (keep && byId.has(keep) && !clubs.has(keep)) clubs.set(keep, new Map([[byId.get(keep)!.team_id ?? '', 1]]))
      const under = new Map<string, { value: string; label: string }[]>()
      for (const [id, counts] of clubs) {
        const club = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
        const list = under.get(club) ?? []
        list.push({ value: id, label: byId.get(id)!.name })
        under.set(club, list)
      }
      return [...under]
        .map(([club, options]) => ({ label: clubOf(club) ? wpblFullName(clubOf(club)!) : 'Other', options: options.sort((a, b) => a.label.localeCompare(b.label)) }))
        .sort((a, b) => a.label.localeCompare(b.label))
    }
    const lines: { player_id: string; team_id: string | null }[] = side === 'pitching' ? pitching : side === 'fielding' ? fielding : batting
    const pas = plateAppearances ?? []
    return {
      players: groups(lines.map(l => [l.player_id, l.team_id]), query.playerId),
      batters: groups(pas.map(l => [l.batter_id, l.batting_team]), query.batterId),
      pitchers: groups(pas.map(l => [l.pitcher_id, l.fielding_team]), query.pitcherId),
      name: id => byId.get(id)?.name ?? id,
    }
  }, [side, batting, pitching, fielding, plateAppearances, players, teams, query.playerId, query.batterId, query.pitcherId])
  const result = useMemo(
    () => runWpblFinder(side, batting, pitching, players, games, query, 50, sort, { eraInnings, qualify, fielding, innings, plateAppearances, teamInnings, fieldInnings, playTotals, clubName }),
    [side, batting, pitching, fielding, players, games, query, sort, eraInnings, qualify, innings, plateAppearances, teamInnings, fieldInnings, playTotals, clubName])
  // THE EXAMPLES' COUNTS, for the board before a question: each one run in the scope on screen. A
  // play-log example counts only once the log is in hand (cached, or read for a play-log grain),
  // since the start screen must not cost the read the play-log grains are careful to defer.
  const startScreen = query.conditions.length === 0 && !hasPlayerFilter(side, query)
  const countPlays = startScreen ? plays : null
  const exInnings = useMemo(
    () => innings ?? (countPlays && side === 'pitching' ? inningPitchingLines(WPBL_LEAGUE, cut(countPlays), games) : undefined),
    [innings, countPlays, side, cut, games])
  const exTeamInnings = useMemo(
    () => teamInnings ?? (countPlays && side === 'hitting' ? teamInningLines(WPBL_LEAGUE, cut(countPlays), games) : undefined),
    [teamInnings, countPlays, side, cut, games])
  const exFieldInnings = useMemo(
    () => fieldInnings ?? (countPlays && fielders && side === 'fielding' ? fieldingInningLines(cut(countPlays), games, fielders) : undefined),
    [fieldInnings, countPlays, fielders, side, cut, games])
  const exPas = useMemo(
    () => plateAppearances ?? (countPlays && side !== 'fielding' ? plateAppearanceLines(WPBL_LEAGUE, cut(countPlays), games) : undefined),
    [plateAppearances, countPlays, side, cut, games])
  // Each laddered example at the highest bar the slice reaches (src/ui/finderExamples.ts), so a tile
  // names what happened rather than "0 games". Before a count is possible, the examples as written.
  const fitted = useMemo(() => {
    const opts = { eraInnings, qualify, fielding, innings: exInnings, plateAppearances: exPas, teamInnings: exTeamInnings, fieldInnings: exFieldInnings, clubName }
    return fitExamples(EXAMPLES[side], ex => {
      if (!startScreen) return null
      const per = ex.per ?? 'game'
      const missing = (per === 'pa' && !exPas)
        || (per === 'inning' && !(side === 'pitching' ? exInnings : side === 'fielding' ? exFieldInnings : exTeamInnings))
      return missing ? null : runWpblFinder(side, batting, pitching, players, games, { ...query, per, conditions: ex.conditions, batterId: null, pitcherId: null, playerId: null }, 0, null, opts).total
    })
  }, [startScreen, side, batting, pitching, players, games, query, eraInnings, qualify, fielding, exInnings, exPas, exTeamInnings, exFieldInnings, clubName])
  const examples = useMemo(() => fitted.map(f => f.ex), [fitted])
  const exampleCounts = useMemo(() => new Map(fitted.map(f => [f.ex, f.n])), [fitted])
  const exampleHref = (ex: FinderExample) => wpblFinderHref({
    side, per: ex.per ?? 'game', conditions: ex.conditions, teamId: query.teamId, oppId: query.oppId, venue: query.venue, ignored: [], season,
  })
  // A reading on this side is asked in place, which keeps the season and slice on screen; one on
  // the other side goes through the address, the way the search box sends it, since the side is
  // StatsView's to switch.
  const onAsk = (r: FinderReading) => {
    // A matchup outlives a typed question only at the grain that asks it.
    if (r.side === side) onQuery({ ...query, per: r.per, conditions: r.conditions, teamId: r.teamId, oppId: r.oppId, venue: r.venue,
      ...(r.per === 'pa' ? {} : { batterId: null, pitcherId: null }) })
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
      sort={sort} onSort={setSort} examples={examples} accent={accent}
      exampleCount={ex => exampleCounts.get(ex) ?? null} exampleHref={exampleHref}
      exampleCounted={plays || askPlays ? grains : ['game', 'season']}
      grains={grains} loading={askPlays && (!plays || (askFielders && !fielders))} picks={picks}
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

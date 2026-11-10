// A Find link's answer, for the search row that offers it: "7 times · last Sep 2 · most, Kelsie
// Whitmore (3)".
//
// READ OFF THE LINK, NOT THE PARSE. Every row that opens Find (a typed question, a player's question,
// a record no Bests card keeps, a stat against a club) already carries the whole question in its
// address, built by `wpblFinderHref`, and the board answers from that address alone. Reading the same
// address here means one resolver covers every such row, and the count in the row is the board's own
// count by construction: the same lines, cut to the same season, through the same engine and
// qualifying bar. A second reading of the typed words could drift from what the link opens.

import { decodeFinderByClub, decodeFinderCuts, decodeFinderPer, decodeFinderQuery, finderAnswerRow, finderAnswerText, finderNeedsPlays, runFinder, seasonFromPas, type FinderBoardSide, type FinderQuery } from '../league/finder'
import { clubFieldingInningLines, fieldingInningLines, inningPitchingLines, plateAppearanceLines, playTotals, teamInningLines } from '../league/inningLines'
import type { SeasonScope } from '../league/season'
import { fetchWpblAllFielding, fetchWpblAllLines } from './api'
import { fetchWpblPlayLog, type WpblLogPlay } from './api/plays'
import { boxScoreOf, requestBoxScore, requestPlay } from './entryUrl'
import { wpblGamePath } from './routes'
import type { FindAnswer } from '../mlb/state/SearchBridgeContext'
import { WPBL_LEAGUE } from './league'
import { wpblFielderSource } from './fielders'
import { currentSeason, seasonCut, seasonGames, seasonsOnRecord } from './season'
import { wpblQualifiers } from './stats'
import type { WpblFieldingLine, WpblGame, WpblPlayer, WpblTeam } from './types'

export interface FindAsk {
  side: FinderBoardSide
  query: FinderQuery
  /** The year the link names, or null for the board's own default. */
  season: number | null
}

/** The question a WPBL Find link asks, or null when it is not one. The same params StatsView reads. */
export function findAskFromHref(href: string, teams: readonly Pick<WpblTeam, 'id'>[] = []): FindAsk | null {
  const url = new URL(href, 'https://sportydolphin.fun')
  if (url.pathname.replace(/\/+$/, '') !== '/wpbl/stats') return null
  const p = url.searchParams
  if (p.get('board') !== 'find') return null
  const s = p.get('side')
  const side: FinderBoardSide = s === 'pitching' || s === 'fielding' ? s : 'hitting'
  const raw = p.get('q')
  // A link's club is matched to the club the way the board does once the clubs load, case aside.
  const club = (id: string | null) => (id ? teams.find(t => t.id.toLowerCase() === id.toLowerCase())?.id ?? id : null)
  const venue = p.get('venue')
  const games = p.get('games')
  const scope: SeasonScope = games === 'post' ? 'postseason' : games === 'all' ? 'all' : 'regular'
  const year = Number(p.get('season'))
  return {
    side,
    season: Number.isInteger(year) && year > 0 ? year : null,
    query: {
      conditions: decodeFinderQuery(raw, side),
      per: decodeFinderPer(raw),
      byClub: decodeFinderByClub(raw),
      ...decodeFinderCuts(raw),
      teamId: club(p.get('team')),
      oppId: club(p.get('opp')),
      venue: venue === 'home' || venue === 'away' ? venue : 'any',
      scope,
      batterId: p.get('bat'),
      pitcherId: p.get('pit'),
      playerId: p.get('by'),
    },
  }
}

/**
 * The answer to `href` in one line, or null when it is not a Find link or names a season the league
 * has not played. Reads what the board would: the season's lines, and the play log only for an inning
 * or a plate appearance (one season of it, often already in memory from the board or a first).
 * Uncapped, since a record's ties are counted over every match (`finderAnswerText`).
 */
export async function wpblFindAnswer(href: string, ctx: FindContext): Promise<string | null> {
  return (await wpblFindAnswerWithTarget(href, ctx))?.text ?? null
}

type FindContext = { schedule: WpblGame[]; players: WpblPlayer[]; teams: WpblTeam[]; eraInnings: number }

/**
 * The answer, and the night or play it names when it names one (`finderAnswerRow`): that game's box
 * score on the line's club, or the play-by-play at the play for an inning or a plate appearance.
 */
export async function wpblFindAnswerWithTarget(href: string, ctx: FindContext): Promise<FindAnswer | null> {
  const ask = findAskFromHref(href, ctx.teams)
  if (!ask) return null
  const { side, query } = ask
  const season = ask.season ?? currentSeason(ctx.schedule)
  if (season == null || !seasonsOnRecord(ctx.schedule).includes(season)) return null
  // Cut against the WHOLE schedule, never one season's games (src/wpbl/CLAUDE.md). Both keep their
  // identity from one call to the next, so the play-log lines are built once a season, not once a row.
  const cut = <T extends { game_id: string }>(rows: T[]): T[] => seasonCut(rows, ctx.schedule, season)
  const games = seasonGames(ctx.schedule, season)
  const fine = finderNeedsPlays(side, query)
  const [lines, fielding, plays] = await Promise.all([
    fetchWpblAllLines(),
    side === 'fielding' ? fetchWpblAllFielding() : Promise.resolve<WpblFieldingLine[]>([]),
    fine ? fetchWpblPlayLog(season) : Promise.resolve<WpblLogPlay[] | null>(null),
  ])
  const log = plays ? cut(plays) : null
  const fielders = log && query.per === 'inning' && side === 'fielding'
    ? await wpblFielderSource(ctx.teams, ctx.players, [lines.batting, lines.pitching, fielding]) : null
  const q = wpblQualifiers(ctx.teams, games, query.scope)
  const result = runFinder(side, cut(lines.batting), cut(lines.pitching), ctx.players, games, query, Infinity, null, {
    eraInnings: ctx.eraInnings,
    qualify: q.active ? { minPa: q.minPa, minOuts: q.minOuts, minG: q.minG } : null,
    fielding: cut(fielding),
    innings: log && query.per === 'inning' && side === 'pitching' ? inningPitchingLines(WPBL_LEAGUE, log, games) : undefined,
    teamInnings: log && query.per === 'inning' && side === 'hitting' ? teamInningLines(WPBL_LEAGUE, log, games) : undefined,
    // A hitter's season against one arm, one pitcher or in a situation is summed from the plate
    // appearances too; left out, "hr off Whitmore" answered "Never" over a board listing four.
    plateAppearances: log && (query.per === 'pa' || seasonFromPas(side, query)) ? plateAppearanceLines(WPBL_LEAGUE, log, games) : undefined,
    fieldInnings: log && fielders && !query.byClub ? fieldingInningLines(log, games, fielders) : undefined,
    clubFieldInnings: log && fielders && query.byClub ? clubFieldingInningLines(log, games, fielders) : undefined,
    playTotals: log && (query.per === 'game' || query.per === 'season') ? playTotals(WPBL_LEAGUE, log, games) : undefined,
    clubName: id => ctx.teams.find(t => t.id === id)?.name ?? id,
  })
  const row = finderAnswerRow(result, query)
  const game = row?.game ?? null
  let target: FindAnswer['target'] = null
  if (row && game) {
    const path = wpblGamePath(game, ctx.teams, ctx.schedule)
    const at = row.inning?.sequence
    if (at != null) {
      target = { href: `${path}#play-${at}`, play: true, open: () => requestPlay(game.id, at) }
    } else {
      const box = boxScoreOf(game, row.teamId)
      target = { href: `${path}${box.query}`, play: false, open: () => requestBoxScore(game.id, box.side) }
    }
  }
  return { text: finderAnswerText(result, side, query), target }
}

// One pairing of clubs over a season: the record, every meeting in order, and who did what in them.
//
// PURE, like matchups.ts and stats.ts beside it: arrays in, plain shapes out, no supabase and no
// React. The page at /wpbl/series/<a>-vs-<b> draws it; see SeriesPage.tsx.
//
// THE RECORD IS THE STANDINGS' RULE, BY CONSTRUCTION. It reads `headToHead`, the same cell the
// standings grid and the club page's chips read, rather than counting finals of its own. Three
// surfaces have each grown a loop of their own and leaked the postseason into a season series
// (see the trap in CLAUDE.md); a fourth would be the next one.
//
// THE POSTSEASON IS A SEPARATE LINE, never folded into the season series. In 2026 three of the six
// pairings met again in the bracket, and "SF 7-3 LA" would be a record nobody played for. The
// meetings list carries both, marked, because a reader looking up a rivalry wants the final too.
import { headToHead } from './matchups'
import { countsInStandings, scopedLines, type SeasonScope } from '../season'
import {
  aggregateBatting, aggregatePitching, plateAppearances,
  QUALIFY_PA_PER_GAME, QUALIFY_OUTS_PER_GAME, QUALIFY_FLOOR_PA, QUALIFY_FLOOR_OUTS,
  type WpblBatSeason, type WpblPitSeason,
} from '../stats'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer } from '../types'

export interface SeriesRecord { aWins: number; bWins: number; aRuns: number; bRuns: number }

export interface SeriesMeeting {
  game: WpblGame
  postseason: boolean
  /** Null until the game is a decisive final. */
  winnerId: string | null
  /** The regular-season series after this game, from a's side. Null on a postseason game and on a
   *  game not yet decided, so the running tally only ever moves on a result that counts. */
  tally: { a: number; b: number } | null
}

export interface WpblSeasonSeries {
  aId: string
  bId: string
  regular: SeriesRecord
  /** Null when the pair never met in the postseason. */
  postseason: SeriesRecord | null
  /** Every game between the two, in date order, played or not. */
  meetings: SeriesMeeting[]
  /** Regular-season meetings still to play, so the page can say the series is not over. */
  remaining: number
}

const isPair = (g: WpblGame, a: string, b: string) =>
  (g.home_team_id === a && g.away_team_id === b) || (g.home_team_id === b && g.away_team_id === a)

const decisive = (g: WpblGame) =>
  g.status === 'final' && g.home_score != null && g.away_score != null && g.home_score !== g.away_score

const byDate = (x: WpblGame, y: WpblGame) =>
  x.game_date.localeCompare(y.game_date) || String(x.start_time ?? '').localeCompare(String(y.start_time ?? ''))

/** Every game the two clubs played or will play, in date order. */
export function seriesGames(games: WpblGame[], aId: string, bId: string): WpblGame[] {
  return games.filter(g => isPair(g, aId, bId)).sort(byDate)
}

export function seasonSeries(games: WpblGame[], aId: string, bId: string): WpblSeasonSeries {
  const mine = seriesGames(games, aId, bId)
  const cell = headToHead(games).get(aId, bId)
  const regular: SeriesRecord = cell
    ? { aWins: cell.wins, bWins: cell.losses, aRuns: cell.runsFor, bRuns: cell.runsAgainst }
    : { aWins: 0, bWins: 0, aRuns: 0, bRuns: 0 }

  let post: SeriesRecord | null = null
  let a = 0, b = 0
  const meetings: SeriesMeeting[] = mine.map(g => {
    const postseason = !countsInStandings(g)
    const winnerId = decisive(g)
      ? (g.home_score! > g.away_score! ? g.home_team_id : g.away_team_id)
      : null
    const aScore = g.home_team_id === aId ? g.home_score : g.away_score
    const bScore = g.home_team_id === aId ? g.away_score : g.home_score
    if (postseason && winnerId) {
      post ??= { aWins: 0, bWins: 0, aRuns: 0, bRuns: 0 }
      if (winnerId === aId) post.aWins++; else post.bWins++
      post.aRuns += aScore ?? 0; post.bRuns += bScore ?? 0
    }
    let tally: SeriesMeeting['tally'] = null
    if (!postseason && winnerId) {
      if (winnerId === aId) a++; else b++
      tally = { a, b }
    }
    return { game: g, postseason, winnerId, tally }
  })
  // A postseason game on the schedule but not yet played still says the pair meets in the bracket.
  if (!post && meetings.some(m => m.postseason)) post = { aWins: 0, bWins: 0, aRuns: 0, bRuns: 0 }

  const remaining = meetings.filter(m => !m.postseason && m.game.status === 'scheduled').length
  return { aId, bId, regular, postseason: post, meetings, remaining }
}

export interface SeriesBatter { season: WpblBatSeason; teamId: string | null; pa: number }
export interface SeriesPitcher { season: WpblPitSeason; teamId: string | null }

/** The bar a series leader has to clear, on the league's own per-game rate (see `wpblQualifiers`),
 *  counted over the games the two clubs played each other in this slice. */
export function seriesQualifiers(gamesPlayed: number): { minPa: number; minOuts: number } {
  return {
    minPa: Math.max(QUALIFY_FLOOR_PA, Math.ceil(QUALIFY_PA_PER_GAME * gamesPlayed)),
    minOuts: Math.max(QUALIFY_FLOOR_OUTS, Math.ceil(QUALIFY_OUTS_PER_GAME * gamesPlayed)),
  }
}

/**
 * Who hit and who pitched in these games, for the two leader boards.
 *
 * The club each player is drawn with is the one on the player's lines IN THESE GAMES, never the
 * roster row, which says where a traded player is now rather than where they were then.
 */
export function seriesLeaders(
  players: WpblPlayer[], batting: WpblBattingLine[], pitching: WpblPitchingLine[],
  games: WpblGame[], aId: string, bId: string, scope: SeasonScope,
): { batters: SeriesBatter[]; pitchers: SeriesPitcher[]; gamesPlayed: number } {
  const ids = new Set(seriesGames(games, aId, bId).filter(decisive).map(g => g.id))
  const inSeries = <T extends { game_id: string }>(ls: T[]) => scopedLines(ls.filter(l => ids.has(l.game_id)), games, scope)
  const bat = inSeries(batting), pit = inSeries(pitching)
  const gamesPlayed = new Set(bat.map(l => l.game_id)).size
  const clubOf = (ls: { player_id: string; team_id: string | null }[]) => {
    const m = new Map<string, string>()
    for (const l of ls) if (l.team_id) m.set(l.player_id, l.team_id)
    return m
  }
  const batClub = clubOf(bat), pitClub = clubOf(pit)
  const { minPa, minOuts } = seriesQualifiers(gamesPlayed)

  const batters = aggregateBatting(players, bat, games, 'all')
    .map(s => ({ season: s, teamId: batClub.get(s.player.id) ?? null, pa: plateAppearances(s.totals) }))
    .filter(b => b.pa >= minPa && b.season.totals.ops != null)
    .sort((x, y) => y.season.totals.ops! - x.season.totals.ops! || y.pa - x.pa || x.season.player.name.localeCompare(y.season.player.name))
  const pitchers = aggregatePitching(players, pit, games, 'all')
    .map(s => ({ season: s, teamId: pitClub.get(s.player.id) ?? null }))
    .filter(p => p.season.totals.outs >= minOuts && p.season.totals.era != null)
    .sort((x, y) => x.season.totals.era! - y.season.totals.era! || y.season.totals.outs - x.season.totals.outs || x.season.player.name.localeCompare(y.season.player.name))
  return { batters, pitchers, gamesPlayed }
}

import type { SeasonScope } from '../league/season'
import type { FinderOptions } from '../league/finder'
import { currentSeason, seasonGames } from './season'
import { wpblQualifiers } from './stats'
import type { WpblGame, WpblTeam } from './types'

/**
 * THE RATE BARS FIND HOLDS A SEASON TO, for the board and the answer line alike, so the two cannot
 * disagree.
 *
 * ONE YEAR: that year's bar (wpblQualifiers scales it with the year's games). EVERY SEASON: a career
 * is held to the bar over every game, which is the seasons' bars together; a row of one year among
 * several is held to its own year's bar (`qualifyFor`), since the career's is one no single season
 * could reach. The bar the board names under the question is then the current season's.
 */
export function wpblFinderQualify(
  teams: WpblTeam[], schedule: WpblGame[], season: number | 'all' | null, scope: SeasonScope, career: boolean,
): Pick<FinderOptions, 'qualify' | 'qualifyFor'> {
  const bar = (games: WpblGame[]) => {
    const q = wpblQualifiers(teams, games, scope)
    return q.active ? { minPa: q.minPa, minOuts: q.minOuts, minG: q.minG } : null
  }
  if (season !== 'all') return { qualify: bar(season == null ? schedule : seasonGames(schedule, season)) }
  if (career) return { qualify: bar(schedule) }
  const now = currentSeason(schedule)
  const byYear = new Map<number, ReturnType<typeof bar>>()
  return {
    qualify: bar(now == null ? schedule : seasonGames(schedule, now)),
    qualifyFor: year => {
      if (!byYear.has(year)) byYear.set(year, bar(seasonGames(schedule, year)))
      return byYear.get(year) ?? null
    },
  }
}

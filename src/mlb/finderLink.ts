// MLB's half of a stat question typed as words: its clubs as the parser reads them, and the
// address of its Find board. The shell's search (src/finderSearch.ts) and the board's own "Ask in
// words" box both go through here (WPBL's twin is src/wpbl/finderLink.ts).

import type { FinderClubAlias, ParsedFinder } from '../league/finderParse'
import { encodeFinderQuery } from '../league/finder'
import { MLB_CLUBS, mlbUrlFor } from './routes'
import { CURRENT_SEASON, TEAM_ABBR } from './constants'

// The nickname is the slug ("red-sox"), and the city is the name with the nickname taken off. A
// city two clubs share (Chicago, New York, Los Angeles) is listed under both, and the parser offers
// a reading for each rather than guessing which one was meant.
export const MLB_FINDER_CLUBS: FinderClubAlias[] = (() => {
  const cityOf = (c: (typeof MLB_CLUBS)[number]) => {
    const nick = c.slug.replace(/-/g, ' ')
    const lower = c.name.toLowerCase()
    return lower.endsWith(nick) ? c.name.slice(0, c.name.length - nick.length).trim() : ''
  }
  return MLB_CLUBS.map(c => {
    const city = cityOf(c)
    const names = [c.name, c.slug.replace(/-/g, ' ')]
    const abbr = TEAM_ABBR[c.id]
    if (abbr) names.push(abbr)
    if (city) names.push(city)
    return { id: String(c.id), names }
  })
})()

/** The Find board asking `p`. */
export function mlbFinderHref(p: Omit<ParsedFinder, 'season'> & { season?: number | null }): string {
  return mlbUrlFor({
    view: 'find',
    lb: p.side,
    find: encodeFinderQuery(p) || null,
    findTeam: p.teamId ? Number(p.teamId) : null,
    findOpp: p.oppId ? Number(p.oppId) : null,
    findVenue: p.venue === 'any' ? null : p.venue,
    season: p.season,
  }, CURRENT_SEASON)
}

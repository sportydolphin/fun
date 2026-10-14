// WPBL's half of a stat question typed as words: its clubs as the parser reads them, and the
// address of its Find board. The shell's search (src/finderSearch.ts) and the board's own "Ask in
// words" box both go through here, so a question means the same in both places, and neither
// section imports the other to get at it.

import type { FinderClubAlias, ParsedFinder } from '../league/finderParse'
import { encodeFinderQuery } from '../league/finder'
import { WPBL_TEAMS } from './constants'

export const WPBL_FINDER_CLUBS: FinderClubAlias[] = Object.values(WPBL_TEAMS).map(t => ({
  id: t.id, names: [t.abbr, t.city, t.name, `${t.city} ${t.name}`],
}))

/** The Find board asking `p`. */
export function wpblFinderHref(p: ParsedFinder): string {
  const params = new URLSearchParams({ board: 'find', side: p.side, q: encodeFinderQuery(p) })
  if (p.teamId) params.set('team', p.teamId)
  if (p.oppId) params.set('opp', p.oppId)
  if (p.venue !== 'any') params.set('venue', p.venue)
  // The finder's grammar is URL-safe on purpose (see encodeFinderQuery), so undo the escaping
  // URLSearchParams gives `~`: the address should read the way the board writes it.
  return `/wpbl/stats?${params.toString().replace(/%7E/gi, '~')}`
}

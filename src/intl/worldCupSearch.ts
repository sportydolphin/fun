// The World Cup's half of the site search: its players outside the WPBL and its editions, matched
// against what the reader typed. ROADMAP-WOMENS-BASEBALL.md, stage 2.
//
// A WPBL player is never here. They come back as a WPBL row, which opens the one page that holds
// their World Cups too (`PersonLookup.path`), and a second row for the same person would be a
// second page that does not exist.
import { foldName, fuzzyMatches } from '../lib/fuzzyName'
import { countryName } from './countries'
import type { WorldCupIndexEntry } from './wbsc/editions'
import type { WorldCupSearchPerson } from './wbsc/personFile'

export interface WorldCupMatches {
  people: WorldCupSearchPerson[]
  editions: WorldCupIndexEntry[]
  /** National teams, by IOC code, that have played a World Cup the reader's words name. */
  teams: string[]
  /** The people came from the forgiving pass, as a WPBL row's can. */
  forgiving: boolean
}

// What a reader types to mean the competition rather than a player in it.
const NAMES = ['world cup', 'womens world cup', 'womens baseball world cup', 'baseball world cup', 'wbsc', 'wbwc']

/** What a reader types for a team besides WBSC's own label (countries.ts): the everyday name. */
const TEAM_ALIASES: Readonly<Record<string, readonly string[]>> = {
  USA: ['United States', 'America', 'Team USA'],
  KOR: ['South Korea'],
  TPE: ['Taiwan'],
  HKG: ['Hong Kong'],
  NED: ['Holland'],
  GBR: ['Britain', 'United Kingdom'],
}

/** A team whose name, an alias or its code the query starts (or starts a later word of). The code
 *  must be typed whole, so "ca" is not Canada and Cuba at once. */
function matchTeams(editions: readonly WorldCupIndexEntry[], q: string): string[] {
  if (q.length < 3) return []
  const played = [...new Set(editions.flatMap(e => e.team_ids ?? []))]
  const hit = (name: string) => { const n = foldName(name); return n.startsWith(q) || n.includes(` ${q}`) }
  return played.filter(t => foldName(t) === q || hit(countryName(t)) || (TEAM_ALIASES[t] ?? []).some(hit))
    .sort((a, b) => countryName(a).localeCompare(countryName(b)))
}

const inEdition = (season: number | null) => (slug: string) => season == null || slug === String(season)

/** `query` is names only, as the search bridge hands it; a year typed beside it is `season`
 *  ("Kim 2024", "world cup 2018"), which narrows both lists to that edition. */
export function matchWorldCup(
  people: readonly WorldCupSearchPerson[],
  editions: readonly WorldCupIndexEntry[],
  query: string,
  season: number | null,
): WorldCupMatches {
  const q = foldName(query)
  const none: WorldCupMatches = { people: [], editions: [], teams: [], forgiving: false }
  // A year alone ("2018") is the edition decided or played that year.
  if (q.length < 2) return season == null ? none : { ...none, editions: editions.filter(e => e.slug === String(season) || e.years.includes(season)) }
  const named = NAMES.some(n => (q.length >= 3 && n.startsWith(q)) || q === n || q.startsWith(`${n} `) || q.endsWith(` ${n}`))
  // Newest first, as a reader asking for the World Cup most likely means the latest one.
  if (named) return { ...none, editions: editions.filter(e => season == null || e.slug === String(season) || e.years.includes(season))
    .sort((a, b) => b.slug.localeCompare(a.slug)) }

  const pool = people.filter(p => season == null || p.editions.some(inEdition(season)))
  // Best match first: the whole name, then its start, then the start of a later word (the surname
  // alone), then anywhere in it.
  const rank = (p: WorldCupSearchPerson) => {
    const n = foldName(p.name)
    return n === q ? 0 : n.startsWith(q) ? 1 : n.includes(` ${q}`) ? 2 : 3
  }
  const exact = pool.filter(p => foldName(p.name).includes(q)).sort((a, b) => rank(a) - rank(b))
  const teams = matchTeams(season == null ? editions : editions.filter(e => e.slug === String(season) || e.years.includes(season)), q)
  if (exact.length || teams.length || q.length < 3) return { ...none, people: exact, teams }
  return { ...none, people: fuzzyMatches(pool, q, p => [p.name]), forgiving: true }
}

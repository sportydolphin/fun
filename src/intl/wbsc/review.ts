// What the reviewer sees beside each crosswalk candidate (`npm run wbsc -- --review`).
//
// A name alone is what the proposer already used, so judging a candidate on the name again checks
// nothing. Each row adds the facts the two sides hold independently: the national team against the
// roster's hometown, and what the player did at the World Cup (pitched, which positions) against
// the roster's position. None of them decides: a Phoenix native plays for Mexico, and a pitcher
// plays first base at a tournament with a 20-player roster. They are there to make a wrong pair
// look wrong.

import type { Candidate, CrosswalkWpblPlayer } from './crosswalk'

/** The country each IOC code is written as at the end of a WPBL hometown. */
const COUNTRY: Record<string, string[]> = {
  AUS: ['australia'], CAN: ['canada'], CUB: ['cuba'], CUW: ['curacao'], FRA: ['france'],
  GBR: ['united kingdom', 'england', 'scotland', 'wales', 'great britain'], HKG: ['hong kong'],
  JPN: ['japan'], KOR: ['south korea', 'korea'], MEX: ['mexico'], NED: ['netherlands'],
  PHI: ['philippines'], PUR: ['puerto rico'], TPE: ['taiwan', 'chinese taipei'],
  USA: ['usa', 'united states'], VEN: ['venezuela'],
}

/**
 * Whether the national team is the country at the end of the hometown. 'unknown' when either is
 * missing or the code is not in the table: a missing fact is not a mismatch.
 */
export function countryAgrees(ioc: string | null, hometown: string | null | undefined): 'same' | 'differs' | 'unknown' {
  const names = ioc ? COUNTRY[ioc] : undefined
  const country = hometown?.split(',').pop()?.trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  if (!names || !country) return 'unknown'
  return names.includes(country) ? 'same' : 'differs'
}

export interface WbscLineRow { player_id: string; game_id: string; pa?: number; outs?: number; position?: string | null }

/** What a WBSC player did in one event, from the lines the importer wrote. */
export interface WbscRecord {
  games: number
  pa: number
  /** Outs recorded as a pitcher. */
  outs: number
  /** Every position in the box score, most played first ("CF", "P"). */
  positions: string[]
  /** One game to open on wbsc.org. */
  first_game: string | null
}

export function wbscRecord(id: string, batting: readonly WbscLineRow[], pitching: readonly WbscLineRow[]): WbscRecord {
  const games = new Set<string>()
  const counts = new Map<string, number>()
  let pa = 0, outs = 0
  for (const l of batting) {
    if (l.player_id !== id) continue
    games.add(l.game_id)
    pa += l.pa ?? 0
    // A double switch reads "PH/LF": each part is a position played.
    for (const p of String(l.position ?? '').split('/').map(s => s.trim().toUpperCase()).filter(Boolean)) {
      counts.set(p, (counts.get(p) ?? 0) + 1)
    }
  }
  for (const l of pitching) {
    if (l.player_id !== id) continue
    games.add(l.game_id)
    outs += l.outs ?? 0
  }
  if (outs > 0 && !counts.has('P')) counts.set('P', 0)
  const sorted = [...games].sort()
  return {
    games: games.size, pa, outs,
    positions: [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([p]) => p),
    first_game: sorted[0] ?? null,
  }
}

/** The groups the page shows, in order: the ones to look at hardest first. */
export type ReviewGroup = 'conflict' | 'check' | 'clear'

/**
 * Where a candidate goes. `conflict`: another candidate claims the same player, so at most one is
 * right. `check`: matched on an initial, or the country disagrees. `clear`: the full name, the
 * same country, and nothing competing for either player.
 */
export function reviewGroup(c: Pick<Candidate, 'ambiguous' | 'match' | 'wbsc_team' | 'wpbl_hometown'>): ReviewGroup {
  if (c.ambiguous) return 'conflict'
  if (c.match !== 'name' || countryAgrees(c.wbsc_team, c.wpbl_hometown) !== 'same') return 'check'
  return 'clear'
}

export interface ReviewRow extends Candidate {
  group: ReviewGroup
  country: ReturnType<typeof countryAgrees>
  wbsc: WbscRecord
  wpbl: Pick<CrosswalkWpblPlayer, 'id' | 'name'> & { position: string | null; bats: string | null; throws: string | null; birth_date: string | null; team_id: string | null; path: string | null }
}

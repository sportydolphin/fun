// people.json: one person, every competition. ROADMAP-WOMENS-BASEBALL.md, stage 1.
//
// A PERSON EXISTS BECAUSE A HUMAN SAID SO. The WPBL roster is the one source that already names
// people (its rows are people: `api_ids` folds the feed's extra ids into one row). Every other
// identity joins one only through a reviewed link: a WBSC tournament player through the crosswalk
// (src/intl/wbsc/crosswalk.ts). Nothing here matches names, so a WBSC player nobody has linked is a
// person of their own, even when the same name played the next World Cup for the same country:
// WBSC numbers every player afresh each tournament, and "same name, same flag" is a proposal for a
// reviewer, never a fact.
//
// IDS ARE ANCHORED, so a link added later does not renumber anybody. A person with a WPBL row is
// `person:wpbl:<that id>`. A WBSC-only person is `person:wbsc:<their earliest tournament id>`, so
// joining a later event to them keeps the id they already had.
//
// ALL OR NOTHING, as the importer and international.json are: a link that does not resolve, or two
// links that would make one person two people (or two people one), and nothing is built.

import type { Crosswalk } from './wbsc/crosswalk'

export interface PeopleWpblPlayer { id: string; name: string }

export interface PeopleWbscPlayer {
  /** The namespaced tournament id, `wbsc:p:<tournament>:<player>`. */
  id: string
  event_key: string
  name: string
  /** The national team, its IOC code. */
  team_id: string | null
}

/** One tournament a person played, as WBSC wrote them in it. */
export interface WbscIdentity {
  event_key: string
  wbsc_id: string
  name: string
  team_id: string | null
}

export interface Person {
  id: string
  /** The roster's name for a WPBL player; WBSC's, from their latest event, for anyone else. */
  name: string
  /** The national team of their latest World Cup, its IOC code. Null for a WPBL player who has
   *  played none. */
  country: string | null
  wpbl_id: string | null
  /** Oldest first. */
  wbsc: WbscIdentity[]
}

export interface PeopleResult {
  people: Person[]
  errors: string[]
}

/** Code-point order, so the file is the same bytes on every machine whatever its locale. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** `wbsc:p:<tournament>:<player>` sorts by tournament, which WBSC numbers in order of the events. */
const tournament = (wbscId: string): number => Number(wbscId.split(':')[2] ?? 0)

export function buildPeople(
  roster: readonly PeopleWpblPlayer[],
  wbscPlayers: readonly PeopleWbscPlayer[],
  crosswalk: Crosswalk,
): PeopleResult {
  const errors: string[] = []
  const wbscById = new Map(wbscPlayers.map(p => [p.id, p]))
  const wpblById = new Map(roster.map(p => [p.id, p]))

  // Every WBSC identity, and the WPBL player its link names, if any.
  const linkOf = new Map<string, string>()
  const perEvent = new Map<string, string>()
  for (const l of crosswalk.links) {
    const label = `${l.wbsc_name} → ${l.wpbl_name} (${l.event_key})`
    if (!wbscById.has(l.wbsc_id)) { errors.push(`${label}: ${l.wbsc_id} is in no imported event`); continue }
    if (!wpblById.has(l.wpbl_id)) { errors.push(`${label}: ${l.wpbl_id} is not on the WPBL roster`); continue }
    const was = linkOf.get(l.wbsc_id)
    if (was && was !== l.wpbl_id) { errors.push(`${label}: ${l.wbsc_id} is also linked to ${wpblById.get(was)?.name}`); continue }
    const event = `${l.wpbl_id} ${wbscById.get(l.wbsc_id)!.event_key}`
    const other = perEvent.get(event)
    if (other && other !== l.wbsc_id) { errors.push(`${label}: ${l.wpbl_name} is already ${wbscById.get(other)?.name} in that event`); continue }
    perEvent.set(event, l.wbsc_id)
    linkOf.set(l.wbsc_id, l.wpbl_id)
  }
  if (errors.length) return { people: [], errors }

  const identity = (p: PeopleWbscPlayer): WbscIdentity => ({ event_key: p.event_key, wbsc_id: p.id, name: p.name, team_id: p.team_id })
  const byTournament = (a: WbscIdentity, b: WbscIdentity) => tournament(a.wbsc_id) - tournament(b.wbsc_id) || cmp(a.wbsc_id, b.wbsc_id)
  const latest = (ids: WbscIdentity[]) => ids[ids.length - 1]

  const people: Person[] = []
  const linked = new Map<string, WbscIdentity[]>()
  for (const p of wbscPlayers) {
    const wpbl = linkOf.get(p.id)
    if (wpbl) linked.set(wpbl, [...(linked.get(wpbl) ?? []), identity(p)])
    else people.push({ id: `person:wbsc:${p.id.slice('wbsc:p:'.length)}`, name: p.name, country: p.team_id, wpbl_id: null, wbsc: [identity(p)] })
  }
  for (const r of roster) {
    const wbsc = (linked.get(r.id) ?? []).sort(byTournament)
    people.push({ id: `person:wpbl:${r.id}`, name: r.name, country: wbsc.length ? latest(wbsc).team_id : null, wpbl_id: r.id, wbsc })
  }
  return { people: people.sort((a, b) => cmp(a.id, b.id)), errors }
}

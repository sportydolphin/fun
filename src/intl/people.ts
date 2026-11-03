// people.json: one person, every competition. ROADMAP-WOMENS-BASEBALL.md, stage 1.
//
// A PERSON EXISTS BECAUSE A DECISION SAID SO. The WPBL roster is the one source that already names
// people (its rows are people: `api_ids` folds the feed's extra ids into one row). Every other
// identity joins one only through a recorded decision: a WBSC tournament player to a WPBL player
// through the reviewed crosswalk (wbsc/crosswalk.ts), and two WBSC tournament players to each other
// through same-person.json (wbsc/samePerson.ts), decided by the reviewer or by a rule the owner's
// crosswalk answers settle. Nothing here matches names: WBSC numbers every player afresh each
// tournament, so a WBSC player nothing joins is a person of their own.
//
// IDS ARE ANCHORED, so a link added later does not renumber anybody. A person with a WPBL row is
// `person:wpbl:<that id>`. A WBSC-only person is `person:wbsc:<their earliest tournament id>`, so
// joining a later event to them keeps the id they already had.
//
// ALL OR NOTHING, as the importer and international.json are: a link that does not resolve, two
// links that would make one person two people (or two people one), or joins that would make one
// person two WPBL players or put them in both groups of one World Cup, and nothing is built.

import type { Crosswalk } from './wbsc/crosswalk'
import { EMPTY_SAME_PERSON, type SamePersonFile } from './wbsc/samePerson'

export interface PeopleWpblPlayer { id: string; name: string }

export interface PeopleWbscPlayer {
  /** The namespaced tournament id, `wbsc:p:<tournament>:<player>`. */
  id: string
  event_key: string
  /** What the site shows: first given name and surname (`displayName` in wbsc/game.ts). */
  name: string
  /** Every name WBSC registered. */
  full_name: string
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
  /** The roster's name for a WPBL player; for anyone else WBSC's from their latest event, without
   *  the middle names WBSC registers. */
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
  /** WBSC players across World Cups decided to be one person (wbsc/samePerson.ts). */
  samePerson: SamePersonFile = EMPTY_SAME_PERSON,
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

  // Same-person decisions between WBSC players, each id checked.
  const joins: [string, string][] = []
  for (const d of samePerson.decisions) {
    if (!d.same) continue
    const label = `${d.a_name} = ${d.b_name}`
    const missing = [d.a, d.b].filter(id => !wbscById.has(id))
    if (missing.length) { errors.push(`${label}: ${missing.join(', ')} in no imported event`); continue }
    joins.push([d.a, d.b])
  }
  if (errors.length) return { people: [], errors }

  // Union-find: WBSC ids, joined by same-person decisions, and to a WPBL player by the crosswalk.
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let p = parent.get(x) ?? x
    if (p !== x) { p = find(p); parent.set(x, p) }
    return p
  }
  const join = (a: string, b: string) => { const [ra, rb] = [find(a), find(b)]; if (ra !== rb) parent.set(ra, rb) }
  for (const [a, b] of joins) join(a, b)
  for (const [wbscId, wpbl] of linkOf) join(wbscId, `wpbl:${wpbl}`)

  const identity = (p: PeopleWbscPlayer): WbscIdentity => ({ event_key: p.event_key, wbsc_id: p.id, name: p.full_name, team_id: p.team_id })
  const shown = new Map(wbscPlayers.map(p => [p.id, p.name]))
  const byTournament = (a: WbscIdentity, b: WbscIdentity) => tournament(a.wbsc_id) - tournament(b.wbsc_id) || cmp(a.wbsc_id, b.wbsc_id)
  const latest = (ids: WbscIdentity[]) => ids[ids.length - 1]

  const groups = new Map<string, { wpbl: Set<string>; wbsc: WbscIdentity[] }>()
  const group = (root: string) => {
    let g = groups.get(root)
    if (!g) { g = { wpbl: new Set(), wbsc: [] }; groups.set(root, g) }
    return g
  }
  for (const p of wbscPlayers) group(find(p.id)).wbsc.push(identity(p))
  for (const wpbl of new Set(linkOf.values())) group(find(`wpbl:${wpbl}`)).wpbl.add(wpbl)

  // A join that makes one person two WPBL players, or puts one person in two events of one year
  // (the two groups of a World Cup), is wrong somewhere, and nothing is built.
  for (const g of groups.values()) {
    const names = g.wbsc.map(w => `${w.name} (${w.event_key})`).join(', ')
    if (g.wpbl.size > 1) errors.push(`one person would be ${g.wpbl.size} WPBL players: ${names}`)
    const years = g.wbsc.map(w => w.event_key.slice(0, 4))
    if (new Set(years).size < years.length) errors.push(`one person would play two events in one year: ${names}`)
  }
  if (errors.length) return { people: [], errors }

  const people: Person[] = []
  const withWpbl = new Map<string, WbscIdentity[]>()
  for (const g of groups.values()) {
    const wbsc = g.wbsc.sort(byTournament)
    const [wpbl] = g.wpbl
    if (wpbl) { withWpbl.set(wpbl, wbsc); continue }
    if (!wbsc.length) continue
    people.push({
      id: `person:wbsc:${wbsc[0].wbsc_id.slice('wbsc:p:'.length)}`,
      name: shown.get(latest(wbsc).wbsc_id) ?? latest(wbsc).name, country: latest(wbsc).team_id, wpbl_id: null, wbsc,
    })
  }
  for (const r of roster) {
    const wbsc = withWpbl.get(r.id) ?? []
    people.push({ id: `person:wpbl:${r.id}`, name: r.name, country: wbsc.length ? latest(wbsc).team_id : null, wpbl_id: r.id, wbsc })
  }
  return { people: people.sort((a, b) => cmp(a.id, b.id)), errors }
}

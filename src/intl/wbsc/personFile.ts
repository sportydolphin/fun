// A World Cup player's page file, for every person in the registry who played one and has no WPBL
// page: about 630 of them, most of the World Cup's names. ROADMAP-WOMENS-BASEBALL.md, stage 2.
//
// A WPBL player gets none. Their World Cups are rows on their WPBL page already (player/WorldCup.tsx),
// and one person has one page: every link to them goes there (`PersonLookup.path`).
//
// SLUGS ARE NAMES, made unique the way a reader would tell two people apart: by country first
// ("jia-lee-kor"), and only then by the tournament id the person was first seen under. A slug is the
// name as the latest event writes it, so it can change when a player appears in a new World Cup;
// that is fine while the pages are unpublished, and a redirect's job after.

import type { Person } from '../people'
import type { PitchingGameLine } from '../../league/types'
import type { WbscBattingLine, WbscGame } from './game'
import { sumBatting, sumPitching, type InternationalEvent, type InternationalGame } from './international'

export interface PersonEventInput {
  key: string
  name: string
  year: number
  /** The event's schedule on wbsc.org. */
  source: string
  games: readonly WbscGame[]
  batting: readonly WbscBattingLine[]
  pitching: readonly PitchingGameLine[]
}

export interface WorldCupPersonEvent extends InternationalEvent {
  /** The edition page this event is part of, when it has one. */
  edition: string | null
}

export interface WorldCupPersonFile {
  slug: string
  name: string
  country: string | null
  /** Oldest first; only the events the person played a game in. */
  events: WorldCupPersonEvent[]
}

const slugify = (name: string) => name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** Every World Cup-only person's slug, by person id. */
export function personSlugs(people: readonly Person[]): Map<string, string> {
  const pool = people.filter(p => !p.wpbl_id && p.wbsc.length)
  const base = new Map(pool.map(p => [p.id, slugify(p.name) || p.id.replace(/[^a-z0-9]+/g, '-')]))
  const count = (key: (p: Person) => string) => {
    const n = new Map<string, number>()
    for (const p of pool) n.set(key(p), (n.get(key(p)) ?? 0) + 1)
    return n
  }
  const byName = count(p => base.get(p.id)!)
  const withCountry = (p: Person) => `${base.get(p.id)}-${(p.country ?? 'x').toLowerCase()}`
  const byCountry = count(withCountry)
  const out = new Map<string, string>()
  for (const p of pool) {
    const b = base.get(p.id)!
    if (byName.get(b) === 1) out.set(p.id, b)
    else if (byCountry.get(withCountry(p)) === 1) out.set(p.id, withCountry(p))
    else out.set(p.id, `${withCountry(p)}-${p.wbsc[0].wbsc_id.split(':')[3]}`)
  }
  return out
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

export function buildPersonFile(
  person: Person,
  slug: string,
  events: ReadonlyMap<string, PersonEventInput>,
  editionOf: (eventKey: string) => string | null,
): WorldCupPersonFile {
  const out: WorldCupPersonEvent[] = []
  for (const id of person.wbsc) {
    const ev = events.get(id.event_key)
    if (!ev) continue
    const batting = ev.batting.filter(l => l.player_id === id.wbsc_id)
    const pitching = ev.pitching.filter(l => l.player_id === id.wbsc_id)
    const played = new Set([...batting, ...pitching].map(l => l.game_id))
    if (!played.size) continue
    const team = batting[0]?.team_id ?? pitching[0]?.team_id ?? id.team_id ?? ''
    const games = ev.games.filter(g => played.has(g.id)).map((g): InternationalGame => {
      const home = g.home_team_id === team
      return {
        game_id: g.id, wbsc_game_id: g.wbsc_game_id, game_date: g.game_date,
        opponent_id: home ? g.away_team_id : g.home_team_id, home, url: `${ev.source}/box-score/${g.wbsc_game_id}`,
      }
    }).sort((a, b) => cmp(a.game_date, b.game_date) || a.wbsc_game_id - b.wbsc_game_id)
    out.push({
      event_key: ev.key, event: ev.name, year: ev.year, team_id: team, wbsc_name: person.name, wbsc_id: id.wbsc_id,
      url: ev.source, batting: sumBatting(batting), pitching: sumPitching(pitching), games, edition: editionOf(ev.key),
    })
  }
  out.sort((a, b) => cmp(a.games[0]?.game_date ?? '', b.games[0]?.game_date ?? '') || cmp(a.event_key, b.event_key))
  return { slug, name: person.name, country: person.country, events: out }
}

/** One World Cup-only person in the site search (`world-cup-people.json`): enough for the row, and
 *  nothing the search does not show, so all 630 load in one small read on the search's first use. */
export interface WorldCupSearchPerson {
  slug: string
  name: string
  country: string | null
  /** The editions the person played, by slug (the year it was decided), oldest first. */
  editions: string[]
}

export function searchEntry(file: WorldCupPersonFile): WorldCupSearchPerson {
  const editions = [...new Set(file.events.flatMap(e => (e.edition ? [e.edition] : [])))].sort()
  return { slug: file.slug, name: file.name, country: file.country, editions }
}

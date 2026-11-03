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
  /** Every game the person played in the event, with their line in it, for the page's game log. */
  log: PersonGameLine[]
}

export type Medal = 'gold' | 'silver' | 'bronze'

/** One game of a person's, with the score from their team's side and only the stats a game log
 *  shows. A side is null when the person did not bat, or did not pitch, that game. */
export interface PersonGameLine {
  wbsc_game_id: number
  game_date: string
  opponent_id: string
  home: boolean
  team_score: number
  opponent_score: number
  batting: { ab: number; r: number; h: number; hr: number; rbi: number; bb: number; so: number; sb: number } | null
  pitching: { outs: number; h: number; er: number; bb: number; so: number; decision: string | null } | null
}

export interface WorldCupPersonFile {
  slug: string
  name: string
  country: string | null
  /** Oldest first; only the events the person played a game in. */
  events: WorldCupPersonEvent[]
  /** The position the person played most, as WBSC writes it ("SS"); "P" for one who only pitched.
   *  A pinch hitter's or runner's turn does not count. */
  position: string | null
  /** The medals the person's team won in an edition they played, oldest first. */
  medals: { edition: string; medal: Medal }[]
  /** Whether search engines may list the page (`isIndexable`). The page's robots tag and the
   *  sitemap both read this, once the pages are public. */
  indexable: boolean
}

/**
 * A page worth a search result: two World Cups, or at least 10 plate appearances and batters faced
 * together across them. Below that the page is a name and a line or two, the thin page search
 * engines hold against a whole site, and about 130 of the 630 are that: mostly a pinch runner or a
 * reliever with one or two games. Measured on Nov 3, 2026 over every World Cup since 2016: the
 * median page holds 5 games; at 10 the 136 left out average 3, at 20 half of all pages would be.
 * The page still exists, opens from every link and appears in the site's own search.
 */
export const INDEX_MIN_PA_BF = 10

export function isIndexable(events: readonly WorldCupPersonEvent[]): boolean {
  if (events.length >= 2) return true
  return events.reduce((n, e) => n + (e.batting?.pa ?? 0) + (e.pitching?.bf ?? 0), 0) >= INDEX_MIN_PA_BF
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

/** The position played most, by game. Ties go to the alphabet, so a rebuild cannot flip it. */
function primaryPosition(batting: readonly WbscBattingLine[], pitched: boolean): string | null {
  const n = new Map<string, number>()
  for (const l of batting) {
    const pos = String(l.position ?? '').toUpperCase().split('/').find(p => p && p !== 'PH' && p !== 'PR')
    if (pos) n.set(pos, (n.get(pos) ?? 0) + 1)
  }
  const top = [...n].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0]?.[0]
  return top ?? (pitched ? 'P' : null)
}

export function buildPersonFile(
  person: Person,
  slug: string,
  events: ReadonlyMap<string, PersonEventInput>,
  editionOf: (eventKey: string) => string | null,
  medalOf: (edition: string, team: string) => Medal | null = () => null,
): WorldCupPersonFile {
  const out: WorldCupPersonEvent[] = []
  const allBatting: WbscBattingLine[] = []
  let pitched = false
  for (const id of person.wbsc) {
    const ev = events.get(id.event_key)
    if (!ev) continue
    const batting = ev.batting.filter(l => l.player_id === id.wbsc_id)
    const pitching = ev.pitching.filter(l => l.player_id === id.wbsc_id)
    const played = new Set([...batting, ...pitching].map(l => l.game_id))
    if (!played.size) continue
    const team = batting[0]?.team_id ?? pitching[0]?.team_id ?? id.team_id ?? ''
    allBatting.push(...batting)
    if (pitching.length) pitched = true
    const log = ev.games.filter(g => played.has(g.id)).map((g): PersonGameLine => {
      const home = g.home_team_id === team
      const b = batting.filter(l => l.game_id === g.id)
      const p = pitching.filter(l => l.game_id === g.id)
      const add = <T extends object>(rows: readonly T[], k: keyof T) => rows.reduce((n, r) => n + (Number(r[k]) || 0), 0)
      return {
        wbsc_game_id: g.wbsc_game_id, game_date: g.game_date, opponent_id: home ? g.away_team_id : g.home_team_id, home,
        team_score: (home ? g.home_score : g.away_score) ?? 0, opponent_score: (home ? g.away_score : g.home_score) ?? 0,
        batting: b.length ? {
          ab: add(b, 'ab'), r: add(b, 'r'), h: add(b, 'h'), hr: add(b, 'hr'), rbi: add(b, 'rbi'), bb: add(b, 'bb'), so: add(b, 'so'), sb: add(b, 'sb'),
        } : null,
        pitching: p.length ? {
          outs: add(p, 'outs'), h: add(p, 'h'), er: add(p, 'er'), bb: add(p, 'bb'), so: add(p, 'so'),
          decision: p.find(l => l.decision === 'W' || l.decision === 'L' || l.decision === 'S')?.decision ?? null,
        } : null,
      }
    }).sort((a, b) => cmp(a.game_date, b.game_date) || a.wbsc_game_id - b.wbsc_game_id)
    const games = ev.games.filter(g => played.has(g.id)).map((g): InternationalGame => {
      const home = g.home_team_id === team
      return {
        game_id: g.id, wbsc_game_id: g.wbsc_game_id, game_date: g.game_date,
        opponent_id: home ? g.away_team_id : g.home_team_id, home, url: `${ev.source}/box-score/${g.wbsc_game_id}`,
      }
    }).sort((a, b) => cmp(a.game_date, b.game_date) || a.wbsc_game_id - b.wbsc_game_id)
    out.push({
      event_key: ev.key, event: ev.name, year: ev.year, team_id: team, wbsc_name: person.name, wbsc_id: id.wbsc_id,
      url: ev.source, batting: sumBatting(batting), pitching: sumPitching(pitching), games, edition: editionOf(ev.key), log,
    })
  }
  out.sort((a, b) => cmp(a.games[0]?.game_date ?? '', b.games[0]?.game_date ?? '') || cmp(a.event_key, b.event_key))
  const medals: WorldCupPersonFile['medals'] = []
  for (const e of out) {
    const medal = e.edition ? medalOf(e.edition, e.team_id) : null
    if (medal && e.edition && !medals.some(m => m.edition === e.edition)) medals.push({ edition: e.edition, medal })
  }
  return {
    slug, name: person.name, country: person.country, events: out,
    position: primaryPosition(allBatting, pitched), medals, indexable: isIndexable(out),
  }
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

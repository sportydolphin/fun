// One World Cup edition's leaders, and the WPBL players who played in it. Part of the edition file
// (editions.ts), so it carries the same promise: totals and names only, nothing WBSC wrote in prose.
//
// ONE PERSON, NOT ONE WBSC ID. WBSC numbers a player afresh every event, and an edition can be three
// events (2023's two groups and the 2024 Finals), so lines are summed per person, through the
// registry's joins (people.json), never per id: a player who hit in Group A and in the Finals is one
// row. An id the registry does not know stands for itself.
//
// THE RATE-TITLE BAR IS THE SITE'S OWN, per team game: 2.4 plate appearances and 2.4 outs, MLB's 3.1
// and 1.0 IP scaled to seven innings (`QUALIFY_PA_PER_GAME` in src/wpbl/stats.ts, which this folder
// may not import). Counted on the player's own team's games, since a medalist plays more games
// than a team that went out in the group, and floored as the WPBL's is.

import type { PitchingGameLine } from '../../league/types'
import { WBSC_LEAGUE } from '../league'
import type { WbscBattingLine, WbscGame } from './game'

const PA_PER_TEAM_GAME = 2.4
const OUTS_PER_TEAM_GAME = 2.4
const FLOOR_PA = 6
const FLOOR_OUTS = 9
const TOP = 5

export type BattingStat = 'AVG' | 'OPS' | 'HR' | 'RBI'
export type PitchingStat = 'ERA' | 'SO' | 'W'

export interface LeaderRow {
  name: string
  team: string
  /** The player's page: their WPBL page when the crosswalk links them, else their World Cup one. */
  path: string | null
  wpbl: boolean
  value: number
}

export interface LeaderBoard<S extends string> {
  stat: S
  rows: LeaderRow[]
}

export interface EditionLeaders {
  batting: LeaderBoard<BattingStat>[]
  pitching: LeaderBoard<PitchingStat>[]
}

/** One player's line for the edition, for the team page: every event of the edition summed, one row
 *  per person (the header says why). Counting stats only; the page computes the rates. */
export interface RosterBatting {
  name: string
  path: string | null
  g: number; pa: number; ab: number; r: number; h: number; doubles: number; triples: number; hr: number
  rbi: number; sb: number; bb: number; so: number; hbp: number; sf: number; tb: number
}

export interface RosterPitching {
  name: string
  path: string | null
  g: number; gs: number; w: number; l: number; sv: number; outs: number; h: number; r: number; er: number; bb: number; so: number
}

export interface TeamRoster {
  team: string
  batting: RosterBatting[]
  pitching: RosterPitching[]
}

export interface WpblInField {
  team: string
  players: { name: string; path: string }[]
}

export interface PersonLookup {
  /** The registry's person for a WBSC tournament id. */
  person: (wbscId: string) => string
  /** A WBSC tournament id's WPBL player, from the confirmed crosswalk only. */
  wpbl: (wbscId: string) => { name: string; path: string } | null
  /** The person's name on every page: the registry's (people.json), one for all their events. */
  name: (wbscId: string) => string
  /** The name this event's own rows write (`displayName` of that event's entry), which is how the
   *  play log names a runner, so the play text can be renamed to `name`. */
  eventName: (wbscId: string) => string
  /** The page a WBSC tournament id's person has: WPBL's for a linked player, else
   *  `/world-cup/players/<slug>`. Null with no registry. */
  path: (wbscId: string) => string | null
}

export interface LeaderInput {
  games: readonly WbscGame[]
  batting: readonly WbscBattingLine[]
  pitching: readonly PitchingGameLine[]
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

interface Person { name: string; team: string; path: string | null; wpbl: boolean; latest: string }

export function editionLeaders(input: LeaderInput, people: PersonLookup): { leaders: EditionLeaders; wpbl: WpblInField[]; rosters: TeamRoster[] } {
  const teamGames = new Map<string, number>()
  for (const g of input.games) for (const t of [g.home_team_id, g.away_team_id]) teamGames.set(t, (teamGames.get(t) ?? 0) + 1)
  const gameOrder = new Map(input.games.map(g => [g.id, `${g.start_local}|${String(g.wbsc_game_id).padStart(9, '0')}`]))

  // Who each person is: the WPBL name when linked, else the name from their latest game here.
  const who = new Map<string, Person>()
  const see = (wbscId: string, team: string, gameId: string) => {
    const id = people.person(wbscId)
    const at = gameOrder.get(gameId) ?? ''
    const was = who.get(id)
    const wpbl = people.wpbl(wbscId)
    if (!was || at >= was.latest) {
      who.set(id, {
        name: wpbl?.name ?? (was?.wpbl ? was.name : people.name(wbscId)), team,
        path: wpbl?.path ?? (was?.wpbl ? was.path : people.path(wbscId)), wpbl: !!wpbl || !!was?.wpbl, latest: at,
      })
    } else if (wpbl && !was.wpbl) {
      who.set(id, { ...was, name: wpbl.name, path: wpbl.path, wpbl: true })
    }
  }

  const bat = new Map<string, { pa: number; ab: number; h: number; bb: number; hbp: number; sf: number; tb: number; hr: number; rbi: number }>()
  for (const l of input.batting) {
    see(l.player_id, l.team_id, l.game_id)
    const id = people.person(l.player_id)
    const t = bat.get(id) ?? { pa: 0, ab: 0, h: 0, bb: 0, hbp: 0, sf: 0, tb: 0, hr: 0, rbi: 0 }
    t.pa += l.pa; t.ab += l.ab; t.h += l.h; t.bb += l.bb; t.hbp += l.hbp; t.sf += l.sf; t.tb += l.tb; t.hr += l.hr; t.rbi += l.rbi
    bat.set(id, t)
  }
  const pit = new Map<string, { outs: number; er: number; so: number; w: number }>()
  for (const l of input.pitching) {
    see(l.player_id, l.team_id, l.game_id)
    const id = people.person(l.player_id)
    const t = pit.get(id) ?? { outs: 0, er: 0, so: 0, w: 0 }
    t.outs += l.outs ?? 0; t.er += l.er ?? 0; t.so += l.so ?? 0; t.w += l.decision === 'W' ? 1 : 0
    pit.set(id, t)
  }

  const minPa = (team: string) => Math.max(FLOOR_PA, Math.round(PA_PER_TEAM_GAME * (teamGames.get(team) ?? 0)))
  const minOuts = (team: string) => Math.max(FLOOR_OUTS, Math.round(OUTS_PER_TEAM_GAME * (teamGames.get(team) ?? 0)))

  function board<S extends string, T>(stat: S, totals: Map<string, T>, value: (t: NoInfer<T>) => number | null, keep: (t: NoInfer<T>, team: string) => boolean, low = false): LeaderBoard<S> {
    const rows = [...totals].flatMap(([id, t]) => {
      const p = who.get(id)!
      const v = value(t)
      return v == null || !keep(t, p.team) ? [] : [{ name: p.name, team: p.team, path: p.path, wpbl: p.wpbl, value: v }]
    })
    // Zero is no lead in a counting stat: a board of five players with no home run says nothing.
    const shown = low ? rows : rows.filter(r => r.value > 0)
    shown.sort((a, b) => (low ? a.value - b.value : b.value - a.value) || cmp(a.name, b.name))
    return { stat, rows: shown.slice(0, TOP) }
  }

  const obp = (t: { h: number; bb: number; hbp: number; ab: number; sf: number }) => {
    const d = t.ab + t.bb + t.hbp + t.sf
    return d > 0 ? (t.h + t.bb + t.hbp) / d : null
  }
  const qualified = (t: { pa: number }, team: string) => t.pa >= minPa(team)
  const any = () => true
  const leaders: EditionLeaders = {
    batting: [
      board('AVG' as const, bat, t => (t.ab > 0 ? t.h / t.ab : null), qualified),
      board('OPS' as const, bat, t => { const o = obp(t); return o == null || t.ab === 0 ? null : o + t.tb / t.ab }, qualified),
      board('HR' as const, bat, t => t.hr, any),
      board('RBI' as const, bat, t => t.rbi, any),
    ],
    pitching: [
      // Per seven innings, the World Cup's own game, as everything WBSC publishes is.
      board('ERA' as const, pit, t => (t.outs > 0 ? (t.er * WBSC_LEAGUE.regulationInnings * 3) / t.outs : null), (t, team) => t.outs >= minOuts(team), true),
      board('SO' as const, pit, t => t.so, any),
      board('W' as const, pit, t => t.w, any),
    ],
  }

  const byTeam = new Map<string, Map<string, { name: string; path: string }>>()
  for (const p of who.values()) {
    if (!p.wpbl || !p.path) continue
    const players = byTeam.get(p.team) ?? new Map()
    players.set(p.path, { name: p.name, path: p.path })
    byTeam.set(p.team, players)
  }
  const wpbl = [...byTeam].map(([team, ps]) => ({ team, players: [...ps.values()].sort((a, b) => cmp(a.name, b.name)) }))
    .sort((a, b) => b.players.length - a.players.length || cmp(a.team, b.team))
  // Keyed by person AND team: a person plays for one country in an edition, but nothing here should
  // merge two teams' lines if the registry ever joined two people by mistake.
  const rosterBat = new Map<string, RosterBatting & { team: string; games: Set<string> }>()
  for (const l of input.batting) {
    const id = people.person(l.player_id)
    const key = `${id}|${l.team_id}`
    const p = who.get(id)!
    const t = rosterBat.get(key) ?? {
      team: l.team_id, games: new Set<string>(), name: p.name, path: p.path,
      g: 0, pa: 0, ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, sb: 0, bb: 0, so: 0, hbp: 0, sf: 0, tb: 0,
    }
    t.games.add(l.game_id)
    t.pa += l.pa; t.ab += l.ab; t.r += l.r; t.h += l.h; t.doubles += l.doubles; t.triples += l.triples; t.hr += l.hr
    t.rbi += l.rbi; t.sb += l.sb; t.bb += l.bb; t.so += l.so; t.hbp += l.hbp; t.sf += l.sf; t.tb += l.tb
    rosterBat.set(key, t)
  }
  const rosterPit = new Map<string, RosterPitching & { team: string; games: Set<string> }>()
  for (const l of input.pitching) {
    if (!l.team_id) continue
    const id = people.person(l.player_id)
    const key = `${id}|${l.team_id}`
    const p = who.get(id)!
    const t = rosterPit.get(key) ?? {
      team: l.team_id, games: new Set<string>(), name: p.name, path: p.path,
      g: 0, gs: 0, w: 0, l: 0, sv: 0, outs: 0, h: 0, r: 0, er: 0, bb: 0, so: 0,
    }
    t.games.add(l.game_id)
    t.gs += l.gs ?? 0; t.w += l.decision === 'W' ? 1 : 0; t.l += l.decision === 'L' ? 1 : 0; t.sv += l.decision === 'S' ? 1 : 0
    t.outs += l.outs ?? 0; t.h += l.h; t.r += l.r; t.er += l.er ?? 0; t.bb += l.bb; t.so += l.so
    rosterPit.set(key, t)
  }
  const teamsSeen = new Set([...rosterBat.values(), ...rosterPit.values()].map(t => t.team))
  const strip = <T extends { team: string; games: Set<string>; g: number }>({ team: _t, games, ...rest }: T) => ({ ...rest, g: games.size })
  const rosters: TeamRoster[] = [...teamsSeen].sort(cmp).map(team => ({
    team,
    batting: [...rosterBat.values()].filter(t => t.team === team).map(strip)
      .sort((a, b) => b.pa - a.pa || cmp(a.name, b.name)) as RosterBatting[],
    pitching: [...rosterPit.values()].filter(t => t.team === team).map(strip)
      .sort((a, b) => b.outs - a.outs || cmp(a.name, b.name)) as RosterPitching[],
  }))
  return { leaders, wpbl, rosters }
}

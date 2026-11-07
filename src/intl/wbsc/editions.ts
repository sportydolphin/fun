// The World Cup as editions, and the files its pages read. See ROADMAP-WOMENS-BASEBALL.md, stage 2.
//
// AN EDITION IS NOT AN EVENT. WBSC files each World Cup as one event (2016, 2018) or, since the
// IX, as several: two group stages one summer and the Finals the next (2023 Groups A and B, then
// the 2024 Finals). A reader asks for "the 2024 World Cup", so the pages are per edition, named
// by the year its champion is decided, which is also the year the roadmap gives the 2027 Finals
// (`/world-cup/2027`). Which events make an edition is written down here, not guessed from keys.
//
// WHAT GOES INTO THESE FILES IS WHAT GETS PUBLISHED. The importer's archive keeps everything it
// validated, WBSC's scorer sentences included; these files carry results and records only, built
// from an allow-list, so publishing them later is publishing exactly this.

import type { PitchingGameLine } from '../../league/types'
import { editionLeaders, type EditionLeaders, type PersonLookup, type TeamRoster, type WpblInField } from './editionLeaders'
import type { WbscBattingLine, WbscGame } from './game'
import { boxScoreUrl } from './ibaf'

export interface EditionEventDef {
  key: string
  /** A group stage of its own ("Group A", "Rockford"); null when the event is the whole edition or
   *  its Finals, whose rounds name themselves. */
  label: string | null
}

export interface EditionDef {
  /** The URL segment: the year the champion is decided. */
  slug: string
  /** WBSC's numbering, from the IX on, when the events start carrying it. */
  ordinal: string | null
  years: number[]
  hosts: string[]
  events: EditionEventDef[]
  /** WBSC's letter for each group of an Opening Round its schedule leaves unlabeled (2016 and 2018),
   *  by the teams in it, as its standings page has them. A group matching no letter fails the build. */
  groupLetters?: Readonly<Record<string, readonly string[]>>
  /** Games awarded by forfeit, which the importer skips (no status, no box score) and WBSC's
   *  standings count, at the score WBSC records. Each from the event's schedule. */
  forfeits?: readonly ForfeitDef[]
  /** WBSC's Final Standings, first place first, as its standings page has them. Not derived: from
   *  the 2024 Finals on WBSC ranks only the teams in the Finals, and how it places the rest has no
   *  rule its pages state. The first three must be the medalists, or the build fails. */
  placings?: readonly string[]
  /** Rounds of this edition that are single games, not a table, beyond the ones every edition
   *  plays that way (KNOCKOUT_ROUNDS). 2012's "Consolation 5th-8th" is two crossover games where
   *  2014's is a round robin under the same name. */
  knockout?: readonly string[]
}

export interface ForfeitDef {
  event: string
  wbsc_game_id: number
  date: string
  round: string
  away: string
  home: string
  away_score: number
  home_score: number
}

/** Oldest first. A new edition is a new entry, written when WBSC announces its events. */
export const EDITIONS: readonly EditionDef[] = [
  // 2004 to 2008: results only, from IBAF's compendium (compendium.ts). Its placings are the
  // compendium's final standings, which wbsc.org's standings pages repeat.
  {
    slug: '2004', ordinal: null, years: [2004], hosts: ['Edmonton, Canada'],
    events: [{ key: '2004-womens-baseball-world-cup', label: null }],
    placings: ['USA', 'JPN', 'CAN', 'AUS', 'TPE'],
  },
  {
    // One round robin and no medal games: the table decided the medals.
    slug: '2006', ordinal: null, years: [2006], hosts: ['Taipei, Taiwan'],
    events: [{ key: '2006-womens-baseball-world-cup', label: null }],
    placings: ['USA', 'JPN', 'CAN', 'AUS', 'TPE', 'CUB', 'HKG'],
  },
  {
    slug: '2008', ordinal: null, years: [2008], hosts: ['Matsuyama, Japan'],
    events: [{ key: '2008-womens-baseball-world-cup', label: null }],
    // Pools A and B in the first round, 1 and 2 in the second, as the compendium names them.
    groupLetters: {
      A: ['AUS', 'IND', 'TPE', 'USA'], B: ['CAN', 'HKG', 'JPN', 'KOR'],
      1: ['HKG', 'IND', 'KOR', 'TPE'], 2: ['AUS', 'CAN', 'JPN', 'USA'],
    },
    placings: ['JPN', 'CAN', 'USA', 'AUS', 'TPE', 'KOR', 'IND', 'HKG'],
  },
  {
    // IBAF's, from its own stats pages (ibaf.ts); wbsc.org keeps a standings page and no games.
    slug: '2010', ordinal: null, years: [2010], hosts: ['Maracay, Venezuela'],
    events: [{ key: '2010-womens-baseball-world-cup', label: null }],
    // Pools A and B in Round 1, C and D in Round 2, as IBAF's schedule named them.
    groupLetters: {
      A: ['AUS', 'CAN', 'HKG', 'NED', 'TPE', 'VEN'], B: ['CUB', 'JPN', 'KOR', 'PUR', 'USA'],
      C: ['AUS', 'CAN', 'CUB', 'JPN', 'USA', 'VEN'], D: ['KOR', 'NED', 'PUR', 'TPE'],
    },
    // No standings page lists them, so they are the games that decided them: the final, the bronze
    // game, the 5th, 7th and 9th place games, and Hong Kong last, having withdrawn after one game.
    placings: ['JPN', 'AUS', 'USA', 'VEN', 'CAN', 'CUB', 'TPE', 'PUR', 'KOR', 'NED', 'HKG'],
  },
  {
    slug: '2012', ordinal: null, years: [2012], hosts: ['Edmonton, Canada'],
    events: [{ key: '2012-womens-baseball-world-cup', label: null }],
    knockout: ['Consolation 5th-8th'],
    // wbsc.org/en/events/2012-womens-baseball-world-cup/standings
    placings: ['JPN', 'USA', 'CAN', 'AUS', 'VEN', 'TPE', 'NED', 'CUB'],
  },
  {
    slug: '2014', ordinal: null, years: [2014], hosts: ['Miyazaki, Japan'],
    events: [{ key: '2014-womens-baseball-world-cup', label: null }],
    // wbsc.org/en/events/2014-womens-baseball-world-cup/standings
    groupLetters: { A: ['JPN', 'AUS', 'VEN', 'HKG'], B: ['USA', 'CAN', 'TPE', 'NED'] },
    placings: ['JPN', 'USA', 'AUS', 'CAN', 'TPE', 'VEN', 'HKG', 'NED'],
  },
  {
    slug: '2016', ordinal: null, years: [2016], hosts: ['Gijang, Korea'],
    events: [{ key: '2016-womens-baseball-world-cup', label: null }],
    // wbsc.org/en/events/2016-womens-baseball-world-cup/standings
    groupLetters: { A: ['VEN', 'KOR', 'CUB', 'PAK'], B: ['JPN', 'CAN', 'NED', 'IND'], C: ['TPE', 'AUS', 'USA', 'HKG'] },
    placings: ['JPN', 'CAN', 'VEN', 'TPE', 'AUS', 'KOR', 'USA', 'CUB', 'NED', 'HKG', 'IND', 'PAK'],
  },
  {
    slug: '2018', ordinal: null, years: [2018], hosts: ['Viera, Florida'],
    events: [{ key: '2018-womens-baseball-world-cup', label: null }],
    // wbsc.org/en/events/2018-womens-baseball-world-cup/standings
    groupLetters: { A: ['TPE', 'USA', 'VEN', 'PUR', 'KOR', 'NED'], B: ['JPN', 'CAN', 'DOM', 'AUS', 'HKG', 'CUB'] },
    placings: ['JPN', 'TPE', 'CAN', 'USA', 'VEN', 'DOM', 'AUS', 'CUB', 'PUR', 'KOR', 'HKG', 'NED'],
  },
  {
    slug: '2024', ordinal: 'IX', years: [2023, 2024], hosts: ['Thunder Bay, Canada', 'Miyoshi, Japan'],
    events: [
      { key: '2023-ix-womens-baseball-world-cup-group-a', label: 'Group A' },
      { key: '2023-ix-womens-baseball-world-cup-group-b', label: 'Group B' },
      { key: '2024-ix-womens-baseball-world-cup-finals', label: null },
    ],
    // Venezuela forfeited its last game; the schedule has it as USA 7, Venezuela 0, no innings.
    forfeits: [{
      event: '2024-ix-womens-baseball-world-cup-finals', wbsc_game_id: 131780, date: '2024-07-28', round: 'Final Stage Games',
      away: 'USA', home: 'VEN', away_score: 7, home_score: 0,
    }],
    // wbsc.org/en/events/2024-ix-womens-baseball-world-cup-finals/standings: the six in the Finals.
    placings: ['JPN', 'USA', 'CAN', 'MEX', 'VEN', 'TPE'],
  },
  {
    // The Finals (Rockford, Jul 19–25, 2027) join as a third event once WBSC publishes them.
    slug: '2027', ordinal: 'X', years: [2026, 2027], hosts: ['Rockford, Illinois', 'Tainan, Taiwan'],
    events: [
      { key: '2026-x-womens-baseball-world-cup-group-stage-rockford', label: 'Rockford' },
      { key: '2026-x-womens-baseball-world-cup-group-stage-tainan', label: 'Tainan' },
    ],
  },
]

export const editionTitle = (slug: string): string => `${slug} World Cup`

/** The edition an event belongs to, for a link to its page. */
export const editionSlugOf = (eventKey: string): string | null =>
  EDITIONS.find(e => e.events.some(ev => ev.key === eventKey))?.slug ?? null

// ── The files ───────────────────────────────────────────────────────────────────

export interface WorldCupGame {
  id: string
  /** The game page's id, `/world-cup/<edition>/games/<this>`. */
  wbsc_game_id: number
  date: string
  away: string
  home: string
  away_score: number
  home_score: number
  /** Below seven for a game ended by the run rule; 0 for a forfeit; null where the source has
   *  only the score (2004 to 2008). */
  innings: number | null
  forfeit: boolean
  /** Whether the game has a page: a box score to draw. Not a forfeit's, nor a results-only game's. */
  page: boolean
  /** The box score on wbsc.org, which every result links to; the schedule for a forfeit, the
   *  compendium's page for a results-only game. */
  url: string
}

export interface StandingRow {
  team: string
  w: number
  l: number
  rs: number
  ra: number
}

export interface WorldCupGroup {
  /** Null when the stage is one group. */
  label: string | null
  /** WBSC's standings: this stage's games plus, for a later round, the earlier rounds' games between
   *  two teams in it, which WBSC carries over. Ties go by the games between the tied teams, then by
   *  their Team Quality Balance in those games (`standings`). */
  standings: StandingRow[]
  games: WorldCupGame[]
}

export interface WorldCupStage {
  label: string
  kind: 'round-robin' | 'knockout' | 'medal'
  groups: WorldCupGroup[]
}

export interface Medals { gold: string; silver: string; bronze: string | null }

export interface WorldCupEdition {
  slug: string
  title: string
  ordinal: string | null
  years: number[]
  hosts: string[]
  teams: string[]
  stages: WorldCupStage[]
  /** Null until the final is played. */
  medals: Medals | null
  /** WBSC's Final Standings, first place first; empty until it publishes them. May stop short of
   *  every team (2024 ranks the Finals' six). */
  placings: string[]
  /** Each event's schedule on wbsc.org. */
  sources: string[]
  leaders: EditionLeaders
  /** The WPBL players in the field, by national team, most first. */
  wpbl: WpblInField[]
  /** Every team's players with their edition totals, for the team pages. */
  rosters: TeamRoster[]
}

export interface WorldCupIndexEntry {
  slug: string
  title: string
  years: number[]
  hosts: string[]
  teams: number
  /** The teams by IOC code, for the search's team rows. Optional only so a file built before it
   *  existed still reads. */
  team_ids?: string[]
  games: number
  medals: Medals | null
}

export interface EditionEventInput {
  key: string
  /** The event's schedule on wbsc.org. */
  source: string
  games: readonly WbscGame[]
  batting: readonly WbscBattingLine[]
  pitching: readonly PitchingGameLine[]
  /** Scores and nothing else (2004 to 2008, compendium.ts): no box scores, so no game pages. */
  results_only?: boolean
}

/** With no registry, every WBSC id is its own person, linked to nobody, named by its id. */
export const NO_PEOPLE: PersonLookup = { person: id => id, wpbl: () => null, name: id => id, eventName: id => id, path: () => null }

export interface WorldCupSite {
  index: WorldCupIndexEntry[]
  editions: WorldCupEdition[]
  /** Why nothing was built. Empty on success. */
  errors: string[]
}

// 2012 and 2014 name the two medal games "Gold" and "Bronze".
const MEDAL_ROUNDS = new Set(['Bronze Medal Game', 'World Championship Final', 'Bronze', 'Gold'])
const isFinalRound = (r: string | null) => r === 'World Championship Final' || r === 'Gold'
const isBronzeRound = (r: string | null) => r === 'Bronze Medal Game' || r === 'Bronze'

/** WBSC's round strings that mean one round: a 2014 game filed under "Round1", and the 5th and 7th
 *  place games, which read as one round of placement games. */
const ROUND_ALIAS: Readonly<Record<string, string>> = {
  'Round1': 'Round 1',
  '5th Place Game': 'Placement games',
  '7th Place Game': 'Placement games',
  '9th Place Game': 'Placement games',
}

/** Rounds that are single games, drawn as a list with no table. */
const KNOCKOUT_ROUNDS = new Set(['Semifinals', 'Placement games'])

/** WBSC's round labels, as a reader would name them. Anything unknown fails the build. */
const ROUND_LABEL: Readonly<Record<string, string>> = {
  'Opening Round': 'Opening Round',
  'Super Round': 'Super Round',
  'Consolation Round': 'Consolation Round',
  'Group Stage Games': 'Group stage',
  'Final Stage Games': 'Finals',
  'Bronze Medal Game': 'Medal games',
  'World Championship Final': 'Medal games',
  // 2012 and 2014.
  'Round 1': 'Opening Round',
  'Round 2': 'Round 2',
  // 2006, its only round.
  'Round Robin': 'Round robin',
  'Consolation 5th-8th': 'Consolation Round',
  'Semifinals': 'Semifinals',
  'Placement games': 'Placement games',
  'Bronze': 'Medal games',
  'Gold': 'Medal games',
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const byDate = (a: WbscGame, b: WbscGame) => cmp(a.start_local, b.start_local) || a.wbsc_game_id - b.wbsc_game_id

const forfeitGame = (f: ForfeitDef): WbscGame => ({
  id: `wbsc:forfeit:${f.wbsc_game_id}`, wbsc_game_id: f.wbsc_game_id, event_key: f.event, game_date: f.date, status: 'final',
  away_team_id: f.away, home_team_id: f.home, away_score: f.away_score, home_score: f.home_score, round: f.round,
  start_local: `${f.date} 00:00:00`, timezone: null, innings: 0, venue: null, city: null, attendance: null,
  duration_minutes: null, home_hits: 0, away_hits: 0, home_errors: 0, away_errors: 0,
})

function summary(g: WbscGame, ev: EditionEventInput): WorldCupGame {
  const base = { id: g.id, wbsc_game_id: g.wbsc_game_id, date: g.game_date, away: g.away_team_id, home: g.home_team_id,
    away_score: g.away_score ?? 0, home_score: g.home_score ?? 0 }
  // The compendium's rows carry 0 innings because it has none to give; they are not forfeits.
  if (ev.results_only) return { ...base, innings: null, forfeit: false, page: false, url: ev.source }
  // A game played has at least one inning; a forfeit, none.
  const forfeit = g.innings === 0
  return { ...base, innings: g.innings, forfeit, page: !forfeit, url: forfeit ? ev.source : boxScoreUrl(ev.source, g.wbsc_game_id) }
}

/** A team's innings at bat in one game: the outs the other side's pitchers got, over three. */
type InningsAtBat = (game: WbscGame, team: string) => number

/**
 * Ordered as WBSC orders a standings table: by winning percentage, then among the teams level on it
 * by their record in the games between them, then by Team Quality Balance in those same games (runs
 * scored per inning at bat less runs allowed per inning in the field). Ties past that are left in
 * code order; WBSC goes on to earned runs and batting average, which has not yet been needed.
 */
export function standings(games: readonly WbscGame[], atBat: InningsAtBat, placings: readonly string[] = []): StandingRow[] {
  const rows = new Map<string, StandingRow>()
  const row = (team: string) => rows.get(team) ?? rows.set(team, { team, w: 0, l: 0, rs: 0, ra: 0 }).get(team)!
  for (const g of games) {
    const [a, h] = [row(g.away_team_id), row(g.home_team_id)]
    const [as, hs] = [g.away_score ?? 0, g.home_score ?? 0]
    a.rs += as; a.ra += hs; h.rs += hs; h.ra += as
    if (as > hs) { a.w++; h.l++ } else if (hs > as) { h.w++; a.l++ }
  }
  const pct = (r: StandingRow) => (r.w + r.l ? r.w / (r.w + r.l) : 0)
  const byPct = new Map<number, StandingRow[]>()
  for (const r of rows.values()) byPct.set(pct(r), [...(byPct.get(pct(r)) ?? []), r])
  return [...byPct.entries()].sort((x, y) => y[0] - x[0]).flatMap(([, tied]) => {
    if (tied.length === 1) return tied
    const ids = new Set(tied.map(r => r.team))
    const h2h = new Map(tied.map(r => [r.team, { w: 0, rs: 0, ra: 0, bat: 0, field: 0 }]))
    for (const g of games) {
      if (!ids.has(g.away_team_id) || !ids.has(g.home_team_id)) continue
      const [as, hs] = [g.away_score ?? 0, g.home_score ?? 0]
      const a = h2h.get(g.away_team_id)!, h = h2h.get(g.home_team_id)!
      if (as > hs) a.w++; else if (hs > as) h.w++
      const [aBat, hBat] = [atBat(g, g.away_team_id), atBat(g, g.home_team_id)]
      a.rs += as; a.ra += hs; a.bat += aBat; a.field += hBat
      h.rs += hs; h.ra += as; h.bat += hBat; h.field += aBat
    }
    const tqb = (t: string) => {
      const x = h2h.get(t)!
      return (x.bat ? x.rs / x.bat : 0) - (x.field ? x.ra / x.field : 0)
    }
    // With no innings (2004 to 2008 have scores alone) Team Quality Balance is 0 for everyone, so
    // the final standings decide, as they decide the compendium's own tables.
    const placed = (t: string) => (placings.includes(t) ? placings.indexOf(t) : placings.length)
    return [...tied].sort((x, y) => h2h.get(y.team)!.w - h2h.get(x.team)!.w || tqb(y.team) - tqb(x.team) || placed(x.team) - placed(y.team) || cmp(x.team, y.team))
  })
}

/**
 * The groups inside one round: the teams that played each other. WBSC's 2016 and 2018 schedules
 * carry no group label, so a round of several groups is split by who played whom, and lettered from
 * the edition's `groupLetters`. Lettering them in the order they first took the field, as this did
 * until Nov 2, 2026, got both editions wrong.
 */
function splitGroups(games: readonly WbscGame[]): WbscGame[][] {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    const p = parent.get(x) ?? x
    if (p === x) return x
    const root = find(p)
    parent.set(x, root)
    return root
  }
  for (const g of games) {
    const [a, b] = [find(g.away_team_id), find(g.home_team_id)]
    if (a !== b) parent.set(a, b)
  }
  const groups = new Map<string, WbscGame[]>()
  for (const g of [...games].sort(byDate)) {
    const root = find(g.home_team_id)
    groups.set(root, [...(groups.get(root) ?? []), g])
  }
  return [...groups.values()]
}

/**
 * Pieces of one group put back together. A group whose games are not all played can fall apart by
 * the games alone: 2008's second-round Pool 1 lost Korea v Chinese Taipei and Hong Kong v India to
 * rain, which left two pairs that never met. Pieces that fit inside the same listed group, and
 * cover it between them, are that group.
 */
function mergeByLetter(def: EditionDef, groups: WbscGame[][]): WbscGame[][] {
  if (!def.groupLetters || groups.length < 2) return groups
  const teamsOf = (gs: readonly WbscGame[]) => new Set(gs.flatMap(g => [g.away_team_id, g.home_team_id]))
  const out: WbscGame[][] = []
  const used = new Set<number>()
  for (const ts of Object.values(def.groupLetters)) {
    const inside = groups.map((gs, i) => [gs, i] as const).filter(([gs, i]) => !used.has(i) && [...teamsOf(gs)].every(t => ts.includes(t)))
    const covered = new Set(inside.flatMap(([gs]) => [...teamsOf(gs)]))
    if (inside.length < 2 || covered.size !== ts.length) continue
    for (const [, i] of inside) used.add(i)
    out.push(inside.flatMap(([gs]) => gs).sort(byDate))
  }
  return out.length ? [...out, ...groups.filter((_, i) => !used.has(i))] : groups
}

/** A group's letter from the edition's list, by its teams; null when the round is one group. */
function letterOf(def: EditionDef, games: readonly WbscGame[], groups: number): string | null | undefined {
  if (groups < 2) return null
  const teams = new Set(games.flatMap(g => [g.away_team_id, g.home_team_id]))
  const hit = Object.entries(def.groupLetters ?? {}).find(([, ts]) => ts.length === teams.size && ts.every(t => teams.has(t)))
  return hit?.[0]
}

export function buildWorldCupSite(
  events: readonly EditionEventInput[],
  { people = NO_PEOPLE, editions = EDITIONS }: { people?: PersonLookup; editions?: readonly EditionDef[] } = {},
): WorldCupSite {
  const errors: string[] = []
  const byKey = new Map(events.map(e => [e.key, e]))
  const built: WorldCupEdition[] = []

  for (const def of editions) {
    const present = def.events.filter(e => byKey.has(e.key))
    if (!present.length) continue
    if (present.length < def.events.length) {
      errors.push(`${def.slug}: ${def.events.filter(e => !byKey.has(e.key)).map(e => e.key).join(', ')} not imported`)
      continue
    }
    const stages: WorldCupStage[] = []
    const medalGames: WbscGame[] = []
    const sources: string[] = []
    const teams = new Set<string>()
    const groupStage: WorldCupGroup[] = []
    for (const evDef of def.events) {
      const ev = byKey.get(evDef.key)!
      sources.push(ev.source)
      const games = [...ev.games, ...(def.forfeits ?? []).filter(f => f.event === ev.key).map(forfeitGame)]
        .map(g => (g.round && ROUND_ALIAS[g.round] ? { ...g, round: ROUND_ALIAS[g.round] } : g))
      for (const g of games) { teams.add(g.home_team_id); teams.add(g.away_team_id) }
      const unknown = [...new Set(games.map(g => g.round ?? ''))].filter(r => !ROUND_LABEL[r])
      if (unknown.length) { errors.push(`${ev.key}: unknown round ${unknown.map(r => `"${r}"`).join(', ')}`); continue }

      const rounds = new Map<string, WbscGame[]>()
      for (const g of [...games].sort(byDate)) {
        if (MEDAL_ROUNDS.has(g.round ?? '')) { medalGames.push(g); continue }
        rounds.set(g.round!, [...(rounds.get(g.round!) ?? []), g])
      }
      // Innings at bat, from the other side's pitching lines, for the tie-break.
      const outs = new Map<string, number>()
      for (const p of ev.pitching) outs.set(`${p.game_id}|${p.team_id}`, (outs.get(`${p.game_id}|${p.team_id}`) ?? 0) + p.outs)
      const atBat: InningsAtBat = (g, team) =>
        (outs.get(`${g.id}|${team === g.home_team_id ? g.away_team_id : g.home_team_id}`) ?? 0) / 3
      const earlier: WbscGame[] = []
      for (const [round, games] of rounds) {
        if (KNOCKOUT_ROUNDS.has(round) || def.knockout?.includes(round)) {
          stages.push({ label: ROUND_LABEL[round], kind: 'knockout', groups: [{ label: null, standings: [], games: games.map(g => summary(g, ev)) }] })
          continue
        }
        const split = mergeByLetter(def, splitGroups(games))
        const groups: WorldCupGroup[] = []
        for (const gs of split) {
          const letter = evDef.label ? null : letterOf(def, gs, split.length)
          const teamsIn = new Set(gs.flatMap(g => [g.away_team_id, g.home_team_id]))
          if (letter === undefined) {
            errors.push(`${ev.key}: a ${round} group (${[...teamsIn].sort(cmp).join(', ')}) has no letter in EDITIONS`)
            continue
          }
          const carried = earlier.filter(g => teamsIn.has(g.away_team_id) && teamsIn.has(g.home_team_id))
          groups.push({
            label: evDef.label ?? (letter ? `Group ${letter}` : null),
            standings: standings([...carried, ...gs], atBat, def.placings),
            games: gs.map(g => summary(g, ev)),
          })
        }
        groups.sort((a, b) => cmp(a.label ?? '', b.label ?? ''))
        earlier.push(...games)
        // An event that is one group stage of several is a group of the edition's group stage.
        if (evDef.label) groupStage.push(...groups)
        else stages.push({ label: ROUND_LABEL[round], kind: 'round-robin', groups })
      }
    }
    if (groupStage.length) stages.unshift({ label: 'Group stage', kind: 'round-robin', groups: groupStage })

    let medals: Medals | null = null
    if (medalGames.length) {
      const sorted = medalGames.sort(byDate)
      const winner = (g: WbscGame) => ((g.home_score ?? 0) > (g.away_score ?? 0) ? g.home_team_id : g.away_team_id)
      const loser = (g: WbscGame) => (winner(g) === g.home_team_id ? g.away_team_id : g.home_team_id)
      const final = sorted.find(g => isFinalRound(g.round))
      const bronze = sorted.find(g => isBronzeRound(g.round))
      if (final) medals = { gold: winner(final), silver: loser(final), bronze: bronze ? winner(bronze) : null }
      const ev = def.events.map(e => byKey.get(e.key)!).find(e => e.games.includes(sorted[0]))!
      stages.push({ label: 'Medal games', kind: 'medal', groups: [{ label: null, standings: [], games: sorted.map(g => summary(g, ev)) }] })
    } else if (def.placings && def.placings.length >= 3 && stages.length) {
      // An edition with no medal games (2006, one round robin) gave its medals by the table.
      const [gold, silver, bronze] = def.placings
      medals = { gold, silver, bronze }
    }

    const placings = [...(def.placings ?? [])]
    if (placings.length) {
      const top = medals ? [medals.gold, medals.silver, medals.bronze] : []
      if (top.some((t, i) => t !== placings[i])) errors.push(`${def.slug}: placings ${placings.slice(0, 3).join(', ')} are not the medalists`)
      const unknownTeams = placings.filter(t => !teams.has(t))
      if (unknownTeams.length || new Set(placings).size < placings.length) errors.push(`${def.slug}: placings name ${unknownTeams.join(', ') || 'a team twice'}`)
    }

    const evs = def.events.map(e => byKey.get(e.key)!)
    const { leaders, wpbl, rosters } = editionLeaders({
      games: evs.flatMap(e => e.games), batting: evs.flatMap(e => e.batting), pitching: evs.flatMap(e => e.pitching),
    }, people)
    built.push({
      slug: def.slug, title: editionTitle(def.slug), ordinal: def.ordinal, years: def.years, hosts: def.hosts,
      teams: [...teams].sort(cmp), stages, medals, placings, sources, leaders, wpbl, rosters,
    })
  }

  if (errors.length) return { index: [], editions: [], errors }
  const index = built.map((e): WorldCupIndexEntry => ({
    slug: e.slug, title: e.title, years: e.years, hosts: e.hosts, teams: e.teams.length, team_ids: e.teams,
    games: e.stages.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.games.filter(x => !x.forfeit).length, 0), 0),
    medals: e.medals,
  }))
  // Newest first on the index: the edition being played is the one a reader came for.
  return { index: index.reverse(), editions: built, errors }
}

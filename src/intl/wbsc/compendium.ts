// The 2004, 2006 and 2008 World Cups from IBAF's 2004 to 2010 compendium: results, rosters and
// awards, with no box scores. See "2004 to 2008, results only" in docs/WBSC_INGEST.md.
//
// No box score survives for most of these games: wbsc.org keeps a standings page per edition, and
// the only box scores anywhere are Canada's, on baseball.ca. What does survive is Oscar Izaguirre's
// compendium for IBAF, which lists every game (number, date, start, park, teams, final score) and
// every round's standings. Its tables are a PDF's text in columns, so they were transcribed once
// into a JSON file beside the PDF in the cache, in the shape of `CompendiumFile`. This file reads
// that transcription and checks it two ways before anything is built from it:
//
// - every round's standings, recomputed from the games as editions.ts computes them (a later round
//   carries over the earlier games between two teams in it), must equal the compendium's own table,
//   wins, losses, runs scored and runs allowed, team by team; a mistyped score breaks two rows.
// - the shape: known teams, known rounds, game numbers 1 to N each once, a winner in every game.
//
// Canada's box scores (2006: 4 games, 2008: 6) and USA Baseball's 2004 releases agree with every
// score they cover; that was checked by hand on Nov 7, 2026, as they are PDFs too.
//
// A results-only game has no line score, hits, errors or innings in the source. Its row carries 0
// for each, and the event's manifest says `results_only`, which is what keeps the site from
// showing those zeros or drawing a game page for it.

import { displayName, type WbscGame, type WbscPlayer } from './game'

/** The compendium in the Wayback Machine. Each edition links to its own page of results. */
export const COMPENDIUM_PDF =
  'https://web.archive.org/web/2012/http://www.ibaf.org/doc/2cfcc351-53f6-4397-a2f9-6ce439901805/2010%20-%20Mundial%20Femenino%20-%20Estadi%CC%81sticas.pdf'

/** The PDF page where each edition's results start. */
const RESULTS_PAGE: Readonly<Record<number, number>> = { 2004: 3, 2006: 8, 2008: 13 }


export const compendiumUrl = (year: number): string => `${COMPENDIUM_PDF}#page=${RESULTS_PAGE[year]}`

/** The edition a compendium link is for, or null for any other link. */
export function compendiumYearOf(url: string): number | null {
  if (!url.startsWith(COMPENDIUM_PDF)) return null
  const page = Number(url.split('#page=')[1])
  const hit = Object.entries(RESULTS_PAGE).find(([, p]) => p === page)
  return hit ? Number(hit[0]) : null
}

/** A game's id: the year, then the compendium's game number, as ibaf.ts numbers 2010. */
export const compendiumGameId = (year: number, gameNumber: number): number => year * 1000 + gameNumber

/** The round names the compendium's sections map to, in editions.ts's vocabulary. */
const ROUNDS = new Set(['Opening Round', 'Round Robin', 'Round 2', 'Semifinals', '5th Place Game', '7th Place Game', 'Bronze', 'Gold'])

const TEAMS = new Set(['AUS', 'CAN', 'CUB', 'HKG', 'IND', 'JPN', 'KOR', 'TPE', 'USA'])

export interface CompendiumGame {
  n: number
  /** YYYY-MM-DD, local. */
  date: string
  /** HH:MM, local. */
  time: string
  venue: string
  round: string
  away: string
  home: string
  away_score: number
  home_score: number
}

/** One standings table as the compendium prints it. `group` is null for a round of one table. */
export interface CompendiumTable {
  round: string
  group: string | null
  /** [team, wins, losses, runs scored, runs allowed] */
  rows: [string, number, number, number, number][]
}

/** One team's roster as the compendium prints it: players with a position where it gives one
 *  (2004's Canada and Japan have none), then the staff. */
export interface CompendiumRoster {
  team: string
  /** India's and Korea's 2008 rosters write the surname first ("Park Jeong Hee"), as no other does. */
  surname_first?: boolean
  players: { name: string; position: string | null }[]
  staff: { name: string; role: string }[]
}

/** A name as an award prints it. `roster` is the roster's spelling when the two differ
 *  ("Lin-Pei Chun" for Pei-Chun Lin), so the award resolves to the player. */
export interface CompendiumNamed { name: string; team: string; roster?: string }

export interface CompendiumAwards {
  /** IBAF's award leaders, value and detail as printed (".556", "5 H, 9 AB"). */
  leaders: (CompendiumNamed & { stat: string; value: string; detail: string | null })[]
  all_tournament: (CompendiumNamed & { position: string })[]
  mvp: CompendiumNamed
  /** The champion's manager, from the staff. */
  manager: { name: string; team: string }
}

export interface CompendiumEdition {
  year: number
  city: string
  timezone: string
  games: CompendiumGame[]
  /** Game numbers the schedule had and rain canceled; they are numbered, so they are listed. */
  canceled: number[]
  standings: CompendiumTable[]
  rosters?: CompendiumRoster[]
  awards?: CompendiumAwards
}

export interface CompendiumFile {
  /** Where the transcription came from: COMPENDIUM_PDF. */
  source: string
  /** What the transcription changed from the page, and why: a typo another page of the compendium
   *  spells right, a cell two columns ran into. */
  corrections?: string[]
  editions: CompendiumEdition[]
}

export const compendiumEventKey = (year: number): string => `${year}-womens-baseball-world-cup`

export function compendiumGames(ed: CompendiumEdition): WbscGame[] {
  return ed.games.map(g => ({
    id: `wbsc:g:${compendiumGameId(ed.year, g.n)}`, wbsc_game_id: compendiumGameId(ed.year, g.n),
    event_key: compendiumEventKey(ed.year), game_date: g.date, status: 'final', round: g.round,
    start_local: `${g.date} ${g.time}:00`, timezone: ed.timezone, venue: g.venue, city: ed.city,
    away_team_id: g.away, home_team_id: g.home, away_score: g.away_score, home_score: g.home_score,
    innings: 0, attendance: null, duration_minutes: null, home_hits: 0, away_hits: 0, home_errors: 0, away_errors: 0,
  }))
}

// ── Rosters and awards ────────────────────────────────────────────────────────

/** The 2004 to 2008 "tournament", in WBSC's id terms, as ibaf.ts numbers 2010. */
export const compendiumTournamentId = (year: number): number => year * 1000

/** A roster's player id, numbered in the order the compendium prints the rosters. */
const playerId = (year: number, n: number) => `wbsc:p:${compendiumTournamentId(year)}:${n}`

/** Given names and surname from a roster's name. A nickname in quotes ('Ka-Yan "Marco" Chan') is a
 *  given name, which is where WBSC's later rosters put it; a hyphenated given name is two, as WBSC
 *  registers them ("Ka Yan"). Cuba's surnames are two words, as WBSC writes them. */
export function splitRosterName(raw: string, team: string, surnameFirst = false): { first_name: string; last_name: string } {
  const words = raw.replace(/["“”]/g, ' ').replace(/-/g, team === 'HKG' || team === 'TPE' ? ' ' : '-').trim().split(/\s+/)
  if (words.length < 2) return { first_name: '', last_name: words[0] ?? '' }
  if (surnameFirst) return { first_name: words.slice(1).join(' '), last_name: words[0] }
  const surname = team === 'CUB' && words.length > 2 ? 2 : 1
  return { first_name: words.slice(0, -surname).join(' '), last_name: words.slice(-surname).join(' ') }
}

/** Every roster's players, as the importer's other events write theirs, so the same-person rules,
 *  the WPBL crosswalk and people.json take them like any other World Cup's. */
export function compendiumPlayers(ed: CompendiumEdition): (WbscPlayer & { position: string | null })[] {
  let n = 0
  return (ed.rosters ?? []).flatMap(r => r.players.map(p => {
    n++
    const { first_name, last_name } = splitRosterName(p.name, r.team, r.surname_first)
    return {
      id: playerId(ed.year, n), name: displayName(first_name, last_name, r.team), full_name: `${first_name} ${last_name}`.trim(),
      event_key: compendiumEventKey(ed.year), wbsc_player_id: n, first_name, last_name, uniform: null, team_id: r.team,
      position: p.position,
    }
  }))
}

/** The roster player an award names: exactly one on that team, by the roster's spelling, or null. */
export function awardPlayer(ed: CompendiumEdition, a: CompendiumNamed): string | null {
  const fold = (s: string) => s.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase()
  const want = fold(a.roster ?? a.name)
  const players = compendiumPlayers(ed)
  let n = 0
  const hits: string[] = []
  for (const r of ed.rosters ?? []) for (const p of r.players) {
    const id = players[n++].id
    if (r.team === a.team && fold(p.name) === want) hits.push(id)
  }
  return hits.length === 1 ? hits[0] : null
}

/** Rounds in the order played, for carrying earlier games into a later table. */
function roundOrder(games: readonly CompendiumGame[]): string[] {
  const order: string[] = []
  for (const g of [...games].sort((a, b) => a.n - b.n)) if (!order.includes(g.round)) order.push(g.round)
  return order
}

/** Everything wrong with one edition's transcription; empty when it is right. */
export function checkCompendium(ed: CompendiumEdition): string[] {
  const problems: string[] = []
  const at = (g: CompendiumGame) => `${ed.year} game ${g.n}`
  const numbers = [...ed.games.map(g => g.n), ...ed.canceled].sort((a, b) => a - b)
  if (numbers.some((n, i) => n !== i + 1)) problems.push(`${ed.year}: game numbers are not 1 to ${numbers.length}, each once`)
  for (const g of ed.games) {
    if (!TEAMS.has(g.away) || !TEAMS.has(g.home) || g.away === g.home) problems.push(`${at(g)}: teams ${g.away} @ ${g.home}`)
    if (!ROUNDS.has(g.round)) problems.push(`${at(g)}: round "${g.round}"`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.date) || !g.date.startsWith(String(ed.year))) problems.push(`${at(g)}: date ${g.date}`)
    if (!/^\d{2}:\d{2}$/.test(g.time)) problems.push(`${at(g)}: time ${g.time}`)
    if (![g.away_score, g.home_score].every(s => Number.isInteger(s) && s >= 0) || g.away_score === g.home_score) {
      problems.push(`${at(g)}: score ${g.away_score}-${g.home_score}`)
    }
  }

  const order = roundOrder(ed.games)
  for (const t of ed.standings) {
    const teams = new Set(t.rows.map(r => r[0]))
    const before = order.slice(0, order.indexOf(t.round))
    if (!order.includes(t.round)) { problems.push(`${ed.year} ${t.round}: no games in that round`); continue }
    const counted = ed.games.filter(g => teams.has(g.away) && teams.has(g.home) && (g.round === t.round || before.includes(g.round)))
    // The round's own games must stay inside the table: a game against a team outside it means
    // the table's teams were transcribed wrong.
    const own = ed.games.filter(g => g.round === t.round && (teams.has(g.away) || teams.has(g.home)))
    if (own.some(g => !teams.has(g.away) || !teams.has(g.home))) problems.push(`${ed.year} ${t.round} ${t.group ?? ''}: a game leaves the table`)
    const sum = new Map([...teams].map(team => [team, [0, 0, 0, 0]]))
    for (const g of counted) {
      const [a, h] = [sum.get(g.away)!, sum.get(g.home)!]
      a[2] += g.away_score; a[3] += g.home_score; h[2] += g.home_score; h[3] += g.away_score
      if (g.away_score > g.home_score) { a[0]++; h[1]++ } else { h[0]++; a[1]++ }
    }
    for (const [team, ...want] of t.rows) {
      const got = sum.get(team)!
      if (want.some((v, i) => v !== got[i])) {
        problems.push(`${ed.year} ${t.round} ${t.group ?? ''}: ${team} is ${want.join('-')} in the compendium, ${got.join('-')} from the games`)
      }
    }
  }
  // Every round-robin round has a table to be checked against; a knockout game is checked by its
  // winner's place in the final standings, which editions.ts does.
  for (const r of order.filter(r => r === 'Opening Round' || r === 'Round Robin' || r === 'Round 2')) {
    const teams = new Set(ed.games.filter(g => g.round === r).flatMap(g => [g.away, g.home]))
    const tabled = new Set(ed.standings.filter(t => t.round === r).flatMap(t => t.rows.map(x => x[0])))
    if ([...teams].some(t => !tabled.has(t))) problems.push(`${ed.year} ${r}: a team with no standings row`)
  }
  if (ed.rosters) problems.push(...checkRosters(ed))
  return problems
}

/** A roster for every team that played and none other, no player twice on one, and every award
 *  naming exactly one of them. */
function checkRosters(ed: CompendiumEdition): string[] {
  const problems: string[] = []
  const played = [...new Set(ed.games.flatMap(g => [g.away, g.home]))].sort()
  const rostered = (ed.rosters ?? []).map(r => r.team).sort()
  if (played.join() !== rostered.join()) problems.push(`${ed.year}: rosters for ${rostered.join(', ')}, games for ${played.join(', ')}`)
  for (const r of ed.rosters ?? []) {
    const names = r.players.map(p => p.name)
    if (new Set(names).size < names.length) problems.push(`${ed.year} ${r.team}: a player listed twice`)
    if (names.length < 9) problems.push(`${ed.year} ${r.team}: ${names.length} players`)
  }
  if (!ed.awards) return problems
  const named = [...ed.awards.leaders, ...ed.awards.all_tournament, ed.awards.mvp]
  for (const a of named) if (!awardPlayer(ed, a)) problems.push(`${ed.year}: ${a.name} (${a.team}) is no one on that roster`)
  const m = ed.awards.manager
  if (!ed.rosters?.some(r => r.team === m.team && r.staff.some(s => s.name === m.name))) problems.push(`${ed.year}: manager ${m.name} is not on ${m.team}'s staff`)
  return problems
}

/** What an edition's pages need from the rosters and awards, by player id, written beside the event's
 *  games as `compendium.json`. The ids resolve to names and pages through people.json, as every
 *  other World Cup player's do. */
export interface CompendiumExtras {
  rosters: { team: string; players: { id: string; position: string | null }[]; staff: { name: string; role: string }[] }[]
  awards: {
    leaders: { stat: string; id: string; team: string; value: string; detail: string | null }[]
    all_tournament: { position: string; id: string; team: string }[]
    mvp: { id: string; team: string }
    manager: { name: string; team: string }
  } | null
}

/** Only for an edition `checkCompendium` passed: an award that names no one throws. */
export function compendiumExtras(ed: CompendiumEdition): CompendiumExtras {
  const players = compendiumPlayers(ed)
  let n = 0
  const rosters = (ed.rosters ?? []).map(r => ({
    team: r.team, staff: r.staff,
    players: r.players.map(() => { const p = players[n++]; return { id: p.id, position: p.position } }),
  }))
  const id = (a: CompendiumNamed) => {
    const hit = awardPlayer(ed, a)
    if (!hit) throw new Error(`${ed.year}: ${a.name} is no one on ${a.team}'s roster`)
    return hit
  }
  const a = ed.awards
  return {
    rosters,
    awards: a ? {
      leaders: a.leaders.map(l => ({ stat: l.stat, id: id(l), team: l.team, value: l.value, detail: l.detail })),
      all_tournament: a.all_tournament.map(x => ({ position: x.position, id: id(x), team: x.team })),
      mvp: { id: id(a.mvp), team: a.mvp.team }, manager: a.manager,
    } : null,
  }
}

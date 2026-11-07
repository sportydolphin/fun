// The 2004, 2006 and 2008 World Cups: results only, from IBAF's 2004 to 2010 compendium. See
// "2004 to 2008, results only" in docs/WBSC_INGEST.md.
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

import type { WbscGame } from './game'

/** The compendium in the Wayback Machine. Each edition links to its own page of results. */
export const COMPENDIUM_PDF =
  'https://web.archive.org/web/2012/http://www.ibaf.org/doc/2cfcc351-53f6-4397-a2f9-6ce439901805/2010%20-%20Mundial%20Femenino%20-%20Estadi%CC%81sticas.pdf'

/** The PDF page where each edition's results start. */
const RESULTS_PAGE: Readonly<Record<number, number>> = { 2004: 3, 2006: 8, 2008: 13 }

/** The editions with results alone, by slug: their pages have no Leaders tab. Known from the slug,
 *  not the file, so the tabs are drawn before the file arrives. */
export const RESULTS_ONLY_EDITIONS: ReadonlySet<string> = new Set(Object.keys(RESULTS_PAGE))

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

export interface CompendiumEdition {
  year: number
  city: string
  timezone: string
  games: CompendiumGame[]
  /** Game numbers the schedule had and rain canceled; they are numbered, so they are listed. */
  canceled: number[]
  standings: CompendiumTable[]
}

export interface CompendiumFile {
  /** Where the transcription came from: COMPENDIUM_PDF. */
  source: string
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
  return problems
}

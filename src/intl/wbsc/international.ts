// international.json: each linked WPBL player's World Cups, the one file a WPBL player page reads.
// See docs/WBSC_INGEST.md and ROADMAP-WOMENS-BASEBALL.md, stage 0 step 5.
//
// BUILT FROM THE CONFIRMED CROSSWALK ONLY. The review file's yeses are not links until --confirm
// moves them, so an unconfirmed candidate can never reach a page. And the build trusts no link it
// cannot resolve: a link to a WBSC player in no imported event, or to someone off the WPBL roster,
// or two WBSC players for one WPBL player in one event, fails the whole build and writes nothing,
// for the importer's reason: a file quietly missing a player looks complete.
//
// TOTALS, NEVER RATES. The page computes AVG, OPS and ERA itself, on the World Cup's own basis
// (seven innings), so a rate here would be a second definition to keep in step with the first.
// And no total ever spans two events: a group stage and the Finals are separate rows on the page,
// as a WPBL season and a World Cup are (docs/PLAYER_PAGE.md).

import type { PitchingGameLine } from '../../league/types'
import type { Crosswalk } from './crosswalk'
import type { WbscBattingLine, WbscGame } from './game'

/** One imported event, as the importer wrote it to `archive/wbsc/<event-key>/`. */
export interface InternationalEventInput {
  key: string
  name: string
  year: number
  /** The event's schedule on wbsc.org. */
  source: string
  games: readonly WbscGame[]
  /** Every player the event's box scores name, for checking that a link resolves. */
  playerIds: ReadonlySet<string>
  batting: readonly WbscBattingLine[]
  pitching: readonly PitchingGameLine[]
}

export interface InternationalBatting {
  g: number
  pa: number
  ab: number
  r: number
  h: number
  doubles: number
  triples: number
  hr: number
  rbi: number
  bb: number
  ibb: number
  so: number
  hbp: number
  sb: number
  cs: number
  sf: number
  sh: number
  gdp: number
  tb: number
}

export interface InternationalPitching {
  g: number
  gs: number
  /** Innings as outs, as everywhere else. */
  outs: number
  bf: number
  h: number
  r: number
  er: number
  bb: number
  so: number
  hr: number
  hbp: number
  wp: number
  bk: number
  /** Null when any game in the event has no pitch count (2018 recorded none). */
  pitches: number | null
  strikes: number | null
  w: number
  l: number
  sv: number
}

export interface InternationalGame {
  game_id: string
  wbsc_game_id: number
  game_date: string
  /** The opposing national team, its IOC code. */
  opponent_id: string
  home: boolean
  /** The box score on wbsc.org. */
  url: string
}

export interface InternationalEvent {
  event_key: string
  event: string
  year: number
  /** The national team played for, its IOC code. */
  team_id: string
  /** The WBSC name the crosswalk matched, shown beside the row so a reader can spot a wrong one. */
  wbsc_name: string
  wbsc_id: string
  /** The event's schedule on wbsc.org. */
  url: string
  /** Null when the player never batted or fielded in the event, as a pitcher in most of them. */
  batting: InternationalBatting | null
  /** Null when the player never pitched in the event. */
  pitching: InternationalPitching | null
  games: InternationalGame[]
}

export interface InternationalPlayer {
  wpbl_name: string
  /** Oldest first. */
  events: InternationalEvent[]
}

/** The file: keyed by WPBL player id, with only the players who appeared in at least one game. */
export type International = Record<string, InternationalPlayer>

export interface InternationalResult {
  international: International
  /** Why nothing was built. Empty on success. */
  errors: string[]
  /** Links to a player who is on an event's roster and appeared in none of its games. Not an
   *  error, since a roster spot is not a game, but worth a line in the run log. */
  unplayed: { wpbl_name: string; event_key: string; wbsc_name: string }[]
}

/**
 * Whether a batting line is a game as a batter or fielder, the WPBL page's rule (`isBattingGame`
 * in src/wpbl/stats.ts, which this folder may not import): a line with a plate appearance, or a
 * pinch runner or defensive sub who never came up. A pitcher's empty line is a pitching game only.
 * WBSC writes positions in either case ('PR/RF', 'p').
 */
export function isWbscBattingGame(l: Pick<WbscBattingLine, 'pa' | 'position'>): boolean {
  if (l.pa > 0) return true
  const parts = String(l.position ?? '').toLowerCase().split('/').map(s => s.trim()).filter(Boolean)
  return parts.length > 0 && !parts.every(p => p === 'p')
}

const BATTING_KEYS = ['pa', 'ab', 'r', 'h', 'doubles', 'triples', 'hr', 'rbi', 'bb', 'ibb', 'so', 'hbp', 'sb', 'cs', 'sf', 'sh', 'gdp', 'tb'] as const
const PITCHING_KEYS = ['outs', 'bf', 'h', 'r', 'er', 'bb', 'so', 'hr', 'hbp', 'wp', 'bk'] as const

function sumBatting(lines: readonly WbscBattingLine[]): InternationalBatting | null {
  const played = lines.filter(isWbscBattingGame)
  if (!played.length) return null
  const out = { g: played.length } as InternationalBatting
  for (const k of BATTING_KEYS) out[k] = played.reduce((n, l) => n + (l[k] ?? 0), 0)
  return out
}

function sumPitching(lines: readonly PitchingGameLine[]): InternationalPitching | null {
  if (!lines.length) return null
  const out = { g: lines.length, gs: lines.reduce((n, l) => n + (l.gs ?? 0), 0) } as InternationalPitching
  for (const k of PITCHING_KEYS) out[k] = lines.reduce((n, l) => n + (l[k] ?? 0), 0)
  // A partial pitch count summed reads as a real, low one, so one unknown game makes it unknown.
  out.pitches = lines.every(l => l.pitches != null) ? lines.reduce((n, l) => n + (l.pitches ?? 0), 0) : null
  out.strikes = lines.every(l => l.strikes != null) ? lines.reduce((n, l) => n + (l.strikes ?? 0), 0) : null
  out.w = lines.filter(l => l.decision === 'W').length
  out.l = lines.filter(l => l.decision === 'L').length
  out.sv = lines.filter(l => l.decision === 'S').length
  return out
}

/** Code-point order, so the file is the same bytes on every machine whatever its locale. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

export function buildInternational(
  crosswalk: Crosswalk,
  events: readonly InternationalEventInput[],
  roster: ReadonlySet<string>,
): InternationalResult {
  const errors: string[] = []
  const unplayed: InternationalResult['unplayed'] = []
  const byKey = new Map(events.map(e => [e.key, e]))
  const international: International = {}

  const seen = new Map<string, string>()
  for (const link of crosswalk.links) {
    const label = `${link.wbsc_name} → ${link.wpbl_name} (${link.event_key})`
    const event = byKey.get(link.event_key)
    if (!event) { errors.push(`${label}: ${link.event_key} is not imported`); continue }
    if (!event.playerIds.has(link.wbsc_id)) { errors.push(`${label}: ${link.wbsc_id} is not in ${link.event_key}`); continue }
    if (!roster.has(link.wpbl_id)) { errors.push(`${label}: ${link.wpbl_id} is not on the WPBL roster`); continue }
    const pair = `${link.wpbl_id} ${link.event_key}`
    const other = seen.get(pair)
    if (other) { errors.push(`${label}: ${link.wpbl_name} is already ${other} in ${link.event_key}`); continue }
    seen.set(pair, link.wbsc_name)

    const batting = event.batting.filter(l => l.player_id === link.wbsc_id)
    const pitching = event.pitching.filter(l => l.player_id === link.wbsc_id)
    const gameIds = new Set([...batting, ...pitching].map(l => l.game_id))
    if (!gameIds.size) { unplayed.push({ wpbl_name: link.wpbl_name, event_key: link.event_key, wbsc_name: link.wbsc_name }); continue }

    const team = batting[0]?.team_id ?? pitching[0]?.team_id ?? ''
    const games = event.games.filter(g => gameIds.has(g.id)).map((g): InternationalGame => {
      const home = g.home_team_id === team
      return {
        game_id: g.id, wbsc_game_id: g.wbsc_game_id, game_date: g.game_date,
        opponent_id: home ? g.away_team_id : g.home_team_id, home,
        url: `${event.source}/box-score/${g.wbsc_game_id}`,
      }
    }).sort((a, b) => cmp(a.game_date, b.game_date) || a.wbsc_game_id - b.wbsc_game_id)
    if (games.length !== gameIds.size) {
      errors.push(`${label}: ${gameIds.size - games.length} of the player's games are not in ${link.event_key}'s games`)
      continue
    }

    const player = international[link.wpbl_id] ??= { wpbl_name: link.wpbl_name, events: [] }
    player.events.push({
      event_key: event.key, event: event.name, year: event.year, team_id: team,
      wbsc_name: link.wbsc_name, wbsc_id: link.wbsc_id, url: event.source,
      batting: sumBatting(batting), pitching: sumPitching(pitching), games,
    })
  }

  if (errors.length) return { international: {}, errors, unplayed }
  for (const p of Object.values(international)) {
    p.events.sort((a, b) => cmp(a.games[0].game_date, b.games[0].game_date) || cmp(a.event_key, b.event_key))
  }
  const sorted: International = {}
  for (const id of Object.keys(international).sort(cmp)) sorted[id] = international[id]
  return { international: sorted, errors, unplayed }
}

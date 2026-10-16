// One WBSC game page in, the neutral rows out (src/league/types.ts), after checking that the
// page agrees with itself. See docs/WBSC_INGEST.md for the source and the reasoning.
//
// VALIDATE, THEN TRANSFORM, AND NEVER ONE WITHOUT THE OTHER. The page is three views of the same
// game (the line score, the box score, the play log), kept by a scorer's software we cannot see
// into. Where the three disagree, a board built on one of them is quietly wrong, so a game that
// fails any check below is left out with its reasons printed, and the importer exits non-zero.

import type {
  BattingGameLine, FieldingGameLine, LeagueGame, LeaguePlayer, LineScoreEntry, PitchingGameLine, RunValuePlay,
} from '../../league/types'
import { NON_PITCH_RESULT1, PITCH_LETTER, TIE_BREAK_PLACEMENT, baserunningEvent, paEventType } from './codes'
import type { WbscBoxRow, WbscEvent, WbscGamePage, WbscPlayRow } from './types'

// ── The rows we write ───────────────────────────────────────────────────────────

export interface WbscGame extends LeagueGame {
  event_key: string
  wbsc_game_id: number
  /** WBSC's own label for the stage: 'Group Stage Games', 'Final', ... */
  round: string | null
  /** Local wall-clock start and its zone, as WBSC publishes them. */
  start_local: string
  timezone: string | null
  /** Innings played; below seven for a game ended by the run rule. */
  innings: number
  venue: string | null
  city: string | null
  attendance: number | null
  duration_minutes: number | null
  home_hits: number
  away_hits: number
  home_errors: number
  away_errors: number
}

/** A player IN ONE EVENT. WBSC numbers a player afresh every tournament, so the same person in
 *  two events is two of these, joined (if ever) by the crosswalk and never by name. */
export interface WbscPlayer extends LeaguePlayer {
  event_key: string
  wbsc_player_id: number
  first_name: string
  last_name: string
  uniform: number | null
}

export interface WbscBattingLine extends BattingGameLine {
  pa: number
  ibb: number
  /** The lineup spot, 1 to 9. */
  spot: number
  position: string | null
}

export type WbscPlay = RunValuePlay

export interface WbscGameRows {
  game: WbscGame
  players: WbscPlayer[]
  batting: WbscBattingLine[]
  pitching: PitchingGameLine[]
  fielding: FieldingGameLine[]
  plays: WbscPlay[]
  /** What the importer decided rather than copied, for the run log. */
  notes: string[]
}

// ── Ids ─────────────────────────────────────────────────────────────────────────

// Namespaced strings, so a WBSC row can never collide with a WPBL uuid or an MLB number in any
// table or map that ends up holding both.
export const gameId = (wbscGameId: number) => `wbsc:g:${wbscGameId}`
export const playerId = (tournamentId: number, wbscPlayerId: number) => `wbsc:p:${tournamentId}:${wbscPlayerId}`

// ── Small readers ───────────────────────────────────────────────────────────────

/**
 * Innings in baseball notation, as outs: '4.2' is 14. Null for anything that is not that
 * notation, which the validation reports. Reading it as a decimal is the classic mistake (4.67
 * innings), and summing two of them as decimals compounds it.
 */
export function inningsToOuts(ip: string | number | null | undefined): number | null {
  const m = /^(\d+)\.([012])$/.exec(String(ip ?? '').trim())
  return m ? Number(m[1]) * 3 + Number(m[2]) : null
}

/** Any apostrophe, with any space a scorer typed around it: WBSC writes one O'Sullivan as
 *  "O ` SULLIVAN", a backtick between two spaces. */
export const APOSTROPHE = /\s*['’`´ʼ]\s*/g

/** 'MARCANO  VIZCARRONDO' → 'Marcano Vizcarrondo', "O'SULLIVAN" → "O'Sullivan", 'DAY-BÉDARD' →
 *  'Day-Bédard'. WBSC writes every surname in capitals. A Mc or Mac loses its inner capital; the
 *  crosswalk records the name each side writes, so nothing is matched on this. */
export function surnameCase(raw: string): string {
  return raw.replace(APOSTROPHE, "'").trim().split(/\s+/)
    .map(word => word.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase()))
    .join(' ')
}

const cleanNarrative = (s: string | null | undefined): string | null => {
  const t = (s ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim()
  return t || null
}

const durationMinutes = (d: string | null): number | null => {
  const m = /^(\d+):(\d{2})$/.exec(d ?? '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** Every row in a team's box, whichever lineup spot it is filed under. */
export function boxRows(page: WbscGamePage, teamId: number): WbscBoxRow[] {
  const bySpot = page.boxScore[String(teamId)]
  if (!bySpot || typeof bySpot !== 'object') return []
  return Object.values(bySpot as Record<string, WbscBoxRow[]>).flat()
}

/** A player's whole game: their box rows merged, and their innings as outs. */
export interface PlayerGame extends WbscBoxRow {
  pitch_outs: number
}

// The counts a split row carries. Summed when a player has two rows; nothing else is.
const COUNTS = [
  'pa', 'ab', 'r', 'h', 'rbi', 'double', 'triple', 'hr', 'bb', 'ibb', 'so', 'hbp', 'sb', 'cs', 'sf', 'sh', 'gdp',
  'field_po', 'field_a', 'field_e', 'field_dp', 'field_pb', 'field_sba', 'field_ci',
  'pitch_appear', 'pitch_bf', 'pitch_h', 'pitch_r', 'pitch_er', 'pitch_bb', 'pitch_so', 'pitch_hr', 'pitch_hbp',
  'pitch_wp', 'pitch_bk', 'pitch_pitches', 'pitch_strikes', 'pitch_gs', 'pitch_win', 'pitch_loss', 'pitch_save',
] as const satisfies readonly (keyof WbscBoxRow)[]

/**
 * One line per player, whatever the box files them under.
 *
 * TWO ROWS ARE ONE PLAYER, NOT A DUPLICATE. A fielder who moves to the mound costs the side its
 * DH, and WBSC then files the player twice: the batting spot (with what they did there) and 90,
 * the pitchers' row (with what they did on the mound). Every count is split between the two, so
 * the player's game is the sum; keeping either row alone drops half of it. Seen 11 times in the
 * 30 games of the 2026 group stage. The batting spot is the row that is not 90.
 */
export function playerLines(page: WbscGamePage, teamId: number): PlayerGame[] {
  const byId = new Map<number, PlayerGame>()
  for (const r of boxRows(page, teamId)) {
    const outs = inningsToOuts(r.pitch_ip) ?? 0
    const had = byId.get(r.playerid)
    if (!had) { byId.set(r.playerid, { ...r, pitch_outs: outs }); continue }
    for (const k of COUNTS) had[k] = (Number(had[k]) || 0) + (Number(r[k]) || 0)
    had.pitch_outs += outs
    if (had.spot >= 90 && r.spot < 90) { had.spot = r.spot; had.pos = r.pos }
  }
  return [...byId.values()]
}

/** The play log in game order: innings ascending, top before bottom, rows by `playorder`. */
export function halves(page: WbscGamePage): { inning: number; half: Half; rows: WbscPlayRow[] }[] {
  const out: { inning: number; half: Half; rows: WbscPlayRow[] }[] = []
  const innings = Object.keys(page.gamePlays?.all ?? {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b)
  for (const inning of innings) {
    const both = page.gamePlays.all[String(inning)]
    // WBSC's key for the second half is `bot`; ours is the word the neutral types use.
    for (const [key, half] of [['top', 'top'], ['bot', 'bottom']] as const) {
      const rows = [...(both?.[key] ?? [])].sort((a, b) => a.playorder - b.playorder)
      if (rows.length) out.push({ inning, half, rows })
    }
  }
  return out
}

const lineRuns = (page: WbscGamePage, side: 'home' | 'away', inning: number): number =>
  Number(page.gameData[`runs${side}${inning}`] ?? 0)

type Half = 'top' | 'bottom'

/**
 * Lineup slot code → the box row of the player who held it, per batting half.
 *
 * The code is 1000 for the visitors or 2000 for the home side, plus ten times the batting spot,
 * plus the substitution count: 2061 is the home side's sixth spot, first substitute. Measured,
 * not assumed: across the 30 games of the 2026 group stage it names the batter on 1,732 of 1,733
 * plate appearances and resolves all 7,227 runners on base. It is how a base gets a name, since a
 * runner is only ever written as a code.
 */
export function lineupSlots(page: WbscGamePage): Record<Half, Map<number, WbscBoxRow>> {
  const g = page.gameData
  const slots: Record<Half, Map<number, WbscBoxRow>> = { top: new Map(), bottom: new Map() }
  for (const [half, teamId, base] of [['top', g.awayid, 1000], ['bottom', g.homeid, 2000]] as const) {
    for (const r of boxRows(page, teamId)) if (r.spot > 0 && r.spot < 90) slots[half].set(base + r.spot * 10 + (r.sub || 0), r)
  }
  return slots
}

/**
 * Who batted on a row: the batter id, unless the lineup slot says otherwise AND the scorer's own
 * sentence agrees with the slot.
 *
 * The one case it exists for: game 201087, where a substitute's plate appearance carries the
 * slot code of the substitute, a narrative naming the substitute, and the batter id of the player
 * they replaced. Two of the three sources agree, so the slot wins, and the importer prints it.
 * When the narrative names neither, nothing is guessed: `id` is null and validation fails it.
 */
export function batterOnRow(row: WbscPlayRow, slots: Map<number, WbscBoxRow>): { id: number | null; overridden: boolean } {
  const held = slots.get(row.lineupslot)
  if (!held || held.playerid === row.batterid) return { id: row.batterid || null, overridden: false }
  const said = (row.narrative ?? '').toUpperCase()
  if (said.includes(held.lastname.trim().toUpperCase())) return { id: held.playerid, overridden: true }
  return { id: null, overridden: false }
}

// ── Validation ──────────────────────────────────────────────────────────────────

/** Everything wrong with a game page, as sentences. Empty means it may be transformed. */
export function validateGame(page: WbscGamePage): string[] {
  const problems: string[] = []
  const g = page.gameData
  if (!g) return ['no gameData']
  if (g.gamestatustext !== 'F') problems.push(`not final (status "${g.gamestatustext ?? ''}")`)
  if (!(g.innings > 0)) problems.push(`innings played is ${g.innings}`)

  const log = halves(page)
  if (!log.length) problems.push('the play log is empty')

  for (const side of ['away', 'home'] as const) {
    const ioc = side === 'home' ? g.homeioc : g.awayioc
    const runs = side === 'home' ? g.homeruns : g.awayruns
    const hits = side === 'home' ? g.homehits : g.awayhits
    const teamId = side === 'home' ? g.homeid : g.awayid
    const rows = playerLines(page, teamId)
    if (!rows.length) { problems.push(`${ioc}: no box score`); continue }

    // The line score adds up to the final.
    let line = 0
    for (let i = 1; i <= Math.max(g.innings, 1); i++) line += lineRuns(page, side, i)
    if (line !== runs) problems.push(`${ioc}: line score sums to ${line}, final is ${runs}`)

    // The box score adds up to the final.
    const boxR = rows.reduce((n, r) => n + r.r, 0)
    const boxH = rows.reduce((n, r) => n + r.h, 0)
    if (boxR !== runs) problems.push(`${ioc}: box score runs ${boxR}, final is ${runs}`)
    if (boxH !== hits) problems.push(`${ioc}: box score hits ${boxH}, line score has ${hits}`)

    // The play log adds up to the line score, inning by inning.
    const half = side === 'home' ? 'bottom' : 'top'
    let logRuns = 0
    for (const h of log.filter(x => x.half === half)) {
      const inHalf = h.rows.reduce((n, r) => n + (r.runs || 0), 0)
      logRuns += inHalf
      const cell = lineRuns(page, side, h.inning)
      if (inHalf !== cell) problems.push(`${ioc}: inning ${h.inning} play log scores ${inHalf}, line score has ${cell}`)
    }
    if (logRuns !== runs) problems.push(`${ioc}: play log scores ${logRuns}, final is ${runs}`)

    // Per raw row: a merged line has already turned its innings into outs.
    for (const r of boxRows(page, teamId)) {
      if ((r.pitch_appear > 0 || r.pitch_bf > 0) && inningsToOuts(r.pitch_ip) == null) {
        problems.push(`${ioc}: ${r.lastname} pitched "${r.pitch_ip}" innings, which is not innings notation`)
      }
    }
  }

  // The play log's plate appearances match the box score's, batter by batter.
  const boxPa = new Map<number, number>()
  for (const id of [g.homeid, g.awayid]) for (const r of playerLines(page, id)) boxPa.set(r.playerid, r.pa)
  const logPa = new Map<number, number>()
  const slots = lineupSlots(page)
  for (const h of log) {
    for (const r of h.rows) {
      if (r.pa !== 1) continue
      const { id } = batterOnRow(r, slots[h.half])
      if (id == null) {
        const held = slots[h.half].get(r.lineupslot)
        problems.push(`inning ${h.inning} ${h.half}, play ${r.playorder}: batter ${r.batterid} but lineup slot ${r.lineupslot} is ${held?.lastname ?? 'nobody'}, and the narrative names neither`)
        continue
      }
      logPa.set(id, (logPa.get(id) ?? 0) + 1)
    }
  }
  for (const id of new Set([...boxPa.keys(), ...logPa.keys()])) {
    const box = boxPa.get(id), plays = logPa.get(id) ?? 0
    if (box === undefined) problems.push(`batter ${id} is in the play log but not the box score`)
    else if (box !== plays) problems.push(`batter ${id}: ${plays} plate appearances in the play log, ${box} in the box score`)
  }

  // Every code is one we know.
  for (const h of log) {
    for (const r of h.rows) {
      const where = `inning ${h.inning} ${h.half}, play ${r.playorder} ("${cleanNarrative(r.narrative) ?? ''}")`
      if (r.pitch_pitches !== 0 && r.pitch_pitches !== 1) problems.push(`${where}: pitch_pitches is ${r.pitch_pitches}`)
      if (r.result1) {
        const known = r.pitch_pitches === 1
          ? PITCH_LETTER[r.result1] !== undefined
          // No pitch thrown: an intentional walk, or a ball awarded for a clock violation.
          : PITCH_LETTER[r.result1] !== undefined || NON_PITCH_RESULT1.has(r.result1)
        if (!known) problems.push(`${where}: unknown pitch code ${r.result1}`)
      }
      if (r.pa === 1) {
        if (paEventType(r) == null) problems.push(`${where}: unknown plate-appearance result ${r.result2} / "${r.result3 ?? ''}"`)
      } else if (r.result2 && r.result2 !== TIE_BREAK_PLACEMENT) {
        problems.push(`${where}: result ${r.result2} on a row that ends no plate appearance`)
      } else {
        const ev = baserunningEvent(r)
        if (ev === 'unknown_out' || ev === 'unknown_advance') problems.push(`${where}: ${ev.replace('_', ' ')}`)
      }
    }
  }
  return problems
}

// ── Transform ───────────────────────────────────────────────────────────────────

/** The rows for one validated game. Call `validateGame` first; this assumes it passed. */
export function transformGame(page: WbscGamePage, event: WbscEvent): WbscGameRows {
  const g = page.gameData
  const tid = g.tournamentid
  const gid = gameId(g.id)
  const iocOf = (teamId: number) => (teamId === g.homeid ? g.homeioc : g.awayioc)
  const log = halves(page)

  const lineFor = (side: 'home' | 'away'): LineScoreEntry[] =>
    // Only the halves that were played: a home side that did not need its last turn at bat has
    // no cell for it, rather than a zero that reads as a scoreless inning.
    log.filter(h => h.half === (side === 'home' ? 'bottom' : 'top'))
      .map(h => ({ inning: h.inning, runs: lineRuns(page, side, h.inning) }))

  const game: WbscGame = {
    id: gid,
    event_key: event.key,
    wbsc_game_id: g.id,
    round: g.gametypelabel || null,
    game_date: g.start.slice(0, 10),
    start_local: g.start,
    timezone: g.start_tz || null,
    status: 'final',
    innings: g.innings,
    home_team_id: g.homeioc,
    away_team_id: g.awayioc,
    home_score: g.homeruns,
    away_score: g.awayruns,
    home_hits: g.homehits,
    away_hits: g.awayhits,
    home_errors: g.homeerrors,
    away_errors: g.awayerrors,
    home_line: lineFor('home'),
    away_line: lineFor('away'),
    venue: g.stadium || null,
    city: g.location || null,
    attendance: g.attendance || null,
    duration_minutes: durationMinutes(g.duration),
  }

  const players: WbscPlayer[] = []
  const batting: WbscBattingLine[] = []
  const pitching: PitchingGameLine[] = []
  const fielding: FieldingGameLine[] = []
  const nameById = new Map<number, string>()

  for (const teamId of [g.awayid, g.homeid]) {
    const team = iocOf(teamId)
    for (const r of playerLines(page, teamId)) {
      const pid = playerId(tid, r.playerid)
      const name = `${r.firstname.trim()} ${surnameCase(r.lastname)}`
      nameById.set(r.playerid, name)
      players.push({
        id: pid, event_key: event.key, wbsc_player_id: r.playerid, name,
        first_name: r.firstname.trim(), last_name: surnameCase(r.lastname),
        team_id: team, uniform: r.uniform ?? null,
      })
      const key = `${g.id}:${r.playerid}`

      if (r.spot > 0 && r.spot < 90) {
        batting.push({
          id: `wbsc:b:${key}`, game_id: gid, player_id: pid, team_id: team,
          spot: r.spot, position: r.pos || null,
          pa: r.pa, ab: r.ab, r: r.r, h: r.h, doubles: r.double, triples: r.triple, hr: r.hr,
          rbi: r.rbi, bb: r.bb, ibb: r.ibb, so: r.so, hbp: r.hbp, sb: r.sb, cs: r.cs,
          sf: r.sf, sh: r.sh, gdp: r.gdp,
          tb: r.h + r.double + 2 * r.triple + 3 * r.hr,
        })
      }

      if (r.pitch_appear > 0 || r.pitch_bf > 0) {
        pitching.push({
          id: `wbsc:pi:${key}`, game_id: gid, player_id: pid, team_id: team,
          outs: r.pitch_outs, bf: r.pitch_bf,
          h: r.pitch_h, r: r.pitch_r, er: r.pitch_er, bb: r.pitch_bb, so: r.pitch_so, hr: r.pitch_hr,
          pitches: r.pitch_pitches, strikes: r.pitch_strikes,
          hbp: r.pitch_hbp, wp: r.pitch_wp, bk: r.pitch_bk,
          gs: r.pitch_gs ? 1 : 0,
          decision: r.pitch_win ? 'W' : r.pitch_loss ? 'L' : r.pitch_save ? 'S' : null,
        })
      }

      // Written only for a game with something to record, as the WPBL lines are (see
      // FieldingGameLine): a count of these is never games played.
      if (r.field_po || r.field_a || r.field_e || r.field_dp || r.field_pb || r.field_sba || r.field_ci) {
        fielding.push({
          id: `wbsc:f:${key}`, game_id: gid, player_id: pid, team_id: team,
          po: r.field_po, a: r.field_a, e: r.field_e, dp: r.field_dp,
          pb: r.field_pb, sba: r.field_sba, ci: r.field_ci,
        })
      }
    }
  }

  // The play log: one row per plate appearance and one per baserunning event between pitches,
  // each with the base-out state BEFORE it, the shape the WPBL log has and the engines read.
  const hasPitches = log.some(h => h.rows.some(r => r.pitch_pitches === 1))
  const plays: WbscPlay[] = []
  const notes: string[] = []
  const slots = lineupSlots(page)
  // A runner is only ever a slot code. Every code in the 2026 groups resolves; one that does not
  // keeps the code rather than a guessed name, and still reads as an occupied base.
  const onBase = (half: Half, code: number): string => {
    if (!code) return ''
    const held = slots[half].get(code)
    return (held && nameById.get(held.playerid)) || `slot ${code}`
  }

  for (const h of log) {
    let sequence = ''
    const team = h.half === 'top' ? g.awayioc : g.homeioc
    for (const r of h.rows) {
      if (r.pitch_pitches === 1) sequence += PITCH_LETTER[r.result1] ?? '?'

      const event = r.pa === 1 ? paEventType(r)
        : r.result2 === TIE_BREAK_PLACEMENT ? null
          : baserunningEvent(r)
      if (event) {
        const batter = r.pa === 1 ? batterOnRow(r, slots[h.half]) : { id: r.batterid || null, overridden: false }
        if (batter.overridden) {
          notes.push(`play ${r.playorder}: batter ${nameById.get(batter.id ?? 0)} from the lineup slot and the narrative, not id ${r.batterid}`)
        }
        plays.push({
          game_id: gid, sequence: r.playorder, inning: h.inning, half: h.half, team_id: team,
          batter_id: batter.id ? playerId(tid, batter.id) : null,
          batter_name: (batter.id && nameById.get(batter.id)) || null,
          pitcher_id: r.pitcherid ? playerId(tid, r.pitcherid) : null,
          pitcher_name: nameById.get(r.pitcherid) ?? null,
          event_type: event,
          // A plate appearance's whole sequence; null on a baserunning row, and on every row of a
          // game scored without pitches (2016, 2018), where '' would claim "no pitches thrown".
          pitch_sequence: r.pa === 1 && hasPitches ? sequence : null,
          outs: r.outs,
          first_base: onBase(h.half, r.runner1),
          second_base: onBase(h.half, r.runner2),
          third_base: onBase(h.half, r.runner3),
          runs_scored: r.runs || 0,
          narrative: cleanNarrative(r.narrative),
        })
      }
      if (r.pa === 1) sequence = ''
    }
  }

  return { game, players, batting, pitching, fielding, plays, notes }
}

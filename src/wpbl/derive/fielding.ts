import { reOf, type PlayRunValue, type ReTable } from './runExpectancy.ts'
import { catcherIndex, type CatcherSourceLine } from './catching.ts'
import { OUTFIELD_ZONES, sprayZone, type SprayZone } from './spray.ts'
import type { RunnerEvent } from './baserunning.ts'
import { PITCH_CODES } from '../league.ts'
import type { WpblRunValuePlay } from '../types'

/**
 * The defensive half of WAR, as a ledger: every player's season at every position, in raw runs.
 * `derive/war.ts` centres each figure against the average at the position and adds it up.
 *
 * PLAYING TIME IS OUTS, COUNTED PLAY BY PLAY. Every out the defence records is credited to the
 * nine players standing there at the time, so a rate per position is per out actually played
 * there, not per game a player's line says they appeared in.
 *
 * RANGE: OUTS MADE ON BALLS HIT TO THE ZONE. A ball's zone comes from the scorer's words
 * (`sprayZone`), and the zone's fielder is charged with it whether it was caught or fell in; a
 * ball into a gap is shared between the two outfielders. Each is measured against the league's
 * out rate for that zone and priced at the zone's own gap between a hit and an out. The play log
 * says where a ball went and never how hard, so a scorched ground ball and a dribbler count alike:
 * this is a zone rating, not a Statcast one, and it is honest about the difference by being the
 * only thing it claims to be.
 *
 * ERRORS: WHAT THE MISPLAY COST AGAINST THE PLAY MADE CLEANLY. A batter who reached on an error is
 * priced against that batter being out with the runners holding, which is what the scorer's ruling
 * says should have happened. Any other error (a throw that got away, a runner taking an extra base
 * on a bobble) is priced against the league's average for the same event in the same base-out
 * state without an error, since the play around the error is real and only the error is the
 * fielder's. A play the error made no worse for the defence costs nothing: the fielder is never
 * paid for erring. Two fielders named on one play share it. A reach on an error is left out of
 * range, or it would be charged twice.
 *
 * DOUBLE PLAYS: WHAT THE SECOND OUT WAS WORTH (`doublePlayWorth`), shared equally along the throw
 * chain the scorer wrote ("2b to ss to 1b"), which is also how the box score credits a DP to
 * every fielder in it.
 *
 * OUTFIELD ARMS: what the runners did on balls hit to an outfielder, from `baserunningEvents`. A
 * runner who took the extra base on a fielder is that fielder's loss; `warSeason` measures it
 * against the average runner chance at the same position.
 *
 * CATCHING: pitches received, and the wild pitches and passed balls among them. Both are the
 * catcher's to block here, since FIP charges the pitcher with neither.
 *
 * WHO WAS STANDING THERE. A play row names a position ("error by ss") and never a player. The
 * pitcher is on the row itself; the catcher comes from `catcherIndex`; everyone else is tracked
 * through the game by `defenseIndex` from the starting positions in the box score and the
 * substitution rows in the play log. A position the two cannot settle is left uncredited.
 *
 * REGULAR SEASON ONLY, because the play values it reads are (`playRunValues`).
 */

export const FIELD_POSITIONS = ['p', 'c', '1b', '2b', '3b', 'ss', 'lf', 'cf', 'rf'] as const
export type FieldPosition = typeof FIELD_POSITIONS[number]
const POS = '(p|c|1b|2b|3b|ss|lf|cf|rf)'
const isFieldPos = (t: string): t is FieldPosition => (FIELD_POSITIONS as readonly string[]).includes(t)

// The whole row, as the substitution rows always are: "Keira Izumi to 3b for Alyssa Zettlemoyer."
// A play that merely ends "to 1b" ("grounded out ss to 1b") also matches, but what precedes it is
// then a sentence rather than a name on the sheet, and it is dropped where the name is looked up.
// DH is read too, though nobody fields there: a fielder moving to it leaves their position empty.
const TO_POSITION = /^\s*(.+?) to (p|c|1b|2b|3b|ss|lf|cf|rf|dh)(?: for .+?)?\.?\s*$/
const PINCH = /^\s*(.+?) pinch (?:hit|ran) for .+?\.?\s*$/

export type FielderAt = (gameId: string, teamId: string, pos: FieldPosition, sequence: number) => string | null

/** A box-score line with its position and a play with its narrative, as this module reads them. */
type Line = CatcherSourceLine
type Play = Pick<WpblRunValuePlay, 'game_id' | 'sequence' | 'narrative'>

/**
 * Who played each position for a club at each play.
 *
 * THE STARTER AT A POSITION is a player whose box-score position begins with it ("lf/p" started
 * in left) and who did not ENTER there: a substitute's line also begins with the position they
 * came in at, and their first row in the log is the one that put them there ("X to lf", or a
 * pinch row). A starter who later moved has a first row naming somewhere else. Two starters
 * claiming one position leave it unknown until a row settles it.
 *
 * Every "X to POS" row after that puts X at POS from the next play on, and takes X off wherever
 * they were. The row sits in the other club's half (a club changes its defence while the other
 * one bats), so it is matched to a club by the name being on that club's sheet that game.
 */
export function defenseIndex(
  lines: readonly Line[],
  plays: readonly Play[],
  players: readonly { id: string; name: string }[],
): FielderAt {
  const nameOf = new Map(players.map(p => [p.id, p.name.trim()]))
  // Per game: name to [club, id], from that game's box score.
  const sheet = new Map<string, Map<string, { team: string; id: string; first: string }>>()
  for (const l of lines) {
    if (!l.team_id) continue
    const name = nameOf.get(l.player_id)
    if (!name) continue
    const m = sheet.get(l.game_id) ?? new Map()
    // A name on both sheets (it has happened once, a traded player) cannot be told apart by name.
    m.set(name, m.has(name) ? { team: '', id: '', first: '' } : {
      team: l.team_id, id: l.player_id, first: (l.position ?? '').toLowerCase().split('/')[0].trim(),
    })
    sheet.set(l.game_id, m)
  }

  // Per game, in order: who moved where, and each player's first row.
  type Move = { seq: number; team: string; id: string; pos: FieldPosition | 'dh' }
  const moves = new Map<string, Move[]>()
  const firstRow = new Map<string, { pos: string | null }>()  // `${game}|${id}`
  const sorted = [...plays].sort((a, b) => (a.game_id < b.game_id ? -1 : a.game_id > b.game_id ? 1 : a.sequence - b.sequence))
  for (const p of sorted) {
    if (!p.narrative) continue
    const m = sheet.get(p.game_id)
    if (!m) continue
    const to = TO_POSITION.exec(p.narrative)
    const pinch = to ? null : PINCH.exec(p.narrative)
    const who = m.get(((to ?? pinch)?.[1] ?? '').trim())
    if (!who || !who.id) continue
    const k = `${p.game_id}|${who.id}`
    if (!firstRow.has(k)) firstRow.set(k, { pos: to ? to[2] : null })
    if (to) {
      const arr = moves.get(p.game_id) ?? []
      arr.push({ seq: p.sequence, team: who.team, id: who.id, pos: to[2] as FieldPosition | 'dh' })
      moves.set(p.game_id, arr)
    }
  }

  // The starting defence per club-game.
  const start = new Map<string, Map<FieldPosition, string | null>>()
  for (const [gameId, m] of sheet) {
    for (const who of m.values()) {
      if (!who.id || !isFieldPos(who.first)) continue
      const first = firstRow.get(`${gameId}|${who.id}`)
      // Entered at this position, by a pinch row before it or a row putting them here.
      if (first && (first.pos === null || first.pos === who.first)) continue
      const k = `${gameId}|${who.team}`
      const d = start.get(k) ?? new Map<FieldPosition, string | null>()
      d.set(who.first, d.has(who.first) ? null : who.id)
      start.set(k, d)
    }
  }

  const catcher = catcherIndex(lines, plays, players)
  return (gameId, teamId, pos, sequence) => {
    if (pos === 'c') return catcher(gameId, teamId, sequence)
    let at = start.get(`${gameId}|${teamId}`)?.get(pos) ?? null
    for (const mv of moves.get(gameId) ?? []) {
      if (mv.seq >= sequence) break
      if (mv.team !== teamId) continue
      if (mv.pos === pos) at = mv.id
      else if (at === mv.id) at = null
    }
    return at
  }
}

// ── Reading a play ──────────────────────────────────────────────────────────────

/** Every fielder an error is charged to on this play, in the scorer's words. */
export function errorFielders(narrative: string): FieldPosition[] {
  const out: FieldPosition[] = []
  const re = new RegExp(`\\b(?:error|dropped (?:fly|foul fly|foul ball|ball|throw)|muffed throw) by ${POS}\\b`, 'gi')
  for (const m of narrative.matchAll(re)) {
    const pos = m[1].toLowerCase() as FieldPosition
    if (!out.includes(pos)) out.push(pos)
  }
  // The scorer's own shorthand, which the feed uses for a dropped foul ball: "E2" is the catcher.
  for (const m of narrative.matchAll(/\bE([1-9])\b/g)) {
    const pos = FIELD_POSITIONS[Number(m[1]) - 1]
    if (!out.includes(pos)) out.push(pos)
  }
  return out
}

/** The batter's own clause says they reached on the misplay, not on a hit. */
export function reachedOnError(narrative: string): boolean {
  const own = narrative.split(';')[0]
  return /\breached (?:first |second |third )?on (?:an? )?(?:(?:fielding|throwing) )?(?:error|dropped)/i.test(own)
}

export interface DoublePlayRead {
  /** The throw chain as written, each fielder once. */
  chain: FieldPosition[]
  /** A ground ball, where one out would have been a force; otherwise a catch and a runner doubled off. */
  ground: boolean
}

export function readDoublePlay(narrative: string): DoublePlayRead | null {
  const own = narrative.split(';')[0]
  const m = new RegExp(`\\bdouble play((?: ${POS}(?: to)?)*)`, 'i').exec(own)
  if (!m) return null
  const chain: FieldPosition[] = []
  for (const t of (m[1] ?? '').toLowerCase().split(/\s+/)) {
    if (isFieldPos(t) && !chain.includes(t)) chain.push(t)
  }
  if (chain.length === 0) return null
  // Caught in the air, with a runner doubled off; anything else (a ground ball, a bunt, a
  // fielder's choice turned into two) had a force for its first out.
  return { chain, ground: !/\b(?:lined|flied|popped|fouled) (?:out )?into (?:a )?double play/i.test(own) }
}

// ── The season ──────────────────────────────────────────────────────────────────

/** What one double play was worth to the defence: the second out, against the single out the play
 *  would otherwise have been. A ground ball's single out is the force (the batter on first, the
 *  rest where the play put them); a line drive's or a fly's is the catch, with the runners where
 *  they stood. Shared by the fielders who turned it and the batter who hit into it. */
export function doublePlayWorth(v: PlayRunValue, table: ReTable, ground: boolean): number | null {
  const single = ground ? reAt(table, v.outs + 1, (v.afterBases ?? v.bases) | 1) : reAt(table, v.outs + 1, v.bases)
  return single == null ? null : Math.max(0, single - v.after)
}

const reAt = (table: ReTable, outs: number, bases: number) => (outs >= 3 ? 0 : reOf(table, outs, bases as 0) ?? null)

/** Who is responsible for a ball hit to a zone. A gap is two outfielders' ball, shared. */
const ZONE_FIELDERS: Record<SprayZone, readonly FieldPosition[]> = {
  P: ['p'], C: ['c'], '1B': ['1b'], '2B': ['2b'], '3B': ['3b'], SS: ['ss'],
  LF: ['lf'], LCF: ['lf', 'cf'], CF: ['cf'], RCF: ['cf', 'rf'], RF: ['rf'],
}
/** A ball in play the defence turned into an out, and one it did not. A home run is neither: no
 *  fielder had a chance at it. A reach on an error is neither either, since the error runs
 *  already price it, and counting it here as a hit would charge the fielder twice. */
const BIP_OUT = new Set(['groundout', 'flyout', 'lineout', 'popup', 'foul_out', 'out', 'fielders_choice', 'sacrifice'])
const BIP_HIT = new Set(['single', 'double', 'triple'])

/** One player's season at one position. Every figure is raw: `warComponents` centres them. */
export interface FieldingCell {
  playerId: string
  pos: FieldPosition
  /** Outs the defence recorded while they stood there: the playing time every rate is per. */
  outs: number
  errors: number
  /** Runs given away on errors. Never positive. */
  errRuns: number
  dps: number
  /** The second outs' worth. Never negative. */
  dpRuns: number
  /** Balls in play to their zone, and outs made above the league's rate for it (a share of a
   *  gap ball counts as that share). */
  bip: number
  playsAbove: number
  /** `playsAbove` priced: each one is a hit in that zone turned into an out. Centred already. */
  rangeRuns: number
  /** Outfield arms: runs the runners did NOT take on balls hit to them, and the runner chances
   *  they came from. Raw: a runner's chance is centred on every chance in its spot, infield hits
   *  included, so balls to the outfield run above that mean and `warSeason` centres again here. */
  armRuns: number
  armChances: number
  /** Catching: pitches received, and the wild pitches and passed balls among them, with what
   *  those cost. */
  pitches: number
  wpPb: number
  wpPbRuns: number
}

export interface FieldingLedger {
  cells: FieldingCell[]
  /** Plays found and plays credited, so a test or a reader can see how much went unattributed. */
  coverage: {
    errors: number; errorsCredited: number; doublePlays: number; doublePlaysCredited: number
    bip: number; bipPlaced: number; outs: number; outsCredited: number
  }
}

/** Runner events as the arm column reads them: which play, and what the runner made of it. */
type ArmEvent = Pick<RunnerEvent, 'game_id' | 'sequence' | 'kind' | 'value'>

export function fieldingLedger(
  values: readonly PlayRunValue[],
  table: ReTable,
  fielderAt: FielderAt,
  /** The runners' extra-base chances, from `baserunningEvents`, for the outfield arms. */
  runnerEvents: readonly ArmEvent[] = [],
): FieldingLedger {
  // The no-error baseline: each event's mean value per base-out state, from the plays without one.
  const base = new Map<string, { n: number; v: number }>()
  const keyOf = (v: PlayRunValue) => `${v.play.event_type ?? ''}|${v.outs}|${v.bases}`
  for (const v of values) {
    if (!v.play.narrative || /error|dropped|\bE[1-9]\b/i.test(v.play.narrative)) continue
    const k = keyOf(v)
    const s = base.get(k) ?? { n: 0, v: 0 }
    s.n++; s.v += v.value; base.set(k, s)
  }
  const baseline = (v: PlayRunValue) => {
    const s = base.get(keyOf(v))
    // An event never seen clean in this state, or a row that is nothing but the misplay
    // ("advanced to third on an error by lf"), would have been nothing without it.
    return s && s.n > 0 ? s.v / s.n : 0
  }

  const cells = new Map<string, FieldingCell>()
  const cell = (id: string, pos: FieldPosition) => {
    const k = `${id}|${pos}`
    let c = cells.get(k)
    if (!c) {
      cells.set(k, c = {
        playerId: id, pos, outs: 0, errors: 0, errRuns: 0, dps: 0, dpRuns: 0,
        bip: 0, playsAbove: 0, rangeRuns: 0, armRuns: 0, armChances: 0, pitches: 0, wpPb: 0, wpPbRuns: 0,
      })
    }
    return c
  }
  const coverage = {
    errors: 0, errorsCredited: 0, doublePlays: 0, doublePlaysCredited: 0, bip: 0, bipPlaced: 0, outs: 0, outsCredited: 0,
  }
  const arms = new Map<string, ArmEvent[]>()
  for (const e of runnerEvents) {
    if (e.kind !== 'extra' && e.kind !== 'held' && e.kind !== 'out_advancing') continue
    const k = `${e.game_id}|${e.sequence}`
    const arr = arms.get(k) ?? []
    arr.push(e); arms.set(k, arr)
  }
  // Balls in play, kept for the second pass once every zone's league rate is known.
  const balls: { zone: SprayZone; out: boolean; value: number; ids: (string | null)[] }[] = []

  for (const v of values) {
    const p = v.play
    if (!v.fieldingTeamId) continue
    const who = (pos: FieldPosition) => (pos === 'p' ? p.pitcher_id : fielderAt(p.game_id, v.fieldingTeamId!, pos, p.sequence))

    // Playing time. A play that ended the half-inning recorded whatever was left of it.
    const outs = Math.max(0, (v.afterOuts ?? 3) - v.outs)
    if (outs > 0) {
      coverage.outs += outs * FIELD_POSITIONS.length
      for (const pos of FIELD_POSITIONS) {
        const id = who(pos)
        if (id) { cell(id, pos).outs += outs; coverage.outsCredited += outs }
      }
    }

    // Catching: every pitch of a plate appearance, and the wild pitches and passed balls the feed
    // writes as rows of their own. Both are the catcher's to block; FIP charges the pitcher with
    // neither, so nothing is counted twice.
    const catcher = who('c')
    if (catcher) {
      if (p.pitch_sequence) {
        let n = 0
        for (const ch of p.pitch_sequence) if (PITCH_CODES[ch]) n++
        cell(catcher, 'c').pitches += n
      } else if (p.event_type === 'wild_pitch' || p.event_type === 'passed_ball') {
        const c = cell(catcher, 'c')
        c.wpPb++; c.wpPbRuns += v.value
      }
    }

    if (!p.narrative) continue

    const charged = errorFielders(p.narrative)
    if (charged.length > 0) {
      coverage.errors++
      let cost: number | null
      if (reachedOnError(p.narrative)) {
        const out = reAt(table, v.outs + 1, v.bases)
        cost = out == null ? null : v.value - (out - v.before)
      } else {
        cost = v.value - baseline(v)
      }
      if (cost != null) {
        const share = Math.max(0, cost) / charged.length
        let any = false
        for (const pos of charged) {
          const id = who(pos)
          if (!id) continue
          const c = cell(id, pos)
          c.errors++; c.errRuns -= share; any = true
        }
        if (any) coverage.errorsCredited++
      }
    }

    const dp = readDoublePlay(p.narrative)
    if (dp) {
      coverage.doublePlays++
      const worth = doublePlayWorth(v, table, dp.ground)
      if (worth != null) {
        const share = worth / dp.chain.length
        let any = false
        for (const pos of dp.chain) {
          const id = who(pos)
          if (!id) continue
          const c = cell(id, pos)
          c.dps++; c.dpRuns += share; any = true
        }
        if (any) coverage.doublePlaysCredited++
      }
    }

    // Range: a plate appearance that put the ball in play, and the zone it went to.
    const e = p.event_type ?? ''
    if (p.pitch_sequence && (BIP_OUT.has(e) || BIP_HIT.has(e)) && charged.length === 0) {
      coverage.bip++
      const zone = sprayZone(p.narrative)
      if (zone) {
        coverage.bipPlaced++
        balls.push({ zone, out: BIP_OUT.has(e), value: v.value, ids: ZONE_FIELDERS[zone].map(who) })
      }
      // Outfield arms: what the runners made of a ball hit to an outfielder.
      const ofZone = zone && OUTFIELD_ZONES.includes(zone) ? ZONE_FIELDERS[zone] : null
      const runners = ofZone ? arms.get(`${p.game_id}|${p.sequence}`) : null
      if (ofZone && runners) {
        for (const pos of ofZone) {
          const id = who(pos)
          if (!id) continue
          const c = cell(id, pos)
          for (const r of runners) { c.armRuns -= r.value / ofZone.length; c.armChances += 1 / ofZone.length }
        }
      }
    }
  }

  // Range, second pass: each zone's league out rate, and what turning a hit there into an out is
  // worth (the mean hit's value less the mean out's, both from the batting side).
  const zones = new Map<SprayZone, { n: number; outs: number; outV: number; hitV: number }>()
  for (const b of balls) {
    const z = zones.get(b.zone) ?? { n: 0, outs: 0, outV: 0, hitV: 0 }
    z.n++
    if (b.out) { z.outs++; z.outV += b.value } else z.hitV += b.value
    zones.set(b.zone, z)
  }
  for (const b of balls) {
    const z = zones.get(b.zone)!
    const hits = z.n - z.outs
    if (z.outs === 0 || hits === 0) continue
    const rate = z.outs / z.n
    const worth = z.hitV / hits - z.outV / z.outs
    const positions = ZONE_FIELDERS[b.zone]
    b.ids.forEach((id, i) => {
      if (!id) return
      const share = 1 / positions.length
      const c = cell(id, positions[i])
      c.bip += share
      c.playsAbove += share * ((b.out ? 1 : 0) - rate)
      c.rangeRuns += share * ((b.out ? 1 : 0) - rate) * worth
    })
  }

  return { cells: [...cells.values()], coverage }
}

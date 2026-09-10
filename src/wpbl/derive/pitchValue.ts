import { countKey, type Count, type CountValue } from './countValue'
import { PITCH_CODES, type PitchKind } from './pitches'
import type { PlayRunValue } from './runExpectancy'
import type { WpblPlayer } from '../types'

// ─── What one pitch was worth ─────────────────────────────────────────────────
//
// THE PIECE BETWEEN THE TWO BOARDS THAT ALREADY EXIST. The Pitch by pitch board says how
// often a hitter swings, misses and takes; the Run value board says what a play was worth in
// this league's runs. Neither can say what a called strike COSTS, because a rate has no unit
// and a play value has no pitches in it. This module multiplies one by the other.
//
// HOW A PITCH CAN BE PRICED AT ALL. `countValues` prices every count off the plate
// appearances that passed through it, so a pitch is worth the count it moved TO minus the
// count it moved FROM. The last pitch of a plate appearance has no count after it, so it is
// worth the whole plate appearance minus the count it was thrown in. That makes the pitches
// of a plate appearance sum to its value minus the value of 0-0, exactly, which is the
// identity `paDecomposition` returns and `__tests__/pitchValue.test.ts` pins. It is what
// keeps this card adding up to the leaderboard printed beside it.
//
// WHAT THIS DOES NOT KNOW. The count is the whole model, so within one count a called strike
// and a swinging strike are priced identically BY CONSTRUCTION: both make it 0-1. The two
// come out at different season averages anyway (a called strike −0.10, a swing and a miss
// −0.22) and the reason is not stuff, it is strike three: swings are 54% to 68% of the
// strikes thrown in two-strike counts against 12% at 0-0, so a much larger share of swinging
// strikes are the pitch that ended the at-bat and carry the strikeout's whole price. Anything
// on a surface that reads this as "a whiff hurts more than a taken strike" is wrong, and the
// card says so.

/** One pitch, priced. */
export interface PitchWorth {
  kind: PitchKind
  /** The count it was thrown in, which is the count the batter stood in and never the stored
   *  `balls`/`strikes` columns: see the warning on `countsThrough`. */
  from: Count
  /** Runs it added for the BATTING side, like `PlayRunValue.value`. */
  worth: number
  /** It ended the plate appearance, so its price is the whole outcome rather than a step
   *  between two counts. */
  terminal: boolean
}

/** A reader for the count table: null for a count too rare to have been priced. */
export type CountValueAt = (c: Count) => number | null

export function countValueAt(rows: readonly CountValue[]): CountValueAt {
  const by = new Map(rows.map(r => [r.key, r.per]))
  return c => by.get(countKey(c)) ?? null
}

/**
 * Take one plate appearance apart, pitch by pitch.
 *
 * Returns an empty array rather than a partial one when the count table cannot price a count
 * the at-bat passed through: half a decomposition does not add up to anything, and a caller
 * summing it would get a number that looks fine and is short by whatever it dropped.
 *
 * THE LAST PITCH ABSORBS THE REMAINDER, INCLUDING WHEN THE FEED DOES NOT MARK ONE. 17 of the
 * season's 2,161 sequences end on a ball or a foul with the plate appearance somehow over (a
 * single whose last recorded pitch is a `B`), and the four terminal codes are the only thing
 * that says an at-bat has finished. Left alone those at-bats hand back a decomposition that
 * is short by the whole value of the outcome, silently, on the one card whose entire claim is
 * that the parts add up to the total.
 */
export function paDecomposition(
  sequence: string,
  paValue: number,
  at: CountValueAt,
): PitchWorth[] {
  const out: PitchWorth[] = []
  let balls = 0, strikes = 0
  let prev = at({ balls: 0, strikes: 0 })
  if (prev == null) return []

  for (const ch of sequence) {
    const kind = PITCH_CODES[ch]
    // An unrecognised letter advances nothing, exactly as in `countsThrough`: guessing at it
    // would misprice every pitch after it in the same at-bat.
    if (!kind) continue
    const from: Count = { balls, strikes }

    // A ball with three already there is a walk, and a strike with two is a strikeout. Both
    // leave the grid, which is what makes them terminal rather than a step to a count.
    let terminal = false
    if (kind === 'inplay' || kind === 'hbp') terminal = true
    else if (kind === 'ball') { if (balls === 3) terminal = true; else balls++ }
    else if (kind === 'called' || kind === 'swinging') { if (strikes === 2) terminal = true; else strikes++ }
    else if (kind === 'foul') { if (strikes < 2) strikes++ }

    if (terminal) {
      out.push({ kind, from, worth: paValue - prev, terminal: true })
      return out
    }
    const next = at({ balls, strikes })
    if (next == null) return []
    out.push({ kind, from, worth: next - prev, terminal: false })
    prev = next
  }

  // No terminal pitch, but the plate appearance is over: give the leftover to the last pitch
  // so the column still sums to the outcome.
  const last = out[out.length - 1]
  if (last) last.worth += paValue - prev
  return out
}

/** Whether the batter offered at it. A hit by pitch is a take: she did not swing, and leaving
 *  it out of both columns would stop them summing to the plate appearance. */
export const isSwing = (kind: PitchKind): boolean =>
  kind === 'swinging' || kind === 'foul' || kind === 'inplay'

// ── What each kind of pitch is worth ────────────────────────────────────────────

export interface KindValue {
  kind: PitchKind
  n: number
  /** Mean runs for the batting side. */
  per: number
  total: number
}

const KIND_ORDER: readonly PitchKind[] = ['ball', 'called', 'swinging', 'foul', 'inplay', 'hbp']

export function kindValues(values: readonly PlayRunValue[], counts: readonly CountValue[]): KindValue[] {
  const at = countValueAt(counts)
  const acc = new Map<PitchKind, { n: number; total: number }>()
  for (const v of values) {
    const seq = v.play.pitch_sequence
    if (!seq) continue
    for (const p of paDecomposition(seq, v.value, at)) {
      const a = acc.get(p.kind) ?? { n: 0, total: 0 }
      a.n++; a.total += p.worth; acc.set(p.kind, a)
    }
  }
  return KIND_ORDER
    .map(kind => {
      const a = acc.get(kind)
      return a && a.n > 0 ? { kind, n: a.n, per: a.total / a.n, total: a.total } : null
    })
    .filter((x): x is KindValue => x !== null)
}

/**
 * The whole gap between a ball and a strike in a given count, INCLUDING the counts where one
 * side of it is an outcome rather than a count.
 *
 * `pitchSwing` in countValue.ts answers this off the count table alone and so has to give up
 * at 3-anything and anything-2, which is where the answer is most interesting: on 3-2 the two
 * outcomes are a walk and a strikeout and the pitch is worth over a run either way, against
 * about a tenth on 0-0. Measured here from the pitches themselves, so a terminal pitch is
 * priced at what actually happened.
 */
export function fullCountSwing(
  values: readonly PlayRunValue[], counts: readonly CountValue[], from: Count,
): number | null {
  const at = countValueAt(counts)
  let ball = 0, ballN = 0, strike = 0, strikeN = 0
  const key = countKey(from)
  for (const v of values) {
    const seq = v.play.pitch_sequence
    if (!seq) continue
    for (const p of paDecomposition(seq, v.value, at)) {
      if (countKey(p.from) !== key) continue
      if (p.kind === 'ball') { ball += p.worth; ballN++ }
      // A foul is not a strike here: below two it advances the count like one, at two it does
      // nothing at all, and averaging the two together would answer a question nobody asked.
      else if (p.kind === 'called' || p.kind === 'swinging') { strike += p.worth; strikeN++ }
    }
  }
  const MIN = 10
  if (ballN < MIN || strikeN < MIN) return null
  return ball / ballN - strike / strikeN
}

// ── Per player ──────────────────────────────────────────────────────────────────

export interface TakeSwingLine {
  player: WpblPlayer | null
  name: string
  teamId: string | null
  pitches: number
  /** Runs on the pitches the batter did not offer at, in whichever direction is good news for
   *  the side asked for. */
  taking: number
  swinging: number
  /** taking + swinging, which is the player's run value exactly. Deliberately re-derived here
   *  rather than read off `runValueLeaders`: a total that came from somewhere else could
   *  disagree with the two numbers printed beside it and nothing would report it. */
  total: number
}

/**
 * Split every player's season into the pitches they took and the pitches they offered at.
 *
 * THE ONE QUESTION THE SECTION COULD NOT ASK. A hitter's run value is one number and the
 * discipline board is a table of rates, so a hitter with the best eye in the league and
 * nothing behind it looks average on the first and excellent on the second, and no surface
 * puts the two together. Split in runs it reads in one line: Maggie Foxx is +4.4 on the
 * pitches she takes and −12.8 on the ones she swings at.
 *
 * Plate appearances only, for the reason `runValueLeaders` gives: on a steal the feed still
 * fills `batter_name` with whoever is standing at the plate, so a row built from every play
 * would credit her with the runner's work.
 *
 * A pitcher's numbers are the batting side's NEGATED, like every other pitching total here,
 * so bigger is better on both sides of the board.
 *
 * THE FIRST PITCH CARRIES THE 0-0 BASELINE, which is the one thing here that is a choice
 * rather than arithmetic. `paDecomposition` prices a pitch by what it CHANGED, so its parts
 * sum to the plate appearance minus the value of 0-0: a plate appearance is worth about a
 * hundredth of a run before anybody does anything, and that hundredth belongs to no pitch.
 * Left where it is, a regular's two columns come out about half a run above the run-value
 * total printed beside them, which is small, permanent, and exactly the kind of thing a reader
 * who checks the arithmetic will find. So it goes on the first pitch, once per plate
 * appearance: the bias that introduces is under 0.4 runs across a whole season, against a
 * card whose entire claim is that the two numbers add up to the one next to it.
 */
export function takeSwingSplit(
  values: readonly PlayRunValue[],
  counts: readonly CountValue[],
  players: readonly WpblPlayer[],
  side: 'hitting' | 'pitching',
): TakeSwingLine[] {
  const at = countValueAt(counts)
  const base = at({ balls: 0, strikes: 0 }) ?? 0
  const byId = new Map(players.map(p => [p.id, p]))
  const rows = new Map<string, TakeSwingLine>()

  for (const v of values) {
    const seq = v.play.pitch_sequence
    if (!seq) continue
    const id = side === 'hitting' ? v.play.batter_id : v.play.pitcher_id
    const name = (side === 'hitting' ? v.play.batter_name : v.play.pitcher_name) ?? ''
    if (!name) continue
    const parts = paDecomposition(seq, v.value, at)
    if (parts.length === 0) continue

    const key = id ?? `name:${name.toLowerCase()}`
    let row = rows.get(key)
    if (!row) {
      row = {
        player: id ? byId.get(id) ?? null : null,
        name,
        // The club that was batting is on the play, and the fielding one is worked out from
        // the schedule: a traded player's July has to read as the club she played it for,
        // which her roster row no longer knows.
        teamId: side === 'hitting' ? v.play.team_id : v.fieldingTeamId,
        pitches: 0, taking: 0, swinging: 0, total: 0,
      }
      rows.set(key, row)
    }
    const sign = side === 'hitting' ? 1 : -1
    parts.forEach((p, i) => {
      // See the note above: the value of standing in at 0-0 rides along with the first pitch,
      // so the two columns sum to the plate appearance and not to the plate appearance less a
      // baseline nobody printed.
      const worth = sign * (p.worth + (i === 0 ? base : 0))
      row!.pitches++
      if (isSwing(p.kind)) row!.swinging += worth; else row!.taking += worth
      row!.total += worth
    })
  }

  return [...rows.values()].sort((a, b) => b.taking - a.taking)
}

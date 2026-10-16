// WBSC's numeric codes, and what each becomes in the neutral play log (src/league/types.ts).
//
// EVERY TABLE HERE IS A CLOSED LIST, and a code missing from one fails the import for that game
// with the row printed. The alternative, filing it as 'unknown', is how a board quietly drifts:
// a new kind of out would fall out of every rate it belongs in and nothing would say so. Each
// entry was read off the 30 games of the 2026 group stage against the scorer's own narrative;
// a code the back catalog turns up gets added the same way, one at a time.

import type { WbscPlayRow } from './types'

/**
 * `result1`, what one pitch was, as the letter `pitch_sequence` spells it.
 *
 * OUR ALPHABET, NOT WBSC'S NUMBERS, so the binding's `pitchCodes` reads like the other two
 * leagues' and a sequence can be eyeballed. 1 (the intentional walk) is not here because it is
 * not a pitch: WBSC writes it as one row with no pitch thrown.
 */
export const PITCH_LETTER: Readonly<Record<number, string>> = {
  2: 'B', // ball
  3: 'H', // hit by pitch; terminal
  4: 'C', // called strike
  5: 'S', // swinging strike
  6: 'F', // foul
  9: 'X', // in play; terminal
}

/** The `result1` codes that are not a pitch but are still known. */
export const NON_PITCH_RESULT1 = new Set([1])

/**
 * `result2`, how a plate appearance ended, as the `event_type` the engines already read (WPBL's
 * vocabulary, which the MLB mirror also normalises onto).
 *
 * A function rather than a map only because 4 is every air out, and which kind it was is only in
 * the scorer's notation (see `airOut`).
 */
const PA_RESULT: Readonly<Record<number, string | ((row: WbscPlayRow) => string | null)>> = {
  1: 'strikeout',       // looking
  2: 'strikeout',       // swinging
  3: 'groundout',
  4: row => airOut(row.narrative),
  // Grounded into a double play. WPBL's feed files these under the batter's own result too, and
  // the extra out is in the next row's base-out state, which is all run expectancy reads.
  5: 'groundout',
  11: 'fielders_choice',
  12: 'field_error',    // reached on an error
  13: 'walk',
  // Kept apart from 'walk': it has no pitches, and a pitch board that counted it would credit a
  // pitcher with a walk on an empty sequence.
  14: 'intent_walk',
  15: 'hit_by_pitch',
  16: 'catcher_interference',
  18: 'single',
  19: 'double',
  20: 'triple',
  21: 'home_run',
  // Out by rule: a two-strike bunt foul (102), a dropped infield fly (108).
  102: 'out',
  108: 'out',
}

/**
 * Which air out a `result2` 4 was, from the scorer's notation in the narrative.
 *
 * NOT FROM `result3`, which looks like the notation and is not: it reads 'F2' on a foul fly the
 * narrative scores 'FF2', and 'F3' on a pop-up scored 'P3'. Trusting it filed all 340 air outs
 * of the 2026 groups as fly outs, 131 of them wrongly. The vocabulary is WPBL's, including
 * 'sacrifice' for a sacrifice fly, which is how that feed files one.
 */
export function airOut(narrative: string | null | undefined): string | null {
  const n = narrative ?? ''
  if (/\bSF\d/.test(n) || /Sacrifice Fly/i.test(n)) return 'sacrifice'
  if (/\bF[FPL]\d/.test(n)) return 'foul_out'   // foul fly, foul pop, foul liner
  if (/\bP\d/.test(n)) return 'popup'
  if (/\bL\d/.test(n)) return 'lineout'
  if (/\bF\d/.test(n)) return 'flyout'
  return null
}

/** `result2` 28: the tie-break runner placed on second at the start of an extra inning. Not a
 *  plate appearance, and not an event: the runner shows up in the next row's base state. */
export const TIE_BREAK_PLACEMENT = 28

/** The `event_type` of the row that ends a plate appearance, or null if its code is unknown. */
export function paEventType(row: WbscPlayRow): string | null {
  const entry = PA_RESULT[row.result2]
  if (entry === undefined) return null
  return typeof entry === 'function' ? entry(row) : entry
}

/**
 * `runnerNtoM`, why a runner moved, on a row that is NOT the end of a plate appearance. A runner
 * moving on the play that ends one is part of that play and needs no reason of its own.
 */
export const ADVANCE_REASON: Readonly<Record<number, string>> = {
  31: 'wild_pitch',
  32: 'passed_ball',
  33: 'balk',
  34: 'stolen_base',
  51: 'error_advance', // the narrative's E1T, E2T: an error on a throw
}

/**
 * Which baserunning event a mid-plate-appearance row is, or null if it moved nobody.
 *
 * ONE EVENT PER ROW, by precedence, because the play log has one row per event and a single
 * pitch can carry two (a runner steals second and takes third on the catcher's throw). An out
 * outranks an advance, since the out is what changes the state most.
 *
 * Returns 'unknown_advance' / 'unknown_out' for a movement whose reason is not recognised, which
 * the validation turns into a failure; it never reaches a file.
 */
export function baserunningEvent(row: WbscPlayRow): string | null {
  const outs = [row.runner1out, row.runner2out, row.runner3out].filter(v => v > 0)
  if (outs.length) {
    // The fielders are in the code; whether it was a steal or a pickoff is only in the notation
    // the scorer wrote, which the narrative carries ("CS26", "PO13").
    const n = row.narrative ?? ''
    if (/\bCS\d/.test(n)) return 'caught_stealing'
    if (/\bPO\d/.test(n)) return 'pickoff'
    return 'unknown_out'
  }
  const reasons = [
    row.runner1to2, row.runner1to3, row.runner1to4,
    row.runner2to3, row.runner2to4, row.runner3to4,
  ].filter(v => v > 0)
  if (!reasons.length) return null
  for (const r of [34, 31, 32, 33, 51]) if (reasons.includes(r)) return ADVANCE_REASON[r]
  return 'unknown_advance'
}

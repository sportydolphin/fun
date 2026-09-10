import type { PlayRunValue } from './runExpectancy'

// ─── What a count is worth ────────────────────────────────────────────────────
//
// THE COUNT IS THE ONE THING THIS FEED RECORDS ABOUT EVERY PITCH. There is no velocity, no
// location and no pitch type outside the 766 TrackMan rows from two games in August, but
// `pitch_sequence` is on 2,222 of the season's plate appearances and it says, in order, what
// each pitch did. That is enough to answer the question the section has never asked: what is
// a 1-0 worth in this league, and what does 0-2 cost.
//
// PRICED IN THIS LEAGUE'S OWN RUNS, off the run-expectancy table built from these same plays.
// A WPBL half-inning is worth roughly double a major-league one, so a borrowed count table
// would be wrong by a factor before it started.
//
// A count's value here is the average run value of the plate appearances that PASSED THROUGH
// it. Every plate appearance passes through 0-0, so 0-0 is the league's average plate
// appearance by construction, and every other count reads against it.

/**
 * The feed's six pitch codes.
 *
 * `P` IS THE BALL BEING PUT IN PLAY, AND THE FEED CALLS IT A PITCHOUT. Its own `pitch_events`
 * entry is `{"code":"P","type":"pitchout","description":"Pitchout"}` on all 1,563 of them,
 * which would make this a league where a fifth of all pitches are pitchouts. It is terminal in
 * 1,560 of the 1,563 sequences that contain one and the plate appearance ends in a batted
 * ball, which a real pitchout cannot do. Read the code, never the feed's label for it.
 *
 * `K` has `type: "unknown"` for the same reason: the label is unreliable and the code is not.
 */
export const PITCH_EFFECT = {
  B: 'ball',
  K: 'strike',
  S: 'strike',
  F: 'foul',
  H: 'hbp',
  P: 'inplay',
} as const

export type PitchEffect = typeof PITCH_EFFECT[keyof typeof PITCH_EFFECT]

export interface Count { balls: number; strikes: number }

/** "1-2". The order is balls then strikes, as it is said out loud. */
export const countKey = (c: Count): string => `${c.balls}-${c.strikes}`

/** Every count a batter can legally stand in: 0-0 through 3-2. */
export const ALL_COUNTS: readonly Count[] = (() => {
  const out: Count[] = []
  for (let b = 0; b <= 3; b++) for (let s = 0; s <= 2; s++) out.push({ balls: b, strikes: s })
  return out
})()

/**
 * The counts a plate appearance stood in, starting at 0-0.
 *
 * DO NOT USE THE STORED `balls` / `strikes` COLUMNS FOR THIS. They are the final tally
 * INCLUDING the deciding pitch, so a walk is recorded as 4-0 and a strikeout as 1-3: counts
 * that cannot exist and that the batter never stood in. 633 of the season's 2,222 plate
 * appearances are stored that way, which is every one that did not end on a ball in play.
 * It is the same shape as the `live_state` trap in CLAUDE.md, and the same answer: clamp.
 *
 * A foul with two strikes does not advance the count, so it revisits 3-2 rather than adding a
 * new one; the result is deduplicated because a nine-pitch at-bat should not count as nine
 * visits to 3-2 when pricing it.
 */
export function countsThrough(sequence: string | null | undefined): Count[] {
  const seen = new Set<string>()
  const out: Count[] = []
  let balls = 0, strikes = 0

  const visit = () => {
    const c = { balls, strikes }
    const k = countKey(c)
    if (!seen.has(k)) { seen.add(k); out.push(c) }
  }

  visit()                                  // every plate appearance starts at 0-0
  for (const ch of sequence ?? '') {
    const effect = PITCH_EFFECT[ch as keyof typeof PITCH_EFFECT]
    // An unknown code is skipped rather than guessed at: advancing the count on a character
    // this does not recognise would misprice every count after it in the same at-bat.
    if (effect === 'ball') balls = Math.min(3, balls + 1)
    else if (effect === 'strike') strikes = Math.min(2, strikes + 1)
    else if (effect === 'foul') { if (strikes < 2) strikes++ }
    else continue                          // in play or hit by pitch: the at-bat is over
    visit()
  }
  return out
}

export interface CountValue {
  count: Count
  key: string
  /** Plate appearances that reached this count. */
  n: number
  /** Mean run value of those plate appearances, in this league's runs. */
  per: number
  /** Share of them that ended each way, for reading the number against something concrete. */
  walk: number
  strikeout: number
  hit: number
  /** How often a plate appearance that got here ended right here. */
  ended: number
}

const isWalk = (e: string | null) => e === 'walk'
const isK    = (e: string | null) => e === 'strikeout'

/**
 * Price every count off the plate appearances that passed through it.
 *
 * Only rows with a `pitch_sequence`, which is the feed's own marker for "this is a plate
 * appearance": a stolen base or a wild pitch is a play with a run value and no count of its
 * own, and folding those in would credit the batter's count with the runner's work.
 */
export function countValues(values: readonly PlayRunValue[], minPa = 25): CountValue[] {
  interface Acc { n: number; total: number; walk: number; k: number; hit: number; ended: number }
  const acc = new Map<string, Acc>()
  const get = (k: string): Acc => {
    let a = acc.get(k)
    if (!a) { a = { n: 0, total: 0, walk: 0, k: 0, hit: 0, ended: 0 }; acc.set(k, a) }
    return a
  }

  for (const v of values) {
    const seq = v.play.pitch_sequence
    if (!seq) continue
    const counts = countsThrough(seq)
    const event = v.play.event_type ?? null
    const hit = event === 'single' || event === 'double' || event === 'triple' || event === 'home_run'
    const final = counts[counts.length - 1]

    for (const c of counts) {
      const a = get(countKey(c))
      a.n++
      a.total += v.value
      if (isWalk(event)) a.walk++
      if (isK(event)) a.k++
      if (hit) a.hit++
      if (final && countKey(final) === countKey(c)) a.ended++
    }
  }

  return ALL_COUNTS
    .map(count => {
      const a = acc.get(countKey(count))
      if (!a || a.n < minPa) return null
      return {
        count, key: countKey(count), n: a.n, per: a.total / a.n,
        walk: a.walk / a.n, strikeout: a.k / a.n, hit: a.hit / a.n, ended: a.ended / a.n,
      }
    })
    .filter((x): x is CountValue => x !== null)
}

/**
 * What one pitch is worth from a given count: the gap between the count after a ball and the
 * count after a strike.
 *
 * THE HEADLINE NUMBER, because "0-0 is worth +0.01" means nothing on its own while "the first
 * pitch is worth a tenth of a run either way" is the whole point of caring about counts. Null
 * when either side of the comparison is missing or too rare to price.
 */
export function pitchSwing(rows: readonly CountValue[], from: Count): number | null {
  const at = (c: Count) => rows.find(r => r.key === countKey(c))?.per ?? null
  // A fourth ball and a third strike are outcomes rather than counts, so the edges compare
  // against the walk and the strikeout instead of a count that cannot exist.
  if (from.balls >= 3 || from.strikes >= 2) return null
  const ball = at({ balls: from.balls + 1, strikes: from.strikes })
  const strike = at({ balls: from.balls, strikes: from.strikes + 1 })
  return ball == null || strike == null ? null : ball - strike
}

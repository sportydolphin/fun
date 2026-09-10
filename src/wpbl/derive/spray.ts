import type { WpblSprayPlay } from '../types'

// ─── Where the ball went ──────────────────────────────────────────────────────
//
// THE FEED PUBLISHES NO HIT LOCATION AT ALL. There is no coordinate anywhere in it: not on
// the play, not on the box-score line, and the one source that would carry one (TrackMan) is
// 766 rows from two games in early August. What there IS, in the play's own narrative, is the
// scorer's English: "singled to left field", "flied out to rf", "homered down the lf line",
// "grounded out p to ss to 1b". That is a DIRECTION, and 742 plays carry one.
//
// SO THIS IS ZONES, NEVER COORDINATES, and the chart that draws it has to say so. Eleven
// regions is the whole resolution available, and a renderer that scatters dots inside them
// would be inventing precision the league never published. When RetroWPBL's hit locations
// arrive the same zone stays correct and gains a point inside it; nothing here has to be
// unlearned.
//
// TWO TRAPS, BOTH LIVE.
//
// A NARRATIVE DESCRIBES MORE THAN THE BATTED BALL. "grounded out p to ss to 1b, RBI (0-0);
// Ayuri Shimano advanced to second" contains three fielders and a runner going to second, and
// naive matching on "to <something>" reads that runner as a direction: `to second` was the
// 4th most common fragment in the whole play log when this was written, and every one of
// those is a baserunner rather than a batted ball. Everything after the first semicolon is
// somebody else's movement and is cut before anything else happens.
//
// A FIELDING SEQUENCE IS NOT A DIRECTION EITHER, it is a chain, and only its FIRST link says
// where the ball was hit. "p to ss to 1b" went to the pitcher. So the scan returns the
// earliest direction in the clause rather than the last or the most specific.

/** The eleven places this feed can put a batted ball. */
export type SprayZone = 'LF' | 'LCF' | 'CF' | 'RCF' | 'RF' | 'P' | 'C' | '1B' | '2B' | '3B' | 'SS'

/** Left to right, as the chart draws them. The infield has no such list any more: the chart
 *  derives its own from the geometry, since the zones there tile a band rather than sit at
 *  points, and a second ordering would have been a second thing to keep in step. */
export const OUTFIELD_ZONES: readonly SprayZone[] = ['LF', 'LCF', 'CF', 'RCF', 'RF']

/**
 * The scorer's vocabulary, longest phrase first.
 *
 * ORDER IS LOAD BEARING inside each group: "left center" has to be tested before "left", or
 * every ball to left-center is filed in left field. The abbreviations are matched on word
 * boundaries because a single letter is otherwise found inside the batter's own name.
 */
const PHRASES: ReadonlyArray<readonly [RegExp, SprayZone]> = [
  [/\bleft center(?:field)?\b/,   'LCF'],
  [/\bright center(?:field)?\b/,  'RCF'],
  [/\blcf\b/,                     'LCF'],
  [/\brcf\b/,                     'RCF'],
  [/\bleft field\b/,              'LF'],
  [/\bcenter field\b/,            'CF'],
  [/\bright field\b/,             'RF'],
  [/\blf\b/,                      'LF'],
  [/\bcf\b/,                      'CF'],
  [/\brf\b/,                      'RF'],
  [/\bshortstop\b/,               'SS'],
  [/\bfirst base(?:man)?\b/,      '1B'],
  [/\bsecond base(?:man)?\b/,     '2B'],
  [/\bthird base(?:man)?\b/,      '3B'],
  [/\bpitcher\b/,                 'P'],
  [/\bcatcher\b/,                 'C'],
  [/\bss\b/,                      'SS'],
  [/\b1b\b/,                      '1B'],
  [/\b2b\b/,                      '2B'],
  [/\b3b\b/,                      '3B'],
  [/\bp\b/,                       'P'],
  [/\bc\b/,                       'C'],
]

/**
 * "down the line" names a FOUL LINE, not a fielder.
 *
 * "doubled down the 3b line" is a ball past third into the left-field corner, and reading its
 * "3b" through the table above would file it as a ball fielded by the third baseman: an
 * extra-base hit recorded as an infield grounder. Tested first, and its match consumes the
 * clause so the general scan never sees those characters.
 */
const LINE_DRIVE: ReadonlyArray<readonly [RegExp, SprayZone]> = [
  [/\bdown the (?:lf|left field|3b|third base) line\b/, 'LF'],
  [/\bdown the (?:rf|right field|1b|first base) line\b/, 'RF'],
]

/**
 * The phrases that name a direction without naming a place.
 *
 * "singled up the middle", "singled through the left side", "doubled through the right side".
 * 125 of the season's 454 singles are described this way, and not one of them contains a
 * fielder or a field to match on, so before this every one was a ball nobody could place and
 * singles were the worst-covered hit type in the log at 72%.
 *
 * They name the gap the ball went THROUGH, and a ground ball through the left side of the
 * infield finishes in left field, which is where a chart of direction belongs to put it.
 * Tested alongside the foul lines and before the general scan, because "up the middle" would
 * otherwise fall through every rule and land nowhere.
 */
const GAPS: ReadonlyArray<readonly [RegExp, SprayZone]> = [
  [/\bup the middle\b/,          'CF'],
  [/\bthrough the middle\b/,     'CF'],
  [/\bthrough the left side\b/,  'LF'],
  [/\bthrough the right side\b/, 'RF'],
]

/** The batter's own verb. Anything before it is a name and cannot be a direction. */
const VERB = /\b(?:singled|doubled|tripled|homered|grounded|flied|lined|popped|fouled|bunted|reached|sacrificed|hit|out)\b/

/**
 * The zone a play's narrative names, or null when it names none.
 *
 * Null is a real and common answer, not a failure: a walk, a strikeout and a stolen base have
 * no batted ball at all, and plenty of real batted balls are described without a direction
 * ("out on batter's interference"). Callers must count nulls rather than dropping them
 * silently, or a chart claims to show a season it has only seen half of.
 */
export function sprayZone(narrative: string | null | undefined): SprayZone | null {
  if (!narrative) return null

  // Everything after the first semicolon is a RUNNER, not the batted ball. See the header.
  let clause = narrative.split(';')[0].toLowerCase()
  // The pitch count rides in parentheses ("(3-2 KKBBFBFS)") and its letters collide with the
  // one-letter fielder codes below.
  clause = clause.replace(/\([^)]*\)/g, ' ')

  for (const [re, zone] of LINE_DRIVE) if (re.test(clause)) return zone
  for (const [re, zone] of GAPS) if (re.test(clause)) return zone

  // From the verb onwards, so the batter's NAME cannot supply a match.
  //
  // NO VERB MEANS NO ANSWER, rather than falling back to scanning the whole clause. Every
  // batted ball is described with one of these verbs, so a clause without one is not a batted
  // ball this can place; scanning it anyway only exposes the batter's name to the one-letter
  // fielder codes, and a player whose name begins "Cf" would have every plate appearance
  // filed in centre field.
  const verb = clause.search(VERB)
  if (verb >= 0) {
    const tail = clause.slice(verb)
    // THE EARLIEST MATCH WINS, because a fielding sequence is a chain and only its first link
    // says where the ball was hit. Scanning the table in order instead would return whichever
    // phrase happens to sit highest in it.
    let best: { at: number; zone: SprayZone } | null = null
    for (const [re, zone] of PHRASES) {
      const at = tail.search(re)
      if (at >= 0 && (best === null || at < best.at)) best = { at, zone }
    }
    if (best) return best.zone
  }

  // THE ONE PLACE THE RUNNER'S CLAUSE IS ALLOWED TO ANSWER, and it is a fielder's choice.
  //
  // "Val Perez reached on a fielder's choice (2-0 BB); Alyssa Zettlemoyer out at second cf to
  // 2b" says nothing about the batted ball before the semicolon, because on a fielder's
  // choice the interesting event IS the runner being retired. But the fielder who started
  // that throw is the fielder who picked the ball up, so "cf to 2b" places the ball in centre
  // field as surely as "flied out to cf" would. 31 of the season's 76 fielder's choices are
  // written this way and were the last real gap in the coverage.
  //
  // Narrow on purpose: only the "out at <base> <fielder> to ..." shape, only when the
  // batter's own clause named nothing, and only the FIRST fielder in the chain. Widening it
  // to any "to <fielder>" after a semicolon would start reading ordinary baserunning as
  // batted-ball direction, which is the trap this whole function is arranged around.
  const relay = narrative.toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .match(/\bout at (?:first|second|third|home)\s+([a-z0-9]{1,3})\s+to\b/)
  if (relay) {
    for (const [re, zone] of PHRASES) if (re.test(relay[1])) return zone
  }
  return null
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

export interface ZoneTally { zone: SprayZone; hits: number; outs: number; total: number }

export interface SprayProfile {
  /** One entry per zone that saw a ball. Callers draw every zone; empty ones simply aren't here. */
  zones: ZoneTally[]
  /** Balls in play the narrative placed. */
  placed: number
  /** Batted balls whose narrative named no direction. Shown, never hidden. */
  unplaced: number
  hits: number
  outs: number
}

/** Event types that put a ball in play. A walk or a strikeout has no direction to find. */
const BATTED = new Set([
  'single', 'double', 'triple', 'home_run',
  'groundout', 'flyout', 'lineout', 'popup', 'foul_out', 'sacrifice', 'fielders_choice', 'out',
])

export const isBattedBall = (eventType: string | null | undefined): boolean =>
  !!eventType && BATTED.has(eventType)

/** Roll a set of plays into per-zone hit/out counts. */
export function sprayProfile(plays: readonly WpblSprayPlay[]): SprayProfile {
  const byZone = new Map<SprayZone, ZoneTally>()
  let placed = 0, unplaced = 0, hits = 0, outs = 0

  for (const p of plays) {
    if (!isBattedBall(p.event_type)) continue
    const hit = !!p.is_hit
    if (hit) hits++; else outs++

    const zone = sprayZone(p.narrative)
    if (!zone) { unplaced++; continue }
    placed++
    const t = byZone.get(zone) ?? { zone, hits: 0, outs: 0, total: 0 }
    if (hit) t.hits++; else t.outs++
    t.total++
    byZone.set(zone, t)
  }

  return {
    zones: [...byZone.values()].sort((a, b) => b.total - a.total),
    placed, unplaced, hits, outs,
  }
}

// ─── Pull and opposite field ──────────────────────────────────────────────────

export type SpraySide = 'pull' | 'center' | 'oppo'

/** Which zones are which side of the field, from the RIGHT-handed batter's point of view. */
const RIGHTY_SIDE: Record<SprayZone, SpraySide> = {
  LF: 'pull', LCF: 'pull', '3B': 'pull', SS: 'pull',
  CF: 'center', P: 'center', C: 'center',
  RF: 'oppo', RCF: 'oppo', '1B': 'oppo', '2B': 'oppo',
}

const MIRROR: Record<SpraySide, SpraySide> = { pull: 'oppo', center: 'center', oppo: 'pull' }

/**
 * Pull, centre or opposite field for this batter, or null when it cannot be said.
 *
 * NULL FOR A SWITCH HITTER, AND THAT IS NOT LAZINESS. "Pull" is defined by which box she
 * stood in, and the feed records a switch hitter's handedness as `S` on the roster while
 * saying nothing per plate appearance. Guessing from the opposing pitcher would be a model,
 * not a fact, so a switch hitter has a spray chart and no pull rate. Callers must leave her
 * out of the denominator instead of counting her as a righty.
 */
export function spraySide(zone: SprayZone, bats: string | null | undefined): SpraySide | null {
  const b = (bats ?? '').trim().toUpperCase()[0]
  if (b === 'R') return RIGHTY_SIDE[zone]
  if (b === 'L') return MIRROR[RIGHTY_SIDE[zone]]
  return null
}

export interface PullProfile { pull: number; center: number; oppo: number; total: number; pullPct: number | null }

/** Pull / centre / oppo counts for one batter. `total` is only the balls that could be sided. */
export function pullProfile(plays: readonly WpblSprayPlay[], bats: string | null | undefined): PullProfile {
  let pull = 0, center = 0, oppo = 0
  for (const p of plays) {
    if (!isBattedBall(p.event_type)) continue
    const zone = sprayZone(p.narrative)
    if (!zone) continue
    const side = spraySide(zone, bats)
    if (side === 'pull') pull++
    else if (side === 'center') center++
    else if (side === 'oppo') oppo++
  }
  const total = pull + center + oppo
  return { pull, center, oppo, total, pullPct: total ? (pull / total) * 100 : null }
}

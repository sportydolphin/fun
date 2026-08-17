/**
 * "Call the Play": turns a real plate appearance from the league's play-by-play into a
 * multiple-choice question.
 *
 * WHY THIS SHAPE. A four-team league with 118 players is a thin dataset for trivia. Straight
 * recall ("who led the league in doubles?") runs out in a week. Situations do not: every plate
 * appearance is its own question, there are about 980 usable ones in the season, and they stay
 * answerable by baseball sense rather than memory, so they are still fun to someone who never
 * watched the game they came from. That is what makes this worth having in November, when the
 * feed has gone quiet and nothing else on the site has anything new to say.
 *
 * PURE ON PURPOSE. No database, no Discord, no fetch. It takes a play and returns a question,
 * so the same engine can serve a slash command today and an embedded Activity later without
 * being rewritten. Randomness is injected rather than taken from Math.random, so a question is
 * reproducible from its seed and the tests can assert on one.
 *
 * THE COUNT LEAKS THE ANSWER, AND THAT IS THE SUBTLE BIT. `strikes` reaches 3 only on a
 * strikeout and `balls` reaches 4 only on a walk or hit-by-pitch, because the feed stores the
 * count AFTER the deciding pitch. Printing it raw would hand over the answer on about 240 of
 * the plays. Clamping to 3-and-2 is not a fudge: it is the count as it stood when the pitcher
 * came set, which is exactly the situation the reader is being asked to read.
 */

export interface TriviaPlay {
  id: string
  game_id: string
  sequence: number
  inning: number | null
  half: string | null
  outs: number | null
  balls: number | null
  strikes: number | null
  first_base: string | null
  second_base: string | null
  third_base: string | null
  batter_name: string | null
  pitcher_name: string | null
  event_type: string | null
  narrative: string | null
}

export interface TriviaQuestion {
  playId: string
  gameId: string
  sequence: number
  /** The situation, with the outcome removed. */
  prompt: string
  /** Four outcome labels, one of them correct. */
  options: string[]
  correctIndex: number
  /** The feed's own sentence, revealed after answering. */
  detail: string
}

// How each outcome is written on a button. Deliberately coarse: the question is "what
// happened", not "which fielder", so "Groundout" is the answer and "grounded out to short" is
// the reveal.
const LABELS: Record<string, string> = {
  single: 'Single',
  double: 'Double',
  triple: 'Triple',
  home_run: 'Home run',
  walk: 'Walk',
  hit_by_pitch: 'Hit by pitch',
  strikeout: 'Strikeout',
  groundout: 'Groundout',
  flyout: 'Fly out',
  popup: 'Pop up',
  lineout: 'Line out',
  foul_out: 'Foul out',
  out: 'Out in play',
  fielders_choice: "Fielder's choice",
  sacrifice: 'Sacrifice',
}

/**
 * Outcomes whose members are near-synonyms to a spectator. "Fly out" against "Pop up", or
 * "Walk" against "Hit by pitch", is not a test of anything: nobody can separate them from a
 * situation, and a question nobody can reason about is a coin toss wearing a uniform. At most
 * one member of each of these may appear in a question, the answer included.
 *
 * `hit` is deliberately NOT in here. Single against double against home run is exactly the
 * judgement the game is asking for.
 */
const NEAR_SYNONYM_FAMILY: Record<string, string> = {
  groundout: 'out', flyout: 'out', popup: 'out', lineout: 'out', foul_out: 'out', out: 'out',
  walk: 'free', hit_by_pitch: 'free',
}

// Outcomes offered as wrong answers. `triple` is absent on purpose: the league has not hit one
// all season, so anyone who follows it knows it is never the answer, and an option that cannot
// be right quietly turns a four-way question into a three-way one.
const DISTRACTOR_POOL = [
  'single', 'double', 'home_run',
  'groundout', 'flyout', 'lineout', 'popup',
  'strikeout',
  'walk', 'hit_by_pitch',
  'fielders_choice', 'sacrifice',
]

/**
 * Whether an outcome is even POSSIBLE given the count on display, which is the other way a
 * dead option sneaks in.
 *
 * A walk needs four balls and a strikeout needs three strikes, so after clamping, a walk can
 * only appear at 3 balls and a strikeout only at 2 strikes. Offering "Strikeout" on an 0-0
 * count is offering an answer that cannot be right: measured against the season, 0 of 248
 * plays shown with no balls were a walk. Filtering them out is what keeps all four options
 * live, which is the difference between a four-way question and a three-way one wearing a
 * fourth button.
 *
 * HIT BY PITCH IS NOT IN THAT CLUB, and assuming it was is a mistake this function made
 * first time round. A walk is a consequence of the count; being hit is an accident that can
 * happen on any pitch, and the season bears that out: 17 at one ball, 10 at two, 4 at three.
 * Gating it like a walk quietly made it a dead option on 27 questions.
 */
export function isPossibleOutcome(event: string, ballsShown: number, strikesShown: number): boolean {
  if (event === 'walk') return ballsShown >= 3
  if (event === 'strikeout') return strikesShown >= 2
  return true
}

/**
 * Whether a play can be asked about at all.
 *
 * `unknown` is 21% of the table and is mostly pickoffs and substitutions, which have no
 * outcome to guess. A play also needs a batter and enough situation to be worth reading.
 */
export function isTriviaCandidate(play: TriviaPlay): boolean {
  if (!play.event_type || !(play.event_type in LABELS)) return false
  if (!play.batter_name) return false
  if (play.inning == null || play.outs == null) return false
  return true
}

const ORDINALS = ['0th', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th']
const ordinal = (n: number) => ORDINALS[n] ?? `${n}th`

/** Runners, named, because "runner on second" is a situation and "Caitlin Eynon on second" is
 *  a story. Empty strings rather than nulls are how the feed says "nobody there". */
export function describeRunners(play: TriviaPlay): string {
  const on = [
    [play.first_base, '1st'], [play.second_base, '2nd'], [play.third_base, '3rd'],
  ].filter(([name]) => name && String(name).trim()) as [string, string][]
  if (on.length === 0) return 'Bases empty'
  if (on.length === 3) return `Bases loaded (${on.map(([n]) => n).join(', ')})`
  return on.map(([name, base]) => `${name} on ${base}`).join(', ')
}

/**
 * The situation as a reader sees it, with the outcome withheld.
 *
 * The count is clamped to 3-and-2. See the header: the stored count is the one AFTER the
 * deciding pitch, so a raw 0-3 says "strikeout" before anyone has read the question.
 */
export function describeSituation(play: TriviaPlay): string {
  const half = (play.half ?? '').toLowerCase() === 'bottom' ? 'Bottom' : 'Top'
  const outs = play.outs === 1 ? '1 out' : `${play.outs} out`
  const balls = Math.min(play.balls ?? 0, 3)
  const strikes = Math.min(play.strikes ?? 0, 2)

  const lines = [
    `${half} ${ordinal(play.inning ?? 0)}, ${outs}. ${describeRunners(play)}.`,
    `Count ${balls}-${strikes}.`,
    play.pitcher_name
      ? `**${play.batter_name}** batting against **${play.pitcher_name}**.`
      : `**${play.batter_name}** batting.`,
  ]
  return lines.join('\n')
}

/** Fisher-Yates, with injected randomness so a question is reproducible from its seed. */
function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Build the question. Three wrong answers that are all genuinely possible given the count, no
 * two of them near-synonyms, then the four shuffled so the answer is not always in one place.
 */
export function buildQuestion(play: TriviaPlay, rng: () => number = Math.random): TriviaQuestion {
  if (!isTriviaCandidate(play)) {
    throw new Error(`Play ${play.id} cannot be a question: event_type ${play.event_type ?? 'null'}`)
  }
  const answer = play.event_type as string
  const ballsShown = Math.min(play.balls ?? 0, 3)
  const strikesShown = Math.min(play.strikes ?? 0, 2)

  // Families already spoken for. The answer claims its own, so a groundout is never offered
  // alongside a fly out.
  const usedFamilies = new Set<string>()
  if (NEAR_SYNONYM_FAMILY[answer]) usedFamilies.add(NEAR_SYNONYM_FAMILY[answer])

  const distractors: string[] = []
  for (const candidate of shuffle(DISTRACTOR_POOL, rng)) {
    if (distractors.length === 3) break
    if (candidate === answer) continue
    if (!isPossibleOutcome(candidate, ballsShown, strikesShown)) continue
    const family = NEAR_SYNONYM_FAMILY[candidate]
    if (family && usedFamilies.has(family)) continue
    if (family) usedFamilies.add(family)
    distractors.push(candidate)
  }

  const options = shuffle([LABELS[answer], ...distractors.map(d => LABELS[d])], rng)
  return {
    playId: play.id,
    gameId: play.game_id,
    sequence: play.sequence,
    prompt: describeSituation(play),
    options,
    correctIndex: options.indexOf(LABELS[answer]),
    detail: (play.narrative ?? '').trim(),
  }
}

/**
 * A small deterministic PRNG (mulberry32), so a question can be rebuilt from a seed rather
 * than stored option by option. That matters for the Discord path: the button press arrives as
 * a separate request, and rebuilding beats trusting the client to say what the options were.
 */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Turn any string (a play uuid) into a seed, so the same play always shuffles the same way. */
export function seedFrom(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

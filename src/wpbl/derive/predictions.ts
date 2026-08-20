/**
 * "Call It Early": the rules behind the Discord in-game predictions game.
 *
 * A mod opens a round about the half-inning that has NOT started yet, the channel answers
 * with buttons, and the league's own play-by-play settles it. This module is the whole of
 * the rulebook: which half-inning may be asked about, what the question says, what the
 * answer turns out to be, and who won the game. It knows nothing about Discord or Postgres,
 * so it is unit tested and both callers (the Cloudflare Pages interactions endpoint and the
 * wpbl-ingest edge function) settle a round by the same arithmetic rather than each doing
 * its own.
 *
 * WHY THE QUESTION IS ALWAYS ABOUT A HALF-INNING NOBODY HAS PLAYED. Nothing in the feed says
 * when a play happened: `pitch_events` carries code, type, sequence and description and no
 * clock at all, and `created_at` is our own insert time, rewritten every time the ingest
 * deletes and reinserts the game. So a voting window can never be closed before the event it
 * is about, and asking about the at-bat in progress cannot be made fair: roughly a quarter of
 * pitches end their plate appearance, so anyone watching could wait and then click. Asking
 * about the next half-inning removes the problem rather than managing it. Every run in it
 * crosses minutes after the buttons are dead.
 *
 * That is why `nextHalfInning` refuses to return a half-inning that is already under way, and
 * why it takes both the play log and the feed's live situation: between innings the two
 * disagree, and the round has to be built off whichever is further along.
 */
import { runsOnPlay } from './playByPlay.ts'

export type Half = 'top' | 'bottom'

export interface HalfInning { inning: number; half: Half }

/** The slim projection of a play the grader reads. Nothing else in a play row matters here. */
export interface PredictPlay {
  inning: number
  half: string | null
  sequence: number
  event_type: string | null
  runs_scored: number | null
}

/** The game columns the rules read. A `WpblGame` satisfies this. */
export interface PredictGame {
  status: string
  live_inning?: number | null
  live_half?: string | null
}

export interface PredictOption { key: string; label: string }

/** A round as the rules define it, before anything Discord-shaped is attached. */
export interface RoundDraft {
  kind: 'runs'
  question: string
  situation: string
  options: PredictOption[]
  target_inning: number
  target_half: Half
  anchor_sequence: number
  locks_at: string
}

/**
 * A half-inning's ordering key within one game. Grading keys on the half-inning itself rather
 * than on a play id or a sequence number because a half-inning names itself uniquely and
 * permanently: `wpbl_game_plays` is a mirror whose uuids the ingest regenerates on every pass,
 * and plays can arrive out of order, but "the top of the 4th" is the same frame either way.
 */
export const halfIndex = (h: HalfInning): number => h.inning * 2 + (h.half === 'bottom' ? 1 : 0)

export const fromHalfIndex = (i: number): HalfInning =>
  ({ inning: Math.floor(i / 2), half: i % 2 === 1 ? 'bottom' : 'top' })

const playHalf = (p: PredictPlay): HalfInning =>
  ({ inning: p.inning, half: p.half === 'bottom' ? 'bottom' : 'top' })

/** 1 becomes "1st". Used in both the question and the card, so it lives with the rules. */
export function ordinal(n: number): string {
  const rest = n % 100
  if (rest >= 11 && rest <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/** How far the game has actually got, by the two sources that can answer and often disagree. */
export function currentHalfIndex(game: PredictGame, plays: PredictPlay[]): number | null {
  let byPlays: number | null = null
  for (const p of plays) {
    const idx = halfIndex(playHalf(p))
    if (byPlays == null || idx > byPlays) byPlays = idx
  }
  // The feed's live situation is only meaningful while the game is live: on a scheduled game
  // `live_inning` defaults to 1 in our own schema and says nothing, and on a final one it is
  // whatever the last pass happened to see.
  const byFeed = game.status === 'live' && game.live_inning
    ? halfIndex({ inning: game.live_inning, half: game.live_half === 'bottom' ? 'bottom' : 'top' })
    : null
  if (byPlays == null) return byFeed
  if (byFeed == null) return byPlays
  return Math.max(byPlays, byFeed)
}

/**
 * The half-inning a round may honestly ask about: the first one that has not started.
 *
 * Null when there is nothing to ask about, which is a finished game. A scheduled game answers
 * "top of the 1st", so a round can be opened before first pitch.
 */
export function nextHalfInning(game: PredictGame, plays: PredictPlay[]): HalfInning | null {
  if (game.status === 'final') return null
  const current = currentHalfIndex(game, plays)
  if (current == null) return { inning: 1, half: 'top' }
  return fromHalfIndex(current + 1)
}

/** Has the target half-inning started? A pick arriving after this is no longer a prediction. */
export function halfInningStarted(target: HalfInning, game: PredictGame, plays: PredictPlay[]): boolean {
  const current = currentHalfIndex(game, plays)
  return current != null && current >= halfIndex(target)
}

// ─── The one round type that ships: how many runs ─────────────────────────────
//
// Four buckets rather than a typed number, because a button is the whole interface: a player
// never types. "3+" is the top bucket because a half-inning of four or more runs is rare
// enough that splitting it would only ever produce dead options, and because capping it is
// what lets a round settle the moment the third run crosses instead of waiting out the side
// (see gradeRunsRound).
export const RUNS_OPTIONS: PredictOption[] = [
  { key: '0', label: '0' },
  { key: '1', label: '1' },
  { key: '2', label: '2' },
  { key: '3', label: '3+' },
]

export const optionLabel = (key: string): string =>
  RUNS_OPTIONS.find(o => o.key === key)?.label ?? key

/** The bucket a run total falls in. Anything past 3 is the "3+" bucket. */
export const runsKey = (runs: number): string => String(Math.min(Math.max(runs, 0), 3))

export interface RoundInput {
  target: HalfInning
  /** Name of the side batting in the target half-inning. */
  battingTeam: string
  awayName: string
  homeName: string
  awayScore: number
  homeScore: number
  /** Where the play log stood when the round opened. Kept only to keep the grader's query
   *  small; grading itself never depends on it. */
  anchorSequence: number
  seconds: number
  now: Date
}

export function buildRunsRound(input: RoundInput): RoundDraft {
  const { target, battingTeam, awayName, homeName, awayScore, homeScore } = input
  return {
    kind: 'runs',
    question: `How many runs will ${battingTeam} score in the ${target.half} of the ${ordinal(target.inning)}?`,
    situation: `${awayName} ${awayScore}, ${homeName} ${homeScore} · ${battingTeam} batting next`,
    options: RUNS_OPTIONS,
    target_inning: target.inning,
    target_half: target.half,
    anchor_sequence: input.anchorSequence,
    // Floor rather than trust the caller: a window of a couple of seconds is a round nobody
    // can answer, and the timer is the only thing closing picks when a mod opens one and then
    // watches the game instead of the channel.
    locks_at: new Date(input.now.getTime() + Math.max(15, input.seconds) * 1000).toISOString(),
  }
}

// ─── Grading ──────────────────────────────────────────────────────────────────

export type Verdict =
  | { state: 'pending' }
  | { state: 'graded'; correctKey: string; runs: number; outcome: string; detail: string }
  | { state: 'void'; outcome: string; detail: string }

/**
 * Settle a runs round against the play log, as early as it can honestly be settled.
 *
 * Three ways a round resolves:
 *   - The third run crosses. The bucket cannot change after that, so there is no reason to
 *     make anyone sit through the rest of the inning.
 *   - A later half-inning appears in the log, which is the only durable evidence that this one
 *     is over. The alternative is counting outs, and `outs` on a play row is the feed's own
 *     field whose before/after meaning we would be guessing at.
 *   - The game goes final.
 *
 * A half-inning that was never played is VOID, not "held scoreless". The home side does not bat
 * in the bottom of the last inning when it is already ahead, and scoring that as 0 would punish
 * everyone who correctly called runs in a frame that never happened.
 */
export function gradeRunsRound(
  target: HalfInning,
  game: PredictGame,
  plays: PredictPlay[],
): Verdict {
  const idx = halfIndex(target)
  let runs = 0
  let played = 0
  let laterPlay = false
  for (const p of plays) {
    const pIdx = halfIndex(playHalf(p))
    // runsOnPlay, never p.runs_scored: the feed counts the runners who crossed and not the
    // batter, so a solo home run reads 0 in the column.
    if (pIdx === idx) { played++; runs += runsOnPlay(p) }
    else if (pIdx > idx) laterPlay = true
  }

  const where = `${target.half === 'top' ? 'Top' : 'Bottom'} ${ordinal(target.inning)}`
  const plural = (r: number) => (r === 1 ? '1 run' : `${r} runs`)

  if (runs >= 3) {
    return {
      state: 'graded', correctKey: '3', runs,
      outcome: plural(runs),
      detail: `${where}: ${plural(runs)} in, so this one is already settled.`,
    }
  }

  const over = laterPlay || game.status === 'final'
  if (!over) return { state: 'pending' }

  if (played === 0) {
    return {
      state: 'void',
      outcome: 'never played',
      detail: `${where} was never played, so this round counts for nothing.`,
    }
  }
  return {
    state: 'graded', correctKey: runsKey(runs), runs,
    outcome: plural(runs),
    detail: `${where}: ${plural(runs)}.`,
  }
}

// ─── The board ────────────────────────────────────────────────────────────────

export interface BoardRound { id: string; status: string; correct_key: string | null }
export interface BoardPick {
  round_id: string
  discord_user_id: string
  display_name: string
  option_key: string
  response_ms: number
}
export interface BoardRow {
  userId: string
  name: string
  correct: number
  answered: number
  meanMs: number
}

/**
 * Standings over the rounds that actually graded. A voided round counts for nobody, in either
 * direction: it is not a miss, and skipping it is not a penalty.
 *
 * The tiebreak is AVERAGE time to answer, never total. A total would punish whoever played the
 * most rounds, since ten answers accumulate ten response times and two accumulate two, so the
 * player who sat out most of the game would win every tie. Answering more is already rewarded
 * by the primary sort: a round you skipped can never be correct.
 */
export function buildBoard(rounds: BoardRound[], picks: BoardPick[]): BoardRow[] {
  const graded = new Map(
    rounds.filter(r => r.status === 'graded' && r.correct_key).map(r => [r.id, r.correct_key as string]),
  )
  const rows = new Map<string, BoardRow & { totalMs: number }>()
  for (const p of picks) {
    const key = graded.get(p.round_id)
    if (!key) continue
    const row = rows.get(p.discord_user_id)
      ?? { userId: p.discord_user_id, name: p.display_name || 'someone', correct: 0, answered: 0, meanMs: 0, totalMs: 0 }
    row.answered++
    row.totalMs += Math.max(0, p.response_ms || 0)
    if (p.option_key === key) row.correct++
    // The freshest display name wins: someone who changed their nickname mid-game should be
    // announced as whoever they are now.
    if (p.display_name) row.name = p.display_name
    rows.set(p.discord_user_id, row)
  }
  return [...rows.values()]
    .map(r => ({
      userId: r.userId, name: r.name, correct: r.correct, answered: r.answered,
      meanMs: Math.round(r.totalMs / Math.max(1, r.answered)),
    }))
    .sort((a, b) => b.correct - a.correct || a.meanMs - b.meanMs || a.name.localeCompare(b.name))
}

/**
 * The one winner, or nobody.
 *
 * Nobody winning is a real result. A game where every round voided, or where nobody called a
 * single one right, is announced as such rather than crowning the least wrong player.
 */
export function boardWinner(board: BoardRow[]): BoardRow | null {
  const top = board[0]
  return top && top.correct > 0 ? top : null
}

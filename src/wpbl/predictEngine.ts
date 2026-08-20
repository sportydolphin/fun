/**
 * Locking, grading and crowning: everything that happens to a round after a mod opens it.
 *
 * This is the duplicated plumbing and NOT duplicated rules. It runs on the ingest's two-minute
 * pass, which is what makes the reveal automatic, and it runs again whenever a mod asks for the
 * board or the winner, which is what keeps the game scoring correctly even if the ingest is
 * behind or has stopped. Both paths call the same pure functions in derive/predictions.ts, so
 * "settled by the feed" and "settled because someone asked" can never disagree.
 *
 * Nothing in here throws at its caller. A settle failing must never break an ingest pass or an
 * interaction: the worst outcome is a round that grades on the next pass instead of this one.
 *
 * Runtime imports carry `.ts` because wpbl-ingest loads this under Deno.
 */
import {
  boardWinner, buildBoard, gradeRunsRound, halfInningStarted,
  type BoardRow,
} from './derive/predictions.ts'
import { buildRoundCard, buildWinnerMessage, embedColorFromHex } from './discordPredictions.ts'
import {
  editRoundCard, postToChannel, roundTarget,
  type PredictGameRow, type PredictRound, type PredictStore, type PredictTeam,
} from './predictStore.ts'

export interface SettleResult {
  locked: number
  graded: number
  voided: number
  crowned: boolean
}

const ZERO: SettleResult = { locked: 0, graded: 0, voided: 0, crowned: false }

export interface SettleOptions {
  botToken?: string | null
  now?: Date
  /** Passed in when the caller already holds them, to save a read. */
  teams?: PredictTeam[]
  /** Skip the winner announcement even on a final game. The mod-run `/predict winner` uses
   *  this so it can post the announcement itself, as its own reply, with no bot token. */
  crown?: boolean
}

/**
 * Settle one game's rounds.
 *
 * The order matters: lock before grading. A round whose target half-inning has started is no
 * longer answerable, and grading it while it still shows live buttons would leave the channel
 * pressing them after the answer was known.
 */
export async function settleGame(
  store: PredictStore,
  gameId: string,
  opts: SettleOptions = {},
): Promise<SettleResult> {
  const now = opts.now ?? new Date()
  try {
    const [game, rounds] = await Promise.all([store.game(gameId), store.roundsForGame(gameId)])
    if (!game || rounds.length === 0) return ZERO

    const live = rounds.filter(r => r.status === 'open' || r.status === 'locked')
    const result: SettleResult = { locked: 0, graded: 0, voided: 0, crowned: false }

    if (live.length) {
      // From the earliest anchor across the open rounds: every play any of them could care
      // about came after the earliest of them opened.
      const from = Math.min(...live.map(r => r.anchor_sequence ?? 0))
      const plays = await store.plays(gameId, from)

      for (const round of live) {
        const target = roundTarget(round)
        const patch: Partial<PredictRound> = {}

        // Auto-close. Two independent triggers, and the second is the one that matters: the
        // timer is a backstop for a mod who opened a round and then went back to watching the
        // game, while the half-inning starting is the thing that actually ends a prediction.
        if (round.status === 'open'
          && (Date.parse(round.locks_at) <= now.getTime() || halfInningStarted(target, game, plays))) {
          patch.status = 'locked'
          patch.closed_at = now.toISOString()
          result.locked++
        }

        const verdict = gradeRunsRound(target, game, plays)
        if (verdict.state !== 'pending') {
          patch.status = verdict.state === 'void' ? 'void' : 'graded'
          patch.correct_key = verdict.state === 'graded' ? verdict.correctKey : null
          patch.outcome = verdict.outcome
          patch.detail = verdict.detail
          patch.graded_at = now.toISOString()
          patch.closed_at = patch.closed_at ?? round.closed_at ?? now.toISOString()
          if (verdict.state === 'void') result.voided++; else result.graded++
        }

        if (!patch.status) continue
        await store.updateRound(round.id, patch)
        if (patch.status === 'graded' || patch.status === 'void') {
          await store.gradePicks(round.id, patch.correct_key ?? null)
        }
        Object.assign(round, patch)
        // Best effort, and last: the round is scored whether or not the channel's card catches
        // up. See editRoundCard for why the card can legitimately go stale.
        await refreshCard(store, round, opts.botToken).catch(() => {})
      }
    }

    // The game is over and nothing is left hanging, so there is a winner to crown. Rounds that
    // are still open cannot happen here (a final game grades or voids every one of them above),
    // but the check is cheap and a crowned game cannot be un-crowned.
    const settledAll = rounds.every(r => r.status === 'graded' || r.status === 'void')
    if (opts.crown !== false && game.status === 'final' && settledAll) {
      result.crowned = await crownGame(store, game, rounds, opts)
    }
    return result
  } catch {
    return ZERO
  }
}

/** Every game with a round still live. The ingest's entry point. */
export async function settleOpenRounds(store: PredictStore, opts: SettleOptions = {}): Promise<SettleResult> {
  try {
    const open = await store.openRounds()
    const gameIds = [...new Set(open.map(r => r.game_id))]
    const total = { ...ZERO }
    for (const gameId of gameIds) {
      const one = await settleGame(store, gameId, opts)
      total.locked += one.locked
      total.graded += one.graded
      total.voided += one.voided
      total.crowned = total.crowned || one.crowned
    }
    return total
  } catch {
    return ZERO
  }
}

/** Re-render a round's card in the channel from whatever the row now says. */
export async function refreshCard(
  store: PredictStore,
  round: PredictRound,
  botToken?: string | null,
  color?: number,
): Promise<boolean> {
  const picks = await store.pickCount(round.id)
  return editRoundCard(round, buildRoundCard(round, { picks, color }), botToken)
}

export interface GameBoard {
  rounds: PredictRound[]
  board: BoardRow[]
  winner: BoardRow | null
}

export async function gameBoard(store: PredictStore, gameId: string): Promise<GameBoard> {
  const rounds = await store.roundsForGame(gameId)
  const picks = await store.picksForRounds(rounds.map(r => r.id))
  const board = buildBoard(rounds, picks)
  return { rounds, board, winner: boardWinner(board) }
}

export function matchupLabel(game: PredictGameRow, teams: PredictTeam[]): string {
  const name = (id: string) => teams.find(t => t.id === id)?.name ?? id
  return `${name(game.away_team_id)} at ${name(game.home_team_id)}`
}

/**
 * Write the winner row and announce it.
 *
 * The claim is an INSERT against the primary key, so the ingest settling a game and a mod
 * running `/predict winner` in the same minute cannot both announce it. Without a bot token
 * there is no way to post a NEW message into the round's channel (a webhook is bound to one
 * channel, and a round can run in any of them), so the row is still written with
 * `announced_at` null and the mod's `/predict winner` posts it as its own reply.
 */
async function crownGame(
  store: PredictStore,
  game: PredictGameRow,
  rounds: PredictRound[],
  opts: SettleOptions,
): Promise<boolean> {
  const picks = await store.picksForRounds(rounds.map(r => r.id))
  const board = buildBoard(rounds, picks)
  const winner = boardWinner(board)
  const last = rounds[rounds.length - 1]

  const claimed = await store.claimWinner({
    game_id: game.id,
    discord_user_id: winner?.userId ?? null,
    display_name: winner?.name ?? null,
    correct: winner?.correct ?? 0,
    answered: winner?.answered ?? 0,
    mean_ms: winner?.meanMs ?? 0,
    rounds: rounds.length,
    channel_id: last?.channel_id ?? null,
    message_id: null,
    announced_at: null,
  })
  if (!claimed) return false

  if (!opts.botToken || !last) return true
  const teams = opts.teams ?? await store.teams()
  const home = teams.find(t => t.id === game.home_team_id)
  const message = buildWinnerMessage(board, winner, matchupLabel(game, teams), embedColorFromHex(home?.color))
  const messageId = await postToChannel(last.channel_id, message, opts.botToken)
  if (messageId) {
    await store.updateWinner(game.id, { message_id: messageId, announced_at: new Date().toISOString() })
  }
  return true
}

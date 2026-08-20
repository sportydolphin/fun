/**
 * Every message the "Call It Early" predictions game puts in the channel: the round card with
 * its buttons, the board, and the winner announcement.
 *
 * Pure, for the same reason discordRecap.ts is: what gets posted into a public channel is
 * worth unit testing, and neither caller (the Pages interactions endpoint, the wpbl-ingest
 * edge function) can be imported by a test. Both render through here, so a card that a mod
 * opens and the same card that the ingest later edits to reveal the answer are one template
 * rather than two that drift.
 *
 * Runtime imports carry `.ts` because wpbl-ingest loads this under Deno, which resolves local
 * specifiers literally. Nothing here may reach constants.ts, which pulls in the team logos as
 * Vite assets.
 */
import { optionLabel, ordinal, type BoardRow, type PredictOption } from './derive/predictions.ts'

/** 64 = ephemeral, visible only to whoever pressed the button. */
export const EPHEMERAL = 64

export interface DiscordButton {
  type: 2
  style: 1 | 2 | 3 | 4
  label: string
  custom_id: string
  disabled?: boolean
}
export interface DiscordActionRow { type: 1; components: DiscordButton[] }

export interface PredictMessage {
  content?: string
  embeds?: {
    title: string
    description?: string
    color?: number
    fields?: { name: string; value: string; inline?: boolean }[]
    footer?: { text: string }
  }[]
  components?: DiscordActionRow[]
  allowed_mentions: { parse: [] }
  flags?: number
}

/** The round as the card needs to see it. A `wpbl_predict_rounds` row satisfies this. */
export interface CardRound {
  id: string
  question: string
  situation: string
  options: PredictOption[]
  target_inning: number
  target_half: string
  locks_at: string
  status: string
  correct_key: string | null
  outcome: string | null
  detail: string | null
}

const GAME_NAME = 'Call It Early'

/** "#e8412c" becomes the integer Discord wants for an embed's accent stripe. */
export function embedColorFromHex(hex: string | null | undefined): number | undefined {
  const clean = (hex ?? '').replace('#', '').trim()
  if (!/^[0-9a-f]{6}$/i.test(clean)) return undefined
  return parseInt(clean, 16)
}

const half = (r: { target_inning: number; target_half: string }) =>
  `${r.target_half === 'bottom' ? 'bottom' : 'top'} of the ${ordinal(r.target_inning)}`

/**
 * Discord's own relative timestamp, which counts down in the reader's client without anyone
 * editing the message. That matters here: the card is posted once and the countdown has to
 * keep running, and we have no process able to tick it.
 */
const countdown = (iso: string) => `<t:${Math.floor(Date.parse(iso) / 1000)}:R>`

/**
 * The round card, in all four of its states.
 *
 * The pick count is shown as a TOTAL and never split by option, on purpose: a live tally per
 * button turns a prediction into a poll about what the channel thinks, and the last person to
 * click would be answering a different question from the first.
 */
export function buildRoundCard(
  round: CardRound,
  opts: { picks: number; color?: number } = { picks: 0 },
): PredictMessage {
  const picks = opts.picks
  const tally = picks === 1 ? '1 pick in' : `${picks} picks in`
  const graded = round.status === 'graded'
  const closed = round.status !== 'open'

  let state: string
  if (round.status === 'open') state = `⏳ Picks close ${countdown(round.locks_at)} · ${tally}`
  else if (round.status === 'locked') state = `🔒 Picks are closed · ${tally} · waiting on the ${half(round)}`
  else if (graded) state = `✅ **${round.outcome ?? 'settled'}** · ${round.detail ?? ''}`
  else state = `⚪ Void · ${round.detail ?? 'this round counts for nothing'}`

  const buttons: DiscordButton[] = (round.options ?? []).map(o => ({
    type: 2,
    // The right answer goes green when the round reveals; everything else stays neutral, so
    // the card reads at a glance without anyone having to compare it to a separate message.
    style: graded && round.correct_key === o.key ? 3 : 2,
    label: o.label,
    custom_id: `predict:${round.id}:${o.key}`,
    disabled: closed,
  }))

  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `⚾ ${GAME_NAME}`,
      description: `**${round.question}**\n${round.situation}\n\n${state}`,
      color: opts.color,
      footer: { text: graded || round.status === 'void' ? 'One winner a game.' : 'Press a button to lock in your call.' },
    }],
    components: buttons.length ? [{ type: 1, components: buttons }] : [],
  }
}

const MEDALS = ['🥇', '🥈', '🥉']

const rank = (rows: BoardRow[]) => rows.slice(0, 10).map((r, i) =>
  `${MEDALS[i] ?? `${i + 1}.`} **${r.name}** ${r.correct}/${r.answered} · ${(r.meanMs / 1000).toFixed(1)}s avg`)

/** The board so far, for a mod who wants to show the room where it stands. */
export function buildStandingsMessage(board: BoardRow[], rounds: { status: string }[], color?: number): PredictMessage {
  const graded = rounds.filter(r => r.status === 'graded').length
  const pending = rounds.filter(r => r.status === 'open' || r.status === 'locked').length
  const lines = board.length
    ? rank(board)
    : ['Nobody has called one right yet.']
  const footer = [
    graded === 1 ? '1 round settled' : `${graded} rounds settled`,
    pending ? `${pending} still live` : '',
    'ties broken by average answer time',
  ].filter(Boolean).join(' · ')

  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `⚾ ${GAME_NAME} · standings`,
      description: lines.join('\n'),
      color,
      footer: { text: footer },
    }],
  }
}

/**
 * The end of the game.
 *
 * Nobody winning is a real result and is announced as one: a game where every round voided, or
 * where nobody called a single one right, does not crown the least wrong player.
 */
export function buildWinnerMessage(
  board: BoardRow[],
  winner: BoardRow | null,
  matchup: string,
  color?: number,
): PredictMessage {
  const description = winner
    ? `🏆 **${winner.name}** wins it: ${winner.correct} of ${winner.answered} called right, ${(winner.meanMs / 1000).toFixed(1)}s average.`
    : board.length
      ? 'Nobody called a single round right tonight. No winner.'
      : 'No picks were made tonight, so there is nobody to crown.'
  const rest = board.length > 1 ? `\n\n${rank(board).join('\n')}` : ''
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `⚾ ${GAME_NAME} · ${matchup}`,
      description: description + rest,
      color,
      footer: { text: 'Final. Next game, next chance.' },
    }],
  }
}

/** Ephemeral: the confirmation of a pick belongs to the person who pressed the button. */
export function pickAck(optionKey: string, round: CardRound): PredictMessage {
  return {
    allowed_mentions: { parse: [] },
    flags: EPHEMERAL,
    content: `Locked in: **${optionLabel(optionKey)}** for the ${half(round)}. Change it any time before picks close.`,
  }
}

export function ephemeral(message: string): PredictMessage {
  return { allowed_mentions: { parse: [] }, flags: EPHEMERAL, content: message }
}

/**
 * Every read and write the predictions game makes, in one place.
 *
 * Two very different runtimes host this game: the Cloudflare Pages function that answers a
 * Discord interaction, and the Supabase edge function that settles rounds on the ingest's
 * two-minute pass. Both have `fetch` and nothing else in common, so this talks to PostgREST
 * and to Discord over plain HTTP rather than through the supabase-js client. That is what
 * lets one implementation serve both, and it is why the settle logic in predictEngine.ts can
 * be shared instead of written twice and drifting.
 *
 * WHY THE SERVICE ROLE. `wpbl_predict_rounds` / `_picks` / `_winners` are RLS-on with no
 * policies, so nothing but a service-role actor can touch them. That is deliberate: the anon
 * key ships inside the client bundle, so the browser cannot be trusted to say which Discord
 * user a pick belongs to. Recording a pick is a write, so this needs the real key.
 *
 * Runtime imports carry `.ts` because wpbl-ingest loads this under Deno.
 */
import type { HalfInning, PredictOption, PredictPlay } from './derive/predictions.ts'
import type { PredictMessage } from './discordPredictions.ts'

export interface PredictRound {
  id: string
  game_id: string
  kind: string
  guild_id: string
  channel_id: string
  message_id: string | null
  interaction_token: string | null
  application_id: string | null
  opened_by: string
  question: string
  situation: string
  options: PredictOption[]
  target_inning: number
  target_half: string
  anchor_sequence: number
  locks_at: string
  status: string
  correct_key: string | null
  outcome: string | null
  detail: string | null
  opened_at: string
  closed_at: string | null
  graded_at: string | null
}

export interface PredictPick {
  round_id: string
  discord_user_id: string
  display_name: string
  option_key: string
  response_ms: number
  correct: boolean | null
}

export interface PredictGameRow {
  id: string
  game_date: string
  status: string
  home_team_id: string
  away_team_id: string
  home_score: number | null
  away_score: number | null
  live_inning: number | null
  live_half: string | null
}

export interface PredictTeam { id: string; name: string; abbr: string | null; color: string | null }

export interface PredictWinner {
  game_id: string
  discord_user_id: string | null
  display_name: string | null
  correct: number
  answered: number
  mean_ms: number
  rounds: number
  channel_id: string | null
  message_id: string | null
  announced_at: string | null
}

const DISCORD_API = 'https://discord.com/api/v10'

export interface PredictStore {
  openRounds(): Promise<PredictRound[]>
  roundsForGame(gameId: string): Promise<PredictRound[]>
  round(id: string): Promise<PredictRound | null>
  latestRoundInChannel(channelId: string): Promise<PredictRound | null>
  picksForRounds(roundIds: string[]): Promise<PredictPick[]>
  pickCount(roundId: string): Promise<number>
  insertRound(row: Partial<PredictRound>): Promise<PredictRound | null>
  updateRound(id: string, patch: Partial<PredictRound>): Promise<void>
  savePick(pick: Omit<PredictPick, 'correct'>): Promise<void>
  gradePicks(roundId: string, correctKey: string | null): Promise<void>
  game(id: string): Promise<PredictGameRow | null>
  gamesByStatus(status: string): Promise<PredictGameRow[]>
  teams(): Promise<PredictTeam[]>
  plays(gameId: string, minSequence?: number): Promise<PredictPlay[]>
  winner(gameId: string): Promise<PredictWinner | null>
  claimWinner(row: PredictWinner): Promise<boolean>
  updateWinner(gameId: string, patch: Partial<PredictWinner>): Promise<void>
}

/**
 * Null when the service-role credentials are absent, which is how this stays off until it is
 * switched on: a deploy without them leaves every entry point answering "not configured"
 * rather than half-working.
 */
export function createPredictStore(env: {
  url?: string | null
  serviceKey?: string | null
  signal?: AbortSignal
}): PredictStore | null {
  const base = (env.url ?? '').replace(/\/+$/, '')
  const key = env.serviceKey ?? ''
  if (!base || !key) return null

  async function rest<T>(path: string, init?: RequestInit & { prefer?: string }): Promise<T[]> {
    const res = await fetch(`${base}/rest/v1/${path}`, {
      ...init,
      signal: env.signal,
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        accept: 'application/json',
        ...(init?.prefer ? { prefer: init.prefer } : {}),
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) throw new Error(`postgrest ${res.status} on ${path}: ${await res.text()}`)
    if (res.status === 204) return []
    const text = await res.text()
    return text ? (JSON.parse(text) as T[]) : []
  }

  const one = <T>(rows: T[]): T | null => rows[0] ?? null

  return {
    openRounds: () =>
      rest<PredictRound>('wpbl_predict_rounds?select=*&status=in.(open,locked)&order=opened_at'),

    roundsForGame: gameId =>
      rest<PredictRound>(`wpbl_predict_rounds?select=*&game_id=eq.${gameId}&order=opened_at`),

    round: async id => one(await rest<PredictRound>(`wpbl_predict_rounds?select=*&id=eq.${id}`)),

    // Which game a bare `/predict standings` is about: the one the last round in this channel
    // belonged to. Asking the schedule instead would guess wrong on a doubleheader day, and
    // asking the mod to name a game would be a worse command for the sake of a rarer case.
    latestRoundInChannel: async channelId =>
      one(await rest<PredictRound>(
        `wpbl_predict_rounds?select=*&channel_id=eq.${channelId}&order=opened_at.desc&limit=1`,
      )),

    // Every pick on a game in one read, by round id. A game is a handful of rounds and a few
    // dozen picks, so this stays one round trip inside an interaction's three-second budget
    // where a per-round loop would be N of them.
    picksForRounds: roundIds =>
      roundIds.length
        ? rest<PredictPick>(
          'wpbl_predict_picks?select=round_id,discord_user_id,display_name,option_key,response_ms,correct'
          + `&round_id=in.(${roundIds.join(',')})`,
        )
        : Promise.resolve([]),

    async pickCount(roundId) {
      const res = await fetch(`${base}/rest/v1/wpbl_predict_picks?select=round_id&round_id=eq.${roundId}`, {
        method: 'HEAD',
        signal: env.signal,
        headers: { apikey: key, authorization: `Bearer ${key}`, prefer: 'count=exact' },
      })
      // "0-24/37": the total is what we want, and a missing header means we simply do not know.
      const range = res.headers.get('content-range') ?? ''
      const total = parseInt(range.split('/')[1] ?? '', 10)
      return Number.isFinite(total) ? total : 0
    },

    insertRound: async row =>
      one(await rest<PredictRound>('wpbl_predict_rounds?select=*', {
        method: 'POST', body: JSON.stringify(row), prefer: 'return=representation',
      })),

    async updateRound(id, patch) {
      await rest(`wpbl_predict_rounds?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
    },

    async savePick(pick) {
      // The primary key is (round_id, discord_user_id), so answering twice REPLACES your own
      // answer instead of stuffing the ballot.
      await rest('wpbl_predict_picks?on_conflict=round_id,discord_user_id', {
        method: 'POST', body: JSON.stringify(pick), prefer: 'resolution=merge-duplicates',
      })
    },

    async gradePicks(roundId, correctKey) {
      if (!correctKey) {
        // A void round: nobody was right and nobody was wrong.
        await rest(`wpbl_predict_picks?round_id=eq.${roundId}`, {
          method: 'PATCH', body: JSON.stringify({ correct: null }),
        })
        return
      }
      await rest(`wpbl_predict_picks?round_id=eq.${roundId}&option_key=eq.${correctKey}`, {
        method: 'PATCH', body: JSON.stringify({ correct: true }),
      })
      await rest(`wpbl_predict_picks?round_id=eq.${roundId}&option_key=neq.${correctKey}`, {
        method: 'PATCH', body: JSON.stringify({ correct: false }),
      })
    },

    game: async id => one(await rest<PredictGameRow>(`${GAME_SELECT}&id=eq.${id}`)),

    gamesByStatus: status => rest<PredictGameRow>(`${GAME_SELECT}&status=eq.${status}&order=start_time`),

    teams: () => rest<PredictTeam>('wpbl_teams?select=id,name,abbr,color'),

    // Only the five columns the grader reads, and only from the round's anchor forward. A
    // game's play log is a few hundred rows with every pitch of every at-bat attached, and
    // shipping that into an interaction with a three-second budget is the difference between
    // a card and "the application did not respond".
    plays: (gameId, minSequence = 0) =>
      rest<PredictPlay>(
        'wpbl_game_plays?select=inning,half,sequence,event_type,runs_scored'
        + `&game_id=eq.${gameId}&sequence=gte.${minSequence}&order=sequence`,
      ),

    winner: async gameId => one(await rest<PredictWinner>(`wpbl_predict_winners?select=*&game_id=eq.${gameId}`)),

    async claimWinner(row) {
      // An INSERT against the primary key, not an upsert: the conflict IS the lock. Whoever
      // gets there first owns the announcement, so the ingest settling a final game and a mod
      // running /predict winner at the same moment cannot both post one.
      try {
        await rest('wpbl_predict_winners', { method: 'POST', body: JSON.stringify(row) })
        return true
      } catch {
        return false
      }
    },

    async updateWinner(gameId, patch) {
      await rest(`wpbl_predict_winners?game_id=eq.${gameId}`, { method: 'PATCH', body: JSON.stringify(patch) })
    },
  }
}

const GAME_SELECT =
  'wpbl_games?select=id,game_date,status,home_team_id,away_team_id,home_score,away_score,live_inning,live_half'

// ─── Discord REST ─────────────────────────────────────────────────────────────

/**
 * Edit a round's own message, which is how the answer is revealed.
 *
 * Two credentials can do it and they fail differently:
 *
 *   | Credential                  | Lifetime            | Needs                                  |
 *   | the round's interaction token | 15 minutes from opening | nothing at all                    |
 *   | DISCORD_BOT_TOKEN            | forever             | the app in the guild (the `bot` scope) |
 *
 * A half-inning takes roughly ten minutes to play out and the ingest can be two minutes
 * behind, so the interaction token is genuinely marginal: it covers a round that settles early
 * and misses one that goes the distance. Either way the round still GRADES and SCORES. Only
 * the card in the channel goes stale, which is why nothing here treats a failed edit as an
 * error worth stopping for.
 */
export async function editRoundCard(
  round: Pick<PredictRound, 'channel_id' | 'message_id' | 'application_id' | 'interaction_token'>,
  message: PredictMessage,
  botToken?: string | null,
): Promise<boolean> {
  const body = JSON.stringify({
    content: message.content ?? '',
    embeds: message.embeds ?? [],
    components: message.components ?? [],
    allowed_mentions: message.allowed_mentions,
  })
  if (botToken && round.message_id) {
    const res = await fetch(`${DISCORD_API}/channels/${round.channel_id}/messages/${round.message_id}`, {
      method: 'PATCH',
      headers: { authorization: `Bot ${botToken}`, 'content-type': 'application/json' },
      body,
    })
    if (res.ok) return true
  }
  if (round.application_id && round.interaction_token) {
    const res = await fetch(
      `${DISCORD_API}/webhooks/${round.application_id}/${round.interaction_token}/messages/@original`,
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body },
    )
    return res.ok
  }
  return false
}

/** Post a new message into a channel. Only a bot token can do this; a webhook is bound to one
 *  channel and a round can run in any of them. */
export async function postToChannel(
  channelId: string,
  message: PredictMessage,
  botToken?: string | null,
): Promise<string | null> {
  if (!botToken) return null
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bot ${botToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      content: message.content ?? '',
      embeds: message.embeds ?? [],
      components: message.components ?? [],
      allowed_mentions: message.allowed_mentions,
    }),
  })
  if (!res.ok) return null
  const posted = await res.json().catch(() => null) as { id?: string } | null
  return posted?.id ? String(posted.id) : null
}

/**
 * The message id of the reply we just made to an interaction.
 *
 * An interaction response body does not carry one, and the id is what lets the bot token edit
 * the card hours later when the interaction token is long dead. This is the only way to learn
 * it, and it needs no credential: the token in the URL is the authority.
 */
export async function originalMessageId(applicationId: string, token: string): Promise<string | null> {
  const res = await fetch(`${DISCORD_API}/webhooks/${applicationId}/${token}/messages/@original`)
  if (!res.ok) return null
  const msg = await res.json().catch(() => null) as { id?: string } | null
  return msg?.id ? String(msg.id) : null
}

/** The half-inning a stored round targets, in the shape the rules take. */
export const roundTarget = (r: Pick<PredictRound, 'target_inning' | 'target_half'>): HalfInning =>
  ({ inning: r.target_inning, half: r.target_half === 'bottom' ? 'bottom' : 'top' })

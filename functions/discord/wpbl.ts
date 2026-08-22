// Cloudflare Pages function for /discord/wpbl — the Discord bot's inbound endpoint.
//
// Discord offers two ways to run a bot. A gateway bot holds a websocket open and needs a
// process running somewhere forever, which this project has nowhere to put. The other is an
// HTTP interactions endpoint: Discord POSTs each slash command to a URL and takes the reply
// from the response body. That is what this is, and it costs nothing when nobody is asking
// — it deploys with the site and there is no bot to keep alive.
//
// It answers /player <name>, resolving whatever was typed against the roster
// (src/wpbl/playerSearch.ts) and replying with that player's season
// (src/wpbl/discordPlayerCard.ts). It also serves Discord's autocomplete, so the name
// resolves while the reader is still typing rather than after they guess wrong.
//
// It also runs /predict, the mod-hosted in-game predictions game, and takes the button
// presses that answer a round (those arrive here as component interactions). The rules and
// the settling live in src/wpbl/, shared with the wpbl-ingest edge function so a round
// settles identically whether the feed got there first or a mod asked.
//
// Setup, including registering the command and where the public key comes from, is in
// docs/DISCORD.md.
import { searchPlayers } from '../../src/wpbl/playerSearch'
import { buildPlayerReply, buildNoMatchReply, buildAmbiguousReply, type DiscordReply } from '../../src/wpbl/discordPlayerCard'
import { buildPositionIndex, displayPositionFromIndex } from '../../src/wpbl/positions'
import { buildRunsRound, halfIndex, halfInningStarted, nextHalfInning } from '../../src/wpbl/derive/predictions'
import {
  buildRoundCard, buildStandingsMessage, buildWinnerMessage, embedColorFromHex, ephemeral, pickAck,
  type PredictMessage,
} from '../../src/wpbl/discordPredictions'
import {
  createPredictStore, originalMessageId, roundTarget,
  type PredictGameRow, type PredictRound, type PredictStore, type PredictTeam,
} from '../../src/wpbl/predictStore'
import { gameBoard, matchupLabel, refreshCard, settleGame } from '../../src/wpbl/predictEngine'
import type { WpblPlayer, WpblTeam, WpblBattingLine, WpblPitchingLine } from '../../src/wpbl/types'
import type { WpblSeasonGame } from '../../src/wpbl/season'

interface Env {
  // Optional override for the committed key below. Set it if the app is ever rotated or
  // replaced without a deploy.
  DISCORD_PUBLIC_KEY?: string
  // The same public reads the site itself makes. The anon key already ships in the client
  // bundle, so reading with it here grants nothing new.
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  // The one real secret here, and only /predict needs it. The predictions tables are RLS-on
  // with no policies, so every write to them goes through a service-role actor; the anon key
  // ships in the client bundle and so cannot be trusted to say whose pick a pick is.
  SUPABASE_SERVICE_ROLE_KEY?: string
  // Optional. Without it a settled round still grades and scores, but the card in the channel
  // can stay looking open, and the winner cannot be announced automatically. See
  // editRoundCard in src/wpbl/predictStore.ts.
  DISCORD_BOT_TOKEN?: string
}

interface Ctx {
  request: Request
  env: Env
  // Pages hands this to a function so work can outlive the response. Used below to write
  // the roster cache without making the reader wait for it.
  waitUntil?: (promise: Promise<unknown>) => void
}

// Discord's own budget is three seconds, after which it shows the reader "the application
// did not respond" no matter what we send. Coming in under that with room to spare means an
// unreachable database produces an honest message instead of that.
const DATA_TIMEOUT_MS = 2200

// Interaction types and response types, from Discord's API. Named because `type: 4` at a
// call site tells nobody anything.
const PING = 1, APPLICATION_COMMAND = 2, MESSAGE_COMPONENT = 3, AUTOCOMPLETE = 4
const PONG = 1, CHANNEL_MESSAGE = 4, DEFERRED_MESSAGE = 5, AUTOCOMPLETE_RESULT = 8

// The Discord application's Ed25519 public key, from the developer portal's General
// Information page.
//
// Committed rather than held as an environment variable, and safe to be: this is a PUBLIC
// key in the literal sense. It only verifies that a request was signed by Discord. Forging
// a signature needs the matching private key, which Discord holds and never discloses, so
// publishing this grants an attacker nothing. Discord prints it openly in the portal.
//
// Keeping it here rather than in Cloudflare's environment also means the endpoint keeps
// working across redeploys and dashboard changes with nothing to re-enter. `env` still wins
// when set, so a rotated app can be pointed at a new key without a code change.
const PUBLIC_KEY = 'c3deb21bd78c665a6d1a19b295569fb0688544c801b9ddef4e686f2303fa9e3c'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export async function onRequestPost(context: Ctx): Promise<Response> {
  const { request, env, waitUntil } = context
  const signature = request.headers.get('x-signature-ed25519')
  const timestamp = request.headers.get('x-signature-timestamp')
  const body = await request.text()

  const publicKey = (env.DISCORD_PUBLIC_KEY || '').trim() || PUBLIC_KEY
  // Discord validates the endpoint by sending deliberately BAD signatures and requiring a
  // 401. Returning anything else here fails setup, so this is not just a guard.
  if (!signature || !timestamp || !(await verify(body, signature, timestamp, publicKey))) {
    return new Response('bad signature', { status: 401 })
  }

  let interaction: Interaction
  try { interaction = JSON.parse(body) as Interaction } catch { return new Response('bad body', { status: 400 }) }

  if (interaction.type === PING) return json({ type: PONG })

  if (interaction.type === AUTOCOMPLETE) {
    const choices = await autocomplete(typed(interaction), env, waitUntil)
    return json({ type: AUTOCOMPLETE_RESULT, data: { choices } })
  }

  if (interaction.type === APPLICATION_COMMAND) {
    if (interaction.data?.name === 'predict') return predictCommand(interaction, env, waitUntil)
    const reply = await lookup(typed(interaction), env, waitUntil)
    return json({ type: CHANNEL_MESSAGE, data: reply })
  }

  // Someone answered a round.
  if (interaction.type === MESSAGE_COMPONENT) return predictButton(interaction, env, waitUntil)

  // A modal, or a component we never registered. Acknowledge rather than erroring.
  return json({ type: PONG })
}

// ─── Interaction shapes ───────────────────────────────────────────────────────

interface InteractionOption { name: string; value?: string | number; focused?: boolean; options?: InteractionOption[] }
interface InteractionUser { id?: string; username?: string; global_name?: string }
interface Interaction {
  type: number
  application_id?: string
  token?: string
  guild_id?: string
  channel_id?: string
  data?: { name?: string; options?: InteractionOption[]; custom_id?: string }
  message?: { id?: string }
  // `member` in a guild, `user` in a DM. This game is guild-only, so `member` is what it
  // reads, and its absence is how a DM is recognised.
  member?: { user?: InteractionUser; nick?: string; permissions?: string }
  user?: InteractionUser
}

/** The player name the reader typed, from whichever option carries it. */
function typed(interaction: Interaction): string {
  const options = interaction.data?.options ?? []
  const focused = options.find(o => o.focused) ?? options.find(o => o.name === 'name') ?? options[0]
  return String(focused?.value ?? '').trim()
}

// ─── Signature ────────────────────────────────────────────────────────────────

// Allocated through an explicit ArrayBuffer rather than `new Uint8Array(n)`. Both are the
// same at runtime, but TypeScript types the shorthand as Uint8Array<ArrayBufferLike>, and
// WebCrypto's BufferSource will only accept a view backed by a plain ArrayBuffer — a
// SharedArrayBuffer-backed view is not transferable to it.
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.trim()
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) return new Uint8Array(new ArrayBuffer(0))
  const out = new Uint8Array(new ArrayBuffer(clean.length / 2))
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

/**
 * Ed25519 verification over `timestamp + body`, exactly as Discord signs it.
 *
 * Two algorithm names because the Workers runtime spelled this 'NODE-ED25519' before the
 * WebCrypto standard settled on 'Ed25519', and which one an account gets still depends on
 * its compatibility date. Trying the standard name first and falling back costs one failed
 * import on old runtimes and nothing on current ones.
 */
async function verify(body: string, signature: string, timestamp: string, publicKey: string): Promise<boolean> {
  const sig = hexToBytes(signature)
  const key = hexToBytes(publicKey)
  if (sig.length === 0 || key.length === 0) return false
  // Same BufferSource requirement as above. TextEncoder always allocates a plain
  // ArrayBuffer, so copying into one we typed ourselves costs a few hundred bytes and keeps
  // the call honest rather than casting the guarantee away.
  const encoded = new TextEncoder().encode(timestamp + body)
  const message = new Uint8Array(new ArrayBuffer(encoded.length))
  message.set(encoded)

  for (const algorithm of [{ name: 'Ed25519' }, { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' }]) {
    try {
      const imported = await crypto.subtle.importKey('raw', key, algorithm as AlgorithmIdentifier, false, ['verify'])
      return await crypto.subtle.verify(algorithm as AlgorithmIdentifier, imported, sig, message)
    } catch { /* try the other spelling */ }
  }
  return false
}

// ─── Data ─────────────────────────────────────────────────────────────────────

type RosterPlayer = Pick<WpblPlayer, 'id' | 'name' | 'position' | 'jersey_number' | 'team_id'>

function reader(env: Env, signal: AbortSignal) {
  const base = (env.VITE_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/+$/, '')
  const key = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || ''
  if (!base || !key) return null
  return async <T>(query: string): Promise<T[]> => {
    const res = await fetch(`${base}/rest/v1/${query}`, {
      headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' },
      signal,
    })
    if (!res.ok) throw new Error(`postgrest ${res.status}`)
    return (await res.json()) as T[]
  }
}

// ─── Roster cache ─────────────────────────────────────────────────────────────
//
// Autocomplete is what makes this worth having. Discord fires an autocomplete interaction
// as the reader types, several per search, and each one needs the whole roster to match
// against — so the uncached version re-read all ~120 players and every team for each
// keystroke, to answer from data that changes when someone is signed or traded.
//
// Two layers, because they fail differently. The module-scope memo is free and instant but
// lives only as long as this isolate, which covers the burst within one search and not much
// else. The Cache API is shared across isolates in the same colo and survives one being
// recycled, so it covers the gap between searches. A miss on both is the only path that
// touches the database.
//
// Only public roster data is held here, which is what makes a cache shared across every
// reader of the isolate safe. Nothing interaction-specific goes in.
//
// Box-score lines are deliberately NOT cached: they change while a game is being played,
// they're small, and they're fetched for one player at a time. Serving a five-minute-old
// batting line during a live game is the one staleness anyone would actually notice.
const ROSTER_TTL_S = 300

interface Roster {
  players: RosterPlayer[]
  teams: WpblTeam[]
  /** The schedule's three "does this game count" columns, so the /player card's season line
   *  can drop postseason games. Cached alongside the roster: both change once a game. */
  games: WpblSeasonGame[]
  /** Every box-score line's position, for working out where each player actually plays.
   *  Cached with the roster because it changes on the same timescale: once a game. */
  battingPositions: { player_id: string; position: string | null }[]
}

let memo: { at: number; data: Roster } | null = null

/** Test seam: drops the in-isolate memo so a test can observe a cold load. */
export function __resetRosterCache(): void { memo = null }

export async function loadRoster(
  env: Env,
  signal: AbortSignal,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<Roster | null> {
  const now = Date.now()
  if (memo && now - memo.at < ROSTER_TTL_S * 1000) return memo.data

  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default
  // A synthetic key on a hostname that resolves to nothing: the Cache API keys on a Request,
  // and this entry is written and read only by us, never fetched.
  const key = new Request('https://wpbl-bot.invalid/roster-v1')

  if (cache) {
    try {
      const hit = await cache.match(key)
      if (hit) {
        const data = await hit.json() as Roster
        memo = { at: now, data }
        return data
      }
    } catch { /* a cache miss must never be fatal — fall through to the database */ }
  }

  const read = reader(env, signal)
  if (!read) return null
  const [players, teams, battingPositions, games] = await Promise.all([
    read<RosterPlayer>('wpbl_players?select=id,name,position,jersey_number,team_id&order=name'),
    read<WpblTeam>('wpbl_teams?select=*'),
    // Two narrow columns over the whole season (a few hundred rows) so the suggestions
    // name the position a player actually plays, the same as every other surface.
    read<{ player_id: string; position: string | null }>('wpbl_batting_lines?select=player_id,position'),
    read<WpblSeasonGame>('wpbl_games?select=id,game_type,counts_in_standings'),
  ])
  const data: Roster = { players, teams, battingPositions, games }
  memo = { at: now, data }

  if (cache) {
    const stored = new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ROSTER_TTL_S}` },
    })
    // Writing the cache is not something the reader should wait on.
    const put = cache.put(key, stored).catch(() => {})
    if (waitUntil) waitUntil(put)
  }
  return data
}

/** Suggestions while the reader is still typing. Discord allows at most 25. */
async function autocomplete(
  query: string,
  env: Env,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<{ name: string; value: string }[]> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), DATA_TIMEOUT_MS)
  try {
    const roster = await loadRoster(env, abort.signal, waitUntil)
    if (!roster) return []
    const players = roster.players
    // An empty box should still offer something rather than sitting blank.
    const hits = query ? searchPlayers(query, players).slice(0, 25) : players.slice(0, 25).map(p => ({ player: p }))
    const positionIndex = buildPositionIndex(roster.battingPositions)
    return hits.map(h => {
      const pos = displayPositionFromIndex(h.player, positionIndex).label
      return ({
      name: pos ? `${h.player.name} (${pos})` : h.player.name,
      // The value is the full name, not the id: if the reader ignores the menu and submits
      // their own text, the command still receives something the search can resolve.
      value: h.player.name.slice(0, 100),
    })})
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

/** Resolve a name and build the reply. Never throws: every failure becomes a message. */
async function lookup(
  query: string,
  env: Env,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<DiscordReply> {
  if (!query) return buildNoMatchReply('', [])

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), DATA_TIMEOUT_MS)
  try {
    const roster = await loadRoster(env, abort.signal, waitUntil)
    if (!roster) return errorReply('The stats database is not configured for this bot yet.')
    const { players, teams } = roster

    const hits = searchPlayers(query, players)
    if (hits.length === 0) return buildNoMatchReply(query, [])

    const best = hits[0]
    if (!best.confident) {
      // Nothing was clearly meant. Offer the near misses instead of guessing.
      return buildNoMatchReply(query, hits.slice(0, 5).map(h => h.player.name))
    }
    // Two hits of the same strength is a genuine collision (a shared surname), not a
    // ranking artefact, so ask rather than pick the one that happened to sort first.
    const tied = hits.filter(h => h.score === best.score)
    if (tied.length > 1) return buildAmbiguousReply(query, tied.map(h => h.player.name))

    // Uncached, and per player: these move during a live game.
    const read = reader(env, abort.signal)
    if (!read) return errorReply('The stats database is not configured for this bot yet.')
    const [batting, pitching] = await Promise.all([
      read<WpblBattingLine>(`wpbl_batting_lines?select=*&player_id=eq.${best.player.id}`),
      read<WpblPitchingLine>(`wpbl_pitching_lines?select=*&player_id=eq.${best.player.id}`),
    ])

    const team = teams.find(t => t.id === best.player.team_id)
    // `?? []` because the roster is cached: an entry written before games joined it has no
    // such field, and an empty schedule excludes nothing, which is the safe direction.
    return buildPlayerReply(best.player, team, batting, pitching, roster.games ?? [])
  } catch {
    return errorReply("Couldn't reach the WPBL stats just now. Try again in a moment.")
  } finally {
    clearTimeout(timer)
  }
}

/** Ephemeral: a failure is between the reader and the bot, not channel content. */
function errorReply(message: string): DiscordReply {
  return { allowed_mentions: { parse: [] }, content: message, flags: 64 }
}

// ─── /predict: the in-game predictions game ───────────────────────────────────
//
// Everything below is plumbing. The rules are in src/wpbl/derive/predictions.ts, the messages
// in src/wpbl/discordPredictions.ts, and the lock/grade/crown pass in
// src/wpbl/predictEngine.ts, all of which the wpbl-ingest edge function also runs. What lives
// here is only what is specific to being a Discord interaction: who is allowed to run it,
// which game they mean, and how to answer inside Discord's three-second budget.

const DISCORD_API = 'https://discord.com/api/v10'

// MANAGE_MESSAGES, or ADMINISTRATOR which implies it. Every subcommand is mod-only; players
// never type anything, they press buttons.
const MOD_PERMISSIONS = (1n << 13n) | (1n << 3n)

function isMod(interaction: Interaction): boolean {
  try {
    return (BigInt(interaction.member?.permissions ?? '0') & MOD_PERMISSIONS) !== 0n
  } catch {
    return false
  }
}

/** Whoever pressed the button, named the way the server knows them. */
function actor(interaction: Interaction): { id: string; name: string } {
  const user = interaction.member?.user ?? interaction.user ?? {}
  return {
    id: String(user.id ?? ''),
    name: interaction.member?.nick || user.global_name || user.username || 'someone',
  }
}

function predictStore(env: Env): PredictStore | null {
  // No AbortSignal on purpose: some of this work runs in waitUntil after the response has
  // gone, and a signal tied to the request would cancel the very writes that finish the job.
  return createPredictStore({
    url: env.VITE_SUPABASE_URL || env.SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
  })
}

const message = (msg: PredictMessage) => json({ type: CHANNEL_MESSAGE, data: msg })

/** The subcommand and its options, flattened. "/predict open seconds:60" is one nesting level. */
function subcommand(interaction: Interaction): { name: string; option: (key: string) => string | number | undefined } {
  const first = interaction.data?.options?.[0]
  const opts = first?.options ?? []
  return {
    name: String(first?.name ?? ''),
    option: (key: string) => opts.find(o => o.name === key)?.value,
  }
}

/**
 * Discord's "thinking" state, for the two subcommands that cannot answer in three seconds.
 *
 * /predict standings and /predict winner both settle every open round first, which is several
 * database round trips plus a card edit each. Deferring buys fifteen minutes to finish and then
 * edit this reply into the real answer.
 *
 * The follow-up is always PUBLIC: ephemeral is decided when the deferral is sent, and both of
 * these subcommands post to the channel by design. An error path therefore lands in the channel
 * too, which is why those messages say what went wrong rather than reading as chatter.
 */
function deferred(
  interaction: Interaction,
  work: (edit: (msg: PredictMessage) => Promise<void>) => Promise<void>,
  waitUntil?: (p: Promise<unknown>) => void,
): Response {
  const edit = async (msg: PredictMessage) => {
    await fetch(`${DISCORD_API}/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: msg.content ?? '',
        embeds: msg.embeds ?? [],
        components: msg.components ?? [],
        allowed_mentions: msg.allowed_mentions,
      }),
    })
  }
  const task = work(edit).catch(async err => {
    await edit(ephemeral(`That did not work: ${err instanceof Error ? err.message : 'unknown error'}`)).catch(() => {})
  })
  if (waitUntil) waitUntil(task)
  return json({ type: DEFERRED_MESSAGE })
}

async function predictCommand(
  interaction: Interaction,
  env: Env,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<Response> {
  if (!interaction.guild_id) return message(ephemeral('Run this in the server, not in a DM.'))
  if (!isMod(interaction)) {
    return message(ephemeral('Only mods run the predictions game. Everyone else plays with the buttons.'))
  }

  const store = predictStore(env)
  if (!store) return message(ephemeral('The predictions game is not configured yet: this deploy has no service-role key.'))

  const { name, option } = subcommand(interaction)
  try {
    if (name === 'open') return await openRound(interaction, store, option, env, waitUntil)
    if (name === 'lock') return await closeRound(interaction, store, 'lock', env, waitUntil)
    if (name === 'cancel') return await closeRound(interaction, store, 'cancel', env, waitUntil)
    if (name === 'standings') return standings(interaction, store, env, waitUntil)
    if (name === 'winner') return endGame(interaction, store, env, waitUntil)
  } catch (e) {
    return message(ephemeral(`That did not work: ${e instanceof Error ? e.message : 'unknown error'}`))
  }
  return message(ephemeral('Unknown subcommand.'))
}

/** Today in Central, which is the zone every WPBL game is scheduled in. */
function chicagoToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * The game a round is about.
 *
 * Live games first, plus anything scheduled for today so a mod can open a round on the top of
 * the 1st before first pitch. With two games running at once the mod has to say which, because
 * guessing would put the round on the wrong scoreboard and there is no undo once people have
 * answered.
 */
async function pickGame(store: PredictStore, teams: PredictTeam[], query: string): Promise<
  { game: PredictGameRow } | { error: string }
> {
  const [live, scheduled] = await Promise.all([store.gamesByStatus('live'), store.gamesByStatus('scheduled')])
  const today = chicagoToday()
  let candidates = [...live, ...scheduled.filter(g => g.game_date === today)]
  if (!candidates.length) return { error: 'No WPBL game is live or scheduled today, so there is nothing to predict.' }

  const wanted = query.trim().toLowerCase()
  if (wanted) {
    const matches = (id: string) => {
      const team = teams.find(t => t.id === id)
      return [id, team?.name ?? '', team?.abbr ?? ''].some(v => v.toLowerCase().includes(wanted))
    }
    candidates = candidates.filter(g => matches(g.home_team_id) || matches(g.away_team_id))
    if (!candidates.length) return { error: `No game today involves "${query}".` }
  }
  if (candidates.length > 1) {
    const name = (id: string) => teams.find(t => t.id === id)?.name ?? id
    const list = candidates.map(g => `- ${name(g.away_team_id)} at ${name(g.home_team_id)}`).join('\n')
    return { error: `More than one game is on. Add the team option to say which one.\n${list}` }
  }
  return { game: candidates[0] }
}

async function openRound(
  interaction: Interaction,
  store: PredictStore,
  option: (key: string) => string | number | undefined,
  env: Env,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<Response> {
  const teams = await store.teams()
  const chosen = await pickGame(store, teams, String(option('team') ?? ''))
  if ('error' in chosen) return message(ephemeral(chosen.error))
  const game = chosen.game

  const rounds = await store.roundsForGame(game.id)
  const liveRound = rounds.find(r => r.status === 'open' || r.status === 'locked')
  if (liveRound) {
    return message(ephemeral(liveRound.status === 'open'
      ? 'A round is already taking picks. Let that one close first.'
      : 'The last round is still waiting on its half-inning. It settles on its own.'))
  }

  const plays = await store.plays(game.id)
  const target = nextHalfInning(game, plays)
  if (!target) return message(ephemeral('That game is over. Use /predict winner to close it out.'))
  if (rounds.some(r => halfIndex(roundTarget(r)) === halfIndex(target))) {
    return message(ephemeral('That half-inning has already been asked about.'))
  }

  const teamName = (id: string) => teams.find(t => t.id === id)?.name ?? id
  const battingId = target.half === 'top' ? game.away_team_id : game.home_team_id
  const draft = buildRunsRound({
    target,
    battingTeam: teamName(battingId),
    awayName: teamName(game.away_team_id),
    homeName: teamName(game.home_team_id),
    awayScore: game.away_score ?? 0,
    homeScore: game.home_score ?? 0,
    anchorSequence: plays.reduce((max, p) => Math.max(max, p.sequence ?? 0), 0),
    seconds: Number(option('seconds') ?? 120),
    now: new Date(),
  })

  const round = await store.insertRound({
    ...draft,
    game_id: game.id,
    guild_id: interaction.guild_id ?? '',
    channel_id: interaction.channel_id ?? '',
    application_id: interaction.application_id ?? null,
    // The fallback credential for editing this card later, good for fifteen minutes. The bot
    // token is the one that lasts; this covers a deploy that has not set it.
    interaction_token: interaction.token ?? null,
    opened_by: actor(interaction).id,
  })
  if (!round) return message(ephemeral('Could not open the round: the database refused the write.'))

  // An interaction response body carries no message id, and that id is what lets the bot token
  // edit this card once the interaction token has expired. Fetching it is a round trip the
  // channel should not wait on.
  const appId = interaction.application_id
  const token = interaction.token
  if (waitUntil && appId && token) {
    waitUntil((async () => {
      const id = await originalMessageId(appId, token)
      if (id) await store.updateRound(round.id, { message_id: id })
    })().catch(() => {}))
  }

  const color = embedColorFromHex(teams.find(t => t.id === battingId)?.color)
  return message(buildRoundCard(round, { picks: 0, color }))
}

/** /predict lock closes picks early; /predict cancel throws the round away. */
async function closeRound(
  interaction: Interaction,
  store: PredictStore,
  action: 'lock' | 'cancel',
  env: Env,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<Response> {
  const latest = await store.latestRoundInChannel(interaction.channel_id ?? '')
  if (!latest || (latest.status !== 'open' && latest.status !== 'locked')) {
    return message(ephemeral('There is no live round in this channel.'))
  }
  const now = new Date().toISOString()
  const patch = action === 'lock'
    ? { status: 'locked', closed_at: now }
    : {
      status: 'void', closed_at: now, graded_at: now, correct_key: null,
      outcome: 'cancelled', detail: 'A mod called this round off, so it counts for nothing.',
    }
  await store.updateRound(latest.id, patch)
  if (action === 'cancel') await store.gradePicks(latest.id, null)
  Object.assign(latest, patch)
  if (waitUntil) waitUntil(refreshCard(store, latest, env.DISCORD_BOT_TOKEN).catch(() => false))

  return message(ephemeral(action === 'lock'
    ? 'Picks are closed. The feed settles it from here.'
    : 'Round cancelled. Nobody gains or loses anything on it.'))
}

/** The game a bare subcommand is about: whatever this channel last ran a round on. */
async function channelGame(store: PredictStore, channelId: string): Promise<
  { game: PredictGameRow; round: PredictRound } | { error: string }
> {
  const round = await store.latestRoundInChannel(channelId)
  if (!round) return { error: 'No rounds have been run in this channel yet.' }
  const game = await store.game(round.game_id)
  if (!game) return { error: 'That round points at a game that is no longer in the database.' }
  return { game, round }
}

function standings(
  interaction: Interaction,
  store: PredictStore,
  env: Env,
  waitUntil?: (p: Promise<unknown>) => void,
): Response {
  return deferred(interaction, async edit => {
    const found = await channelGame(store, interaction.channel_id ?? '')
    if ('error' in found) { await edit(ephemeral(found.error)); return }
    // Settle first, so the board is right even when the ingest is behind or has stopped. The
    // duplication is of the plumbing and not of the rules.
    await settleGame(store, found.game.id, { botToken: env.DISCORD_BOT_TOKEN })
    const [{ rounds, board }, teams] = await Promise.all([gameBoard(store, found.game.id), store.teams()])
    const color = embedColorFromHex(teams.find(t => t.id === found.game.home_team_id)?.color)
    await edit(buildStandingsMessage(board, rounds, color))
  }, waitUntil)
}

/**
 * End the game and crown one winner.
 *
 * A mod can run this at any point, which is the point of having it: the game normally ends when
 * the feed sees the final, but a watch party that breaks up early should be able to close the
 * board rather than leave it hanging. Any round still live when a mod ends it is voided rather
 * than guessed at.
 */
function endGame(
  interaction: Interaction,
  store: PredictStore,
  env: Env,
  waitUntil?: (p: Promise<unknown>) => void,
): Response {
  return deferred(interaction, async edit => {
    const found = await channelGame(store, interaction.channel_id ?? '')
    if ('error' in found) { await edit(ephemeral(found.error)); return }
    const game = found.game

    // Grade everything gradeable, then abandon what is left: a half-inning that has not been
    // played cannot be settled and must not be scored as anything.
    await settleGame(store, game.id, { botToken: env.DISCORD_BOT_TOKEN, crown: false })
    const now = new Date().toISOString()
    for (const round of await store.roundsForGame(game.id)) {
      if (round.status !== 'open' && round.status !== 'locked') continue
      const patch = {
        status: 'void', closed_at: round.closed_at ?? now, graded_at: now, correct_key: null,
        outcome: 'unsettled', detail: 'The game was closed out before this half-inning played.',
      }
      await store.updateRound(round.id, patch)
      await store.gradePicks(round.id, null)
      Object.assign(round, patch)
      await refreshCard(store, round, env.DISCORD_BOT_TOKEN).catch(() => {})
    }

    const [{ rounds, board, winner }, teams] = await Promise.all([gameBoard(store, game.id), store.teams()])
    if (!rounds.length) { await edit(ephemeral('No rounds were run on that game.')); return }
    const color = embedColorFromHex(teams.find(t => t.id === game.home_team_id)?.color)
    const card = buildWinnerMessage(board, winner, matchupLabel(game, teams), color)

    // The winner row is claimed by insert, so the ingest and this command cannot both announce
    // the same game. If the ingest got there first AND announced it, say so instead of posting
    // a second copy; if it wrote the row but had no bot token to announce with, this reply is
    // the announcement.
    const claimed = await store.claimWinner({
      game_id: game.id,
      discord_user_id: winner?.userId ?? null,
      display_name: winner?.name ?? null,
      correct: winner?.correct ?? 0,
      answered: winner?.answered ?? 0,
      mean_ms: winner?.meanMs ?? 0,
      rounds: rounds.length,
      channel_id: interaction.channel_id ?? null,
      message_id: null,
      announced_at: now,
    })
    if (!claimed) {
      const existing = await store.winner(game.id)
      if (existing?.announced_at) { await edit(ephemeral('That game has already been closed out.')); return }
      await store.updateWinner(game.id, { announced_at: now })
    }
    await edit(card)
  }, waitUntil)
}

/**
 * Someone answered a round.
 *
 * Two things close picks, and both are checked here rather than trusted from the row: the clock
 * on the round, and the half-inning actually starting. The second is the one that keeps the
 * game fair. The ingest only passes every two minutes, so a round whose inning started ninety
 * seconds ago still reads "open" in the table, and without this check anyone watching the game
 * could see a run cross and then click.
 */
async function predictButton(
  interaction: Interaction,
  env: Env,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<Response> {
  const [prefix, roundId, optionKey] = (interaction.data?.custom_id ?? '').split(':')
  if (prefix !== 'predict' || !roundId) return json({ type: PONG })

  const store = predictStore(env)
  if (!store) return message(ephemeral('The predictions game is not configured on this deploy.'))

  try {
    const round = await store.round(roundId)
    if (!round) return message(ephemeral('That round is gone.'))
    if (!round.options?.some(o => o.key === optionKey)) return message(ephemeral('That is not one of the answers.'))
    if (round.status !== 'open') return message(ephemeral('Picks are closed on that one.'))

    // The row carries its own message id only after the follow-up write lands, and that write
    // can fail. A button press is a free chance to learn it, and it is what lets the bot token
    // reveal the answer later.
    const fresh: PredictRound = {
      ...round,
      message_id: round.message_id ?? interaction.message?.id ?? null,
      application_id: interaction.application_id ?? round.application_id,
      // A press is a live interaction, so its token can edit the card the button sits on even
      // when the round's own token died fifteen minutes after it opened.
      interaction_token: interaction.token ?? round.interaction_token,
    }
    if (!round.message_id && interaction.message?.id && waitUntil) {
      waitUntil(store.updateRound(round.id, { message_id: interaction.message.id }).catch(() => {}))
    }

    const now = Date.now()
    const game = await store.game(round.game_id)
    const plays = game ? await store.plays(round.game_id, round.anchor_sequence ?? 0) : []
    const started = game ? halfInningStarted(roundTarget(round), game, plays) : false
    if (Date.parse(round.locks_at) <= now || started) {
      const patch = { status: 'locked', closed_at: new Date(now).toISOString() }
      Object.assign(fresh, patch)
      if (waitUntil) {
        waitUntil((async () => {
          await store.updateRound(round.id, patch)
          await refreshCard(store, fresh, env.DISCORD_BOT_TOKEN)
        })().catch(() => {}))
      }
      return message(ephemeral(started
        ? 'The inning has started, so picks are closed on that one.'
        : 'Picks just closed on that one.'))
    }

    const who = actor(interaction)
    if (!who.id) return message(ephemeral('Discord did not say who you are, so that pick cannot be recorded.'))
    await store.savePick({
      round_id: round.id,
      discord_user_id: who.id,
      display_name: who.name,
      option_key: optionKey,
      // Measured from when the round opened, which is the only clock both sides share. It is
      // the tiebreak for the game's winner and nothing else.
      response_ms: Math.max(0, now - Date.parse(round.opened_at)),
    })
    // The card shows a running total of picks and never the split by option: a live per-button
    // tally turns a prediction into a poll about what the channel thinks.
    if (waitUntil) waitUntil(refreshCard(store, fresh, env.DISCORD_BOT_TOKEN).catch(() => false))

    return message(pickAck(optionKey, round))
  } catch (e) {
    return message(ephemeral(`That did not record: ${e instanceof Error ? e.message : 'unknown error'}`))
  }
}

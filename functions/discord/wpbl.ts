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
// Setup, including registering the command and where the public key comes from, is in
// docs/DISCORD.md.
import { searchPlayers } from '../../src/wpbl/playerSearch'
import { buildPlayerReply, buildNoMatchReply, buildAmbiguousReply, type DiscordReply } from '../../src/wpbl/discordPlayerCard'
import { buildPositionIndex, displayPositionFromIndex } from '../../src/wpbl/positions'
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
const PING = 1, APPLICATION_COMMAND = 2, AUTOCOMPLETE = 4
const PONG = 1, CHANNEL_MESSAGE = 4, AUTOCOMPLETE_RESULT = 8

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
    const reply = await lookup(typed(interaction), env, waitUntil)
    return json({ type: CHANNEL_MESSAGE, data: reply })
  }

  // A component or modal we never registered. Acknowledge rather than erroring.
  return json({ type: PONG })
}

// ─── Interaction shapes ───────────────────────────────────────────────────────

interface InteractionOption { name: string; value?: string; focused?: boolean }
interface Interaction {
  type: number
  data?: { name?: string; options?: InteractionOption[] }
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

type RosterPlayer = Pick<WpblPlayer, 'id' | 'name' | 'position' | 'team_id'>

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
    read<RosterPlayer>('wpbl_players?select=id,name,position,team_id&order=name'),
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

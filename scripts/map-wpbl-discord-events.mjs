#!/usr/bin/env node
/**
 * map-wpbl-discord-events.mjs — build the game→event-URL map, once, automatically.
 *
 * Reads scripts/wpbl-discord-events.txt (one watch-party event link per line), resolves
 * each event's name + scheduled start time, matches it to the wpbl_games row whose first
 * pitch is at the same instant, and writes scripts/wpbl-event-urls.json:
 *
 *     { "<api_game_id>": "<event link>", ... }
 *
 * Keyed on api_game_id, the league feed's own id, NOT on wpbl_games.id. The ingest deletes
 * phantom duplicates of a game by api_game_id and reinserts the real row later with a FRESH
 * uuid, so a uuid-keyed map silently loses its entries as the season runs and the board
 * degrades to the generic fallback link with nothing logged. api_game_id is the upsert's
 * conflict key, so it survives that churn by construction.
 *
 * TWO link forms are accepted, and they are not equally resolvable:
 *
 *   https://discord.gg/<code>?event=<id>       public invite API, no token
 *   https://discord.com/events/<guild>/<id>    needs DISCORD_BOT_TOKEN
 *
 * The invite form only carries the event while the invite's channel IS the event's channel.
 * Move the watch parties elsewhere (voice to stage, say) and Discord silently drops
 * guild_scheduled_event from that invite's payload: HTTP 200, event simply absent, and
 * every link on the board opens a bare server invite with no RSVP. That is what broke on
 * Aug 23, 2026. The /events/ form is bound to the guild rather than to a channel, so it
 * survives the move, which is why it is preferred and why a bot token is worth having.
 *
 * Usage (local, from repo root):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   [DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=...] \
 *   node scripts/map-wpbl-discord-events.mjs
 *
 * With DISCORD_BOT_TOKEN set the guild's whole event list is pulled and the txt file is
 * not read at all, so recreating every event needs no file edit: just re-run this.
 *
 * It prints a pairing table so you can eyeball the matches, and lists anything it could
 * not confidently match (fix the time in Discord, or map it by hand in the JSON).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

const HERE = dirname(fileURLToPath(import.meta.url))
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
// Only public reads (wpbl_games/wpbl_teams), so the anon key is enough — no need for the
// service-role secret. Prefer service-role if present, else the anon key from .env.
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  ?? process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌  Set SUPABASE_URL (or VITE_SUPABASE_URL) and a Supabase key (VITE_SUPABASE_ANON_KEY) before running')
  process.exit(1)
}

const BOT_TOKEN = (process.env.DISCORD_BOT_TOKEN ?? '').trim()
const GUILD_ID = (process.env.DISCORD_GUILD_ID ?? '').trim()

const WPBL_TZ = 'America/Chicago'
// Accept a game as "the same" event if first pitch is within this many minutes of the
// event's start time. Watch parties are scheduled at first pitch, so this is generous.
const MATCH_TOLERANCE_MIN = 20

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws },
})

// Same first-pitch math as the board + reminder scripts.
function gameStartMs(gameDate, startTime) {
  if (!startTime) return null
  const m = String(startTime).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!m) return null
  let h = parseInt(m[1], 10) % 12
  if (/pm/i.test(m[3])) h += 12
  const min = parseInt(m[2], 10)
  const [y, mo, d] = gameDate.split('-').map(Number)
  const naive = Date.UTC(y, mo - 1, d, h, min)
  const ref = new Date(naive)
  const offset = new Date(ref.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
    - new Date(ref.toLocaleString('en-US', { timeZone: WPBL_TZ })).getTime()
  return naive + offset
}

function readEventUrls() {
  const raw = readFileSync(join(HERE, 'wpbl-discord-events.txt'), 'utf8')
  return raw.split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
}

/** Split either accepted link form into { kind, code, guildId, eventId }. */
function parseEventUrl(url) {
  const u = new URL(url)
  const parts = u.pathname.split('/').filter(Boolean)
  if (parts[0] === 'events' && parts.length >= 3) {
    return { kind: 'guild', guildId: parts[1], eventId: parts[2] }
  }
  const eventId = u.searchParams.get('event')                    // '15367...'
  const code = parts.pop()                                       // 'uJ5CAxtdPF'
  if (code && eventId) return { kind: 'invite', code, eventId }
  throw new Error(`Can't parse an event out of ${url}`)
}

/** Pull an event's name + start instant from the public invite endpoint (no auth). */
async function fetchViaInvite(url, { code, eventId }) {
  const api = `https://discord.com/api/v10/invites/${code}?guild_scheduled_event_id=${eventId}&with_counts=false`
  const res = await fetch(api, { headers: { 'User-Agent': 'wpbl-board-mapper/1.0' } })
  if (!res.ok) throw new Error(`Invite fetch ${res.status} for ${url}: ${await res.text()}`)
  const data = await res.json()
  const ev = data.guild_scheduled_event
  // A 200 carrying no event means the invite's channel is no longer the event's channel
  // (see the header). Say that, rather than "event deleted", which sends you hunting for
  // the wrong thing: the event is fine, the link shape is what stopped working.
  if (!ev?.scheduled_start_time) {
    throw new Error(
      `Invite ${code} resolved but carries no event ${eventId}. The invite is bound to a ` +
      `channel the event no longer lives in. Use the https://discord.com/events/<guild>/<id> ` +
      `form (needs DISCORD_BOT_TOKEN), or make a fresh invite on the event's own channel.`
    )
  }
  return { name: ev.name ?? '(unnamed)', startMs: Date.parse(ev.scheduled_start_time), url }
}

/**
 * Every scheduled event in a guild, by id. Needs a bot token: there is no unauthenticated
 * way in. The guild endpoint 401s, and the event page serves generic Discord marketing OG
 * tags rather than the event's, so scraping the link is not a fallback either.
 * Cached per guild, so a file of twenty links still costs one request.
 */
const guildEventCache = new Map()
async function guildEvents(guildId) {
  if (guildEventCache.has(guildId)) return guildEventCache.get(guildId)
  if (!BOT_TOKEN) {
    throw new Error(
      `Set DISCORD_BOT_TOKEN to resolve https://discord.com/events/${guildId}/… links ` +
      `(Discord exposes no public endpoint for them).`
    )
  }
  const api = `https://discord.com/api/v10/guilds/${guildId}/scheduled-events`
  const res = await fetch(api, {
    headers: { Authorization: `Bot ${BOT_TOKEN}`, 'User-Agent': 'wpbl-board-mapper/1.0' },
  })
  if (!res.ok) throw new Error(`Guild events fetch ${res.status} for ${guildId}: ${await res.text()}`)
  const byId = new Map((await res.json()).map(ev => [ev.id, ev]))
  guildEventCache.set(guildId, byId)
  return byId
}

async function fetchViaGuild(url, { guildId, eventId }) {
  const ev = (await guildEvents(guildId)).get(eventId)
  if (!ev?.scheduled_start_time) throw new Error(`Guild ${guildId} has no scheduled event ${eventId} (deleted?)`)
  return { name: ev.name ?? '(unnamed)', startMs: Date.parse(ev.scheduled_start_time), url }
}

async function fetchEvent(url) {
  const parsed = parseEventUrl(url)
  return parsed.kind === 'guild' ? fetchViaGuild(url, parsed) : fetchViaInvite(url, parsed)
}

/**
 * With a bot token the hand-listed file is redundant: take the guild's whole event list
 * instead. That is the difference between "recreate the events, then re-paste twenty
 * links" and "recreate the events, then re-run this", and the first is the maintenance
 * step that actually gets skipped.
 */
async function discoverEvents(guildId) {
  return [...(await guildEvents(guildId)).values()]
    .filter(ev => ev.scheduled_start_time)
    .map(ev => ({
      name: ev.name ?? '(unnamed)',
      startMs: Date.parse(ev.scheduled_start_time),
      url: `https://discord.com/events/${guildId}/${ev.id}`,
    }))
}

async function fetchGames() {
  const { data: teams, error: tErr } = await supabase.from('wpbl_teams').select('id, city, name')
  if (tErr) throw new Error(`Loading teams failed: ${tErr.message}`)
  const teamName = new Map((teams ?? []).map(t => [t.id, `${t.city} ${t.name}`]))

  const { data: games, error: gErr } = await supabase
    .from('wpbl_games')
    .select('id, api_game_id, game_date, start_time, home_team_id, away_team_id, status')
    .neq('status', 'final')
  if (gErr) throw new Error(`Loading games failed: ${gErr.message}`)

  return (games ?? [])
    .map(g => ({
      id: g.api_game_id,            // the key the map is written on (see the header)
      startMs: gameStartMs(g.game_date, g.start_time),
      matchup: `${teamName.get(g.away_team_id) ?? '???'} @ ${teamName.get(g.home_team_id) ?? '???'}`,
    }))
    .filter(g => g.startMs != null && g.id)
}

/**
 * The events to match against. A bot token means we can just ask the guild what exists,
 * which is both less to maintain and immune to the txt file going stale; without one we
 * fall back to the hand-listed links, which is all the public API allows.
 */
async function collectEvents() {
  if (BOT_TOKEN && GUILD_ID) {
    console.log(`\n🔗 Listing every scheduled event in guild ${GUILD_ID}…\n`)
    const found = await discoverEvents(GUILD_ID)
    console.log(`   ${found.length} event(s) in the guild.`)
    return found
  }

  const urls = readEventUrls()
  console.log(`\n🔗 Resolving ${urls.length} event link(s) from wpbl-discord-events.txt…`)
  if (!BOT_TOKEN) console.log(`   (set DISCORD_BOT_TOKEN + DISCORD_GUILD_ID to skip the file entirely)`)
  console.log('')

  const events = []
  for (const url of urls) {
    try {
      events.push(await fetchEvent(url))
    } catch (err) {
      console.warn(`  ⚠️  ${err.message}`)
    }
    await new Promise(r => setTimeout(r, 250)) // be polite to the invite endpoint
  }
  return events
}

async function main() {
  const events = await collectEvents()

  const games = await fetchGames()
  const map = {}
  const usedGameIds = new Set()
  const rows = []
  const unmatched = []

  // Match closest-in-time first, so tight clusters resolve to their nearest game.
  const pairs = []
  for (const ev of events) {
    for (const g of games) {
      pairs.push({ ev, g, diffMin: Math.abs(ev.startMs - g.startMs) / 60000 })
    }
  }
  pairs.sort((a, b) => a.diffMin - b.diffMin)

  const usedEvents = new Set()
  for (const { ev, g, diffMin } of pairs) {
    if (usedEvents.has(ev.url) || usedGameIds.has(g.id)) continue
    if (diffMin > MATCH_TOLERANCE_MIN) continue
    map[g.id] = ev.url
    usedEvents.add(ev.url)
    usedGameIds.add(g.id)
    rows.push({ when: new Date(g.startMs).toISOString(), matchup: g.matchup, event: ev.name, diffMin: diffMin.toFixed(0) })
  }
  for (const ev of events) {
    if (!usedEvents.has(ev.url)) unmatched.push(ev)
  }

  rows.sort((a, b) => a.when.localeCompare(b.when))
  console.log('✅ Matched pairs (verify these look right):\n')
  for (const r of rows) console.log(`   ${r.when}  ${r.matchup.padEnd(34)}  ← "${r.event}"  (Δ${r.diffMin}m)`)

  if (unmatched.length) {
    // With guild discovery this list also holds every unrelated event in the server, so it
    // is informational, not a failure. Only a MISSING game is worth chasing.
    console.log(`\n⚠️  ${unmatched.length} event(s) had no game within ${MATCH_TOLERANCE_MIN} min. Unrelated events land here too:`)
    for (const ev of unmatched) {
      console.log(`   "${ev.name}"  @ ${new Date(ev.startMs).toISOString()}  ${ev.url}`)
    }
  }

  const missing = games.filter(g => !usedGameIds.has(g.id) && g.startMs > Date.now())
  if (missing.length) {
    console.log(`\n❗ ${missing.length} upcoming game(s) have NO event. The board will show the generic fallback link:`)
    for (const g of missing) console.log(`   ${new Date(g.startMs).toISOString()}  ${g.matchup}`)
  }

  const outPath = join(HERE, 'wpbl-event-urls.json')

  // Refuse to replace a populated map with an empty one. Every way this script fails at
  // scale fails the same way: nothing resolves, every game matches nothing, and the write
  // lands `{}` over a file that was correct a second ago. The board then shows the generic
  // fallback on every line and nothing anywhere reports a problem. Rerunning without a bot
  // token after the events moved to a stage channel did exactly this.
  let existing = {}
  try { existing = JSON.parse(readFileSync(outPath, 'utf8')) } catch { /* first run */ }
  if (!Object.keys(map).length && Object.keys(existing).length) {
    throw new Error(
      `Resolved 0 event(s) but ${Object.keys(existing).length} mapping(s) already exist, so ` +
      `refusing to blank ${outPath}. Fix the errors above (a bot token is needed for ` +
      `discord.com/events/ links) and re-run.`
    )
  }

  writeFileSync(outPath, JSON.stringify(map, null, 2) + '\n')
  console.log(`\n💾 Wrote ${Object.keys(map).length} mapping(s) to ${outPath}\n`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })

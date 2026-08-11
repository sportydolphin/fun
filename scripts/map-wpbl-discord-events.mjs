#!/usr/bin/env node
/**
 * map-wpbl-discord-events.mjs — build the game→event-URL map, once, automatically.
 *
 * Reads scripts/wpbl-discord-events.txt (one watch-party invite link per line), asks
 * Discord's PUBLIC invite API for each event's name + scheduled start time (no bot token
 * needed — an event invite is public), matches each event to the wpbl_games row whose
 * first pitch is at the same instant, and writes scripts/wpbl-event-urls.json:
 *
 *     { "<wpbl-game-id>": "https://discord.gg/<code>?event=<id>", ... }
 *
 * update-wpbl-discord-board.mjs loads that JSON, so each game on the board links to its
 * own event. Re-run this whenever you add/replace events — it just rewrites the JSON,
 * no code edits.
 *
 * Usage (local, from repo root):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/map-wpbl-discord-events.mjs
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

/** Pull an event's name + start instant from the public invite endpoint (no auth). */
async function fetchEvent(url) {
  const u = new URL(url)
  const code = u.pathname.split('/').filter(Boolean).pop()      // 'qyQjy667'
  const eventId = u.searchParams.get('event')                    // '15367...'
  if (!code || !eventId) throw new Error(`Can't parse invite/event from ${url}`)

  const api = `https://discord.com/api/v10/invites/${code}?guild_scheduled_event_id=${eventId}&with_counts=false`
  const res = await fetch(api, { headers: { 'User-Agent': 'wpbl-board-mapper/1.0' } })
  if (!res.ok) throw new Error(`Invite fetch ${res.status} for ${url}: ${await res.text()}`)
  const data = await res.json()
  const ev = data.guild_scheduled_event
  if (!ev?.scheduled_start_time) throw new Error(`No scheduled event on invite ${url}`)
  return { name: ev.name ?? '(unnamed)', startMs: Date.parse(ev.scheduled_start_time), url }
}

async function fetchGames() {
  const { data: teams, error: tErr } = await supabase.from('wpbl_teams').select('id, city, name')
  if (tErr) throw new Error(`Loading teams failed: ${tErr.message}`)
  const teamName = new Map((teams ?? []).map(t => [t.id, `${t.city} ${t.name}`]))

  const { data: games, error: gErr } = await supabase
    .from('wpbl_games')
    .select('id, game_date, start_time, home_team_id, away_team_id, status')
    .neq('status', 'final')
  if (gErr) throw new Error(`Loading games failed: ${gErr.message}`)

  return (games ?? [])
    .map(g => ({
      id: g.id,
      startMs: gameStartMs(g.game_date, g.start_time),
      matchup: `${teamName.get(g.away_team_id) ?? '???'} @ ${teamName.get(g.home_team_id) ?? '???'}`,
    }))
    .filter(g => g.startMs != null)
}

async function main() {
  const urls = readEventUrls()
  console.log(`\n🔗 Resolving ${urls.length} event link(s) via Discord's public invite API…\n`)

  const events = []
  for (const url of urls) {
    try {
      events.push(await fetchEvent(url))
    } catch (err) {
      console.warn(`  ⚠️  ${err.message}`)
    }
    await new Promise(r => setTimeout(r, 250)) // be polite to the invite endpoint
  }

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
    console.log(`\n⚠️  ${unmatched.length} event(s) had no game within ${MATCH_TOLERANCE_MIN} min — map by hand or fix the event time:`)
    for (const ev of unmatched) {
      console.log(`   "${ev.name}"  @ ${new Date(ev.startMs).toISOString()}  ${ev.url}`)
    }
  }

  const outPath = join(HERE, 'wpbl-event-urls.json')
  writeFileSync(outPath, JSON.stringify(map, null, 2) + '\n')
  console.log(`\n💾 Wrote ${Object.keys(map).length} mapping(s) to ${outPath}\n`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })

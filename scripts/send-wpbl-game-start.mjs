#!/usr/bin/env node
/**
 * send-wpbl-game-start.mjs — "the WPBL game you flagged is about to start" Web Push.
 *
 * The push side of the reminder bell on the WPBL Home next-game card
 * Two ways to opt in, both honoured here: a standing
 * user_preferences.notify_wpbl_all_games ("before every game"), and legacy per-game
 * wpbl_game_reminders rows. The standing opt-in is expanded into one reminder per scheduled
 * game for today, so everything downstream treats them identically.
 *
 * (src/wpbl/Home.tsx → src/wpbl/reminders.ts). For every wpbl_game_reminders opt-in
 * whose game's first pitch is now within the user's lead window, it sends one push.
 * A row in wpbl_game_start_sent keeps each reminder to exactly one delivery, so this
 * is safe to run every few minutes from cron.
 *
 * Unlike the MLB sender (which reads StatsAPI), everything here comes from our own
 * Supabase mirror: wpbl_games for the schedule, wpbl_teams for the matchup names.
 *
 * Usage (local):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com \
 *   node scripts/send-wpbl-game-start.mjs
 *
 *   # Send a one-off TEST reminder to a single user (ignores timing):
 *   node scripts/send-wpbl-game-start.mjs --test <user-id-or-email>
 *
 * Required env vars: same as scripts/send-game-start.mjs.
 *
 * Prerequisites (run once): scripts/create_wpbl_game_reminders.sql.
 */

import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
import webpush from 'web-push'
import { buildWpblGameStart } from '../shared/notifications.js'

// ─── Setup ────────────────────────────────────────────────────────────────────

const SUPABASE_URL  = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY ?? process.env.VITE_VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:notifications@sportydolphin.fun'

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running')
  process.exit(1)
}
if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
  console.error('❌  Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY before running')
  process.exit(1)
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws },
})

// A little grace so a game that just started (or a cron pass that lands a couple
// minutes late) still fires rather than being silently skipped.
const START_GRACE_MIN = 3
const DEFAULT_LEAD_MIN = 30
// The single hub venue sits in U.S. Central time; game start_time is a flat wall
// clock there (mirrors src/wpbl/constants.ts formatGameTime / gameStartMs).
const WPBL_TZ = 'America/Chicago'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * The true UTC instant (epoch ms) of a WPBL game's first pitch. Treats the stored
 * "H:MM AM/PM" wall clock as Central, DST-safe (identical math to the client's
 * gameStartMs). Null if there's no valid start time.
 */
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

/**
 * Turn a shared-catalog notification into a Web Push wire payload. Same shape as
 * send-game-start.mjs: `id` doubles as the push `tag`, and the catalog emoji
 * travels as `emoji` (sw.js keeps `icon` for the OS notification image).
 */
function toPushPayload(n) {
  return { id: n.id, type: n.type, title: n.title, body: n.body, url: n.url, emoji: n.icon, tag: n.id }
}

async function sendToUser(subs, payload) {
  let sent = 0
  const body = JSON.stringify(payload)
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body
      )
      sent++
    } catch (err) {
      const code = err?.statusCode
      if (code === 404 || code === 410) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
        console.log(`  🧹 Pruned expired subscription (${code})`)
      } else {
        console.warn(`  ⚠️  Send failed (${code ?? 'no status'}): ${err?.body ?? err?.message ?? err}`)
      }
    }
  }
  return sent
}

/** teamId → "City Name" (e.g. "Boston Hunters"), for the push matchup line. */
async function fetchTeamNames() {
  const { data, error } = await supabase.from('wpbl_teams').select('id, city, name')
  if (error) throw new Error(`Loading teams failed: ${error.message}`)
  const byId = new Map()
  for (const t of data ?? []) byId.set(t.id, `${t.city} ${t.name}`)
  return byId
}

function matchupLine(teamNames, game) {
  const away = teamNames.get(game.away_team_id) ?? '???'
  const home = teamNames.get(game.home_team_id) ?? '???'
  return `${away} @ ${home}`
}

// ─── Test mode ────────────────────────────────────────────────────────────────

async function resolveUserId(idOrEmail) {
  if (!idOrEmail.includes('@')) return idOrEmail
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw new Error(`listUsers failed: ${error.message}`)
  const match = data?.users?.find(u => (u.email ?? '').toLowerCase() === idOrEmail.toLowerCase())
  if (!match) throw new Error(`No user found with email ${idOrEmail}`)
  return match.id
}

async function runTest(idOrEmail) {
  const userId = await resolveUserId(idOrEmail)
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
  if (!subs || subs.length === 0) {
    console.log(`No subscriptions found for user ${userId}. Enable notifications in the app first.`)
    return
  }
  const sent = await sendToUser(subs, toPushPayload(buildWpblGameStart({
    gameId: 'test', matchup: 'Boston Hunters @ New York Heights', minutesToStart: 5,
  })))
  console.log(`✅ Test WPBL game-start push sent to ${sent}/${subs.length} device(s).`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const testFlagIdx = process.argv.indexOf('--test')
  if (testFlagIdx !== -1) {
    const who = process.argv[testFlagIdx + 1]
    if (!who) { console.error('Usage: node scripts/send-wpbl-game-start.mjs --test <user-id-or-email>'); process.exit(1) }
    await runTest(who)
    return
  }

  const date = todayStr()
  console.log(`\n🥎 WPBL game-start reminders — ${date}\n`)

  // 1. Opt-ins for games today (past days can't still be "upcoming"; future days
  //    aren't in-window yet, but keeping >= today keeps the query cheap and correct).
  const { data: reminders, error: remErr } = await supabase
    .from('wpbl_game_reminders')
    .select('user_id, game_id, lead_min')
    .gte('game_date', date)
  if (remErr) {
    console.error('  ❌  Could not read wpbl_game_reminders — run scripts/create_wpbl_game_reminders.sql first.')
    throw new Error(remErr.message)
  }
  // 1b. Standing opt-ins: users who asked for a reminder before EVERY game rather than
  //     picking them off one at a time. Expanded below into one virtual reminder per
  //     scheduled game, so the rest of this script does not need to know the difference.
  const { data: allGamesRows, error: allErr } = await supabase
    .from('user_preferences')
    .select('user_id, notify_wpbl_all_games')
    .eq('notify_wpbl_all_games', true)
  if (allErr) throw new Error(`Loading WPBL notification preferences failed: ${allErr.message}`)
  const allGamesUsers = (allGamesRows ?? []).map(r => r.user_id)

  if ((!reminders || reminders.length === 0) && allGamesUsers.length === 0) {
    console.log('  No reminders opted in — exiting.')
    return
  }

  // 2. The games in play: the ones per-game reminders point at, plus today's scheduled
  //    games for anyone on the standing opt-in. Only scheduled games can still fire a
  //    pre-game push; live/final have already started.
  const { data: todayRows, error: todayErr } = await supabase
    .from('wpbl_games')
    .select('id, game_date, start_time, status, home_team_id, away_team_id')
    .eq('game_date', date)
  if (todayErr) throw new Error(`Loading today's games failed: ${todayErr.message}`)
  const todayGames = todayRows ?? []

  const gameIds = [...new Set(reminders.map(r => r.game_id))]
  const { data: gameRows, error: gameErr } = await supabase
    .from('wpbl_games')
    .select('id, game_date, start_time, status, home_team_id, away_team_id')
    .in('id', gameIds.length ? gameIds : ['00000000-0000-0000-0000-000000000000'])
  if (gameErr) throw new Error(`Loading games failed: ${gameErr.message}`)
  const gameById = new Map([...(gameRows ?? []), ...todayGames].map(g => [g.id, g]))

  // Fold the standing opt-ins in as ordinary reminders, skipping any (user, game) that
  // already has a real row so a user can't be queued twice for the same game.
  const seen = new Set(reminders.map(r => `${r.user_id}:${r.game_id}`))
  for (const userId of allGamesUsers) {
    for (const g of todayGames) {
      const key = `${userId}:${g.id}`
      if (seen.has(key)) continue
      seen.add(key)
      reminders.push({ user_id: userId, game_id: g.id, lead_min: DEFAULT_LEAD_MIN })
    }
  }
  if (allGamesUsers.length) {
    console.log(`  ${allGamesUsers.length} user(s) on the every-game opt-in`)
  }
  if (reminders.length === 0) { console.log('  Nothing to send today — exiting.'); return }

  // 3. Which reminders already went out, so we send each exactly once.
  const { data: sentRows, error: sentErr } = await supabase
    .from('wpbl_game_start_sent')
    .select('user_id, game_id')
    .eq('game_date', date)
  if (sentErr) {
    console.error('  ❌  Could not read wpbl_game_start_sent — run scripts/create_wpbl_game_reminders.sql first.')
    throw new Error(sentErr.message)
  }
  const alreadySent = new Set((sentRows ?? []).map(r => `${r.user_id}:${r.game_id}`))

  // 4. Push subscriptions for the opted-in users, grouped by user.
  const userIds = [...new Set(reminders.map(r => r.user_id))]
  const { data: subsRows, error: subsErr } = await supabase
    .from('push_subscriptions')
    .select('user_id, endpoint, p256dh, auth')
    .in('user_id', userIds)
  if (subsErr) throw new Error(`Loading subscriptions failed: ${subsErr.message}`)
  const subsByUser = new Map()
  for (const row of subsRows ?? []) {
    if (!subsByUser.has(row.user_id)) subsByUser.set(row.user_id, [])
    subsByUser.get(row.user_id).push(row)
  }

  const teamNames = await fetchTeamNames()
  const now = Date.now()

  // 5. Fire for each opt-in whose game is scheduled and inside the lead window.
  let notified = 0
  for (const rem of reminders) {
    const game = gameById.get(rem.game_id)
    if (!game || game.status !== 'scheduled') continue
    if (game.game_date !== date) continue // only today's slate is in play right now

    const startMs = gameStartMs(game.game_date, game.start_time)
    if (startMs == null) continue

    const minutesToStart = (startMs - now) / 60_000
    const leadMin = Number.isFinite(rem.lead_min) && rem.lead_min > 0 ? rem.lead_min : DEFAULT_LEAD_MIN
    if (minutesToStart > leadMin || minutesToStart < -START_GRACE_MIN) continue
    if (alreadySent.has(`${rem.user_id}:${rem.game_id}`)) continue

    const subs = subsByUser.get(rem.user_id)
    if (!subs || subs.length === 0) continue

    const payload = toPushPayload(buildWpblGameStart({
      gameId:         game.id,
      matchup:        matchupLine(teamNames, game),
      minutesToStart,
    }))
    const sent = await sendToUser(subs, payload)
    if (sent > 0) {
      // Record before moving on so a mid-run crash can't double-send on retry.
      await supabase.from('wpbl_game_start_sent').insert({
        user_id: rem.user_id, game_id: game.id, game_date: date,
      })
      notified++
    }
  }

  console.log(`\n✅ Reminded ${notified} user(s).\n`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })

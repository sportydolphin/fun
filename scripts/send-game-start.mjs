#!/usr/bin/env node
/**
 * send-game-start.mjs — "your team's game is about to start" Web Push.
 *
 * The push twin of the in-site game-start source (src/mlb/notifications/
 * gameStart.ts): same catalog builder, same id, so a user who gets the push and
 * then opens the site sees one notification, not two.
 *
 * For every user who has opted into game-start reminders (user_preferences
 * .notify_game_start) and set a followed team, it finds that team's next game
 * today and, once first pitch is within the user's lead window, sends one push.
 * A row in game_start_sent keeps each reminder to exactly one delivery, so this
 * is safe to run every few minutes from cron.
 *
 * Usage (local):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com \
 *   node scripts/send-game-start.mjs
 *
 *   # Send a one-off TEST game-start push to a single user (ignores timing):
 *   node scripts/send-game-start.mjs --test <user-id-or-email>
 *
 * Required env vars: same as scripts/send-reminders.mjs.
 *
 * Prerequisites (run once): scripts/add_game_start_prefs.sql,
 * scripts/create_game_start_sent.sql.
 */

import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
import webpush from 'web-push'
import { buildGameStart, DEFAULT_GAME_START_LEAD_MIN } from '../shared/notifications.js'

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Turn a shared-catalog notification into a Web Push wire payload. Same shape as
 * send-reminders.mjs: `id` doubles as the push `tag`, and the catalog emoji
 * travels as `emoji` (sw.js keeps `icon` for the OS notification image).
 */
function toPushPayload(n) {
  return { id: n.id, type: n.type, title: n.title, body: n.body, url: n.url, emoji: n.icon, tag: n.id }
}

/** teamId → that team's games today, each with { gamePk, startMs, state, matchup, teamName }. */
async function fetchTeamGames(date) {
  const res = await fetch(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&gameType=R`
  )
  const d = await res.json()
  const byTeam = new Map()
  const add = (teamId, game) => {
    if (!byTeam.has(teamId)) byTeam.set(teamId, [])
    byTeam.get(teamId).push(game)
  }
  for (const dateObj of d.dates ?? []) {
    for (const g of dateObj.games ?? []) {
      if (!g.gameDate) continue
      const home = g.teams?.home?.team
      const away = g.teams?.away?.team
      const base = {
        gamePk:  Number(g.gamePk),
        startMs: new Date(g.gameDate).getTime(),
        state:   g.status?.abstractGameState ?? 'Preview',
        matchup: `${away?.name ?? '???'} @ ${home?.name ?? '???'}`,
      }
      if (home?.id) add(Number(home.id), { ...base, teamName: home.name })
      if (away?.id) add(Number(away.id), { ...base, teamName: away.name })
    }
  }
  // Earliest first, so "next game" is just the first non-final one.
  for (const list of byTeam.values()) list.sort((a, b) => a.startMs - b.startMs)
  return byTeam
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
  const sent = await sendToUser(subs, toPushPayload(buildGameStart({
    gamePk: 0, teamName: 'Reds', matchup: 'Cubs @ Reds', minutesToStart: 5,
  })))
  console.log(`✅ Test game-start push sent to ${sent}/${subs.length} device(s).`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const testFlagIdx = process.argv.indexOf('--test')
  if (testFlagIdx !== -1) {
    const who = process.argv[testFlagIdx + 1]
    if (!who) { console.error('Usage: node scripts/send-game-start.mjs --test <user-id-or-email>'); process.exit(1) }
    await runTest(who)
    return
  }

  const date = todayStr()
  console.log(`\n⏰ Game-start reminders — ${date}\n`)

  // 1. All opted-in subscriptions, grouped by user.
  const { data: subsRows, error: subsErr } = await supabase
    .from('push_subscriptions')
    .select('user_id, endpoint, p256dh, auth')
  if (subsErr) throw new Error(`Loading subscriptions failed: ${subsErr.message}`)
  if (!subsRows || subsRows.length === 0) { console.log('  No push subscriptions yet — exiting.'); return }

  const subsByUser = new Map()
  for (const row of subsRows) {
    if (!subsByUser.has(row.user_id)) subsByUser.set(row.user_id, [])
    subsByUser.get(row.user_id).push(row)
  }

  // 2. Preferences for those users — who opted in, their team, their lead time.
  const userIds = [...subsByUser.keys()]
  const { data: prefRows, error: prefErr } = await supabase
    .from('user_preferences')
    .select('user_id, followed_team_id, notify_game_start, game_start_lead_min')
    .in('user_id', userIds)
  if (prefErr) throw new Error(`Loading preferences failed: ${prefErr.message}`)

  const candidates = (prefRows ?? []).filter(p => p.notify_game_start && p.followed_team_id != null)
  if (candidates.length === 0) { console.log('  No users opted into game-start reminders — exiting.'); return }

  // 3. Which reminders already went out today, so we send each exactly once.
  const { data: sentRows, error: sentErr } = await supabase
    .from('game_start_sent')
    .select('user_id, game_pk')
    .eq('game_date', date)
  if (sentErr) {
    console.error('  ❌  Could not read game_start_sent — run scripts/create_game_start_sent.sql first.')
    throw new Error(sentErr.message)
  }
  const alreadySent = new Set((sentRows ?? []).map(r => `${r.user_id}:${r.game_pk}`))

  // 4. Today's games, keyed by team.
  const teamGames = await fetchTeamGames(date)
  const now = Date.now()

  // 5. Fire for each candidate whose team's next game is inside their window.
  let notified = 0
  for (const pref of candidates) {
    const games = teamGames.get(Number(pref.followed_team_id)) ?? []
    const game  = games.find(g => g.state !== 'Final')
    if (!game) continue

    const minutesToStart = (game.startMs - now) / 60_000
    const leadMin = Number.isFinite(pref.game_start_lead_min) && pref.game_start_lead_min > 0
      ? pref.game_start_lead_min : DEFAULT_GAME_START_LEAD_MIN
    if (minutesToStart > leadMin || minutesToStart < -START_GRACE_MIN) continue
    if (alreadySent.has(`${pref.user_id}:${game.gamePk}`)) continue

    const payload = toPushPayload(buildGameStart({
      gamePk:         game.gamePk,
      teamName:       game.teamName,
      matchup:        game.matchup,
      minutesToStart,
    }))
    const sent = await sendToUser(subsByUser.get(pref.user_id), payload)
    if (sent > 0) {
      // Record before moving on so a mid-run crash can't double-send on retry.
      await supabase.from('game_start_sent').insert({
        user_id: pref.user_id, game_pk: game.gamePk, game_date: date,
      })
      notified++
    }
  }

  console.log(`\n✅ Reminded ${notified} user(s).\n`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })

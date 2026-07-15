#!/usr/bin/env node
/**
 * send-reminders.mjs — Daily "make your picks" Web Push reminder.
 *
 * Finds users who have opted into push (rows in push_subscriptions) but haven't
 * finished predicting today's games, and sends each of their devices a nudge.
 * Meant to run once a day from a GitHub Action, comfortably before first pitch.
 *
 * Usage (local):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com \
 *   node scripts/send-reminders.mjs
 *
 *   # Send a one-off test push to a single user (ignores pick state):
 *   node scripts/send-reminders.mjs --test <user-id>
 *
 * Required env vars:
 *   SUPABASE_URL               — project URL (or VITE_SUPABASE_URL as fallback)
 *   SUPABASE_SERVICE_ROLE_KEY  — service role key (NEVER the anon key)
 *   VAPID_PUBLIC_KEY           — VAPID public key (same one shipped as VITE_VAPID_PUBLIC_KEY)
 *   VAPID_PRIVATE_KEY          — VAPID private key (keep secret)
 *   VAPID_SUBJECT              — a mailto: or https: contact URL (optional; defaults to a mailto)
 */

import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
import webpush from 'web-push'

// ─── Setup ────────────────────────────────────────────────────────────────────

const SUPABASE_URL   = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const VAPID_PUBLIC   = process.env.VAPID_PUBLIC_KEY ?? process.env.VITE_VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE  = process.env.VAPID_PRIVATE_KEY ?? ''
const VAPID_SUBJECT  = process.env.VAPID_SUBJECT ?? 'mailto:notifications@sportydolphin.fun'

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** gamePks of today's not-yet-started games (the ones still pickable). */
async function fetchPreviewGamePks(date) {
  const res = await fetch(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&gameType=R` +
    `&fields=dates,games,gamePk,status,abstractGameState`
  )
  const d = await res.json()
  const pks = []
  for (const dateObj of d.dates ?? []) {
    for (const g of dateObj.games ?? []) {
      if ((g.status?.abstractGameState ?? 'Preview') === 'Preview') pks.push(Number(g.gamePk))
    }
  }
  return pks
}

/**
 * Send one payload to all of a user's subscriptions. Prunes any that the push
 * service reports as gone (404/410). Returns the number of successful sends.
 */
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

// ─── Test mode ──────────────────────────────────────────────────────────────

async function runTest(userId) {
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
  if (!subs || subs.length === 0) {
    console.log(`No subscriptions found for user ${userId}. Enable notifications in the app first.`)
    return
  }
  const sent = await sendToUser(subs, {
    title: '⚾ Test notification',
    body:  'Push notifications are working. You’re all set!',
    url:   '/mlb?view=home',
    tag:   'mlb-test',
  })
  console.log(`✅ Test sent to ${sent}/${subs.length} device(s).`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const testFlagIdx = process.argv.indexOf('--test')
  if (testFlagIdx !== -1) {
    const userId = process.argv[testFlagIdx + 1]
    if (!userId) { console.error('Usage: node scripts/send-reminders.mjs --test <user-id>'); process.exit(1) }
    await runTest(userId)
    return
  }

  const date = todayStr()
  console.log(`\n🔔 Pick reminders — ${date}\n`)

  // 1. Which of today's games are still pickable?
  const previewPks = await fetchPreviewGamePks(date)
  console.log(`  ${previewPks.length} game(s) still open for picks`)
  if (previewPks.length === 0) {
    console.log('  Nothing to remind about today — exiting.')
    return
  }
  const previewSet = new Set(previewPks)

  // 2. All opted-in subscriptions, grouped by user.
  const { data: subsRows, error: subsErr } = await supabase
    .from('push_subscriptions')
    .select('user_id, endpoint, p256dh, auth')
  if (subsErr) throw new Error(`Loading subscriptions failed: ${subsErr.message}`)
  if (!subsRows || subsRows.length === 0) {
    console.log('  No push subscriptions yet — exiting.')
    return
  }
  const subsByUser = new Map()
  for (const row of subsRows) {
    if (!subsByUser.has(row.user_id)) subsByUser.set(row.user_id, [])
    subsByUser.get(row.user_id).push(row)
  }
  console.log(`  ${subsByUser.size} subscribed user(s), ${subsRows.length} device(s)`)

  // 3. Today's picks for exactly those users, so we can compute who's behind.
  const userIds = [...subsByUser.keys()]
  const { data: predRows, error: predErr } = await supabase
    .from('game_predictions')
    .select('user_id, game_pk')
    .eq('game_date', date)
    .in('user_id', userIds)
  if (predErr) throw new Error(`Loading predictions failed: ${predErr.message}`)

  const pickedByUser = new Map()
  for (const row of predRows ?? []) {
    if (!pickedByUser.has(row.user_id)) pickedByUser.set(row.user_id, new Set())
    pickedByUser.get(row.user_id).add(Number(row.game_pk))
  }

  // 4. Nudge each user with at least one unpicked open game.
  let notified = 0
  for (const [userId, subs] of subsByUser) {
    const picked = pickedByUser.get(userId) ?? new Set()
    let remaining = 0
    for (const pk of previewSet) if (!picked.has(pk)) remaining++
    if (remaining === 0) continue

    const payload = {
      title: '⚾ Don’t forget your picks!',
      body:  `${remaining} ${remaining === 1 ? 'game' : 'games'} left to predict today — first pitch soon.`,
      url:   '/mlb?view=home',
      tag:   'mlb-daily-reminder',
    }
    const sent = await sendToUser(subs, payload)
    if (sent > 0) notified++
  }

  console.log(`\n✅ Reminded ${notified} user(s).\n`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })

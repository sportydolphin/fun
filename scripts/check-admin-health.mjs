#!/usr/bin/env node
/**
 * check-admin-health.mjs — page the owner when a background pipeline breaks.
 *
 * The /admin Health group answers "is anything broken" only for someone who has opened the
 * page, and the one ingest outage that ever reached production sat unseen for two days because
 * it was an amber chip nobody was looking at. This is the server-side other half: on a schedule
 * it reads the same health tables, asks shared/adminHealth.js what is actionable, and pushes the
 * owner's own devices when something is wrong — so a red state reaches them without anyone
 * opening the dashboard. The dashboard becomes where you DIAGNOSE, not where you DISCOVER.
 *
 * WHAT IT PAGES ON is decided in shared/adminHealth.js (and unit-tested there): a failed or
 * stalled ingest, the "unmapped team" ok:true-with-errors trap, and the nightly scoring job
 * failing or going missing. TrackMan "behind" and nightly findings are expected and never page.
 *
 * DEDUPE. admin_alert_state remembers the signature it last paged per problem, so a persistent
 * outage pages ONCE, not every run; a changed problem (a new kind of ingest error) re-pages,
 * and a still-broken one re-pages after the reminder window. A problem that clears drops its
 * row, so a recurrence pages fresh.
 *
 * Usage (local):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com \
 *   node scripts/check-admin-health.mjs
 *
 *   node scripts/check-admin-health.mjs --dry-run   # read + decide + print, send nothing
 *   node scripts/check-admin-health.mjs --test      # send one sample alert to the owner
 *
 * Required env vars: same as scripts/send-wpbl-game-start.mjs.
 * Prerequisite (run once): scripts/migrations/…_add_admin_alert_state.sql (npm run migrate).
 */

import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
import webpush from 'web-push'
import { healthAlerts } from '../shared/adminHealth.js'
import { buildAdminHealthAlert } from '../shared/notifications.js'

// ─── Setup ────────────────────────────────────────────────────────────────────

const SUPABASE_URL  = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY ?? process.env.VITE_VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:notifications@sportydolphin.fun'

// The one place the owner is named in code is public.is_site_owner() (scripts/add_user_admin.sql);
// this mirrors it. If the owner email ever changes, both move together.
const OWNER_EMAIL = 'snichols246@gmail.com'

// Re-page a STILL-broken pipeline this long after the last page, so a multi-day outage does not
// go silent after its first alert. Well under a day, so a break that starts overnight is on the
// phone by morning either way.
const REMINDER_MS = 12 * 60 * 60_000

const DRY_RUN = process.argv.includes('--dry-run')
const TEST    = process.argv.includes('--test')

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running')
  process.exit(1)
}
if (!DRY_RUN && (!VAPID_PUBLIC || !VAPID_PRIVATE)) {
  console.error('❌  Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (or pass --dry-run)')
  process.exit(1)
}
if (VAPID_PUBLIC && VAPID_PRIVATE) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws },
})

// ─── Push plumbing (same shape as send-wpbl-game-start.mjs) ─────────────────────

function toPushPayload(n) {
  return { id: n.id, type: n.type, title: n.title, body: n.body, url: n.url, emoji: n.icon, tag: n.id }
}

/** The owner's push subscriptions, resolved from the same email is_site_owner() uses. */
async function ownerSubscriptions() {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw new Error(`listUsers failed: ${error.message}`)
  const owner = data?.users?.find(u => (u.email ?? '').toLowerCase() === OWNER_EMAIL.toLowerCase())
  if (!owner) { console.warn(`⚠️  No account for owner ${OWNER_EMAIL} — nothing to notify.`); return [] }
  const { data: subs, error: subErr } = await supabase
    .from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', owner.id)
  if (subErr) throw new Error(`Loading owner subscriptions failed: ${subErr.message}`)
  return subs ?? []
}

async function sendToOwner(subs, payload) {
  let sent = 0
  const body = JSON.stringify(payload)
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body)
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

// ─── Reads ──────────────────────────────────────────────────────────────────────

async function latestRun(table, cols) {
  const { data, error } = await supabase.from(table).select(cols).order('ran_at', { ascending: false }).limit(1)
  if (error) { console.warn(`⚠️  Reading ${table} failed: ${error.message}`); return null }
  return data?.[0] ?? null
}

// The generic per-job heartbeats (drift checker today; the push and recap senders next). One row
// per job; shared/adminHealth.js decides which are stale or failed.
async function fetchHeartbeats() {
  const { data, error } = await supabase.from('cron_heartbeats').select('job, ran_at, ok, detail')
  if (error) { console.warn(`⚠️  Reading cron_heartbeats failed: ${error.message}`); return [] }
  return data ?? []
}

// ─── Test mode ────────────────────────────────────────────────────────────────

async function runTest() {
  const subs = await ownerSubscriptions()
  if (subs.length === 0) { console.log('No owner subscriptions found. Enable notifications in the app first.'); return }
  const sent = await sendToOwner(subs, toPushPayload(buildAdminHealthAlert({
    key: 'test', title: 'Health alert test', body: 'This is a test of the admin health alert. If you can read it, paging works.',
  })))
  console.log(`✅ Test health alert sent to ${sent}/${subs.length} device(s).`)
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (TEST) return runTest()

  const [ingest, validation, heartbeats] = await Promise.all([
    latestRun('wpbl_ingest_runs', 'ran_at, ok, error_count, errors'),
    latestRun('wpbl_pbp_validation_runs', 'ran_at, ok'),
    fetchHeartbeats(),
  ])

  const alerts = healthAlerts({ ingest, validation, heartbeats })

  // Prior dedupe state. If the table is missing (migration not applied) we alert WITHOUT
  // dedupe rather than going silent — a noisy alert is recoverable, a missed outage is the
  // whole failure this replaces — and say so loudly.
  const { data: stateRows, error: stateErr } = await supabase
    .from('admin_alert_state').select('key, signature, last_alerted')
  if (stateErr) console.warn(`⚠️  admin_alert_state unavailable (alerting without dedupe): ${stateErr.message}`)
  const priorByKey = new Map((stateRows ?? []).map(r => [r.key, r]))

  const activeKeys = new Set(alerts.map(a => a.key))

  // A problem that has cleared drops its row, so a recurrence pages fresh rather than being
  // swallowed as "same signature as last time".
  for (const key of priorByKey.keys()) {
    if (activeKeys.has(key)) continue
    console.log(`✅ Recovered: ${key}`)
    if (!DRY_RUN) await supabase.from('admin_alert_state').delete().eq('key', key)
  }

  if (alerts.length === 0) { console.log('✅ All pipelines healthy — nothing to page.'); return }

  const subs = DRY_RUN ? [] : await ownerSubscriptions()
  const now = Date.now()
  let paged = 0

  for (const a of alerts) {
    const prior = priorByKey.get(a.key)
    const changed = !prior || prior.signature !== a.signature
    const overdue = prior && now - Date.parse(prior.last_alerted) > REMINDER_MS
    if (!changed && !overdue) { console.log(`⏸️  Holding (already paged): ${a.key} — ${a.title}`); continue }

    if (DRY_RUN) { console.log(`🔔 Would page: ${a.title} — ${a.body}`); continue }

    const sent = await sendToOwner(subs, toPushPayload(buildAdminHealthAlert(a)))
    const iso = new Date().toISOString()
    const { error: upErr } = await supabase.from('admin_alert_state')
      .upsert({ key: a.key, signature: a.signature, last_alerted: iso, updated_at: iso })
    if (upErr) console.warn(`  ⚠️  Could not record alert state for ${a.key}: ${upErr.message}`)
    console.log(`🔔 Paged (${sent}/${subs.length}): ${a.title}`)
    paged++
  }

  console.log(DRY_RUN ? 'Dry run complete.' : `Done — ${paged} alert(s) pushed.`)
}

main().catch(err => { console.error('❌  check-admin-health failed:', err?.message ?? err); process.exit(1) })

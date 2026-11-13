#!/usr/bin/env node
/**
 * notify-photo-submissions.mjs: tell the owner a fan sent photos, and tell a fan the owner decided.
 *
 * WHY. Fan uploads (docs/FAN_UPLOADS.md) wait for the owner in /admin, and a queue nobody is told
 * about is a queue nobody opens; a fan who never hears back does not send a second batch. The
 * database wakes this job (20261113200000_photo_submission_notifications.sql) on every submission
 * and decision, and every ten minutes while anyone is still owed a notice.
 *
 * WHO HEARS WHAT.
 *   The owner: one push for the whole queue ("3 photos to review"), on one id, so each new one
 *   replaces the last on the lock screen.
 *   A fan: one push per run covering every decision since they were last told, so ten approvals in
 *   a row are one notice, not ten. Sent to every device they subscribed for any push: it answers
 *   something they did, so it has no preference of its own (shared/notifications.js).
 *   The bell shows both without this job (src/wpbl/notifications/photoSubmissions.ts).
 *
 * TOLD MEANS TRIED. A row is marked once a push was attempted, or when its reader has no device to
 * push to (the bell covers them). A run that could not push at all (no VAPID keys) marks nothing,
 * so the sweep tries again and the run goes red.
 *
 * Usage:
 *   npm run photo-notify               # send and mark
 *   npm run photo-notify -- --dry-run  # print who would hear what; send and mark nothing
 *
 * Credentials: SUPABASE_DB_URL; VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY.
 */
import pg from 'pg'
import webpush from 'web-push'
import { buildPhotosWaiting, buildPhotoDecided } from '../shared/notifications.js'

const OWNER_EMAIL = 'snichols246@gmail.com' // mirrors public.is_site_owner(), as check-admin-health does
const HEARTBEAT_JOB = 'wpbl-photo-submissions'
const DRY_RUN = process.argv.includes('--dry-run')

const DB_URL = process.env.SUPABASE_DB_URL ?? ''
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY ?? process.env.VITE_VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@sportydolphin.fun'
const CAN_PUSH = Boolean(VAPID_PUBLIC && VAPID_PRIVATE)
if (CAN_PUSH) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

if (!DB_URL) {
  console.error('❌  Set SUPABASE_DB_URL (the connection string npm run migrate uses).')
  process.exit(1)
}
const db = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })

/** Push one payload to these subscriptions; returns how many took it. Prunes expired ones. */
async function push(subs, n) {
  const body = JSON.stringify({ id: n.id, type: n.type, title: n.title, body: n.body, url: n.url, emoji: n.icon, tag: n.id })
  let sent = 0
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body)
      sent++
    } catch (err) {
      const code = err?.statusCode
      if (code === 404 || code === 410) {
        await db.query('delete from public.push_subscriptions where endpoint = $1', [s.endpoint])
        console.log(`  🧹 Pruned expired subscription (${code})`)
      } else {
        console.warn(`  ⚠️  Push failed (${code ?? 'no status'}): ${err?.body ?? err?.message ?? err}`)
      }
    }
  }
  return sent
}

async function recordHeartbeat(ok, detail) {
  try {
    await db.query(
      `insert into public.cron_heartbeats (job, ran_at, ok, detail, updated_at) values ($1, now(), $2, $3, now())
       on conflict (job) do update set ran_at = now(), ok = $2, detail = $3, updated_at = now()`,
      [HEARTBEAT_JOB, ok, detail],
    )
  } catch (err) {
    // A heartbeat that fails to record must not turn a clean run red (shared/heartbeat.js).
    console.error(`  heartbeat write failed (non-fatal): ${err.message}`)
  }
}

async function notifyOwner() {
  const { rows: fresh } = await db.query(
    `select id from public.wpbl_photo_submissions where status = 'pending' and owner_notified_at is null`)
  if (fresh.length === 0) return 'owner: nothing new'
  const { rows: [{ n }] } = await db.query(
    `select count(*)::int as n from public.wpbl_photo_submissions where status = 'pending'`)
  const payload = buildPhotosWaiting({ count: n })
  console.log(`📷 Owner: ${payload.title} (${fresh.length} new)`)
  if (DRY_RUN) return `owner: would push "${payload.title}"`

  const { rows: subs } = await db.query(
    `select s.endpoint, s.p256dh, s.auth from public.push_subscriptions s
       join auth.users u on u.id = s.user_id where lower(u.email) = lower($1)`, [OWNER_EMAIL])
  if (subs.length > 0 && !CAN_PUSH) throw new Error('no VAPID keys, so nothing was sent; marking nothing')
  const sent = subs.length > 0 ? await push(subs, payload) : 0
  await db.query(`update public.wpbl_photo_submissions set owner_notified_at = now() where id = any($1::uuid[])`,
    [fresh.map(r => r.id)])
  return `owner: ${fresh.length} new, pushed to ${sent} of ${subs.length} device(s)`
}

async function notifyFans() {
  // A week back at most: a notice about a decision older than that is noise, not news.
  const { rows } = await db.query(
    `select id, user_id, status, reject_reason from public.wpbl_photo_submissions
      where status in ('approved', 'rejected') and fan_notified_at is null
        and decided_at > now() - interval '7 days'
      order by decided_at`)
  if (rows.length === 0) return 'fans: nothing new'

  const byUser = new Map()
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r])
  let pushed = 0
  for (const [userId, list] of byUser) {
    const published = list.filter(r => r.status === 'approved').length
    const declined = list.length - published
    const payload = buildPhotoDecided({
      key: `batch:${list[list.length - 1].id}`, published, declined,
      reason: list.length === 1 ? list[0].reject_reason : null,
    })
    console.log(`📷 Fan ${userId.slice(0, 8)}…: ${payload.title}`)
    if (DRY_RUN) continue
    const { rows: subs } = await db.query(
      'select endpoint, p256dh, auth from public.push_subscriptions where user_id = $1', [userId])
    if (subs.length > 0 && !CAN_PUSH) throw new Error('no VAPID keys, so nothing was sent; marking nothing')
    if (subs.length > 0 && (await push(subs, payload)) > 0) pushed++
    await db.query(`update public.wpbl_photo_submissions set fan_notified_at = now() where id = any($1::uuid[])`,
      [list.map(r => r.id)])
  }
  return DRY_RUN ? `fans: would tell ${byUser.size}` : `fans: told ${byUser.size}, ${pushed} by push`
}

async function main() {
  await db.connect()
  try {
    const owner = await notifyOwner()
    const fans = await notifyFans()
    console.log(`${owner}; ${fans}`)
    if (!DRY_RUN) await recordHeartbeat(true, `${owner}; ${fans}`)
  } catch (err) {
    if (!DRY_RUN) await recordHeartbeat(false, String(err?.message ?? err).slice(0, 500))
    throw err
  } finally {
    await db.end()
  }
}

main().catch(err => {
  console.error(`❌  ${err?.message ?? err}`)
  process.exit(1)
})

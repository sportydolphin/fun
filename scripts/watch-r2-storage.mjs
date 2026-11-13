#!/usr/bin/env node
/**
 * watch-r2-storage.mjs: record how much R2 the site uses, and tell the owner before it costs money.
 *
 * WHY. R2 has a free tier (10 GB, a million writes and ten million reads a month) and no spending
 * cap, and fan uploads let strangers write to it. The Cloudflare dashboard shows usage, but only to
 * someone who goes and looks. This reads every bucket's size and the month's operations daily,
 * keeps one row per bucket per day for the /admin card, and pushes to the owner the first time in
 * a month the account crosses 80% of any free allowance. See docs/FAN_UPLOADS.md.
 *
 * WHY A JOB AND NOT A LIVE CALL FROM /admin. The analytics token would have to reach the browser,
 * and the bundle ships to everyone. The job holds it in a GitHub secret.
 *
 * Usage:
 *   npm run r2-storage                # read, record, alert
 *   npm run r2-storage -- --dry-run   # read and print; write and send nothing
 *
 * Credentials: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_ANALYTICS_TOKEN (Account Analytics Read only),
 * SUPABASE_DB_URL. For the push: VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY.
 */
import pg from 'pg'
import webpush from 'web-push'
import { accountUsage, alertKey, formatBytes, monthStart, sumOperations, R2_FREE_TIER } from '../shared/r2Usage.js'
import { buildAdminHealthAlert } from '../shared/notifications.js'

const OWNER_EMAIL = 'snichols246@gmail.com' // mirrors public.is_site_owner(), as check-admin-health does
const HEARTBEAT_JOB = 'r2-storage-watch'
const DRY_RUN = process.argv.includes('--dry-run')

const ACCOUNT = (process.env.CLOUDFLARE_ACCOUNT_ID ?? '').trim()
const TOKEN = (process.env.CLOUDFLARE_ANALYTICS_TOKEN ?? '').trim()
const DB_URL = process.env.SUPABASE_DB_URL ?? ''
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY ?? process.env.VITE_VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@sportydolphin.fun'
if (VAPID_PUBLIC && VAPID_PRIVATE) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

// Missing Cloudflare credentials end the run green with a warning, not red: until the owner adds
// the secrets (docs/FAN_UPLOADS.md, "The owner's setup") a daily red run would page through
// workflow-failure-alert.yml for something already known. The /admin card reads "No data" until then.
if (!ACCOUNT || !TOKEN) {
  console.log('::warning::CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_ANALYTICS_TOKEN is not set; nothing read.')
  process.exit(0)
}
if (!DB_URL && !DRY_RUN) {
  console.error('❌  Set SUPABASE_DB_URL (the connection string npm run migrate uses).')
  process.exit(1)
}

// ─── Reading ──────────────────────────────────────────────────────────────────

// Storage is a gauge: the latest sample per bucket in the last two days (R2 samples it a few
// times a day, so one day can be empty). Operations are a sum over the UTC month, R2's billing
// window. Both group by bucket, so a new bucket (the private submissions one) shows up unasked.
const QUERY = `
query R2Usage($account: string!, $storageStart: Time!, $monthStart: Time!, $now: Time!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      storage: r2StorageAdaptiveGroups(
        limit: 1000
        filter: { datetime_geq: $storageStart, datetime_leq: $now }
        orderBy: [datetime_DESC]
      ) {
        max { objectCount payloadSize metadataSize }
        dimensions { bucketName datetime }
      }
      operations: r2OperationsAdaptiveGroups(
        limit: 10000
        filter: { datetime_geq: $monthStart, datetime_leq: $now }
      ) {
        sum { requests }
        dimensions { bucketName actionType }
      }
    }
  }
}`

// Account-level operations (creating a bucket, setting its rules) come back with no bucket name.
// They still count against the free tier, so they keep a row of their own under a name that
// cannot be a real bucket (R2 names are lowercase letters, digits and hyphens).
const ACCOUNT_ROW = '(account)'
const bucketOf = name => name || ACCOUNT_ROW

async function readUsage(now) {
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        account: ACCOUNT,
        storageStart: new Date(now.getTime() - 2 * 24 * 60 * 60_000).toISOString(),
        monthStart: monthStart(now).toISOString(),
        now: now.toISOString(),
      },
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`Cloudflare GraphQL ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const json = await res.json()
  if (json.errors?.length) throw new Error(`Cloudflare GraphQL: ${json.errors.map(e => e.message).join('; ')}`)
  const acct = json.data?.viewer?.accounts?.[0]
  if (!acct) throw new Error('Cloudflare GraphQL returned no account: check CLOUDFLARE_ACCOUNT_ID and the token scope')

  // Newest first, so the first sample seen per bucket is the latest.
  const latest = new Map()
  for (const g of acct.storage ?? []) {
    const b = bucketOf(g.dimensions.bucketName)
    if (!latest.has(b)) latest.set(b, g.max)
  }
  const ops = sumOperations((acct.operations ?? []).map(g => ({
    bucket: bucketOf(g.dimensions.bucketName), action: g.dimensions.actionType, requests: g.sum.requests,
  })))

  const names = new Set([...latest.keys(), ...ops.keys()])
  return [...names].sort().map(bucket => {
    const s = latest.get(bucket)
    const o = ops.get(bucket) ?? { classA: 0, classB: 0 }
    return {
      bucket,
      object_count: s?.objectCount ?? 0,
      payload_bytes: s?.payloadSize ?? 0,
      metadata_bytes: s?.metadataSize ?? 0,
      class_a_month: o.classA,
      class_b_month: o.classB,
    }
  })
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

async function pushToOwner(db, n) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) { console.warn('  ⚠️  No VAPID keys, so no push.'); return 0 }
  const { rows: subs } = await db.query(
    `select s.endpoint, s.p256dh, s.auth from public.push_subscriptions s
       join auth.users u on u.id = s.user_id where lower(u.email) = lower($1)`, [OWNER_EMAIL])
  if (subs.length === 0) console.warn('  ⚠️  The owner has no push subscriptions.')
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

const LABEL = { storage: 'Storage', classA: 'Writes (Class A)', classB: 'Reads (Class B)' }
function describeAllowance(k, usage) {
  if (k === 'storage') return `${formatBytes(usage.storageBytes)} of ${formatBytes(R2_FREE_TIER.storageBytes)}`
  const used = k === 'classA' ? usage.classA : usage.classB
  return `${used.toLocaleString('en-US')} of ${R2_FREE_TIER[k].toLocaleString('en-US')} this month`
}

async function recordHeartbeat(db, ok, detail) {
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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const now = new Date()
  const buckets = await readUsage(now)
  const usage = accountUsage(buckets)
  for (const b of buckets) {
    console.log(`🪣 ${b.bucket}: ${b.object_count.toLocaleString('en-US')} objects, ${formatBytes(b.payload_bytes + b.metadata_bytes)}, ` +
      `${b.class_a_month.toLocaleString('en-US')} writes and ${b.class_b_month.toLocaleString('en-US')} reads this month`)
  }
  for (const k of /** @type {const} */ (['storage', 'classA', 'classB'])) {
    console.log(`   ${LABEL[k]}: ${describeAllowance(k, usage)} (${Math.round(usage.shares[k] * 100)}%)`)
  }
  if (DRY_RUN) { console.log('Dry run: nothing recorded, nothing sent.'); return }

  const db = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
  await db.connect()
  try {
    const day = now.toISOString().slice(0, 10)
    for (const b of buckets) {
      await db.query(
        `insert into public.r2_storage_snapshots
           (day, bucket, object_count, payload_bytes, metadata_bytes, class_a_month, class_b_month, recorded_at)
         values ($1, $2, $3, $4, $5, $6, $7, now())
         on conflict (day, bucket) do update set
           object_count = excluded.object_count, payload_bytes = excluded.payload_bytes,
           metadata_bytes = excluded.metadata_bytes, class_a_month = excluded.class_a_month,
           class_b_month = excluded.class_b_month, recorded_at = now()`,
        [day, b.bucket, b.object_count, b.payload_bytes, b.metadata_bytes, b.class_a_month, b.class_b_month],
      )
    }

    // Once per allowance per month. The alert row is written only after a push lands, so a run
    // that could not deliver tries again tomorrow rather than going quiet for the month.
    for (const k of usage.over) {
      const key = alertKey(k, now)
      const { rowCount } = await db.query('select 1 from public.r2_usage_alerts where key = $1', [key])
      if (rowCount > 0) continue
      const detail = `${describeAllowance(k, usage)} (${Math.round(usage.shares[k] * 100)}% of the free tier)`
      const sent = await pushToOwner(db, buildAdminHealthAlert({
        key: `r2:${key}`, title: `R2 ${LABEL[k].toLowerCase()} near the free tier`, body: detail,
      }))
      console.log(`📱 ${LABEL[k]}: pushed to ${sent} device(s)`)
      if (sent > 0) await db.query('insert into public.r2_usage_alerts (key, detail) values ($1, $2) on conflict do nothing', [key, detail])
    }
    await recordHeartbeat(db, true, `${buckets.length} bucket(s), ${formatBytes(usage.storageBytes)}`)
  } catch (err) {
    await recordHeartbeat(db, false, String(err?.message ?? err).slice(0, 500))
    throw err
  } finally {
    await db.end()
  }
}

main().catch(err => {
  console.error(`❌  ${err?.message ?? err}`)
  process.exit(1)
})

// R2 usage math for the storage monitor (scripts/watch-r2-storage.mjs) and the /admin card.
// Plain ESM so the cron job runs it without a build; types in r2Usage.d.ts. See
// docs/FAN_UPLOADS.md, "Storage and its monitor".

/**
 * R2's free tier, per account per month (Cloudflare's pricing page, read Nov 12, 2026). Storage is
 * billed on the month's average; the monitor compares the latest size, which is never lower than
 * the average while a library only grows, so it warns early rather than late.
 */
export const R2_FREE_TIER = {
  storageBytes: 10 * 1e9,
  classA: 1_000_000,
  classB: 10_000_000,
}

/** The share of a free allowance at which the owner is pushed, once per allowance per month. */
export const ALERT_AT = 0.8

// Cloudflare's operation classes. Class B is the short read list; delete and abort are free; every
// other action (puts, lists, multipart steps, bucket config writes) is Class A. Defaulting an
// unknown action to A is on purpose: a new action type should over-count writes, not vanish.
const CLASS_B = new Set([
  'HeadBucket', 'HeadObject', 'GetObject', 'UsageSummary',
  'GetBucketEncryption', 'GetBucketLocation', 'GetBucketCors', 'GetBucketLifecycleConfiguration',
])
const FREE = new Set(['DeleteObject', 'DeleteBucket', 'AbortMultipartUpload'])

/** @param {string} action */
export function operationClass(action) {
  if (FREE.has(action)) return 'free'
  return CLASS_B.has(action) ? 'B' : 'A'
}

/**
 * Sum operation rows (one per bucket and action, as the GraphQL groups come back) into per-bucket
 * Class A and Class B counts.
 * @param {Array<{ bucket: string, action: string, requests: number }>} rows
 */
export function sumOperations(rows) {
  /** @type {Map<string, { classA: number, classB: number }>} */
  const out = new Map()
  for (const r of rows) {
    const cls = operationClass(r.action)
    if (cls === 'free') continue
    const cur = out.get(r.bucket) ?? { classA: 0, classB: 0 }
    if (cls === 'A') cur.classA += r.requests
    else cur.classB += r.requests
    out.set(r.bucket, cur)
  }
  return out
}

/**
 * The account against the free tier: each allowance's used share, and the ones at or past ALERT_AT.
 * @param {Array<{ payload_bytes: number, metadata_bytes: number, class_a_month: number, class_b_month: number }>} buckets
 */
export function accountUsage(buckets) {
  const storageBytes = buckets.reduce((n, b) => n + b.payload_bytes + b.metadata_bytes, 0)
  const classA = buckets.reduce((n, b) => n + b.class_a_month, 0)
  const classB = buckets.reduce((n, b) => n + b.class_b_month, 0)
  const shares = {
    storage: storageBytes / R2_FREE_TIER.storageBytes,
    classA: classA / R2_FREE_TIER.classA,
    classB: classB / R2_FREE_TIER.classB,
  }
  const over = /** @type {Array<'storage' | 'classA' | 'classB'>} */ (
    Object.keys(shares).filter(k => shares[/** @type {'storage'} */ (k)] >= ALERT_AT))
  return { storageBytes, classA, classB, shares, over }
}

/**
 * The once-a-month key for one allowance's alert, e.g. 'storage:2026-11'.
 * @param {'storage' | 'classA' | 'classB'} allowance
 * @param {Date} now
 */
export function alertKey(allowance, now) {
  return `${allowance}:${now.toISOString().slice(0, 7)}`
}

/** The first instant of `now`'s UTC month, the window R2 bills operations on. @param {Date} now */
export function monthStart(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/** Bytes as the card and the push print them: "225 MB", "1.4 GB". @param {number} n */
export function formatBytes(n) {
  if (n < 1e3) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1e3, i = 0
  while (v >= 1e3 && i < units.length - 1) { v /= 1e3; i++ }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

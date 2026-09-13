// ─── Admin health alerting — which pipeline states are worth paging the owner ─────
//
// The /admin Health group answers "is anything broken" only for someone who has opened
// the page, and the one ingest break that ever reached production was invisible for two
// days precisely because it sat as an amber chip nobody was looking at. This module is the
// server-side half of the fix: scripts/check-admin-health.mjs runs on a schedule, reads the
// same tables, and calls `healthAlerts` to decide what, if anything, should push to the owner.
//
// Plain ESM .js on purpose, exactly like notifications.js: the Node cron imports it directly,
// and TS consumes it through the adminHealth.d.ts sidecar next door. Keep it pure — no
// supabase, no clock except the injected `nowMs` — so the thresholds can be unit-tested rather
// than eyeballed, which is the same reason AdminPanel's status functions are pure.
//
// WHAT PAGES AND WHAT DOES NOT is the whole judgement here, and it is deliberately narrower
// than the panel's four-colour chips. An alert the owner learns to ignore is worse than no
// alert, so this fires only on states that are both actionable and unexpected:
//
//   * INGEST is the every-two-minutes mirror, so it is the one whose failure is urgent. It
//     pages when a run failed outright, when a run logged per-game errors (the "unmapped team"
//     trap: ok:true with a non-empty errors array, the exact break this whole feature exists
//     for), or when it has gone quiet past a lenient staleness window.
//   * SCORING is nightly and its FINDINGS are expected and mostly known, so those never page;
//     only the job failing or going missing does.
//   * TRACKMAN is not paged at all. "Behind" is the league's normal state for weeks at a time
//     (see trackingStatus in AdminPanel), and a red row nobody can act on is exactly the
//     fatigue this avoids.
//   * PAYROLLS are a daily refresh of a slow-moving table; a stale day is not worth a push.
//
// `signature` is the dedupe key the sender compares against what it last alerted: it is stable
// while a problem persists (so a continuous outage pages once, not every run) but changes when
// the problem itself changes (a new kind of ingest error re-pages). The sender owns the
// "still broken N hours later" reminder; this module only says what is wrong right now.

/** Ingest is the ~2-minute mirror; 15 minutes is several missed runs, well past a single
 *  slipped tick, so a page here means the loop has actually stopped rather than hiccuped. It is
 *  deliberately more lenient than the panel's 6-minute amber, which is a glance-state, not a page. */
export const INGEST_STALE_MS = 15 * 60_000

/** Scoring runs nightly. 30h is a whole missed day plus margin for GitHub's best-effort cron,
 *  matching the spirit of AdminPanel's 26h amber but slower, because this one buzzes a phone. */
export const VALIDATION_STALE_MS = 30 * 60 * 60_000

/**
 * The rest of the fleet, monitored through the generic cron_heartbeats table rather than a
 * bespoke health table each. A job here writes a heartbeat at the end of every run; this pages
 * when a job that HAS been running fails or goes quiet past its own cadence.
 *
 * `maxAgeMs` is that cadence plus margin. Only jobs with a PREDICTABLE cadence belong here: a
 * staleness alarm on a job that only runs when there is a game to act on would false-fire every
 * quiet night, so those are added as failure-only (a null maxAgeMs) when their turn comes.
 *
 * A job with no heartbeat row at all is treated as never-run (idle), never as failed — absence
 * is not evidence of a stall, only staleness is, exactly as an empty ingest/validation table is.
 */
export const HEARTBEAT_CHECKS = [
  // The nightly drift checker: the only thing that catches the league revising a final after the
  // fact, so its silent death lets the scoreboard and the box score drift apart with nothing
  // saying so. Nightly, so 30h is a whole missed day plus margin.
  { job: 'wpbl-drift-check', label: 'Drift check', maxAgeMs: 30 * 60 * 60_000 },
]

/**
 * @typedef {Object} HealthAlert
 * @property {string} key        Stable id for the kind of problem (dedupe scope).
 * @property {string} signature  Changes only when the problem itself changes; the sender pages
 *                               on a new (key, signature) and holds otherwise.
 * @property {string} title      One-line push title.
 * @property {string} body       Push body, carrying the detail the owner would otherwise open
 *                               the SQL editor to read.
 */

/**
 * Decide what should page the owner, given the latest row from each health table.
 *
 * @param {{ ingest?: any, validation?: any }} rows  Latest wpbl_ingest_runs / wpbl_pbp_validation_runs.
 * @param {number} [nowMs]  Injected clock, so staleness is testable.
 * @returns {HealthAlert[]}  Empty when everything actionable is fine.
 */
export function healthAlerts(rows, nowMs = Date.now()) {
  /** @type {HealthAlert[]} */
  const out = []
  const ingest = rows?.ingest ?? null
  const validation = rows?.validation ?? null

  if (ingest) {
    if (!ingest.ok) {
      // A run that failed outright. Signature is stable across a run of failures so the streak
      // pages once; the sender's reminder cadence handles "still down".
      out.push({
        key: 'ingest-down',
        signature: 'down',
        title: 'WPBL ingest is failing',
        body: `The feed mirror's last run (${ingest.ran_at}) failed outright. The site is drifting from the official feed.`,
      })
    } else if ((ingest.error_count ?? 0) > 0) {
      // ok:true with per-game errors — the postseason "unmapped team" trap. The detail rides in
      // the signature so a NEW kind of error re-pages while the same recurring ones stay quiet.
      const detail = (ingest.errors ?? []).slice(0, 3).join('; ')
      out.push({
        key: 'ingest-errors',
        signature: `errors:${detail || ingest.error_count}`,
        title: `WPBL ingest: ${ingest.error_count} error(s)`,
        body: detail
          ? `Last run reported ok but logged: ${detail}${ingest.error_count > 3 ? ` (+${ingest.error_count - 3} more)` : ''}.`
          : `Last run reported ok but logged ${ingest.error_count} per-game error(s).`,
      })
    } else if (nowMs - Date.parse(ingest.ran_at) > INGEST_STALE_MS) {
      out.push({
        key: 'ingest-stale',
        signature: 'stale',
        title: 'WPBL ingest has stalled',
        body: `No feed-mirror run since ${ingest.ran_at}. The every-two-minutes cron may have stopped.`,
      })
    }
  }

  if (validation) {
    if (!validation.ok) {
      out.push({
        key: 'scoring-down',
        signature: 'down',
        title: 'WPBL scoring check failed',
        body: `The nightly play-by-play validation run (${validation.ran_at}) failed.`,
      })
    } else if (nowMs - Date.parse(validation.ran_at) > VALIDATION_STALE_MS) {
      out.push({
        key: 'scoring-stale',
        signature: 'stale',
        title: 'WPBL scoring check is missing',
        body: `No validation run since ${validation.ran_at}. The nightly job may have stopped.`,
      })
    }
    // Deliberately silent on new_findings: they are expected and mostly known, and paging on
    // them is how the owner learns to swipe this away. The panel shows them; a phone should not.
  }

  // The heartbeat-backed jobs. A configured job with no row yet has simply never run under this
  // mechanism (idle), so it is skipped rather than paged; only a failed run or one that has gone
  // stale past the job's own cadence pages.
  const beats = new Map((rows?.heartbeats ?? []).map(b => [b.job, b]))
  for (const check of HEARTBEAT_CHECKS) {
    const b = beats.get(check.job)
    if (!b) continue
    if (b.ok === false) {
      out.push({
        key: `${check.job}:failed`,
        signature: `failed:${b.detail ?? ''}`,
        title: `${check.label} failed`,
        body: b.detail ? `Last run failed: ${b.detail}` : `The ${check.label.toLowerCase()} job reported a failure.`,
      })
    } else if (check.maxAgeMs != null && nowMs - Date.parse(b.ran_at) > check.maxAgeMs) {
      out.push({
        key: `${check.job}:stale`,
        signature: 'stale',
        title: `${check.label} is missing`,
        body: `No ${check.label.toLowerCase()} run since ${b.ran_at}. The job may have stopped.`,
      })
    }
  }

  return out
}

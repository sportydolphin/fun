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
// WHAT PAGES AND WHAT DOES NOT is the whole judgment here, and it is deliberately narrower
// than the panel's four-color chips. An alert the owner learns to ignore is worse than no
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

/** Away from a game date the ingest runs four times a day, not every two minutes (see
 *  wpbl_ingest_due in the 20260923072614 migration), so a 15-minute window would page all winter.
 *  Six hours plus margin: a page here still means the floor itself has stopped. */
export const INGEST_STALE_OFFSEASON_MS = 7 * 60 * 60_000

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
  // The game-start push sender and the recap sync are FAILURE-ONLY (maxAgeMs null): both run on a
  // game-hours / window cadence, not daily, so a flat staleness alarm would false-fire every
  // quiet night. This catches a run that ran and errored; a hard crash (which writes no
  // heartbeat) is not caught here and waits on a future "a game started N hours ago but the
  // sender never beat for it" gate. The push sender is the more user-facing of the two — a silent
  // death there is missed game reminders.
  { job: 'wpbl-game-start', label: 'Game-start push', maxAgeMs: null },
  { job: 'wpbl-recaps-sync', label: 'Recap sync', maxAgeMs: null },
]

/** Heartbeat job names written for a failed GitHub Actions run: `workflow:<workflow name>`. */
export const WORKFLOW_JOB_PREFIX = 'workflow:'

/** How long a failed workflow run stays an alert. Shorter than the sender's 12h reminder, so a
 *  failure that does not recur pages exactly once. */
export const WORKFLOW_FAILURE_WINDOW_MS = 6 * 60 * 60_000

// ─── Game states: the failures a clean run cannot report ─────────────────────────
//
// Everything above watches the PIPELINE, and every one of the ingest's worst breaks so far
// passed it: the 50-row cap, the unmapped postseason clubs and the status that walked backwards
// all logged runs that looked healthy or close to it, while a game sat in the wrong state on the
// site. These look at the games themselves, so they need nothing from the ingest to fire.
//
// Each threshold is far past anything a healthy game reaches, because a false page here is a
// phone buzzing at midnight over a rain delay:
//   * NEVER STARTED: still `scheduled` three hours after first pitch. This is what the Aug 30
//     truncation and the Sep 9 unmapped clubs both looked like from the outside. A postponed,
//     suspended or delayed game says so in status_detail and is left alone.
//   * STUCK LIVE: still `live` five hours after first pitch. A seven-inning game runs well under
//     three. This is the status-gone-backwards shape: a live dot on a game nobody is playing.
//   * FINAL WITHOUT A BOX SCORE: stored final with no batting lines an hour after first pitch.
//     The scoreboard reads right and Game Center is empty under it.

export const NEVER_STARTED_MS = 3 * 60 * 60_000
export const STUCK_LIVE_MS = 5 * 60 * 60_000
export const FINAL_NO_BOX_MS = 60 * 60_000

/** The feed's own words for a game that is late on purpose. */
const EXCUSED = /postpon|cancel|suspend|delay|ppd|tba|rain/i

/** ms to add to a UTC instant to read the given zone's wall clock. */
function zoneOffsetMs(ms, timeZone) {
  const d = new Date(ms)
  return new Date(d.toLocaleString('en-US', { timeZone })).getTime()
    - new Date(d.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
}

/**
 * First pitch as a UTC instant, from the stored Central date and wall clock ("6:30 PM"). A game
 * with no time counts from the end of its day, so it can only page late, never early.
 */
export function centralStartMs(gameDate, startTime) {
  const [y, mo, d] = String(gameDate).split('-').map(Number)
  const m = /^(\d{1,2}):(\d{2})\s*([AP])M$/i.exec(String(startTime ?? '').trim())
  const h = m ? (Number(m[1]) % 12) + (m[3].toUpperCase() === 'P' ? 12 : 0) : 23
  const min = m ? Number(m[2]) : 59
  const naive = Date.UTC(y, mo - 1, d, h, min)
  return naive - zoneOffsetMs(naive, 'America/Chicago')
}

const describeGame = g => `${g.away_team_id} at ${g.home_team_id} ${g.game_date}`

/**
 * @param {Array<{ id: string, game_date: string, start_time?: string | null, status: string,
 *   status_detail?: string | null, home_team_id: string, away_team_id: string,
 *   has_lines?: boolean }>} games  Recent wpbl_games rows; `has_lines` is whether any batting
 *   line exists, and is only read on a final.
 * @param {number} nowMs
 * @returns {HealthAlert[]}
 */
export function gameAlerts(games, nowMs) {
  const neverStarted = [], stuckLive = [], noBox = []
  for (const g of games ?? []) {
    const since = nowMs - centralStartMs(g.game_date, g.start_time)
    if (g.status === 'scheduled' && since > NEVER_STARTED_MS && !EXCUSED.test(g.status_detail ?? '')) neverStarted.push(g)
    else if (g.status === 'live' && since > STUCK_LIVE_MS) stuckLive.push(g)
    else if (g.status === 'final' && g.has_lines === false && since > FINAL_NO_BOX_MS) noBox.push(g)
  }
  // The game ids are the signature, so a second game going wrong re-pages and the same one does
  // not page every fifteen minutes.
  const alert = (key, list, title, what) => list.length ? [{
    key,
    signature: list.map(g => g.id).sort().join(','),
    title: `${title}${list.length > 1 ? ` (${list.length})` : ''}`,
    body: `${list.map(describeGame).join('; ')} ${what}`,
  }] : []
  return [
    ...alert('game-never-started', neverStarted, 'WPBL game never started',
      'is still scheduled hours after first pitch. The feed may be hiding it from the ingest.'),
    ...alert('game-stuck-live', stuckLive, 'WPBL game stuck live',
      'still reads live hours after first pitch. The feed may have walked its status back.'),
    ...alert('game-final-no-box', noBox, 'WPBL final has no box score',
      'is final with no batting lines. Game Center is empty under the score.'),
  ]
}

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
 * @param {{ ingest?: any, validation?: any, nearGame?: boolean }} rows  Latest wpbl_ingest_runs /
 *   wpbl_pbp_validation_runs. `nearGame: false` relaxes the ingest staleness window to the
 *   off-season cadence; anything else, including absent, keeps the strict one, so a caller that
 *   forgets to say fails toward paging rather than toward silence.
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
      // A failed run. Since Oct 2026 that includes a pass that finished with per-game errors or a
      // feed contract break (wpbl-ingest now sets ok:false on any), so the page carries the
      // first errors: "failing" alone would send the owner to the SQL editor to learn which.
      // The detail is the signature, as below: a streak of the same failure pages once, and the
      // sender's reminder cadence handles "still down", while a new kind of failure re-pages.
      const detail = (ingest.errors ?? []).slice(0, 3).join('; ')
      const more = (ingest.error_count ?? 0) > 3 ? ` (+${ingest.error_count - 3} more)` : ''
      out.push({
        key: 'ingest-down',
        signature: `down:${detail}`,
        title: 'WPBL ingest is failing',
        body: detail
          ? `The feed mirror's last run (${ingest.ran_at}) failed: ${detail}${more}.`
          : `The feed mirror's last run (${ingest.ran_at}) failed outright. The site is drifting from the official feed.`,
      })
    } else if ((ingest.error_count ?? 0) > 0) {
      // ok:true with per-game errors: the postseason "unmapped team" trap, from an ingest older
      // than the one that fails on them. Kept so a stale deploy still pages. The detail rides in
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
    } else if (nowMs - Date.parse(ingest.ran_at) > (rows?.nearGame === false ? INGEST_STALE_OFFSEASON_MS : INGEST_STALE_MS)) {
      out.push({
        key: 'ingest-stale',
        signature: 'stale',
        title: 'WPBL ingest has stalled',
        body: `No feed-mirror run since ${ingest.ran_at}. The ingest cron may have stopped.`,
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

  // Any scheduled workflow that went red, recorded by .github/workflows/workflow-failure-alert.yml
  // as a `workflow:<name>` heartbeat. Only failures are ever written (a success would cost an
  // extra Actions run per tick of every cron), so nothing clears the row: the alert lives for
  // WORKFLOW_FAILURE_WINDOW_MS after the LAST failure instead. A job that keeps failing keeps
  // refreshing ran_at and stays active, which is what lets the sender's 12h reminder fire; a
  // one-off failure ages out and its dedupe row is dropped, so the next one pages fresh.
  // The signature is deliberately constant: detail is the run URL, which differs every run, and
  // a job on a five-minute cron would otherwise page every five minutes.
  for (const b of rows?.heartbeats ?? []) {
    if (!b.job.startsWith(WORKFLOW_JOB_PREFIX) || b.ok !== false) continue
    if (nowMs - Date.parse(b.ran_at) > WORKFLOW_FAILURE_WINDOW_MS) continue
    const name = b.job.slice(WORKFLOW_JOB_PREFIX.length)
    out.push({
      key: b.job,
      signature: 'failed',
      title: `${name} failed`,
      body: `The scheduled run at ${b.ran_at} failed.${b.detail ? ` ${b.detail}` : ''}`,
    })
  }

  out.push(...gameAlerts(rows?.games, nowMs))

  return out
}

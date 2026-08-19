#!/usr/bin/env node
/**
 * watch-wpbl-tracking.mjs: tell us when the league starts publishing TrackMan data again.
 *
 * WHY. Home used to carry a "Ballpark tracking" teaser that hid itself once the league's
 * radar publishing fell more than three days behind the schedule. Publishing stopped after
 * the first couple of games, so the card rendered never. A card that hides itself is not a
 * monitor: the only thing watching for the feed's return was a component that had already
 * disappeared. The card is gone and this job is what replaced it.
 *
 * WHAT COUNTS AS NEWS. The newest game date carrying any tracking moved forward, or the
 * number of tracked games grew (a backfill that fills in older games without extending the
 * front edge is still the feed waking up). Both are compared against wpbl_tracking_watch,
 * which is the whole reason that table exists: without a watermark this either shouts every
 * night for as long as the data is current, or shouts once and stays quiet through the next
 * batch.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not touch the visitor-facing cue.
 * `NewTrackingBanner` in Home.tsx still tells a reader when the tracked set has grown since
 * their browser last saw it. That is per-browser localStorage and only fires if somebody
 * visits; this fires whether or not anyone is looking. They answer different questions and
 * neither replaces the other.
 *
 * FIRST RUN SEEDS SILENTLY. With no state row there is no "before", so every tracked game
 * ever would read as new. It records what it sees and says nothing, the same courtesy the
 * Home banner extends to a first-time visitor.
 *
 * Usage:
 *   npm run tracking-watch                 # check, alert if the feed moved, record
 *   npm run tracking-watch -- --dry-run    # check and report, write nothing, send nothing
 *   npm run tracking-watch -- --status     # just print what the last run recorded
 *   npm run tracking-watch -- --reseed     # accept the current state as the baseline, silently
 *
 * Credentials: SUPABASE_DB_URL, the same connection string `npm run migrate` uses. This talks
 * to Postgres directly rather than through PostgREST, because it is three queries and one row
 * of owner-only bookkeeping, and a laptop that can run migrations can then run this too
 * without a service-role key sitting in .env.
 * Optional: DISCORD_ALERTS_WEBHOOK_URL (where the alert goes), DISCORD_TRACKING_MENTION.
 */

import pg from 'pg'
import { pathToFileURL } from 'node:url'

const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')
const STATUS = args.has('--status')
const RESEED = args.has('--reseed')

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const SUPABASE_DB_URL = (process.env.SUPABASE_DB_URL ?? '').trim()

// Where the alert goes. Its own webhook on purpose: this is an operations alert about our
// own mirror, addressed to whoever runs the site, and it has no business in a fan channel
// next to highlight reels.
const WEBHOOK = (process.env.DISCORD_ALERTS_WEBHOOK_URL ?? '').trim()
const MENTION = (process.env.DISCORD_TRACKING_MENTION ?? '').trim()

const TRACKING_URL = 'https://sportydolphin.fun/wpbl'

// ─── Reading the state of play ──────────────────────────────────────────────

/**
 * How far tracking has got, and how far the schedule has got.
 *
 * One round trip, because the two numbers are only meaningful together: "tracking reaches
 * Aug 2" says nothing until you know whether the last final was Aug 3 or Sep 6.
 */
const SNAPSHOT_SQL = `
  select
    (select max(g.game_date)
       from public.wpbl_pitch_tracking t
       join public.wpbl_games g on g.id = t.game_id)                        as tracked_through,
    (select count(distinct t.game_id) from public.wpbl_pitch_tracking t)    as tracked_games,
    (select max(game_date) from public.wpbl_games where status = 'final')   as final_through
`

/** ISO date (or null) from whatever the driver hands back for a `date` column. */
function isoDate(v) {
  if (!v) return null
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)
}

const dayjsIsh = (a, b) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000)

// ─── The message ────────────────────────────────────────────────────────────

/**
 * What the alert says. Pure, so the interesting part is testable without a database.
 *
 * Exported for the same reason the restock watcher exports its diff: the judgement about what
 * counts as news is the part worth pinning down, and it should not need a webhook to check.
 */
export function describeChange(before, now) {
  const advanced = now.trackedThrough && (!before.trackedThrough || now.trackedThrough > before.trackedThrough)
  const grew = now.trackedGames > before.trackedGames
  if (!advanced && !grew) return null

  const added = now.trackedGames - before.trackedGames
  const lines = []
  lines.push('**WPBL TrackMan data has landed.**')
  if (added > 0) {
    // Both halves have to agree on number, which the obvious one-sided `game${s}` gets wrong
    // for the single-game case that is also the most likely one.
    lines.push(added === 1
      ? `1 more game now carries pitch tracking (${before.trackedGames} to ${now.trackedGames}).`
      : `${added} more games now carry pitch tracking (${before.trackedGames} to ${now.trackedGames}).`)
  } else {
    lines.push(`Still ${now.trackedGames} tracked game${now.trackedGames === 1 ? '' : 's'}, but the data now reaches a later game.`)
  }
  if (advanced) {
    lines.push(before.trackedThrough
      ? `Tracking now reaches ${now.trackedThrough}, up from ${before.trackedThrough}.`
      : `Tracking now reaches ${now.trackedThrough}.`)
  }
  // The lag is the thing that decides whether this is worth acting on: a feed that woke up
  // and is still three weeks behind is a different situation from one that has caught up.
  if (now.trackedThrough && now.finalThrough) {
    const lag = dayjsIsh(now.finalThrough, now.trackedThrough)
    lines.push(lag <= 0
      ? 'That is level with the last final, so the feed is current.'
      : `The last final was ${now.finalThrough}, so it is still ${lag} day${lag === 1 ? '' : 's'} behind.`)
  }
  lines.push(`<${TRACKING_URL}>`)
  return lines.join('\n')
}

async function post(content) {
  if (!WEBHOOK) {
    console.log('   DISCORD_ALERTS_WEBHOOK_URL is not set, so there is nowhere to announce this.')
    console.log('   The watermark is still recorded, and /admin shows the state either way.')
    return false
  }
  const body = { content: MENTION ? `${MENTION}\n${content}` : content }
  const res = await fetch(WEBHOOK, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  if (res.status === 429) {
    // Discord hands back how long to wait. One retry is plenty for a job that runs daily.
    const wait = Number((await res.json().catch(() => ({}))).retry_after ?? 2)
    console.warn(`   rate limited, retrying in ${wait}s`)
    await new Promise(r => setTimeout(r, wait * 1000))
    return post(content)
  }
  if (!res.ok) throw new Error(`Discord ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return true
}

// ─── Main ───────────────────────────────────────────────────────────────────

function makeClient() {
  if (SUPABASE_DB_URL) {
    const isLocal = /@(localhost|127\.0\.0\.1)/.test(SUPABASE_DB_URL)
    return new pg.Client({ connectionString: SUPABASE_DB_URL, ssl: isLocal ? false : { rejectUnauthorized: false } })
  }
  // The PostgREST path would need a second code path for three trivial queries, so instead
  // the service-role credentials are refused outright with the fix spelled out. This job is
  // owner-run bookkeeping, not something the browser or an edge function ever calls.
  throw new Error(
    'SUPABASE_DB_URL is not set. This job talks to Postgres directly (three queries, one row of state).\n' +
    'Add the same connection string `npm run migrate` uses to .env, or to the repo secrets for CI.' +
    (SUPABASE_URL && SERVICE_KEY ? '\nA service-role key alone is not enough here.' : ''))
}

async function main() {
  const client = makeClient()
  await client.connect()
  try {
    const { rows: [snap] } = await client.query(SNAPSHOT_SQL)
    const now = {
      trackedThrough: isoDate(snap.tracked_through),
      trackedGames: Number(snap.tracked_games ?? 0),
      finalThrough: isoDate(snap.final_through),
    }

    const { rows: [state] } = await client.query('select * from public.wpbl_tracking_watch where id')

    if (STATUS) {
      console.log('Now      :', JSON.stringify(now))
      console.log('Recorded :', state
        ? JSON.stringify({
            trackedThrough: isoDate(state.last_tracked_game_date),
            trackedGames: state.tracked_game_count,
            lastChecked: state.last_checked_at, lastAdvanced: state.last_advanced_at,
            lastNotified: state.last_notified_at,
          })
        : '(no state row yet; the next real run seeds it)')
      return
    }

    const before = state
      ? { trackedThrough: isoDate(state.last_tracked_game_date), trackedGames: state.tracked_game_count ?? 0 }
      : null

    // Seeding: no "before" means everything looks new, which is not news, it is a first look.
    const seeding = before == null || RESEED
    const change = seeding ? null : describeChange(before, now)

    console.log(`Tracking reaches ${now.trackedThrough ?? '(nothing tracked)'} across ${now.trackedGames} game(s); last final ${now.finalThrough ?? '(none)'}.`)
    if (seeding) {
      console.log(RESEED ? 'Reseeding: recording this as the baseline, saying nothing.'
                         : 'First run: recording this as the baseline, saying nothing.')
    } else if (change) {
      console.log('\n' + change + '\n')
    } else {
      console.log('No change since the last check.')
    }

    if (DRY_RUN) { console.log('(dry run, nothing written or sent)'); return }

    let notified = false
    if (change) notified = await post(change)

    // `last_advanced_at` moves only when the watermark did, so a long quiet stretch is
    // visible as a stale advance beside a fresh check rather than as no data at all.
    await client.query(
      `insert into public.wpbl_tracking_watch
         (id, last_tracked_game_date, tracked_game_count, last_final_game_date,
          last_checked_at, last_advanced_at, last_notified_at, updated_at)
       values (true, $1, $2, $3, now(), case when $4 then now() else null end,
               case when $5 then now() else null end, now())
       on conflict (id) do update set
         last_tracked_game_date = excluded.last_tracked_game_date,
         tracked_game_count     = excluded.tracked_game_count,
         last_final_game_date   = excluded.last_final_game_date,
         last_checked_at        = excluded.last_checked_at,
         last_advanced_at       = coalesce(excluded.last_advanced_at, public.wpbl_tracking_watch.last_advanced_at),
         last_notified_at       = coalesce(excluded.last_notified_at, public.wpbl_tracking_watch.last_notified_at),
         updated_at             = now()`,
      [now.trackedThrough, now.trackedGames, now.finalThrough, !!change, notified])

    console.log(change ? (notified ? '✅  Alert sent and watermark recorded.' : '✅  Watermark recorded (no webhook configured).')
                       : '✅  Checked, nothing to report.')
  } finally {
    await client.end()
  }
}

// Run only when invoked directly. Imported (by the tests, which exercise describeChange
// without a database or a webhook) this file must define and not do. `pathToFileURL` rather
// than string surgery on argv[1], which is what the sibling watcher does and the only version
// that gets Windows drive letters right.
if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error('❌ ', err.message); process.exit(1) })
}

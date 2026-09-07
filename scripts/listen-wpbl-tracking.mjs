#!/usr/bin/env node
/**
 * listen-wpbl-tracking.mjs — hold the league's live socket open and catch TrackMan if it returns.
 *
 * WHY A SOCKET, WHEN EVERYTHING ELSE HERE POLLS. The REST route that carried tracking,
 * `/v1/games/{id}/activity`, has answered `401 missing api key` since Sep 1, 2026, and the
 * boxscore no longer carries `tracking_activity` at all: the key is absent from the payload,
 * not empty, on every game including the two we already hold 766 rows for. Retested Sep 7 with
 * `?include=`, `?tracking=1`, `?expand=` and `?with=`, all byte-identical. There is no REST path
 * left.
 *
 * The league's OWN site has one. `wpbl-draft-picks/assets/js/live-stats.js` opens
 * `wss://stats.womensprobaseballleague.com/v1/ws?channel=boxscore:<gameId>` with no key, no
 * token and no origin check that a Node client trips, and its handler switches on three envelope
 * types: `boxscore_snapshot`, `boxscore_updated`, and **`tracking_activity_updated`**. So the
 * tracking path is still wired on their server and is not gated on the socket. It simply has
 * nothing to push while the provider is silent, which it has been since Aug 3.
 *
 * WHAT THIS IS FOR, precisely: the postseason, which starts Sep 9, 2026. If TrackMan runs for
 * it, this is the only way the data reaches us, and it reaches us live or not at all. If nothing
 * arrives, the run says so in as many words, which is a definitive answer rather than a guess.
 *
 * IT WRITES TRACKING AND NOTHING ELSE. `wpbl-ingest` owns box scores, lines and plays, and two
 * writers on one row is how they come to disagree. Snapshots are read only for the day the
 * league restores `tracking_activity` to them, in which case those rows are harvested too.
 *
 * Usage:
 *   node --env-file=.env scripts/listen-wpbl-tracking.mjs
 *   node --env-file=.env scripts/listen-wpbl-tracking.mjs --dry-run   # connect, report, write nothing
 *   MAX_MINUTES=300 node --env-file=.env scripts/listen-wpbl-tracking.mjs
 *
 * Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (CI), or SUPABASE_DB_URL (local), the same pair
 * of options sync-wpbl-site-calendar.mjs offers. Both are the service-role actor.
 */

import { createClient } from '@supabase/supabase-js'

const DRY_RUN = process.argv.includes('--dry-run')
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const DB_URL = process.env.SUPABASE_DB_URL ?? ''

const FEED = 'https://stats.womensprobaseballleague.com/v1'
const WS_BASE = 'wss://stats.womensprobaseballleague.com/v1'

/** How long to hold the sockets open. The workflow gives the job a little more than this. */
const MAX_MINUTES = Number(process.env.MAX_MINUTES ?? 240)
/**
 * How early to start watching, and how long after a first pitch a game is still worth watching.
 *
 * Generous in both directions on purpose: this costs one idle socket, and the failure it exists
 * to avoid is being connected five minutes after the only tracking of the season went past.
 * Overridable so a run can be pointed at a game that has already finished, which is the only
 * way to exercise the socket on a dark day.
 */
const START_LEAD_MIN = Number(process.env.WATCH_LEAD_MIN ?? 90)
const START_TRAIL_MIN = Number(process.env.WATCH_TRAIL_MIN ?? 300)

/** Nothing to do at all: no game today within the window. */
const NOTHING_TO_WATCH = 'no game inside the watch window'

if (!DRY_RUN && !(SUPABASE_URL && SUPABASE_KEY) && !DB_URL) {
  console.error('Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_DB_URL, before running')
  process.exit(1)
}
if (typeof WebSocket === 'undefined') {
  console.error('No global WebSocket: this needs Node 22 or newer')
  process.exit(1)
}

// ─── Which games to watch ─────────────────────────────────────────────────────

/**
 * The games worth holding a socket open for, from the feed's own list.
 *
 * THE FEED'S ID SPACE, NOT OURS, because the channel name is `boxscore:<feed game id>`. Which
 * also means a postseason game the feed has not published yet cannot be watched at all: there is
 * no id to subscribe to. That is the one hole in this and it closes itself, since the feed
 * publishes a game row well before first pitch.
 *
 * `?limit=` IS NOT OPTIONAL. `GET /v1/games` caps at 50 and says nothing about it (CLAUDE.md),
 * and a truncated list here would silently drop the game we came for.
 */
async function gamesToWatch() {
  const res = await fetch(`${FEED}/games?limit=500`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`games list failed: ${res.status}`)
  const body = await res.json()
  const all = body.games ?? []
  if (body.count != null && all.length < body.count) {
    throw new Error(`games list came back short: ${all.length} of ${body.count}`)
  }

  const now = Date.now()
  const candidates = all.filter(g => {
    const start = Date.parse(g.scheduled_start ?? '')
    if (!Number.isFinite(start)) return false
    const mins = (now - start) / 60000
    const inWindow = mins > -START_LEAD_MIN && mins < START_TRAIL_MIN
    const live = /progress|in progress|live/i.test(g.status ?? '')
    return inWindow || live
  })

  // THE TIMEZONE TWINS. The feed publishes most fixtures twice, an hour apart and under
  // different game ids, and one of the pair never leaves "Not Started" (see `bestTwin` in the
  // ingest, which deletes the loser). Both would connect here, and the phantom is the one that
  // will never carry a pitch. Keep the copy that has actually been played, or the later start
  // when neither has: a wrong guess costs an idle socket, not a row.
  const best = new Map()
  for (const g of candidates) {
    const key = `${g.away_team_id}|${g.home_team_id}|${(g.scheduled_start ?? '').slice(0, 10)}`
    const rival = best.get(key)
    if (!rival) { best.set(key, g); continue }
    const played = (x) => (/not started/i.test(x.status ?? '') ? 0 : 1)
    const better = played(g) !== played(rival)
      ? (played(g) > played(rival) ? g : rival)
      : (Date.parse(g.scheduled_start) > Date.parse(rival.scheduled_start) ? g : rival)
    best.set(key, better)
  }
  return [...best.values()]
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const s = (v) => (v == null ? '' : String(v))
const num = (v) => (v == null || v === '' ? null : Number(v))

/** One activity event as a `wpbl_pitch_tracking` row. Mirrors the ingest's mapping exactly:
 *  the same columns, the same coercions, the same `raw`, so rows from the two paths are
 *  indistinguishable and `onConflict: activity_id` makes them idempotent. */
const toRow = (t, gameUuid) => ({
  activity_id: s(t.activity_id), game_id: gameUuid, play_id: s(t.play_id) || null,
  session_id: s(t.session_id) || null, kind: s(t.kind) || null, event_type: s(t.event_type) || null,
  sequence: t.sequence != null ? num(t.sequence) : null, occurred_at: t.occurred_at || null,
  release_speed: t.release_speed ?? null, speed_unit: s(t.speed_unit) || null,
  spin_rate_rpm: t.spin_rate_rpm ?? null, extension: t.extension ?? null,
  vertical_break: t.vertical_break ?? null, horizontal_break: t.horizontal_break ?? null,
  plate_location_height: t.plate_location_height ?? null, raw: t,
})

const COLUMNS = [
  'activity_id', 'game_id', 'play_id', 'session_id', 'kind', 'event_type', 'sequence',
  'occurred_at', 'release_speed', 'speed_unit', 'spin_rate_rpm', 'extension',
  'vertical_break', 'horizontal_break', 'plate_location_height', 'raw',
]

function makeStore() {
  const supabase = SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
    : null
  let pgClient = null

  return {
    /** Our game uuid for a feed game id, or null when the ingest has not seen it yet. */
    async gameUuid(apiGameId) {
      if (supabase) {
        const { data } = await supabase.from('wpbl_games').select('id').eq('api_game_id', apiGameId).maybeSingle()
        return data?.id ?? null
      }
      const c = await this.pg()
      const r = await c.query('select id from public.wpbl_games where api_game_id = $1 limit 1', [apiGameId])
      return r.rows[0]?.id ?? null
    },
    async pg() {
      if (!pgClient) {
        const { default: pg } = await import('pg')
        pgClient = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
        await pgClient.connect()
      }
      return pgClient
    },
    async upsert(rows) {
      if (!rows.length) return
      if (supabase) {
        const { error } = await supabase.from('wpbl_pitch_tracking').upsert(rows, { onConflict: 'activity_id' })
        if (error) throw new Error(`upsert failed: ${error.message}`)
        return
      }
      const c = await this.pg()
      const set = COLUMNS.filter(k => k !== 'activity_id').map(k => `${k} = excluded.${k}`).join(', ')
      for (const row of rows) {
        await c.query(
          `insert into public.wpbl_pitch_tracking (${COLUMNS.join(', ')})
           values (${COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})
           on conflict (activity_id) do update set ${set}`,
          COLUMNS.map(k => (k === 'raw' ? JSON.stringify(row[k]) : row[k] ?? null)),
        )
      }
    },
    async close() { if (pgClient) await pgClient.end() },
  }
}

// ─── One game's socket ────────────────────────────────────────────────────────

/**
 * Hold one channel open until the deadline, writing any tracking that arrives.
 *
 * RECONNECTS, because a socket held for four hours will be dropped at least once and the whole
 * point is to be connected at the moment something is published. Backs off to 30s so a server
 * that is refusing connections is not hammered for the length of a game.
 */
function watchGame({ game, gameUuid, store, deadline, tally }) {
  const label = `${game.away_team_name} @ ${game.home_team_name}`
  return new Promise((resolve) => {
    let socket = null
    let attempt = 0
    let closed = false

    const stop = (why) => {
      if (closed) return
      closed = true
      try { socket?.close() } catch { /* already gone */ }
      console.log(`[${label}] stopped: ${why}`)
      resolve()
    }

    const harvest = async (items, source) => {
      const rows = (items ?? []).filter(t => t?.activity_id).map(t => toRow(t, gameUuid))
      if (!rows.length) return
      tally.tracking += rows.length
      tally.kinds[source] = (tally.kinds[source] ?? 0) + rows.length
      for (const r of rows) if (r.kind) tally.byKind[r.kind] = (tally.byKind[r.kind] ?? 0) + 1
      console.log(`[${label}] ${rows.length} tracking row(s) from ${source}`)
      if (DRY_RUN) {
        console.log(`[${label}] dry run, sample: ${JSON.stringify(rows[0].raw).slice(0, 300)}`)
        return
      }
      try { await store.upsert(rows) } catch (e) { console.error(`[${label}] write failed: ${e.message}`) }
    }

    const connect = () => {
      if (closed || Date.now() > deadline) return stop('deadline')
      socket = new WebSocket(`${WS_BASE}/ws?channel=${encodeURIComponent('boxscore:' + game.game_id)}`)

      socket.addEventListener('open', () => {
        attempt = 0
        console.log(`[${label}] connected`)
      })

      socket.addEventListener('message', async (ev) => {
        let envelope
        try { envelope = JSON.parse(String(ev.data)) } catch { return }
        const type = envelope?.type
        if (!type) return
        tally.envelopes[type] = (tally.envelopes[type] ?? 0) + 1

        if (type === 'tracking_activity_updated') {
          // The shape their own client expects: one activity object on `new_value`. An array is
          // accepted too rather than assumed against, since a batch would be the obvious way for
          // them to send a backlog on reconnect.
          const v = envelope.data?.new_value
          await harvest(Array.isArray(v) ? v : [v], 'socket')
          return
        }
        // Read only, and only for the day they put tracking back in the payload. Box scores are
        // the ingest's to write.
        if (type === 'boxscore_snapshot' || type === 'boxscore_updated') {
          const box = envelope.data?.boxscore ?? envelope.data?.new_value
          if (box?.tracking_activity?.length) await harvest(box.tracking_activity, 'boxscore payload')
        }
      })

      socket.addEventListener('close', () => {
        if (closed) return
        if (Date.now() > deadline) return stop('deadline')
        const wait = Math.min(30000, 1000 * 2 ** attempt++)
        setTimeout(connect, wait)
      })

      socket.addEventListener('error', () => { /* close follows, and handles the retry */ })
    }

    connect()
    setTimeout(() => stop('deadline'), Math.max(0, deadline - Date.now()))
  })
}

// ─── Run ──────────────────────────────────────────────────────────────────────

async function main() {
  const games = await gamesToWatch()
  if (!games.length) {
    console.log(NOTHING_TO_WATCH)
    return
  }

  const store = makeStore()
  const deadline = Date.now() + MAX_MINUTES * 60000
  const tally = { envelopes: {}, tracking: 0, kinds: {}, byKind: {} }

  console.log(`Watching ${games.length} game(s) for up to ${MAX_MINUTES} minutes:`)
  const watches = []
  for (const game of games) {
    const gameUuid = DRY_RUN ? null : await store.gameUuid(game.game_id)
    if (!DRY_RUN && !gameUuid) {
      // Nothing to attach the rows to. The ingest runs every two minutes and will have the row
      // shortly, so this is a real state on a game published minutes ago rather than an error.
      console.log(`  ${game.away_team_name} @ ${game.home_team_name}: not in wpbl_games yet, skipping`)
      continue
    }
    console.log(`  ${game.away_team_name} @ ${game.home_team_name} (${game.status}) ${game.scheduled_start}`)
    watches.push(watchGame({ game, gameUuid, store, deadline, tally }))
  }
  if (!watches.length) { console.log(NOTHING_TO_WATCH); return }

  await Promise.all(watches)
  await store.close()

  console.log('\n' + '='.repeat(60))
  console.log('envelopes seen:', Object.entries(tally.envelopes).map(([k, v]) => `${k} ${v}`).join(', ') || 'none')
  if (tally.tracking > 0) {
    const kinds = Object.entries(tally.byKind).map(([k, v]) => `${v} ${k}`).join(', ')
    console.log(`TRACKMAN IS BACK: ${tally.tracking} tracking row(s) written (${kinds}).`)
    console.log('wpbl-tracking-watch will notice the advance and say so in Discord.')
  } else {
    // The answer this job exists to give, in the words a person reads at a glance.
    console.log('No tracking published on the socket during this window.')
    console.log('The channel is live and the league is pushing box scores, so this is the')
    console.log('provider being silent rather than the connection being wrong.')
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })

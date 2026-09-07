#!/usr/bin/env node
/**
 * sync-wpbl-site-calendar.mjs — mirror the league's WEBSITE calendar into wpbl_site_games.
 *
 * A SECOND SOURCE, AND THE ONLY ONE THAT KNOWS SOME THINGS. Everything else in this section
 * mirrors the stats feed (stats.womensprobaseballleague.com/v1), which will not carry a game
 * row until it has two clubs to put on it. That is fine for a regular season and useless for a
 * postseason whose clubs are settled by the last game of the regular one: on Sep 6, 2026 the
 * feed held 61 rows, every one of them `game_type: 'regular'`, while the league's own website
 * had all eleven postseason games with dates, first-pitch times, ticket links, and for the six
 * semifinal games WHICH CLUB BATS LAST. The section printed the postseason with no home club
 * for three days because nobody had looked here.
 *
 * WHAT IT IS FOR, precisely: a game the stats feed has not published yet. Scores, box scores,
 * plays and standings all stay the feed's, and nothing derived reads this table. Each mirrored
 * row retires itself the moment the feed carries the same game.
 *
 * THE ENDPOINT is the calendar behind womensprobaseballleague.com/schedule/, a WordPress REST
 * route. It takes `start` and `end` and, as of Sep 2026, IGNORES BOTH: the same 41 rows come
 * back either way, which is the whole season plus the postseason. They are passed anyway, wide,
 * so the day it starts honouring them is not the day this quietly mirrors a fortnight.
 *
 * NO DELETES, EVER. A short or empty read is the failure this has to survive (see the `/games`
 * truncation trap in CLAUDE.md, which cost the site a real game). Rows are upserted and
 * `last_seen_at` is stamped, so a game withdrawn from the league's calendar shows up as a row
 * that stopped being touched, for a person to look at, rather than as a row that silently
 * vanished from the schedule.
 *
 * Usage:
 *   node --env-file=.env scripts/sync-wpbl-site-calendar.mjs
 *   node --env-file=.env scripts/sync-wpbl-site-calendar.mjs --dry-run
 *
 * TWO WAYS TO WRITE, one actor. On CI it is SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, like
 * every other sync here. Locally the service-role key is deliberately not in `.env` (only
 * SUPABASE_DB_URL is, for the migration runner), so it falls back to a direct Postgres
 * connection with that, the same pair of options `ingest-wpbl-birthdays.mjs` already offers.
 * Both are the service-role actor of CLAUDE.md's three write paths; neither is a new one.
 *
 * Required env: SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY, or
 * SUPABASE_DB_URL.
 */

import { createClient } from '@supabase/supabase-js'

const DRY_RUN = process.argv.includes('--dry-run')
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const DB_URL = process.env.SUPABASE_DB_URL ?? ''

const FEED = 'https://www.womensprobaseballleague.com/wp-json/wpbl/v1/calendar-events'
// The whole inaugural season and then some, so the window can never be the reason a game is
// missing. See the note above about the endpoint ignoring these today.
const WINDOW = { start: '2026-01-01T00:00:00-06:00', end: '2027-01-01T00:00:00-06:00' }

// One hub venue, Robin Roberts Stadium in Springfield IL, so the league's clock is Central and
// this stores the league's calendar rather than the reader's. Same zone the stats feed writes
// its start_time in, which is what makes rows from the two directly comparable.
const LEAGUE_TZ = 'America/Chicago'

if (!DRY_RUN && !(SUPABASE_URL && SUPABASE_KEY) && !DB_URL) {
  console.error('Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_DB_URL, before running')
  process.exit(1)
}

// ─── The league's clock ───────────────────────────────────────────────────────

const DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: LEAGUE_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
})
const TIME_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: LEAGUE_TZ, hour: 'numeric', minute: '2-digit', hour12: true,
})

/** "2026-09-09", Central. en-CA formats as YYYY-MM-DD, which is the shape wpbl_games stores. */
const leagueDate = (iso) => DATE_FMT.format(new Date(iso))

/**
 * "6:00 PM", Central, matching wpbl_games.start_time.
 *
 * Derived from the instant rather than taken from the payload's own `time`, which is lowercase
 * ("6:00 pm") and would hand the app two spellings of one clock. The narrow no-break space some
 * ICU builds put before the meridiem is normalised out for the same reason: it is invisible and
 * it breaks every string comparison it touches.
 */
const leagueTime = (iso) => TIME_FMT.format(new Date(iso)).replace(/\u202f/g, ' ')

// ─── The slug, which is the only field that names a series ────────────────────

const SEMIFINAL_SLUG = /semi-?finals?-series-([ab])-playoff-game-(\d+)/i
const CHAMPIONSHIP_SLUG = /championship-game-(\d+)/i

/**
 * Which series, and which game of it, read out of the event's URL slug
 * ("semi-final-series-a-playoff-game-2", "wpbl-championship-game-4-if-needed").
 *
 * NOTHING ELSE IN THE PAYLOAD SAYS. A semifinal's title is "Boston @ San Francisco", the same
 * shape as a regular-season game's, and the postseason marking the stats feed has is not
 * published here at all. An unrecognised slug returns nulls rather than a guess: the app then
 * falls back to its own published calendar, which is what it did before this table existed.
 */
function parseSeries(url) {
  const slug = String(url ?? '')
  const semi = slug.match(SEMIFINAL_SLUG)
  if (semi) return { round: 'semifinal', series_key: semi[1].toUpperCase(), game_number: Number(semi[2]) }
  const champ = slug.match(CHAMPIONSHIP_SLUG)
  if (champ) return { round: 'championship', series_key: null, game_number: Number(champ[1]) }
  return { round: null, series_key: null, game_number: null }
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchCalendar() {
  const url = `${FEED}?start=${encodeURIComponent(WINDOW.start)}&end=${encodeURIComponent(WINDOW.end)}`
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`calendar read failed: ${res.status} ${await res.text()}`)
  const body = await res.json()
  // A shape change is the one failure here that could pass for success: an object carrying an
  // error message has no length to check and would mirror nothing, quietly.
  if (!Array.isArray(body)) throw new Error(`calendar returned ${typeof body}, expected an array`)
  if (body.length === 0) throw new Error('calendar returned no events, which the league has never published')
  return body
}

/** One API event as one table row, or null when it is not a game this can key. */
function toRow(ev, teamIds) {
  const p = ev?.extendedProps ?? {}
  if (ev?.id == null || !ev?.start) return null
  const home = String(p.homeAbbr ?? '').trim().toUpperCase()
  const away = String(p.awayAbbr ?? '').trim().toUpperCase()
  // An abbreviation we do not know is a new club or a renamed one, and either way is something
  // for a person to look at rather than a foreign-key violation at 4am. The row is stored
  // without the club instead: the game, its date and its tickets are all still true.
  const known = (abbr) => (abbr && teamIds.has(abbr) ? abbr : null)
  if ((home && !teamIds.has(home)) || (away && !teamIds.has(away))) {
    console.warn(`unknown club abbreviation on event ${ev.id}: ${away || '-'} @ ${home || '-'}`)
  }
  const now = new Date().toISOString()
  return {
    event_id: Number(ev.id),
    starts_at: new Date(ev.start).toISOString(),
    game_date: leagueDate(ev.start),
    start_time: leagueTime(ev.start),
    title: String(ev.title ?? '').trim() || 'Untitled',
    status: String(p.status ?? 'unknown'),
    status_label: p.statusLabel ?? null,
    home_team_id: known(home),
    away_team_id: known(away),
    home_score: p.homeScore ?? null,
    away_score: p.awayScore ?? null,
    venue: p.venue || null,
    url: ev.url || null,
    ticket_status: p.ticketStatus || null,
    ticket_url: p.ticketUrl || null,
    promotion_theme: p.promotionTheme || null,
    promotion_giveaway: p.promotionGiveaway || null,
    ...parseSeries(ev.url),
    last_seen_at: now,
    updated_at: now,
  }
}

const COLUMNS = [
  'event_id', 'starts_at', 'game_date', 'start_time', 'title', 'status', 'status_label',
  'home_team_id', 'away_team_id', 'home_score', 'away_score', 'venue', 'url',
  'ticket_status', 'ticket_url', 'promotion_theme', 'promotion_giveaway',
  'round', 'series_key', 'game_number', 'last_seen_at', 'updated_at',
]

/**
 * The Postgres path, for a local run with SUPABASE_DB_URL and no service-role key.
 *
 * The column list is spelled once, above, and both the insert and the update read it, so a
 * column added to the row shape cannot arrive here as an insert that quietly stops updating.
 */
async function writeOverPostgres(rows) {
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const setCols = COLUMNS.filter(c => c !== 'event_id')
    for (const row of rows) {
      const values = COLUMNS.map(c => row[c] ?? null)
      const params = COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
      const updates = setCols.map(c => `${c} = excluded.${c}`).join(', ')
      await client.query(
        `insert into public.wpbl_site_games (${COLUMNS.join(', ')}) values (${params})
         on conflict (event_id) do update set ${updates}`,
        values,
      )
    }
  } finally {
    await client.end()
  }
}

async function main() {
  const events = await fetchCalendar()
  const supabase = SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
    : null

  let teamIds = new Set(['BOS', 'LA', 'NY', 'SF'])
  if (supabase) {
    const { data, error } = await supabase.from('wpbl_teams').select('id')
    if (error) throw new Error(`wpbl_teams read failed: ${error.message}`)
    if (data?.length) teamIds = new Set(data.map(t => t.id))
  }

  const rows = events.map(ev => toRow(ev, teamIds)).filter(Boolean)
  const post = rows.filter(r => r.round)
  console.log(`Calendar: ${events.length} events, ${rows.length} rows (${post.length} postseason).`)
  for (const r of post) {
    const clubs = r.home_team_id ? `${r.away_team_id} @ ${r.home_team_id}` : 'clubs TBD'
    console.log(`  ${r.game_date} ${r.start_time.padStart(8)}  ${r.round}${r.series_key ?? ''} G${r.game_number}  ${clubs}`)
  }

  if (DRY_RUN) {
    console.log('Dry run: nothing written.')
    return
  }
  // Upsert only. See the header: a short read has to cost nothing, and it cannot cost anything
  // if this never deletes.
  if (supabase) {
    const { error } = await supabase.from('wpbl_site_games').upsert(rows, { onConflict: 'event_id' })
    if (error) throw new Error(`wpbl_site_games upsert failed: ${error.message}`)
  } else {
    await writeOverPostgres(rows)
  }
  console.log(`Mirrored ${rows.length} rows.`)
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})

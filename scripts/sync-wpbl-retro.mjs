#!/usr/bin/env node
/**
 * sync-wpbl-retro.mjs: pull the per-game facts the league's own feed does not carry.
 *
 * WHAT IT IS. RetroWPBL (github.com/exu6jh/RetroWPBL) is an independent, hand-made
 * transcription of this season into Retrosheet format, used with the transcriber's explicit
 * permission (granted Aug 21, 2026). Its event files open with `info` records, and four of
 * them exist nowhere in stats.womensprobaseballleague.com:
 *
 *   starttime   first pitch, local
 *   timeofgame  length of the game in minutes
 *   umphome …   the crew
 *   temp/sky/…  the weather
 *
 * `timeofgame` is the reason this job exists. Game duration was investigated against the
 * league feed and found underivable: no duration field, no first-pitch field, `completed_at`
 * is a processing timestamp, and plays carry no timestamps at all. This is the only source
 * for it that we have permission to use.
 *
 * WHAT IT WRITES. wpbl_game_details, keyed on our game id, one row per transcribed game.
 * NOT wpbl_games, which is the feed's mirror: wpbl-ingest rewrites that row every two
 * minutes and would erase anything else written into it, slowly and with no trace.
 *
 * THE SOURCE LAGS, AND THAT IS NORMAL. One person transcribing by hand covers fewer games
 * than the league plays: 11 against our 16 finals on the day this shipped. A game with no
 * row is "not written up yet". The job therefore never deletes, never warns about a missing
 * game, and reports coverage rather than treating a gap as a failure.
 *
 * MATCHING. Their game id is home team + date + game number, in their own team codes
 * (BSH/LAQ/NYH/SFF against our BOS/LA/NY/SF). Games are matched on (date, home team), which
 * is unique in a league that plays at one park: two games on Aug 8 are distinguishable by
 * home side, and the `number` field is 0 on every row because there are no doubleheaders.
 * A game that does not match is COUNTED AND SKIPPED, never guessed at.
 *
 * Usage:
 *   npm run retro-sync                  # fetch, match, upsert
 *   npm run retro-sync -- --dry-run     # fetch, match, report, write nothing
 *
 * Credentials: SUPABASE_DB_URL, the same connection string `npm run migrate` uses, for the
 * same reason watch-wpbl-tracking.mjs uses it: this is owner-only bookkeeping over a handful
 * of rows, and a laptop that can run migrations can run this without a service-role key
 * sitting in .env.
 */

import pg from 'pg'
import { pathToFileURL } from 'node:url'

const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')

const REPO = 'exu6jh/RetroWPBL'
const RAW = `https://raw.githubusercontent.com/${REPO}/main`
const API = `https://api.github.com/repos/${REPO}`

// Their event files are per home team, one file per club for the season.
const EVENT_FILES = ['2026BSH.EVW', '2026LAQ.EVW', '2026NYH.EVW', '2026SFF.EVW']

/** Their club codes to ours. Hard-coded rather than fuzzy-matched: four clubs, and a wrong
 *  guess here silently attaches one game's weather to a different game. */
export const TEAM_CODES = Object.freeze({ BSH: 'BOS', LAQ: 'LA', NYH: 'NY', SFF: 'SF' })

/** The park ids they use, to the names their ballparks.csv gives. One entry today. */
const PARKS = Object.freeze({ SPR03: 'Lanphier Park' })

// Retrosheet writes "(none)" where a field is empty, which is not the same as absent: it
// means the transcriber looked and there was nobody there (a two-umpire crew has no third
// base umpire). Both become null; the distinction is not one any reader here can use.
const NONE = /^\(none\)$/i
const clean = (v) => {
  const s = (v ?? '').trim()
  return !s || NONE.test(s) ? null : s
}

const int = (v) => {
  const s = clean(v)
  if (s == null) return null
  const n = Number.parseInt(s, 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Split one event file into its games' `info` blocks.
 *
 * Deliberately reads ONLY the `id` and `info` lines and ignores every `start`, `play` and
 * `sub` record, which are 273 lines a game. We already hold the play-by-play in far more
 * depth from the feed, and mirroring a second copy of it would create two sources of truth
 * for the same at-bats with no way for a reader to know which one they were looking at.
 * The independent transcription is worth reading as a CHECK on ours (see the validator), and
 * that is a different job from this one.
 *
 * Exported, and this file is imported by its test rather than reimplemented in it: the parser
 * IS the job, and a copy living in the test would keep passing while this drifted.
 */
export function parseEventFile(text) {
  const games = []
  let current = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('id,')) {
      if (current) games.push(current)
      current = { id: line.slice(3).trim(), info: {} }
      continue
    }
    if (!current || !line.startsWith('info,')) continue
    // info,key,value — and a value may itself contain commas, so split on the first two only.
    const rest = line.slice(5)
    const comma = rest.indexOf(',')
    if (comma < 0) continue
    current.info[rest.slice(0, comma).trim()] = rest.slice(comma + 1).trim()
  }
  if (current) games.push(current)
  return games
}

/**
 * One parsed game into the row shape wpbl_game_details holds, minus the game_id, which only
 * a lookup against our schedule can supply.
 *
 * `date` comes back as their `info,date` (2026/08/01) normalised to ISO, and `homeCode` as
 * OUR club id, because those two are the match key and the caller should not have to know
 * their vocabulary to use it.
 */
export function toDetails(game) {
  const i = game.info
  const date = (clean(i.date) ?? '').replace(/\//g, '-')
  const homeCode = TEAM_CODES[clean(i.hometeam) ?? '']
  const parkId = clean(i.site)
  return {
    retro_game_id: game.id,
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    homeTeamId: homeCode ?? null,
    first_pitch_local: clean(i.starttime),
    duration_minutes: int(i.timeofgame),
    ump_home: clean(i.umphome),
    ump_first: clean(i.ump1b),
    ump_second: clean(i.ump2b),
    ump_third: clean(i.ump3b),
    temp_f: int(i.temp),
    wind_dir: clean(i.winddir),
    sky: clean(i.sky),
    precip: clean(i.precip),
    field_cond: clean(i.fieldcond),
    park_id: parkId,
    park_name: parkId ? PARKS[parkId] ?? null : null,
  }
}

/** Their umpire ids ("dinek701") are meaningless to a reader, so the crew is stored by name.
 *  UMPIRES2026.txt is the id-to-name table and is five rows long. */
export function parseUmpires(csv) {
  const out = new Map()
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const [id, last, first] = line.split(',').map((s) => (s ?? '').trim())
    if (id && last) out.set(id, `${first} ${last}`.trim())
  }
  return out
}

const fetchText = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': 'sportydolphin.fun retro sync' } })
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return res.text()
}

async function headCommit() {
  try {
    const res = await fetch(`${API}/commits/main`, { headers: { accept: 'application/vnd.github+json' } })
    if (!res.ok) return null
    return (await res.json())?.sha?.slice(0, 12) ?? null
  } catch {
    // Provenance is nice to have, not a reason to abandon a sync.
    return null
  }
}

async function main() {
  const DB_URL = process.env.SUPABASE_DB_URL ?? ''
  if (!DB_URL) {
    console.error('❌  Set SUPABASE_DB_URL (Supabase → Connect → Session pooler).')
    process.exit(1)
  }

  const [umpCsv, commit, ...files] = await Promise.all([
    fetchText(`${RAW}/umpires/UMPIRES2026.txt`),
    headCommit(),
    ...EVENT_FILES.map((f) => fetchText(`${RAW}/events/${f}`)),
  ])
  const umpires = parseUmpires(umpCsv)
  const named = (id) => (id ? umpires.get(id) ?? id : null)

  const parsed = files.flatMap(parseEventFile).map(toDetails)
  console.log(`RetroWPBL: ${parsed.length} transcribed games${commit ? ` @ ${commit}` : ''}`)

  const db = new pg.Client({ connectionString: DB_URL })
  await db.connect()
  try {
    const { rows: schedule } = await db.query(
      `select id, game_date::text as game_date, home_team_id from public.wpbl_games`)
    const byKey = new Map(schedule.map((g) => [`${g.game_date}|${g.home_team_id}`, g.id]))

    let written = 0
    const unmatched = []
    for (const d of parsed) {
      const gameId = d.date && d.homeTeamId ? byKey.get(`${d.date}|${d.homeTeamId}`) : undefined
      if (!gameId) { unmatched.push(d.retro_game_id); continue }
      written++
      if (DRY_RUN) continue
      await db.query(
        `insert into public.wpbl_game_details (
           game_id, retro_game_id, first_pitch_local, duration_minutes,
           ump_home, ump_first, ump_second, ump_third,
           temp_f, wind_dir, sky, precip, field_cond, park_id, park_name,
           source_commit, synced_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
         on conflict (game_id) do update set
           retro_game_id = excluded.retro_game_id,
           first_pitch_local = excluded.first_pitch_local,
           duration_minutes = excluded.duration_minutes,
           ump_home = excluded.ump_home, ump_first = excluded.ump_first,
           ump_second = excluded.ump_second, ump_third = excluded.ump_third,
           temp_f = excluded.temp_f, wind_dir = excluded.wind_dir, sky = excluded.sky,
           precip = excluded.precip, field_cond = excluded.field_cond,
           park_id = excluded.park_id, park_name = excluded.park_name,
           source_commit = excluded.source_commit, synced_at = now()`,
        [gameId, d.retro_game_id, d.first_pitch_local, d.duration_minutes,
          named(d.ump_home), named(d.ump_first), named(d.ump_second), named(d.ump_third),
          d.temp_f, d.wind_dir, d.sky, d.precip, d.field_cond, d.park_id, d.park_name,
          commit])
    }

    const { rows: [{ finals }] } = await db.query(
      `select count(*)::int as finals from public.wpbl_games where status = 'final'`)
    console.log(`${DRY_RUN ? 'would write' : 'wrote'} ${written} row(s); ${finals} games are final`)
    // Coverage, not a warning. The source is expected to trail the schedule, and a job that
    // shouts about that every night is a job that gets muted.
    if (finals > written) console.log(`  ${finals - written} final game(s) not transcribed yet`)
    if (unmatched.length) console.log(`  ⚠ ${unmatched.length} unmatched: ${unmatched.join(', ')}`)
  } finally {
    await db.end()
  }
}

// Importable for the tests without running the sync.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error('❌ ', err); process.exit(1) })
}

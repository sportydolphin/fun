/**
 * export-wpbl-archive.ts: keep a second copy of the WPBL's inaugural season.
 *
 * WHY THIS EXISTS, AND WHAT CHANGES ON SEP 22, 2026. Until that date `wpbl_games` and the
 * tables around it are a CACHE: every row in them can be re-fetched from
 * stats.womensprobaseballleague.com, and losing the lot would cost a re-ingest and nothing
 * else. When the feed goes quiet there is no longer anything to re-ingest from, and the same
 * tables silently become the only copy of the league's first season that we control. A dropped
 * table, a lapsed project or a bad migration after that date is unrecoverable, and nothing
 * about the day it happens would look different from any other day.
 *
 * So this writes the season to files, and the files go in git. That is the whole idea: git is
 * versioned, it is already mirrored to GitHub, every past export stays reachable, and a diff
 * shows exactly what moved between two runs.
 *
 * IT READS THROUGH THE ANON KEY ON PURPOSE, and that is a security property rather than a
 * convenience. The export is committed to a repository, so the one thing it must never do is
 * pick up a row that was not already public. Reading as the anonymous client means RLS decides
 * what lands in the file, using the same policies that decide what the website serves: a table
 * with no public policy exports as empty, and no future table can leak into the archive by
 * being added to the list by mistake. A service-role key would export `events`, `feedback` and
 * `wpbl_predict_*`, which carry analytics and Discord user ids and have no business in git.
 *
 * WHICH MEANS THIS IS NOT A DATABASE BACKUP, and must not be described as one. It preserves the
 * PUBLIC RECORD of the season. Auth, analytics, feedback, push subscriptions and the prediction
 * game are all outside it and are not protected by anything here. Project-level backups and
 * point-in-time recovery are a Supabase dashboard setting and a separate decision; this file
 * does not substitute for them and the two solve different problems.
 *
 * PAGING IS NOT OPTIONAL. PostgREST caps a bare select at 1000 rows and says nothing about it,
 * so "read every row" has to page with an explicit range AND a deterministic order or Postgres
 * may hand back the same row twice and skip another. An archive that is quietly missing a
 * prefix is worse than no archive, because it looks complete. Every read below therefore pages
 * and every page is ordered by primary key, and the run FAILS if the rows it assembled do not
 * match the count the server reports for the same table.
 *
 * Usage:
 *   npm run archive              # write the export
 *   npm run archive -- --check   # verify the files on disk against the live database
 *
 * Needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const CHECK = process.argv.includes('--check')

/** Relative to the repo root, NOT to this file: esbuild bundles it into node_modules/.cache
 *  first, so import.meta.url points somewhere useless by the time it runs. */
const OUT_DIR = resolve(process.cwd(), 'archive', 'wpbl-2026')

/** `order` is the table's PRIMARY KEY, not a convenience. Paging is only safe over a column
 *  that is unique and never null: order by anything with ties and Postgres is free to return a
 *  row on two pages and skip another, which is the silent corruption this file cannot afford.
 *  Half these tables key on the feed's own id rather than a uuid, so this cannot be assumed. */
interface Table { name: string; order: string }

/**
 * The tables that make up the season's public record, each with the column its pages are
 * ordered by.
 *
 * DELIBERATELY A HAND-WRITTEN LIST rather than everything beginning with `wpbl_`. Two reasons.
 * A discovered list would silently start archiving whatever a future migration adds, including
 * something that should not be in git; and it would give no place to say WHY a table is or is
 * not here, which is the only part of this decision that is not obvious in six months.
 *
 * Left out on purpose, and none of it is an oversight:
 *   wpbl_predict_*        the Discord prediction game. RLS-on with no policies, and it carries
 *                         Discord user ids. It would export empty; it is not listed so that
 *                         stays true by intent rather than by accident.
 *   wpbl_game_reminders,  per-user push state. Not the season's record, and personal.
 *   wpbl_*_posts,         bookkeeping for the Discord and Bluesky posters: which message id
 *   wpbl_*_state          carries which recap. Meaningless without the servers they name.
 *   wpbl_ingest_runs,     operational health. Interesting for a week, not for a decade, and
 *   wpbl_*_watch*,        it is the one set of tables here that keeps growing forever.
 *   wpbl_shop_*,          merchandise and auction listings. Someone else's catalogue.
 *   wpbl_auction_lots
 */
const TABLES: Table[] = [
  // The league itself.
  { name: 'wpbl_teams', order: 'id' },
  { name: 'wpbl_players', order: 'id' },
  { name: 'wpbl_games', order: 'id' },
  // The games. These four are the season: with them, every leaderboard, record, run-expectancy
  // table and win-probability graph on the site can be rebuilt from scratch in any year.
  { name: 'wpbl_batting_lines', order: 'id' },
  { name: 'wpbl_pitching_lines', order: 'id' },
  { name: 'wpbl_fielding_lines', order: 'id' },
  { name: 'wpbl_game_plays', order: 'id' },
  // Pitch tracking. Two games' worth, from a batch the league published once and stopped, which
  // is exactly why it is worth keeping: nobody else has a copy either.
  { name: 'wpbl_pitch_tracking', order: 'activity_id' },
  // Our own work on top of the feed, and the part that would be hardest to reproduce: the
  // hand-made scoring corrections that no re-ingest could ever bring back, and the trade log,
  // which is the only record of which club a player was on for a given GAME as opposed to
  // today. The log was excluded when this file was written, because the ingest's insert was not
  // idempotent and it held 13,644 rows encoding 18 facts; the 20260901204532 migration made the
  // write conflict-safe and collapsed it, which is what let it in.
  { name: 'wpbl_play_corrections', order: 'id' },
  { name: 'wpbl_player_team_changes', order: 'id' },
  // Context the feed does not carry. Links rather than content: the videos live on YouTube and
  // the articles on Substack, so this preserves what was published and when, not the thing
  // itself, and it is the record that survives either of those going away.
  { name: 'wpbl_videos', order: 'video_id' },
  { name: 'wpbl_articles', order: 'post_id' },
  { name: 'wpbl_game_details', order: 'game_id' },
  { name: 'wpbl_photos', order: 'page_id' },
]

const PAGE = 1000

function env(): { base: string; key: string } {
  const base = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!base || !key) {
    throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required (try: node --env-file=.env)')
  }
  return { base: base.replace(/\/+$/, ''), key }
}

/** The server's own count for a table, which is what a short read is caught against. */
async function serverCount(t: Table): Promise<number> {
  const { base, key } = env()
  const res = await fetch(`${base}/rest/v1/${t.name}?select=${t.order}`, {
    headers: { apikey: key, authorization: `Bearer ${key}`, prefer: 'count=exact', range: '0-0' },
  })
  if (!res.ok) throw new Error(`${t.name}: count failed ${res.status} ${await res.text()}`)
  // "0-0/2358", or "*/0" for an empty table.
  const total = (res.headers.get('content-range') ?? '').split('/')[1]
  const n = Number(total)
  if (!Number.isFinite(n)) throw new Error(`${t.name}: could not read a row count from "${res.headers.get('content-range')}"`)
  return n
}

/** Every row, paged, ordered, and checked against the count the server reports. */
async function readAll(t: Table): Promise<Record<string, unknown>[]> {
  const { base, key } = env()
  const expected = await serverCount(t)
  const rows: Record<string, unknown>[] = []
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(
      `${base}/rest/v1/${t.name}?select=*&order=${t.order}.asc&limit=${PAGE}&offset=${from}`,
      { headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' } })
    if (!res.ok) throw new Error(`${t.name}: read failed ${res.status} ${await res.text()}`)
    const page = await res.json() as Record<string, unknown>[]
    rows.push(...page)
    if (page.length < PAGE) break
  }
  // The whole point of the count above. A short read here is the failure this file exists to
  // make impossible, so it stops the run rather than writing a plausible-looking short file.
  if (rows.length !== expected) {
    throw new Error(`${t.name}: read ${rows.length} rows but the server counts ${expected}. Refusing to write a partial archive.`)
  }
  return rows
}

/** Stable JSON: keys sorted, so a row the database returns in a different column order does not
 *  show up as a diff in git and does not change the digest. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = stable((value as Record<string, unknown>)[k])
    }
    return out
  }
  return value
}

const serialise = (rows: Record<string, unknown>[]): string =>
  JSON.stringify(stable(rows), null, 1) + '\n'

const digest = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16)

interface ManifestEntry { table: string; rows: number; sha256: string; bytes: number }

async function exportAll(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true })
  const entries: ManifestEntry[] = []
  for (const t of TABLES) {
    const rows = await readAll(t)
    const text = serialise(rows)
    writeFileSync(join(OUT_DIR, `${t.name}.json`), text)
    entries.push({ table: t.name, rows: rows.length, sha256: digest(text), bytes: Buffer.byteLength(text) })
    console.log(`  ${String(rows.length).padStart(6)} rows  ${t.name}`)
  }

  const total = entries.reduce((n, e) => n + e.rows, 0)
  const bytes = entries.reduce((n, e) => n + e.bytes, 0)
  // `exported_at` is the only field here that changes when nothing else has, which would make
  // every run a commit. The workflow commits on a content diff, so the manifest is written with
  // the timestamp LAST and the caller compares the table digests, not the whole file.
  const manifest = {
    season: 2026,
    league: "Women's Pro Baseball League",
    source: 'https://sportydolphin.fun — mirrored from stats.womensprobaseballleague.com',
    note: 'The public record of the WPBL inaugural season. Plain JSON arrays of rows, one file '
      + 'per table, keys sorted. NOT a database backup: it is what the anonymous client can '
      + 'read, which is what the website serves. See scripts/export-wpbl-archive.ts.',
    exported_at: new Date().toISOString(),
    total_rows: total,
    tables: entries,
  }
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`\n${total} rows across ${entries.length} tables, ${(bytes / 1e6).toFixed(2)} MB, in ${OUT_DIR}`)
}

/**
 * Verify what is on disk against the live database.
 *
 * An untested backup is a rumour, and the cheap half of testing one is proving the copy still
 * matches the original. This re-reads every table and compares the digest of what it would
 * write against the digest recorded in the manifest, so it catches a truncated file, a
 * hand-edit, and a table that has moved on since the last export.
 */
async function check(): Promise<void> {
  const manifestPath = join(OUT_DIR, 'manifest.json')
  if (!existsSync(manifestPath)) throw new Error(`No archive at ${OUT_DIR}. Run: npm run archive`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { exported_at: string; tables: ManifestEntry[] }
  const recorded = new Map(manifest.tables.map(e => [e.table, e]))

  let bad = 0
  for (const t of TABLES) {
    const file = join(OUT_DIR, `${t.name}.json`)
    const was = recorded.get(t.name)
    if (!existsSync(file) || !was) { console.log(`  MISSING  ${t.name}`); bad++; continue }

    // The file has not been corrupted or edited since it was written.
    const onDisk = readFileSync(file, 'utf8')
    if (digest(onDisk) !== was.sha256) { console.log(`  ALTERED  ${t.name} (file does not match its manifest digest)`); bad++; continue }
    // ...and it still parses as what it claims to be.
    const parsed = JSON.parse(onDisk) as unknown[]
    if (!Array.isArray(parsed) || parsed.length !== was.rows) { console.log(`  CORRUPT  ${t.name}`); bad++; continue }

    // ...and it still matches the database.
    const live = serialise(await readAll(t))
    const same = digest(live) === was.sha256
    // Say WHICH kind of stale. A row count is the obvious thing to print and it is silent in
    // the common case: a game row whose score or `updated_at` moved leaves the count identical,
    // so "live has 30 rows, archive has 30" was the whole report on the only difference there
    // was. Rows gained or lost and rows edited are different situations and read differently.
    const liveRows = (JSON.parse(live) as unknown[]).length
    const why = liveRows === was.rows
      ? `${was.rows} rows, but their contents differ`
      : `live has ${liveRows} rows, archive has ${was.rows}`
    console.log(`  ${same ? 'ok      ' : 'STALE   '} ${t.name}${same ? '' : ` (${why})`}`)
    if (!same) bad++
  }

  console.log(`\nExported ${manifest.exported_at}.`)
  if (bad === 0) {
    console.log('Every table matches the live database and its own digest.')
  } else {
    // STALE is expected and fine while games are still being played: it means the season has
    // moved on since the last export, not that anything is wrong. It is only a failure in the
    // sense that the archive needs rewriting, which is what the scheduled job does.
    console.log(`${bad} table(s) differ. Re-run \`npm run archive\` to bring the files up to date.`)
  }
  process.exit(bad === 0 ? 0 : 1)
}

async function main(): Promise<void> {
  console.log(CHECK ? '\nVerifying the WPBL season archive\n' : '\nExporting the WPBL season archive\n')
  await (CHECK ? check() : exportAll())
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}

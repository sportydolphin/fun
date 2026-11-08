#!/usr/bin/env node
/**
 * freeze-mlb-lines.mjs: move closed MLB seasons' box-score lines out of Postgres and onto R2.
 *
 * WHY. mlb_batting_lines and mlb_pitching_lines were 250 MB of a 407 MB database on Nov 8, 2026,
 * about 9 MB a season, and nothing changes a season once its postseason is over. The browser
 * already reads a season as one packed row of the `mlb_season_lines` view, so this writes that
 * exact row to a static file, and src/mlb/seasonLines.ts reads the file for every season up to
 * MLB_LINES_FROZEN_THROUGH (shared/mlbLinesArchive.js). docs/MLB_LINES_ARCHIVE.md has the whole
 * procedure.
 *
 * THREE STAGES, EACH SAFE TO RE-RUN:
 *   (default)  read the view, upload the file, read it back from the public domain and compare
 *              every count with the database. Deletes nothing.
 *   --delete   all of that, then delete the season's batting and pitching lines in one
 *              transaction. Refused unless the season is at or below MLB_LINES_FROZEN_THROUGH,
 *              the public copy matches and the domain answers the site's origin with CORS, since
 *              each of those is a way for the boards to go blank once the rows are gone. Ship the
 *              raised constant before running it.
 *   --vacuum   VACUUM FULL both line tables at the end, which is what gives the space back: a
 *              plain delete only makes it reusable. Locks the tables for the few seconds it runs.
 *
 * mlb_games and mlb_players stay. The nightly mirror decides what is new by the games it holds, and
 * the view still lists every season from them; together they are about 10 MB.
 *
 * UNDOING IT: `node --env-file=.env scripts/sync-mlb-lines.mjs --season <year> --all --unfreeze`
 * reads the season's box scores again (about two hours a season), then lower the constant.
 *
 * Usage:
 *   npm run freeze-mlb-lines -- --season 2026
 *   npm run freeze-mlb-lines -- --from 2000 --through 2026 --delete --vacuum
 *
 * Required env: SUPABASE_DB_URL, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
 */
import pg from 'pg'
import { pathToFileURL } from 'node:url'
import { AwsClient } from 'aws4fetch'
import { MLB_LINES_FROZEN_THROUGH, mlbLinesArchiveKey, mlbLinesArchiveUrl } from '../shared/mlbLinesArchive.js'

const SITE_ORIGIN = 'https://sportydolphin.fun'
// A day, not a year: a late scorer's change to a closed season is re-frozen in place, and the
// boards should see it by the next day. The folder is versioned for a change of shape.
const CACHE_CONTROL = 'public, max-age=86400'
const SETS = ['games', 'batting', 'pitching', 'players']

/** The seasons asked for, oldest first. */
export function seasonsFromArgs(argv) {
  const get = name => { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : undefined }
  const one = get('--season')
  if (one) return [one]
  const from = get('--from'), through = get('--through')
  if (!from || !through || from > through) return []
  return Array.from({ length: through - from + 1 }, (_, i) => from + i)
}

/** How many of each set a packed row holds, so the copy and the database can be compared. */
export const countsOf = row => Object.fromEntries(SETS.map(s => [s, row?.[s]?.rows?.length ?? -1]))

/** The first set whose count differs, or null when the copy matches. */
export function mismatch(a, b) {
  for (const s of SETS) if (a[s] !== b[s]) return `${s}: database ${a[s]}, file ${b[s]}`
  return null
}

const env = name => (process.env[name] ?? '').trim()

async function main() {
  const seasons = seasonsFromArgs(process.argv)
  const doDelete = process.argv.includes('--delete')
  const doVacuum = process.argv.includes('--vacuum')
  if (!seasons.length) {
    console.error('Pass --season <year>, or --from <year> --through <year>')
    process.exit(1)
  }
  const missing = ['SUPABASE_DB_URL', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].filter(n => !env(n))
  if (missing.length) {
    console.error(`Set ${missing.join(', ')} before running`)
    process.exit(1)
  }
  if (doDelete) {
    const late = seasons.filter(s => s > MLB_LINES_FROZEN_THROUGH)
    if (late.length) {
      console.error(`Refusing --delete for ${late.join(', ')}: above MLB_LINES_FROZEN_THROUGH (${MLB_LINES_FROZEN_THROUGH}), so the boards still read them from Postgres`)
      process.exit(1)
    }
  }

  const r2 = new AwsClient({ accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY'), region: 'auto', service: 's3' })
  const endpoint = `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/${env('R2_BUCKET')}`
  const db = new pg.Client({ connectionString: env('SUPABASE_DB_URL'), ssl: { rejectUnauthorized: false } })
  await db.connect()
  const failed = []

  try {
    for (const season of seasons) {
      const { rows } = await db.query(
        'select season, games, batting, pitching, players, synced_at from public.mlb_season_lines where season = $1', [season])
      const row = rows[0]
      const dbCounts = countsOf(row)
      if (!row || dbCounts.batting === 0) {
        // Already deleted, or never mirrored: the file is the only copy, so it is checked, not rewritten.
        console.log(`${season}: no lines in the database, checking the file only`)
      } else {
        const body = JSON.stringify(row)
        const res = await r2.fetch(`${endpoint}/${mlbLinesArchiveKey(season)}`, {
          method: 'PUT', body,
          headers: { 'content-type': 'application/json', 'cache-control': CACHE_CONTROL },
        })
        if (!res.ok) throw new Error(`R2 PUT ${season} failed: ${res.status} ${await res.text().catch(() => '')}`)
        console.log(`${season}: uploaded ${(body.length / 1048576).toFixed(1)} MB`)
      }

      // Read back through the public domain as the browser will, past the edge cache, from the
      // site's origin: a file the boards cannot fetch is as gone as one that was never written.
      const pub = await fetch(`${mlbLinesArchiveUrl(season)}?check=${Date.now()}`, { headers: { Origin: SITE_ORIGIN } })
      if (!pub.ok) { failed.push(`${season}: public file answered ${pub.status}`); continue }
      const cors = pub.headers.get('access-control-allow-origin')
      const fileCounts = countsOf(await pub.json())
      const differs = dbCounts.batting > 0 ? mismatch(dbCounts, fileCounts) : null
      if (differs) { failed.push(`${season}: ${differs}`); continue }
      console.log(`${season}: public copy matches (${fileCounts.games} games, ${fileCounts.batting} batting, ${fileCounts.pitching} pitching)`)

      if (!doDelete || dbCounts.batting === 0) continue
      if (cors !== '*' && cors !== SITE_ORIGIN) {
        failed.push(`${season}: no CORS for ${SITE_ORIGIN} on the public file, so the browser could not read it; not deleting`)
        continue
      }
      await db.query('begin')
      try {
        const games = 'select game_pk from public.mlb_games where season = $1'
        const b = await db.query(`delete from public.mlb_batting_lines where game_pk in (${games})`, [season])
        const p = await db.query(`delete from public.mlb_pitching_lines where game_pk in (${games})`, [season])
        await db.query('commit')
        console.log(`${season}: deleted ${b.rowCount} batting and ${p.rowCount} pitching lines`)
      } catch (e) {
        await db.query('rollback')
        throw e
      }
    }

    if (doVacuum) {
      for (const t of ['mlb_batting_lines', 'mlb_pitching_lines']) {
        await db.query(`vacuum full public.${t}`)
        const { rows } = await db.query('select pg_size_pretty(pg_total_relation_size($1::regclass)) size', [`public.${t}`])
        console.log(`${t}: ${rows[0].size} after VACUUM FULL`)
      }
    }
  } finally {
    await db.end()
  }

  if (failed.length) {
    console.error(`${failed.length} failed:\n  ${failed.join('\n  ')}`)
    process.exit(1)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1) })
}

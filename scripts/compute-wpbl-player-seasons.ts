/**
 * compute-wpbl-player-seasons.ts: total every WPBL player's season once, for every reader.
 *
 * The Stats tab's Players, Leaders and Overall boards and the search box's answers were built in
 * each reader's browser from every box-score line and, for WAR, the whole play log. This runs
 * exactly the code the browser ran (src/wpbl/derive/playerSeasons.ts, which calls the aggregates,
 * the WAR engine and the run values the browser calls) over exactly the inputs it read (the schedule
 * cleaned as fetchWpblSchedule cleans it, the lines in id order, the play log in (game, sequence)
 * order with our corrections laid over it, the roster) and stores the answer in
 * `wpbl_player_seasons`. See that migration for why, and for how a reader decides the rows are
 * current.
 *
 * THE STAMP IS READ FIRST, before any input. Anything that changes while the inputs are read then
 * leaves the stored stamp behind the live one, and readers fall back until the next run. Read it
 * last and a change that landed mid-read would be stamped as included when it was not.
 *
 * A SHORT READ MUST FAIL, NOT WRITE, as in the run-environment job. Every read is paged and checked
 * against its own count, since a missing page does not error; it would just total a season off a
 * slice of it and serve that to everyone.
 *
 * Usage:
 *   npm run player-seasons              # total and write, unless the stored stamp already matches
 *   npm run player-seasons -- --force   # write even so
 *   npm run player-seasons -- --dry-run # total and print, write nothing
 *
 * Writes with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY on CI; by hand with SUPABASE_DB_URL, the
 * connection string the migration runner uses. A dry run needs only VITE_SUPABASE_URL +
 * VITE_SUPABASE_ANON_KEY, since everything it reads is public.
 */
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import { RUN_VALUE_PLAY_SELECT } from '../src/wpbl/derive/runEnvironment'
import {
  buildPlayerSeasonRows, LEAGUE_ROW, PLAYER_SEASONS_VERSION, type WpblPlayerSeasonRow,
} from '../src/wpbl/derive/playerSeasons'
import { applyPlayCorrections, CORRECTION_SELECT, type WpblPlayCorrection } from '../src/wpbl/playCorrections'
import { cleanSchedule } from '../src/wpbl/gameOver'
import { seasonOf } from '../src/wpbl/season'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblRunValuePlay } from '../src/wpbl/types'

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true'
const FORCE = process.argv.includes('--force') || process.env.FORCE === 'true'
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const READ_KEY = SERVICE_KEY || (process.env.VITE_SUPABASE_ANON_KEY ?? '')
const DB_URL = process.env.SUPABASE_DB_URL ?? ''

if (!SUPABASE_URL || !READ_KEY) {
  console.error('Set SUPABASE_URL and a key before running (try: node --env-file=.env)')
  process.exit(1)
}
if (!DRY_RUN && !SERVICE_KEY && !DB_URL) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_DB_URL to write. Add --dry-run to read only.')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, READ_KEY, { auth: { persistSession: false } })
const PAGE = 1000

/** Every row of a read, paged and ordered (CLAUDE.md: a bare select stops at 1000 silently),
 *  and checked against the table's own count so a lost page fails the run. */
async function readAll<T>(table: string, select: string, order: string[]): Promise<T[]> {
  const out: T[] = []
  let total: number | null = null
  for (let from = 0; total == null || from < total; from += PAGE) {
    let q = db.from(table).select(select, { count: 'exact' })
    for (const col of order) q = q.order(col, { ascending: true })
    const { data, error, count } = await q.range(from, from + PAGE - 1)
    if (error) throw new Error(`${table} read failed: ${error.message}`)
    total = count ?? 0
    out.push(...((data ?? []) as T[]))
    if (!data || data.length === 0) break
  }
  if (out.length !== total) throw new Error(`${table}: read ${out.length} of ${total} rows, refusing to total a partial season`)
  return out
}

async function readStamp(): Promise<string> {
  const { data, error } = await db.from('wpbl_player_season_stamp').select('stamp').limit(1)
  if (error || !data?.[0]?.stamp) throw new Error(`stamp read failed: ${error?.message ?? 'no row'}`)
  return data[0].stamp as string
}

async function main() {
  const stamp = await readStamp()

  // Nothing to do when every stored row already describes these inputs: the offseason's hourly run.
  if (!FORCE && !DRY_RUN) {
    const stored = await readAll<{ stamp: string; version: number }>('wpbl_player_seasons', 'stamp,version', ['season', 'scope', 'player_id'])
    if (stored.length > 0 && stored.every(r => r.stamp === stamp && r.version === PLAYER_SEASONS_VERSION)) {
      console.log(`Stored rows already match stamp ${stamp}; nothing written.`)
      return
    }
  }

  // The orders are the browser's: lines by id, plays by (game, sequence), the schedule sorted by
  // cleanSchedule. WAR's float sums follow the order of their inputs (see cleanSchedule).
  const [rawGames, players, batting, pitching, plays, corrections] = await Promise.all([
    readAll<WpblGame>('wpbl_games', '*', ['game_date', 'id']),
    readAll<WpblPlayer>('wpbl_players', '*', ['id']),
    readAll<WpblBattingLine>('wpbl_batting_lines', '*', ['id']),
    readAll<WpblPitchingLine>('wpbl_pitching_lines', '*', ['id']),
    readAll<WpblRunValuePlay>('wpbl_game_plays', `${RUN_VALUE_PLAY_SELECT},is_hit`, ['game_id', 'sequence']),
    readAll<WpblPlayCorrection>('wpbl_play_corrections', CORRECTION_SELECT, ['game_id', 'sequence', 'field']),
  ])
  const schedule = cleanSchedule(rawGames)

  // A live game's plays are deleted and reinserted every two minutes, so a read can land between
  // the two. Readers fall back to the plays while a game is live anyway (its writes move the stamp).
  const live = schedule.filter(g => g.status === 'live')
  if (live.length > 0 && !DRY_RUN) {
    console.log(`${live.length} game(s) live; nothing written. The next run after the final will total it.`)
    return
  }

  const corrected = applyPlayCorrections(plays, corrections)
  const years = [...new Set(schedule.map(seasonOf).filter((y): y is number => y != null))].sort()
  const rows: WpblPlayerSeasonRow[] = []
  for (const season of years) {
    const built = buildPlayerSeasonRows({ season, schedule, lines: { batting, pitching }, plays: corrected, players, stamp })
    rows.push(...built.map(r => ({ ...r, season_rows: built.length })))
    const reg = built.filter(r => r.scope === 'regular' && r.player_id !== LEAGUE_ROW)
    const lg = built.find(r => r.scope === 'regular' && r.player_id === LEAGUE_ROW)!
    console.log(`${season}: ${built.length} rows, ${reg.filter(r => r.batting).length} hitters, `
      + `${reg.filter(r => r.pitching).length} pitchers, ${reg.filter(r => r.value).length} with WAR; `
      + `league ${lg.batting?.ab} AB, ${lg.pitching?.outs} outs; weights ${lg.weights?.woba ? 'priced' : 'none'}`)
  }

  // JSON cannot carry NaN or Infinity: either would arrive as null and print as a dash, silently.
  for (const r of rows) {
    for (const part of [r.batting, r.pitching, r.value] as (Record<string, number> | null)[]) {
      for (const [k, v] of Object.entries(part ?? {})) {
        if (!Number.isFinite(v)) throw new Error(`${r.season} ${r.scope} ${r.player_id}: ${k} is ${v}, refusing to write`)
      }
    }
  }

  console.log(`${schedule.length} games, ${batting.length} batting and ${pitching.length} pitching lines, `
    + `${plays.length} plays, ${corrections.length} corrections; stamp ${stamp}`)
  if (DRY_RUN) {
    console.log('\n--dry-run: nothing written.')
    return
  }

  const computed_at = new Date().toISOString()
  if (SERVICE_KEY) {
    // One upsert per season, each a single statement, so a reader sees a season whole or not at
    // all; then whatever the run did not write (a player merged away) goes. A reader that catches
    // the moment between the two sees a row with the old stamp and falls back, which is harmless.
    for (const season of years) {
      const mine = rows.filter(r => r.season === season).map(r => ({ ...r, computed_at }))
      const { error } = await db.from('wpbl_player_seasons').upsert(mine, { onConflict: 'season,scope,player_id' })
      if (error) throw new Error(`wpbl_player_seasons upsert failed: ${error.message}`)
    }
    const { error } = await db.from('wpbl_player_seasons').delete().neq('stamp', stamp)
    if (error) throw new Error(`wpbl_player_seasons cleanup failed: ${error.message}`)
  } else {
    // The hand-run path: the same rows, in one transaction over the session pooler.
    const client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
    await client.connect()
    try {
      await client.query('begin')
      await client.query('delete from wpbl_player_seasons')
      await client.query(
        `insert into wpbl_player_seasons (season, scope, player_id, batting, pitching, value, position, weights, season_rows, stamp, version, computed_at)
         select season, scope, player_id, batting, pitching, value, position, weights, season_rows, stamp, version, $2::timestamptz
         from jsonb_to_recordset($1::jsonb) as r(season int, scope text, player_id text, batting jsonb, pitching jsonb,
           value jsonb, position jsonb, weights jsonb, season_rows int, stamp text, version int)`,
        [JSON.stringify(rows), computed_at])
      await client.query('commit')
    } catch (err) {
      await client.query('rollback')
      throw err
    } finally {
      await client.end()
    }
  }
  console.log(`\nwrote ${rows.length} rows`)
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})

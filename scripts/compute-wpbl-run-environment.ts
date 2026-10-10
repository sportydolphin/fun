/**
 * compute-wpbl-run-environment.ts: price the season's run environment once, for every reader.
 *
 * The Stats tab's wOBA, wRC+ and FIP weights come from walking every play of the season through
 * the league's run-expectancy table. This runs exactly the code the browser ran
 * (src/wpbl/derive/runEnvironment.ts) over exactly the inputs the browser read (the schedule as
 * fetchWpblSchedule settles it, the play log with our corrections laid over it) and stores the
 * answer in `wpbl_run_environment`. See that migration for why, and for how a reader decides
 * whether the stored row is current.
 *
 * A SHORT READ MUST FAIL, NOT PRICE. The play log is paged, and a missing page does not error,
 * it just prices the season off a slice of it, which would then be served to everyone as the
 * league's weights. Every read is checked against its own count before anything is written.
 *
 * Usage:
 *   npm run run-environment              # price and write
 *   npm run run-environment -- --dry-run # price and print, write nothing
 *
 * Writes with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (CI). A dry run needs only
 * VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY, since everything it reads is public.
 */
import { createClient } from '@supabase/supabase-js'
import { priceRunEnvironment, RUN_VALUE_PLAY_SELECT } from '../src/wpbl/derive/runEnvironment'
import { applyPlayCorrections, CORRECTION_SELECT, type WpblPlayCorrection } from '../src/wpbl/playCorrections'
import { settleGames } from '../src/wpbl/gameOver'
import type { WpblGame, WpblRunValuePlay } from '../src/wpbl/types'

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true'
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const READ_KEY = SERVICE_KEY || (process.env.VITE_SUPABASE_ANON_KEY ?? '')

if (!SUPABASE_URL || !READ_KEY) {
  console.error('Set SUPABASE_URL and a key before running (try: node --env-file=.env)')
  process.exit(1)
}
if (!DRY_RUN && !SERVICE_KEY) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY to write. Add --dry-run to read only.')
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
  if (out.length !== total) throw new Error(`${table}: read ${out.length} of ${total} rows, refusing to price a partial season`)
  return out
}

async function main() {
  const [rawGames, plays, corrections] = await Promise.all([
    readAll<WpblGame>('wpbl_games', '*', ['game_date', 'id']),
    readAll<WpblRunValuePlay>('wpbl_game_plays', RUN_VALUE_PLAY_SELECT, ['game_id', 'sequence']),
    readAll<WpblPlayCorrection>('wpbl_play_corrections', CORRECTION_SELECT, ['game_id', 'sequence', 'field']),
  ])
  // The statuses the browser sees: fetchWpblSchedule settles every read the same way, and the
  // final count a reader compares against is taken from those.
  const games = settleGames(rawGames)
  const env = priceRunEnvironment(applyPlayCorrections(plays, corrections), games)

  console.log(`${games.length} games, ${env.final_games} regular-season finals, ${env.plays} plays, ${corrections.length} corrections`)
  console.log('wOBA weights:', JSON.stringify(env.woba_weights))
  console.log('FIP weights: ', JSON.stringify(env.fip_weights))

  if (DRY_RUN) {
    console.log('\n--dry-run: nothing written.')
    return
  }
  const { error } = await db.from('wpbl_run_environment')
    .upsert({ ...env, computed_at: new Date().toISOString() }, { onConflict: 'scope' })
  if (error) throw new Error(`wpbl_run_environment upsert failed: ${error.message}`)
  console.log('\nwrote the regular-season row')
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})

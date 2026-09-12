/**
 * sync-wpbl-recaps.ts: mirror This is Women's Baseball's game recaps as LINKS.
 *
 * They write one recap per WPBL game and gave explicit permission for us to link to them
 * (ARCHITECTURE §10). This reads their RSS, works out which of our games each post is about,
 * and stores four things: the headline, their URL, their title image's URL, and the date.
 *
 * IT STORES NO PROSE, and that is not an oversight to be helpfully corrected later. The feed
 * carries the lede in `description` and this never reads it: on recaps this short the lede is
 * close to half the article. `wpbl_recaps` has no column for a body, so the rule is the
 * schema's rather than this file's. See docs/RECAPS.md.
 *
 * UPSERTS ONLY, NEVER DELETES, for the same reason the site-calendar job does. Their feed is a
 * 50-item window that ignores every paging parameter, so it will one day stop carrying August;
 * a sync that reconciled by deleting what it could no longer see would take the back catalogue
 * with it on that day, silently. A row that stops appearing simply stops being updated.
 *
 * Usage:
 *   npm run recaps-sync              # read, match, write
 *   npm run recaps-sync -- --dry-run # read, match, print, write nothing
 *
 * TWO WAYS TO WRITE, ONE ACTOR, same as the site-calendar job beside it. On CI it is
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY; by hand it is SUPABASE_DB_URL, the same connection
 * string the migration runner uses, so a run from a checkout needs no service key in `.env`.
 * The table is public-read and service-role-write, and this is its only writer.
 */
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import {
  FEED_URL, PUBLICATION_NAME, matchRecaps, parseRecapFeed,
  type RecapGame,
} from '../src/wpbl/derive/recaps'

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true'
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const DB_URL = process.env.SUPABASE_DB_URL ?? ''

// Reading is enough for a dry run, and the anon key can do it, so `--dry-run` works from a
// checkout with only a .env.
const READ_KEY = SERVICE_KEY || ANON_KEY
if (!SUPABASE_URL || !READ_KEY) {
  console.error('Set SUPABASE_URL and a key before running (try: node --env-file=.env)')
  process.exit(1)
}
if (!DRY_RUN && !SERVICE_KEY && !DB_URL) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_DB_URL to write. Add --dry-run to read only.')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, READ_KEY, { auth: { persistSession: false } })

/** The hand-run path: the same upsert, straight over the session pooler. */
async function writeOverPostgres(rows: readonly Record<string, unknown>[]) {
  const client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    for (const r of rows) {
      await client.query(
        `insert into wpbl_recaps (game_id, url, title, cover_url, published_at, matched_by, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (game_id) do update set
           url = excluded.url, title = excluded.title, cover_url = excluded.cover_url,
           published_at = excluded.published_at, matched_by = excluded.matched_by,
           updated_at = excluded.updated_at`,
        [r.game_id, r.url, r.title, r.cover_url, r.published_at, r.matched_by, r.updated_at])
    }
  } finally {
    await client.end()
  }
}

async function main() {
  // ── their feed ─────────────────────────────────────────────────────────────
  const res = await fetch(FEED_URL, {
    headers: {
      // Say who we are. They gave permission for this; a job reading someone's feed every
      // night should be identifiable from their logs without them having to ask.
      'user-agent': 'sportydolphin.fun WPBL recap linker (+https://sportydolphin.fun)',
      accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
    },
  })
  if (!res.ok) throw new Error(`feed ${FEED_URL} → ${res.status}`)
  const posts = parseRecapFeed(await res.text())
  if (posts.length === 0) throw new Error('feed parsed to zero posts, refusing to continue')

  // ── our games ──────────────────────────────────────────────────────────────
  // Explicit limit and order, per the paging rule in CLAUDE.md: a bare select caps at 1000
  // without saying so, and a schedule that silently lost its tail would match recaps onto
  // whatever remained.
  const { data: games, error } = await db
    .from('wpbl_games')
    .select('id,game_date,home_team_id,away_team_id,home_score,away_score')
    .eq('status', 'final')
    .order('game_date', { ascending: true })
    .order('id', { ascending: true })
    .limit(2000)
  if (error) throw new Error(`wpbl_games read failed: ${error.message}`)

  const matches = matchRecaps(posts, (games ?? []) as RecapGame[])
  const played = (games ?? []).length

  console.log(`${PUBLICATION_NAME}: ${posts.length} posts in the feed, ${played} final games`)
  console.log(`matched ${matches.length} of ${played}`)

  const byKind = new Map<string, number>()
  for (const m of matches) byKind.set(m.how, (byKind.get(m.how) ?? 0) + 1)
  for (const [how, n] of [...byKind].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${how}`)

  const placed = new Set(matches.map(m => m.gameId))
  const unmatched = (games ?? []).filter(g => !placed.has(g.id))
  if (unmatched.length) {
    // Reported, never guessed at. An unmatched game shows no card, which is the failure this
    // is designed to have: see the bias note in derive/recaps.ts.
    console.log(`\n${unmatched.length} game(s) with no recap placed:`)
    for (const g of unmatched) console.log(`  ${g.game_date} ${g.away_team_id}@${g.home_team_id}`)
  }

  const rows = matches.map(m => ({
    game_id: m.gameId,
    url: m.post.url,
    title: m.post.title,
    cover_url: m.post.coverUrl,
    published_at: m.post.publishedAt.toISOString(),
    matched_by: m.how,
    updated_at: new Date().toISOString(),
  }))

  if (DRY_RUN) {
    console.log(`\n--dry-run: would upsert ${rows.length} row(s). Nothing written.`)
    for (const r of rows.slice(0, 5)) console.log(`  ${r.published_at.slice(0, 10)}  ${r.title}`)
    if (rows.length > 5) console.log(`  … and ${rows.length - 5} more`)
    return
  }

  // On the game, which is this table's key. A re-match that moved a post to another game
  // trips the url unique index instead of quietly attaching one article to two games.
  if (SERVICE_KEY) {
    const { error: writeError } = await db.from('wpbl_recaps').upsert(rows, { onConflict: 'game_id' })
    if (writeError) throw new Error(`wpbl_recaps upsert failed: ${writeError.message}`)
  } else {
    await writeOverPostgres(rows)
  }
  console.log(`\nwrote ${rows.length} row(s)`)
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})

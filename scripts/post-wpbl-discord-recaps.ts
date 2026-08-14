#!/usr/bin/env node
/**
 * post-wpbl-discord-recaps.ts — posts a box score to Discord when a WPBL game goes final,
 * then keeps that message current if the stats change.
 *
 * One message per game, posted once and edited in place afterwards. The edit matters: the
 * league's feed revises box scores after the final — a scoring change, a late correction —
 * and wpbl-ingest re-fetches finals, so a post-and-forget recap would sit in the channel
 * with numbers the site no longer agrees with. Every run re-renders each recent final and
 * PATCHes only the ones whose rendered message actually changed, so a quiet run costs
 * nothing and a corrected line score fixes itself.
 *
 * Why a webhook (not a bot): send-only HTTP, no token, no gateway, nothing to keep running.
 * Same reasoning as scripts/update-wpbl-discord-board.mjs, which also owns its messages by
 * id and edits them.
 *
 * Why TypeScript: the recap itself comes from src/wpbl/derive/recap.ts — the same engine
 * behind the site's Recap tab — so the headline, the narrative, the decisions, and the
 * stars read identically in Discord and in the app. That module is pure TS, so this script
 * is bundled with esbuild before it runs (see the npm script / the workflow).
 *
 * It never backfills. The first run against an empty posts table posts only the most
 * recently completed game and quietly records every older final as handled, so switching
 * the job on puts one game in the channel rather than a season. After that each new final
 * is posted as it lands, which is the steady state: a game ends, the next pass posts it.
 *
 * Usage:
 *   npm run discord-recaps -- --dry-run      # render to stdout, post nothing
 *   npm run discord-recaps                   # post the newest unposted final, update the rest
 *   npm run discord-recaps -- --seed         # record every final as handled, post nothing
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (anon works — all reads are public,
 * but the posts table is service-role only), DISCORD_RECAP_WEBHOOK_URL (not needed by
 * --dry-run).
 */
import { createClient } from '@supabase/supabase-js'
// @ts-expect-error — no types installed for `ws`; it is only handed to supabase-js below.
import ws from 'ws'
import { buildRecap, leagueRecapContext } from '../src/wpbl/derive/recap'
import { buildRecapMessage, recapMessageHash } from '../src/wpbl/derive/discordRecap'
import type { WpblGame, WpblTeam, WpblBattingLine, WpblPitchingLine, WpblGamePlay } from '../src/wpbl/types'

// ─── Config ─────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  ?? process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''
const WEBHOOK_URL = process.env.DISCORD_RECAP_WEBHOOK_URL ?? ''
const SITE = 'https://sportydolphin.fun'

const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')
const SEED = args.has('--seed')

// How far back a final stays eligible. Long enough that a correction landing the next
// morning still updates its message, short enough that the job's work stays bounded and an
// old game can never resurface in the channel.
const WINDOW_DAYS = 3

// Discord allows a burst, but there is no reason to spend it — a normal run posts one or
// two games.
const SEND_GAP_MS = 400

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌  Set SUPABASE_URL and a Supabase key before running')
  process.exit(1)
}
if (!WEBHOOK_URL && !DRY_RUN && !SEED) {
  console.error('❌  Set DISCORD_RECAP_WEBHOOK_URL (the full https://discord.com/api/webhooks/<id>/<token>)')
  process.exit(1)
}

// Matches the other Discord/reminder scripts: no session handling in CI, and `ws` for
// realtime because supabase-js constructs a client for it even though nothing here
// subscribes (Node < 22 has no global WebSocket).
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws },
})

// What the message looks like — and therefore when it needs re-sending — lives in
// src/wpbl/derive/discordRecap.ts, next to the recap engine and under test. The edge
// function that announces a final immediately renders and hashes through the same module,
// so the two posters never disagree about whether a message is current.

// ─── Discord ────────────────────────────────────────────────────────────────

async function discord(path: string, init: RequestInit): Promise<Response> {
  const res = await fetch(`${WEBHOOK_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (res.status === 429) {
    // Webhook buckets are per-channel; one wait and one retry is plenty for a job that
    // sends single digits of messages.
    const retryMs = Math.min(10_000, Number((await res.clone().json().catch(() => ({}))).retry_after ?? 1) * 1000)
    console.warn(`⚠️  Rate limited, waiting ${retryMs}ms`)
    await sleep(retryMs)
    return discord(path, init)
  }
  return res
}

/** `?wait=true` makes Discord return the created message, which is how we learn its id. */
async function createMessage(payload: unknown): Promise<{ id: string }> {
  const res = await discord('?wait=true', { method: 'POST', body: JSON.stringify(payload) })
  if (!res.ok) throw new Error(`Post failed (${res.status}): ${await res.text()}`)
  return await res.json()
}

/** Returns gone=true when the message has been deleted in Discord, so we can repost. */
async function editMessage(id: string, payload: unknown): Promise<{ gone: boolean }> {
  const res = await discord(`/messages/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
  if (res.status === 404) return { gone: true }
  if (!res.ok) throw new Error(`Edit failed (${res.status}): ${await res.text()}`)
  return { gone: false }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ─── Data ───────────────────────────────────────────────────────────────────

interface PostRow { game_id: string; message_id: string | null; content_hash: string }

const dateStr = (offsetDays: number): string =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)

/** "4:30 PM" → 990, for ordering two games played on the same date. Stored start times are
 *  free-form wall clock at the league's single hub, so a string sort would put "11:00 AM"
 *  after "4:30 PM" — which on a doubleheader day is the difference between posting the
 *  right game and the wrong one. Unparseable times sort first. */
function startMinutes(startTime: string | null): number {
  const m = /^\s*(\d{1,2}):(\d{2})\s*([AP])M/i.exec(startTime ?? '')
  if (!m) return -1
  const h = Number(m[1]) % 12 + (m[3].toUpperCase() === 'P' ? 12 : 0)
  return h * 60 + Number(m[2])
}

/** Has this job ever recorded anything? An empty table means a first run, which posts only
 *  the newest final (see the header). Asked separately from loadPosts because that one is
 *  scoped to the window's games, and "no rows for these games" is not the same question. */
async function hasAnyPost(): Promise<boolean> {
  const { data, error } = await supabase.from('wpbl_discord_recap_posts').select('game_id').limit(1)
  if (error) throw new Error(`Reading wpbl_discord_recap_posts failed (has the migration run?): ${error.message}`)
  return (data ?? []).length > 0
}

async function loadPosts(gameIds: string[]): Promise<Map<string, PostRow>> {
  if (!gameIds.length) return new Map()
  const { data, error } = await supabase
    .from('wpbl_discord_recap_posts')
    .select('game_id, message_id, content_hash')
    .in('game_id', gameIds)
  if (error) {
    // A dry run is the thing you want to be able to do BEFORE applying the migration —
    // it sends nothing, so it can just report every game as new. A real run cannot: with
    // no memory of what it posted it would repost every game, every pass.
    if (DRY_RUN) {
      console.warn(`⚠️  No wpbl_discord_recap_posts yet (${error.message}) — treating every game as new.`)
      return new Map()
    }
    throw new Error(`Reading wpbl_discord_recap_posts failed (has the migration run?): ${error.message}`)
  }
  return new Map((data ?? []).map(r => [r.game_id, r as PostRow]))
}

async function savePost(row: PostRow): Promise<void> {
  const { error } = await supabase
    .from('wpbl_discord_recap_posts')
    .upsert({ ...row, updated_at: new Date().toISOString() })
  if (error) throw new Error(`Persisting the post for ${row.game_id} failed: ${error.message}`)
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // The whole season's games: the recap's wording calibrates to how this league actually
  // scores (see leagueRecapContext), so it needs every final, not just the window's.
  const { data: allGames, error: gamesErr } = await supabase.from('wpbl_games').select('*')
  if (gamesErr) throw new Error(`Loading games failed: ${gamesErr.message}`)
  const games = (allGames ?? []) as WpblGame[]
  const ctx = leagueRecapContext(games)

  const { data: teamRows, error: teamsErr } = await supabase.from('wpbl_teams').select('*')
  if (teamsErr) throw new Error(`Loading teams failed: ${teamsErr.message}`)
  const teams = new Map(((teamRows ?? []) as WpblTeam[]).map(t => [t.id, t]))

  // Decided finals only — buildRecap returns null for a tie or a missing score, and a game
  // still being ingested has no business in the channel.
  const decided = games.filter(g =>
    g.status === 'final' && g.home_score != null && g.away_score != null && g.home_score !== g.away_score)
  const eligible = SEED ? decided : decided.filter(g => g.game_date >= dateStr(-WINDOW_DAYS))
  if (!eligible.length) { console.log('Nothing final in the window — nothing to do.'); return }

  const posts = await loadPosts(eligible.map(g => g.id))

  const { data: players } = await supabase.from('wpbl_players').select('id, name')
  const nameById = new Map(((players ?? []) as { id: string; name: string }[]).map(p => [p.id, p.name]))
  const nameOf = (id: string) => nameById.get(id) ?? '—'

  const ids = eligible.map(g => g.id)
  const [batting, pitching, plays] = await Promise.all([
    supabase.from('wpbl_batting_lines').select('*').in('game_id', ids),
    supabase.from('wpbl_pitching_lines').select('*').in('game_id', ids),
    supabase.from('wpbl_game_plays').select('*').in('game_id', ids),
  ])
  const by = <T extends { game_id: string }>(rows: T[] | null) => {
    const m = new Map<string, T[]>()
    for (const r of rows ?? []) m.set(r.game_id, [...(m.get(r.game_id) ?? []), r])
    return m
  }
  const battingBy = by(batting.data as WpblBattingLine[] | null)
  const pitchingBy = by(pitching.data as WpblPitchingLine[] | null)
  const playsBy = by(plays.data as WpblGamePlay[] | null)

  // Oldest first, so a run that posts more than one game reads down the channel in the
  // order they were played.
  eligible.sort((a, b) => a.game_date.localeCompare(b.game_date) || startMinutes(a.start_time) - startMinutes(b.start_time))

  // A first run has no history to reason from, so it takes the newest final only. Every
  // run after this one can trust the table: an unposted final is simply new.
  const firstRun = !(await hasAnyPost())
  const newestId = eligible[eligible.length - 1]?.id
  if (firstRun) console.log(`First run — posting only the most recent final, recording ${eligible.length - 1} older one(s) as handled.`)

  let posted = 0, updated = 0, unchanged = 0, seeded = 0
  for (const game of eligible) {
    const recap = buildRecap(game, teams, battingBy.get(game.id) ?? [], pitchingBy.get(game.id) ?? [],
      playsBy.get(game.id) ?? [], nameOf, ctx)
    if (!recap) continue
    const payload = buildRecapMessage(game, recap, teams)
    const hash = await recapMessageHash(payload)
    const existing = posts.get(game.id)

    // message_id null = "handled, deliberately never posted" — what a first run writes for
    // everything older than the newest final, and what --seed writes for everything.
    const holdBack = SEED || (firstRun && game.id !== newestId)

    if (DRY_RUN) {
      const state = holdBack ? 'would record as handled, NOT posted'
        : !existing ? 'WOULD POST'
        : existing.message_id == null ? (existing.content_hash === '' ? 'WOULD POST (finishing an abandoned claim)' : 'held back earlier, skipping')
        : existing.content_hash === hash ? 'unchanged' : 'WOULD EDIT'
      console.log(`\n── ${game.game_date}  ${recap.headline}  [${state}]`)
      if (!holdBack) console.log(JSON.stringify(payload.embeds[0], null, 1))
      continue
    }
    if (holdBack) {
      if (!existing) { await savePost({ game_id: game.id, message_id: null, content_hash: hash }); seeded++ }
      continue
    }

    // A row with no message id means one of two things, told apart by the hash: a real hash
    // is a game deliberately held back (a first run's older games, or --seed), while an
    // EMPTY hash is a claim the edge function staked and never completed — it deletes its
    // own claim when a post fails, so this only survives if that function died mid-flight.
    // The first is left alone; the second is ours to finish.
    if (existing != null && existing.message_id == null && existing.content_hash !== '') { unchanged++; continue }

    if (existing?.message_id) {
      if (existing.content_hash === hash) { unchanged++; continue }
      const { gone } = await editMessage(existing.message_id, payload)
      if (!gone) {
        await savePost({ game_id: game.id, message_id: existing.message_id, content_hash: hash })
        updated++
        console.log(`✏️  Updated ${game.game_date} — ${recap.headline}`)
        await sleep(SEND_GAP_MS)
        continue
      }
      console.warn(`⚠️  Message for ${game.game_date} was deleted in Discord — posting a fresh one.`)
    }

    const msg = await createMessage(payload)
    await savePost({ game_id: game.id, message_id: msg.id, content_hash: hash })
    posted++
    console.log(`✅ Posted ${game.game_date} — ${recap.headline}`)
    await sleep(SEND_GAP_MS)
  }

  if (DRY_RUN) console.log('\n(dry run — nothing was sent)')
  else console.log(`Done: ${posted} posted, ${updated} updated, ${unchanged} unchanged${seeded ? `, ${seeded} recorded without posting` : ''}.`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })

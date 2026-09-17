#!/usr/bin/env node
/**
 * post-wpbl-bluesky-game-start.ts: posts a "starting soon" reminder for a WPBL game to Bluesky.
 *
 * THE PRE-GAME TWIN OF post-wpbl-bluesky-recaps.ts. Same account, same "publish once, no edit,
 * no undo" discipline, same league-calendar-over-feed correction on the start time. What differs
 * is the window, and the difference runs the opposite way.
 *
 * 1. IT POSTS BEFORE THE GAME, ONCE, AND NEVER AFTER IT STARTS. The recap WAITS for a final to
 *    settle. This publishes only while a game is still `scheduled` and its first pitch is inside
 *    a short window ahead (LEAD_MIN) and not already past by more than a little (GRACE_MIN). A
 *    permanent "first pitch soon" left over a game already in the 5th is the whole failure this
 *    is shaped to avoid, and Bluesky has no edit to take it back with.
 *
 * 2. NO CARD, so no font subsetting and no rasteriser: a reminder is prose. The box-score image
 *    is the recap's problem.
 *
 * 3. NO SEED, NO BACKFILL. The recap needs a seed run so switching it on does not dump a season
 *    of finals onto the timeline. Here the window itself is the guard: only games about to start
 *    are ever eligible, so there is no backlog to flood. Switching this on posts the next game
 *    about to start, which is the point.
 *
 * THE START TIME IS CORRECTED THE SAME WAY EVERY OTHER SURFACE CORRECTS IT: applyLeagueStartTimes
 * puts the league's own calendar (wpbl_site_games) and the rain-delay map over the feed's
 * `start_time`, because the feed can be an hour stale on a game it published days ago, and a
 * reminder is the one surface where being an hour early is worse than saying nothing.
 *
 * WHAT ACTUALLY STARTS THIS is wpbl_bluesky_start_nudge() on pg_cron, not the workflow's
 * schedule line: GitHub runs this repo's `schedule` events 130 to 452 minutes late, which a
 * ~25-minute window cannot survive. The nudge is coarse and this job is the only decider; see the
 * migration.
 *
 * IT NEVER REPLIES, QUOTES, OR MENTIONS ANYBODY. Same rule as the recap poster and the mention
 * watcher: posting our own reminders to our own timeline is the whole of what any of them may do.
 *
 * Usage:
 *   npm run bluesky-game-start -- --dry-run   # render the post(s) to the log, publish nothing
 *   npm run bluesky-game-start                # publish whatever is in-window
 *   npm run bluesky-game-start -- --now       # ignore the window (post the next scheduled game)
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BLUESKY_IDENTIFIER, BLUESKY_APP_PASSWORD.
 * The service-role key is required to publish: wpbl_bluesky_start_posts is RLS'd with no policies,
 * so any other key reads it as empty, which this job would take to mean nothing has been posted.
 */
import { createClient } from '@supabase/supabase-js'
// @ts-expect-error: no types installed for `ws`; it is only handed to supabase-js below.
import ws from 'ws'
import { buildGameStartPost } from '../src/wpbl/derive/blueskyGameStart'
import { linkFacets, tagFacets, graphemes } from '../src/wpbl/derive/blueskyRecap'
import { seriesContext } from '../src/wpbl/derive/series'
import { applyLeagueStartTimes, type PublishedStart } from '../src/wpbl/startTimes'
import { wpblGameShortPath } from '../src/wpbl/routes'
import type { WpblGame, WpblTeam } from '../src/wpbl/types'

// ─── Config ─────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const SUPABASE_KEY = SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const BSKY_ID = (process.env.BLUESKY_IDENTIFIER ?? '').trim()
const BSKY_PASSWORD = (process.env.BLUESKY_APP_PASSWORD ?? '').trim()

const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')
const NOW = args.has('--now')

// How far before first pitch a reminder may go out. Matches the push reminder's DEFAULT_LEAD_MIN
// (scripts/send-wpbl-game-start.mjs), so the two surfaces agree on what "starting soon" means.
const LEAD_MIN = 30
// How far past first pitch a game may still be posted. A little grace so a nudge or run that
// lands a couple of minutes late still fires; past this the game has started and a reminder is a
// lie in public, so it is closed unposted instead.
const GRACE_MIN = 10

// The single hub venue sits in U.S. Central time; game start_time is a flat wall clock there
// (mirrors src/wpbl/constants.ts gameStartMs and the .mjs push sender).
const WPBL_TZ = 'America/Chicago'
const TZ_LABEL = 'CT'

// One game at a time, with a gap. A doubleheader is the busiest this ever gets.
const SEND_GAP_MS = 2_000

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌  Set SUPABASE_URL and a Supabase key before running.')
  process.exit(1)
}
// Same reasoning as the recap poster: the posts table is invisible to the anon key, and
// "invisible" and "empty" read the same. A real run on that could republish.
if (!SERVICE_KEY && !DRY_RUN) {
  console.error('❌  Publishing needs SUPABASE_SERVICE_ROLE_KEY: wpbl_bluesky_start_posts is service-role only, and with any other key this job cannot tell what it has already posted.')
  process.exit(1)
}
if ((!BSKY_ID || !BSKY_PASSWORD) && !DRY_RUN) {
  console.error('❌  Set BLUESKY_IDENTIFIER (the full handle, no @) and BLUESKY_APP_PASSWORD (an App Password from Settings, never the account password).')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws },
})

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ─── Time ─────────────────────────────────────────────────────────────────────

/**
 * The true UTC instant (epoch ms) of a game's first pitch: the stored "H:MM AM/PM" wall clock
 * read as Central, DST-safe. Identical math to the client's gameStartMs and the push sender's,
 * replicated rather than imported because constants.ts pulls the club logos in as Vite assets and
 * this is a plain Node bundle. Null when there is no valid start time.
 */
function gameStartMs(gameDate: string, startTime: string | null): number | null {
  if (!startTime) return null
  const m = String(startTime).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!m) return null
  let h = parseInt(m[1], 10) % 12
  if (/pm/i.test(m[3])) h += 12
  const min = parseInt(m[2], 10)
  const [y, mo, d] = gameDate.split('-').map(Number)
  const naive = Date.UTC(y, mo - 1, d, h, min)
  const ref = new Date(naive)
  const offset = new Date(ref.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
    - new Date(ref.toLocaleString('en-US', { timeZone: WPBL_TZ })).getTime()
  return naive + offset
}

/** Central yesterday, today and tomorrow, as the YYYY-MM-DD dates game_date holds. A late-night
 *  game is still in the lingering half of the window after Central midnight, and an early one is
 *  in the lead window the evening before, so both neighbours are in range. */
function scheduleDays(): string[] {
  const day = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA', { timeZone: WPBL_TZ })
  return [day(-1), day(0), day(1)]
}

// ─── Bluesky ────────────────────────────────────────────────────────────────

interface Session { jwt: string; did: string }

async function login(): Promise<Session> {
  const res = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: BSKY_ID, password: BSKY_PASSWORD }),
  })
  const body = await res.json().catch(() => null) as any
  if (!res.ok) throw new Error(`Bluesky refused the session (${res.status}) ${body?.error ?? ''}: ${body?.message ?? ''}`)
  return { jwt: body.accessJwt, did: body.did }
}

async function publish(session: Session, post: { text: string; url: string }) {
  const record = {
    $type: 'app.bsky.feed.post',
    text: post.text,
    createdAt: new Date().toISOString(),
    langs: ['en'],
    facets: [...linkFacets(post.text, post.url), ...tagFacets(post.text, 'wpbl')],
  }
  const res = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.jwt}` },
    body: JSON.stringify({ repo: session.did, collection: 'app.bsky.feed.post', record }),
  })
  const body = await res.json().catch(() => null) as any
  if (!res.ok) throw new Error(`Bluesky refused the post (${res.status}): ${body?.message ?? JSON.stringify(body)}`)
  return { uri: body.uri as string, cid: body.cid as string }
}

// ─── Data ───────────────────────────────────────────────────────────────────

async function main() {
  const days = scheduleDays()

  const [{ data: games }, { data: teamRows }, { data: published }] = await Promise.all([
    supabase.from('wpbl_games').select('*').order('game_date'),
    supabase.from('wpbl_teams').select('*'),
    supabase.from('wpbl_site_games').select('game_date, start_time, home_team_id, away_team_id').in('game_date', days),
  ])
  if (!games?.length) { console.log('No games.'); return }

  const teams = new Map<string, WpblTeam>((teamRows ?? []).map((t: WpblTeam) => [t.id, t]))
  const clubName = (id: string) => {
    const t = teams.get(id)
    return t ? `${t.city} ${t.name}` : '???'
  }

  // The league's own calendar and the rain-delay map over the feed's start time, applied to the
  // scheduled rows only. Same rule as the section and the push sender.
  const corrected = applyLeagueStartTimes(games as WpblGame[], (published ?? []) as PublishedStart[])

  const { data: known, error: knownErr } = await supabase
    .from('wpbl_bluesky_start_posts').select('game_id, posted_at, skipped_reason')
  if (knownErr) throw new Error(`Reading wpbl_bluesky_start_posts failed (has the migration run?): ${knownErr.message}`)
  const rows = new Map((known ?? []).map((r: any) => [r.game_id, r]))

  const now = Date.now()

  // Scheduled games on the days in range, not yet resolved either way, with a valid start.
  const candidates = corrected
    .filter(g => g.status === 'scheduled' && days.includes(g.game_date))
    .filter(g => { const r = rows.get(g.id); return !r?.posted_at && !r?.skipped_reason })
    .map(g => ({ game: g, startMs: gameStartMs(g.game_date, g.start_time) }))
    .filter((g): g is { game: WpblGame; startMs: number } => g.startMs !== null)
    .sort((a, b) => a.startMs - b.startMs)

  // In-window: first pitch is soon and not already past by more than the grace. --now takes the
  // single nearest upcoming game regardless, for a deliberate manual post.
  const inWindow = candidates.filter(({ startMs }) => {
    const minutesToStart = (startMs - now) / 60_000
    return minutesToStart <= LEAD_MIN && minutesToStart >= -GRACE_MIN
  })
  const due = NOW ? candidates.slice(0, 1) : inWindow

  if (!due.length) {
    console.log(`Nothing in window. ${candidates.length} scheduled game(s) nearby.`)
    if (!DRY_RUN) await closeMissed(candidates, now)
    return
  }

  const session = DRY_RUN ? null : await login()

  for (const { game, startMs } of due) {
    const ctx = seriesContext(game, corrected as WpblGame[], teams)
    // Short /g/<code> form (schemeless; linkFacets restores https). It 302s to the game's
    // canonical page and is shorter than the readable slug, leaving room for the #wpbl tag.
    const url = `sportydolphin.fun${wpblGameShortPath(game)}`
    const post = buildGameStartPost({
      away: clubName(game.away_team_id),
      home: clubName(game.home_team_id),
      startTime: game.start_time,
      tzLabel: TZ_LABEL,
      url,
      series: ctx ? { label: ctx.label, gameNumber: ctx.gameNumber, line: ctx.line, stakes: ctx.stakes } : null,
    })

    const mins = Math.round((startMs - now) / 60_000)
    if (DRY_RUN) {
      console.log(`\n--- would post (${graphemes(post.text)}/300, first pitch in ${mins} min) ---\n${post.text}\n`)
      continue
    }

    const { uri, cid } = await publish(session!, post)
    const { error } = await supabase.from('wpbl_bluesky_start_posts')
      .upsert({ game_id: game.id, posted_at: new Date().toISOString(), post_uri: uri, post_cid: cid }, { onConflict: 'game_id' })
    // The post exists whatever happens next. Failing to record it would republish the game on the
    // next run, so this is loud rather than swallowed.
    if (error) console.error(`❌  Posted ${uri} but could not record it, which means the next run would post it AGAIN: ${error.message}`)
    console.log(`✅  Posted ${clubName(game.away_team_id)} at ${clubName(game.home_team_id)}: ${uri}`)
    await sleep(SEND_GAP_MS)
  }

  if (!DRY_RUN) await closeMissed(candidates, now)
}

/** Close, unposted, any candidate whose window has passed, so the pending set does not carry
 *  games that can never be posted. */
async function closeMissed(candidates: { game: WpblGame; startMs: number }[], now: number) {
  const passed = candidates.filter(({ startMs }) => (startMs - now) / 60_000 < -GRACE_MIN)
  if (!passed.length) return
  const { error } = await supabase.from('wpbl_bluesky_start_posts').upsert(
    passed.map(({ game }) => ({ game_id: game.id, skipped_reason: 'window passed before a run posted it' })),
    { onConflict: 'game_id' },
  )
  if (error) console.error(`⚠️   Could not close ${passed.length} missed game(s): ${error.message}`)
  else console.log(`Closed ${passed.length} game(s) whose window had passed.`)
}

main().catch(err => {
  console.error(`❌  ${err?.stack ?? err}`)
  process.exit(1)
})

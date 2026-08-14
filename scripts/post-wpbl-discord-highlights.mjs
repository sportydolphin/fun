#!/usr/bin/env node
/**
 * post-wpbl-discord-highlights.mjs — posts each new WPBL game highlight reel into the fan
 * server's highlights channel, once, as it appears on the league's YouTube channel.
 *
 * It does not talk to YouTube. scripts/sync-wpbl-youtube.mjs already mirrors the channel's
 * uploads into `wpbl_videos` (classifying each one and resolving highlight titles to the
 * game they recap), so this job's whole world is that table: find the highlight rows we
 * have not posted, send them, remember that we did. Running it as the step after the sync
 * in the same workflow means a reel reaches Discord in the same pass that discovers it.
 *
 * Why a webhook (not a bot): send-only HTTP, no token, no gateway, nothing to keep running
 * — the same reasoning as update-wpbl-discord-board.mjs and post-wpbl-discord-recaps.ts.
 * This one posts to its OWN channel, so it takes its own webhook URL
 * (DISCORD_HIGHLIGHTS_WEBHOOK_URL) rather than sharing the recap channel's.
 *
 * Why plain JS and not TypeScript like the recap poster: that one is TS so it can import
 * the site's recap engine and render a box score identically in both places. A highlight
 * message is a line of text and a URL — there is nothing to share, so there is nothing to
 * bundle.
 *
 * The message is deliberately a bare YouTube URL on its own line: Discord unfurls that
 * into a playable inline player, which is the entire point of a highlights channel. The
 * link back to the site is markdown, because markdown links do NOT unfurl — a second
 * auto-embed would push the video player down the message.
 *
 * It never backfills. The first run against an empty posts table posts only the newest
 * reel and quietly records every older one as handled, so switching the job on puts one
 * video in the channel rather than a season of them.
 *
 * Usage:
 *   npm run discord-highlights -- --dry-run   # render to stdout, post nothing
 *   npm run discord-highlights                # post whatever is new
 *   npm run discord-highlights -- --seed      # record every reel as handled, post nothing
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DISCORD_HIGHLIGHTS_WEBHOOK_URL.
 * The service-role key is required to post: wpbl_videos is public, but
 * wpbl_discord_highlight_posts is service-role only and any other key reads it as empty —
 * which this job would take to mean "nothing posted yet" and repost the lot. --dry-run
 * sends nothing, so it runs on the anon key and says what it cannot see.
 */

import { createClient } from '@supabase/supabase-js'
// supabase-js builds a realtime client even though nothing here subscribes, and Node < 22
// has no global WebSocket — so it needs `ws` handed to it or it throws at construction.
// Same line, same reason, as the sibling Discord/reminder scripts.
import ws from 'ws'

// ─── Config ─────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const SUPABASE_KEY = SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const WEBHOOK_URL = (process.env.DISCORD_HIGHLIGHTS_WEBHOOK_URL ?? '').trim()
const SITE = 'https://sportydolphin.fun'

const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')
const SEED = args.has('--seed')

// How far back an unposted reel stays eligible. The league uploads a game's highlights
// within a day or so of the final, and the sync only carries the recent window anyway —
// this is the guard that stops a reel the job somehow missed from surfacing in the channel
// a fortnight late, looking like news.
const WINDOW_DAYS = 4

// A normal run posts zero or one video. The gap only matters on a first seeding run.
const SEND_GAP_MS = 400

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌  Set SUPABASE_URL (or VITE_SUPABASE_URL) and a Supabase key before running')
  process.exit(1)
}
if (!WEBHOOK_URL && !DRY_RUN && !SEED) {
  console.error('❌  Set DISCORD_HIGHLIGHTS_WEBHOOK_URL (the full https://discord.com/api/webhooks/<id>/<token> for the highlights channel)')
  process.exit(1)
}
if (!SERVICE_KEY && !DRY_RUN) {
  console.error('❌  Posting needs SUPABASE_SERVICE_ROLE_KEY: wpbl_discord_highlight_posts is service-role only, and with any other key this job cannot tell what it has already posted.')
  process.exit(1)
}
if (!SERVICE_KEY) {
  console.warn('⚠️   No service-role key — wpbl_discord_highlight_posts is invisible to this key, so every video below will read as new regardless of what has actually been posted.')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws },
})

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ─── Discord ────────────────────────────────────────────────────────────────

async function discord(path, init) {
  const res = await fetch(`${WEBHOOK_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (res.status === 429) {
    const retryMs = Math.min(10_000, Number((await res.clone().json().catch(() => ({}))).retry_after ?? 1) * 1000)
    console.warn(`⚠️   Rate limited, waiting ${retryMs}ms`)
    await sleep(retryMs)
    return discord(path, init)
  }
  return res
}

/** `?wait=true` makes Discord return the created message, which is how we learn its id. */
async function createMessage(payload) {
  const res = await discord('?wait=true', { method: 'POST', body: JSON.stringify(payload) })
  if (!res.ok) throw new Error(`Post failed (${res.status}): ${await res.text()}`)
  return await res.json()
}

// ─── Message ────────────────────────────────────────────────────────────────

/** "2026-08-13" → "August 13" — the date the game was played, not the upload date. */
function prettyDate(iso) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

/**
 * The matchup line, preferring the matched game row (authoritative) and falling back to
 * whatever the sync parsed out of the title. Falls back again to the raw title, so a reel
 * we couldn't resolve still gets posted rather than silently skipped.
 */
function headline(video, game, teams) {
  const nameOf = (id) => {
    const t = teams.get(id)
    return t ? `${t.city} ${t.name}` : null
  }
  const away = nameOf(game?.away_team_id ?? video.away_hint)
  const home = nameOf(game?.home_team_id ?? video.home_hint)
  const date = prettyDate(game?.game_date ?? video.game_date_hint)
  if (!away || !home) return video.title
  return `${away} @ ${home}${date ? ` · ${date}` : ''}`
}

/**
 * What lands in the channel. Note what is deliberately absent: the final score. The recap
 * channel already posts box scores; someone opening the highlights channel is here to
 * watch the game, and a scoreline above the player spoils it. The box score is one
 * markdown click away for anyone who wants it.
 */
function buildMessage(video, game, teams) {
  const lines = [`🎬 **Highlights — ${headline(video, game, teams)}**`]
  if (game) lines.push(`[Box score & recap](${SITE}/wpbl?game=${game.id})`)
  // Bare URL, last, on its own line: this is the one Discord expands into the player.
  lines.push(`https://www.youtube.com/watch?v=${video.video_id}`)
  return {
    // A highlight should never ping a channel.
    allowed_mentions: { parse: [] },
    content: lines.join('\n'),
  }
}

// ─── Data ───────────────────────────────────────────────────────────────────

/** Has this job ever recorded anything? An empty table means a first run, which posts only
 *  the newest reel (see the header). */
async function hasAnyPost() {
  const { data, error } = await supabase.from('wpbl_discord_highlight_posts').select('video_id').limit(1)
  // Same reasoning as loadPosts: a dry run has to work before the migration is applied,
  // and "no table" is simply "nothing posted yet" when we are sending nothing.
  if (error) {
    if (DRY_RUN) return false
    throw new Error(`Reading wpbl_discord_highlight_posts failed (has the migration run?): ${error.message}`)
  }
  return (data ?? []).length > 0
}

async function loadPosts(videoIds) {
  if (!videoIds.length) return new Set()
  const { data, error } = await supabase
    .from('wpbl_discord_highlight_posts')
    .select('video_id')
    .in('video_id', videoIds)
  if (error) {
    // A dry run is the thing you want to do BEFORE applying the migration — it sends
    // nothing, so it can just report every video as new. A real run cannot.
    if (DRY_RUN) {
      console.warn(`⚠️   No wpbl_discord_highlight_posts yet (${error.message}) — treating every video as new.`)
      return new Set()
    }
    throw new Error(`Reading wpbl_discord_highlight_posts failed (has the migration run?): ${error.message}`)
  }
  return new Set((data ?? []).map(r => r.video_id))
}

async function savePost(row) {
  const { error } = await supabase.from('wpbl_discord_highlight_posts').upsert(row)
  if (error) throw new Error(`Persisting the post for ${row.video_id} failed: ${error.message}`)
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()

  // --seed deliberately ignores the window: its whole job is to mark the back catalogue
  // handled, and anything it leaves out would post on the next real run.
  let query = supabase
    .from('wpbl_videos')
    .select('video_id, title, published_at, kind, game_id, away_hint, home_hint, game_date_hint')
    .eq('kind', 'highlight')
    .order('published_at', { ascending: true })
  if (!SEED) query = query.gte('published_at', cutoff)

  const { data: videoRows, error: vidErr } = await query
  if (vidErr) throw new Error(`Loading wpbl_videos failed: ${vidErr.message}`)
  const videos = videoRows ?? []
  if (!videos.length) { console.log('No highlight reels in the window — nothing to do.'); return }

  const { data: teamRows, error: teamErr } = await supabase.from('wpbl_teams').select('id, city, name, abbr')
  if (teamErr) throw new Error(`Loading teams failed: ${teamErr.message}`)
  const teams = new Map((teamRows ?? []).map(t => [t.id, t]))

  const gameIds = [...new Set(videos.map(v => v.game_id).filter(Boolean))]
  const games = new Map()
  if (gameIds.length) {
    const { data: gameRows, error: gameErr } = await supabase
      .from('wpbl_games')
      .select('id, game_date, home_team_id, away_team_id')
      .in('id', gameIds)
    if (gameErr) throw new Error(`Loading games failed: ${gameErr.message}`)
    for (const g of gameRows ?? []) games.set(g.id, g)
  }

  const posted = await loadPosts(videos.map(v => v.video_id))

  // A first run has no history to reason from, so it takes the newest reel only. Every run
  // after this one can trust the table: an unposted highlight is simply new.
  const firstRun = !(await hasAnyPost())
  const newestId = videos[videos.length - 1]?.video_id
  if (firstRun && !SEED) {
    console.log(`First run — posting only the newest reel, recording ${videos.length - 1} older one(s) as handled.`)
  }

  let sent = 0, seeded = 0, skipped = 0
  for (const video of videos) {
    if (posted.has(video.video_id)) { skipped++; continue }
    const game = video.game_id ? games.get(video.game_id) ?? null : null
    const holdBack = SEED || (firstRun && video.video_id !== newestId)
    const payload = buildMessage(video, game, teams)

    if (DRY_RUN) {
      console.log(`\n── ${video.published_at.slice(0, 10)}  [${holdBack ? 'would record as handled, NOT posted' : 'WOULD POST'}]`)
      if (!holdBack) console.log(payload.content)
      continue
    }
    if (holdBack) {
      await savePost({ video_id: video.video_id, message_id: null, game_id: video.game_id, title: video.title })
      seeded++
      continue
    }

    const msg = await createMessage(payload)
    await savePost({ video_id: video.video_id, message_id: msg.id, game_id: video.game_id, title: video.title })
    sent++
    console.log(`✅  Posted ${video.title}`)
    await sleep(SEND_GAP_MS)
  }

  if (DRY_RUN) console.log('\n(dry run — nothing was sent)')
  else console.log(`Done: ${sent} posted, ${skipped} already posted${seeded ? `, ${seeded} recorded without posting` : ''}.`)
}

main().catch(err => { console.error('❌ ', err.message); process.exit(1) })

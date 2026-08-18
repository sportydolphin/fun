#!/usr/bin/env node
/**
 * sync-wpbl-substack.ts: mirror an independent writer's WPBL coverage into Supabase.
 *
 * Source: "towards a more perfect game: women's baseball & the wpbl" by mary mustard
 * (towardsamoreperfectgame.substack.com). She is not affiliated with us or the league; she
 * is a writer and amateur ballplayer from Albany who has been covering this season closely.
 *
 * WHAT THIS DOES NOT DO: store her writing. The RSS feed hands over the complete article
 * body, and this job reads it for two narrow purposes, finding the names of rostered players
 * and clubs in it and counting the clips embedded in it, and then throws it away. What lands
 * in the database is a headline, a dek, a cover image, a word count, a clip count and a link
 * to her post. Every surface in the app opens that link. The point of the feature is to send
 * readers to her, not to keep them from having to go.
 *
 * Two sources, because they carry different things:
 *   - the archive API is COMPLETE (every post, not a recent window) and carries the tags,
 *     word count and a stable numeric id, so it drives the list and the upsert key;
 *   - the RSS feed carries the body, so it drives entity matching, for the recent window
 *     it covers. An older post simply keeps whatever matches it already had.
 *
 * World Cup posts are skipped entirely. Roughly half her output is about the Women's
 * Baseball World Cup, which this section has no teams, players or games for, so a card
 * about it would be a card whose every link is dead. See isWpblPost() in derive/articles.ts.
 *
 * Why TypeScript: every judgement call here (which posts count, which names are real, which
 * game a recap belongs to) lives in src/wpbl/derive/articles.ts so it can be unit tested,
 * the same arrangement as post-wpbl-discord-recaps.ts and the recap engine. This script is
 * bundled with esbuild before it runs (see the npm script and the workflow).
 *
 * Usage:
 *   npm run substack-sync -- --dry-run   # print what would be written, write nothing
 *   npm run substack-sync                # upsert
 *
 * Required env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY.
 * --dry-run needs no service-role key: everything it reads is public.
 */
import { createClient } from '@supabase/supabase-js'
// @ts-expect-error: no types installed for `ws`; it is only handed to supabase-js below.
import ws from 'ws'
import {
  ARCHIVE_PAGE_SIZE, archiveUrl, FEED_URL, SUBSTACK_HOST,
  isWpblPost, matchGame, matchPlayers, matchTeams, parseFeed, readMinutes,
} from '../src/wpbl/derive/articles'
import type { WpblGame, WpblPlayer, WpblTeam } from '../src/wpbl/types'

// ─── Config ─────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run')
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
// A real run needs the service-role key: wpbl_articles is public to read and owner-only to
// write, so the anon key gets all the way through the fetching and matching and is then
// refused by RLS on the final upsert. Checked up front rather than discovered at the end.
// A dry run writes nothing, so the anon key is enough for the reads it does.
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const SUPABASE_KEY = SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''

// Identify the job honestly. This is one person's personal Substack, not a platform API:
// a contactable UA is the least we owe a site we poll hourly, and it means she can see
// what we are in her logs rather than an anonymous scraper.
const UA = 'sportydolphin.fun WPBL reading feed (+https://sportydolphin.fun/wpbl)'

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌  Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY before running')
  process.exit(1)
}
if (!DRY_RUN && !SERVICE_KEY) {
  console.error('❌  A write run needs SUPABASE_SERVICE_ROLE_KEY. RLS will refuse the upsert ' +
    'on any other key. Use --dry-run to check the matching without writing.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  // Node < 22 has no native WebSocket; supabase-js builds a realtime client on
  // construction even though this job only ever does plain reads and an upsert.
  realtime: { transport: ws },
})

// ─── Fetching ───────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** GET with a couple of polite retries. Substack is generally reliable, but a personal
 *  publication behind Cloudflare occasionally answers a datacenter IP with a 5xx, and one
 *  transient blip should not empty a rail. */
async function get(url: string, accept: string): Promise<string> {
  let last = ''
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept } })
      if (res.ok) return await res.text()
      last = `${res.status} ${res.statusText}`
    } catch (e) {
      last = e instanceof Error ? e.message : String(e)
    }
    console.warn(`   ${url} → ${last}${attempt < 3 ? ', retrying…' : ''}`)
    if (attempt < 3) await sleep(2000 * attempt)
  }
  throw new Error(`${url} failed after retries: ${last}`)
}

/** One post as the archive API describes it. Only the fields we actually read. */
interface ArchivePost {
  id: number
  slug: string
  title: string
  subtitle?: string | null
  post_date: string
  canonical_url?: string | null
  cover_image?: string | null
  wordcount?: number | null
  audience?: string | null
  postTags?: { name?: string | null }[] | null
}

/** The parts of a row we already hold that a body-less run must preserve. */
interface StoredArticle {
  post_id: number
  game_id: string | null
  team_ids: string[]
  player_ids: string[]
  video_count: number | null
}

/** Every post, paged. Stops on the first short page, and at a hard ceiling so a malformed
 *  response that keeps returning full pages can't spin here forever. */
async function fetchArchive(): Promise<ArchivePost[]> {
  const all: ArchivePost[] = []
  for (let offset = 0; offset < 1000; offset += ARCHIVE_PAGE_SIZE) {
    const raw = await get(archiveUrl(offset), 'application/json')
    const json: unknown = JSON.parse(raw)
    if (!Array.isArray(json)) throw new Error('Archive API did not return a list')
    const page = json as ArchivePost[]
    all.push(...page)
    if (page.length < ARCHIVE_PAGE_SIZE) break
  }
  return all
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const archive = await fetchArchive()
  console.log(`📚  ${archive.length} posts in the archive`)

  const wpblPosts = archive.filter(p => isWpblPost((p.postTags ?? []).map(t => t?.name ?? '')))
  console.log(`⚾  ${wpblPosts.length} tagged WPBL (${archive.length - wpblPosts.length} skipped: World Cup and other beats)`)
  if (wpblPosts.length === 0) { console.log('Nothing to upsert.'); return }

  // Bodies, for entity matching, and the video counts taken from them. Keyed by URL because
  // that is the only field the RSS item and the archive row reliably share (the feed carries
  // no post id).
  const feed = await fetchFeed()
  const feedByUrl = new Map(feed.map(f => [f.link.replace(/\/$/, ''), f]))
  console.log(`📰  ${feed.length} posts in the RSS window (bodies available for matching)`)

  // What we already worked out about each post, for the posts we can no longer read.
  //
  // The RSS feed carries about twenty posts. Everything older reaches us through the archive
  // API, which has no body in it, so there is nothing to find names or embeds in. Without
  // this, re-running the matcher against an empty body would quietly WIPE a post's players,
  // clubs and video count the moment it aged out of the window: "I Cannot Overstate... Denae
  // Benites" would drop from three players to one (the name in its own headline) a few weeks
  // after publication, and its game link and clip count would go to nothing. Matches are
  // revised only when there is an article to revise them from.
  const stored = new Map((await read<StoredArticle>('wpbl_articles',
    'post_id,game_id,team_ids,player_ids,video_count')).map(r => [Number(r.post_id), r]))

  const [teams, players, games] = await Promise.all([
    read<WpblTeam>('wpbl_teams', 'id,city,name,abbr'),
    read<WpblPlayer>('wpbl_players', 'id,name,team_id'),
    read<WpblGame>('wpbl_games', 'id,game_date,status,home_team_id,away_team_id,home_score,away_score'),
  ])
  console.log(`🗂   ${teams.length} teams, ${players.length} players, ${games.length} games loaded for matching`)

  const rows = []
  for (const p of wpblPosts) {
    const url = (p.canonical_url ?? `https://${SUBSTACK_HOST}/p/${p.slug}`).replace(/\/$/, '')
    const post = feedByUrl.get(url)
    const prior = stored.get(p.id)
    const headline = `${p.title} ${p.subtitle ?? ''}`

    let teamIds: string[]
    let playerIds: string[]
    let gameId: string | null
    let videoCount: number | null

    if (post) {
      // Title included in the matched text: several of her headlines name the player the
      // post is about ("...How Good Denae Benites is Playing...").
      //
      // Players are matched across everything: naming someone once is enough to have written
      // about them. Clubs are stricter, because "mentions the Hunters" and "is about the
      // Hunters" are different claims and the team page only wants the second: headline
      // mentions, a repeat-mention count in the body, or the club of a player named in the
      // headline. That last one is why `players` is handed to matchTeams; see it for why.
      teamIds = matchTeams(headline, post.text, teams, players)
      playerIds = matchPlayers(`${headline} ${post.text}`, players)
      gameId = matchGame({ title: p.title, publishedAt: p.post_date, teamIds }, games)
      videoCount = post.videos
    } else {
      // Out of the RSS window: keep what we knew rather than recomputing from a headline.
      teamIds = prior?.team_ids ?? []
      playerIds = prior?.player_ids ?? []
      gameId = prior?.game_id ?? null
      videoCount = prior?.video_count ?? null
    }

    rows.push({
      post_id: p.id,
      slug: p.slug,
      url,
      title: p.title,
      subtitle: p.subtitle?.trim() || null,
      cover_url: p.cover_image ?? null,
      published_at: p.post_date,
      word_count: p.wordcount ?? null,
      tags: (p.postTags ?? []).map(t => t?.name ?? '').filter(Boolean),
      game_id: gameId,
      team_ids: teamIds,
      player_ids: playerIds,
      video_count: videoCount,
      updated_at: new Date().toISOString(),
    })

    const note = post ? '' : ' (outside the RSS window: keeping stored matches)'
    console.log(`  • ${p.title.slice(0, 64)}`)
    console.log(`      ${readMinutes(p.wordcount, videoCount)} min · ` +
      `${videoCount ?? '?'} clip${videoCount === 1 ? '' : 's'} · ` +
      `teams ${teamIds.join(',') || '—'} · ` +
      `${playerIds.length} player${playerIds.length === 1 ? '' : 's'} · ` +
      `${gameId ? `game ${gameId.slice(0, 8)}` : 'no game'}${note}`)
  }

  if (DRY_RUN) {
    console.log(`\n🔍  Dry run: would upsert ${rows.length} articles. Nothing written.`)
    return
  }

  const { error } = await supabase.from('wpbl_articles').upsert(rows, { onConflict: 'post_id' })
  if (error) throw new Error(`Upsert failed: ${error.message}`)
  const linked = rows.filter(r => r.game_id).length
  console.log(`\n✅  Upserted ${rows.length} articles (${linked} matched to a game)`)
}

/** Re-upserting every post every run is deliberate: she edits titles and covers after
 *  publishing, and re-running the matcher lets an older post pick up players who have since
 *  been added to the roster. The table is tiny, so the cost of being always-current is nil. */
async function read<T>(table: string, columns: string): Promise<T[]> {
  const { data, error } = await supabase.from(table).select(columns)
  if (error) throw new Error(`Loading ${table} failed: ${error.message}`)
  return (data ?? []) as T[]
}

async function fetchFeed() {
  const xml = await get(FEED_URL, 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8')
  return parseFeed(xml)
}

main().catch(err => { console.error('❌ ', err instanceof Error ? err.message : err); process.exit(1) })

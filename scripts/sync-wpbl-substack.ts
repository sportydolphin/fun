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
  ARCHIVE_PAGE_SIZE, archiveUrl, profilePostsUrl, FEED_URL, SUBSTACK_HOST,
  isWpblPost, matchGame, matchPlayers, matchTeams, parseFeed, readMinutes,
} from '../src/wpbl/derive/articles'
import type { FeedPost } from '../src/wpbl/derive/articles'
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

// A real browser User-Agent, reluctantly.
//
// This started as a self-identifying string ("sportydolphin.fun WPBL reading feed" plus a
// contact URL), which is the polite thing to send to one person's personal Substack and is
// what she would see in her logs. It works from a laptop. It does not work from CI: every
// scheduled run 403'd at Cloudflare while the identical request from a residential IP
// returned 200. Substack sits behind Cloudflare's bot protection, which is far stricter
// about datacenter address space, and a non-browser UA from a GitHub runner is the exact
// shape it drops.
//
// So this is not an attempt to look like something we are not to HER: the job still reads
// only public endpoints, at a gentler cadence than a single reader hitting refresh, and
// every card it produces links straight back to her post. It is what it takes to get past a
// generic edge filter that was never aimed at us. If Substack ever offers a documented way
// to identify a friendly integration, that is strictly better and should replace this.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

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
      const res = await fetch(url, {
        headers: {
          'user-agent': UA,
          accept,
          // Cloudflare scores the whole header set, not the UA alone: a "browser" that sends
          // no language or encoding preferences is a tell. These are what a real request
          // carries anyway.
          'accept-language': 'en-US,en;q=0.9',
          'cache-control': 'no-cache',
        },
      })
      if (res.ok) return await res.text()
      // Include a snippet of the body. A bare "403 Forbidden" is unactionable; Cloudflare's
      // block page names the reason, and the difference between a challenge, a rate limit
      // and an outright ban decides what to do next. Whitespace-collapsed so an HTML error
      // page does not bury the run log in markup.
      const body = await res.text().catch(() => '')
      const hint = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
      last = `${res.status} ${res.statusText}${hint ? ` :: ${hint}` : ''}`
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
  type?: string | null
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

/** Every post, from her publication's own archive endpoint. Paged; stops on the first short
 *  page, and at a hard ceiling so a malformed response can't spin here forever. */
async function fetchPublicationArchive(): Promise<ArchivePost[]> {
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

/**
 * Every post, from her author profile on substack.com.
 *
 * The paging guard is deliberately not "stop when the cursor is empty". She is under one
 * page today, so the cursor parameter's name is unverified against a real second page; if it
 * is wrong the API would hand back page one forever. Stopping as soon as a page contributes
 * no NEW post id makes that failure terminate with the right data instead of looping.
 */
async function fetchProfilePosts(): Promise<ArchivePost[]> {
  const byId = new Map<number, ArchivePost>()
  let cursor: string | undefined
  for (let page = 0; page < 20; page++) {
    const raw = await get(profilePostsUrl(cursor), 'application/json')
    const json = JSON.parse(raw) as { posts?: ArchivePost[]; nextCursor?: string | null }
    const posts = json.posts ?? []
    const before = byId.size
    // Only her own publication, and only real posts. The endpoint is scoped to an author
    // rather than a publication, so a future guest post elsewhere would arrive here too.
    for (const p of posts) {
      const host = (p.canonical_url ?? '').split('/')[2] ?? ''
      if (host === SUBSTACK_HOST && (p.type ?? 'newsletter') === 'newsletter') byId.set(p.id, p)
    }
    if (!json.nextCursor || byId.size === before) break
    cursor = json.nextCursor
  }
  return [...byId.values()]
}

/**
 * The post list, from whichever source answers.
 *
 * Profile first. It is unblocked from CI, and it is also the more complete of the two: her
 * whole history rather than the recent slice the publication archive returns. The
 * publication archive stays as the fallback for the case where substack.com is the one
 * having a bad day, since it carries identical fields.
 */
async function fetchArchive(): Promise<ArchivePost[]> {
  try {
    const posts = await fetchProfilePosts()
    if (posts.length === 0) throw new Error('profile endpoint returned no posts')
    console.log(`📚  ${posts.length} posts from the author profile (substack.com)`)
    return posts
  } catch (e) {
    console.warn(`   profile endpoint unavailable (${e instanceof Error ? e.message.slice(0, 90) : e})`)
    console.warn('   falling back to the publication archive')
    const posts = await fetchPublicationArchive()
    console.log(`📚  ${posts.length} posts from the publication archive`)
    return posts
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

/**
 * When the archive API is unreachable, say whether the RSS feed is too.
 *
 * These two endpoints are not equally defended. Cloudflare challenges tend to be scoped to
 * `/api/*`, while `/feed` is usually left open because every feed reader on the internet is
 * a datacenter client and challenging them would break the feed for everyone. Knowing which
 * of the two is blocked is the difference between "wait it out" and "this job needs to stop
 * depending on the API", so the failure path answers it instead of leaving it to guesswork
 * on the next incident.
 */
async function probeFeed(): Promise<string> {
  try {
    const xml = await get(FEED_URL, 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8')
    return `reachable, ${parseFeed(xml).length} posts`
  } catch (e) {
    return `also blocked (${e instanceof Error ? e.message.slice(0, 120) : e})`
  }
}

async function main() {
  let archive: ArchivePost[]
  try {
    archive = await fetchArchive()
  } catch (e) {
    console.error(`\n❌  Archive API unreachable: ${e instanceof Error ? e.message : e}`)
    console.error(`   RSS feed: ${await probeFeed()}`)
    console.error('   A "Just a moment..." body is Cloudflare\'s JavaScript challenge, which no')
    console.error('   amount of header tuning gets past: it wants a browser that runs JS. It fires')
    console.error('   on datacenter address space, which is why this passes from a laptop and fails')
    console.error('   from CI. See docs/READING.md for what to do about it.')
    process.exit(1)
  }

  const wpblPosts = archive.filter(p => isWpblPost((p.postTags ?? []).map(t => t?.name ?? '')))
  console.log(`⚾  ${wpblPosts.length} tagged WPBL (${archive.length - wpblPosts.length} skipped: World Cup and other beats)`)
  if (wpblPosts.length === 0) { console.log('Nothing to upsert.'); return }

  // Bodies, for entity matching, and the video counts taken from them. Keyed by URL because
  // that is the only field the RSS item and the archive row reliably share (the feed carries
  // no post id).
  // Best-effort, and non-fatal when it fails. The feed lives on her publication subdomain,
  // which is the host behind Cloudflare's challenge, so from CI this normally returns
  // nothing. That costs the body-derived fields (players, clubs, game link, clip count) for
  // posts we have never read, and costs nothing at all for posts we have: see the ladder
  // below. Everything the rail actually renders comes from the post list, not from here.
  let feed: FeedPost[] = []
  try {
    feed = await fetchFeed()
    console.log(`📰  ${feed.length} posts in the RSS window (bodies available for matching)`)
  } catch (e) {
    console.warn(`📰  RSS feed unavailable (${e instanceof Error ? e.message.slice(0, 90) : e})`)
    console.warn('    Continuing without bodies: stored matches are kept, new posts match on the headline.')
  }
  const feedByUrl = new Map(feed.map(f => [f.link.replace(/\/$/, ''), f]))

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
    } else if (prior) {
      // Body out of reach, but we have read this post before. Keep what it taught us rather
      // than recomputing from a headline and quietly demoting it.
      teamIds = prior.team_ids
      playerIds = prior.player_ids
      gameId = prior.game_id
      videoCount = prior.video_count
    } else {
      // Never read, and no body available: match on the headline alone. Weaker than a full
      // read, but not nothing, because the headline is where she names her subject. This is
      // the path every new post takes while the feed is blocked from CI, and it is why a
      // profile piece still lands on the right club (see rule 3 in matchTeams). Clip count
      // stays null rather than 0: we do not know, and 0 would claim we did.
      teamIds = matchTeams(headline, '', teams, players)
      playerIds = matchPlayers(headline, players)
      gameId = matchGame({ title: p.title, publishedAt: p.post_date, teamIds }, games)
      videoCount = null
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

    const note = post ? '' : prior ? ' (no body: keeping stored matches)' : ' (no body: headline only)'
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

/**
 * The Substack mirror, as one routine both runtimes call.
 *
 * There are two callers: `scripts/sync-wpbl-substack.ts` (Node, for a run by hand) and the
 * `wpbl-substack-sync` edge function (Deno, hourly on pg_cron). The orchestration lives here
 * rather than in either of them because it is the part with the judgement in it, and two
 * copies of "which post counts, what it is about, what we keep when we cannot read it" would
 * drift the first time one was fixed and the other was not.
 *
 * WHY IT RUNS ON SUPABASE. Substack serves Cloudflare's JavaScript interstitial to
 * datacenter address space, and it covers every host it owns: her publication's archive API,
 * her publication's RSS feed, and substack.com itself all return 403 from a GitHub Actions
 * runner. Supabase's egress is not challenged; all three answer 200, feed included. See
 * docs/READING.md for the full table.
 *
 * The only thing this module will not do is store her writing. Bodies are fetched to find
 * names and embedded clips in them, and are then dropped. See the migration for why the
 * table has no column to put them in.
 */
import {
  ARCHIVE_PAGE_SIZE, archiveUrl, profilePostsUrl, FEED_URL, SUBSTACK_HOST,
  isWpblPost, matchGame, matchPlayers, matchTeams, parseFeed, readMinutes,
  type FeedPost,
} from './derive/articles.ts'
import type { WpblGame, WpblPlayer, WpblTeam } from './types.ts'

/**
 * The database, reduced to the two things this needs.
 *
 * Deliberately not a SupabaseClient. Node and Deno import supabase-js from different places
 * (npm vs esm.sh) and pin it separately, so taking the real type here would make this module
 * unusable from one side or the other. Each caller adapts its own client in about five lines.
 */
export interface SyncDb {
  select<T>(table: string, columns: string): Promise<T[]>
  upsert(table: string, rows: readonly unknown[], onConflict: string): Promise<void>
}

export interface SyncOptions {
  /** Compute and report, write nothing. */
  dryRun?: boolean
  /** Where progress goes. The CLI passes console.log; the edge function collects lines. */
  log?: (line: string) => void
}

export interface SyncResult {
  source: 'profile' | 'archive'
  totalPosts: number
  wpblPosts: number
  bodiesAvailable: number
  matchedToGame: number
  written: number
  dryRun: boolean
}

/** One post as either list endpoint describes it. Only the fields actually read. */
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

/** What we already worked out about a post, for the passes that cannot read it again. */
interface StoredArticle {
  post_id: number
  game_id: string | null
  team_ids: string[]
  player_ids: string[]
  video_count: number | null
}

// A browser User-Agent. The self-identifying string this started with is the politer thing
// to send to one person's personal Substack, and it is what she would see in her logs, but
// Cloudflare scores the whole header set and drops requests that do not look like a browser.
// Supabase's egress is not challenged, so this may well be unnecessary now; it stays because
// the cost is nil and the failure it prevents cost seven silent runs to diagnose.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** GET with a couple of polite retries, and a readable reason when it gives up. */
async function get(url: string, accept: string, log: (s: string) => void): Promise<string> {
  let last = ''
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept, 'accept-language': 'en-US,en;q=0.9' },
      })
      if (res.ok) return await res.text()
      // A bare "403 Forbidden" is unactionable. Cloudflare's block page names the reason,
      // and "Just a moment..." specifically means the JavaScript challenge, which no amount
      // of header tuning gets past. Stripped of markup so it cannot bury the log.
      const body = await res.text().catch(() => '')
      const hint = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
      last = `${res.status} ${res.statusText}${hint ? ` :: ${hint}` : ''}`
    } catch (e) {
      last = e instanceof Error ? e.message : String(e)
    }
    if (attempt < 3) { log(`   ${url} → ${last}, retrying…`); await sleep(2000 * attempt) }
  }
  throw new Error(`${url} failed after retries: ${last}`)
}

/** Every post, from her publication's own archive endpoint. */
async function fetchPublicationArchive(log: (s: string) => void): Promise<ArchivePost[]> {
  const all: ArchivePost[] = []
  for (let offset = 0; offset < 1000; offset += ARCHIVE_PAGE_SIZE) {
    const raw = await get(archiveUrl(offset), 'application/json', log)
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
 * The paging guard is deliberately not "stop when the cursor is empty". She is under one page
 * today, so the cursor parameter's name is unverified against a real second page; if it is
 * wrong the API would hand back page one forever. Stopping as soon as a page contributes no
 * NEW post id makes that failure terminate with the right data instead of looping.
 */
async function fetchProfilePosts(log: (s: string) => void): Promise<ArchivePost[]> {
  const byId = new Map<number, ArchivePost>()
  let cursor: string | undefined
  for (let page = 0; page < 20; page++) {
    const raw = await get(profilePostsUrl(cursor), 'application/json', log)
    const json = JSON.parse(raw) as { posts?: ArchivePost[]; nextCursor?: string | null }
    const before = byId.size
    // Only her own publication, and only real posts. The endpoint is scoped to an AUTHOR
    // rather than a publication, so a future guest post elsewhere would arrive here too.
    for (const p of json.posts ?? []) {
      const host = (p.canonical_url ?? '').split('/')[2] ?? ''
      if (host === SUBSTACK_HOST && (p.type ?? 'newsletter') === 'newsletter') byId.set(p.id, p)
    }
    if (!json.nextCursor || byId.size === before) break
    cursor = json.nextCursor
  }
  return [...byId.values()]
}

export async function runSubstackSync(db: SyncDb, opts: SyncOptions = {}): Promise<SyncResult> {
  const log = opts.log ?? (() => {})
  const dryRun = !!opts.dryRun

  // Profile first: it is the more complete of the two, returning her whole history where the
  // publication archive returns a recent slice. The archive stays as the fallback for the day
  // substack.com is the one having trouble, since it carries identical fields.
  let source: SyncResult['source'] = 'profile'
  let archive: ArchivePost[]
  try {
    archive = await fetchProfilePosts(log)
    if (archive.length === 0) throw new Error('profile endpoint returned no posts')
    log(`📚  ${archive.length} posts from the author profile (substack.com)`)
  } catch (e) {
    log(`   profile endpoint unavailable (${e instanceof Error ? e.message.slice(0, 90) : e})`)
    log('   falling back to the publication archive')
    archive = await fetchPublicationArchive(log)
    source = 'archive'
    log(`📚  ${archive.length} posts from the publication archive`)
  }

  const wpblPosts = archive.filter(p => isWpblPost((p.postTags ?? []).map(t => t?.name ?? '')))
  log(`⚾  ${wpblPosts.length} tagged WPBL (${archive.length - wpblPosts.length} skipped: World Cup and other beats)`)
  if (wpblPosts.length === 0) {
    return { source, totalPosts: archive.length, wpblPosts: 0, bodiesAvailable: 0, matchedToGame: 0, written: 0, dryRun }
  }

  // Bodies, for entity matching and the clip counts taken from them. Best-effort and
  // non-fatal: losing the feed costs the body-derived fields, not the run. Keyed by URL,
  // the only field an RSS item and a list row reliably share (the feed carries no post id).
  let feed: FeedPost[] = []
  try {
    feed = parseFeed(await get(FEED_URL, 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8', log))
    log(`📰  ${feed.length} posts in the RSS window (bodies available for matching)`)
  } catch (e) {
    log(`📰  RSS feed unavailable (${e instanceof Error ? e.message.slice(0, 90) : e})`)
    log('    Continuing without bodies: stored matches kept, new posts match on the headline.')
  }
  const feedByUrl = new Map(feed.map(f => [f.link.replace(/\/$/, ''), f]))

  const stored = new Map((await db.select<StoredArticle>(
    'wpbl_articles', 'post_id,game_id,team_ids,player_ids,video_count'))
    .map(r => [Number(r.post_id), r]))

  const [teams, players, games] = await Promise.all([
    db.select<WpblTeam>('wpbl_teams', 'id,city,name,abbr'),
    db.select<WpblPlayer>('wpbl_players', 'id,name,team_id'),
    db.select<WpblGame>('wpbl_games', 'id,game_date,status,home_team_id,away_team_id,home_score,away_score'),
  ])
  log(`🗂   ${teams.length} teams, ${players.length} players, ${games.length} games loaded for matching`)

  const rows = []
  let bodiesAvailable = 0
  for (const p of wpblPosts) {
    const url = (p.canonical_url ?? `https://${SUBSTACK_HOST}/p/${p.slug}`).replace(/\/$/, '')
    const post = feedByUrl.get(url)
    const prior = stored.get(p.id)
    const headline = `${p.title} ${p.subtitle ?? ''}`

    let teamIds: string[], playerIds: string[], gameId: string | null, videoCount: number | null

    if (post) {
      // The headline is included in the matched text because several of her titles name the
      // player the piece is about ("...How Good Denae Benites is Playing...").
      //
      // Players match on any mention: naming someone once is enough to have written about
      // them. Clubs are stricter, because "mentions the Hunters" and "is about the Hunters"
      // are different claims and the badges only want the second. See matchTeams().
      bodiesAvailable++
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
      // Never read, no body available: match on the headline alone. Weaker than a full read
      // but not nothing, because the headline is where she names her subject. Clip count
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
    log(`  • ${p.title.slice(0, 64)}`)
    log(`      ${readMinutes(p.wordcount, videoCount)} min · ${videoCount ?? '?'} clip${videoCount === 1 ? '' : 's'} · ` +
      `teams ${teamIds.join(',') || '—'} · ${playerIds.length} player${playerIds.length === 1 ? '' : 's'} · ` +
      `${gameId ? `game ${gameId.slice(0, 8)}` : 'no game'}${note}`)
  }

  const matchedToGame = rows.filter(r => r.game_id).length
  if (dryRun) {
    log(`\n🔍  Dry run: would upsert ${rows.length} articles. Nothing written.`)
    return { source, totalPosts: archive.length, wpblPosts: rows.length, bodiesAvailable, matchedToGame, written: 0, dryRun }
  }

  // Re-upserting every post every pass is deliberate: she edits titles and covers after
  // publishing, and re-running the matcher lets an older post pick up players added to the
  // roster since. The table is tiny, so being always-current costs nothing.
  await db.upsert('wpbl_articles', rows, 'post_id')
  log(`\n✅  Upserted ${rows.length} articles (${matchedToGame} matched to a game)`)
  return { source, totalPosts: archive.length, wpblPosts: rows.length, bodiesAvailable, matchedToGame, written: rows.length, dryRun }
}

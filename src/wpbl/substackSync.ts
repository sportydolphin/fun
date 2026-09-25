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
 * datacenter address space, and it covers every host it owns: the publication's archive API,
 * its RSS feed, and substack.com itself all return 403 from a GitHub Actions runner.
 * Supabase's egress is not challenged; all three answer 200, feed included. See
 * docs/READING.md for the full table.
 *
 * ONE PASS PER PUBLICATION (SOURCES in derive/articles.ts): each is listed, filtered by its
 * own rule, read and matched the same way, and every row carries its `source`. One failing
 * publication does not cost the other its run.
 *
 * The only thing this module will not do is store the writing. Bodies are fetched to find
 * names and embedded clips in them, and are then dropped. See the migration for why the
 * table has no column to put them in.
 */
import {
  ARCHIVE_PAGE_SIZE, SOURCES, archiveUrlFor, profilePostsUrlFor, postUrlFor, countVideos,
  dropTranslations, imageCover, matchGame, matchPlayers, matchTeams, parseFeed, readMinutes, teamsInTitle,
  type FeedPost, type SubstackSource,
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

export interface SourceResult {
  source: SubstackSource['key']
  /** Which list endpoint answered, or 'failed' when neither did. */
  list: 'profile' | 'archive' | 'failed'
  totalPosts: number
  wpblPosts: number
  bodiesAvailable: number
  matchedToGame: number
  error?: string
}

export interface SyncResult {
  sources: SourceResult[]
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
  source: string | null
  game_id: string | null
  team_ids: string[]
  player_ids: string[]
  video_count: number | null
}

// A browser User-Agent. A self-identifying string is the politer thing to send to one
// person's personal Substack, and it is what the writer would see in their logs, but
// Cloudflare scores the whole header set and drops requests that do not look like a browser.
// Supabase's egress is not challenged, so this may well be unnecessary; it stays because the
// cost is nil and the failure it prevents took seven silent runs to diagnose.
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

/** Every post, from the publication's own archive endpoint. */
async function fetchPublicationArchive(src: SubstackSource, log: (s: string) => void): Promise<ArchivePost[]> {
  // PAGED BY WHAT CAME BACK, AND ENDED BY AN EMPTY PAGE. Substack answers the FIRST page with
  // 23 posts whatever `limit` asks for, then full pages after it (measured Sep 25, 2026: offsets
  // 0, 23, 46 return 23, 50, 50). This loop used to stop at the first page shorter than the
  // limit, which is always the first page, so every archive read ended at 23 posts and looked
  // like a publication that small.
  const byId = new Map<number, ArchivePost>()
  let offset = 0
  for (let guard = 0; guard < 40; guard++) {
    const raw = await get(archiveUrlFor(src.host, offset), 'application/json', log)
    const json: unknown = JSON.parse(raw)
    if (!Array.isArray(json)) throw new Error('Archive API did not return a list')
    const page = json as ArchivePost[]
    const before = byId.size
    for (const p of page) byId.set(p.id, p)
    // No new ids ends it too, so an API that ignored `offset` could not loop.
    if (page.length === 0 || byId.size === before) break
    offset += page.length
  }
  return [...byId.values()]
}

/**
 * Every post, from the author profile on substack.com.
 *
 * The paging guard is deliberately not "stop when the cursor is empty": if the cursor parameter
 * were ever wrong the API would hand back page one forever. Stopping as soon as a page
 * contributes no NEW post id makes that failure terminate with the right data instead of looping.
 */
async function fetchProfilePosts(src: SubstackSource, log: (s: string) => void): Promise<ArchivePost[]> {
  const byId = new Map<number, ArchivePost>()
  let cursor: string | undefined
  for (let page = 0; page < 20; page++) {
    const raw = await get(profilePostsUrlFor(src.authorUserId!, cursor), 'application/json', log)
    const json = JSON.parse(raw) as { posts?: ArchivePost[]; nextCursor?: string | null }
    const before = byId.size
    // Only this publication, and only real posts. The endpoint is scoped to an AUTHOR rather
    // than a publication, so a guest post elsewhere would arrive here too.
    for (const p of json.posts ?? []) {
      const host = (p.canonical_url ?? '').split('/')[2] ?? ''
      if (host === src.host && (p.type ?? 'newsletter') === 'newsletter') byId.set(p.id, p)
    }
    if (!json.nextCursor || byId.size === before) break
    cursor = json.nextCursor
  }
  return [...byId.values()]
}

/** One post's body, through the single-post API. Null on any failure: a body is an improvement
 *  to the matching, never a reason to fail the run. */
async function fetchPostBody(src: SubstackSource, slug: string, log: (s: string) => void): Promise<FeedPost | null> {
  try {
    const json = JSON.parse(await get(postUrlFor(src.host, slug), 'application/json', log)) as {
      body_html?: string | null; canonical_url?: string | null; title?: string | null
    }
    const html = json.body_html ?? ''
    if (!html) return null
    return {
      link: json.canonical_url ?? '',
      title: json.title ?? '',
      text: html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(),
      videos: countVideos(html),
    }
  } catch {
    return null
  }
}

/** How many never-read posts one run may fetch a body for, one request each. The first run of a
 *  new publication reads its back catalogue a slice at a time rather than in one burst at
 *  somebody's personal Substack; every later run has nothing new to fetch. */
const BODY_FETCHES_PER_RUN = 30

interface Context {
  teams: WpblTeam[]
  players: WpblPlayer[]
  games: WpblGame[]
  stored: Map<number, StoredArticle>
  log: (s: string) => void
}

async function syncSource(src: SubstackSource, ctx: Context): Promise<{ result: SourceResult; rows: unknown[] }> {
  const { teams, players, games, stored, log } = ctx
  log(`\n━━ ${src.publicationName} (${src.authorName})`)

  // Profile first where there is one: it returns the whole history and sits outside the
  // Cloudflare challenge on the publication subdomain. The archive is the fallback.
  //
  // BOTH, MERGED, when both answer. Neither is complete on its own: for mary the profile had 37
  // posts where the archive stopped at 23, and for The Rising Fastball it is the other way round,
  // the profile stopping at the newest 46 of 124, which left out every player profile from before
  // the season. The union by post id is the whole history either way. The archive is best-effort
  // when the profile answered, and the only source when it did not.
  let list: SourceResult['list'] = 'profile'
  const byId = new Map<number, ArchivePost>()
  try {
    if (!src.authorUserId) throw new Error('no author id')
    const profile = await fetchProfilePosts(src, log)
    if (profile.length === 0) throw new Error('profile endpoint returned no posts')
    for (const p of profile) byId.set(p.id, p)
    log(`📚  ${profile.length} posts from the author profile (substack.com)`)
  } catch (e) {
    log(`   profile endpoint unavailable (${e instanceof Error ? e.message.slice(0, 90) : e})`)
    list = 'archive'
  }
  try {
    const fromArchive = await fetchPublicationArchive(src, log)
    const before = byId.size
    for (const p of fromArchive) if (!byId.has(p.id)) byId.set(p.id, p)
    log(`📚  ${fromArchive.length} posts from the publication archive (${byId.size - before} not in the profile)`)
  } catch (e) {
    if (list === 'archive') throw e
    log(`   publication archive unavailable (${e instanceof Error ? e.message.slice(0, 90) : e}); the profile alone`)
  }
  const archive = [...byId.values()]

  // Free posts only. Everything mirrored today is free; a paid post would be a card that opens
  // onto a paywall, which is not what either writer agreed to have featured.
  const listed = archive.filter(p => (p.audience ?? 'everyone') === 'everyone')
  const wpblPosts = dropTranslations(listed).filter(p => src.includes({
    title: p.title, subtitle: p.subtitle, tags: (p.postTags ?? []).map(t => t?.name ?? ''),
  }, players))
  log(`⚾  ${wpblPosts.length} about the league (${archive.length - wpblPosts.length} skipped: other beats, translations)`)
  const base: SourceResult = { source: src.key, list, totalPosts: archive.length, wpblPosts: 0, bodiesAvailable: 0, matchedToGame: 0 }
  if (wpblPosts.length === 0) return { result: base, rows: [] }

  // Bodies, for entity matching and the clip counts taken from them. Best-effort and non-fatal:
  // losing the feed costs the body-derived fields, not the run. Keyed by URL, the only field an
  // RSS item and a list row reliably share (the feed carries no post id).
  let feed: FeedPost[] = []
  try {
    feed = parseFeed(await get(`https://${src.host}/feed`, 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8', log))
    log(`📰  ${feed.length} posts in the RSS window (bodies available for matching)`)
  } catch (e) {
    log(`📰  RSS feed unavailable (${e instanceof Error ? e.message.slice(0, 90) : e})`)
    log('    Continuing without bodies: stored matches kept, new posts match on the headline.')
  }
  const feedByUrl = new Map(feed.map(f => [f.link.replace(/\/$/, ''), f]))

  const rows = []
  let bodiesAvailable = 0
  let fetchesLeft = BODY_FETCHES_PER_RUN
  for (const p of wpblPosts) {
    const url = (p.canonical_url ?? `https://${src.host}/p/${p.slug}`).replace(/\/$/, '')
    const prior = stored.get(p.id)
    let post = feedByUrl.get(url) ?? null
    // Outside the feed and never read: fetch the one post, so an older piece (a player profile
    // from before the season, say) is matched on its body rather than its headline alone.
    if (!post && !prior && fetchesLeft > 0) {
      fetchesLeft--
      post = await fetchPostBody(src, p.slug, log)
    }
    const headline = `${p.title} ${p.subtitle ?? ''}`
    const titleTeamIds = teamsInTitle(p.title, teams)

    let teamIds: string[], playerIds: string[], gameId: string | null, videoCount: number | null

    if (post) {
      // The headline is included in the matched text because several of the titles name the
      // player the piece is about. Players match on any mention; clubs are stricter, because
      // "mentions the Hunters" and "is about the Hunters" are different claims. See matchTeams().
      bodiesAvailable++
      teamIds = matchTeams(headline, post.text, teams, players)
      playerIds = matchPlayers(`${headline} ${post.text}`, players)
      gameId = matchGame({ title: p.title, publishedAt: p.post_date, teamIds, titleTeamIds }, games)
      videoCount = post.videos
    } else if (prior) {
      // Body out of reach, but we have read this post before. Keep what it taught us rather
      // than recomputing from a headline and quietly demoting it. The game is re-matched from
      // the headline if it had none, which is how a rule added later reaches an old post.
      teamIds = prior.team_ids
      playerIds = prior.player_ids
      gameId = prior.game_id ?? matchGame({ title: p.title, publishedAt: p.post_date, teamIds, titleTeamIds }, games)
      videoCount = prior.video_count
    } else {
      // Never read, no body available: match on the headline alone. Clip count stays null
      // rather than 0: we do not know, and 0 would claim we did.
      teamIds = matchTeams(headline, '', teams, players)
      playerIds = matchPlayers(headline, players)
      gameId = matchGame({ title: p.title, publishedAt: p.post_date, teamIds, titleTeamIds }, games)
      videoCount = null
    }

    rows.push({
      post_id: p.id,
      source: src.key,
      slug: p.slug,
      url,
      title: p.title,
      subtitle: p.subtitle?.trim() || null,
      cover_url: imageCover(p.cover_image),
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

  return {
    result: { ...base, wpblPosts: rows.length, bodiesAvailable, matchedToGame: rows.filter(r => r.game_id).length },
    rows,
  }
}

export async function runSubstackSync(db: SyncDb, opts: SyncOptions = {}): Promise<SyncResult> {
  const log = opts.log ?? (() => {})
  const dryRun = !!opts.dryRun

  const stored = new Map((await db.select<StoredArticle>(
    'wpbl_articles', 'post_id,source,game_id,team_ids,player_ids,video_count'))
    .map(r => [Number(r.post_id), r]))
  const [teams, players, games] = await Promise.all([
    db.select<WpblTeam>('wpbl_teams', 'id,city,name,abbr'),
    db.select<WpblPlayer>('wpbl_players', 'id,name,team_id'),
    db.select<WpblGame>('wpbl_games', 'id,game_date,status,home_team_id,away_team_id,home_score,away_score'),
  ])
  log(`🗂   ${teams.length} teams, ${players.length} players, ${games.length} games loaded for matching`)

  const results: SourceResult[] = []
  const rows: unknown[] = []
  for (const src of SOURCES) {
    try {
      const out = await syncSource(src, { teams, players, games, stored, log })
      results.push(out.result)
      rows.push(...out.rows)
    } catch (e) {
      // One publication down is not the other's problem. Its stored rows are left as they are.
      const error = e instanceof Error ? e.message : String(e)
      log(`❌  ${src.publicationName}: ${error}`)
      results.push({ source: src.key, list: 'failed', totalPosts: 0, wpblPosts: 0, bodiesAvailable: 0, matchedToGame: 0, error })
    }
  }

  if (dryRun) {
    log(`\n🔍  Dry run: would upsert ${rows.length} articles. Nothing written.`)
    return { sources: results, written: 0, dryRun }
  }
  if (results.every(r => r.list === 'failed')) {
    throw new Error(`every publication failed: ${results.map(r => r.error).join('; ')}`)
  }

  // Re-upserting every post every pass is deliberate: writers edit titles and covers after
  // publishing, and re-running the matcher lets an older post pick up players added to the
  // roster since. The table is tiny, so being always-current costs nothing.
  if (rows.length > 0) await db.upsert('wpbl_articles', rows, 'post_id')
  log(`\n✅  Upserted ${rows.length} articles`)
  return { sources: results, written: rows.length, dryRun }
}

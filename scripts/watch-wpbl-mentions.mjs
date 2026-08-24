#!/usr/bin/env node
/**
 * watch-wpbl-mentions.mjs: find the public posts where somebody is asking where to follow a
 * WPBL game, and put them in one Discord channel.
 *
 * WHY THIS EXISTS. The most useful thing that can be said about this site is said in reply to
 * a question somebody already asked: "where can I see live scores for this?" That moment is
 * currently found by luck, in whichever tab happened to be open. This is the un-lucky version.
 *
 * IT FINDS THREADS. IT DOES NOT ANSWER THEM. The only thing this ever posts to is our own
 * Discord webhook. It has no credentials for Reddit or Bluesky beyond reading, and it must not
 * grow any: an automated reply in someone else's community is spam, it gets the account banned
 * from precisely the communities worth being in, and the reply is the part that needs a human
 * anyway. A link with no answer attached is what everyone downvotes.
 *
 * WHY NOT FACEBOOK, WHERE THE TRACTION ACTUALLY IS. There is no permitted automated path.
 * The Groups API was withdrawn in 2024, group posts appear in no search API, and scraping them
 * violates the terms whichever account does it, including our own. The two groups already
 * working get worked by hand, and the durable fix there is a pinned resource link rather than
 * a faster way to notice. See docs/BACKLINKS.md.
 *
 * X IS ABSENT for a duller reason: search costs $200/month.
 *
 * SEEING AND ANNOUNCING ARE SEPARATE, and that is the one non-obvious thing in here. The
 * search looks back a week, so the first run can find dozens at once. Every hit is recorded
 * immediately; only a budgeted few per run are announced, and a row still holding
 * announced_at null is next run's message rather than something lost. Anything that goes
 * stale before its turn is marked announced without being posted, so one flood cannot dribble
 * out for a month. Without this the first run is a single unreadable 40-item wall, which is
 * the same as finding nothing.
 *
 * BOTH SOURCES NEED A CREDENTIAL, and neither of them looks like it does. Reddit answers 403
 * to every anonymous read now (search.json, old.reddit.com, even /r/<sub>/new.json, from a
 * residential IP with an honest user-agent), and Bluesky's public AppView serves getProfile
 * and searchActors happily but answers app.bsky.feed.searchPosts with a CDN 403 that does not
 * read as an auth failure at all. Both are free to get. A source with no credentials is
 * SKIPPED, loudly, in the log; it never fails the run, and it never counts towards the
 * everything-is-down notice.
 *
 * Usage:
 *   npm run mentions-watch                 # search, record, announce what is due
 *   npm run mentions-watch -- --dry-run    # search and render; writes nothing, posts nothing
 *   npm run mentions-watch -- --status     # what the queue holds, search nothing
 *   npm run mentions-watch -- --test-post  # post a sample to the webhook, to prove it works
 *   npm run mentions-watch -- --all        # ignore the per-run budget and announce everything
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *   DISCORD_MENTIONS_WEBHOOK_URL  where the digest goes. A private channel: these are threads
 *                                 to answer, not content for the fan server.
 *   DISCORD_MENTIONS_MENTION      optional. Pings only when the batch contains a question or a
 *                                 link to us, never for a plain mention.
 *   REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET   a free "script" app at reddit.com/prefs/apps.
 *                                 Without these, Reddit is skipped entirely.
 *   BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD  the handle, and an App Password from Settings
 *                                 (never the account password). Without these, Bluesky is
 *                                 skipped entirely.
 */

import { createClient } from '@supabase/supabase-js'
// supabase-js constructs a realtime client even though nothing here subscribes, and Node < 22
// has no global WebSocket, so it needs `ws` handed to it or it throws at construction. Same
// line, same reason, as the sibling cron scripts.
import ws from 'ws'
import { pathToFileURL } from 'node:url'

// Run only when invoked directly. Imported (by the tests, which exercise the matching and the
// message building without a database or a webhook) this file must define and not do.
const IS_ENTRYPOINT = process.argv[1] != null
  && import.meta.url === pathToFileURL(process.argv[1]).href

// ─── Config ─────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const WEBHOOK = (process.env.DISCORD_MENTIONS_WEBHOOK_URL ?? '').trim()

// Empty by default. A question worth answering is worth a phone buzz, but this channel is
// private and one person reads it, so who to ping is a local decision.
const MENTION = (process.env.DISCORD_MENTIONS_MENTION ?? '').trim()

const REDDIT_ID = (process.env.REDDIT_CLIENT_ID ?? '').trim()
const REDDIT_SECRET = (process.env.REDDIT_CLIENT_SECRET ?? '').trim()
const BSKY_ID = (process.env.BLUESKY_IDENTIFIER ?? '').trim()
const BSKY_PASSWORD = (process.env.BLUESKY_APP_PASSWORD ?? '').trim()

const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')
const STATUS = args.has('--status')
const TEST_POST = args.has('--test-post')
const ANNOUNCE_ALL = args.has('--all')

// Identify honestly rather than impersonating a browser, so either platform can see what we
// are and block us if they would rather we stopped. Reddit's API rules require a real
// user-agent and throttle a generic one hard.
const USER_AGENT =
  'sportydolphin.fun mention watcher/1.0 (+https://sportydolphin.fun; contact via the WPBL fan Discord)'
const FETCH_TIMEOUT_MS = 20_000

// How long every source has to be unreachable before we say so. Six hours, same reasoning as
// the shop watcher: past a deploy, a blip or a rate limit, short of the day that makes a
// missed question likely.
const ERROR_QUIET_HOURS = 6

// The per-run announcement budget. A Discord message caps at 2000 characters and nobody reads
// a 40-item list anyway; the rest waits for the next run fifteen minutes later.
const MAX_PER_RUN = 8

// A pending hit older than this leaves the queue unannounced. Somebody else has answered the
// question by now, and a backlog that drips for a fortnight is a channel that gets muted.
const STALE_DAYS = 3

// How far back each search looks. A week, so a run that fails for a few hours catches up on
// its own rather than leaving a hole.
const LOOKBACK_DAYS = 7

if (IS_ENTRYPOINT) {
  // A dry run touches no table at all, by design: it is the way to try a change to the search
  // terms from a laptop, and demanding the service-role key for that would mean the only place
  // the matching can be exercised against the live APIs is CI.
  if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
    console.error('❌  Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. wpbl_mention_hits is server-only (RLS with no policies), so no other key can read or write it.')
    process.exit(1)
  }
  // Not an error, and deliberately not a failure: the workflow ships before the webhook does,
  // and a scheduled job that red-Xes every quarter hour until someone pastes a secret is a job
  // everybody learns to ignore before it ever does anything useful.
  if (!WEBHOOK && !DRY_RUN && !STATUS) {
    console.log('DISCORD_MENTIONS_WEBHOOK_URL is not set, so there is nowhere to report anything. Doing nothing. See docs/DISCORD.md, "The mention watcher".')
    process.exit(0)
  }
}

const supabase = SUPABASE_URL && SERVICE_KEY
  ? createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: { transport: ws },
    })
  : null

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
export const hoursSince = (iso, now = Date.now()) =>
  (iso ? (now - new Date(iso).getTime()) / 3_600_000 : Infinity)

// ─── What counts as a hit ───────────────────────────────────────────────────

/**
 * The league, named specifically enough that a sitewide search can be filtered locally.
 *
 * Club nicknames on their own are NOT in here and must not be added: "Queens", "Heights" and
 * "Hunters" are ordinary English words, and a watcher that reports every post containing
 * "heights" is a watcher nobody opens. "Firebells" is the one nickname unique enough to stand
 * alone.
 */
export const SUBJECT_TERMS = [
  'wpbl',
  "women's pro baseball", 'womens pro baseball',
  "women's professional baseball", 'womens professional baseball',
  'firebells',
  'boston hunters', 'los angeles queens', 'la queens', 'new york heights',
]

/** Somebody naming the site. Outranks everything else: it is either a link worth thanking
 *  someone for or a complaint worth answering the same day. */
export const SITE_TERMS = ['sportydolphin']

/**
 * Somebody asking where to follow along, which is the moment this whole job exists to catch.
 *
 * Phrases rather than single words, because the single words are all too common: "watch",
 * "score" and "stats" appear in every second baseball post ever written, and matching them
 * turns the channel into a firehose that gets muted inside a day.
 */
export const INTENT_TERMS = [
  'where can i watch', 'where do i watch', 'where to watch', 'where can i stream',
  'where can i find', 'where do i find', 'where can i see', 'where do i see',
  'how do i follow', 'how can i follow', 'follow along', 'keep up with',
  'live score', 'live scores', 'live update', 'live updates', 'live stats',
  'box score', 'box scores', 'play by play', 'play-by-play',
  'is there an app', 'is there a site', 'is there a website', 'anywhere to',
  'standings', 'stat leaders', 'leaderboard',
]

const matchesTerm = (text, term) => {
  // Word boundaries, so "wpbl" does not match inside a longer token and "standings" does not
  // match "outstanding". Terms are literal phrases, so the only regex metacharacters that can
  // appear are the apostrophe and hyphen we wrote, but escape anyway rather than trusting that
  // the list never grows a "?" or a ".".
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text)
}

const found = (text, terms) => terms.filter(t => matchesTerm(text, t))

/**
 * What a post is, from its text alone. Pure, and tested, because both failure modes here are
 * expensive: too loose and the channel is muted within a day, too tight and the question this
 * exists to catch goes past unseen.
 *
 * Returns null for anything not about the league at all, which is most of what a sitewide
 * search for a four-letter acronym returns.
 */
export function classify(text) {
  // Curly apostrophes are what phones type, so "women’s pro baseball" is the COMMON spelling
  // and the straight one is the exception. Without this fold the subject term matches almost
  // nothing written on a phone, and nothing about the failure looks like a failure.
  const haystack = String(text ?? '').replace(/[‘’]/g, "'")
  const site = found(haystack, SITE_TERMS)
  const subject = found(haystack, SUBJECT_TERMS)
  const intent = found(haystack, INTENT_TERMS)

  // Someone naming the site is worth seeing whether or not the league is named in the same
  // breath: it is either a backlink or a bug report.
  if (site.length) return { kind: 'link', matched: [...site, ...subject, ...intent] }
  if (!subject.length) return null
  if (intent.length) return { kind: 'question', matched: [...subject, ...intent] }
  return { kind: 'mention', matched: subject }
}

/** The searches each source runs. Deliberately broad: the narrowing is `classify`, locally,
 *  where it can be tested and changed without learning two query syntaxes. */
export const QUERIES = ['WPBL', '"women\'s pro baseball"', 'sportydolphin']

const excerptOf = (text, max = 280) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

// ─── Reddit ─────────────────────────────────────────────────────────────────

/**
 * Reddit's listing shape, flattened to what the digest needs.
 *
 * Link posts only. Reddit's search does not usefully cover comments, and the honest cost of
 * that is that a question asked as a reply inside somebody else's game thread is invisible
 * here. Worth knowing before wondering why a thread you saw by hand never arrived.
 */
export function normaliseReddit(payload) {
  const children = payload?.data?.children ?? []
  return children
    .filter(c => c?.kind === 't3' && c?.data)
    .map(c => c.data)
    .map(d => ({
      // `name` is the fullname ("t3_1abcdef"), stable; the permalink carries a title slug that
      // changes when a post is edited, so it cannot be the key.
      external_id: `reddit:${d.name ?? `t3_${d.id}`}`,
      source: 'reddit',
      url: `https://www.reddit.com${d.permalink}`,
      author: d.author ? `u/${d.author}` : null,
      title: d.title ?? null,
      // Both fields feed the matcher: the question is as often in the body as in the title.
      text: `${d.title ?? ''}\n${d.selftext ?? ''}`,
      context: d.subreddit ? `r/${d.subreddit}` : null,
      posted_at: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null,
    }))
}

async function redditToken(fetchImpl = fetch) {
  const res = await fetchImpl('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${REDDIT_ID}:${REDDIT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Reddit refused the token request (${res.status}). Check REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET.`)
  const body = await res.json()
  if (!body?.access_token) throw new Error('Reddit returned no access_token')
  return body.access_token
}

/**
 * THERE IS NO ANONYMOUS MODE, and an earlier draft of this file wrongly had one.
 * www.reddit.com/search.json, old.reddit.com and even /r/<sub>/new.json all answer 403 now, to
 * an honest user-agent, from a residential IP: this is Reddit's 2023 API policy rather than a
 * datacentre-IP block, so there is nothing to fall back TO. The token above is required, and a
 * run without it skips Reddit rather than pretending. Verified by hand Aug 24, 2026.
 */
export async function searchReddit(queries = QUERIES, fetchImpl = fetch) {
  const token = await redditToken(fetchImpl)
  const headers = {
    'User-Agent': USER_AGENT, Accept: 'application/json', Authorization: `Bearer ${token}`,
  }

  const out = []
  for (const q of queries) {
    const url = `https://oauth.reddit.com/search?q=${encodeURIComponent(q)}`
      + '&sort=new&limit=100&t=week&type=link&raw_json=1'
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`Reddit returned ${res.status} for ${q}`)
    out.push(...normaliseReddit(await res.json()))
    // Well under the 100 a minute the app-only token allows, and it costs a run nothing to be
    // polite.
    await sleep(1_000)
  }
  return out
}

// ─── Bluesky ────────────────────────────────────────────────────────────────

/**
 * An at:// uri is not a link a human can open, so the web URL is rebuilt from the record key
 * and the author's handle: at://did:plc:xyz/app.bsky.feed.post/<rkey> becomes
 * bsky.app/profile/<handle>/post/<rkey>. The uri stays as the dedupe key, because a handle can
 * be changed by its owner and the did cannot.
 */
export function normaliseBluesky(payload) {
  return (payload?.posts ?? []).map(p => {
    const rkey = String(p?.uri ?? '').split('/').pop()
    const handle = p?.author?.handle ?? null
    return {
      external_id: `bluesky:${p.uri}`,
      source: 'bluesky',
      url: handle && rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : String(p?.uri ?? ''),
      author: handle ? `@${handle}` : null,
      title: null,
      text: p?.record?.text ?? '',
      context: null,
      posted_at: p?.record?.createdAt ?? p?.indexedAt ?? null,
    }
  })
}

async function blueskyToken(fetchImpl = fetch) {
  const res = await fetchImpl('https://bsky.social/xrpc/com.atproto.server.createSession', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ identifier: BSKY_ID, password: BSKY_PASSWORD }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Bluesky refused the session (${res.status}). BLUESKY_APP_PASSWORD must be an app password from Settings, not the account password.`)
  const jwt = (await res.json())?.accessJwt
  if (!jwt) throw new Error('Bluesky returned no accessJwt')
  return jwt
}

/**
 * POST SEARCH IS THE ONE PUBLIC-APPVIEW ENDPOINT THAT NEEDS A TOKEN, which is easy to get
 * wrong because its neighbours do not: public.api.bsky.app answers app.bsky.actor.getProfile
 * and app.bsky.actor.searchActors with no credential at all, and app.bsky.feed.searchPosts
 * with a 403 (a CDN error page, not an XRPC error body, so it does not even read as an auth
 * failure). Authenticated calls go to the PDS, which proxies app.bsky.* through to the
 * AppView. Verified by hand Aug 24, 2026.
 */
export async function searchBluesky(queries = QUERIES, fetchImpl = fetch) {
  const token = await blueskyToken(fetchImpl)
  const headers = {
    Accept: 'application/json', 'User-Agent': USER_AGENT, Authorization: `Bearer ${token}`,
  }

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString()
  const out = []
  for (const q of queries) {
    const url = `https://bsky.social/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}`
      + `&limit=100&sort=latest&since=${encodeURIComponent(since)}`
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`Bluesky returned ${res.status} for ${q}`)
    out.push(...normaliseBluesky(await res.json()))
    await sleep(500)
  }
  return out
}

/**
 * The sources, and what each one needs before it can be asked anything.
 *
 * BOTH need a credential. Neither did when this was designed, and discovering that after the
 * fact is why `configured` is a first-class idea here rather than a try/catch: a source with
 * no credentials is SKIPPED with an actionable line in the log, and a skipped source must not
 * count towards "everything is down", or a half-configured install would post an outage notice
 * every six hours forever.
 */
const SOURCES = [
  {
    name: 'Reddit',
    search: searchReddit,
    configured: () => Boolean(REDDIT_ID && REDDIT_SECRET),
    hint: 'Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET from a free "script" app at reddit.com/prefs/apps. There is no anonymous mode any more.',
  },
  {
    name: 'Bluesky',
    search: searchBluesky,
    configured: () => Boolean(BSKY_ID && BSKY_PASSWORD),
    hint: 'Set BLUESKY_IDENTIFIER (the handle) and BLUESKY_APP_PASSWORD (Settings, App Passwords, never the account password). Post search is the one public endpoint that will not answer without a token.',
  },
]

// ─── Turning results into hits ──────────────────────────────────────────────

/**
 * Everything the sources returned, reduced to the rows worth keeping: on topic, recent enough,
 * and not something we already hold.
 *
 * Pure and tested. `known` is passed rather than read here so the tests can exercise the
 * dedupe without a database.
 */
export function toHits(results, known, { now = Date.now(), lookbackDays = LOOKBACK_DAYS } = {}) {
  const cutoff = now - lookbackDays * 86_400_000
  const seen = new Set(known)
  const hits = []
  for (const r of results) {
    if (seen.has(r.external_id)) continue
    const verdict = classify(`${r.title ?? ''}\n${r.text ?? ''}`)
    if (!verdict) continue
    // A missing timestamp is kept rather than dropped: an undated result is far more likely a
    // shape we did not expect than a decade-old post, and dropping it silently would hide it.
    if (r.posted_at && new Date(r.posted_at).getTime() < cutoff) continue
    // Within one run the same post can arrive from two queries ("WPBL" and "sportydolphin"
    // both match a post naming both), and inserting it twice is a primary key violation that
    // would fail the whole batch.
    seen.add(r.external_id)
    hits.push({
      external_id: r.external_id,
      source: r.source,
      kind: verdict.kind,
      url: r.url,
      author: [r.author, r.context].filter(Boolean).join(' in ') || null,
      title: r.title ? excerptOf(r.title, 200) : null,
      excerpt: excerptOf(r.text),
      matched: verdict.matched,
      posted_at: r.posted_at,
    })
  }
  return hits
}

/** Questions first, then links to us, then plain mentions: the order the human should read
 *  them in, and so the order the per-run budget is spent in. */
const KIND_ORDER = { question: 0, link: 1, mention: 2 }
export const byUrgency = (a, b) =>
  (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9)
  || String(b.posted_at ?? '').localeCompare(String(a.posted_at ?? ''))

// ─── Messages ───────────────────────────────────────────────────────────────

const SOURCE_LABEL = { reddit: 'Reddit', bluesky: 'Bluesky' }

const SECTIONS = [
  { kind: 'question', heading: '🎯 **Someone is asking where to follow along**' },
  { kind: 'link', heading: '🔗 **Someone mentioned sportydolphin**' },
  { kind: 'mention', heading: '💬 **WPBL talk, no question attached**' },
]

/**
 * The excerpt is a stranger's text arriving over the network, so it is stripped rather than
 * interpolated raw: a post whose body is "@everyone" must not become a ping (allowed_mentions
 * is the real guard, this is the belt), and one full of backticks must not break the rest of
 * the message out of its formatting.
 */
const safeExcerpt = (text, max) => excerptOf(text, max).replace(/[`@]/g, ' ')

function hitLine(hit) {
  const where = [SOURCE_LABEL[hit.source] ?? hit.source, hit.author].filter(Boolean).join(' · ')
  const lines = [`• **${safeExcerpt(hit.title ?? hit.excerpt, 90)}** _(${where})_`]
  if (hit.title && hit.excerpt) lines.push(`  > ${safeExcerpt(hit.excerpt, 180)}`)
  lines.push(`  ${hit.url}`)
  return lines.join('\n')
}

/**
 * One message per run covering everything due, or null when nothing is. One message rather
 * than one per hit, because a busy day would otherwise be fifteen notifications in a row.
 */
export function digestMessage(hits, { remaining = 0 } = {}) {
  if (!hits.length) return null
  const parts = []
  for (const { kind, heading } of SECTIONS) {
    const group = hits.filter(h => h.kind === kind)
    if (!group.length) continue
    parts.push(`${heading} (${group.length})\n${group.map(hitLine).join('\n')}`)
  }
  if (remaining > 0) {
    parts.push(`_…and ${remaining} more waiting. They come through on the next runs._`)
  }
  // The standing reminder, because this job is one impatient afternoon away from being a spam
  // bot, and the person reading the channel is the part that stops it.
  parts.push('_Reply as yourself, and answer the question before linking. A bare link gets removed._')
  return parts.join('\n\n')
}

// Discord's hard cap on one message. Not a style choice: the API rejects anything longer.
export const DISCORD_LIMIT = 2000

/**
 * As many of `due` as fit in one message, and the rest left in the queue.
 *
 * The cap has to be respected HERE rather than by slicing the finished string, because slicing
 * cuts a URL in half and leaves an unclickable link as the last thing in the channel: the one
 * failure that makes a found thread unreachable after finding it. A hit dropped here still
 * holds announced_at null, so it is next run's message rather than something lost.
 *
 * `pending` is the whole queue depth, passed in so the measured message is the one actually
 * sent: the "…and N more" line changes length as `take` shrinks, and measuring a different
 * string than we post is how an off-by-forty-characters bug gets in.
 */
export function fitDigest(due, pending, limit = DISCORD_LIMIT) {
  let take = due.length
  const render = (n) => digestMessage(due.slice(0, n), { remaining: pending - n })
  while (take > 1 && (render(take)?.length ?? 0) > limit) take--
  return { due: due.slice(0, take), left: due.length - take }
}

function outageMessage(hours, errors) {
  return [
    `⚠️  **Mention watcher is blind.** No source has answered for ${Math.floor(hours)}h.`,
    ...errors.map(e => `• \`${String(e).slice(0, 200)}\``),
    'It will keep trying and will say nothing more until it recovers.',
  ].join('\n')
}

/**
 * Which mention categories Discord may act on, worked out from the mention WE configured and
 * nothing else.
 *
 * Discord ignores an @everyone in a message body unless allowed_mentions says otherwise, so
 * this is the switch that decides whether the digest notifies anyone. Deriving it from our own
 * string rather than scanning the content is what keeps a stranger's Reddit post from reaching
 * a role we were not already pinging.
 */
export function mentionParse(mention) {
  const m = (mention ?? '').trim()
  if (!m) return []
  if (/@everyone|@here/.test(m)) return ['everyone']
  if (/<@&\d+>/.test(m)) return ['roles']
  if (/<@!?\d+>/.test(m)) return ['users']
  return []
}

// ─── Discord ────────────────────────────────────────────────────────────────

async function post(content, mention = '') {
  if (!WEBHOOK) { console.warn('⚠️   No webhook configured; skipping.'); return }
  if (DRY_RUN) {
    console.log('\n─── would post ───────────────────────────────────────────')
    console.log(content)
    console.log(`(allowed_mentions: ${JSON.stringify(mentionParse(mention))})`)
    console.log('──────────────────────────────────────────────────────────\n')
    return
  }
  const body = mention ? `${mention}\n${content}` : content
  const res = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // fitDigest is what keeps a digest under the cap without mangling a link. This slice is
      // the backstop for the messages that do not go through it (the outage notice, the test
      // post), and reaching it means something upstream miscounted.
      content: body.slice(0, DISCORD_LIMIT),
      allowed_mentions: { parse: mentionParse(mention) },
    }),
  })
  if (res.status === 429) {
    const retryMs = Math.min(10_000, Number((await res.clone().json().catch(() => ({}))).retry_after ?? 1) * 1000)
    console.warn(`⚠️   Rate limited, waiting ${retryMs}ms`)
    await sleep(retryMs)
    return post(content, mention)
  }
  if (!res.ok) throw new Error(`Discord post failed (${res.status}): ${await res.text()}`)
}

// ─── Persistence ────────────────────────────────────────────────────────────

// PostgREST silently caps a bare select at 1000 rows: no error, just a short array. That is the
// standing trap in CLAUDE.md, and here a truncated read of the known ids reads as "we have
// never seen these posts" and re-announces threads that were answered last week. The table
// grows by a handful of rows a day, so this ceiling is years away, but it is checked rather
// than assumed.
const KNOWN_LIMIT = 5000

/** Only the recent ids: dedupe has to reach exactly as far back as the search does, and
 *  reading the whole table would grow without bound for no benefit. */
async function loadKnownIds() {
  const since = new Date(Date.now() - (LOOKBACK_DAYS + 7) * 86_400_000).toISOString()
  const { data, error } = await supabase.from('wpbl_mention_hits')
    .select('external_id').gte('found_at', since).limit(KNOWN_LIMIT)
  if (error) throw new Error(`Could not read what we have already seen: ${error.message}`)
  if ((data ?? []).length >= KNOWN_LIMIT) {
    throw new Error(`The known-id read hit the ${KNOWN_LIMIT}-row cap, so it is a prefix rather than the whole window. Diffing against a prefix re-announces old threads. Page this read before letting the job run again.`)
  }
  return (data ?? []).map(r => r.external_id)
}

async function saveHits(hits) {
  if (!hits.length) return
  // ignoreDuplicates, because two overlapping runs (a slow one and its successor) would
  // otherwise fail the whole batch on the primary key rather than skipping the one row.
  const { error } = await supabase.from('wpbl_mention_hits')
    .upsert(hits, { onConflict: 'external_id', ignoreDuplicates: true })
  if (error) throw new Error(`Could not record the hits: ${error.message}`)
}

async function loadPending() {
  const { data, error } = await supabase.from('wpbl_mention_hits')
    .select('external_id,source,kind,url,author,title,excerpt,posted_at')
    .is('announced_at', null)
    .order('posted_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(`Could not read the queue: ${error.message}`)
  return data ?? []
}

async function markAnnounced(ids) {
  if (!ids.length) return
  const { error } = await supabase.from('wpbl_mention_hits')
    .update({ announced_at: new Date().toISOString() }).in('external_id', ids)
  if (error) throw new Error(`Could not mark them announced, which means the next run would repeat them: ${error.message}`)
}

async function recordRun(fields) {
  const { error } = await supabase.from('wpbl_mention_watch_runs').insert(fields)
  if (error) console.error(`Could not record the run: ${error.message}`)
}

async function lastGoodRun() {
  const { data } = await supabase.from('wpbl_mention_watch_runs')
    .select('ran_at,ok').eq('ok', true).order('ran_at', { ascending: false }).limit(1)
  return data?.[0] ?? null
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (TEST_POST) {
    await post('mention watcher test')
    console.log(DRY_RUN ? 'Dry run: nothing sent.' : '✅  Test message sent.')
    return
  }

  if (STATUS) {
    const pending = await loadPending()
    const byKind = pending.reduce((acc, h) => ({ ...acc, [h.kind]: (acc[h.kind] ?? 0) + 1 }), {})
    const summary = Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(', ')
    console.log(`Queue: ${pending.length} waiting${summary ? ` (${summary})` : ''}.`)
    for (const source of SOURCES) {
      console.log(`${source.name}: ${source.configured() ? 'credentials present' : `NOT configured. ${source.hint}`}`)
    }
    console.log(`Last successful run: ${(await lastGoodRun())?.ran_at ?? 'never'}`)
    return
  }

  // Each source is allowed to fail on its own. One platform blocking us must not cost the
  // other's results, and one flaky source must not turn the job red every quarter hour.
  const errors = []
  const results = []
  let asked = 0
  for (const source of SOURCES) {
    if (!source.configured()) {
      console.log(`${source.name}: skipped, no credentials. ${source.hint}`)
      continue
    }
    asked++
    try {
      const batch = await source.search()
      results.push(...batch)
      console.log(`${source.name}: ${batch.length} results.`)
    } catch (err) {
      const message = `${source.name}: ${err?.message ?? err}`
      console.error(`⚠️   ${message}`)
      errors.push(message)
    }
  }

  if (asked === 0) {
    // Nothing to be blind about: this is an unfinished setup, not an outage, and posting an
    // alarm about it every six hours would train everyone to ignore the alarm that matters.
    console.log('No source has credentials, so there was nothing to search. See the hints above.')
    return
  }

  if (errors.length === asked) {
    if (!DRY_RUN) {
      // Every source down is the one state a watcher cannot report by staying quiet, so once
      // the outage is old enough we say so, once.
      const blindFor = hoursSince((await lastGoodRun())?.ran_at)
      if (blindFor >= ERROR_QUIET_HOURS) {
        await post(outageMessage(blindFor, errors)).catch(e =>
          console.error(`   Could not post the outage notice either: ${e.message}`))
      }
      await recordRun({ ok: false, error: errors.join(' | ').slice(0, 500) })
    }
    // Exit 0: expected and self-healing, and a red X every fifteen minutes teaches everyone to
    // ignore the job.
    return
  }

  const hits = toHits(results, DRY_RUN ? [] : await loadKnownIds())
  console.log(`On topic and new: ${hits.length} of ${results.length}.`)

  if (DRY_RUN) {
    const sorted = [...hits].sort(byUrgency)
    const { due: shown } = fitDigest(sorted.slice(0, MAX_PER_RUN), sorted.length)
    const message = digestMessage(shown, { remaining: Math.max(0, hits.length - shown.length) })
    if (message) await post(message)
    else console.log('Nothing to report.')
    console.log('\nDry run: nothing written, nothing sent.')
    return
  }

  // Recorded before anything is announced. A crash between the two costs a delayed digest; the
  // other order costs a lost thread, and a repeated digest for everything else.
  await saveHits(hits)

  const pending = (await loadPending()).sort(byUrgency)

  // Anything that waited too long leaves the queue without being posted. Somebody else has
  // answered by now, and a fortnight-long drip is a muted channel.
  const staleCutoff = Date.now() - STALE_DAYS * 86_400_000
  const isStale = (h) => h.posted_at != null && new Date(h.posted_at).getTime() < staleCutoff
  const stale = pending.filter(isStale)
  const fresh = pending.filter(h => !isStale(h))

  // --all lifts the per-run budget, not the character cap: fitDigest still trims, and what it
  // trims stays queued for the next run rather than being cut off mid-URL.
  const budgeted = ANNOUNCE_ALL ? fresh : fresh.slice(0, MAX_PER_RUN)
  const { due, left } = fitDigest(budgeted, fresh.length)
  if (left) console.log(`${left} more would not fit in one message; they stay queued.`)
  const message = digestMessage(due, { remaining: fresh.length - due.length })

  if (message) {
    // Ping only for something that wants answering today. A plain mention can wait, and a
    // channel that buzzes for those is muted before the next real question arrives.
    const worthPinging = due.some(h => h.kind === 'question' || h.kind === 'link')
    await post(message, worthPinging ? MENTION : '')
    console.log(`Announced ${due.length}.`)
  }
  if (stale.length) console.log(`Dropped ${stale.length} that went stale before their turn.`)

  await markAnnounced([...due, ...stale].map(h => h.external_id))
  await recordRun({
    ok: true,
    seen: results.length,
    new_hits: hits.length,
    announced: due.length,
    error: errors.length ? errors.join(' | ').slice(0, 500) : null,
  })
}

if (IS_ENTRYPOINT) {
  main().catch(err => {
    console.error(`❌  ${err?.stack ?? err}`)
    process.exit(1)
  })
}

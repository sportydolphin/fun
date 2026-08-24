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
 * REDDIT IS TWO SOURCES, not one. Its search indexes link posts and not comments, and the
 * question this exists to catch is more often a reply inside somebody else's game thread than
 * a post of its own. So the comment listings of a short list of subreddits are swept
 * separately, on the same credential, failing separately. What keeps that from drowning the
 * channel is that a comment is only ever a question or a link to us, never a plain mention:
 * see `classifyComment`.
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

/**
 * What a COMMENT is, which is a different question from what a post is, and the difference is
 * the whole reason this function exists rather than reusing `classify`.
 *
 * TWO RULES, PULLING OPPOSITE WAYS.
 *
 * The subject may come from the PARENT POST'S TITLE. The comment that matters most reads, in
 * full, "wait, where can I watch this?", under a post titled "WPBL semifinal game thread". It
 * names no league, so `classify` returns null for it, and the single most valuable thing this
 * job could ever find would go past unseen. Reddit hands us `link_title` on every comment, so
 * the parent is free to read.
 *
 * But the INTENT must come from the comment's OWN text, and a comment can never be a plain
 * `mention`. Take that away and every one of the four hundred comments under that same game
 * thread inherits the league from the title and lands in the channel, because the title alone
 * makes each of them "the league, discussed". One game thread would bury a week of real
 * questions, and the channel would be muted by the end of the night. A comment earns its place
 * by asking something or by naming us. Nothing else does.
 */
export function classifyComment(body, parentTitle) {
  const own = String(body ?? '').replace(/[‘’]/g, "'")
  const parent = String(parentTitle ?? '').replace(/[‘’]/g, "'")

  // Naming the site in a comment is worth seeing wherever it was said: it is a recommendation
  // to thank someone for, or a complaint to answer today.
  const site = found(own, SITE_TERMS)
  if (site.length) return { kind: 'link', matched: [...site, ...found(own, SUBJECT_TERMS)] }

  const intent = found(own, INTENT_TERMS)
  if (!intent.length) return null
  // The parent is read for the subject and for nothing else.
  const subject = [...new Set([...found(own, SUBJECT_TERMS), ...found(parent, SUBJECT_TERMS)])]
  if (!subject.length) return null
  return { kind: 'question', matched: [...subject, ...intent] }
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
 * Search covers LINK POSTS only, which is a limit of Reddit's search rather than a choice:
 * comments are not in the index at all. The question this job exists to catch is more often a
 * reply inside somebody else's game thread than a post of its own, so that half is swept
 * separately, by `searchRedditComments` below, off each subreddit's own comment listing.
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
      // Spelled out rather than left to default, because `toHits` branches on it and a silent
      // absence would read as a post whatever it actually was.
      form: 'post',
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
  if (!res.ok) {
    const said = await res.text().catch(() => '')
    throw new Error(`Reddit refused the token request (${res.status}) ${said.slice(0, 200)}. Check REDDIT_CLIENT_ID (the unlabelled string under the app name, not the app name) and REDDIT_CLIENT_SECRET.`)
  }
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

/**
 * The subreddits whose comment listings are swept. THIS LIST IS THE TUNING KNOB, and it is
 * short on purpose.
 *
 * A sub that does not exist, has gone private, or has banned us answers 404 or 403 and is
 * SKIPPED with a line in the log rather than failing the sweep, so a speculative entry here
 * costs one wasted request a run and nothing else.
 *
 * The real cost of a bad entry is the opposite one. A comment listing returns the NEWEST
 * comments and cannot be asked for a time range, so a sub busy enough to produce more than
 * MAX_COMMENT_PAGES * 100 comments between two runs is one this job only ever sees a slice of.
 * That failure is invisible by construction, which is why `commentSpanMinutes` measures it and
 * says so out loud. Adding r/AskReddit here would not break anything visibly; it would just
 * quietly consume the budget and start missing r/baseball.
 */
export const COMMENT_SUBREDDITS = ['baseball', 'womenssports', 'womensbaseball', 'wpbl']

// Three pages, 100 at a time. Enough that r/baseball is covered between runs on an ordinary
// evening, bounded so a sub having a moment cannot spend the whole run on itself.
const MAX_COMMENT_PAGES = 3

// How far back the comment sweep tries to reach. Three times the 15-minute cadence, so one
// skipped or slow run is caught up by the next rather than leaving a hole.
const COMMENT_WINDOW_MINUTES = 45

/**
 * Reddit's comment listing, flattened to the same shape as a post.
 *
 * `form: 'comment'` is what makes `toHits` classify it against the parent title as well, and
 * `parent_title` is what it reads. Both are load-bearing: see `classifyComment`.
 */
export function normaliseRedditComments(payload) {
  const children = payload?.data?.children ?? []
  return children
    .filter(c => c?.kind === 't1' && c?.data)
    .map(c => c.data)
    .map(d => ({
      external_id: `reddit:${d.name ?? `t1_${d.id}`}`,
      source: 'reddit',
      form: 'comment',
      // ?context=3 so the link lands on the comment WITH the conversation above it. Answering
      // well needs to know what was already said, and a permalink alone opens on an orphan.
      url: `https://www.reddit.com${d.permalink}?context=3`,
      author: d.author ? `u/${d.author}` : null,
      // The thread the comment sits in, not the comment: the digest shows this as the heading
      // and quotes the comment itself underneath, which is the order a human reads them in.
      title: d.link_title ? `re: ${d.link_title}` : null,
      parent_title: d.link_title ?? null,
      text: d.body ?? '',
      context: d.subreddit ? `r/${d.subreddit}` : null,
      posted_at: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null,
    }))
}

/** How many minutes of conversation a batch actually covers, which is the only way to know
 *  whether the sweep saw the window or just the last ninety seconds of it. */
export function commentSpanMinutes(rows, now = Date.now()) {
  const stamps = rows.map(r => Date.parse(r.posted_at ?? '')).filter(Number.isFinite)
  if (!stamps.length) return null
  return (now - Math.min(...stamps)) / 60_000
}

/**
 * The half of Reddit that search cannot see.
 *
 * A separate SOURCE rather than a second half of `searchReddit`, which costs one extra token
 * request a run and buys the failure isolation the whole file is built on: post search going
 * down must not cost the comment sweep, and a sub listing changing shape must not take the
 * search results with it. It shares the credential and nothing else.
 */
export async function searchRedditComments(subs = COMMENT_SUBREDDITS, fetchImpl = fetch) {
  const token = await redditToken(fetchImpl)
  const headers = {
    'User-Agent': USER_AGENT, Accept: 'application/json', Authorization: `Bearer ${token}`,
  }

  const out = []
  const refused = []
  for (const sub of subs) {
    const rows = []
    let after = null
    try {
      for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
        const url = `https://oauth.reddit.com/r/${encodeURIComponent(sub)}/comments`
          + `?limit=100&raw_json=1${after ? `&after=${encodeURIComponent(after)}` : ''}`
        const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
        // A sub that is gone, private, or has banned us is not an outage. Say which, once, and
        // carry on with the others.
        if (res.status === 403 || res.status === 404) { refused.push(`r/${sub} (${res.status})`); break }
        if (!res.ok) throw new Error(`Reddit returned ${res.status} for r/${sub}`)
        const payload = await res.json()
        const batch = normaliseRedditComments(payload)
        // No new ids means the cursor was not honoured; paging on would fetch the same page
        // until the budget ran out.
        const before = rows.length
        const seen = new Set(rows.map(r => r.external_id))
        rows.push(...batch.filter(r => !seen.has(r.external_id)))
        if (rows.length === before) break

        after = payload?.data?.after ?? null
        const span = commentSpanMinutes(rows)
        if (!after || (span != null && span >= COMMENT_WINDOW_MINUTES)) break
        await sleep(1_000)
      }
    } catch (err) {
      // One sub failing is not the sweep failing. Everything gathered so far still counts.
      console.warn(`⚠️   r/${sub}: ${err?.message ?? err}`)
      continue
    }

    const span = commentSpanMinutes(rows)
    // The invisible failure, made visible: the sweep ran, returned full pages, and still only
    // reached back a few minutes. Nothing is wrong with the code; the sub is busier than the
    // page budget, and anything asked before that window was never read. Either drop the sub
    // or raise MAX_COMMENT_PAGES.
    //
    // A leftover cursor is what distinguishes this from a QUIET sub, which also spans very
    // little and is fine: that one runs out of comments and Reddit returns no `after`, so it
    // must not raise an alarm every fifteen minutes forever.
    if (after != null && span != null && span < COMMENT_WINDOW_MINUTES) {
      console.warn(`⚠️   r/${sub}: ${rows.length} comments reach back only ${Math.round(span)} min of the ${COMMENT_WINDOW_MINUTES} min window, and there is more to read. Anything asked before that was missed.`)
    }
    out.push(...rows)
    await sleep(1_000)
  }
  if (refused.length) console.log(`Comment sweep skipped ${refused.join(', ')}.`)
  // Every sub refusing is a real failure and must reach the caller: silently returning nothing
  // is exactly how a source dies without anybody noticing.
  if (refused.length === subs.length) {
    throw new Error(`Every subreddit in the comment sweep refused: ${refused.join(', ')}`)
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
      form: 'post',
      url: handle && rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : String(p?.uri ?? ''),
      author: handle ? `@${handle}` : null,
      title: null,
      text: p?.record?.text ?? '',
      context: null,
      posted_at: p?.record?.createdAt ?? p?.indexedAt ?? null,
    }
  })
}

/**
 * Which of the two secrets is wrong, answered rather than guessed.
 *
 * `AuthenticationRequired: Invalid identifier or password` is deliberately vague on Bluesky's
 * side, and a person cannot tell the two apart by looking: both secrets are opaque strings that
 * look fine. But a handle resolves on the PUBLIC AppView with no credential whatsoever, so the
 * identifier half can be checked on its own. If it resolves, the password is what is wrong, and
 * that is the whole answer. Costs one request, and only on a failure that has already happened.
 */
async function whichHalfIsWrong(fetchImpl = fetch) {
  const id = BSKY_ID
  if (!id) return 'BLUESKY_IDENTIFIER is empty.'
  if (id.startsWith('@')) return `BLUESKY_IDENTIFIER starts with "@". Bluesky wants "${id.slice(1)}", with no @.`
  // An email is a legitimate identifier and there is nothing public to resolve it against, so
  // say what can honestly be said rather than inventing a verdict.
  if (id.includes('@')) return 'BLUESKY_IDENTIFIER looks like an email, which is valid but cannot be checked from here. Try the full handle instead, which can.'
  if (!id.includes('.')) return `BLUESKY_IDENTIFIER is "${id}", which is not a full handle. It needs the domain too, e.g. "${id}.bsky.social".`
  try {
    const res = await fetchImpl(
      `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(id)}`,
      { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (res.ok) return `The handle "${id}" resolves, so the identifier is right and BLUESKY_APP_PASSWORD is what is wrong. Generate a fresh App Password (Settings, Privacy and Security, App Passwords), keep its hyphens, and make sure it is not the account password.`
    return `The handle "${id}" does not resolve (${res.status}), so BLUESKY_IDENTIFIER is what is wrong. Check the exact handle on your Bluesky profile page.`
  } catch {
    // The check is a courtesy. If it cannot run, the original error still stands on its own.
    return 'Check BLUESKY_IDENTIFIER is the full handle (no leading @) and BLUESKY_APP_PASSWORD is an App Password rather than the account password.'
  }
}

async function blueskyToken(fetchImpl = fetch) {
  const res = await fetchImpl('https://bsky.social/xrpc/com.atproto.server.createSession', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ identifier: BSKY_ID, password: BSKY_PASSWORD }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) {
    // NAME THE REASON THE SERVER GAVE. This line used to assert one cause ("must be an app
    // password"), which is only one of four things a 401 here means, and the other three are
    // invisible while it is guessing: a handle with a leading @, an identifier that is neither
    // the full handle nor the account email, and two-factor being on, which answers
    // AuthFactorTokenRequired and cannot be satisfied by any secret we could store. XRPC puts a
    // machine-readable `error` in the body; a wrong guess in an error message costs more time
    // than no guess at all.
    const body = await res.json().catch(() => null)
    const named = body?.error ? `${body.error}${body.message ? `: ${body.message}` : ''}` : await res.text().catch(() => '')
    const hint = body?.error === 'AuthFactorTokenRequired'
      ? ' Two-factor is on for this account. No stored secret can answer it: turn off email 2FA, or use an account without it.'
      // "Invalid identifier or password" cannot say WHICH, and the two have nothing in common
      // to check. So ask the half that can be checked without a credential.
      : ` ${await whichHalfIsWrong(fetchImpl)}`
    throw new Error(`Bluesky refused the session (${res.status}) ${String(named).slice(0, 200)}.${hint}`)
  }
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
    name: 'Reddit comments',
    search: searchRedditComments,
    // The same credential as the search above. Listed separately anyway, because the two fail
    // for different reasons and each has to be able to report without the other.
    configured: () => Boolean(REDDIT_ID && REDDIT_SECRET),
    hint: 'Same REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET as the search above.',
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
    // A comment is judged against its parent post's title as well, and can never be a plain
    // mention. `classifyComment` carries the reasoning; the short version is that "where can I
    // watch this?" names no league, and that every other comment in the same thread would
    // inherit one from the title if it could.
    const verdict = r.form === 'comment'
      ? classifyComment(r.text, r.parent_title)
      : classify(`${r.title ?? ''}\n${r.text ?? ''}`)
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
  // `hoursSince` returns Infinity when there has never been a successful run, which is the
  // NORMAL state on a fresh install with a bad secret, not a rare edge. Formatting it as a
  // duration produced "No source has answered for Infinityh", which reads as a crash and hides
  // the actually useful fact: this has never worked, so it is setup rather than an outage.
  const forHow = Number.isFinite(hours) ? `for ${Math.floor(hours)}h` : 'since this job was set up, not once'
  return [
    `⚠️  **Mention watcher is blind.** No source has answered ${forHow}.`,
    ...errors.map(e => `• \`${String(e).slice(0, 500)}\``),
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

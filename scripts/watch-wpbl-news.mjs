#!/usr/bin/env node
/**
 * watch-wpbl-news.mjs: tell the owner when the league publishes anything, anywhere we can read.
 *
 * WHY. Off-season news arrives in places nothing else here reads. On Nov 7-8, 2026 the league
 * confirmed 2027 in a YouTube Short, posted a roster explainer and opened a draft application
 * page, and each was found by someone happening to look. The stats feed will carry the 2027
 * season one day with no announcement at all. This reads every source each run and reports what
 * is new or changed since the last one.
 *
 * WHO HEARS WHAT. The stats feed (a new season, club or game) and the league's own club and venue
 * records push to the owner's phone: those change what the ingest does and what the site may say.
 * Everything else (posts, pages, player status, the website calendar, promos, partners, YouTube,
 * press coverage) goes to the ops Discord channel as a quiet digest. Which sources are loud is
 * LOUD_SOURCES in shared/newsWatch.js, beside its tests. A website calendar game in a later year
 * than the season we hold is loud too: that is the next schedule.
 *
 * WHAT IT NEVER DOES. It changes no league data and posts nowhere but our own webhook and the
 * owner's own devices. Any mirroring stays with the jobs that already own it.
 *
 * A NEW SOURCE SEEDS SILENTLY: its first good read is recorded and reported as nothing, so
 * adding one never floods the channel with the league's history.
 *
 * A FAILED READ IS NOT "NO NEWS". Each source is read on its own; one failing never stops the
 * rest. A source failing FAILURES_BEFORE_RED runs in a row turns the run red, which
 * workflow-failure-alert.yml pages, because by then the source has moved, not hiccuped.
 *
 * DELIVERY BEFORE BOOKKEEPING. Alerts are sent first and the store written after, so a crash in
 * between repeats a report rather than losing one. If news was found and neither the push nor
 * Discord took it, nothing is written and the next run tries again.
 *
 * Usage:
 *   npm run news-watch                  # check, alert, record
 *   npm run news-watch -- --dry-run     # check and print what would be reported; write and send nothing
 *   npm run news-watch -- --status      # print each source's last read
 *   npm run news-watch -- --reseed      # record everything as seen, report nothing
 *   npm run news-watch -- --test        # send one sample push and Discord post, read nothing
 *
 * Credentials: SUPABASE_DB_URL (state, the owner's push subscriptions, the heartbeat).
 * For alerts: VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY (push), DISCORD_ALERTS_WEBHOOK_URL (digest).
 * Either may be missing; the run says so and uses whichever it has.
 */

import pg from 'pg'
import webpush from 'web-push'
import {
  diffSource, isLoud, isNextSeasonDate, decodeEntities, describe, chunkLines, pushSummary,
  FAILURES_BEFORE_RED,
} from '../shared/newsWatch.js'
import { buildLeagueNewsAlert } from '../shared/notifications.js'

const FEED = 'https://stats.womensprobaseballleague.com/v1'
const SITE = 'https://www.womensprobaseballleague.com'
const WP   = `${SITE}/wp-json/wp/v2`
// The league's own YouTube channel, as in scripts/sync-wpbl-youtube.mjs. Read from our mirror
// (wpbl_videos), not YouTube: the public uploads feed 404s for hours at a time, and the sync
// already pays for the reliable read.
const LEAGUE_CHANNEL_ID = 'UCtd3k09dk2H6UjU7skfmemQ'
// The season the site already holds. A calendar game after this year is the next schedule.
const KNOWN_SEASON_YEAR = 2026
// Press coverage older than this is not news, however recently Google surfaced it.
const NEWS_MAX_AGE_MS = 14 * 24 * 60 * 60_000
// "WPBL" alone is also the World Pickleball League, hence the full name and the exclusion.
const NEWS_QUERIES = ['"Women\'s Pro Baseball League"', 'WPBL baseball -pickleball']

const OWNER_EMAIL = 'snichols246@gmail.com' // mirrors public.is_site_owner(), as check-admin-health does
const HEARTBEAT_JOB = 'wpbl-news-watch'
const UA = 'sportydolphin.fun league news watch (+https://sportydolphin.fun)'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const STATUS  = args.includes('--status')
const RESEED  = args.includes('--reseed')
const TEST    = args.includes('--test')

const DB_URL = process.env.SUPABASE_DB_URL ?? ''
const DISCORD_WEBHOOK = (process.env.DISCORD_ALERTS_WEBHOOK_URL ?? '').trim()
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY ?? process.env.VITE_VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@sportydolphin.fun'
if (VAPID_PUBLIC && VAPID_PRIVATE) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

if (!DB_URL) {
  console.error('❌  Set SUPABASE_DB_URL (the connection string npm run migrate uses).')
  process.exit(1)
}
const db = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })

// ─── Reading ──────────────────────────────────────────────────────────────────

async function fetchText(url, { accept = 'application/json' } = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept },
    signal: AbortSignal.timeout(30_000),
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`${res.status} from ${url}`)
  return { text: await res.text(), headers: res.headers }
}

async function fetchJson(url) {
  const { text, headers } = await fetchText(url)
  try { return { json: JSON.parse(text), headers } }
  catch { throw new Error(`not JSON from ${url}: ${text.slice(0, 80)}`) }
}

/** Every row of a WordPress collection. The REST API caps a page at 100 and says how many pages. */
async function wpAll(type, fields) {
  const out = []
  for (let page = 1; page <= 50; page++) {
    const { json, headers } = await fetchJson(`${WP}/${type}?per_page=100&page=${page}&_fields=${fields}`)
    if (!Array.isArray(json)) throw new Error(`${type}: expected an array`)
    out.push(...json)
    const pages = Number(headers.get('x-wp-totalpages') ?? '1')
    if (page >= pages) return out
  }
  throw new Error(`${type}: more than 50 pages, which is not a collection this site has`)
}

const wpTitle = r => decodeEntities(r.title?.rendered ?? r.slug ?? String(r.id))

/** A WordPress type where only a new row or a retitled one is news. */
const wpSimple = type => async () =>
  (await wpAll(type, 'id,slug,link,title')).map(r => ({
    key: String(r.id), fingerprint: wpTitle(r), title: wpTitle(r), url: r.link,
  }))

// Every source, by the name stored in wpbl_news_watch.source. Order is the report order.
const SOURCES = {
  // ── The stats feed: what the ingest will read ──
  'feed-season': async () => {
    const { json } = await fetchJson(`${FEED}/seasons`)
    return (json.seasons ?? []).map(s => ({ key: s.season_id, fingerprint: s.name, title: s.name }))
  },
  'feed-team': async () => {
    const { json } = await fetchJson(`${FEED}/teams`)
    return (json.teams ?? []).map(t => ({
      key: `${t.season_id}:${t.team_id}`, fingerprint: t.team_name, title: t.team_name,
    }))
  },
  'feed-game': async () => {
    // /games caps at 50 in silence without ?limit (supabase/functions/wpbl-ingest/CLAUDE.md),
    // so ask for far more than exist and refuse a short read rather than call it complete.
    const { json } = await fetchJson(`${FEED}/games?limit=1000`)
    const games = json.games ?? []
    if (typeof json.count === 'number' && json.count > games.length) {
      throw new Error(`/games returned ${games.length} of ${json.count}`)
    }
    return games.map(g => ({
      key: g.game_id,
      // Only a new game is news here. Score and status edits to known games are the drift
      // check's job, and reporting them would bury the one line that matters.
      fingerprint: g.game_id,
      title: `${g.away_team_name} @ ${g.home_team_name}, ${(g.scheduled_start ?? '').slice(0, 10) || 'no date'}`,
    }))
  },

  // ── The league's website ──
  'site-post': async () => {
    // The newest 50 are plenty at a 3-hour cadence; older posts cannot be new.
    const { json } = await fetchJson(`${WP}/posts?per_page=50&_fields=id,link,title,date`)
    return json.map(r => ({
      key: String(r.id), fingerprint: wpTitle(r), title: wpTitle(r), url: r.link,
    }))
  },
  'site-page': async () =>
    (await wpAll('pages', 'id,link,title,modified')).map(r => ({
      // A page is a standing thing (tickets, schedule, the draft application), so an edit to
      // one is the news, not just its creation.
      key: String(r.id), fingerprint: r.modified, title: wpTitle(r), url: r.link,
      note: `edited ${r.modified?.slice(0, 16).replace('T', ' ')}`,
    })),
  'site-transaction': wpSimple('wpbl-transactions'),
  'site-team': wpSimple('wpbl_team'),
  'site-venue': wpSimple('wpbl_venue'),
  'site-game': wpSimple('wpbl_game'),
  'site-promo': wpSimple('wpbl_promo'),
  'site-partner': wpSimple('wpbl_partner'),
  'site-video': async () => [
    ...(await wpSimple('video')()).map(i => ({ ...i, key: `video:${i.key}` })),
    ...(await wpSimple('wpbl_video')()).map(i => ({ ...i, key: `wpbl_video:${i.key}` })),
  ],
  'site-player': async () => {
    // Status and club are where a re-signing, a release or a new signing shows first: the
    // league edits a player's record before it writes anything about it.
    const teams = new Map((await wpAll('wpbl_team', 'id,title')).map(t => [String(t.id), wpTitle(t)]))
    const rows = await wpAll('wpbl_player', 'id,link,title,acf.player_status,acf.team_post')
    return rows.map(r => {
      const status = r.acf?.player_status?.value || 'no status'
      const teamId = String(r.acf?.team_post?.value ?? '')
      const club = teams.get(teamId) ?? (teamId ? `club ${teamId}` : 'no club')
      const now = `${status}, ${club}`
      return { key: String(r.id), fingerprint: now, title: wpTitle(r), url: r.link, note: now }
    })
  },
  'site-calendar': async () => {
    const { json } = await fetchJson(`${SITE}/wp-json/wpbl/v1/calendar-events`)
    if (!Array.isArray(json)) throw new Error('calendar-events: expected an array')
    return json.map(e => ({
      key: String(e.id),
      fingerprint: `${e.start}|${decodeEntities(e.title)}`,
      title: `${decodeEntities(e.title)}, ${String(e.start ?? '').slice(0, 10)}`,
      url: e.url,
      loud: isNextSeasonDate(e.start, KNOWN_SEASON_YEAR),
    }))
  },

  // ── Elsewhere ──
  'youtube': async () => {
    const { rows } = await db.query(
      `select video_id, title, is_short from public.wpbl_videos
        where channel_id = $1 order by published_at desc nulls last limit 100`, [LEAGUE_CHANNEL_ID])
    return rows.map(v => ({
      key: v.video_id, fingerprint: v.title ?? '', title: v.title ?? v.video_id,
      url: v.is_short ? `https://youtube.com/shorts/${v.video_id}` : `https://youtu.be/${v.video_id}`,
    }))
  },
  'news': async () => {
    const out = new Map()
    for (const q of NEWS_QUERIES) {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`
      const { text } = await fetchText(url, { accept: 'application/rss+xml' })
      for (const m of text.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const tag = t => decodeEntities((m[1].match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1] ?? '')
          .replace(/^<!\[CDATA\[|\]\]>$/g, ''))
        const link = tag('link')
        const title = tag('title')
        const when = Date.parse(tag('pubDate'))
        if (!link || !title) continue
        if (Number.isFinite(when) && Date.now() - when > NEWS_MAX_AGE_MS) continue
        // Keyed by headline, not link: Google gives one story a different link per query.
        out.set(title.toLowerCase(), { key: title.toLowerCase().slice(0, 300), fingerprint: '1', title, url: link })
      }
    }
    return [...out.values()]
  },
}

// ─── Store ────────────────────────────────────────────────────────────────────

async function loadState() {
  const { rows: items } = await db.query('select source, key, fingerprint from public.wpbl_news_watch')
  const { rows: sources } = await db.query('select * from public.wpbl_news_watch_sources')
  const bySource = new Map()
  for (const r of items) {
    if (!bySource.has(r.source)) bySource.set(r.source, new Map())
    bySource.get(r.source).set(r.key, r.fingerprint)
  }
  return { bySource, sources: new Map(sources.map(s => [s.source, s])) }
}

async function recordItems(source, items) {
  if (items.length === 0) return
  await db.query(
    `insert into public.wpbl_news_watch (source, key, fingerprint, title, url)
     select $1, k, f, t, u from unnest($2::text[], $3::text[], $4::text[], $5::text[]) as x(k, f, t, u)
     on conflict (source, key) do update
       set fingerprint = excluded.fingerprint, title = excluded.title, url = excluded.url, last_seen = now()`,
    [source, items.map(i => i.key), items.map(i => i.fingerprint), items.map(i => i.title), items.map(i => i.url ?? null)],
  )
}

async function recordSourceOk(source, count) {
  await db.query(
    `insert into public.wpbl_news_watch_sources (source, seeded_at, last_ok_at, last_error, consecutive_failures, items)
     values ($1, now(), now(), null, 0, $2)
     on conflict (source) do update set seeded_at = coalesce(wpbl_news_watch_sources.seeded_at, now()),
       last_ok_at = now(), last_error = null, consecutive_failures = 0, items = $2`,
    [source, count],
  )
}

/** Returns the source's failure streak after this one. Never marks a source seeded. */
async function recordSourceFailure(source, message) {
  const { rows } = await db.query(
    `insert into public.wpbl_news_watch_sources (source, last_error, consecutive_failures)
     values ($1, $2, 1)
     on conflict (source) do update set last_error = $2,
       consecutive_failures = wpbl_news_watch_sources.consecutive_failures + 1
     returning consecutive_failures`,
    [source, message.slice(0, 500)],
  )
  return rows[0]?.consecutive_failures ?? 1
}

async function recordHeartbeat(ok, detail) {
  try {
    await db.query(
      `insert into public.cron_heartbeats (job, ran_at, ok, detail, updated_at) values ($1, now(), $2, $3, now())
       on conflict (job) do update set ran_at = now(), ok = $2, detail = $3, updated_at = now()`,
      [HEARTBEAT_JOB, ok, detail],
    )
  } catch (err) {
    // A heartbeat that fails to record must not turn a clean run red (shared/heartbeat.js).
    console.error(`  heartbeat write failed (non-fatal): ${err.message}`)
  }
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

async function ownerSubscriptions() {
  const { rows } = await db.query(
    `select s.endpoint, s.p256dh, s.auth from public.push_subscriptions s
       join auth.users u on u.id = s.user_id where lower(u.email) = lower($1)`, [OWNER_EMAIL])
  return rows
}

/** Push to every owner device; returns how many took it. Prunes the expired ones, as the senders do. */
async function pushToOwner(n) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) { console.warn('  ⚠️  No VAPID keys, so no push.'); return 0 }
  const subs = await ownerSubscriptions()
  if (subs.length === 0) console.warn('  ⚠️  The owner has no push subscriptions.')
  const body = JSON.stringify({ id: n.id, type: n.type, title: n.title, body: n.body, url: n.url, emoji: n.icon, tag: n.id })
  let sent = 0
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body)
      sent++
    } catch (err) {
      const code = err?.statusCode
      if (code === 404 || code === 410) {
        await db.query('delete from public.push_subscriptions where endpoint = $1', [s.endpoint])
        console.log(`  🧹 Pruned expired subscription (${code})`)
      } else {
        console.warn(`  ⚠️  Push failed (${code ?? 'no status'}): ${err?.body ?? err?.message ?? err}`)
      }
    }
  }
  return sent
}

/** Post the lines to the ops channel; true only when every message landed. */
async function postToDiscord(header, lines) {
  if (!DISCORD_WEBHOOK) { console.warn('  ⚠️  No DISCORD_ALERTS_WEBHOOK_URL, so no Discord post.'); return false }
  let ok = true
  for (const content of chunkLines(header, lines)) {
    try {
      const res = await fetch(DISCORD_WEBHOOK, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Never ping anyone from text the league or a news site wrote.
        body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) { ok = false; console.warn(`  ⚠️  Discord post failed (${res.status})`) }
    } catch (err) {
      ok = false
      console.warn(`  ⚠️  Discord post failed: ${err?.message ?? err}`)
    }
  }
  return ok
}

// Angle brackets stop Discord unfurling every link into a card.
const discordLine = r => `• ${describe(r.source, r.kind, r.item)}${r.item.url ? ` <${r.item.url}>` : ''}`

// ─── Modes ────────────────────────────────────────────────────────────────────

async function runStatus() {
  const { sources } = await loadState()
  for (const name of Object.keys(SOURCES)) {
    const s = sources.get(name)
    if (!s) { console.log(`${name.padEnd(17)} never read`); continue }
    const ok = s.last_ok_at ? new Date(s.last_ok_at).toISOString().slice(0, 16) : 'never'
    console.log(`${name.padEnd(17)} ${String(s.items).padStart(4)} items, last good read ${ok}` +
      (s.consecutive_failures ? `, ${s.consecutive_failures} failure(s) in a row: ${s.last_error}` : ''))
  }
}

async function runTest() {
  const n = buildLeagueNewsAlert({
    key: `test-${Date.now()}`,
    title: 'WPBL: news watch test',
    body: 'A test of the league news alert. If you can read this, new league data will reach this phone.',
  })
  const sent = await pushToOwner(n)
  const posted = await postToDiscord('📰 **League news watch: test**', ['• If you can read this, the quiet digest reaches this channel.'])
  console.log(`✅ Test push sent to ${sent} device(s); Discord ${posted ? 'posted' : 'not posted'}.`)
  if (sent === 0 && !posted) process.exitCode = 1
}

async function main() {
  await db.connect()
  try {
    if (STATUS) return await runStatus()
    if (TEST) return await runTest()

    const { bySource, sources } = await loadState()
    const reports = []
    const reads = []   // { source, items } for the sources that read cleanly
    const failures = []

    const results = await Promise.allSettled(Object.entries(SOURCES).map(async ([name, read]) => ({ name, items: await read() })))
    results.forEach((r, i) => {
      const name = Object.keys(SOURCES)[i]
      if (r.status === 'rejected') { failures.push({ name, message: String(r.reason?.message ?? r.reason) }); return }
      const { items } = r.value
      const seeded = Boolean(sources.get(name)?.seeded_at) && !RESEED
      const { added, changed, seeding } = diffSource(bySource.get(name) ?? new Map(), items, { seeded })
      reads.push({ name, items })
      if (seeding) console.log(`🌱 ${name}: ${RESEED ? 'reseeded' : 'first read, seeded'} with ${items.length} item(s)`)
      for (const item of added) reports.push({ source: name, kind: 'added', item })
      for (const item of changed) {
        const note = item.note && item.before && name === 'site-player' ? `${item.before} → ${item.note}` : item.note
        reports.push({ source: name, kind: 'changed', item: { ...item, note } })
      }
    })

    const loud = reports.filter(r => isLoud(r.source, r.item))
    const quiet = reports.filter(r => !isLoud(r.source, r.item))
    for (const r of reports) console.log(`${isLoud(r.source, r.item) ? '📣' : '  '} ${describe(r.source, r.kind, r.item)}`)
    for (const f of failures) console.warn(`⚠️  ${f.name}: ${f.message}`)
    if (reports.length === 0) console.log('No league news since the last run.')

    if (DRY_RUN) { console.log('Dry run: nothing sent, nothing recorded.'); return }

    // Deliver first (see the header). A loud item reaches Discord as well as the phone, so the
    // channel stays the complete record.
    if (reports.length > 0) {
      let delivered = false
      if (loud.length > 0) {
        const summary = pushSummary(loud)
        const sent = await pushToOwner(buildLeagueNewsAlert({ key: String(Date.now()), ...summary }))
        console.log(`📱 Pushed to ${sent} device(s): ${summary.title}`)
        delivered = sent > 0
      }
      const lines = [...loud, ...quiet].map(discordLine)
      const posted = await postToDiscord(`📰 **League news** (${reports.length})`, lines)
      delivered = delivered || posted
      if (!delivered) throw new Error(`found ${reports.length} item(s) but could deliver none; recording nothing so the next run retries`)
    }

    for (const { name, items } of reads) {
      await recordItems(name, items)
      await recordSourceOk(name, items.length)
    }
    const red = []
    for (const f of failures) {
      const streak = await recordSourceFailure(f.name, f.message)
      if (streak >= FAILURES_BEFORE_RED) red.push(`${f.name} (${streak} in a row): ${f.message}`)
    }

    const detail = `${reports.length} reported (${loud.length} pushed), ${reads.length}/${Object.keys(SOURCES).length} sources read` +
      (failures.length ? `; failing: ${failures.map(f => f.name).join(', ')}` : '')
    await recordHeartbeat(red.length === 0, red.length ? red.join('; ').slice(0, 500) : detail)
    console.log(`Done: ${detail}`)
    if (red.length) {
      console.error(`❌ Source(s) failing too long:\n  ${red.join('\n  ')}`)
      process.exitCode = 1
    }
  } finally {
    await db.end()
  }
}

main().catch(async err => {
  console.error(`❌ ${err.message}`)
  process.exitCode = 1
})

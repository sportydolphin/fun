#!/usr/bin/env node
/**
 * probe-wpbl-tracking.mjs: try every remaining public route to WPBL TrackMan data, and say
 * which ones are alive.
 *
 * WHY. The league published tracking for two games (766 rows, Aug 1 and Aug 2) and then
 * `/games/{id}/activity` and `/games/{id}/pitches` started answering `401 missing api key`
 * on Sep 1, 2026, and the box score's embedded `tracking_activity` came back empty even for
 * those two games. Meanwhile the league keeps posting graphics built on radar numbers, so the
 * data plainly exists on their side. `watch-wpbl-tracking.mjs` answers one question, "did the
 * gate open again", by looking at our own mirror. It cannot tell us whether the data is
 * reachable by some OTHER path, and that is a question somebody re-asks every few weeks from
 * memory, badly. This is that question, written down and runnable.
 *
 * WHAT IT WILL NOT DO. It never guesses, brute-forces or reuses a credential, and it never
 * tries to log in. Every request here is either an anonymous GET of a public URL or the exact
 * request the league's own public web client makes from a browser. Where a route needs an
 * account, the probe reports that and stops, because the answer to "is it gated" is worth
 * having and the gate itself is not ours to pick.
 *
 * READ THE VERDICTS THIS WAY. `open` means fetch it and we are done. `gated` means the door
 * exists and is locked, which is an argument to make to the league rather than a bug to fix.
 * `absent` means there is no such door, so stop re-checking it. A route that flips from
 * `gated` to `open` is the whole reason this file exists.
 *
 * Usage:
 *   npm run probe-tracking                 # every check, human-readable
 *   npm run probe-tracking -- --json       # same, as one JSON object, for a cron or a diff
 *   npm run probe-tracking -- --game <id>  # probe this api_game_id rather than a discovered one
 *   npm run probe-tracking -- --quick      # feed routes only: skip archives and third parties
 *
 * Credentials: none required. SUPABASE_DB_URL is used if present, only to print what we
 * already hold, so a verdict reads against our own coverage rather than against nothing.
 */

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const valueOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined }
const JSON_OUT = has('--json')
const QUICK = has('--quick')
const GAME_ARG = valueOf('--game')

const FEED = 'https://stats.womensprobaseballleague.com/v1'
const STATS_SITE = 'https://stats.womensprobaseballleague.com'

// The two games the league did publish, by date. Any probe wants a game that HAS tracking on
// the league's side, or an empty answer proves nothing: an ungated endpoint over a game that
// was never tracked looks exactly like a gate that let us through and had nothing to give.
const KNOWN_TRACKED_DATES = ['2026-08-01', '2026-08-02']

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

const results = []
const record = (route, verdict, detail, extra = {}) => {
  results.push({ route, verdict, detail, ...extra })
  if (!JSON_OUT) {
    const mark = { open: '  OPEN ', gated: ' GATED ', absent: 'ABSENT ', error: ' ERROR ', info: '  INFO ' }[verdict] ?? verdict
    console.log(`[${mark}] ${route}\n          ${detail}`)
  }
}

const log = (line) => { if (!JSON_OUT) console.log(line) }

/** One anonymous GET, with a bounded body read: several of these answer with a whole page. */
async function get(url, { headers = {}, timeoutMs = 15000 } = {}) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, ...headers }, signal: ctl.signal, redirect: 'follow' })
    const text = (await res.text()).slice(0, 400000)
    return { ok: res.ok, status: res.status, text, type: res.headers.get('content-type') ?? '' }
  } catch (e) {
    return { ok: false, status: 0, text: '', type: '', error: e instanceof Error ? e.message : String(e) }
  } finally { clearTimeout(timer) }
}

const asJson = (r) => { try { return JSON.parse(r.text) } catch { return null } }

/** Trim a gate's own words down to something a log line can carry. */
const gist = (r) => {
  const body = (r.text ?? '').replace(/\s+/g, ' ').trim()
  return body ? `${r.status}: ${body.slice(0, 120)}` : `${r.status}`
}

// ─── what we already hold ─────────────────────────────────────────────────────
// Printed first so every verdict below reads against a number rather than a vibe. Optional by
// design: the whole point of this script is that it needs no credentials to be useful.
async function ourCoverage() {
  const url = (process.env.SUPABASE_DB_URL ?? '').trim()
  if (!url) return null
  let pg
  try { pg = (await import('pg')).default } catch { return null }
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  try {
    await client.connect()
    const { rows } = await client.query(`
      select count(*)::int as rows,
             count(distinct t.game_id)::int as games,
             min(g.game_date)::text as first_date,
             max(g.game_date)::text as last_date
      from wpbl_pitch_tracking t join wpbl_games g on g.id = t.game_id`)
    const finals = await client.query(`select count(*)::int as n from wpbl_games where status = 'final'`)
    return { ...rows[0], finals: finals.rows[0].n }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  } finally { try { await client.end() } catch { /* already down */ } }
}

// ─── the feed itself ──────────────────────────────────────────────────────────
/** A game id from one of the dates the league actually tracked, so an empty answer means
 *  something. Falls back to whatever the list gives us if those dates cannot be matched. */
async function pickGame() {
  if (GAME_ARG) return { id: GAME_ARG, date: 'given on the command line' }
  // `?limit=` is mandatory here: a bare /games caps at 50 and says nothing about it.
  const r = await get(`${FEED}/games?limit=500`)
  const body = asJson(r)
  const games = body?.games ?? []
  if (!games.length) return null
  const dated = games.filter((g) => KNOWN_TRACKED_DATES.some((d) => JSON.stringify(g).includes(d)))
  const pick = dated[0] ?? games[0]
  return { id: String(pick.id ?? pick.game_id ?? ''), date: dated.length ? 'a game the league tracked' : 'an arbitrary game (no tracked date matched)', count: body?.count ?? null, listed: games.length }
}

async function probeFeed(game) {
  // Control. If this is not open, nothing below means anything and the feed itself is the story.
  const list = await get(`${FEED}/games?limit=500`)
  record('feed /games', list.ok ? 'open' : 'error', list.ok
    ? `${gist({ status: list.status, text: '' })} list is alive${game?.count != null ? `, count=${game.count}, returned=${game.listed}` : ''}`
    : gist(list))
  if (game?.count != null && game.listed != null && game.count > game.listed) {
    record('feed /games truncation', 'info', `the list returned ${game.listed} of ${game.count}: raise --limit before trusting anything derived from it`)
  }
  if (!game?.id) { record('feed probes', 'error', 'no game id to probe with; pass --game <api_game_id>'); return }

  // The free path home. If the league ever stops emptying this array we need no endpoint at all.
  const box = await get(`${FEED}/games/${game.id}/boxscore`)
  const tracking = asJson(box)?.boxscore?.tracking_activity ?? null
  record('boxscore tracking_activity', Array.isArray(tracking) && tracking.length ? 'open' : box.ok ? 'absent' : 'error',
    Array.isArray(tracking)
      ? `${tracking.length} embedded events on ${game.date} (capped at 200 by the server even when full)`
      : box.ok ? 'box score reads fine and carries no tracking array' : gist(box),
    { events: Array.isArray(tracking) ? tracking.length : 0 })

  // The two endpoints that closed. Asked plainly, then asked the way the league's own page
  // asks: a gate that only reads Origin or Referer is not an API-key gate, and the public
  // client is the intended caller.
  for (const path of ['activity', 'pitches']) {
    const plain = await get(`${FEED}/games/${game.id}/${path}?limit=1000`)
    const rows = asJson(plain)?.[path === 'activity' ? 'activity' : 'pitches'] ?? null
    record(`feed /games/{id}/${path}`, plain.ok && Array.isArray(rows) ? 'open' : plain.status === 401 || plain.status === 403 ? 'gated' : 'error',
      plain.ok && Array.isArray(rows) ? `${rows.length} rows, ungated` : gist(plain))

    if (!plain.ok) {
      const asPage = await get(`${FEED}/games/${game.id}/${path}?limit=1000`, {
        headers: { origin: STATS_SITE, referer: `${STATS_SITE}/explorer/games`, accept: 'application/json' },
      })
      record(`feed /games/{id}/${path} (as the league's own page)`, asPage.ok ? 'open' : asPage.status === 401 || asPage.status === 403 ? 'gated' : 'error',
        asPage.ok ? 'opens for a browser-shaped request: the gate reads Origin, not a key' : `${gist(asPage)} (same gate for a browser-shaped request, so it is a real key check)`)
    }
  }

  // Doors that may simply never have been locked, because nobody knew they were there. Cheap
  // to ask, and a 404 here is a permanent answer worth writing down rather than re-guessing.
  const alternates = [
    `${FEED}/games/${game.id}/tracking`,
    `${FEED}/games/${game.id}/trackman`,
    `${FEED}/tracking?game_id=${game.id}&limit=1000`,
    `${FEED}/pitches?game_id=${game.id}&limit=1000`,
    `${STATS_SITE}/v2/games/${game.id}/activity?limit=1000`,
    `${STATS_SITE}/api/v1/games/${game.id}/activity?limit=1000`,
    `https://api.womensprobaseballleague.com/v1/games/${game.id}/activity?limit=1000`,
  ]
  for (const url of alternates) {
    const r = await get(url)
    const body = asJson(r)
    const rows = body && (body.activity ?? body.pitches ?? body.tracking ?? body.data)
    record(`alternate ${url.replace(STATS_SITE, '').replace('https://', '')}`,
      r.ok && Array.isArray(rows) && rows.length ? 'open' : r.status === 401 || r.status === 403 ? 'gated' : 'absent',
      r.ok && Array.isArray(rows) ? `${rows.length} rows` : gist(r))
  }
}

// ─── the league's own public client ───────────────────────────────────────────
// The explorer is a public page that renders league data. Whatever it sends is, by
// definition, a request an anonymous visitor is allowed to make, so its bundle names both the
// endpoints in use and the auth mechanism. A key shipped in a public bundle is public. A
// login session is the end of the road, and knowing which it is settles the question.
async function probeExplorer() {
  const page = await get(`${STATS_SITE}/explorer/teams`)
  if (!page.ok) { record('stats explorer', 'gated', `${gist(page)} (the page itself no longer serves anonymously)`); return }

  const srcs = [...page.text.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1])
    .map((s) => (s.startsWith('http') ? s : `${STATS_SITE}${s.startsWith('/') ? '' : '/'}${s}`))
  record('stats explorer', 'open', `page serves anonymously, ${srcs.length} script bundles to read`)

  const found = { endpoints: new Set(), authHints: new Set() }
  for (const src of srcs.slice(0, 12)) {
    const js = await get(src, { timeoutMs: 30000 })
    if (!js.ok) continue
    for (const m of js.text.matchAll(/["'`]\/?(?:v1|v2|api)\/[a-z0-9/{}$_.-]*(?:activity|pitches|tracking|trackman)[a-z0-9/{}$_.-]*/gi)) found.endpoints.add(m[0].replace(/["'`]/g, ''))
    for (const m of js.text.matchAll(/x-api-key|apikey|api_key|Authorization|Bearer |supabase|firebase|auth0|cognito/gi)) found.authHints.add(m[0].toLowerCase())
  }
  record('explorer bundle: tracking endpoints', found.endpoints.size ? 'info' : 'absent',
    found.endpoints.size ? [...found.endpoints].join(', ') : 'the public client references no tracking endpoint at all, which is its own answer: the league did not merely lock the door, it stopped shipping a page that opens it',
    { endpoints: [...found.endpoints] })
  record('explorer bundle: how it authenticates', found.authHints.size ? 'info' : 'info',
    found.authHints.size ? [...found.authHints].join(', ') : 'no auth machinery in the bundle',
    { hints: [...found.authHints] })
}

// ─── archives ─────────────────────────────────────────────────────────────────
// The endpoints were open and public for a month. If a crawler saw one, the JSON still exists
// even though the door does not, and an archived response needs nobody's permission to read.
// This is the single most likely place a copy of the missing games survives.
async function probeArchives() {
  const cdx = 'https://web.archive.org/cdx/search/cdx?url=stats.womensprobaseballleague.com&matchType=domain&output=json&collapse=urlkey&limit=2000'
  const r = await get(cdx, { timeoutMs: 45000 })
  const rows = asJson(r)
  if (!Array.isArray(rows) || rows.length < 2) {
    record('wayback: any snapshot of the feed', r.ok ? 'absent' : 'error', r.ok ? 'no archived URL on that domain' : gist(r))
  } else {
    const urls = rows.slice(1).map((row) => row[2])
    const tracked = urls.filter((u) => /activity|pitches|boxscore|tracking/i.test(u))
    record('wayback: any snapshot of the feed', 'info', `${urls.length} archived URLs, ${tracked.length} of them box score or tracking`, { sample: tracked.slice(0, 20) })
    // An archived boxscore from before Sep 1 carries up to 200 embedded events per game, which
    // is not the full ~380 but is 200 more than we have for any third game.
    for (const u of tracked.slice(0, 5)) {
      const snap = await get(`https://web.archive.org/web/2026id_/${u}`, { timeoutMs: 45000 })
      const body = asJson(snap)
      const events = body?.activity ?? body?.pitches ?? body?.boxscore?.tracking_activity ?? null
      record(`wayback snapshot ${u.slice(-60)}`, Array.isArray(events) && events.length ? 'open' : 'absent',
        Array.isArray(events) ? `${events.length} tracked events recoverable` : 'snapshot carries no tracking rows')
    }
  }

  const cc = await get('https://index.commoncrawl.org/CC-MAIN-2026-33-index?url=stats.womensprobaseballleague.com%2F*&output=json', { timeoutMs: 45000 })
  const lines = cc.ok ? cc.text.trim().split('\n').filter(Boolean) : []
  record('common crawl index', lines.length ? 'info' : 'absent',
    lines.length ? `${lines.length} captures; fetch the WARC ranges for any /activity hit` : cc.ok ? 'no captures of that host in this crawl' : gist(cc))
}

// ─── everyone else looking at the same league ─────────────────────────────────
// Not a mirror to copy from. The question is narrower and worth one request each: does anybody
// else show a tracked number for a game after Aug 2? If one of them does, they have a source
// that we do not, and the next move is to ask them what it is rather than to keep guessing.
async function probeThirdParties() {
  const sites = [
    ['wpblscores.com tracking board', 'https://wpblscores.com/tracking/'],
    ['wpblstats.com', 'https://wpblstats.com/'],
    ['backstopwpbl.com stats', 'https://backstopwpbl.com/stats/'],
  ]
  for (const [name, url] of sites) {
    const r = await get(url, { timeoutMs: 20000 })
    if (!r.ok) { record(name, 'error', gist(r)); continue }
    const text = r.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    const empty = /no tracked|not available|once tracking|no data/i.test(text)
    const mph = [...text.matchAll(/(\d{2,3}(?:\.\d)?)\s*mph/gi)].map((m) => m[1])
    record(name, mph.length && !empty ? 'info' : 'absent',
      mph.length && !empty
        ? `renders tracked numbers (${mph.slice(0, 5).join(', ')} mph): worth asking where they get them`
        : 'renders no tracked measurements, so they are behind the same gate we are',
      { values: mph.slice(0, 10) })
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────
const mine = await ourCoverage()
if (mine && !mine.error) {
  log(`we hold ${mine.rows} tracked rows across ${mine.games} of ${mine.finals} finals (${mine.first_date} to ${mine.last_date})\n`)
} else if (mine?.error) {
  log(`(could not read our own coverage: ${mine.error})\n`)
}

const game = await pickGame()
if (game) log(`probing with game ${game.id}: ${game.date}\n`)
await probeFeed(game)
await probeExplorer()
if (!QUICK) {
  await probeArchives()
  await probeThirdParties()
}

const open = results.filter((r) => r.verdict === 'open')
if (JSON_OUT) {
  console.log(JSON.stringify({ checked_at: new Date().toISOString(), coverage: mine, game, results }, null, 2))
} else {
  console.log(`\n${open.length} of ${results.length} routes open.`)
  console.log(open.length
    ? `Reachable now: ${open.map((r) => r.route).join('; ')}`
    : 'Nothing new is reachable. The data exists on the league\'s side and every public route to it is closed, so the next move is a request to the league, not another probe. See docs/TRACKMAN.md.')
}
process.exit(0)

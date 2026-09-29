#!/usr/bin/env node
/**
 * sync-wpbl-youtube.mjs: mirror WPBL YouTube uploads into Supabase.
 *
 * TWO CHANNELS (see CHANNELS): the league's own, and "WPBL from Day 1", a fan channel of
 * condensed games and season compilations embedded with permission. Each row records its
 * `channel_id`. Each channel has its own title classifier, and only the league's rows ever
 * reach the Discord poster. Everything below describing the league's title contract is about
 * the league channel; the fan channel's contract is at `classifyFan`.
 *
 * Reads the channel's PUBLIC RSS feed (no API key, no OAuth, no quota — YouTube exposes
 * the latest ~15 uploads at feeds/videos.xml), classifies each upload, parses the game
 * highlights' titles into the WPBL game they recap, and upserts everything into the
 * `wpbl_videos` table. The browser reads that table directly (public RLS), so no viewer
 * ever hits YouTube until they actually click Play on a thumbnail facade.
 *
 * Why RSS and not the YouTube Data API: the feed is free and unauthenticated and gives us
 * exactly what a highlights rail needs (id, title, published, thumbnail) for the recent
 * window that matters. The Data API would add a key, a quota, and daily-limit failure
 * modes for zero extra value here.
 *
 * Title contract (as the league publishes them), e.g.:
 *   "WPBL Highlights: San Francisco @ Los Angeles | August 7, 2026"
 *   "WPBL Highlights: Los Angeles Queens @ New York Heights | August 1st, 2026"
 * i.e. `<away> @ <home> | <Month Day[, ordinal], Year>`. The away/home segments may or may
 * not include the club nickname, and the date may carry an ordinal suffix — the parser
 * tolerates both. Anything that isn't a recognisable "<team> @ <team>" highlight is stored
 * with game_id null (podcasts, league features) so the rail can still show it if we want.
 *
 * Usage (local):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/sync-wpbl-youtube.mjs
 *   node --env-file=.env scripts/sync-wpbl-youtube.mjs --dry-run   # anon key, writes nothing
 *   ... --all   # every upload, not the latest 25 (needs YOUTUBE_API_KEY; for adding a channel)
 *
 * Source: prefers the YouTube Data API v3 when YOUTUBE_API_KEY is set (reliable from CI
 * datacenter IPs), otherwise falls back to the public RSS feed (keyless, but YouTube
 * 404s it intermittently from GitHub runners — hence the API-key path and RSS retries).
 *
 * Required env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY.
 * Optional env: YOUTUBE_API_KEY (preferred source), WPBL_YT_CHANNEL_ID (defaults to
 *               the official channel).
 */

import { createClient } from '@supabase/supabase-js'
import { pathToFileURL } from 'node:url'

// Run only when invoked directly. Imported (by the tests, which exercise the Short probe's
// reading of a response without touching YouTube) this file must define and not do.
const IS_ENTRYPOINT = process.argv[1] != null
  && import.meta.url === pathToFileURL(process.argv[1]).href

// ─── Config ─────────────────────────────────────────────────────────────────

const args = new Set(process.argv.slice(2))
// Print what would be stored and write nothing. Runs on the anon key, since every table it
// reads is public.
const DRY_RUN = args.has('--dry-run')
// Page through every upload instead of the latest 25. Data API only (the RSS feed has no
// paging), and meant for a one-off backfill when a channel is added, not for the schedule.
const ALL = args.has('--all')

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const SUPABASE_KEY = SERVICE_KEY || (DRY_RUN ? process.env.VITE_SUPABASE_ANON_KEY ?? '' : '')
// Official WPBL channel (youtube.com/@wpbl_official). Overridable via the WPBL_YT_CHANNEL_ID
// repo variable. NOTE: GitHub passes an *unset* `vars.X` as an empty string (""), and `??`
// only falls back on null/undefined — so use `|| default` (and trim) to treat "" as unset.
export const LEAGUE_CHANNEL_ID = (process.env.WPBL_YT_CHANNEL_ID || '').trim() || 'UCtd3k09dk2H6UjU7skfmemQ'
// "WPBL from Day 1" (youtube.com/@wpblfanrecaps): a fan's condensed games and season
// compilations, embedded with the owner's explicit permission (Sep 28, 2026). Mirrored beside
// the league's uploads with their own classifier, because their titles follow a different
// contract and the league's classifier reads every one of their condensed games as a league
// highlight reel ("LA Queens vs. NY Heights Highlights | WPBL | Aug. 1, 2026"), which is the
// value the Discord poster keys on.
export const FAN_RECAPS_CHANNEL_ID = 'UC9oWksw_L8tfpxdF6uUiTXw'
// Optional YouTube Data API key. When set, it's the primary source: the Data API is
// authenticated and serves datacenter IPs reliably, whereas the public RSS feed is
// gated by IP/UA reputation and 404s intermittently from CI runners (which is what
// bit the first GitHub Actions run). A channel's uploads playlist id is always its
// channel id with the "UC" prefix swapped for "UU", so no extra channels.list call.
// Trim + strip stray wrapping quotes: pasting a secret into GitHub commonly leaves a
// trailing newline/space (or quotes), which YouTube rejects as "API key not valid" (400).
const YT_API_KEY = (process.env.YOUTUBE_API_KEY ?? '').trim().replace(/^["']|["']$/g, '')
// A realistic browser UA + Accept header materially improves the odds the RSS feed
// returns 200 rather than YouTube's bot-gate 404 for a bare programmatic request.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

if (IS_ENTRYPOINT && (!SUPABASE_URL || !SUPABASE_KEY)) {
  console.error('❌  Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY before running' +
    ' (--dry-run also accepts VITE_SUPABASE_ANON_KEY)')
  process.exit(1)
}
if (IS_ENTRYPOINT && ALL && !YT_API_KEY) {
  console.error('❌  --all pages through the Data API, so it needs YOUTUBE_API_KEY. The RSS feed only ever holds the latest ~15.')
  process.exit(1)
}

const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null

// ─── XML feed parsing ─────────────────────────────────────────────────────────
// The feed is small, well-formed Atom with a fixed shape, so a couple of scoped regexes
// beat pulling in an XML parser dependency (the sibling scripts keep their dep list to
// @supabase/supabase-js + ws for the same reason). We only read four fields per <entry>.

function decodeXml(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
}

function parseEntries(xml) {
  const entries = []
  const blocks = xml.split(/<entry>/).slice(1)
  for (const raw of blocks) {
    const block = raw.split(/<\/entry>/)[0]
    const videoId = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1]
    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]
    const published = block.match(/<published>([^<]+)<\/published>/)?.[1]
    const thumb = block.match(/<media:thumbnail[^>]*\burl="([^"]+)"/)?.[1]
    if (!videoId || !title || !published) continue
    entries.push({
      videoId: videoId.trim(),
      title: decodeXml(title.trim()),
      published,
      // Prefer the feed's thumbnail; fall back to the deterministic poster URL.
      thumbnail: thumb ? decodeXml(thumb) : `https://i.ytimg.com/vi/${videoId.trim()}/hqdefault.jpg`,
    })
  }
  return entries
}

// ─── Title classification + matchup parsing ────────────────────────────────────

// The matchup separator the league actually uses varies: mostly "@", but some uploads say
// "vs." ("WPBL Highlights: Boston Hunters vs. New York Heights | August 9, 2026"). Accept
// both, matching what parseMatchup already splits on — otherwise a "vs." reel lands as
// 'other', drops out of the rail, and never reaches the Discord highlights channel.
const MATCHUP_SEP = /\s@\s|\svs\.?\s/

export function classify(title) {
  const t = title.toLowerCase()
  if (/\bhighlights?\b/.test(t) && MATCHUP_SEP.test(t)) return 'highlight'
  if (/\bpodcast\b|\bepisode\b|\bep\.?\s*\d|dialogues?\b/.test(t)) return 'podcast'
  return 'other'
}

/**
 * WPBL from Day 1's titles, which follow their own contract:
 *
 *   "LA Queens vs. NY Heights Highlights | WPBL | Aug. 1, 2026"            regular season
 *   "[GAME 1] LA Queens vs. SF Firebells | WPBL Championship | Sep. 16, 2026"  postseason
 *   "Top 10 Home Runs of the WPBL Season!"                                   compilation
 *
 * Every matchup upload is a condensed game (their own description calls each one "extended
 * highlights and a condensed game recap"), whether or not the title says "Highlights", and the
 * postseason ones do not. A matchup counts only with a readable date beside it: without one
 * there is no game to match, and a guess would put their video on the wrong night.
 * Anything unrecognised is 'other', never a guess at a game.
 */
export function classifyFan(title) {
  if (/\btop\s+\d+\b/i.test(title)) return 'compilation'
  if (MATCHUP_SEP.test(title) && parseTitleDate(title)) return 'condensed'
  return 'other'
}

/**
 * Is this upload a YouTube Short?
 *
 * `classify()` above reads the title, which is all it can do and all it needs to do: the
 * league's titles announce a highlight reel. Nothing in a title says "vertical", though. Their
 * Shorts are called "FIRST WPBL WALK-OFF" and "Denae Benites GRAND SLAM", and the same `other`
 * bucket also holds three-hour full-game replays and sit-down features, so no keyword separates
 * them. The one exact signal is the URL: youtube.com/shorts/<id> answers 200 for a Short and
 * 303s to /watch for everything else.
 *
 * ONLY AN UNAMBIGUOUS ANSWER COUNTS. Returning null (rather than false) on a 404, a 429, a 5xx
 * or a network error is the whole safety design. YouTube already bot-gates this script from
 * GitHub's datacenter IPs, which is why the RSS path has a browser UA and a retry, and a probe
 * that read a gate as "not a Short" would silently and permanently exclude a clip from the
 * Discord channel. Null means "ask again next run", and the caller never overwrites a value it
 * already has with one.
 */
export async function probeIsShort(videoId, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`https://www.youtube.com/shorts/${videoId}`, {
      method: 'HEAD',
      redirect: 'manual',
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 200) return true
    // 301/302/303/307/308 to /watch is YouTube saying "this is an ordinary video".
    if (res.status >= 300 && res.status < 400) {
      return (res.headers.get('location') ?? '').includes('/watch') ? false : null
    }
    return null
  } catch {
    return null
  }
}

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
}

// "August 7, 2026" / "August 1st, 2026" / "Aug 7 2026" / "Aug. 1, 2026" / "09/22/26" →
// 'YYYY-MM-DD' (null if unreadable). The numeric form is the league's postseason reels
// ("WPBL Highlights: Championship - Game 5 | ... | 09/22/26"); without it not one of the eleven
// playoff reels matched its game, and nothing said so beyond "(no game match)" in the log.
function parseTitleDate(s) {
  const n = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/)
  if (n) {
    const [mo, day] = [Number(n[1]), Number(n[2])]
    const year = n[3].length === 2 ? 2000 + Number(n[3]) : Number(n[3])
    if (mo < 1 || mo > 12 || day < 1 || day > 31) return null
    return `${year}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  const m = s.match(/\b([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/)
  if (!m) return null
  const monthKey = Object.keys(MONTHS).find(k => k.startsWith(m[1].toLowerCase()))
  if (!monthKey) return null
  const mo = MONTHS[monthKey]
  const day = Number(m[2])
  const year = Number(m[3])
  if (day < 1 || day > 31) return null
  return `${year}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// Build a matcher from the team rows so a segment like "Los Angeles" or "Los Angeles Queens"
// or "LA" resolves to the team id. City and nickname both point at the same id.
export function buildTeamResolver(teams) {
  const byPhrase = new Map()
  for (const t of teams) {
    const add = (s) => { if (s) byPhrase.set(s.toLowerCase().trim(), t.id) }
    add(t.city)
    add(t.name)
    add(`${t.city} ${t.name}`)
    add(t.abbr)
    add(t.id)
  }
  // Longest phrases first so "Los Angeles Queens" wins over "Los Angeles" when both match.
  const phrases = [...byPhrase.keys()].sort((a, b) => b.length - a.length)
  return (segment) => {
    const seg = segment.toLowerCase().trim()
    for (const p of phrases) {
      if (seg === p || seg.startsWith(p + ' ') || seg.endsWith(' ' + p) || seg.includes(' ' + p + ' ')) {
        return byPhrase.get(p)
      }
    }
    return null
  }
}

// From a highlight title, pull away/home team ids and the game date. Returns nulls for
// anything it can't read rather than guessing.
export function parseMatchup(title, resolveTeam) {
  // Strip the leading "WPBL Highlights:" (or similar) label and the trailing "| date".
  // The matchup is whichever segment holds the separator, not always the first: the postseason
  // reels put a round in front ("WPBL Highlights: Championship - Game 5 | LA @ SF | 09/22/26").
  const afterColon = title.includes(':') ? title.slice(title.indexOf(':') + 1) : title
  const segments = afterColon.split('|')
  const matchupPart = segments.find(s => MATCHUP_SEP.test(s)) ?? segments[0]
  return splitMatchup(matchupPart, title, resolveTeam)
}

// The fan channel's version: no colon label, but a "[GAME 1]" tag in front of a postseason
// matchup and a trailing "Highlights" on a regular-season one. Both are stripped rather than
// left to the resolver's loose matching, which would otherwise be deciding on "heights
// highlights".
export function parseFanMatchup(title, resolveTeam) {
  const matchupPart = title.split('|')[0]
    .replace(/^\s*\[[^\]]*\]\s*/, '')
    .replace(/\s+(extended\s+)?(highlights?|condensed game)\s*$/i, '')
  return splitMatchup(matchupPart, title, resolveTeam)
}

function splitMatchup(matchupPart, title, resolveTeam) {
  const at = matchupPart.split(/\s+@\s+|\s+vs\.?\s+/i)
  if (at.length !== 2) return { away: null, home: null, date: parseTitleDate(title) }
  return {
    away: resolveTeam(at[0]),
    home: resolveTeam(at[1]),
    date: parseTitleDate(title),
  }
}

// Each mirrored channel: how to read its titles, and whether its Shorts are worth probing for.
// The probe exists for the Discord poster, which posts league uploads only, so a channel that
// never reaches Discord never pays for it (and never has a gated request mistaken for an answer).
export const CHANNELS = [
  { id: LEAGUE_CHANNEL_ID, label: 'league', classify, parse: parseMatchup, gameKinds: ['highlight'], probeShorts: true },
  { id: FAN_RECAPS_CHANNEL_ID, label: 'WPBL from Day 1', classify: classifyFan, parse: parseFanMatchup, gameKinds: ['condensed'], probeShorts: false },
]

// ─── Upload sources ─────────────────────────────────────────────────────────
// Both sources return the same normalised entry shape: { videoId, title, published,
// thumbnail }. The Data API is preferred when a key is present (reliable from CI); the
// RSS feed is the keyless fallback.

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// Latest uploads via the YouTube Data API (playlistItems on the channel's uploads list), or
// every upload under --all.
async function fetchViaApi(channelId) {
  // A real API key is ~39 chars and starts with "AIza". If it doesn't, the most likely
  // mistake is pasting an OAuth client ID / client secret (or a truncated value) instead
  // of an API key — flag that up front rather than letting YouTube's terse 400 mislead.
  if (!/^AIza[\w-]{35}$/.test(YT_API_KEY)) {
    console.warn(`⚠️   YOUTUBE_API_KEY doesn't look like an API key (got ${YT_API_KEY.length} chars, ` +
      `starts "${YT_API_KEY.slice(0, 4)}"). It should be ~39 chars starting "AIza". ` +
      `Create one under APIs & Services → Credentials → Create credentials → API key.`)
  }
  // Redacted fingerprint of the key the runner actually received — enough to spot a
  // truncated/padded/whitespaced secret without exposing the key (and it's the user's
  // own private log). If len != 39 or the prefix isn't "AIzaSy", the secret value is wrong.
  const k = YT_API_KEY
  console.log(`🔑  key fingerprint: len=${k.length} prefix="${k.slice(0, 6)}" suffix="${k.slice(-4)}" ` +
    `looksValid=${/^AIza[\w-]{35}$/.test(k)}`)

  // A real channel id is "UC" + 22 chars; the uploads playlist is the same with "UU".
  // Guard so a misconfigured/empty channel id fails loudly instead of sending "UU".
  const playlist = 'UU' + channelId.slice(2)
  if (!/^UC[\w-]{22}$/.test(channelId)) {
    throw new Error(`Bad channel id "${channelId}" → playlist "${playlist}". ` +
      `Unset the WPBL_YT_CHANNEL_ID repo variable (or set it to a UC… id).`)
  }
  console.log(`📼  playlistId=${playlist} (channel ${channelId})${ALL ? ', every page' : ''}`)

  const items = []
  let pageToken = ''
  do {
    const url = 'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet' +
      `&maxResults=${ALL ? 50 : 25}&playlistId=${playlist}&key=${encodeURIComponent(YT_API_KEY)}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '')
    const res = await fetch(url)
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      const err = json?.error?.errors?.[0] ?? {}
      // Full raw error so the precise reason/location is unambiguous. Common cases:
      //   400 badRequest "API key not valid" → wrong/typo'd key, or wrong GCP project
      //   403 accessNotConfigured            → enable "YouTube Data API v3" in that project
      //   403 quotaExceeded                  → daily quota used up
      console.error(`❌  Data API raw error: ${JSON.stringify(json?.error ?? { status: res.status })}`)
      throw new Error(`Data API HTTP ${res.status}: ${json?.error?.message ?? res.statusText}` +
        `${err.reason ? ` (${err.reason}${err.location ? ` @ ${err.location}` : ''})` : ''}`)
    }
    items.push(...(json?.items ?? []))
    pageToken = ALL ? json?.nextPageToken ?? '' : ''
  } while (pageToken)

  return items.map(it => {
    const s = it.snippet ?? {}
    const thumb = s.thumbnails?.maxres?.url ?? s.thumbnails?.high?.url ?? s.thumbnails?.medium?.url
    const vid = s.resourceId?.videoId
    return {
      videoId: vid,
      title: s.title ?? '',
      published: s.publishedAt ?? new Date().toISOString(),
      thumbnail: thumb ?? (vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : null),
    }
  }).filter(e => e.videoId && e.title)
}


// Latest uploads via the public RSS feed. Retried a few times because CI runners hit
// intermittent bot-gate 404/5xx responses that a moment later succeed.
async function fetchViaRss(channelId) {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
  const headers = { 'user-agent': BROWSER_UA, accept: 'application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8' }
  let last = ''
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(feedUrl, { headers, redirect: 'follow' })
    if (res.ok) return parseEntries(await res.text())
    last = `${res.status} ${res.statusText}`
    console.warn(`   RSS attempt ${attempt}/4 → ${last}${attempt < 4 ? ', retrying…' : ''}`)
    if (attempt < 4) await sleep(1500 * attempt)
  }
  throw new Error(`RSS feed failed after retries: ${last}`)
}

// Pick a source. When a key is set the Data API is authoritative: we do NOT silently fall
// back to RSS on failure, because that masks the real (fixable) API error behind RSS's own
// unreliable 404. Only when there is no key do we use RSS (YouTube's abandoned, flaky feed).
async function fetchEntries(channelId) {
  if (YT_API_KEY) {
    const e = await fetchViaApi(channelId)
    console.log(`📺  ${e.length} videos via Data API`)
    return e
  }
  console.warn('⚠️   No YOUTUBE_API_KEY set — trying the public RSS feed, which YouTube 404s ' +
    'intermittently from CI. Set YOUTUBE_API_KEY for a reliable source.')
  const e = await fetchViaRss(channelId)
  console.log(`📺  ${e.length} videos via RSS`)
  return e
}

/**
 * What one upload is and which game it belongs to, from its title alone.
 *
 * `gameByKey` is keyed `date|away|home`. When the title names the clubs the other way round
 * (the fan channel writes "LA Queens vs. NY Heights" whichever club was at home) the flip is
 * tried, and the hints are then taken from the GAME rather than the title, so the card's
 * "away @ home" badges say what happened rather than what the title's word order implied.
 */
export function resolveVideo(channel, title, resolveTeam, gameByKey) {
  const kind = channel.classify(title)
  let away = null, home = null, date = null, gameId = null
  if (channel.gameKinds.includes(kind)) {
    ({ away, home, date } = channel.parse(title, resolveTeam))
    if (away && home && date) {
      gameId = gameByKey.get(`${date}|${away}|${home}`) ?? null
      if (!gameId) {
        gameId = gameByKey.get(`${date}|${home}|${away}`) ?? null
        if (gameId) [away, home] = [home, away]
      }
    }
  }
  return { kind, away, home, date, gameId }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const { data: teams, error: teamErr } = await supabase.from('wpbl_teams').select('id, city, name, abbr')
  if (teamErr) throw new Error(`Loading teams failed: ${teamErr.message}`)
  const resolveTeam = buildTeamResolver(teams ?? [])

  // Pull the games we might match against once, then resolve in memory. The feed window is
  // small, so this is a single cheap read rather than one lookup per video.
  const { data: games, error: gameErr } = await supabase
    .from('wpbl_games')
    .select('id, game_date, home_team_id, away_team_id')
  if (gameErr) throw new Error(`Loading games failed: ${gameErr.message}`)
  // Key: `date|away|home`.
  const gameByKey = new Map()
  for (const g of games ?? []) gameByKey.set(`${g.game_date}|${g.away_team_id}|${g.home_team_id}`, g.id)

  // One channel failing does not stop the other: the RSS path 404s intermittently from CI, and
  // a bad read of the league's feed is no reason to leave the fan channel's new upload unsynced.
  // The run still exits non-zero, so the failure shows in Actions.
  const failures = []
  for (const channel of CHANNELS) {
    console.log(`\n── ${channel.label} (${channel.id})`)
    try {
      await syncChannel(channel, resolveTeam, gameByKey)
    } catch (err) {
      console.error(`❌  ${channel.label}: ${err.message}`)
      failures.push(channel.label)
    }
  }
  if (failures.length) throw new Error(`Sync failed for: ${failures.join(', ')}`)
}

async function syncChannel(channel, resolveTeam, gameByKey) {
  const entries = await fetchEntries(channel.id)
  if (entries.length === 0) { console.log('Nothing to upsert.'); return }

  // What we already know about these ids, so the probe below runs on new uploads only. Two
  // reasons this matters. The sync runs 20 times a day over the same ~15 videos, so probing
  // blind would be 300 requests a day to a host that already bot-gates us. And the upsert
  // rewrites every column it names: re-probing and getting null from a gated request would
  // ERASE a Short we had correctly identified, which is worse than never having identified it.
  const { data: knownRows, error: knownErr } = await supabase
    .from('wpbl_videos').select('video_id, is_short').in('video_id', entries.map(e => e.videoId))
  if (knownErr) throw new Error(`Loading known videos failed: ${knownErr.message}`)
  const knownShort = new Map((knownRows ?? []).map(r => [r.video_id, r.is_short]))

  const rows = []
  for (const e of entries) {
    const { kind, away, home, date, gameId } = resolveVideo(channel, e.title, resolveTeam, gameByKey)
    // A highlight reel and a podcast are never Shorts, so their answer is free. Everything else
    // is asked once, ever, and the answer is remembered. A channel that does not probe leaves
    // the column at whatever it holds, which for a new row is null: undetermined.
    const isShort = kind === 'highlight' || kind === 'podcast'
      ? false
      : knownShort.get(e.videoId) ?? (channel.probeShorts && !DRY_RUN ? await probeIsShort(e.videoId) : null)
    rows.push({
      video_id: e.videoId,
      channel_id: channel.id,
      title: e.title,
      published_at: e.published,
      thumbnail_url: e.thumbnail,
      kind,
      game_id: gameId,
      away_hint: away,
      home_hint: home,
      game_date_hint: date,
      is_short: isShort,
      updated_at: new Date().toISOString(),
    })
    const tag = channel.gameKinds.includes(kind)
      ? `[${kind}] ${gameId ? `→ game ${gameId.slice(0, 8)}` : '→ (no game match)'}`
      : `[${kind}${isShort === true ? ', short' : isShort == null ? ', short?' : ''}]`
    console.log(`  • ${e.title}  ${tag}`)
  }

  const matched = rows.filter(r => r.game_id).length
  if (DRY_RUN) {
    console.log(`🧪  Dry run: would upsert ${rows.length} videos (${matched} matched to a game)`)
    return
  }
  const { error: upErr } = await supabase.from('wpbl_videos').upsert(rows, { onConflict: 'video_id' })
  if (upErr) throw new Error(`Upsert failed: ${upErr.message}`)
  console.log(`✅  Upserted ${rows.length} videos (${matched} matched to a game)`)
}

if (IS_ENTRYPOINT) {
  main().catch(err => { console.error('❌ ', err.message); process.exit(1) })
}

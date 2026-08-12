#!/usr/bin/env node
/**
 * sync-wpbl-youtube.mjs — mirror the WPBL official YouTube uploads into Supabase.
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
 *
 * Required env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY.
 * Optional env: WPBL_YT_CHANNEL_ID (defaults to the official channel).
 */

import { createClient } from '@supabase/supabase-js'

// ─── Config ─────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
// Official WPBL channel (youtube.com/@wpbl_official). Overridable for testing.
const CHANNEL_ID = process.env.WPBL_YT_CHANNEL_ID ?? 'UCtd3k09dk2H6UjU7skfmemQ'
const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌  Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY before running')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

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

function classify(title) {
  const t = title.toLowerCase()
  if (/\bhighlights?\b/.test(t) && t.includes('@')) return 'highlight'
  if (/\bpodcast\b|\bepisode\b|\bep\.?\s*\d|dialogues?\b/.test(t)) return 'podcast'
  return 'other'
}

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
}

// "August 7, 2026" / "August 1st, 2026" / "Aug 7 2026" → 'YYYY-MM-DD' (null if unreadable).
function parseTitleDate(s) {
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
function buildTeamResolver(teams) {
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
function parseMatchup(title, resolveTeam) {
  // Strip the leading "WPBL Highlights:" (or similar) label and the trailing "| date".
  const afterColon = title.includes(':') ? title.slice(title.indexOf(':') + 1) : title
  const matchupPart = afterColon.split('|')[0]
  const at = matchupPart.split(/\s+@\s+|\s+vs\.?\s+/i)
  if (at.length !== 2) return { away: null, home: null, date: parseTitleDate(title) }
  return {
    away: resolveTeam(at[0]),
    home: resolveTeam(at[1]),
    date: parseTitleDate(title),
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const res = await fetch(FEED_URL, { headers: { 'user-agent': 'wpbl-youtube-sync/1.0' } })
  if (!res.ok) {
    console.error(`❌  Feed fetch failed: ${res.status} ${res.statusText}`)
    process.exit(1)
  }
  const xml = await res.text()
  const entries = parseEntries(xml)
  console.log(`📺  ${entries.length} videos in feed`)
  if (entries.length === 0) return

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

  const rows = []
  for (const e of entries) {
    const kind = classify(e.title)
    let away = null, home = null, date = null, gameId = null
    if (kind === 'highlight') {
      ({ away, home, date } = parseMatchup(e.title, resolveTeam))
      if (away && home && date) {
        gameId = gameByKey.get(`${date}|${away}|${home}`)
          // Feeds occasionally list the matchup home-first; try the flip before giving up.
          ?? gameByKey.get(`${date}|${home}|${away}`)
          ?? null
      }
    }
    rows.push({
      video_id: e.videoId,
      title: e.title,
      published_at: e.published,
      thumbnail_url: e.thumbnail,
      kind,
      game_id: gameId,
      away_hint: away,
      home_hint: home,
      game_date_hint: date,
      updated_at: new Date().toISOString(),
    })
    const tag = kind === 'highlight' ? (gameId ? `→ game ${gameId.slice(0, 8)}` : '→ (no game match)') : `[${kind}]`
    console.log(`  • ${e.title}  ${tag}`)
  }

  const { error: upErr } = await supabase.from('wpbl_videos').upsert(rows, { onConflict: 'video_id' })
  if (upErr) throw new Error(`Upsert failed: ${upErr.message}`)
  const matched = rows.filter(r => r.game_id).length
  console.log(`✅  Upserted ${rows.length} videos (${matched} matched to a game)`)
}

main().catch(err => { console.error('❌ ', err.message); process.exit(1) })

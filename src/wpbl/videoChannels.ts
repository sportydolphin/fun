import type { WpblVideo } from './types'

// The YouTube channels mirrored into wpbl_videos (scripts/sync-wpbl-youtube.mjs, CHANNELS).
// The ids are duplicated there rather than imported, because that script is plain Node and this
// file is bundled by Vite; `videoChannels.test.ts` pins the two lists together.

export const LEAGUE_CHANNEL_ID = 'UCtd3k09dk2H6UjU7skfmemQ'
export const FAN_RECAPS_CHANNEL_ID = 'UC9oWksw_L8tfpxdF6uUiTXw'

export interface VideoCredit { name: string; url: string }

// Every channel that is not the league's is credited on every card that shows one of its
// videos, not behind a click: the same rule as the fan photographs. Embedding their work was
// a permission they gave us (Sep 28, 2026), and a card that looks like the league's own reel
// would be taking credit for it.
const CREDITS: Record<string, VideoCredit> = {
  [FAN_RECAPS_CHANNEL_ID]: { name: 'WPBL from Day 1', url: 'https://www.youtube.com/@wpblfanrecaps' },
}

export function isLeagueVideo(v: WpblVideo): boolean {
  return v.channel_id === LEAGUE_CHANNEL_ID
}

/** Who to credit on a card, or null for the league's own uploads. */
export function videoCredit(v: WpblVideo): VideoCredit | null {
  return isLeagueVideo(v) ? null : CREDITS[v.channel_id] ?? null
}

/**
 * The country a reader is assumed to be in when /api/geo cannot say (the dev server, a failed
 * request). The league is American and so is most of its audience, and the two ways of being wrong
 * are not equal: hiding a broadcast from a reader abroad costs them a video they can still find on
 * YouTube, while showing it to a reader in the US hands them a player that says "Video unavailable".
 */
export const ASSUMED_COUNTRY = 'US'

/**
 * Can a reader in `country` play this video? From the restriction the sync stores
 * (refreshVideoDetails in scripts/sync-wpbl-youtube.mjs). A video never checked has neither list and
 * plays everywhere, so a missing API key shows the catalog rather than hiding it.
 */
export function playableIn(v: Pick<WpblVideo, 'region_allowed' | 'region_blocked'>, country: string | null): boolean {
  const c = country ?? ASSUMED_COUNTRY
  if (v.region_allowed?.length && !v.region_allowed.includes(c)) return false
  if (v.region_blocked?.includes(c)) return false
  return true
}

/** The card's kicker. */
export function videoLabel(v: WpblVideo): string {
  return v.kind === 'condensed' ? 'Condensed game' : v.kind === 'full_game' ? 'Full game' : 'Watch Highlights'
}

/** The lightbox's eyebrow and a button's name: what the video IS, in a word or two. */
export function videoKindName(v: WpblVideo): string {
  if (v.is_short === true) return 'Clip'
  switch (v.kind) {
    case 'highlight': return 'Highlights'
    case 'condensed': return 'Condensed game'
    case 'full_game': return 'Full game'
    case 'compilation': return 'Compilation'
    case 'press': return 'Press conference'
    case 'podcast': return 'Podcast'
    default: return 'Video'
  }
}

/** "8:42" or "2:10:05", or null for a length not read yet. */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || seconds <= 0) return null
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = String(Math.floor(seconds % 60)).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** "12.3K views", or null for a count not read yet. */
export function formatViews(views: number | null | undefined): string | null {
  if (views == null) return null
  if (views < 1000) return `${views} ${views === 1 ? 'view' : 'views'}`
  const short = views < 1_000_000 ? `${(views / 1000).toFixed(views < 10_000 ? 1 : 0)}K` : `${(views / 1_000_000).toFixed(1)}M`
  return `${short.replace('.0', '')} views`
}

// Shortest watch first: the reel is a few minutes, the condensed game a quarter of an hour, the
// broadcast the whole game. A reader who opened a game's videos wants the quick one on top.
const GAME_KIND_RANK: Record<string, number> = { highlight: 0, condensed: 1, full_game: 2 }

/**
 * Every video of one game, shortest watch first.
 *
 * A game can have three: the league's reel, a fan's condensed game and the league's full
 * broadcast. This replaced a `find`, which kept whichever row the table happened to return first
 * and dropped the rest without a trace.
 */
export function gameVideos(videos: readonly WpblVideo[], gameId: string): WpblVideo[] {
  const rank = (v: WpblVideo) => GAME_KIND_RANK[v.kind] ?? 3
  return videos
    .filter(v => v.game_id === gameId)
    .sort((a, b) => rank(a) - rank(b) || a.published_at.localeCompare(b.published_at))
}

/**
 * The Watch page's three shelves, from one list.
 *
 * `is_short` decides first and a game second, and the order matters: a Short never carries a
 * `game_id` today, but when clip tagging lands one will, and it is still a clip, not a fourth
 * button on the game card. An undetermined `is_short` (null) reads as landscape and goes to More,
 * for the reason on the type. Every video lands on exactly one shelf.
 */
export function watchShelves(videos: readonly WpblVideo[]): {
  gameIds: string[]; clips: WpblVideo[]; more: WpblVideo[]
} {
  const gameIds: string[] = []
  const seen = new Set<string>()
  const clips: WpblVideo[] = []
  const more: WpblVideo[] = []
  for (const v of videos) {
    if (v.is_short === true) clips.push(v)
    else if (v.game_id) { if (!seen.has(v.game_id)) { seen.add(v.game_id); gameIds.push(v.game_id) } }
    else more.push(v)
  }
  return { gameIds, clips, more }
}

// More's groups, in page order. The compilations lead: they are the best single watches on the shelf
// and the only things on it about the season as a whole. The podcast follows, because it is most of
// the shelf (a weekly episode since March, each a player's own hour).
//
// FEATURES IS EVERYTHING ELSE, not `kind === 'other'`. A list of kinds left a game reel with no game
// on no group at all, so the chip counted it and the shelf never drew it.
export const MORE_GROUPS: { key: string; label: string; test: (v: WpblVideo) => boolean }[] = [
  { key: 'compilation', label: 'Season compilations', test: v => v.kind === 'compilation' },
  { key: 'podcast', label: 'Podcast', test: v => v.kind === 'podcast' },
  { key: 'press', label: 'Press conferences', test: v => v.kind === 'press' },
  { key: 'features', label: 'Features', test: v => !['compilation', 'podcast', 'press'].includes(v.kind) },
]

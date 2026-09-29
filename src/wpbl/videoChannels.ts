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

/** The card's kicker. */
export function videoLabel(v: WpblVideo): string {
  return v.kind === 'condensed' ? 'Condensed game' : 'Watch Highlights'
}

/**
 * Every video of one game, the league's first.
 *
 * A game can now have two: the league's reel and a fan's condensed game. This replaced a
 * `find`, which kept whichever row the table happened to return first and dropped the other
 * without a trace. League first because it is the official record and the shorter watch; the
 * condensed game is the longer one for a reader who wants more.
 */
export function gameVideos(videos: readonly WpblVideo[], gameId: string): WpblVideo[] {
  const rank = (v: WpblVideo) => (isLeagueVideo(v) ? 0 : 1)
  return videos
    .filter(v => v.game_id === gameId)
    .sort((a, b) => rank(a) - rank(b) || a.published_at.localeCompare(b.published_at))
}

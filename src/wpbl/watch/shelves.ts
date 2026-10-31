import type { WpblVideo, WpblVideoTag } from '../types'

// Which videos go where on the Watch page, with nothing that touches the page so it can be tested.

/** "The Entire WPBL Season in 19 Minutes": the one video that answers "what is this league?". */
export const FEATURED_VIDEO_ID = 'gI6r3cjpjik'
/** How long the newest game's reel holds the top of the page before the season reel takes it back. */
const FRESH_REEL_MS = 3 * 86_400_000

/**
 * The video at the top of the page: last night's reel while there is one, otherwise the pinned reel,
 * then the newest compilation, then the newest landscape video. A chain rather than a constant,
 * because the list is only what this reader's country can play, and the league can pull any upload.
 */
export function featuredVideo(videos: readonly WpblVideo[], now: number): WpblVideo | null {
  const landscape = videos.filter(v => v.is_short !== true)
  const newestReel = landscape.find(v => v.kind === 'highlight' && !!v.game_id)
  if (newestReel && now - Date.parse(newestReel.published_at) < FRESH_REEL_MS) return newestReel
  return landscape.find(v => v.video_id === FEATURED_VIDEO_ID)
    ?? landscape.find(v => v.kind === 'compilation')
    ?? landscape[0]
    ?? null
}

/**
 * The Shorts split in two: those from a game, and the rest (the draft, features, the offseason's
 * social posts). Every Short lands on exactly one side. By the tag's game rather than its pinned play,
 * because "Mackay's big night" is from a game even when no title can name the at-bat.
 */
export function splitClips(clips: readonly WpblVideo[], tags: ReadonlyMap<string, WpblVideoTag>): { plays: WpblVideo[]; rest: WpblVideo[] } {
  const plays: WpblVideo[] = []
  const rest: WpblVideo[] = []
  for (const v of clips) (tags.get(v.video_id)?.game_id ? plays : rest).push(v)
  return { plays, rest }
}

/** The videos to pick up again, in the order the reader last watched them. */
export function continueWatching(videos: readonly WpblVideo[], ids: readonly string[]): WpblVideo[] {
  const byId = new Map(videos.map(v => [v.video_id, v]))
  return ids.map(id => byId.get(id)).filter((v): v is WpblVideo => !!v && v.is_short !== true)
}

import { gameVideos, MORE_GROUPS, watchShelves } from '../videoChannels'
import type { WpblVideo } from '../types'

// What plays after this video, with no imports that touch the page so it can be tested alone.

/**
 * The list a video belongs to when nothing chose one, which is any link from outside the Watch page:
 * a share, a search result, a video opened in a new tab. It always holds the video itself, because
 * the caller reads next and previous from its position.
 *
 *   A Short          every Short, newest first.
 *   A game's video   the same kind of video from every game, newest first, with this game's other
 *                    videos right behind this one, so the condensed game follows its reel.
 *   Anything else    its own group on the shelf (the podcast, the compilations).
 */
export function defaultQueue(video: WpblVideo, videos: readonly WpblVideo[]): string[] {
  const { clips, more } = watchShelves(videos)
  if (video.is_short === true) return clips.map(v => v.video_id)
  if (video.game_id) {
    const siblings = gameVideos(videos, video.game_id)
      .filter(v => v.is_short !== true && v.video_id !== video.video_id)
      .map(v => v.video_id)
    const kin = videos
      .filter(v => v.is_short !== true && !!v.game_id && v.kind === video.kind && !siblings.includes(v.video_id))
      .map(v => v.video_id)
    const at = kin.indexOf(video.video_id)
    return [...kin.slice(0, at + 1), ...siblings, ...kin.slice(at + 1)]
  }
  const group = MORE_GROUPS.find(g => g.test(video))
  return group ? more.filter(group.test).map(v => v.video_id) : [video.video_id]
}

/**
 * The queue to play, as videos: the shelf's own list when the reader came from one, so a filtered
 * shelf plays what it shows, otherwise the default. A stored list that no longer holds this video is
 * stale, from an old history entry, and is ignored rather than leaving next and previous dead.
 */
export function resolveQueue(video: WpblVideo, videos: readonly WpblVideo[], stored: unknown): WpblVideo[] {
  const byId = new Map(videos.map(v => [v.video_id, v]))
  const ids = Array.isArray(stored) && stored.includes(video.video_id) ? stored as string[] : defaultQueue(video, videos)
  return ids.map(id => byId.get(id)).filter((v): v is WpblVideo => !!v)
}

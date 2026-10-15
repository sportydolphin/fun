import { supabase } from '../../lib/supabase'
import { viewerCountry } from '../../lib/geo'
import { playableIn } from '../videoChannels'
import type { WpblGameRecap, WpblVideo, WpblVideoTag, WpblArticle } from '../types'
import { safe, once, isFresh, isFreshSlow, fetchAllPaged, ownerWrite } from './core'

// What is written and filmed about the league: recaps, videos and their tags, and the reading feed.

let allVideosCache:   { data: WpblVideo[]; at: number } | null = null
let videoTagsCache:   { data: Map<string, WpblVideoTag>; at: number } | null = null
let allRecapsCache:   { data: WpblGameRecap[]; at: number } | null = null
let allArticlesCache: { data: WpblArticle[]; at: number } | null = null

export function getCachedWpblVideos(): WpblVideo[] | null { return allVideosCache?.data ?? null }
export function getCachedWpblVideoTags(): Map<string, WpblVideoTag> | null { return videoTagsCache?.data ?? null }
export function getCachedWpblRecaps(): WpblGameRecap[] | null { return allRecapsCache?.data ?? null }
export function getCachedWpblArticles(): WpblArticle[] | null { return allArticlesCache?.data ?? null }

/**
 * This is Women's Baseball's game recaps, as links.
 *
 * ONE READ FOR THE WHOLE TABLE, cached app-wide, exactly like the videos below it and for the
 * same reason: it is one row per game, so the season is under forty of them, and a per-game
 * request would be a round trip to learn that a card should say nothing. A game opened from the
 * schedule reads this out of the cache.
 *
 * Empty pre-migration, and empty is the ordinary state for a game nobody has written up yet:
 * the card renders nothing rather than an empty shell. See docs/RECAPS.md.
 */
export function fetchWpblRecaps(): Promise<WpblGameRecap[]> {
  if (isFresh(allRecapsCache)) return Promise.resolve(allRecapsCache!.data)
  return once('allRecaps', async () => {
    const data = await safe<WpblGameRecap[]>('fetchWpblRecaps', () =>
      supabase.from('wpbl_recaps')
        .select('game_id,url,title,cover_url,published_at,matched_by')
        .order('published_at', { ascending: false }) as unknown as
        PromiseLike<{ data: WpblGameRecap[] | null; error: unknown }>,
      [])
    if (data.length > 0 || allRecapsCache == null) allRecapsCache = { data, at: Date.now() }
    return data
  })
}

// The mirrored YouTube uploads (league and WPBL from Day 1), newest first, for the Watch page, the
// Home card and the per-game recap card. Cached last-good: the Watch page and GameDetail read the
// same cache instead of each making their own request. `channel_id` needs migration
// 20260929002026: without it this read errors and every video on the site disappears, quietly, as
// an empty list.
//
// PAGED, although it fits one page today (451 rows on Sep 29, 2026). The league posts several
// Shorts a game in season, so the table passes PostgREST's silent 1000-row cap next summer, and
// from that day a bare select would drop the OLDEST uploads without an error. `video_id` breaks
// the tie between two uploads stamped the same second, which is what keeps the pages disjoint.
export function fetchWpblVideos(): Promise<WpblVideo[]> {
  if (isFreshSlow(allVideosCache)) return Promise.resolve(allVideosCache!.data)
  return once('allVideos', async () => {
    const countryLookup = viewerCountry()
    const data = await fetchAllPaged<WpblVideo>('fetchWpblVideos', (from, to) =>
      supabase.from('wpbl_videos')
        .select('video_id,channel_id,title,published_at,thumbnail_url,kind,game_id,away_hint,home_hint,game_date_hint,is_short,region_allowed,region_blocked')
        .order('published_at', { ascending: false })
        .order('video_id', { ascending: true })
        .range(from, to) as unknown as
        PromiseLike<{ data: WpblVideo[] | null; error: unknown }>)
    // FILTERED HERE, ONCE, so every surface (the Watch page, its card, Game Center, the recap
    // card) shows only what this reader's country can play without each having to remember to
    // ask. The country is fetched alongside the rows, never after them. See playableIn.
    const country = await countryLookup
    const playable = data.filter(v => playableIn(v, country))
    if (playable.length > 0 || allVideosCache == null) allVideosCache = { data: playable, at: Date.now() }
    return playable
  })
}

/**
 * What each Short shows (wpbl_video_tags), keyed by video id: the game, the at-bat, the players
 * and the club. A few hundred rows at most, read once and shared by the Watch page, Game Center's
 * clip row and the player page. A clip with no row has no tag, which is most of the pre-season.
 */
export function fetchWpblVideoTags(fresh = false): Promise<Map<string, WpblVideoTag>> {
  // `fresh` for /admin's tag editor, which must not edit over another tab's older copy.
  if (!fresh && isFreshSlow(videoTagsCache)) return Promise.resolve(videoTagsCache!.data)
  return once(fresh ? 'videoTagsFresh' : 'videoTags', async () => {
    const rows = await fetchAllPaged<WpblVideoTag>('fetchWpblVideoTags', (from, to) =>
      supabase.from('wpbl_video_tags')
        .select('video_id,game_id,play_sequence,inning,half,team_id,player_ids,method')
        .order('video_id', { ascending: true })
        .range(from, to) as unknown as
        PromiseLike<{ data: WpblVideoTag[] | null; error: unknown }>)
    const data = new Map(rows.map(t => [t.video_id, t]))
    if (data.size > 0 || videoTagsCache == null) videoTagsCache = { data, at: Date.now() }
    return data
  })
}

// The reading feed (wpbl_articles): a mirror of two independent writers' WPBL coverage.
// Tiny table, read once app-wide and shared by the Home rail, the game card, and the player
// and team pages, exactly like the videos read above it.
export function fetchWpblArticles(): Promise<WpblArticle[]> {
  if (isFreshSlow(allArticlesCache)) return Promise.resolve(allArticlesCache!.data)
  return once('allArticles', async () => {
    const data = await safe<WpblArticle[]>('fetchWpblArticles', () =>
      supabase.from('wpbl_articles')
        // No `tags`: the sync reads them to decide which posts count, and nothing in the browser
        // does. They are Substack's reach tags, often a dozen per post, and were the bulk of the
        // payload after the headlines.
        .select('post_id,source,slug,url,title,subtitle,cover_url,published_at,word_count,video_count,game_id,team_ids,player_ids')
        .order('published_at', { ascending: false })
        // Two posts can share a publish minute, and without a tiebreak Postgres may return them in
        // either order, so the Reading page's lead story could swap between visits.
        .order('post_id', { ascending: false }) as unknown as
        PromiseLike<{ data: WpblArticle[] | null; error: unknown }>,
      [])
    if (data.length > 0 || allArticlesCache == null) allArticlesCache = { data, at: Date.now() }
    return data
  })
}

/**
 * Set a clip's tag by hand (/admin → Clips). Always saved as method 'manual', which the sync's
 * matcher never overwrites or deletes, so a correction outlives every later --relink. A manual row
 * with no game, no players and no club is the way to say "this clip is from nothing": without it
 * the matcher would put a wrong tag back on the next pass. Patches the shared cache on success, so
 * the Watch page and Game Center show the fix without a reload.
 */
export async function saveWpblVideoTag(tag: Omit<WpblVideoTag, 'method'>): Promise<boolean> {
  const row = { ...tag, method: 'manual' as const, matched_at: new Date().toISOString() }
  const ok = await ownerWrite('saveWpblVideoTag', () =>
    supabase.from('wpbl_video_tags').upsert(row, { onConflict: 'video_id' }))
  if (ok && videoTagsCache) videoTagsCache.data.set(tag.video_id, { ...tag, method: 'manual' })
  return ok
}

/**
 * Drop a clip's tag, hand-set or not. The matcher tags it again on its next pass over that clip,
 * which for anything older than the sync's 72-hour window means the next --relink.
 */
export async function deleteWpblVideoTag(videoId: string): Promise<boolean> {
  const ok = await ownerWrite('deleteWpblVideoTag', () =>
    supabase.from('wpbl_video_tags').delete().eq('video_id', videoId))
  if (ok && videoTagsCache) videoTagsCache.data.delete(videoId)
  return ok
}

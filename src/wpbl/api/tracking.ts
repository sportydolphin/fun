import { supabase } from '../../lib/supabase'
import { writeSeed } from '../seed'
import type { WpblPitchTracking, WpblTrackRow } from '../types'
import {
  safe, once, overlayKeyed, isList, seeded, isFreshSlow, keyedCache, emptyList, fetchAllPaged,
  numOrNull,
} from './core'

// TrackMan: the league's tracked pitches, which games carry them, one game's and one pitcher's.

export let allTrackingCache: { data: WpblTrackRow[]; at: number } | null = null
// Just the distinct game ids that carry tracking, for Home's "new tracking batch" banner. See
// fetchWpblTrackedGameIds for why this exists separately from the full table above.
export let trackedGameIdsCache: { data: string[]; at: number } | null = null

export const seedTrackedIds = () => seeded<string[]>('trackedGameIds', trackedGameIdsCache, isList, data => { trackedGameIdsCache = { data, at: 0 } })

export function getCachedWpblAllTracking(): WpblTrackRow[] | null { return allTrackingCache?.data ?? null }
export function getCachedWpblTrackedGameIds(): string[] | null { seedTrackedIds(); return trackedGameIdsCache?.data ?? null }

const pitchLocsCache = keyedCache('pitchLocs', readWpblPitcherLocations, emptyList)

/** Every tracked pitch by one pitcher. Takes the feed ids as ONE comma-joined string rather
 *  than an array, because that string is the cache key and an array would be a new object on
 *  every render. PlayerDetail already holds exactly this string for the same reason. */
export const fetchWpblPitcherLocations = pitchLocsCache.fetch

export const getCachedWpblPitcherLocations = pitchLocsCache.get

// How many games carry TrackMan data, from the watcher's one-row snapshot
// (`wpbl_tracking_watch`, refreshed daily by scripts/watch-wpbl-tracking.mjs). One row and one
// integer, so the Stats tab can decide whether to offer the Tracked board BEFORE paying for
// the paginated tracking scan that would answer the same question. Null when the row has never
// been written, which callers should read as "unknown", not "none".
let trackedGamesCache: { data: number | null; at: number } | null = null

export function fetchWpblTrackedGameCount(): Promise<number | null> {
  if (isFreshSlow(trackedGamesCache)) return Promise.resolve(trackedGamesCache!.data)
  return once('trackedGameCount', async () => {
    const rows = await safe<{ tracked_game_count: number | null }[]>('fetchWpblTrackedGameCount', () =>
      supabase.from('wpbl_tracking_watch').select('tracked_game_count').limit(1), [])
    const data = rows.length > 0 ? rows[0].tracked_game_count ?? 0 : null
    trackedGamesCache = { data, at: Date.now() }
    return data
  })
}

// Every TrackMan tracking row in the league, slimmed to the fields the velocity board
// needs (see WpblTrackRow): the raw-payload sub-fields are projected server-side so we
// never transfer the whole `raw` blob. Paginated past PostgREST's 1000-row default so it
// keeps working as the season fills in. Empty pre-migration / on error.
const TRACK_SELECT =
  'game_id,kind,release_speed,spin_rate_rpm,' +
  'pitch_type:raw->>pitch_type,pitcher_id:raw->>pitcher_id,pitcher_name:raw->>pitcher_name,' +
  'batter_id:raw->>batter_id,batter_name:raw->>batter_name,' +
  'exit_speed:raw->>exit_speed,launch_angle:raw->>launch_angle_deg,distance:raw->>distance,hit_type:raw->>hit_type'


export function fetchWpblAllTracking(): Promise<WpblTrackRow[]> {
  if (isFreshSlow(allTrackingCache)) return Promise.resolve(allTrackingCache!.data)
  return once('allTracking', async () => {
  const PAGE = 1000
  const out: WpblTrackRow[] = []
  for (let from = 0; ; from += PAGE) {
    // supabase-js mis-types projected jsonb (`raw->>key`) selects, so cast the result.
    const page = await safe<Record<string, unknown>[]>('fetchWpblAllTracking', () =>
      // `.order()` is not decoration: paging with `.range()` alone lets Postgres hand the same
      // row to two pages and skip another, which here would double-count a pitch in a velocity
      // average and silently drop another. Invisible while tracking fits in one page, wrong the
      // moment it does not. `activity_id` is the table's natural key; readWpblPitcherLocations
      // pages the same way.
      supabase.from('wpbl_pitch_tracking').select(TRACK_SELECT)
        .order('activity_id', { ascending: true })
        .range(from, from + PAGE - 1) as unknown as
        PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>,
      [])
    for (const d of page) out.push({
      game_id: String(d.game_id),
      kind: (d.kind as string) ?? null,
      release_speed: numOrNull(d.release_speed),
      spin_rate_rpm: numOrNull(d.spin_rate_rpm),
      pitch_type: (d.pitch_type as string) ?? null,
      pitcher_id: (d.pitcher_id as string) ?? null,
      pitcher_name: (d.pitcher_name as string) ?? null,
      batter_id: (d.batter_id as string) ?? null,
      batter_name: (d.batter_name as string) ?? null,
      exit_speed: numOrNull(d.exit_speed),
      launch_angle: numOrNull(d.launch_angle),
      distance: numOrNull(d.distance),
      hit_type: (d.hit_type as string) ?? null,
    })
    if (page.length < PAGE) break
  }
  // Cache last-good so the Tracking tab can repaint from it on a swipe-back without
  // re-running this paginated scan (see the cache block above). A transient empty
  // doesn't clobber a previously good result.
  const rows = overlayKeyed(out)
  if (rows.length > 0 || allTrackingCache == null) allTrackingCache = { data: rows, at: Date.now() }
  return rows
  })
}

/**
 * Just the distinct game ids that carry tracking, for Home's "new tracking batch" banner.
 *
 * The banner reduces the whole tracking table to `new Set(game_id)` (see `useNewTrackingBatch` in
 * home/TrackingBanner.tsx), so calling `fetchWpblAllTracking` for it moved the entire table across the wire to
 * count a handful of games: 766 rows for a set of 2 today, and it grows with every tracked game
 * while the answer stays tiny. This reads the ONE column instead, and the full table stays behind
 * `fetchWpblAllTracking` for the Tracking tab, which actually plots the pitches.
 *
 * PAGED with a deterministic order, the section's "read every row" rule. A skipped row cannot
 * drop a game id here, since a tracked game brings hundreds of rows and its id survives a lost
 * one, but the read still has to reach every page or a whole game could vanish once tracking
 * outgrows one page.
 */
export function fetchWpblTrackedGameIds(): Promise<string[]> {
  if (isFreshSlow(trackedGameIdsCache)) return Promise.resolve(trackedGameIdsCache!.data)
  return once('trackedGameIds', async () => {
    const rows = await fetchAllPaged<{ game_id: string }>('fetchWpblTrackedGameIds', (from, to) =>
      supabase.from('wpbl_pitch_tracking').select('game_id')
        .order('activity_id', { ascending: true })
        .range(from, to) as unknown as
        PromiseLike<{ data: { game_id: string }[] | null; error: unknown }>)
    const ids = [...new Set(rows.map(r => String(r.game_id)))]
    // Last-good, like the table read above: a transient empty must not clobber a good set.
    if (ids.length > 0) writeSeed('trackedGameIds', ids)
    if (ids.length > 0 || trackedGameIdsCache == null) trackedGameIdsCache = { data: ids, at: Date.now() }
    return ids
  })
}

// TrackMan pitch/hit tracking for one game (chronological).
export function fetchWpblGameTracking(gameId: string): Promise<WpblPitchTracking[]> {
  return safe('fetchWpblGameTracking', () =>
    supabase.from('wpbl_pitch_tracking').select('*').eq('game_id', gameId).order('occurred_at', { ascending: true }),
    [] as WpblPitchTracking[])
}

// One tracked pitch's plate location + label, for a pitcher's location map. Coordinates
// are in feet from the plate: `side` 0 = center (catcher's view, + toward the plot's
// right), `height` 0 = ground. Both are present for 100% of tracked pitches.
export interface WpblPitchLoc {
  game_id: string
  pitch_type: string | null
  release_speed: number | null
  side: number | null
  height: number | null
}

// Every tracked pitch thrown by one pitcher, projected out of the raw payload. Empty for
// non-pitchers and for players the feed has no id for.
//
// Takes EVERY feed id the player has held, not just the current one. The tracking rows are
// keyed on the feed's player id, and the feed mints a new id per club, so reading only
// `api_id` would show a traded pitcher's work for their new team and silently nothing before
// it, which looks exactly like a pitcher who has not thrown much rather than like a bug.
// Paginated past PostgREST's 1000-row default so it holds up as the season fills in.
async function readWpblPitcherLocations(idsKey: string): Promise<WpblPitchLoc[]> {
  const ids = idsKey ? idsKey.split(',') : []
  if (ids.length === 0) return []
  const SELECT = 'game_id,release_speed,pitch_type:raw->>pitch_type,' +
    'side:raw->>plate_location_side,height:raw->>plate_location_height'
  const PAGE = 1000
  const out: WpblPitchLoc[] = []
  for (let from = 0; ; from += PAGE) {
    const page = await safe<Record<string, unknown>[]>('fetchWpblPitcherLocations', () =>
      supabase.from('wpbl_pitch_tracking').select(SELECT)
        .eq('kind', 'pitch').in('raw->>pitcher_id', ids)
        // Deterministic order, or Postgres is free to hand the same row to two pages and skip
        // another (see the paging note in CLAUDE.md). activity_id is the table's natural key.
        .order('activity_id', { ascending: true })
        .range(from, from + PAGE - 1) as unknown as
        PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>,
      [])
    for (const d of page) out.push({
      game_id: String(d.game_id),
      pitch_type: (d.pitch_type as string) ?? null,
      release_speed: numOrNull(d.release_speed),
      side: numOrNull(d.side),
      height: numOrNull(d.height),
    })
    if (page.length < PAGE) break
  }
  return out
}

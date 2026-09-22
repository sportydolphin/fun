import { supabase } from '../lib/supabase'
import { FIRSTS_EVENT_TYPES } from './firsts'
import { countsInStandings, standingsFinals } from './season'
import { settleGames } from './gameOver'
import { buildFanPhotoIndex, type FanPhotoIndex } from './fanPhotos'
import type {
  WpblTeam, WpblPlayer, WpblGame, WpblStandingRow,
  WpblBattingLine, WpblPitchingLine,
  WpblFieldingLine, WpblGamePlay, WpblFirstsPlay, WpblRecapPlay, WpblPitchPlay, WpblRunValuePlay,
  WpblGameRecap, WpblSprayPlay,
  WpblCorrectionSource,
  WpblPitchTracking, WpblTrackRow,
  WpblVideo, WpblArticle, WpblPhoto, WpblSiteGame, WpblLineupHistoryRow, WpblPitchingUsageRow,
  WpblGameDetails, WpblGameRevision,
  WpblFanPhoto, WpblPhotoFigure, WpblPhotoSubject, WpblPhotoContributor,
} from './types'

// Reads for the WPBL section. Everything degrades gracefully: if the tables don't
// exist yet (pre-migration) or a request fails, we log and return an empty result so
// the section renders an empty shell instead of throwing. Same tolerance the rest of
// the app uses for not-yet-migrated features.

// Upper bound on any single read. If the database stalls, the read resolves to its fallback
// instead of hanging forever (an infinite spinner); the section then shows its empty state and
// the next poll refills it once the DB recovers. Generous enough that a healthy request never
// trips it.
const READ_TIMEOUT_MS = 8000

async function safe<T>(label: string, run: () => PromiseLike<{ data: T | null; error: unknown }>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), READ_TIMEOUT_MS) })
    const result = await Promise.race([run(), timeout])
    if (result === 'timeout') {
      console.warn(`[wpbl] ${label} timed out after ${READ_TIMEOUT_MS}ms`)
      return fallback
    }
    const { data, error } = result
    if (error) {
      console.warn(`[wpbl] ${label} failed:`, error)
      return fallback
    }
    return data ?? fallback
  } catch (e) {
    console.warn(`[wpbl] ${label} threw:`, e)
    return fallback
  } finally {
    clearTimeout(timer)
  }
}

// Collapse concurrent duplicate reads. On a cold load several views mount at once and ask
// for the same bulk dataset (WpblApp's search pool and Home both pull the full roster; the
// schedule poll can overlap a focus-refresh), and without this each fires its own DB query.
// Keyed by dataset, the in-flight promise is shared until it settles, then cleared: this
// only dedupes genuine overlap. Reads that land near each other but don't actually overlap
// are handled a layer up, by the BULK_FRESH_MS window on the cached bulk fetchers below.
const inflight = new Map<string, Promise<unknown>>()
function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  const pending = inflight.get(key) as Promise<T> | undefined
  if (pending) return pending
  const p = run().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

// Last good teams read, for a synchronous seed on a surface that opens after the section has
// already loaded them (the overlay hosts). Never overwritten by an empty read, same reasoning
// as the schedule's last-good below.
let teamsCache: WpblTeam[] | null = null
export function getCachedWpblTeams(): WpblTeam[] | null { return teamsCache }
export function fetchWpblTeams(): Promise<WpblTeam[]> {
  return once('teams', () => safe('fetchWpblTeams', () =>
    supabase.from('wpbl_teams').select('*').order('sort_order', { ascending: true }),
    [] as WpblTeam[]).then(t => { if (t.length > 0) teamsCache = t; return t }))
}

// The last good schedule the section fetched, for the same synchronous seed. `lastGoodSchedule`
// is what fetchWpblSchedule already keeps for its empty-read guard, so this exposes it rather
// than holding a second copy.
export function getCachedWpblSchedule(): WpblGame[] | null { return lastGoodSchedule }

// The feed occasionally emits a phantom `scheduled` duplicate of a game it already
// reported final (same date + matchup, different api_game_id). Drop the not-yet-played
// copy when a played one exists for the same matchup-day; genuine doubleheaders (two
// played, or two upcoming) are left untouched.
//
// wpbl-ingest also suppresses these server-side (deletes the phantom row from the mirror),
// so on a healthy DB this filter is a no-op, kept as a cheap fallback for the window before
// a re-ingest clears an already-stored phantom.
function dedupeSchedule(games: WpblGame[]): WpblGame[] {
  const played = (g: WpblGame) => g.status === 'final' || g.status === 'live'
  const hasPlayed = new Set<string>()
  for (const g of games) if (played(g)) hasPlayed.add(`${g.game_date}|${g.away_team_id}|${g.home_team_id}`)
  return games.filter(g => played(g) || !hasPlayed.has(`${g.game_date}|${g.away_team_id}|${g.home_team_id}`))
}

/**
 * An empty schedule read never replaces a good one.
 *
 * `safe()` answers a failed or timed-out read with its fallback, and for this read the fallback
 * is `[]`, indistinguishable from a season that has not been ingested yet. That is the same
 * hazard the bulk and per-entity caches spell out further down, but the schedule is the one
 * read with no cache in front of it (a poll must never be served a stale copy of the thing it
 * is polling for), so the guard has to live on the read itself.
 *
 * WHAT IT COSTS TO GET WRONG IS THE WHOLE SECTION, not a stale row. `WpblApp` pushes this
 * straight into state every 20-60 seconds, and everything under /wpbl is derived from it: the
 * scoreboard, the standings, Home's next and last game, the live banner. One 8-second timeout
 * on a phone changing cells therefore empties the section and renders four clubs with no games,
 * which reads as the league having gone quiet rather than as a dropped request. Serving the
 * copy we already had is wrong by at most one poll and self-corrects on the next one.
 *
 * Once, on a first load with nothing to fall back on, `[]` is still the honest answer and the
 * views have empty states for it.
 */
export function mergeSchedule(next: WpblGame[], lastGood: WpblGame[] | null): WpblGame[] {
  if (next.length === 0 && lastGood && lastGood.length > 0) {
    console.warn('[wpbl] fetchWpblSchedule came back empty; serving the last good schedule.')
    return lastGood
  }
  return next
}

let lastGoodSchedule: WpblGame[] | null = null

/**
 * A dev-only interception point for the three reads that describe a game in progress.
 *
 * INSTALLED, not imported, and that is the whole design. The simulator behind it
 * (`dev/devLiveGame.ts`) is reachable only from `DevSettings`, which is proven absent from the
 * production bundle, so an import from here would be the one edge dragging it back in: a
 * production import of a module with top-level state is a side effect tree-shaking will not
 * remove. A slot costs three null checks and cannot leak.
 *
 * Every method is a pure transform of what the real read returned, so an uninstalled slot and
 * an installed-but-idle one are the same code path. See devLiveGame.ts for what it replays and
 * what it cannot.
 */
export interface WpblReadOverlay {
  schedule(games: WpblGame[]): WpblGame[]
  live(gameId: string, delta: Partial<WpblGame> | null): Partial<WpblGame> | null
  plays(gameId: string, plays: WpblGamePlay[]): WpblGamePlay[]
}

let readOverlay: WpblReadOverlay | null = null

export function installWpblReadOverlay(overlay: WpblReadOverlay | null) { readOverlay = overlay }

export function fetchWpblSchedule(): Promise<WpblGame[]> {
  return once('schedule', async () => {
    const games = await safe('fetchWpblSchedule', () =>
      supabase.from('wpbl_games').select('*').order('game_date', { ascending: true }),
      [] as WpblGame[])
    // settleGames LAST of the three, and at this boundary rather than in the views, because
    // `status` is read in about fifty places and a rule the callers have to remember to apply
    // is a rule that gets forgotten by the next one. Everything downstream of this read sees a
    // game the league has stopped updating as the final it is. See gameOver.ts.
    const schedule = mergeSchedule(settleGames(dedupeSchedule(games)), lastGoodSchedule)
    if (schedule.length > 0) lastGoodSchedule = schedule
    // Last, and after the last-good cache, so what is remembered for the next empty read is the
    // real schedule rather than a simulated moment of it.
    return readOverlay ? readOverlay.schedule(schedule) : schedule
  })
}

// How often the live views re-read a game in progress.
//
// This is a FALLBACK, not the delivery mechanism. Both live surfaces also hold a Supabase
// Realtime subscription on the row (Live.tsx) or on the plays and batting lines feeding it
// (GameDetail.tsx), and those push within a second of the write. The poll exists for the case
// where a subscription drops silently, which websockets do.
//
// Not faster: a poll cannot beat Realtime to a change, so a 5s poll only asks three times as
// often for an answer already on screen (over a three-hour game, 2,160 requests per viewer per
// surface instead of 720). Raise it further and a dropped subscription starts to show; lower it
// and you are paying for latency Realtime already gave you for free.
export const LIVE_POLL_MS = 15000

// Every column of `wpbl_games` that can change while a game is in progress. The live poll
// asks for these and merges them over the row the caller already holds, instead of re-reading
// the whole game every few seconds.
//
// TRAP: THIS LIST AND THE IMMUTABLE ONE BELOW MUST PARTITION THE TABLE. The columns
// deliberately left out are fixed the moment a game is scheduled and cannot move under a
// poll: game_date, start_time, home_team_id, away_team_id, venue, created_at, api_game_id,
// season_id, game_type, counts_in_standings. Adding a volatile column to `wpbl_games` and
// forgetting it here does not fail: it goes stale on screen mid-game, silently, and the merge
// below will keep serving the value from first paint. If you add a column, put it in one of
// the two lists. The saving is real but modest (0.94 KB against 1.2 KB, 22%), so if this list
// ever becomes hard to keep honest, going back to `select('*')` is the right call.
const LIVE_GAME_COLUMNS = [
  'id', 'status', 'status_detail', 'notes', 'updated_at', 'source_updated_at',
  'home_score', 'away_score', 'innings',
  'home_hits', 'away_hits', 'home_errors', 'away_errors', 'home_lob', 'away_lob',
  'home_line', 'away_line', 'live_state',
  'live_inning', 'live_half', 'live_outs', 'live_balls', 'live_strikes',
  'runner_first', 'runner_second', 'runner_third',
  'away_batting_order', 'home_batting_order', 'away_pitcher_id', 'home_pitcher_id',
  'last_play_at',
].join(',')

/** The volatile half of one game's row, for the live poll. Merge it over the game you already
 *  have (`{ ...prev, ...delta }`); every column it omits is immutable, so the merge is
 *  complete rather than a best effort. */
export async function fetchWpblGameLive(gameId: string): Promise<Partial<WpblGame> | null> {
  // Explicit, because the fallback alone does not pin the generic once the result is bound
  // rather than returned: inference walks off into PostgREST's error row type.
  const delta = await safe<Partial<WpblGame> | null>('fetchWpblGameLive', () =>
    supabase.from('wpbl_games').select(LIVE_GAME_COLUMNS).eq('id', gameId).maybeSingle() as unknown as
      PromiseLike<{ data: Partial<WpblGame> | null; error: unknown }>,
    null)
  return readOverlay ? readOverlay.live(gameId, delta) : delta
}

function readWpblRoster(teamId: string): Promise<WpblPlayer[]> {
  return safe('fetchWpblRoster', () =>
    supabase.from('wpbl_players').select('*').eq('team_id', teamId).order('name', { ascending: true }),
    [] as WpblPlayer[])
}

// ─── Session cache for the shared bulk reads ────────────────────────────────────
// The Stats and Home tabs both pull the full player roster and box-score lines, and a tab can
// remount (on desktop only the active tab is rendered), so without a cache each return would
// re-query the DB and flash the tab's loading spinner. Keep the last successful result so a
// remount repaints instantly, with a timestamp so a caller can still revalidate once it's
// stale (box scores change as games are played).
export type WpblLinesResult = { batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }
let allPlayersCache:  { data: WpblPlayer[]; at: number } | null = null
let allLinesCache:    { data: WpblLinesResult; at: number } | null = null
let allTrackingCache: { data: WpblTrackRow[]; at: number } | null = null
// Just the distinct game ids that carry tracking, for Home's "new tracking batch" banner. See
// fetchWpblTrackedGameIds for why this exists separately from the full table above.
let trackedGameIdsCache: { data: string[]; at: number } | null = null
let allPlaysCache:    { data: WpblFirstsPlay[]; at: number } | null = null
let allPitchPlaysCache: { data: WpblPitchPlay[]; at: number } | null = null
let allRunValuePlaysCache: { data: WpblRunValuePlay[]; at: number } | null = null
let allVideosCache:   { data: WpblVideo[]; at: number } | null = null
let allRecapsCache:   { data: WpblGameRecap[]; at: number } | null = null
let allArticlesCache: { data: WpblArticle[]; at: number } | null = null
let allPhotosCache:   { data: WpblPhoto[]; at: number } | null = null
let fanPhotosCache:   { data: WpblFanPhoto[]; at: number } | null = null
let fanPhotoSubjectsCache: { data: WpblPhotoSubject[]; at: number } | null = null
let fanPhotoFiguresCache:  { data: WpblPhotoFigure[]; at: number } | null = null
let siteGamesCache:   { data: WpblSiteGame[]; at: number } | null = null

// How long a bulk result is served straight from the cache without re-querying.
//
// `once()` above collapses reads that overlap in time; this collapses reads that merely
// land close together, which on a cold load is most of them. Several components ask for these
// same league-wide datasets independently (Home, GamePreview, StatsView, TeamPage,
// TrackingView), and a caller should not have to remember to check its own staleness: without
// this a single load re-pulls the full roster and every box-score line two or three times,
// hundreds of milliseconds apart.
//
// Kept comfortably below the 30s window Home's own gate uses, so nothing that revalidates
// on a schedule (the live-game poll runs at 60s) gets held back; this only absorbs the
// fan-out within one page load or one quick tab switch.
const BULK_FRESH_MS = 20_000

const isFresh = (c: { at: number } | null): boolean => !!c && Date.now() - c.at < BULK_FRESH_MS

export function getCachedWpblAllPlayers(): WpblPlayer[] | null { return allPlayersCache?.data ?? null }
export function getCachedWpblAllLines(): WpblLinesResult | null { return allLinesCache?.data ?? null }
export function getCachedWpblAllTracking(): WpblTrackRow[] | null { return allTrackingCache?.data ?? null }
export function getCachedWpblTrackedGameIds(): string[] | null { return trackedGameIdsCache?.data ?? null }
export function getCachedWpblAllPlays(): WpblFirstsPlay[] | null { return allPlaysCache?.data ?? null }
export function getCachedWpblAllPitchPlays(): WpblPitchPlay[] | null { return allPitchPlaysCache?.data ?? null }
export function getCachedWpblAllRunValuePlays(): WpblRunValuePlay[] | null { return allRunValuePlaysCache?.data ?? null }
export function getCachedWpblVideos(): WpblVideo[] | null { return allVideosCache?.data ?? null }
export function getCachedWpblRecaps(): WpblGameRecap[] | null { return allRecapsCache?.data ?? null }
export function getCachedWpblArticles(): WpblArticle[] | null { return allArticlesCache?.data ?? null }
export function getCachedWpblPhotos(): WpblPhoto[] | null { return allPhotosCache?.data ?? null }
export function getCachedWpblFanPhotos(): WpblFanPhoto[] | null { return fanPhotosCache?.data ?? null }
export function getCachedWpblFanPhotoSubjects(): WpblPhotoSubject[] | null { return fanPhotoSubjectsCache?.data ?? null }
export function getCachedWpblFanPhotoFigures(): WpblPhotoFigure[] | null { return fanPhotoFiguresCache?.data ?? null }
export function getCachedWpblSiteGames(): WpblSiteGame[] | null { return siteGamesCache?.data ?? null }

// ─── Per-entity session cache ───────────────────────────────────────────────────
//
// The same contract as the bulk caches, for PER-THING reads, which is what the two surfaces a
// reader opens over and over are made of: the four club buttons on a team page, whose whole job
// is to be tapped back and forth, and a player card opened from a leaderboard, closed, and
// opened again. Uncached, the second visit spins exactly as long as the first, on data that has
// not changed since ten seconds ago.
//
// Keyed by entity id: `isFresh` decides whether a read is skipped, `once` collapses two callers
// landing together, and a `getCached*` accessor lets a component paint from the cache
// SYNCHRONOUSLY on its first render. That last part is what removes the spinner rather than
// merely shortening it: seeding state in an effect still gives you one frame of empty, and one
// frame of empty is a flash.
//
// AN EMPTY RESULT NEVER EVICTS A GOOD ONE. `safe()` answers a failed or timed-out read with its
// fallback, which is `[]` or null here, so without this guard one dropped request would replace
// a club's roster with "no players" and keep serving that for the rest of the freshness window.
// Same reasoning as `mergeBulkLines`, one section up. `isEmpty` is per-cache because the shapes
// differ: a list is empty when it has no rows, a player's season when all three of its reads are.
//
// NOT FOR ANYTHING A POLL DEPENDS ON, AND THE PER-GAME READS ARE ALL OF THEM:
//
//   * `fetchWpblGameLive` is the live scoreboard's refresh. A cache on it is a scoreboard that
//     stops moving.
//   * `fetchWpblGameLines` looks like the obvious next one and is the trap. Game Center polls
//     it every LIVE_POLL_MS (15s) and ALSO re-reads it from a realtime subscription on
//     wpbl_batting_lines, so a 20s freshness window would swallow both: a run scores, the
//     change event fires, and the box score does not move for up to five seconds after the
//     poll that should have caught it. The window being longer than the poll is the whole
//     problem, and tuning one against the other is a worse bargain than not caching.
//   * `fetchWpblGamePlays`, `fetchWpblGameTracking` and `fetchWpblGameDetails` ride in the same
//     `reload()` as the lines, and Game Center already solves reopening with its own
//     `gameCache` at the component level, which is the right layer for it: that cache holds
//     the assembled view, not the four reads.
//
// So this is for entities whose data changes on the ingest's schedule rather than a poll's:
// a roster, a club's lineup history and usage, a player's season.
function keyedCache<T>(name: string, read: (key: string) => Promise<T>, isEmpty: (v: T) => boolean) {
  const cache = new Map<string, { data: T; at: number }>()
  return {
    get: (key: string): T | null => cache.get(key)?.data ?? null,
    fetch: (key: string): Promise<T> => {
      const hit = cache.get(key)
      if (hit && isFresh(hit)) return Promise.resolve(hit.data)
      return once(`${name}:${key}`, async () => {
        const data = await read(key)
        if (!isEmpty(data) || !cache.has(key)) cache.set(key, { data, at: Date.now() })
        return cache.get(key)?.data ?? data
      })
    },
  }
}

const emptyList = <T,>(v: T[]) => v.length === 0

const rosterCache  = keyedCache('roster', readWpblRoster, emptyList)
const lineupsCache = keyedCache('lineups', readWpblLineupHistory, emptyList)
const usageCache   = keyedCache('usage', readWpblPitchingUsage, emptyList)

// A PLAYER PAGE IS THE THING PEOPLE OPEN TWICE. It is the section's retention event (a reader
// who opens one comes back at 76.5%, against 7.8% for one who opens neither it nor Game
// Center; see ROADMAP-WPBL.md), and it is reached from a leaderboard, which is a list of
// twenty of them: open, read, close, open the next, come back to the first.
const playerLinesCache = keyedCache('playerLines', readWpblPlayerLines,
  v => v.batting.length === 0 && v.pitching.length === 0 && v.fielding.length === 0)
const pitchLocsCache = keyedCache('pitchLocs', readWpblPitcherLocations, emptyList)

export const fetchWpblRoster = rosterCache.fetch
export const fetchWpblLineupHistory = lineupsCache.fetch
export const fetchWpblPitchingUsage = usageCache.fetch
export const fetchWpblPlayerLines = playerLinesCache.fetch

/** Every tracked pitch by one pitcher. Takes the feed ids as ONE comma-joined string rather
 *  than an array, because that string is the cache key and an array would be a new object on
 *  every render. PlayerDetail already holds exactly this string for the same reason. */
export const fetchWpblPitcherLocations = pitchLocsCache.fetch

/** The last good read for one club, or null. For painting on the first render; the caller
 *  should still call the matching `fetch` so a stale entry revalidates behind the paint. */
export const getCachedWpblRoster = rosterCache.get
export const getCachedWpblLineupHistory = lineupsCache.get
export const getCachedWpblPitchingUsage = usageCache.get
export const getCachedWpblPlayerLines = playerLinesCache.get
export const getCachedWpblPitcherLocations = pitchLocsCache.get

/** Age (ms) of the cached players+lines pair; Infinity until both are seeded. */
export function wpblStatsCacheAgeMs(): number {
  if (!allPlayersCache || !allLinesCache) return Infinity
  return Date.now() - Math.min(allPlayersCache.at, allLinesCache.at)
}

/** Age (ms) of the players+lines+tracking trio the Tracking tab reads; Infinity until all seeded. */
export function wpblTrackingCacheAgeMs(): number {
  if (!allPlayersCache || !allLinesCache || !allTrackingCache) return Infinity
  return Date.now() - Math.min(allPlayersCache.at, allLinesCache.at, allTrackingCache.at)
}

/** Age (ms) of the set Home's own effect reads (players + lines + the tracked-game-id list its
 *  banner needs); Infinity until all three are seeded, which is what makes a warm re-entry skip
 *  the refetch. It deliberately does NOT wait on the run-value play log: that is fetched last and
 *  on its own, so gating warmth on it would keep Home "cold" for the second it takes to land and
 *  refetch everything else needlessly. (It used to wait on the firsts play log, which Home has
 *  not read since the Hall of Firsts came off, so this never went warm at all.) */
export function wpblHomeCacheAgeMs(): number {
  if (!allPlayersCache || !allLinesCache || !trackedGameIdsCache) return Infinity
  return Date.now() - Math.min(allPlayersCache.at, allLinesCache.at, trackedGameIdsCache.at)
}

// Every player in the league (all four rosters): the name pool for search, for slugs, and for
// any surface that names a player off a box-score line.
export function fetchWpblAllPlayers(): Promise<WpblPlayer[]> {
  if (isFresh(allPlayersCache)) return Promise.resolve(allPlayersCache!.data)
  return once('allPlayers', async () => {
    const data = await safe('fetchWpblAllPlayers', () =>
      supabase.from('wpbl_players').select('*'),
      [] as WpblPlayer[])
    // Don't clobber a good cache with an empty error/timeout fallback; a genuinely
    // empty first load (pre-migration) still seeds so callers stop showing a spinner.
    if (data.length > 0 || allPlayersCache == null) allPlayersCache = { data, at: Date.now() }
    return data
  })
}

// Only the play columns the Hall of Firsts reads (see WpblFirstsPlay). Deliberately omits
// `pitch_events` (a JSON array of every pitch in the play) and the base/count fields, which
// dominate the row size but the firsts computation never uses, so this scans the whole
// season's plays at a fraction of the transfer of select('*').
const FIRSTS_PLAY_SELECT =
  'game_id,sequence,team_id,batter_id,batter_name,pitcher_id,pitcher_name,narrative,event_type,is_hit,runs_scored'

// Only the plays that could ever set a milestone (see playCanSetFirst). Routine outs are
// most of the play log and none of them can produce a first, so they are dropped at the
// database rather than transferred and skipped on the phone.
const FIRSTS_PLAY_FILTER = [
  'is_hit.is.true',
  `event_type.in.(${FIRSTS_EVENT_TYPES.join(',')})`,
  'runs_scored.gt.0',
  'narrative.ilike.*balk*',
].join(',')

// ─── Batted balls, for the spray chart ────────────────────────────────────────
//
// A SECOND PLAY READ, and the filter is the reason. `fetchWpblAllPlays` drops routine outs at
// the database because none of them can set a first, and a spray chart made of hits only is
// not a spray chart: a flyout is the best-covered category in the whole log for direction
// (219 of 219 name one), and leaving them out draws a picture where every ball a fielder
// caught simply never happened.
//
// Narrowed the other way instead: only the event types that put a ball in play, and only the
// eight columns the chart reads. That is roughly 1,500 rows for the season.
const SPRAY_PLAY_SELECT = 'game_id,sequence,team_id,batter_id,batter_name,narrative,event_type,is_hit'
const SPRAY_EVENT_TYPES = [
  'single', 'double', 'triple', 'home_run',
  'groundout', 'flyout', 'lineout', 'popup', 'foul_out', 'sacrifice', 'fielders_choice', 'out',
]

let sprayPlaysCache: { data: WpblSprayPlay[]; at: number } | null = null

export function getCachedWpblBattedBalls(): WpblSprayPlay[] | null { return sprayPlaysCache?.data ?? null }

/** Every batted ball of the season. Paged and ordered for the reason on fetchWpblAllPlays. */
export function fetchWpblBattedBalls(): Promise<WpblSprayPlay[]> {
  if (isFresh(sprayPlaysCache)) return Promise.resolve(sprayPlaysCache!.data)
  return once('sprayPlays', async () => {
    const PAGE = 1000
    const out: WpblSprayPlay[] = []
    for (let from = 0; ; from += PAGE) {
      const page = await safe<WpblSprayPlay[]>('fetchWpblBattedBalls', () =>
        supabase.from('wpbl_game_plays')
          .select(SPRAY_PLAY_SELECT)
          .in('event_type', SPRAY_EVENT_TYPES)
          .order('game_id', { ascending: true })
          .order('sequence', { ascending: true })
          .range(from, from + PAGE - 1) as unknown as
          PromiseLike<{ data: WpblSprayPlay[] | null; error: unknown }>,
        [])
      out.push(...page)
      if (page.length < PAGE) break
    }
    // Corrections carry the batter, and a play credited to the wrong hitter puts her ball on
    // somebody else's chart. Same overlay the firsts read applies, same reason.
    const corrected = applyPlayCorrections(out, await fetchAllPlayCorrections())
    if (corrected.length > 0 || sprayPlaysCache == null) sprayPlaysCache = { data: corrected, at: Date.now() }
    return corrected
  })
}

// How many games carry TrackMan data, from the watcher's one-row snapshot
// (`wpbl_tracking_watch`, refreshed daily by scripts/watch-wpbl-tracking.mjs). One row and one
// integer, so the Stats tab can decide whether to offer the Tracked board BEFORE paying for
// the paginated tracking scan that would answer the same question. Null when the row has never
// been written, which callers should read as "unknown", not "none".
let trackedGamesCache: { data: number | null; at: number } | null = null

export function fetchWpblTrackedGameCount(): Promise<number | null> {
  if (isFresh(trackedGamesCache)) return Promise.resolve(trackedGamesCache!.data)
  return once('trackedGameCount', async () => {
    const rows = await safe<{ tracked_game_count: number | null }[]>('fetchWpblTrackedGameCount', () =>
      supabase.from('wpbl_tracking_watch').select('tracked_game_count').limit(1), [])
    const data = rows.length > 0 ? rows[0].tracked_game_count ?? 0 : null
    trackedGamesCache = { data, at: Date.now() }
    return data
  })
}

// Every play-by-play row in the league that could set a Hall of Firsts milestone (first HR,
// first strikeout, first stolen base, …): one row per play for the whole season, so it is
// column-projected, filtered server-side, and cached last-good. Empty pre-migration.
//
// Paginated, and this is not optional. PostgREST caps an unbounded select at 1000 rows and
// returns them in no defined order, so an unpaged scan silently stops at that cap (the play log
// is well past it) with an arbitrary slice. computeFirsts sorts what it is handed and takes the
// earliest match, so a dropped opening-day play would not just omit a milestone, it would
// reassign it to whoever did it next. The explicit order also makes the paging deterministic:
// without it, PostgREST can return the same row on two pages and miss another entirely.
export function fetchWpblAllPlays(): Promise<WpblFirstsPlay[]> {
  if (isFresh(allPlaysCache)) return Promise.resolve(allPlaysCache!.data)
  return once('allPlays', async () => {
    const PAGE = 1000
    const out: WpblFirstsPlay[] = []
    for (let from = 0; ; from += PAGE) {
      const page = await safe<WpblFirstsPlay[]>('fetchWpblAllPlays', () =>
        supabase.from('wpbl_game_plays')
          .select(FIRSTS_PLAY_SELECT)
          .or(FIRSTS_PLAY_FILTER)
          .order('game_id', { ascending: true })
          .order('sequence', { ascending: true })
          .range(from, from + PAGE - 1) as unknown as
          PromiseLike<{ data: WpblFirstsPlay[] | null; error: unknown }>,
        [])
      out.push(...page)
      if (page.length < PAGE) break
    }
    // Corrections matter more here than anywhere else in the app. A first is awarded once and
    // then reads as settled league history, so a play credited to the wrong batter does not
    // just mislabel one row, it hands somebody else's milestone to them permanently. The
    // corrections table is tiny, so this is one extra request on a read that already made
    // several.
    const corrected = applyPlayCorrections(out, await fetchAllPlayCorrections())
    if (corrected.length > 0 || allPlaysCache == null) allPlaysCache = { data: corrected, at: Date.now() }
    return corrected
  })
}

// Only the columns the pitch-code boards read (see WpblPitchPlay), and only the rows that
// have a pitch sequence at all. The filter is doing real work: a third of the play log is
// baserunning and substitution rows that carry no pitches, and dropping them at the database
// is a third of the transfer for a board that would skip them anyway.
const PITCH_PLAY_SELECT =
  'game_id,sequence,team_id,batter_id,batter_name,pitcher_id,pitcher_name,event_type,pitch_sequence'

/** Every plate appearance in the league, as its pitch sequence.
 *
 *  Paged, for the reason spelled out on fetchWpblAllPlays: an unbounded select stops at 1000
 *  rows with no error, and the play log is well past that. A truncated read here does not
 *  fail, it just makes every rate on the boards a rate over an arbitrary slice of the season.
 *
 *  Corrected on the way out like the firsts read, because a correction to a play's batter or
 *  pitcher moves that whole at-bat's pitches from one player's line to another's. */
const RUN_VALUE_PLAY_SELECT =
  'game_id,sequence,inning,half,team_id,batter_id,batter_name,pitcher_id,pitcher_name,'
  + 'outs,first_base,second_base,third_base,event_type,runs_scored,narrative,pitch_sequence'

/** Every play in the league, in order, with the base-out state each one started from.
 *
 *  UNFILTERED, unlike the firsts read next door, and it has to be. Run expectancy is a walk
 *  forward through a half-inning: the state a play ended in is the state the NEXT row reports,
 *  so dropping the routine outs would leave the walk stepping over gaps and silently valuing
 *  plays against the wrong state. This is the one league-wide play read that wants all of it.
 *
 *  Paged and ordered for the reason on fetchWpblAllPlays, and corrected on the way out like
 *  every other play read: a correction that moves a run moves the value of the play it was
 *  scored on. */
export function fetchWpblAllRunValuePlays(): Promise<WpblRunValuePlay[]> {
  if (isFresh(allRunValuePlaysCache)) return Promise.resolve(allRunValuePlaysCache!.data)
  return once('allRunValuePlays', async () => {
    const out = await fetchAllPaged<WpblRunValuePlay>('fetchWpblAllRunValuePlays', (from, to) =>
      supabase.from('wpbl_game_plays')
        .select(RUN_VALUE_PLAY_SELECT)
        .order('game_id', { ascending: true })
        .order('sequence', { ascending: true })
        .range(from, to) as unknown as
        PromiseLike<{ data: WpblRunValuePlay[] | null; error: unknown }>)
    const corrected = applyPlayCorrections(out, await fetchAllPlayCorrections())
    if (corrected.length > 0 || allRunValuePlaysCache == null) {
      allRunValuePlaysCache = { data: corrected, at: Date.now() }
    }
    return corrected
  })
}

export function fetchWpblAllPitchPlays(): Promise<WpblPitchPlay[]> {
  if (isFresh(allPitchPlaysCache)) return Promise.resolve(allPitchPlaysCache!.data)
  return once('allPitchPlays', async () => {
    const out = await fetchAllPaged<WpblPitchPlay>('fetchWpblAllPitchPlays', (from, to) =>
      supabase.from('wpbl_game_plays')
        .select(PITCH_PLAY_SELECT)
        .not('pitch_sequence', 'is', null)
        .order('game_id', { ascending: true })
        .order('sequence', { ascending: true })
        .range(from, to) as unknown as
        PromiseLike<{ data: WpblPitchPlay[] | null; error: unknown }>)
    const corrected = applyPlayCorrections(out, await fetchAllPlayCorrections())
    if (corrected.length > 0 || allPitchPlaysCache == null) allPitchPlaysCache = { data: corrected, at: Date.now() }
    return corrected
  })
}

/**
 * Read a whole table, a page at a time.
 *
 * PostgREST silently caps a bare `select` at 1000 rows (no error, just a short array), so
 * anything that means "every row" has to page explicitly or it quietly returns a prefix.
 * The `order` the caller passes matters as much as the paging does: without a deterministic
 * total order PostgREST can hand back the same row on two pages and skip another entirely
 * (same trap documented on fetchWpblAllPlays above).
 */
async function fetchAllPaged<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const rows = await safe<T[]>(label, () => page(from, from + PAGE - 1), [])
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

// Every box-score line in the league, for season aggregates. Paged, because a truncated read
// here doesn't fail, it just makes every league-wide rate quietly wrong: OPS+ and ERA+ derive
// their league baseline from these rows. Returns empty (no leaders) until games start being
// entered.
// The bulk line reads take every column EXCEPT `created_at`, which nothing in the section
// reads and which costs 17 KB across the season's batting lines (145 KB to 128 KB, 12%). The
// per-game reads still take `select('*')`: they are one game's worth of rows and the saving
// there is noise.
//
// Read these as "the type, minus created_at". If you add a column to either table, add it
// here too, or the season aggregates simply will not see it. tsc will not catch the omission,
// because a missing column arrives as `undefined` and both types allow that for new fields.
const PITCHING_LINE_COLUMNS = [
  'id', 'game_id', 'player_id', 'team_id', 'outs', 'bf', 'h', 'r', 'er', 'bb', 'so', 'hr',
  'pitches', 'decision', 'gs', 'hbp', 'ibb', 'wp', 'bk', 'strikes', 'doubles', 'triples',
].join(',')

const BATTING_LINE_COLUMNS = [
  'id', 'game_id', 'player_id', 'team_id', 'batting_order', 'position',
  'ab', 'r', 'h', 'doubles', 'triples', 'hr', 'rbi', 'bb', 'so', 'hbp',
  'sb', 'cs', 'sf', 'sh', 'ibb', 'gdp', 'tb', 'lob', 'sub_out',
].join(',')

/**
 * Merge a fresh pair of line reads over the last-good pair, ARRAY BY ARRAY.
 *
 * `fetchWpblAllPlayers` gets last-good right because it holds one array: an empty result with a
 * good cache means the read failed, so the cache is left alone. Two arrays make that test
 * ambiguous. "Cache the pair unless BOTH failed" is wrong, because the two reads run in parallel
 * and fail independently: a run where only the batting read came up short would cache a league
 * with no batting at all, and every surface built on it (team stats, the spec chart's Power,
 * Contact, Eye and Speed) would look finished while being half fiction.
 *
 * `complete` is false when either side came back short, and the caller uses it to leave the
 * cache's timestamp alone so the next read RETRIES rather than serving the half it knows is
 * missing for the whole freshness window.
 *
 * A genuinely empty league (no cache yet, pre-migration) still seeds, or every caller spins
 * forever waiting for rows that do not exist.
 */
export function mergeBulkLines(fresh: WpblLinesResult, prev: WpblLinesResult | null): {
  data: WpblLinesResult
  complete: boolean
} {
  const complete = fresh.batting.length > 0 && fresh.pitching.length > 0
  if (!prev) return { data: fresh, complete }
  return {
    data: {
      batting: fresh.batting.length > 0 ? fresh.batting : prev.batting,
      pitching: fresh.pitching.length > 0 ? fresh.pitching : prev.pitching,
    },
    complete,
  }
}

/**
 * Every fielding line in the league, for the one thing that needs them: the fan ballot's
 * Defensive Wizard shortlist.
 *
 * League-wide fielding is read nowhere else: the section has no defensive leaderboard and
 * deliberately does not pretend to have one. A ballot line still has to offer names, and the
 * box score's fielding line is the closest it gets to a play made.
 *
 * PAGED, AND ORDERED, which on this table is the whole risk. PostgREST caps a bare select at
 * 1000 rows and says nothing about it, and one season already runs to hundreds of fielding
 * lines, so a second season walks straight into a silent truncation that would quietly drop
 * whole clubs off the shortlist. `fetchAllPaged` with a deterministic order is the section's one
 * answer to that; see CLAUDE.md.
 *
 * Cached on the same clock as the other bulk reads, and empty on error rather than throwing: a
 * ballot that cannot draw one shortlist should draw the others.
 */
const FIELDING_LINE_COLUMNS = [
  'id', 'game_id', 'player_id', 'team_id', 'po', 'a', 'e', 'pb', 'sba', 'ci', 'dp',
].join(',')

let allFieldingCache: { data: WpblFieldingLine[]; at: number } | null = null

export function getCachedWpblAllFielding(): WpblFieldingLine[] | null {
  return allFieldingCache?.data ?? null
}

export function fetchWpblAllFielding(): Promise<WpblFieldingLine[]> {
  if (isFresh(allFieldingCache)) return Promise.resolve(allFieldingCache!.data)
  return once('allFielding', async () => {
    const rows = await fetchAllPaged<WpblFieldingLine>('fetchWpblAllFielding', (from, to) =>
      supabase.from('wpbl_fielding_lines').select(FIELDING_LINE_COLUMNS)
        .order('id', { ascending: true }).range(from, to) as unknown as
        PromiseLike<{ data: WpblFieldingLine[] | null; error: unknown }>)
    // A short read keeps the last good rows and leaves the clock alone, exactly as the batting
    // and pitching reads do: half a league's fielding is a shortlist missing two clubs, and it
    // looks precisely like a shortlist that is complete.
    if (rows.length === 0 && allFieldingCache) return allFieldingCache.data
    allFieldingCache = { data: rows, at: Date.now() }
    return rows
  })
}

export function fetchWpblAllLines(): Promise<WpblLinesResult> {
  if (isFresh(allLinesCache)) return Promise.resolve(allLinesCache!.data)
  return once('allLines', async () => {
    const [batting, pitching] = await Promise.all([
      fetchAllPaged<WpblBattingLine>('fetchWpblAllBatting', (from, to) =>
        supabase.from('wpbl_batting_lines').select(BATTING_LINE_COLUMNS)
          .order('id', { ascending: true }).range(from, to) as unknown as
          PromiseLike<{ data: WpblBattingLine[] | null; error: unknown }>),
      fetchAllPaged<WpblPitchingLine>('fetchWpblAllPitching', (from, to) =>
        supabase.from('wpbl_pitching_lines').select(PITCHING_LINE_COLUMNS)
          .order('id', { ascending: true }).range(from, to) as unknown as
          PromiseLike<{ data: WpblPitchingLine[] | null; error: unknown }>),
    ])
    const prevAt = allLinesCache?.at
    const { data, complete } = mergeBulkLines({ batting, pitching }, allLinesCache?.data ?? null)
    if (!complete && prevAt != null) {
      console.warn(`[wpbl] fetchWpblAllLines came back short (batting ${batting.length}, pitching ${pitching.length}); serving last-good for the missing half and leaving the cache stale so the next read retries.`)
    }
    // A short read updates the DATA (it may still carry a fresher half) but not the clock.
    allLinesCache = { data, at: complete || prevAt == null ? Date.now() : prevAt }
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

const numOrNull = (v: unknown): number | null => {
  if (v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

export function fetchWpblAllTracking(): Promise<WpblTrackRow[]> {
  if (isFresh(allTrackingCache)) return Promise.resolve(allTrackingCache!.data)
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
  if (out.length > 0 || allTrackingCache == null) allTrackingCache = { data: out, at: Date.now() }
  return out
  })
}

/**
 * Just the distinct game ids that carry tracking, for Home's "new tracking batch" banner.
 *
 * The banner reduces the whole tracking table to `new Set(game_id)` (see `useNewTrackingBatch` in
 * Home.tsx), so calling `fetchWpblAllTracking` for it moved the entire table across the wire to
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
  if (isFresh(trackedGameIdsCache)) return Promise.resolve(trackedGameIdsCache!.data)
  return once('trackedGameIds', async () => {
    const rows = await fetchAllPaged<{ game_id: string }>('fetchWpblTrackedGameIds', (from, to) =>
      supabase.from('wpbl_pitch_tracking').select('game_id')
        .order('activity_id', { ascending: true })
        .range(from, to) as unknown as
        PromiseLike<{ data: { game_id: string }[] | null; error: unknown }>)
    const ids = [...new Set(rows.map(r => String(r.game_id)))]
    // Last-good, like the table read above: a transient empty must not clobber a good set.
    if (ids.length > 0 || trackedGameIdsCache == null) trackedGameIdsCache = { data: ids, at: Date.now() }
    return ids
  })
}

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

// The league's mirrored YouTube uploads, newest first, for the highlights rail and the
// per-game recap card. A small table, so this is one cheap read cached last-good: the rail
// repaints on a revisit without re-querying, and the GameDetail recap reads the same cache
// instead of its own request. Empty pre-migration.
export function fetchWpblVideos(): Promise<WpblVideo[]> {
  if (isFresh(allVideosCache)) return Promise.resolve(allVideosCache!.data)
  return once('allVideos', async () => {
    const data = await safe<WpblVideo[]>('fetchWpblVideos', () =>
      supabase.from('wpbl_videos')
        .select('video_id,title,published_at,thumbnail_url,kind,game_id,away_hint,home_hint,game_date_hint')
        .order('published_at', { ascending: false }) as unknown as
        PromiseLike<{ data: WpblVideo[] | null; error: unknown }>,
      [])
    if (data.length > 0 || allVideosCache == null) allVideosCache = { data, at: Date.now() }
    return data
  })
}

/**
 * The league's own website calendar (`wpbl_site_games`), mirrored nightly by
 * `scripts/sync-wpbl-site-calendar.mjs`.
 *
 * A SECOND SOURCE, FOR THE GAMES THE STATS FEED HAS NOT PUBLISHED. Everything else here comes
 * from the feed, which needs two clubs before it will carry a game row and so holds nothing for
 * a postseason until the seeds are set, while the website publishes those games weeks out with
 * the times, the tickets and, for the semifinals, which club bats last. Only
 * `postseasonScheduleRows` reads it, and only for a fixture the feed has no row for.
 *
 * A few dozen rows for a whole season, so it is read whole, ordered, and cached app-wide like
 * the videos above it. An empty result keeps the last good list: the postseason placeholders
 * fall back to their own published constant rather than losing their home clubs on one bad
 * read.
 */
export function fetchWpblSiteGames(): Promise<WpblSiteGame[]> {
  if (isFresh(siteGamesCache)) return Promise.resolve(siteGamesCache!.data)
  return once('siteGames', async () => {
    const data = await safe<WpblSiteGame[]>('fetchWpblSiteGames', () =>
      supabase.from('wpbl_site_games')
        .select('event_id,game_date,start_time,title,status,home_team_id,away_team_id,home_score,away_score,round,series_key,game_number,url,ticket_url')
        .order('game_date', { ascending: true })
        .order('event_id', { ascending: true }) as unknown as
        PromiseLike<{ data: WpblSiteGame[] | null; error: unknown }>,
      [])
    if (data.length > 0 || siteGamesCache == null) siteGamesCache = { data, at: Date.now() }
    return data
  })
}

// The reading feed (wpbl_articles): a mirror of an independent writer's WPBL coverage.
// Tiny table, read once app-wide and shared by the Home rail, the game card, and the player
// and team pages, exactly like the videos read above it.
export function fetchWpblArticles(): Promise<WpblArticle[]> {
  if (isFresh(allArticlesCache)) return Promise.resolve(allArticlesCache!.data)
  return once('allArticles', async () => {
    const data = await safe<WpblArticle[]>('fetchWpblArticles', () =>
      supabase.from('wpbl_articles')
        .select('post_id,slug,url,title,subtitle,cover_url,published_at,word_count,video_count,tags,game_id,team_ids,player_ids')
        .order('published_at', { ascending: false }) as unknown as
        PromiseLike<{ data: WpblArticle[] | null; error: unknown }>,
      [])
    if (data.length > 0 || allArticlesCache == null) allArticlesCache = { data, at: Date.now() }
    return data
  })
}

// The archive gallery (wpbl_photos): freely licensed women's baseball photography mirrored
// from Wikimedia Commons. Same shape as the two reads above, and the same tolerance for the
// table not existing yet.
//
// NOT filtered on `approved` here, and that is deliberate. The RLS policy already restricts
// the select to approved rows, so the unreviewed backlog is unreachable from the browser
// whatever this query asks for. Adding `.eq('approved', true)` would read as though it were
// the thing keeping the backlog private, and the next person to write a query would copy the
// filter and believe it was enough.
//
// Ordered by the curator's sequence, which is the point of having one: the gallery is a
// curated set, not a feed, so upload date is the wrong axis. `page_id` breaks ties so the
// order is total (see fetchAllPaged for what a non-deterministic order costs a paged read;
// this table is far too small to page, but the habit is cheap).
export function fetchWpblPhotos(): Promise<WpblPhoto[]> {
  if (isFresh(allPhotosCache)) return Promise.resolve(allPhotosCache!.data)
  return once('allPhotos', async () => {
    const data = await safe<WpblPhoto[]>('fetchWpblPhotos', () =>
      supabase.from('wpbl_photos')
        .select('page_id,title,description,caption,file_url,thumb_url,width,height,description_url,artist,license_short,license_url,date_original,sort_order')
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('page_id', { ascending: true }) as unknown as
        PromiseLike<{ data: WpblPhoto[] | null; error: unknown }>,
      [])
    if (data.length > 0 || allPhotosCache == null) allPhotosCache = { data, at: Date.now() }
    return data
  })
}

// ─── Fan photos: this season's players, by name ──────────────────────────────
//
// The three flat reads that back every fan-photo surface. NOT wpbl_photos (the Commons
// history gallery); see docs/FAN_PHOTOS.md for why they are separate tables. buildFanPhotoIndex
// in fanPhotos.ts joins them client-side into per-player / per-figure / per-game lookups, the same
// shape the section already uses for league-wide data (flat reads, indexed in memory), rather
// than a PostgREST embed.
//
// All three are PAGED and ORDERED. Four hundred photos at three tags each is already 1,200
// subject rows, so the tags cross PostgREST's silent 1000-row cap on the first real batch; a
// truncated read is a short array with no error, and the photos it drops simply stop appearing
// on the pages that sort last. See fetchAllPaged and CLAUDE.md.
//
// None filters on `approved`: RLS restricts the select to approved rows (and a tag to an
// approved photo), so the unreviewed backlog is unreachable from the browser whatever the query
// asks. A filter here would read as though it were the protection.

// The card render, dims and caption drive the strip and gallery; game_id feeds Game Center.
// Ordered by the curator's sequence, id breaking ties so the order is total.
const FAN_PHOTO_COLUMNS = 'id,card_url,full_url,width,height,caption,credit,taken_on,game_id,sort_order'

export function fetchWpblFanPhotos(): Promise<WpblFanPhoto[]> {
  if (isFresh(fanPhotosCache)) return Promise.resolve(fanPhotosCache!.data)
  return once('fanPhotos', async () => {
    const data = await fetchAllPaged<WpblFanPhoto>('fetchWpblFanPhotos', (from, to) =>
      supabase.from('wpbl_fan_photos')
        .select(FAN_PHOTO_COLUMNS)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as unknown as
        PromiseLike<{ data: WpblFanPhoto[] | null; error: unknown }>)
    if (data.length > 0 || fanPhotosCache == null) fanPhotosCache = { data, at: Date.now() }
    return data
  })
}

export function fetchWpblFanPhotoSubjects(): Promise<WpblPhotoSubject[]> {
  if (isFresh(fanPhotoSubjectsCache)) return Promise.resolve(fanPhotoSubjectsCache!.data)
  return once('fanPhotoSubjects', async () => {
    const data = await fetchAllPaged<WpblPhotoSubject>('fetchWpblFanPhotoSubjects', (from, to) =>
      supabase.from('wpbl_photo_subjects')
        .select('id,photo_id,player_id,figure_key')
        .order('photo_id', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as unknown as
        PromiseLike<{ data: WpblPhotoSubject[] | null; error: unknown }>)
    if (data.length > 0 || fanPhotoSubjectsCache == null) fanPhotoSubjectsCache = { data, at: Date.now() }
    return data
  })
}

export function fetchWpblFanPhotoFigures(): Promise<WpblPhotoFigure[]> {
  if (isFresh(fanPhotoFiguresCache)) return Promise.resolve(fanPhotoFiguresCache!.data)
  return once('fanPhotoFigures', async () => {
    const data = await fetchAllPaged<WpblPhotoFigure>('fetchWpblFanPhotoFigures', (from, to) =>
      supabase.from('wpbl_photo_figures')
        .select('key,name,kind,blurb,team_id')
        .order('name', { ascending: true })
        .order('key', { ascending: true })
        .range(from, to) as unknown as
        PromiseLike<{ data: WpblPhotoFigure[] | null; error: unknown }>)
    if (data.length > 0 || fanPhotoFiguresCache == null) fanPhotoFiguresCache = { data, at: Date.now() }
    return data
  })
}

// The one call a surface makes: all three reads in parallel, joined into the per-subject and
// per-game lookups. Each read is cached and deduped on its own, so calling this from several
// components in one load costs one round trip each, not one per caller.
export async function fetchWpblFanPhotoIndex(): Promise<FanPhotoIndex> {
  const [photos, subjects, figures] = await Promise.all([
    fetchWpblFanPhotos(),
    fetchWpblFanPhotoSubjects(),
    fetchWpblFanPhotoFigures(),
  ])
  return buildFanPhotoIndex(photos, subjects, figures)
}

// ─── Fan photo curation (owner-only, writes through the is_site_owner() RLS policy) ──────
//
// The curation tool under /admin. These writes are NOT a fourth write path (CLAUDE.md): the
// owner policy on each table already exists, exactly as it does on wpbl_photos, and the
// browser is refused every one of these unless is_site_owner() passes. The route gate in
// App.tsx is cosmetic; RLS is the boundary.
//
// The queue read deliberately does NOT go through the cached public fetchers. It needs every
// row including the unapproved backlog, and it must be fresh after each edit rather than served
// from the 20s bulk cache. The owner's `for all using (is_site_owner())` policy ORs with the
// public `using (approved)` one, so this returns all rows for the owner (and, harmlessly, only
// approved rows for anyone else who called it).

/** A fan photo as the curator sees it: the public shape plus the review-only columns. */
export interface WpblFanPhotoRow extends WpblFanPhoto {
  approved: boolean
  contributor_id: string | null
  created_at: string
}

export async function fetchWpblFanPhotoQueue(): Promise<{
  photos: WpblFanPhotoRow[]; subjects: WpblPhotoSubject[]; figures: WpblPhotoFigure[]
}> {
  // All three read FRESH, not through the cached public fetchers: an approve or a new tag has to
  // show on the next reload, and the bulk cache would serve the pre-edit set for its whole window.
  const [photos, subjects, figures] = await Promise.all([
    safe<WpblFanPhotoRow[]>('fetchWpblFanPhotoQueue', () =>
      supabase.from('wpbl_fan_photos')
        // Unreviewed first (approved ascending puts false before true), then the curated order.
        .select(`${FAN_PHOTO_COLUMNS},approved,contributor_id,created_at`)
        .order('approved', { ascending: true })
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true }) as unknown as
        PromiseLike<{ data: WpblFanPhotoRow[] | null; error: unknown }>, []),
    safe<WpblPhotoSubject[]>('fetchWpblFanPhotoQueueSubjects', () =>
      supabase.from('wpbl_photo_subjects').select('id,photo_id,player_id,figure_key') as unknown as
        PromiseLike<{ data: WpblPhotoSubject[] | null; error: unknown }>, []),
    safe<WpblPhotoFigure[]>('fetchWpblFanPhotoQueueFigures', () =>
      supabase.from('wpbl_photo_figures').select('key,name,kind,blurb,team_id').order('name') as unknown as
        PromiseLike<{ data: WpblPhotoFigure[] | null; error: unknown }>, []),
  ])
  return { photos, subjects, figures }
}

/** True on success. Every one of these logs and returns false rather than throwing, so a
 *  single failed edit leaves the rest of the queue usable. */
async function ownerWrite(label: string, run: () => PromiseLike<{ error: unknown }>): Promise<boolean> {
  try {
    const { error } = await run()
    if (error) { console.error(`${label}:`, error); return false }
    return true
  } catch (e) {
    console.error(`${label}:`, e)
    return false
  }
}

export function setFanPhotoApproved(id: string, approved: boolean): Promise<boolean> {
  return ownerWrite('setFanPhotoApproved', () =>
    supabase.from('wpbl_fan_photos').update({ approved, updated_at: new Date().toISOString() }).eq('id', id))
}

/** Patch the curator-owned fields. Only the keys passed are written, so this never clobbers a
 *  field it was not asked to touch. */
export function updateFanPhoto(id: string, patch: {
  caption?: string | null; taken_on?: string | null; game_id?: string | null; sort_order?: number | null
}): Promise<boolean> {
  return ownerWrite('updateFanPhoto', () =>
    supabase.from('wpbl_fan_photos').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id))
}

/** Tag a subject, returning the new row (for optimistic UI) or null on failure. Exactly one of
 *  playerId / figureKey is passed; the table's check constraint enforces that, and the unique
 *  index rejects a repeat tag (which the UI avoids by not offering an already-tagged subject).
 *  `.insert().select()` is safe here because the owner's RLS policy also grants the select. */
export async function addFanPhotoSubject(
  photoId: string, subject: { playerId: string } | { figureKey: string },
): Promise<WpblPhotoSubject | null> {
  const row = 'playerId' in subject
    ? { photo_id: photoId, player_id: subject.playerId, figure_key: null }
    : { photo_id: photoId, player_id: null, figure_key: subject.figureKey }
  try {
    const { data, error } = await supabase.from('wpbl_photo_subjects')
      .insert(row).select('id,photo_id,player_id,figure_key').single()
    if (error) { console.error('addFanPhotoSubject:', error); return null }
    return data as WpblPhotoSubject
  } catch (e) {
    console.error('addFanPhotoSubject:', e)
    return null
  }
}

export function removeFanPhotoSubject(id: string): Promise<boolean> {
  return ownerWrite('removeFanPhotoSubject', () =>
    supabase.from('wpbl_photo_subjects').delete().eq('id', id))
}

/** Create or update a non-player figure (a mascot, manager, coach, ...). Keyed on `key`, so a
 *  re-save edits rather than duplicates. */
export function upsertFanPhotoFigure(fig: WpblPhotoFigure): Promise<boolean> {
  return ownerWrite('upsertFanPhotoFigure', () =>
    supabase.from('wpbl_photo_figures').upsert(fig, { onConflict: 'key' }))
}

// ─── The web upload path (owner, from the browser) ───────────────────────────────────────
//
// The CLI ingest still exists for a laptop and a big drop folder; this is the from-anywhere
// path. The bytes go to R2 through the owner-gated /api/fan-photo function (the browser cannot
// hold R2 keys); the row is written HERE, through the same is_site_owner() RLS as the curation
// edits, so there is no second writer to reason about.

/** Does a photo with these original bytes already exist? Returns its id and approval, or null.
 *  This is the real-time duplicate check the upload UI runs the moment a file is picked, so the
 *  same shot is never uploaded twice. Owner-only read (the queue RLS returns the unapproved
 *  backlog to is_site_owner()). */
export async function findFanPhotoBySha(sha256: string): Promise<{ id: string; approved: boolean } | null> {
  try {
    const { data, error } = await supabase.from('wpbl_fan_photos')
      .select('id,approved').eq('sha256', sha256).maybeSingle()
    if (error) { console.error('findFanPhotoBySha:', error); return null }
    return data ?? null
  } catch (e) {
    console.error('findFanPhotoBySha:', e)
    return null
  }
}

/** Insert a fan photo row after its renders are in R2. Returns the new id, or null on failure.
 *  Lands `approved = false` by the column default: an uploaded photo is still just a queue
 *  entry until it is tagged and published. */
export async function insertFanPhoto(row: {
  sha256: string; storage_path: string; card_url: string; full_url: string
  width: number | null; height: number | null; credit: string | null; contributor_id: string | null
}): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('wpbl_fan_photos').insert(row).select('id').single()
    if (error) { console.error('insertFanPhoto:', error); return null }
    return data.id as string
  } catch (e) {
    console.error('insertFanPhoto:', e)
    return null
  }
}

/** The contributors already on file, for the upload panel's picker. Owner-only table. */
export async function fetchFanPhotoContributors(): Promise<WpblPhotoContributor[]> {
  return safe<WpblPhotoContributor[]>('fetchFanPhotoContributors', () =>
    supabase.from('wpbl_photo_contributors')
      .select('id,display_name,contact,permission_granted_on,permission_evidence,permission_scope,withdrawn_on')
      .order('display_name') as unknown as
      PromiseLike<{ data: WpblPhotoContributor[] | null; error: unknown }>, [])
}

/** Create a contributor (the permission record), returning the new id. */
export async function createFanPhotoContributor(
  rec: Omit<WpblPhotoContributor, 'id' | 'withdrawn_on'>,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('wpbl_photo_contributors').insert(rec).select('id').single()
    if (error) { console.error('createFanPhotoContributor:', error); return null }
    return data.id as string
  } catch (e) {
    console.error('createFanPhotoContributor:', e)
    return null
  }
}

// Existing box-score lines for one game (for editing / display).
export async function fetchWpblGameLines(gameId: string): Promise<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[]; fielding: WpblFieldingLine[] }> {
  const [batting, pitching, fielding] = await Promise.all([
    safe('fetchWpblBatting', () =>
      supabase.from('wpbl_batting_lines').select('*').eq('game_id', gameId).order('batting_order', { ascending: true }),
      [] as WpblBattingLine[]),
    safe('fetchWpblPitching', () =>
      supabase.from('wpbl_pitching_lines').select('*').eq('game_id', gameId).order('created_at', { ascending: true }),
      [] as WpblPitchingLine[]),
    safe('fetchWpblFielding', () =>
      supabase.from('wpbl_fielding_lines').select('*').eq('game_id', gameId),
      [] as WpblFieldingLine[]),
  ])
  return { batting, pitching, fielding }
}

// Lineup history for one team: which slot and position each player filled, game by game.
//
// Reads the wpbl_lineup_history view rather than wpbl_batting_lines, because "did they start
// or come in later?" can only be answered by cross-referencing play sequence, and that join
// belongs in the database next to the rule it implements (see the view's migration).
//
// Deliberately narrow: the grid needs slot, position and started (not the stat line), so
// the columns are listed rather than select('*'). One team's season is a few hundred rows.
function readWpblLineupHistory(teamId: string): Promise<WpblLineupHistoryRow[]> {
  return safe('fetchWpblLineupHistory', () =>
    supabase.from('wpbl_lineup_history')
      .select('game_id,team_id,player_id,game_date,game_status,opponent_team_id,opp_starter_name,opp_starter_throws,lineup_spot,position,started,slot_shared')
      .eq('team_id', teamId)
      .order('game_date', { ascending: false })
      .order('lineup_spot', { ascending: true }),
    [] as WpblLineupHistoryRow[])
}

// Pitcher usage for one team: every appearance, with rest days already computed.
//
// days_rest comes from the view rather than being derived here: the gap that matters is
// between a pitcher's own consecutive outings, which is a window function over their whole
// appearance history, not something the client can see from one team's recent games.
function readWpblPitchingUsage(teamId: string): Promise<WpblPitchingUsageRow[]> {
  return safe('fetchWpblPitchingUsage', () =>
    supabase.from('wpbl_pitching_usage')
      .select('game_id,team_id,player_id,game_date,game_status,opponent_team_id,started,outs,pitches,bf,er,so,bb,decision,days_rest')
      .eq('team_id', teamId)
      .order('game_date', { ascending: false }),
    [] as WpblPitchingUsageRow[])
}

// ─── Play corrections ─────────────────────────────────────────────────────────
//
// The league's scoring has errors: batters credited to the wrong player, plate appearances
// missing entirely. They are not reachable to fix it at source, so we keep our own
// corrections and lay them over the mirror on the way out.
//
// This CANNOT be done by editing wpbl_game_plays. That table is a mirror and wpbl-ingest
// deletes and reinserts every play for a game on each pass, so an edit written into it
// survives until the next cron tick and then disappears without trace.
//
// Values arrive as text because one table serves fields of several types; see the migration
// for why that beats a jsonb blob. Casting happens here, once, rather than at each call site.
const CORRECTABLE_NUMBER = new Set(['runs_scored'])
const CORRECTABLE_BOOLEAN = new Set(['is_hit', 'is_scoring_play'])

function castCorrection(field: string, value: string | null): unknown {
  if (value === null) return null
  if (CORRECTABLE_NUMBER.has(field)) return Number(value)
  if (CORRECTABLE_BOOLEAN.has(field)) return value === 'true' || value === '1'
  return value
}

interface WpblPlayCorrection {
  game_id: string; sequence: number; field: string; new_value: string | null
  /** How we know. Carried onto the play so a surface can say where an account came from; see
   *  `corrected_source` on WpblGamePlay for the reader-facing reason it has to. */
  source: WpblCorrectionSource | null
}

/** Best evidence first, matching the order docs/PLAY_VALIDATION.md sets out: somebody watched
 *  it, then a rule concluded it, then a second transcription agreed, then the league's own box
 *  score contradicted its own play log. */
const SOURCE_RANK: readonly WpblCorrectionSource[] = ['video', 'derived', 'external', 'league']
const strongestSource = (all: WpblCorrectionSource[]): WpblCorrectionSource =>
  all.reduce((best, s) => (SOURCE_RANK.indexOf(s) < SOURCE_RANK.indexOf(best) ? s : best), all[0])

/** Overlay corrections onto plays, matched on (game_id, sequence), which is the feed's own
 *  identifier for a play. Never the play's uuid, which wpbl-ingest regenerates on every
 *  reinsert and so identifies a row only for minutes.
 *
 *  `sequence` restarts at 1 in every game, so game_id is load-bearing and not belt-and-braces:
 *  the Hall of Firsts hands this the whole season at once, and on a sequence-only match one
 *  game's correction would rewrite the same-numbered play in every game. */
export function applyPlayCorrections<T extends { game_id: string; sequence: number }>(
  plays: T[], corrections: WpblPlayCorrection[],
): T[] {
  if (corrections.length === 0) return plays
  const key = (gameId: string, sequence: number) => `${gameId}:${sequence}`
  const byPlay = new Map<string, WpblPlayCorrection[]>()
  for (const c of corrections) {
    const k = key(c.game_id, c.sequence)
    const list = byPlay.get(k)
    if (list) list.push(c); else byPlay.set(k, [c])
  }
  return plays.map(play => {
    const fixes = byPlay.get(key(play.game_id, play.sequence))
    if (!fixes) return play
    const next = { ...play } as Record<string, unknown>
    for (const f of fixes) next[f.field] = castCorrection(f.field, f.new_value)
    // STAMPED ON THE PLAY, NOT STORED ANYWHERE. The mirror row is always the feed's own; this
    // says only that what the caller is now holding is not. Where a play carries corrections
    // from more than one source, the strongest wins: a reader shown one provenance should be
    // shown the best evidence behind the row rather than whichever correction was written last.
    const source = fixes.map(f => f.source).filter(Boolean) as WpblCorrectionSource[]
    if (source.length) next.corrected_source = strongestSource(source)
    return next as T
  })
}

const CORRECTION_SELECT = 'game_id,sequence,field,new_value,source'

function fetchPlayCorrections(gameId: string): Promise<WpblPlayCorrection[]> {
  return safe('fetchPlayCorrections', () =>
    supabase.from('wpbl_play_corrections').select(CORRECTION_SELECT).eq('game_id', gameId),
    [] as WpblPlayCorrection[])
}

/** Every correction in the league. The table holds one row per corrected field and is expected
 *  to stay in the dozens, so the season-wide reads take the lot rather than paging it. */
function fetchAllPlayCorrections(): Promise<WpblPlayCorrection[]> {
  return safe('fetchAllPlayCorrections', () =>
    supabase.from('wpbl_play_corrections').select(CORRECTION_SELECT),
    [] as WpblPlayCorrection[])
}

// The official-feed play-by-play for one game, in order, with our corrections laid over it.
// Full rows, because the Game Center renders every pitch of every at-bat and so genuinely
// needs `pitch_events`.
export async function fetchWpblGamePlays(gameId: string): Promise<WpblGamePlay[]> {
  // Both reads go out together: the corrections table is tiny and usually empty, so making it
  // wait on the plays would add a round trip to every game anyone opens.
  const [plays, corrections] = await Promise.all([
    safe('fetchWpblGamePlays', () =>
      supabase.from('wpbl_game_plays').select('*').eq('game_id', gameId).order('sequence', { ascending: true }),
      [] as WpblGamePlay[]),
    fetchPlayCorrections(gameId),
  ])
  const corrected = applyPlayCorrections(plays, corrections)
  return readOverlay ? readOverlay.plays(gameId, corrected) : corrected
}

// The same game's plays, projected to what buildRecap reads (see WpblRecapPlay), so Home's
// Last Game card does not pull ~80 KB of pitch-by-pitch JSON on the landing view to answer
// whether anyone hit back-to-back home runs. Game Center still takes the full rows when a
// reader actually opens a game.
export async function fetchWpblGameRecapPlays(gameId: string): Promise<WpblRecapPlay[]> {
  const [plays, corrections] = await Promise.all([
    safe<WpblRecapPlay[]>('fetchWpblGameRecapPlays', () =>
      supabase.from('wpbl_game_plays')
        .select('game_id,sequence,inning,team_id,event_type,narrative')
        .eq('game_id', gameId)
        .order('sequence', { ascending: true }) as unknown as
        PromiseLike<{ data: WpblRecapPlay[] | null; error: unknown }>,
      []),
    fetchPlayCorrections(gameId),
  ])
  return applyPlayCorrections(plays, corrections)
}

// The transcribed extras for one game: first pitch, duration, crew, weather. Absent for any
// game RetroWPBL has not written up yet, which is the recent ones, so this resolves to null
// rather than erroring and every caller renders nothing at all in that case.
export function fetchWpblGameDetails(gameId: string): Promise<WpblGameDetails | null> {
  return safe('fetchWpblGameDetails', () =>
    supabase.from('wpbl_game_details').select('*').eq('game_id', gameId).maybeSingle(),
    null as WpblGameDetails | null)
}

/** What the league changed about this game after it was final, newest first.
 *
 *  Written once per detected revision by scripts/check-wpbl-drift.mjs, at the only moment both
 *  versions of the scoring exist. Nothing regenerates it, so an empty answer means "we have not
 *  caught a revision to this game", never "this game was never revised": the table only holds
 *  revisions caught since it started recording, and many earlier ones never were.
 *  `wpbl_games.source_updated_at` is still the one that says a game was revised at all. */
export function fetchWpblGameRevisions(gameId: string): Promise<WpblGameRevision[]> {
  return safe('fetchWpblGameRevisions', () =>
    supabase.from('wpbl_game_revisions').select('*').eq('game_id', gameId)
      .order('detected_at', { ascending: false }),
    [] as WpblGameRevision[])
}

// TrackMan pitch/hit tracking for one game (chronological).
export function fetchWpblGameTracking(gameId: string): Promise<WpblPitchTracking[]> {
  return safe('fetchWpblGameTracking', () =>
    supabase.from('wpbl_pitch_tracking').select('*').eq('game_id', gameId).order('occurred_at', { ascending: true }),
    [] as WpblPitchTracking[])
}

// All of a player's box-score lines across every game (for the player page).
async function readWpblPlayerLines(playerId: string): Promise<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[]; fielding: WpblFieldingLine[] }> {
  const [batting, pitching, fielding] = await Promise.all([
    safe('fetchWpblPlayerBatting', () =>
      supabase.from('wpbl_batting_lines').select('*').eq('player_id', playerId),
      [] as WpblBattingLine[]),
    safe('fetchWpblPlayerPitching', () =>
      supabase.from('wpbl_pitching_lines').select('*').eq('player_id', playerId),
      [] as WpblPitchingLine[]),
    safe('fetchWpblPlayerFielding', () =>
      supabase.from('wpbl_fielding_lines').select('*').eq('player_id', playerId),
      [] as WpblFieldingLine[]),
  ])
  return { batting, pitching, fielding }
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

// Standings derived from final games (not stored). Which games those are, and the order they
// were played in, is `standingsFinals` in season.ts: one definition, for the reason written
// beside it there.

// `countsInStandings` lives in season.ts, which imports nothing but types. The predicate is
// needed by stats.ts, which is bundled into the Cloudflare Pages Functions behind the OG cards
// and the Discord /player command; importing it from here would drag the whole supabase client
// into those. Re-exported so every existing importer keeps working and there is still exactly
// one definition of "counts toward the season".
export { regularSeasonLines, excludedGameIds } from './season'
export { standingsFinals, standingsStartMin } from './season'
export { countsInStandings }
export { gameIsOver, settleGame, settleGames } from './gameOver'

export function computeStandings(teams: WpblTeam[], games: WpblGame[]): WpblStandingRow[] {
  const acc = new Map<string, { team: WpblTeam; wins: number; losses: number; runsFor: number; runsAgainst: number }>()
  for (const team of teams) acc.set(team.id, { team, wins: 0, losses: 0, runsFor: 0, runsAgainst: 0 })

  const finals = standingsFinals(games)

  const history = new Map<string, ('W' | 'L')[]>(teams.map(t => [t.id, []]))
  const h2h = new Map<string, number>() // `${winnerId}|${loserId}` → head-to-head win count
  for (const g of finals) {
    const home = acc.get(g.home_team_id), away = acc.get(g.away_team_id)
    if (!home || !away) continue
    home.runsFor += g.home_score!; home.runsAgainst += g.away_score!
    away.runsFor += g.away_score!; away.runsAgainst += g.home_score!
    const homeWon = g.home_score! > g.away_score!
    const winner = homeWon ? g.home_team_id : g.away_team_id
    const loser  = homeWon ? g.away_team_id : g.home_team_id
    acc.get(winner)!.wins++; acc.get(loser)!.losses++
    history.get(winner)!.push('W'); history.get(loser)!.push('L')
    h2h.set(`${winner}|${loser}`, (h2h.get(`${winner}|${loser}`) ?? 0) + 1)
  }

  const rows: WpblStandingRow[] = [...acc.values()].map(r => {
    const played = r.wins + r.losses
    const hist = history.get(r.team.id) ?? []
    let streak: WpblStandingRow['streak'] = null
    if (hist.length) {
      const type = hist[hist.length - 1]
      let count = 0
      for (let i = hist.length - 1; i >= 0 && hist[i] === type; i--) count++
      streak = { type, count }
    }
    const last = hist.slice(-10)
    return {
      ...r,
      pct: played ? r.wins / played : 0,
      gamesBack: 0, // set after sort, relative to the leader
      streak,
      lastTen: { wins: last.filter(x => x === 'W').length, losses: last.filter(x => x === 'L').length },
      recent: hist.slice(-5),
    }
  })

  // Win% desc, then head-to-head between the two teams, then run differential.
  const overCount = (a: string, b: string) => h2h.get(`${a}|${b}`) ?? 0
  rows.sort((a, b) =>
    b.pct !== a.pct ? b.pct - a.pct
    : overCount(b.team.id, a.team.id) !== overCount(a.team.id, b.team.id)
      ? overCount(b.team.id, a.team.id) - overCount(a.team.id, b.team.id)
      : (b.runsFor - b.runsAgainst) - (a.runsFor - a.runsAgainst))

  // Games back from the leader (first row after sorting).
  const leader = rows[0]
  if (leader) for (const r of rows) {
    r.gamesBack = ((leader.wins - r.wins) + (r.losses - leader.losses)) / 2
  }
  return rows
}

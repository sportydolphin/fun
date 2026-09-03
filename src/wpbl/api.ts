import { supabase } from '../lib/supabase'
import { FIRSTS_EVENT_TYPES } from './firsts'
import { countsInStandings } from './season'
import type {
  WpblTeam, WpblPlayer, WpblGame, WpblStandingRow,
  WpblBattingLine, WpblPitchingLine,
  WpblFieldingLine, WpblGamePlay, WpblFirstsPlay, WpblRecapPlay, WpblPitchPlay, WpblRunValuePlay,
  WpblPitchTracking, WpblTrackRow,
  WpblVideo, WpblArticle, WpblPhoto, WpblLineupHistoryRow, WpblPitchingUsageRow,
  WpblGameDetails,
} from './types'

// Reads for the WPBL section. Everything degrades gracefully: if the tables don't
// exist yet (pre-migration) or a request fails, we log and return an empty result so
// the section renders an empty shell instead of throwing. Same tolerance the rest of
// the app uses for not-yet-migrated features.

// Upper bound on any single read. If the database stalls (the failure mode behind the
// old infinite spinner), the read resolves to its fallback instead of hanging forever;
// the section then shows its empty state and the next poll refills it once the DB
// recovers. Generous enough that a healthy request never trips it.
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
// schedule poll can overlap a focus-refresh) — without this each fires its own DB query.
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

export function fetchWpblTeams(): Promise<WpblTeam[]> {
  return once('teams', () => safe('fetchWpblTeams', () =>
    supabase.from('wpbl_teams').select('*').order('sort_order', { ascending: true }),
    [] as WpblTeam[]))
}

// The feed occasionally emits a phantom `scheduled` duplicate of a game it already
// reported final (same date + matchup, different api_game_id). Drop the not-yet-played
// copy when a played one exists for the same matchup-day; genuine doubleheaders (two
// played, or two upcoming) are left untouched.
//
// The wpbl-ingest function now suppresses these server-side too (deletes the phantom row
// from the mirror), so on a healthy DB this filter is a no-op. It's kept as a cheap
// fallback for the window before a re-ingest clears an already-stored phantom.
function dedupeSchedule(games: WpblGame[]): WpblGame[] {
  const played = (g: WpblGame) => g.status === 'final' || g.status === 'live'
  const hasPlayed = new Set<string>()
  for (const g of games) if (played(g)) hasPlayed.add(`${g.game_date}|${g.away_team_id}|${g.home_team_id}`)
  return games.filter(g => played(g) || !hasPlayed.has(`${g.game_date}|${g.away_team_id}|${g.home_team_id}`))
}

export function fetchWpblSchedule(): Promise<WpblGame[]> {
  return once('schedule', async () => {
    const games = await safe('fetchWpblSchedule', () =>
      supabase.from('wpbl_games').select('*').order('game_date', { ascending: true }),
      [] as WpblGame[])
    return dedupeSchedule(games)
  })
}

// How often the live views re-read a game in progress.
//
// This is a FALLBACK, not the delivery mechanism. Both live surfaces also hold a Supabase
// Realtime subscription on the row (Live.tsx) or on the plays and batting lines feeding it
// (GameDetail.tsx), and those push within a second of the write. The poll exists for the case
// where a subscription drops silently, which websockets do.
//
// It was 5s, which bought nothing: it cannot beat Realtime to a change, so all it did was ask
// three times as often for an answer that was already on screen. Over a three-hour game that
// is 2,160 requests per viewer per surface instead of 720. Raise it further and a dropped
// subscription starts to show; lower it and you are paying for latency Realtime already gave
// you for free.
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
  return safe('fetchWpblGameLive', () =>
    supabase.from('wpbl_games').select(LIVE_GAME_COLUMNS).eq('id', gameId).maybeSingle(),
    null as Partial<WpblGame> | null)
}

export function fetchWpblRoster(teamId: string): Promise<WpblPlayer[]> {
  return safe('fetchWpblRoster', () =>
    supabase.from('wpbl_players').select('*').eq('team_id', teamId).order('name', { ascending: true }),
    [] as WpblPlayer[])
}

// ─── Session cache for the shared bulk reads ────────────────────────────────────
// The Stats and Home tabs both pull the full player roster and box-score lines, and
// SwipeableViews unmounts a tab when you swipe away — so without a cache each return
// re-queried the DB and flashed the tab's loading spinner (the "full reload"). Keep
// the last successful result so a remount repaints instantly, with a timestamp so a
// caller can still revalidate once it's stale (box scores change as games are played).
export type WpblLinesResult = { batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }
let allPlayersCache:  { data: WpblPlayer[]; at: number } | null = null
let allLinesCache:    { data: WpblLinesResult; at: number } | null = null
let allTrackingCache: { data: WpblTrackRow[]; at: number } | null = null
let allPlaysCache:    { data: WpblFirstsPlay[]; at: number } | null = null
let allPitchPlaysCache: { data: WpblPitchPlay[]; at: number } | null = null
let allRunValuePlaysCache: { data: WpblRunValuePlay[]; at: number } | null = null
let allVideosCache:   { data: WpblVideo[]; at: number } | null = null
let allArticlesCache: { data: WpblArticle[]; at: number } | null = null
let allPhotosCache:   { data: WpblPhoto[]; at: number } | null = null

// How long a bulk result is served straight from the cache without re-querying.
//
// `once()` above collapses reads that overlap in time; this collapses reads that merely
// land close together, which on a cold load is most of them. Five components ask for these
// same league-wide datasets independently — Home's leaders, GamePreview's "next game" card,
// StatsView, TeamPage, TrackingView — and only some of them gated on their own staleness
// helper, so a single load re-pulled the full roster and every box-score line two or three
// times, hundreds of milliseconds apart. That is what a session cache is for; the callers
// should not each have to remember to check it.
//
// Kept comfortably below the 30s window Home's own gate uses, so nothing that revalidates
// on a schedule (the live-game poll runs at 60s) gets held back — this only absorbs the
// fan-out within one page load or one quick tab switch.
const BULK_FRESH_MS = 20_000

const isFresh = (c: { at: number } | null): boolean => !!c && Date.now() - c.at < BULK_FRESH_MS

export function getCachedWpblAllPlayers(): WpblPlayer[] | null { return allPlayersCache?.data ?? null }
export function getCachedWpblAllLines(): WpblLinesResult | null { return allLinesCache?.data ?? null }
export function getCachedWpblAllTracking(): WpblTrackRow[] | null { return allTrackingCache?.data ?? null }
export function getCachedWpblAllPlays(): WpblFirstsPlay[] | null { return allPlaysCache?.data ?? null }
export function getCachedWpblAllPitchPlays(): WpblPitchPlay[] | null { return allPitchPlaysCache?.data ?? null }
export function getCachedWpblAllRunValuePlays(): WpblRunValuePlay[] | null { return allRunValuePlaysCache?.data ?? null }
export function getCachedWpblVideos(): WpblVideo[] | null { return allVideosCache?.data ?? null }
export function getCachedWpblArticles(): WpblArticle[] | null { return allArticlesCache?.data ?? null }
export function getCachedWpblPhotos(): WpblPhoto[] | null { return allPhotosCache?.data ?? null }

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

/** Age (ms) of the full set the Home tab reads (players+lines+plays+tracking); Infinity until all seeded. */
export function wpblHomeCacheAgeMs(): number {
  if (!allPlayersCache || !allLinesCache || !allTrackingCache || !allPlaysCache) return Infinity
  return Date.now() - Math.min(allPlayersCache.at, allLinesCache.at, allTrackingCache.at, allPlaysCache.at)
}

// Every player in the league (all four rosters). Used to attach names/teams to the
// aggregated league-leader rows on the home view.
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
// dominate the row size but the firsts computation never uses — so this scans the whole
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
// first strikeout, first stolen base, …). The heaviest WPBL read — one row per play for the
// whole season — so it is column-projected, filtered server-side, and cached last-good so
// the Home tab repaints on a swipe-back without re-pulling it. Empty pre-migration.
//
// Paginated, and this is not optional. PostgREST caps an unbounded select at 1000 rows and
// returns them in no defined order, so before this the season scan silently stopped at that
// cap — `wpbl_game_plays` passed it mid-season — and the rows that came back were an
// arbitrary slice. computeFirsts sorts what it is handed and takes the earliest match, so a
// dropped opening-day play did not just omit a milestone, it reassigned it to whoever did it
// next. The explicit order also makes the paging deterministic: without it, PostgREST can
// return the same row on two pages and miss another entirely.
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
 *  rows with no error, and the play log passed that mid-season. A truncated read here does not
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
 * PostgREST silently caps a bare `select` at 1000 rows — no error, just a short array — so
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

// Every box-score line in the league — for computing season league leaders. Paged, because
// a truncated read here doesn't fail, it just makes every league-wide rate quietly wrong:
// OPS+ and ERA+ derive their league baseline from these rows. Returns empty (no leaders)
// until games start being entered.
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
 * ambiguous, and the first version of this asked `batting.length > 0 || pitching.length > 0`,
 * i.e. "cache the pair unless BOTH failed". The two reads run in parallel and fail
 * independently, so a run where only the batting read came up short cached a league with no
 * batting at all: the Team stats card said "team stats appear once games are played" for a club
 * that had played thirteen, and the spec chart drew four confident 50s across Power, Contact,
 * Eye and Speed (the honest answer to "how far above an average of nothing") beside completely
 * correct Arms and Glove. It looked finished and was half fiction. Seen on Sep 3, 2026.
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
// needs (see WpblTrackRow) — the raw-payload sub-fields are projected server-side so we
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
      supabase.from('wpbl_pitch_tracking').select(TRACK_SELECT).range(from, from + PAGE - 1) as unknown as
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

// The league's mirrored YouTube uploads, newest first — for the Home highlights rail and
// the per-game recap card. Small table (the feed carries ~15 uploads), so this is one cheap
// read cached last-good: the rail repaints on a swipe-back without re-querying, and the
// GameDetail recap reads the same cache instead of its own request. Empty pre-migration.
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

// Lineup history for one team — which slot and position each player filled, game by game.
//
// Reads the wpbl_lineup_history view rather than wpbl_batting_lines, because "did they start
// or come in later?" can only be answered by cross-referencing play sequence, and that join
// belongs in the database next to the rule it implements (see the view's migration).
//
// Deliberately narrow: the grid needs slot, position and started — not the stat line — so
// the columns are listed rather than select('*'). One team's season is a few hundred rows.
export function fetchWpblLineupHistory(teamId: string): Promise<WpblLineupHistoryRow[]> {
  return safe('fetchWpblLineupHistory', () =>
    supabase.from('wpbl_lineup_history')
      .select('game_id,team_id,player_id,game_date,game_status,opponent_team_id,opp_starter_name,opp_starter_throws,lineup_spot,position,started,slot_shared')
      .eq('team_id', teamId)
      .order('game_date', { ascending: false })
      .order('lineup_spot', { ascending: true }),
    [] as WpblLineupHistoryRow[])
}

// Pitcher usage for one team — every appearance, with rest days already computed.
//
// days_rest comes from the view rather than being derived here: the gap that matters is
// between a pitcher's own consecutive outings, which is a window function over their whole
// appearance history, not something the client can see from one team's recent games.
export function fetchWpblPitchingUsage(teamId: string): Promise<WpblPitchingUsageRow[]> {
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

interface WpblPlayCorrection { game_id: string; sequence: number; field: string; new_value: string | null }

/** Overlay corrections onto plays, matched on (game_id, sequence), which is the feed's own
 *  identifier for a play. Never the play's uuid, which wpbl-ingest regenerates on every
 *  reinsert and so identifies a row only for minutes.
 *
 *  `sequence` restarts at 1 in every game, so game_id is load-bearing and not belt-and-braces:
 *  the Hall of Firsts hands this the whole season at once, and on a sequence-only match one
 *  game's correction would rewrite the same-numbered play in all 28 of them. */
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
    return next as T
  })
}

const CORRECTION_SELECT = 'game_id,sequence,field,new_value'

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
  return applyPlayCorrections(plays, corrections)
}

// The same game's plays, projected to what buildRecap reads (see WpblRecapPlay).
//
// Home's "Last Game" card was calling fetchWpblGamePlays for this: ~80 KB of pitch-by-pitch
// JSON, on the landing view, to answer whether anyone hit back-to-back home runs. The Game
// Center still takes the full rows when a reader actually opens a game.
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

// TrackMan pitch/hit tracking for one game (chronological).
// The transcribed extras for one game: first pitch, duration, crew, weather. Absent for any
// game RetroWPBL has not written up yet, which is the recent ones, so this resolves to null
// rather than erroring and every caller renders nothing at all in that case.
export function fetchWpblGameDetails(gameId: string): Promise<WpblGameDetails | null> {
  return safe('fetchWpblGameDetails', () =>
    supabase.from('wpbl_game_details').select('*').eq('game_id', gameId).maybeSingle(),
    null as WpblGameDetails | null)
}

export function fetchWpblGameTracking(gameId: string): Promise<WpblPitchTracking[]> {
  return safe('fetchWpblGameTracking', () =>
    supabase.from('wpbl_pitch_tracking').select('*').eq('game_id', gameId).order('occurred_at', { ascending: true }),
    [] as WpblPitchTracking[])
}

// All of a player's box-score lines across every game (for the player page).
export async function fetchWpblPlayerLines(playerId: string): Promise<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[]; fielding: WpblFieldingLine[] }> {
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
// keyed on the feed's player id, and the feed mints a new id per club — so reading only
// `api_id` would show a traded pitcher's work for her new team and silently nothing before
// it, which looks exactly like a pitcher who has not thrown much rather than like a bug.
// Paginated past PostgREST's 1000-row default so it holds up as the season fills in.
export async function fetchWpblPitcherLocations(apiIds: string | string[] | null): Promise<WpblPitchLoc[]> {
  const ids = (typeof apiIds === 'string' ? [apiIds] : apiIds ?? []).filter(Boolean)
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

// Standings derived from final games (not stored). A game counts only once both a
// status of 'final' and both scores are present.
// "6:30 PM" wall clock → minutes since midnight (blank/unparseable sorts first), so
// same-day games order by start time when deriving streaks / last-10.
function standingsStartMin(t: string | null | undefined): number {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec((t ?? '').trim())
  if (!m) return 0
  let h = Number(m[1]) % 12
  if (/pm/i.test(m[3])) h += 12
  return h * 60 + Number(m[2])
}

// `countsInStandings` lives in season.ts now, which imports nothing but types. The predicate
// is needed by stats.ts, which is bundled into the Cloudflare Pages Functions behind the OG
// cards and the Discord /player command; importing it from here would drag the whole supabase
// client into those. Re-exported so every existing importer keeps working and there is still
// exactly one definition of "counts toward the season".
export { regularSeasonLines, excludedGameIds } from './season'
export { countsInStandings }

export function computeStandings(teams: WpblTeam[], games: WpblGame[]): WpblStandingRow[] {
  const acc = new Map<string, { team: WpblTeam; wins: number; losses: number; runsFor: number; runsAgainst: number }>()
  for (const team of teams) acc.set(team.id, { team, wins: 0, losses: 0, runsFor: 0, runsAgainst: 0 })

  // Decisive REGULAR-SEASON final games, chronological (date then start time) so streak /
  // last-10 read in true order and head-to-head is accumulated as played.
  const finals = games
    .filter(g => g.status === 'final' && g.home_score != null && g.away_score != null && g.home_score !== g.away_score)
    .filter(countsInStandings)
    .sort((a, b) => a.game_date !== b.game_date
      ? (a.game_date < b.game_date ? -1 : 1)
      : standingsStartMin(a.start_time) - standingsStartMin(b.start_time))

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

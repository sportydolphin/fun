import { supabase } from '../lib/supabase'
import type {
  WpblTeam, WpblPlayer, WpblGame, WpblStandingRow,
  WpblBattingLine, WpblPitchingLine,
  WpblFieldingLine, WpblGamePlay, WpblFirstsPlay, WpblPitchTracking, WpblTrackRow,
  WpblVideo,
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
// only dedupes genuine overlap and never hands a later, deliberately-fresh call stale data
// (the result caches + per-caller staleness gating handle revalidation separately).
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

// One game's current row — used by the live views to poll fresh score + live_state.
export async function fetchWpblGame(gameId: string): Promise<WpblGame | null> {
  return safe('fetchWpblGame', () =>
    supabase.from('wpbl_games').select('*').eq('id', gameId).maybeSingle(),
    null as WpblGame | null)
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
let allVideosCache:   { data: WpblVideo[]; at: number } | null = null

export function getCachedWpblAllPlayers(): WpblPlayer[] | null { return allPlayersCache?.data ?? null }
export function getCachedWpblAllLines(): WpblLinesResult | null { return allLinesCache?.data ?? null }
export function getCachedWpblAllTracking(): WpblTrackRow[] | null { return allTrackingCache?.data ?? null }
export function getCachedWpblAllPlays(): WpblFirstsPlay[] | null { return allPlaysCache?.data ?? null }
export function getCachedWpblVideos(): WpblVideo[] | null { return allVideosCache?.data ?? null }

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

// Every play-by-play row in the league — for the Hall of Firsts (first HR, first
// strikeout, first stolen base, etc.). The heaviest WPBL read (one row per play, all
// season), so it's both column-projected and cached last-good, letting the Home tab
// repaint on a swipe-back without re-pulling it. Empty pre-migration.
export function fetchWpblAllPlays(): Promise<WpblFirstsPlay[]> {
  return once('allPlays', async () => {
    const data = await safe<WpblFirstsPlay[]>('fetchWpblAllPlays', () =>
      supabase.from('wpbl_game_plays').select(FIRSTS_PLAY_SELECT) as unknown as
        PromiseLike<{ data: WpblFirstsPlay[] | null; error: unknown }>,
      [])
    if (data.length > 0 || allPlaysCache == null) allPlaysCache = { data, at: Date.now() }
    return data
  })
}

// Every box-score line in the league — for computing season league leaders. Cheap for
// a four-team league; returns empty (no leaders) until games start being entered.
export function fetchWpblAllLines(): Promise<WpblLinesResult> {
  return once('allLines', async () => {
    const [batting, pitching] = await Promise.all([
      safe('fetchWpblAllBatting', () =>
        supabase.from('wpbl_batting_lines').select('*'),
        [] as WpblBattingLine[]),
      safe('fetchWpblAllPitching', () =>
        supabase.from('wpbl_pitching_lines').select('*'),
        [] as WpblPitchingLine[]),
    ])
    const result = { batting, pitching }
    // Keep last-good on a transient empty (see fetchWpblAllPlayers).
    if (batting.length > 0 || pitching.length > 0 || allLinesCache == null) {
      allLinesCache = { data: result, at: Date.now() }
    }
    return result
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

// The official-feed play-by-play for one game, in order.
export function fetchWpblGamePlays(gameId: string): Promise<WpblGamePlay[]> {
  return safe('fetchWpblGamePlays', () =>
    supabase.from('wpbl_game_plays').select('*').eq('game_id', gameId).order('sequence', { ascending: true }),
    [] as WpblGamePlay[])
}

// TrackMan pitch/hit tracking for one game (chronological).
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

// Every tracked pitch thrown by one pitcher (keyed by the feed id = wpbl_players.api_id),
// projected out of the raw payload. Empty for non-pitchers / players with no api_id.
// Paginated past PostgREST's 1000-row default so it holds up as the season fills in.
export async function fetchWpblPitcherLocations(apiId: string | null): Promise<WpblPitchLoc[]> {
  if (!apiId) return []
  const SELECT = 'game_id,release_speed,pitch_type:raw->>pitch_type,' +
    'side:raw->>plate_location_side,height:raw->>plate_location_height'
  const PAGE = 1000
  const out: WpblPitchLoc[] = []
  for (let from = 0; ; from += PAGE) {
    const page = await safe<Record<string, unknown>[]>('fetchWpblPitcherLocations', () =>
      supabase.from('wpbl_pitch_tracking').select(SELECT)
        .eq('kind', 'pitch').eq('raw->>pitcher_id', apiId)
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

export function computeStandings(teams: WpblTeam[], games: WpblGame[]): WpblStandingRow[] {
  const acc = new Map<string, { team: WpblTeam; wins: number; losses: number; runsFor: number; runsAgainst: number }>()
  for (const team of teams) acc.set(team.id, { team, wins: 0, losses: 0, runsFor: 0, runsAgainst: 0 })

  // Decisive final games, chronological (date then start time) so streak / last-10 read
  // in true order and head-to-head is accumulated as played.
  const finals = games
    .filter(g => g.status === 'final' && g.home_score != null && g.away_score != null && g.home_score !== g.away_score)
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

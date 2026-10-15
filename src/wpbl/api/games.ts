import { supabase } from '../../lib/supabase'
import { countsInStandings, standingsFinals } from '../season'
import { cleanSchedule } from '../gameOver'
import { readSeed, writeSeed } from '../seed'
import type {
  WpblTeam, WpblGame, WpblStandingRow, WpblSiteGame, WpblGameDetails, WpblGameRevision,
} from '../types'
import { safe, once, readOverlay, isList, seeded, isFreshSlow } from './core'

// The clubs, the schedule and one game's own rows: what the scoreboard and the standings stand on.

// Last good teams read, for a synchronous seed on a surface that opens after the section has
// already loaded them (the overlay hosts). Never overwritten by an empty read, same reasoning
// as the schedule's last-good below.
export let teamsCache: WpblTeam[] | null = null
// The last visit's clubs (seed.ts), for the first paint only: kept apart from teamsCache, which
// short-circuits every later read, so a seed never stops the session's one real read of them.
let seededTeams: WpblTeam[] | null | undefined
export function getCachedWpblTeams(): WpblTeam[] | null {
  if (teamsCache) return teamsCache
  if (seededTeams === undefined) seededTeams = readSeed<WpblTeam[]>('teams', isList)
  return seededTeams
}
export function fetchWpblTeams(): Promise<WpblTeam[]> {
  // Served from the last good read once there is one. The four clubs do not change inside a
  // session, and without this every surface that joins against them paid its own round trip:
  // Home's first paint read the table twice, once for the section and again for the gallery.
  if (teamsCache) return Promise.resolve(teamsCache)
  return once('teams', () => safe('fetchWpblTeams', () =>
    supabase.from('wpbl_teams').select('*').order('sort_order', { ascending: true }),
    [] as WpblTeam[]).then(t => { if (t.length > 0) { teamsCache = t; writeSeed('teams', t) } return t }))
}

// The last good schedule the section fetched, for the same synchronous seed. `lastGoodSchedule`
// is what fetchWpblSchedule already keeps for its empty-read guard, so this exposes it rather
// than holding a second copy.
export function getCachedWpblSchedule(): WpblGame[] | null { seedSchedule(); return lastGoodSchedule }

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

export let lastGoodSchedule: WpblGame[] | null = null
// The last visit's schedule (seed.ts) stands in as the last good one until the first real read,
// so it is also what an empty first read falls back to rather than an empty league.
let scheduleSeeded = false
function seedSchedule(): void {
  if (scheduleSeeded) return
  scheduleSeeded = true
  if (!lastGoodSchedule) lastGoodSchedule = readSeed<WpblGame[]>('schedule', isList)
}

export function fetchWpblSchedule(): Promise<WpblGame[]> {
  return once('schedule', async () => {
    const games = await safe('fetchWpblSchedule', () =>
      supabase.from('wpbl_games').select('*').order('game_date', { ascending: true }),
      [] as WpblGame[])
    // settleGames LAST of the three, and at this boundary rather than in the views, because
    // `status` is read in about fifty places and a rule the callers have to remember to apply
    // is a rule that gets forgotten by the next one. Everything downstream of this read sees a
    // game the league has stopped updating as the final it is. See gameOver.ts.
    seedSchedule()
    const schedule = mergeSchedule(cleanSchedule(games), lastGoodSchedule)
    if (schedule.length > 0) {
      // Only a real read is remembered for the next visit, never the seed handed back.
      if (games.length > 0) writeSeed('schedule', schedule)
      lastGoodSchedule = schedule
    }
    // Last, and after the last-good cache, so what is remembered for the next empty read is the
    // real schedule rather than a simulated moment of it.
    return readOverlay ? readOverlay.schedule(schedule) : schedule
  })
}

// How often the live views re-read a game in progress.
//
// This is a FALLBACK, not the delivery mechanism. Both live surfaces also hold a Supabase
// Realtime subscription on the row (Live.tsx) or on the plays and batting lines feeding it
// (gameDetail/GameDetailModal.tsx), and those push within a second of the write. The poll exists for the case
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
//
// The compiler now holds the two halves to the WpblGame type: a field added there and to
// neither list fails `npm run typecheck` on WpblGameColumnsPartition below, naming the field. It
// cannot see a column added to the table and not to the type, so add it to the type first.
const LIVE_GAME_COLUMN_NAMES = [
  'id', 'status', 'status_detail', 'notes', 'updated_at', 'source_updated_at',
  'home_score', 'away_score', 'innings',
  'home_hits', 'away_hits', 'home_errors', 'away_errors', 'home_lob', 'away_lob',
  'home_line', 'away_line', 'live_state',
  'live_inning', 'live_half', 'live_outs', 'live_balls', 'live_strikes',
  'runner_first', 'runner_second', 'runner_third',
  'away_batting_order', 'home_batting_order', 'away_pitcher_id', 'home_pitcher_id',
  'last_play_at',
] as const satisfies readonly (keyof WpblGame)[]
const LIVE_GAME_COLUMNS = LIVE_GAME_COLUMN_NAMES.join(',')

/** The immutable half: fixed the moment a game is scheduled. Listed only to be checked. */
const _FIXED_GAME_COLUMN_NAMES = [
  'game_date', 'start_time', 'home_team_id', 'away_team_id', 'venue', 'created_at',
  'api_game_id', 'season_id', 'game_type', 'counts_in_standings',
] as const satisfies readonly (keyof WpblGame)[]

type AssertNever<T extends never> = T
/** Fails to compile, naming the field, when a WpblGame field is in neither list.
 *  `final_by_rule` is not a column (see its comment in types.ts). Exported only so an unused type
 *  is not an error, so nothing imports it.
 *  @public */
export type WpblGameColumnsPartition = AssertNever<Exclude<keyof WpblGame,
  (typeof LIVE_GAME_COLUMN_NAMES)[number] | (typeof _FIXED_GAME_COLUMN_NAMES)[number] | 'final_by_rule'>>

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

let siteGamesCache:   { data: WpblSiteGame[]; at: number } | null = null

const seedSiteGames = () => seeded<WpblSiteGame[]>('siteGames', siteGamesCache, isList, data => { siteGamesCache = { data, at: 0 } })

export function getCachedWpblSiteGames(): WpblSiteGame[] | null { seedSiteGames(); return siteGamesCache?.data ?? null }

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
  if (isFreshSlow(siteGamesCache)) return Promise.resolve(siteGamesCache!.data)
  return once('siteGames', async () => {
    const data = await safe<WpblSiteGame[]>('fetchWpblSiteGames', () =>
      supabase.from('wpbl_site_games')
        .select('event_id,game_date,start_time,title,status,home_team_id,away_team_id,home_score,away_score,round,series_key,game_number,url,ticket_url')
        .order('game_date', { ascending: true })
        .order('event_id', { ascending: true }) as unknown as
        PromiseLike<{ data: WpblSiteGame[] | null; error: unknown }>,
      [])
    if (data.length > 0) writeSeed('siteGames', data)
    if (data.length > 0 || siteGamesCache == null) siteGamesCache = { data, at: Date.now() }
    return data
  })
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

// Standings derived from final games (not stored). Which games those are, and the order they
// were played in, is `standingsFinals` in season.ts: one definition, for the reason written
// beside it there.

// `countsInStandings` lives in season.ts, which imports nothing but types. The predicate is
// needed by stats.ts, which is bundled into the Cloudflare Pages Functions behind the OG cards
// and the Discord /player command; importing it from here would drag the whole supabase client
// into those. Re-exported so every existing importer keeps working and there is still exactly
// one definition of "counts toward the season".
export { countsInStandings }

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

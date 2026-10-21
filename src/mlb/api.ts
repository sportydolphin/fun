import { foldName, fuzzyMatches } from '../lib/fuzzyName'
import { Player, Team, StatDef, TeamSummary, RecentGameEntry, RosterEntry, StandingsDivision, TeamPlayerStat, TeamStandingInfo, SosEntry, LeaderboardEntry } from './types'
import { TEAM_ABBR, CURRENT_SEASON } from './constants'
import { supabase } from '../lib/supabase'
import { fetchSeasonPlayerStats } from './apiSeasonStats'
import { seasonIsOver } from './seasonPhase'
import { isUnplayed } from './gameStatus'
import { combineEntries, CAREER_POST_MIN_PA, CAREER_POST_MIN_IP } from './lib/gameScope'
import type { GameScope } from './lib/gameScope'
import { cachedJson, cachedRead, FRESH_LONG_MS } from './lib/readCache'
import { MLB_QUALIFY_IP_PER_GAME, MLB_QUALIFY_PA_PER_GAME } from './qualify'
import { pickMoves, moveWindowDays } from './lib/rosterMoves'

// Public API surface split across sibling modules, re-exported here so existing
// `from '../api'` imports across the app keep resolving unchanged.
export { fetchSeasonPlayerStats } from './apiSeasonStats'
export * from './reportCardData'
export * from './apiContracts'

// ─── API helpers ─────────────────────────────────────────────────────────────

// THE NAME LOOKUPS, KEPT FOR TEN MINUTES. The search asks StatsAPI on every settled keystroke, and
// a reader backspacing "ohtani" to "ohta" and back, a compare asking for both halves of "Ohtani vs
// Judge" on each key, and the forgiving pass's short starts ("oh") all re-asked for answers they
// had seconds earlier. Kept as the promise, so two asks in flight share one call; a failed one is
// dropped, so the next ask tries again. Bounded, oldest out first: a long session types a lot.
const NAME_TTL_MS = 10 * 60_000
const NAME_CACHE_MAX = 200
const nameCache = new Map<string, { at: number; people: Promise<Player[]> }>()

export function searchPlayers(name: string): Promise<Player[]> {
  const key = name.trim().toLowerCase()
  const hit = nameCache.get(key)
  if (hit && Date.now() - hit.at < NAME_TTL_MS) return hit.people.then(p => [...p])
  const people = fetch(`https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}&sportId=1&hydrate=currentTeam`)
    // A refusal is thrown rather than read as nobody, or an outage would be kept as an answer.
    .then(r => { if (!r.ok) throw new Error(`people/search ${r.status}`); return r.json() })
    .then((d: { people?: Player[] }) => {
      const out = d.people ?? []
      // Active players first, retired players after, which covers the full modern era
      return out.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0))
    })
  nameCache.delete(key)
  nameCache.set(key, { at: Date.now(), people })
  if (nameCache.size > NAME_CACHE_MAX) nameCache.delete(nameCache.keys().next().value!)
  people.catch(() => { if (nameCache.get(key)?.people === people) nameCache.delete(key) })
  return people.then(p => [...p])
}

/** Tests only: forget every cached lookup. */
export function clearPlayerSearchCache(): void { nameCache.clear() }

/**
 * A second try for a name StatsAPI's prefix search missed, "Ohatni" or "Freddy Freman". The API
 * matches the start of a word and nothing looser, so this asks for short starts instead (the first
 * three letters of the two longest words, and the first two of the longest, since a slip in the
 * third letter is common: "oha" will never find Ohtani, "oh" does) and keeps only the players
 * whose whole name fits the query within a slip or two (lib/fuzzyName.ts). At most three calls.
 */
export async function searchPlayersForgiving(name: string): Promise<Player[]> {
  const words = foldName(name).split(' ').filter(w => w.length >= 4).sort((a, b) => b.length - a.length).slice(0, 2)
  if (!words.length) return []
  const starts = [...new Set([...words.map(w => w.slice(0, 3)), words[0].slice(0, 2)])]
  const pools = await Promise.all(starts.map(s => searchPlayers(s).catch(() => [] as Player[])))
  const seen = new Set<number>()
  const all = pools.flat().filter(p => !seen.has(p.id) && !!seen.add(p.id))
  return fuzzyMatches(all, name, p => [p.fullName])
}

/** One game off StatsAPI's schedule, as the search's game rows need it. */
export interface ScheduleGameLite {
  gamePk: number; date: string; awayId: number; homeId: number
  awayScore: number | null; homeScore: number | null; state: 'final' | 'live' | 'scheduled'
  /** "Bottom 6", "Mid 3", while the game is live. */
  inning?: string | null
}

/**
 * A club's games, or two clubs' meetings, between two days: the palette's "Dodgers last night" and
 * "Cubs vs Cardinals". StatsAPI filters on both clubs itself (`opponentId`), so a pairing is one
 * small call whatever the range. Every game type, since a playoff game is a game someone asks for.
 */
export async function fetchClubGames(teamId: number, opponentId: number | null, start: string, end: string): Promise<ScheduleGameLite[]> {
  const opp = opponentId != null ? `&opponentId=${opponentId}` : ''
  // The line score, for where a live game is ("Bottom 6"), which the palette's live row says.
  const r = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${teamId}${opp}&startDate=${start}&endDate=${end}&hydrate=linescore`)
  const d = await r.json()
  return (d.dates ?? []).flatMap((day: any) => (day.games ?? []).map((g: any): ScheduleGameLite => {
    const s = g.status?.abstractGameState
    return {
      gamePk: g.gamePk, date: g.officialDate ?? day.date,
      awayId: g.teams?.away?.team?.id, homeId: g.teams?.home?.team?.id,
      awayScore: g.teams?.away?.score ?? null, homeScore: g.teams?.home?.score ?? null,
      state: s === 'Final' ? 'final' : s === 'Live' ? 'live' : 'scheduled',
      inning: s === 'Live' && g.linescore?.currentInning
        ? `${g.linescore.inningState === 'Middle' ? 'Mid' : g.linescore.inningState === 'End' ? 'End' : g.linescore.inningHalf ?? ''} ${g.linescore.currentInning}`.trim()
        : null,
    }
  }))
}

// Player bio (name/position/currentTeam) is static within a session, and cross-links
// fetch it twice per click (once in the nav handler, once inside selectPlayer), so
// cache by id. On failure the entry is evicted so a transient blip doesn't poison it.
const playerDetailsCache = new Map<number, Promise<Player | null>>()

export function fetchPlayerDetails(id: number): Promise<Player | null> {
  const cached = playerDetailsCache.get(id)
  if (cached) return cached
  const p = fetch(`https://statsapi.mlb.com/api/v1/people/${id}?hydrate=currentTeam`)
    .then(r => r.json())
    .then((d: any) => d.people?.[0] ?? null)
  playerDetailsCache.set(id, p)
  p.catch(() => playerDetailsCache.delete(id))
  return p
}

// Cache raw yearByYear splits, one request per player/group, shared by the player page's career
// table and its trends chart (playerProfile.ts).
const yearByYearCache = new Map<string, Promise<any[]>>()

export function fetchYearByYearSplits(id: number, group: 'hitting' | 'pitching'): Promise<any[]> {
  const key = `${id}-${group}`
  if (!yearByYearCache.has(key)) {
    yearByYearCache.set(key,
      fetch(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=yearByYear&group=${group}&sportId=1`)
        .then(r => r.json())
        .then((d: any) => d.stats?.[0]?.splits ?? [])
        .catch(() => [])
    )
  }
  return yearByYearCache.get(key)!
}


// Fetch all players' season stats for a group, then rank locally per stat def.
// Replaces the old stats/leaders endpoint which silently drops most categories
// when more than ~3 are batched in one request.
export async function fetchAndRankPlayers(
  group: 'hitting' | 'pitching',
  season: number,
  defs: StatDef[]
): Promise<Map<string, number[]>> {
  try {
    const splits = await fetchSeasonPlayerStats(group, season)
    // Estimate how far into the season we are by the max games played by any player
    const maxGames = Math.max(...splits.map(s => Number(s.stat?.gamesPlayed ?? 0)), 1)
    const minPA = Math.round(maxGames * MLB_QUALIFY_PA_PER_GAME)   // batting qualification threshold
    const minIP = maxGames * MLB_QUALIFY_IP_PER_GAME                // pitching qualification threshold
    const map = new Map<string, number[]>()
    for (const def of defs) {
      if (!def.leaderCategory) continue
      // For rate stats, only rank players who have enough PA / IP to qualify
      const qualifiedSplits = def.isRate
        ? splits.filter(s =>
            group === 'hitting'
              ? Number(s.stat?.plateAppearances ?? 0) >= minPA
              : parseFloat(s.stat?.inningsPitched ?? '0') >= minIP
          )
        : splits
      const entries = qualifiedSplits
        .map(s => ({ id: Number(s.player?.id), val: def.getValue(s.stat) }))
        .filter(x => x.id > 0 && x.val != null && x.val !== '' && !isNaN(Number(x.val)))
      // Sort ascending only for stats where lower is better (ERA, WHIP); all others descending
      const asc = def.lowerIsBetter ?? false
      entries.sort((a, b) => asc ? Number(a.val) - Number(b.val) : Number(b.val) - Number(a.val))
      map.set(def.leaderCategory, entries.map(x => x.id))
    }
    return map
  } catch {
    return new Map()
  }
}

export async function fetchAllTeams(): Promise<Team[]> {
  const d = await cachedJson<{ teams?: Team[] }>('https://statsapi.mlb.com/api/v1/teams?sportId=1&activeStatus=Active', FRESH_LONG_MS)
  return [...(d.teams ?? [])].sort((a: Team, b: Team) => a.name.localeCompare(b.name))
}

// EVERY CLUB'S SEASON LINE IN ONE READ, per group. This was one request per club per group, and
// the team page's league ranks (fetchTeamRankings) and the Visualize charts each want all thirty,
// so opening a followed team's card fired 60 requests before anything drew. `/teams/stats` returns
// the same stat object for every club (checked field for field, current and past seasons), so a
// single team's line is looked up in it.
//
// A failed read is evicted rather than cached, so a network blip on one visit is not an empty
// ranking for the rest of the session.
const allTeamStatsCache = new Map<string, Promise<Map<number, any>>>()

/** `gameType` 'P' is the postseason, which answers with only the clubs that played in it. */
export function fetchAllTeamStats(group: 'hitting' | 'pitching' | 'fielding', season: number, gameType: 'R' | 'P' = 'R'): Promise<Map<number, any>> {
  const key = `${group}-${season}-${gameType}`
  let p = allTeamStatsCache.get(key)
  if (!p) {
    p = fetch(`https://statsapi.mlb.com/api/v1/teams/stats?stats=season&group=${group}&season=${season}&sportIds=1${gameType === 'P' ? '&gameType=P' : ''}`)
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then((d: any) => new Map<number, any>(
        (d.stats?.[0]?.splits ?? []).map((s: any) => [Number(s.team?.id), s.stat ?? null] as [number, any]),
      ))
    p.catch(() => allTeamStatsCache.delete(key))
    allTeamStatsCache.set(key, p)
  }
  return p
}

export async function fetchTeamStats(id: number, group: 'hitting' | 'pitching', season: number): Promise<any> {
  try { return (await fetchAllTeamStats(group, season)).get(id) ?? null }
  catch { return null }
}

// Fetch all player stats for a season and return structured entries for leaderboard display.
// `scope` 'all' is the two halves summed per player, since StatsAPI has no combined pool.
export async function fetchLeaderboardData(
  group: 'hitting' | 'pitching',
  season: number,
  scope: GameScope = 'regular',
): Promise<LeaderboardEntry[]> {
  if (scope === 'all') {
    const [regular, post] = await Promise.all([
      fetchLeaderboardData(group, season, 'regular'),
      fetchLeaderboardData(group, season, 'post'),
    ])
    return combineEntries(regular, post)
  }
  try {
    const splits = await fetchSeasonPlayerStats(group, season, scope === 'post' ? 'P' : 'R')
    return splits.map((s: any) => ({
      playerId: Number(s.player?.id),
      playerName: s.player?.fullName ?? '—',
      teamAbbr: s.team?.abbreviation ?? TEAM_ABBR[s.team?.id] ?? '—',
      teamId: Number(s.team?.id) || 0,
      position: s.position?.abbreviation,
      stat: s.stat,
    })).filter((e: any) => e.playerId > 0)
  } catch {
    return []
  }
}


// ─── All-time (career) leaderboard ──────────────────────────────────────────────
// The career-stats endpoint holds ~22k players, far too many to fetch and sort
// client-side. Instead we ask the API for the true career leaders of each headline
// stat (server-sorted) and union the results into one pool the Stats table can
// re-sort locally. Rate stats use the Qualified pool (career PA/IP thresholds) so
// tiny-sample flukes don't top the list; counting stats use the full pool so career
// relievers (e.g. the all-time saves leaders) aren't excluded.
//
// ── Why rate stats are fetched in both directions ──
// The pool only contains leaders, so re-sorting it backwards locally would answer
// the wrong question: not "who has the worst career AVG" but "which of these
// leaders is weakest at AVG". For rate stats the *real* answer is worth having and
// the API can give it: sorted ascending within the Qualified pool it returns
// George McBride (.218) and Mark Belanger (.228), a real worst-hitters board,
// so we fetch that direction too and the reversed sort becomes truthful.
//
// Counting stats get no such treatment, because there is no meaningful answer to
// fetch: ascending career home runs is thousands of players tied on zero, and the
// endpoint returns an arbitrary handful of them. StatsView therefore refuses to
// sort those backwards at all rather than showing a list that means nothing.
export type CareerSortSpec = { field: string; pool: 'All' | 'Qualified'; order: 'asc' | 'desc' }

export const CAREER_SORTS: Record<'hitting' | 'pitching', CareerSortSpec[]> = {
  hitting: [
    { field: 'hits',        pool: 'All',       order: 'desc' },
    { field: 'homeRuns',    pool: 'All',       order: 'desc' },
    { field: 'rbi',         pool: 'All',       order: 'desc' },
    { field: 'doubles',     pool: 'All',       order: 'desc' },
    { field: 'triples',     pool: 'All',       order: 'desc' },
    { field: 'stolenBases', pool: 'All',       order: 'desc' },
    { field: 'baseOnBalls', pool: 'All',       order: 'desc' },
    { field: 'strikeOuts',  pool: 'All',       order: 'desc' },
    { field: 'avg',         pool: 'Qualified', order: 'desc' },
    { field: 'obp',         pool: 'Qualified', order: 'desc' },
    { field: 'slg',         pool: 'Qualified', order: 'desc' },
    { field: 'ops',         pool: 'Qualified', order: 'desc' },
    // Worst-qualified ends, so the table can be sorted the other way honestly.
    { field: 'avg',         pool: 'Qualified', order: 'asc'  },
    { field: 'obp',         pool: 'Qualified', order: 'asc'  },
    { field: 'slg',         pool: 'Qualified', order: 'asc'  },
    { field: 'ops',         pool: 'Qualified', order: 'asc'  },
  ],
  pitching: [
    { field: 'wins',              pool: 'All',       order: 'desc' },
    { field: 'inningsPitched',    pool: 'All',       order: 'desc' },
    { field: 'strikeOuts',        pool: 'All',       order: 'desc' },
    { field: 'saves',             pool: 'All',       order: 'desc' },
    { field: 'era',               pool: 'Qualified', order: 'asc'  },
    { field: 'whip',              pool: 'Qualified', order: 'asc'  },
    { field: 'strikeoutsPer9Inn', pool: 'Qualified', order: 'desc' },
    // For ERA/WHIP "worst" is the high end; SO/9's is the low end.
    { field: 'era',               pool: 'Qualified', order: 'desc' },
    { field: 'whip',              pool: 'Qualified', order: 'desc' },
    { field: 'strikeoutsPer9Inn', pool: 'Qualified', order: 'asc'  },
  ],
}

export interface AllTimeEntry {
  playerId:   number
  playerName: string
  teamAbbr:   string
  teamId:     number
  position?:  string
  stat:       any
  /**
   * The API returned this player in a Qualified-pool request, i.e. they cleared
   * the career PA/IP minimum. Rate-stat leaderboards restrict to these: without
   * it a .000-in-1-AB cup-of-coffee player would top any ascending rate sort.
   */
  qualified:  boolean
}

const allTimeCache = new Map<string, Promise<AllTimeEntry[]>>()

// CAREER POSTSEASON HAS NO QUALIFIED POOL. StatsAPI answers `playerPool=Qualified&gameType=P` with
// zero rows, and its All pool sorted by a rate is a list of pitchers with one scoreless inning. So
// the postseason pool is built from volume instead (the counting leaders, plus the 400 players with
// the most plate appearances or innings), and "qualified" is a bar of ours. 100 PA and 40 IP is
// roughly four and a half postseason series of a regular's at-bats, and a starter's dozen-odd
// starts: enough that one hot October cannot top the board, low enough that the board is not
// only the dynasty clubs.
const CAREER_POST_VOLUME: Record<'hitting' | 'pitching', string> = { hitting: 'plateAppearances', pitching: 'inningsPitched' }

// Career postseason is a pool of its own (`gameType=P`), and the same leaders-union applies. There
// is no career "All": the pools are each stat's top 100, so a player can be in one and not the
// other, and summing what happens to be present would publish half a career as the whole of one.
export function fetchAllTimeLeaderboardData(group: 'hitting' | 'pitching', scope: 'regular' | 'post' = 'regular'): Promise<AllTimeEntry[]> {
  const key = `${group}-${scope}`
  if (!allTimeCache.has(key)) {
    const post = scope === 'post'
    const specs: Array<CareerSortSpec & { limit?: number }> = post
      ? [
          ...CAREER_SORTS[group].filter(s => s.pool === 'All'),
          { field: CAREER_POST_VOLUME[group], pool: 'All', order: 'desc', limit: 400 },
        ]
      : CAREER_SORTS[group]
    const p = Promise.all(specs.map(spec =>
      fetch(`https://statsapi.mlb.com/api/v1/stats?stats=career&group=${group}&sportId=1&limit=${spec.limit ?? 100}` +
        `&playerPool=${spec.pool}&sortStat=${spec.field}&order=${spec.order}${post ? '&gameType=P' : ''}`)
        .then(r => r.json())
        .then((d: any) => ({ spec, splits: (d.stats?.[0]?.splits ?? []) as any[] }))
        .catch(() => ({ spec, splits: [] as any[] }))
    )).then(results => {
      // Union by playerId. Career stat objects are complete regardless of which sort
      // surfaced a player, so first-wins dedup is safe for the stats themselves,
      // but `qualified` must OR across every request, since a player can arrive
      // first via an All-pool counting sort and only later via a Qualified one.
      const byId = new Map<number, AllTimeEntry>()
      for (const { spec, splits } of results) {
        for (const s of splits) {
          const playerId = Number(s.player?.id)
          if (!playerId) continue
          const existing = byId.get(playerId)
          if (existing) {
            if (spec.pool === 'Qualified') existing.qualified = true
            continue
          }
          byId.set(playerId, {
            playerId,
            playerName: s.player?.fullName ?? '—',
            teamAbbr: s.team?.abbreviation ?? TEAM_ABBR[s.team?.id] ?? '—',
            teamId: Number(s.team?.id) || 0,
            position: s.position?.abbreviation,
            stat: s.stat,
            qualified: spec.pool === 'Qualified',
          })
        }
      }
      const entries = [...byId.values()]
      if (post) {
        for (const e of entries) {
          e.qualified = group === 'hitting'
            ? Number(e.stat?.plateAppearances ?? 0) >= CAREER_POST_MIN_PA
            : parseFloat(String(e.stat?.inningsPitched ?? 0)) >= CAREER_POST_MIN_IP
        }
      }
      return entries
    }).catch(() => [])
    allTimeCache.set(key, p)
  }
  return allTimeCache.get(key)!
}

export async function fetchTeamRankings(group: 'hitting' | 'pitching', season: number, defs: StatDef[]): Promise<Map<string, number[]>> {
  try {
    const teamIds = Object.keys(TEAM_ABBR).map(Number)
    const results = await Promise.all(
      teamIds.map(id => fetchTeamStats(id, group, season).then(stat => ({ id, stat })))
    )
    const valid = results.filter(r => r.stat != null)
    const map = new Map<string, number[]>()
    for (const def of defs) {
      if (!def.leaderCategory) continue
      const entries = valid
        .map(r => ({ id: r.id, val: def.getValue(r.stat) }))
        .filter(x => x.val != null && x.val !== '' && !isNaN(Number(x.val)))
      const asc = def.lowerIsBetter || def.poop
      entries.sort((a, b) => asc ? Number(a.val) - Number(b.val) : Number(b.val) - Number(a.val))
      map.set(def.leaderCategory, entries.map(x => x.id))
    }
    return map
  } catch {
    return new Map()
  }
}

export async function fetchTeamSummaryData(season: number): Promise<TeamSummary[]> {
  const teamIds = Object.keys(TEAM_ABBR).map(Number)
  const results = await Promise.all(
    teamIds.map(id =>
      Promise.all([
        fetchTeamStats(id, 'hitting', season).catch(() => null),
        fetchTeamStats(id, 'pitching', season).catch(() => null),
      ]).then(([hitting, pitching]) => ({ id, hitting, pitching }))
    )
  )
  return results
    .map(r => ({
      id: r.id,
      abbr: TEAM_ABBR[r.id],
      ops: r.hitting?.ops != null ? Number(r.hitting.ops) : NaN,
      era: r.pitching?.era != null ? Number(r.pitching.era) : NaN,
      rs: r.hitting?.runs != null ? Number(r.hitting.runs) : NaN,
      ra: r.pitching?.runs != null ? Number(r.pitching.runs) : NaN,
      wins: r.pitching?.wins != null ? Number(r.pitching.wins) : NaN,
      losses: r.pitching?.losses != null ? Number(r.pitching.losses) : NaN,
    }))
    .filter(p => p.abbr)
}

// ─── Recent game log ─────────────────────────────────────────────────────────

// Game logs for a completed season are final, so cache them; the current season's log
// grows each day and is always fetched fresh. Failures are evicted so a blip doesn't stick.
const recentGamesCache = new Map<string, Promise<RecentGameEntry[]>>()

export function fetchRecentGames(
  id: number,
  groups: Array<'hitting' | 'pitching'>,
  season: number
): Promise<RecentGameEntry[]> {
  if (season >= CURRENT_SEASON) return fetchRecentGamesUncached(id, groups, season)
  const key = `${id}-${[...groups].sort().join(',')}-${season}`
  const cached = recentGamesCache.get(key)
  if (cached) return cached
  const p = fetchRecentGamesUncached(id, groups, season)
  recentGamesCache.set(key, p)
  p.catch(() => recentGamesCache.delete(key))
  return p
}

async function fetchRecentGamesUncached(
  id: number,
  groups: Array<'hitting' | 'pitching'>,
  season: number
): Promise<RecentGameEntry[]> {
  const results = await Promise.all(
    groups.map(group =>
      fetch(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=gameLog&group=${group}&season=${season}`)
        .then(r => r.json())
        .then((d: any) => ({ group, splits: (d.stats?.[0]?.splits ?? []) as any[] }))
        .catch(() => ({ group, splits: [] as any[] }))
    )
  )

  const byGame = new Map<number, RecentGameEntry>()

  for (const { group, splits } of results) {
    for (const split of splits) {
      const gamePk = Number(split.game?.gamePk)
      if (!gamePk) continue
      if (!byGame.has(gamePk)) {
        byGame.set(gamePk, {
          date: split.date ?? '',
          isHome: split.isHome ?? true,
          opponentAbbr: split.opponent?.abbreviation ?? TEAM_ABBR[split.opponent?.id] ?? '???',
          opponentId: split.opponent?.id != null ? Number(split.opponent.id) : null,
          hitting: null,
          pitching: null,
        })
      }
      const entry = byGame.get(gamePk)!
      if (group === 'hitting') entry.hitting = split.stat
      else entry.pitching = split.stat
    }
  }

  return [...byGame.values()].sort((a, b) => b.date.localeCompare(a.date))
}

// Active roster for a team/season. `hydrate=person(...)` pulls bats/throws so the
// roster rows can show handedness without a second request per player.
export async function fetchTeamRoster(teamId: number, season: number): Promise<RosterEntry[]> {
  try {
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1/teams/${teamId}/roster?rosterType=active&season=${season}` +
      `&hydrate=person(batSide,pitchHand)`
    )
    const d = await r.json()
    const roster: any[] = d.roster ?? []
    return roster.map((e): RosterEntry => ({
      playerId: Number(e.person?.id),
      fullName: e.person?.fullName ?? '—',
      jerseyNumber: e.jerseyNumber ?? '',
      positionAbbr: e.position?.abbreviation ?? e.person?.primaryPosition?.abbreviation ?? '',
      positionType: e.position?.type ?? e.person?.primaryPosition?.type ?? '',
      positionCode: String(e.position?.code ?? e.person?.primaryPosition?.code ?? ''),
      bats: e.person?.batSide?.code,
      throws: e.person?.pitchHand?.code,
      statusCode: e.status?.code ?? 'A',
      statusDescription: e.status?.description ?? '',
    })).filter(e => e.playerId)
  } catch {
    return []
  }
}

// ─── Team featured players ────────────────────────────────────────────────────
//
// Fetch all individual player season stats for a team so we can surface the
// team's best hitters and pitchers as mini-cards on the team card.
// Each group is sorted by the most meaningful metric so callers can slice off
// the top N without further work.

export async function fetchTeamTopPlayers(
  teamId: number,
  season: number,
): Promise<{ hitters: TeamPlayerStat[]; pitchers: TeamPlayerStat[] }> {
  const [hd, pd] = await Promise.all([
    fetch(`https://statsapi.mlb.com/api/v1/stats?stats=season&group=hitting&season=${season}&sportId=1&teamId=${teamId}`)
      .then(r => r.json()).catch(() => null),
    fetch(`https://statsapi.mlb.com/api/v1/stats?stats=season&group=pitching&season=${season}&sportId=1&teamId=${teamId}`)
      .then(r => r.json()).catch(() => null),
  ])

  const hitSplits: any[] = hd?.stats?.[0]?.splits ?? []
  const pitSplits: any[] = pd?.stats?.[0]?.splits ?? []

  const hitters: TeamPlayerStat[] = hitSplits
    .filter(s =>
      s.player?.id &&
      Number(s.stat?.plateAppearances ?? 0) >= 50 &&
      s.position?.type !== 'Pitcher',
    )
    .map(s => ({
      playerId: Number(s.player.id),
      playerName: s.player.fullName ?? '',
      position: s.position?.abbreviation ?? '?',
      gamesStarted: 0,
      saves: 0,
      stat: s.stat,
    }))
    .sort((a, b) => Number(b.stat?.ops ?? 0) - Number(a.stat?.ops ?? 0))

  const pitchers: TeamPlayerStat[] = pitSplits
    .filter(s =>
      s.player?.id &&
      parseFloat(String(s.stat?.inningsPitched ?? '0')) >= 5,
    )
    .map(s => ({
      playerId: Number(s.player.id),
      playerName: s.player.fullName ?? '',
      position: s.position?.abbreviation ?? 'P',
      gamesStarted: Number(s.stat?.gamesStarted ?? 0),
      saves: Number(s.stat?.saves ?? 0),
      stat: s.stat,
    }))
    .sort((a, b) => Number(a.stat?.era ?? 99) - Number(b.stat?.era ?? 99))

  return { hitters, pitchers }
}

// ─── Standings ────────────────────────────────────────────────────────────────

// Cache full standings by season (reused by both the Standings view and the team card)
const standingsCache = new Map<number, Promise<StandingsDivision[]>>()

function fetchStandingsCached(season: number): Promise<StandingsDivision[]> {
  if (!standingsCache.has(season)) {
    standingsCache.set(season, fetchStandings(season).catch(() => []))
  }
  return standingsCache.get(season)!
}

export async function fetchTeamStanding(teamId: number, season: number): Promise<TeamStandingInfo | null> {
  const standings = await fetchStandingsCached(season)
  for (const div of standings) {
    const t = div.teams.find(t => t.teamId === teamId)
    if (t) {
      return {
        divisionRank: t.divisionRank,
        divisionName: div.divisionName,
        gamesBack: t.gamesBack,
        wcGamesBack: t.wcGamesBack,
        wcRank: t.wcRank,
        divisionLeader: t.divisionLeader,
      }
    }
  }
  return null
}

export async function fetchDivisionForTeam(teamId: number, season: number): Promise<StandingsDivision | null> {
  const standings = await fetchStandingsCached(season)
  return standings.find(div => div.teams.some(t => t.teamId === teamId)) ?? null
}

// ─── Strength of Schedule ────────────────────────────────────────────────────
//
// Fetch all remaining regular-season games, cross-reference each opponent's
// current win%, and return 30 SosEntry objects sorted hardest → easiest.
//
// ONCE THE REGULAR SEASON IS OVER there is nothing remaining, and the remaining read came back
// empty: every club at .000 with 0 games left, from Sep 28 to the next opening day. So `final`
// turns it around: every game each club actually played, at the opponents' final records. The
// caller passes its phase rather than this reading one, so the board's words and its numbers
// come from the same answer (the dev phase override included).

const sosCache = new Map<string, Promise<SosEntry[]>>()

export function fetchStrengthOfSchedule(season: number, final = false): Promise<SosEntry[]> {
  const key = `${season}:${final}`
  if (!sosCache.has(key)) {
    sosCache.set(key, (final ? _buildPlayedSosEntries(season) : _buildSosEntries(season)).catch(() => []))
  }
  return sosCache.get(key)!
}

/** Win% and record per club from the standings, the shared half of both schedule boards. */
async function _sosStandings(season: number) {
  const standings = await fetchStandingsCached(season)
  const winPctMap = new Map<number, number>()
  const teamInfoMap = new Map<number, { abbr: string; teamName: string; wins: number; losses: number }>()
  for (const div of standings) {
    for (const t of div.teams) {
      winPctMap.set(t.teamId, parseFloat(t.pct) || 0)
      teamInfoMap.set(t.teamId, { abbr: t.abbr, teamName: t.teamName, wins: t.wins, losses: t.losses })
    }
  }
  return { winPctMap, teamInfoMap }
}

function _sosEntries(
  teamInfoMap: Map<number, { abbr: string; teamName: string; wins: number; losses: number }>,
  oppPcts: Map<number, number[]>,
): SosEntry[] {
  const entries: SosEntry[] = []
  for (const [teamId, info] of teamInfoMap) {
    const pcts = oppPcts.get(teamId) ?? []
    const avg = pcts.length > 0 ? pcts.reduce((s, p) => s + p, 0) / pcts.length : 0
    entries.push({
      teamId,
      abbr: info.abbr,
      teamName: info.teamName,
      games: pcts.length,
      oppWinPct: avg,
      wins: info.wins,
      losses: info.losses,
    })
  }
  return entries.sort((a, b) => b.oppWinPct - a.oppWinPct)
}

// Each opponent's record here leaves out its games against the club being ranked. With every result
// in hand that costs nothing, and without it the board ranks badness: the worst club's opponents
// all padded their records beating it, which put a 58–104 club at the top of 2026's hardest.
async function _buildPlayedSosEntries(season: number): Promise<SosEntry[]> {
  const { teamInfoMap } = await _sosStandings(season)
  const r = await fetch(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&season=${season}&gameType=R` +
    `&fields=dates,games,gamePk,status,abstractGameState,codedGameState,detailedState,teams,home,away,team,id,isWinner`
  )
  const d = await r.json()
  // A rainout is listed twice under one gamePk (the postponed date and the makeup) and a suspended
  // game on both of its days, so each game counts once and an unplayed one never: without both,
  // a club with a few rainouts would carry those opponents into its average two and three times.
  const seen = new Set<number>()
  const games: { home: number; away: number; homeWon: boolean }[] = []
  for (const dateObj of d.dates ?? []) {
    for (const game of dateObj.games ?? []) {
      if (isUnplayed(game.status) || game.status?.abstractGameState !== 'Final' || seen.has(game.gamePk)) continue
      seen.add(game.gamePk)
      const home = Number(game.teams?.home?.team?.id)
      const away = Number(game.teams?.away?.team?.id)
      if (home && away) games.push({ home, away, homeWon: game.teams?.home?.isWinner === true })
    }
  }

  const wins = new Map<number, number>(), played = new Map<number, number>()
  const h2hWins = new Map<string, number>(), h2hGames = new Map<string, number>()   // `${team}:${opp}`
  const bump = (m: Map<any, number>, k: number | string, by = 1) => m.set(k, (m.get(k) ?? 0) + by)
  for (const g of games) {
    for (const [t, o, won] of [[g.home, g.away, g.homeWon], [g.away, g.home, !g.homeWon]] as const) {
      bump(played, t); bump(h2hGames, `${t}:${o}`)
      if (won) { bump(wins, t); bump(h2hWins, `${t}:${o}`) }
    }
  }
  const oppPctWithout = (opp: number, team: number) => {
    const n = (played.get(opp) ?? 0) - (h2hGames.get(`${opp}:${team}`) ?? 0)
    return n > 0 ? ((wins.get(opp) ?? 0) - (h2hWins.get(`${opp}:${team}`) ?? 0)) / n : 0.5
  }

  const oppPcts = new Map<number, number[]>()
  for (const g of games) {
    bumpList(oppPcts, g.home, oppPctWithout(g.away, g.home))
    bumpList(oppPcts, g.away, oppPctWithout(g.home, g.away))
  }
  return _sosEntries(teamInfoMap, oppPcts)
}

function bumpList(m: Map<number, number[]>, k: number, v: number) {
  const list = m.get(k)
  if (list) list.push(v); else m.set(k, [v])
}

async function _buildSosEntries(season: number): Promise<SosEntry[]> {
  const { winPctMap, teamInfoMap } = await _sosStandings(season)

  // Fetch remaining schedule (only the fields we need to keep response small)
  const today = new Date().toISOString().split('T')[0]
  const endDate = `${season}-10-06`
  const r = await fetch(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${today}&endDate=${endDate}&gameType=R` +
    `&fields=dates,date,games,teams,home,away,team,id`
  )
  const d = await r.json()

  // Accumulate opponent win% lists per team
  const oppPcts = new Map<number, number[]>()
  for (const dateObj of d.dates ?? []) {
    for (const game of dateObj.games ?? []) {
      const homeId = Number(game.teams?.home?.team?.id)
      const awayId = Number(game.teams?.away?.team?.id)
      if (!homeId || !awayId) continue

      const homePct = winPctMap.get(homeId) ?? 0.5
      const awayPct = winPctMap.get(awayId) ?? 0.5

      if (!oppPcts.has(homeId)) oppPcts.set(homeId, [])
      if (!oppPcts.has(awayId)) oppPcts.set(awayId, [])

      oppPcts.get(homeId)!.push(awayPct)
      oppPcts.get(awayId)!.push(homePct)
    }
  }

  return _sosEntries(teamInfoMap, oppPcts)
}

// The standings endpoint returns division objects with only {id, link} and no name field.
// Hard-code names by the stable MLB division IDs.
const DIVISION_NAMES: Record<number, string> = {
  200: 'AL West', 201: 'AL East', 202: 'AL Central',
  203: 'NL West', 204: 'NL East', 205: 'NL Central',
}

export async function fetchStandings(season: number): Promise<StandingsDivision[]> {
  const r = await fetch(
    `https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason`
  )
  const d = await r.json()
  return (d.records ?? []).map((rec: any) => {
    const teams = (rec.teamRecords ?? []).map((t: any) => {
      const splitRecords: any[] = t.records?.splitRecords ?? []
      const lastTenRec = splitRecords.find((s: any) => s.type === 'lastTen')
      const lastTen = lastTenRec ? `${lastTenRec.wins}-${lastTenRec.losses}` : '—'
      return {
        teamId: Number(t.team?.id),
        teamName: t.team?.name ?? '—',
        abbr: TEAM_ABBR[Number(t.team?.id)] ?? (t.team?.abbreviation ?? '—'),
        wins: Number(t.wins ?? 0),
        losses: Number(t.losses ?? 0),
        pct: t.winningPercentage ?? '.000',
        gamesBack: t.gamesBack ?? '-',
        wcGamesBack: t.wildCardGamesBack ?? '-',
        wcRank: Number(t.wildCardRank ?? 0),
        divisionRank: Number(t.divisionRank ?? 0),
        streakCode: t.streak?.streakCode ?? '',
        lastTen,
        runsScored: Number(t.runsScored ?? 0),
        runsAllowed: Number(t.runsAllowed ?? 0),
        runDiff: Number(t.runDifferential ?? 0),
        divisionLeader: Boolean(t.divisionLeader),
      }
    })
    return {
      divisionId: Number(rec.division?.id),
      divisionName: DIVISION_NAMES[Number(rec.division?.id)] ?? `Division ${rec.division?.id}`,
      leagueId: Number(rec.league?.id),
      teams,
    }
  })
}

// ─── Team average ages ────────────────────────────────────────────────────────
//
// In season this is today's roster: every player's current club and current age. Once the regular
// season is over that stops describing the season, since free agency empties the rosters a week
// after the World Series and everyone left gets a year older on their birthday. So `final` reads
// who actually played instead: each club's own split of every player it used (a traded player
// counts for both clubs), at their age for the season, weighted by playing time (plate appearances
// and batters faced) so a September call-up with ten trips to the plate barely moves it.

const teamAgeCache = new Map<string, Promise<Record<number, number>>>()

export function fetchTeamAverageAges(season: number, final = false): Promise<Record<number, number>> {
  const key = `${season}:${final}`
  if (!teamAgeCache.has(key)) {
    teamAgeCache.set(key, (final ? _buildPlayedTeamAges(season) : _buildTeamAges(season)).catch(() => ({})))
  }
  return teamAgeCache.get(key)!
}

async function _buildPlayedTeamAges(season: number): Promise<Record<number, number>> {
  // One read per club: the league-wide read carries a traded player as one row, on their last club.
  const out: Record<number, number> = {}
  await Promise.all(Object.keys(TEAM_ABBR).map(async id => {
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1/stats?stats=season&group=hitting,pitching&season=${season}` +
      `&sportId=1&playerPool=ALL&limit=500&teamId=${id}` +
      `&fields=stats,group,displayName,splits,stat,age,plateAppearances,battersFaced`
    )
    const d = await r.json()
    let ageSum = 0, weight = 0
    for (const group of d.stats ?? []) {
      const pitching = group.group?.displayName === 'pitching'
      for (const s of group.splits ?? []) {
        const age = Number(s.stat?.age)
        const w = Number((pitching ? s.stat?.battersFaced : s.stat?.plateAppearances) ?? 0)
        if (!(age >= 17 && age <= 55) || !(w > 0)) continue
        ageSum += age * w
        weight += w
      }
    }
    if (weight > 0) out[Number(id)] = ageSum / weight
  }))
  return out
}

async function _buildTeamAges(season: number): Promise<Record<number, number>> {
  const r = await fetch(`https://statsapi.mlb.com/api/v1/sports/1/players?season=${season}&gameType=R`)
  const d = await r.json()
  const people: any[] = d.people ?? []
  const byTeam = new Map<number, number[]>()
  for (const p of people) {
    const teamId = Number(p.currentTeam?.id)
    const age = Number(p.currentAge)
    if (!teamId || !(age >= 17 && age <= 55)) continue
    if (!byTeam.has(teamId)) byTeam.set(teamId, [])
    byTeam.get(teamId)!.push(age)
  }
  const out: Record<number, number> = {}
  for (const [teamId, ages] of byTeam) {
    if (ages.length >= 5) out[teamId] = ages.reduce((s, a) => s + a, 0) / ages.length
  }
  return out
}

// ─── Roster moves (transactions feed) ─────────────────────────────────────────

export interface RosterMove {
  id:          number
  playerId:    number
  playerName:  string
  fromTeamId:  number | null   // MLB club, or null when that side is a minor-league/other roster
  toTeamId:    number | null
  date:        string          // YYYY-MM-DD
  typeCode:    string          // TR / DES / CLW / REL / SFA / SU, and DFA / R5 in the winter
  typeDesc:    string
  description: string
}

const rosterMovesCache = new Map<boolean, Promise<RosterMove[]>>()

/** The notable moves of the last few weeks, in season or Hot Stove mode (lib/rosterMoves.ts says
 *  which moves each one keeps, and why). One read per mode per page load. */
export function fetchRosterMoves(hotStove = false): Promise<RosterMove[]> {
  let p = rosterMovesCache.get(hotStove)
  if (!p) {
    p = computeRosterMoves(hotStove).catch(e => { rosterMovesCache.delete(hotStove); throw e })
    rosterMovesCache.set(hotStove, p)
  }
  return p
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function computeRosterMoves(hotStove: boolean): Promise<RosterMove[]> {
  const end   = new Date()
  const start = new Date(end.getTime() - moveWindowDays(hotStove) * 86400000)
  const r = await fetch(
    `https://statsapi.mlb.com/api/v1/transactions?sportId=1&startDate=${localYmd(start)}&endDate=${localYmd(end)}`
  )
  const d = await r.json()
  return pickMoves(d.transactions ?? [], hotStove)
}

// ─── Served-suspension check ──────────────────────────────────────────────────
//
// The transactions feed logs a suspension (SU) but has no matching reinstatement
// event when it ends. Reinstatements never appear. So anywhere an SU move
// is presented as *current state* (the followed-players badge), it would stick
// for the full 14-day window even after the player was back playing.
//
// The 40-man roster carries the live status instead: `SU` while the player is
// still serving, `A` once reinstated. Note the asymmetry below: a player missing
// from the roster entirely (suspended off the 40-man, restricted list) is
// "unknown", not "served", so the badge stays rather than being wrongly cleared.

const SUSPENDED_ROSTER_STATUS = 'SU'

const teamRosterStatusCache = new Map<number, Promise<Map<number, string>>>()

function fetchTeamRosterStatuses(teamId: number): Promise<Map<number, string>> {
  let p = teamRosterStatusCache.get(teamId)
  if (!p) {
    p = fetch(`https://statsapi.mlb.com/api/v1/teams/${teamId}/roster/40Man`)
      .then(r => r.json())
      .then(d => new Map<number, string>(
        (d.roster ?? [])
          .filter((e: any) => e.person?.id && e.status?.code)
          .map((e: any) => [Number(e.person.id), String(e.status.code)] as [number, string])
      ))
      .catch(e => { teamRosterStatusCache.delete(teamId); throw e })
    teamRosterStatusCache.set(teamId, p)
  }
  return p
}

/** Player ids whose SU move in `moves` is provably over (back on the roster as
 *  something other than suspended). Empty when nothing can be confirmed. */
export async function fetchServedSuspensionIds(moves: RosterMove[]): Promise<Set<number>> {
  const byTeam = new Map<number, number[]>()
  for (const m of moves) {
    if (m.typeCode !== 'SU') continue
    const teamId = m.toTeamId ?? m.fromTeamId
    if (teamId == null) continue
    byTeam.set(teamId, [...(byTeam.get(teamId) ?? []), m.playerId])
  }

  const served = new Set<number>()
  await Promise.all([...byTeam].map(async ([teamId, playerIds]) => {
    try {
      const statuses = await fetchTeamRosterStatuses(teamId)
      for (const id of playerIds) {
        const status = statuses.get(id)
        if (status && status !== SUSPENDED_ROSTER_STATUS) served.add(id)
      }
    } catch { /* unknown → leave the badge alone */ }
  }))
  return served
}

// ─── Team season stats + league ranks ─────────────────────────────────────────
//
// Powers the game-preview matchup comparison. The league-wide endpoint returns
// all 30 clubs in one request per group, which is what makes ranks possible:
// per-team requests would give values with nothing to rank them against. Two
// fetches total, module-cached for the session (season totals barely move
// day to day, and every preview card reuses the same numbers).

export type TeamStatKey = 'avg' | 'obp' | 'slg' | 'ops' | 'rpg' | 'hr' | 'era' | 'whip' | 'k9' | 'baa'

export interface TeamStatValue {
  display: string
  rank:    number     // 1 = best in MLB, ties share the better rank
  // Where the value sits in the league's range, 0 = worst, 1 = best. Already
  // direction-aware, so a long bar always means "good", including for ERA and
  // the other lower-is-better stats.
  pct:     number
}

export type TeamSeasonStats = Partial<Record<TeamStatKey, TeamStatValue>>

export interface TeamStatDef {
  key:    TeamStatKey
  label:  string
  group:  'hitting' | 'pitching'
  better: 'high' | 'low'
}

// Render order for the comparison table.
export const TEAM_STAT_DEFS: TeamStatDef[] = [
  { key: 'avg',  label: 'AVG',  group: 'hitting',  better: 'high' },
  { key: 'obp',  label: 'OBP',  group: 'hitting',  better: 'high' },
  { key: 'slg',  label: 'SLG',  group: 'hitting',  better: 'high' },
  { key: 'ops',  label: 'OPS',  group: 'hitting',  better: 'high' },
  { key: 'rpg',  label: 'R/G',  group: 'hitting',  better: 'high' },
  { key: 'hr',   label: 'HR',   group: 'hitting',  better: 'high' },
  { key: 'era',  label: 'ERA',  group: 'pitching', better: 'low'  },
  { key: 'whip', label: 'WHIP', group: 'pitching', better: 'low'  },
  { key: 'k9',   label: 'K/9',  group: 'pitching', better: 'high' },
  { key: 'baa',  label: 'BAA',  group: 'pitching', better: 'low'  },
]

// MLB innings notation: "887.2" is 887 innings and 2 *thirds*, not 887.2 innings.
function inningsToOuts(ip: string): number {
  const [whole, frac] = String(ip ?? '').split('.')
  return (Number(whole) || 0) * 3 + (Number(frac) || 0)
}

// Leading-zero-less rate stats (.263) are the convention for AVG/OBP/SLG/OPS.
function fmtRate(n: number): string {
  return n.toFixed(3).replace(/^0/, '')
}

async function fetchLeagueTeamSplits(group: 'hitting' | 'pitching'): Promise<any[]> {
  const r = await fetch(
    `https://statsapi.mlb.com/api/v1/teams/stats?season=${CURRENT_SEASON}&sportIds=1&group=${group}&stats=season`
  )
  const d = await r.json()
  return d.stats?.[0]?.splits ?? []
}

let teamSeasonStatsCache: Promise<Map<number, TeamSeasonStats>> | null = null

export function fetchTeamSeasonStats(): Promise<Map<number, TeamSeasonStats>> {
  if (!teamSeasonStatsCache) {
    teamSeasonStatsCache = computeTeamSeasonStats()
      .catch(e => { teamSeasonStatsCache = null; throw e })
  }
  return teamSeasonStatsCache
}

async function computeTeamSeasonStats(): Promise<Map<number, TeamSeasonStats>> {
  const [hitting, pitching] = await Promise.all([
    fetchLeagueTeamSplits('hitting'),
    fetchLeagueTeamSplits('pitching'),
  ])

  // Raw numeric value per team per stat, ranked below, then formatted for display.
  const raw = new Map<TeamStatKey, Map<number, number>>()
  const put = (key: TeamStatKey, teamId: number, value: number) => {
    if (!Number.isFinite(value)) return
    if (!raw.has(key)) raw.set(key, new Map())
    raw.get(key)!.set(teamId, value)
  }

  for (const s of hitting) {
    const id = Number(s.team?.id); if (!id) continue
    const st = s.stat ?? {}
    put('avg', id, Number(st.avg))
    put('obp', id, Number(st.obp))
    put('slg', id, Number(st.slg))
    put('ops', id, Number(st.ops))
    put('hr',  id, Number(st.homeRuns))
    // Runs per game, not total runs, since clubs sit on different game counts.
    if (Number(st.gamesPlayed) > 0) put('rpg', id, Number(st.runs) / Number(st.gamesPlayed))
  }

  for (const s of pitching) {
    const id = Number(s.team?.id); if (!id) continue
    const st = s.stat ?? {}
    put('era',  id, Number(st.era))
    put('whip', id, Number(st.whip))
    put('baa',  id, Number(st.avg))
    const outs = inningsToOuts(st.inningsPitched)
    if (outs > 0) put('k9', id, (Number(st.strikeOuts) * 27) / outs)
  }

  const fmt: Record<TeamStatKey, (n: number) => string> = {
    avg: fmtRate, obp: fmtRate, slg: fmtRate, ops: fmtRate, baa: fmtRate,
    rpg:  n => n.toFixed(2),
    hr:   n => String(Math.round(n)),
    era:  n => n.toFixed(2),
    whip: n => n.toFixed(2),
    k9:   n => n.toFixed(1),
  }

  const out = new Map<number, TeamSeasonStats>()
  for (const def of TEAM_STAT_DEFS) {
    const values = raw.get(def.key)
    if (!values) continue
    // Sort best-first, then walk assigning ranks; equal values share a rank.
    const sorted = [...values].sort((a, b) => def.better === 'high' ? b[1] - a[1] : a[1] - b[1])
    // League range for the bar scale: best and worst are the sorted ends.
    const best  = sorted[0][1]
    const worst = sorted[sorted.length - 1][1]
    const span  = Math.abs(best - worst)
    let rank = 0
    let prev: number | null = null
    sorted.forEach(([teamId, value], i) => {
      if (prev === null || value !== prev) rank = i + 1
      prev = value
      const entry = out.get(teamId) ?? {}
      entry[def.key] = {
        display: fmt[def.key](value),
        rank,
        pct: span === 0 ? 1 : Math.abs(value - worst) / span,
      }
      out.set(teamId, entry)
    })
  }
  return out
}

// ─── Playoff odds ─────────────────────────────────────────────────────────────

// One team's row from the nightly Monte Carlo. Shape mirrors the objects written
// by scripts/simulate-playoff-odds.mjs. Keep the two in sync.
export interface PlayoffOddsRow {
  teamId: number
  abbr: string
  teamName: string
  divisionId: number
  divisionName: string
  leagueId: number
  wins: number
  losses: number
  remaining: number
  strength: number
  makePlayoffs: number   // 0–1
  winDivision: number    // 0–1
  projWins: number
  projLosses: number
}

// A GitHub Action reruns the sim nightly (scripts/simulate-playoff-odds.mjs →
// playoff_odds table, one jsonb row per season). Unlike the streak boards there's
// no in-browser fallback (a full-schedule Monte Carlo is too heavy for the client),
// so a missing or stale row just means "odds unavailable" and callers hide the
// UI. The offseason sim aborts (no remaining games), leaving computed_at frozen,
// which is exactly when we want the stale check to hide last season's numbers.
const PLAYOFF_ODDS_STALE_MS = 72 * 3600 * 1000

export async function fetchPlayoffOdds(season: number): Promise<PlayoffOddsRow[] | null> {
  try {
    const { data } = await supabase
      .from('playoff_odds')
      .select('data, computed_at')
      .eq('season', season)
      .limit(1)
    const row = data?.[0]
    if (row?.data && Date.now() - new Date(row.computed_at).getTime() < PLAYOFF_ODDS_STALE_MS) {
      return row.data as PlayoffOddsRow[]
    }
  } catch { /* table missing or unreachable: treat as unavailable */ }
  return null
}

// ─── Milestone watch ──────────────────────────────────────────────────────────

// One active player's live milestone chase. Shape mirrors the objects written by
// scripts/update-milestones.mjs. Keep the two in sync.
export interface MilestoneItem {
  playerId:   number
  playerName: string
  teamId:     number
  teamAbbr:   string
  group:      'hitting' | 'pitching'
  statKey:    string
  statLabel:  string     // noun for the card, e.g. "HR", "strikeouts"
  current:    number
  target:     number
  remaining:  number
  window?:    number     // watch window for this stat: how far out the chase was picked up; drives the proximity meter
  kind:       'career' | 'season' | 'record'
  achievedOn?: string    // YYYY-MM-DD, present only on recently-reached milestones
}

// The card reads both the upcoming chases and the milestones just reached; the nightly
// script stores them together (plus a private totals snapshot it diffs against).
export interface MilestoneData {
  items:   MilestoneItem[]   // upcoming chases, closest first
  recent:  MilestoneItem[]   // reached in the last few days, newest first (⊂ reached)
  reached: MilestoneItem[]   // every milestone reached this season, newest first
}

// A GitHub Action recomputes this nightly (scripts/update-milestones.mjs →
// milestone_watch, one jsonb row per season). No in-browser fallback: recomputing
// would mean fetching every active player's career stats, so a missing or stale
// row just hides the card. Items arrive pre-sorted (records, then marquee, then by
// closeness). Once the regular season is over the job stops (scripts/mlb-job-due.mjs) and its last
// row is the season's final word, so an old row is read rather than hidden: it is what Milestone
// Watch's "Reached in 2026" archive draws from all winter.
const MILESTONE_STALE_MS = 72 * 3600 * 1000

export async function fetchMilestoneData(season: number): Promise<MilestoneData | null> {
  try {
    // Written once a night, so held for minutes (see lib/readCache.ts). An error is thrown out of
    // the cache rather than stored, and lands in the catch below as before.
    const row = await cachedRead(`milestone_watch:${season}`, FRESH_LONG_MS, async () => {
      const { data, error } = await supabase
        .from('milestone_watch')
        .select('data, computed_at')
        .eq('season', season)
        .limit(1)
      if (error) throw error
      return (data?.[0] ?? null) as { data: unknown; computed_at: string } | null
    })
    const fresh = !!row && Date.now() - new Date(row.computed_at).getTime() < MILESTONE_STALE_MS
    if (row?.data && (fresh || await seasonIsOver(season))) {
      const d = row.data as { items?: MilestoneItem[]; recent?: MilestoneItem[]; reached?: MilestoneItem[] }
      // `reached` is the season archive; fall back to `recent` for rows written before
      // the archive existed, so an un-migrated row still shows something under Reached.
      return { items: d.items ?? [], recent: d.recent ?? [], reached: d.reached ?? d.recent ?? [] }
    }
  } catch { /* table missing or unreachable: treat as unavailable */ }
  return null
}

// Chases only, kept for the milestone notification source, which doesn't care about
// the recently-reached list.
export async function fetchMilestoneWatch(season: number): Promise<MilestoneItem[] | null> {
  const d = await fetchMilestoneData(season)
  return d ? d.items : null
}

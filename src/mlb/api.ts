import { Player, Team, StatDef, TeamSummary, CareerStatSplit, RecentGameEntry, RosterEntry, StandingsDivision, TeamPlayerStat, TeamStandingInfo, SosEntry, LeaderboardEntry } from './types'
import { TEAM_ABBR, CURRENT_SEASON } from './constants'
import { supabase } from '../lib/supabase'
import { fetchSeasonPlayerStats } from './apiSeasonStats'

// Public API surface split across sibling modules — re-exported so existing
// `from '../api'` imports across the app keep resolving unchanged.
export { fetchSeasonPlayerStats } from './apiSeasonStats'
export * from './reportCardData'
export * from './apiContracts'

// ─── API helpers ─────────────────────────────────────────────────────────────

export async function searchPlayers(name: string): Promise<Player[]> {
  const r = await fetch(`https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}&sportId=1&hydrate=currentTeam`)
  const d = await r.json()
  const people: Player[] = d.people ?? []
  // Active players first, retired players after — covers the full modern era
  return people.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0))
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

// Completed seasons never change, so cache them; the current season updates daily and
// is always fetched fresh. Failures are evicted so a blip doesn't stick.
const seasonStatCache = new Map<string, Promise<any>>()

export function fetchStats(id: number, group: 'hitting' | 'pitching', season: number): Promise<any> {
  const run = () =>
    fetch(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=season&group=${group}&season=${season}`)
      .then(r => r.json())
      .then((d: any) => d.stats?.[0]?.splits?.[0]?.stat ?? null)
  if (season >= CURRENT_SEASON) return run()
  const key = `${id}-${group}-${season}`
  const cached = seasonStatCache.get(key)
  if (cached) return cached
  const p = run()
  seasonStatCache.set(key, p)
  p.catch(() => seasonStatCache.delete(key))
  return p
}

// Cache raw yearByYear splits so fetchCareerData and fetchPlayerCareerStats share one request per player/group
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

export async function fetchCareerData(id: number, groups: Array<'hitting' | 'pitching'>): Promise<{
  seasons: number[]
  teamsBySeason: Map<number, string[]>
  teamIdsBySeason: Map<number, number>
}> {
  const results = await Promise.all(groups.map(group => fetchYearByYearSplits(id, group)))
  const allSplits = results.flat()
  const teamsBySeason = new Map<number, string[]>()
  const teamIdsBySeason = new Map<number, number>()
  const seasons = new Set<number>()
  for (const split of allSplits) {
    const s = Number(split.season)
    if (!s) continue
    seasons.add(s)
    const teamId = Number(split.team?.id ?? 0)
    const abbr = TEAM_ABBR[teamId]
    if (abbr) {
      const existing = teamsBySeason.get(s) ?? []
      if (!existing.includes(abbr)) teamsBySeason.set(s, [...existing, abbr])
    }
    if (teamId && !teamIdsBySeason.has(s)) teamIdsBySeason.set(s, teamId)
  }
  return { seasons: [...seasons].sort((a, b) => b - a), teamsBySeason, teamIdsBySeason }
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
    const minPA = Math.round(maxGames * 3.1)   // batting qualification threshold
    const minIP = maxGames * 1.0                // pitching qualification threshold
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
  const r = await fetch('https://statsapi.mlb.com/api/v1/teams?sportId=1&activeStatus=Active')
  const d = await r.json()
  return (d.teams ?? []).sort((a: Team, b: Team) => a.name.localeCompare(b.name))
}

const teamStatsCache = new Map<string, Promise<any>>()

export async function fetchTeamStats(id: number, group: 'hitting' | 'pitching', season: number): Promise<any> {
  const key = `${id}-${group}-${season}`
  if (!teamStatsCache.has(key)) {
    teamStatsCache.set(key,
      fetch(`https://statsapi.mlb.com/api/v1/teams/${id}/stats?stats=season&group=${group}&season=${season}`)
        .then(r => r.json())
        .then((d: any) => d.stats?.[0]?.splits?.[0]?.stat ?? null)
        .catch(() => null)
    )
  }
  return teamStatsCache.get(key)!
}

// Fetch all player stats for a season and return structured entries for leaderboard display
export async function fetchLeaderboardData(
  group: 'hitting' | 'pitching',
  season: number
): Promise<LeaderboardEntry[]> {
  try {
    const splits = await fetchSeasonPlayerStats(group, season)
    return splits.map((s: any) => ({
      playerId: Number(s.player?.id),
      playerName: s.player?.fullName ?? '—',
      teamAbbr: s.team?.abbreviation ?? TEAM_ABBR[s.team?.id] ?? '—',
      teamId: Number(s.team?.id) || 0,
      stat: s.stat,
    })).filter((e: any) => e.playerId > 0)
  } catch {
    return []
  }
}


// ─── All-time (career) leaderboard ──────────────────────────────────────────────
// The career-stats endpoint holds ~22k players — far too many to fetch and sort
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
// the API can give it — sorted ascending within the Qualified pool it returns
// George McBride (.218) and Mark Belanger (.228), a genuine worst-hitters board —
// so we fetch that direction too and the reversed sort becomes truthful.
//
// Counting stats get no such treatment, because there is no meaningful answer to
// fetch: ascending career home runs is thousands of players tied on zero, and the
// endpoint returns an arbitrary handful of them. StatsView therefore refuses to
// sort those backwards at all rather than showing a list that means nothing.
type CareerSortSpec = { field: string; pool: 'All' | 'Qualified'; order: 'asc' | 'desc' }

const CAREER_SORTS: Record<'hitting' | 'pitching', CareerSortSpec[]> = {
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
  stat:       any
  /**
   * The API returned this player in a Qualified-pool request, i.e. they cleared
   * the career PA/IP minimum. Rate-stat leaderboards restrict to these: without
   * it a .000-in-1-AB cup-of-coffee player would top any ascending rate sort.
   */
  qualified:  boolean
}

const allTimeCache = new Map<'hitting' | 'pitching', Promise<AllTimeEntry[]>>()

export function fetchAllTimeLeaderboardData(group: 'hitting' | 'pitching'): Promise<AllTimeEntry[]> {
  if (!allTimeCache.has(group)) {
    const specs = CAREER_SORTS[group]
    const p = Promise.all(specs.map(spec =>
      fetch(`https://statsapi.mlb.com/api/v1/stats?stats=career&group=${group}&sportId=1&limit=100` +
        `&playerPool=${spec.pool}&sortStat=${spec.field}&order=${spec.order}`)
        .then(r => r.json())
        .then((d: any) => ({ spec, splits: (d.stats?.[0]?.splits ?? []) as any[] }))
        .catch(() => ({ spec, splits: [] as any[] }))
    )).then(results => {
      // Union by playerId. Career stat objects are complete regardless of which sort
      // surfaced a player, so first-wins dedup is safe for the stats themselves —
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
            stat: s.stat,
            qualified: spec.pool === 'Qualified',
          })
        }
      }
      return [...byId.values()]
    }).catch(() => [])
    allTimeCache.set(group, p)
  }
  return allTimeCache.get(group)!
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

export async function fetchCareerStats(id: number, group: 'hitting' | 'pitching'): Promise<any> {
  try {
    const r = await fetch(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=career&group=${group}&sportId=1`)
    const d = await r.json()
    return d.stats?.[0]?.splits?.[0]?.stat ?? null
  } catch {
    return null
  }
}

// ─── Career trends data ───────────────────────────────────────────────────────

export async function fetchPlayerCareerStats(id: number, groups: Array<'hitting' | 'pitching'>): Promise<CareerStatSplit[]> {
  const results = await Promise.all(
    groups.map(async group => ({ group, splits: await fetchYearByYearSplits(id, group) }))
  )

  const bySeasonHit     = new Map<number, any>()
  const bySeasonPit     = new Map<number, any>()
  const bySeasonTeamId  = new Map<number, number | null>()    // primary team (most games) for dot color
  const bySeasonAbbrs   = new Map<number, string[]>()         // all teams in chronological API order

  for (const { group, splits } of results) {
    const seasonMap = new Map<number, any[]>()
    for (const split of splits) {
      const s = Number(split.season)
      if (!s) continue
      if (!seasonMap.has(s)) seasonMap.set(s, [])
      seasonMap.get(s)!.push(split)
    }
    for (const [season, seasonSplits] of seasonMap) {
      // Collect all unique real-team abbreviations (API order = chronological)
      if (!bySeasonAbbrs.has(season)) {
        const abbrs: string[] = []
        for (const sp of seasonSplits) {
          const abbr = sp.team?.id ? (TEAM_ABBR[sp.team.id] ?? sp.team?.abbreviation ?? null) : null
          if (abbr && !abbrs.includes(abbr)) abbrs.push(abbr)
        }
        bySeasonAbbrs.set(season, abbrs)
      }

      // Pick the split with the most games for the stat value (and primary team color)
      const best = seasonSplits.reduce((a, b) =>
        (Number(b.stat?.gamesPlayed ?? b.stat?.gamesStarted ?? 0) >
         Number(a.stat?.gamesPlayed ?? a.stat?.gamesStarted ?? 0)) ? b : a
      )
      if (!bySeasonTeamId.has(season)) bySeasonTeamId.set(season, best.team?.id ?? null)
      if (group === 'hitting') bySeasonHit.set(season, best.stat)
      else bySeasonPit.set(season, best.stat)
    }
  }

  const allSeasons = [...new Set([...bySeasonHit.keys(), ...bySeasonPit.keys()])].sort((a, b) => a - b)
  return allSeasons.map(season => {
    const abbrs = bySeasonAbbrs.get(season) ?? []
    return {
      season,
      teamId:   bySeasonTeamId.get(season) ?? null,
      teamAbbr: abbrs.length > 0 ? abbrs.join('/') : null,
      hitting:  bySeasonHit.get(season) ?? null,
      pitching: bySeasonPit.get(season) ?? null,
    }
  })
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

const sosCache = new Map<number, Promise<SosEntry[]>>()

export function fetchStrengthOfSchedule(season: number): Promise<SosEntry[]> {
  if (!sosCache.has(season)) {
    sosCache.set(season, _buildSosEntries(season).catch(() => []))
  }
  return sosCache.get(season)!
}

async function _buildSosEntries(season: number): Promise<SosEntry[]> {
  const standings = await fetchStandingsCached(season)

  // Build lookup maps from standings
  const winPctMap = new Map<number, number>()
  const teamInfoMap = new Map<number, { abbr: string; teamName: string; wins: number; losses: number }>()
  for (const div of standings) {
    for (const t of div.teams) {
      winPctMap.set(t.teamId, parseFloat(t.pct) || 0)
      teamInfoMap.set(t.teamId, { abbr: t.abbr, teamName: t.teamName, wins: t.wins, losses: t.losses })
    }
  }

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

  // Build entries
  const entries: SosEntry[] = []
  for (const [teamId, info] of teamInfoMap) {
    const pcts = oppPcts.get(teamId) ?? []
    const avg = pcts.length > 0 ? pcts.reduce((s, p) => s + p, 0) / pcts.length : 0
    entries.push({
      teamId,
      abbr: info.abbr,
      teamName: info.teamName,
      remainingGames: pcts.length,
      oppWinPct: avg,
      wins: info.wins,
      losses: info.losses,
    })
  }

  return entries.sort((a, b) => b.oppWinPct - a.oppWinPct)
}

// The standings endpoint returns division objects with only {id, link} — no name field.
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

const teamAgeCache = new Map<number, Promise<Record<number, number>>>()

export function fetchTeamAverageAges(season: number): Promise<Record<number, number>> {
  if (!teamAgeCache.has(season)) {
    teamAgeCache.set(season, _buildTeamAges(season).catch(() => ({})))
  }
  return teamAgeCache.get(season)!
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
  typeCode:    string          // TR / DES / CLW / REL / SFA / SU
  typeDesc:    string
  description: string
}

// Move types worth surfacing. Everything else on the wire (options, recalls,
// rehab assignments, draft signings, paper status changes) is daily churn.
const NOTABLE_MOVE_TYPES = new Set(['TR', 'DES', 'CLW', 'REL', 'SFA', 'SU'])

const ROSTER_MOVE_DAYS = 14

let rosterMovesCache: Promise<RosterMove[]> | null = null

export function fetchRosterMoves(): Promise<RosterMove[]> {
  if (!rosterMovesCache) {
    rosterMovesCache = computeRosterMoves().catch(e => { rosterMovesCache = null; throw e })
  }
  return rosterMovesCache
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function computeRosterMoves(): Promise<RosterMove[]> {
  const end   = new Date()
  const start = new Date(end.getTime() - ROSTER_MOVE_DAYS * 86400000)
  const r = await fetch(
    `https://statsapi.mlb.com/api/v1/transactions?sportId=1&startDate=${localYmd(start)}&endDate=${localYmd(end)}`
  )
  const d = await r.json()
  const moves: RosterMove[] = []
  const seen = new Set<number>()
  for (const t of d.transactions ?? []) {
    if (!NOTABLE_MOVE_TYPES.has(t.typeCode) || !t.person?.id || seen.has(t.id)) continue
    const fromId = t.fromTeam?.id && TEAM_ABBR[t.fromTeam.id] ? Number(t.fromTeam.id) : null
    const toId   = t.toTeam?.id   && TEAM_ABBR[t.toTeam.id]   ? Number(t.toTeam.id)   : null
    // The feed includes minor-league paper moves — keep only moves touching an MLB club.
    if (fromId == null && toId == null) continue
    seen.add(t.id)
    moves.push({
      id: t.id, playerId: Number(t.person.id), playerName: t.person.fullName ?? '?',
      fromTeamId: fromId, toTeamId: toId,
      date: t.date ?? '', typeCode: t.typeCode, typeDesc: t.typeDesc ?? '',
      description: t.description ?? '',
    })
  }
  // Newest first; trades outrank other moves from the same day.
  moves.sort((a, b) =>
    b.date.localeCompare(a.date) ||
    Number(b.typeCode === 'TR') - Number(a.typeCode === 'TR'))
  return moves
}

// ─── Served-suspension check ──────────────────────────────────────────────────
//
// The transactions feed logs a suspension (SU) but has no matching reinstatement
// event when it ends — reinstatements simply never appear. So anywhere an SU move
// is presented as *current state* (the followed-players badge), it would stick
// for the full 14-day window even after the player was back playing.
//
// The 40-man roster carries the live status instead: `SU` while the player is
// still serving, `A` once reinstated. Note the asymmetry below — a player missing
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
// all 30 clubs in one request per group, which is what makes ranks possible —
// per-team requests would give values with nothing to rank them against. Two
// fetches total, module-cached for the session (season totals barely move
// day to day, and every preview card reuses the same numbers).

export type TeamStatKey = 'avg' | 'obp' | 'slg' | 'ops' | 'rpg' | 'hr' | 'era' | 'whip' | 'k9' | 'baa'

export interface TeamStatValue {
  display: string
  rank:    number     // 1 = best in MLB, ties share the better rank
  // Where the value sits in the league's range, 0 = worst, 1 = best. Already
  // direction-aware, so a long bar always means "good" — including for ERA and
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

  // Raw numeric value per team per stat — ranked below, then formatted for display.
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
    // Runs per game, not total runs — clubs sit on different game counts.
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
    // League range for the bar scale — best and worst are the sorted ends.
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

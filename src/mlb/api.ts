import { Player, Team, StatDef, TeamSummary, CareerStatSplit, RecentGameEntry, StandingsDivision, TeamPlayerStat, TeamStandingInfo } from './types'
import { TEAM_ABBR } from './constants'

// ─── API helpers ─────────────────────────────────────────────────────────────

export async function searchPlayers(name: string): Promise<Player[]> {
  const r = await fetch(`https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}&sportId=1&hydrate=currentTeam`)
  const d = await r.json()
  return (d.people ?? []).filter((p: Player) => p.active !== false)
}

export async function fetchPlayerDetails(id: number): Promise<Player | null> {
  const r = await fetch(`https://statsapi.mlb.com/api/v1/people/${id}?hydrate=currentTeam`)
  const d = await r.json()
  return d.people?.[0] ?? null
}

export async function fetchStats(id: number, group: 'hitting' | 'pitching', season: number) {
  const r = await fetch(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=season&group=${group}&season=${season}`)
  const d = await r.json()
  return d.stats?.[0]?.splits?.[0]?.stat ?? null
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
}> {
  const results = await Promise.all(groups.map(group => fetchYearByYearSplits(id, group)))
  const allSplits = results.flat()
  const teamsBySeason = new Map<number, string[]>()
  const seasons = new Set<number>()
  for (const split of allSplits) {
    const s = Number(split.season)
    if (!s) continue
    seasons.add(s)
    const abbr = TEAM_ABBR[split.team?.id]
    if (abbr) {
      const existing = teamsBySeason.get(s) ?? []
      if (!existing.includes(abbr)) teamsBySeason.set(s, [...existing, abbr])
    }
  }
  return { seasons: [...seasons].sort((a, b) => b - a), teamsBySeason }
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
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1/stats?stats=season&group=${group}&season=${season}&sportId=1&limit=2000`
    )
    const d = await r.json()
    const splits: any[] = d.stats?.[0]?.splits ?? []
    const map = new Map<string, number[]>()
    for (const def of defs) {
      if (!def.leaderCategory) continue
      const entries = splits
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
): Promise<Array<{ playerId: number; playerName: string; teamAbbr: string; teamId: number; stat: any }>> {
  try {
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1/stats?stats=season&group=${group}&season=${season}&sportId=1&limit=2000`
    )
    const d = await r.json()
    return (d.stats?.[0]?.splits ?? []).map((s: any) => ({
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

export async function fetchRecentGames(
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

  const bySeasonHit = new Map<number, any>()
  const bySeasonPit = new Map<number, any>()
  const bySeasonTeam = new Map<number, { id: number | null; abbr: string | null }>()

  for (const { group, splits } of results) {
    const seasonMap = new Map<number, any[]>()
    for (const split of splits) {
      const s = Number(split.season)
      if (!s) continue
      if (!seasonMap.has(s)) seasonMap.set(s, [])
      seasonMap.get(s)!.push(split)
    }
    for (const [season, seasonSplits] of seasonMap) {
      // Pick the split with the most games (handles traded players — biggest sample = combined/primary)
      const best = seasonSplits.reduce((a, b) =>
        (Number(b.stat?.gamesPlayed ?? b.stat?.gamesStarted ?? 0) >
         Number(a.stat?.gamesPlayed ?? a.stat?.gamesStarted ?? 0)) ? b : a
      )
      if (!bySeasonTeam.has(season)) {
        bySeasonTeam.set(season, {
          id: best.team?.id ?? null,
          abbr: (best.team?.id ? TEAM_ABBR[best.team.id] : null) ?? best.team?.abbreviation ?? null,
        })
      }
      if (group === 'hitting') bySeasonHit.set(season, best.stat)
      else bySeasonPit.set(season, best.stat)
    }
  }

  const allSeasons = [...new Set([...bySeasonHit.keys(), ...bySeasonPit.keys()])].sort((a, b) => a - b)
  return allSeasons.map(season => ({
    season,
    teamId: bySeasonTeam.get(season)?.id ?? null,
    teamAbbr: bySeasonTeam.get(season)?.abbr ?? null,
    hitting: bySeasonHit.get(season) ?? null,
    pitching: bySeasonPit.get(season) ?? null,
  }))
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
        divisionLeader: t.divisionLeader,
      }
    }
  }
  return null
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

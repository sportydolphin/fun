// Season-wide player stats: one cached network request per (group, season),
// shared by the leaderboard, per-stat rankings, the trends chart, and the
// report-card data module. Lives on its own so those consumers share it without
// importing back through the api.ts barrel (which would create a cycle).

// Cache the full "every player in a season" payload so the many consumers that
// need it (leaderboard, per-stat rankings, and the trends chart's league
// averages) all share a single network request per (group, season).
const seasonStatsCache = new Map<string, Promise<any[]>>()

/** `gameType` 'R' is the regular season, which is also what StatsAPI answers with none; 'P' is
 *  the postseason. There is no combined pool (see lib/gameScope.ts). */
export function fetchSeasonPlayerStats(group: 'hitting' | 'pitching', season: number, gameType: 'R' | 'P' = 'R'): Promise<any[]> {
  const key = `${group}-${season}-${gameType}`
  if (!seasonStatsCache.has(key)) {
    seasonStatsCache.set(key,
      fetch(`https://statsapi.mlb.com/api/v1/stats?stats=season&group=${group}&season=${season}&sportId=1&limit=2000&playerPool=All${gameType === 'P' ? '&gameType=P' : ''}`)
        .then(r => r.json())
        .then((d: any) => d.stats?.[0]?.splits ?? [])
        .catch(() => [])
    )
  }
  return seasonStatsCache.get(key)!
}

// wOBA and wRC+ for every hitter in a regular season: StatsAPI's `sabermetrics`, which carries the
// year's linear weights and park factors that nothing else here has. Read only when the Players
// table needs one of the two (its Advanced view, or a sort on either), so the default board costs
// no second request. There is no postseason pool (it answers empty), which is why the two columns
// are offered on the regular season alone. Keyed by player id; a failed read is an empty map, so
// the columns read "—" rather than taking the table down.
const sabermetricsCache = new Map<number, Promise<Map<number, { woba?: number; wrcPlus?: number }>>>()

export function fetchSeasonSabermetrics(season: number): Promise<Map<number, { woba?: number; wrcPlus?: number }>> {
  if (!sabermetricsCache.has(season)) {
    sabermetricsCache.set(season,
      fetch(`https://statsapi.mlb.com/api/v1/stats?stats=sabermetrics&group=hitting&season=${season}&sportId=1&limit=2000&playerPool=All`)
        .then(r => r.json())
        .then((d: any) => {
          const out = new Map<number, { woba?: number; wrcPlus?: number }>()
          for (const s of d.stats?.[0]?.splits ?? []) {
            const id = Number(s.player?.id)
            const woba = Number(s.stat?.woba), wrcPlus = Number(s.stat?.wRcPlus)
            if (id) out.set(id, { woba: Number.isFinite(woba) ? woba : undefined, wrcPlus: Number.isFinite(wrcPlus) ? wrcPlus : undefined })
          }
          return out
        })
        // Not cached, so the next visit to Advanced asks again.
        .catch(() => { sabermetricsCache.delete(season); return new Map() }))
  }
  return sabermetricsCache.get(season)!
}

// Each club's park factor for a season: what its home park does to scoring, from StatsAPI's team
// home and road splits, since StatsAPI publishes no park factor of its own (Savant's page answers
// HTML, not data). The classic run factor, (runs scored + allowed per home game) / (the same per
// road game), over the season and the two before it, because one year of a park is mostly noise.
// Keyed by club id, which survives a rename (Oakland to the Athletics), though not a move: the
// three years then straddle two parks, which is the price of having no venue on the split.
//
// HALVED before it is returned, (1 + PF) / 2, as Baseball-Reference and FanGraphs both do: half
// of a season is played on the road, so what applies to a player's line is half the home park's. A failed or short year is dropped rather than failing the read, and a club with no
// years at all is simply absent, which reads as neutral (lib/advanced.ts).
//
// `limit` IS REQUIRED: without it the endpoint answers the first 50 of 60 splits with no sign of
// it, which leaves ten clubs with a home half and no road half, or the reverse.
const parkFactorCache = new Map<number, Promise<Map<number, number>>>()
const PARK_FACTOR_YEARS = 3

async function teamHomeRoad(group: 'hitting' | 'pitching', season: number): Promise<any[]> {
  const d: any = await fetch(`https://statsapi.mlb.com/api/v1/teams/stats?stats=statSplits&sitCodes=h,a&group=${group}&season=${season}&sportId=1&limit=100`).then(r => r.json())
  const s = d.stats?.[0]
  const splits: any[] = s?.splits ?? []
  if (!splits.length || splits.length !== s?.totalSplits) throw new Error(`short ${group} splits for ${season}`)
  return splits
}

export function fetchParkFactors(season: number): Promise<Map<number, number>> {
  if (!parkFactorCache.has(season)) {
    const years = Array.from({ length: PARK_FACTOR_YEARS }, (_, i) => season - i)
    parkFactorCache.set(season, Promise.all(years.map(y =>
      Promise.all([teamHomeRoad('hitting', y), teamHomeRoad('pitching', y)]).catch(() => null)))
      .then(reads => {
        // Runs scored (hitting) and allowed (pitching) per club and side; games from the hitting half.
        const sums = new Map<number, { h: number; hg: number; a: number; ag: number }>()
        for (const read of reads) {
          if (!read) continue
          read.forEach((splits, i) => {
            for (const s of splits) {
              const id = Number(s.team?.id), side = s.split?.code === 'h' ? 'h' : 'a'
              if (!id) continue
              const t = sums.get(id) ?? { h: 0, hg: 0, a: 0, ag: 0 }
              t[side] += Number(s.stat?.runs) || 0
              if (i === 0) t[side === 'h' ? 'hg' : 'ag'] += Number(s.stat?.gamesPlayed) || 0
              sums.set(id, t)
            }
          })
        }
        const out = new Map<number, number>()
        for (const [id, t] of sums) {
          if (t.hg && t.ag && t.a) out.set(id, (1 + (t.h / t.hg) / (t.a / t.ag)) / 2)
        }
        if (!out.size) throw new Error('no park factors')
        return out
      })
      // Not cached, so the next visit asks again.
      .catch(() => { parkFactorCache.delete(season); return new Map<number, number>() }))
  }
  return parkFactorCache.get(season)!
}

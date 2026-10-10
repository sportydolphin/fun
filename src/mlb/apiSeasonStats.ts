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

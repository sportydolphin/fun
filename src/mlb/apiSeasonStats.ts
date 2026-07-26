// Season-wide player stats — one cached network request per (group, season),
// shared by the leaderboard, per-stat rankings, the trends chart, and the
// report-card data module. Lives on its own so those consumers share it without
// importing back through the api.ts barrel (which would create a cycle).

// Cache the full "every player in a season" payload so the many consumers that
// need it — leaderboard, per-stat rankings, and the trends chart's league
// averages — all share a single network request per (group, season).
const seasonStatsCache = new Map<string, Promise<any[]>>()

export function fetchSeasonPlayerStats(group: 'hitting' | 'pitching', season: number): Promise<any[]> {
  const key = `${group}-${season}`
  if (!seasonStatsCache.has(key)) {
    seasonStatsCache.set(key,
      fetch(`https://statsapi.mlb.com/api/v1/stats?stats=season&group=${group}&season=${season}&sportId=1&limit=2000&playerPool=All`)
        .then(r => r.json())
        .then((d: any) => d.stats?.[0]?.splits ?? [])
        .catch(() => [])
    )
  }
  return seasonStatsCache.get(key)!
}

import { fetchSeasonPlayerStats } from '../api'

// Helpers shared by RollingWindowChart and PlayerTrendsChart. Split out of
// PlayerTrendsChart.tsx (July 2026) so the rolling chart can live in its own file
// without either component importing the other.

// ─── League avg cache (module-level, keyed "hitting-2023") ────────────────────
//
// The raw per-season payload is fetched + cached once in api.ts and shared with
// the leaderboard / rankings; here we just cache the lighter mapped-to-`.stat`
// projection so repeated chart interactions don't re-map 2,000 rows each time.

const leagueStatsCache = new Map<string, Promise<any[]>>()
const LEAGUE_CACHE_MAX = 30

export function fetchLeagueStatsBySeason(season: number, group: 'hitting' | 'pitching'): Promise<any[]> {
  const key = `${group}-${season}`
  if (!leagueStatsCache.has(key)) {
    if (leagueStatsCache.size >= LEAGUE_CACHE_MAX) {
      // Evict oldest entry (Map iteration order = insertion order)
      leagueStatsCache.delete(leagueStatsCache.keys().next().value!)
    }
    leagueStatsCache.set(key,
      fetchSeasonPlayerStats(group, season).then(splits => splits.map((s: any) => s.stat))
    )
  }
  return leagueStatsCache.get(key)!
}

// ─── Hover-tooltip anchoring (shared by both chart tooltips) ─────────────────
//
// Always anchored above the hovered/touched point — never below — per design:
// a tooltip below the point gets covered by a finger on touch, and showing it
// on one side sometimes and the other side other times reads as inconsistent.
// The gap between the point and the tooltip differs by input: on touch, a
// finger occludes a wide area around the contact point, so the tooltip needs
// real clearance; a mouse cursor is a single pixel, so it can sit right above it.
export function tooltipAnchorSx(tipPos: { x: number; y: number }, canHover: boolean) {
  const gapPx = canHover ? 10 : 40
  const tipLeft = Math.min(Math.max(tipPos.x, 12), 82)
  return {
    left: `${tipLeft}%`,
    top: `calc(${tipPos.y}% - ${gapPx}px)`,
    transform: 'translate(-50%, -100%)',
  } as const
}

// ─── Smart stat selection ─────────────────────────────────────────────────────
//
// When a player is loaded we pick stats automatically:
//   • A small set of always-on core stats (avg/hr/rbi/ops for hitters, etc.)
//   • Any additional stat where the player ranks in the top-N league-wide
//
// The result is ordered the same way the STAT_DEFS arrays are ordered so the
// card layout is consistent regardless of which bonus stats get added.

import { HITTING_STAT_DEFS, PITCHING_STAT_DEFS } from '../constants'

export const HIT_TOP_N = 20  // rank threshold for bonus hitting stats
export const PIT_TOP_N = 20  // rank threshold for bonus pitching stats

// Core hitting stats always shown regardless of rank
export const HIT_ALWAYS = new Set(['avg', 'hr', 'rbi', 'ops'])
// Bonus hitting stats shown when the player ranks in the top-N
export const HIT_BONUS = ['h', '2b', '3b', 'obp', 'slg', 'bb', 'sb', 'k']

// Core pitching stats always shown
export const PIT_ALWAYS = new Set(['wl', 'era', 'ip', 'whip', 'k'])
// Bonus pitching stats shown when the player ranks top-N
// (sv is already auto-injected by CardInner for closers, so we skip it here)
export const PIT_BONUS = ['so9']

export function computeSmartHitStats(playerId: number, leaders: Map<string, number[]>): string[] {
  const show = new Set(HIT_ALWAYS)
  for (const key of HIT_BONUS) {
    const def = HITTING_STAT_DEFS.find(d => d.key === key)
    if (!def?.leaderCategory) continue
    const ids = leaders.get(def.leaderCategory) ?? []
    const rank = ids.indexOf(playerId)
    if (rank !== -1 && rank < HIT_TOP_N) show.add(key)
  }
  return HITTING_STAT_DEFS.filter(d => show.has(d.key)).map(d => d.key)
}

export function computeSmartPitStats(playerId: number, leaders: Map<string, number[]>): string[] {
  const show = new Set(PIT_ALWAYS)
  for (const key of PIT_BONUS) {
    const def = PITCHING_STAT_DEFS.find(d => d.key === key)
    if (!def?.leaderCategory) continue
    const ids = leaders.get(def.leaderCategory) ?? []
    const rank = ids.indexOf(playerId)
    if (rank !== -1 && rank < PIT_TOP_N) show.add(key)
  }
  return PITCHING_STAT_DEFS.filter(d => show.has(d.key)).map(d => d.key)
}

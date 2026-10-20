// Recent WPBL searches: WPBL's binding of the shared store in src/lib/recentSearches.ts, synced to
// `user_preferences.wpbl_recent_searches`.
//
// Deliberately NOT MLB's list (`user_preferences.recent_searches`): that one is keyed on numeric
// StatsAPI ids and rendered from MLB's team colors and headshots. WPBL ids are string uuids and
// its avatars are its own, so a shared list would either corrupt MLB recents or render WPBL rows
// blank. Each row's avatar and subtitle are rebuilt from the live roster at render time (so a
// traded player's tint and club follow them), which is why only the id, type and name are stored.

import { useRecents, type RecentStore } from '../lib/recentSearches'

export interface WpblRecentItem {
  type: 'player' | 'team'
  id:   string   // player uuid, or team id (also a string in this section)
  name: string
}

function isValid(x: unknown): x is WpblRecentItem {
  const r = x as WpblRecentItem
  return !!r && (r.type === 'player' || r.type === 'team') && typeof r.id === 'string' && typeof r.name === 'string'
}

const WPBL_RECENTS: RecentStore<WpblRecentItem> = {
  key: 'wpbl_recent_searches', column: 'wpbl_recent_searches', max: 8, isValid,
}

export const useWpblRecents = (userId: string | null) => useRecents(WPBL_RECENTS, userId)

// Recent MLB searches: MLB's binding of the shared store in src/lib/recentSearches.ts, synced to
// `user_preferences.recent_searches`. Its items carry what MLB's rows draw from (the club for a
// player's logo tint, the position for the subtitle), so they are not WPBL's.

import { useRecents, type RecentStore } from '../../lib/recentSearches'

export interface RecentSearchItem {
  type:      'player' | 'team'
  id:        number
  name:      string
  teamId?:   number   // player → their team id (for the logo tint); team → same as id
  position?: string   // player position abbreviation, for the row subtitle
}

function isValid(x: unknown): x is RecentSearchItem {
  const r = x as RecentSearchItem
  return !!r && (r.type === 'player' || r.type === 'team') && typeof r.id === 'number' && typeof r.name === 'string'
}

const MLB_RECENTS: RecentStore<RecentSearchItem> = {
  key: 'mlb_recent_searches', column: 'recent_searches', max: 12, isValid,
}

export const useMlbRecents = (userId: string | null) => useRecents(MLB_RECENTS, userId)

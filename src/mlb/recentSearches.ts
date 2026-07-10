// Recent searches — the players and teams a user has opened, most-recent first.
// Stored in localStorage (works logged-out / offline) and, when signed in, mirrored
// to the user_preferences.recent_searches column so they sync across devices.

export interface RecentSearchItem {
  type:      'player' | 'team'
  id:        number
  name:      string
  teamId?:   number   // player → their team id (for the logo tint); team → same as id
  position?: string   // player position abbreviation, for the row subtitle
}

const KEY = 'mlb_recent_searches'
export const RECENT_MAX = 12

function isValid(x: any): x is RecentSearchItem {
  return x && (x.type === 'player' || x.type === 'team') && typeof x.id === 'number' && typeof x.name === 'string'
}

export function getLocalRecentSearches(): RecentSearchItem[] {
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter(isValid).slice(0, RECENT_MAX) : []
  } catch { return [] }
}

export function setLocalRecentSearches(items: RecentSearchItem[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(items.slice(0, RECENT_MAX))) } catch {}
}

// Move `item` to the front, dedup by type+id, cap the list.
export function mergeRecent(list: RecentSearchItem[], item: RecentSearchItem): RecentSearchItem[] {
  if (!isValid(item)) return list
  const deduped = list.filter(x => !(x.type === item.type && x.id === item.id))
  return [item, ...deduped].slice(0, RECENT_MAX)
}

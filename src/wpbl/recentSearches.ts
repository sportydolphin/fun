// Recent WPBL searches — the players and teams a user has opened from the header search,
// most-recent first. localStorage only (works logged-out / offline).
//
// Deliberately NOT the MLB `RecentSearchItem` / `user_preferences.recent_searches` path:
// that store is keyed on numeric StatsAPI ids and is rendered from the MLB team-color map
// and mlbstatic headshot URLs. WPBL ids are string uuids and its avatars are its own, so a
// shared store would either corrupt MLB recents or render WPBL rows blank. The section owns
// its own tiny list here and rebuilds each row's avatar/subtitle from the live roster at
// render time (so a traded player's tint and team follow her), which is why only the id,
// type and name are stored.

export interface WpblRecentItem {
  type: 'player' | 'team'
  id:   string   // player uuid, or team id (also a string in this section)
  name: string
}

const KEY = 'wpbl_recent_searches'
export const WPBL_RECENT_MAX = 8

function isValid(x: unknown): x is WpblRecentItem {
  const r = x as WpblRecentItem
  return !!r && (r.type === 'player' || r.type === 'team') && typeof r.id === 'string' && typeof r.name === 'string'
}

export function getWpblRecents(): WpblRecentItem[] {
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter(isValid).slice(0, WPBL_RECENT_MAX) : []
  } catch { return [] }
}

export function setWpblRecents(items: WpblRecentItem[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(items.slice(0, WPBL_RECENT_MAX))) } catch { /* private mode / quota */ }
}

// Move `item` to the front, dedup by type+id, cap the list.
export function mergeWpblRecent(list: WpblRecentItem[], item: WpblRecentItem): WpblRecentItem[] {
  if (!isValid(item)) return list
  const deduped = list.filter(x => !(x.type === item.type && x.id === item.id))
  return [item, ...deduped].slice(0, WPBL_RECENT_MAX)
}

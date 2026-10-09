// Recent WPBL searches: the players and teams a user has opened from the header search,
// most-recent first. localStorage always (works logged-out / offline) and, when signed in,
// mirrored to `user_preferences.wpbl_recent_searches` so they follow the reader across devices,
// as MLB's do.
//
// Deliberately NOT the MLB `RecentSearchItem` / `user_preferences.recent_searches` list:
// that store is keyed on numeric StatsAPI ids and is rendered from the MLB team-color map
// and mlbstatic headshot URLs. WPBL ids are string uuids and its avatars are its own, so a
// shared store would either corrupt MLB recents or render WPBL rows blank. The section owns
// its own tiny list here and rebuilds each row's avatar/subtitle from the live roster at
// render time (so a traded player's tint and team follow them), which is why only the id,
// type and name are stored.

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ensureActiveUser } from '../lib/userActive'

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

export function cleanWpblRecents(arr: unknown): WpblRecentItem[] {
  return Array.isArray(arr) ? arr.filter(isValid).slice(0, WPBL_RECENT_MAX) : []
}

export function getWpblRecents(): WpblRecentItem[] {
  try {
    const raw = localStorage.getItem(KEY)
    return cleanWpblRecents(raw ? JSON.parse(raw) : [])
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

// `first` in its own order, then whatever of `rest` it lacks, capped.
export function unionWpblRecents(first: WpblRecentItem[], rest: WpblRecentItem[]): WpblRecentItem[] {
  const seen = new Set(first.map(x => `${x.type}:${x.id}`))
  return [...first, ...rest.filter(x => !seen.has(`${x.type}:${x.id}`))].slice(0, WPBL_RECENT_MAX)
}

// null means "could not read", which the caller must tell apart from "stored nothing": on a
// failed read the local list stays and is NOT pushed up, or a network blip would overwrite the
// reader's other devices with whatever this one happened to hold.
export async function loadWpblRecentsRemote(userId: string): Promise<WpblRecentItem[] | null> {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('wpbl_recent_searches')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return null
  return cleanWpblRecents((data as { wpbl_recent_searches?: unknown } | null)?.wpbl_recent_searches)
}

export async function saveWpblRecentsRemote(userId: string, items: WpblRecentItem[]): Promise<void> {
  if (!(await ensureActiveUser(userId))) return
  // Upserts only this column; the row's other preferences are left untouched.
  const { error } = await supabase
    .from('user_preferences')
    .upsert({ user_id: userId, wpbl_recent_searches: items, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) { /* localStorage still holds them */ }
}

const SAVE_DEBOUNCE_MS = 800

/**
 * The section's recents list, synced for a signed-in reader. On sign-in the stored list wins
 * when it has anything in it, the way MLB's does, and an empty one is seeded from this device.
 * Writes are debounced and happen only on a real change (`record`, `clear`), never because the
 * list was just loaded, so opening the site on a second device cannot echo the first back.
 */
export function useWpblRecents(userId: string | null) {
  const [items, setItems] = useState<WpblRecentItem[]>(getWpblRecents)
  // The handlers read the list from here rather than inside a setState updater, which StrictMode
  // runs twice and which is the wrong place for a write to storage and a timer.
  const itemsRef = useRef(items)
  const userRef = useRef(userId)
  userRef.current = userId
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; run: () => void } | null>(null)

  const flush = useCallback(() => {
    const p = pending.current
    if (!p) return
    clearTimeout(p.timer)
    pending.current = null
    p.run()
  }, [])

  const commit = useCallback((next: WpblRecentItem[]) => {
    itemsRef.current = next
    setItems(next)
    setWpblRecents(next)
    const uid = userRef.current
    if (!uid) return
    if (pending.current) clearTimeout(pending.current.timer)
    const run = () => { void saveWpblRecentsRemote(uid, next) }
    pending.current = { run, timer: setTimeout(() => { pending.current = null; run() }, SAVE_DEBOUNCE_MS) }
  }, [])

  // A pick made just before the section unmounts (a switch to /mlb) still reaches the server.
  useEffect(() => flush, [flush])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const before = itemsRef.current
    loadWpblRecentsRemote(userId).then(remote => {
      if (cancelled || remote === null) return
      if (itemsRef.current !== before) {
        // A pick landed while the read was in flight. Replacing the list would drop it, so
        // keep this device's newest first and fill the rest from the stored list.
        commit(unionWpblRecents(itemsRef.current, remote))
      } else if (remote.length > 0) {
        itemsRef.current = remote
        setItems(remote)
        setWpblRecents(remote)
      } else if (itemsRef.current.length > 0) {
        void saveWpblRecentsRemote(userId, itemsRef.current)
      }
    })
    return () => { cancelled = true }
  }, [userId, commit])

  const record = useCallback((item: WpblRecentItem) => commit(mergeWpblRecent(itemsRef.current, item)), [commit])
  const clear = useCallback(() => commit([]), [commit])
  return { items, record, clear }
}

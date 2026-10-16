// Recent searches: the players and clubs a reader has opened from the header search, most recent
// first. Kept in localStorage always (it works signed out and offline) and, for a signed-in
// reader, mirrored to a `user_preferences` column so the list follows them across devices.
//
// One store and two lists. Each section binds its own key, column, cap and item shape
// (mlb/storage/recentSearches.ts, wpbl/recentSearches.ts), because the items cannot mix: MLB's
// ids are StatsAPI numbers drawn from MLB's colour map and headshots, WPBL's are uuids drawn from
// its own roster, so a shared list would render one section's rows blank in the other. Until
// Oct 15, 2026 the two sections also kept two copies of this code, and MLB's lacked what WPBL's
// had learned: a pick made while the stored list was loading was lost, and a pick made just
// before leaving the section never reached the server.

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { ensureActiveUser } from './userActive'

interface RecentLike { type: 'player' | 'team'; id: string | number }

export interface RecentStore<T extends RecentLike> {
  /** The localStorage key. */
  key: string
  /** The `user_preferences` column the list syncs to. */
  column: string
  max: number
  isValid: (x: unknown) => x is T
}

const keyOf = (x: RecentLike) => `${x.type}:${x.id}`

function clean<T extends RecentLike>(store: RecentStore<T>, arr: unknown): T[] {
  return Array.isArray(arr) ? arr.filter(store.isValid).slice(0, store.max) : []
}

function getLocal<T extends RecentLike>(store: RecentStore<T>): T[] {
  try {
    const raw = localStorage.getItem(store.key)
    return clean(store, raw ? JSON.parse(raw) : [])
  } catch { return [] }
}

function setLocal<T extends RecentLike>(store: RecentStore<T>, items: T[]): void {
  try { localStorage.setItem(store.key, JSON.stringify(items.slice(0, store.max))) } catch { /* private mode / quota */ }
}

/** Move `item` to the front, dedup by type and id, cap the list. */
function mergeRecentItem<T extends RecentLike>(store: RecentStore<T>, list: T[], item: T): T[] {
  if (!store.isValid(item)) return list
  return [item, ...list.filter(x => keyOf(x) !== keyOf(item))].slice(0, store.max)
}

/** `first` in its own order, then whatever of `rest` it lacks, capped. */
function unionRecents<T extends RecentLike>(store: RecentStore<T>, first: T[], rest: T[]): T[] {
  const seen = new Set(first.map(keyOf))
  return [...first, ...rest.filter(x => !seen.has(keyOf(x)))].slice(0, store.max)
}

// null means "could not read", which the caller must tell apart from "stored nothing": on a
// failed read the local list stays and is NOT pushed up, or a network blip would overwrite the
// reader's other devices with whatever this one happened to hold.
async function loadRemote<T extends RecentLike>(store: RecentStore<T>, userId: string): Promise<T[] | null> {
  const { data, error } = await supabase
    .from('user_preferences')
    .select(store.column)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return null
  return clean(store, (data as unknown as Record<string, unknown> | null)?.[store.column])
}

async function saveRemote<T extends RecentLike>(store: RecentStore<T>, userId: string, items: T[]): Promise<void> {
  if (!(await ensureActiveUser(userId))) return
  // Upserts only this column; the row's other preferences are left untouched.
  const { error } = await supabase
    .from('user_preferences')
    .upsert({ user_id: userId, [store.column]: items, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) { /* localStorage still holds them */ }
}

const SAVE_DEBOUNCE_MS = 800

/**
 * A section's recents list, synced for a signed-in reader. On sign-in the stored list wins when it
 * has anything in it, and an empty one is seeded from this device. Writes are debounced and happen
 * only on a real change (`record`, `clear`), never because the list was just loaded, so opening
 * the site on a second device cannot echo the first back.
 */
export function useRecents<T extends RecentLike>(store: RecentStore<T>, userId: string | null) {
  const [items, setItems] = useState<T[]>(() => getLocal(store))
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

  const commit = useCallback((next: T[]) => {
    itemsRef.current = next
    setItems(next)
    setLocal(store, next)
    const uid = userRef.current
    if (!uid) return
    if (pending.current) clearTimeout(pending.current.timer)
    const run = () => { void saveRemote(store, uid, next) }
    pending.current = { run, timer: setTimeout(() => { pending.current = null; run() }, SAVE_DEBOUNCE_MS) }
  }, [store])

  // A pick made just before the section unmounts (a switch to the other section) still reaches
  // the server.
  useEffect(() => flush, [flush])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const before = itemsRef.current
    loadRemote(store, userId).then(remote => {
      if (cancelled || remote === null) return
      if (itemsRef.current !== before) {
        // A pick landed while the read was in flight. Replacing the list would drop it, so
        // keep this device's newest first and fill the rest from the stored list.
        commit(unionRecents(store, itemsRef.current, remote))
      } else if (remote.length > 0) {
        itemsRef.current = remote
        setItems(remote)
        setLocal(store, remote)
      } else if (itemsRef.current.length > 0) {
        void saveRemote(store, userId, itemsRef.current)
      }
    })
    return () => { cancelled = true }
  }, [store, userId, commit])

  const record = useCallback((item: T) => commit(mergeRecentItem(store, itemsRef.current, item)), [store, commit])
  const clear = useCallback(() => commit([]), [commit])
  return { items, record, clear }
}

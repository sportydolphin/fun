import { useSyncExternalStore } from 'react'

// How far this reader got through each video. Per browser, in localStorage, wrapped like newSince.ts:
// a blocked store must mean "no progress shown", never a thrown render. It imports nothing but React,
// and the player writes it, so every surface that plays a video records the same way.
//
// ONE STORE WITH ONE WRITE PATH, NOT A KEY PER VIDEO. A key per video would need 441 reads to draw
// the Clips shelf; this is one JSON read, cached for the session, and capped so it cannot grow without
// bound on a reader who watches everything.

interface Entry { t: number; d: number; done?: 1; at: number }

const KEY = 'sdWatchProgress'
const CAP = 300
/** Past this share the video counts as watched, because the last few percent of a broadcast is a
 *  closing card that nobody sits through. */
const DONE_SHARE = 0.95
/** Under this much in, resuming would only skip the opening of something barely started. */
const RESUME_FROM_SECONDS = 15

let cache: Record<string, Entry> | null = null
const listeners = new Set<() => void>()

function all(): Record<string, Entry> {
  if (cache) return cache
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    cache = parsed && typeof parsed === 'object' ? parsed as Record<string, Entry> : {}
  } catch {
    cache = {}
  }
  return cache
}

function put(id: string, entry: Entry): void {
  const next = { ...all(), [id]: entry }
  const ids = Object.keys(next)
  if (ids.length > CAP) {
    ids.sort((a, b) => next[a].at - next[b].at).slice(0, ids.length - CAP).forEach(old => { delete next[old] })
  }
  cache = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* nothing to keep it in */ }
  listeners.forEach(fn => fn())
}

/** Record a position. A finished video stays finished when it is rewatched and paused early, so the
 *  shelf does not lose the mark. */
export function saveProgress(id: string, seconds: number, duration: number): void {
  if (!(duration > 0) || !(seconds >= 0)) return
  const was = all()[id]
  const done = was?.done || seconds / duration >= DONE_SHARE
  put(id, { t: seconds, d: duration, at: Date.now(), ...(done ? { done: 1 as const } : null) })
}

export function markWatched(id: string, duration: number): void {
  put(id, { t: duration, d: duration, at: Date.now(), done: 1 })
}

/** Where to start this video, or 0 from the top. A finished video starts over. */
export function resumeAt(id: string): number {
  const e = all()[id]
  if (!e || e.done || e.t < RESUME_FROM_SECONDS) return 0
  return Math.floor(e.t)
}

/** How much of it has been watched, 0 to 1. */
export function watchedShare(id: string): number {
  const e = all()[id]
  if (!e) return 0
  return e.done ? 1 : Math.min(1, e.d > 0 ? e.t / e.d : 0)
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** `watchedShare`, kept current while the video plays. */
export function useWatchedShare(id: string): number {
  return useSyncExternalStore(subscribe, () => watchedShare(id), () => 0)
}

const NO_IDS: string[] = []
let startedCache: { from: Record<string, Entry>; ids: string[] } | null = null

/** Every video started and not finished, most recently watched first. Held per version of the store,
 *  because a store snapshot must be the same array until something actually changes. */
function started(): string[] {
  const store = all()
  if (startedCache?.from === store) return startedCache.ids
  const ids = Object.keys(store)
    .filter(id => resumeAt(id) > 0)
    .sort((a, b) => store[b].at - store[a].at)
  startedCache = { from: store, ids }
  return ids
}

/** The list a Continue watching row draws, kept current. */
export function useStartedVideos(): string[] {
  return useSyncExternalStore(subscribe, started, () => NO_IDS)
}

/** Forget the cached read, for a test that resets localStorage. */
export function resetProgressCache(): void { cache = null }

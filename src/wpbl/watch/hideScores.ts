import { useSyncExternalStore } from 'react'

// Whether this reader wants scores kept off Watch, so a game can be watched without knowing how it
// ended. One browser's choice in localStorage, wrapped like the rest: a blocked store means scores
// show, as they did before there was a setting. A store with a subscribe rather than a useState,
// because the shelf and the video page mounted beside it must flip together.

const KEY = 'sdWatchHideScores'
const listeners = new Set<() => void>()
let value: boolean | null = null

function read(): boolean {
  if (value != null) return value
  try { value = localStorage.getItem(KEY) === '1' } catch { value = false }
  return value
}

export function setHideScores(on: boolean): void {
  value = on
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* lasts the visit */ }
  listeners.forEach(fn => fn())
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function useHideScores(): boolean {
  return useSyncExternalStore(subscribe, read, () => false)
}

/** Forget the cached read, for a test that resets localStorage. */
export function resetHideScores(): void { value = null }

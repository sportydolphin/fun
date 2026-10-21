import { useSyncExternalStore } from 'react'

// How much glass the bottom bar has, 0 (nearly solid) to 1 (clear), as one dial. Set only from the
// dev settings gear while the level is being tuned by eye; production never writes it, so every
// reader gets GLASS_DEFAULT. It lives here rather than in DevSettings because BottomNav ships and
// must not import the dev menu (that would pull the simulators into the bundle).

const KEY = 'sdNavGlass'
export const GLASS_DEFAULT = 0.5

// null when nobody has set a level, which is every production reader.
const read = (): number | null => {
  try {
    const raw = localStorage.getItem(KEY)
    const v = Number(raw)
    return raw != null && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null
  } catch { return null }
}

let level: number | null = read()
const listeners = new Set<() => void>()

export function setGlassLevel(next: number | null) {
  try {
    if (next == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, String(next))
  } catch { /* storage blocked: the level still applies for this page */ }
  level = next == null ? null : Math.min(1, Math.max(0, next))
  listeners.forEach(l => l())
}

export const glassLevel = () => level

// The dev menu's Mobile mode runs the app in a same-origin iframe with its own copy of this module,
// so the dial in the parent reaches the bar inside only through storage.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key !== KEY) return
    level = read()
    listeners.forEach(l => l())
  })
}

/** The level set by hand, or null for the shipped default. A set level also overrides the
 *  reader's reduced-transparency preference, which matters on the dev machine: Windows with
 *  transparency effects off reports `reduce` to Chrome, and the dial would otherwise move nothing. */
export function useGlassLevel(): number | null {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => { listeners.delete(cb) } },
    glassLevel,
    () => null,
  )
}

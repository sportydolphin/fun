// The section's core reads as they were on this device's last visit, for a first paint that does
// not wait on the network.
//
// WHY. Every WPBL tab drew its skeleton until teams and the schedule came back (WpblApp's
// `loading`), then Home's leaders until players and lines did: a few hundred milliseconds on a
// good connection and seconds on a phone, on every visit, for data that between two visits has
// usually not changed at all (and in the offseason cannot). A returning reader now gets the last
// copy on the first frame and the fresh one a round trip later, in the same boxes, so nothing
// moves when it lands. MLB's bracket has done this since Sep 2026 (`seededBracket`).
//
// A SEED IS NEVER FRESH. api.ts installs it with `at: 0`, which every freshness check reads as
// stale, so each one is revalidated by the first read that asks; a seed only ever stands in for
// the network until the network answers. Older than MAX_AGE it is ignored, and VERSION is bumped
// whenever a stored shape changes, which retires every old copy at once.
//
// LAZY ON THE WAY IN, so a visit that never draws a stat line never parses half a megabyte of
// them; DEFERRED AND THROTTLED on the way out, so a live poll is not a storage write every tick.
// Best effort throughout: storage may be off, full, or cleared, and every failure means only
// "no seed", which is exactly the behaviour before this file existed. Never under Vitest, where
// one test's seed would quietly become the next test's starting state.

const VERSION = 1
const PREFIX = `sd:wpbl-seed:v${VERSION}:`
const MAX_AGE_MS = 30 * 86_400_000
const WRITE_AFTER_MS = 2_000
const WRITE_EVERY_MS = 60_000

let enabled = import.meta.env.MODE !== 'test'


/** The stored copy of `name`, when there is one young enough and of the expected shape. */
export function readSeed<T>(name: string, valid: (d: unknown) => d is T): T | null {
  if (!enabled) return null
  try {
    const raw = localStorage.getItem(PREFIX + name)
    if (!raw) return null
    const { at, data } = JSON.parse(raw) as { at?: number; data?: unknown }
    if (typeof at !== 'number' || Date.now() - at > MAX_AGE_MS || !valid(data)) return null
    return data
  } catch {
    return null
  }
}

const pending = new Map<string, unknown>()
const lastWrite = new Map<string, number>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

/** Remember `data` as the seed for `name`, a moment from now and at most once a minute. */
export function writeSeed(name: string, data: unknown): void {
  if (!enabled) return
  pending.set(name, data)
  if (timers.has(name)) return
  const wait = Math.max(WRITE_AFTER_MS, (lastWrite.get(name) ?? 0) + WRITE_EVERY_MS - Date.now())
  timers.set(name, setTimeout(() => {
    timers.delete(name)
    const latest = pending.get(name)
    pending.delete(name)
    lastWrite.set(name, Date.now())
    try {
      localStorage.setItem(PREFIX + name, JSON.stringify({ at: Date.now(), data: latest }))
    } catch {
      // Most likely full. A half-kept seed is worse than none, so drop this one.
      try { localStorage.removeItem(PREFIX + name) } catch { /* storage off */ }
    }
  }, wait))
}

/** Test seam: turn the seed on (or off) under Vitest, forgetting any write still waiting. */
export function __setSeedEnabled(on: boolean): void {
  enabled = on
  for (const t of timers.values()) clearTimeout(t)
  timers.clear(); pending.clear(); lastWrite.clear()
}

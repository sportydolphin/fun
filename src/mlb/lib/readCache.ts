// One memory cache for the MLB section's reads, keyed by what was asked.
//
// WHY IT EXISTS. The section unmounts whenever the reader switches to WPBL, and every card on Home
// fetches on mount, so a reader flipping MLB, WPBL, MLB re-ran twenty requests for data a minute
// old: today's schedule four ways, three followed players' bio and season lines, the club list, a
// roster, the leaders, a month of finals and a box score. WPBL's reads have had this shape since
// Sep 2026 (src/wpbl/api.ts, `isFresh`); MLB's were raw `fetch` calls in each component.
//
// THE WINDOW IS PER READ, AND FOR ANYTHING A LIVE GAME MOVES IT IS SHORTER THAN THAT READ'S POLL.
// A poll asking through this cache must get a real read on every tick, or a cache would freeze a
// live score: the shortest poll on Home is 10s, so nothing live here is held for longer than 8s.
// What only changes overnight (rosters, the club list, a month of finals, milestones) is held for
// minutes. Errors are never stored, so a failed read is retried by the next caller.
//
// In-flight reads are shared too: two cards asking for the same thing in the same tick make one
// request.

const store = new Map<string, { data: unknown; at: number }>()
const inflight = new Map<string, Promise<unknown>>()

export const FRESH_LIVE_MS = 8_000
export const FRESH_SHORT_MS = 60_000
export const FRESH_LONG_MS = 10 * 60_000

export function cachedRead<T>(key: string, freshMs: number, run: () => Promise<T>): Promise<T> {
  const hit = store.get(key)
  if (hit && Date.now() - hit.at < freshMs) return Promise.resolve(hit.data as T)
  const pending = inflight.get(key)
  if (pending) return pending as Promise<T>
  const p = run()
    .then(data => { store.set(key, { data, at: Date.now() }); return data })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

/** `fetch(url).then(r => r.json())` through the cache. A non-OK response throws, and is not kept. */
export function cachedJson<T = unknown>(url: string, freshMs: number): Promise<T> {
  return cachedRead(url, freshMs, async () => {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`${r.status} ${url}`)
    return r.json() as Promise<T>
  })
}

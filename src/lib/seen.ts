import { useCallback, useState } from 'react'

// ─── "New here" dots ──────────────────────────────────────────────────────────
//
// The small dots that point at something newly shipped. ONE REGISTRY, and every dot on the way
// to a feature is derived from it. Each feature names the place it lives as a path
// ('wpbl/stats/find'), and a place wears a dot while any live feature at or under it has not been
// reached that far. So the Stats pill ('wpbl/stats') and the Find chip ('wpbl/stats/find') both
// light from the one entry, with no key for the pill and nothing to wire per feature. Before
// v1.165.0 each dot was a key of its own with hand-written mapping in WpblApp: three keys and a
// page of comments for the two boards below.
//
// WHAT IS STORED IS HOW DEEP THE READER HAS GONE, per feature. Visiting a place records its depth
// against every feature under it, and a dot at a place is out once the reader has been there or
// deeper. Reaching the Stats tab therefore puts out the pill (its whole question was "look in
// here") while the chips keep pointing; a deep link straight onto Find puts out both. A plain
// seen flag on the PLACE would not do: the next feature shipped under Stats would find the pill
// already marked and never light it.
//
// TWO conditions gate a dot, not one: the reader has not reached it, AND today is before the
// feature's expiry. The expiry is the important half. A dot with only a seen flag lives forever
// for anyone who never clicks it, so months later it is still advertising something that stopped
// being new in August. Pinning it to a date means it removes itself with no follow-up commit, and
// an expired entry is dead code that can be deleted in one go.
//
// Deliberately NOT gated on being a returning visitor. There is no reliable signal for that
// here, and building one has a cold-start problem: on the day a dot ships nobody has been
// stamped yet, so everyone looks new and it shows to no one. A dot only claims "there is
// something here", which is true for a first-time visitor too.
//
// Keep it to one live feature per nav pill: two dots in a five-tab nav is one more than a nudge
// can afford, and both land on the same pill anyway.

export interface Feature {
  /** Where it lives: the section, then the nav tab, then whatever sits inside it, e.g. a chip. */
  place: string
  /** After this, no reader sees the dot. */
  until: Date
}

/** Live features. Add one when shipping something worth pointing at, and delete it once the
 *  date has passed. A place's segments must match what the section passes to `visit`. */
const FEATURES = {
  // The Bests and Find boards, shipped together on the Stats tab. Outlive the feed by
  // a few weeks rather than expiring with it: these boards are the durable archive (single-game
  // and query-any records survive the feed stopping), so a reader returning after the season is
  // exactly who the dot still points at.
  'bests-v184': { place: 'wpbl/stats/bests', until: new Date('2026-10-31T23:59:59Z') },
  'find-v184': { place: 'wpbl/stats/find', until: new Date('2026-10-31T23:59:59Z') },
} as const satisfies Record<string, Feature>

type Registry = Record<string, Feature>
/** How deep each feature's path the reader has gone: 0 is never, Infinity is all the way. */
export type Reached = Record<string, number>

const storageKey = (id: string) => `sdSeen:${id}`
const depth = (place: string) => place.split('/').length
const isUnder = (at: string, place: string) => at === place || at.startsWith(`${place}/`)

export function readReached(registry: Registry = FEATURES): Reached {
  const out: Reached = {}
  for (const id of Object.keys(registry)) {
    try {
      const v = localStorage.getItem(storageKey(id))
      // '1' is the old seen flag, written when the reader opened the feature itself.
      out[id] = v == null ? 0 : v === '1' ? Infinity : Number(v) || 0
    } catch {
      // Storage off (private mode, blocked cookies). A dot that could never be dismissed,
      // shown on every visit, is worse than no dot.
      out[id] = Infinity
    }
  }
  return out
}

/** Does `place` wear a dot? */
export function hasDot(place: string, reached: Reached, now = Date.now(), registry: Registry = FEATURES): boolean {
  const d = depth(place)
  return Object.entries(registry).some(([id, f]) =>
    now <= f.until.getTime() && isUnder(f.place, place) && (reached[id] ?? 0) < d)
}

/** The reader is at `place`: every feature at or under it has been reached that deep. Returns
 *  `reached` itself when nothing moved, so a state setter can skip the render. */
export function visit(place: string, reached: Reached, registry: Registry = FEATURES): Reached {
  const d = depth(place)
  let next = reached
  for (const [id, f] of Object.entries(registry)) {
    if (!isUnder(f.place, place) || (reached[id] ?? 0) >= d) continue
    if (next === reached) next = { ...reached }
    next[id] = d
    try { localStorage.setItem(storageKey(id), String(d)) } catch { /* nothing to keep it in */ }
  }
  return next
}

/**
 * The dots for one section. Read once at mount (storage and the dates do not change under us
 * mid-session), then kept current as the reader moves. `dot(place)` says whether a place wears
 * one, `dotsUnder(place)` names the children of a place that do (the chips in a row), and
 * `visit(place)` records the reader arriving somewhere, by any route.
 */
export function useFeatureDots() {
  const [reached, setReached] = useState(() => readReached())
  const dot = useCallback((place: string) => hasDot(place, reached), [reached])
  const dotsUnder = useCallback((place: string): ReadonlySet<string> => {
    const out = new Set<string>()
    for (const f of Object.values(FEATURES) as Feature[]) {
      if (!f.place.startsWith(`${place}/`)) continue
      const child = f.place.slice(place.length + 1).split('/')[0]
      if (hasDot(`${place}/${child}`, reached)) out.add(child)
    }
    return out
  }, [reached])
  const markVisited = useCallback((place: string) => setReached(prev => visit(place, prev)), [])
  return { dot, dotsUnder, visit: markVisited }
}

/** Dev only: forget how far the reader has gone, so the dots can be checked again. Expired
 *  features stay hidden, which is the date half of the rule doing its job. */
export function resetFeatureDotsForDev(): void {
  for (const id of Object.keys(FEATURES)) {
    try { localStorage.removeItem(storageKey(id)) } catch { /* nothing kept */ }
  }
}

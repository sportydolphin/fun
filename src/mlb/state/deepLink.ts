// ─── Deep links: "open this thing" intents arriving from outside the view ─────
//
// A notification is only useful if clicking it lands somewhere that lets you act.
// Every notification payload therefore carries an `?open=…` query in its `url`,
// and this module turns that query into an intent some component can honour.
//
// Why the action lives in the URL rather than in a field of its own: `url` is the
// only channel Web Push has. An OS notification click can do nothing but open a
// URL, so encoding the action there means the bell and the lock screen take the
// user to exactly the same place, with no second mechanism to keep in sync.
//
// Two arrival paths, one parser:
//   cold — a push (or a shared link) opens /mlb?…&open=predictor. Parsed at module
//          load, below, and picked up by whichever component mounts to honour it.
//   warm — the bell is clicked while the app is already running. The bell parses
//          the same url and publishes the intent; subscribers react immediately.
//
// Intents are consumed by kind, not first-come — several components subscribe and
// each takes only what it owns, so ordering between them doesn't matter. An intent
// nothing claims simply expires unread, which is the right failure mode: a stale
// link should be inert, not send the user somewhere arbitrary.
//
// Module singleton, matching devSim / devDrama / homeOverlay elsewhere. Distinct
// from homeOverlay: that restores a modal the user already had open when Back
// brings them home; this opens one they've never seen, on request from outside.

import { useEffect, useRef } from 'react'

export type DeepLink =
  | { kind: 'predictor' }                  // open the full predictions board
  | { kind: 'game'; gamePk: number }       // open a specific game's preview / Game Center
  | { kind: 'milestones' }                 // open the Milestone Watch board

/** Query string → intent. Accepts a full url or a bare search string. */
export function parseDeepLink(url: string): DeepLink | null {
  try {
    const qs     = url.includes('?') ? url.slice(url.indexOf('?')) : url
    const params = new URLSearchParams(qs)
    switch (params.get('open')) {
      case 'predictor':
        return { kind: 'predictor' }
      case 'game': {
        const gamePk = Number(params.get('gamePk'))
        return Number.isFinite(gamePk) && gamePk > 0 ? { kind: 'game', gamePk } : null
      }
      case 'milestones':
        return { kind: 'milestones' }
      default:
        return null
    }
  } catch { return null }
}

// Seeded from the launch URL so a cold start from a push is honoured. The MLB
// view's URL-sync effect rewrites the address bar moments after boot and drops
// the `open` param — reading it once here, at module load, gets in ahead of that.
let pending: DeepLink | null =
  typeof window !== 'undefined' ? parseDeepLink(window.location.search) : null

const listeners = new Set<() => void>()

/** Publish an intent for whichever component owns that kind. */
export function requestDeepLink(link: DeepLink): void {
  pending = link
  listeners.forEach(l => l())
}

/** Take the pending intent if it is of `kind`, leaving other kinds for their owner. */
export function takeDeepLink<K extends DeepLink['kind']>(
  kind: K,
): Extract<DeepLink, { kind: K }> | null {
  if (pending?.kind !== kind) return null
  const link = pending as Extract<DeepLink, { kind: K }>
  pending = null
  return link
}

export function subscribeDeepLink(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/**
 * Run `handler` whenever a deep link of `kind` is pending — on mount (cold start)
 * and on every later publish (bell click while mounted). The intent is consumed,
 * so it fires once per request.
 */
export function useDeepLink<K extends DeepLink['kind']>(
  kind: K,
  handler: (link: Extract<DeepLink, { kind: K }>) => void,
): void {
  // Held in a ref so callers don't have to memoise the handler to avoid
  // resubscribing (and re-checking) on every render.
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    const check = () => {
      const link = takeDeepLink(kind)
      if (link) ref.current(link)
    }
    check()
    return subscribeDeepLink(check)
  }, [kind])
}

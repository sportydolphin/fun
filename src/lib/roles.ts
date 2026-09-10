import { useEffect, useState } from 'react'
import { useAuth } from '../AuthContext'
import { supabase } from './supabase'
import { SITE_ROLES } from './adminUsers'
import type { SiteRole } from './adminUsers'

// The reader's own capability grants, for deciding what to draw.
//
// COSMETIC, EXACTLY AS `useIsAdmin` IS, and for the same reasons written out there: the
// component and its data ship in the bundle either way, so this hides UI rather than keeping
// anything secret. What it buys is that the owner is one hard-coded address and a collaborator
// is a person who arrives, so granting one is a row rather than a deploy. Anything that must
// actually be enforced belongs in an RLS policy or inside a security-definer function, where
// `public.user_has_role()` is the server-side half of this.
//
// `user_roles` is select-own-rows (plus the owner), so this reads the table directly. It
// cannot enumerate anybody else's roles, which is the point of that policy.

const KEY = 'sdSiteRoles'

const EMPTY: ReadonlySet<SiteRole> = new Set()

/** Only the roles this build knows about. A role added to the table later must not throw here. */
const parse = (values: unknown): Set<SiteRole> =>
  new Set((Array.isArray(values) ? values : [])
    .filter((r): r is SiteRole => (SITE_ROLES as readonly unknown[]).includes(r)))

/**
 * The last answer for this user, from localStorage.
 *
 * WHY THIS IS CACHED AT ALL, AND WHY IT IS SAFE TO. A role read is a round trip, and
 * `useIsAdmin` beside it is synchronous, so without a cache the fan-awards slot on Home draws
 * the MVP race for a moment and then swaps to the ballot under a collaborator every single
 * load. One flash on the very first load is a fair price; one on every load is a bug.
 *
 * It is safe because the gate is cosmetic. A reader who edits this value hands themselves a
 * card whose code is already in the bundle they edited it from, and every write that card can
 * make was callable by anyone before any of this existed. If a role ever gates something real,
 * that check goes server-side and this cache stops being the thing deciding it.
 *
 * Keyed by user id, so signing in as somebody else does not inherit the last account's roles.
 */
function cached(uid: string): Set<SiteRole> | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as { uid?: string; roles?: unknown }
    return saved.uid === uid ? parse(saved.roles) : null
  } catch { return null }
}

function remember(uid: string, roles: Set<SiteRole>): void {
  try { localStorage.setItem(KEY, JSON.stringify({ uid, roles: [...roles] })) } catch { /* private mode */ }
}

/**
 * The signed-in reader's roles. Empty for a signed-out reader, and empty on any error.
 *
 * Failing closed matters more here than it looks: the alternative is a fetch that throws
 * leaving a stale `true` on screen, and every consumer of this is deciding whether to show
 * something that is not finished yet.
 */
export function useSiteRoles(): ReadonlySet<SiteRole> {
  const { user } = useAuth()
  const uid = user?.id ?? null
  const [roles, setRoles] = useState<ReadonlySet<SiteRole>>(() => (uid && cached(uid)) || EMPTY)

  useEffect(() => {
    if (!uid) { setRoles(EMPTY); return }
    // Paint from the cache first so a returning collaborator never sees the swap.
    setRoles(cached(uid) ?? EMPTY)

    let alive = true
    supabase.from('user_roles').select('role').eq('user_id', uid).then(({ data, error }) => {
      if (!alive) return
      if (error) { console.warn('[roles] read error:', error.message); return }
      const next = parse((data ?? []).map(r => (r as { role: string }).role))
      remember(uid, next)
      setRoles(next)
    })
    return () => { alive = false }
  }, [uid])

  return roles
}

/** Convenience for a single role. */
export function useHasRole(role: SiteRole): boolean {
  return useSiteRoles().has(role)
}

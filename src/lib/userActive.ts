import { isUserDeactivated } from './usernames'

// Shared write-gate: a single check every user-initiated database action runs
// before it writes, so an owner-deactivated account (is_deleted on usernames, see
// scripts/add_user_admin.sql) can't create or change data mid-session. This is the
// client half of enforcement; scripts/add_user_active_guard.sql enforces the same
// at the database via RLS so it holds even if the client is bypassed.

type Handler = () => void

// App.tsx registers what to do when a deactivated account is caught here: show the
// blocking notice and sign out. A module singleton so any write path can trigger it
// without prop-drilling a callback down to it.
let onDeactivated: Handler | null = null
export function setDeactivationHandler(fn: Handler | null) { onDeactivated = fn }

// Short-lived cache so frequent writers (prefs/recent-search sync) don't re-query on
// every call. Deactivation is rare and also caught at sign-in + by RLS, so a brief
// window where a just-deactivated user's cached "active" still passes is acceptable.
const TTL_MS = 30_000
const cache = new Map<string, { active: boolean; ts: number }>()

// Clears the cache — call on sign-out so a different account can't inherit a result.
export function resetActiveCache() { cache.clear() }

// Gate for a user-initiated DB write. Returns true if the write may proceed. For a
// deactivated account it fires the app's deactivation flow and returns false so the
// caller aborts. Anonymous / no-user callers pass through — there's no account to gate.
export async function ensureActiveUser(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return true

  const hit = cache.get(userId)
  if (hit && Date.now() - hit.ts < TTL_MS) {
    if (!hit.active) onDeactivated?.()
    return hit.active
  }

  const deactivated = await isUserDeactivated(userId)
  const active = !deactivated
  cache.set(userId, { active, ts: Date.now() })
  if (!active) onDeactivated?.()
  return active
}

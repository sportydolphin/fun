import { supabase } from './supabase'

// Owner-only user roster for the Admin panel. Reads are what RLS exposes to the
// client: the public `usernames` roster joined with each user's `prediction_stats`
// (also public-read). Email / last-sign-in live in auth.users and need the service
// role, so they're intentionally absent here. The soft-delete toggle is gated to the
// owner by RLS (scripts/add_user_admin.sql).

export interface AdminUser {
  user_id:    string
  username:   string
  created_at: string
  is_deleted: boolean
  deleted_at: string | null
  // From prediction_stats — null when the user has never predicted.
  predictions: number | null
  correct:     number | null
  accuracyPct: number | null
}

interface StatsRow {
  user_id: string
  accuracy_pct: number
  correct_predictions: number
  total_predictions: number
}

// All users, newest first, merged with their prediction record. Degrades gracefully
// if add_user_admin.sql hasn't been run yet (the is_deleted/deleted_at columns are
// then absent) — the same fallback pattern the streak columns use.
export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const [uRes, sRes] = await Promise.all([
    supabase.from('usernames')
      .select('user_id, username, created_at, is_deleted, deleted_at')
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase.from('prediction_stats')
      .select('user_id, accuracy_pct, correct_predictions, total_predictions')
      .limit(1000),
  ])

  // Pre-migration: the extended select errors on the missing columns → retry bare.
  let usernameRows = uRes.data as Array<Record<string, unknown>> | null
  if (uRes.error) {
    const bare = await supabase.from('usernames')
      .select('user_id, username, created_at')
      .order('created_at', { ascending: false })
      .limit(1000)
    if (bare.error) {
      console.warn('[admin] fetchAdminUsers error:', bare.error.message)
      return []
    }
    usernameRows = bare.data as Array<Record<string, unknown>>
  }

  const stats = new Map<string, StatsRow>(
    ((sRes.data ?? []) as StatsRow[]).map(s => [s.user_id, s]),
  )

  return (usernameRows ?? []).map(u => {
    const s = stats.get(u.user_id as string)
    return {
      user_id:    u.user_id as string,
      username:   u.username as string,
      created_at: u.created_at as string,
      is_deleted: !!u.is_deleted,
      deleted_at: (u.deleted_at as string | null) ?? null,
      predictions: s?.total_predictions ?? null,
      correct:     s?.correct_predictions ?? null,
      accuracyPct: s?.accuracy_pct ?? null,
    }
  })
}

// Soft-delete (deactivate) or restore a user. Owner-only via RLS. Returns success.
export async function setUserDeleted(userId: string, deleted: boolean): Promise<boolean> {
  const { error } = await supabase.from('usernames')
    .update({ is_deleted: deleted, deleted_at: deleted ? new Date().toISOString() : null })
    .eq('user_id', userId)

  if (error) {
    console.warn('[admin] setUserDeleted error:', error.message)
    return false
  }
  return true
}

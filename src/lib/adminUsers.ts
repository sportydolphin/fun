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

// One entry from the nightly all-time prediction board (prediction_boards, window 'all').
interface BoardEntry {
  userId: string
  correct: number
  total: number
  accuracy: number
}

// All users, newest first, merged with their prediction record. Degrades gracefully
// if add_user_admin.sql hasn't been run yet (the is_deleted/deleted_at columns are
// then absent) — the same fallback pattern the streak columns use.
//
// Prediction numbers come from the nightly all-time board (prediction_boards, window
// 'all'), which grades every pick for every predictor — the same source the leaderboard
// reads. prediction_stats is only written when a user opens My Stats, so it misses many
// predictors; it's kept only as a fallback for anyone not yet on a computed board.
export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const [uRes, bRes, sRes] = await Promise.all([
    supabase.from('usernames')
      .select('user_id, username, created_at, is_deleted, deleted_at')
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase.from('prediction_boards')
      .select('data')
      .eq('window_key', 'all')
      .maybeSingle(),
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

  // Authoritative record from the all-time board, keyed by user.
  const boardEntries = ((bRes.data as { data?: { entries?: BoardEntry[] } } | null)?.data?.entries ?? [])
  const board = new Map<string, BoardEntry>(boardEntries.map(e => [e.userId, e]))

  // Fallback for users not on a board yet (or before the board has ever been computed).
  const stats = new Map<string, StatsRow>(
    ((sRes.data ?? []) as StatsRow[]).map(s => [s.user_id, s]),
  )

  return (usernameRows ?? []).map(u => {
    const id = u.user_id as string
    const b = board.get(id)
    const s = stats.get(id)
    return {
      user_id:    id,
      username:   u.username as string,
      created_at: u.created_at as string,
      is_deleted: !!u.is_deleted,
      deleted_at: (u.deleted_at as string | null) ?? null,
      predictions: b ? b.total   : (s?.total_predictions   ?? null),
      correct:     b ? b.correct : (s?.correct_predictions ?? null),
      accuracyPct: b ? b.accuracy : (s?.accuracy_pct        ?? null),
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

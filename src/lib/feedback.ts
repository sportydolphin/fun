import { supabase } from './supabase'

// Insert a feedback note. Writes are open to everyone via RLS (see
// scripts/create_feedback.sql), so this works signed in or anonymous. Returns
// true on success; the dialog uses that to show a thank-you vs. an error state.
export async function submitFeedback(input: {
  message: string
  email?: string | null
  userId?: string | null
}): Promise<boolean> {
  const message = input.message.trim()
  if (!message) return false

  const email = input.email?.trim() || null
  const path = typeof window !== 'undefined'
    ? window.location.pathname + window.location.search
    : null
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : null

  const { error } = await supabase.from('feedback').insert({
    message,
    email,
    user_id: input.userId ?? null,
    path,
    user_agent: userAgent,
  })

  if (error) {
    console.warn('[feedback] submit error:', error.message)
    return false
  }
  return true
}

// ─── Admin: read + act on submissions ─────────────────────────────────────────
// Reads/edits/deletes are gated to the owner by RLS (scripts/create_feedback.sql).
// For anyone else these queries just come back empty / no-op, so calling them off
// the owner-only Admin panel is safe.

export interface FeedbackRow {
  id:         string
  created_at: string
  email:      string | null
  message:    string
  path:       string | null
  user_agent: string | null
  handled_at: string | null
}

// Newest first. `limit` caps how many rows come back (the queue rarely needs more).
export async function fetchFeedback(limit = 200): Promise<FeedbackRow[]> {
  const { data, error } = await supabase
    .from('feedback')
    .select('id, created_at, email, message, path, user_agent, handled_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.warn('[feedback] fetch error:', error.message)
    return []
  }
  return (data ?? []) as FeedbackRow[]
}

// Mark a note handled (dealt with) or reopen it. Returns true on success.
export async function setFeedbackHandled(id: string, handled: boolean): Promise<boolean> {
  const { error } = await supabase
    .from('feedback')
    .update({ handled_at: handled ? new Date().toISOString() : null })
    .eq('id', id)

  if (error) {
    console.warn('[feedback] update error:', error.message)
    return false
  }
  return true
}

// Permanently remove a note. Returns true on success.
export async function deleteFeedback(id: string): Promise<boolean> {
  const { error } = await supabase.from('feedback').delete().eq('id', id)

  if (error) {
    console.warn('[feedback] delete error:', error.message)
    return false
  }
  return true
}

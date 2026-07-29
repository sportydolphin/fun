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

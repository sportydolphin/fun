// ─── Fan photo submissions in the bell ────────────────────────────────────────
//
// The in-site twins of the pushes scripts/notify-photo-submissions.mjs sends (docs/FAN_UPLOADS.md):
// the owner's "N photos to review", and a fan's "your photo is up". Derived from the submissions
// table on every refresh, so the owner's line retracts once the queue is empty and the count is
// always the real one, and a decision is in the bell however the push fared.
//
// RLS DECIDES WHO SEES WHAT. The owner's policy returns every row and a fan's returns their own, so
// the owner's line counts waiting rows that are NOT the reader's: for the owner, the fans' queue;
// for anyone else, nothing. No email check stands in for the owner check.

import { buildPhotosWaiting, buildPhotoDecided } from '../../../shared/notifications'
import type { NotificationPayload } from '../../../shared/notifications'
import type { NotificationContext, NotificationSource } from '../../lib/notifications'

// A decision stays in the bell this long; the bell itself drops anything older than 14 days.
const DECIDED_WINDOW_MS = 7 * 86_400_000

export const photosWaitingSource: NotificationSource = {
  id: 'wpbl-photos-waiting',

  async evaluate(ctx: NotificationContext): Promise<NotificationPayload[]> {
    if (!ctx.userId) return []
    // Dynamic: the bell is in the always-loaded toolbar, and the client is already loaded by then,
    // but keeping the import here keeps this file out of the entry chunk's static graph.
    const { supabase } = await import('../../lib/supabase')
    const { count, error } = await supabase.from('wpbl_photo_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .neq('user_id', ctx.userId)
    if (error) throw error
    return count ? [buildPhotosWaiting({ count })] : []
  },
}

export const photoDecidedSource: NotificationSource = {
  id: 'wpbl-photo-decided',

  async evaluate(ctx: NotificationContext): Promise<NotificationPayload[]> {
    if (!ctx.userId) return []
    const { supabase } = await import('../../lib/supabase')
    const since = new Date(Date.now() - DECIDED_WINDOW_MS).toISOString()
    // Filtered on the account as well as by RLS: the owner's policy returns everyone's rows.
    const { data, error } = await supabase.from('wpbl_photo_submissions')
      .select('id,status,reject_reason')
      .eq('user_id', ctx.userId)
      .in('status', ['approved', 'rejected'])
      .gte('decided_at', since)
      .order('decided_at', { ascending: false })
      .limit(20)
    if (error) throw error
    return (data ?? []).map(r => buildPhotoDecided({
      key: r.id as string,
      published: r.status === 'approved' ? 1 : 0,
      declined: r.status === 'rejected' ? 1 : 0,
      reason: r.reject_reason as string | null,
    }))
  },
}

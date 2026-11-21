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
    // The newest waiting photo names the line (buildPhotosWaiting says why), so one row comes back
    // along with the count.
    const { data, count, error } = await supabase.from('wpbl_photo_submissions')
      .select('id', { count: 'exact' })
      .eq('status', 'pending')
      .neq('user_id', ctx.userId)
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) throw error
    const newestId = data?.[0]?.id as string | undefined
    return count && newestId ? [buildPhotosWaiting({ count, newestId })] : []
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
      // A quiet rejection (the owner unticked Notify) stays out of the bell as well as the push.
      .eq('fan_notify', true)
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

// Fans' photo submissions: the owner's review calls. The fan's own calls arrive with the submit page
// (docs/FAN_UPLOADS.md, phase 3). Writes go through the definer functions in
// 20261113170000_fan_photo_submissions.sql, which check the owner themselves; the reads lean on
// the table's policy (the owner sees every row).
import { supabase } from '../../lib/supabase'
import { fetchAllPaged } from './core'
import { prepareFromRender, uploadPreparedPhoto } from '../fanPhotoUpload'

export type SubmissionSubject = { player: string } | { figure: string } | { team: string }

export interface PhotoSubmission {
  id: string
  user_id: string
  sha256: string
  width: number | null
  height: number | null
  credit_name: string
  note: string | null
  subjects: SubmissionSubject[]
  status: 'pending' | 'approved' | 'rejected' | 'removed'
  reject_reason: string | null
  photo_id: string | null
  created_at: string
  decided_at: string | null
}

const COLUMNS = 'id,user_id,sha256,width,height,credit_name,note,subjects,status,reject_reason,photo_id,created_at,decided_at'

/** Every waiting submission, oldest first (the bucket deletes a render 30 days after upload, so
 *  the oldest is the one about to be lost). Paged: a busy week could pass PostgREST's 1000 cap. */
export function fetchPendingPhotoSubmissions(): Promise<PhotoSubmission[]> {
  return fetchAllPaged<PhotoSubmission>('fetchPendingPhotoSubmissions', (from, to) =>
    supabase.from('wpbl_photo_submissions').select(COLUMNS)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: PhotoSubmission[] | null; error: unknown }>)
}

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sign in again: no session.')
  return token
}

/** One render of a waiting photo, from the private bucket through /api/fan-submission. The bytes
 *  need the caller's token, so an <img src> cannot fetch them; the caller makes an object URL. */
export async function fetchSubmissionRender(id: string, variant: 'card' | 'full'): Promise<Blob> {
  const res = await fetch(`/api/fan-submission?id=${encodeURIComponent(id)}&v=${variant}`, {
    headers: { authorization: `Bearer ${await accessToken()}` },
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(detail.error || `could not load the photo (${res.status})`)
  }
  return res.blob()
}

/**
 * Approve: re-render the photo from its private full render IN THIS BROWSER, put the new renders
 * in the public bucket through /api/fan-photo, then let the database make the photo row. The
 * re-render is the point (docs/FAN_UPLOADS.md decision 3): the canvas carries no metadata, so
 * whatever the fan's browser sent, nothing but pixels reaches the public bucket.
 */
export async function approvePhotoSubmission(sub: PhotoSubmission): Promise<string> {
  const token = await accessToken()
  const prepared = await prepareFromRender(await fetchSubmissionRender(sub.id, 'full'), sub.sha256)
  const loc = await uploadPreparedPhoto(prepared, token)
  const { data, error } = await supabase.rpc('wpbl_approve_photo_submission', {
    p_id: sub.id, p_storage_path: loc.storage_path, p_card_url: loc.card_url, p_full_url: loc.full_url,
    p_width: prepared.width, p_height: prepared.height,
  })
  if (error) throw new Error(error.message)
  return data as string
}

export async function rejectPhotoSubmission(id: string, reason: string): Promise<boolean> {
  const { error } = await supabase.rpc('wpbl_reject_photo_submission', { p_id: id, p_reason: reason })
  if (error) { console.error('rejectPhotoSubmission:', error); return false }
  return true
}

/** Block the account and reject everything it has waiting. */
export async function blockPhotoUploader(userId: string, note: string): Promise<boolean> {
  const { error } = await supabase.rpc('wpbl_block_photo_uploader', { p_user: userId, p_note: note })
  if (error) { console.error('blockPhotoUploader:', error); return false }
  return true
}

/** Days until the bucket's lifecycle rule deletes a waiting photo's renders. */
export const SUBMISSION_EXPIRY_DAYS = 30
export function daysLeft(createdAt: string, now = Date.now()): number {
  const age = (now - new Date(createdAt).getTime()) / 86_400_000
  return Math.max(0, Math.ceil(SUBMISSION_EXPIRY_DAYS - age))
}

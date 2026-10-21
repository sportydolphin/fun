import { supabase } from '../../lib/supabase'
import { safe, fetchAllPaged, ownerWrite } from './core'
import { devTagQueueOn, devPhotosToTag, devSuggest, devReport } from '../dev/devPhotoTagging'

// Public photo tagging: anyone, signed in or not, says who is in a fan photo the owner has opened
// for tagging. See docs/PHOTO_TAGGING.md and the migration 20261020200000_public_photo_tagging.sql,
// which holds every guard: the three public calls are definer functions, the tables behind them have
// no policy for anon, and the limits, blocks and IP hashing all live in the database where a client
// cannot skip them. Nothing a suggester does reaches a reader until the owner accepts it.
//
// NONE OF THESE GO THROUGH THE EDGE CACHE (src/lib/edgeTables.ts): every answer depends on the
// caller's key, and a cached one would hand one browser's queue to the next.

// ─── The suggester's key ────────────────────────────────────────────────────────

const KEY_STORE = 'sd_photo_tag_key'
let memoryKey: string | null = null

function mint(): string {
  try { return crypto.randomUUID() } catch {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  }
}

/** A random id for this browser, kept in localStorage. It is NOT an identity and guards nothing on
 *  its own (a private window mints another); it lets the queue skip what this browser has answered
 *  and lets the owner clear one person's junk in one action. The database's limits key on the
 *  caller's address as well, for exactly that reason. Without storage it lasts the page's life. */
export function photoTagKey(): string {
  try {
    const have = localStorage.getItem(KEY_STORE)
    if (have && have.length >= 16 && have.length <= 64) return have
    const next = mint()
    localStorage.setItem(KEY_STORE, next)
    return next
  } catch {
    return (memoryKey ??= mint())
  }
}

// ─── The public side ────────────────────────────────────────────────────────────

export type TagSubject = { player: string } | { figure: string } | { team: string }

/** One photo in review, as the queue hands it out: the renders and the credit, who the owner has
 *  already tagged (tagging is shared, so a tagged photo stays in the queue until it is published),
 *  and the queue's progress (how many are open, how many already have a name). */
export interface PhotoToTag {
  id: string
  card_url: string
  full_url: string
  width: number | null
  height: number | null
  credit: string | null
  open_count: number
  named_count: number
  tagged: TagSubject[]
}

/** What a write said: recorded; the photo left the queue meanwhile; refused as malformed; over a
 *  limit. `error` is the network or an unknown answer, which the page treats as "try again". */
export type TagAnswer = 'ok' | 'closed' | 'invalid' | 'limited' | 'error'

const ANSWERS = new Set<TagAnswer>(['ok', 'closed', 'invalid', 'limited'])
const asAnswer = (v: unknown): TagAnswer => (typeof v === 'string' && ANSWERS.has(v as TagAnswer) ? v as TagAnswer : 'error')

/** The next photos for this browser, fewest suggesters first. `skip` is what was skipped this visit,
 *  which the database never hears about otherwise. Null on failure, so the page can tell "nothing
 *  left" (an empty list) from "could not ask". */
export async function fetchPhotosToTag(skip: string[], limit = 10): Promise<PhotoToTag[] | null> {
  if (import.meta.env.DEV && devTagQueueOn()) return devPhotosToTag(skip, limit)
  try {
    const { data, error } = await supabase.rpc('wpbl_photos_to_tag', { p_key: photoTagKey(), p_limit: limit, p_skip: skip.slice(-500) })
    if (error) {
      // PGRST202 is "no such function": a database the migration has not reached, where the gallery's
      // invite simply does not draw. Anything else is worth a line in the console.
      if ((error as { code?: string }).code !== 'PGRST202') console.error('fetchPhotosToTag:', error)
      return null
    }
    return (data ?? []) as PhotoToTag[]
  } catch (e) {
    console.error('fetchPhotosToTag:', e)
    return null
  }
}


export async function suggestPhotoTags(photoId: string, subjects: TagSubject[]): Promise<TagAnswer> {
  if (subjects.length === 0 || subjects.length > 10) return 'invalid'
  if (import.meta.env.DEV && devTagQueueOn()) return devSuggest(photoId)
  try {
    const { data, error } = await supabase.rpc('wpbl_suggest_photo_tags', { p_photo: photoId, p_key: photoTagKey(), p_subjects: subjects })
    if (error) { console.error('suggestPhotoTags:', error); return 'error' }
    return asAnswer(data)
  } catch (e) {
    console.error('suggestPhotoTags:', e)
    return 'error'
  }
}

export type ReportReason = 'private_person' | 'child' | 'not_wpbl' | 'other'

export async function reportPhoto(photoId: string, reason: ReportReason): Promise<TagAnswer> {
  if (import.meta.env.DEV && devTagQueueOn()) return devReport(photoId)
  try {
    const { data, error } = await supabase.rpc('wpbl_report_photo', { p_photo: photoId, p_key: photoTagKey(), p_reason: reason })
    if (error) { console.error('reportPhoto:', error); return 'error' }
    return asAnswer(data)
  } catch (e) {
    console.error('reportPhoto:', e)
    return 'error'
  }
}

// ─── The owner's side (writes through the is_site_owner() policies) ─────────────
//
// Every read here fails soft to empty, so /admin keeps working against a database the migration has
// not reached yet. Reads are fresh, never cached: a decision has to show on the next reload.

export interface PhotoTagSuggestion {
  id: string
  photo_id: string
  player_id: string | null
  figure_key: string | null
  team_id: string | null
  suggester_key: string
  ip_hash: string | null
  status: 'pending' | 'accepted' | 'rejected'
  created_at: string
}

export interface PhotoReport {
  id: string
  photo_id: string
  suggester_key: string
  ip_hash: string | null
  reason: ReportReason
  resolved_at: string | null
  created_at: string
}

export interface PhotoTagBlock { kind: 'key' | 'ip'; value: string; created_at: string }

export interface PhotoTagReview {
  /** Photos open for tagging. Read on its own so the curator's main read never names a column the
   *  database may not have yet. */
  open: Set<string>
  suggestions: PhotoTagSuggestion[]
  reports: PhotoReport[]
  blocks: PhotoTagBlock[]
}

export async function fetchPhotoTagReview(): Promise<PhotoTagReview> {
  const [open, suggestions, reports, blocks] = await Promise.all([
    safe<Array<{ id: string }>>('fetchPhotoTagOpen', () =>
      supabase.from('wpbl_fan_photos').select('id').eq('open_for_tagging', true) as unknown as
        PromiseLike<{ data: Array<{ id: string }> | null; error: unknown }>, []),
    // Paged with a total order: 115 photos at a few suggestions each crosses PostgREST's silent
    // 1000-row cap almost at once, and the failure is suggestions that simply never appear.
    fetchAllPaged<PhotoTagSuggestion>('fetchPhotoTagSuggestions', (from, to) =>
      supabase.from('wpbl_photo_tag_suggestions')
        .select('id,photo_id,player_id,figure_key,team_id,suggester_key,ip_hash,status,created_at')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: PhotoTagSuggestion[] | null; error: unknown }>),
    fetchAllPaged<PhotoReport>('fetchPhotoReports', (from, to) =>
      supabase.from('wpbl_photo_reports')
        .select('id,photo_id,suggester_key,ip_hash,reason,resolved_at,created_at')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: PhotoReport[] | null; error: unknown }>),
    safe<PhotoTagBlock[]>('fetchPhotoTagBlocks', () =>
      supabase.from('wpbl_photo_tag_blocks').select('kind,value,created_at').order('created_at') as unknown as
        PromiseLike<{ data: PhotoTagBlock[] | null; error: unknown }>, []),
  ])
  return { open: new Set(open.map(r => r.id)), suggestions, reports, blocks }
}

/** Open or close photos for tagging. Opening is, in effect, publishing the image (its URL is
 *  handed to strangers), so the caller screens first; see docs/PHOTO_TAGGING.md. */
export function setOpenForTagging(ids: string[], open: boolean): Promise<boolean> {
  if (ids.length === 0) return Promise.resolve(true)
  return ownerWrite('setOpenForTagging', () =>
    supabase.from('wpbl_fan_photos').update({ open_for_tagging: open, updated_at: new Date().toISOString() }).in('id', ids))
}

/** Mark suggestions decided. Accepting one does not tag the photo by itself: the caller adds the
 *  subject first (addFanPhotoSubject), so a failed tag never reads as an accepted suggestion. */
export function decideSuggestions(ids: string[], status: 'accepted' | 'rejected' | 'pending'): Promise<boolean> {
  if (ids.length === 0) return Promise.resolve(true)
  return ownerWrite('decideSuggestions', () =>
    supabase.from('wpbl_photo_tag_suggestions')
      .update({ status, decided_at: status === 'pending' ? null : new Date().toISOString() }).in('id', ids))
}

/** Reject everything still pending from one browser key or one address: junk clears in one action. */
export function discardSuggester(kind: 'key' | 'ip', value: string): Promise<boolean> {
  return ownerWrite('discardSuggester', () =>
    supabase.from('wpbl_photo_tag_suggestions')
      .update({ status: 'rejected', decided_at: new Date().toISOString() })
      .eq(kind === 'key' ? 'suggester_key' : 'ip_hash', value).eq('status', 'pending'))
}

/** Block a key or an address. Their later calls are told they worked and store nothing. */
export async function blockSuggester(kind: 'key' | 'ip', value: string): Promise<boolean> {
  // An insert, with an existing block counting as done (23505, the primary key): an upsert would
  // need this table's SELECT policy checked first (src/__tests__/browserUpserts.test.ts).
  try {
    const { error } = await supabase.from('wpbl_photo_tag_blocks').insert({ kind, value })
    if (error && (error as { code?: string }).code !== '23505') { console.error('blockSuggester:', error); return false }
    return true
  } catch (e) {
    console.error('blockSuggester:', e)
    return false
  }
}

export function unblockSuggester(kind: 'key' | 'ip', value: string): Promise<boolean> {
  return ownerWrite('unblockSuggester', () =>
    supabase.from('wpbl_photo_tag_blocks').delete().eq('kind', kind).eq('value', value))
}

/** Resolve every open report on a photo, which returns it to the queue (if it is still open). */
export function resolvePhotoReports(photoId: string): Promise<boolean> {
  return ownerWrite('resolvePhotoReports', () =>
    supabase.from('wpbl_photo_reports').update({ resolved_at: new Date().toISOString() })
      .eq('photo_id', photoId).is('resolved_at', null))
}

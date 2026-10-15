import { supabase } from '../../lib/supabase'
import { buildFanPhotoIndex, type FanPhotoIndex } from '../fanPhotos'
import type {
  WpblPhoto, WpblFanPhoto, WpblPhotoFigure, WpblPhotoSubject, WpblPhotoContributor,
  WpblPhotoCategory,
} from '../types'
import { safe, once, isFreshSlow, fetchAllPaged, ownerWrite } from './core'
import { teamsCache, fetchWpblTeams } from './games'

// Photos: the Commons archive gallery, and fan photos with their curation and upload writes.

let allPhotosCache:   { data: WpblPhoto[]; at: number } | null = null
let fanPhotosCache:   { data: WpblFanPhoto[]; at: number } | null = null
let fanPhotoSubjectsCache: { data: WpblPhotoSubject[]; at: number } | null = null
let fanPhotoFiguresCache:  { data: WpblPhotoFigure[]; at: number } | null = null
let fanPhotoCategoriesCache: { data: WpblPhotoCategory[]; at: number } | null = null

export function getCachedWpblPhotos(): WpblPhoto[] | null { return allPhotosCache?.data ?? null }

// The archive gallery (wpbl_photos): freely licensed women's baseball photography mirrored
// from Wikimedia Commons. Same shape as the two reads above, and the same tolerance for the
// table not existing yet.
//
// NOT filtered on `approved` here, and that is deliberate. The RLS policy already restricts
// the select to approved rows, so the unreviewed backlog is unreachable from the browser
// whatever this query asks for. Adding `.eq('approved', true)` would read as though it were
// the thing keeping the backlog private, and the next person to write a query would copy the
// filter and believe it was enough.
//
// Ordered by the curator's sequence, which is the point of having one: the gallery is a
// curated set, not a feed, so upload date is the wrong axis. `page_id` breaks ties so the
// order is total (see fetchAllPaged for what a non-deterministic order costs a paged read;
// this table is far too small to page, but the habit is cheap).
export function fetchWpblPhotos(): Promise<WpblPhoto[]> {
  if (isFreshSlow(allPhotosCache)) return Promise.resolve(allPhotosCache!.data)
  return once('allPhotos', async () => {
    const data = await safe<WpblPhoto[]>('fetchWpblPhotos', () =>
      supabase.from('wpbl_photos')
        .select('page_id,title,description,caption,file_url,thumb_url,width,height,description_url,artist,license_short,license_url,date_original,sort_order')
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('page_id', { ascending: true }) as unknown as
        PromiseLike<{ data: WpblPhoto[] | null; error: unknown }>,
      [])
    if (data.length > 0 || allPhotosCache == null) allPhotosCache = { data, at: Date.now() }
    return data
  })
}

// ─── Fan photos: this season's players, by name ──────────────────────────────
//
// The three flat reads that back every fan-photo surface. NOT wpbl_photos (the Commons
// history gallery); see docs/FAN_PHOTOS.md for why they are separate tables. buildFanPhotoIndex
// in fanPhotos.ts joins them client-side into per-player / per-figure / per-game lookups, the same
// shape the section already uses for league-wide data (flat reads, indexed in memory), rather
// than a PostgREST embed.
//
// All three are PAGED and ORDERED. Four hundred photos at three tags each is already 1,200
// subject rows, so the tags cross PostgREST's silent 1000-row cap on the first real batch; a
// truncated read is a short array with no error, and the photos it drops simply stop appearing
// on the pages that sort last. See fetchAllPaged and CLAUDE.md.
//
// RLS restricts a reader's select to approved rows (and a tag to an approved photo), and THAT is
// the protection: nothing here could hide the backlog from someone determined to read it.
//
// But RLS answers "who may read this", not "what does the audience see", and for the OWNER those
// differ: the owner's `for all using (is_site_owner())` policy ORs with the public one, so an
// unfiltered read hands the owner the whole unreviewed queue, and every public surface drew
// unpublished photos for the one person checking what readers see. So the photo read filters on
// `approved` too, and buildFanPhotoIndex drops anything not approved as a second line. Neither is
// the security boundary; both are what keep the owner's view honest.

// The card render, dims and caption drive the strip and gallery; game_id feeds Game Center.
// Ordered by the curator's sequence, id breaking ties so the order is total.
const FAN_PHOTO_COLUMNS = 'id,card_url,full_url,width,height,caption,credit,taken_on,game_id,sort_order,category_key,approved'

export function fetchWpblFanPhotos(): Promise<WpblFanPhoto[]> {
  if (isFreshSlow(fanPhotosCache)) return Promise.resolve(fanPhotosCache!.data)
  return once('fanPhotos', async () => {
    const data = await fetchAllPaged<WpblFanPhoto>('fetchWpblFanPhotos', (from, to) =>
      supabase.from('wpbl_fan_photos')
        .select(FAN_PHOTO_COLUMNS)
        .eq('approved', true)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as unknown as
        PromiseLike<{ data: WpblFanPhoto[] | null; error: unknown }>)
    if (data.length > 0 || fanPhotosCache == null) fanPhotosCache = { data, at: Date.now() }
    return data
  })
}

export function fetchWpblFanPhotoSubjects(): Promise<WpblPhotoSubject[]> {
  if (isFreshSlow(fanPhotoSubjectsCache)) return Promise.resolve(fanPhotoSubjectsCache!.data)
  return once('fanPhotoSubjects', async () => {
    const data = await fetchAllPaged<WpblPhotoSubject>('fetchWpblFanPhotoSubjects', (from, to) =>
      supabase.from('wpbl_photo_subjects')
        .select('id,photo_id,player_id,figure_key,team_id')
        .order('photo_id', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as unknown as
        PromiseLike<{ data: WpblPhotoSubject[] | null; error: unknown }>)
    if (data.length > 0 || fanPhotoSubjectsCache == null) fanPhotoSubjectsCache = { data, at: Date.now() }
    return data
  })
}

export function fetchWpblFanPhotoFigures(): Promise<WpblPhotoFigure[]> {
  if (isFreshSlow(fanPhotoFiguresCache)) return Promise.resolve(fanPhotoFiguresCache!.data)
  return once('fanPhotoFigures', async () => {
    const data = await fetchAllPaged<WpblPhotoFigure>('fetchWpblFanPhotoFigures', (from, to) =>
      supabase.from('wpbl_photo_figures')
        .select('key,name,kind,blurb,team_id')
        .order('name', { ascending: true })
        .order('key', { ascending: true })
        .range(from, to) as unknown as
        PromiseLike<{ data: WpblPhotoFigure[] | null; error: unknown }>)
    if (data.length > 0 || fanPhotoFiguresCache == null) fanPhotoFiguresCache = { data, at: Date.now() }
    return data
  })
}

const FAN_PHOTO_CATEGORY_COLUMNS = 'key,name,blurb,sort_order'

// A handful of rows, so one read rather than paged; ordered by the curator's sequence, then name.
export function fetchWpblFanPhotoCategories(): Promise<WpblPhotoCategory[]> {
  if (isFreshSlow(fanPhotoCategoriesCache)) return Promise.resolve(fanPhotoCategoriesCache!.data)
  return once('fanPhotoCategories', async () => {
    const data = await safe<WpblPhotoCategory[]>('fetchWpblFanPhotoCategories', () =>
      supabase.from('wpbl_photo_categories').select(FAN_PHOTO_CATEGORY_COLUMNS)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true }) as unknown as
        PromiseLike<{ data: WpblPhotoCategory[] | null; error: unknown }>, [])
    if (data.length > 0 || fanPhotoCategoriesCache == null) fanPhotoCategoriesCache = { data, at: Date.now() }
    return data
  })
}

/** Fired after the owner edits a photo in place, so every mounted photo surface reads again. */
export const FAN_PHOTOS_CHANGED_EVENT = 'wpbl:fan-photos-changed'

/** Drop the cached public photo reads and tell the mounted surfaces. Without this an edit made from
 *  the enlarged view would not show until the 20s bulk cache expired and the page was reopened. */
export function invalidateWpblFanPhotos(): void {
  fanPhotosCache = null
  fanPhotoSubjectsCache = null
  fanPhotoFiguresCache = null
  fanPhotoCategoriesCache = null
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(FAN_PHOTOS_CHANGED_EVENT))
}

/** The index from the session caches alone, or null until every read behind it has landed.
 *  For a synchronous first paint: the section warms these reads beside the schedule, so by the
 *  time Home mounts the gallery can usually draw at once instead of popping in a beat later and
 *  pushing the page down under the reader. */
export function getCachedWpblFanPhotoIndex(): FanPhotoIndex | null {
  if (!fanPhotosCache || !fanPhotoSubjectsCache || !fanPhotoFiguresCache || !fanPhotoCategoriesCache || !teamsCache) return null
  return buildFanPhotoIndex(fanPhotosCache.data, fanPhotoSubjectsCache.data, fanPhotoFiguresCache.data,
    teamsCache, fanPhotoCategoriesCache.data)
}

// The one call a surface makes: all three reads in parallel, joined into the per-subject and
// per-game lookups. Each read is cached and deduped on its own, so calling this from several
// components in one load costs one round trip each, not one per caller.
export async function fetchWpblFanPhotoIndex(): Promise<FanPhotoIndex> {
  const [photos, subjects, figures, teams, categories] = await Promise.all([
    fetchWpblFanPhotos(),
    fetchWpblFanPhotoSubjects(),
    fetchWpblFanPhotoFigures(),
    fetchWpblTeams(),
    fetchWpblFanPhotoCategories(),
  ])
  return buildFanPhotoIndex(photos, subjects, figures, teams, categories)
}

// ─── Fan photo curation (owner-only, writes through the is_site_owner() RLS policy) ──────
//
// The curation tool under /admin. These writes are NOT a fourth write path (CLAUDE.md): the
// owner policy on each table already exists, exactly as it does on wpbl_photos, and the
// browser is refused every one of these unless is_site_owner() passes. The route gate in
// App.tsx is cosmetic; RLS is the boundary.
//
// The queue read deliberately does NOT go through the cached public fetchers. It needs every
// row including the unapproved backlog, and it must be fresh after each edit rather than served
// from the 20s bulk cache. The owner's `for all using (is_site_owner())` policy ORs with the
// public `using (approved)` one, so this returns all rows for the owner (and, harmlessly, only
// approved rows for anyone else who called it).

/** A fan photo as the curator sees it: the public shape plus the review-only columns. */
export interface WpblFanPhotoRow extends WpblFanPhoto {
  approved: boolean
  contributor_id: string | null
  created_at: string
  /** Where the UNCROPPED renders live; a crop is filed beside them (fanPhotoUpload.ts). */
  storage_path: string
  sha256: string
}

export async function fetchWpblFanPhotoQueue(): Promise<{
  photos: WpblFanPhotoRow[]; subjects: WpblPhotoSubject[]; figures: WpblPhotoFigure[]; categories: WpblPhotoCategory[]
}> {
  // All three read FRESH, not through the cached public fetchers: an approve or a new tag has to
  // show on the next reload, and the bulk cache would serve the pre-edit set for its whole window.
  const [photos, subjects, figures, categories] = await Promise.all([
    safe<WpblFanPhotoRow[]>('fetchWpblFanPhotoQueue', () =>
      supabase.from('wpbl_fan_photos')
        // Unreviewed first (approved ascending puts false before true), then the curated order.
        .select(`${FAN_PHOTO_COLUMNS},contributor_id,created_at,storage_path,sha256`)
        .order('approved', { ascending: true })
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true }) as unknown as
        PromiseLike<{ data: WpblFanPhotoRow[] | null; error: unknown }>, []),
    safe<WpblPhotoSubject[]>('fetchWpblFanPhotoQueueSubjects', () =>
      supabase.from('wpbl_photo_subjects').select('id,photo_id,player_id,figure_key,team_id') as unknown as
        PromiseLike<{ data: WpblPhotoSubject[] | null; error: unknown }>, []),
    safe<WpblPhotoFigure[]>('fetchWpblFanPhotoQueueFigures', () =>
      supabase.from('wpbl_photo_figures').select('key,name,kind,blurb,team_id').order('name') as unknown as
        PromiseLike<{ data: WpblPhotoFigure[] | null; error: unknown }>, []),
    safe<WpblPhotoCategory[]>('fetchWpblFanPhotoQueueCategories', () =>
      supabase.from('wpbl_photo_categories').select(FAN_PHOTO_CATEGORY_COLUMNS)
        .order('sort_order', { ascending: true, nullsFirst: false }).order('name') as unknown as
        PromiseLike<{ data: WpblPhotoCategory[] | null; error: unknown }>, []),
  ])
  return { photos, subjects, figures, categories }
}

export function setFanPhotoApproved(id: string, approved: boolean): Promise<boolean> {
  return ownerWrite('setFanPhotoApproved', () =>
    supabase.from('wpbl_fan_photos').update({ approved, updated_at: new Date().toISOString() }).eq('id', id))
}

/** Patch the curator-owned fields. Only the keys passed are written, so this never clobbers a
 *  field it was not asked to touch. */
export function updateFanPhoto(id: string, patch: {
  caption?: string | null; taken_on?: string | null; game_id?: string | null; sort_order?: number | null
  category_key?: string | null
  // Reassigning the photographer: both together, since `credit` is the public copy of the
  // contributor's name (see updateFanPhotoContributor).
  contributor_id?: string | null; credit?: string | null
  // A crop repoints the served renders; `storage_path` is left alone so the original stays findable.
  card_url?: string; full_url?: string; width?: number | null; height?: number | null
}): Promise<boolean> {
  return ownerWrite('updateFanPhoto', () =>
    supabase.from('wpbl_fan_photos').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id))
}

/** Tag a subject, returning the new row (for optimistic UI) or null on failure. Exactly one of
 *  playerId / figureKey / teamId is passed; the table's check constraint enforces that, and the unique
 *  index rejects a repeat tag (which the UI avoids by not offering an already-tagged subject).
 *  `.insert().select()` is safe here because the owner's RLS policy also grants the select. */
export async function addFanPhotoSubject(
  photoId: string, subject: { playerId: string } | { figureKey: string } | { teamId: string },
): Promise<WpblPhotoSubject | null> {
  const row = {
    photo_id: photoId,
    player_id: 'playerId' in subject ? subject.playerId : null,
    figure_key: 'figureKey' in subject ? subject.figureKey : null,
    team_id: 'teamId' in subject ? subject.teamId : null,
  }
  try {
    const { data, error } = await supabase.from('wpbl_photo_subjects')
      .insert(row).select('id,photo_id,player_id,figure_key,team_id').single()
    if (error) { console.error('addFanPhotoSubject:', error); return null }
    return data as WpblPhotoSubject
  } catch (e) {
    console.error('addFanPhotoSubject:', e)
    return null
  }
}

export function removeFanPhotoSubject(id: string): Promise<boolean> {
  return ownerWrite('removeFanPhotoSubject', () =>
    supabase.from('wpbl_photo_subjects').delete().eq('id', id))
}

/** Create or update a category. Keyed on `key`, so a re-save renames rather than duplicates. */
export function upsertFanPhotoCategory(cat: WpblPhotoCategory): Promise<boolean> {
  return ownerWrite('upsertFanPhotoCategory', () =>
    supabase.from('wpbl_photo_categories').upsert(cat, { onConflict: 'key' }))
}

/** Create or update a non-player figure (a mascot, manager, coach, ...). Keyed on `key`, so a
 *  re-save edits rather than duplicates. */
export function upsertFanPhotoFigure(fig: WpblPhotoFigure): Promise<boolean> {
  return ownerWrite('upsertFanPhotoFigure', () =>
    supabase.from('wpbl_photo_figures').upsert(fig, { onConflict: 'key' }))
}

// ─── The web upload path (owner, from the browser) ───────────────────────────────────────
//
// The CLI ingest still exists for a laptop and a big drop folder; this is the from-anywhere
// path. The bytes go to R2 through the owner-gated /api/fan-photo function (the browser cannot
// hold R2 keys); the row is written HERE, through the same is_site_owner() RLS as the curation
// edits, so there is no second writer to reason about.

/** Does a photo with these original bytes already exist? Returns its id and approval, or null.
 *  This is the real-time duplicate check the upload UI runs the moment a file is picked, so the
 *  same shot is never uploaded twice. Owner-only read (the queue RLS returns the unapproved
 *  backlog to is_site_owner()). */
export async function findFanPhotoBySha(sha256: string): Promise<{ id: string; approved: boolean } | null> {
  try {
    const { data, error } = await supabase.from('wpbl_fan_photos')
      .select('id,approved').eq('sha256', sha256).maybeSingle()
    if (error) { console.error('findFanPhotoBySha:', error); return null }
    return data ?? null
  } catch (e) {
    console.error('findFanPhotoBySha:', e)
    return null
  }
}

/** Insert a fan photo row after its renders are in R2. Returns the new id, or null on failure.
 *  Lands `approved = false` by the column default: an uploaded photo is still just a queue
 *  entry until it is tagged and published. */
export async function insertFanPhoto(row: {
  sha256: string; storage_path: string; card_url: string; full_url: string
  width: number | null; height: number | null; credit: string | null; contributor_id: string | null
  category_key?: string | null
}): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('wpbl_fan_photos').insert(row).select('id').single()
    if (error) { console.error('insertFanPhoto:', error); return null }
    return data.id as string
  } catch (e) {
    console.error('insertFanPhoto:', e)
    return null
  }
}

/** The contributors already on file, for the upload panel's picker. Owner-only table. */
export async function fetchFanPhotoContributors(): Promise<WpblPhotoContributor[]> {
  return safe<WpblPhotoContributor[]>('fetchFanPhotoContributors', () =>
    supabase.from('wpbl_photo_contributors')
      .select('id,display_name,contact,permission_granted_on,permission_evidence,permission_scope,withdrawn_on')
      .order('display_name') as unknown as
      PromiseLike<{ data: WpblPhotoContributor[] | null; error: unknown }>, [])
}

/** Create a contributor (the permission record), returning the new id. */
export async function createFanPhotoContributor(
  rec: Omit<WpblPhotoContributor, 'id' | 'withdrawn_on'>,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('wpbl_photo_contributors').insert(rec).select('id').single()
    if (error) { console.error('createFanPhotoContributor:', error); return null }
    return data.id as string
  } catch (e) {
    console.error('createFanPhotoContributor:', e)
    return null
  }
}

/** Edit a contributor's record, and keep the public credit in step with it.
 *
 *  THE CREDIT IS DENORMALIZED onto every photo row (the contributors table is owner-only, so a
 *  reader can never join to it), which means a renamed photographer would otherwise keep their
 *  old name on every photo already published. So a `display_name` change rewrites `credit` on
 *  all of their photos in the same call. Two writes rather than a trigger: the owner is the only
 *  writer, and this is the only path that renames.
 *
 *  Withdrawing (setting `withdrawn_on`) also unpublishes every photo of theirs, which is what the
 *  table's own note defines withdrawal as: the date records it, the unpublish carries it out. */
export async function updateFanPhotoContributor(
  id: string, patch: Partial<Omit<WpblPhotoContributor, 'id'>>, prev: WpblPhotoContributor,
): Promise<boolean> {
  const ok = await ownerWrite('updateFanPhotoContributor', () =>
    supabase.from('wpbl_photo_contributors').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id))
  if (!ok) return false
  if (patch.display_name && patch.display_name !== prev.display_name) {
    const synced = await ownerWrite('updateFanPhotoContributorCredit', () =>
      supabase.from('wpbl_fan_photos').update({ credit: patch.display_name, updated_at: new Date().toISOString() }).eq('contributor_id', id))
    if (!synced) return false
  }
  if (patch.withdrawn_on && !prev.withdrawn_on) {
    const pulled = await ownerWrite('updateFanPhotoContributorWithdraw', () =>
      supabase.from('wpbl_fan_photos').update({ approved: false, updated_at: new Date().toISOString() }).eq('contributor_id', id))
    if (!pulled) return false
  }
  invalidateWpblFanPhotos()
  return true
}

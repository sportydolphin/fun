// The browser half of the web upload: hash the original, make the two webp renders in a canvas,
// and hand the bytes to the owner-gated /api/fan-photo endpoint. This is the mirror of
// scripts/prepare-fan-photos.py, moved into the browser so a photo can be uploaded from a phone.
//
// Re-encoding through a canvas STRIPS EXIF the same way Pillow does: a canvas has no metadata, so
// the render carries no GPS or device id out of the original. The EXIF DateTimeOriginal seed that
// the CLI reads is skipped here (parsing EXIF in the browser is not worth a dependency); the
// curator sets `taken_on` in review instead, which the plan already treats as the settling step.
//
// The hash is of the ORIGINAL bytes, so it matches the CLI's and the DB's unique key exactly: a
// photo uploaded from a phone and the same file later dropped through the CLI collapse to one row.

const CARD_MAX = 800
const FULL_MAX = 1600
const WEBP_QUALITY = 0.82

/** sha256 of the original file bytes, as lowercase hex. */
export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Fit (w, h) inside a max longest-side, never upscaling. Pure, so it is unit-tested. */
export function fitDimensions(w: number, h: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

async function toWebp(bitmap: ImageBitmap, max: number): Promise<{ blob: Blob; width: number; height: number }> {
  const { width, height } = fitDimensions(bitmap.width, bitmap.height, max)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d canvas context')
  ctx.drawImage(bitmap, 0, 0, width, height)
  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/webp', WEBP_QUALITY))
  if (!blob) throw new Error('webp encode failed')
  return { blob, width, height }
}

export interface PreparedPhoto {
  sha256: string
  card: Blob
  full: Blob
  /** The full render's dimensions, which the DB row stores for aspect ratio. */
  width: number
  height: number
}

/** Hash and render one picked file into the two webp blobs, ready to upload. */
export async function prepareForUpload(file: File): Promise<PreparedPhoto> {
  const buf = await file.arrayBuffer()
  const sha256 = await sha256Hex(buf)
  // `imageOrientation: 'from-image'` bakes the EXIF rotation into the pixels before we drop the
  // EXIF, so a portrait phone photo is upright rather than sideways with its orientation gone.
  const bitmap = await createImageBitmap(new Blob([buf], { type: file.type }),
    { imageOrientation: 'from-image' } as ImageBitmapOptions)
  try {
    const card = await toWebp(bitmap, CARD_MAX)
    const full = await toWebp(bitmap, FULL_MAX)
    return { sha256, card: card.blob, full: full.blob, width: full.width, height: full.height }
  } finally {
    bitmap.close()
  }
}

export interface UploadedLocation {
  storage_path: string
  card_url: string
  full_url: string
}

// ─── Cropping, after upload ────────────────────────────────────────────────────────
//
// The original file is gone by the time a photo is being tagged, so a crop is cut from the
// UNCROPPED full render (<=1600px), which never moves: it stays at `<storage_path>/full.webp` and
// a crop is written beside it under its own variant key. That keeps every crop redoable from the
// same source and makes "reset" a pointer change. It also has to be a new key rather than an
// overwrite, because photos.sportydolphin.fun serves `max-age=14400`: an overwritten render would
// show the old framing for four hours in every browser and edge cache that had seen it.

/** The uncropped renders of a photo, derived from where the upload put them. */
export function originalRenders(photo: { storage_path?: string | null; full_url: string }): { card: string; full: string } | null {
  if (!photo.storage_path) return null
  let origin: string
  try { origin = new URL(photo.full_url).origin } catch { return null }
  return { card: `${origin}/${photo.storage_path}/card.webp`, full: `${origin}/${photo.storage_path}/full.webp` }
}

/** Fetch a render's bytes for the cropper. `cache: 'reload'` matters: tag mode has already shown
 *  this image through a plain <img>, and a cached copy fetched without CORS would taint the canvas. */
export async function fetchRender(url: string): Promise<Blob> {
  const res = await fetch(url, { mode: 'cors', cache: 'reload' })
  if (!res.ok) throw new Error(`could not load the original (${res.status})`)
  return res.blob()
}

/** A crop in the SOURCE image's pixels. */
export interface PixelCrop { x: number; y: number; width: number; height: number }

/** Cut `crop` out of `source` and make the two webp renders from it. */
export async function renderCrop(source: Blob, crop: PixelCrop): Promise<Omit<PreparedPhoto, 'sha256'>> {
  const bitmap = await createImageBitmap(source,
    Math.round(crop.x), Math.round(crop.y), Math.max(1, Math.round(crop.width)), Math.max(1, Math.round(crop.height)))
  try {
    const card = await toWebp(bitmap, CARD_MAX)
    const full = await toWebp(bitmap, FULL_MAX)
    return { card: card.blob, full: full.blob, width: full.width, height: full.height }
  } finally {
    bitmap.close()
  }
}

/** A fresh variant key for a crop's renders: unique per save, so a URL never changes content. */
export function newCropVariant(): string {
  return `c${Date.now().toString(36)}`
}

/** Send the two renders to the owner-gated endpoint, which puts them in R2 and returns the URLs.
 *  `token` is the owner's Supabase access token, which the endpoint checks against
 *  is_site_owner(); an upload never leaves the browser without it. `variant` files a crop beside
 *  the original instead of over it (see above). */
export async function uploadPreparedPhoto(prepared: PreparedPhoto, token: string, variant?: string): Promise<UploadedLocation> {
  const form = new FormData()
  form.set('sha256', prepared.sha256)
  form.set('card', prepared.card, 'card.webp')
  form.set('full', prepared.full, 'full.webp')
  if (variant) form.set('variant', variant)
  const res = await fetch('/api/fan-photo', {
    method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form,
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(detail.error || `upload failed (${res.status})`)
  }
  return res.json()
}

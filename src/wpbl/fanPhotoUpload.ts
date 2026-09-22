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

/** Send the two renders to the owner-gated endpoint, which puts them in R2 and returns the URLs.
 *  `token` is the owner's Supabase access token, which the endpoint checks against
 *  is_site_owner(); an upload never leaves the browser without it. */
export async function uploadPreparedPhoto(prepared: PreparedPhoto, token: string): Promise<UploadedLocation> {
  const form = new FormData()
  form.set('sha256', prepared.sha256)
  form.set('card', prepared.card, 'card.webp')
  form.set('full', prepared.full, 'full.webp')
  const res = await fetch('/api/fan-photo', {
    method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form,
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(detail.error || `upload failed (${res.status})`)
  }
  return res.json()
}

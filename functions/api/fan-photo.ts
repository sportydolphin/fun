// POST /api/fan-photo: the owner-gated R2 upload endpoint behind the web upload UI.
//
// The browser cannot hold the R2 keys (the frontend bundle ships to everyone), so the pixel
// bytes it made in a canvas are handed to this function, which is the only place the R2
// credentials live at the edge. It does exactly one job: prove the caller is the site owner,
// then put the two renders in the bucket. It never writes the database row; the browser does
// that through RLS, exactly as the CLI ingest keeps the two halves apart. See docs/FAN_PHOTOS.md.
//
// Owner check reuses the DB's own is_site_owner() rather than re-deciding here: the function
// calls that RPC with the caller's Supabase token, so the answer is whatever auth.uid() resolves
// to from the verified JWT. There is no second copy of "who is the owner" to drift.
//
// Needs `/api/*` in public/_routes.json or Cloudflare never invokes it, and these Cloudflare
// env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE,
// plus the VITE_SUPABASE_* pair the other functions already read.
import { AwsClient } from 'aws4fetch'

interface Env {
  VITE_SUPABASE_URL?: string
  SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
  SUPABASE_ANON_KEY?: string
  R2_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_BUCKET?: string
  R2_PUBLIC_BASE?: string
}

interface Ctx {
  request: Request
  env: Env
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// Ask the database whether this token belongs to the owner. Any failure is treated as "no":
// a misconfigured edge must refuse an upload, never wave one through.
async function isOwner(base: string, anon: string, token: string): Promise<boolean> {
  if (!base || !anon || !token) return false
  try {
    const res = await fetch(`${base}/rest/v1/rpc/is_site_owner`, {
      method: 'POST',
      headers: { apikey: anon, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    })
    if (!res.ok) return false
    return (await res.json()) === true
  } catch {
    return false
  }
}

async function put(client: AwsClient, url: string, file: File): Promise<void> {
  const body = new Uint8Array(await file.arrayBuffer())
  const res = await client.fetch(url, { method: 'PUT', body, headers: { 'content-type': 'image/webp' } })
  if (!res.ok) throw new Error(`R2 PUT ${res.status}`)
}

// A render is small; a fan sending a 40MB raw file through here is a mistake or an abuse, and
// either way it is not a photo we want. The browser already shrinks to <=1600px webp.
const MAX_BYTES = 8 * 1024 * 1024

export async function onRequestPost(context: Ctx): Promise<Response> {
  const { request, env } = context

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  const base = (env.VITE_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/+$/, '')
  const anon = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || ''
  if (!token) return json(401, { error: 'not signed in' })
  if (!(await isOwner(base, anon, token))) return json(403, { error: 'not the owner' })

  const acct = env.R2_ACCOUNT_ID, bucket = env.R2_BUCKET
  const pub = (env.R2_PUBLIC_BASE || '').replace(/\/+$/, '')
  if (!acct || !bucket || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !pub)
    return json(500, { error: 'R2 is not configured on the server' })

  let form: FormData
  try { form = await request.formData() } catch { return json(400, { error: 'expected multipart form' }) }
  const sha = String(form.get('sha256') || '')
  const card = form.get('card'), full = form.get('full')
  if (!/^[0-9a-f]{64}$/.test(sha) || !(card instanceof File) || !(full instanceof File))
    return json(400, { error: 'need sha256 plus card and full webp files' })
  if (card.size > MAX_BYTES || full.size > MAX_BYTES) return json(413, { error: 'render too large' })
  // A crop's renders go beside the original under their own key, never over it: the originals
  // are what every later crop is cut from, and the public host caches for hours, so an overwrite
  // would show stale framing. Tightly shaped so it can never climb out of this photo's prefix.
  const variant = String(form.get('variant') || '')
  if (variant && !/^c[0-9a-z]{1,16}$/.test(variant)) return json(400, { error: 'bad variant' })

  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    region: 'auto', service: 's3',
  })
  const ep = `https://${acct}.r2.cloudflarestorage.com/${bucket}`
  const prefix = variant ? `fan/${sha}/${variant}` : `fan/${sha}`
  try {
    await put(client, `${ep}/${prefix}/card.webp`, card)
    await put(client, `${ep}/${prefix}/full.webp`, full)
  } catch (e) {
    return json(502, { error: `upload to R2 failed: ${(e as Error).message}` })
  }

  return json(200, {
    storage_path: prefix,
    card_url: `${pub}/${prefix}/card.webp`,
    full_url: `${pub}/${prefix}/full.webp`,
  })
}

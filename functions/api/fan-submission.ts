// /api/fan-submission: a signed-in fan's photo into the PRIVATE submissions bucket, and the owner's
// (or the fan's own) way to see it again. Phase 2 of docs/FAN_UPLOADS.md.
//
// POST, any signed-in account: ask the database whether this photo may be filed
// (wpbl_check_photo_submission), put the two renders in the private bucket, then file the row
// (wpbl_submit_photo). Both calls go out on the FAN'S OWN token, so every limit and the block list
// live in the database, where a caller skipping this endpoint meets them too, and no service key
// is involved (scripts/migrations/CLAUDE.md: three write paths, and this is the first one).
//
// GET ?id=<submission>&v=card|full: stream one render back. The row is read with the caller's
// token, so RLS decides who may see it (the uploader and the owner), and nothing else here has to.
// The bucket has no public domain on purpose: until the owner approves, this is the only way in.
//
// Needs, beside the R2_* vars /api/fan-photo reads: R2_SUBMISSIONS_BUCKET.
import { AwsClient } from 'aws4fetch'

interface Env {
  VITE_SUPABASE_URL?: string
  SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
  SUPABASE_ANON_KEY?: string
  R2_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_SUBMISSIONS_BUCKET?: string
}

interface Ctx {
  request: Request
  env: Env
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

// The same cap as /api/fan-photo: the browser already shrinks to <=1600px webp.
const MAX_BYTES = 8 * 1024 * 1024
const SHA = /^[0-9a-f]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function setup(request: Request, env: Env) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  const base = (env.VITE_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/+$/, '')
  const anon = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || ''
  const acct = env.R2_ACCOUNT_ID, bucket = env.R2_SUBMISSIONS_BUCKET
  const r2 = acct && bucket && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY
    ? {
        client: new AwsClient({
          accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, region: 'auto', service: 's3',
        }),
        endpoint: `https://${acct}.r2.cloudflarestorage.com/${bucket}`,
      }
    : null
  return { token, base, anon, r2 }
}

/** Call a database function as the caller. Any failure reads as an error string, never a pass. */
async function rpc(base: string, anon: string, token: string, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: anon, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (res.status === 401) return 'signin'
  if (!res.ok) throw new Error(`${fn} ${res.status}`)
  return res.json()
}

export async function onRequestPost(context: Ctx): Promise<Response> {
  const { request, env } = context
  const { token, base, anon, r2 } = setup(request, env)
  if (!token) return json(401, { error: 'not signed in' })
  if (!base || !anon) return json(500, { error: 'Supabase is not configured on the server' })
  if (!r2) return json(500, { error: 'the submissions bucket is not configured on the server' })

  let form: FormData
  try { form = await request.formData() } catch { return json(400, { error: 'expected multipart form' }) }
  const sha = String(form.get('sha256') || '')
  const card = form.get('card'), full = form.get('full')
  if (!SHA.test(sha) || !(card instanceof File) || !(full instanceof File))
    return json(400, { error: 'need sha256 plus card and full webp files' })
  if (card.size > MAX_BYTES || full.size > MAX_BYTES) return json(413, { error: 'render too large' })

  let subjects: unknown
  try { subjects = JSON.parse(String(form.get('subjects') || '[]')) } catch { return json(400, { error: 'bad subjects' }) }
  const int = (k: string) => { const n = Number(form.get(k)); return Number.isInteger(n) && n > 0 ? n : null }

  try {
    // Before any bytes are stored, so a refused or blocked upload costs nothing in the bucket.
    const gate = await rpc(base, anon, token, 'wpbl_check_photo_submission', { p_sha: sha })
    // A blocked account is told it worked and nothing is stored (docs/FAN_UPLOADS.md decision 7).
    if (gate === 'blocked') return json(200, { status: 'ok' })
    if (gate !== 'ok') return json(gate === 'signin' ? 401 : 200, { status: gate })

    for (const [name, file] of [['card', card], ['full', full]] as const) {
      const res = await r2.client.fetch(`${r2.endpoint}/sub/${sha}/${name}.webp`, {
        method: 'PUT', body: new Uint8Array(await file.arrayBuffer()), headers: { 'content-type': 'image/webp' },
      })
      if (!res.ok) return json(502, { error: `upload to storage failed (${res.status})` })
    }

    const filed = await rpc(base, anon, token, 'wpbl_submit_photo', {
      p_sha: sha, p_width: int('width'), p_height: int('height'),
      p_credit: String(form.get('credit') || ''), p_note: String(form.get('note') || ''),
      p_subjects: subjects, p_terms_version: int('terms_version'),
    })
    return json(filed === 'signin' ? 401 : 200, { status: filed })
  } catch (e) {
    return json(502, { error: (e as Error).message })
  }
}

export async function onRequestGet(context: Ctx): Promise<Response> {
  const { request, env } = context
  const { token, base, anon, r2 } = setup(request, env)
  if (!token) return json(401, { error: 'not signed in' })
  if (!base || !anon || !r2) return json(500, { error: 'not configured on the server' })

  const url = new URL(request.url)
  const id = url.searchParams.get('id') || ''
  const variant = url.searchParams.get('v') === 'full' ? 'full' : 'card'
  if (!UUID.test(id)) return json(400, { error: 'bad id' })

  // RLS answers "may this caller see this submission": their own, or the owner's. A row that
  // comes back empty is a 404 whether it does not exist or is someone else's.
  const res = await fetch(`${base}/rest/v1/wpbl_photo_submissions?id=eq.${id}&select=storage_path`, {
    headers: { apikey: anon, authorization: `Bearer ${token}` },
  })
  if (res.status === 401) return json(401, { error: 'not signed in' })
  if (!res.ok) return json(502, { error: `lookup failed (${res.status})` })
  const rows = await res.json() as Array<{ storage_path: string }>
  const path = rows[0]?.storage_path
  if (!path || !/^sub\/[0-9a-f]{64}$/.test(path)) return json(404, { error: 'not found' })

  const obj = await r2.client.fetch(`${r2.endpoint}/${path}/${variant}.webp`)
  // Gone after the bucket's 30-day rule, or never uploaded (a row filed without the endpoint).
  if (obj.status === 404) return json(404, { error: 'image missing' })
  if (!obj.ok) return json(502, { error: `storage read failed (${obj.status})` })
  return new Response(obj.body, {
    headers: { 'content-type': 'image/webp', 'cache-control': 'private, no-store' },
  })
}

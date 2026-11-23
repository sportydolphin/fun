import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { onRequestGet, onRequestPost } from '../../../functions/api/fan-submission'

// /api/fan-submission. Pinned: nothing is stored before the database says yes, a blocked account
// is told it worked and nothing is stored, an approved upload lands under sub/<sha> in the PRIVATE
// bucket and is then filed, and a read only streams a row RLS returned with a well-formed path.

const env = {
  VITE_SUPABASE_URL: 'https://db.test', VITE_SUPABASE_ANON_KEY: 'anon',
  R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's',
  R2_SUBMISSIONS_BUCKET: 'private-bucket',
}
const sha = 'a'.repeat(64)
let calls: Array<{ url: string; method: string; body?: string }> = []
let gate = 'ok'
let rows: Array<{ storage_path: string }> = []

function post(fields: Record<string, string | Blob> = {}, token = 'tok') {
  const form = new FormData()
  form.set('sha256', sha)
  form.set('card', new File([new Uint8Array([1])], 'card.webp'))
  form.set('full', new File([new Uint8Array([2])], 'full.webp'))
  form.set('credit', 'Jamie Fan')
  form.set('terms_version', '1')
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {}
  return onRequestPost({ request: new Request('https://site/api/fan-submission', { method: 'POST', body: form, headers }), env })
}

beforeEach(() => {
  calls = []; gate = 'ok'; rows = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init)
    const url = req.url
    calls.push({ url, method: req.method, body: req.method === 'POST' ? await req.clone().text() : undefined })
    if (url.endsWith('/rpc/wpbl_check_photo_submission')) return Response.json(gate)
    if (url.endsWith('/rpc/wpbl_submit_photo')) return Response.json('ok')
    if (url.includes('/rest/v1/wpbl_photo_submissions')) return Response.json(rows)
    if (url.includes('r2.cloudflarestorage.com')) return new Response(req.method === 'GET' ? 'webp' : null, { status: 200 })
    return new Response('?', { status: 500 })
  }))
})
afterEach(() => vi.unstubAllGlobals())

const r2Puts = () => calls.filter(c => c.url.includes('r2.cloudflarestorage.com') && c.method === 'PUT')

describe('POST /api/fan-submission', () => {
  it('refuses a caller with no token before touching anything', async () => {
    const res = await post({}, '')
    expect(res.status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('checks, stores both renders in the private bucket, then files the row', async () => {
    const res = await post({ subjects: JSON.stringify([{ player: 'p1' }]) })
    expect(await res.json()).toEqual({ status: 'ok' })
    expect(calls.map(c => c.url.replace(/^https:\/\/[^/]+/, ''))).toEqual([
      '/rest/v1/rpc/wpbl_check_photo_submission',
      `/private-bucket/sub/${sha}/card.webp`,
      `/private-bucket/sub/${sha}/full.webp`,
      '/rest/v1/rpc/wpbl_submit_photo',
    ])
    const filed = JSON.parse(calls[3].body!)
    expect(filed).toMatchObject({ p_sha: sha, p_credit: 'Jamie Fan', p_terms_version: 1, p_subjects: [{ player: 'p1' }] })
  })

  it('stores nothing for a blocked account and still says it worked', async () => {
    gate = 'blocked'
    const res = await post()
    expect(await res.json()).toEqual({ status: 'ok' })
    expect(r2Puts()).toHaveLength(0)
    expect(calls.some(c => c.url.endsWith('/wpbl_submit_photo'))).toBe(false)
  })

  it('passes a refusal through without storing anything', async () => {
    gate = 'limited'
    const res = await post()
    expect(await res.json()).toEqual({ status: 'limited' })
    expect(r2Puts()).toHaveLength(0)
  })

  it('rejects a malformed hash', async () => {
    const res = await post({ sha256: 'nope' })
    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })
})

describe('GET /api/fan-submission', () => {
  const get = (q: string) => onRequestGet({
    request: new Request(`https://site/api/fan-submission?${q}`, { headers: { authorization: 'Bearer tok' } }), env,
  })
  const id = '11111111-2222-3333-4444-555555555555'

  it('streams a render RLS returned', async () => {
    rows = [{ storage_path: `sub/${sha}` }]
    const res = await get(`id=${id}&v=full`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(calls[calls.length - 1].url).toContain(`/private-bucket/sub/${sha}/full.webp`)
  })

  it('is a 404 when RLS returns nothing (someone else\'s, or missing)', async () => {
    const res = await get(`id=${id}`)
    expect(res.status).toBe(404)
    expect(calls.some(c => c.url.includes('r2.cloudflarestorage.com'))).toBe(false)
  })

  it('never reads outside sub/<sha>, whatever the row says', async () => {
    rows = [{ storage_path: 'fan/../secret' }]
    const res = await get(`id=${id}`)
    expect(res.status).toBe(404)
  })
})

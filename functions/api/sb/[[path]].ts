// GET /api/sb/rest/v1/<table>?<query>: a signed-out Supabase read, answered from Cloudflare's edge
// cache when it can be. Which tables, and for how long, is src/lib/edgeTables.ts, which also says
// why this exists. The browser routes here from src/lib/supabase.ts.
//
// IT ALWAYS ASKS AS ANON. The caller's Authorization header is thrown away and the anon key put
// in its place, so a cached answer can never be one signed-in reader's rows handed to the next.
// The browser only sends signed-out reads here anyway; this makes it true whatever arrives.
//
// THE KEY IS THE WHOLE QUESTION: the upstream URL plus the three headers PostgREST answers
// differently on (Accept for `.single()`, Prefer for counts, Accept-Profile for the schema).
// Errors are passed through and never stored, so a failed read is retried by the next reader.
//
// `x-edge` on every answer says what happened (hit, stale, miss, pass), and its absence is how
// the browser knows it reached something else, such as `vite preview`'s app shell, and must go
// to Supabase directly. Served under `/api/*`, which public/_routes.json already routes here.
import { EDGE_TABLES, EDGE_POLICY, edgeTable, leagueActiveQuery } from '../../../src/lib/edgeTables'

interface Env {
  VITE_SUPABASE_URL?: string
  SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
  SUPABASE_ANON_KEY?: string
}

interface Ctx {
  request: Request
  env: Env
  waitUntil?: (p: Promise<unknown>) => void
}

const VARY = ['accept', 'prefer', 'accept-profile'] as const
// The headers worth handing back: the body's type, and the row count a counted read carries.
const KEEP = ['content-type', 'content-range', 'preference-applied'] as const
const STORED_AT = 'x-edge-stored-at'

function answer(body: BodyInit | null, status: number, from: Headers, edge: string, age?: number): Response {
  const h = new Headers({ 'x-edge': edge, 'cache-control': 'no-store' })
  for (const k of KEEP) { const v = from.get(k); if (v) h.set(k, v) }
  if (age != null) h.set('age', String(Math.max(0, Math.round(age))))
  return new Response(body, { status, headers: h })
}

// Whether the league is active (edgeTables.ts), remembered for a minute in this isolate and in
// the location's cache, so the answer costs one small read per location per minute at most.
const ACTIVE_FOR_MS = 60_000
let activeMemo: { at: number; active: boolean } | null = null

/** Test seam: forget the remembered answer. */
export function __resetLeagueActive(): void { activeMemo = null }

async function leagueActive(base: string, anon: string, cache: Cache | undefined, waitUntil?: (p: Promise<unknown>) => void): Promise<boolean> {
  const now = Date.now()
  if (activeMemo && now - activeMemo.at < ACTIVE_FOR_MS) return activeMemo.active
  const key = new Request('https://sb-edge.invalid/__league_active')
  try {
    const hit = cache ? await cache.match(key) : undefined
    if (hit) {
      const { active, at } = await hit.json() as { active: boolean; at: number }
      if (now - at < ACTIVE_FOR_MS) { activeMemo = { at, active }; return active }
    }
    const res = await fetch(`${base}${leagueActiveQuery(new Date(now))}`, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } })
    if (!res.ok) return true
    const active = (await res.json() as unknown[]).length > 0
    activeMemo = { at: now, active }
    if (cache) {
      const put = cache.put(key, new Response(JSON.stringify({ active, at: now }), { headers: { 'cache-control': 'max-age=60' } })).catch(() => {})
      if (waitUntil) waitUntil(put); else await put
    }
    return active
  } catch {
    return true
  }
}

export async function onRequestGet(context: Ctx): Promise<Response> {
  const { request, env } = context
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/api\/sb/, '')
  const table = edgeTable(path)
  const base = (env.VITE_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/+$/, '')
  const anon = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || ''
  if (!table || !base || !anon) return new Response('Not found', { status: 404, headers: { 'x-edge': 'refused' } })

  const upstream = `${base}${path}${url.search}`
  const headers: Record<string, string> = { apikey: anon, Authorization: `Bearer ${anon}` }
  for (const k of VARY) { const v = request.headers.get(k); if (v) headers[k] = v }

  // A synthetic key: written and read only here, never fetched.
  const keyUrl = new URL(`https://sb-edge.invalid${path}${url.search}`)
  for (const k of VARY) if (headers[k]) keyUrl.searchParams.set(`__h_${k}`, headers[k])
  const key = new Request(keyUrl.toString())

  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default
  const tier = EDGE_TABLES[table] === 'live' && !(await leagueActive(base, anon, cache, context.waitUntil)) ? 'slow' : EDGE_TABLES[table]
  const policy = EDGE_POLICY[tier]

  const fetchAndStore = async (): Promise<Response> => {
    const res = await fetch(upstream, { headers })
    const body = await res.arrayBuffer()
    if (cache && (res.status === 200 || res.status === 206)) {
      const stored = new Headers(res.headers)
      stored.set(STORED_AT, String(Date.now()))
      // The Cache API's own expiry: the end of the stale window, after which nothing serves it.
      stored.set('cache-control', `public, max-age=${policy.fresh + policy.stale}`)
      stored.delete('set-cookie')
      const put = cache.put(key, new Response(body, { status: res.status, headers: stored })).catch(() => {})
      if (context.waitUntil) context.waitUntil(put); else await put
    }
    return answer(body, res.status, res.headers, res.ok ? 'miss' : 'pass')
  }

  if (cache) {
    try {
      const hit = await cache.match(key)
      if (hit) {
        const age = (Date.now() - Number(hit.headers.get(STORED_AT) || 0)) / 1000
        if (age < policy.fresh) return answer(hit.body, hit.status, hit.headers, 'hit', age)
        if (age < policy.fresh + policy.stale && context.waitUntil) {
          // Serve what is held and refresh it behind the reader, who does not wait on it.
          context.waitUntil(fetchAndStore().catch(() => {}))
          return answer(hit.body, hit.status, hit.headers, 'stale', age)
        }
      }
    } catch { /* a cache failure must never be fatal: ask the database */ }
  }
  try {
    return await fetchAndStore()
  } catch {
    return new Response('Upstream unreachable', { status: 502, headers: { 'x-edge': 'error' } })
  }
}

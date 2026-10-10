// The `fetch` the Supabase client is built with: a signed-out GET of a table in
// src/lib/edgeTables.ts is asked of this site's own edge cache (functions/api/sb) instead of
// Supabase, and everything else goes to Supabase untouched.
//
// SIGNED-OUT ONLY, decided by the bearer: supabase-js sends the anon key as the bearer until there
// is a session, and the reader's own token after. A signed-in reader can be shown rows anon cannot
// (the owner sees unapproved fan photos, for one), so their reads stay direct and are never cached.
//
// IT FALLS BACK TO SUPABASE whenever the edge did not answer as itself: a network failure, a 5xx,
// or a response without `x-edge`, which is what `vite preview` gives (its app shell, with a 200).
// A read the cache cannot serve costs one extra round trip, never a missing table.
import { EDGE_PREFIX, edgeTable } from './edgeTables'

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export function edgeFetch(supabaseUrl: string, anonKey: string, origin: string, base: Fetch): Fetch {
  const root = supabaseUrl.replace(/\/+$/, '')
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    if (method !== 'GET' || !url.startsWith(`${root}/rest/v1/`)) return base(input, init)
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    if (headers.get('authorization') !== `Bearer ${anonKey}`) return base(input, init)
    const u = new URL(url)
    if (!edgeTable(u.pathname)) return base(input, init)
    try {
      const res = await base(`${origin}${EDGE_PREFIX}${u.pathname}${u.search}`, { ...init, headers })
      if (res.headers.has('x-edge') && res.status < 500) return res
    } catch (e) {
      // An abort is the caller's decision, not the edge failing: do not retry it elsewhere.
      if (init?.signal?.aborted) throw e
    }
    return base(input, init)
  }
}

// The browser's Supabase client, assembled from the two parts every page needs (auth and the REST
// API) instead of `createClient`.
//
// WHY NOT createClient. It constructs storage, realtime and the functions client up front, so all
// three ship in the entry chunk whether or not anything uses them: 274KB of the entry's 1.87MB of
// source, about 15% of what every first visit downloads before it can draw. The site never uses
// storage, uses realtime only while a WPBL game is live, and calls two edge functions from two
// dialogs. Realtime is loaded on its first subscription (`watchChanges`), and the functions are a
// plain POST (`functions.invoke`).
//
// WHAT MUST MATCH createClient, or every signed-in reader is silently signed out on deploy:
// the auth storage key (`sb-<project ref>-auth-token`) and the auth defaults below. And every
// request carries the reader's own token when there is one, the anon key otherwise, exactly as
// `fetchWithAuth` in supabase-js does, or RLS answers a signed-in reader as anon.
//
// THE AUTH CLIENT LOADS ONLY FOR A READER WHO MAY BE SIGNED IN. `@supabase/auth-js` was about
// 40 KB of the JavaScript every reader downloaded before Home could draw (170 KB before compressing,
// the third largest thing in that load after react-dom and MUI), and most readers have never signed
// in. `auth` below is a stand-in with the same methods: with no session in storage and no sign-in
// answer in the address it says "no session" on the spot and the REST client sends the anon key, as
// the real one would. Anything that can change that (a sign-in, a sign-up, a reset, OAuth, another
// tab signing in) loads the real client first and hands it every listener registered so far, so
// AuthContext hears SIGNED_IN as before. A reader with a stored session, or arriving from an OAuth
// or email link, gets the real client at once, built exactly as it always was.
import type { AuthChangeEvent, Session } from '@supabase/auth-js'
import { PostgrestClient } from '@supabase/postgrest-js'
import type { RealtimeChannel, RealtimeClient } from '@supabase/realtime-js'
import { edgeFetch } from './edgeFetch'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY as string

type Fetch = typeof fetch

// Signed-out reads of public tables go through the edge cache in a built site (src/lib/edgeTables.ts
// says which and why). Not under `npm run dev` or Vitest, where there is no Pages Function to ask:
// those talk to Supabase exactly as before.
const baseFetch: Fetch = import.meta.env.PROD && typeof window !== 'undefined'
  ? edgeFetch(supabaseUrl, supabaseKey, window.location.origin, (input, init) => fetch(input, init))
  : (input, init) => fetch(input, init)

// The client's type, without importing the module: the import is what this file exists to delay.
type AuthApi = InstanceType<typeof import('@supabase/auth-js')['AuthClient']>
type AuthListener = (event: AuthChangeEvent, session: Session | null) => void

/** True when the real auth client has anything to find: a stored session, or the answer of an
 *  OAuth or email link in the address (implicit flow, so `#access_token=` or an error). */
function mayBeSignedIn(storageKey: string): boolean {
  try { if (localStorage.getItem(storageKey)) return true } catch { /* storage off: no stored session */ }
  if (typeof window === 'undefined') return false
  const { hash, search } = window.location
  return /(?:^|[#&?])(access_token|refresh_token|error_description)=/.test(`${hash}&${search}`)
}

function createSiteClient(url: string, key: string, customFetch: Fetch) {
  const base = new URL(url.endsWith('/') ? url : `${url}/`)
  const storageKey = `sb-${base.hostname.split('.')[0]}-auth-token`

  // The real client, built on first need. Listeners registered before it existed are handed over
  // the moment it does; their unsubscribes work either side of that.
  let real: AuthApi | null = null
  let loading: Promise<AuthApi> | null = null
  const pending = new Set<{ cb: AuthListener; off?: () => void }>()
  const loadAuth = (): Promise<AuthApi> => loading ??= import('@supabase/auth-js').then(({ AuthClient }) => {
    real = new AuthClient({
      url: new URL('auth/v1', base).href,
      headers: { Authorization: `Bearer ${key}`, apikey: key },
      storageKey,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: 'implicit',
      fetch: customFetch,
      hasCustomAuthorizationHeader: false,
    })
    for (const l of pending) l.off = real.onAuthStateChange(l.cb).data.subscription.unsubscribe
    return real
  })
  if (mayBeSignedIn(storageKey)) void loadAuth()
  // Signed in from another tab: the real client would have heard the storage event; this one loads
  // it, and it reads the new session and tells the listeners.
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', e => { if (e.key === storageKey && e.newValue && !real) void loadAuth() })
  }
  const withAuth = <A extends unknown[], R>(pick: (a: AuthApi) => (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => { const a = await loadAuth(); return pick(a).apply(a, args) }

  const auth = {
    getSession: (): ReturnType<AuthApi['getSession']> =>
      real || loading ? loadAuth().then(a => a.getSession())
        : Promise.resolve({ data: { session: null }, error: null }),
    onAuthStateChange(cb: AuthListener): { data: { subscription: { unsubscribe: () => void } } } {
      if (real) return real.onAuthStateChange(cb)
      const l: { cb: AuthListener; off?: () => void } = { cb }
      pending.add(l)
      return { data: { subscription: { unsubscribe: () => { pending.delete(l); l.off?.() } } } }
    },
    signInWithPassword: withAuth(a => a.signInWithPassword),
    signInWithOAuth: withAuth(a => a.signInWithOAuth),
    signUp: withAuth(a => a.signUp),
    signOut: withAuth(a => a.signOut),
    resetPasswordForEmail: withAuth(a => a.resetPasswordForEmail),
    updateUser: withAuth(a => a.updateUser),
  }

  const accessToken = async (): Promise<string> => {
    const { data } = await auth.getSession()
    return data.session?.access_token ?? key
  }

  const authedFetch: Fetch = async (input, init) => {
    const headers = new Headers(init?.headers)
    if (!headers.has('apikey')) headers.set('apikey', key)
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${await accessToken()}`)
    return customFetch(input, { ...init, headers })
  }

  const rest = new PostgrestClient(new URL('rest/v1', base).href, { fetch: authedFetch })

  // Realtime, on first use. The token follows the session the way createClient's does: set on
  // sign-in and refresh, cleared on sign-out.
  let realtime: Promise<RealtimeClient> | null = null
  const loadRealtime = () => realtime ??= import('@supabase/realtime-js').then(({ RealtimeClient }) => {
    const ws = new URL('realtime/v1', base)
    ws.protocol = ws.protocol.replace('http', 'ws')
    const client = new RealtimeClient(ws.href, { accessToken, fetch: authedFetch, params: { apikey: key } })
    auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') void client.setAuth(session?.access_token)
      else if (event === 'SIGNED_OUT') void client.setAuth()
    })
    return client
  })

  return {
    auth,
    from: rest.from.bind(rest) as typeof rest.from,
    rpc: rest.rpc.bind(rest) as typeof rest.rpc,

    /** Call `onChange` whenever a row matching any of `specs` changes. Returns the unsubscribe,
     *  which is safe to call before the realtime module has even loaded. */
    watchChanges(name: string, specs: { table: string; filter: string }[], onChange: () => void): () => void {
      let closed = false
      let channel: RealtimeChannel | null = null
      void loadRealtime().then(client => {
        if (closed) return
        let ch = client.channel(name)
        for (const s of specs) ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: s.table, filter: s.filter }, onChange)
        channel = ch.subscribe()
      })
      return () => {
        closed = true
        if (channel) void loadRealtime().then(client => client.removeChannel(channel!))
      }
    },

    functions: {
      /** POST to an edge function as the reader. On a non-2xx answer `error.context` is the
       *  Response, as supabase-js gives it, so a caller can read the function's own message. */
      async invoke(name: string): Promise<{ data: unknown; error: (Error & { context?: Response }) | null }> {
        try {
          const res = await authedFetch(new URL(`functions/v1/${name}`, base).href, { method: 'POST' })
          if (!res.ok) return { data: null, error: Object.assign(new Error(`Edge function ${name} answered ${res.status}`), { context: res }) }
          const type = res.headers.get('content-type') ?? ''
          return { data: type.includes('json') ? await res.json() : await res.text(), error: null }
        } catch (e) {
          return { data: null, error: e instanceof Error ? e : new Error(String(e)) }
        }
      },
    },
  }
}

export const supabase = createSiteClient(supabaseUrl, supabaseKey, baseFetch)

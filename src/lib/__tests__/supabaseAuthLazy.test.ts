// @vitest-environment jsdom
// The auth client is loaded only for a reader who may be signed in (src/lib/supabase.ts). Get it
// wrong one way and every reader downloads it again; the other way and a signed-in reader is
// treated as signed out, and RLS answers them as anon. These pin both halves with a fake client.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const built = vi.fn()
const listeners: ((event: string, session: unknown) => void)[] = []
const session = { access_token: 'user-token' }

vi.mock('@supabase/auth-js', () => ({
  AuthClient: class {
    constructor(opts: unknown) { built(opts) }
    getSession = vi.fn(async () => ({ data: { session: localStorage.getItem(KEY) ? session : null }, error: null }))
    onAuthStateChange = vi.fn((cb: (event: string, s: unknown) => void) => {
      listeners.push(cb)
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })
    signInWithPassword = vi.fn(async () => {
      localStorage.setItem(KEY, '{}')
      for (const l of listeners) l('SIGNED_IN', session)
      return { data: {}, error: null }
    })
  },
}))

// Placeholder project from vite.config.js's test env: http://127.0.0.1:54321, so the ref is the host.
const KEY = 'sb-127-auth-token'

async function freshClient() {
  vi.resetModules()
  return (await import('../supabase')).supabase
}

beforeEach(() => {
  localStorage.clear()
  built.mockClear()
  listeners.length = 0
  window.history.replaceState(null, '', '/wpbl')
})
afterEach(() => vi.unstubAllGlobals())

describe('the auth client, loaded on need', () => {
  it('is not loaded for a reader with no session, who reads as anon', async () => {
    const asked: Headers[] = []
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: RequestInit) => {
      asked.push(new Headers(init?.headers))
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const sb = await freshClient()
    expect((await sb.auth.getSession()).data.session).toBeNull()
    await sb.from('wpbl_teams').select('*')
    expect(built).not.toHaveBeenCalled()
    expect(asked[0].get('Authorization')).toBe('Bearer test-anon-key')
  })

  it('is loaded at once for a stored session, and reads carry its token', async () => {
    localStorage.setItem(KEY, '{}')
    const asked: Headers[] = []
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: RequestInit) => {
      asked.push(new Headers(init?.headers))
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const sb = await freshClient()
    await sb.from('wpbl_teams').select('*')
    expect(built).toHaveBeenCalledTimes(1)
    expect(asked[0].get('Authorization')).toBe('Bearer user-token')
  })

  it('is loaded at once for an OAuth or email link answer in the address', async () => {
    window.history.replaceState(null, '', '/wpbl#access_token=abc&type=recovery')
    const sb = await freshClient()
    await sb.auth.getSession()
    expect(built).toHaveBeenCalledTimes(1)
  })

  it('hands earlier listeners to the real client when a sign-in loads it', async () => {
    const sb = await freshClient()
    const heard: string[] = []
    sb.auth.onAuthStateChange(event => { heard.push(event) })
    expect(built).not.toHaveBeenCalled()
    await sb.auth.signInWithPassword({ email: 'reader@example.com', password: 'not-a-real-password' })
    expect(built).toHaveBeenCalledTimes(1)
    expect(heard).toContain('SIGNED_IN')
    expect((await sb.auth.getSession()).data.session).toEqual(session)
  })

  // Asserted on this client's own answer, not a count: the clients the tests above built still
  // listen on the same window, and they load too.
  it('loads when another tab signs in', async () => {
    const sb = await freshClient()
    expect((await sb.auth.getSession()).data.session).toBeNull()
    localStorage.setItem(KEY, '{}')
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: '{}' }))
    expect((await sb.auth.getSession()).data.session).toEqual(session)
  })
})

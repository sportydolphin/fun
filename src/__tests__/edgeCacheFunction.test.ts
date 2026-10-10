import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { onRequestGet, __resetLeagueActive } from '../../functions/api/sb/[[path]]'

const env = { VITE_SUPABASE_URL: 'https://proj.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' }

// The Workers Cache API, as far as the function uses it.
function fakeCache() {
  const store = new Map<string, Response>()
  return {
    store,
    match: async (k: Request) => store.get(k.url)?.clone(),
    put: async (k: Request, r: Response) => { store.set(k.url, r.clone()) },
  }
}

let cache: ReturnType<typeof fakeCache>
let upstream: ReturnType<typeof vi.fn>
let pending: Promise<unknown>[]
// Answers the league-active question, which every live-tier read asks first.
let gameToday: boolean
const isActiveQuery = (u: unknown) => String(u).includes('status.eq.live')
const tableCalls = () => upstream.mock.calls.filter(c => !isActiveQuery(c[0]))

const call = async (path: string, headers: Record<string, string> = {}) => {
  const res = await onRequestGet({
    request: new Request(`https://sportydolphin.fun/api/sb${path}`, { headers }),
    env,
    waitUntil: p => { pending.push(p) },
  })
  await Promise.all(pending)
  return res
}

beforeEach(() => {
  cache = fakeCache()
  vi.stubGlobal('caches', { default: cache })
  gameToday = true
  upstream = vi.fn(async (u: unknown, _i?: RequestInit) => (isActiveQuery(u)
    ? new Response(gameToday ? '[{"id":"g"}]' : '[]', { status: 200 })
    : new Response('[{"id":1}]', { status: 200, headers: { 'content-type': 'application/json' } })))
  vi.stubGlobal('fetch', upstream)
  pending = []
  __resetLeagueActive()
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('the edge cache function', () => {
  it('asks Supabase once, as anon, then answers from the cache', async () => {
    const first = await call('/rest/v1/wpbl_teams?select=*', { authorization: 'Bearer someone' })
    expect(first.headers.get('x-edge')).toBe('miss')
    expect((upstream.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe('Bearer anon')
    const second = await call('/rest/v1/wpbl_teams?select=*')
    expect(second.headers.get('x-edge')).toBe('hit')
    expect(await second.text()).toBe('[{"id":1}]')
    expect(tableCalls()).toHaveLength(1)
  })

  // `.single()` asks for an object rather than an array: the same URL, a different answer.
  it('keys on the headers PostgREST answers differently on', async () => {
    await call('/rest/v1/wpbl_teams?select=*')
    await call('/rest/v1/wpbl_teams?select=*', { accept: 'application/vnd.pgrst.object+json' })
    expect(tableCalls()).toHaveLength(2)
  })

  it('serves a slow table stale while it refreshes, and a live one never', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
    await call('/rest/v1/wpbl_players?select=*')
    await call('/rest/v1/wpbl_games?select=*')
    vi.setSystemTime(3_600_000)
    expect((await call('/rest/v1/wpbl_players?select=*')).headers.get('x-edge')).toBe('stale')
    expect((await call('/rest/v1/wpbl_games?select=*')).headers.get('x-edge')).toBe('miss')
    expect(tableCalls()).toHaveLength(4)
    // The stale answer's refresh is now the held one.
    expect((await call('/rest/v1/wpbl_players?select=*')).headers.get('x-edge')).toBe('hit')
  })

  // Nothing a game writes can change with no game on, so the season tables are held like the rest.
  it('holds the live tables stale while the league is idle', async () => {
    gameToday = false
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
    await call('/rest/v1/wpbl_game_plays?select=*')
    vi.setSystemTime(3_600_000)
    __resetLeagueActive()
    expect((await call('/rest/v1/wpbl_game_plays?select=*')).headers.get('x-edge')).toBe('stale')
  })

  it('treats an unreadable league signal as active', async () => {
    upstream.mockImplementation(async (u: unknown) => (isActiveQuery(u)
      ? new Response('', { status: 500 })
      : new Response('[]', { status: 200 })))
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
    await call('/rest/v1/wpbl_games?select=*')
    vi.setSystemTime(60_000)
    __resetLeagueActive()
    expect((await call('/rest/v1/wpbl_games?select=*')).headers.get('x-edge')).toBe('miss')
  })

  it('never stores an error', async () => {
    upstream.mockResolvedValueOnce(new Response('{"message":"bad"}', { status: 400 }))
    expect((await call('/rest/v1/wpbl_teams?select=nope')).headers.get('x-edge')).toBe('pass')
    expect(cache.store.size).toBe(0)
  })

  it('refuses a table it does not serve', async () => {
    expect((await call('/rest/v1/user_preferences?select=*')).status).toBe(404)
    expect((await call('/rest/v1/rpc/wpbl_award_results')).status).toBe(404)
    expect(upstream).not.toHaveBeenCalled()
  })
})

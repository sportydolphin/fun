import { describe, it, expect, vi } from 'vitest'
import { edgeFetch } from '../lib/edgeFetch'
import { edgeTable } from '../lib/edgeTables'

const SB = 'https://proj.supabase.co'
const ANON = 'anon-key'
const ORIGIN = 'https://sportydolphin.fun'
const ok = (edge?: string) => new Response('[]', { status: 200, headers: edge ? { 'x-edge': edge } : {} })
const anonHeaders = { apikey: ANON, Authorization: `Bearer ${ANON}` }

describe('edgeFetch', () => {
  it('sends a signed-out read of a public table to the edge', async () => {
    const base = vi.fn(async (_u: unknown, _i?: RequestInit) => ok('hit'))
    await edgeFetch(SB, ANON, ORIGIN, base)(`${SB}/rest/v1/wpbl_players?select=*`, { headers: anonHeaders })
    expect(base).toHaveBeenCalledTimes(1)
    expect(base.mock.calls[0][0]).toBe(`${ORIGIN}/api/sb/rest/v1/wpbl_players?select=*`)
  })

  // A signed-in reader may see rows anon cannot, and the cache would hand them to the next reader.
  it('keeps a signed-in read, a write, an RPC and an unlisted table direct', async () => {
    const base = vi.fn(async (_u: unknown, _i?: RequestInit) => ok())
    const f = edgeFetch(SB, ANON, ORIGIN, base)
    await f(`${SB}/rest/v1/wpbl_fan_photos?select=*`, { headers: { apikey: ANON, Authorization: 'Bearer user-jwt' } })
    await f(`${SB}/rest/v1/wpbl_players`, { method: 'POST', headers: anonHeaders })
    await f(`${SB}/rest/v1/rpc/wpbl_award_results`, { method: 'POST', headers: anonHeaders })
    await f(`${SB}/rest/v1/user_preferences?select=*`, { headers: anonHeaders })
    expect(base.mock.calls.every(c => String(c[0]).startsWith(SB))).toBe(true)
  })

  // `vite preview` answers /api/sb with the app shell and a 200, which must not reach the client.
  it('falls back to Supabase when the edge did not answer as itself', async () => {
    const shell = vi.fn(async (_u: unknown) => ok())
    await edgeFetch(SB, ANON, ORIGIN, shell)(`${SB}/rest/v1/wpbl_games?select=*`, { headers: anonHeaders })
    expect(shell.mock.calls.map(c => String(c[0]).startsWith(ORIGIN) ? 'edge' : 'direct')).toEqual(['edge', 'direct'])

    const down = vi.fn(async (u: unknown) => (String(u).startsWith(ORIGIN) ? new Response('', { status: 502, headers: { 'x-edge': 'error' } }) : ok()))
    const res = await edgeFetch(SB, ANON, ORIGIN, down)(`${SB}/rest/v1/wpbl_games?select=*`, { headers: anonHeaders })
    expect(down).toHaveBeenCalledTimes(2)
    expect(res.status).toBe(200)
  })

  it('only matches a table path exactly', () => {
    expect(edgeTable('/rest/v1/wpbl_games')).toBe('wpbl_games')
    expect(edgeTable('/rest/v1/wpbl_games/x')).toBeNull()
    expect(edgeTable('/rest/v1/events')).toBeNull()
    expect(edgeTable('/rest/v1/constructor')).toBeNull()
  })
})

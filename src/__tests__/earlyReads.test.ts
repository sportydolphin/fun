// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { EARLY_READS, EARLY_READS_GLOBAL, takeEarlyRead } from '../lib/earlyReads'
import { edgeFetch } from '../lib/edgeFetch'
import { edgeTable } from '../lib/edgeTables'
import html from '../../index.html?raw'

// index.html starts these before any bundle loads and the client claims them by exact URL, so the
// three copies of the list (earlyReads.ts, index.html, the api functions' own queries) must agree.
// A query edited in one place leaves the early answer unclaimed: no error, just every cold load
// reading the same rows twice. See src/lib/earlyReads.ts.

const SB = 'https://proj.supabase.co'
const ANON = 'anon-key'
const ORIGIN = 'https://sportydolphin.fun'
const anonHeaders = { apikey: ANON, Authorization: `Bearer ${ANON}` }
const early = (map: Record<string, Promise<Response>>) => { (window as unknown as Record<string, unknown>)[EARLY_READS_GLOBAL] = map }

afterEach(() => {
  delete (window as unknown as Record<string, unknown>)[EARLY_READS_GLOBAL]
  vi.unstubAllGlobals()
})

describe('early reads', () => {
  it('index.html starts exactly the listed reads', () => {
    const started = [...html.matchAll(/'(\/rest\/v1\/[^']+)'/g)].map(m => m[1])
    expect(started).toEqual([...EARLY_READS])
    expect(html).toContain(`window.${EARLY_READS_GLOBAL} = reads`)
  })

  it('lists only tables the edge cache serves', () => {
    for (const path of EARLY_READS) expect(edgeTable(path.split('?')[0])).toBeTruthy()
  })

  it('are the URLs the api functions build', async () => {
    const asked: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      asked.push(`${u.pathname}${u.search}`)
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const api = await import('../wpbl/api')
    await Promise.all([api.fetchWpblTeams(), api.fetchWpblSchedule(), api.fetchWpblAllPlayers()])
    for (const path of EARLY_READS) expect(asked).toContain(path)
  })

  it('edgeFetch answers from an early read once, then asks the network', async () => {
    const body = new Response('[1]', { status: 200, headers: { 'x-edge': 'hit' } })
    early({ '/rest/v1/wpbl_players?select=*': Promise.resolve(body) })
    const base = vi.fn(async () => new Response('[2]', { status: 200, headers: { 'x-edge': 'miss' } }))
    const f = edgeFetch(SB, ANON, ORIGIN, base)
    expect(await (await f(`${SB}/rest/v1/wpbl_players?select=*`, { headers: anonHeaders })).text()).toBe('[1]')
    expect(base).not.toHaveBeenCalled()
    expect(await (await f(`${SB}/rest/v1/wpbl_players?select=*`, { headers: anonHeaders })).text()).toBe('[2]')
    expect(base).toHaveBeenCalledTimes(1)
  })

  // `vite preview` and `npm run dev` answer /api/sb with the app shell: the client must read normally.
  it('an early read that is not a good edge answer is asked again', async () => {
    early({ '/rest/v1/wpbl_teams?select=*&order=sort_order.asc': Promise.resolve(new Response('<html>', { status: 200 })) })
    const base = vi.fn(async () => new Response('[]', { status: 200, headers: { 'x-edge': 'miss' } }))
    await edgeFetch(SB, ANON, ORIGIN, base)(`${SB}/rest/v1/wpbl_teams?select=*&order=sort_order.asc`, { headers: anonHeaders })
    expect(base).toHaveBeenCalledTimes(1)
    expect(String((base.mock.calls[0] as unknown[])[0])).toBe(`${ORIGIN}/api/sb/rest/v1/wpbl_teams?select=*&order=sort_order.asc`)
  })

  it('takeEarlyRead is empty without the global', () => {
    expect(takeEarlyRead(EARLY_READS[0])).toBeNull()
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadRoster, __resetRosterCache } from '../../../functions/discord/wpbl'

// The Discord bot's roster cache. This exists for one reason: Discord fires an autocomplete
// interaction per keystroke, and each one needs the whole roster to match against, so the
// uncached version re-read every player and team several times per search. These tests
// assert the thing that actually saves — that repeat loads inside the window issue no
// further database reads — because it isn't observable from outside the function without a
// signed interaction from Discord.

const env = { VITE_SUPABASE_URL: 'https://db.test', VITE_SUPABASE_ANON_KEY: 'anon' }

function stubFetch() {
  const calls: string[] = []
  const fake = vi.fn(async (url: string | URL | Request) => {
    const u = String(url)
    calls.push(u)
    const body = u.includes('wpbl_players')
      ? [{ id: 'p1', name: 'Kelsie Whitmore', position: 'RHP', team_id: 'SF' }]
      : [{ id: 'SF', city: 'San Francisco', name: 'Firebells', color: '#e8412c' }]
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fake)
  return calls
}

describe('the bot roster cache', () => {
  beforeEach(() => { __resetRosterCache() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('reads players and teams once on a cold load', async () => {
    const calls = stubFetch()
    const roster = await loadRoster(env, new AbortController().signal)
    expect(roster?.players).toHaveLength(1)
    expect(roster?.teams).toHaveLength(1)
    expect(calls).toHaveLength(2)
    expect(calls.some(c => c.includes('wpbl_players'))).toBe(true)
    expect(calls.some(c => c.includes('wpbl_teams'))).toBe(true)
  })

  it('serves repeat loads without touching the database again', async () => {
    const calls = stubFetch()
    await loadRoster(env, new AbortController().signal)
    expect(calls).toHaveLength(2)

    // What an autocomplete burst looks like: several interactions in a couple of seconds.
    for (let i = 0; i < 8; i++) await loadRoster(env, new AbortController().signal)

    expect(calls).toHaveLength(2)   // still just the cold load
  })

  it('returns the same data on a cached load as on the cold one', async () => {
    stubFetch()
    const first = await loadRoster(env, new AbortController().signal)
    const second = await loadRoster(env, new AbortController().signal)
    expect(second).toEqual(first)
  })

  it('reports null rather than throwing when the database is not configured', async () => {
    stubFetch()
    expect(await loadRoster({}, new AbortController().signal)).toBeNull()
  })
})

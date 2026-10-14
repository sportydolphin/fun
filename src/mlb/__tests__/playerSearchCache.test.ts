import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearPlayerSearchCache, searchPlayers } from '../api'

// The search asks StatsAPI on every settled keystroke. Backspacing, a compare asking for both
// halves on each key, and the typo fallback's short starts all re-asked for answers they had.
describe('searchPlayers cache', () => {
  const ok = (people: unknown[]) => ({ ok: true, status: 200, json: async () => ({ people }) })
  beforeEach(() => clearPlayerSearchCache())
  afterEach(() => vi.unstubAllGlobals())

  it('asks once for the same name, however it is cased, and shares a call in flight', async () => {
    const fetchMock = vi.fn(async () => ok([{ id: 1, fullName: 'Shohei Ohtani', active: true }]))
    vi.stubGlobal('fetch', fetchMock)
    const [a, b] = await Promise.all([searchPlayers('Ohtani'), searchPlayers('ohtani ')])
    expect(await searchPlayers('OHTANI')).toEqual(a)
    expect(b).toEqual(a)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps no failure, so the next ask tries again', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValueOnce(ok([{ id: 1, fullName: 'Shohei Ohtani' }]))
    vi.stubGlobal('fetch', fetchMock)
    await expect(searchPlayers('ohtani')).rejects.toThrow('503')
    expect(await searchPlayers('ohtani')).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('hands each caller its own list, so one sorting it cannot reorder another', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok([{ id: 1 }, { id: 2 }])))
    const a = await searchPlayers('x')
    a.reverse()
    expect((await searchPlayers('x')).map(p => p.id)).toEqual([1, 2])
  })
})

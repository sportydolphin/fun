// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadMlbPlayerIndex, mlbPlayerIndexReady, resetMlbPlayerIndex, searchMlbPlayerIndex } from '../playerIndex'
import type { Player } from '../types'

const pos = { code: '8', name: 'Outfielder', type: 'Outfielder', abbreviation: 'CF' }
const person = (id: number, fullName: string, active = true): Player => ({ id, fullName, active, primaryPosition: pos })
const PEOPLE = [
  person(1, 'Ronald Acuña Jr.'),
  person(2, 'Luisangel Acuña'),
  person(3, 'Paul Skenes'),
  person(4, 'Bobby Witt Jr.'),
  person(5, 'Old Skenesworth', false),
]
const ok = (people: unknown[]) => ({ ok: true, status: 200, json: async () => ({ people }) })

describe('MLB player index', () => {
  beforeEach(() => resetMlbPlayerIndex())
  afterEach(() => { localStorage.clear(); vi.unstubAllGlobals() })

  it('reads the season once and keeps it for the next page load', async () => {
    const fetchMock = vi.fn(async () => ok(PEOPLE))
    vi.stubGlobal('fetch', fetchMock)
    await loadMlbPlayerIndex(2026)
    await loadMlbPlayerIndex(2026)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resetMlbPlayerIndex()
    await loadMlbPlayerIndex(2026)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mlbPlayerIndexReady()).toBe(true)
  })

  it('reads again for a new season', async () => {
    const fetchMock = vi.fn(async () => ok(PEOPLE))
    vi.stubGlobal('fetch', fetchMock)
    await loadMlbPlayerIndex(2026)
    resetMlbPlayerIndex()
    await loadMlbPlayerIndex(2027)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // A failed read must not be kept as an empty answer, or the search would find nobody all day.
  it('keeps nothing from a failed read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })))
    await loadMlbPlayerIndex(2026)
    expect(mlbPlayerIndexReady()).toBe(false)
    expect(localStorage.length).toBe(0)
  })

  it('matches word starts in any order, accents ignored, best first', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(PEOPLE)))
    await loadMlbPlayerIndex(2026)
    const names = (q: string) => searchMlbPlayerIndex(q).map(p => p.fullName)
    expect(names('acuna')).toEqual(['Luisangel Acuña', 'Ronald Acuña Jr.'])
    expect(names('acuna ron')).toEqual(['Ronald Acuña Jr.'])
    expect(names('ske')).toEqual(['Paul Skenes', 'Old Skenesworth'])
    expect(names('kenes')).toEqual([])
    expect(names('witt')).toEqual(['Bobby Witt Jr.'])
  })
})

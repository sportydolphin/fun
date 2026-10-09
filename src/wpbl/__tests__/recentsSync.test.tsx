import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

// The two things that would quietly lose a reader's recents: a load echoing straight back up
// (harmless alone, but it is how a stale device overwrites a fresh one), and a failed read
// being taken for an empty list and "seeding" over what the other devices stored.

let stored: { wpbl_recent_searches: unknown } | null = null
let readError: { message: string } | null = null
let releaseRead: (() => void) | null = null
let holdRead = false
const upserts: unknown[][] = []

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            const result = () => ({ data: stored, error: readError })
            if (!holdRead) return Promise.resolve(result())
            return new Promise(res => { releaseRead = () => res(result()) })
          },
        }),
      }),
      upsert: (row: { wpbl_recent_searches: unknown[] }) => {
        upserts.push(row.wpbl_recent_searches)
        return Promise.resolve({ error: null })
      },
    }),
  },
}))
vi.mock('../../lib/userActive', () => ({ ensureActiveUser: async () => true }))

import { useWpblRecents, type WpblRecentItem } from '../recentSearches'

const kelsie: WpblRecentItem = { type: 'player', id: 'p-kw', name: 'Kelsie Whitmore' }
const diana: WpblRecentItem = { type: 'player', id: 'p-di', name: 'Diana Ibarra' }
const boston: WpblRecentItem = { type: 'team', id: 'BOS', name: 'Boston' }

const local = () => JSON.parse(localStorage.getItem('wpbl_recent_searches') ?? '[]')

beforeEach(() => {
  localStorage.clear()
  stored = null
  readError = null
  holdRead = false
  releaseRead = null
  upserts.length = 0
})
afterEach(() => { vi.useRealTimers() })

describe('useWpblRecents', () => {
  it('signed out, keeps the list on this device only', () => {
    const { result } = renderHook(() => useWpblRecents(null))
    act(() => result.current.record(kelsie))
    expect(result.current.items).toEqual([kelsie])
    expect(local()).toEqual([kelsie])
    expect(upserts).toEqual([])
  })

  it('on sign-in takes the stored list and does not write it back', async () => {
    localStorage.setItem('wpbl_recent_searches', JSON.stringify([boston]))
    stored = { wpbl_recent_searches: [kelsie, diana] }
    const { result } = renderHook(() => useWpblRecents('u1'))
    await waitFor(() => expect(result.current.items).toEqual([kelsie, diana]))
    expect(local()).toEqual([kelsie, diana])
    await new Promise(r => setTimeout(r, 900))
    expect(upserts).toEqual([])
  })

  it('seeds an empty stored list from this device', async () => {
    localStorage.setItem('wpbl_recent_searches', JSON.stringify([boston]))
    stored = { wpbl_recent_searches: [] }
    renderHook(() => useWpblRecents('u1'))
    await waitFor(() => expect(upserts).toEqual([[boston]]))
  })

  it('a failed read keeps the local list and pushes nothing', async () => {
    localStorage.setItem('wpbl_recent_searches', JSON.stringify([boston]))
    readError = { message: 'network' }
    const { result } = renderHook(() => useWpblRecents('u1'))
    await new Promise(r => setTimeout(r, 20))
    expect(result.current.items).toEqual([boston])
    expect(upserts).toEqual([])
  })

  it('a pick while signed in is saved once, after the debounce', async () => {
    stored = { wpbl_recent_searches: [] }
    const { result } = renderHook(() => useWpblRecents('u1'))
    await new Promise(r => setTimeout(r, 20))
    vi.useFakeTimers()
    act(() => { result.current.record(kelsie); result.current.record(diana) })
    expect(upserts).toEqual([])
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    expect(upserts).toEqual([[diana, kelsie]])
  })

  it('a pick made while the read is in flight survives it', async () => {
    holdRead = true
    stored = { wpbl_recent_searches: [diana, boston] }
    const { result } = renderHook(() => useWpblRecents('u1'))
    act(() => result.current.record(kelsie))
    await act(async () => { releaseRead?.() })
    await waitFor(() => expect(result.current.items).toEqual([kelsie, diana, boston]))
  })

  it('an unmount flushes a pending save', async () => {
    stored = { wpbl_recent_searches: [] }
    const { result, unmount } = renderHook(() => useWpblRecents('u1'))
    await new Promise(r => setTimeout(r, 20))
    act(() => result.current.record(kelsie))
    unmount()
    await waitFor(() => expect(upserts).toEqual([[kelsie]]))
  })
})

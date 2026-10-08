import { renderHook, act } from '@testing-library/react'
import { useNewSince, FLOOR } from '../newSince'

const items = (...ats: string[]) => ats.map((at, i) => ({ id: `v${i}`, at }))

beforeEach(() => localStorage.clear())

describe('useNewSince', () => {
  it('marks nothing on a first visit, and sets the baseline', () => {
    const { result } = renderHook(() => useNewSince('watch', items('2026-10-09T00:00:00Z'), true))
    expect(result.current.isNew('v0', '2026-10-09T00:00:00Z')).toBe(false)
    expect(localStorage.getItem('sdNewSince:watch')).toBe('2026-10-09T00:00:00Z')
  })

  it('marks what was published after the last visit, and keeps the marks for this visit', () => {
    localStorage.setItem('sdNewSince:reading', '2026-10-09T00:00:00Z')
    const list = items('2026-10-11T00:00:00Z', '2026-10-09T00:00:00Z')
    const { result } = renderHook(() => useNewSince('reading', list, true))
    expect(result.current.isNew('v0', list[0].at)).toBe(true)
    expect(result.current.isNew('v1', list[1].at)).toBe(false)
    // The page moved the watermark, but the marks it drew stay until the next visit.
    expect(localStorage.getItem('sdNewSince:reading')).toBe('2026-10-11T00:00:00Z')
    expect(result.current.isNew('v0', list[0].at)).toBe(true)
  })

  it('only the page advances the watermark', () => {
    localStorage.setItem('sdNewSince:watch', '2026-10-09T00:00:00Z')
    renderHook(() => useNewSince('watch', items('2026-10-13T00:00:00Z')))
    expect(localStorage.getItem('sdNewSince:watch')).toBe('2026-10-09T00:00:00Z')
  })

  it('opening an item clears its mark, on every surface', () => {
    localStorage.setItem('sdNewSince:watch', '2026-10-09T00:00:00Z')
    const list = items('2026-10-13T00:00:00Z')
    const home = renderHook(() => useNewSince('watch', list))
    act(() => home.result.current.markOpened('v0'))
    expect(home.result.current.isNew('v0', list[0].at)).toBe(false)
    const page = renderHook(() => useNewSince('watch', list, true))
    expect(page.result.current.isNew('v0', list[0].at)).toBe(false)
  })

  it('never marks anything published before the feature shipped', () => {
    // A watermark from long before the floor, as a stale or hand-set value would be.
    localStorage.setItem('sdNewSince:reading', '2026-09-01T00:00:00Z')
    const before = new Date(FLOOR - 60_000).toISOString()
    const after = new Date(FLOOR + 60_000).toISOString()
    const { result } = renderHook(() => useNewSince('reading', [{ id: 'a', at: before }, { id: 'b', at: after }]))
    expect(result.current.isNew('a', before)).toBe(false)
    expect(result.current.isNew('b', after)).toBe(true)
  })

  it('compares instants, not strings', () => {
    localStorage.setItem('sdNewSince:watch', '2026-10-09T00:00:00.500Z')
    const { result } = renderHook(() => useNewSince('watch', null))
    expect(result.current.isNew('x', '2026-10-09T00:00:01+00:00')).toBe(true)
    expect(result.current.isNew('y', '2026-10-09T00:00:00+00:00')).toBe(false)
  })
})

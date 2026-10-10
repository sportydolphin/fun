// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readSeed, writeSeed, __setSeedEnabled } from '../seed'

const isList = (d: unknown): d is number[] => Array.isArray(d)
const KEY = 'sd:wpbl-seed:v1:games'

beforeEach(() => { localStorage.clear(); __setSeedEnabled(true); vi.useFakeTimers() })
afterEach(() => { __setSeedEnabled(false); vi.useRealTimers() })

describe('the last-visit seed', () => {
  it('writes a moment later, once, with the latest data', () => {
    writeSeed('games', [1])
    writeSeed('games', [1, 2])
    expect(localStorage.getItem(KEY)).toBeNull()
    vi.advanceTimersByTime(2_000)
    expect(readSeed('games', isList)).toEqual([1, 2])
  })

  // A live poll must not be a half-megabyte storage write on every tick.
  it('writes at most once a minute', () => {
    writeSeed('games', [1])
    vi.advanceTimersByTime(2_000)
    writeSeed('games', [2])
    vi.advanceTimersByTime(30_000)
    expect(readSeed('games', isList)).toEqual([1])
    vi.advanceTimersByTime(30_000)
    expect(readSeed('games', isList)).toEqual([2])
  })

  it('ignores a copy that is too old, the wrong shape, or unreadable', () => {
    localStorage.setItem(KEY, JSON.stringify({ at: Date.now() - 31 * 86_400_000, data: [1] }))
    expect(readSeed('games', isList)).toBeNull()
    localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), data: { not: 'a list' } }))
    expect(readSeed('games', isList)).toBeNull()
    localStorage.setItem(KEY, '{nope')
    expect(readSeed('games', isList)).toBeNull()
  })

  // Off under Vitest by default, so one test's data never becomes another's starting state.
  it('does nothing when disabled', () => {
    __setSeedEnabled(false)
    writeSeed('games', [1])
    vi.advanceTimersByTime(120_000)
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { shouldShowBadge, markBadgeSeen } from '../lib/seen'

// The badge is gated on a date as well as a click, and the date half is the part nobody will
// notice breaking: if the expiry stops being honoured, a dot advertising an August release is
// still sitting in the nav at Christmas, and the only symptom is that it never goes away for
// anyone who ignores it. These pin both halves.

const KEY = 'teams-v145'
const BEFORE_EXPIRY = new Date('2026-08-20T12:00:00Z')
const AFTER_EXPIRY = new Date('2026-09-15T12:00:00Z')

describe('shouldShowBadge', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.useRealTimers() })

  it('shows for a reader who has not seen it, before the expiry', () => {
    vi.setSystemTime(BEFORE_EXPIRY)
    expect(shouldShowBadge(KEY)).toBe(true)
  })

  it('stops once marked seen', () => {
    vi.setSystemTime(BEFORE_EXPIRY)
    markBadgeSeen(KEY)
    expect(shouldShowBadge(KEY)).toBe(false)
  })

  it('stops after the expiry even for a reader who never saw it', () => {
    vi.setSystemTime(AFTER_EXPIRY)
    expect(shouldShowBadge(KEY)).toBe(false)
  })

  it('marking is idempotent', () => {
    vi.setSystemTime(BEFORE_EXPIRY)
    markBadgeSeen(KEY)
    markBadgeSeen(KEY)
    expect(shouldShowBadge(KEY)).toBe(false)
  })

  // Private mode and blocked storage. Showing a badge that can never be dismissed, on every
  // single visit, is worse than showing nothing.
  it('shows nothing when localStorage throws', () => {
    vi.setSystemTime(BEFORE_EXPIRY)
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(shouldShowBadge(KEY)).toBe(false)
    spy.mockRestore()
  })

  it('marking never throws when storage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => markBadgeSeen(KEY)).not.toThrow()
    spy.mockRestore()
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { hasDot, dotNote, visit, readReached, type Feature } from '../lib/seen'

// A dot is derived from the registry at every level on the way to a feature, and gated on a date
// as well as a visit. The date half is the part nobody will notice breaking: if the expiry stops
// being honoured, a dot advertising an August release is still in the nav at Christmas. The depth
// half is what lets one entry light both a nav pill and a chip and put them out separately.
// A registry of its own, so these test the mechanism and outlive whatever is registered today.

const UNTIL = new Date('2026-10-31T23:59:59Z')
const REG: Record<string, Feature> = {
  find: { place: 'wpbl/stats/find', label: 'Find', until: UNTIL },
  bests: { place: 'wpbl/stats/bests', label: 'Bests', until: UNTIL },
}
const BEFORE = Date.parse('2026-10-14T12:00:00Z')
const AFTER = Date.parse('2026-11-01T12:00:00Z')
const fresh = () => readReached(REG)

describe('feature dots', () => {
  beforeEach(() => { localStorage.clear() })

  it('lights the feature and every place on the way to it, and nothing beside it', () => {
    const r = fresh()
    expect(hasDot('wpbl/stats', r, BEFORE, REG)).toBe(true)
    expect(hasDot('wpbl/stats/find', r, BEFORE, REG)).toBe(true)
    expect(hasDot('wpbl/home', r, BEFORE, REG)).toBe(false)
    expect(hasDot('wpbl/stats/hitting', r, BEFORE, REG)).toBe(false)
  })

  it('reaching the tab puts out the pill and leaves the chips pointing', () => {
    const r = visit('wpbl/stats', fresh(), REG)
    expect(hasDot('wpbl/stats', r, BEFORE, REG)).toBe(false)
    expect(hasDot('wpbl/stats/find', r, BEFORE, REG)).toBe(true)
    expect(hasDot('wpbl/stats/bests', r, BEFORE, REG)).toBe(true)
  })

  it('a deep link onto one board puts out its chip only, and the pill stays for the other', () => {
    const r = visit('wpbl/stats/find', fresh(), REG)
    expect(hasDot('wpbl/stats/find', r, BEFORE, REG)).toBe(false)
    expect(hasDot('wpbl/stats/bests', r, BEFORE, REG)).toBe(true)
    expect(hasDot('wpbl/stats', r, BEFORE, REG)).toBe(true)
  })

  it('persists across a reload, and never goes back up', () => {
    visit('wpbl/stats/find', fresh(), REG)
    const r = visit('wpbl/stats', fresh(), REG)
    expect(hasDot('wpbl/stats/find', r, BEFORE, REG)).toBe(false)
  })

  it('returns the same object when nothing moved', () => {
    const r = visit('wpbl/stats', fresh(), REG)
    expect(visit('wpbl/stats', r, REG)).toBe(r)
    expect(visit('wpbl/home', r, REG)).toBe(r)
  })

  it('stops after the expiry even for a reader who never looked', () => {
    expect(hasDot('wpbl/stats', fresh(), AFTER, REG)).toBe(false)
  })

  it('reads the old seen flag as all the way there', () => {
    localStorage.setItem('sdSeen:find', '1')
    expect(hasDot('wpbl/stats/find', fresh(), BEFORE, REG)).toBe(false)
  })

  // The tooltip says what the dot points at, and only what is still unreached under that place.
  it('names what a dot points at, and drops what the reader has reached', () => {
    expect(dotNote('wpbl/stats', fresh(), BEFORE, REG)).toBe('New: Find; Bests')
    const r = visit('wpbl/stats/find', fresh(), REG)
    expect(dotNote('wpbl/stats', r, BEFORE, REG)).toBe('New: Bests')
    expect(dotNote('wpbl/stats', fresh(), AFTER, REG)).toBeUndefined()
  })

  // Private mode and blocked storage. A dot that can never be dismissed, on every single visit,
  // is worse than none.
  it('shows nothing when localStorage throws, and visiting never throws', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const r = fresh()
    expect(hasDot('wpbl/stats', r, BEFORE, REG)).toBe(false)
    expect(() => visit('wpbl/stats/find', { find: 0 }, REG)).not.toThrow()
    get.mockRestore(); set.mockRestore()
  })
})

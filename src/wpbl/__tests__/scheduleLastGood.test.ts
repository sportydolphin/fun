import { describe, it, expect, vi, afterEach } from 'vitest'
import { mergeSchedule } from '../api'
import type { WpblGame } from '../types'

// The schedule is the one read with no cache in front of it, because a poll must never be
// served a stale copy of the thing it is polling for. That leaves it as the one read where a
// dropped request reaches state as `[]`, and everything under /wpbl is derived from it, so
// `[]` is not a short answer, it is the section going blank.

const game = (id: string): WpblGame => ({
  id, game_date: '2026-09-04', home_team_id: 'NY', away_team_id: 'SF', status: 'scheduled',
} as WpblGame)

const GOOD = [game('a'), game('b')]

afterEach(() => { vi.restoreAllMocks() })

describe('mergeSchedule', () => {
  it('takes a real read', () => {
    const next = [game('c')]
    expect(mergeSchedule(next, GOOD)).toBe(next)
  })

  // The failure this exists for: safe() answers a timeout with its fallback, which for this
  // read is the same `[]` an uningested season returns.
  it('keeps the last good schedule when a read comes back empty', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(mergeSchedule([], GOOD)).toBe(GOOD)
  })

  it('says so, so a blank poll is findable in a console rather than only on screen', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mergeSchedule([], GOOD)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  // On a first load there is nothing to fall back on and `[]` is the honest answer; the views
  // have empty states for exactly that.
  it('passes an empty first read through', () => {
    expect(mergeSchedule([], null)).toEqual([])
    expect(mergeSchedule([], [])).toEqual([])
  })

  // A game finishing or a phantom copy being deleted shrinks the list, and neither is a
  // failure. Only an entirely empty read is.
  it('does not treat a shorter schedule as a failure', () => {
    const shorter = [game('a')]
    expect(mergeSchedule(shorter, GOOD)).toBe(shorter)
  })
})

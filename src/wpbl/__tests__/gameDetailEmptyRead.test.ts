import { describe, it, expect } from 'vitest'
import { isEmptyReadOf } from '../GameDetail'

// The Live Game Center closed between plays because it reloaded the plays mirror on every
// realtime change, and the ingest DELETES then reinserts every play each pass: a reload landing
// in that gap read zero plays, the Live tab's `plays.length >= 2` gate flipped false, and the
// whole view was swapped out until the next reload. reload now keeps what it holds over such an
// empty read. This pins the rule that decides it.

describe('isEmptyReadOf', () => {
  it('treats an empty read of something we hold as the mid-reinsert gap', () => {
    expect(isEmptyReadOf(0, 40)).toBe(true)
  })

  it('takes a genuine empty when we hold nothing yet', () => {
    // The start of a game, before any play has landed: empty is the truth, not a gap.
    expect(isEmptyReadOf(0, 0)).toBe(false)
  })

  it('always takes a non-empty read', () => {
    // A real update, including a correction that changed the play count, is never second-guessed.
    expect(isEmptyReadOf(41, 40)).toBe(false)
    expect(isEmptyReadOf(2, 0)).toBe(false)
    expect(isEmptyReadOf(1, 40)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { ENTRY_HASH, requestPlay, takeOpeningPlayHash } from '../entryUrl'

// A Find row for one inning opens Game Center on that inning's first play. In the app no fragment
// survives the address rewrite, so the play is handed over in memory, and it must reach only the
// game it was asked for, and only as it opens: a remount a moment later still lands on the play,
// a later open of the same game does not.

describe('requestPlay', () => {
  it('opens the asked game on the play, through a remount, and not on a later open', () => {
    requestPlay('g1', 42)
    expect(takeOpeningPlayHash('g1', 1000)).toBe('#play-42')
    expect(takeOpeningPlayHash('g1', 1500)).toBe('#play-42')
    expect(takeOpeningPlayHash('g1', 5000)).toBe(ENTRY_HASH)
    expect(takeOpeningPlayHash('g1', 5100)).toBe(ENTRY_HASH)
  })

  it('never lands on another game', () => {
    requestPlay('g1', 42)
    expect(takeOpeningPlayHash('g2')).toBe(ENTRY_HASH)
    expect(takeOpeningPlayHash('g1')).toBe(ENTRY_HASH)
  })
})

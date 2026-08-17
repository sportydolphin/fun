import { describe, it, expect } from 'vitest'
import { applyPlayCorrections } from '../api'

// Corrections are matched on the feed's sequence number, never the play's uuid, because
// wpbl-ingest deletes and reinserts every play for a game on each pass and the uuid is
// regenerated each time. Getting that wrong would silently stop applying corrections a few
// minutes after they were written, which is the kind of failure nobody notices.

const play = (sequence: number, extra: Record<string, unknown> = {}) => ({
  sequence, batter_name: 'Feed Batter', runs_scored: 0, is_hit: false, ...extra,
} as { sequence: number } & Record<string, unknown>)

describe('applyPlayCorrections', () => {
  it('leaves plays untouched when there is nothing to correct', () => {
    const plays = [play(1), play(2)]
    expect(applyPlayCorrections(plays, [])).toBe(plays)
  })

  it('replaces only the corrected field on only the matching play', () => {
    const out = applyPlayCorrections(
      [play(1), play(2)],
      [{ sequence: 2, field: 'batter_name', new_value: 'Real Batter' }],
    )
    expect(out[0].batter_name).toBe('Feed Batter')
    expect(out[1].batter_name).toBe('Real Batter')
    expect(out[1].runs_scored).toBe(0)
  })

  it('applies several corrections to one play', () => {
    const [out] = applyPlayCorrections(
      [play(1)],
      [
        { sequence: 1, field: 'batter_name', new_value: 'Real Batter' },
        { sequence: 1, field: 'runs_scored', new_value: '2' },
      ],
    )
    expect(out.batter_name).toBe('Real Batter')
    expect(out.runs_scored).toBe(2)
  })

  // Everything is stored as text because one table serves fields of several types.
  it('casts numbers and booleans back out of text', () => {
    const [out] = applyPlayCorrections(
      [play(1)],
      [
        { sequence: 1, field: 'runs_scored', new_value: '3' },
        { sequence: 1, field: 'is_hit', new_value: 'true' },
      ],
    )
    expect(out.runs_scored).toBe(3)
    expect(out.is_hit).toBe(true)
  })

  // Clearing a field the feed wrongly populated is a legitimate correction.
  it('treats a null new_value as clearing the field', () => {
    const [out] = applyPlayCorrections(
      [play(1, { narrative: 'wrong' })],
      [{ sequence: 1, field: 'narrative', new_value: null }],
    )
    expect(out.narrative).toBeNull()
  })

  it('ignores a correction for a sequence that is not in this game', () => {
    const out = applyPlayCorrections([play(1)], [{ sequence: 99, field: 'batter_name', new_value: 'Nobody' }])
    expect(out[0].batter_name).toBe('Feed Batter')
  })

  it('does not mutate the plays it was given', () => {
    const plays = [play(1)]
    applyPlayCorrections(plays, [{ sequence: 1, field: 'batter_name', new_value: 'Real Batter' }])
    expect(plays[0].batter_name).toBe('Feed Batter')
  })
})

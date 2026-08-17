import { describe, it, expect } from 'vitest'
import { applyPlayCorrections } from '../api'

// Corrections are matched on (game_id, sequence), the feed's own identifier for a play, and
// never on the play's uuid: wpbl-ingest deletes and reinserts every play for a game on each
// pass and the uuid is regenerated each time. Getting that wrong would silently stop applying
// corrections a few minutes after they were written, which is the kind of failure nobody
// notices. game_id is half of the key because sequence restarts at 1 in every game.

const play = (sequence: number, extra: Record<string, unknown> = {}, gameId = 'g1') => ({
  game_id: gameId, sequence, batter_name: 'Feed Batter', runs_scored: 0, is_hit: false, ...extra,
} as { game_id: string; sequence: number } & Record<string, unknown>)

const fix = (sequence: number, field: string, new_value: string | null, gameId = 'g1') =>
  ({ game_id: gameId, sequence, field, new_value })

describe('applyPlayCorrections', () => {
  it('leaves plays untouched when there is nothing to correct', () => {
    const plays = [play(1), play(2)]
    expect(applyPlayCorrections(plays, [])).toBe(plays)
  })

  it('replaces only the corrected field on only the matching play', () => {
    const out = applyPlayCorrections(
      [play(1), play(2)],
      [fix(2, 'batter_name', 'Real Batter')],
    )
    expect(out[0].batter_name).toBe('Feed Batter')
    expect(out[1].batter_name).toBe('Real Batter')
    expect(out[1].runs_scored).toBe(0)
  })

  it('applies several corrections to one play', () => {
    const [out] = applyPlayCorrections(
      [play(1)],
      [fix(1, 'batter_name', 'Real Batter'), fix(1, 'runs_scored', '2')],
    )
    expect(out.batter_name).toBe('Real Batter')
    expect(out.runs_scored).toBe(2)
  })

  // Everything is stored as text because one table serves fields of several types.
  it('casts numbers and booleans back out of text', () => {
    const [out] = applyPlayCorrections(
      [play(1)],
      [fix(1, 'runs_scored', '3'), fix(1, 'is_hit', 'true')],
    )
    expect(out.runs_scored).toBe(3)
    expect(out.is_hit).toBe(true)
  })

  // Clearing a field the feed wrongly populated is a legitimate correction.
  it('treats a null new_value as clearing the field', () => {
    const [out] = applyPlayCorrections(
      [play(1, { narrative: 'wrong' })],
      [fix(1, 'narrative', null)],
    )
    expect(out.narrative).toBeNull()
  })

  it('ignores a correction for a sequence that is not in this game', () => {
    const out = applyPlayCorrections([play(1)], [fix(99, 'batter_name', 'Nobody')])
    expect(out[0].batter_name).toBe('Feed Batter')
  })

  // `sequence` restarts at 1 in every game, so a sequence-only match would rewrite the same
  // numbered play in every game of the season. The Hall of Firsts reads the whole season in
  // one array, which is exactly where that would bite.
  it('does not leak a correction from one game into the same sequence in another', () => {
    const out = applyPlayCorrections(
      [play(4, {}, 'g1'), play(4, {}, 'g2')],
      [fix(4, 'batter_name', 'Real Batter', 'g2')],
    )
    expect(out[0].batter_name).toBe('Feed Batter')
    expect(out[1].batter_name).toBe('Real Batter')
  })

  it('does not mutate the plays it was given', () => {
    const plays = [play(1)]
    applyPlayCorrections(plays, [fix(1, 'batter_name', 'Real Batter')])
    expect(plays[0].batter_name).toBe('Feed Batter')
  })
})

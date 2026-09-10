import { describe, it, expect } from 'vitest'
import { countsThrough, countValues, countKey, ALL_COUNTS, PITCH_EFFECT } from '../derive/countValue'
import type { PlayRunValue } from '../derive/runExpectancy'

// Walking a pitch sequence into the counts a batter actually stood in. Every sequence below is
// a real one from the 2026 season.

describe('walking a pitch sequence into counts', () => {
  it('starts at 0-0 even when nothing was thrown to it', () => {
    expect(countsThrough('').map(countKey)).toEqual(['0-0'])
    expect(countsThrough(null).map(countKey)).toEqual(['0-0'])
  })

  it('advances on balls and strikes', () => {
    expect(countsThrough('BKP').map(countKey)).toEqual(['0-0', '1-0', '1-1'])
    expect(countsThrough('KKP').map(countKey)).toEqual(['0-0', '0-1', '0-2'])
  })

  // THE WHOLE REASON THIS EXISTS. The stored balls/strikes columns are the final tally
  // INCLUDING the deciding pitch, so a walk is recorded 4-0 and a strikeout 1-3. The batter
  // never stood in either. 633 of the season's 2,222 plate appearances are stored that way.
  it('never produces a count that cannot exist', () => {
    expect(countsThrough('BBBB').map(countKey)).toEqual(['0-0', '1-0', '2-0', '3-0'])
    expect(countsThrough('KKS').map(countKey)).toEqual(['0-0', '0-1', '0-2'])
    for (const c of countsThrough('BBBBKKSSFFFF')) {
      expect(c.balls).toBeLessThanOrEqual(3)
      expect(c.strikes).toBeLessThanOrEqual(2)
    }
  })

  it('does not advance the count on a foul with two strikes', () => {
    expect(countsThrough('KKFFF').map(countKey)).toEqual(['0-0', '0-1', '0-2'])
    expect(countsThrough('FKP').map(countKey)).toEqual(['0-0', '0-1', '0-2'])
  })

  // A nine-pitch at-bat is not nine visits to 3-2 for the purpose of pricing 3-2.
  it('counts a revisited count once', () => {
    const seq = countsThrough('BBBKFFFFF').map(countKey)
    expect(seq.filter(k => k === '3-1')).toHaveLength(1)
    expect(new Set(seq).size).toBe(seq.length)
  })

  // P is the ball being put in play, whatever the feed's own label says, and H ends the plate
  // appearance too. Neither may move the count.
  it('treats a ball in play and a hit batter as terminal', () => {
    expect(PITCH_EFFECT.P).toBe('inplay')
    expect(countsThrough('BBP').map(countKey)).toEqual(['0-0', '1-0', '2-0'])
    expect(countsThrough('BH').map(countKey)).toEqual(['0-0', '1-0'])
  })

  it('skips a code it does not know rather than guessing', () => {
    expect(countsThrough('BZK').map(countKey)).toEqual(['0-0', '1-0', '1-1'])
  })
})

describe('the count table', () => {
  const pa = (seq: string, value: number, event: string): PlayRunValue => ({
    play: { pitch_sequence: seq, event_type: event } as PlayRunValue['play'],
    runs: 0, outs: 0, bases: 0, before: 0, after: 0,
    afterBases: null, afterOuts: null, fieldingTeamId: null, value,
  })

  // Ten walks on four straight balls and ten strikeouts on three straight strikes: 0-0 must
  // come out at the average of everything, 3-0 must be worth only the walks and 0-2 only the
  // strikeouts.
  const values = [
    ...Array.from({ length: 10 }, () => pa('BBBB', +0.30, 'walk')),
    ...Array.from({ length: 10 }, () => pa('KKS', -0.25, 'strikeout')),
  ]

  it('prices 0-0 as the average plate appearance', () => {
    const rows = countValues(values, 1)
    const zero = rows.find(r => r.key === '0-0')!
    expect(zero.n).toBe(20)
    expect(zero.per).toBeCloseTo(0.025, 5)
  })

  it('prices a hitter\'s count above a pitcher\'s count', () => {
    const rows = countValues(values, 1)
    expect(rows.find(r => r.key === '3-0')!.per).toBeCloseTo(0.30, 5)
    expect(rows.find(r => r.key === '0-2')!.per).toBeCloseTo(-0.25, 5)
    expect(rows.find(r => r.key === '3-0')!.per).toBeGreaterThan(rows.find(r => r.key === '0-2')!.per)
  })

  it('reports how those plate appearances ended', () => {
    const rows = countValues(values, 1)
    expect(rows.find(r => r.key === '3-0')!.walk).toBe(1)
    expect(rows.find(r => r.key === '0-2')!.strikeout).toBe(1)
    expect(rows.find(r => r.key === '0-0')!.walk).toBeCloseTo(0.5, 5)
  })

  // A stolen base is a play with a run value and no count of its own. Folding it in would
  // credit the batter's count with the runner's work.
  it('ignores plays that are not plate appearances', () => {
    const withSteal = [...values, pa('', +0.2, 'stolen_base')]
    withSteal[withSteal.length - 1].play.pitch_sequence = null
    expect(countValues(withSteal, 1).find(r => r.key === '0-0')!.n).toBe(20)
  })

  it('drops counts too rare to price', () => {
    expect(countValues(values, 1000)).toHaveLength(0)
    expect(countValues(values, 1).length).toBeGreaterThan(0)
  })

  it('offers twelve legal counts and no more', () => {
    expect(ALL_COUNTS).toHaveLength(12)
    expect(ALL_COUNTS.map(countKey)).toContain('3-2')
    expect(ALL_COUNTS.map(countKey)).not.toContain('4-0')
    expect(ALL_COUNTS.map(countKey)).not.toContain('0-3')
  })
})

import { describe, it, expect } from 'vitest'
import {
  paDecomposition, countValueAt, isSwing, kindValues, takeSwingSplit, fullCountSwing,
} from '../derive/pitchValue'
import { countKey, type Count, type CountValue } from '../derive/countValue'
import { runValueLeaders, type PlayRunValue } from '../derive/runExpectancy'
import type { WpblRunValuePlay } from '../types'

// A count table with made-up but ordered values: every ball helps the hitter, every strike
// hurts. Real numbers would make the assertions below read as measurements of the league
// rather than as arithmetic, which is what they are.
const table: CountValue[] = []
for (let b = 0; b <= 3; b++) {
  for (let s = 0; s <= 2; s++) {
    table.push({
      count: { balls: b, strikes: s }, key: `${b}-${s}`,
      n: 100, per: b * 0.1 - s * 0.1,
      walk: 0, strikeout: 0, hit: 0, ended: 0,
    })
  }
}
const at = countValueAt(table)
const value = (c: Count) => at(c)!

const play = (over: Partial<WpblRunValuePlay>): WpblRunValuePlay => ({
  game_id: 'g1', sequence: 1, inning: 1, half: 'top', team_id: 'BOS',
  batter_id: 'b1', batter_name: 'Batter', pitcher_id: 'p1', pitcher_name: 'Pitcher',
  outs: 0, first_base: '', second_base: '', third_base: '',
  event_type: 'single', runs_scored: 0, narrative: '', pitch_sequence: 'P',
  ...over,
} as WpblRunValuePlay)

const rv = (sequence: string, v: number, over: Partial<WpblRunValuePlay> = {}): PlayRunValue => ({
  play: play({ pitch_sequence: sequence, ...over }),
  runs: 0, outs: 0, bases: 0, before: 1, after: 1, afterBases: 0, afterOuts: 0,
  fieldingTeamId: 'NY', value: v,
})

describe('paDecomposition', () => {
  it('prices a non-terminal pitch as the count it moved to, minus the one it left', () => {
    const [ball] = paDecomposition('BP', 0.5, at)
    expect(ball.kind).toBe('ball')
    expect(ball.terminal).toBe(false)
    expect(ball.worth).toBeCloseTo(value({ balls: 1, strikes: 0 }) - value({ balls: 0, strikes: 0 }))
  })

  it('prices the last pitch as the whole outcome, minus the count it came in', () => {
    const parts = paDecomposition('BP', 0.5, at)
    const last = parts[parts.length - 1]
    expect(last.terminal).toBe(true)
    expect(last.worth).toBeCloseTo(0.5 - value({ balls: 1, strikes: 0 }))
  })

  // THE IDENTITY THE WHOLE MODULE RESTS ON, and the one that keeps the take/swing card adding
  // up to the run-value leaderboard printed beside it. Every path through the loop has to hold
  // it: a walk, a strikeout, a ball in play, fouls that do and do not advance the count, and a
  // sequence the feed never marked as finished.
  it.each([
    ['P', 'first-pitch contact'],
    ['BBBB', 'a walk'],
    ['KKK', 'a strikeout looking'],
    ['BSFFFP', 'fouls that do not advance'],
    ['FFP', 'fouls that do'],
    ['KBSP', 'a mixed at-bat'],
    ['H', 'a hit by pitch'],
    ['BSFB', 'a sequence with no terminal pitch'],
    ['BXP', 'an unrecognised letter'],
  ])('sums to the plate appearance minus 0-0: %s (%s)', seq => {
    const paValue = 0.42
    const parts = paDecomposition(seq, paValue, at)
    const sum = parts.reduce((a, p) => a + p.worth, 0)
    expect(sum + value({ balls: 0, strikes: 0 })).toBeCloseTo(paValue, 10)
  })

  it('treats a fourth ball and a third strike as outcomes, not counts', () => {
    const walk = paDecomposition('BBBB', 0.9, at)
    expect(walk).toHaveLength(4)
    expect(walk[3].terminal).toBe(true)
    const k = paDecomposition('KKK', -0.3, at)
    expect(k[2].terminal).toBe(true)
  })

  it('does not advance the count on an unrecognised letter', () => {
    const parts = paDecomposition('XBP', 0.1, at)
    // X is skipped entirely rather than priced, so the ball is still thrown in 0-0.
    expect(parts.map(p => p.kind)).toEqual(['ball', 'inplay'])
    expect(countKey(parts[0].from)).toBe('0-0')
  })

  it('gives back nothing when a count it passes through has no price', () => {
    const thin = table.filter(r => r.key !== '1-0')
    expect(paDecomposition('BP', 0.5, countValueAt(thin))).toEqual([])
  })
})

describe('isSwing', () => {
  it('counts a hit by pitch as a take, so the two columns still sum to the at-bat', () => {
    expect(isSwing('hbp')).toBe(false)
    expect(isSwing('ball')).toBe(false)
    expect(isSwing('called')).toBe(false)
    expect(isSwing('swinging')).toBe(true)
    expect(isSwing('foul')).toBe(true)
    expect(isSwing('inplay')).toBe(true)
  })
})

describe('takeSwingSplit', () => {
  const values = [rv('BP', 0.5), rv('KP', -0.2)]

  it('splits a season into the pitches taken and the pitches offered at', () => {
    const [row] = takeSwingSplit(values, table, [], 'hitting')
    expect(row.pitches).toBe(4)
    // The ball and the called strike are takes; both P are swings.
    expect(row.taking).toBeCloseTo(
      (value({ balls: 1, strikes: 0 }) - value({ balls: 0, strikes: 0 }))
      + (value({ balls: 0, strikes: 1 }) - value({ balls: 0, strikes: 0 })))
    expect(row.taking + row.swinging).toBeCloseTo(row.total)
  })

  // THE CARD'S WHOLE CLAIM, and the reason the 0-0 baseline rides on the first pitch: the two
  // columns are printed beside a run-value leaderboard, so they have to come to the same number
  // it does rather than to that number less a hundredth of a run per plate appearance.
  it('adds up to the run value on the leaderboard beside it, exactly', () => {
    const [row] = takeSwingSplit(values, table, [], 'hitting')
    const [leader] = runValueLeaders(values as PlayRunValue[], [], 'hitting')
    expect(row.taking + row.swinging).toBeCloseTo(leader.value, 10)
    expect(row.total).toBeCloseTo(leader.value, 10)
  })

  it('still adds up when a plate appearance ends on its first pitch', () => {
    const [row] = takeSwingSplit([rv('P', 0.8)], table, [], 'hitting')
    expect(row.total).toBeCloseTo(0.8, 10)
  })

  it('negates for a pitcher, so bigger is better on both sides', () => {
    const [hit] = takeSwingSplit(values, table, [], 'hitting')
    const [pit] = takeSwingSplit(values, table, [], 'pitching')
    expect(pit.taking).toBeCloseTo(-hit.taking)
    expect(pit.swinging).toBeCloseTo(-hit.swinging)
    expect(pit.name).toBe('Pitcher')
  })

  it('takes a hitter\'s club off the play and a pitcher\'s off the schedule', () => {
    const [hit] = takeSwingSplit(values, table, [], 'hitting')
    const [pit] = takeSwingSplit(values, table, [], 'pitching')
    expect(hit.teamId).toBe('BOS')
    expect(pit.teamId).toBe('NY')
  })

  it('ignores a play with no pitch sequence, which is somebody else\'s work', () => {
    const steal = rv('', 0.3, { pitch_sequence: null, event_type: 'stolen_base' })
    const rows = takeSwingSplit([...values, steal], table, [], 'hitting')
    expect(rows[0].pitches).toBe(4)
  })
})

describe('kindValues', () => {
  it('prices each kind of pitch, in the order a count is built', () => {
    const rows = kindValues([rv('BP', 0.5), rv('BKP', -0.1)], table)
    const ball = rows.find(r => r.kind === 'ball')!
    expect(ball.n).toBe(2)
    expect(ball.per).toBeCloseTo(ball.total / 2)
    expect(rows.map(r => r.kind)).toEqual(['ball', 'called', 'inplay'])
  })
})

describe('fullCountSwing', () => {
  it('is null until both sides of the comparison are measured', () => {
    expect(fullCountSwing([rv('BP', 0.5)], table, { balls: 0, strikes: 0 })).toBeNull()
  })

  it('is the gap between a ball and a strike thrown in that count', () => {
    const values = [
      ...Array.from({ length: 10 }, () => rv('BP', 0.5)),
      ...Array.from({ length: 10 }, () => rv('KP', -0.5)),
    ]
    const swing = fullCountSwing(values, table, { balls: 0, strikes: 0 })!
    expect(swing).toBeCloseTo(
      (value({ balls: 1, strikes: 0 }) - value({ balls: 0, strikes: 0 }))
      - (value({ balls: 0, strikes: 1 }) - value({ balls: 0, strikes: 0 })))
  })

  it('leaves fouls out of the strike side, since at two they do nothing', () => {
    const values = [
      ...Array.from({ length: 10 }, () => rv('BP', 0.5)),
      ...Array.from({ length: 10 }, () => rv('KP', -0.5)),
      ...Array.from({ length: 40 }, () => rv('FP', -0.5)),
    ]
    const withFouls = fullCountSwing(values, table, { balls: 0, strikes: 0 })!
    const without = fullCountSwing(values.slice(0, 20), table, { balls: 0, strikes: 0 })!
    expect(withFouls).toBeCloseTo(without)
  })
})

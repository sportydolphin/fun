import { describe, expect, it } from 'vitest'
import { legacyPlays, pitchLetters, resolveName, splitName, type LegacyPerson, type LegacyRow } from '../legacy'

// The 2016 prose reader against synthetic half-innings written the way the 2016 scorer writes:
// surnames in capitals, a given-name prefix where two share one, one clause per player.

const person = (id: number, first: string, last: string): LegacyPerson => ({ id, first_name: first, last_name: last })
const SIDE = [
  person(1, 'Ana', 'QUILL'),
  person(2, 'Bea', 'ROSALES'),
  person(3, 'Cleo', 'VAN DER BERG'),
  person(4, 'Ya Ting', 'WEN'),
  person(5, 'Ya Zhu', 'WEN'),
  person(6, 'Dana Lee', 'MORA SALAS'),
  person(7, 'Eve', 'OKAFOR'),
  person(8, 'Pooja', '.'),
  person(9, '.', 'ARSHDEEP KAUR'),
]

let order = 0
const row = (narrative: string, outs = 0, batterid = 0): LegacyRow =>
  ({ playorder: ++order, batterid, pitcherid: 100, inning: 1, narrative, outs })
const half = (rows: LegacyRow[]) => legacyPlays([{ inning: 1, half: 'top', rows, batting: SIDE }])

describe('names', () => {
  it('splits the name from the play', () => {
    expect(splitName('QUILL walked')).toEqual({ name: 'QUILL', rest: 'walked' })
    expect(splitName('VAN DER BERG stole second')).toEqual({ name: 'VAN DER BERG', rest: 'stole second' })
    expect(splitName('WEN Ya T doubled to left center')).toEqual({ name: 'WEN Ya T', rest: 'doubled to left center' })
    expect(splitName('Dropped foul ball, E2')).toBeNull()
  })

  it('finds the one player a name can mean, and never guesses', () => {
    expect(resolveName('QUILL', SIDE)).toMatchObject({ id: 1 })
    // The first of two surnames, a given-name prefix per word, a name cut short, a one-name player.
    expect(resolveName('MORA', SIDE)).toMatchObject({ id: 6 })
    expect(resolveName('WEN Ya T', SIDE)).toMatchObject({ id: 4 })
    expect(resolveName('WEN Ya Z', SIDE)).toMatchObject({ id: 5 })
    expect(resolveName('ARSHDEEP KAU', SIDE)).toMatchObject({ id: 9 })
    expect(resolveName('POOJA', SIDE)).toMatchObject({ id: 8 })
    expect(resolveName('WEN', SIDE)).toBe('ambiguous')
    expect(resolveName('NOBODY', SIDE)).toBeNull()
  })
})

describe('pitches', () => {
  it('spells the count in our alphabet, K being a called strike', () => {
    expect(pitchLetters('QUILL walked (3-1 BKBBB).')).toBe('BCBBB')
    expect(pitchLetters('QUILL singled (0-0).')).toBe('')
    expect(pitchLetters('QUILL singled.')).toBeNull()
    expect(() => pitchLetters('QUILL singled (0-1 Q).')).toThrow(/pitch letter/)
  })
})

describe('a half-inning', () => {
  it('carries the runners by name, and scores what the prose scores', () => {
    const r = half([
      row('QUILL walked (3-0 BBBB).', 0, 1),
      row('ROSALES singled to left field (0-1 K); QUILL advanced to second.', 0, 2),
      row('QUILL stole third.', 0, 3),
      row('VAN DER BERG doubled, 2 RBI (1-1 SB); QUILL scored; ROSALES scored.', 0, 3),
      row('WEN Ya T grounded into double play ss to 2b to 1b (0-0); VAN DER BERG out on the play.', 0, 4),
      row('WEN Ya Z flied out to cf (0-1 S).', 2, 5),
    ])
    expect(r.problems).toEqual([])
    expect(r.plays.map(p => p.event)).toEqual(['walk', 'single', 'stolen_base', 'double', 'groundout', 'flyout'])
    const dbl = r.plays[3]
    expect(dbl.bases).toEqual([2, null, 1]) // before the play: ROSALES on first, QUILL on third
    expect(dbl.runs).toBe(2)
    expect(dbl.pitch_sequence).toBe('SBX')
    expect(r.plays[0].pitch_sequence).toBe('BBBB')
    expect(r.counts.get(3)).toMatchObject({ pa: 1, h: 1, double: 1 })
    expect(r.lob.top).toBe(0)
  })

  it('reads a sacrifice, a pickoff of a runner and the runners left on base', () => {
    const r = half([
      row('QUILL singled up the middle (0-0).', 0, 1),
      row('ROSALES grounded out to p, SAC (0-0); QUILL advanced to second.', 0, 2),
      row('QUILL out at second p to ss, picked off.', 1, 3),
      row('VAN DER BERG walked (3-0 BBBB).', 2, 3),
      row('OKAFOR struck out looking (0-2 KKK).', 2, 7),
    ])
    expect(r.problems).toEqual([])
    expect(r.plays.map(p => p.event)).toEqual(['single', 'sacrifice', 'pickoff', 'walk', 'strikeout'])
    expect(r.lob.top).toBe(1)
  })

  it('places the tie-break runners and reads a pinch runner who names nobody', () => {
    const r = half([
      row('QUILL placed on second.'),
      row('ROSALES placed on first.'),
      row('OKAFOR pinch ran for QUILL.'),
      row('VAN DER BERG singled to right field (0-0); OKAFOR scored; ROSALES advanced to third.', 0, 3),
    ])
    expect(r.problems).toEqual([])
    expect(r.plays).toHaveLength(1)
    expect(r.plays[0].bases).toEqual([2, 7, null])
  })

  it('fails on a phrase it does not know, on outs that disagree, and on a runner who is not on', () => {
    expect(half([row('QUILL juggled the ball (0-0).', 0, 1)]).problems.join()).toMatch(/unknown phrase "juggled the ball"/)
    expect(half([row('QUILL walked (0-0).', 1, 1)]).problems.join()).toMatch(/the row says 1 out, the plays before it make 0/)
    expect(half([row('QUILL stole second.')]).problems.join()).toMatch(/QUILL moves but is not on base/)
  })

  it('carries a player the box score lacks as a stand-in, and says so', () => {
    const r = half([row('ZETA walked (3-0 BBBB).'), row('QUILL singled (0-0); ZETA advanced to second.', 0, 1)])
    expect(r.problems).toEqual(['ZETA is in the plays and not in the box score'])
    expect(r.plays[1].bases[0]).toBeLessThan(0)
  })
})

import { describe, it, expect } from 'vitest'
import { displayPosition, primaryPosition, buildPositionIndex, MIN_FIELDED_GAMES } from '../positions'

// The roster files a position once and the season then disagrees with it. This decides when the
// season wins. It has two ways to be wrong: leave a player labelled at a position she has not
// played all year, or relabel someone off a handful of games and lose what she is actually for.

/** n games at one position. */
const at = (position: string, n: number) => Array.from({ length: n }, () => ({ position }))

describe('primaryPosition', () => {
  it('needs a real majority, not a plurality', () => {
    // 3 of 7 is the largest share and still not most of them.
    const lines = [...at('ss', 3), ...at('2b', 2), ...at('3b', 2)]
    expect(primaryPosition(lines)).toBeNull()
  })

  it('refuses a tie outright', () => {
    // Samantha Gutierrez: third twice, caught twice. Neither answer is right, and a sort-order
    // winner would be a coin flip baked into the roster.
    expect(primaryPosition([...at('3b', 2), ...at('c', 2)])).toBeNull()
  })

  it('rejects exactly half', () => {
    expect(primaryPosition([...at('2b', 3), ...at('ss', 2), ...at('3b', 1)])).toBeNull()
  })

  it('accepts one more than half', () => {
    expect(primaryPosition([...at('2b', 4), ...at('ss', 3)])).toEqual({ position: '2b', games: 4, fielded: 7 })
  })

  it('will not rule on fewer than the minimum fielded games', () => {
    const lines = at('1b', MIN_FIELDED_GAMES - 1)
    expect(primaryPosition(lines)).toBeNull()
    expect(primaryPosition(at('1b', MIN_FIELDED_GAMES))).not.toBeNull()
  })

  // Kylee Lahners: listed at third, DH'd four times, played first twice. Two games is not a
  // position change, and the DH games must not pad her out to the minimum.
  it('counts batting roles neither for a position nor toward the total', () => {
    const lines = [...at('dh', 4), ...at('1b', 2)]
    expect(primaryPosition(lines)).toBeNull()
  })

  it('measures the share against fielded games only', () => {
    // Four at first out of four fielded, despite six appearances.
    expect(primaryPosition([...at('1b', 4), ...at('dh', 1), ...at('ph', 1)]))
      .toEqual({ position: '1b', games: 4, fielded: 4 })
  })

  it('takes the position a player started at when she moved mid-game', () => {
    // "lf/p" started in left and pitched later; "p/cf" started on the mound.
    const lines = [...at('lf/p', 3), ...at('p/cf', 1)]
    expect(primaryPosition(lines)).toEqual({ position: 'lf', games: 3, fielded: 4 })
  })

  it('gives each game exactly one vote however much a player moved', () => {
    // Splitting the vote would let someone who moves a lot out-vote a regular.
    const lines = [...at('lf/p', 2), ...at('lf/1b', 1), ...at('p', 1)]
    expect(primaryPosition(lines)).toEqual({ position: 'lf', games: 3, fielded: 4 })
  })

  it('ignores a position the feed does not recognise', () => {
    expect(primaryPosition([...at('1b', 4), ...at('xx', 5)]))
      .toEqual({ position: '1b', games: 4, fielded: 4 })
  })
})

describe('displayPosition', () => {
  it('replaces the roster label when the season clearly disagrees', () => {
    // Alyssa Zettlemoyer, listed at catcher, third base in all six she has fielded.
    expect(displayPosition('C', at('3b', 6))).toEqual({ label: '3B', overridden: true, official: 'C' })
  })

  it('leaves the roster label alone when it already agrees', () => {
    expect(displayPosition('SS', at('ss', 7))).toEqual({ label: 'SS', overridden: false, official: 'SS' })
  })

  // The roster writes handedness on pitchers; a box score only ever writes "p". Reading those
  // as different would relabel every pitcher in the league from RHP to P.
  it('reads RHP and LHP as agreeing with a season spent pitching', () => {
    expect(displayPosition('RHP', at('p', 5)).overridden).toBe(false)
    expect(displayPosition('LHP', at('p', 4)).overridden).toBe(false)
  })

  it('still relabels a pitcher who mostly plays the field', () => {
    // Maïka Dumais: filed RHP, four of six fielded games at first.
    expect(displayPosition('RHP', [...at('1b', 4), ...at('p', 2)]))
      .toEqual({ label: '1B', overridden: true, official: 'RHP' })
  })

  // Turning "OF" into "LF" is the most useful thing here: a bucket rules nothing out.
  it('sharpens a bucket label into the position actually played', () => {
    expect(displayPosition('OF', at('lf', 7))).toEqual({ label: 'LF', overridden: true, official: 'OF' })
    expect(displayPosition('IF', at('2b', 5))).toEqual({ label: '2B', overridden: true, official: 'IF' })
  })

  it('checks every part of a multi-label roster entry', () => {
    // "RHP, UTL" agrees with a season on the mound.
    expect(displayPosition('RHP, UTL', at('p', 5)).overridden).toBe(false)
    expect(displayPosition('RHP, UTL', at('lf', 5)).overridden).toBe(true)
  })

  it('falls back to the roster when the season has not said enough', () => {
    expect(displayPosition('C', at('3b', 2))).toEqual({ label: 'C', overridden: false, official: 'C' })
  })

  it('survives a player with no roster position and no games', () => {
    expect(displayPosition(null, [])).toEqual({ label: null, overridden: false, official: null })
  })

  it('names a position for a player the roster left blank', () => {
    expect(displayPosition(null, at('ss', 5))).toEqual({ label: 'SS', overridden: true, official: null })
  })
})

describe('buildPositionIndex', () => {
  it('rules on each player separately and omits the undecided', () => {
    const index = buildPositionIndex([
      ...at('3b', 6).map(l => ({ ...l, player_id: 'zettlemoyer' })),
      ...at('c', 2).map(l => ({ ...l, player_id: 'gutierrez' })),
      ...at('3b', 2).map(l => ({ ...l, player_id: 'gutierrez' })),
      ...at('1b', 2).map(l => ({ ...l, player_id: 'lahners' })),
    ])
    expect(index.get('zettlemoyer')).toEqual({ position: '3b', games: 6, fielded: 6 })
    expect(index.has('gutierrez')).toBe(false) // tied
    expect(index.has('lahners')).toBe(false)   // too few
  })
})

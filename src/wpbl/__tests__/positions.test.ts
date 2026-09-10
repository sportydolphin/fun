import { describe, it, expect } from 'vitest'
import { displayPosition, primaryPosition, positionsPlayed, buildPositionIndex, leadsWithPitching, MIN_FIELDED_GAMES } from '../positions'
import type { WpblSeasonGame } from '../season'

// The roster files a position once and the season then disagrees with it. This decides when the
// season wins. It has two ways to be wrong: leave a player labelled at a position she has not
// played all year, or relabel someone off a handful of games and lose what she is actually for.

/** n games at one position. Each line names its own game, because the three season-scoped
 *  functions here take a schedule and read `game_id` off the line to apply it. */
let gameSeq = 0
const at = (position: string, n: number) =>
  Array.from({ length: n }, () => ({ position, game_id: `g${gameSeq++}` }))

/** An empty schedule excludes nothing, which is the fail-open behaviour season.ts guarantees
 *  and the right baseline for every test below that is not about the postseason. */
const ALL: WpblSeasonGame[] = []

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
    expect(displayPosition('C', at('3b', 6), ALL)).toEqual({ label: '3B', overridden: true, official: 'C' })
  })

  it('leaves the roster label alone when it already agrees', () => {
    expect(displayPosition('SS', at('ss', 7), ALL)).toEqual({ label: 'SS', overridden: false, official: 'SS' })
  })

  // The roster writes handedness on pitchers; a box score only ever writes "p". Reading those
  // as different would relabel every pitcher in the league from RHP to P.
  it('reads RHP and LHP as agreeing with a season spent pitching', () => {
    expect(displayPosition('RHP', at('p', 5), ALL).overridden).toBe(false)
    expect(displayPosition('LHP', at('p', 4), ALL).overridden).toBe(false)
  })

  it('still relabels a pitcher who mostly plays the field', () => {
    // Maïka Dumais: filed RHP, four of six fielded games at first.
    expect(displayPosition('RHP', [...at('1b', 4), ...at('p', 2)], ALL))
      .toEqual({ label: '1B', overridden: true, official: 'RHP' })
  })

  // Turning "OF" into "LF" is the most useful thing here: a bucket rules nothing out.
  it('sharpens a bucket label into the position actually played', () => {
    expect(displayPosition('OF', at('lf', 7), ALL)).toEqual({ label: 'LF', overridden: true, official: 'OF' })
    expect(displayPosition('IF', at('2b', 5), ALL)).toEqual({ label: '2B', overridden: true, official: 'IF' })
  })

  it('checks every part of a multi-label roster entry', () => {
    // "RHP, UTL" agrees with a season on the mound.
    expect(displayPosition('RHP, UTL', at('p', 5), ALL).overridden).toBe(false)
    expect(displayPosition('RHP, UTL', at('lf', 5), ALL).overridden).toBe(true)
  })

  it('falls back to the roster when the season has not said enough', () => {
    expect(displayPosition('C', at('3b', 2), ALL)).toEqual({ label: 'C', overridden: false, official: 'C' })
  })

  it('survives a player with no roster position and no games', () => {
    expect(displayPosition(null, [], ALL)).toEqual({ label: null, overridden: false, official: null })
  })

  it('names a position for a player the roster left blank', () => {
    expect(displayPosition(null, at('ss', 5), ALL)).toEqual({ label: 'SS', overridden: true, official: null })
  })
})

describe('buildPositionIndex', () => {
  it('rules on each player separately and omits the undecided', () => {
    const index = buildPositionIndex([
      ...at('3b', 6).map(l => ({ ...l, player_id: 'zettlemoyer' })),
      ...at('c', 2).map(l => ({ ...l, player_id: 'gutierrez' })),
      ...at('3b', 2).map(l => ({ ...l, player_id: 'gutierrez' })),
      ...at('1b', 2).map(l => ({ ...l, player_id: 'lahners' })),
    ], ALL)
    expect(index.get('zettlemoyer')).toEqual({ position: '3b', games: 6, fielded: 6 })
    expect(index.has('gutierrez')).toBe(false) // tied
    expect(index.has('lahners')).toBe(false)   // too few
  })
})

// `positionsPlayed` answers a different question from everything above, and the difference is
// the whole reason it is a separate function: `primaryPosition` asks "what position IS she",
// which has to count one game once, and this asks "where did these fielding numbers come
// from", which has to count every place she stood.
describe('positionsPlayed', () => {
  it('counts BOTH halves of a game she moved in, unlike the vote', () => {
    const lines = at('p/cf', 1)
    // The vote takes the first token only, so a utility player cannot out-vote a regular.
    expect(primaryPosition(Array.from({ length: 4 }, () => ({ position: 'p/cf' })))?.position).toBe('p')
    // The scope note takes both, because she really did field at both and both are in the sum.
    expect(positionsPlayed(lines, ALL)).toEqual(['cf', 'p'])
  })

  // Kelsie Whitmore's real season, which is what found the bug: her pitching pane presented
  // 21 putouts as a pitcher's fielding line, and they are catches in centre field.
  it('puts the most-played position first', () => {
    const lines = [...at('cf', 6), ...at('p/cf', 4)]
    expect(positionsPlayed(lines, ALL)).toEqual(['cf', 'p'])
  })

  // A tie must not reorder itself between two renders of the same card.
  it('breaks a tie the same way every time', () => {
    const one = positionsPlayed([...at('ss', 3), ...at('1b', 3)], ALL)
    expect(one).toEqual(['1b', 'ss'])
    expect(positionsPlayed([...at('1b', 3), ...at('ss', 3)], ALL)).toEqual(one)
  })

  // DH, PH and PR are batting roles rather than places on the field, and a fielding line that
  // named them would be claiming she fielded in a game she did not take the field in.
  it('ignores the batting-only roles', () => {
    expect(positionsPlayed([...at('dh', 5), ...at('ph', 2), ...at('cf', 1)], ALL)).toEqual(['cf'])
    expect(positionsPlayed([...at('dh', 5)], ALL)).toEqual([])
  })
})

// Which half of a two-way season a card leads with. Three surfaces call this (the player page,
// the shared-link unfurl, the Discord /player card), and what is being pinned is the pair of
// conditions that let the box score outvote the roster, because the whole point of them is to
// move two players out of nineteen and leave the other seventeen alone.
describe('leadsWithPitching', () => {
  /** A shortstop, unless told otherwise. */
  const who = (o: Partial<Parameters<typeof leadsWithPitching>[0]> = {}) => leadsWithPitching({
    position: 'SS', hasBatting: true, hasPitching: true, gs: 0, bf: 0, pa: 0, ...o,
  })

  it('leads with whichever half exists when only one does', () => {
    expect(who({ hasBatting: false })).toBe(true)
    expect(who({ hasPitching: false, gs: 3, bf: 90, pa: 0 })).toBe(false)
  })

  it('takes the filed position first, at any workload', () => {
    // "RHP, UTL" with a full set of at-bats and one relief inning still leads with pitching.
    expect(who({ position: 'RHP, UTL', bf: 4, pa: 60 })).toBe(true)
    expect(who({ position: 'LHP' })).toBe(true)
  })

  // Emi Saiki, filed SS: 2 starts, 54 batters faced, 17 plate appearances, and on Sep 4, 2026
  // the longest start anyone in the league had thrown.
  it('lets the box score outvote a position code that does not say pitcher', () => {
    expect(who({ gs: 2, bf: 54, pa: 17 })).toBe(true)
  })

  // Rosi del Castillo: 4.2 mop-up innings in a season of six plate appearances. The ratio is
  // higher than Saiki's and she is not a pitcher; the start is what separates them.
  it('does not promote relief work, however lopsided the ratio', () => {
    expect(who({ gs: 0, bf: 20, pa: 6 })).toBe(false)
  })

  // Jamie Mackay (a catcher, 68 BF against 47 PA) and Claire Eccles (a centre fielder, 45
  // against 43) both start the odd game. Near parity the lead role would flip on one
  // appearance and flip back the next week, which is worse than being steadily wrong.
  it('needs a clear margin, not a majority', () => {
    expect(who({ gs: 1, bf: 68, pa: 47 })).toBe(false)
    expect(who({ gs: 2, bf: 45, pa: 43 })).toBe(false)
    expect(who({ gs: 3, bf: 72, pa: 36 })).toBe(true)
  })

  // Older mirrored rows carry `bf` as null, which sums to zero. A feed that stops publishing
  // the column has to degrade to the roster's answer rather than to "she has never pitched".
  it('falls back to the filed position when the feed has no batters faced', () => {
    expect(who({ gs: 3, bf: 0, pa: 20 })).toBe(false)
    expect(who({ position: 'RHP', gs: 3, bf: 0, pa: 20 })).toBe(true)
  })
})

// The whole reason these three take a schedule. Kelsie Whitmore's real September: a season
// spent mostly in centre field, then one start on the mound in game 1 of the semifinal.
// Counting that game does not add a position, it destroys the majority she had, and the label
// falls back to the roster listing this module exists to override.
describe('the postseason, which none of this is about', () => {
  const PLAYOFF: WpblSeasonGame[] = [{ id: 'post1', game_type: 'postSeason', counts_in_standings: true }]
  // Three in centre, two on the mound: a majority in centre, and a narrow one, which is what
  // every two-way player's is.
  const season = [...at('cf', 3), ...at('p', 2)]
  const playoffStart = [{ position: 'p', game_id: 'post1' }]

  it('keeps a two-way player at the position she played all season', () => {
    expect(displayPosition('RHP', [...season, ...playoffStart], PLAYOFF))
      .toEqual({ label: 'CF', overridden: true, official: 'RHP' })
    // And this is the bug it replaces: counting the playoff start makes it three of six, which
    // is exactly half and so no majority at all, so the roster label wins by default.
    expect(displayPosition('RHP', [...season, ...playoffStart], []).overridden).toBe(false)
  })

  it('leaves the playoff game out of the index and the scope note too', () => {
    const index = buildPositionIndex(
      [...season, ...playoffStart].map(l => ({ ...l, player_id: 'whitmore' })), PLAYOFF)
    expect(index.get('whitmore')).toEqual({ position: 'cf', games: 3, fielded: 5 })
    expect(positionsPlayed([...at('cf', 5), ...playoffStart], PLAYOFF)).toEqual(['cf'])
  })

  // Same fail-open rule as everything else that takes a schedule: a game we cannot place is
  // counted, so a caller holding a partial schedule over-counts rather than rendering nothing.
  it('counts a game the schedule does not mention', () => {
    expect(positionsPlayed([...at('cf', 5), ...playoffStart], [])).toEqual(['cf', 'p'])
  })
})

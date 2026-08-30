import { describe, it, expect } from 'vitest'
import { mvpRace, fmtMvpRuns } from '../derive/mvpRace'
import { runValueLeaders, type PlayRunValue } from '../derive/runExpectancy'
import type { WpblGame, WpblPlayer, WpblRunValuePlay } from '../types'

// The MVP race, pinned on the three things about it that fail quietly.
//
// It sums two numbers that already exist elsewhere, so the failure mode is never a crash: it
// is a total that disagrees with the Run value board by a little, a two-way player counted
// twice or not at all, or a lead change the chart draws in the wrong place. All three look
// like a working card.

let seq = 0
const play = (over: Partial<WpblRunValuePlay> = {}): WpblRunValuePlay => ({
  game_id: 'g1', sequence: seq++, inning: 1, half: 'top', team_id: 'SF',
  batter_id: 'bat-1', batter_name: 'A Batter', pitcher_id: 'pit-1', pitcher_name: 'A Pitcher',
  outs: 0, first_base: '', second_base: '', third_base: '',
  event_type: 'single', runs_scored: 0, narrative: '', pitch_sequence: 'BK',
  ...over,
})

/** A priced play. `mvpRace` reads only `play`, `value` and `fieldingTeamId`, so the rest of
 *  the run-value shape is filled in to satisfy the type and never inspected. */
const priced = (value: number, over: Partial<WpblRunValuePlay> = {}, fieldingTeamId = 'BOS'): PlayRunValue => ({
  play: play(over), runs: 0, outs: 0, bases: 0, before: 0, after: 0,
  afterBases: 0, afterOuts: 0, fieldingTeamId, value,
})

const player = (id: string, name: string, team_id: string | null = 'SF'): WpblPlayer => ({
  id, api_ids: [], name, team_id, position: null,
} as unknown as WpblPlayer)

const game = (id: string, game_date: string): Pick<WpblGame, 'id' | 'game_date'> => ({ id, game_date })

const GAMES = [game('g1', '2026-08-01'), game('g2', '2026-08-02'), game('g3', '2026-08-03')]

describe('the two sides of the ball', () => {
  it('adds runs created at the plate to runs saved on the mound, for one player', () => {
    // She batted for +2 and, in the same season, pitched a play that cost the offence 1.5,
    // which is +1.5 to her. One row, +3.5.
    const values = [
      priced(2, { batter_id: 'p1', batter_name: 'Two Way', pitcher_id: 'other', pitcher_name: 'Someone Else' }),
      priced(-1.5, { batter_id: 'other-bat', batter_name: 'Other Bat', pitcher_id: 'p1', pitcher_name: 'Two Way' }),
    ]
    const race = mvpRace(values, [player('p1', 'Two Way')], GAMES)
    const her = race.field.find(c => c.key === 'p1')!
    expect(her.bat).toBeCloseTo(2)
    expect(her.arm).toBeCloseTo(1.5)
    expect(her.total).toBeCloseTo(3.5)
    expect(her.pa).toBe(1)
    expect(her.bf).toBe(1)
  })

  // THE SIGN IS THE WHOLE THING. A play that adds half a run to the offence took half a run
  // off the pitcher who allowed it. Summed without the negation, the board opens with the
  // worst arms in the league and looks entirely plausible while doing it.
  it('negates the pitching side, so a pitcher who gives up runs is not rewarded for it', () => {
    const values = [priced(3, { pitcher_id: 'p9', pitcher_name: 'Shelled' })]
    const race = mvpRace(values, [player('p9', 'Shelled')], GAMES)
    expect(race.field.find(c => c.key === 'p9')!.arm).toBeCloseTo(-3)
  })

  it('agrees exactly with runValueLeaders, which is the board it has to match', () => {
    const values = [
      priced(1.2, { batter_id: 'a', batter_name: 'Ay', pitcher_id: 'x', pitcher_name: 'Ex' }),
      priced(-0.4, { batter_id: 'b', batter_name: 'Bee', pitcher_id: 'a', pitcher_name: 'Ay' }),
      priced(0.9, { batter_id: 'a', batter_name: 'Ay', pitcher_id: 'x', pitcher_name: 'Ex' }),
    ]
    const players = [player('a', 'Ay'), player('b', 'Bee'), player('x', 'Ex')]
    const race = mvpRace(values, players, GAMES)
    const hit = new Map(runValueLeaders(values, players, 'hitting').map(r => [r.player!.id, r.value]))
    const pit = new Map(runValueLeaders(values, players, 'pitching').map(r => [r.player!.id, r.value]))
    for (const c of race.field) {
      expect(c.total).toBeCloseTo((hit.get(c.key) ?? 0) + (pit.get(c.key) ?? 0), 10)
    }
  })

  // A steal, a substitution or a runner advancing carries no pitch sequence and belongs to no
  // plate appearance. Counted, it would charge the batter standing at the plate for a runner's
  // decision and credit the pitcher for it.
  it('ignores plays with no pitch sequence', () => {
    const values = [priced(5, { pitch_sequence: '' }), priced(5, { pitch_sequence: null as unknown as string })]
    expect(mvpRace(values, [player('bat-1', 'A Batter')], GAMES).field).toHaveLength(0)
  })
})

describe('the curve', () => {
  it('accumulates by date and stays flat on a day she did not play', () => {
    const values = [
      priced(1, { game_id: 'g1', batter_id: 'p1', batter_name: 'One', pitcher_id: null, pitcher_name: null }),
      priced(2, { game_id: 'g3', batter_id: 'p1', batter_name: 'One', pitcher_id: null, pitcher_name: null }),
    ]
    const race = mvpRace(values, [player('p1', 'One')], GAMES)
    // g2 produced no plays at all, so it is not on the axis: the axis is the dates the priced
    // plays came from, never the whole schedule.
    expect(race.dates).toEqual(['2026-08-01', '2026-08-03'])
    expect(race.field[0].curve).toEqual([1, 3])
  })

  it('ends every curve on the player total, which is what the chart and the rows both claim', () => {
    const values = [
      priced(1.5, { game_id: 'g1', batter_id: 'p1', batter_name: 'One', pitcher_id: null, pitcher_name: null }),
      priced(-0.5, { game_id: 'g2', batter_id: 'p1', batter_name: 'One', pitcher_id: null, pitcher_name: null }),
      priced(3, { game_id: 'g2', batter_id: 'p2', batter_name: 'Two', pitcher_id: null, pitcher_name: null }),
    ]
    const race = mvpRace(values, [player('p1', 'One'), player('p2', 'Two')], GAMES)
    for (const c of race.field) {
      expect(c.curve).toHaveLength(race.dates.length)
      expect(c.curve[c.curve.length - 1]).toBeCloseTo(c.total)
    }
  })
})

describe('the lead', () => {
  const bat = (gid: string, id: string, name: string, v: number) =>
    priced(v, { game_id: gid, batter_id: id, batter_name: name, pitcher_id: null, pitcher_name: null })

  it('counts a change of hands and reports where it happened', () => {
    // A leads after g1, B goes ahead on g2 and stays there.
    const values = [
      bat('g1', 'a', 'Ay', 5), bat('g1', 'b', 'Bee', 1),
      bat('g2', 'b', 'Bee', 9),
    ]
    const race = mvpRace(values, [player('a', 'Ay'), player('b', 'Bee')], GAMES)
    expect(race.top.map(c => c.name)).toEqual(['Bee', 'Ay'])
    expect(race.lead).toBeCloseTo(5)
    expect(race.leadChanges).toBe(1)
    expect(race.dates[race.lastLeadChange!]).toBe('2026-08-02')
  })

  // A day the two curves happen to meet is not the lead changing hands twice. Left unguarded,
  // a level Tuesday puts a change-of-lead marker on the chart for a day nothing happened.
  it('does not count a level day as a change', () => {
    const values = [
      bat('g1', 'a', 'Ay', 4), bat('g1', 'b', 'Bee', 1),
      bat('g2', 'b', 'Bee', 3),                            // level at 4
      bat('g3', 'a', 'Ay', 2),                             // Ay still ahead
    ]
    const race = mvpRace(values, [player('a', 'Ay'), player('b', 'Bee')], GAMES)
    expect(race.leadChanges).toBe(0)
    expect(race.lastLeadChange).toBeNull()
  })

  it('reports no lead change in a season where nobody was ever passed', () => {
    const values = [bat('g1', 'a', 'Ay', 4), bat('g1', 'b', 'Bee', 1), bat('g2', 'a', 'Ay', 2)]
    const race = mvpRace(values, [player('a', 'Ay'), player('b', 'Bee')], GAMES)
    expect(race.leadChanges).toBe(0)
    expect(race.lastLeadChange).toBeNull()
    expect(race.lead).toBeCloseTo(5)
  })
})

describe('identity', () => {
  // The play log carries our own player uuid, not a feed id, so the league minting a second
  // id for a traded player is already resolved upstream. What still has to hold is that a
  // resolved player is ONE row across both sides of the ball.
  it('keys on the player id, so a two-way player is one candidate and not two', () => {
    const values = [
      priced(3, { batter_id: 'p1', batter_name: 'Two Way', pitcher_id: 'z', pitcher_name: 'Zed' }),
      priced(-2, { batter_id: 'z2', batter_name: 'Other', pitcher_id: 'p1', pitcher_name: 'Two Way' }),
    ]
    const race = mvpRace(values, [player('p1', 'Two Way')], GAMES)
    expect(race.field.filter(c => c.name === 'Two Way')).toHaveLength(1)
  })

  it('still ranks a player the roster cannot resolve, rather than dropping her from the race', () => {
    const values = [priced(4, { batter_id: null, batter_name: 'Unrostered', pitcher_id: null, pitcher_name: null })]
    const race = mvpRace(values, [], GAMES)
    expect(race.field).toHaveLength(1)
    expect(race.field[0].player).toBeNull()
    expect(race.field[0].key).toBe('name:unrostered')
  })

  // The badge beside her name is the shirt she is wearing now, which is the roster row. The
  // play only knows the club she was with that day, and is the fallback for someone the
  // roster has no row for at all.
  it('takes the club from the roster, not from the play', () => {
    const values = [priced(1, { batter_id: 'p1', batter_name: 'Traded', team_id: 'NY', pitcher_id: null, pitcher_name: null })]
    const race = mvpRace(values, [player('p1', 'Traded', 'LA')], GAMES)
    expect(race.field[0].teamId).toBe('LA')
  })

  it('falls back to the play club when there is no roster row', () => {
    const values = [priced(1, { batter_id: null, batter_name: 'Nobody', team_id: 'NY', pitcher_id: null, pitcher_name: null })]
    expect(mvpRace(values, [], GAMES).field[0].teamId).toBe('NY')
  })
})

describe('the two-way flag', () => {
  const both = (pa: number, bf: number): PlayRunValue[] => [
    ...Array.from({ length: pa }, () => priced(0.1, { batter_id: 'p1', batter_name: 'Both', pitcher_id: 'x', pitcher_name: 'Ex' })),
    ...Array.from({ length: bf }, () => priced(-0.1, { batter_id: 'y', batter_name: 'Why', pitcher_id: 'p1', pitcher_name: 'Both' })),
  ]

  it('is set only when both sides carry real work', () => {
    expect(mvpRace(both(25, 25), [player('p1', 'Both')], GAMES).field.find(c => c.key === 'p1')!.twoWay).toBe(true)
  })

  // A position player who threw one mop-up inning is not a two-way player, and a pitcher's own
  // trips to the plate are not a second case for her.
  it('is not set by a token appearance on one side', () => {
    expect(mvpRace(both(25, 3), [player('p1', 'Both')], GAMES).field.find(c => c.key === 'p1')!.twoWay).toBe(false)
    expect(mvpRace(both(3, 25), [player('p1', 'Both')], GAMES).field.find(c => c.key === 'p1')!.twoWay).toBe(false)
  })
})

describe('formatting', () => {
  it('signs a run figure the way the Run value board does', () => {
    expect(fmtMvpRuns(18.46)).toBe('+18.5')
    expect(fmtMvpRuns(-3.2)).toBe('-3.2')
    expect(fmtMvpRuns(0)).toBe('0.0')
  })

  // "-0.0" reads as a measurement of nothing. Same guard as fmtRunValue.
  it('never prints a negative zero', () => {
    expect(fmtMvpRuns(-0.01)).toBe('0.0')
  })
})

describe('an empty league', () => {
  it('returns an empty race rather than throwing, before a pitch is thrown', () => {
    const race = mvpRace([], [], [])
    expect(race.top).toHaveLength(0)
    expect(race.dates).toHaveLength(0)
    expect(race.lead).toBe(0)
    expect(race.lastLeadChange).toBeNull()
  })
})

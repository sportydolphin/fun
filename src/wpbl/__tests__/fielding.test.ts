import { describe, it, expect } from 'vitest'
import {
  defenseIndex, errorFielders, fieldingLedger, reachedOnError, readDoublePlay, type FielderAt,
} from '../derive/fielding'
import type { PlayRunValue, ReTable } from '../derive/runExpectancy'
import type { WpblRunValuePlay } from '../types'

// Fielding runs: errors priced against the play made cleanly and double plays against the single
// out. The traps pinned here are all about WHO: a play names a position, never a player, so a
// substitute who entered at a position must not be read as its starter, a starter who moved must
// leave the position behind, and a play that merely ends "to 1b" is a throw rather than a change.

describe('reading a play', () => {
  it('names every fielder an error is charged to, in words or in the scorer\'s shorthand', () => {
    expect(errorFielders('Suzu Narasaki singled to shortstop, advanced to second on a throwing error by ss (0-2 KS).')).toEqual(['ss'])
    expect(errorFielders('Ashton Lansdell reached first on a dropped fly by cf, advanced to second on the error (0-1 K).')).toEqual(['cf'])
    expect(errorFielders('X advanced to second on an error by 1b; Y scored on a throwing error by c.')).toEqual(['1b', 'c'])
    expect(errorFielders('Madison Willan Dropped foul ball, E2 (0-0).')).toEqual(['c'])
    // "on the error" points back at one already named, and names nobody new.
    expect(errorFielders('Kate Blunt advanced to second on the error.')).toEqual([])
  })

  it('tells a batter who reached on the misplay from a runner who advanced on one', () => {
    expect(reachedOnError('Molly Paddison reached first on an error by 2b (1-2 KBS).')).toBe(true)
    expect(reachedOnError('Andreanne Leblanc reached first on a dropped fly by lf (2-1 KBB).')).toBe(true)
    expect(reachedOnError('London Studer reached on a fielder\'s choice (2-0 BB); Denae Benites advanced to second on an error by 2b.')).toBe(false)
  })

  it('reads the throw chain and whether the first out was a force', () => {
    expect(readDoublePlay('Michelle Roche grounded into double play 2b to ss to 1b (0-0); Sarah Edwards out on the play.'))
      .toEqual({ chain: ['2b', 'ss', '1b'], ground: true })
    expect(readDoublePlay('Claire O\'Sullivan lined into double play 3b to 1b (3-1 BBBK); London Studer out on the play.'))
      .toEqual({ chain: ['3b', '1b'], ground: false })
    expect(readDoublePlay('Kelsie Whitmore lined into double play 2b (1-0 B); Ela Day-Bédard out on the play.'))
      .toEqual({ chain: ['2b'], ground: false })
    expect(readDoublePlay('Val Perez singled to left field (0-0).')).toBe(null)
  })
})

describe('defenseIndex', () => {
  const players = [
    { id: 'a', name: 'Ann Short' }, { id: 'b', name: 'Bea Third' }, { id: 'c', name: 'Cat Sub' },
    { id: 'd', name: 'Dee Pinch' }, { id: 'e', name: 'Eve Catcher' },
  ]
  const lines = [
    { game_id: 'g', team_id: 'SF', player_id: 'a', position: 'ss/3b' },   // started at short, moved
    { game_id: 'g', team_id: 'SF', player_id: 'b', position: '3b/dh' },   // started at third, to DH
    { game_id: 'g', team_id: 'SF', player_id: 'c', position: 'ss' },      // entered at short
    { game_id: 'g', team_id: 'SF', player_id: 'd', position: 'ph/lf' },   // pinch hit, then left
    { game_id: 'g', team_id: 'SF', player_id: 'e', position: 'c' },
  ]
  const plays = [
    { game_id: 'g', sequence: 5, narrative: 'Bea Third grounded out ss to 1b (0-0).' },
    { game_id: 'g', sequence: 10, narrative: 'Bea Third to dh.' },
    { game_id: 'g', sequence: 11, narrative: 'Ann Short to 3b.' },
    { game_id: 'g', sequence: 12, narrative: 'Cat Sub to ss for Someone Else.' },
    { game_id: 'g', sequence: 20, narrative: 'Dee Pinch pinch hit for Someone Else.' },
    { game_id: 'g', sequence: 25, narrative: 'Dee Pinch to lf.' },
  ]
  const at: FielderAt = defenseIndex(lines, plays, players)

  it('starts each position with its starter, not the substitute who later played there', () => {
    expect(at('g', 'SF', 'ss', 5)).toBe('a')
    expect(at('g', 'SF', '3b', 5)).toBe('b')
    expect(at('g', 'SF', 'c', 5)).toBe('e')
    // Nobody started in left: the pinch hitter's line begins with "ph".
    expect(at('g', 'SF', 'lf', 5)).toBe(null)
  })

  it('follows each change from the play after its row', () => {
    expect(at('g', 'SF', '3b', 12)).toBe('a')
    expect(at('g', 'SF', 'ss', 12)).toBe(null)   // vacated at 11, refilled by the row at 12
    expect(at('g', 'SF', 'ss', 13)).toBe('c')
    expect(at('g', 'SF', 'lf', 26)).toBe('d')
  })

  it('answers only for the club whose sheet the name is on', () => {
    expect(at('g', 'BOS', 'ss', 13)).toBe(null)
  })
})

describe('fieldingLedger', () => {
  // A table where every state is worth its outs-to-go, simple enough to price by hand:
  // 0 out 0.5, 1 out 0.3, 2 out 0.1, plus 0.2 a runner.
  const runners = (b: number) => ((b & 1) + ((b >> 1) & 1) + ((b >> 2) & 1))
  const table = {
    cells: [0.5, 0.3, 0.1].map(base => Array.from({ length: 8 }, (_, b) => ({ re: base + 0.2 * runners(b), n: 10 }))),
  } as unknown as ReTable
  const re = (o: number, b: number) => (o >= 3 ? 0 : table.cells[o][b].re!)

  let seq = 0
  const value = (narrative: string, o: number, b: number, ao: number | null, ab: number | null, event = 'unknown', pitches: string | null = null): PlayRunValue => {
    const before = re(o, b), after = ao == null ? 0 : re(ao, ab!)
    return {
      play: { game_id: 'g', sequence: ++seq, narrative, event_type: event, pitcher_id: 'P', pitch_sequence: pitches } as WpblRunValuePlay,
      runs: 0, outs: o, bases: b as 0, before, after, afterBases: ab as 0 | null, afterOuts: ao,
      fieldingTeamId: 'SF', value: after - before,
    }
  }
  const fielders: Record<string, string> = { c: 'C', ss: 'SS', '2b': '2B', '1b': '1B', lf: 'LF', cf: 'CF' }
  const at: FielderAt = (_g, _t, pos) => fielders[pos] ?? null
  const cellOf = (cells: ReturnType<typeof fieldingLedger>['cells'], id: string, pos: string) =>
    cells.find(c => c.playerId === id && c.pos === pos)!

  it('credits every out to the nine standing there', () => {
    const { cells } = fieldingLedger([value('Ann grounded out ss to 1b (0-0).', 0, 0, 1, 0, 'groundout', 'P')], table, at)
    for (const [id, pos] of [['SS', 'ss'], ['C', 'c'], ['P', 'p'], ['LF', 'lf']]) expect(cellOf(cells, id, pos).outs).toBe(1)
    expect(cellOf(cells, 'C', 'c').pitches).toBe(1)
  })

  it('prices a reach on an error against the out the play should have been', () => {
    const { cells } = fieldingLedger([value('Ann reached first on an error by ss (0-0).', 0, 0, 0, 1)], table, at)
    expect(cellOf(cells, 'SS', 'ss').errRuns).toBeCloseTo(-(re(0, 1) - re(1, 0)))
  })

  it('charges the pitcher off the play itself', () => {
    const { cells } = fieldingLedger([value('Ann reached first on a throwing error by p (0-0).', 0, 0, 0, 1)], table, at)
    expect(cellOf(cells, 'P', 'p').errors).toBe(1)
  })

  it('prices a ground-ball double play against the force alone, shared along the chain', () => {
    // Runner on first, nobody out: two out and the bases empty, against one out and the batter on first.
    const { cells } = fieldingLedger([value('Bea grounded into double play ss to 2b to 1b (0-0); Cat out on the play.', 0, 1, 2, 0, 'out')], table, at)
    const each = (re(1, 1) - re(2, 0)) / 3
    for (const [id, pos] of [['SS', 'ss'], ['2B', '2b'], ['1B', '1b']]) {
      expect(cellOf(cells, id, pos).dpRuns).toBeCloseTo(each)
      expect(cellOf(cells, id, pos).dps).toBe(1)
    }
  })

  it('never pays a fielder for an error the play made no worse', () => {
    const v = value('Kim struck out; Lee out at second, throwing error by ss.', 0, 1, 2, 0, 'strikeout')
    const clean = value('Kim struck out.', 0, 1, 1, 1, 'strikeout')
    const { cells } = fieldingLedger([v, clean], table, at)
    expect(cellOf(cells, 'SS', 'ss').errors).toBe(1)
    expect(cellOf(cells, 'SS', 'ss').errRuns).toBeCloseTo(0)
  })

  it('measures range against the zone, and shares a gap between two outfielders', () => {
    // Left field: two caught, two fell in, so the league rate there is a half.
    const plays = [
      value('A flied out to lf (0-0).', 0, 0, 1, 0, 'flyout', 'P'),
      value('B flied out to lf (0-0).', 0, 0, 1, 0, 'flyout', 'P'),
      value('C singled to left field (0-0).', 0, 0, 0, 1, 'single', 'P'),
      value('D singled to left field (0-0).', 0, 0, 0, 1, 'single', 'P'),
      // A gap: half of it is centre field's.
      value('E doubled to left center (0-0).', 0, 0, 0, 2, 'double', 'P'),
      value('F flied out to left center (0-0).', 0, 0, 1, 0, 'flyout', 'P'),
    ]
    const { cells } = fieldingLedger(plays, table, at)
    // Every left-field ball was LF's, so against their own rate they are exactly average.
    expect(cellOf(cells, 'LF', 'lf').playsAbove).toBeCloseTo(0)
    expect(cellOf(cells, 'LF', 'lf').bip).toBeCloseTo(5)
    expect(cellOf(cells, 'CF', 'cf').bip).toBeCloseTo(1)
  })

  it('charges a wild pitch to the catcher behind the plate', () => {
    const { cells } = fieldingLedger([value('Ann advanced to second on a wild pitch.', 0, 1, 0, 2, 'wild_pitch')], table, at)
    expect(cellOf(cells, 'C', 'c')).toMatchObject({ wpPb: 1 })
    expect(cellOf(cells, 'C', 'c').wpPbRuns).toBeCloseTo(re(0, 2) - re(0, 1))
  })
})

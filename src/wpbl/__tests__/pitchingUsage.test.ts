import { describe, it, expect } from 'vitest'
import { buildUsageGrid, outsToIpShort } from '../derive/pitchingUsage'
import type { WpblPitchingUsageRow } from '../types'

const row = (o: Partial<WpblPitchingUsageRow> & {
  game_id: string; player_id: string; game_date: string
}): WpblPitchingUsageRow => ({
  team_id: 'SF', game_status: 'final', opponent_team_id: 'LA',
  started: false, outs: 3, pitches: 20, bf: 4, er: 0, so: 1, bb: 0,
  decision: null, days_rest: null, ...o,
})

describe('outsToIpShort', () => {
  it('uses the baseball convention, not decimals', () => {
    expect(outsToIpShort(0)).toBe('0.0')
    expect(outsToIpShort(4)).toBe('1.1')   // one and one-third, not 1.3
    expect(outsToIpShort(12)).toBe('4.0')
  })
})

describe('buildUsageGrid', () => {
  const rows = [
    row({ game_id: 'g3', player_id: 'starter', game_date: '2026-08-15', started: true, pitches: 71, outs: 12 }),
    row({ game_id: 'g3', player_id: 'pen-a', game_date: '2026-08-15', pitches: 62, outs: 9 }),
    row({ game_id: 'g2', player_id: 'other-starter', game_date: '2026-08-14', started: true, pitches: 63, outs: 12 }),
    row({ game_id: 'g2', player_id: 'pen-b', game_date: '2026-08-14', pitches: 13, outs: 3 }),
    row({ game_id: 'g1', player_id: 'pen-a', game_date: '2026-08-12', pitches: 20, outs: 3 }),
  ]

  it('orders games newest first and honours the window', () => {
    expect(buildUsageGrid(rows, 6).games.map(g => g.id)).toEqual(['g3', 'g2', 'g1'])
    expect(buildUsageGrid(rows, 2).games.map(g => g.id)).toEqual(['g3', 'g2'])
  })

  it('puts pitchers who started above pitchers who only relieved', () => {
    const order = buildUsageGrid(rows, 6).pitchers
    expect(order.indexOf('starter')).toBeLessThan(order.indexOf('pen-a'))
    expect(order.indexOf('other-starter')).toBeLessThan(order.indexOf('pen-a'))
  })

  it('orders starters by most recent start, so the rotation reads in turn order', () => {
    const order = buildUsageGrid(rows, 6).pitchers
    expect(order.indexOf('starter')).toBeLessThan(order.indexOf('other-starter'))
  })

  it('orders relievers by workload, heaviest first', () => {
    const order = buildUsageGrid(rows, 6).pitchers
    // pen-a threw 82 across the window, pen-b threw 13.
    expect(order.indexOf('pen-a')).toBeLessThan(order.indexOf('pen-b'))
  })

  it('totals only the pitches inside the window', () => {
    expect(buildUsageGrid(rows, 6).windowPitches.get('pen-a')).toBe(82)
    // Narrow the window past g1 and her earlier outing stops counting.
    expect(buildUsageGrid(rows, 2).windowPitches.get('pen-a')).toBe(62)
  })

  it('keeps a null pitch count null rather than calling it zero', () => {
    const g = buildUsageGrid([row({ game_id: 'g1', player_id: 'x', game_date: '2026-08-12', pitches: null })], 6)
    expect(g.cells.get('x')!.get('g1')!.pitches).toBeNull()
  })

  it('carries days_rest through so back-to-backs can be flagged', () => {
    const g = buildUsageGrid([
      row({ game_id: 'g1', player_id: 'x', game_date: '2026-08-12', days_rest: 1 }),
    ], 6)
    expect(g.cells.get('x')!.get('g1')!.daysRest).toBe(1)
  })

  it('adds work together if one pitcher somehow has two lines in a game', () => {
    const g = buildUsageGrid([
      row({ game_id: 'g1', player_id: 'x', game_date: '2026-08-12', outs: 3, pitches: 20 }),
      row({ game_id: 'g1', player_id: 'x', game_date: '2026-08-12', outs: 2, pitches: 15, started: true }),
    ], 6)
    const c = g.cells.get('x')!.get('g1')!
    expect(c.outs).toBe(5)
    expect(c.pitches).toBe(35)
    expect(c.started).toBe(true)
  })

  it('returns an empty grid rather than throwing when a team has no pitching', () => {
    const g = buildUsageGrid([], 6)
    expect(g.games).toEqual([])
    expect(g.pitchers).toEqual([])
  })
})

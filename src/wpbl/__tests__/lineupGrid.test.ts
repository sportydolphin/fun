import { describe, it, expect } from 'vitest'
import { buildLineupGrid, rankPlayer } from '../derive/lineupGrid'
import type { WpblLineupHistoryRow } from '../types'

const row = (o: Partial<WpblLineupHistoryRow> & {
  game_id: string; player_id: string; game_date: string; lineup_spot: number
}): WpblLineupHistoryRow => ({
  team_id: 'LA', game_status: 'final', opponent_team_id: 'SF',
  opp_starter_name: 'Kelsie Whitmore', opp_starter_throws: 'R', position: 'cf', started: true, slot_shared: false, ...o,
})

describe('rankPlayer', () => {
  it('sorts by the slot a player most often starts in', () => {
    expect(rankPlayer([
      { position: 'cf', spot: 2, started: true },
      { position: 'cf', spot: 2, started: true },
      { position: 'cf', spot: 7, started: true },
    ]).key).toBe(2)
  })

  it('uses the modal slot, not the mean, so it never invents a slot never occupied', () => {
    // 2nd against righties, 8th against lefties. The mean would be 5 — a slot she has
    // never hit in, and one that would sort her between two genuine #5 hitters.
    const r = rankPlayer([
      { position: 'lf', spot: 2, started: true },
      { position: 'lf', spot: 2, started: true },
      { position: 'lf', spot: 8, started: true },
      { position: 'lf', spot: 8, started: true },
    ])
    expect(r.key).toBe(2)   // tie broken toward the earlier slot
  })

  it('breaks a modal tie toward the earlier slot', () => {
    expect(rankPlayer([
      { position: '1b', spot: 6, started: true },
      { position: '1b', spot: 3, started: true },
    ]).key).toBe(3)
  })

  it('ignores substitute appearances when finding the usual slot', () => {
    const r = rankPlayer([
      { position: 'ph', spot: 1, started: false },
      { position: 'ph', spot: 1, started: false },
      { position: 'rf', spot: 9, started: true },
    ])
    expect(r.key).toBe(9)
    expect(r.starts).toBe(1)
  })

  it('sorts a bench-only player to the bottom rather than by her one appearance', () => {
    const bench = rankPlayer([{ position: 'ph', spot: 1, started: false }])
    const leadoff = rankPlayer([{ position: 'cf', spot: 1, started: true }])
    expect(bench.key).toBeGreaterThan(leadoff.key)
    expect(bench.starts).toBe(0)
  })
})

describe('buildLineupGrid', () => {
  const rows = [
    row({ game_id: 'g3', player_id: 'a', game_date: '2026-08-15', lineup_spot: 1 }),
    row({ game_id: 'g3', player_id: 'b', game_date: '2026-08-15', lineup_spot: 4 }),
    row({ game_id: 'g2', player_id: 'a', game_date: '2026-08-14', lineup_spot: 1 }),
    row({ game_id: 'g2', player_id: 'b', game_date: '2026-08-14', lineup_spot: 4 }),
    row({ game_id: 'g1', player_id: 'c', game_date: '2026-08-12', lineup_spot: 9 }),
  ]

  it('orders games newest first', () => {
    expect(buildLineupGrid(rows, 6).games.map(g => g.id)).toEqual(['g3', 'g2', 'g1'])
  })

  it('keeps only the most recent N games and drops cells outside them', () => {
    const g = buildLineupGrid(rows, 2)
    expect(g.games.map(x => x.id)).toEqual(['g3', 'g2'])
    // 'c' only played in g1, which fell outside the window, so she has no row at all.
    expect(g.players).not.toContain('c')
  })

  it('orders players by usual lineup slot', () => {
    expect(buildLineupGrid(rows, 6).players).toEqual(['a', 'b', 'c'])
  })

  it('prefers the start when a player holds two rows in one game', () => {
    // She began at short, then moved to left — two rows, same game.
    const moved = [
      row({ game_id: 'g1', player_id: 'x', game_date: '2026-08-12', lineup_spot: 5, position: 'lf', started: false }),
      row({ game_id: 'g1', player_id: 'x', game_date: '2026-08-12', lineup_spot: 2, position: 'ss', started: true }),
    ]
    const cell = buildLineupGrid(moved, 6).cells.get('x')!.get('g1')!
    expect(cell).toEqual({ position: 'ss', spot: 2, started: true })
  })

  it('carries the opposing starter name and hand onto the game column', () => {
    const g = buildLineupGrid([row({
      game_id: 'g1', player_id: 'a', game_date: '2026-08-12', lineup_spot: 1,
      opp_starter_name: 'Liz Gilder', opp_starter_throws: 'L',
    })], 6)
    expect(g.games[0].hand).toBe('L')
    expect(g.games[0].starter).toBe('Liz Gilder')
  })

  it('returns an empty grid rather than throwing when a team has no lineups', () => {
    expect(buildLineupGrid([], 6)).toEqual({ games: [], players: [], cells: new Map() })
  })
})

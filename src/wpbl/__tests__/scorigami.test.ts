import { describe, it, expect } from 'vitest'
import { wpblScorigami, scorigamiKey, scorigamiCountsAt } from '../derive/scorigami'
import type { WpblGame } from '../types'

// The scorigami grid, and the four ways it could be wrong while rendering perfectly:
//
//   - a game still being played counted as a final score;
//   - a tie or a missing score drawn on a diagonal the grid does not have;
//   - a postseason final dropped, when a score is a score wherever it happened;
//   - "first time it happened" pointing at a later occurrence, so the linked game is not the one
//     the cell claims.

const game = (o: Partial<WpblGame> = {}): WpblGame => ({
  id: Math.random().toString(36).slice(2), status: 'final', game_date: '2026-08-07',
  home_team_id: 'SF', away_team_id: 'LA', home_score: 5, away_score: 2,
  game_type: 'regular', counts_in_standings: true, ...o,
} as WpblGame)

describe('wpblScorigami', () => {
  it('keys a cell by (winner, loser) regardless of which club was home', () => {
    // Same 5-2 final, once with the home side winning and once the away side. One cell, two games.
    const grid = wpblScorigami([
      game({ id: 'g1', home_score: 5, away_score: 2 }),
      game({ id: 'g2', home_score: 2, away_score: 5 }),
    ])
    expect(grid.cells.size).toBe(1)
    const cell = grid.cells.get(scorigamiKey(5, 2))!
    expect(cell.win).toBe(5)
    expect(cell.lose).toBe(2)
    expect(cell.count).toBe(2)
  })

  it('counts only finals with two differing scores', () => {
    const grid = wpblScorigami([
      game({ id: 'live', status: 'live', home_score: 3, away_score: 1 }),
      game({ id: 'sched', status: 'scheduled', home_score: null, away_score: null }),
      game({ id: 'nulls', home_score: null, away_score: 4 }),
      game({ id: 'tie', home_score: 3, away_score: 3 }),
      game({ id: 'real', home_score: 7, away_score: 4 }),
    ])
    expect(grid.totalGames).toBe(1)
    expect(grid.cells.size).toBe(1)
    expect(grid.cells.has(scorigamiKey(7, 4))).toBe(true)
  })

  it('includes the postseason: a score is a score', () => {
    // Everywhere else on the section a postseason box score is held out of season totals. Not here.
    const grid = wpblScorigami([
      game({ id: 'reg', home_score: 5, away_score: 2 }),
      game({ id: 'post', game_type: 'postseason', counts_in_standings: false, home_score: 8, away_score: 1 }),
    ])
    expect(grid.totalGames).toBe(2)
    expect(grid.cells.has(scorigamiKey(8, 1))).toBe(true)
  })

  it('links a repeated score to the EARLIEST game', () => {
    const grid = wpblScorigami([
      game({ id: 'later', game_date: '2026-08-20', home_score: 4, away_score: 3 }),
      game({ id: 'first', game_date: '2026-07-01', home_score: 3, away_score: 4 }),
    ])
    const cell = grid.cells.get(scorigamiKey(4, 3))!
    expect(cell.count).toBe(2)
    expect(cell.first.id).toBe('first')
    // The full list stays earliest-first too, so a caller can name every occurrence in order.
    expect(cell.games.map(g => g.id)).toEqual(['first', 'later'])
  })

  it('reports the largest winning score as the grid height, and 0 when empty', () => {
    expect(wpblScorigami([]).maxWin).toBe(0)
    expect(wpblScorigami([game({ home_score: 11, away_score: 9 })]).maxWin).toBe(11)
  })

  it('replays in date order, one final at a time, ending on the full grid', () => {
    const grid = wpblScorigami([
      game({ id: 'c', game_date: '2026-08-03', home_score: 5, away_score: 2 }),
      game({ id: 'a', game_date: '2026-08-01', home_score: 5, away_score: 2 }),
      game({ id: 'b', game_date: '2026-08-02', home_score: 9, away_score: 1 }),
    ])
    expect(grid.steps.map(s => s.game.id)).toEqual(['a', 'b', 'c'])
    expect(scorigamiCountsAt(grid, 0).size).toBe(0)
    expect([...scorigamiCountsAt(grid, 1)]).toEqual([[scorigamiKey(5, 2), 1]])
    expect(scorigamiCountsAt(grid, 2).get(scorigamiKey(9, 1))).toBe(1)
    // The last frame must agree with the static grid, or the replay ends on a different picture.
    const end = scorigamiCountsAt(grid, grid.steps.length)
    for (const [k, cell] of grid.cells) expect(end.get(k)).toBe(cell.count)
    expect(scorigamiCountsAt(grid, 99).get(scorigamiKey(5, 2))).toBe(2)
  })
})

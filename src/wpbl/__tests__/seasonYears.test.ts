import { describe, expect, it } from 'vitest'
import { inSeason, seasonsPlayed, latestSeason, gamesInSeason, type WpblDatedGame } from '../season'

const game = (id: string, game_date: string, game_type: string | null = 'regular'): WpblDatedGame =>
  ({ id, game_date, game_type, counts_in_standings: true } as WpblDatedGame)

// Two years, with the 2026 postseason dated in September like the real one: it is a separate presto
// season with its own season_id, and must still land in 2026.
const games = [
  game('a', '2026-06-01'), game('b', '2026-09-10', 'postseason'),
  game('c', '2027-05-20'), game('d', '2027-06-02'),
]
const line = (game_id: string) => ({ game_id })

describe('player page seasons', () => {
  it('cuts lines to one year, postseason included', () => {
    const lines = [line('a'), line('b'), line('c')]
    expect(inSeason(lines, games, 2026).map(l => l.game_id)).toEqual(['a', 'b'])
    expect(inSeason(lines, games, 2027).map(l => l.game_id)).toEqual(['c'])
  })

  it('counts a line whose game is not in the schedule yet in the newest season only', () => {
    // A box score can land before its game row. Dropping it would take a game off the season
    // being played; it cannot be claimed by an older year.
    expect(inSeason([line('new')], games, 2027)).toHaveLength(1)
    expect(inSeason([line('new')], games, 2026)).toHaveLength(0)
  })

  it('lists the seasons a player has lines in, newest first', () => {
    expect(seasonsPlayed([line('a'), line('d'), line('b')], games)).toEqual([2027, 2026])
    expect(seasonsPlayed([line('a')], games)).toEqual([2026])
    expect(seasonsPlayed([], games)).toEqual([])
  })

  it('finds the newest season and one season of schedule', () => {
    expect(latestSeason(games)).toBe(2027)
    expect(latestSeason([])).toBeNull()
    expect(gamesInSeason(games, 2026).map(g => g.id)).toEqual(['a', 'b'])
  })
})

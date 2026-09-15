import { describe, it, expect } from 'vitest'
import { runsByInning, battedHalves, perHalf, leagueExtremes, EXTRAS_COLUMN } from '../derive/runsByInning'
import type { WpblGame, WpblTeam } from '../types'

// The runs-by-inning grid, and the ways it could be wrong while drawing a perfectly plausible map:
//
//   - a bottom half the home side never batted counted as a scoreless inning, which is how the feed
//     stores it, so every club's 7th reads quieter than it was;
//   - a walk-off dropped by the same rule, which would lose the most dramatic runs in the season;
//   - a postseason run reaching the regular season, on rows that say counts_in_standings: true;
//   - a line score that does not add up to its own final trusted anyway.

const TEAMS = ['SF', 'NY', 'LA', 'BOS'].map(id => ({ id } as WpblTeam))
const line = (runs: number[]) => runs.map((r, i) => ({ inning: i + 1, runs: r }))
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

let seq = 0
const game = (away: number[], home: number[], o: Partial<WpblGame> = {}): WpblGame => ({
  id: `g${seq++}`, game_date: '2026-08-07', status: 'final',
  away_team_id: 'LA', home_team_id: 'SF',
  away_score: sum(away), home_score: sum(home),
  away_line: line(away), home_line: line(home),
  game_type: 'regular', counts_in_standings: true, ...o,
} as WpblGame)

const col = (inning: number) => inning - 1
const row = (grid: ReturnType<typeof runsByInning>, id: string) => grid.clubs.find(r => r.teamId === id)!

describe('battedHalves', () => {
  it('drops the bottom of the last inning when the home side already led', () => {
    // SF led 2-1 going to the bottom of the 7th, so it never batted; the feed still stores a 0.
    const h = battedHalves(game([0, 0, 0, 0, 0, 0, 1], [2, 0, 0, 0, 0, 0, 0]))!
    expect(h.home.map(e => e.inning)).toEqual([1, 2, 3, 4, 5, 6])
    expect(h.away).toHaveLength(7)
  })

  it('keeps a walk-off', () => {
    const h = battedHalves(game([1, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 2]))!
    expect(h.home).toHaveLength(7)
  })

  it('keeps a bottom half the home side batted after losing the lead in the top', () => {
    // 3-3 going to the bottom of the 7th: batted, even though the stored 0 looks the same.
    const h = battedHalves(game([0, 0, 0, 0, 0, 0, 3], [3, 0, 0, 0, 0, 0, 1]))!
    expect(h.home).toHaveLength(7)
  })

  it('refuses a line score that does not add up to its own final', () => {
    expect(battedHalves(game([1, 0, 0, 0, 0, 0, 0], [2, 0, 0, 0, 0, 0, 0], { away_score: 4 }))).toBeNull()
    expect(battedHalves(game([1], [2], { home_line: null }))).toBeNull()
  })
})

describe('runsByInning', () => {
  it('divides by the halves batted, not the games played', () => {
    const grid = runsByInning([
      game([0, 0, 0, 0, 0, 0, 1], [2, 0, 0, 0, 0, 0, 0]), // SF skips the bottom 7th
      game([0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 3]), // SF walks it off with 3
    ], TEAMS, 'regular')
    const sf = row(grid, 'SF')
    expect(sf.games).toBe(2)
    expect(sf.scored[col(7)]).toMatchObject({ runs: 3, halves: 1 })
    expect(perHalf(sf.scored[col(7)])).toBe(3)
    // LA's pitchers faced one bottom 7th, not two.
    expect(row(grid, 'LA').allowed[col(7)]).toMatchObject({ runs: 3, halves: 1 })
  })

  it('credits the runs a club gives up to its allowed row', () => {
    const grid = runsByInning([game([4, 0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0, 5])], TEAMS, 'regular')
    expect(row(grid, 'SF').allowed[col(1)].runs).toBe(4)
    expect(row(grid, 'LA').allowed[col(1)].runs).toBe(1)
    expect(row(grid, 'LA').allowed[col(7)].runs).toBe(5)
  })

  it('reads the same scored and allowed on the league row, since every run is both', () => {
    const grid = runsByInning([
      game([4, 0, 1, 0, 0, 2, 0], [1, 3, 0, 0, 0, 0, 5]),
      game([0, 1, 0, 0, 0, 0, 0], [2, 0, 0, 0, 0, 0, 0], { away_team_id: 'NY', home_team_id: 'BOS' }),
    ], TEAMS, 'regular')
    expect(grid.league.scored).toEqual(grid.league.allowed)
    expect(grid.league.games).toBe(2)
  })

  it('pools every extra inning into one column, per half batted', () => {
    // To the 9th, walked off in the bottom: SF bats the 8th and 9th, LA the 8th and 9th.
    const grid = runsByInning([
      game([0, 0, 0, 0, 0, 0, 0, 1, 0], [0, 0, 0, 0, 0, 0, 0, 1, 1]),
    ], TEAMS, 'regular')
    expect(grid.columns).toEqual([1, 2, 3, 4, 5, 6, 7, EXTRAS_COLUMN])
    expect(row(grid, 'SF').scored[EXTRAS_COLUMN - 1]).toMatchObject({ runs: 2, halves: 2 })
    expect(row(grid, 'LA').scored[EXTRAS_COLUMN - 1]).toMatchObject({ runs: 1, halves: 2 })
  })

  it('draws no extras column when nothing went long, and leaves extras out of the colour scale', () => {
    expect(runsByInning([game([1, 0, 0, 0, 0, 0, 0], [2, 0, 0, 0, 0, 0, 0])], TEAMS, 'regular').columns).toHaveLength(7)
    const long = runsByInning([
      game([1, 0, 0, 0, 0, 0, 0, 9], [0, 0, 0, 0, 0, 0, 1, 0]),
    ], TEAMS, 'regular')
    // Regulation holds 2 runs in 14 halves; the 9-run 8th would otherwise set the scale for everything.
    expect(long.mean).toBeCloseTo(1 / 7)
    expect(long.spread).toBeCloseTo(6 / 7)
  })

  it('keeps the postseason out of the regular season, on rows that claim to count', () => {
    const games = [
      game([1, 0, 0, 0, 0, 0, 0], [2, 0, 0, 0, 0, 0, 0]),
      // What the feed actually sends on a bracket game: the flag is useless, game_type is the tell.
      game([5, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0], { game_type: 'postSeason', counts_in_standings: true }),
    ]
    const regular = runsByInning(games, TEAMS, 'regular')
    const post = runsByInning(games, TEAMS, 'postseason')
    expect(regular.games).toBe(1)
    expect(row(regular, 'LA').scored[col(1)].runs).toBe(1)
    expect(post.games).toBe(1)
    expect(row(post, 'LA').scored[col(1)].runs).toBe(5)
  })

  it('counts only finals, and leaves a club with no games in scope off the grid', () => {
    const grid = runsByInning([
      game([3, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0], { status: 'live' }),
      game([1, 0, 0, 0, 0, 0, 0], [2, 0, 0, 0, 0, 0, 0]),
    ], TEAMS, 'regular')
    expect(grid.games).toBe(1)
    expect(grid.clubs.map(r => r.teamId)).toEqual(['SF', 'LA'])
  })

  it('names the busiest and quietest regulation inning league-wide', () => {
    const grid = runsByInning([game([4, 1, 1, 1, 1, 1, 0], [2, 1, 1, 1, 1, 1, 1])], TEAMS, 'regular')
    const ext = leagueExtremes(grid)!
    expect(ext.high.inning).toBe(1)
    // SF trailed 7-9 going to the bottom of the 7th, so it batted: 1 run in two halves, the lowest.
    expect(ext.low.inning).toBe(7)
  })
})

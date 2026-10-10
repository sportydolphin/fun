import { describe, it, expect } from 'vitest'
import {
  fieldingQualified, fieldingRows, fieldingLeagueLine, fieldingDefsFor, combineFieldingLines, combineFieldingSplits,
  combineTeamLines, type GridRow,
} from '../lib/seasonGrid'
import { boardSortFor } from '../state/useMlbState'
import { mlbUrlFor, mlbSnapshotFromUrl, mlbNavKeyFromPath, MLB_STATS_BOARDS, MLB_VIEW_PATHS } from '../routes'

const row = (position: string, stat: Record<string, unknown>): GridRow => ({ id: `1-${position}`, playerId: 1, name: 'A', teamId: 136, position, stat })

describe('the fielding title bar', () => {
  // Rule 9.22(c): half the club's games at catcher, two thirds anywhere else, an inning a game pitched.
  it('qualifies each position on its own terms', () => {
    expect(fieldingQualified(row('C', { games: 81 }), 162)).toBe(true)
    expect(fieldingQualified(row('C', { games: 80 }), 162)).toBe(false)
    expect(fieldingQualified(row('SS', { games: 108 }), 162)).toBe(true)
    expect(fieldingQualified(row('SS', { games: 107 }), 162)).toBe(false)
    // A pitcher qualifies on innings, which arrive with outs after the point.
    expect(fieldingQualified(row('P', { games: 30, innings: '162.0' }), 162)).toBe(true)
    expect(fieldingQualified(row('P', { games: 30, innings: '161.2' }), 162)).toBe(false)
    expect(fieldingQualified(row('SS', { games: 108 }), 0)).toBe(false)
  })
})

describe('the fielding rows', () => {
  it('keys a row per player per position', () => {
    const rows = fieldingRows([
      { player: { id: 7, fullName: 'Utility' }, team: { id: 136 }, position: { abbreviation: '2B' }, stat: {} },
      { player: { id: 7, fullName: 'Utility' }, team: { id: 136 }, position: { abbreviation: 'SS' }, stat: {} },
    ])
    expect(rows.map(r => r.id)).toEqual(['7-2B', '7-SS'])
  })

  // Summed, never averaged: three chances must not weigh what a season does.
  it('sums the league line rather than averaging the rows', () => {
    const line = fieldingLeagueLine([
      row('SS', { putOuts: 200, assists: 400, errors: 10, innings: '1200.0' }),
      row('SS', { putOuts: 1, assists: 1, errors: 1, innings: '10.0' }),
    ])
    expect(line?.fielding).toBe('.982')
    expect(line?.caughtStealingPercentage).toBeUndefined()
  })

  it('offers the catching columns on the catchers alone', () => {
    expect(fieldingDefsFor('C').some(d => d.key === 'pb')).toBe(true)
    expect(fieldingDefsFor('SS').some(d => d.key === 'pb')).toBe(false)
    expect(fieldingDefsFor('all').some(d => d.key === 'pb')).toBe(false)
  })
})

describe('the Teams and Fielding addresses', () => {
  it('are Stats boards, lit as the Stats tab', () => {
    expect(MLB_STATS_BOARDS).toEqual(['leaderboard', 'stats', 'teamStats', 'fielding', 'viz'])
    expect(mlbNavKeyFromPath(MLB_VIEW_PATHS.teamStats)).toBe('stats')
    expect(mlbNavKeyFromPath(MLB_VIEW_PATHS.fielding)).toBe('stats')
  })

  it('carry the side, the season and the games, and nothing they cannot use', () => {
    expect(mlbUrlFor({ view: 'teamStats', lb: 'pitching', season: 2024, games: 'post' }, 2026)).toBe('/mlb/team-stats?lb=pitching&season=2024&games=post')
    // Fielding has no side.
    expect(mlbUrlFor({ view: 'fielding', lb: 'pitching', season: 2024, games: 'all' }, 2026)).toBe('/mlb/fielding?season=2024&games=all')
    // Charts has no playoffs pool.
    expect(mlbUrlFor({ view: 'viz', games: 'post' }, 2026)).toBe('/mlb/charts')
    expect(mlbSnapshotFromUrl('/mlb/team-stats', '?lb=pitching&season=2024&games=post'))
      .toEqual({ view: 'teamStats', lb: 'pitching', allTime: false, season: 2024, games: 'post', sort: null, dir: null })
    expect(mlbSnapshotFromUrl('/mlb/fielding', '?lb=pitching'))
      .toEqual({ view: 'fielding', lb: 'hitting', allTime: false, season: null, games: 'regular', sort: null, dir: null, pos: null, club: null })
  })

  // A reversed sort is part of what the sender was looking at, on all three tables.
  it('carries a reversed sort', () => {
    expect(mlbUrlFor({ view: 'stats', sort: 'era', dir: 'desc', lb: 'pitching' }, 2026)).toBe('/mlb/stats?lb=pitching&sort=era&dir=desc')
    expect(mlbUrlFor({ view: 'fielding', dir: 'asc' }, 2026)).toBe('/mlb/fielding?dir=asc')
    expect(mlbSnapshotFromUrl('/mlb/team-stats', '?dir=asc')).toMatchObject({ sort: null, dir: 'asc' })
    expect(mlbSnapshotFromUrl('/mlb/stats', '?dir=sideways')).toMatchObject({ dir: null })
    // Players: a direction alone turns the default column round.
    expect(boardSortFor('hitting', null, 'asc')).toMatchObject({ sortKey: 'ops', sortAsc: true })
    expect(boardSortFor('pitching', 'era', 'desc')).toMatchObject({ sortKey: 'era', sortAsc: false })
    expect(boardSortFor('pitching', 'era')).toMatchObject({ sortAsc: true })
    expect(boardSortFor('hitting', null)).toBeNull()
  })

  // Everything on the board is on the address, so a link says exactly what the sender was looking at.
  it('round-trips the sort, the position and the club', () => {
    const url = mlbUrlFor({ view: 'fielding', season: 2025, sort: 'e', pos: 'SS', club: 136 }, 2026)
    expect(url).toBe('/mlb/fielding?season=2025&sort=e&pos=SS&team=mariners')
    const [path, q] = url.split('?')
    expect(mlbSnapshotFromUrl(path, `?${q}`)).toMatchObject({ view: 'fielding', season: 2025, sort: 'e', pos: 'SS', club: 136 })
    expect(mlbUrlFor({ view: 'teamStats', lb: 'pitching', sort: 'whip' }, 2026)).toBe('/mlb/team-stats?lb=pitching&sort=whip')
  })

  it('opens the whole board on a position or club it does not know', () => {
    expect(mlbSnapshotFromUrl('/mlb/fielding', '?pos=DH&team=nowhere')).toMatchObject({ pos: null, club: null })
  })
})

describe('regular season plus playoffs', () => {
  // Counts add; rates are rebuilt from them, never carried over from one half.
  it('rebuilds a fielder’s rates from the summed counts', () => {
    const both = combineFieldingLines(
      { games: 150, putOuts: 200, assists: 400, errors: 10, chances: 610, innings: '1300.1', fielding: '.984', stolenBases: 0, caughtStealing: 0 },
      { games: 10, putOuts: 10, assists: 20, errors: 0, chances: 30, innings: '88.2', fielding: '1.000', stolenBases: 0, caughtStealing: 0 },
    )
    expect(both.games).toBe(160)
    expect(both.innings).toBe('1389.0')
    expect(both.fielding).toBe('.984')
    expect(both.rangeFactorPer9Inn).toBe((27 * 630 / (1389 * 3)).toFixed(2))
    expect(both.caughtStealingPercentage).toBeUndefined()
  })

  it('keys a fielder by player and position, on the club they finished with', () => {
    const reg = [{ player: { id: 1 }, position: { abbreviation: 'SS' }, team: { id: 136 }, stat: { games: 100, putOuts: 1, assists: 1, errors: 0, innings: '1.0' } }]
    const post = [
      { player: { id: 1 }, position: { abbreviation: 'SS' }, team: { id: 141 }, stat: { games: 5, putOuts: 1, assists: 1, errors: 0, innings: '1.0' } },
      { player: { id: 1 }, position: { abbreviation: '2B' }, team: { id: 141 }, stat: { games: 1, putOuts: 1, assists: 0, errors: 0, innings: '1.0' } },
    ]
    const both = combineFieldingSplits(reg, post)
    expect(both).toHaveLength(2)
    expect(both[0]).toMatchObject({ team: { id: 141 }, stat: { games: 105 } })
  })

  it('leaves a club with no postseason as it was', () => {
    const both = combineTeamLines(
      new Map([[136, { gamesPlayed: 162, hits: 1300, atBats: 5500 }], [141, { gamesPlayed: 162, hits: 1400, atBats: 5500 }]]),
      new Map([[141, { gamesPlayed: 6, hits: 50, atBats: 200 }]]),
    )
    expect(both.get(136)).toMatchObject({ gamesPlayed: 162 })
    expect(both.get(141)).toMatchObject({ gamesPlayed: 168, hits: 1450, avg: '.254' })
  })
})

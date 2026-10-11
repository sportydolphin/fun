import { describe, it, expect } from 'vitest'
import { adaptSeasonLines, unpack, seasonScopeOf } from '../seasonLines'
import { mlbUrlFor, mlbSnapshotFromUrl, mlbNavKeyFromPath, MLB_VIEW_PATHS } from '../routes'
import { bestGames } from '../../league/bests'
import { runFinder, EMPTY_FINDER_QUERY } from '../../league/finder'

// The MLB lines mirror as the browser reads it: the packed view row, turned into the neutral shapes
// the engines in src/league/ take, and the two boards' addresses.

const row = {
  season: 2026,
  synced_at: '2026-10-11T10:00:00Z',
  games: {
    cols: ['game_pk', 'game_date', 'game_type', 'counts_in_standings', 'status', 'home_team_id', 'away_team_id', 'home_score', 'away_score'],
    rows: [
      [1, '2026-05-01', 'R', true, 'final', 136, 117, 4, 2],
      [2, '2026-10-05', 'D', false, 'final', 117, 136, 1, 0],
    ],
  },
  // Columns in a different order from the view's, on purpose: the adapter reads by name.
  batting: {
    cols: ['player_id', 'game_pk', 'team_id', 'ab', 'r', 'h', 'doubles', 'triples', 'hr', 'rbi', 'bb', 'so', 'hbp', 'sb', 'cs', 'sf', 'sh', 'gdp', 'tb'],
    rows: [
      [10, 1, 136, 4, 2, 3, 0, 0, 2, 4, 0, 1, 0, 0, 0, 0, 0, 0, 9],
      [10, 2, 136, 4, 1, 4, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 13],
    ],
  },
  pitching: { cols: ['game_pk', 'player_id', 'team_id', 'outs', 'bf', 'h', 'r', 'er', 'bb', 'so', 'hr', 'pitches', 'strikes', 'hbp', 'wp', 'bk'], rows: [] },
  players: { cols: ['player_id', 'name', 'team_id'], rows: [[10, 'Cal Example', 136]] },
}

describe('adaptSeasonLines', () => {
  const lines = adaptSeasonLines(row)

  it('reads columns by name, whatever order they arrive in', () => {
    expect(lines.batting[0]).toMatchObject({ id: '1-10', game_id: '1', player_id: '10', team_id: '136', hr: 2, tb: 9 })
  })

  it('keeps the numeric ids beside the string ones, for links and logos', () => {
    expect(lines.games[0]).toMatchObject({ id: '1', gamePk: 1, home_team_id: '136', homeId: 136, awayId: 117 })
    expect(lines.players[0]).toMatchObject({ id: '10', playerId: 10, name: 'Cal Example' })
  })

  it('gives an empty set for a missing one rather than throwing', () => {
    expect(unpack(undefined)).toEqual([])
  })

  it('keeps a playoff game out of the regular season through the engines', () => {
    const hr = bestGames('hitting', lines.batting, lines.pitching, lines.players, lines.games, seasonScopeOf('regular'))
      .find(b => b.key === 'hr')!
    expect(hr.rows.map(r => r.value)).toEqual([2])
    const post = bestGames('hitting', lines.batting, lines.pitching, lines.players, lines.games, seasonScopeOf('post'))
      .find(b => b.key === 'hr')!
    expect(post.rows.map(r => r.value)).toEqual([3])
    // The board row hands back the adapter's player, numeric id and all.
    expect(hr.rows[0].player?.playerId).toBe(10)
  })

  it('finds a road game by the club played for that day', () => {
    const res = runFinder('hitting', lines.batting, [], lines.players, lines.games,
      { ...EMPTY_FINDER_QUERY, venue: 'away', scope: 'all' })
    expect(res.rows.map(r => r.game?.gamePk)).toEqual([2])
  })
})

describe('the Bests and Find addresses', () => {
  it('are Stats boards', () => {
    expect(mlbNavKeyFromPath(MLB_VIEW_PATHS.bests)).toBe('stats')
    expect(mlbNavKeyFromPath(MLB_VIEW_PATHS.find)).toBe('stats')
  })

  it('carry a Find question there and back', () => {
    const url = mlbUrlFor({
      view: 'find', lb: 'pitching', season: 2026, games: 'post',
      find: 'so.gte.10~bb.eq.0', findTeam: 136, findOpp: 117, findVenue: 'home',
    }, 2026)
    expect(url).toBe('/mlb/find?lb=pitching&games=post&q=so.gte.10%7Ebb.eq.0&team=mariners&opp=astros&venue=home')
    const [path, qs] = url.split('?')
    expect(mlbSnapshotFromUrl(path, `?${qs}`)).toMatchObject({
      view: 'find', lb: 'pitching', games: 'post', find: 'so.gte.10~bb.eq.0', findTeam: 136, findOpp: 117, findVenue: 'home',
    })
  })

  it('leave Find\'s fields off every other board', () => {
    expect(mlbUrlFor({ view: 'bests', lb: 'pitching', find: 'so.gte.10' }, 2026)).toBe('/mlb/bests?lb=pitching')
  })
})

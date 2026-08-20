import { describe, it, expect } from 'vitest'
import { regularSeasonLines, excludedGameIds } from '../season'
import {
  sumBatting, sumPitching, aggregateBatting, aggregatePitching,
  wpblQualifiers, computeWpblTeamStats,
} from '../stats'
import type { WpblBattingLine, WpblPitchingLine, WpblPlayer, WpblGame, WpblTeam } from '../types'

// The other half of the postseason problem. `countsInStandings` (see countsInStandings.test.ts)
// keeps playoff games out of the RECORD; this keeps them out of the NUMBERS.
//
// Seven to eleven postseason games land on top of a 30-game regular season, and a finalist
// plays up to eight more on top of its fifteen. Left alone, the first semifinal box score
// changes every season total on the site, and unevenly: a finalist's hitter gains eight games
// of counting stats where a club swept in the semis gains two, so the leaderboards reorder by
// how far a team went rather than by how anyone played.

const REG = 'g-regular'
const POST = 'g-post'

const games: WpblGame[] = [
  { id: REG, game_type: 'regular', counts_in_standings: true } as WpblGame,
  { id: POST, game_type: 'postseason', counts_in_standings: false } as WpblGame,
]

const bat = (o: Partial<WpblBattingLine> = {}): WpblBattingLine => ({
  id: Math.random().toString(36).slice(2), game_id: REG, player_id: 'p1', team_id: 'SF',
  batting_order: 1, position: 'CF',
  ab: 4, r: 1, h: 2, doubles: 0, triples: 0, hr: 0, rbi: 1, bb: 0, so: 1,
  hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0, ibb: 0, gdp: 0, ...o,
} as WpblBattingLine)

const pit = (o: Partial<WpblPitchingLine> = {}): WpblPitchingLine => ({
  id: Math.random().toString(36).slice(2), game_id: REG, player_id: 'p2', team_id: 'SF',
  outs: 21, bf: 28, h: 5, r: 2, er: 2, bb: 1, so: 7, hr: 0, pitches: 95,
  decision: 'W', gs: 1, hbp: 0, ibb: 0, wp: 0, bk: 0, strikes: 60, ...o,
} as WpblPitchingLine)

const players: WpblPlayer[] = [
  { id: 'p1', name: 'Denae Benites', team_id: 'NY' } as WpblPlayer,
  { id: 'p2', name: 'Meggie Meidlinger', team_id: 'LA' } as WpblPlayer,
]

describe('regularSeasonLines', () => {
  it('drops the lines belonging to a postseason game', () => {
    const lines = [bat(), bat({ game_id: POST }), bat()]
    expect(regularSeasonLines(lines, games)).toHaveLength(2)
  })

  it('FAILS OPEN on a game it has never heard of', () => {
    // The direction matters more than the filtering. Keeping only lines whose game is in the
    // counted set would empty a player page the moment a caller held a partial schedule, and
    // an empty season reads as a broken site rather than as a slightly wrong number.
    const orphan = bat({ game_id: 'a-game-nobody-passed-us' })
    expect(regularSeasonLines([orphan], games)).toEqual([orphan])
    expect(regularSeasonLines([orphan], [])).toEqual([orphan])
  })

  it('names the excluded games, not the included ones', () => {
    expect([...excludedGameIds(games)]).toEqual([POST])
  })
})

describe('season totals', () => {
  it('leaves a postseason game out of a batting line', () => {
    const t = sumBatting([bat(), bat({ game_id: POST, ab: 4, h: 4, hr: 2 })], games)
    expect(t.g).toBe(1)
    expect(t.h).toBe(2)
    expect(t.hr).toBe(0)
    expect(t.avg).toBeCloseTo(0.5)
  })

  it('leaves a postseason game out of a pitching line', () => {
    const t = sumPitching([pit(), pit({ game_id: POST, outs: 21, er: 9 })], games)
    expect(t.outs).toBe(21)
    expect(t.er).toBe(2)
  })

  it('counts everything when the schedule says every game is regular', () => {
    const t = sumBatting([bat(), bat()], [games[0]])
    expect(t.g).toBe(2)
  })
})

describe('league aggregates', () => {
  it('excludes postseason lines from the batting leaderboard', () => {
    const rows = aggregateBatting(players, [
      bat({ player_id: 'p1' }),
      bat({ player_id: 'p1', game_id: POST, hr: 3 }),
    ], games)
    expect(rows).toHaveLength(1)
    expect(rows[0].totals.g).toBe(1)
    expect(rows[0].totals.hr).toBe(0)
  })

  it('excludes postseason lines from the pitching leaderboard', () => {
    const rows = aggregatePitching(players, [
      pit({ player_id: 'p2' }),
      pit({ player_id: 'p2', game_id: POST, so: 12 }),
    ], games)
    expect(rows[0].totals.so).toBe(7)
  })

  it('drops a player entirely if all they have is postseason', () => {
    // Not a judgement call: a player with no regular-season line has no regular-season row,
    // the same as a player who never appeared.
    const rows = aggregateBatting(players, [bat({ player_id: 'p1', game_id: POST })], games)
    expect(rows).toHaveLength(0)
  })
})

describe('qualifier thresholds', () => {
  const teams = [{ id: 'SF' } as WpblTeam, { id: 'NY' } as WpblTeam]
  const played = (id: string, over: Partial<WpblGame> = {}): WpblGame => ({
    id, status: 'final', home_team_id: 'SF', away_team_id: 'NY',
    game_type: 'regular', counts_in_standings: true, ...over,
  } as WpblGame)

  it('does not count postseason games toward the games-played bar', () => {
    // The thresholds scale off games played, so counting playoff games would raise the bar
    // for a rate title mid-postseason and quietly drop players off boards they had earned.
    const regular = Array.from({ length: 10 }, (_, i) => played(`r${i}`))
    const withPost = [...regular, ...Array.from({ length: 8 }, (_, i) =>
      played(`p${i}`, { game_type: 'postseason', counts_in_standings: false }))]

    expect(wpblQualifiers(teams, withPost)).toEqual(wpblQualifiers(teams, regular))
    expect(wpblQualifiers(teams, regular).teamGames).toBe(10)
  })
})

describe('team season comparison', () => {
  const teams = [{ id: 'SF' } as WpblTeam, { id: 'NY' } as WpblTeam]

  it('keeps runs and the games denominator on the same side of the line', () => {
    // R/G is the one stat here with a denominator of its own. If the lines were filtered and
    // the games count was not, a finalist's regular-season runs would be divided by a total
    // that included its playoff run, and the whole league's bars would shift under it.
    const schedule: WpblGame[] = [
      { id: REG, status: 'final', home_team_id: 'SF', away_team_id: 'NY',
        game_type: 'regular', counts_in_standings: true } as WpblGame,
      { id: POST, status: 'final', home_team_id: 'SF', away_team_id: 'NY',
        game_type: 'postseason', counts_in_standings: false } as WpblGame,
    ]
    const batting = [
      bat({ team_id: 'SF', r: 3 }),
      bat({ team_id: 'SF', game_id: POST, r: 9 }),
    ]
    const stats = computeWpblTeamStats(teams, schedule, batting, [pit({ team_id: 'SF' })])
    expect(stats.get('SF')?.rpg?.display).toBe('3.0')
  })
})

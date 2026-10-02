// "All" is the regular season and the postseason summed by us, because StatsAPI has no combined
// pool. The failure worth pinning is a rate that was added or carried over instead of rebuilt:
// it looks like a perfectly good number.
import { describe, it, expect } from 'vitest'
import { combineStatLines, combineEntries } from '../lib/gameScope'
import { filterQualified } from '../lib/utils'
import { mlbUrlFor } from '../routes'

describe('combineStatLines', () => {
  const regular = {
    age: 30, gamesPlayed: 158, plateAppearances: 727, atBats: 611, hits: 172, doubles: 25, triples: 9,
    homeRuns: 55, baseOnBalls: 109, hitByPitch: 3, sacFlies: 4, totalBases: 380, stolenBases: 20, caughtStealing: 6,
    avg: '.282', obp: '.392', slg: '.622', ops: '1.014', babip: '.300',
  }
  const post = {
    age: 30, gamesPlayed: 17, plateAppearances: 84, atBats: 68, hits: 18, doubles: 3, triples: 1,
    homeRuns: 8, baseOnBalls: 16, hitByPitch: 0, sacFlies: 0, totalBases: 47, stolenBases: 1, caughtStealing: 1,
    avg: '.265', obp: '.405', slg: '.691', ops: '1.096', babip: '.270',
  }
  const all = combineStatLines(regular, post)

  it('adds the counts, and leaves age alone', () => {
    expect(all.gamesPlayed).toBe(175)
    expect(all.homeRuns).toBe(63)
    expect(all.plateAppearances).toBe(811)
    expect(all.age).toBe(30)
  })

  it('rebuilds the rates from the summed counts', () => {
    expect(all.avg).toBe('.280')                       // 190 / 679
    expect(all.obp).toBe('.392')                       // 318 / 811
    expect(all.slg).toBe('.629')                       // 427 / 679
    expect(all.ops).toBe('1.021')
    expect(all.stolenBasePercentage).toBe('.750')      // 21 / 28
  })

  it('drops a rate it cannot rebuild rather than keeping one half of it', () => {
    expect(all.babip).toBeUndefined()
  })

  it('adds innings by the out, and rebuilds the pitching rates on nine', () => {
    const p = combineStatLines(
      { inningsPitched: '10.2', outs: 32, earnedRuns: 4, hits: 8, baseOnBalls: 3, strikeOuts: 12, wins: 1, losses: 0, era: '3.38' },
      { inningsPitched: '2.1', outs: 7, earnedRuns: 1, hits: 2, baseOnBalls: 1, strikeOuts: 3, wins: 0, losses: 1, era: '3.86' },
    )
    expect(p.inningsPitched).toBe('13.0')
    expect(p.era).toBe('3.46')                         // 5 * 27 / 39
    expect(p.whip).toBe('1.08')                        // 14 * 3 / 39
    expect(p.strikeoutsPer9Inn).toBe('10.38')
    expect(p.winPercentage).toBe('.500')
  })

  it('reads innings when a line has no outs field', () => {
    expect(combineStatLines({ inningsPitched: '1.2', earnedRuns: 0 }, { inningsPitched: '0.1', earnedRuns: 0 }).inningsPitched).toBe('2.0')
  })
})

describe('combineEntries', () => {
  it('joins on the player, takes the postseason club, and keeps players in only one half', () => {
    const out = combineEntries(
      [{ playerId: 1, teamId: 10, teamAbbr: 'AAA', stat: { homeRuns: 30 } }, { playerId: 2, teamId: 10, teamAbbr: 'AAA', stat: { homeRuns: 5 } }],
      [{ playerId: 1, teamId: 20, teamAbbr: 'BBB', stat: { homeRuns: 3 } }, { playerId: 3, teamId: 20, teamAbbr: 'BBB', stat: { homeRuns: 1 } }],
    )
    const by = new Map(out.map(e => [e.playerId, e]))
    expect(out).toHaveLength(3)
    expect(by.get(1)).toMatchObject({ teamId: 20, stat: { homeRuns: 33 } })
    expect(by.get(2)!.stat.homeRuns).toBe(5)
    expect(by.get(3)!.stat.homeRuns).toBe(1)
  })
})

// The regular-season rule takes one threshold from the busiest player, with a 30 PA floor. In the
// postseason that bars everybody for the first week and every eliminated club for good.
describe('the postseason qualifier', () => {
  const hitter = (teamId: number, gamesPlayed: number, plateAppearances: number) => ({ teamId, stat: { gamesPlayed, plateAppearances } })

  it('is judged per club, at 3.1 PA a team game', () => {
    const pool = [
      hitter(1, 2, 8), hitter(1, 2, 5),              // a Wild Card loser: 2 games, bar 6
      hitter(2, 12, 50), hitter(2, 12, 30),          // a pennant winner: 12 games, bar 37
    ]
    expect(filterQualified(pool, 'hitting', 'post').map(e => e.stat.plateAppearances)).toEqual([8, 50])
    // The regular-season rule takes its bar from the busiest player, and bars the first club entirely.
    expect(filterQualified(pool, 'hitting').map(e => e.stat.plateAppearances)).toEqual([50])
  })

  it('counts a club\'s games from its starts for pitchers, at an inning a game', () => {
    const p = (teamId: number, gamesStarted: number, inningsPitched: string) => ({ teamId, stat: { gamesStarted, inningsPitched } })
    const pool = [p(1, 2, '12.0'), p(1, 1, '2.2'), p(1, 0, '3.0')]   // 3 games, bar 3 IP
    expect(filterQualified(pool, 'pitching', 'post').map(e => e.stat.inningsPitched)).toEqual(['12.0', '3.0'])
  })
})

describe('the address', () => {
  it('carries the scope on the two boards it applies to, and nowhere else', () => {
    expect(mlbUrlFor({ view: 'leaderboard', games: 'post' }, 2026)).toBe('/mlb/leaders?games=post')
    expect(mlbUrlFor({ view: 'stats', games: 'all', lb: 'pitching' }, 2026)).toBe('/mlb/stats?lb=pitching&games=all')
    expect(mlbUrlFor({ view: 'leaderboard', games: 'regular' }, 2026)).toBe('/mlb/leaders')
    expect(mlbUrlFor({ view: 'viz', games: 'post' }, 2026)).toBe('/mlb/charts')
  })
})

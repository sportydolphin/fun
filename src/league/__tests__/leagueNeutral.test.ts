import { describe, it, expect } from 'vitest'
import { buildRunExpectancy, playRunValues, type RunValueGame } from '../runExpectancy'
import { aggregatePitchCodes, pitchQualifiers, readSequence } from '../pitches'
import { bestGames } from '../bests'
import { scopedLines } from '../season'
import type { BattingGameLine, LeagueGame, RunValuePlay } from '../types'
import { MLB_LEAGUE } from '../../mlb/league'
import { WPBL_LEAGUE } from '../../wpbl/league'

// The engines in src/league/ ran on WPBL alone until they were lifted, so WPBL's own suites prove
// the lift changed nothing there. These prove the other half: that what differs between the two
// leagues reaches each engine through the adapter, and that no seven was left behind in one.

const GAME: RunValueGame & LeagueGame = {
  id: 'g1', game_date: '2027-04-01', status: 'final', game_type: 'R', counts_in_standings: true,
  home_team_id: 'home', away_team_id: 'away', home_score: 0, away_score: 1,
  away_line: Array.from({ length: 9 }, (_, i) => ({ inning: i + 1, runs: i === 7 ? 1 : 0 })),
  home_line: Array.from({ length: 9 }, (_, i) => ({ inning: i + 1, runs: 0 })),
}

/** A nine-inning 1-0 game: three strikeouts in every half, except a solo home run leading off the
 *  top of the 8th. MLB's convention for `runs_scored`, so the home run carries its own run. */
function nineInnings(): RunValuePlay[] {
  const plays: RunValuePlay[] = []
  let sequence = 0
  const pa = (inning: number, half: 'top' | 'bottom', outs: number, event: string, runs: number) => plays.push({
    game_id: 'g1', sequence: sequence++, inning, half, team_id: half === 'top' ? 'away' : 'home',
    batter_id: `b${sequence}`, batter_name: `Batter ${sequence}`, pitcher_id: 'p', pitcher_name: 'Pitcher',
    outs, first_base: '', second_base: '', third_base: '', event_type: event, runs_scored: runs,
    narrative: null, pitch_sequence: event === 'strikeout' ? 'CSS' : 'X',
  })
  for (let inning = 1; inning <= 9; inning++) {
    for (const half of ['top', 'bottom'] as const) {
      if (inning === 8 && half === 'top') pa(inning, half, 0, 'home_run', 1)
      for (let outs = 0; outs < 3; outs++) pa(inning, half, outs, 'strikeout', 0)
    }
  }
  return plays
}

describe('run expectancy takes the game length from the league', () => {
  it('measures all eighteen half-innings of a nine-inning game', () => {
    const table = buildRunExpectancy(MLB_LEAGUE, nineInnings(), [GAME])
    expect(table.halfInnings).toBe(18)
    // Eighteen leadoffs with nobody on and nobody out, plus the batter after the home run, who
    // stood in the same state. Only the home run was followed by a run.
    expect(table.cells[0][0].n).toBe(19)
    expect(table.cells[0][0].re).toBeCloseTo(1 / 19)
  })

  it('would silently drop the 8th and 9th at seven innings, which is why it is not a literal', () => {
    const table = buildRunExpectancy({ ...MLB_LEAGUE, regulationInnings: 7 }, nineInnings(), [GAME])
    expect(table.halfInnings).toBe(14)
    expect(table.cells[0][0].re).toBe(0)
  })

  it('prices the home run with the league\'s own run count', () => {
    const plays = nineInnings()
    const table = buildRunExpectancy(MLB_LEAGUE, plays, [GAME])
    const hr = playRunValues(MLB_LEAGUE, plays, [GAME], table).find(v => v.play.event_type === 'home_run')!
    expect(hr.runs).toBe(1)
    // The caller's own play object comes back, not a copy.
    expect(plays).toContain(hr.play)
  })
})

describe('runs on a play are the league\'s rule', () => {
  it('adds the batter back on a WPBL home run and reads MLB\'s column as it stands', () => {
    // WPBL's feed counts the runners who crossed, so a solo home run arrives as 0.
    expect(WPBL_LEAGUE.runsOnPlay({ event_type: 'home_run', runs_scored: 0 })).toBe(1)
    expect(MLB_LEAGUE.runsOnPlay({ event_type: 'home_run', runs_scored: 1 })).toBe(1)
    expect(MLB_LEAGUE.runsOnPlay({ event_type: 'single', runs_scored: 2 })).toBe(2)
  })
})

describe('pitch letters are the league\'s alphabet', () => {
  it('reads P as a ball in play in WPBL and a pitchout in MLB', () => {
    expect(readSequence('P', WPBL_LEAGUE.pitchCodes).counts.inplay).toBe(1)
    expect(readSequence('P', MLB_LEAGUE.pitchCodes).counts.ball).toBe(1)
  })

  it('reads a WPBL called strike as unknown in MLB rather than guessing', () => {
    expect(readSequence('K', WPBL_LEAGUE.pitchCodes).counts.called).toBe(1)
    expect(readSequence('K', MLB_LEAGUE.pitchCodes).counts.unknown).toBe(1)
  })

  it('counts a foul tip with two strikes as the third, where a foul would not be', () => {
    // C, S: two strikes. T: a foul tip, which is a strike at any count.
    const r = readSequence('CST', MLB_LEAGUE.pitchCodes)
    expect(r.counts.swinging).toBe(2)
    expect(r.reachedTwoStrikes).toBe(true)
  })

  it('aggregates a nine-inning game in MLB letters with nothing unknown', () => {
    const board = aggregatePitchCodes(MLB_LEAGUE, nineInnings(), [], [GAME])
    expect(board.league.counts.unknown).toBe(0)
    expect(board.league.counts.called).toBe(54)
    expect(board.league.counts.inplay).toBe(1)
  })

  it('sets the sample bars in each league\'s own units', () => {
    expect(pitchQualifiers(WPBL_LEAGUE, 30)).toEqual({ minPitcher: 360, minBatter: 240 })
    // Over a full MLB season, about 0.8 of an inning and 2.5 trips to the plate a game.
    const mlb = pitchQualifiers(MLB_LEAGUE, 162)
    expect(mlb.minPitcher).toBeGreaterThan(2000)
    expect(mlb.minBatter).toBeGreaterThan(1500)
  })
})

describe('the postseason stays out on the adapter\'s flag', () => {
  // MLB types its playoff rounds with single letters that the loose pattern cannot match, so the
  // MLB mirror marks them with `counts_in_standings: false`, which is definitive on its own.
  const games: LeagueGame[] = [
    GAME,
    { ...GAME, id: 'g2', game_type: 'F', counts_in_standings: false },
  ]
  const line = (id: string, game_id: string, hr: number): BattingGameLine => ({
    id, game_id, player_id: 'x', team_id: 'away', ab: 4, r: hr, h: hr, doubles: 0, triples: 0, hr,
    rbi: hr, bb: 0, so: 0, hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0, tb: hr * 4,
  })
  const lines = [line('a', 'g1', 1), line('b', 'g2', 3)]

  it('keeps a wild-card game out of the regular season and in the playoffs', () => {
    expect(scopedLines(lines, games, 'regular').map(l => l.id)).toEqual(['a'])
    expect(scopedLines(lines, games, 'postseason').map(l => l.id)).toEqual(['b'])
  })

  it('so a playoff game is not a regular-season record', () => {
    const players = [{ id: 'x', name: 'Ada Example', team_id: 'away' }]
    const hr = bestGames('hitting', lines, [], players, games).find(b => b.key === 'hr')!
    expect(hr.rows.map(r => r.value)).toEqual([1])
    expect(hr.rows[0].player).toBe(players[0])
  })
})

describe('a records board at a big league size', () => {
  const games: LeagueGame[] = Array.from({ length: 20 }, (_, i) => ({ ...GAME, id: `t${i}` }))
  const players = [{ id: 'x', name: 'Ada Example', team_id: 'away' }]
  const lines: BattingGameLine[] = games.map((g, i) => ({
    id: `l${i}`, game_id: g.id, player_id: 'x', team_id: 'away', ab: 4, r: 3, h: 3, doubles: 0, triples: 0,
    hr: 3, rbi: 3, bb: 0, so: 0, hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0, tb: 12,
  }))

  it('extends through every tie when no cap is passed, as WPBL does', () => {
    const hr = bestGames('hitting', lines, [], players, games).find(b => b.key === 'hr')!
    expect(hr.rows).toHaveLength(20)
    expect(hr.more).toBe(0)
  })

  it('stops at the cap and counts the ties it left off rather than dropping them', () => {
    const hr = bestGames('hitting', lines, [], players, games, 'regular', 5, 10).find(b => b.key === 'hr')!
    expect(hr.rows).toHaveLength(10)
    expect(hr.more).toBe(10)
    expect(hr.rows.every(r => r.rank === 1)).toBe(true)
  })
})

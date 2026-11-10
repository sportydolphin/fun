import { describe, it, expect } from 'vitest'
import { buildWinProbModel } from '../derive/winProbability'
import { buildLeverageModel, fmtLeverage, leverageBand, leverageIndex, leverageLines } from '../derive/leverage'
import type { RunValueGame } from '../derive/runExpectancy'
import type { WpblRunValuePlay } from '../types'

// The same shape of synthetic league as winProbability.test.ts: complete half-innings of three
// plate appearances, scoring on a rotating out, so every cell the models read has a sample.
let seq = 0
function play(over: Partial<WpblRunValuePlay> = {}): WpblRunValuePlay {
  return {
    game_id: 'g1', sequence: seq++, inning: 1, half: 'top', team_id: 'away',
    batter_id: 'bat', batter_name: 'A Batter', pitcher_id: 'arm', pitcher_name: 'A Pitcher',
    outs: 0, first_base: null, second_base: null, third_base: null,
    event_type: 'strikeout', runs_scored: 0, narrative: '', pitch_sequence: 'S',
    ...over,
  } as WpblRunValuePlay
}

function synthetic(halves = 240) {
  const plays: WpblRunValuePlay[] = []
  const games: RunValueGame[] = []
  for (let h = 0; h < halves; h++) {
    const gameId = `g${Math.floor(h / 14)}`
    if (!games.some(g => g.id === gameId)) {
      games.push({
        id: gameId, game_date: '2026-08-01', status: 'final', game_type: 'regular',
        counts_in_standings: true, home_team_id: 'home', away_team_id: 'away',
        home_score: null, away_score: null,
      } as unknown as RunValueGame)
    }
    const inning = Math.floor((h % 14) / 2) + 1
    const half = h % 2 === 0 ? 'top' : 'bottom'
    const runs = h % 3 === 0 ? 1 : h % 5 === 0 ? 2 : 0
    const scoreOn = h % 3
    // A reliever takes over for the home side from the fifth on, so gmLI has someone to measure.
    const pitcher = half === 'top' && inning >= 5 ? 'pen' : 'arm'
    for (let o = 0; o < 3; o++) {
      plays.push(play({
        game_id: gameId, inning, half, outs: o, pitcher_id: pitcher,
        team_id: half === 'top' ? 'away' : 'home',
        event_type: o === scoreOn && runs > 0 ? 'home_run' : 'strikeout',
        runs_scored: o === scoreOn && runs > 0 ? runs - 1 : 0,
      }))
    }
  }
  return { plays, games }
}

const { plays, games } = synthetic()
const wp = buildWinProbModel(plays, games)
const lev = buildLeverageModel(wp, plays, games)

describe('leverage index', () => {
  it('averages 1.00 over the plate appearances it was measured on', () => {
    const line = leverageLines(lev, plays, games, 'hitting').get('bat')!
    expect(line.pa).toBeGreaterThan(0)
    expect(line.pli).toBeCloseTo(1, 6)
  })

  it('rises with the inning in a tie, and falls away in a rout', () => {
    const first = leverageIndex(lev, 1, 'top', 0, 0, 0)
    const last = leverageIndex(lev, 7, 'bottom', 0, 0, 0)
    expect(last).toBeGreaterThan(first)
    expect(leverageIndex(lev, 6, 'top', 0, 0, 10)).toBeLessThan(0.85)
  })

  it('is never negative and reads a decided game as nothing at stake', () => {
    for (let o = 0; o < 3; o++) expect(leverageIndex(lev, 3, 'top', o, 0, 0)).toBeGreaterThanOrEqual(0)
    expect(leverageIndex(lev, 7, 'top', 2, 0, 15)).toBeLessThan(0.01)
  })

  it('gives gmLI to a pitcher who entered in relief, and none to one who only started', () => {
    const arms = leverageLines(lev, plays, games, 'pitching')
    expect(arms.get('arm')!.gmli).toBeNull()
    expect(arms.get('pen')!.reliefApps).toBeGreaterThan(0)
    expect(arms.get('pen')!.gmli).not.toBeNull()
  })

  it('labels and prints on the standard bands', () => {
    expect(leverageBand(2.4)).toBe('High')
    expect(leverageBand(1)).toBe('Medium')
    expect(leverageBand(0.4)).toBe('Low')
    expect(fmtLeverage(1.837)).toBe('1.84')
    expect(fmtLeverage(null)).toBe('—')
  })
})

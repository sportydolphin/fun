import { describe, it, expect } from 'vitest'
import { bestGames } from '../../../league/bests'
import { EMPTY_FINDER_QUERY, runFinder } from '../../../league/finder'
import { aggregatePitchCodes } from '../../../league/pitches'
import { buildRunExpectancy, playRunValues } from '../../../league/runExpectancy'
import { WBSC_LEAGUE } from '../../league'
import { transformGame } from '../game'
import { EVENT, fixturePage } from './fixture'

// The proof that the importer's rows are the shapes the league-neutral engines read: each engine
// runs on them unchanged, with the WBSC binding, and gets the answer the fixture's game implies.
// If a field were misnamed or a unit wrong (innings as decimals, a half spelled `bot`), one of
// these would come back empty or off by a run rather than throwing, which is why they check
// numbers and not just that nothing broke.

const rows = transformGame(fixturePage(), EVENT)
const games = [rows.game]

describe('the engines run on WBSC rows', () => {
  it('best games: the hits board is led by the two-hit game', () => {
    const boards = bestGames('hitting', rows.batting, rows.pitching, rows.players, games, 'all')
    const hits = boards.find(b => b.key === 'h')!
    expect(hits.rows[0]).toMatchObject({ value: 2, name: 'Bea Bravo', teamId: 'AAA' })
    expect(hits.rows[0].game?.id).toBe('wbsc:g:500')
  })

  it('best games: innings pitched come through as outs', () => {
    const boards = bestGames('pitching', rows.batting, rows.pitching, rows.players, games, 'all')
    const ip = boards.find(b => b.key === 'outs')!
    expect(ip.rows[0]).toMatchObject({ value: 6, name: 'Pia Pitch-Away' })
  })

  it('the finder answers a question over the lines', () => {
    const result = runFinder('hitting', rows.batting, rows.pitching, rows.players, games, {
      ...EMPTY_FINDER_QUERY, scope: 'all', conditions: [{ field: 'h', op: 'gte', value: 1 }],
    })
    expect(result.rows.map(r => r.name).sort()).toEqual(['Bea Bravo', "Hana O'Home"])
  })

  it('run expectancy measures all four half-innings and prices the home run at its run', () => {
    const table = buildRunExpectancy(WBSC_LEAGUE, rows.plays, games)
    expect(table.halfInnings).toBe(4)
    const hr = playRunValues(WBSC_LEAGUE, rows.plays, games, table).find(v => v.play.event_type === 'home_run')!
    // WBSC counts the batter in `runs`, so the solo homer carries its own run.
    expect(hr.runs).toBe(1)
  })

  it('the pitch boards read the importer\'s alphabet with nothing unknown', () => {
    const board = aggregatePitchCodes(WBSC_LEAGUE, rows.plays, rows.players, games, 'all')
    // 4 + 2 + 3 + 1 to the visitors in the 1st, 1 + 3 + 0 + 1 to the home side, then 1 + 2 + 1 +
    // 1 + 1 and 1 + 1 + 1 in the 2nd: 24 pitches. Sixteen plate appearances, and the intentional
    // walk threw none, so fifteen reach a pitch board.
    expect(board.pitches).toBe(24)
    expect(board.pa).toBe(15)
    expect(board.league.counts.unknown).toBe(0)
    expect(board.league.counts.hbp).toBe(1)
  })
})

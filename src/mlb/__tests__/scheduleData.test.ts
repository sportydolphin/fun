import { describe, it, expect } from 'vitest'
import { chipBadge, parseTeamSchedule } from '../views/scheduleData'

// The Full schedule sheet opens on a club's last game once its season is over. It carried "NEXT" over
// a final until Nov 1, 2026.
describe('chipBadge', () => {
  it('calls a game still to be played next, and a finished one nothing', () => {
    expect(chipBadge({ state: 'preview' }, false)).toBe('NEXT')
    expect(chipBadge({ state: 'final' }, false)).toBeNull()
  })

  it('says today, live and unplayed whatever else is true', () => {
    expect(chipBadge({ state: 'final' }, true)).toBe('TODAY')
    expect(chipBadge({ state: 'live' }, true)).toBe('● LIVE')
    expect(chipBadge({ state: 'postponed', unplayed: 'Postponed' }, false)).toBe('PPD')
    expect(chipBadge({ state: 'postponed', unplayed: 'Cancelled' }, false)).toBe('CNCL')
  })
})

describe('parseTeamSchedule', () => {
  const game = (gamePk: number, gameNumber: number) => ({
    gamePk, gameNumber, gameDate: '2026-09-27T19:00:00Z',
    status: { abstractGameState: 'Final', detailedState: 'Final', codedGameState: 'F' },
    teams: {
      home: { team: { id: 116, name: 'Detroit Tigers' }, score: 4, isWinner: true },
      away: { team: { id: 145, name: 'Chicago White Sox' }, score: 1, isWinner: false },
    },
  })

  it('reads the club side and keeps a doubleheader in order', () => {
    const games = parseTeamSchedule({ dates: [{ date: '2026-09-27', games: [game(2, 2), game(1, 1)] }] }, 116)
    expect(games.map(g => g.gamePk)).toEqual([1, 2])
    expect(games[0]).toMatchObject({ isHome: true, state: 'final', teamScore: 4, opponentScore: 1, isWin: true })
  })

  it('is empty for a window with no games, which is all of the winter', () => {
    expect(parseTeamSchedule({ dates: [] }, 116)).toEqual([])
  })
})

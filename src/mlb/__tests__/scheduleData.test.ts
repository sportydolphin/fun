import { describe, it, expect } from 'vitest'
import { calendarCell, monthRecord, monthWeeks, openingMonth, parseTeamSchedule, scheduleMonths, type ScheduleGame } from '../views/scheduleData'

type Cell = Parameters<typeof calendarCell>[0]
const cell = (over: Partial<Cell>): Cell => ({ state: 'final', gameTime: '7:05 PM', teamScore: 4, opponentScore: 2, isWin: true, ...over })

// The Full schedule sheet is one month of a 170-game season at a time, so it has to open on the right
// month, keep its height from month to month, and fit in a seventh of a phone.
describe('the season calendar', () => {
  it('lists the months with a game, in order', () => {
    expect(scheduleMonths([{ date: '2026-04-02' }, { date: '2026-03-26' }, { date: '2026-04-30' }])).toEqual(['2026-03', '2026-04'])
  })

  it('opens on the next game, and on the last one once there is no next', () => {
    const games = [{ date: '2026-08-31', state: 'final' }, { date: '2026-09-02', state: 'preview' }] as Pick<ScheduleGame, 'date' | 'state'>[]
    expect(openingMonth(games, '2026-09-01')).toBe('2026-09')
    expect(openingMonth(games, '2026-08-15')).toBe('2026-09')
    expect(openingMonth([games[0]], '2026-11-01')).toBe('2026-08')
  })

  it('draws six weeks whatever the month, each day on its weekday', () => {
    const feb = monthWeeks('2026-02')   // a Sunday the 1st, four weeks long
    const aug = monthWeeks('2026-08')   // a Saturday the 1st, six weeks long
    expect(feb).toHaveLength(42)
    expect(aug).toHaveLength(42)
    expect(feb[0]).toBe('2026-02-01')
    expect(aug[6]).toBe('2026-08-01')
    expect(aug.filter(Boolean)).toHaveLength(31)
    expect(aug[36]).toBe('2026-08-31')
  })

  it('counts only the decided games in a record', () => {
    const g = (state: ScheduleGame['state'], isWin: boolean | null) => ({ state, isWin })
    expect(monthRecord([g('final', true), g('final', false), g('final', true), g('preview', null)])).toBe('2–1')
    expect(monthRecord([g('preview', null)])).toBeNull()
  })

  it('prints a result by its score and tone, with the words for a screen reader', () => {
    expect(calendarCell(cell({}))).toEqual({ text: '4–2', label: 'won 4–2', tone: 'win' })
    expect(calendarCell(cell({ isWin: false, teamScore: 2, opponentScore: 4 }))).toEqual({ text: '2–4', label: 'lost 2–4', tone: 'loss' })
    expect(calendarCell(cell({ state: 'live', isWin: null })).tone).toBe('live')
  })

  it('drops the meridiem from a time and shortens a game not played', () => {
    expect(calendarCell(cell({ state: 'preview', teamScore: null, opponentScore: null, isWin: null })).text).toBe('7:05')
    expect(calendarCell(cell({ state: 'postponed', unplayed: 'Postponed' })).text).toBe('PPD')
    expect(calendarCell(cell({ state: 'postponed', unplayed: 'Cancelled' })).text).toBe('CNCL')
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

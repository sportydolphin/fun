import { describe, it, expect } from 'vitest'
import { phaseOn, hasGamesLeft, jobDueOn, mlbJobDue, addDaysISO } from '../../../shared/mlbSeason.js'
import { isSeasonOver } from '../seasonPhase'
import { isUnplayed } from '../gameStatus'
import { displaySeasonOn } from '../constants'

// The league's 2026 calendar, as /seasons/2026 publishes it.
const D2026 = { regularSeasonStart: '2026-03-25', regularSeasonEnd: '2026-09-27', postSeasonEnd: '2026-10-31' }

describe('season phase', () => {
  it('follows the league calendar', () => {
    expect(phaseOn(D2026, '2026-03-01')).toBe('preseason')
    expect(phaseOn(D2026, '2026-03-25')).toBe('regular')
    expect(phaseOn(D2026, '2026-09-27')).toBe('regular')
    expect(phaseOn(D2026, '2026-09-28')).toBe('postseason')
    expect(phaseOn(D2026, '2026-10-31')).toBe('postseason')
    expect(phaseOn(D2026, '2026-11-01')).toBe('offseason')
  })

  it('stays in the regular season while a makeup game is still to be played', () => {
    expect(phaseOn(D2026, '2026-09-28', true)).toBe('regular')
    expect(isSeasonOver(phaseOn(D2026, '2026-09-28', true))).toBe(false)
  })

  it('counts a game still to come, but never a postponed or cancelled one', () => {
    const day = (...states: object[]) => ({ dates: [{ games: states.map(status => ({ status })) }] })
    expect(hasGamesLeft(day({ abstractGameState: 'Final' }))).toBe(false)
    // Sep 27, 2026's rained-out game was cancelled, not rescheduled, and must not hold October back.
    expect(hasGamesLeft(day({ abstractGameState: 'Final', codedGameState: 'C', detailedState: 'Cancelled' }))).toBe(false)
    expect(hasGamesLeft(day({ abstractGameState: 'Final', codedGameState: 'D', detailedState: 'Postponed' }))).toBe(false)
    expect(hasGamesLeft(day({ abstractGameState: 'Preview', detailedState: 'Scheduled' }))).toBe(true)
    expect(hasGamesLeft(day({ abstractGameState: 'Live', detailedState: 'In Progress' }))).toBe(true)
    expect(hasGamesLeft({})).toBe(false)
  })

  it('agrees with gameStatus.ts on what was never played', () => {
    // shared/ cannot import the site's TypeScript, so it carries its own copy of the test.
    for (const status of [
      { codedGameState: 'D' }, { codedGameState: 'C' }, { detailedState: 'Postponed' },
      { detailedState: 'Cancelled' }, { codedGameState: 'F', detailedState: 'Final' }, {},
    ]) {
      const left = hasGamesLeft({ dates: [{ games: [{ status: { ...status, abstractGameState: 'Preview' } }] }] })
      expect(left).toBe(!isUnplayed(status))
    }
  })

  it('is over in the postseason and the winter, and not before', () => {
    expect(isSeasonOver('postseason')).toBe(true)
    expect(isSeasonOver('offseason')).toBe(true)
    expect(isSeasonOver('regular')).toBe(false)
    expect(isSeasonOver('preseason')).toBe(false)
  })
})

describe('when the MLB jobs have work', () => {
  it('runs the game jobs from the day before opening day to two days past the World Series', () => {
    expect(jobDueOn('games', D2026, '2026-03-23')).toBe(false)
    expect(jobDueOn('games', D2026, '2026-03-24')).toBe(true)
    expect(jobDueOn('games', D2026, '2026-10-01')).toBe(true)     // the postseason is games too
    expect(jobDueOn('games', D2026, '2026-11-02')).toBe(true)     // the resolvers grade the last night
    expect(jobDueOn('games', D2026, '2026-11-03')).toBe(false)
    expect(jobDueOn('games', D2026, '2026-12-25')).toBe(false)
  })

  it('runs the regular-season boards to two days past the last game, longer for a makeup', () => {
    expect(jobDueOn('regular', D2026, '2026-03-24')).toBe(false)
    expect(jobDueOn('regular', D2026, '2026-03-25')).toBe(true)
    expect(jobDueOn('regular', D2026, '2026-09-29')).toBe(true)
    expect(jobDueOn('regular', D2026, '2026-09-30')).toBe(false)
    expect(jobDueOn('regular', D2026, '2026-09-30', true)).toBe(true)
  })

  it('adds days across a month and a year', () => {
    expect(addDaysISO('2026-10-31', 2)).toBe('2026-11-02')
    expect(addDaysISO('2027-01-01', -1)).toBe('2026-12-31')
  })

  const fakeFetch = (calendar: object | null, schedule: object = {}) => async (url: string) => ({
    ok: calendar != null,
    json: async () => (url.includes('/seasons/') ? { seasons: [calendar] } : schedule),
  })
  const cal = { regularSeasonStartDate: '2026-03-25', regularSeasonEndDate: '2026-09-27', postSeasonEndDate: '2026-10-31' }

  it('reads the calendar for the year it is asked on, so January needs no special case', async () => {
    const cal27 = { regularSeasonStartDate: '2027-03-25', regularSeasonEndDate: '2027-09-26', postSeasonEndDate: '2027-10-30' }
    expect((await mlbJobDue('games', new Date('2027-01-15T12:00:00Z'), fakeFetch(cal27))).due).toBe(false)
    expect((await mlbJobDue('games', new Date('2026-12-15T12:00:00Z'), fakeFetch(cal))).due).toBe(false)
    expect((await mlbJobDue('games', new Date('2026-10-01T12:00:00Z'), fakeFetch(cal))).due).toBe(true)
  })

  it('keeps the boards running while a makeup is left, and stops them once none is', async () => {
    const left = { dates: [{ games: [{ status: { abstractGameState: 'Preview' } }] }] }
    expect((await mlbJobDue('regular', new Date('2026-10-01T12:00:00Z'), fakeFetch(cal, left))).due).toBe(true)
    expect((await mlbJobDue('regular', new Date('2026-10-01T12:00:00Z'), fakeFetch(cal, {}))).due).toBe(false)
  })

  it('runs when the calendar cannot be read', async () => {
    const r = await mlbJobDue('regular', new Date('2026-12-15T12:00:00Z'), fakeFetch(null))
    expect(r.due).toBe(true)
    expect(r.reason).toMatch(/could not read/)
  })
})

describe('the season the section shows', () => {
  const at = (iso: string) => new Date(`${iso}T12:00:00`)

  it('stays on last season from Jan 1 until the new one opens', () => {
    expect(displaySeasonOn(at('2026-12-31'), null)).toBe(2026)
    expect(displaySeasonOn(at('2027-01-01'), null)).toBe(2026)
    expect(displaySeasonOn(at('2027-03-24'), '2027-03-25')).toBe(2026)
    expect(displaySeasonOn(at('2027-03-25'), '2027-03-25')).toBe(2027)
  })

  it('uses Mar 20 when no opening day has been remembered', () => {
    expect(displaySeasonOn(at('2027-03-19'), null)).toBe(2026)
    expect(displaySeasonOn(at('2027-03-20'), null)).toBe(2027)
  })

  it('takes a late opening day at its word (2022 opened Apr 7 after the lockout)', () => {
    expect(displaySeasonOn(at('2022-04-01'), '2022-04-07')).toBe(2021)
  })
})

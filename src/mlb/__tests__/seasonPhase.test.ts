import { describe, it, expect } from 'vitest'
import { phaseOn, hasRegularGamesLeft, isSeasonOver } from '../seasonPhase'

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
    expect(hasRegularGamesLeft(day({ abstractGameState: 'Final' }))).toBe(false)
    // Sep 27, 2026's rained-out game was cancelled, not rescheduled, and must not hold October back.
    expect(hasRegularGamesLeft(day({ abstractGameState: 'Final', codedGameState: 'C', detailedState: 'Cancelled' }))).toBe(false)
    expect(hasRegularGamesLeft(day({ abstractGameState: 'Final', codedGameState: 'D', detailedState: 'Postponed' }))).toBe(false)
    expect(hasRegularGamesLeft(day({ abstractGameState: 'Preview', detailedState: 'Scheduled' }))).toBe(true)
    expect(hasRegularGamesLeft(day({ abstractGameState: 'Live', detailedState: 'In Progress' }))).toBe(true)
    expect(hasRegularGamesLeft({})).toBe(false)
  })

  it('is over in the postseason and the winter, and not before', () => {
    expect(isSeasonOver('postseason')).toBe(true)
    expect(isSeasonOver('offseason')).toBe(true)
    expect(isSeasonOver('regular')).toBe(false)
    expect(isSeasonOver('preseason')).toBe(false)
  })
})

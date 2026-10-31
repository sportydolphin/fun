import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { buildCostPerWinRows, buildWinChangeRows } from '../components/reportCardRows'
import { cardMoves, moveSummary } from '../lib/rosterMoves'
import type { RosterMove } from '../api'
import type { StandingsDivision } from '../types'

// What Home's winter cards read: the new boards, the Hot Stove's order, the team card's line, and the
// games card with a reader signed in.

vi.mock('../../AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'reader@example.com' } }) }))
vi.mock('../seasonPhase', () => ({ fetchNextOpeningDay: async () => '2027-03-25', longDay: () => 'March 25' }))
vi.mock('../views/survivorData', async importOriginal => ({
  ...(await importOriginal<object>()),
  fetchMyStats: async () => ({ currentStreak: 0, longestStreak: 14, totalHits: 60, totalPicks: 90 }),
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: table === 'prediction_stats' ? { correct_predictions: 300, total_predictions: 500 } : { username: 'reader' } }),
        }),
      }),
    }),
  },
}))

const div = (teams: [number, string, number, number][]): StandingsDivision => ({
  divisionId: 1, divisionName: 'AL East', leagueId: 103,
  teams: teams.map(([teamId, abbr, wins, losses]) => ({ teamId, abbr, wins, losses, divisionRank: 1 })),
} as unknown as StandingsDivision)
const names = new Map([[116, 'Tigers'], [158, 'Brewers'], [119, 'Dodgers']])

describe('the boards that need a finished season', () => {
  const now = [div([[116, 'DET', 76, 86], [158, 'MIL', 103, 59], [119, 'LAD', 90, 72]])]
  const before = [div([[116, 'DET', 86, 76], [158, 'MIL', 97, 65], [119, 'LAD', 90, 72]])]

  it('ranks wins against last season, leaving out a club that did not move', () => {
    expect(buildWinChangeRows(now, before, names, 'up').map(r => [r.abbr, r.value])).toEqual([['MIL', '+6 wins']])
    expect(buildWinChangeRows(now, before, names, 'down').map(r => [r.abbr, r.value])).toEqual([['DET', '−10 wins']])
  })

  it('prices a win from the payroll', () => {
    const pay = { 116: 152, 158: 103, 119: 360 }
    expect(buildCostPerWinRows(now, pay, names, 'cheapest').map(r => [r.abbr, r.value])).toEqual([['MIL', '$1.0M'], ['DET', '$2.0M'], ['LAD', '$4.0M']])
    expect(buildCostPerWinRows(now, pay, names, 'priciest')[0].abbr).toBe('LAD')
  })
})

const move = (over: Partial<RosterMove>): RosterMove => ({
  id: 1, playerId: 1, playerName: 'A', fromTeamId: null, toTeamId: null, date: '2026-11-10', typeCode: 'DES', typeDesc: '', description: '', ...over,
})

describe('the Hot Stove card', () => {
  it("leads the week's moves with signings and trades, whatever came in later", () => {
    const moves = [
      move({ id: 1, typeCode: 'REL', fromTeamId: 111, date: '2026-11-10' }),
      move({ id: 2, typeCode: 'SFA', toTeamId: 147, date: '2026-11-08' }),
      move({ id: 3, typeCode: 'CLW', toTeamId: 121, date: '2026-11-09' }),
    ]
    expect(cardMoves(moves, true, null).map(m => m.typeCode)).toEqual(['SFA', 'CLW', 'REL'])
  })

  it('never lets an old signing outrank this week', () => {
    const moves = [
      move({ id: 1, typeCode: 'DES', fromTeamId: 111, date: '2026-11-10' }),
      move({ id: 2, typeCode: 'SFA', toTeamId: 147, date: '2026-10-20' }),
    ]
    expect(cardMoves(moves, true, null).map(m => m.id)).toEqual([1, 2])
  })

  it("leads a kind with the followed club's", () => {
    const moves = [
      move({ id: 1, typeCode: 'SFA', toTeamId: 147 }),
      move({ id: 2, typeCode: 'SFA', toTeamId: 116 }),
    ]
    expect(cardMoves(moves, true, 116).map(m => m.id)).toEqual([2, 1])
  })

  it('stays in date order in season', () => {
    const moves = [move({ id: 1, typeCode: 'REL' }), move({ id: 2, typeCode: 'SFA' })]
    expect(cardMoves(moves, false, null)).toBe(moves)
  })
})

describe('moveSummary', () => {
  it('counts the two commonest kinds, a trade once whichever players it moved', () => {
    const moves = [
      move({ id: 1, typeCode: 'DFA', fromTeamId: 116, playerId: 1 }), move({ id: 2, typeCode: 'DFA', fromTeamId: 116, playerId: 2 }),
      move({ id: 3, typeCode: 'DFA', fromTeamId: 116, playerId: 3 }),
      move({ id: 4, typeCode: 'TR', fromTeamId: 116, toTeamId: 111, playerId: 4 }), move({ id: 4, typeCode: 'TR', fromTeamId: 111, toTeamId: 116, playerId: 5 }),
      move({ id: 5, typeCode: 'REL', fromTeamId: 116, playerId: 6 }),
    ]
    expect(moveSummary(moves, 116)).toBe('3 free agents · 1 trade')
  })

  it('leaves out other clubs, and is null with nothing', () => {
    expect(moveSummary([move({ typeCode: 'SFA', toTeamId: 147 })], 116)).toBeNull()
  })
})

describe('the games card, signed in', () => {
  it("shows the reader's record and best streak beside the date", async () => {
    const { WinterGamesCard } = await import('../views/WinterGames')
    render(<WinterGamesCard />)
    await waitFor(() => expect(screen.getByText(/300–200 · 60%/)).toBeTruthy())
    expect(screen.getByText(/Best 14/)).toBeTruthy()
    expect(screen.getByText(/Opening Day · March 25/)).toBeTruthy()
  })
})

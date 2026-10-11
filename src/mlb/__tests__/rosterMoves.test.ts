import { describe, it, expect } from 'vitest'
import { cardMoves, moveWindowDays, pickMoves } from '../lib/rosterMoves'
import { BAL, BOS, CHC } from '../constants'

// Shaped like StatsAPI's /transactions rows from Nov 2025, which is what the winter mode was
// measured against. A minor-league affiliate's id is not in TEAM_ABBR.
const AFFILIATE = 4124
const row = (id: number, typeCode: string, description: string, from: number | null, to: number | null, date = '2025-11-20', person = id) => ({
  id, typeCode, typeDesc: typeCode, date, description,
  person: { id: person, fullName: `Player ${person}` },
  ...(from ? { fromTeam: { id: from } } : {}), ...(to ? { toTeam: { id: to } } : {}),
})

const feed = [
  row(1, 'SFA', 'Baltimore Orioles signed free agent OF A.', null, BAL),
  row(2, 'SFA', 'Chicago Cubs signed free agent RHP B. to a minor league contract.', null, CHC),
  row(3, 'DFA', 'RHP C. elected free agency.', BOS, null),
  row(4, 'R5', 'Chicago Cubs selected RHP D. in the Rule 5 draft.', BAL, CHC),
  row(5, 'TR', 'Boston Red Sox traded E. to Baltimore Orioles for F.', BOS, BAL, '2025-11-20', 50),
  row(5, 'TR', 'Boston Red Sox traded E. to Baltimore Orioles for F.', BAL, BOS, '2025-11-20', 51),
  row(6, 'SC', 'Status change.', null, BOS),
  row(7, 'DES', 'Designated for assignment.', AFFILIATE, null),
]

describe('roster moves', () => {
  // Over Nov 1 to Dec 15, 2025, 234 of 279 signings were minor-league deals.
  it('never shows a minor-league contract, in either mode', () => {
    for (const hotStove of [false, true]) {
      expect(pickMoves(feed, hotStove).map(m => m.id)).not.toContain(2)
    }
  })

  it('adds free agency and Rule 5 only in the winter', () => {
    expect(pickMoves(feed, false).map(m => m.typeCode).sort()).toEqual(['SFA', 'TR', 'TR'])
    expect(pickMoves(feed, true).map(m => m.typeCode).sort()).toEqual(['DFA', 'R5', 'SFA', 'TR', 'TR'])
  })

  it('keeps both sides of a trade, puts trades first on a day, and drops minor-league-only moves', () => {
    const moves = pickMoves(feed, true)
    expect(moves.slice(0, 2).map(m => m.playerId)).toEqual([50, 51])
    expect(moves.map(m => m.id)).not.toContain(7)
  })

  // A whole free-agent class declares the day after the World Series; on the card only the
  // followed club's leavers survive, so signings and trades still reach it.
  it('leaves the free-agent class off the card except for the followed club', () => {
    const moves = pickMoves(feed, true)
    expect(cardMoves(moves, true, null).map(m => m.typeCode)).not.toContain('DFA')
    expect(cardMoves(moves, true, BOS).map(m => m.typeCode)).toContain('DFA')
    expect(cardMoves(moves, false, null)).toBe(moves)
  })

  it('reads a longer window in the winter', () => {
    expect(moveWindowDays(false)).toBe(14)
    expect(moveWindowDays(true)).toBe(30)
  })
})

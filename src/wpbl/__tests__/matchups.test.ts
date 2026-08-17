import { describe, it, expect } from 'vitest'
import { headToHead } from '../derive/matchups'
import type { WpblGame } from '../types'

// `headToHead` backs the four-by-four grid on the Teams tab. It is asymmetric by design,
// since get(a, b) and get(b, a) are two different cells, and it has to agree with computeStandings
// on which games count, so both halves are worth pinning down.

let seq = 0
function game(home: string, away: string, homeScore: number | null, awayScore: number | null,
              status: WpblGame['status'] = 'final'): WpblGame {
  return {
    id: `g${seq++}`,
    game_date: '2026-08-10',
    start_time: '6:30 PM',
    home_team_id: home,
    away_team_id: away,
    venue: null,
    status,
    home_score: homeScore,
    away_score: awayScore,
    innings: 7,
    notes: null,
    created_at: '',
    updated_at: '',
  }
}

describe('headToHead', () => {
  it('records a decisive final from both sides', () => {
    const g = headToHead([game('A', 'B', 6, 2)])
    expect(g.get('A', 'B')).toEqual({ wins: 1, losses: 0, runsFor: 6, runsAgainst: 2 })
    expect(g.get('B', 'A')).toEqual({ wins: 0, losses: 1, runsFor: 2, runsAgainst: 6 })
  })

  it('credits the away team when it wins', () => {
    const g = headToHead([game('A', 'B', 1, 4)])
    expect(g.get('A', 'B')).toMatchObject({ wins: 0, losses: 1 })
    expect(g.get('B', 'A')).toMatchObject({ wins: 1, losses: 0 })
  })

  it('accumulates a series across meetings, either side of the ledger', () => {
    const g = headToHead([
      game('A', 'B', 5, 1),
      game('B', 'A', 3, 2),
      game('A', 'B', 7, 0),
    ])
    expect(g.get('A', 'B')).toEqual({ wins: 2, losses: 1, runsFor: 14, runsAgainst: 4 })
    expect(g.get('B', 'A')).toEqual({ wins: 1, losses: 2, runsFor: 4, runsAgainst: 14 })
  })

  it('returns null for a pairing that has not met, and for the diagonal', () => {
    const g = headToHead([game('A', 'B', 6, 2)])
    expect(g.get('A', 'C')).toBeNull()
    expect(g.get('A', 'A')).toBeNull()
  })

  // Same exclusions computeStandings applies, so the grid can never disagree with the
  // records on the cards directly above it.
  it('ignores anything that is not a decisive final', () => {
    const g = headToHead([
      game('A', 'B', 4, 4),                    // tie, no winner to credit
      game('A', 'B', null, null, 'scheduled'), // not played
      game('A', 'B', 3, 1, 'live'),            // in progress
      game('A', 'B', null, 2),                 // half-ingested row
    ])
    expect(g.get('A', 'B')).toBeNull()
  })
})

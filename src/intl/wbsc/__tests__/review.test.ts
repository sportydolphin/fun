import { describe, expect, it } from 'vitest'
import { countryAgrees, reviewGroup, wbscRecord } from '../review'

// Synthetic ids and places only; the real rows stay on the machine that imported them.

describe('countryAgrees', () => {
  it('reads the country off the end of the hometown', () => {
    expect(countryAgrees('CAN', 'Smalltown, Ontario, Canada')).toBe('same')
    expect(countryAgrees('USA', 'Anytown, Ohio, USA')).toBe('same')
    expect(countryAgrees('KOR', 'Seoul, South Korea')).toBe('same')
  })
  it('flags a different country without calling it wrong', () => {
    expect(countryAgrees('MEX', 'Anytown, Arizona, USA')).toBe('differs')
  })
  it('is unknown when a fact is missing', () => {
    expect(countryAgrees('ZZZ', 'Anytown, Canada')).toBe('unknown')
    expect(countryAgrees('CAN', null)).toBe('unknown')
    expect(countryAgrees(null, 'Anytown, Canada')).toBe('unknown')
  })
})

describe('wbscRecord', () => {
  const batting = [
    { player_id: 'a', game_id: 'g2', pa: 3, position: 'CF' },
    { player_id: 'a', game_id: 'g1', pa: 4, position: 'PH/LF' },
    { player_id: 'a', game_id: 'g3', pa: 2, position: 'CF' },
    { player_id: 'b', game_id: 'g1', pa: 4, position: 'SS' },
  ]
  const pitching = [{ player_id: 'a', game_id: 'g4', outs: 7 }]

  it('counts games from both sides, and every position played', () => {
    expect(wbscRecord('a', batting, pitching)).toEqual({
      games: 4, pa: 9, outs: 7, positions: ['CF', 'LF', 'PH', 'P'], first_game: 'g1',
    })
  })
  it('is empty for a player with no lines', () => {
    expect(wbscRecord('z', batting, pitching)).toEqual({ games: 0, pa: 0, outs: 0, positions: [], first_game: null })
  })
})

describe('reviewGroup', () => {
  const base = { ambiguous: false, match: 'name' as const, wbsc_team: 'CAN', wpbl_hometown: 'Anytown, Canada' }
  it('sorts the candidates by how hard to look', () => {
    expect(reviewGroup(base)).toBe('clear')
    expect(reviewGroup({ ...base, match: 'initial' })).toBe('check')
    expect(reviewGroup({ ...base, wpbl_hometown: 'Anytown, Ohio, USA' })).toBe('check')
    expect(reviewGroup({ ...base, wpbl_hometown: null })).toBe('check')
    expect(reviewGroup({ ...base, ambiguous: true })).toBe('conflict')
  })
})

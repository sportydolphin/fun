import { describe, expect, it } from 'vitest'
import { fuzzyMatches, fuzzyNameScore } from '../fuzzyName'
import { matchesClubNickname } from '../../mlb/clubNicknames'

const PLAYERS = ['Kelsie Whitmore', 'Diana Ibarra', 'Shohei Ohtani', 'Freddie Freeman', 'Pierson Ohl', 'José Ramírez']

describe('fuzzyNameScore', () => {
  it('forgives a slip, a swap and a name still being typed', () => {
    expect(fuzzyMatches(PLAYERS, 'whitmor', n => [n])).toEqual(['Kelsie Whitmore'])
    expect(fuzzyMatches(PLAYERS, 'ohatni', n => [n])).toEqual(['Shohei Ohtani'])
    expect(fuzzyMatches(PLAYERS, 'freddy freman', n => [n])).toEqual(['Freddie Freeman'])
    expect(fuzzyMatches(PLAYERS, 'jose ramires', n => [n])).toEqual(['José Ramírez'])
  })

  it('wants a short word exact, and every word typed to land on the name', () => {
    expect(fuzzyNameScore('Pierson Ohl', 'oxl')).toBe(0)
    expect(fuzzyNameScore('Kelsie Whitmore', 'kelsie ibarra')).toBe(0)
    expect(fuzzyMatches(PLAYERS, 'zzyzx', n => [n])).toEqual([])
  })
})

describe('matchesClubNickname', () => {
  it('reads a nickname whole, or its start from three letters', () => {
    expect(matchesClubNickname(138, 'Cards')).toBe(true)
    expect(matchesClubNickname(141, 'jay')).toBe(true)
    expect(matchesClubNickname(133, "A's")).toBe(true)
    // Two letters only whole, so "o" on the way to "Orioles" is not taken for "O's".
    expect(matchesClubNickname(110, 'o')).toBe(false)
    expect(matchesClubNickname(119, 'cards')).toBe(false)
  })
})

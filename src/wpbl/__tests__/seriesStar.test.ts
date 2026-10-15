import { describe, it, expect } from 'vitest'
import { seriesStar } from '../derive/seriesStar'
import type { WpblBattingLine, WpblPitchingLine } from '../types'

// The Star of the final on the offseason Home. What this pins: it sums a player's games on Game
// Center's own star scale, and it never names a player from the club that lost the final, however
// big their series was.

let seq = 0
const bat = (player_id: string, team_id: string, over: Partial<WpblBattingLine> = {}): WpblBattingLine => ({
  id: `b${++seq}`, game_id: `g${seq}`, player_id, team_id, batting_order: 1, position: 'CF',
  ab: 4, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0, hbp: 0,
  sb: 0, cs: 0, sf: 0, sh: 0, ibb: 0, gdp: 0, tb: 0, lob: 0, sub_out: false,
  ...over,
} as WpblBattingLine)

const pitch = (player_id: string, team_id: string, over: Partial<WpblPitchingLine> = {}): WpblPitchingLine => ({
  id: `p${++seq}`, game_id: `g${seq}`, player_id, team_id, outs: 0, bf: 0, h: 0, r: 0, er: 0, bb: 0,
  so: 0, hr: 0, pitches: 0, decision: null, gs: false, hbp: 0, ibb: 0, wp: 0, bk: 0, strikes: 0,
  doubles: 0, triples: 0,
  ...over,
} as WpblPitchingLine)

describe('seriesStar', () => {
  it('sums a player across games and words the series line like Game Center', () => {
    const star = seriesStar('LA', [
      bat('a', 'LA', { h: 2, tb: 5, hr: 1, rbi: 3, r: 1 }),
      bat('a', 'LA', { h: 1, tb: 1, rbi: 1 }),
      bat('b', 'LA', { h: 2, tb: 2 }),
    ], [])
    expect(star).toEqual({ playerId: 'a', kind: 'bat', statline: '3-8, 1 HR, 4 RBI', games: 2 })
  })

  it('ranks pitchers on the same scale and can pick one', () => {
    const star = seriesStar('LA', [bat('a', 'LA', { h: 1, tb: 1 })], [
      pitch('p', 'LA', { outs: 21, so: 9, decision: 'W' }),
    ])
    expect(star?.playerId).toBe('p')
    expect(star?.kind).toBe('pitch')
    expect(star?.statline).toBe('7.0 IP, 9 K, 0 ER')
  })

  it('never names a player from the club that lost', () => {
    const star = seriesStar('LA', [
      bat('loser', 'SF', { h: 4, tb: 12, hr: 3, rbi: 8, r: 3 }),
      bat('a', 'LA', { h: 1, tb: 1 }),
    ], [])
    expect(star?.playerId).toBe('a')
  })

  it('names nobody when the champion has no positive line', () => {
    expect(seriesStar('LA', [bat('a', 'LA')], [])).toBeNull()
    expect(seriesStar('LA', [], [])).toBeNull()
  })
})

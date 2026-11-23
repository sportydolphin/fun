import { describe, expect, it } from 'vitest'
import { parseBigPlay } from '../searchBigPlays'

// The Nov 20, 2026 probe: "highest wpa play" and "biggest play" found a World Cup name, or nothing.
describe('parseBigPlay', () => {
  it('reads the kind, and a club, a player or a year beside it', () => {
    expect(parseBigPlay('biggest play')).toEqual({ kind: 'play', season: null })
    expect(parseBigPlay('highest wpa play')).toEqual({ kind: 'play', season: null })
    expect(parseBigPlay('biggest hit of 2026')).toEqual({ kind: 'hit', season: 2026 })
    expect(parseBigPlay('Hunters biggest hit')).toEqual({ kind: 'hit', season: null, teamId: 'BOS' })
    expect(parseBigPlay("Whitmore's biggest hit")).toEqual({ kind: 'hit', season: null, who: 'whitmore' })
    expect(parseBigPlay('Sato biggest strikeout')).toEqual({ kind: 'strikeout', season: null, who: 'sato' })
    expect(parseBigPlay('highest leverage at-bats')).toEqual({ kind: 'leverage', season: null })
  })
  it('leaves other questions alone', () => {
    for (const t of ['biggest innings', 'most hr', 'leverage', 'whitmore']) expect(parseBigPlay(t), t).toBeNull()
  })
})

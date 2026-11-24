import { describe, expect, it } from 'vitest'
import { playerSplits, splitRates } from '../derive/splits'
import type { PlateAppearanceLine } from '../../league/inningLines'

const pa = (over: Partial<PlateAppearanceLine>): PlateAppearanceLine => ({
  id: 'g|1', game_id: 'g', sequence: 1, inning: 1, half: 'top', batter_id: 'b', pitcher_id: 'p',
  batting_team: 'a', fielding_team: 'h', event: null, paouts: 0, on: 0, risp: 0, balls: 0, scount: 0,
  pitches: 1, strikes: 1, fouls: 0, h: 0, doubles: 0, triples: 0, hr: 0, tb: 0, bb: 0, so: 0, hbp: 0,
  runs: 0, rbi: 0, walkoff: 0, hrrow: 0, krow: 0, retired: 0, ...over,
})
const hands: Record<string, { bats?: string; throws?: string }> = {
  b: { bats: 'L' }, s: { bats: 'S' }, p: { throws: 'R' }, q: { throws: 'L' },
}
const handOf = (id: string | null, k: 'bats' | 'throws') => (id ? hands[id]?.[k] ?? null : null)
const row = (groups: ReturnType<typeof playerSplits>, g: string, r: string) =>
  groups.find(x => x.key === g)!.rows.find(x => x.key === r)!.line

describe('playerSplits', () => {
  it('files a hitter by the pitcher’s arm and a pitcher by where the batter stood', () => {
    const lines = [pa({ pitcher_id: 'p', h: 1, tb: 1 }), pa({ pitcher_id: 'q' }), pa({ batter_id: 's', pitcher_id: 'p' })]
    const bat = playerSplits('batting', lines.slice(0, 2), handOf)
    expect(row(bat, 'hand', 'vr')).toMatchObject({ pa: 1, h: 1 })
    expect(row(bat, 'hand', 'vl')).toMatchObject({ pa: 1, h: 0 })
    // A switch hitter against a righty bats left.
    const pit = playerSplits('pitching', [lines[2]], handOf)
    expect(row(pit, 'hand', 'vl').pa).toBe(1)
    expect(row(pit, 'hand', 'vr').pa).toBe(0)
  })

  it('takes walks, hit batters and sacrifices out of at-bats', () => {
    const s = row(playerSplits('batting', [pa({ bb: 1 }), pa({ hbp: 1 }), pa({ sf: 1 }), pa({ sh: 1 }), pa({ so: 1 })], handOf), 'situation', 'empty')
    expect(s).toMatchObject({ pa: 5, ab: 1, bb: 1, hbp: 1, sf: 1, so: 1 })
    expect(splitRates(s).obp).toBeCloseTo(2 / 4)
  })

  it('reads the count the plate appearance ended in, and skips one with no pitches', () => {
    const g = playerSplits('batting', [
      pa({ balls: 0, scount: 0, pitches: 1 }),
      pa({ balls: 3, scount: 2, pitches: 7 }),
      pa({ balls: 2, scount: 1, pitches: 4 }),
      pa({ balls: 0, scount: 2, pitches: 3 }),
      pa({ pitches: 0 }),
    ], handOf)
    expect(row(g, 'count', 'first').pa).toBe(1)
    expect(row(g, 'count', 'full').pa).toBe(1)
    expect(row(g, 'count', 'ahead').pa).toBe(1)
    expect(row(g, 'count', 'behind').pa).toBe(1)
    expect(row(g, 'count', 'twok').pa).toBe(2)
  })

  it('puts extra innings with the 7th and lists only the lineup spots batted in', () => {
    const g = playerSplits('batting', [pa({ inning: 8 })], handOf, [
      { batting_order: 3, ab: 4, h: 2, doubles: 1, triples: 0, hr: 0, bb: 1, so: 0, hbp: 0, sf: 0, sh: 0 },
      { batting_order: 10, ab: 1, h: 0, doubles: 0, triples: 0, hr: 0, bb: 0, so: 0, hbp: 0, sf: 0, sh: 0 },
    ])
    expect(row(g, 'inning', 'i7').pa).toBe(1)
    const spots = g.find(x => x.key === 'spot')!.rows
    expect(spots.map(r => r.label)).toEqual(['Batting 3rd'])
    expect(spots[0].line).toMatchObject({ pa: 5, tb: 3 })
  })

  it('has no lineup group for a pitcher', () => {
    expect(playerSplits('pitching', [], handOf).map(g => g.key)).toEqual(['hand', 'situation', 'count', 'inning'])
  })
})

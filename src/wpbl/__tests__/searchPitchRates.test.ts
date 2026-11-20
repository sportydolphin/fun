import { describe, expect, it } from 'vitest'
import { parsePitchRateText, pitchRateRows } from '../searchPitchRates'
import type { PitchBoard, PitchProfile } from '../derive/pitches'
import type { WpblPlayer } from '../types'

// The Nov 20, 2026 request: "best whiff rate" and the Pitches board's other rates reached nothing.
describe('parsePitchRateText', () => {
  const read = (t: string) => { const a = parsePitchRateText(t); return a && { key: a.def.key, side: a.side, end: a.end, who: a.who, season: a.season } }
  it('reads each rate, the side it leans to and the end asked for', () => {
    expect(read('best whiff rate')).toEqual({ key: 'whiffPct', side: 'pitching', end: 'good', who: null, season: null })
    expect(read('lowest whiff rate hitters')).toEqual({ key: 'whiffPct', side: 'hitting', end: 'low', who: null, season: null })
    expect(read('contact rate leaders 2026')).toEqual({ key: 'contactPct', side: 'hitting', end: 'good', who: null, season: 2026 })
    expect(read('swstr%')).toMatchObject({ key: 'swStrPct' })
    expect(read('first pitch strike rate')).toMatchObject({ key: 'firstStrikePct', side: 'pitching' })
    expect(read('p/pa')).toMatchObject({ key: 'pitchesPerPa', side: 'hitting' })
  })
  it("reads a player's name beside it", () => {
    expect(read("Whitmore's whiff rate")).toMatchObject({ key: 'whiffPct', who: 'whitmore' })
    expect(read('where does Sato rank in putaway rate')).toMatchObject({ key: 'putawayPct', who: 'sato' })
  })
  it('leaves other questions alone', () => {
    for (const t of ['strike rate', 'strikeout rate', 'whitmore', 'most hr']) expect(parsePitchRateText(t), t).toBeNull()
  })
})

describe('pitchRateRows', () => {
  const player = (id: string, name: string) => ({ id, name } as WpblPlayer)
  const prof = (p: WpblPlayer | null, whiffPct: number, pitches: number, swings: number): PitchProfile =>
    ({ player: p, name: p?.name ?? 'League', teamId: null, pitches, pa: 10, swings, whiffPct, swStrPct: whiffPct / 2 } as unknown as PitchProfile)
  const a = player('a', 'Kelsie Whitmore'), b = player('b', 'Ayami Sato'), c = player('c', 'Short Sample')
  const board = {
    gameCount: 1, pitches: 300, pa: 80, league: prof(null, 0.15, 300, 100),
    pitchers: [prof(a, 0.20, 100, 40), prof(b, 0.30, 120, 45), prof(c, 0.50, 5, 2)], batters: [],
  } as unknown as PitchBoard
  const mins = { minPitcher: 50, minBatter: 50 }
  it('names the leader of the board, the short sample left out as the board leaves it', () => {
    expect(pitchRateRows(parsePitchRateText('best whiff rate')!, board, mins, 2026, [a, b, c])).toEqual([expect.objectContaining({
      title: 'Highest whiff rate', detail: 'Ayami Sato leads with 30.0% · 2026 · league 15.0%', href: '/wpbl/stats?board=pitches&side=pitching&season=2026',
    })])
  })
  it("gives a player's rate and place", () => {
    expect(pitchRateRows(parsePitchRateText('whitmore whiff rate')!, board, mins, 2026, [a, b, c])[0])
      .toMatchObject({ title: 'Kelsie Whitmore whiff rate', detail: '20.0% · 2026 · 2nd of 2 pitchers · league 15.0%' })
  })
})

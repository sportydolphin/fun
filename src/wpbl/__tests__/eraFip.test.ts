import { describe, it, expect } from 'vitest'
import { sumPitching, type WpblPitSeason } from '../stats'
import { eraFipGaps, ERA_FIP_MIN_GAP } from '../derive/eraFip'
import type { WpblPitchingLine, WpblGame, WpblPlayer } from '../types'

// The recap's ERA vs FIP boards. What they must get right: which side a pitcher lands on, that a
// small gap is not listed at all, and that the stated reason is the one the box score supports.

const G = 'g1'
const games: WpblGame[] = [{ id: G, game_type: 'regular', counts_in_standings: true } as WpblGame]
const w = { hr: 13 / 9, bb: 3 / 9, k: -2 / 9 }

const pit = (id: string, o: Partial<WpblPitchingLine>): WpblPitchingLine => ({
  id: `${id}-${Math.random()}`, game_id: G, player_id: id, team_id: 'SF',
  outs: 45, bf: 70, h: 15, r: 8, er: 8, bb: 5, so: 10, hr: 1, hbp: 0, pitches: 250, decision: null, ...o,
} as WpblPitchingLine)

const season = (line: WpblPitchingLine): WpblPitSeason =>
  ({ player: { id: line.player_id, name: line.player_id } as WpblPlayer, totals: sumPitching([line], games) })

// Unearned-heavy: 4 earned of 12, walks well over strikeouts, so ERA far below FIP.
const shielded = pit('shielded', { r: 12, er: 4, so: 3, bb: 12, hr: 3 })
// Strikes out a third of the batters and allows hits on half the balls in play: ERA far above FIP.
const bled = pit('bled', { r: 20, er: 20, so: 25, bb: 3, hr: 0, h: 22 })
// Middle of the league on everything.
const average = pit('average', {})
// Too few innings to qualify, however wild the numbers.
const cameo = pit('cameo', { outs: 6, r: 9, er: 9, so: 0, bb: 5 })

const lines = [shielded, bled, average, cameo]
const league = sumPitching(lines, games)
const seasons = lines.map(season)

describe('eraFipGaps', () => {
  const out = eraFipGaps(seasons, league, w, 36)!

  it('puts each pitcher on the side their ERA falls', () => {
    expect(out.eraLower.map(r => r.season.player.id)).toContain('shielded')
    expect(out.eraHigher.map(r => r.season.player.id)).toContain('bled')
  })

  it('leaves out anyone short of the innings bar', () => {
    const ids = [...out.eraLower, ...out.eraHigher].map(r => r.season.player.id)
    expect(ids).not.toContain('cameo')
  })

  it('lists no gap smaller than the minimum', () => {
    for (const r of [...out.eraLower, ...out.eraHigher]) expect(Math.abs(r.gap)).toBeGreaterThanOrEqual(ERA_FIP_MIN_GAP)
  })

  it('names unearned runs when they are a large share of the runs', () => {
    const r = out.eraLower.find(x => x.season.player.id === 'shielded')!
    expect(r.reason).toEqual({ kind: 'unearned', unearned: 8, runs: 12 })
  })

  it('names balls in play when they fell well above the league', () => {
    const r = out.eraHigher.find(x => x.season.player.id === 'bled')!
    expect(r.reason.kind).toBe('babip')
  })

  it('is null until the weights exist', () => {
    expect(eraFipGaps(seasons, league, null, 36)).toBeNull()
  })
})

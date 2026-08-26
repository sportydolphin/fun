import { describe, it, expect } from 'vitest'
import {
  sumPitching, scaleToBasis, kRateLabel, computeWpblTeamStats, ERA_BASIS_CANONICAL,
} from '../stats'
import { computeWpblPlayerRanks } from '../percentiles'
import type { WpblPitchingLine, WpblGame, WpblTeam, WpblPlayer } from '../types'

// The WPBL plays seven innings and the league publishes ERA per NINE anyway. We follow the
// league and let a reader opt out, which puts two things at risk that nothing else catches:
//
//   1. The STORED number drifting back to per 7. Everything that leaves the site (share cards,
//      the Discord bot) reads it directly and has no reader to ask, so a per-7 value in the
//      aggregate silently republishes a number that disagrees with the league.
//   2. A rescale reaching something it must not. Rescaling is display-only and both stats are
//      linear in the basis, so no sort, rank or comparison may move when the basis does. If
//      one ever does, a leaderboard and the player page it opens can disagree.

const G = 'g1'
const games: WpblGame[] = [{ id: G, game_type: 'regular', counts_in_standings: true } as WpblGame]

const pit = (o: Partial<WpblPitchingLine> = {}): WpblPitchingLine => ({
  id: Math.random().toString(36).slice(2), game_id: G, player_id: 'p1', team_id: 'SF',
  outs: 21, h: 5, r: 2, er: 2, bb: 1, so: 7, hr: 0, pitches: 90, decision: null, ...o,
} as WpblPitchingLine)

describe('the stored basis', () => {
  it('holds ERA per nine, which is what the league publishes', () => {
    // A complete WPBL game: 2 earned runs in seven innings. The league would print 2.57.
    const t = sumPitching([pit({ outs: 21, er: 2 })], games)
    expect(t.era).toBeCloseTo(2.571, 3)
    expect(t.k9).toBeCloseTo(9, 6)
  })

  it('says so in one constant, so nothing has to infer it', () => {
    expect(ERA_BASIS_CANONICAL).toBe(9)
  })
})

describe('scaleToBasis', () => {
  it('gives back the stored number on the league basis', () => {
    expect(scaleToBasis(2.571, 9)).toBeCloseTo(2.571, 6)
  })

  it('converts to the seven-inning figure a reader asking for per 7 expects', () => {
    // Same pitcher: 2 ER in 7 IP really is 2.00 per game, which is the whole argument for
    // per 7 and the reason the setting exists.
    const t = sumPitching([pit({ outs: 21, er: 2 })], games)
    expect(scaleToBasis(t.era, 7)).toBeCloseTo(2, 6)
  })

  it('passes null through rather than inventing a zero', () => {
    expect(scaleToBasis(null, 7)).toBeNull()
  })

  it('names the strikeout rate after its denominator, since ERA cannot', () => {
    expect(kRateLabel(9)).toBe('K/9')
    expect(kRateLabel(7)).toBe('K/7')
  })
})

// The invariant that makes display-time rescaling safe at all.
describe('changing the basis moves no ranking', () => {
  const teams = [{ id: 'SF' }, { id: 'BOS' }] as WpblTeam[]
  const players = [
    { id: 'ace', name: 'Ada Ace', team_id: 'SF' },
    { id: 'mid', name: 'Mira Mid', team_id: 'SF' },
    { id: 'bad', name: 'Bea Bad', team_id: 'BOS' },
  ] as WpblPlayer[]
  // Finals with both clubs named, because the qualifying bar scales with team games played
  // and an unplayed schedule leaves every strip empty for "the season is too young".
  const season: WpblGame[] = Array.from({ length: 6 }, (_, i) => ({
    id: `g${i}`, game_type: 'regular', counts_in_standings: true, status: 'final',
    home_team_id: 'SF', away_team_id: 'BOS',
  } as WpblGame))
  const lines = season.flatMap(g => [
    pit({ game_id: g.id, player_id: 'ace', team_id: 'SF', outs: 21, er: 1, h: 3, bb: 1, so: 9 }),
    pit({ game_id: g.id, player_id: 'mid', team_id: 'SF', outs: 21, er: 3, h: 6, bb: 2, so: 5 }),
    pit({ game_id: g.id, player_id: 'bad', team_id: 'BOS', outs: 21, er: 6, h: 9, bb: 4, so: 3 }),
  ])

  const ranksAt = (basis: 7 | 9) =>
    computeWpblPlayerRanks('mid', players, teams, season, [], lines, basis)

  it('leaves every player rank exactly where it was', () => {
    const nine = ranksAt(9).pitching.map(r => [r.key, r.rank, r.pct])
    const seven = ranksAt(7).pitching.map(r => [r.key, r.rank, r.pct])
    expect(seven).toEqual(nine)
  })

  it('changes only the printed figure, and only for the two rates that have a denominator', () => {
    const nine = new Map(ranksAt(9).pitching.map(r => [r.key, r.display]))
    const seven = new Map(ranksAt(7).pitching.map(r => [r.key, r.display]))
    // 3 ER in 7 IP: 3.86 per nine, 3.00 per seven.
    expect(nine.get('era')).toBe('3.86')
    expect(seven.get('era')).toBe('3.00')
    // WHIP and K/BB are per-inning and per-walk, so they have no basis to rescale.
    expect(seven.get('whip')).toBe(nine.get('whip'))
    expect(seven.get('kbb')).toBe(nine.get('kbb'))
  })

  it('reaches the four-club comparison too, ranks unmoved', () => {
    const nine = computeWpblTeamStats(teams, season, [], lines, 9)
    const seven = computeWpblTeamStats(teams, season, [], lines, 7)
    expect(seven.get('SF')!.era!.rank).toBe(nine.get('SF')!.era!.rank)
    expect(seven.get('SF')!.era!.display).not.toBe(nine.get('SF')!.era!.display)
  })

  it('defaults to the league basis when nobody passes one, so a bot cannot opt in by accident', () => {
    const explicit = computeWpblTeamStats(teams, season, [], lines, 9)
    const implied = computeWpblTeamStats(teams, season, [], lines)
    expect(implied.get('SF')!.era!.display).toBe(explicit.get('SF')!.era!.display)
  })
})

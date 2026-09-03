import { describe, it, expect } from 'vitest'
import {
  sumPitching, scaleToBasis, kRateLabel, computeWpblTeamStats, ERA_BASIS_CANONICAL,
} from '../stats'
import { computeWpblPlayerRanks } from '../percentiles'
import type { WpblPitchingLine, WpblGame, WpblTeam, WpblPlayer } from '../types'

// The WPBL plays seven innings and the league publishes ERA per SEVEN. It did not always: it
// published per 9 until early September 2026, this site followed it there, and on Sep 3, 2026
// its stat page was re-checked and had switched (all 38 pitchers and all 4 clubs matched per 7).
// We follow the league either way and let a reader opt out, which puts two things at risk that
// nothing else catches:
//
//   1. The STORED number drifting off the league's basis. Everything that leaves the site
//      (share cards, the Discord bot) reads it directly and has no reader to ask, so a value on
//      the wrong denominator silently republishes a figure that disagrees with the league.
//   2. A rescale reaching something it must not. Rescaling is display-only and both stats are
//      linear in the basis, so no sort, rank or comparison may move when the basis does. If
//      one ever does, a leaderboard and the player page it opens can disagree.
//
// Which number is canonical is the part that moved. The two hazards did not, and the six tests
// below that are not about the constant passed unchanged through the switch, which is the
// evidence that the mechanism was right even while the number was wrong.

const G = 'g1'
const games: WpblGame[] = [{ id: G, game_type: 'regular', counts_in_standings: true } as WpblGame]

const pit = (o: Partial<WpblPitchingLine> = {}): WpblPitchingLine => ({
  id: Math.random().toString(36).slice(2), game_id: G, player_id: 'p1', team_id: 'SF',
  outs: 21, h: 5, r: 2, er: 2, bb: 1, so: 7, hr: 0, pitches: 90, decision: null, ...o,
} as WpblPitchingLine)

describe('the stored basis', () => {
  it('holds ERA per seven, which is what the league publishes', () => {
    // A complete WPBL game: 2 earned runs in seven innings, which the league prints as 2.00.
    // Per 9 the same line is 2.57, and that is the number this held until Sep 3, 2026.
    const t = sumPitching([pit({ outs: 21, er: 2 })], games)
    expect(t.era).toBeCloseTo(2, 6)
    expect(t.k9).toBeCloseTo(7, 6)
  })

  it('says so in one constant, so nothing has to infer it', () => {
    expect(ERA_BASIS_CANONICAL).toBe(7)
  })

  // The real-world line that settled it, from the league's own board on Sep 3, 2026.
  it('agrees with the league on a pitcher anyone can look up', () => {
    // Kelsie Whitmore: 18 earned runs in 24.0 innings, printed by the league as 5.25.
    const t = sumPitching([pit({ outs: 72, er: 18 })], games)
    expect(t.era).toBeCloseTo(5.25, 2)
    expect(scaleToBasis(t.era, 9)).toBeCloseTo(6.75, 2)
  })
})

describe('scaleToBasis', () => {
  it('gives back the stored number on the league basis', () => {
    expect(scaleToBasis(2, 7)).toBeCloseTo(2, 6)
  })

  it('converts to the nine-inning figure a reader asking for per 9 expects', () => {
    // Same pitcher: 2 ER in 7 IP is 2.00 per game and 2.57 on the MLB denominator, which is
    // what the setting is now for. The two swapped roles when the league switched.
    const t = sumPitching([pit({ outs: 21, er: 2 })], games)
    expect(scaleToBasis(t.era, 9)).toBeCloseTo(2.571, 3)
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

  // Written against a literal 9 and passing for the wrong reason: 9 WAS the canonical basis, so
  // "explicit 9" and "no argument" agreed trivially. Against the constant it tests what its name
  // says, which is that an omitted basis is the LEAGUE's, whatever the league is publishing.
  it('defaults to the league basis when nobody passes one, so a bot cannot opt in by accident', () => {
    const explicit = computeWpblTeamStats(teams, season, [], lines, ERA_BASIS_CANONICAL)
    const implied = computeWpblTeamStats(teams, season, [], lines)
    expect(implied.get('SF')!.era!.display).toBe(explicit.get('SF')!.era!.display)
    // And an explicit request for the OTHER basis really does differ, or the assertion above
    // would hold for a function that ignored its argument entirely.
    const other = computeWpblTeamStats(teams, season, [], lines, 9)
    expect(other.get('SF')!.era!.display).not.toBe(implied.get('SF')!.era!.display)
  })
})

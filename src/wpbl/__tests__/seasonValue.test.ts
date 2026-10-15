import { describe, it, expect } from 'vitest'
import { playerSeasonValue, type PlayerSeasonValue, type SeasonValueBoards } from '../derive/seasonValue'
import { buildWpblComparison } from '../derive/compare'
import { baserunningRuns, type BaserunningLine, type BaserunningRuns } from '../derive/baserunning'
import type { WpaLine } from '../derive/winProbability'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblTeam } from '../types'

// The player card and Compare print a player's wins added and runs on the bases with a place,
// "3rd of 74", read off Run value's own boards. These pin that the place is the board's.

type P = { id: string; name: string }
const p = (id: string): P => ({ id, name: id })
const wpa = (player: P | null, v: number, name = player?.name ?? '?'): WpaLine<P> =>
  ({ player, name, teamId: 'SF', pa: 10, wpa: v })
const bases = (player: P | null, bsr: number): BaserunningRuns<P> => ({
  player, name: player?.name ?? 'Unresolved Runner', teamId: 'SF',
  sb: 2, cs: 0, pickoffs: 0, chances: 3, extra: 2, thrownOut: 0,
  stealRuns: bsr / 2, advanceRuns: bsr / 2, total: bsr, onFirst: 10, gdp: 0, bsr,
})

describe('a player\'s place on the boards', () => {
  const boards: SeasonValueBoards<P> = {
    // Sorted best first, as wpaLeaders returns them, with a name the log could not resolve.
    wpaHitting: [wpa(p('x'), 1.2), wpa(null, 0.9, 'Nobody Known'), wpa(p('y'), 0.4), wpa(p('z'), 0.4), wpa(p('w'), -0.3)],
    wpaPitching: [wpa(p('y'), 0.8), wpa(p('q'), -0.1)],
    bases: [bases(p('z'), 2.1), bases(p('x'), 0.5)],
  }

  it('counts the unresolved names the board lists, in the place and in the field', () => {
    const v = playerSeasonValue(boards, 'y')
    expect(v.wpaHitting).toEqual({ value: 0.4, rank: 3, of: 5 })
    expect(v.wpaPitching).toEqual({ value: 0.8, rank: 1, of: 2 })
  })

  it('gives a tie the better place', () => {
    expect(playerSeasonValue(boards, 'z').wpaHitting?.rank).toBe(3)
  })

  it('is null on a board the player is not on, and carries the bases counts', () => {
    const v = playerSeasonValue(boards, 'x')
    expect(v.wpaPitching).toBeNull()
    expect(v.bases).toMatchObject({ value: 0.5, rank: 2, of: 2, line: { sb: 2, extra: 2, chances: 3 } })
  })
})

describe('the Compare rows', () => {
  const teams = [{ id: 'SF' } as WpblTeam, { id: 'LA' } as WpblTeam]
  const A = { id: 'a', name: 'Val Perez', team_id: 'SF' } as WpblPlayer
  const B = { id: 'b', name: 'Liz Gilder', team_id: 'LA' } as WpblPlayer
  const games = Array.from({ length: 10 }, (_, i) => ({
    id: `g${i}`, status: 'final', home_team_id: 'SF', away_team_id: 'LA', game_type: 'regular', counts_in_standings: true,
  } as WpblGame))
  const bat = (player_id: string): WpblBattingLine => ({
    id: player_id, game_id: 'g0', player_id, team_id: 'SF', batting_order: 1, position: 'CF',
    ab: 4, r: 0, h: 1, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0, hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0, ibb: 0, gdp: 0,
  } as WpblBattingLine)
  const pit = (player_id: string): WpblPitchingLine => ({
    id: player_id, game_id: 'g0', player_id, team_id: 'LA', outs: 18, bf: 24, h: 5, r: 2, er: 2, bb: 1, so: 6, hr: 0,
    pitches: 90, strikes: 60, decision: null, gs: 1, hbp: 0, ibb: 0, wp: 0, bk: 0, doubles: 0, triples: 0,
  } as WpblPitchingLine)
  const lines = { teams, games, batting: [bat('a'), bat('b')], pitching: [pit('b')] }
  const place = (value: number) => ({ value, rank: 1, of: 9 })
  const none: PlayerSeasonValue = { wpaHitting: null, wpaPitching: null, bases: null }
  const valueOf = (c: ReturnType<typeof buildWpblComparison>, group: 'batting' | 'pitching') =>
    c.groups.find(g => g.key === group)!.value

  it('has none when the caller passes no value at all', () => {
    expect(valueOf(buildWpblComparison(A, B, lines), 'batting')).toEqual([])
  })

  it('holds the same rows, pending, while the plays are on their way', () => {
    const c = buildWpblComparison(A, B, { ...lines, value: null })
    expect(valueOf(c, 'batting').map(r => [r.key, r.pending])).toEqual([['wpa', true], ['bsr', true]])
    expect(valueOf(c, 'pitching').map(r => r.key)).toEqual(['wpa'])
  })

  it('ticks the higher figure, and nobody against a player the board does not list', () => {
    const c = buildWpblComparison(A, B, {
      ...lines,
      value: {
        a: { wpaHitting: place(0.62), wpaPitching: null, bases: { ...place(1.25), line: bases(null, 1.25) } },
        b: { ...none, wpaHitting: place(-0.1), wpaPitching: place(0.4) },
      },
    })
    const [w, b] = valueOf(c, 'batting')
    expect([w.aText, w.bText, w.leader, w.pending]).toEqual(['+0.62', '−0.10', 'a', undefined])
    expect([b.aText, b.bText, b.leader]).toEqual(['+1.3', '—', null])
    expect(valueOf(c, 'pitching')[0]).toMatchObject({ aText: '—', bText: '+0.40', leader: null })
  })
})

describe('BsR: the steals measured against an average runner', () => {
  const raw = (player: P | null, stealRuns: number, advanceRuns: number): BaserunningLine<P> => ({
    player, name: player?.name ?? 'Unnamed Runner', teamId: 'SF',
    sb: 1, cs: 0, pickoffs: 0, chances: 1, extra: 1, thrownOut: 0,
    stealRuns, advanceRuns, total: stealRuns + advanceRuns,
  })
  // The named runners lost 2 runs stealing over a league that reached first 100 times: -0.02 a time.
  const runners = [raw(p('thief'), -1.5, 0.5), raw(p('pinch'), -0.5, 0), raw(null, -3, 0)]
  const hitters = [
    { player: p('thief'), onFirst: 20, teamId: 'SF' },
    { player: p('patient'), onFirst: 40, teamId: 'LA' },
  ]
  const rows = baserunningRuns(runners, hitters, 100)
  const of = (id: string) => rows.find(r => r.player?.id === id)!

  it('charges every hitter the league rate per time on first, runner or not', () => {
    expect(of('thief').bsr).toBeCloseTo(-1.5 + 0.5 + 0.02 * 20)
    // Reached 40 times and never ran: an average runner would have lost 0.8 in their place.
    expect(of('patient')).toMatchObject({ teamId: 'LA', sb: 0 })
    expect(of('patient').bsr).toBeCloseTo(0.8)
  })

  it('leaves a pinch runner and an unnamed runner raw, and the unnamed out of the rate', () => {
    expect(of('pinch').bsr).toBeCloseTo(-0.5)
    expect(rows.find(r => !r.player)!.bsr).toBeCloseTo(-3)
  })

  it('adds the double plays to runner and non-runner alike', () => {
    const withGdp = baserunningRuns(runners, hitters, 100, new Map([['thief', -0.25], ['patient', 0.1]]))
    const g = (id: string) => withGdp.find(r => r.player?.id === id)!
    expect(g('thief')).toMatchObject({ gdp: -0.25 })
    expect(g('thief').bsr).toBeCloseTo(-1.5 + 0.5 + 0.02 * 20 - 0.25)
    expect(g('patient').bsr).toBeCloseTo(0.9)
  })

  it('ranks on BsR', () => {
    expect(rows.map(r => r.player?.id ?? 'unnamed')).toEqual(['patient', 'pinch', 'thief', 'unnamed'])
  })
})

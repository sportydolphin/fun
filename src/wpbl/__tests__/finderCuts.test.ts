import { describe, it, expect } from 'vitest'
import { runWpblFinder, encodeFinderQuery, decodeFinderQuery, decodeFinderCuts, EMPTY_FINDER_QUERY, type FinderQuery } from '../derive/finder'
import { describeFinderCuts, finderAnswerText } from '../../league/finder'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer } from '../types'
import type { PlateAppearanceLine } from '../../league/inningLines'

// Complete games, streaks, and the cuts (a span, the last N games, the other player's arm), each of
// which answers by leaving lines out: a wrong one is a shorter list that looks like an answer.

const A = { id: 'a', name: 'Jaida Lee', team_id: 'NY', bats: 'L', throws: 'R' } as WpblPlayer
const B = { id: 'b', name: 'Ayami Sato', team_id: 'LA', bats: 'R', throws: 'L' } as WpblPlayer
const C = { id: 'c', name: 'Alli Schroder', team_id: 'LA', bats: 'R', throws: 'R' } as WpblPlayer
const D = { id: 'd', name: 'Kate Blunt', team_id: 'NY', bats: 'S', throws: 'R' } as WpblPlayer
const PLAYERS = [A, B, C, D]

const game = (id: string, date: string, o: Partial<WpblGame> = {}): WpblGame => ({
  id, status: 'final', game_date: date, home_team_id: 'NY', away_team_id: 'LA',
  home_score: 3, away_score: 1, game_type: 'regular', counts_in_standings: true, ...o,
} as WpblGame)
const GAMES = [game('g1', '2026-07-30'), game('g2', '2026-08-02', { home_score: 0, away_score: 4 }), game('g3', '2026-08-05'), game('g4', '2026-09-01')]

const bat = (o: Partial<WpblBattingLine>): WpblBattingLine => ({
  id: Math.random().toString(36).slice(2), game_id: 'g1', player_id: 'a', team_id: 'NY',
  ab: 4, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0,
  hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0, ibb: 0, gdp: 0, tb: 0, lob: 0, ...o,
} as WpblBattingLine)
const pit = (o: Partial<WpblPitchingLine>): WpblPitchingLine => ({
  id: Math.random().toString(36).slice(2), game_id: 'g1', player_id: 'b', team_id: 'LA',
  outs: 0, bf: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0, pitches: 0, decision: null,
  gs: 0, hbp: 0, ibb: 0, wp: 0, bk: 0, strikes: 0, doubles: 0, triples: 0, ...o,
} as WpblPitchingLine)
const pa = (o: Partial<PlateAppearanceLine>): PlateAppearanceLine => ({
  id: Math.random().toString(36).slice(2), game_id: 'g1', sequence: 1, inning: 1, half: 'bottom', batter_id: 'a', pitcher_id: 'b',
  batting_team: 'NY', fielding_team: 'LA', event: null, paouts: 0, on: 0, risp: 0, balls: 0, scount: 0, pitches: 3, strikes: 2,
  fouls: 0, h: 0, doubles: 0, triples: 0, hr: 0, tb: 0, bb: 0, so: 0, hbp: 0, runs: 0, walkoff: 0, hrrow: 0, krow: 0, retired: 0, ...o,
})
const q = (o: Partial<FinderQuery>): FinderQuery => ({ ...EMPTY_FINDER_QUERY, ...o })

describe('complete games', () => {
  it('are a club\'s only pitcher that day, never one of two', () => {
    const lines = [
      pit({ game_id: 'g1', player_id: 'b', outs: 24, gs: 1 }),
      pit({ game_id: 'g2', player_id: 'b', outs: 15, gs: 1 }), pit({ game_id: 'g2', player_id: 'c', outs: 9 }),
    ]
    const r = runWpblFinder('pitching', [], lines, PLAYERS, GAMES, q({ conditions: [{ field: 'cg', op: 'gte', value: 1 }] }))
    expect(r.rows.map(x => x.game?.id)).toEqual(['g1'])
  })
})

describe('streaks', () => {
  it('count a hitting streak once, on its last game, and a walk-only game neither extends nor ends it', () => {
    const lines = [
      bat({ game_id: 'g1', h: 1 }), bat({ game_id: 'g2', ab: 0, bb: 3 }), bat({ game_id: 'g3', h: 2 }), bat({ game_id: 'g4', h: 0 }),
    ]
    const r = runWpblFinder('hitting', lines, [], PLAYERS, GAMES, q({ conditions: [{ field: 'hstreak', op: 'gte', value: 1 }] }))
    expect(r.rows.map(x => [x.game?.id, x.headline])).toEqual([['g3', 2]])
    // The walks keep the on-base streak going through the third game.
    const ob = runWpblFinder('hitting', lines, [], PLAYERS, GAMES, q({ conditions: [{ field: 'obstreak', op: 'gte', value: 1 }] }))
    expect(ob.rows.map(x => [x.game?.id, x.headline])).toEqual([['g3', 3]])
  })
})

describe('cuts', () => {
  const lines = GAMES.map(g => bat({ game_id: g.id, h: 1 }))

  it('keep the games in a span, by month and day', () => {
    const r = runWpblFinder('hitting', lines, [], PLAYERS, GAMES, q({ conditions: [{ field: 'h', op: 'gte', value: 1 }], from: '0801', to: '0831' }))
    expect(r.rows.map(x => x.game?.id).sort()).toEqual(['g2', 'g3'])
  })

  it('keep a club\'s last N games, and its record is the answer with nothing asked', () => {
    const club = q({ per: 'club', teamId: 'NY', last: 3 })
    const r = runWpblFinder('hitting', lines, [], PLAYERS, GAMES, club, Infinity)
    expect(r.rows.map(x => x.game?.id).sort()).toEqual(['g2', 'g3', 'g4'])
    expect(finderAnswerText(r, 'hitting', club)).toBe('2–1')
  })

  it('split plate appearances by the other player\'s arm, a switch hitter standing opposite it', () => {
    const pas = [
      pa({ batter_id: 'a', pitcher_id: 'b', h: 1 }),          // a lefty batter vs a lefty pitcher
      pa({ batter_id: 'a', pitcher_id: 'c', h: 1, sequence: 2 }), // vs a righty
      pa({ batter_id: 'd', pitcher_id: 'b', h: 1, sequence: 3 }), // a switch hitter bats right vs a lefty
    ]
    const vsL = runWpblFinder('hitting', [], [], PLAYERS, GAMES, q({ per: 'pa', conditions: [{ field: 'h', op: 'gte', value: 1 }], hand: 'L' }), 50, null, { plateAppearances: pas })
    expect(vsL.total).toBe(2)
    const toR = runWpblFinder('pitching', [], [], PLAYERS, GAMES, q({ per: 'pa', conditions: [{ field: 'h', op: 'gte', value: 1 }], hand: 'R' }), 50, null, { plateAppearances: pas })
    expect(toR.rows.map(x => x.name)).toEqual(['Ayami Sato'])
  })

  it('sum a hitter\'s season against one arm from those plate appearances', () => {
    const pas = [
      pa({ batter_id: 'a', pitcher_id: 'b', h: 1, tb: 1 }), pa({ batter_id: 'a', pitcher_id: 'b', sequence: 2 }),
      pa({ batter_id: 'a', pitcher_id: 'c', h: 1, tb: 1, sequence: 3 }),
    ]
    const r = runWpblFinder('hitting', [], [], PLAYERS, GAMES, q({ per: 'season', conditions: [{ field: 'avg', op: 'gte', value: 1 }], hand: 'L' }), 50, null, { plateAppearances: pas })
    expect(r.rows[0].values.avg).toBe(500)
  })

  // "avg off Schroder", "avg with RISP": the same sum, cut by the pitcher or by where each trip began.
  it('sum a hitter\'s season against one pitcher, or in one situation, from those plate appearances', () => {
    const pas = [
      pa({ batter_id: 'a', pitcher_id: 'b', h: 1, tb: 1, risp: 1 }), pa({ batter_id: 'a', pitcher_id: 'b', sequence: 2 }),
      pa({ batter_id: 'a', pitcher_id: 'c', h: 1, tb: 4, hr: 1, sequence: 3, risp: 1 }), pa({ batter_id: 'a', pitcher_id: 'c', sequence: 4, risp: 1 }),
    ]
    const opts = { plateAppearances: pas }
    const offC = runWpblFinder('hitting', [], [], PLAYERS, GAMES, q({ per: 'season', conditions: [{ field: 'hr', op: 'gte', value: 1 }], pitcherId: 'c' }), 50, null, opts)
    expect(offC.rows.map(r => [r.name, r.values.hr, r.values.pa])).toEqual([['Jaida Lee', 1, 2]])
    const risp = runWpblFinder('hitting', [], [], PLAYERS, GAMES,
      q({ per: 'season', conditions: [{ field: 'avg', op: 'gte', value: 1 }, { field: 'risp', op: 'eq', value: 1 }] }), 50, null, opts)
    expect(risp.rows[0].values.avg).toBe(667)
    expect(risp.qualifier).toBeNull()
  })

  // "two out runs team" (Nov 10, 2026): a club's season, its two-out runs off its half-innings, and
  // "team avg with 2 outs" the same plate-appearance sum filed under the club.
  it("sum a club's season, with its two-out runs, and cut it by a situation", () => {
    const batting = [
      bat({ game_id: 'g1', player_id: 'a', team_id: 'NY', h: 2, r: 2 }), bat({ game_id: 'g1', player_id: 'd', team_id: 'NY', h: 1, r: 1 }),
      bat({ game_id: 'g3', player_id: 'a', team_id: 'NY', h: 1, r: 1 }), bat({ game_id: 'g1', player_id: 'b', team_id: 'LA', h: 1, r: 1 }),
    ]
    const half = (game_id: string, team_id: string, r2: number) => ({
      id: `${game_id}|${team_id}|${r2}`, game_id, team_id, inning: 1, half: 'bottom' as const, sequence: 1, r: r2, h: 0, doubles: 0,
      triples: 0, hr: 0, tb: 0, bb: 0, so: 0, hbp: 0, ab: 3, sh: 0, sf: 0, r2, trail: 0, tooklead: 0, sb: 0, sbh: 0, cs: 0, pk: 0,
    })
    const teamInnings = [half('g1', 'NY', 2), half('g3', 'NY', 1), half('g1', 'LA', 1), half('g1', 'LA', 0)]
    const clubName = (id: string) => id
    const r2 = runWpblFinder('hitting', batting, [], PLAYERS, GAMES,
      q({ per: 'season', byClub: true, conditions: [{ field: 'r2', op: 'gte', value: 1 }] }), 50, null, { teamInnings, clubName })
    expect(r2.rows.map(r => [r.name, r.values.r2, r.values.g, r.values.r, r.values.h])).toEqual([['NY', 3, 2, 4, 4], ['LA', 1, 1, 1, 1]])
    expect(r2.rows[0].player).toBeNull()

    const pas = [
      pa({ batter_id: 'a', paouts: 2, h: 1, tb: 1 }), pa({ batter_id: 'd', paouts: 2, sequence: 2 }), pa({ batter_id: 'a', paouts: 0, h: 1, tb: 1, sequence: 3 }),
      pa({ batter_id: 'b', batting_team: 'LA', fielding_team: 'NY', half: 'top', paouts: 2, sequence: 4 }),
    ]
    const twoOut = runWpblFinder('hitting', [], [], PLAYERS, GAMES,
      q({ per: 'season', byClub: true, conditions: [{ field: 'avg', op: 'gte', value: 0 }, { field: 'paouts', op: 'eq', value: 2 }] }), 50, null, { plateAppearances: pas, clubName })
    expect(twoOut.rows.map(r => [r.name, r.values.avg, r.values.pa])).toEqual([['NY', 500, 2], ['LA', 0, 1]])
  })

  it("carry a club's season in q", () => {
    const raw = encodeFinderQuery(q({ per: 'season', byClub: true, conditions: [{ field: 'r2', op: 'gte', value: 1 }] }))
    expect(raw).toBe('clubseason~r2.gte.1')
    expect(decodeFinderQuery(raw, 'hitting')).toEqual([{ field: 'r2', op: 'gte', value: 1 }])
    // A player's season has no two-out runs, so a hand-edited link keeps none.
    expect(decodeFinderQuery('season~r2.gte.1', 'hitting')).toEqual([])
  })

  it('ride in q and come back whole, beside conditions an older reader still reads', () => {
    const raw = encodeFinderQuery(q({ per: 'season', conditions: [{ field: 'hr', op: 'gte', value: 1 }], from: '0801', last: 10, hand: 'L' }))
    expect(raw).toBe('season~from.0801~last.10~hand.l~hr.gte.1')
    expect(decodeFinderCuts(raw)).toEqual({ from: '0801', last: 10, hand: 'L' })
    expect(decodeFinderQuery(raw, 'hitting')).toEqual([{ field: 'hr', op: 'gte', value: 1 }])
  })

  it('read as chips, a whole month as its name', () => {
    expect(describeFinderCuts('hitting', { per: 'season', from: '0901', to: '0930', hand: 'L', last: 5 }).map(c => c.text))
      .toEqual(['September', 'Last 5 games', 'Vs LHP'])
    // A game cannot be split by the arm, so no chip claims it is.
    expect(describeFinderCuts('hitting', { per: 'game', hand: 'L' })).toEqual([])
  })
})

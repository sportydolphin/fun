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
  fouls: 0, h: 0, doubles: 0, triples: 0, hr: 0, tb: 0, bb: 0, so: 0, hbp: 0, runs: 0, rbi: 0, walkoff: 0, hrrow: 0, krow: 0, retired: 0, ...o,
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

  // "most 2 out rbi", "most grand slams", "most walk-off hits": the RBI a season of trips sums are the
  // scorer's, and a walk-off, a leadoff or a pinch hitter cuts the trips like a situation does.
  it('sum the RBI and the event flags of the trips that fit', () => {
    const pas = [
      pa({ batter_id: 'a', paouts: 2, rbi: 2, runs: 2, h: 1, tb: 1 }), pa({ batter_id: 'a', paouts: 1, rbi: 1, runs: 1, sequence: 2 }),
      pa({ batter_id: 'a', paouts: 2, rbi: 0, runs: 1, sequence: 3 }),
      pa({ batter_id: 'a', on: 3, hr: 1, h: 1, tb: 4, rbi: 4, runs: 4, sequence: 4, walkoff: 1 }),
    ]
    const opts = { plateAppearances: pas }
    const twoOut = runWpblFinder('hitting', [], [], PLAYERS, GAMES,
      q({ per: 'season', conditions: [{ field: 'rbi', op: 'gte', value: 1 }, { field: 'paouts', op: 'eq', value: 2 }] }), 50, null, opts)
    expect(twoOut.rows.map(r => [r.name, r.values.rbi])).toEqual([['Jaida Lee', 2]])
    const slams = runWpblFinder('hitting', [], [], PLAYERS, GAMES,
      q({ per: 'season', conditions: [{ field: 'hr', op: 'gte', value: 1 }, { field: 'on', op: 'eq', value: 3 }] }), 50, null, opts)
    expect(slams.rows.map(r => r.values.hr)).toEqual([1])
    const walkoffHits = runWpblFinder('hitting', [], [], PLAYERS, GAMES,
      q({ per: 'season', conditions: [{ field: 'h', op: 'gte', value: 1 }, { field: 'walkoff', op: 'eq', value: 1 }] }), 50, null, opts)
    expect(walkoffHits.rows.map(r => r.values.h)).toEqual([1])
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

  it('keep extra-inning games, off the line score or, with none, off the outs the pitchers got', () => {
    const line = (n: number) => Array.from({ length: n }, (_, i) => ({ inning: i + 1, runs: 0 }))
    const games = [
      game('g1', '2026-08-01', { home_line: line(7), away_line: line(7) } as Partial<WpblGame>),
      game('g2', '2026-08-02', { home_line: line(8), away_line: line(8) } as Partial<WpblGame>),
      // A six-inning game is short, not long.
      game('g3', '2026-08-03', { home_line: line(6), away_line: line(6) } as Partial<WpblGame>),
      // No line score (MLB's mirrored games): 24 outs by the home staff is past seven innings.
      game('g4', '2026-08-04'),
    ]
    const batting = games.map(g => bat({ game_id: g.id, h: 1 }))
    const pitching = [pit({ game_id: 'g4', player_id: 'c', team_id: 'NY', outs: 24 }), pit({ game_id: 'g4', team_id: 'LA', outs: 21 })]
    const r = runWpblFinder('hitting', batting, pitching, PLAYERS, games, q({ conditions: [{ field: 'h', op: 'gte', value: 1 }], extra: true }))
    expect(r.rows.map(x => x.game?.id).sort()).toEqual(['g2', 'g4'])
  })

  it("keep a doubleheader's games, the opener and the nightcap by first pitch", () => {
    const games = [
      game('g1', '2026-08-08', { start_time: '6:30 PM' } as Partial<WpblGame>),
      game('g2', '2026-08-08', { start_time: '1:00 PM' } as Partial<WpblGame>),
      // The same date between other clubs is no doubleheader.
      game('g3', '2026-08-08', { home_team_id: 'SF', away_team_id: 'BOS' }),
      game('g4', '2026-08-09'),
    ]
    const batting = games.map(g => bat({ game_id: g.id, h: 1, team_id: g.home_team_id }))
    const ask = (dh: FinderQuery['dh']) => runWpblFinder('hitting', batting, [], PLAYERS, games, q({ conditions: [{ field: 'h', op: 'gte', value: 1 }], dh }))
      .rows.map(x => x.game?.id).sort()
    expect(ask('any')).toEqual(['g1', 'g2'])
    expect(ask(1)).toEqual(['g2'])
    expect(ask(2)).toEqual(['g1'])
  })

  it("rank each player's best stretch of N straight games, with a bar of its own for a rate", () => {
    const games = ['01', '02', '03', '04', '05', '06'].map((d, i) => game(`s${i}`, `2026-08-${d}`))
    const hr = [0, 2, 1, 0, 3, 0]
    const batting = [
      ...games.map((g, i) => bat({ game_id: g.id, player_id: 'a', hr: hr[i], h: hr[i], tb: hr[i] * 4 })),
      // Three games only: no three-game stretch past them, and a 2-for-2 is no average to rank.
      ...games.slice(0, 2).map(g => bat({ game_id: g.id, player_id: 'd', ab: 1, h: 1 })),
    ]
    const r = runWpblFinder('hitting', batting, [], PLAYERS, games, q({ per: 'season', stretch: 3, conditions: [{ field: 'hr', op: 'gte', value: 1 }] }))
    // 2+1+0, 1+0+3, 0+3+0: the best run is the second to fourth games' 4, the latest on a tie.
    expect(r.rows.map(x => [x.name, x.values.hr, x.values.g, x.stretch?.first.id, x.stretch?.last.id])).toEqual([['Jaida Lee', 4, 3, 's2', 's4']])
    expect(r.rows[0].detail).toMatch(/^Aug 3 to Aug 5 · /)
    const avg = runWpblFinder('hitting', batting, [], PLAYERS, games, q({ per: 'season', stretch: 2, conditions: [{ field: 'avg', op: 'gte', value: 1 }] }))
    expect(avg.qualifier).toEqual({ field: 'pa', min: 4 })
    expect(avg.rows.map(x => x.name)).toEqual(['Jaida Lee'])
  })

  it('ride in q too', () => {
    const raw = encodeFinderQuery(q({ per: 'season', conditions: [{ field: 'hr', op: 'gte', value: 1 }], extra: true, dh: 2, stretch: 5 }))
    expect(raw).toBe('season~extra.1~dh.2~stretch.5~hr.gte.1')
    expect(decodeFinderCuts(raw)).toEqual({ extra: true, dh: 2, stretch: 5 })
    expect(decodeFinderCuts('dh.a~stretch.1~stretch.99')).toEqual({ dh: 'any' })
    expect(describeFinderCuts('hitting', { per: 'season', extra: true, dh: 'any', stretch: 5 }).map(c => c.text))
      .toEqual(['Extra innings', 'Doubleheaders', '5-game stretch'])
    // A stretch is a season's: a game has none.
    expect(describeFinderCuts('hitting', { per: 'game', stretch: 5 })).toEqual([])
  })

  it('read as chips, a whole month as its name', () => {
    expect(describeFinderCuts('hitting', { per: 'season', from: '0901', to: '0930', hand: 'L', last: 5 }).map(c => c.text))
      .toEqual(['September', 'Last 5 games', 'Vs LHP'])
    // A game cannot be split by the arm, so no chip claims it is.
    expect(describeFinderCuts('hitting', { per: 'game', hand: 'L' })).toEqual([])
  })
})

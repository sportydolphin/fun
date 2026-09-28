import { describe, it, expect } from 'vitest'
import { headToHead, batterPitcherMatchups, playerMatchups, edgeOf, matchupBoard, type WpblMatchupPlay } from '../derive/matchups'
import type { WpblGame } from '../types'

// `headToHead` backs the four-by-four grid on the Teams tab. It is asymmetric by design,
// since get(a, b) and get(b, a) are two different cells, and it has to agree with computeStandings
// on which games count, so both halves are worth pinning down.

let seq = 0
function game(home: string, away: string, homeScore: number | null, awayScore: number | null,
              status: WpblGame['status'] = 'final'): WpblGame {
  return {
    id: `g${seq++}`,
    game_date: '2026-08-10',
    start_time: '6:30 PM',
    home_team_id: home,
    away_team_id: away,
    venue: null,
    status,
    home_score: homeScore,
    away_score: awayScore,
    innings: 7,
    notes: null,
    created_at: '',
    updated_at: '',
  }
}

describe('headToHead', () => {
  it('records a decisive final from both sides', () => {
    const g = headToHead([game('A', 'B', 6, 2)])
    expect(g.get('A', 'B')).toEqual({ wins: 1, losses: 0, runsFor: 6, runsAgainst: 2 })
    expect(g.get('B', 'A')).toEqual({ wins: 0, losses: 1, runsFor: 2, runsAgainst: 6 })
  })

  it('credits the away team when it wins', () => {
    const g = headToHead([game('A', 'B', 1, 4)])
    expect(g.get('A', 'B')).toMatchObject({ wins: 0, losses: 1 })
    expect(g.get('B', 'A')).toMatchObject({ wins: 1, losses: 0 })
  })

  it('accumulates a series across meetings, either side of the ledger', () => {
    const g = headToHead([
      game('A', 'B', 5, 1),
      game('B', 'A', 3, 2),
      game('A', 'B', 7, 0),
    ])
    expect(g.get('A', 'B')).toEqual({ wins: 2, losses: 1, runsFor: 14, runsAgainst: 4 })
    expect(g.get('B', 'A')).toEqual({ wins: 1, losses: 2, runsFor: 4, runsAgainst: 14 })
  })

  it('returns null for a pairing that has not met, and for the diagonal', () => {
    const g = headToHead([game('A', 'B', 6, 2)])
    expect(g.get('A', 'C')).toBeNull()
    expect(g.get('A', 'A')).toBeNull()
  })

  // The exclusion this file's header always claimed and the code did not make: the first
  // postseason final, on Sep 9, 2026, turned a 5-0 season series into a 6-0 grid cell sitting
  // one row above a standings table that had never heard of the game.
  it('ignores a postseason game, however decisive and however final', () => {
    const regular = game('A', 'B', 5, 1)
    const playoff = { ...game('A', 'B', 6, 4), game_type: 'postSeason', counts_in_standings: true } as WpblGame
    expect(headToHead([regular, playoff]).get('A', 'B'))
      .toEqual({ wins: 1, losses: 0, runsFor: 5, runsAgainst: 1 })
    // counts_in_standings alone is enough, for a feed that stops naming the round.
    const flagged = { ...game('A', 'B', 6, 4), counts_in_standings: false } as WpblGame
    expect(headToHead([regular, flagged]).get('A', 'B'))
      .toEqual({ wins: 1, losses: 0, runsFor: 5, runsAgainst: 1 })
  })

  // Same exclusions computeStandings applies, so the grid can never disagree with the
  // records on the cards directly above it.
  it('ignores anything that is not a decisive final', () => {
    const g = headToHead([
      game('A', 'B', 4, 4),                    // tie, no winner to credit
      game('A', 'B', null, null, 'scheduled'), // not played
      game('A', 'B', 3, 1, 'live'),            // in progress
      game('A', 'B', null, 2),                 // half-ingested row
    ])
    expect(g.get('A', 'B')).toBeNull()
  })
})

function pa(gameId: string, batter: [string | null, string], pitcher: [string | null, string],
            event_type: string, team_id: string | null = null): WpblMatchupPlay {
  return { game_id: gameId, team_id, batter_id: batter[0], batter_name: batter[1],
           pitcher_id: pitcher[0], pitcher_name: pitcher[1], event_type, narrative: null }
}

describe('batterPitcherMatchups', () => {
  const reg = { id: 'r1', game_type: 'regularSeason', counts_in_standings: true } as WpblGame
  const semi = { id: 'p1', game_type: 'postSeason', counts_in_standings: true } as WpblGame
  const kw: [string, string] = ['kw', 'Kelsie Whitmore']
  const as: [string, string] = ['as', 'Ayami Sato']

  // Found Sep 28, 2026, before anything drew the board: the function took no schedule, so a
  // semifinal at-bat read as one more regular-season meeting between the two of them.
  it('leaves playoff plate appearances out of the season line', () => {
    const plays = [
      pa('r1', kw, as, 'home_run'), pa('r1', kw, as, 'strikeout'), pa('r1', kw, as, 'walk'),
      pa('p1', kw, as, 'single'), pa('p1', kw, as, 'double'),
    ]
    const [line] = batterPitcherMatchups(plays, [reg, semi])
    expect(line).toMatchObject({ pa: 3, ab: 2, h: 1, hr: 1, bb: 1, so: 1 })
  })

  // The ingest leaves the id null exactly when a name is ambiguous, so a name key would merge
  // two players precisely where the ingest refused to.
  it('keys on the player id, never the name', () => {
    const a: [string, string] = ['a1', 'Sam Lee'], b: [string, string] = ['a2', 'Sam Lee']
    const plays = [
      ...[1, 2, 3].map(() => pa('r1', a, as, 'single')),
      ...[1, 2, 3].map(() => pa('r1', b, as, 'strikeout')),
      pa('r1', [null, 'Sam Lee'], as, 'home_run'),
    ]
    const lines = batterPitcherMatchups(plays, [reg])
    expect(lines.map(l => [l.batterId, l.h, l.so, l.hr]).sort())
      .toEqual([['a1', 3, 0, 0], ['a2', 0, 3, 0]])
  })

  // The clubs come off the play and the game, which is what keeps a traded player's July on the
  // club she played it for. The roster only says where she is now.
  it('names the club each side played for, off the play and the game', () => {
    const g = { id: 'r1', game_type: 'regularSeason', counts_in_standings: true, home_team_id: 'SF', away_team_id: 'LA' } as WpblGame
    const plays = [1, 2, 3].map(() => pa('r1', kw, as, 'single', 'SF'))
    expect(batterPitcherMatchups(plays, [g])[0]).toMatchObject({ batterTeamIds: ['SF'], pitcherTeamIds: ['LA'] })
  })

  // The player page's Regular / Playoffs / Both control reaches this, so each slice must be its
  // own, and "Both" must be the sum rather than whichever came first.
  it('follows the season scope', () => {
    const plays = [
      pa('r1', kw, as, 'home_run'), pa('r1', kw, as, 'strikeout'), pa('r1', kw, as, 'walk'),
      pa('p1', kw, as, 'single'), pa('p1', kw, as, 'double'), pa('p1', kw, as, 'groundout'),
    ]
    const at = (scope: 'regular' | 'postseason' | 'all') =>
      batterPitcherMatchups(plays, [reg, semi], { scope })[0]
    expect(at('regular')).toMatchObject({ pa: 3, h: 1 })
    expect(at('postseason')).toMatchObject({ pa: 3, h: 2, xbh: 1 })
    expect(at('all')).toMatchObject({ pa: 6, h: 3, ab: 5 })
  })
})

describe('playerMatchups', () => {
  const reg = { id: 'r1', game_type: 'regularSeason', counts_in_standings: true } as WpblGame
  const semi = { id: 'p1', game_type: 'postSeason', counts_in_standings: true } as WpblGame
  const two: [string, string] = ['tw', 'Two Way']
  const p1: [string, string] = ['p1', 'Pitcher One'], p2: [string, string] = ['p2', 'Pitcher Two']
  const b1: [string, string] = ['b1', 'Batter One']

  it('splits a two-way player into her at-bats and her batters faced', () => {
    const plays = [
      pa('r1', two, p1, 'single'),
      pa('r1', b1, two, 'strikeout'), pa('r1', b1, two, 'flyout'),
      pa('r1', b1, p1, 'home_run'), // not hers at all
    ]
    const m = playerMatchups(new Set(['tw']), plays, [reg])
    expect(m.vsPitchers.map(l => [l.pitcherId, l.pa])).toEqual([['p1', 1]])
    expect(m.vsBatters.map(l => [l.batterId, l.pa, l.so])).toEqual([['b1', 2, 1]])
  })

  // A single meeting is a line on her page even though the league board would never draw it,
  // and the most-faced opponent leads, not the best average.
  it('keeps every pair, most-faced first', () => {
    const plays = [
      pa('r1', two, p2, 'home_run'),
      pa('r1', two, p1, 'groundout'), pa('r1', two, p1, 'groundout'), pa('r1', two, p1, 'single'),
    ]
    const m = playerMatchups(new Set(['tw']), plays, [reg])
    expect(m.vsPitchers.map(l => l.pitcherId)).toEqual(['p1', 'p2'])
  })

  it('reads the playoffs only when asked', () => {
    const plays = [pa('r1', two, p1, 'single'), pa('p1', two, p1, 'single'), pa('p1', two, p2, 'walk')]
    expect(playerMatchups(new Set(['tw']), plays, [reg, semi]).vsPitchers).toHaveLength(1)
    expect(playerMatchups(new Set(['tw']), plays, [reg, semi], 'all').vsPitchers.map(l => l.pa)).toEqual([2, 1])
  })
})

describe('edgeOf', () => {
  const line = (h: number, ab: number, hr = 0) => ({ h, ab, hr, avg: ab > 0 ? h / ab : null })

  // Found Sep 28, 2026 sizing the league board: any home run used to hand the hitter the edge,
  // which put a .143 line on a board headed "the hitter's edge".
  it('does not give the hitter the edge for one home run in a poor line', () => {
    expect(edgeOf(line(1, 7, 1))).toBeNull()
    expect(edgeOf(line(1, 3, 1))).toBe('batter')
    expect(edgeOf(line(2, 9, 2))).toBe('batter')
  })

  it('needs three at-bats either way', () => {
    expect(edgeOf(line(2, 2))).toBeNull()
    expect(edgeOf(line(0, 2))).toBeNull()
    expect(edgeOf(line(0, 3))).toBe('pitcher')
    expect(edgeOf(line(2, 4))).toBe('batter')
  })

  it('never gives the pitcher the edge over a hitter who took her deep', () => {
    expect(edgeOf(line(1, 8, 1))).toBeNull()
  })
})

describe('matchupBoard', () => {
  const reg = { id: 'r1', game_type: 'regularSeason', counts_in_standings: true } as WpblGame
  const many = (b: [string, string], p: [string, string], events: string[]) => events.map(e => pa('r1', b, p, e))
  const lines = batterPitcherMatchups([
    ...many(['b1', 'Amy'], ['p1', 'Pia'], ['groundout', 'flyout', 'strikeout', 'strikeout', 'popup', 'lineout']), // 0-for-6
    ...many(['b2', 'Bea'], ['p1', 'Pia'], ['groundout', 'flyout', 'strikeout']),                                 // 0-for-3
    ...many(['b3', 'Cat'], ['p2', 'Quin'], ['single', 'double', 'groundout']),                                     // 2-for-3
    ...many(['b4', 'Dot'], ['p2', 'Quin'], ['home_run', 'home_run', 'groundout', 'flyout', 'walk']),              // 2-for-4, 2 HR
    ...many(['b5', 'Eve'], ['p2', 'Quin'], ['single', 'groundout', 'flyout', 'walk', 'walk', 'strikeout', 'groundout']), // 1-for-5, 7 PA
  ], [reg])

  it("leads the pitcher's board with the bigger shutout", () => {
    expect(matchupBoard(lines, 'pitcher').map(l => l.batterId)).toEqual(['b1', 'b2'])
  })

  it("leads the hitter's board by margin over a league-average line", () => {
    expect(matchupBoard(lines, 'batter').map(l => l.batterId)).toEqual(['b3', 'b4'])
  })

  // Found building the board: by average, the smallest perfect lines led it. A 3-for-3 and a
  // 4-for-5 are both on it; the longer run of hits is the stronger claim.
  it('does not let the smallest sample lead just by being small', () => {
    const board = matchupBoard(batterPitcherMatchups([
      ...many(['s1', 'Sam'], ['p9', 'Zed'], ['single', 'single', 'single']),                                  // 3-for-3
      ...many(['s2', 'Tia'], ['p9', 'Zed'], ['single', 'single', 'double', 'single', 'groundout']),           // 4-for-5
      ...many(['s3', 'Uma'], ['p8', 'Yan'], Array(20).fill('groundout')),                                      // league filler
    ], [reg]), 'batter')
    expect(board.map(l => l.batterId)).toEqual(['s2', 's1'])
  })

  it('orders the most-faced board by plate appearances and keeps every pair', () => {
    expect(matchupBoard(lines, 'faced').map(l => l.batterId)).toEqual(['b5', 'b1', 'b4', 'b2', 'b3'])
  })
})

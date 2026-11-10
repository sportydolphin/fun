import { describe, it, expect } from 'vitest'
import {
  runWpblFinder, encodeFinderQuery, decodeFinderQuery, parseFinderValue, describeFinderQuery, describeFinderConditions,
  finderColumns, finderFields, validFinderSort, decodeFinderByClub, decodeFinderPer, EMPTY_FINDER_QUERY, type FinderQuery,
} from '../derive/finder'
import { conditionsForPer, finderPlayerAt, hasMatchup, hasPlayerFilter } from '../../league/finder'
import type { WpblBattingLine, WpblFieldingLine, WpblGame, WpblPitchingLine, WpblPlayer } from '../types'
import type { InningPitchingLine, PlateAppearanceLine, TeamInningLine } from '../../league/inningLines'

// The finder, and the ways a query engine lies without looking like it.
//
// A board that is wrong shows a number nobody expected. A SEARCH that is wrong shows a shorter
// list, which is indistinguishable from the honest answer: a reader asking "has anyone ever
// struck out six" and getting four results has no way to tell that two were dropped. So the
// cases below are the ones where a plausible implementation quietly returns the wrong set.

const A = { id: 'a', name: 'Jaida Lee', team_id: 'NY' } as WpblPlayer
const B = { id: 'b', name: 'Ayami Sato', team_id: 'LA' } as WpblPlayer
// Traded: her roster row says LA, and the lines below were thrown for NY.
const C = { id: 'c', name: 'Emi Saiki', team_id: 'LA' } as WpblPlayer
const PLAYERS = [A, B, C]

const game = (o: Partial<WpblGame> = {}): WpblGame => ({
  id: 'g1', status: 'final', game_date: '2026-08-07',
  home_team_id: 'NY', away_team_id: 'LA',
  game_type: 'regular', counts_in_standings: true, ...o,
} as WpblGame)

const bat = (o: Partial<WpblBattingLine> = {}): WpblBattingLine => ({
  id: Math.random().toString(36).slice(2), game_id: 'g1', player_id: 'a', team_id: 'NY',
  ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0,
  hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0, ibb: 0, gdp: 0, tb: 0, lob: 0, ...o,
} as WpblBattingLine)

const pit = (o: Partial<WpblPitchingLine> = {}): WpblPitchingLine => ({
  id: Math.random().toString(36).slice(2), game_id: 'g1', player_id: 'a', team_id: 'NY',
  outs: 0, bf: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0, pitches: 0, decision: null,
  gs: 0, hbp: 0, ibb: 0, wp: 0, bk: 0, strikes: 0, doubles: 0, triples: 0, ...o,
} as WpblPitchingLine)

const q = (o: Partial<FinderQuery> = {}): FinderQuery => ({ ...EMPTY_FINDER_QUERY, ...o })

const names = (r: { rows: { name: string }[] }) => r.rows.map(x => x.name)

describe('the finder', () => {
  it('requires every condition at once, not any of them', () => {
    // The difference between AND and OR is the whole meaning of a two-condition query, and both
    // return a plausible-looking list. Five strikeouts AND at most one walk is one game here;
    // OR would be three.
    const games = [game()]
    const lines = [
      pit({ player_id: 'a', so: 6, bb: 0, outs: 12 }),  // both
      pit({ player_id: 'b', so: 6, bb: 4, outs: 12 }),  // strikeouts only
      pit({ player_id: 'c', so: 1, bb: 0, outs: 12 }),  // walks only
    ]
    const r = runWpblFinder('pitching', [], lines, PLAYERS, games, q({
      conditions: [{ field: 'so', op: 'gte', value: 5 }, { field: 'bb', op: 'lte', value: 1 }],
    }))
    expect(names(r)).toEqual(['Jaida Lee'])
    expect(r.total).toBe(1)
  })

  it('compares at least, at most and exactly', () => {
    const games = [game()]
    const lines = [1, 2, 3, 4].map(h => bat({ player_id: 'a', ab: 4, h }))
    const run = (op: 'gte' | 'lte' | 'eq', value: number) => runWpblFinder(
      'hitting', lines, [], PLAYERS, games, q({ conditions: [{ field: 'h', op, value }] })).total
    expect(run('gte', 3)).toBe(2)
    expect(run('lte', 2)).toBe(2)
    expect(run('eq', 3)).toBe(1)
  })

  // INNINGS ARE THE ONE FIELD WHERE THE STORED UNIT AND THE TYPED ONE DIFFER, and reading "4.2"
  // as four point two is wrong by a third of an inning while looking perfectly right.
  it('reads an innings threshold as innings, not as a decimal', () => {
    expect(parseFinderValue('pitching', 'ip', '4')).toBe(12)
    expect(parseFinderValue('pitching', 'ip', '4.2')).toBe(14)
    // Nothing else on either side is in thirds, so everything else parses as a plain number.
    expect(parseFinderValue('pitching', 'so', '5')).toBe(5)

    const games = [game()]
    const lines = [pit({ player_id: 'a', outs: 13 }), pit({ player_id: 'b', outs: 11 })]
    const r = runWpblFinder('pitching', [], lines, PLAYERS, games, q({
      conditions: [{ field: 'ip', op: 'gte', value: parseFinderValue('pitching', 'ip', '4') }],
    }))
    expect(names(r)).toEqual(['Jaida Lee'])
    expect(r.rows[0].headlineDisplay).toBe('4.1')
  })

  it('matches nothing on a field it does not recognize', () => {
    // A hand-edited link naming a stat that does not exist must not quietly drop the condition:
    // that answers a WIDER question than the URL asks, and the reader has no way to see it. An
    // empty result is visibly the wrong shape and gets looked at.
    const r = runWpblFinder('pitching', [], [pit({ so: 9, outs: 15 })], PLAYERS, [game()], q({
      conditions: [{ field: 'wins', op: 'gte', value: 1 }],
    }))
    expect(r.total).toBe(0)
  })

  it('filters on the club from the LINE, not the roster row', () => {
    // Emi Saiki's roster row says LA and this line was thrown for NY. Filtering by roster would
    // put her August under a club she had not joined; see CLAUDE.md.
    const r = runWpblFinder('pitching', [], [pit({ player_id: 'c', team_id: 'NY', so: 6, outs: 12 })],
      PLAYERS, [game()], q({ teamId: 'NY', conditions: [{ field: 'so', op: 'gte', value: 5 }] }))
    expect(names(r)).toEqual(['Emi Saiki'])
    expect(r.rows[0].teamId).toBe('NY')

    const other = runWpblFinder('pitching', [], [pit({ player_id: 'c', team_id: 'NY', so: 6, outs: 12 })],
      PLAYERS, [game()], q({ teamId: 'LA', conditions: [{ field: 'so', op: 'gte', value: 5 }] }))
    expect(other.total).toBe(0)
  })

  it('works out the opponent and the venue from the line\'s own side', () => {
    // The game row names a home club and an away club, and which one the player was on is a fact
    // about her LINE. Read the other way round, every filter here is inverted for half the league.
    const games = [game({ id: 'g1', home_team_id: 'NY', away_team_id: 'LA' })]
    const lines = [
      pit({ player_id: 'a', team_id: 'NY', so: 6, outs: 12 }),  // home, vs LA
      pit({ player_id: 'b', team_id: 'LA', so: 6, outs: 12 }),  // away, at NY
    ]
    const cond = [{ field: 'so', op: 'gte' as const, value: 5 }]
    expect(names(runWpblFinder('pitching', [], lines, PLAYERS, games, q({ venue: 'home', conditions: cond }))))
      .toEqual(['Jaida Lee'])
    expect(names(runWpblFinder('pitching', [], lines, PLAYERS, games, q({ venue: 'away', conditions: cond }))))
      .toEqual(['Ayami Sato'])
    expect(names(runWpblFinder('pitching', [], lines, PLAYERS, games, q({ oppId: 'LA', conditions: cond }))))
      .toEqual(['Jaida Lee'])
  })

  it('keeps the postseason and the regular season apart', () => {
    const games = [
      game({ id: 'reg' }),
      game({ id: 'post', game_type: 'postseason', counts_in_standings: true }),
    ]
    const lines = [
      pit({ player_id: 'a', game_id: 'reg', so: 6, outs: 12 }),
      pit({ player_id: 'b', game_id: 'post', so: 6, outs: 12 }),
    ]
    const cond = [{ field: 'so', op: 'gte' as const, value: 5 }]
    expect(runWpblFinder('pitching', [], lines, PLAYERS, games, q({ scope: 'regular', conditions: cond })).total).toBe(1)
    expect(runWpblFinder('pitching', [], lines, PLAYERS, games, q({ scope: 'postseason', conditions: cond })).total).toBe(1)
    expect(runWpblFinder('pitching', [], lines, PLAYERS, games, q({ scope: 'all', conditions: cond })).total).toBe(2)
  })

  it('will not match a line from a game still being played', () => {
    const games = [game({ id: 'done' }), game({ id: 'live', status: 'live' })]
    const lines = [
      pit({ player_id: 'a', game_id: 'done', so: 6, outs: 12 }),
      pit({ player_id: 'b', game_id: 'live', so: 6, outs: 6 }),
    ]
    const r = runWpblFinder('pitching', [], lines, PLAYERS, games, q({
      conditions: [{ field: 'so', op: 'gte', value: 5 }],
    }))
    expect(names(r)).toEqual(['Jaida Lee'])
  })

  it('counts how many times each player did it', () => {
    // The second answer, and the more interesting one: the list says when, this says who.
    const games = [game({ id: 'g1' }), game({ id: 'g2' }), game({ id: 'g3' })]
    const lines = [
      pit({ player_id: 'a', game_id: 'g1', so: 6, outs: 12 }),
      pit({ player_id: 'a', game_id: 'g2', so: 5, outs: 12 }),
      pit({ player_id: 'b', game_id: 'g3', so: 7, outs: 12 }),
    ]
    const r = runWpblFinder('pitching', [], lines, PLAYERS, games, q({
      conditions: [{ field: 'so', op: 'gte', value: 5 }],
    }))
    expect(r.tally.map(t => [t.name, t.games])).toEqual([['Jaida Lee', 2], ['Ayami Sato', 1]])
  })

  it('files a traded player under the club they matched for most, not the roster row', () => {
    // Emi Saiki's roster row says LA. She matched twice for NY and once for LA, so her one
    // tally line belongs under NY: filing it under "now" would badge her NY games with a club
    // she reached later. See CLAUDE.md on team_id meaning "now".
    const games = [game({ id: 'g1' }), game({ id: 'g2' }), game({ id: 'g3' })]
    const lines = [
      pit({ player_id: 'c', game_id: 'g1', team_id: 'NY', so: 6, outs: 12 }),
      pit({ player_id: 'c', game_id: 'g2', team_id: 'NY', so: 5, outs: 12 }),
      pit({ player_id: 'c', game_id: 'g3', team_id: 'LA', so: 7, outs: 12 }),
    ]
    const r = runWpblFinder('pitching', [], lines, PLAYERS, games, q({
      conditions: [{ field: 'so', op: 'gte', value: 5 }],
    }))
    expect(r.tally).toHaveLength(1)
    expect(r.tally[0].games).toBe(3)
    expect(r.tally[0].teamId).toBe('NY')
  })

  // WHAT WAS SEARCHED IS PART OF A ZERO ANSWER. "Nobody has done this" and "your filters left
  // three lines to look at" are different answers, and a bare count of every stored line would
  // tell the reader neither: 97 of the season's batting lines are a pitcher's all-zero row.
  it('counts only real appearances as searched', () => {
    const games = [game()]
    const lines = [
      bat({ player_id: 'a', ab: 4, h: 1 }),
      bat({ player_id: 'b', ab: 0 }),             // a pitcher's empty line
      bat({ player_id: 'c', ab: 0, bb: 1 }),      // walked: still a trip to the plate
    ]
    const r = runWpblFinder('hitting', lines, [], PLAYERS, games, q({
      conditions: [{ field: 'h', op: 'gte', value: 9 }],
    }))
    expect(r.total).toBe(0)
    expect(r.searched).toBe(2)
  })

  it('measures every row by the FIRST condition, so the list sorts by what was asked', () => {
    const games = [game({ id: 'g1' }), game({ id: 'g2' })]
    const lines = [
      pit({ player_id: 'a', game_id: 'g1', so: 5, outs: 18 }),
      pit({ player_id: 'b', game_id: 'g2', so: 8, outs: 12 }),
    ]
    const r = runWpblFinder('pitching', [], lines, PLAYERS, games, q({
      conditions: [{ field: 'so', op: 'gte', value: 5 }, { field: 'ip', op: 'gte', value: 12 }],
    }))
    expect(r.headlineField).toBe('so')
    expect(names(r)).toEqual(['Ayami Sato', 'Jaida Lee'])
  })
})

describe('the query in the address bar', () => {
  it('survives a round trip', () => {
    const conditions = [
      { field: 'so', op: 'gte' as const, value: 5 },
      { field: 'bb', op: 'lte' as const, value: 1 },
    ]
    const encoded = encodeFinderQuery(q({ conditions }))
    expect(encoded).toBe('so.gte.5~bb.lte.1')
    expect(decodeFinderQuery(encoded, 'pitching')).toEqual(conditions)
  })

  // EVERY CHARACTER URL-SAFE UNENCODED is the point of the grammar: `>=` would have come out as
  // %3E%3D and made a shared link look broken, which is the difference between a link somebody
  // pastes into a chat and one they decide not to.
  it('spells the query in characters a url does not have to escape', () => {
    const encoded = encodeFinderQuery(q({ conditions: [{ field: 'ip', op: 'gte', value: 14 }] }))
    expect(encodeURIComponent(encoded).replace(/%7E/gi, '~')).toBe(encoded)
  })

  it('drops a condition it cannot read rather than refusing the whole link', () => {
    // A truncated or hand-edited link should still show something. A dropped condition WIDENS
    // the result, which is visible in the count; the opposite, a condition with a nonsense
    // field kept, is what `runWpblFinder` refuses above.
    expect(decodeFinderQuery('so.gte.5~nonsense.gte.2~bb.sideways.1', 'pitching'))
      .toEqual([{ field: 'so', op: 'gte', value: 5 }])
    expect(decodeFinderQuery('', 'pitching')).toEqual([])
    expect(decodeFinderQuery(null, 'pitching')).toEqual([])
  })

  it('reads a query against the side it belongs to', () => {
    // The two sides share stat keys that mean opposite things: `so` is a strikeout taken for a
    // hitter and one thrown for a pitcher, and `ip` exists on only one of them.
    expect(decodeFinderQuery('ip.gte.12', 'pitching')).toHaveLength(1)
    expect(decodeFinderQuery('ip.gte.12', 'hitting')).toHaveLength(0)
  })

  it('will not take more conditions than the board can draw', () => {
    const many = Array.from({ length: 20 }, () => 'so.gte.1').join('~')
    expect(decodeFinderQuery(many, 'pitching')).toHaveLength(6)
  })

  it('sorts by the chosen column BEFORE it caps, not within the capped rows', () => {
    // A table re-sorted by walks has to show the most walks across every match. Sorting only the
    // fifty the question's own stat picked would show a confident, wrong top row.
    const games = [game()]
    const lines = [
      pit({ player_id: 'a', so: 9, bb: 0, outs: 12 }),
      pit({ player_id: 'b', so: 8, bb: 1, outs: 12 }),
      pit({ player_id: 'c', so: 5, bb: 6, outs: 12 }),
    ]
    const cond = [{ field: 'so', op: 'gte' as const, value: 5 }]
    expect(names(runWpblFinder('pitching', [], lines, PLAYERS, games, q({ conditions: cond }), 2)))
      .toEqual(['Jaida Lee', 'Ayami Sato'])
    expect(names(runWpblFinder('pitching', [], lines, PLAYERS, games, q({ conditions: cond }), 2, { key: 'bb', desc: true })))
      .toEqual(['Emi Saiki', 'Ayami Sato'])
    expect(names(runWpblFinder('pitching', [], lines, PLAYERS, games, q({ conditions: cond }), 3, { key: 'bb', desc: false })))
      .toEqual(['Jaida Lee', 'Ayami Sato', 'Emi Saiki'])
  })

  it('sorts by date, newest first', () => {
    const games = [game({ id: 'g1', game_date: '2026-08-01' }), game({ id: 'g2', game_date: '2026-08-09' })]
    const lines = [pit({ game_id: 'g1', player_id: 'a', so: 9, outs: 12 }), pit({ game_id: 'g2', player_id: 'b', so: 5, outs: 12 })]
    const r = runWpblFinder('pitching', [], lines, PLAYERS, games,
      q({ conditions: [{ field: 'so', op: 'gte', value: 5 }] }), 50, { key: 'date', desc: true })
    expect(names(r)).toEqual(['Ayami Sato', 'Jaida Lee'])
  })

  it('counts each player\'s appearances in the games searched, for "2 of 3"', () => {
    // The denominator honors the club, venue and opponent filters: appearances in games the
    // question did not look at would make every rate look rarer than it is.
    const games = [game({ id: 'g1' }), game({ id: 'g2' }), game({ id: 'g3', home_team_id: 'LA', away_team_id: 'NY' })]
    const lines = [
      pit({ game_id: 'g1', player_id: 'a', so: 7, outs: 12 }),
      pit({ game_id: 'g2', player_id: 'a', so: 2, outs: 12 }),
      pit({ game_id: 'g3', player_id: 'a', so: 8, outs: 12 }),
    ]
    const cond = [{ field: 'so', op: 'gte' as const, value: 5 }]
    expect(runWpblFinder('pitching', [], lines, PLAYERS, games, q({ conditions: cond })).tally[0])
      .toMatchObject({ games: 2, played: 3 })
    expect(runWpblFinder('pitching', [], lines, PLAYERS, games, q({ conditions: cond, venue: 'home' })).tally[0])
      .toMatchObject({ games: 1, played: 2 })
  })

  it('draws every column a condition asks about, and forgets a sort on one that is gone', () => {
    const bk = { conditions: [{ field: 'bk', op: 'gte' as const, value: 2 }] }
    expect(finderColumns('pitching', bk).map(c => c.key)).toContain('bk')
    expect(finderColumns('pitching', { conditions: [] }).map(c => c.key)).not.toContain('bk')
    expect(validFinderSort('pitching', bk, { key: 'bk', desc: true })).toEqual({ key: 'bk', desc: true })
    expect(validFinderSort('pitching', { conditions: [] }, { key: 'bk', desc: true })).toBeNull()
    expect(validFinderSort('pitching', { conditions: [] }, { key: 'date', desc: true })).toEqual({ key: 'date', desc: true })
  })

  it('reads the question back in words', () => {
    expect(describeFinderQuery('pitching', q({
      conditions: [{ field: 'so', op: 'gte', value: 5 }, { field: 'ip', op: 'gte', value: 14 }],
    }))).toBe('Strikeouts at least 5 and Innings pitched at least 4.2')
  })
})

// A SEASON IS THE SAME ENGINE OVER SUMS, and the ways it can lie are the sum's: a line counted
// twice or not at all, a rate over a sample too small to mean anything, and a cut applied after
// summing instead of before.
describe('season totals', () => {
  const games = ['g1', 'g2', 'g3'].map((id, i) => game({ id, game_date: `2026-08-0${i + 1}`, home_team_id: i === 2 ? 'LA' : 'NY', away_team_id: i === 2 ? 'NY' : 'LA' }))
  const season = (o: Partial<FinderQuery> = {}) => q({ per: 'season', ...o })

  it('sums each player\'s lines and asks the conditions of the sum', () => {
    const lines = [
      bat({ player_id: 'a', game_id: 'g1', ab: 4, h: 1, hr: 1 }),
      bat({ player_id: 'a', game_id: 'g2', ab: 4, h: 2, hr: 1 }),
      bat({ player_id: 'b', game_id: 'g1', team_id: 'LA', ab: 4, h: 3, hr: 1 }),
    ]
    const r = runWpblFinder('hitting', lines, [], PLAYERS, games, season({ conditions: [{ field: 'hr', op: 'gte', value: 2 }] }))
    expect(names(r)).toEqual(['Jaida Lee'])
    expect(r.rows[0].values).toMatchObject({ g: 2, hr: 2, h: 3, ab: 8, avg: 375 })
    // No game behind a season row, and no tally: each player is one row already.
    expect(r.rows[0].game).toBeNull()
    expect(r.tally).toEqual([])
  })

  it('applies the venue BEFORE summing, so "at home" is a home split', () => {
    const lines = [
      bat({ player_id: 'a', game_id: 'g1', ab: 4, hr: 1 }),  // home
      bat({ player_id: 'a', game_id: 'g3', ab: 4, hr: 1 }),  // away
    ]
    const r = runWpblFinder('hitting', lines, [], PLAYERS, games, season({ venue: 'home', conditions: [{ field: 'hr', op: 'gte', value: 2 }] }))
    expect(r.total).toBe(0)
    expect(runWpblFinder('hitting', lines, [], PLAYERS, games, season({ conditions: [{ field: 'hr', op: 'gte', value: 2 }] })).total).toBe(1)
  })

  it('holds a rate to the qualifying bar, unless the reader set one', () => {
    const lines = [
      bat({ player_id: 'a', game_id: 'g1', ab: 2, h: 2 }),              // 1.000 in 2 PA
      ...['g1', 'g2', 'g3'].map(g => bat({ player_id: 'b', game_id: g, team_id: 'LA', ab: 4, h: 2 })),  // .500 in 12
    ]
    const avg = [{ field: 'avg', op: 'gte' as const, value: 400 }]
    const qualify = { minPa: 10, minOuts: 30 }
    const r = runWpblFinder('hitting', lines, [], PLAYERS, games, season({ conditions: avg }), 50, null, { qualify })
    expect(names(r)).toEqual(['Ayami Sato'])
    expect(r.qualifier).toEqual({ field: 'pa', min: 10 })
    // A plate-appearance condition of the reader's own replaces the bar.
    const own = runWpblFinder('hitting', lines, [], PLAYERS, games,
      season({ conditions: [...avg, { field: 'pa', op: 'gte', value: 1 }] }), 50, null, { qualify })
    expect(names(own)).toEqual(['Jaida Lee', 'Ayami Sato'])
    expect(own.qualifier).toBeNull()
    // A count is not a rate and needs no bar.
    expect(runWpblFinder('hitting', lines, [], PLAYERS, games, season({ conditions: [{ field: 'h', op: 'gte', value: 1 }] }),
      50, null, { qualify }).qualifier).toBeNull()
  })

  it('works an ERA out on the basis it is handed, and lists the lowest first', () => {
    const lines = [
      pit({ player_id: 'a', game_id: 'g1', outs: 21, er: 3 }),  // 3.00 per 7, 3.86 per 9
      pit({ player_id: 'b', game_id: 'g1', team_id: 'LA', outs: 21, er: 1 }),
    ]
    const era = [{ field: 'era', op: 'lte' as const, value: 500 }]
    const seven = runWpblFinder('pitching', [], lines, PLAYERS, games, season({ conditions: era }), 50, null, { eraInnings: 7 })
    expect(names(seven)).toEqual(['Ayami Sato', 'Jaida Lee'])
    expect(seven.rows[1].headlineDisplay).toBe('3.00')
    const nine = runWpblFinder('pitching', [], lines, PLAYERS, games, season({ conditions: era }), 50, null, { eraInnings: 9 })
    expect(nine.rows[1].headlineDisplay).toBe('3.86')
  })

  it('counts a decision once a game, and sums it over a season', () => {
    const lines = [
      pit({ player_id: 'a', game_id: 'g1', outs: 18, so: 10, decision: 'W', gs: 1 }),
      pit({ player_id: 'a', game_id: 'g2', outs: 18, so: 4, decision: 'W', gs: 1 }),
      pit({ player_id: 'a', game_id: 'g3', outs: 18, so: 11, decision: 'L', gs: 1 }),
      pit({ player_id: 'b', game_id: 'g1', team_id: 'LA', outs: 3, so: 1, decision: 'S' }),
    ]
    // A night: ten strikeouts in a win is one game, not the loss with eleven.
    const night = runWpblFinder('pitching', [], lines, PLAYERS, games, q({
      conditions: [{ field: 'so', op: 'gte', value: 10 }, { field: 'w', op: 'eq', value: 1 }],
    }))
    expect(night.total).toBe(1)
    expect(night.rows[0].detail).toMatch(/^Win, /)
    // A season: the two wins add up, the starts with them, and the closer's save is his own.
    const wins = runWpblFinder('pitching', [], lines, PLAYERS, games, season({ conditions: [{ field: 'w', op: 'gte', value: 2 }] }))
    expect(names(wins)).toEqual(['Jaida Lee'])
    expect(wins.rows[0].values).toMatchObject({ w: 2, l: 1, gs: 3, sv: 0 })
    expect(names(runWpblFinder('pitching', [], lines, PLAYERS, games, season({ conditions: [{ field: 'sv', op: 'gte', value: 1 }] }))))
      .toEqual(['Ayami Sato'])
  })

  it('reads a rate typed with or without its leading zero', () => {
    expect(parseFinderValue('hitting', 'avg', '.300')).toBe(300)
    expect(parseFinderValue('hitting', 'avg', '0.300')).toBe(300)
    expect(parseFinderValue('hitting', 'ops', '1.050')).toBe(1050)
    expect(parseFinderValue('pitching', 'era', '2.45')).toBe(245)
  })

  it('carries the grain in the address, and refuses a rate on a game question', () => {
    const query = season({ conditions: [{ field: 'avg', op: 'gte', value: 300 }] })
    const raw = encodeFinderQuery(query)
    expect(raw).toBe('season~avg.gte.300')
    expect(decodeFinderPer(raw)).toBe('season')
    expect(decodeFinderQuery(raw, 'hitting')).toEqual(query.conditions)
    expect(decodeFinderQuery('avg.gte.300', 'hitting')).toEqual([])
    expect(describeFinderQuery('hitting', query)).toBe('Batting average at least .300')
  })
})

describe('the fielding side', () => {
  const fld = (o: Partial<WpblFieldingLine> = {}): WpblFieldingLine => ({
    id: Math.random().toString(36).slice(2), game_id: 'g1', player_id: 'a', team_id: 'NY',
    po: 0, a: 0, e: 0, pb: 0, sba: 0, ci: 0, dp: 0, created_at: '', ...o,
  } as WpblFieldingLine)
  const games = ['g1', 'g2', 'g3', 'g4'].map((id, i) => game({ id, game_date: `2026-08-0${i + 1}` }))

  it('searches the fielding lines, which ride in the options', () => {
    const fielding = [fld({ player_id: 'a', e: 2, po: 3 }), fld({ player_id: 'b', team_id: 'LA', e: 1, a: 4 })]
    const r = runWpblFinder('fielding', [], [], PLAYERS, games, q({ conditions: [{ field: 'e', op: 'gte', value: 2 }] }),
      50, null, { fielding })
    expect(names(r)).toEqual(['Jaida Lee'])
    expect(r.rows[0].values).toMatchObject({ tc: 5, po: 3, e: 2 })
    expect(r.rows[0].detail).toBe('3 PO, 0 A, 2 E')
    // Asked without the lines, the side searches nothing rather than borrowing another side's.
    expect(runWpblFinder('fielding', [bat({ ab: 4 })], [], PLAYERS, games, q(), 50, null, {}).total).toBe(0)
  })

  // A FIELDING LINE IS WRITTEN ONLY FOR A NIGHT WITH A PLAY TO MAKE, so counting them undercounts a
  // fielder's games, which is the bar a fielding percentage qualifies on. Games come off every line.
  it('counts a fielder\'s games off every line, and qualifies a percentage on them', () => {
    const batting = ['g1', 'g2', 'g3', 'g4'].map(g => bat({ game_id: g, player_id: 'a', ab: 3 }))
      .concat([bat({ game_id: 'g1', player_id: 'b', team_id: 'LA', ab: 3 })])
    const fielding = [
      fld({ game_id: 'g1', player_id: 'a', po: 4 }), fld({ game_id: 'g3', player_id: 'a', po: 5, a: 1 }),
      fld({ game_id: 'g1', player_id: 'b', team_id: 'LA', po: 2 }),
    ]
    const season = (conditions: FinderQuery['conditions']) => runWpblFinder('fielding', batting, [], PLAYERS, games,
      q({ per: 'season', conditions }), 50, null, { fielding, qualify: { minPa: 0, minOuts: 0, minG: 3 } })
    const r = season([{ field: 'fpct', op: 'gte', value: 1000 }])
    // Four games played for Lee, though only two of them had a fielding line; Sato's one game is
    // under the bar.
    expect(names(r)).toEqual(['Jaida Lee'])
    expect(r.rows[0].values).toMatchObject({ g: 4, tc: 10, fpct: 1000 })
    expect(r.qualifier).toEqual({ field: 'g', min: 3 })
    // A games condition is the reader's own bar.
    expect(names(season([{ field: 'fpct', op: 'gte', value: 1000 }, { field: 'g', op: 'gte', value: 1 }])))
      .toEqual(['Ayami Sato', 'Jaida Lee'])
  })

  it('reads the tally against games played, not nights with a chance', () => {
    const batting = ['g1', 'g2', 'g3'].map(g => bat({ game_id: g, player_id: 'a', ab: 3 }))
    const fielding = [fld({ game_id: 'g1', player_id: 'a', e: 1, po: 1 })]
    const r = runWpblFinder('fielding', batting, [], PLAYERS, games, q({ conditions: [{ field: 'e', op: 'gte', value: 1 }] }),
      50, null, { fielding })
    expect(r.tally[0]).toMatchObject({ games: 1, played: 3 })
  })

  it('keeps a fielding question in the address, and reads it back in words', () => {
    const raw = encodeFinderQuery({ per: 'season', conditions: [{ field: 'fpct', op: 'gte', value: 980 }] })
    expect(decodeFinderQuery(raw, 'fielding')).toEqual([{ field: 'fpct', op: 'gte', value: 980 }])
    expect(decodeFinderQuery(raw, 'hitting')).toEqual([])
    expect(parseFinderValue('fielding', 'fpct', '.980')).toBe(980)
    expect(describeFinderQuery('fielding', { conditions: [{ field: 'e', op: 'eq', value: 0 }, { field: 'tc', op: 'gte', value: 8 }] }))
      .toBe('Errors exactly 0 and Total chances at least 8')
    expect(finderColumns('fielding', { conditions: [{ field: 'pb', op: 'gte', value: 1 }] }).map(c => c.key))
      .toEqual(['tc', 'po', 'a', 'e', 'dp', 'pb'])
  })
})

describe('the finder, by the inning', () => {
  const inn = (o: Partial<InningPitchingLine> = {}): InningPitchingLine => ({
    id: Math.random().toString(36).slice(2), game_id: 'g1', player_id: 'a', team_id: 'NY', inning: 1, half: 'top', sequence: 0,
    bf: 3, outs: 3, so: 0, bb: 0, hbp: 0, h: 0, hr: 0, r: 0, pitches: 12, strikes: 8, sb: 0, cs: 0, pk: 0, wp: 0, pb: 0, bk: 0, ...o,
  })

  it('finds three strikeouts in one inning, not across a game', () => {
    // Five strikeouts in a game spread over three innings is not three in an inning, and a finder
    // that summed the night would say it was.
    const innings = [
      inn({ player_id: 'a', inning: 1, so: 2 }), inn({ player_id: 'a', inning: 2, so: 2 }), inn({ player_id: 'a', inning: 3, so: 1 }),
      inn({ player_id: 'b', inning: 4, half: 'bottom', team_id: 'LA', so: 3 }),
    ]
    const r = runWpblFinder('pitching', [], [], PLAYERS, [game()], q({ per: 'inning', conditions: [{ field: 'so', op: 'gte', value: 3 }] }),
      50, null, { innings })
    expect(names(r)).toEqual(['Ayami Sato'])
    expect(r.rows[0].inning).toEqual({ inning: 4, half: 'bottom', sequence: 0 })
    expect(r.rows[0].detail).toBe('Bottom 4th: 3 BF, 0 H, 0 R, 3 K, 12 pitches')
    expect(r.tally[0]).toMatchObject({ games: 1, played: 1 })
  })

  it('asks an immaculate inning as two plain conditions', () => {
    const innings = [inn({ so: 3, pitches: 9 }), inn({ so: 3, pitches: 13 })]
    const r = runWpblFinder('pitching', [], [], PLAYERS, [game()], q({ per: 'inning', conditions: [
      { field: 'so', op: 'gte', value: 3 }, { field: 'pitches', op: 'lte', value: 9 },
    ] }), 50, null, { innings })
    expect(r.total).toBe(1)
  })

  it('matches nothing on a field an inning cannot have, or on another side', () => {
    const innings = [inn({ so: 3 })]
    const ip = runWpblFinder('pitching', [], [], PLAYERS, [game()], q({ per: 'inning', conditions: [{ field: 'ip', op: 'gte', value: 0 }] }),
      50, null, { innings })
    expect(ip.total).toBe(0)
    const hitting = runWpblFinder('hitting', [bat({ ab: 3, h: 3 })], [], PLAYERS, [game()], q({ per: 'inning' }), 50, null, { innings })
    expect(hitting.total).toBe(0)
  })

  it('keeps the grain in the address and drops a game-only field', () => {
    const raw = encodeFinderQuery({ per: 'inning', conditions: [{ field: 'so', op: 'gte', value: 3 }, { field: 'inn', op: 'gte', value: 6 }] })
    expect(raw).toBe('inning~so.gte.3~inn.gte.6')
    expect(decodeFinderPer(raw)).toBe('inning')
    expect(decodeFinderQuery(raw, 'pitching')).toHaveLength(2)
    expect(decodeFinderQuery('inning~ip.gte.3', 'pitching')).toEqual([])
    expect(describeFinderQuery('pitching', { per: 'inning', conditions: [] })).toBe('every inning')
    expect(finderColumns('pitching', { per: 'inning', conditions: [] }).map(c => c.key))
      .toEqual(['inn', 'bf', 'h', 'r', 'bb', 'so', 'pitches'])
  })
})

describe('the finder, by the plate appearance', () => {
  const pa = (o: Partial<PlateAppearanceLine> = {}): PlateAppearanceLine => ({
    id: Math.random().toString(36).slice(2), game_id: 'g1', sequence: 10, inning: 3, half: 'top',
    batter_id: 'a', pitcher_id: 'b', batting_team: 'NY', fielding_team: 'LA', event: 'HR',
    paouts: 0, on: 0, risp: 0, balls: 0, scount: 2, pitches: 4, strikes: 3, fouls: 1,
    h: 1, doubles: 0, triples: 0, hr: 1, tb: 4, bb: 0, so: 0, hbp: 0, runs: 1, walkoff: 0, hrrow: 0, krow: 0, retired: 0, ...o,
  })
  const ask = (side: 'hitting' | 'pitching', conditions: FinderQuery['conditions'], plateAppearances: PlateAppearanceLine[]) =>
    runWpblFinder(side, [], [], PLAYERS, [game()], q({ per: 'pa', conditions }), 50, null, { plateAppearances })

  it('files one plate appearance under the batter on Hitting and the pitcher on Pitching', () => {
    const lines = [pa(), pa({ balls: 1, scount: 1 })]
    const onTwo = [{ field: 'hr', op: 'gte' as const, value: 1 }, { field: 'balls', op: 'eq' as const, value: 0 }, { field: 'scount', op: 'eq' as const, value: 2 }]
    const hit = ask('hitting', onTwo, lines)
    expect(names(hit)).toEqual(['Jaida Lee'])
    expect(hit.rows[0]).toMatchObject({ teamId: 'NY', inning: { inning: 3, half: 'top', sequence: 10, event: 'HR' } })
    expect(hit.rows[0].detail).toBe('Top 3rd, 0 out, bases empty, 0-2: HR, 1 run, 4 pitches')
    const pit = ask('pitching', onTwo, lines)
    expect(pit.rows[0]).toMatchObject({ name: 'Ayami Sato', teamId: 'LA' })
  })

  it('keeps the grain in the address, and no fielding side', () => {
    const raw = encodeFinderQuery({ per: 'pa', conditions: [{ field: 'on', op: 'eq', value: 3 }, { field: 'bb', op: 'gte', value: 1 }] })
    expect(raw).toBe('pa~on.eq.3~bb.gte.1')
    expect(decodeFinderPer(raw)).toBe('pa')
    expect(decodeFinderPer('pa.gte.4')).toBe('game')
    expect(decodeFinderQuery(raw, 'hitting')).toHaveLength(2)
    expect(decodeFinderQuery(raw, 'fielding')).toEqual([])
    expect(finderColumns('hitting', { per: 'pa', conditions: [] }).map(c => c.key))
      .toEqual(['inn', 'paouts', 'on', 'balls', 'scount', 'pitches', 'runs'])
  })

  it('reads a situation back the way it is said', () => {
    const conditions = [
      { field: 'balls', op: 'eq' as const, value: 0 }, { field: 'scount', op: 'eq' as const, value: 2 },
      { field: 'hr', op: 'gte' as const, value: 1 }, { field: 'on', op: 'eq' as const, value: 3 },
      { field: 'paouts', op: 'eq' as const, value: 2 }, { field: 'walkoff', op: 'eq' as const, value: 1 },
    ]
    expect(describeFinderQuery('hitting', { per: 'pa', conditions }))
      .toBe('0-2 count and Home runs at least 1 and Bases loaded and 2 out and Walk-off')
    // A range of counts, or the same fields on another grain, read field by field.
    expect(describeFinderQuery('hitting', { per: 'pa', conditions: [{ field: 'balls', op: 'gte', value: 2 }] }))
      .toBe('Balls in the count at least 2')
    expect(describeFinderQuery('pitching', { per: 'inning', conditions: [{ field: 'so', op: 'gte', value: 3 }, { field: 'inn', op: 'gte', value: 6 }] }))
      .toBe('Strikeouts at least 3 and 6th inning or later')
    expect(describeFinderQuery('hitting', { per: 'pa', conditions: [{ field: 'h', op: 'gte', value: 1 }, { field: 'risp', op: 'eq', value: 1 }] }))
      .toBe('Hits at least 1 and Runner in scoring position')
  })

  // The search card's chips: one per phrase, and a phrase made of two conditions drops both.
  it('names each condition as a chip, with the conditions it stands for', () => {
    const conditions = [
      { field: 'hr', op: 'gte' as const, value: 1 }, { field: 'balls', op: 'eq' as const, value: 0 },
      { field: 'on', op: 'eq' as const, value: 3 }, { field: 'scount', op: 'eq' as const, value: 2 },
    ]
    expect(describeFinderConditions('hitting', { per: 'pa', conditions }, true)).toEqual([
      { text: 'Home runs ≥ 1', indices: [0] },
      { text: '0-2 count', indices: [1, 3] },
      { text: 'Bases loaded', indices: [2] },
    ])
  })

  // A YES-OR-NO QUESTION. Every home run is HR 1, so ranking by it ties everyone and leads every row
  // with the same 1. The rows come back in date order, flagged, led by what tells them apart.
  it('reads a question every match answers alike as a log in date order', () => {
    const games = [game({ id: 'g1', game_date: '2026-08-07' }), game({ id: 'g2', game_date: '2026-08-01' })]
    const lines = [pa({ game_id: 'g1', runs: 1 }), pa({ game_id: 'g2', runs: 4 }), pa({ game_id: 'g1', sequence: 20, runs: 2 })]
    const r = runWpblFinder('hitting', [], [], PLAYERS, games, q({ per: 'pa', conditions: [{ field: 'hr', op: 'gte', value: 1 }] }), 50, null, { plateAppearances: lines })
    expect(r.flat).toBe(true)
    expect(r.headlineField).toBe('runs')
    expect(r.rows.map(x => x.game?.id)).toEqual(['g2', 'g1', 'g1'])
    expect(r.rows.map(x => x.headlineDisplay)).toEqual(['4', '1', '2'])
    // Two different first stats is a ranking again, led by the stat asked about.
    const ranked = runWpblFinder('hitting', [], [], PLAYERS, games, q({ per: 'pa', conditions: [{ field: 'runs', op: 'gte', value: 1 }] }), 50, null, { plateAppearances: lines })
    expect(ranked.flat).toBe(false)
    expect(ranked.headlineField).toBe('runs')
    expect(ranked.rows.map(x => x.headline)).toEqual([4, 2, 1])
  })

  // THE MATCHUP. One batter, one pitcher or both, cut before anything is counted, so the tally's
  // "of N" is the trips against that pitcher rather than the season's.
  describe('a matchup', () => {
    const lines = [
      pa({ sequence: 10, batter_id: 'a', pitcher_id: 'b' }),
      pa({ sequence: 20, batter_id: 'a', pitcher_id: 'b', h: 0, hr: 0, tb: 0, so: 1, event: 'K' }),
      pa({ sequence: 30, batter_id: 'a', pitcher_id: 'c' }),
      pa({ sequence: 40, batter_id: 'c', pitcher_id: 'b', h: 0, hr: 0, tb: 0, event: 'Out' }),
    ]
    const run = (side: 'hitting' | 'pitching', o: Partial<FinderQuery>) =>
      runWpblFinder(side, [], [], PLAYERS, [game()], q({ per: 'pa', ...o }), 50, null, { plateAppearances: lines })
    const hr = [{ field: 'hr', op: 'gte' as const, value: 1 }]

    it('keeps only the plate appearances against one pitcher, and counts the tally among them', () => {
      const r = run('hitting', { conditions: hr, pitcherId: 'b' })
      expect(r.total).toBe(1)
      expect(r.searched).toBe(3)
      expect(r.tally).toEqual([expect.objectContaining({ name: 'Jaida Lee', games: 1, played: 2 })])
    })

    it('asks the head-to-head from either side', () => {
      expect(run('hitting', { conditions: [], batterId: 'a', pitcherId: 'b' }).total).toBe(2)
      const pit = run('pitching', { conditions: hr, batterId: 'a' })
      expect(pit.rows.map(x => x.name).sort()).toEqual(['Ayami Sato', 'Emi Saiki'])
    })

    it('reads a matchup with nothing else asked as its log, in the order the plays happened', () => {
      const r = run('hitting', { conditions: [], batterId: 'a', pitcherId: 'b' })
      expect(r.flat).toBe(true)
      expect(r.rows.map(x => x.inning?.event)).toEqual(['HR', 'K'])
    })

    it('ignores the matchup at every other grain', () => {
      const games = run('hitting', { per: 'game', conditions: [], pitcherId: 'b' })
      expect(games.searched).toBe(0)
      expect(hasMatchup({ per: 'game', batterId: 'a' })).toBe(false)
      expect(hasMatchup({ per: 'pa', pitcherId: 'b' })).toBe(true)
    })
  })
})

describe('the finder, by a club half-inning', () => {
  const half = (o: Partial<TeamInningLine> = {}): TeamInningLine => ({
    id: Math.random().toString(36).slice(2), game_id: 'g1', team_id: 'NY', inning: 4, half: 'bottom', sequence: 30,
    r: 0, h: 0, doubles: 0, triples: 0, hr: 0, tb: 0, bb: 0, so: 0, hbp: 0, ab: 3, sh: 0, sf: 0, r2: 0, trail: 0, tooklead: 0, sb: 0, sbh: 0, cs: 0, pk: 0, ...o,
  })
  const clubName = (id: string) => ({ NY: 'New York Heights', LA: 'Los Angeles Queens' })[id] ?? id

  it('rows and tallies clubs, named, with no player', () => {
    const teamInnings = [
      half({ r: 5, h: 4, bb: 2, r2: 3, trail: 2, tooklead: 1, ab: 7 }),
      half({ r: 4, inning: 6 }), half({ team_id: 'LA', half: 'top', r: 1 }),
    ]
    const r = runWpblFinder('hitting', [], [], PLAYERS, [game()], q({ per: 'inning', conditions: [{ field: 'r', op: 'gte', value: 4 }] }),
      50, null, { teamInnings, clubName })
    expect(r.rows.map(x => [x.name, x.player, x.teamId])).toEqual([['New York Heights', null, 'NY'], ['New York Heights', null, 'NY']])
    expect(r.rows[0].detail).toBe('Bottom 4th: 5 R, 4 H, 2 BB, 3 with two out, from 2 down, took the lead')
    expect(r.tally).toEqual([expect.objectContaining({ name: 'New York Heights', games: 2, played: 2 })])
    expect(finderColumns('hitting', { per: 'inning', conditions: [] }).map(c => c.key))
      .toEqual(['inn', 'pa', 'h', 'r', 'hr', 'bb', 'so', 'r2'])
  })

  it('reads a comeback back the way it is asked', () => {
    const conditions = [{ field: 'trail', op: 'gte' as const, value: 1 }, { field: 'tooklead', op: 'eq' as const, value: 1 }]
    const r = runWpblFinder('hitting', [], [], PLAYERS, [game()], q({ per: 'inning', conditions }), 50, null,
      { teamInnings: [half({ trail: 1, tooklead: 1 }), half({ trail: 0, tooklead: 1 })], clubName })
    expect(r.total).toBe(1)
    expect(describeFinderQuery('hitting', { per: 'inning', conditions })).toBe('Down 1 or more and Took the lead')
  })
})

// ONE PLAYER. Before it, a name in a question was dropped, since Find could not ask about one player.
describe('the finder, for one player', () => {
  const games = [game({ id: 'g1', game_date: '2026-08-07' }), game({ id: 'g2', game_date: '2026-08-01' })]
  const batting = [
    bat({ game_id: 'g1', player_id: 'a', ab: 4, h: 3 }),
    bat({ game_id: 'g2', player_id: 'a', ab: 4, h: 1 }),
    bat({ game_id: 'g1', player_id: 'b', team_id: 'LA', ab: 4, h: 3 }),
  ]
  const run = (o: Partial<FinderQuery>, opts = {}) => runWpblFinder('hitting', batting, [], PLAYERS, games, q(o), 50, null, opts)

  it("keeps only that player's lines, at a game and over a season", () => {
    const r = run({ conditions: [{ field: 'h', op: 'gte', value: 3 }], playerId: 'a' })
    expect(r.rows.map(x => x.name)).toEqual(['Jaida Lee'])
    expect(r.tally).toEqual([expect.objectContaining({ games: 1, played: 2 })])
    const season = run({ per: 'season', conditions: [{ field: 'h', op: 'gte', value: 1 }], playerId: 'a' })
    expect(season.rows.map(x => x.headline)).toEqual([4])
  })

  it('reads one player with nothing asked as a game log, in date order', () => {
    const r = run({ conditions: [], playerId: 'a' })
    expect(r.flat).toBe(true)
    expect(r.rows.map(x => x.game?.id)).toEqual(['g2', 'g1'])
  })

  it("asks it of a pitcher's innings, and of nobody's club half-innings", () => {
    const inn = (o: Partial<InningPitchingLine>): InningPitchingLine => ({
      id: Math.random().toString(36).slice(2), game_id: 'g1', player_id: 'a', team_id: 'NY', inning: 2, half: 'top', sequence: 5,
      bf: 3, outs: 3, so: 3, bb: 0, hbp: 0, h: 0, hr: 0, r: 0, pitches: 12, strikes: 9, ...o,
    } as InningPitchingLine)
    const innings = [inn({}), inn({ player_id: 'b', team_id: 'LA' })]
    const r = runWpblFinder('pitching', [], [], PLAYERS, games, q({ per: 'inning', conditions: [{ field: 'so', op: 'gte', value: 3 }], playerId: 'b' }), 50, null, { innings })
    expect(r.rows.map(x => x.name)).toEqual(['Ayami Sato'])
    expect(hasPlayerFilter('hitting', { per: 'inning', playerId: 'a' })).toBe(false)
    expect(hasPlayerFilter('pitching', { per: 'inning', playerId: 'a' })).toBe(true)
  })

  it('carries the player across grains as the batter or the pitcher', () => {
    const base = { per: 'game' as const, playerId: 'a', batterId: null, pitcherId: null }
    expect(finderPlayerAt('hitting', base, 'pa')).toMatchObject({ playerId: null, batterId: 'a', pitcherId: null })
    expect(finderPlayerAt('pitching', base, 'pa')).toMatchObject({ playerId: null, pitcherId: 'a', batterId: null })
    // Back again, the matchup's other player goes.
    expect(finderPlayerAt('hitting', { per: 'pa' as const, playerId: null, batterId: 'a', pitcherId: 'b' }, 'season'))
      .toMatchObject({ playerId: 'a', batterId: null, pitcherId: null })
    expect(finderPlayerAt('fielding', base, 'season')).toMatchObject({ playerId: 'a' })
  })
})

// A floor no single plate appearance can reach matched nothing and read as an answer of 0.
it('drops a condition a plate appearance cannot meet when the grain becomes one', () => {
  const asked = [{ field: 'so', op: 'gte' as const, value: 5 }, { field: 'pitches', op: 'gte' as const, value: 8 }, { field: 'hr', op: 'gte' as const, value: 1 }]
  expect(conditionsForPer('pitching', 'pa', asked).map(c => c.field)).toEqual(['pitches', 'hr'])
  expect(conditionsForPer('pitching', 'game', asked)).toHaveLength(3)
})

// A club's whole game: its players' lines of one game summed, and the result off the game row. A
// "most runs by a team" that read one player's line, or summed across games, would still look like a
// list of clubs.
describe('the finder, by a club game', () => {
  const games = [
    game({ id: 'g1', home_team_id: 'NY', away_team_id: 'LA', home_score: 7, away_score: 2 } as Partial<WpblGame>),
    game({ id: 'g2', game_date: '2026-08-08', home_team_id: 'NY', away_team_id: 'LA', home_score: 1, away_score: 4 } as Partial<WpblGame>),
  ]
  const lines = [
    bat({ game_id: 'g1', player_id: 'a', team_id: 'NY', r: 4, h: 3 }), bat({ game_id: 'g1', player_id: 'c', team_id: 'NY', r: 3, h: 2 }),
    bat({ game_id: 'g1', player_id: 'b', team_id: 'LA', r: 2, h: 5 }),
    bat({ game_id: 'g2', player_id: 'a', team_id: 'NY', r: 1, h: 1 }), bat({ game_id: 'g2', player_id: 'b', team_id: 'LA', r: 4, h: 6 }),
  ]
  const clubName = (id: string) => id

  it('sums a club\'s lines in one game and files the row under the club', () => {
    const r = runWpblFinder('hitting', lines, [], PLAYERS, games, q({ per: 'club', conditions: [{ field: 'r', op: 'gte', value: 5 }] }), 50, null, { clubName })
    expect(r.rows.map(x => [x.name, x.game?.id, x.values.r, x.values.h])).toEqual([['NY', 'g1', 7, 5]])
  })

  it('reads the result off the game, a loss as a negative margin', () => {
    const won = runWpblFinder('hitting', lines, [], PLAYERS, games, q({ per: 'club', conditions: [{ field: 'won', op: 'eq', value: 1 }] }), 50, null, { clubName })
    expect(won.rows.map(x => `${x.name} ${x.game?.id}`).sort()).toEqual(['LA g2', 'NY g1'])
    const lost = runWpblFinder('hitting', lines, [], PLAYERS, games, q({ per: 'club', conditions: [{ field: 'margin', op: 'lte', value: -3 }] }), 50, null, { clubName })
    expect(lost.rows.map(x => [x.name, x.values.margin])).toEqual([['NY', -3], ['LA', -5]])
  })

  it('names no decision a club cannot have', () => {
    expect(finderFields('pitching', 'club').map(f => f.key)).not.toContain('w')
    expect(finderFields('pitching', 'club').map(f => f.key)).toContain('won')
    expect(finderFields('hitting', 'game').map(f => f.key)).not.toContain('margin')
  })

  it('reads a club game off the address and writes it back', () => {
    expect(decodeFinderPer('club~r.gte.10')).toBe('club')
    expect(encodeFinderQuery({ per: 'club', conditions: [{ field: 'margin', op: 'lte', value: -5 }] })).toBe('club~margin.lte.-5')
    expect(decodeFinderQuery('club~margin.lte.-5', 'hitting')).toEqual([{ field: 'margin', op: 'lte', value: -5 }])
  })
})

// Pickoffs and pitches seen live in the play log, so a game has them only with the play totals, and a
// section without plays cannot be offered them.
describe('the finder, with the play totals', () => {
  it('reads a pitcher\'s pickoffs and a batter\'s pitches seen into the game line', () => {
    const games = [game()]
    const totals = new Map([['g1|a', { pk: 2, pitches: 0, pko: 0, sbh: 0 }], ['g1|b', { pk: 0, pitches: 31, pko: 1, sbh: 0 }]])
    const pk = runWpblFinder('pitching', [], [pit({ player_id: 'a', outs: 15 })], PLAYERS, games,
      q({ conditions: [{ field: 'pk', op: 'gte', value: 2 }] }), 50, null, { playTotals: totals })
    expect(names(pk)).toEqual(['Jaida Lee'])
    const seen = runWpblFinder('hitting', [bat({ player_id: 'b', ab: 4 })], [], PLAYERS, games,
      q({ conditions: [{ field: 'pitches', op: 'gte', value: 30 }] }), 50, null, { playTotals: totals })
    expect(names(seen)).toEqual(['Ayami Sato'])
    // The runner's own count, under the batter it is: picked off once.
    const off = runWpblFinder('hitting', [bat({ player_id: 'b', ab: 4 })], [], PLAYERS, games,
      q({ conditions: [{ field: 'pk', op: 'gte', value: 1 }] }), 50, null, { playTotals: totals })
    expect(off.rows.map(r => r.detail)).toEqual(['0-for-4, picked off once'])
  })

  it('offers them only to a section that reads its plays', () => {
    expect(finderFields('pitching', 'game').map(f => f.key)).toContain('pk')
    expect(finderFields('pitching', 'game', false).map(f => f.key)).not.toContain('pk')
    expect(finderFields('hitting', 'season', false).map(f => f.key)).not.toContain('pitches')
  })
})

// Fielding by the inning, a fielder's or the club's: the address says which.
describe('the finder, fielding by the inning', () => {
  it('reads and writes the club’s inning in the address', () => {
    expect(encodeFinderQuery({ per: 'inning', byClub: true, conditions: [{ field: 'e', op: 'gte', value: 2 }] })).toBe('clubinning~e.gte.2')
    expect(decodeFinderPer('clubinning~e.gte.2')).toBe('inning')
    expect(decodeFinderByClub('clubinning~e.gte.2')).toBe(true)
    expect(decodeFinderByClub('inning~e.gte.2')).toBe(false)
    expect(decodeFinderQuery('inning~pos.eq.6', 'fielding')).toEqual([{ field: 'pos', op: 'eq', value: 6 }])
  })
})


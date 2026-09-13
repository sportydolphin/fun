import { describe, it, expect } from 'vitest'
import {
  runWpblFinder, encodeFinderQuery, decodeFinderQuery, parseFinderValue, describeFinderQuery,
  EMPTY_FINDER_QUERY, type FinderQuery,
} from '../derive/finder'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer } from '../types'

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

  it('matches nothing on a field it does not recognise', () => {
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

  it('reads the question back in words', () => {
    expect(describeFinderQuery('pitching', q({
      conditions: [{ field: 'so', op: 'gte', value: 5 }, { field: 'ip', op: 'gte', value: 14 }],
    }))).toBe('Strikeouts at least 5 and Innings pitched at least 4.2')
  })
})

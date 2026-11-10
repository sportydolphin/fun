import { describe, it, expect } from 'vitest'
import { EMPTY_FINDER_QUERY, finderAnswerText, finderSpanText, runFinder, type FinderQuery } from '../../league/finder'
import { findAskFromHref } from '../findAnswer'
import { wpblFinderHref } from '../finderLink'
import type { WpblBattingLine, WpblGame, WpblPlayer } from '../types'

// The answer a search row gives before it is opened. Wrong, it is worse than no answer: "Never" on
// a question the board answers with three rows tells a reader something false that they have no
// reason to check. So the count is pinned to the engine's, and the link is pinned to read back as
// the question it was built from.

const A = { id: 'a', name: 'Jaida Lee', team_id: 'NY' } as WpblPlayer
const B = { id: 'b', name: 'Ayami Sato', team_id: 'LA' } as WpblPlayer
const game = (id: string, game_date: string): WpblGame => ({
  id, status: 'final', game_date, home_team_id: 'NY', away_team_id: 'LA', game_type: 'regular', counts_in_standings: true,
} as WpblGame)
const bat = (game_id: string, player_id: string, h: number): WpblBattingLine => ({
  id: `${game_id}-${player_id}`, game_id, player_id, team_id: player_id === 'a' ? 'NY' : 'LA',
  ab: 4, r: 0, h, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0, hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0, ibb: 0, gdp: 0, tb: h, lob: 0,
} as WpblBattingLine)
const GAMES = [game('g1', '2026-06-05'), game('g2', '2026-07-10'), game('g3', '2026-09-02')]
const q = (o: Partial<FinderQuery>): FinderQuery => ({ ...EMPTY_FINDER_QUERY, ...o })
const threeHits = q({ conditions: [{ field: 'h', op: 'gte', value: 3 }] })

describe('the answer line', () => {
  it('counts every match and dates the latest, past the cap on rows', () => {
    // The rows are the top one by hits (g2's four), but the latest match is g3: a span read off the
    // returned rows would say Jul 10.
    const lines = [bat('g1', 'a', 3), bat('g2', 'a', 4), bat('g3', 'b', 3), bat('g3', 'a', 1)]
    const r = runFinder('hitting', lines, [], [A, B], GAMES, threeHits, 1)
    expect(r.rows).toHaveLength(1)
    expect(finderSpanText(r.span)).toBe('Jun 5 to Sep 2')
    expect(finderAnswerText(r, 'hitting', threeHits)).toBe('3 times · last Sep 2 · most, Jaida Lee (2)')
  })

  it('says Never, and Once with its night', () => {
    expect(finderAnswerText(runFinder('hitting', [bat('g1', 'a', 1)], [], [A], GAMES, threeHits), 'hitting', threeHits)).toBe('Never')
    expect(finderAnswerText(runFinder('hitting', [bat('g2', 'a', 3)], [], [A], GAMES, threeHits), 'hitting', threeHits)).toBe('Once · Jul 10')
  })

  it('names nobody when the most is a tie, a one, or the only player', () => {
    const lines = [bat('g1', 'a', 3), bat('g2', 'b', 3)]
    expect(finderAnswerText(runFinder('hitting', lines, [], [A, B], GAMES, threeHits), 'hitting', threeHits)).toBe('2 times · last Jul 10')
    // "Jaida Lee 3-hit games": the most is the player asked about.
    const own = [bat('g1', 'a', 3), bat('g2', 'a', 3)]
    expect(finderAnswerText(runFinder('hitting', own, [], [A, B], GAMES, { ...threeHits, playerId: 'a' }), 'hitting', threeHits)).toBe('2 times · last Jul 10')
  })

  it('gives a record as its top number, not its count', () => {
    // "Most hits in a game": every game with a hit matches, and the answer is the most, not how many.
    const most = q({ conditions: [{ field: 'h', op: 'gte', value: 1 }] })
    const lines = [bat('g1', 'a', 2), bat('g2', 'b', 4), bat('g3', 'a', 1)]
    expect(finderAnswerText(runFinder('hitting', lines, [], [A, B], GAMES, most, Infinity), 'hitting', most)).toBe('Record 4 · Ayami Sato, Jul 10')
    const tied = [bat('g1', 'a', 4), bat('g2', 'b', 4)]
    expect(finderAnswerText(runFinder('hitting', tied, [], [A, B], GAMES, most, Infinity), 'hitting', most)).toBe('Record 4 · 2 tied')
  })

  it('puts a year on both ends once they fall in different seasons', () => {
    expect(finderSpanText({ first: game('x', '2026-08-01'), last: game('y', '2027-05-03') })).toBe('Aug 1, 2026 to May 3, 2027')
  })
})

describe('the question read off a Find link', () => {
  it('reads back what the link was built from', () => {
    const href = wpblFinderHref({
      side: 'pitching', per: 'inning', conditions: [{ field: 'so', op: 'gte', value: 3 }],
      teamId: 'NY', oppId: null, venue: 'home', ignored: [], season: 2026,
    })
    expect(findAskFromHref(`${href}&by=p1&games=post`)).toEqual({
      side: 'pitching', season: 2026,
      query: {
        conditions: [{ field: 'so', op: 'gte', value: 3 }], per: 'inning', teamId: 'NY', oppId: null, venue: 'home',
        scope: 'postseason', batterId: null, pitcherId: null, playerId: 'p1',
      },
    })
  })

  it('is no question on any other board', () => {
    expect(findAskFromHref('/wpbl/stats?board=bests&side=hitting')).toBeNull()
    expect(findAskFromHref('/mlb/find?q=hr.gte.2')).toBeNull()
  })
})

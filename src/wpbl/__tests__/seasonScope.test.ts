import { describe, it, expect } from 'vitest'
import {
  scopedLines, scopedGames, isPostseasonGame, postseasonGameIds, countsInStandings,
} from '../season'
import type { WpblSeasonGame } from '../season'

// The two slices fail in OPPOSITE directions and both are correct. That asymmetry is the whole
// point of this file: `regular` drops a game only on positive evidence so a feed rename costs
// a few games, while `postseason` keeps a game only on positive evidence so the same rename
// empties the playoff board instead of relabelling the whole regular season as the playoffs.

const g = (id: string, o: Partial<WpblSeasonGame> = {}): WpblSeasonGame =>
  ({ id, game_type: 'regular', counts_in_standings: true, ...o })

const post = (id: string) => g(id, { game_type: 'postSeason', counts_in_standings: true })
const line = (game_id: string) => ({ game_id })

describe('identifying a postseason game', () => {
  it('is the exact negation of countsInStandings', () => {
    const games = [
      g('a'),
      post('b'),
      g('c', { counts_in_standings: false }),
      g('d', { game_type: 'semifinal' }),
      g('e', { game_type: null as unknown as string, counts_in_standings: null as unknown as boolean }),
    ]
    for (const x of games) expect(isPostseasonGame(x)).toBe(!countsInStandings(x))
  })

  // The feed sends counts_in_standings: true on postseason rows, which is why game_type is
  // doing the work and why the flag alone would put the bracket in the standings.
  it('catches a postseason row whose flag still says it counts', () => {
    expect(isPostseasonGame(post('b'))).toBe(true)
  })

  it('names the positive set', () => {
    expect([...postseasonGameIds([g('a'), post('b'), post('c')])]).toEqual(['b', 'c'])
  })
})

describe('slicing lines', () => {
  const games = [g('r1'), g('r2'), post('p1'), post('p2')]
  const lines = [line('r1'), line('r1'), line('r2'), line('p1'), line('p2')]

  it('regular keeps only the regular-season lines', () => {
    expect(scopedLines(lines, games, 'regular').map(l => l.game_id)).toEqual(['r1', 'r1', 'r2'])
  })

  it('postseason keeps only the postseason lines', () => {
    expect(scopedLines(lines, games, 'postseason').map(l => l.game_id)).toEqual(['p1', 'p2'])
  })

  it('all keeps everything, and filters nothing at all', () => {
    expect(scopedLines(lines, games, 'all')).toBe(lines)
  })

  it('defaults to regular, so a caller that passes no scope is unchanged', () => {
    expect(scopedLines(lines, games)).toEqual(scopedLines(lines, games, 'regular'))
  })

  // The two halves have to partition the lines, or a ball is counted twice or not at all.
  it('regular and postseason partition what all returns', () => {
    const r = scopedLines(lines, games, 'regular')
    const p = scopedLines(lines, games, 'postseason')
    expect(r.length + p.length).toBe(scopedLines(lines, games, 'all').length)
    expect(r.some(x => p.includes(x))).toBe(false)
  })

  // THE ASYMMETRY, stated as two tests, because each direction is a different disaster.
  //
  // A line whose game is not in the schedule at all: regular counts it (a partial schedule
  // must not blank a season), postseason does not (it is not evidence of a playoff game).
  it('regular counts a line whose game it has never heard of', () => {
    expect(scopedLines([line('unknown')], games, 'regular')).toHaveLength(1)
  })

  it('postseason refuses a line whose game it has never heard of', () => {
    expect(scopedLines([line('unknown')], games, 'postseason')).toHaveLength(0)
  })

  // The rename scenario in full: the feed starts calling the playoffs something this build
  // does not recognise. Regular over-counts by the bracket, which is visibly wrong on a
  // standings page. Postseason goes empty, which is visibly broken. Neither silently
  // republishes 30 regular-season games under a heading that says Playoffs.
  it('survives the feed renaming its game types', () => {
    const renamed = [g('r1'), g('r2'), g('x1', { game_type: 'roundOfFour' })]
    const all = [line('r1'), line('r2'), line('x1')]
    expect(scopedLines(all, renamed, 'regular')).toHaveLength(3)
    expect(scopedLines(all, renamed, 'postseason')).toHaveLength(0)
  })

  it('postseason is empty before a single playoff game exists', () => {
    expect(scopedLines(lines, [g('r1'), g('r2')], 'postseason')).toHaveLength(0)
  })
})

describe('slicing games', () => {
  const games = [g('r1'), post('p1'), g('r2')]

  it('splits them the same way the lines split', () => {
    expect(scopedGames(games, 'regular').map(x => x.id)).toEqual(['r1', 'r2'])
    expect(scopedGames(games, 'postseason').map(x => x.id)).toEqual(['p1'])
    expect(scopedGames(games, 'all')).toHaveLength(3)
  })
})

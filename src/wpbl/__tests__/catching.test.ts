import { describe, it, expect } from 'vitest'
import { catcherIndex, catcherArmLeaders, type CatcherAt } from '../derive/catching'
import type { RunnerEvent } from '../derive/baserunning'

// Catcher arm runs: the runner's steal price turned around and centered on the league's mean
// attempt. The traps pinned here: a club that changed catchers credits each steal to whoever the
// play log's "to c" row had put behind the plate by then, a throw "to c" is not such a row, a
// pickoff is the pitcher's, and an average arm is worth zero however often it is run on.

const games = [
  { id: 'g1', home_team_id: 'SF', away_team_id: 'BOS' },
  { id: 'g2', home_team_id: 'SF', away_team_id: 'BOS' },
  { id: 'p1', home_team_id: 'SF', away_team_id: 'BOS', game_type: 'Playoffs' },
]

const ev = (game_id: string, teamId: string, kind: RunnerEvent['kind'], value: number, share = 1, sequence = 0): RunnerEvent =>
  ({ game_id, sequence, teamId, runner: 'R', runnerId: null, kind, value, share })

const PLAYERS = [
  { id: 'cSF', name: 'Alexia Jorge' }, { id: 'cB1', name: 'Beth Greenwood' },
  { id: 'cB2', name: 'Hyeonah Kim' }, { id: 'cf', name: 'Val Perez' },
]

describe('catcherIndex', () => {
  const lines = [
    { game_id: 'g1', team_id: 'SF', player_id: 'cSF', position: 'C' },
    { game_id: 'g1', team_id: 'BOS', player_id: 'cB1', position: 'dh/c' },
    { game_id: 'g2', team_id: 'BOS', player_id: 'cB1', position: 'c' },
    { game_id: 'g2', team_id: 'BOS', player_id: 'cB2', position: 'rf/c' },
    { game_id: 'g2', team_id: 'SF', player_id: 'cf', position: 'cf' },
  ]

  it('names the one catcher, and reads any token of the position', () => {
    const at = catcherIndex(lines, [], PLAYERS)
    expect(at('g1', 'SF', 5)).toBe('cSF')
    expect(at('g1', 'BOS', 5)).toBe('cB1')
    // Center field is not catcher.
    expect(at('g2', 'SF', 5)).toBe(null)
  })

  it('follows a change of catcher from its own row, and ignores a throw to one', () => {
    const at = catcherIndex(lines, [
      // Not a change: the catcher took a throw.
      { game_id: 'g2', sequence: 20, narrative: 'Val Perez out at home 3b to c.' },
      // The row sits in the other club's half, which is why it is matched by name.
      { game_id: 'g2', sequence: 40, narrative: 'Hyeonah Kim to c for Beth Greenwood.' },
    ], PLAYERS)
    expect(at('g2', 'BOS', 39)).toBe('cB1')
    expect(at('g2', 'BOS', 41)).toBe('cB2')
  })

  it('leaves a two-catcher game uncredited when no row says when the switch came', () => {
    expect(catcherIndex(lines, [], PLAYERS)('g2', 'BOS', 5)).toBe(null)
  })
})

describe('catcherArmLeaders', () => {
  const map = new Map([['g1|SF', 'cSF'], ['g2|SF', 'cSF'], ['g1|BOS', 'cB'], ['p1|SF', 'cSF']])
  const at: CatcherAt = (g, t) => map.get(`${g}|${t}`) ?? null
  const players = [{ id: 'cSF' }, { id: 'cB' }]

  it('credits the fielding side, centers on the mean attempt and skips pickoffs and the postseason', () => {
    const rows = catcherArmLeaders([
      // Boston runs on SF's catcher: one steal, one caught.
      ev('g1', 'BOS', 'sb', 0.2), ev('g1', 'BOS', 'cs', -0.6),
      // SF runs on Boston's: two steals.
      ev('g1', 'SF', 'sb', 0.2), ev('g2', 'SF', 'sb', 0.2),
      // Neither counts: a pickoff is the pitcher's, and a playoff game is not the season.
      ev('g2', 'BOS', 'pickoff', -0.6), ev('p1', 'BOS', 'cs', -0.6),
    ], games, at, players)
    // Mean attempt: (0.2 - 0.6 + 0.2 + 0.2) / 4 = 0.
    const sf = rows.find(r => r.playerId === 'cSF')!
    expect(sf).toMatchObject({ attempts: 2, sb: 1, cs: 1 })
    expect(sf.runs).toBeCloseTo(0.4)
    // g2's Boston catcher is not known, so only g1's steal reaches them.
    const bos = rows.find(r => r.playerId === 'cB')!
    expect(bos).toMatchObject({ attempts: 1, sb: 1, cs: 0 })
    expect(bos.runs).toBeCloseTo(-0.2)
    expect(rows[0].playerId).toBe('cSF')
  })

  it('reads an average arm as zero, however often it is run on', () => {
    const rows = catcherArmLeaders(
      Array.from({ length: 10 }, (_, i) => ev('g1', 'BOS', i % 2 ? 'sb' : 'cs', i % 2 ? 0.2 : -0.6)),
      games, at, players)
    expect(rows[0].runs).toBeCloseTo(0)
  })
})

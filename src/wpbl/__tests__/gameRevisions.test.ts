import { describe, it, expect } from 'vitest'
import { describeRevision, revisionOverflow } from '../derive/gameRevisions'
import type { WpblGameRevision, WpblRevisionChange } from '../types'

const rev = (changes: WpblRevisionChange[], over: Partial<WpblGameRevision> = {}): WpblGameRevision => ({
  id: 'r1', game_id: 'g1', kind: 'league',
  source_updated_at: '2026-08-24T02:33:01Z', prior_source_updated_at: '2026-08-20T02:33:01Z',
  detected_at: '2026-08-24T07:30:00Z',
  changes, change_count: changes.length, ...over,
})

const CLUBS = { away: 'San Francisco Sailors', home: 'Boston Bolts' }

describe('describeRevision', () => {
  it('names the club rather than the column', () => {
    const [line] = describeRevision(rev([{ kind: 'game', field: 'home_score', before: 9, after: 10 }]), CLUBS)
    expect(line).toEqual({ who: 'Boston Bolts', playerId: null, what: 'Team runs', before: '9', after: '10' })
  })

  it('still reads without the clubs', () => {
    const [line] = describeRevision(rev([{ kind: 'game', field: 'away_hits', before: 7, after: 8 }]))
    expect(line.who).toBe('Away')
    expect(line.what).toBe('Team hits')
  })

  // Innings are stored as outs and read as "5.2". A changelog reporting "17 → 18" would be
  // correct and unreadable, and would not match the pitching line three inches above it.
  it('shows innings pitched the way the box score does', () => {
    const [line] = describeRevision(rev([
      { kind: 'pitching', player: 'Kaia Fry', player_id: 'p1', field: 'outs', before: 17, after: 18 },
    ]), CLUBS)
    expect(line).toEqual({ who: 'Kaia Fry', playerId: 'p1', what: 'Innings pitched', before: '5.2', after: '6.0' })
  })

  it('spells a decision out, and says when there was not one', () => {
    const [line] = describeRevision(rev([
      { kind: 'pitching', player: 'Kaia Fry', player_id: 'p1', field: 'decision', before: '', after: 'W' },
    ]), CLUBS)
    expect(line.before).toBe('—')
    expect(line.after).toBe('Win')
  })

  // THE LABEL IS THE WHOLE POINT ON THIS ONE. The feed's `runs_scored` does not count the
  // batter, so a solo home run stores 0 and a grand slam 3. Every reader of that column so far
  // has been caught by it, and a changelog printing it as "Runs" would republish the trap to
  // people who have no way to know.
  it('says out loud that a play run count excludes the batter', () => {
    const [line] = describeRevision(rev([
      { kind: 'play', sequence: 41, inning: 6, half: 'bottom', batter: 'Val Perez', field: 'runs_scored', before: 0, after: 1 },
    ]), CLUBS)
    expect(line.who).toBe('Bottom 6th')
    expect(line.what).toBe('Val Perez: Runners scoring (not the batter)')
  })

  it('gets the ordinals right in the teens', () => {
    const half = (inning: number) => describeRevision(rev([
      { kind: 'play', sequence: 1, inning, half: 'top', field: 'outs', before: 1, after: 2 },
    ]))[0].who
    expect([half(1), half(2), half(3), half(4), half(11), half(12), half(13), half(21)])
      .toEqual(['Top 1st', 'Top 2nd', 'Top 3rd', 'Top 4th', 'Top 11th', 'Top 12th', 'Top 13th', 'Top 21st'])
  })

  it('reads a boolean as a word', () => {
    const [line] = describeRevision(rev([
      { kind: 'play', sequence: 9, inning: 3, half: 'top', batter: 'Val Perez', field: 'is_hit', before: true, after: false },
    ]))
    expect([line.before, line.after]).toEqual(['Yes', 'No'])
  })

  // An entry the league published with no player id. It cannot be matched to anybody, and the
  // sentence has to say that rather than implying a player was dropped from the sheet.
  it('says plainly when the league listed somebody it did not identify', () => {
    const [line] = describeRevision(rev([{ kind: 'batting', change: 'unidentified', player: 'Val Perez' }]))
    expect(line.what).toBe('Listed on the batting line without a league id')
    expect(line.playerId).toBeNull()
  })

  it('reports a line and a play appearing or disappearing', () => {
    const lines = describeRevision(rev([
      { kind: 'batting', change: 'added', player: 'Val Perez', player_id: 'p1' },
      { kind: 'pitching', change: 'removed', player: 'Kaia Fry', player_id: 'p2' },
      { kind: 'play', sequence: 12, inning: 4, half: 'top', batter: 'Val Perez', change: 'added' },
    ]))
    expect(lines.map(l => l.what)).toEqual([
      'Added to the batting line', 'Removed from the pitching line', 'Play added: Val Perez',
    ])
  })

  it('has nothing to say about a revision that changed nothing it describes', () => {
    expect(describeRevision(rev([]))).toEqual([])
  })
})

describe('revisionOverflow', () => {
  // A wholesale re-score stores its first eighty changes and counts them all. A page trusting
  // the array's length would report the smaller, more misleading number.
  it('is the gap between what was seen and what was kept', () => {
    expect(revisionOverflow(rev([{ kind: 'game', field: 'home_score', before: 1, after: 2 }], { change_count: 300 })))
      .toBe(299)
  })

  it('is zero on an ordinary revision', () => {
    expect(revisionOverflow(rev([{ kind: 'game', field: 'home_score', before: 1, after: 2 }]))).toBe(0)
  })
})

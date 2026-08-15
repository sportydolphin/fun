import { describe, it, expect } from 'vitest'
import { computeFirsts, playCanSetFirst, FIRSTS_EVENT_TYPES } from '../firsts'
import type { WpblGame, WpblPlayer, WpblFirstsPlay, WpblPitchingLine } from '../types'

// The Hall of Firsts reads a server-side-filtered slice of the season's play log
// (FIRSTS_PLAY_FILTER in api.ts, built from FIRSTS_EVENT_TYPES + playCanSetFirst). If that
// filter is ever narrower than what computeFirsts actually inspects, the failure is silent:
// the milestone still renders, just credited to the second player to do it. These tests pin
// the boundary so widening META without widening the filter fails here instead of in prod.

const game = (id: string, date: string, time = '6:30 pm'): WpblGame => ({
  id, game_date: date, start_time: time, status: 'final',
  home_team_id: 'H', away_team_id: 'A', home_score: 1, away_score: 0,
} as unknown as WpblGame)

const player = (id: string, name: string, team = 'H'): WpblPlayer =>
  ({ id, name, team_id: team } as unknown as WpblPlayer)

let seq = 0
const play = (over: Partial<WpblFirstsPlay>): WpblFirstsPlay => ({
  game_id: 'g1', sequence: seq++, team_id: 'H',
  batter_id: 'p1', batter_name: 'Ada Batter',
  pitcher_id: 'p2', pitcher_name: 'Bea Pitcher',
  narrative: 'something happened', event_type: 'groundout',
  is_hit: false, runs_scored: 0,
  ...over,
})

const GAMES = [game('g1', '2026-05-01'), game('g2', '2026-05-02')]
const PLAYERS = [player('p1', 'Ada Batter'), player('p2', 'Bea Pitcher', 'A'), player('p3', 'Cleo Runner')]
const PITCHING: WpblPitchingLine[] = [
  { game_id: 'g1', player_id: 'p2', team_id: 'A', decision: 'W', outs: 21, so: 7 } as unknown as WpblPitchingLine,
]

// One play of every event type the feed emits (from the live histogram), so the filter is
// exercised against the real shape of the table rather than a happy path.
const ALL_EVENT_TYPES = [
  'unknown', 'single', 'groundout', 'walk', 'strikeout', 'flyout', 'double', 'popup',
  'lineout', 'stolen_base', 'wild_pitch', 'hit_by_pitch', 'fielders_choice', 'out',
  'home_run', 'foul_out', 'sacrifice', 'caught_stealing', 'passed_ball',
]

describe('playCanSetFirst', () => {
  it('keeps every event type that names a milestone', () => {
    for (const et of FIRSTS_EVENT_TYPES) {
      expect(playCanSetFirst(play({ event_type: et }))).toBe(true)
    }
  })

  it('keeps hits, run-scoring plays, and balks hidden in an unknown event', () => {
    expect(playCanSetFirst(play({ event_type: 'single', is_hit: true }))).toBe(true)
    expect(playCanSetFirst(play({ event_type: 'fielders_choice', runs_scored: 1 }))).toBe(true)
    expect(playCanSetFirst(play({ event_type: 'unknown', narrative: 'Bea Pitcher was called for a balk.' }))).toBe(true)
  })

  it('drops routine outs, which are most of the play log', () => {
    for (const et of ['groundout', 'flyout', 'popup', 'lineout', 'foul_out', 'out', 'caught_stealing']) {
      expect(playCanSetFirst(play({ event_type: et }))).toBe(false)
    }
  })
})

describe('computeFirsts is unchanged by the server-side filter', () => {
  // A season containing every event type, a couple of milestones buried behind routine
  // outs, and a balk that only the narrative identifies.
  const plays: WpblFirstsPlay[] = [
    ...ALL_EVENT_TYPES.map(et => play({ event_type: et, is_hit: et === 'single' || et === 'double' })),
    play({ event_type: 'home_run', narrative: 'Ada Batter homered to left.', runs_scored: 0 }),
    play({ event_type: 'home_run', narrative: 'Ada Batter hit a grand slam.', runs_scored: 3 }),
    play({ event_type: 'triple', is_hit: true, narrative: 'Ada Batter tripled.' }),
    play({ event_type: 'stolen_base', narrative: 'Cleo Runner stole second.' }),
    play({ event_type: 'unknown', narrative: 'Bea Pitcher was called for a balk.' }),
    play({ event_type: 'wild_pitch', runs_scored: 1, narrative: 'A run scored on a wild pitch.' }),
    play({ event_type: 'fielders_choice', runs_scored: 1, narrative: 'Ada Batter grounded into a fielder’s choice, a run scored.' }),
  ]

  it('produces the same result from the filtered subset as from the whole log', () => {
    const all = computeFirsts(plays, GAMES, PLAYERS, PITCHING)
    const filtered = computeFirsts(plays.filter(playCanSetFirst), GAMES, PLAYERS, PITCHING)
    expect(filtered).toEqual(all)
    // Guard against the test passing because nothing was found at all.
    expect(all.map(f => f.key)).toEqual(
      expect.arrayContaining(['first_hit', 'first_hr', 'first_grand_slam', 'first_triple', 'first_sb', 'first_balk', 'first_rbi']),
    )
  })

  it('still finds a milestone that sits behind a long stretch of routine outs', () => {
    const buried = [
      ...Array.from({ length: 300 }, () => play({ event_type: 'groundout' })),
      play({ event_type: 'home_run', narrative: 'Ada Batter homered.', runs_scored: 0 }),
    ]
    const hr = computeFirsts(buried.filter(playCanSetFirst), GAMES, PLAYERS, PITCHING).find(f => f.key === 'first_hr')
    expect(hr?.name).toBe('Ada Batter')
  })

  it('credits the earliest game, not the earliest row, when the log arrives out of order', () => {
    // Pagination returns rows ordered by game_id, which is not chronological order —
    // computeFirsts has to re-sort by game date. g2 sorts first by id here on purpose.
    const later = play({ game_id: 'g1', event_type: 'home_run', narrative: 'Ada Batter homered.' })
    const earlier = { ...play({ game_id: 'g2', event_type: 'home_run', narrative: 'Cleo Runner homered.' }), batter_id: 'p3', batter_name: 'Cleo Runner' }
    const out = computeFirsts([earlier, later], GAMES, PLAYERS, PITCHING).find(f => f.key === 'first_hr')
    expect(out?.name).toBe('Ada Batter') // g1 is 2026-05-01, g2 is 2026-05-02
  })
})

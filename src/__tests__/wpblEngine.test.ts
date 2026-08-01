// @vitest-environment node
// (Pure engine — no DOM. Pinned to node so it runs without the jsdom setup.)
import {
  OUTCOMES, proposeEffect, proposeBaserun, commit, aggregateFromPlays,
  type LiveState,
} from '../wpbl/engine'
import type { WpblPlay } from '../wpbl/types'

// Pure-engine tests — the baserunner advancement + inning/score bookkeeping + box-score
// recompute, which are the parts most likely to be subtly wrong.

const B = 'batter'
const base = (over: Partial<LiveState> = {}): LiveState => ({
  away_score: 0, home_score: 0, live_inning: 1, live_half: 'top', live_outs: 0,
  runner_first: null, runner_second: null, runner_third: null,
  away_batting_order: 1, home_batting_order: 1, ...over,
})

describe('proposeEffect — baserunner advancement', () => {
  it('single with empty bases puts the batter on first', () => {
    const e = proposeEffect(base(), '1B', B)
    expect(e.bases).toEqual({ first: B, second: null, third: null })
    expect(e.scored).toEqual([])
    expect(e.outsAdded).toBe(0)
  })

  it('single scores the runner from third and advances everyone one base', () => {
    const e = proposeEffect(base({ runner_first: 'r1', runner_third: 'r3' }), '1B', B)
    expect(e.scored).toEqual(['r3'])
    expect(e.bases).toEqual({ first: B, second: 'r1', third: null })
  })

  it('home run with bases loaded clears the bases and scores four', () => {
    const e = proposeEffect(base({ runner_first: 'r1', runner_second: 'r2', runner_third: 'r3' }), 'HR', B)
    expect(e.scored).toEqual(['r3', 'r2', 'r1', B])
    expect(e.bases).toEqual({ first: null, second: null, third: null })
  })

  it('double scores runners from second and third, pushes first to third', () => {
    const e = proposeEffect(base({ runner_first: 'r1', runner_second: 'r2' }), '2B', B)
    expect(e.scored).toEqual(['r2'])
    expect(e.bases).toEqual({ first: null, second: B, third: 'r1' })
  })

  it('walk with bases empty only puts the batter on first (no forced runners)', () => {
    const e = proposeEffect(base(), 'BB', B)
    expect(e.bases).toEqual({ first: B, second: null, third: null })
    expect(e.scored).toEqual([])
  })

  it('walk with a runner on first forces him to second, no run', () => {
    const e = proposeEffect(base({ runner_first: 'r1' }), 'BB', B)
    expect(e.bases).toEqual({ first: B, second: 'r1', third: null })
    expect(e.scored).toEqual([])
  })

  it('walk with the bases loaded forces in exactly one run', () => {
    const e = proposeEffect(base({ runner_first: 'r1', runner_second: 'r2', runner_third: 'r3' }), 'BB', B)
    expect(e.scored).toEqual(['r3'])
    expect(e.bases).toEqual({ first: B, second: 'r1', third: 'r2' })
  })

  it('strikeout records an out and no one advances', () => {
    const e = proposeEffect(base({ runner_second: 'r2' }), 'K', B)
    expect(e.outsAdded).toBe(1)
    expect(e.bases).toEqual({ first: null, second: 'r2', third: null })
  })

  it('sac fly scores the runner on third and records an out', () => {
    const e = proposeEffect(base({ runner_third: 'r3' }), 'SF', B)
    expect(e.outsAdded).toBe(1)
    expect(e.scored).toEqual(['r3'])
    expect(e.bases.third).toBeNull()
  })

  it('double play with a runner on first records two outs and clears first', () => {
    const e = proposeEffect(base({ runner_first: 'r1' }), 'DP', B)
    expect(e.outsAdded).toBe(2)
    expect(e.bases.first).toBeNull()
  })
})

describe('proposeBaserun — steals', () => {
  it('stolen base from second moves the runner to third', () => {
    const e = proposeBaserun(base({ runner_second: 'r2' }), 'SB', 2)
    expect(e.bases).toEqual({ first: null, second: null, third: 'r2' })
    expect(e.scored).toEqual([])
  })
  it('stolen base from third scores', () => {
    const e = proposeBaserun(base({ runner_third: 'r3' }), 'SB', 3)
    expect(e.scored).toEqual(['r3'])
    expect(e.bases.third).toBeNull()
  })
  it('caught stealing removes the runner and records an out', () => {
    const e = proposeBaserun(base({ runner_first: 'r1' }), 'CS', 1)
    expect(e.outsAdded).toBe(1)
    expect(e.bases.first).toBeNull()
  })
})

describe('commit — scoring + inning bookkeeping', () => {
  it('credits runs to the away side and advances its lineup slot in the top half', () => {
    const e = proposeEffect(base({ runner_third: 'r3' }), '1B', B)
    const { state } = commit(base({ runner_third: 'r3' }), OUTCOMES['1B'], e, e.scored.length)
    expect(state.away_score).toBe(1)
    expect(state.home_score).toBe(0)
    expect(state.away_batting_order).toBe(2)
    expect(state.live_outs).toBe(0)
  })

  it('third out in the top half flips to the bottom and clears the bases', () => {
    const s0 = base({ live_outs: 2, runner_first: 'r1' })
    const e = proposeEffect(s0, 'K', B)
    const { state, inningEnded } = commit(s0, OUTCOMES['K'], e, 0)
    expect(inningEnded).toBe(true)
    expect(state.live_half).toBe('bottom')
    expect(state.live_inning).toBe(1)
    expect(state.live_outs).toBe(0)
    expect(state.runner_first).toBeNull()
    expect(state.away_batting_order).toBe(2) // the out still completed a plate appearance
  })

  it('third out in the bottom half advances the inning and returns to the top', () => {
    const s0 = base({ live_half: 'bottom', live_inning: 3, live_outs: 2 })
    const { state } = commit(s0, OUTCOMES['GO'], proposeEffect(s0, 'GO', B), 0)
    expect(state.live_half).toBe('top')
    expect(state.live_inning).toBe(4)
  })

  it('the batting order wraps from 9 back to 1', () => {
    const s0 = base({ away_batting_order: 9 })
    const { state } = commit(s0, OUTCOMES['GO'], proposeEffect(s0, 'GO', B), 0)
    expect(state.away_batting_order).toBe(1)
  })
})

describe('aggregateFromPlays — box score recompute', () => {
  const play = (over: Partial<WpblPlay>): WpblPlay => ({
    id: over.id ?? Math.random().toString(), game_id: 'g', seq: 0, inning: 1, half: 'top',
    batting_team_id: 'AW', batter_id: null, pitcher_id: 'P', runner_id: null,
    outcome: '1B', rbi: 0, runs: 0, outs_recorded: 0, scored_ids: [], description: '',
    away_score_after: 0, home_score_after: 0, inning_after: 1, half_after: 'top', outs_after: 0,
    runner_first_after: null, runner_second_after: null, runner_third_after: null,
    away_order_after: 1, home_order_after: 1, created_at: '', ...over,
  })

  it('totals a batter’s at-bats, hits, RBI and runs across plays', () => {
    const plays = [
      play({ batter_id: 'A', outcome: '1B' }),
      play({ batter_id: 'A', outcome: 'HR', runs: 1, rbi: 1, scored_ids: ['A'] }),
      play({ batter_id: 'A', outcome: 'BB' }),
      play({ batter_id: 'A', outcome: 'K' }),
    ]
    const { bat } = aggregateFromPlays(plays)
    const a = bat.get('A')!
    expect(a.ab).toBe(3)   // 1B, HR, K (walk is not an at-bat)
    expect(a.h).toBe(2)
    expect(a.hr).toBe(1)
    expect(a.bb).toBe(1)
    expect(a.so).toBe(1)
    expect(a.rbi).toBe(1)
    expect(a.r).toBe(1)    // credited via scored_ids
  })

  it('charges the pitcher outs, strikeouts and runs', () => {
    const plays = [
      play({ pitcher_id: 'P', outcome: 'K', outs_recorded: 1 }),
      play({ pitcher_id: 'P', outcome: 'GO', outs_recorded: 1 }),
      play({ pitcher_id: 'P', outcome: 'HR', runs: 1, scored_ids: ['X'] }),
    ]
    const { pit } = aggregateFromPlays(plays)
    const p = pit.get('P')!
    expect(p.outs).toBe(2)
    expect(p.so).toBe(1)
    expect(p.r).toBe(1)
    expect(p.bf).toBe(3)
    expect(p.hr).toBe(1)
  })

  it('credits stolen bases and caught stealing to the runner', () => {
    const { bat } = aggregateFromPlays([
      play({ outcome: 'SB', runner_id: 'R' }),
      play({ outcome: 'CS', runner_id: 'R', outs_recorded: 1 }),
    ])
    const r = bat.get('R')!
    expect(r.sb).toBe(1)
    expect(r.cs).toBe(1)
  })
})

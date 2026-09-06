import { describe, it, expect } from 'vitest'
import { momentOf } from '../dev/devLiveGame'
import type { WpblGame, WpblGamePlay } from '../types'

// The live-game simulator is a dev tool, and a dev tool that lies is worse than no dev tool:
// a replay that mis-scores a game sends somebody looking for a bug in the section that is not
// there. It shipped doing exactly that once (see the note on the overlay's `live` method), so
// the arithmetic is pinned here.

const GAME = {
  id: 'g1', game_date: '2026-09-05', home_team_id: 'BOS', away_team_id: 'LA',
  status: 'final', home_score: 6, away_score: 10, innings: 7,
  updated_at: '2026-09-05T23:00:00Z', source_updated_at: '2026-09-05T23:00:00Z',
} as WpblGame

const play = (over: Partial<WpblGamePlay>): WpblGamePlay => ({
  id: 'p', game_id: 'g1', sequence: 1, inning: 1, half: 'top', team_id: 'LA',
  batter_name: 'Jamie Mackay', pitcher_name: 'Alli Schroder',
  outs: 0, first_base: '', second_base: '', third_base: '', bases_loaded: false,
  narrative: 'Jamie Mackay singled up the middle.', event_type: 'single',
  is_hit: true, is_scoring_play: false, runs_scored: 0,
  pitch_sequence: 'BP', balls: 1, strikes: 0, fouls: 0,
  ...over,
} as WpblGamePlay)

describe('the score the replay puts on the board', () => {
  // The bug this pins: the live poll's delta is a COLUMN SUBSET with no `home_team_id`, so
  // every "is this the home team" test came out false and the whole game was scored to the
  // visitors. It read 11-0 in a game that finished 10-6, which is entirely plausible-looking.
  it('gives each side its own runs', () => {
    const plays = [
      play({ sequence: 1, team_id: 'LA', event_type: 'home_run', runs_scored: 1, narrative: 'Two-run homer.' }),
      play({ sequence: 2, team_id: 'BOS', half: 'bottom', event_type: 'home_run', runs_scored: 0, narrative: 'Solo homer.' }),
      play({ sequence: 3, team_id: 'LA', narrative: 'Grounded out.' }),
    ]
    const m = momentOf(GAME, plays, 2)
    expect(m.away_score).toBe(2)   // LA: a two-run homer
    expect(m.home_score).toBe(1)   // BOS: a solo homer
  })

  // CLAUDE.md's oldest trap: the feed's `runs_scored` counts the runners who crossed and not
  // the batter, so a solo home run reads 0. `runsOnPlay` is the only correct reading, and it is
  // the same one `gameWinProb` uses, which is what makes the chart agree with the scoreboard
  // above it in a replay.
  it('counts the batter on a solo home run', () => {
    const plays = [
      play({ sequence: 1, event_type: 'home_run', runs_scored: 0, narrative: 'Solo home run.' }),
      play({ sequence: 2 }),
    ]
    expect(momentOf(GAME, plays, 1).away_score).toBe(1)
  })

  it('reports the innings each side has actually batted in', () => {
    const plays = [
      play({ sequence: 1, inning: 1, half: 'top', team_id: 'LA' }),
      play({ sequence: 2, inning: 1, half: 'bottom', team_id: 'BOS' }),
      play({ sequence: 3, inning: 2, half: 'top', team_id: 'LA' }),
    ]
    // Sitting on the top of the 2nd: the visitors have batted twice, the home side once.
    const m = momentOf(GAME, plays, 2)
    expect(m.away_line?.map(e => e.inning)).toEqual([1, 2])
    expect(m.home_line?.map(e => e.inning)).toEqual([1])
  })
})

describe('the situation it publishes', () => {
  it('is the state BEFORE the play it is sitting on, runners and all', () => {
    const plays = [
      play({ sequence: 1 }),
      play({
        sequence: 2, inning: 3, half: 'bottom', team_id: 'BOS', outs: 2,
        first_base: 'Lexi Hastings', third_base: 'Kate Blunt',
        batter_name: 'Denver Bryant', pitcher_name: 'Michelle Roche',
        balls: 2, strikes: 1,
      }),
    ]
    const s = momentOf(GAME, plays, 1).live_state!
    expect(s.inning).toBe(3)
    expect(s.half).toBe('bottom')
    expect(s.outs).toBe(2)
    expect(s.balls).toBe(2)
    expect(s.strikes).toBe(1)
    expect(s.batter_name).toBe('Denver Bryant')
    expect(s.pitcher_name).toBe('Michelle Roche')
    expect(s.first_base).toBe('Lexi Hastings')
    expect(s.second_base).toBe('')
    expect(s.third_base).toBe('Kate Blunt')
    expect(s.bases_loaded).toBe(false)
  })

  // The stored count is the one entering the pitch that ended the at-bat, so on a strikeout it
  // is three strikes. That is not a defect to fix here: it is the same impossible count the
  // real feed publishes between at-bats, and passing it through is what lets the Live pane's
  // clamp be exercised without waiting for the league to do it.
  it('passes an impossible count through rather than tidying it', () => {
    const plays = [play({ sequence: 1 }), play({ sequence: 2, balls: 3, strikes: 3 })]
    const s = momentOf(GAME, plays, 1).live_state!
    expect(s.strikes).toBe(3)
  })

  // Both clocks, or `feedHealth` puts a "Waiting on the league, no update since 7:00 PM" banner
  // over the thing you opened the simulator to look at.
  it('moves the feed clocks to now', () => {
    const m = momentOf(GAME, [play({ sequence: 1 }), play({ sequence: 2 })], 1)
    expect(Date.now() - Date.parse(m.updated_at!)).toBeLessThan(5000)
    expect(Date.now() - Date.parse(m.source_updated_at!)).toBeLessThan(5000)
  })
})

describe('the end of the replay', () => {
  it('hands back the real final game once it runs out of plays', () => {
    const plays = [play({ sequence: 1 }), play({ sequence: 2 })]
    expect(momentOf(GAME, plays, 2)).toBe(GAME)
    expect(momentOf(GAME, plays, 99)).toBe(GAME)
  })

  // The simulator does not get to skip a rule the live section applies. A replay that reaches
  // the last inning with the home side in front is over, and `settleGame` says so here exactly
  // as it would for the real thing.
  it('goes final on a walk-off, through the same rule the section uses', () => {
    const plays = [
      play({ sequence: 1, inning: 7, half: 'bottom', team_id: 'BOS', event_type: 'home_run', runs_scored: 0, narrative: 'Walk-off homer.' }),
      play({ sequence: 2, inning: 7, half: 'bottom', team_id: 'BOS' }),
    ]
    const m = momentOf(GAME, plays, 1)
    expect(m.status).toBe('final')
    expect(m.final_by_rule).toBe(true)
  })
})

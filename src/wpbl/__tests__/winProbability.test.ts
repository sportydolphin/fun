import { describe, it, expect } from 'vitest'
import {
  buildWinProbModel, winProbability, gameWinProb, fmtWinPct,
} from '../derive/winProbability'
import type { RunValueGame } from '../derive/runExpectancy'
import type { WpblRunValuePlay } from '../types'

// A league in which exactly one thing happens: see `synthetic` below. Everything here is
// built from plays rather than from a hand-written table, so the tests exercise the same
// path production does, including the run-expectancy walk underneath.

let seq = 0
function play(over: Partial<WpblRunValuePlay> = {}): WpblRunValuePlay {
  return {
    game_id: 'g1', sequence: seq++, inning: 1, half: 'top', team_id: 'away',
    batter_id: null, batter_name: 'A Batter', pitcher_id: null, pitcher_name: 'A Pitcher',
    outs: 0, first_base: null, second_base: null, third_base: null,
    event_type: 'strikeout', runs_scored: 0, narrative: '', pitch_sequence: 'S',
    ...over,
  } as WpblRunValuePlay
}

function game(over: Partial<RunValueGame> = {}): RunValueGame {
  return {
    id: 'g1', game_date: '2026-08-01', status: 'final', game_type: 'regular',
    counts_in_standings: true, home_team_id: 'home', away_team_id: 'away',
    ...over,
  } as RunValueGame
}

/**
 * A season of complete half-innings, each three plate appearances long, scoring `runs` in the
 * first of them. Enough of them that every cell the model reads clears its sample floor.
 */
function synthetic(runsPerHalf: (i: number) => number, halves = 120) {
  const plays: WpblRunValuePlay[] = []
  const games: RunValueGame[] = []
  for (let h = 0; h < halves; h++) {
    const gameId = `g${Math.floor(h / 12)}`
    if (!games.some(g => g.id === gameId)) games.push(game({ id: gameId }))
    const inning = (h % 12 < 7 ? (h % 7) + 1 : 7)
    const half = h % 2 === 0 ? 'top' : 'bottom'
    const runs = runsPerHalf(h)
    // Which out the runs arrive on rotates, so every out count gets scoring observations. A
    // fixture that only ever scored with nobody out taught the model that two out is a dead
    // end, and it dutifully answered 0 for a one-run deficit in the last of the seventh.
    const scoreOn = h % 3
    for (let o = 0; o < 3; o++) {
      plays.push(play({
        game_id: gameId, inning, half, outs: o,
        team_id: half === 'top' ? 'away' : 'home',
        // The batter drives them in, so runsOnPlay sees them: `runs_scored` counts only the
        // runners, exactly as the feed does.
        event_type: o === scoreOn && runs > 0 ? 'home_run' : 'strikeout',
        runs_scored: o === scoreOn && runs > 0 ? runs - 1 : 0,
      }))
    }
    // A last half-inning per game is dropped by the walk, so give every game a spare.
    if (h % 12 === 11) plays.push(play({ game_id: gameId, inning: 7, half: 'bottom', outs: 0 }))
  }
  return { plays, games }
}

describe('the win-probability model', () => {
  it('is a coin flip with nobody on, nobody out, tied, in the first', () => {
    // A league where every half-inning scores nothing has no way to break a tie, so the
    // model should land on the extras fixed point, which is a half.
    const { plays, games } = synthetic(() => 0)
    const m = buildWinProbModel(plays, games)
    expect(winProbability(m, 1, 'top', 0, 0, 0)).toBeCloseTo(0.5, 6)
  })

  it('never leaves the unit interval, in any state it can be asked about', () => {
    const { plays, games } = synthetic(h => (h % 3 === 0 ? 2 : 0))
    const m = buildWinProbModel(plays, games)
    for (let inning = 1; inning <= 8; inning++) {
      for (const half of ['top', 'bottom'] as const) {
        for (let outs = 0; outs < 3; outs++) {
          for (let bases = 0; bases < 8; bases++) {
            for (const margin of [-20, -5, -1, 0, 1, 5, 20]) {
              const p = winProbability(m, inning, half, outs, bases as 0, margin)
              expect(p).toBeGreaterThanOrEqual(0)
              expect(p).toBeLessThanOrEqual(1)
              expect(Number.isFinite(p)).toBe(true)
            }
          }
        }
      }
    }
  })

  it('rises with the lead and falls with the deficit', () => {
    const { plays, games } = synthetic(h => (h % 3 === 0 ? 2 : 0))
    const m = buildWinProbModel(plays, games)
    let last = -1
    for (let margin = -6; margin <= 6; margin++) {
      const p = winProbability(m, 4, 'top', 1, 0, margin)
      expect(p).toBeGreaterThanOrEqual(last)
      last = p
    }
  })

  it('is more certain about the same lead later in the game', () => {
    const { plays, games } = synthetic(h => (h % 3 === 0 ? 2 : 0))
    const m = buildWinProbModel(plays, games)
    const early = winProbability(m, 1, 'top', 0, 0, 2)
    const late = winProbability(m, 7, 'top', 0, 0, 2)
    expect(late).toBeGreaterThan(early)
  })

  it('gives a home team that leads after the last top half the game', () => {
    // Nobody bats in the bottom of the seventh when the home team is already ahead, so the
    // only thing left to decide is nothing.
    const { plays, games } = synthetic(h => (h % 3 === 0 ? 2 : 0))
    const m = buildWinProbModel(plays, games)
    expect(winProbability(m, 7, 'bottom', 0, 0, 1)).toBe(1)
  })

  it('prices a state by its chance of enough runs, not by its average', () => {
    // Two down in the last of the seventh. The average state is worth well under a run, so a
    // model built on means would call a two-run deficit nearly the same as a one-run one.
    // The league needs to produce a RANGE of totals for the two to differ at all: one that
    // only ever scores three saves a one-run deficit and a two-run one with the same outcome,
    // at the same probability, which is correct and tests nothing.
    const { plays, games } = synthetic(h => h % 5)
    const m = buildWinProbModel(plays, games)
    const downOne = winProbability(m, 7, 'bottom', 2, 0, -1)
    const downTwo = winProbability(m, 7, 'bottom', 2, 0, -2)
    expect(downOne).toBeGreaterThan(0)
    expect(downOne).toBeGreaterThan(downTwo)
  })
})

describe('one game, play by play', () => {
  const { plays: seasonPlays, games: seasonGames } = synthetic(h => (h % 3 === 0 ? 2 : 0))
  const model = buildWinProbModel(seasonPlays, seasonGames)

  it('starts near even and ends on the result', () => {
    seq = 0
    const plays = [
      play({ game_id: 'x', inning: 1, half: 'top', outs: 0, team_id: 'away' }),
      play({ game_id: 'x', inning: 1, half: 'bottom', outs: 0, team_id: 'home', event_type: 'home_run', runs_scored: 0 }),
      play({ game_id: 'x', inning: 7, half: 'bottom', outs: 2, team_id: 'home' }),
    ]
    const g = gameWinProb(model, plays, { home_team_id: 'home', status: 'final', home_score: 1, away_score: 0 })
    expect(g.points).toHaveLength(3)
    expect(g.points[0].before).toBeGreaterThan(0.3)
    expect(g.points[0].before).toBeLessThan(0.7)
    // The home team won, so the last point resolves to certainty rather than to a model value.
    expect(g.final).toBe(1)
  })

  it('counts the batter on a home run, which the feed column does not', () => {
    seq = 0
    const plays = [
      play({ game_id: 'x', inning: 3, half: 'bottom', outs: 1, team_id: 'home', event_type: 'home_run', runs_scored: 0 }),
      play({ game_id: 'x', inning: 3, half: 'bottom', outs: 2, team_id: 'home' }),
    ]
    const g = gameWinProb(model, plays, { home_team_id: 'home', status: 'live', home_score: null, away_score: null })
    expect(g.points[0].runs).toBe(1)
    expect(g.points[1].margin).toBe(1)
  })

  it('names the biggest swing and adds up the movement', () => {
    seq = 0
    const plays = [
      play({ game_id: 'x', inning: 1, half: 'top', outs: 0, team_id: 'away' }),
      play({ game_id: 'x', inning: 7, half: 'bottom', outs: 2, team_id: 'home', event_type: 'home_run', runs_scored: 3 }),
      play({ game_id: 'x', inning: 7, half: 'bottom', outs: 2, team_id: 'home' }),
    ]
    const g = gameWinProb(model, plays, { home_team_id: 'home', status: 'final', home_score: 1, away_score: 0 })
    expect(g.biggest).not.toBeNull()
    expect(g.biggest!.play.event_type).toBe('home_run')
    expect(g.excitement).toBeGreaterThan(0)
    expect(g.excitement).toBeGreaterThanOrEqual(Math.abs(g.biggest!.swing))
  })

  it('does not snap a final game whose play log stops early', () => {
    // Aug 19's 11-8 at San Francisco is final and its log ends in the bottom of the sixth.
    // Pinning the result to the last recorded play there does not tidy the chart, it invents
    // a swing: a routine fly ball got credited with 28 points and became the play of the game.
    seq = 0
    const plays = [
      play({ game_id: 'x', inning: 5, half: 'top', outs: 0, team_id: 'away' }),
      play({ game_id: 'x', inning: 6, half: 'bottom', outs: 2, team_id: 'home' }),
    ]
    const g = gameWinProb(model, plays, { home_team_id: 'home', status: 'final', home_score: 8, away_score: 11 })
    const last = g.points[g.points.length - 1]
    expect(last.after).toBe(last.before)
    expect(last.swing).toBe(0)
  })

  it('snaps one that reaches the seventh', () => {
    seq = 0
    const plays = [
      play({ game_id: 'x', inning: 5, half: 'top', outs: 0, team_id: 'away' }),
      play({ game_id: 'x', inning: 7, half: 'bottom', outs: 2, team_id: 'home' }),
    ]
    const g = gameWinProb(model, plays, { home_team_id: 'home', status: 'final', home_score: 2, away_score: 1 })
    expect(g.final).toBe(1)
  })

  it('picks the decisive play from the winner\'s side, not the loudest one', () => {
    // The visitors turn the game over in one swing in the third and lose it anyway, because
    // the home team answers a run at a time. The loudest play of the game is theirs; the play
    // that WON it is the home team's, and only the second is worth calling the swing.
    //
    // The visitors' swing has to land well before the end for this to be a real test. Any
    // late deficit the winner comes back from is closed by the play that wins, so a fixture
    // where the loser's big moment is in the seventh has the two roughly equal by
    // construction, and the largest swing in the game is the winner's after all.
    seq = 0
    const homer = (inning: number, half: 'top' | 'bottom', team: string, extra = 0) =>
      play({ game_id: 'x', inning, half, outs: 0, team_id: team, event_type: 'home_run', runs_scored: extra })
    const plays = [
      homer(1, 'bottom', 'home'),
      homer(2, 'bottom', 'home'),
      homer(3, 'top', 'away', 5),      // six on one swing, and a four-run lead
      homer(3, 'bottom', 'home'),
      homer(4, 'bottom', 'home'),
      homer(5, 'bottom', 'home'),
      homer(6, 'bottom', 'home'),      // level at six
      homer(7, 'bottom', 'home'),      // and ahead, which is where it ends
    ]
    const g = gameWinProb(model, plays, { home_team_id: 'home', status: 'final', home_score: 7, away_score: 6 })
    expect(g.biggest!.play.team_id).toBe('away')
    expect(g.decisive!.play.team_id).toBe('home')
    expect(g.decisive!.swing).toBeGreaterThan(0)
    expect(Math.abs(g.biggest!.swing)).toBeGreaterThan(Math.abs(g.decisive!.swing))
  })

  it('has no decisive play while the game is still on', () => {
    seq = 0
    const plays = [
      play({ game_id: 'x', inning: 2, half: 'top', outs: 1, team_id: 'away' }),
      play({ game_id: 'x', inning: 2, half: 'top', outs: 2, team_id: 'away' }),
    ]
    const g = gameWinProb(model, plays, { home_team_id: 'home', status: 'live', home_score: null, away_score: null })
    expect(g.decisive).toBeNull()
    expect(g.biggest).not.toBeNull()
  })

  it('leaves an unfinished game on the model rather than on a result', () => {
    seq = 0
    const plays = [play({ game_id: 'x', inning: 2, half: 'top', outs: 1, team_id: 'away' })]
    const g = gameWinProb(model, plays, { home_team_id: 'home', status: 'live', home_score: null, away_score: null })
    expect(g.points[0].after).toBe(g.points[0].before)
    expect(g.points[0].swing).toBe(0)
  })
})

describe('fmtWinPct', () => {
  it('rounds to whole points', () => {
    expect(fmtWinPct(0.5)).toBe('50%')
    expect(fmtWinPct(0.344)).toBe('34%')
    expect(fmtWinPct(1)).toBe('100%')
  })
})

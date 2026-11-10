import { describe, it, expect } from 'vitest'
import { inningPitchingLines, plateAppearanceLines, teamInningLines } from '../inningLines'
import type { LeagueGame, RunValuePlay } from '../types'
import { WPBL_LEAGUE } from '../../wpbl/league'

// The inning lines are the finder's third grain, so every number on one is a number a reader can
// ask about. These pin the parts that are not a plain count: outs read off the next row, a half
// split between pitchers, a walk-off, and the club in the field.

const game = (over: Partial<LeagueGame> = {}): LeagueGame => ({
  id: 'g1', game_date: '2026-08-10', status: 'final', game_type: 'R', counts_in_standings: true,
  home_team_id: 'home', away_team_id: 'away', home_score: 0, away_score: 1, ...over,
})

let sequence = 0
const play = (over: Partial<RunValuePlay>): RunValuePlay => ({
  game_id: 'g1', sequence: sequence++, inning: 1, half: 'top', team_id: 'away',
  batter_id: 'b', batter_name: 'Batter', pitcher_id: 'p1', pitcher_name: 'Starter',
  outs: 0, first_base: '', second_base: '', third_base: '', event_type: null, runs_scored: 0,
  narrative: null, pitch_sequence: null, ...over,
})
const k0 = () => play({ outs: 0, event_type: 'strikeout', pitch_sequence: 'KSS' })
const k = (outs: number, seq = 'KSS', over: Partial<RunValuePlay> = {}) =>
  play({ outs, event_type: 'strikeout', pitch_sequence: seq, ...over })

describe('inningPitchingLines', () => {
  it('counts an immaculate inning as three strikeouts on nine strikes', () => {
    const plays = [k(0, 'KSS'), k(1, 'SKS'), k(2, 'KKS'), play({ half: 'bottom', team_id: 'home', outs: 0, event_type: 'groundout', pitch_sequence: 'P', pitcher_id: 'q' })]
    const [line] = inningPitchingLines(WPBL_LEAGUE, plays, [game()])
    expect(line).toMatchObject({ player_id: 'p1', inning: 1, half: 'top', so: 3, bf: 3, outs: 3, pitches: 9, strikes: 9 })
  })

  it('files the line under the club in the field, not the one batting', () => {
    const lines = inningPitchingLines(WPBL_LEAGUE, [
      k(0), play({ half: 'bottom', team_id: 'home', pitcher_id: 'q', event_type: 'walk', pitch_sequence: 'BBBB' }),
    ], [game()])
    expect(lines.find(l => l.half === 'top')!.team_id).toBe('home')
    expect(lines.find(l => l.half === 'bottom')!.team_id).toBe('away')
  })

  it('splits a half-inning between pitchers and credits each with their own plays', () => {
    const plays = [
      play({ outs: 0, event_type: 'walk', pitch_sequence: 'BBBB' }),
      k(0),
      k(1, 'SSS', { pitcher_id: 'p2', pitcher_name: 'Reliever' }),
      k(2, 'KKS', { pitcher_id: 'p2', pitcher_name: 'Reliever' }),
      play({ half: 'bottom', team_id: 'home', pitcher_id: 'q', event_type: 'groundout', pitch_sequence: 'P' }),
    ]
    const lines = inningPitchingLines(WPBL_LEAGUE, plays, [game()])
    expect(lines.find(l => l.player_id === 'p1')).toMatchObject({ so: 1, bb: 1, bf: 2, outs: 1, pitches: 7, strikes: 3 })
    expect(lines.find(l => l.player_id === 'p2')).toMatchObject({ so: 2, bf: 2, outs: 2 })
    // Each line opens Game Center on its own pitcher's first play, not the inning's.
    expect(lines.find(l => l.player_id === 'p1')!.sequence).toBe(plays[0].sequence)
    expect(lines.find(l => l.player_id === 'p2')!.sequence).toBe(plays[2].sequence)
  })

  it('reads a double play and a caught stealing off the next row', () => {
    const plays = [
      play({ outs: 0, event_type: 'single', pitch_sequence: 'P' }),
      play({ outs: 0, event_type: 'groundout', pitch_sequence: 'BP' }),
      play({ outs: 2, event_type: 'single', pitch_sequence: 'P' }),
      play({ outs: 2, event_type: 'caught_stealing', pitch_sequence: null }),
      play({ half: 'bottom', team_id: 'home', pitcher_id: 'q', event_type: 'groundout', pitch_sequence: 'P' }),
    ]
    const line = inningPitchingLines(WPBL_LEAGUE, plays, [game()]).find(l => l.player_id === 'p1')!
    expect(line).toMatchObject({ bf: 3, h: 2, outs: 3, pitches: 4 })
  })

  it('credits no out to the play that ends a game on a walk-off', () => {
    const plays = [
      play({ half: 'bottom', team_id: 'home', outs: 1, event_type: 'home_run', pitch_sequence: 'BP', runs_scored: 0 }),
    ]
    const [line] = inningPitchingLines(WPBL_LEAGUE, plays, [game({ home_score: 1, away_score: 0 })])
    // WPBL's feed leaves the batter out of `runs_scored`, so the solo home run's run comes from
    // the league's `runsOnPlay`, never the raw column.
    expect(line).toMatchObject({ outs: 0, h: 1, hr: 1, r: 1, team_id: 'away' })
  })

  it('takes the last half-inning of a game the home side lost to end on three outs', () => {
    const plays = [play({ half: 'bottom', team_id: 'home', outs: 2, event_type: 'flyout', pitch_sequence: 'P' })]
    const [line] = inningPitchingLines(WPBL_LEAGUE, plays, [game()])
    expect(line.outs).toBe(1)
  })

  it('opens on the first at-bat, past a substitution, and counts a mid-at-bat row once', () => {
    const plays = [
      play({ outs: 0, event_type: 'unknown', narrative: 'Reliever to p.', pitch_sequence: null }),
      play({ outs: 0, batter_id: 'kim', event_type: 'single', pitch_sequence: 'KP' }),
      // The balk that scores a run mid-at-bat, then the same batter's whole at-bat.
      play({ outs: 0, batter_id: 'lee', event_type: 'unknown', pitch_sequence: 'BB', runs_scored: 1 }),
      play({ outs: 0, batter_id: 'lee', event_type: 'walk', pitch_sequence: 'BBBB' }),
      play({ half: 'bottom', team_id: 'home', pitcher_id: 'q', event_type: 'groundout', pitch_sequence: 'P' }),
    ]
    const line = inningPitchingLines(WPBL_LEAGUE, plays, [game()]).find(l => l.player_id === 'p1')!
    expect(line.sequence).toBe(plays[1].sequence)
    expect(line).toMatchObject({ bf: 2, pitches: 6, bb: 1, r: 1 })
  })

  it('skips a play whose game is not held, and one with no pitcher', () => {
    const lines = inningPitchingLines(WPBL_LEAGUE, [
      k(0, 'KSS', { game_id: 'elsewhere' }),
      k(0, 'KSS', { pitcher_id: null }),
    ], [game()])
    expect(lines).toEqual([])
  })
})

describe('plateAppearanceLines', () => {
  it('reads the count before the last pitch, with the foul rule', () => {
    // B, K, F, F, F, then in play: 1-2 when the ball was hit, since a foul with two strikes is no strike.
    const [pa] = plateAppearanceLines(WPBL_LEAGUE, [play({ batter_id: 'kim', event_type: 'home_run', pitch_sequence: 'BKFFFP' })], [game()])
    expect(pa).toMatchObject({ balls: 1, scount: 2, pitches: 6, fouls: 3, strikes: 5, hr: 1, h: 1, tb: 4, event: 'HR', runs: 1 })
    const [k] = plateAppearanceLines(WPBL_LEAGUE, [k0()], [game()])
    expect(k).toMatchObject({ balls: 0, scount: 2, so: 1, event: 'K' })
  })

  it('reads the outs and runners it began with, and files both clubs', () => {
    const [pa] = plateAppearanceLines(WPBL_LEAGUE, [play({ outs: 2, first_base: 'A', second_base: '', third_base: 'C', event_type: 'walk', pitch_sequence: 'BBBB' })], [game()])
    expect(pa).toMatchObject({ paouts: 2, on: 2, risp: 1, bb: 1, batting_team: 'away', fielding_team: 'home', balls: 3, scount: 0 })
  })

  it('skips rows that are not a plate appearance, and the start of the next one', () => {
    const pas = plateAppearanceLines(WPBL_LEAGUE, [
      play({ event_type: 'stolen_base', pitch_sequence: null }),
      play({ batter_id: 'lee', event_type: 'unknown', pitch_sequence: 'BB', runs_scored: 1 }),
      play({ batter_id: 'lee', event_type: 'walk', pitch_sequence: 'BBBB' }),
    ], [game()])
    expect(pas).toHaveLength(1)
    expect(pas[0].bb).toBe(1)
  })

  it('marks the walk-off, and only the play that won it', () => {
    const plays = [
      play({ half: 'bottom', team_id: 'home', outs: 0, event_type: 'single', pitch_sequence: 'P' }),
      play({ half: 'bottom', team_id: 'home', outs: 0, event_type: 'double', pitch_sequence: 'BP', runs_scored: 1 }),
      play({ half: 'bottom', team_id: 'home', outs: 0, event_type: 'unknown', narrative: 'Sub to pr.', pitch_sequence: null }),
    ]
    const pas = plateAppearanceLines(WPBL_LEAGUE, plays, [game({ home_score: 1, away_score: 0 })])
    expect(pas.map(p => p.walkoff)).toEqual([0, 1])
    expect(plateAppearanceLines(WPBL_LEAGUE, plays, [game({ home_score: 1, away_score: 3 })]).every(p => p.walkoff === 0)).toBe(true)
  })
})

describe('teamInningLines', () => {
  it('files a half-inning under the club batting, with its two-out runs', () => {
    const plays = [
      play({ outs: 0, event_type: 'single', pitch_sequence: 'P' }),
      play({ outs: 0, event_type: 'strikeout', pitch_sequence: 'KSS' }),
      play({ outs: 1, event_type: 'walk', pitch_sequence: 'BBBB' }),
      play({ outs: 1, event_type: 'flyout', pitch_sequence: 'P' }),
      play({ outs: 2, event_type: 'home_run', pitch_sequence: 'BP', runs_scored: 2 }),
      play({ outs: 2, event_type: 'groundout', pitch_sequence: 'P' }),
      play({ half: 'bottom', team_id: 'home', pitcher_id: 'q', event_type: 'groundout', pitch_sequence: 'P' }),
    ]
    const [top] = teamInningLines(WPBL_LEAGUE, plays, [game()])
    expect(top).toMatchObject({ team_id: 'away', half: 'top', r: 3, r2: 3, h: 2, hr: 1, tb: 5, bb: 1, so: 1, ab: 5, sequence: plays[0].sequence })
    // Plate appearances as the finder sums them on a batting line.
    expect(top.ab + top.bb + top.hbp + top.sf + top.sh).toBe(6)
  })

  it('reads the score the half began in, and whether it took the lead', () => {
    const plays = [
      play({ inning: 1, half: 'top', outs: 0, event_type: 'home_run', pitch_sequence: 'P' }),
      play({ inning: 1, half: 'top', outs: 0, event_type: 'home_run', pitch_sequence: 'P' }),
      play({ inning: 1, half: 'bottom', team_id: 'home', pitcher_id: 'q', outs: 0, event_type: 'home_run', pitch_sequence: 'P' }),
      play({ inning: 2, half: 'top', outs: 0, event_type: 'groundout', pitch_sequence: 'P' }),
      play({ inning: 2, half: 'bottom', team_id: 'home', pitcher_id: 'q', outs: 0, event_type: 'double', pitch_sequence: 'P' }),
      play({ inning: 2, half: 'bottom', team_id: 'home', pitcher_id: 'q', outs: 0, event_type: 'home_run', pitch_sequence: 'P', runs_scored: 1 }),
    ]
    const lines = teamInningLines(WPBL_LEAGUE, plays, [game({ home_score: 3, away_score: 2 })])
    expect(lines.map(l => [l.inning, l.half, l.r, l.trail, l.tooklead])).toEqual([
      [1, 'top', 2, 0, 1], [1, 'bottom', 1, 2, 0], [2, 'top', 0, 0, 0], [2, 'bottom', 2, 1, 1],
    ])
  })
})

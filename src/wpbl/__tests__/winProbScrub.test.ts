import { describe, it, expect } from 'vitest'
import { restingReadout, scrubReadout } from '../WinProbView'
import type { WinProbPoint } from '../derive/winProbability'
import type { WpblGame, WpblRunValuePlay, WpblTeam } from '../types'
import { wpblShortName } from '../ui'

// The row is one line, so the readouts take the section's name shortener the way the card
// passes it in. `full` keeps a name whole, for the assertions that are not about width.
const full = (n: string) => n
const short = (n: string) => wpblShortName(n, 14)

// The readout, which is the only part of this card that is a decision rather than a gesture:
// which club the two percentages are about, when they are worth printing twice, and what the
// card claims about the play it rests on.

const game = { home_team_id: 'sf', away_team_id: 'la', status: 'final' } as WpblGame
const teams = new Map<string, WpblTeam>([
  ['sf', { id: 'sf', abbr: 'SF' } as WpblTeam],
  ['la', { id: 'la', abbr: 'LA' } as WpblTeam],
])

function point(over: Partial<WinProbPoint> = {}, play: Partial<WpblRunValuePlay> = {}): WinProbPoint {
  return {
    play: {
      game_id: 'g1', sequence: 1, inning: 6, half: 'top', team_id: 'la',
      batter_id: null, batter_name: 'Jamie Mackay', pitcher_id: null, pitcher_name: null,
      outs: 2, first_base: null, second_base: null, third_base: null,
      event_type: 'single', runs_scored: 1,
      narrative: 'Jamie Mackay singled up the middle; Ada Reyes scored.', pitch_sequence: 'BS',
      ...play,
    } as WpblRunValuePlay,
    before: 0.4, after: 0.7, swing: 0.3, runs: 2, margin: -1, homeScore: 3, awayScore: 4,
    ...over,
  }
}

describe('scrubReadout', () => {
  it('reads the percentages for the club the play left in front', () => {
    // A play that hands the game to the home team is the home team's line...
    expect(scrubReadout(point({ before: 0.4, after: 0.7 }), game, teams, full).pct).toBe('SF 40% → 70%')
    // ...and one that leaves the visitors in front is told from theirs, rather than as San
    // Francisco falling away.
    expect(scrubReadout(point({ before: 0.45, after: 0.2 }), game, teams, full).pct).toBe('LA 55% → 80%')
  })

  it('prints one percentage when rounding makes the two the same', () => {
    expect(scrubReadout(point({ before: 0.702, after: 0.704 }), game, teams, full).pct).toBe('SF 70%')
  })

  it('says where in the game it was, what happened, and the score it left', () => {
    const r = scrubReadout(point(), game, teams, full)
    expect(r.label).toBe('Top 6th · 2 out')
    expect(r.text).toBe('Jamie Mackay singled up the middle.')   // runner movements dropped
    expect(r.note).toBe('LA 4, SF 3')                            // visitors first, as a line score reads
  })

  it('still reads a play the feed left no narrative for', () => {
    const r = scrubReadout(point({}, { narrative: null, half: 'bottom', inning: 1, outs: 0 }), game, teams, full)
    expect(r.label).toBe('Bot 1st · 0 out')
    expect(r.text).toBe('No play recorded.')
  })
})

describe('restingReadout', () => {
  it('calls a big swing the swing of the game, and names the inning', () => {
    const r = restingReadout(point({ swing: 0.3 }), game, teams, full, false, true)
    expect(r.label).toBe('Swing of the game · 6th')
    expect(r.text).toBe('Jamie Mackay singled up the middle.')
  })

  // The point of the floor: a rout has no swing, so the card must not claim one. It still
  // shows the play, which is the part that used to go missing.
  it('will not call the biggest play of a rout the swing of the game, but still shows it', () => {
    const r = restingReadout(point({ swing: 0.08 }), game, teams, full, false, true)
    expect(r.label).toBe('Biggest moment · 6th')
    expect(r.text).toContain('Jamie Mackay singled up the middle')
  })

  // A tie and a game in progress share the problem: no winner, so nothing has swung to one.
  it('says "so far" while the game is still being played', () => {
    const live = { ...game, status: 'live' } as WpblGame
    expect(restingReadout(point({ swing: 0.3 }), live, teams, full, false, false).label).toBe('Biggest moment so far · 6th')
  })

  it('will not call anything the swing of a game that has no winner yet', () => {
    expect(restingReadout(point({ swing: 0.3 }), game, teams, full, false, false).label).toBe('Biggest moment · 6th')
  })

  it('spends its third line telling the reader the chart can be read', () => {
    expect(restingReadout(point(), game, teams, full, false, true).note).toBe('Hold the chart for any play')
    expect(restingReadout(point(), game, teams, full, true, true).note).toBe('Hover the chart for any play')
  })
})

describe('one line', () => {
  // The row cannot wrap, so the name is the part that gives way: what survives the width is
  // what happened, not who it was attributed to in full.
  it('abbreviates a long name and leaves the play alone', () => {
    const p = point({}, { batter_name: 'Tháima Maximiliana', narrative: 'Tháima Maximiliana struck out looking.' })
    expect(scrubReadout(p, game, teams, short).text).toBe('T. Maximiliana struck out looking.')
  })

  it('leaves a name that already fits', () => {
    expect(scrubReadout(point(), game, teams, short).text).toBe('Jamie Mackay singled up the middle.')
  })
})

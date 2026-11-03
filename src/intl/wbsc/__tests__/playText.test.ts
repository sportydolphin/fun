import { describe, it, expect } from 'vitest'
import type { RunValuePlay } from '../../../league/types'
import { gamePlayTexts, playText } from '../playText'

// Synthetic plays only (see fixture.ts for why).

let seq = 0
const play = (event_type: string, batter: string, bases: [string, string, string], outs: number, p: Partial<RunValuePlay> = {}): RunValuePlay => ({
  game_id: 'g', sequence: ++seq, team_id: 'AAA', batter_id: null, batter_name: batter, pitcher_id: null, pitcher_name: 'Pia Pitch',
  event_type, pitch_sequence: null, inning: 1, half: 'top', outs,
  first_base: bases[0], second_base: bases[1], third_base: bases[2], runs_scored: 0, narrative: 'WBSC WORDS', ...p,
})

const after = (bases: [string, string, string], outs: number) => ({ bases, outs })

describe('World Cup play text', () => {
  it("never uses the scorer's sentence", () => {
    expect(playText(play('single', 'Ana Alpha', ['', '', ''], 0), after(['Ana Alpha', '', ''], 0))).toBe('Ana Alpha singled.')
  })

  it('names the runners who scored and moved, scorers first', () => {
    const p = play('single', 'Cat Charlie', ['Ana Alpha', 'Bea Bravo', 'Dee Delta'], 1, { runs_scored: 2 })
    expect(playText(p, after(['Cat Charlie', '', 'Ana Alpha'], 1)))
      .toBe('Cat Charlie singled. Dee Delta and Bea Bravo scored. Ana Alpha to third.')
  })

  it('reads a strikeout from the last pitch', () => {
    expect(playText(play('strikeout', 'Ana Alpha', ['', '', ''], 0, { pitch_sequence: 'BCC' }), after(['', '', ''], 1))).toBe('Ana Alpha struck out looking.')
    expect(playText(play('strikeout', 'Ana Alpha', ['', '', ''], 0, { pitch_sequence: 'BCS' }), after(['', '', ''], 1))).toBe('Ana Alpha struck out swinging.')
  })

  it('counts a home run and does not list the runners', () => {
    expect(playText(play('home_run', 'Ana Alpha', ['Bea Bravo', '', ''], 0, { runs_scored: 2 }), after(['', '', ''], 0))).toBe('Ana Alpha hit a two-run home run.')
  })

  it('tells a steal from a runner scoring on one', () => {
    const p = play('stolen_base', 'Ana Alpha', ['Bea Bravo', '', 'Cat Charlie'], 0, { runs_scored: 1 })
    expect(playText(p, after(['', 'Bea Bravo', ''], 0))).toBe('Bea Bravo stole second. Cat Charlie stole home.')
  })

  it('names no one when a play both scores a runner and puts one out', () => {
    const p = play('fielders_choice', 'Ana Alpha', ['Bea Bravo', '', 'Cat Charlie'], 0, { runs_scored: 1 })
    expect(playText(p, after(['Ana Alpha', '', ''], 1))).toBe("Ana Alpha reached on a fielder's choice. 1 run scored.")
  })

  it('leaves the runners stranded by the third out where they were, and calls a double play', () => {
    const p = play('groundout', 'Ana Alpha', ['Bea Bravo', '', 'Cat Charlie'], 1)
    expect(playText(p, null)).toBe('Ana Alpha grounded out. Double play.')
  })

  it('names the one runner caught stealing for the third out', () => {
    expect(playText(play('caught_stealing', 'Ana Alpha', ['Bea Bravo', '', ''], 2), null)).toBe('Bea Bravo was caught stealing.')
  })

  it('works out each play from the next one within the half only', () => {
    const plays = [
      play('walk', 'Ana Alpha', ['', '', ''], 2),
      play('flyout', 'Bea Bravo', ['Ana Alpha', '', ''], 2),
      play('single', 'Cat Charlie', ['', '', ''], 0, { half: 'bottom' }),
    ]
    expect(gamePlayTexts(plays)).toEqual(['Ana Alpha walked.', 'Bea Bravo flied out.', 'Cat Charlie singled.'])
  })
})

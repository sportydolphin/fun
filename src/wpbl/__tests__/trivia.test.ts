import { describe, it, expect } from 'vitest'
import {
  buildQuestion, isTriviaCandidate, isPossibleOutcome, describeRunners, describeSituation,
  seededRng, seedFrom, type TriviaPlay,
} from '../derive/trivia'

// "Call the Play" turns a real plate appearance into a multiple-choice question. Two things
// ruin it and neither is visible by reading one question: an option that gives the answer
// away, and an option that could never have been right, which quietly turns four choices into
// three. Both are decided here.

const play = (over: Partial<TriviaPlay> = {}): TriviaPlay => ({
  id: 'p1', game_id: 'g1', sequence: 12,
  inning: 4, half: 'bottom', outs: 1, balls: 1, strikes: 1,
  first_base: '', second_base: '', third_base: '',
  batter_name: 'Ada Batter', pitcher_name: 'Bea Pitcher',
  event_type: 'single', narrative: 'Ada Batter singled to left field (1-1 BK).',
  ...over,
})

const rng = () => seededRng(seedFrom('fixed-seed'))

describe('the count must not give the answer away', () => {
  it('never shows a third strike, because only a strikeout has one', () => {
    // The feed stores the count AFTER the deciding pitch, so a raw 0-3 reads "strikeout"
    // before the reader has finished the sentence. 120 of ~983 questions would be free.
    const out = describeSituation(play({ balls: 0, strikes: 3, event_type: 'strikeout' }))
    expect(out).toContain('Count 0-2')
    expect(out).not.toContain('0-3')
  })

  it('never shows a fourth ball, because only a walk has one', () => {
    const out = describeSituation(play({ balls: 4, strikes: 1, event_type: 'walk' }))
    expect(out).toContain('Count 3-1')
    expect(out).not.toContain('4-1')
  })

  it('shows an ordinary count untouched', () => {
    expect(describeSituation(play({ balls: 2, strikes: 1 }))).toContain('Count 2-1')
  })

  it('never leaks the outcome into the prompt', () => {
    const q = buildQuestion(play({ event_type: 'home_run', narrative: 'Ada Batter homered to left.' }), rng())
    expect(q.prompt.toLowerCase()).not.toContain('homer')
    expect(q.prompt).not.toContain(q.detail)
  })
})

describe('isPossibleOutcome', () => {
  it('rules out a walk until the count shows three balls', () => {
    expect(isPossibleOutcome('walk', 0, 0)).toBe(false)
    expect(isPossibleOutcome('walk', 2, 1)).toBe(false)
    expect(isPossibleOutcome('walk', 3, 1)).toBe(true)
  })

  it('rules out a strikeout until the count shows two strikes', () => {
    expect(isPossibleOutcome('strikeout', 1, 0)).toBe(false)
    expect(isPossibleOutcome('strikeout', 1, 2)).toBe(true)
  })

  it('allows a hit by pitch on any count, because being hit is an accident', () => {
    // Gating this like a walk was a real mistake: the season has 17 at one ball and 10 at
    // two, so the rule made it a dead option on 27 questions.
    expect(isPossibleOutcome('hit_by_pitch', 0, 0)).toBe(true)
    expect(isPossibleOutcome('hit_by_pitch', 1, 1)).toBe(true)
  })

  it('leaves batted-ball outcomes alone', () => {
    for (const e of ['single', 'double', 'home_run', 'groundout', 'flyout', 'sacrifice']) {
      expect(isPossibleOutcome(e, 0, 0)).toBe(true)
    }
  })
})

describe('buildQuestion', () => {
  it('offers four distinct options, one of them correct', () => {
    const q = buildQuestion(play(), rng())
    expect(q.options).toHaveLength(4)
    expect(new Set(q.options).size).toBe(4)
    expect(q.options[q.correctIndex]).toBe('Single')
  })

  it('never offers an option that could not have happened', () => {
    // An 0-0 count cannot end in a walk or a strikeout, so neither may appear.
    const q = buildQuestion(play({ balls: 0, strikes: 0 }), rng())
    expect(q.options).not.toContain('Walk')
    expect(q.options).not.toContain('Strikeout')
  })

  it('does offer them once the count allows', () => {
    const q = buildQuestion(play({ balls: 3, strikes: 2, event_type: 'walk' }), rng())
    expect(q.options).toContain('Walk')
  })

  it('never offers two outs a spectator could not tell apart', () => {
    // "Fly out" against "Pop up" is not a question, it is a coin toss wearing a uniform.
    const outs = ['Groundout', 'Fly out', 'Pop up', 'Line out', 'Foul out', 'Out in play']
    for (const et of ['groundout', 'flyout', 'single', 'home_run']) {
      const q = buildQuestion(play({ event_type: et, balls: 1, strikes: 1 }), rng())
      expect(q.options.filter(o => outs.includes(o)).length).toBeLessThanOrEqual(1)
    }
  })

  it('never offers walk and hit by pitch together, for the same reason', () => {
    const q = buildQuestion(play({ balls: 3, strikes: 1 }), rng())
    expect(q.options.filter(o => o === 'Walk' || o === 'Hit by pitch').length).toBeLessThanOrEqual(1)
  })

  it('never offers a triple, which the league has not hit all season', () => {
    for (let i = 0; i < 40; i++) {
      const q = buildQuestion(play({ id: `p${i}` }), seededRng(seedFrom(`p${i}`)))
      expect(q.options).not.toContain('Triple')
    }
  })

  it('is reproducible from its seed, so a button press can rebuild it', () => {
    // The Discord path gets the click as a separate request. Rebuilding from the play id
    // beats trusting the client to say what the options were.
    const a = buildQuestion(play(), seededRng(seedFrom('p1')))
    const b = buildQuestion(play(), seededRng(seedFrom('p1')))
    expect(b.options).toEqual(a.options)
    expect(b.correctIndex).toBe(a.correctIndex)
  })

  it('does not put the answer in the same place every time', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 60; i++) {
      seen.add(buildQuestion(play({ id: `p${i}` }), seededRng(seedFrom(`p${i}`))).correctIndex)
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('refuses a play it cannot ask about', () => {
    expect(() => buildQuestion(play({ event_type: 'unknown' }), rng())).toThrow(/cannot be a question/)
  })
})

describe('isTriviaCandidate', () => {
  it('drops the 21% of rows that are pickoffs and substitutions', () => {
    expect(isTriviaCandidate(play({ event_type: 'unknown' }))).toBe(false)
    expect(isTriviaCandidate(play({ event_type: 'stolen_base' }))).toBe(false)
    expect(isTriviaCandidate(play({ event_type: null }))).toBe(false)
  })

  it('drops a play with nobody batting or no situation to read', () => {
    expect(isTriviaCandidate(play({ batter_name: null }))).toBe(false)
    expect(isTriviaCandidate(play({ inning: null }))).toBe(false)
    expect(isTriviaCandidate(play({ outs: null }))).toBe(false)
  })

  it('keeps an ordinary plate appearance', () => {
    expect(isTriviaCandidate(play())).toBe(true)
  })
})

describe('describeRunners', () => {
  it('says bases empty when the feed sends empty strings, not nulls', () => {
    expect(describeRunners(play())).toBe('Bases empty')
  })

  it('names the runners, because a name is a story and "a runner" is not', () => {
    expect(describeRunners(play({ second_base: 'Cleo Runner' }))).toBe('Cleo Runner on 2nd')
  })

  it('lists several in base order', () => {
    const out = describeRunners(play({ first_base: 'A One', third_base: 'C Three' }))
    expect(out).toBe('A One on 1st, C Three on 3rd')
  })

  it('calls it bases loaded when it is', () => {
    const out = describeRunners(play({ first_base: 'A', second_base: 'B', third_base: 'C' }))
    expect(out).toContain('Bases loaded')
  })
})

describe('describeSituation', () => {
  it('reads as a situation someone could call', () => {
    const out = describeSituation(play({ inning: 9, half: 'top', outs: 2, second_base: 'Cleo Runner' }))
    expect(out).toContain('Top 9th, 2 out')
    expect(out).toContain('Cleo Runner on 2nd')
    expect(out).toContain('Ada Batter')
    expect(out).toContain('Bea Pitcher')
  })

  it('says "1 out" rather than "1 outs"', () => {
    expect(describeSituation(play({ outs: 1 }))).toContain('1 out.')
  })

  it('copes with a play carrying no pitcher', () => {
    expect(describeSituation(play({ pitcher_name: null }))).toContain('Ada Batter** batting.')
  })
})

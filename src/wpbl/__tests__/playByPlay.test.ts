import { describe, it, expect } from 'vitest'
import { parsePlay } from '../derive/playByPlay'

// The real shortener maps a full name to a display form; here surnames stand in for it.
const shorten = (t: string) => t
  .replace(/\bDenae Benites\b/g, 'Benites')
  .replace(/\bElodie Ciamarro\b/g, 'Ciamarro')
  .replace(/\bHyeonah Kim\b/g, 'Kim')
  .replace(/\bAlli Schroder\b/g, 'Schroder')
  .replace(/\bTicara Geldenhuis\b/g, 'Geldenhuis')

describe('parsePlay', () => {
  it('splits the batter, the outcome and the count apart', () => {
    const p = parsePlay('Kelsie Whitmore grounded out to 3b (0-0).', 'Kelsie Whitmore', shorten)
    expect(p.who).toBe('Kelsie Whitmore')
    expect(p.what).toBe('grounded out to 3b')
    expect(p.count).toBe('0-0')
    expect(p.detail).toBeNull()
  })

  it('drops the raw pitch letters but keeps the count', () => {
    expect(parsePlay('Denver Bryant singled up the middle (1-2 SFB).', 'Denver Bryant', shorten).count)
      .toBe('1-2')
  })

  it('condenses runner clauses onto one line', () => {
    const p = parsePlay(
      "Kylee Lahners reached on a fielder's choice, RBI (0-0); Denae Benites out at second ss to 2b; Elodie Ciamarro scored on an error by 2b, unearned.",
      'Kylee Lahners', shorten)
    expect(p.who).toBe('Kylee Lahners')
    expect(p.what).toBe("reached on a fielder's choice, RBI")
    expect(p.detail).toBe('Benites out at 2nd · Ciamarro scored on an error')
    expect(p.kind).toBe('play')
  })

  it('strips fielding sequences, which the box score already carries', () => {
    const p = parsePlay('X Y singled (0-0); Madison Willan out at home p to c.', 'X Y', shorten)
    expect(p.detail).toBe('Madison Willan out at home')
  })

  it('keeps "out to ss" in the outcome — that is not a fielding sequence', () => {
    expect(parsePlay('Claire Eccles lined out to ss (1-2 KFB).', 'Claire Eccles', shorten).what)
      .toBe('lined out to ss')
  })

  it('shortens the long multi-runner case to something readable', () => {
    const p = parsePlay(
      'Denver Bryant doubled to right field, advanced to third on an error by 2b, 2 RBI (1-0 B); Hyeonah Kim scored; Alli Schroder scored, unearned; Ticara Geldenhuis scored, unearned.',
      'Denver Bryant', shorten)
    expect(p.what).toBe('doubled to right field, advanced to 3rd on an error, 2 RBI')
    expect(p.detail).toBe('Kim scored · Schroder scored · Geldenhuis scored')
  })

  it('leaves a runner-only play unattributed rather than guessing a batter', () => {
    const p = parsePlay('Samaria Benitez advanced to second on a wild pitch.', null, shorten)
    expect(p.who).toBeNull()
    expect(p.what).toBe('Samaria Benitez advanced to 2nd on a wild pitch')
    expect(p.count).toBeNull()
  })

  it('uses the same base names on both lines', () => {
    // The bug this guards: the batter's line said "advanced to second" while the runner line
    // directly beneath said "to 2nd" for exactly the same movement.
    const p = parsePlay(
      'Maggie Foxx advanced to second; Ashton Lansdell advanced to third.', null, shorten)
    expect(p.what).toContain('to 2nd')
    expect(p.detail).toBe('Ashton Lansdell to 3rd')
  })

  it('marks a substitution as such rather than dressing it up as a play', () => {
    const p = parsePlay('Raine Padgham to p for Paloma Benach', null, shorten)
    expect(p.kind).toBe('substitution')
    expect(p.what).toBe('Raine Padgham to p for Paloma Benach')
    expect(p.count).toBeNull()
  })

  it('does not mistake a real play for a substitution', () => {
    expect(parsePlay('Kelsie Whitmore grounded out to 3b (0-0).', 'Kelsie Whitmore', shorten).kind)
      .toBe('play')
  })

  it('does not strip a name that is not the play\'s batter', () => {
    const p = parsePlay('Jaida Lee struck out swinging (1-2).', 'Elodie Ciamarro', shorten)
    expect(p.who).toBeNull()
    expect(p.what).toBe('Jaida Lee struck out swinging')
  })

  it('survives an empty narrative rather than throwing', () => {
    expect(parsePlay('', null, shorten)).toEqual({ who: null, what: '', count: null, detail: null, kind: 'play' })
  })
})

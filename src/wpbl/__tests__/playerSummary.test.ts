import { describe, it, expect } from 'vitest'
import { wpblBattingSummary, wpblPitchingSummary } from '../derive/playerSummary'

// This line is the only thing on the player sheet a reader can read rather than parse, which
// makes it the only thing there that can be WRONG rather than merely dense. Two ways it goes
// wrong: it says something the numbers do not support, or it speaks at all from a sample that
// cannot carry a sentence. Both are below.

const bat = (over: Record<string, number> = {}) => ({
  ab: 43, h: 17, doubles: 3, triples: 0, hr: 1, rbi: 11, bb: 7, so: 1, sb: 0, ...over,
})
const pit = (over: Record<string, number> = {}) => ({
  outs: 63, so: 24, bb: 6, hr: 1, w: 3, l: 1, s: 0, gs: 4, ...over,
})

describe('wpblBattingSummary', () => {
  // The real Andréanne Leblanc line, which is what prompted this: seven walks and one
  // strikeout are two tiles four columns apart and the fact is that the first is bigger.
  it('leads with the relationship a box score hides', () => {
    expect(wpblBattingSummary(bat(), null)).toBe('More walks (7) than strikeouts (1).')
  })

  it('names a top-third rank, and puts it first', () => {
    expect(wpblBattingSummary(bat(), { label: 'HR', rank: 3, of: 31 }))
      .toBe('3rd in the league in HR, and more walks (7) than strikeouts (1).')
  })

  // The strip already draws every rank with a bar. A sentence saying "22nd" adds a word for a
  // fact the reader can see, so the rank clause is for the top third only.
  it('stays quiet about a rank that is not worth saying aloud', () => {
    expect(wpblBattingSummary(bat(), { label: 'HR', rank: 22, of: 31 }))
      .toBe('More walks (7) than strikeouts (1).')
  })

  it('describes a strikeout-heavy season when that is the shape', () => {
    expect(wpblBattingSummary(bat({ bb: 2, so: 18 }), null))
      .toBe('A strikeout in 42% of her at-bats.')
  })

  it('reaches for extra-base hits when the discipline line has nothing to say', () => {
    expect(wpblBattingSummary(bat({ bb: 1, so: 4, h: 10, doubles: 4, hr: 2 }), null))
      .toBe('6 of her 10 hits for extra bases.')
  })

  it('falls back to steals, then to home runs', () => {
    expect(wpblBattingSummary(bat({ bb: 1, so: 4, doubles: 0, hr: 0, sb: 9 }), null))
      .toBe('9 stolen bases.')
    expect(wpblBattingSummary(bat({ bb: 1, so: 4, h: 20, doubles: 0, hr: 4, sb: 0 }), null))
      .toBe('4 home runs.')
  })

  // A sentence built on six at-bats reads with exactly the authority of one built on six
  // hundred, and this league plays fifteen games.
  it('says nothing at all below the sample floor', () => {
    expect(wpblBattingSummary(bat({ ab: 11 }), { label: 'HR', rank: 1, of: 31 })).toBeNull()
    expect(wpblBattingSummary(bat({ ab: 0, h: 0, doubles: 0, hr: 0, bb: 0, so: 0 }), null)).toBeNull()
  })

  it('says nothing when no clause earns its place', () => {
    expect(wpblBattingSummary(bat({ bb: 2, so: 3, h: 10, doubles: 1, triples: 0, hr: 0, sb: 0 }), null))
      .toBeNull()
  })

  // A rank of 1 in a field of four is not a league-wide fact worth a sentence.
  it('will not call someone the best of a handful', () => {
    expect(wpblBattingSummary(bat({ bb: 1, so: 4, doubles: 0, hr: 0 }), { label: 'HR', rank: 1, of: 4 }))
      .toBeNull()
  })
})

describe('wpblPitchingSummary', () => {
  it('leads with the strikeout-to-walk relationship', () => {
    expect(wpblPitchingSummary(pit(), null)).toBe('24 strikeouts against 6 walks.')
  })

  it('names a top-third rank first', () => {
    expect(wpblPitchingSummary(pit(), { label: 'K/9', rank: 2, of: 12 }))
      .toBe('2nd in the league in K/9, and 24 strikeouts against 6 walks.')
  })

  it('has a sentence for a pitcher who has walked nobody', () => {
    expect(wpblPitchingSummary(pit({ bb: 0, so: 8 }), null)).toBe('8 strikeouts and no walks.')
  })

  it('falls back to a raw strikeout count, then to saves', () => {
    expect(wpblPitchingSummary(pit({ bb: 10, so: 16 }), null)).toBe('16 strikeouts in 21.0 innings.')
    expect(wpblPitchingSummary(pit({ bb: 10, so: 6, s: 4 }), null)).toBe('4 saves.')
  })

  // One appearance is a game story, not a season.
  it('says nothing from a single outing', () => {
    expect(wpblPitchingSummary(pit({ outs: 14 }), { label: 'ERA', rank: 1, of: 12 })).toBeNull()
  })

  // ERA and WHIP are printed directly above with their own ranks; repeating either here is the
  // duplication this whole change removed.
  it('never repeats the hero pair', () => {
    for (const best of [null, { label: 'K/BB', rank: 1, of: 12 }]) {
      const line = wpblPitchingSummary(pit(), best) ?? ''
      expect(line).not.toMatch(/\bERA\b/)
      expect(line).not.toMatch(/\bWHIP\b/)
    }
  })
})

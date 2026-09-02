import { describe, it, expect } from 'vitest'
import { wpblBattingSummary, wpblPitchingSummary } from '../derive/playerSummary'

// This line is the only thing on the player sheet a reader can read rather than parse, which
// makes it the only thing there that can be WRONG rather than merely dense. Two ways it goes
// wrong: it says something the numbers do not support, or it speaks at all from a sample that
// cannot carry a sentence. Both are below.

const bat = (over: Record<string, number> = {}) => ({
  ab: 43, r: 0, h: 17, doubles: 3, triples: 0, hr: 1, rbi: 11, bb: 7, so: 1, sb: 0, cs: 0, hbp: 0, ...over,
})
const pit = (over: Record<string, number | null> = {}) => ({
  outs: 63, so: 24, bb: 6, hr: 1, w: 3, l: 1, s: 0, gs: 4, pitches: 0, strikePct: null, ...over,
} as Parameters<typeof wpblPitchingSummary>[0])

describe('wpblBattingSummary', () => {
  // The real Andréanne Leblanc line, which is what prompted this: seven walks and one
  // strikeout are two tiles four columns apart and the fact is that the first is bigger.
  it('leads with the relationship a box score hides', () => {
    expect(wpblBattingSummary(bat())).toBe('More walks (7) than strikeouts (1).')
  })

  // NO RANKS, EVER, which is a rule about the card rather than about the sentence. This used to
  // open with the best rank the hero was not already showing, and the strip below then drew
  // that same stat with its value, its bar AND its ordinal, about 110px lower on a desktop
  // card. The clause could only fire for a qualified player, and a qualified player always has
  // the strip, so every rank it could name was already drawn better a little further down.
  it('never names a rank, because the strip below always draws it', () => {
    const line = wpblBattingSummary(bat({ hr: 9, h: 26, doubles: 1, bb: 6, so: 5, ab: 48 })) ?? ''
    expect(line).not.toMatch(/\d(st|nd|rd|th)\b/)
    expect(line).not.toMatch(/in the league/)
  })

  it('describes a strikeout-heavy season when that is the shape', () => {
    expect(wpblBattingSummary(bat({ bb: 2, so: 18 })))
      .toBe('A strikeout in 42% of her at-bats.')
  })

  it('reaches for extra-base hits when the discipline line has nothing to say', () => {
    expect(wpblBattingSummary(bat({ bb: 1, so: 4, h: 10, doubles: 4, hr: 2 })))
      .toBe('6 of her 10 hits for extra bases.')
  })

  // THE BUG THIS FILE EXISTS TO STOP COMING BACK. The two fallbacks used to read "9 stolen
  // bases" and "4 home runs", each of which is one tile of the grid two inches below, restated
  // at the top of the card as though it were an insight. A summary whose only clause is a
  // number the reader can already see is worse than no summary: it spends the one line of
  // English on the page saying nothing, and it teaches a reader to skip that line next time.
  // Both are now RELATIONSHIPS between two tiles that sit four columns apart.
  it('says what a steal total cannot: whether the running worked', () => {
    expect(wpblBattingSummary(bat({ bb: 1, so: 4, doubles: 0, hr: 0, sb: 9 })))
      .toBe('9 stolen bases without being caught.')
    expect(wpblBattingSummary(bat({ bb: 1, so: 4, doubles: 0, hr: 0, sb: 9, cs: 3 })))
      .toBe('9 steals in 12 tries.')
  })

  it('turns a home run total into a rate, which no tile carries', () => {
    expect(wpblBattingSummary(bat({ bb: 1, so: 4, h: 20, doubles: 0, hr: 4, sb: 0 })))
      .toBe('A home run every 11 at-bats.')
  })

  // Runs, hits and walks are three tiles; how often the first followed the other two is not on
  // the card anywhere. The bar is the 90th percentile of the league, not "more than half",
  // which is the median and would fire for twenty-five of the forty-nine.
  it('relates runs scored to times on base', () => {
    expect(wpblBattingSummary(bat({ ab: 23, r: 7, h: 5, doubles: 1, triples: 0, hr: 0, bb: 5, so: 5, sb: 5 })))
      .toBe('5 stolen bases without being caught, and 7 runs from 10 times on base.')
    // At the median it is a column heading, not a characterisation.
    expect(wpblBattingSummary(bat({ bb: 1, so: 4, r: 9, h: 17, doubles: 0, hr: 0 }))).toBeNull()
  })

  // A runner can reach on an error or a fielder's choice, neither of which is on the feed's
  // line, so runs can legitimately exceed hits plus walks plus hit-by-pitches. Printing
  // "9 runs from 7 times on base" would read as an arithmetic failure rather than as that.
  it('will not print a fraction bigger than one', () => {
    expect(wpblBattingSummary(bat({ bb: 1, so: 4, r: 12, h: 6, doubles: 0, hr: 0 }))).toBeNull()
  })

  // Two clauses were previously reachable only with a notable rank, so an unranked player got
  // one at most. She is the reader who can least place a player on her own.
  it('gives an unranked player both halves of her season', () => {
    expect(wpblBattingSummary(bat({ ab: 40, h: 9, doubles: 2, triples: 0, hr: 2, bb: 9, so: 6 })))
      .toBe('More walks (9) than strikeouts (6), and 4 of her 9 hits for extra bases.')
  })

  // A sentence built on six at-bats reads with exactly the authority of one built on six
  // hundred, and this league plays fifteen games.
  it('says nothing at all below the sample floor', () => {
    expect(wpblBattingSummary(bat({ ab: 11 }))).toBeNull()
    expect(wpblBattingSummary(bat({ ab: 0, h: 0, doubles: 0, hr: 0, bb: 0, so: 0 }))).toBeNull()
  })

  it('says nothing when no clause earns its place', () => {
    expect(wpblBattingSummary(bat({ bb: 2, so: 3, h: 10, doubles: 1, triples: 0, hr: 0, sb: 0 })))
      .toBeNull()
  })

})

describe('wpblPitchingSummary', () => {
  it('leads with the strikeout-to-walk relationship', () => {
    expect(wpblPitchingSummary(pit())).toBe('24 strikeouts against 6 walks.')
  })

  it('has a sentence for a pitcher who has walked nobody', () => {
    expect(wpblPitchingSummary(pit({ bb: 0, so: 8 }))).toBe('8 strikeouts and no walks.')
  })

  it('falls back to a raw strikeout count', () => {
    expect(wpblPitchingSummary(pit({ bb: 10, so: 16 }))).toBe('16 strikeouts in 21.0 innings.')
  })

  // The batting card's "9 stolen bases" had an exact twin here: saves are printed on the
  // sample line directly above this sentence, beside the W-L record, so "4 saves." was the
  // card reading itself back. Command is the replacement because the grid shows P and never
  // shows strikes, which makes the ratio between them the one number with nowhere else to be.
  it('says nothing where it used to restate the save total', () => {
    expect(wpblPitchingSummary(pit({ bb: 10, so: 6, s: 4 }))).toBeNull()
  })

  it('reaches for command when it has the pitch counts', () => {
    expect(wpblPitchingSummary(pit({ bb: 10, so: 6, s: 4, pitches: 300, strikePct: 0.66 })))
      .toBe('66% of her pitches for strikes.')
    // Roughly one start's worth of pitches before a rate off them means anything.
    expect(wpblPitchingSummary(pit({ bb: 10, so: 6, pitches: 60, strikePct: 0.7 }))).toBeNull()
    // A middling strike rate is the league's median, and the median is not a sentence.
    expect(wpblPitchingSummary(pit({ bb: 10, so: 6, pitches: 300, strikePct: 0.6 }))).toBeNull()
  })

  // Three strikeouts against one walk is a 3.0 K/BB and it is also one inning of work.
  it('will not call a single inning a strikeout-to-walk season', () => {
    expect(wpblPitchingSummary(pit({ so: 3, bb: 1 }))).toBeNull()
  })

  // One appearance is a game story, not a season.
  it('says nothing from a single outing', () => {
    expect(wpblPitchingSummary(pit({ outs: 14 }))).toBeNull()
  })

  // ERA and WHIP are printed directly above with their own ranks; repeating either here is the
  // duplication this whole change removed.
  it('never repeats the hero pair, nor any rank', () => {
    const line = wpblPitchingSummary(pit()) ?? ''
    expect(line).not.toMatch(/\bERA\b/)
    expect(line).not.toMatch(/\bWHIP\b/)
    expect(line).not.toMatch(/in the league/)
  })
})

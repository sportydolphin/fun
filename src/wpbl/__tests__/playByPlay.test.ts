import { describe, it, expect } from 'vitest'
import { parsePlay, runsOnPlay } from '../derive/playByPlay'

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
    expect(p.detail).toBe('Benites out at 2nd, ss to 2b · Ciamarro scored on an error by 2b')
    expect(p.kind).toBe('play')
  })

  // It used to strip these, on the reasoning that "out at home" has already said what happened.
  // It has said what, and not by whom, and the sequence is the only place the by-whom is.
  it('keeps a fielding sequence in a runner clause, punctuated as the aside it is', () => {
    const p = parsePlay('X Y singled (0-0); Madison Willan out at home p to c.', 'X Y', shorten)
    expect(p.detail).toBe('Madison Willan out at home, p to c')
  })

  // The other spelling of the same fact, which has no "to" for the sequence rule to see.
  it('punctuates the unassisted spelling too', () => {
    const p = parsePlay("A B reached on a fielder's choice (0-0); Keira Izumi out at second 2b unassisted.", 'A B', shorten)
    expect(p.detail).toBe('Keira Izumi out at 2nd, 2b unassisted')
  })

  // The feed names a fielder two ways in one game, and the second collided with the base-name
  // shortening to produce "singled to 3rd base", which is not English and was ours.
  it('says a fielder one way, and never turns one into a base', () => {
    const f = (n: string) => parsePlay(n, 'Jua Park', shorten).what
    expect(f('Jua Park singled to third base (3-1 BBKB).')).toBe('singled to 3b')
    expect(f('Jua Park singled to second base (2-1 KBB).')).toBe('singled to 2b')
    expect(f("Jua Park reached on a fielder's choice to shortstop (0-0).")).toBe("reached on a fielder's choice to ss")
    expect(f('Jua Park singled to pitcher (0-0).')).toBe('singled to p')
    // The runner's base is still a base.
    expect(parsePlay('Kylee Lahners advanced to third on a wild pitch.', null, shorten).what)
      .toBe('Kylee Lahners advanced to 3rd on a wild pitch')
  })

  // The one line in the feed that says the opposite of what it means. The name is the RUNNER
  // the pitcher threw at, never the batter and never the pitcher, checked on all 139 of them.
  it('does not leave a pickoff reading as if the runner failed at something', () => {
    const p = parsePlay('Lexi Hastings Failed pickoff attempt.', 'Denver Bryant', shorten)
    expect(p.who).toBeNull()
    expect(p.what).toBe('Failed pickoff attempt at Lexi Hastings')
  })

  // Roster bookkeeping in a play's clothes, 138 rows of it. A defensive move with nobody
  // leaving carries no "for", and the feed's orphan lost the incoming player's name entirely.
  it('recognises a substitution that names no outgoing player', () => {
    const p = parsePlay('Jamie Mackay to lf.', 'Ashton Lansdell', shorten)
    expect(p.kind).toBe('substitution')
    expect(p.what).toBe('Jamie Mackay to lf')
    // A name with a lowercase particle in it is still a name.
    expect(parsePlay('Rosi del Castillo to lf.', null, shorten).kind).toBe('substitution')
  })

  it('names the feed\u2019s orphan substitution rather than printing its punctuation', () => {
    const p = parsePlay('/  for Ayami Sato.', 'Denae Benites', shorten)
    expect(p.kind).toBe('substitution')
    expect(p.what).toBe('Substitution for Ayami Sato')
  })

  // The feed writes a pinch hitter in its own words rather than as "X to ph for Y", and leaves
  // the REPLACED player in batter_name, so nothing is lifted out of the line either.
  it('files a pinch hitter as the roster move it is', () => {
    const p = parsePlay('Lexi Hastings pinch hit for Beth Greenwood.', 'Beth Greenwood', shorten)
    expect(p.kind).toBe('substitution')
    expect(parsePlay('Brittany Apgar pinch ran for Isabella Villareal.', 'Samaria Benitez', shorten).kind)
      .toBe('substitution')
  })

  // From the 8th on, the feed writes the batter due up and the automatic runner as two names in
  // a row. With the batter lifted out and bolded, the line read as her doing the placing.
  it('does not make the batter the subject of the extra-innings runner', () => {
    const p = parsePlay('Kate Blunt Hyeonah Kim placed on second (0-0).', 'Kate Blunt', shorten)
    expect(p.who).toBeNull()
    expect(p.what).toBe('Hyeonah Kim placed on 2nd to start the inning')
  })

  // She hit the foul; the first baseman dropped it. E3 is the scorer's number for that fielder
  // and notation the section explains nowhere.
  it('gives a dropped foul ball to the fielder who dropped it', () => {
    const p = parsePlay('Ashton Lansdell Dropped foul ball, E3 (0-0).', 'Ashton Lansdell', shorten)
    expect(p.who).toBeNull()
    expect(p.what).toBe('Foul ball dropped by 1b')
    expect(parsePlay('Lexi Hastings Dropped foul ball, E2 (0-0).', 'Lexi Hastings', shorten).what)
      .toBe('Foul ball dropped by c')
  })

  // One clause in the season, on a two-RBI double where the feed lost the second runner's verb.
  it('drops a runner clause that is only a name', () => {
    const p = parsePlay(
      'Caitlin Eynon doubled down the lf line, 2 RBI (0-2 KFF); Jamie Mackay scored; Samaria Benitez Samaria Benitez.',
      'Caitlin Eynon', shorten)
    expect(p.detail).toBe('Jamie Mackay scored')
  })

  // A lineout doubled off by one fielder alone carries a single position and no "to", so the
  // sequence rule cannot see it.
  it('punctuates a double play turned by one fielder', () => {
    expect(parsePlay('Kelsie Whitmore lined into double play 2b (1-0 B).', 'Kelsie Whitmore', shorten).what)
      .toBe('lined into double play, 2b')
  })

  // The guard that keeps the two rules above off real plays: every one of them has a lowercase
  // verb, and 2,836 stored narratives produce no false positive.
  it('does not file a ground ball to second as a defensive change', () => {
    for (const n of [
      'Molly Paddison singled to second base (2-1 KBB).',
      'Kelsie Whitmore grounded out to 3b',
      'Amira Hondras out at second c to 2b, caught stealing.',
    ]) expect(parsePlay(n, 'Molly Paddison', shorten).kind).toBe('play')
  })

  // WHO TURNED IT. The sequence is the only place a double play names a fielder, where every
  // other out says hers in words ("grounded out to 2b"). Stripping it read as the play having
  // no fielders at all, which is what a reader wrote in about.
  it('keeps the fielding sequence on a double play, which is the play itself', () => {
    const p = parsePlay(
      'Skylar Kaplan grounded into double play ss to 2b to 1b (1-0 B); Kelsie Whitmore out on the play.',
      'Skylar Kaplan', shorten)
    expect(p.what).toBe('grounded into double play, ss to 2b to 1b')
    expect(p.detail).toBe('Kelsie Whitmore out on the play')
  })

  it('keeps it on the two-fielder kind too, and on a triple play the league has yet to turn', () => {
    expect(parsePlay('Kate Blunt lined into double play 2b to ss (1-1 KB).', 'Kate Blunt', shorten).what)
      .toBe('lined into double play, 2b to ss')
    expect(parsePlay('X Y grounded into triple play 3b to 2b to 1b (0-0).', 'X Y', shorten).what)
      .toBe('grounded into triple play, 3b to 2b to 1b')
  })

  // Three spellings in the feed, and the old rule caught one of them, so the same game printed
  // "on an error" and "on a throwing error by 1b" two lines apart.
  it('names the position on every spelling of an error', () => {
    const err = (n: string) => parsePlay(n, 'Andreanne Leblanc', shorten).what
    expect(err('Andreanne Leblanc reached first on an error by 3b (1-1 KB).'))
      .toBe('reached first on an error by 3b')
    expect(err('Andreanne Leblanc reached first on a throwing error by 1b (1-1 BF).'))
      .toBe('reached first on a throwing error by 1b')
    expect(err('Andreanne Leblanc reached first on a fielding error by ss (0-2 SK).'))
      .toBe('reached first on a fielding error by ss')
  })

  it('keeps "out to ss" in the outcome — that is not a fielding sequence', () => {
    expect(parsePlay('Claire Eccles lined out to ss (1-2 KFB).', 'Claire Eccles', shorten).what)
      .toBe('lined out to ss')
  })

  it('shortens the long multi-runner case to something readable', () => {
    const p = parsePlay(
      'Denver Bryant doubled to right field, advanced to third on an error by 2b, 2 RBI (1-0 B); Hyeonah Kim scored; Alli Schroder scored, unearned; Ticara Geldenhuis scored, unearned.',
      'Denver Bryant', shorten)
    expect(p.what).toBe('doubled to right field, advanced to 3rd on an error by 2b, 2 RBI')
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

  // 16 of the feed's rows carry no narrative at all, half of them with no batter either. They
  // drew as an empty bordered row mid-inning, which reads as a play that failed to load.
  it('marks an empty narrative as blank, so nothing draws a row for it', () => {
    expect(parsePlay('', null, shorten)).toEqual({ who: null, what: '', count: null, detail: null, kind: 'blank' })
  })
})

// ─── runsOnPlay ───────────────────────────────────────────────────────────────
//
// The feed's runs_scored counts runners and omits the batter. Three separate readers of this
// data got that wrong before it was written down in one place, so it is pinned here.
describe('runsOnPlay', () => {
  const play = (event_type: string | null, runs_scored: number | null) => ({ event_type, runs_scored })

  it('credits the batter on a home run', () => {
    expect(runsOnPlay(play('home_run', 0))).toBe(1)   // solo
    expect(runsOnPlay(play('home_run', 1))).toBe(2)   // two-run
    expect(runsOnPlay(play('home_run', 3))).toBe(4)   // grand slam
  })

  it('leaves every other event alone, because the runner is already counted', () => {
    expect(runsOnPlay(play('single', 1))).toBe(1)
    expect(runsOnPlay(play('wild_pitch', 1))).toBe(1)
    expect(runsOnPlay(play('fielders_choice', 2))).toBe(2)
    expect(runsOnPlay(play('groundout', 0))).toBe(0)
  })

  it('treats a missing count as none', () => {
    expect(runsOnPlay(play('single', null))).toBe(0)
    expect(runsOnPlay(play(null, null))).toBe(0)
    expect(runsOnPlay(play('home_run', null))).toBe(1)
  })
})

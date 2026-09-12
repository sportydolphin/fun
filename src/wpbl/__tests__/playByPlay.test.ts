import { describe, it, expect } from 'vitest'
import { parsePlay, runsOnPlay, endsInCalledThirdStrike, stateAfter, pitchingChanges } from '../derive/playByPlay'

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
    // "unearned" was stripped here until Sep 9, 2026: it is the league's own scoring, the only
    // place a reader can see it, and the reason a run on the board is not on the pitcher.
    expect(p.detail).toBe('Benites out at 2nd, ss to 2b · Ciamarro scored on an error by 2b, unearned')
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
    expect(p.detail).toBe('Kim scored · Schroder scored, unearned · Geldenhuis scored, unearned')
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

// ─── The backwards K ─────────────────────────────────────────────────────────
//
// The scorekeeper's mirrored K is a STRIKEOUT LOOKING, not a called strike. Game Center
// mirrored every K in a pitch sequence, which is 1,480 pitches across 1,198 plays wearing the
// notation earned by the 96 that are actually called third strikes: a single on 0-2 drew "F ꓘ"
// and told anyone who knows the notation that she had struck out.
describe('endsInCalledThirdStrike', () => {
  it('is the last pitch of a strikeout looking, and nothing else', () => {
    expect(endsInCalledThirdStrike('J. Leguizamon struck out looking (1-2 BFFK).', 'BFFK')).toBe(true)
    // The same letter, mid at-bat, on a hit.
    expect(endsInCalledThirdStrike('A. Lansdell singled to center field (0-2 FK).', 'FKP')).toBe(false)
    // A strikeout the batter swung at ends in S, and earns a plain K on any earlier called one.
    expect(endsInCalledThirdStrike('D. Benites struck out swinging (1-2 KKBS).', 'KKBS')).toBe(false)
  })

  // Two of the season's 98 strikeouts looking do not end in K. A plain K on a strikeout is a
  // missing flourish; a mirrored one on a single is a lie, so this fails towards the first.
  it('wants the narrative and the letters to agree', () => {
    expect(endsInCalledThirdStrike('X Y struck out looking (0-2 FF).', 'FF')).toBe(false)
    expect(endsInCalledThirdStrike('X Y grounded out to 2b (0-2 FK).', 'FK')).toBe(false)
  })

  it('survives a play with no sequence at all', () => {
    expect(endsInCalledThirdStrike('X Y struck out looking.', null)).toBe(false)
    expect(endsInCalledThirdStrike('', 'K')).toBe(false)
  })
})

// ─── The situation a play left behind ────────────────────────────────────────
//
// The feed states only where a play STARTED, so the diamond and the out lamps in the
// play-by-play are read off the next row of the same half-inning. Every case below is the top
// of the 1st of San Francisco at Boston, Sep 11, 2026, which is the shape the whole rule turns
// on: a leadoff single whose runner appears on the row after it, and a strikeout that strands
// three.
const half = [
  { narrative: 'Amanda Gianelloni singled to right field (0-1 F).', outs: 0, first_base: '', second_base: '', third_base: '' },
  { narrative: 'Kelsie Whitmore flied out to cf (2-1 FBB).', outs: 0, first_base: 'Amanda Gianelloni', second_base: '', third_base: '' },
  { narrative: 'Skylar Kaplan popped up to 1b (1-0 B).', outs: 1, first_base: 'Amanda Gianelloni', second_base: '', third_base: '' },
  { narrative: 'Andreanne Leblanc singled to center field (0-1 K); Amanda Gianelloni advanced to second.', outs: 2, first_base: 'Amanda Gianelloni', second_base: '', third_base: '' },
  { narrative: 'Alexia Jorge walked (3-1 BBFBB).', outs: 2, first_base: 'Andreanne Leblanc', second_base: 'Amanda Gianelloni', third_base: '' },
  { narrative: 'Jua Park struck out looking (1-2 BFFK).', outs: 2, first_base: 'Joely Leguizamon', second_base: 'Alexia Jorge', third_base: 'Andreanne Leblanc' },
]

describe('stateAfter', () => {
  it('reads the next row of the half-inning, not the row it is on', () => {
    // The leadoff single: empty and nobody out on its own row, a runner on first the moment after.
    expect(stateAfter(half, 0)).toEqual({ bases: { first: true, second: false, third: false }, outs: 0 })
    // The single that pushed Gianelloni to second, with two already away.
    expect(stateAfter(half, 3)).toEqual({ bases: { first: true, second: true, third: false }, outs: 2 })
    // The walk that loaded them.
    expect(stateAfter(half, 4)).toEqual({ bases: { first: true, second: true, third: true }, outs: 2 })
  })

  // The out lamps and the diamond come from ONE read, so they cannot disagree about which
  // moment they are describing.
  it('moves the outs on the same row the bases move on', () => {
    expect(stateAfter(half, 1)).toEqual({ bases: { first: true, second: false, third: false }, outs: 1 })
    expect(stateAfter(half, 2)).toEqual({ bases: { first: true, second: false, third: false }, outs: 2 })
  })

  // An empty base is an EMPTY STRING from the ingest, not null. Read with `!= null` every one
  // of these rows draws a loaded diamond.
  it('does not read an empty string as a runner', () => {
    expect(stateAfter(half, 1)!.bases).toEqual({ first: true, second: false, third: false })
  })

  // THE CASE THE NULL EXISTS FOR. Park struck out with the bases loaded: the side was stranded,
  // not the bases cleared, and there is no next moment inside the half to report. Drawn as an
  // empty diamond this row would say the opposite of what happened, and "3 out" cannot be filled
  // in either, since a walk-off ends a half-inning on a run rather than on an out.
  it('says nothing for the last play of a half-inning', () => {
    expect(stateAfter(half, 5)).toBeNull()
  })

  // The ruined rows of Aug 20, 2026: a pitcher, a pitch sequence, and no account of anything.
  // Their bases are empty and their outs frozen at 0 because the feed lost them, which is not
  // the same fact as nobody on and nobody out.
  it('says nothing when the next row carries no narrative', () => {
    const gap = [half[4], { narrative: '', outs: 0, first_base: '', second_base: '', third_base: '' }]
    expect(stateAfter(gap, 0)).toBeNull()
  })
})

// ─── Pitching changes, off the field rather than the prose ───────────────────
//
// The Sep 11, 2026 semifinal is why this reads `pitcher_name`: the league's own sentence named
// the wrong departing pitcher, and the same row's field named the right one.
describe('pitchingChanges', () => {
  it('finds the change and the announcement it stands in for', () => {
    const rows = [
      { pitcher_name: 'Niki Eckert', narrative: 'Liz Gilder to p for Jill Albayati.' },
      { pitcher_name: 'Liz Gilder', narrative: 'Lexi Hastings singled to right field (0-1 F).' },
      { pitcher_name: 'Liz Gilder', narrative: 'Gabrielle Haas grounded out to 3b (0-2 KK).' },
    ]
    expect(pitchingChanges(rows)).toEqual([
      { index: 1, from: 'Niki Eckert', to: 'Liz Gilder', announcedAt: 0 },
    ])
  })

  // THE BARE FORM IS A THIRD OF THEM: 39 of the season's 125 are announced as "X to p" with
  // nobody named as leaving, which is exactly what the derived line supplies. A rule written
  // against "to p for" alone reads all 39 as never announced.
  it('treats the bare "to p" as an announcement, since it is one', () => {
    const rows = [
      { pitcher_name: 'Jamie Mackay', narrative: 'Tháima Maximiliana to p.' },
      { pitcher_name: 'Tháima Maximiliana', narrative: 'Jamie Mackay to lf.' },
    ]
    expect(pitchingChanges(rows)).toEqual([
      { index: 1, from: 'Jamie Mackay', to: 'Tháima Maximiliana', announcedAt: 0 },
    ])
  })

  // The fallback the season never needed, kept so a pitcher cannot change in silence if the
  // feed ever stops announcing one.
  it('still finds a change the league never announced', () => {
    const rows = [
      { pitcher_name: 'Jamie Mackay', narrative: 'Denae Benites grounded out to ss (0-0).' },
      { pitcher_name: 'Tháima Maximiliana', narrative: 'Raine Padgham walked (3-2 FBBBKFB).' },
    ]
    expect(pitchingChanges(rows)).toEqual([
      { index: 1, from: 'Jamie Mackay', to: 'Tháima Maximiliana', announcedAt: null },
    ])
  })

  // THE TEN. The feed names a departing pitcher who had already left, on ten changes across the
  // season including the Sep 11 semifinal. The derived line takes both names off the field, so
  // the prose being wrong cannot reach the page.
  it('names the pitcher who was actually throwing, not the one the sentence claims', () => {
    const rows = [
      { pitcher_name: 'Niki Eckert', narrative: 'Liz Gilder to p for Jill Albayati.' },
      { pitcher_name: 'Liz Gilder', narrative: 'Lexi Hastings singled to right field (0-1 F).' },
    ]
    expect(pitchingChanges(rows)[0].from).toBe('Niki Eckert')
  })

  // A defensive move is not a pitching change, however much it looks like one: only `p` counts.
  it('does not read a fielding substitution as an announcement', () => {
    const rows = [
      { pitcher_name: 'Ayami Sato', narrative: 'Molly Paddison to rf.' },
      { pitcher_name: 'Maggie Fox', narrative: 'Denver Bryant struck out swinging (1-2 KBS).' },
    ]
    expect(pitchingChanges(rows)[0].announcedAt).toBeNull()
  })

  it('is silent when nobody changes', () => {
    const rows = [
      { pitcher_name: 'Liz Gilder', narrative: 'Lexi Hastings singled to right field (0-1 F).' },
      { pitcher_name: 'Liz Gilder', narrative: 'Denver Bryant grounded out to 3b (1-0 B).' },
    ]
    expect(pitchingChanges(rows)).toEqual([])
  })

  // A blank pitcher is a gap in the account, not two changes: the Aug 20 rows carry no pitcher
  // at all, and reading one as a change would invent a reliever and then un-invent her.
  it('does not invent a change out of a missing pitcher', () => {
    const rows = [
      { pitcher_name: 'Liz Gilder', narrative: 'Lexi Hastings singled to right field (0-1 F).' },
      { pitcher_name: '', narrative: '' },
      { pitcher_name: 'Liz Gilder', narrative: 'Denver Bryant grounded out to 3b (1-0 B).' },
    ]
    expect(pitchingChanges(rows)).toEqual([])
  })
})

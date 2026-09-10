import { describe, it, expect } from 'vitest'
import {
  WPBL_AWARDS, AWARDS_OPEN_FALLBACK, AWARDS_CLOSE_AT, AWARDS_CLOSE_DATE, AWARDS_CLOSE_LABEL,
  NEXT_SEASON_CLOSE_AT,
  awardById, awardState, awardsOpenDate, anyAwardOpen, playChoiceKey, parsePlayChoice,
  WPBL_MANAGERS,
  WPBL_GLOVE_SHORTLIST,
  WPBL_AURA_SHORTLIST,
  WPBL_AWARDS_CREDIT,
  awardsCreditLine,
} from '../awards'
import { wpblManagerPortrait } from '../portraits'
import { awardStatsLookup, buildAwardBallot, withWriteIns } from '../derive/awards'
import {
  WPBL_MVP_SWAPS, WPBL_ARM_ORDER_LAST, WPBL_GLOVE_SHORTLIST, WPBL_AURA_SHORTLIST,
} from '../awards'
import { POSTSEASON_SCHEDULE } from '../derive/bracket'
import { MIN_FIELDED_GAMES } from '../positions'
import type { WpblBattingLine, WpblFieldingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblTeam } from '../types'

// The ballot's two irreversible decisions are pinned here: a category id, which is stored on
// every vote cast under it, and a play's choice key, which cannot be the play's uuid.

const teams: WpblTeam[] = [{ id: 'SF', name: 'Sea Lions' } as WpblTeam, { id: 'LA', name: 'Stars' } as WpblTeam]

const game = (o: Partial<WpblGame> = {}): WpblGame => ({
  id: 'g1', game_date: '2026-09-01', home_team_id: 'SF', away_team_id: 'LA',
  status: 'final', home_score: 3, away_score: 2, game_type: 'regular', counts_in_standings: true,
  ...o,
} as WpblGame)

const player = (o: Partial<WpblPlayer> = {}): WpblPlayer => ({
  id: 'p1', team_id: 'SF', name: 'Ada Quinn', active: true, ...o,
} as WpblPlayer)

const bat = (o: Partial<WpblBattingLine> = {}): WpblBattingLine => ({
  id: Math.random().toString(36).slice(2), game_id: 'g1', player_id: 'p1', team_id: 'SF',
  position: 'cf', ab: 3, r: 0, h: 1, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0,
  hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0, ibb: 0, gdp: 0, tb: 1, lob: 0, ...o,
} as WpblBattingLine)

const pitch = (o: Partial<WpblPitchingLine> = {}): WpblPitchingLine => ({
  id: Math.random().toString(36).slice(2), game_id: 'g1', player_id: 'p2', team_id: 'SF',
  outs: 21, bf: 25, h: 4, r: 2, er: 2, bb: 1, so: 8, hr: 0, pitches: 90, decision: 'W',
  gs: 1, hbp: 0, ibb: 0, wp: 0, bk: 0, strikes: 60, doubles: 0, triples: 0, ...o,
} as WpblPitchingLine)

describe('the catalog', () => {
  it('has unique, permanent ids', () => {
    const ids = WPBL_AWARDS.map(a => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    // These are written into wpbl_award_votes.category. Renaming one orphans every vote
    // already cast under it, which is silent: the old rows simply stop being counted.
    for (const id of ['mvp', 'pitcher', 'glove', 'play', 'game', 'rookie', 'franchise-2027']) {
      expect(awardById(id), `${id} was renamed or removed`).toBeDefined()
    }
  })

  it('writes no em dashes in copy the reader sees', () => {
    // House rule, and this is the copy most likely to acquire one: it is the only prose in the
    // section written to be read aloud.
    for (const a of WPBL_AWARDS) {
      expect(`${a.title} ${a.blurb}`).not.toMatch(/—/)
    }
  })
})

describe('a play vote is keyed on (game, sequence)', () => {
  it('round trips, and never touches the play uuid', () => {
    // wpbl_game_plays is a mirror: wpbl-ingest deletes and reinserts every play on each pass,
    // so a play's uuid is regenerated within two minutes and a vote stored against it would
    // point at nothing. See CLAUDE.md.
    const key = playChoiceKey('9f0c1e42-0000-4000-8000-000000000001', 57)
    expect(parsePlayChoice(key)).toEqual({ gameId: '9f0c1e42-0000-4000-8000-000000000001', sequence: 57 })
  })

  it('rejects anything that is not a play key', () => {
    expect(parsePlayChoice('9f0c1e42-0000-4000-8000-000000000001')).toBeNull()
    expect(parsePlayChoice('g1:')).toBeNull()
    expect(parsePlayChoice('g1:last')).toBeNull()
  })
})

describe('when the ballot opens', () => {
  it('opens the day after the last regular-season game, read from the schedule', () => {
    const schedule = [game({ game_date: '2026-09-04' }), game({ game_date: '2026-09-06' })]
    expect(awardsOpenDate(schedule)).toBe('2026-09-07')
  })

  it('is not pushed back by the postseason', () => {
    const schedule = [
      game({ game_date: '2026-09-06' }),
      game({ game_date: '2026-09-22', counts_in_standings: false }),
    ]
    expect(awardsOpenDate(schedule)).toBe('2026-09-07')
  })

  it('falls back to the published date when the schedule has not loaded', () => {
    // Fails toward opening on purpose: a ballot that shows up a day early is a smaller failure
    // than one that never appears because a fetch came back empty.
    expect(awardsOpenDate([])).toBe(AWARDS_OPEN_FALLBACK)
  })

  it('runs early, then open, then closed', () => {
    const schedule = [game({ game_date: '2026-09-06' })]
    const mvp = awardById('mvp')!
    expect(awardState(mvp, schedule, new Date('2026-09-06T18:00:00'))).toBe('early')
    expect(awardState(mvp, schedule, new Date('2026-09-10T18:00:00'))).toBe('open')
    expect(awardState(mvp, schedule, new Date(Date.parse(AWARDS_CLOSE_AT) + 1000))).toBe('closed')
  })

  it("keeps next season's question open through the winter", () => {
    // The section has no feed between Sep 22 and spring. This is the one thing on it that
    // still takes an answer in January.
    const schedule = [game({ game_date: '2026-09-06' })]
    const later = new Date(Date.parse(AWARDS_CLOSE_AT) + 86_400_000)
    expect(awardState(awardById('franchise-2027')!, schedule, later)).toBe('open')
    expect(anyAwardOpen(schedule, later)).toBe(true)
    expect(anyAwardOpen(schedule, new Date(Date.parse(NEXT_SEASON_CLOSE_AT) + 1000))).toBe(false)
  })
})

describe('the hand-swaps on MVP', () => {
  // The mechanism fails safe (a name that resolves to nobody leaves the race's own tile
  // standing), so what is worth pinning is the thing that fails LOUDLY on the ballot: one
  // person carded on two questions, which the sheet's own rule forbids and which a swap is the
  // easiest way to cause by accident.
  it('never swaps somebody onto MVP who is already named on another question', () => {
    const named = [...WPBL_GLOVE_SHORTLIST, ...WPBL_AURA_SHORTLIST, ...WPBL_ARM_ORDER_LAST]
    for (const swap of WPBL_MVP_SWAPS) {
      expect(named.find(n => n.name === swap.in.name), swap.in.name).toBeUndefined()
    }
  })

  it('swaps one person for a different one', () => {
    for (const swap of WPBL_MVP_SWAPS) {
      expect(swap.in.name).not.toBe(swap.out.name)
      expect(swap.in.name.trim()).toBe(swap.in.name)
      expect(swap.out.name.trim()).toBe(swap.out.name)
    }
  })
})

describe('buildAwardBallot', () => {
  const players = [player(), player({ id: 'p2', name: 'Bex Oyelaran' })]
  const base = {
    players, teams, games: [game()],
    batting: [bat({ sb: 4, cs: 1, ab: 20, so: 2, bb: 3 }), bat({ player_id: 'p2', position: 'p' })],
    pitching: [pitch()],
    fielding: [],
  }

  it('drops a category nothing can fill instead of rendering it empty', () => {
    const ids = buildAwardBallot(base).map(e => e.award.id)
    // Tracking is absent whenever the league is not publishing radar, which is a normal state
    // rather than an outage. An award nobody can be nominated for is worse than no award.
    expect(ids).not.toContain('cannon')
    expect(ids).not.toContain('contact')
    // And the ones that need the play log are absent until it has been fetched.
    expect(ids).not.toContain('mvp')
    expect(ids).not.toContain('play')
  })

  it('fills the box-score categories from the lines alone', () => {
    const entries = buildAwardBallot(base)
    const wheels = entries.find(e => e.award.id === 'wheels')
    expect(wheels?.candidates[0]).toMatchObject({ key: 'p1', name: 'Ada Quinn' })
    expect(wheels?.candidates[0].line).toBe('4 steals, caught 1')
    const workhorse = entries.find(e => e.award.id === 'workhorse')
    expect(workhorse?.candidates[0]).toMatchObject({ key: 'p2' })
  })

  it('leaves the postseason out of every shortlist', () => {
    // The ballot opens while the playoffs are running, so a shortlist that moved between a
    // voter reading it and voting on it would be worse than a stale one.
    const post = game({ id: 'g2', game_date: '2026-09-15', counts_in_standings: false })
    const entries = buildAwardBallot({
      ...base,
      games: [game(), post],
      batting: [...base.batting, bat({ game_id: 'g2', sb: 9 })],
    })
    const wheels = entries.find(e => e.award.id === 'wheels')
    expect(wheels?.candidates[0].line).toBe('4 steals, caught 1')
  })

  it('offers everyone who played for the open-field questions, alphabetically', () => {
    const rookie = buildAwardBallot(base).find(e => e.award.id === 'rookie')
    expect(rookie?.candidates.map(c => c.name)).toEqual(['Ada Quinn', 'Bex Oyelaran'])
    expect(rookie?.candidates.every(c => c.line === '')).toBe(true)
  })
})

describe('write-ins on the ballot', () => {
  const seeded = (...keys: string[]) =>
    keys.map(k => ({ key: k, name: k.toUpperCase(), teamId: 'SF', playerId: k, line: '' }))
  const roster = ['a', 'b', 'c', 'd', 'w', 'x'].map(id => ({
    id, name: id.toUpperCase(), team_id: 'SF',
  })) as unknown as WpblPlayer[]
  const base = { players: roster, picked: null, reveal: true, closed: false }

  // The rule that matters: before the reader answers, the list is exactly what was seeded. A
  // promoted write-in is a fact about how other people voted, so promoting one early breaks the
  // same rule the percentages obey, by a quieter route.
  it('shows only the seeded names to someone who has not voted', () => {
    const out = withWriteIns(seeded('a', 'b'), {
      ...base, reveal: false, bucket: { a: 1, w: 99 },
    })
    expect(out.map(c => c.key)).toEqual(['a', 'b'])
  })

  it('adds a write-in the crowd got behind once the tally is showing', () => {
    const out = withWriteIns(seeded('a', 'b'), { ...base, bucket: { a: 5, b: 4, w: 9 } })
    expect(out.map(c => c.key)).toEqual(['a', 'b', 'w'])
    expect(out.find(c => c.key === 'w')?.line).toBe('9 votes')
  })

  // One person must not be able to put a name in front of everybody.
  it('ignores a write-in with a single vote', () => {
    const out = withWriteIns(seeded('a', 'b'), { ...base, bucket: { a: 5, b: 4, w: 1 } })
    expect(out.map(c => c.key)).toEqual(['a', 'b'])
  })

  // Clearing the floor is not enough: it has to beat something we actually seeded, or the
  // shortlist is arguing with itself.
  it('ignores a write-in that has not out-polled the weakest seeded name', () => {
    const out = withWriteIns(seeded('a', 'b'), { ...base, bucket: { a: 5, b: 4, w: 3 } })
    expect(out.map(c => c.key)).toEqual(['a', 'b'])
  })

  // Otherwise the tile the reader just tapped vanishes when the search clears, which reads as
  // the vote having been rejected.
  it('always draws the reader’s own write-in, whatever its support', () => {
    const out = withWriteIns(seeded('a', 'b'), {
      ...base, reveal: false, picked: 'x', bucket: { x: 1 },
    })
    expect(out.map(c => c.key)).toEqual(['a', 'b', 'x'])
    expect(out.find(c => c.key === 'x')?.line).toBe('Your write-in')
  })

  // The hole this closes: a write-in who WON was not drawn at all, because the results view
  // rendered the seeded names and nothing else.
  it('puts a winning write-in first once voting has closed', () => {
    const out = withWriteIns(seeded('a', 'b'), {
      ...base, closed: true, bucket: { a: 5, b: 4, w: 20 },
    })
    expect(out.map(c => c.key)).toEqual(['w', 'a', 'b'])
  })

  // Ballot position is itself a nudge, and re-sorting under the reader the instant they answer
  // moves every tile they were looking at.
  it('holds seeded order while the question is still open', () => {
    const out = withWriteIns(seeded('a', 'b'), { ...base, bucket: { a: 1, b: 40, w: 9 } })
    expect(out.map(c => c.key)).toEqual(['a', 'b', 'w'])
  })

  // The MVP race keys an unrostered name as `name:<lowercased>`, and a vote can outlive the
  // player it named. Neither has a portrait, a club or a page to open.
  it('leaves out a key that names nobody on the roster', () => {
    const out = withWriteIns(seeded('a'), { ...base, bucket: { a: 1, 'name:ghost': 50 } })
    expect(out.map(c => c.key)).toEqual(['a'])
  })
})

// A race with a pure hitter, a pure pitcher and a two-way player, which is the only shape that
// can tell the MVP/Pitcher rules apart.
function raced() {
  const hitter = player({ id: 'h1', name: 'Ada Quinn' })
  const arm = player({ id: 'a1', name: 'Bex Oyelaran' })
  const both = player({ id: 'b1', name: 'Cam Riley' })
  const cand = (pl: WpblPlayer, batV: number, armV: number) => ({
    key: pl.id, name: pl.name, player: pl, teamId: 'SF',
    bat: batV, arm: armV, total: batV + armV,
    pa: 40, bf: armV > 0 ? 60 : 0, twoWay: batV > 0 && armV > 0, curve: [],
  })
  return {
    players: [hitter, arm, both],
    teams,
    games: [game()],
    batting: [
      bat({ player_id: 'h1', ab: 30, h: 12, hr: 4, rbi: 10, sb: 5, bb: 6, tb: 24 }),
      bat({ player_id: 'b1', ab: 28, h: 10, hr: 3, rbi: 8, sb: 2, bb: 5, tb: 20 }),
    ],
    pitching: [
      pitch({ player_id: 'a1', outs: 60, so: 20, er: 6 }),
      pitch({ player_id: 'b1', outs: 45, so: 14, er: 5 }),
    ],
    fielding: [],
    mvp: {
      dates: [], lead: 0, top: [],
      field: [
        cand(both, 20, 12),   // two-way, bat carries her -> MVP, and off Pitcher by the dedupe
        cand(arm, 0, 18),     // pure pitcher -> never on MVP
        cand(hitter, 15, 0),  // pure hitter -> MVP
      ],
    },
  } as unknown as Parameters<typeof buildAwardBallot>[0]
}

describe('MVP and Pitcher do not card the same player', () => {
  // The race ranks everyone by runs added PLUS runs saved, so without this a reliever having a
  // good season outranks most of the league's hitters and MVP fills up with the arms carded two
  // questions further down. Five questions returning the same four names is one question asked
  // five ways.
  it('keeps pitchers off the MVP slate', () => {
    const mvp = buildAwardBallot(raced()).find(e => e.award.id === 'mvp')
    expect(mvp).toBeTruthy()
    const keys = mvp!.candidates.map(c => c.key)
    expect(keys).toContain('h1')   // pure hitter
    expect(keys).toContain('b1')   // two-way, bat carries her
    expect(keys).not.toContain('a1')  // pure pitcher belongs to the other award
  })

  // The overlap is the two-way player: she led Pitcher on runs saved and MVP on runs added, so
  // a reader met the same face twice in the first two questions. She is dropped from Pitcher
  // rather than MVP because the next arm down is a real candidate, and MVP has no replacement
  // for her bat.
  it('drops an MVP name from the pitcher slate, and back-fills it', () => {
    const ballot = buildAwardBallot(raced())
    const mvp = new Set((ballot.find(e => e.award.id === 'mvp')?.candidates ?? []).map(c => c.key))
    const arm = ballot.find(e => e.award.id === 'pitcher')?.candidates ?? []
    expect(arm.length).toBeGreaterThan(0)
    // The two-way player is on MVP, so she is not repeated here...
    expect(arm.map(c => c.key)).not.toContain('b1')
    // ...and the pure pitcher, who MVP will not take, still gets her award.
    expect(arm.map(c => c.key)).toContain('a1')
    for (const c of arm) expect(mvp.has(c.key)).toBe(false)
  })
})

describe('MVP puts every club on the ballot', () => {
  // Four clubs, five hitters, and the club that leads has two of the top four. Taken straight
  // off the race the first question of the ballot ran two deep into one club and left another
  // with nobody, which reads to a fan of that club as a ballot that is not about them.
  const clubbed = () => {
    const rank = [
      ['n1', 'Nina Alder', 'NY', 30],
      ['n2', 'Opal Reyes', 'NY', 26],
      ['s1', 'Pia Duarte', 'SF', 24],
      ['b1', 'Quinn Hale', 'BOS', 20],
      ['l1', 'Remy Sato', 'LA', 18],
    ] as const
    const players = rank.map(([id, name, club]) => player({ id, name, team_id: club }))
    return {
      players, teams, games: [game()],
      batting: rank.map(([id, , club]) => bat({ player_id: id, team_id: club })),
      pitching: [], fielding: [],
      mvp: {
        dates: [], lead: 0, top: [],
        field: rank.map(([id, name, club, v], i) => ({
          key: id, name, player: players[i], teamId: club,
          bat: v, arm: 0, total: v, pa: 40, bf: 0, twoWay: false, curve: [],
        })),
      },
    } as unknown as Parameters<typeof buildAwardBallot>[0]
  }

  it('cards each club’s best hitter, in race order, rather than the top four names', () => {
    const mvp = buildAwardBallot(clubbed()).find(e => e.award.id === 'mvp')
    expect(mvp!.candidates.map(c => c.key)).toEqual(['n1', 's1', 'b1', 'l1'])
    // The second-best hitter in the league is off the ballot only because a team-mate outranks
    // her, and the search under the question still takes a vote for her.
    expect(mvp!.candidates.map(c => c.key)).not.toContain('n2')
  })

  // The fill pass: fewer clubs than slots must still fill the row rather than render a short one.
  it('fills the row from the race when the clubs run out', () => {
    const mvp = buildAwardBallot(raced()).find(e => e.award.id === 'mvp')
    expect(mvp!.candidates.map(c => c.key)).toEqual(['b1', 'h1'])
  })
})

describe('the position under the name', () => {
  // Four batting averages side by side do not say which of them is a catcher, and the one thing
  // an MVP tile cannot show is the half of a two-way season it is not carding.
  const twoWayBallot = () => {
    const hitter = player({ id: 'h1', name: 'Ada Quinn', position: 'C' })
    const both = player({ id: 'b1', name: 'Cam Riley', position: 'LF' })
    const cand = (pl: WpblPlayer, batV: number, armV: number) => ({
      key: pl.id, name: pl.name, player: pl, teamId: 'SF',
      bat: batV, arm: armV, total: batV + armV, pa: 40, bf: armV > 0 ? 60 : 0,
      twoWay: armV > 0, curve: [],
    })
    return {
      players: [hitter, both], teams, games: [game()],
      batting: [
        bat({ player_id: 'h1', position: 'c' }),
        bat({ player_id: 'b1', position: 'lf' }),
      ],
      // A start on the mound, which is what separates a two-way player from a position player
      // mopping up an inning of a blowout.
      pitching: [pitch({ player_id: 'b1', outs: 45, gs: 1 })],
      fielding: [],
      mvp: { dates: [], lead: 0, top: [], field: [cand(both, 20, 12), cand(hitter, 15, 0)] },
    } as unknown as Parameters<typeof buildAwardBallot>[0]
  }

  it('leads a two-way MVP candidate with the mound, and leaves a hitter alone', () => {
    const mvp = buildAwardBallot(twoWayBallot()).find(e => e.award.id === 'mvp')
    const subs = new Map(mvp!.candidates.map(c => [c.key, c.sub]))
    expect(subs.get('b1')).toBe('P / LF')
    expect(subs.get('h1')).toBe('C')
  })

  // Every candidate on Pitcher of the Year is a pitcher, so a column of P under four names is
  // noise rather than information.
  it('says nothing under a pitcher on the pitching award', () => {
    const pitcher = buildAwardBallot(twoWayBallot()).find(e => e.award.id === 'pitcher')
    for (const c of pitcher?.candidates ?? []) expect(c.sub).toBeUndefined()
  })
})

describe('ERA on a ballot tile', () => {
  // The one figure a pure builder must not have the last word on: it is stored on whichever
  // basis the league publishes and the reader can flip that in settings, so the number travels
  // raw and the view scales it. A tile that shipped only a formatted string would silently
  // disagree with the stats board for anyone on the other convention.
  it('travels as a raw value for the view to scale, with a canonical fallback', () => {
    const arm = buildAwardBallot(raced()).find(e => e.award.id === 'pitcher')
    const era = arm?.candidates[0]?.stats?.find(st => st.label === 'ERA')
    expect(era).toBeTruthy()
    expect(era).toHaveProperty('eraBasisValue')
    // `value` stays populated so a non-React consumer still renders something sane.
    expect(typeof era!.value).toBe('string')
    expect(era!.value.length).toBeGreaterThan(0)
  })

  // ORDER IS PRIORITY, because the tile shows only the first three on a phone. RBI is last on
  // purpose: it prices the lineup batting in front of her as much as the hitter, so it takes
  // the slot that only appears where there is room to spare.
  it('cards a hitter on AVG, HR, OPS, SB, RBI, in that order', () => {
    const mvp = buildAwardBallot(raced()).find(e => e.award.id === 'mvp')
    const labels = mvp?.candidates[0]?.stats?.map(st => st.label) ?? []
    expect(labels).toEqual(['AVG', 'HR', 'OPS', 'SB', 'RBI'])
  })

  // A closer carded on innings and strikeouts is judged on the two things her job does not ask
  // of her, and on a phone only three figures survive. `gs === 0` is the test, so a starter who
  // picked up a save is not recarded as a closer.
  it('leads a reliever with saves, and only a reliever', () => {
    const arm = buildAwardBallot(raced()).find(e => e.award.id === 'pitcher')
    const starter = arm?.candidates.find(c => c.key === 'a1')
    expect(starter?.stats?.map(st => st.label)).toEqual(['ERA', 'K', 'IP', 'WHIP'])
  })
})

describe('the ballot closes at first pitch of the final', () => {
  // awards.ts is a dependency-free leaf, so the final's date is COPIED there rather than
  // imported from the bracket. This is the seam that keeps the copy honest: move the final in
  // POSTSEASON_SCHEDULE and forget the constant, and the deadline silently points at a day the
  // league is not playing on, which nothing else in the app would notice.
  it('uses the date the schedule gives the final', () => {
    expect(AWARDS_CLOSE_DATE).toBe(POSTSEASON_SCHEDULE.championship[0].date)
    expect(AWARDS_CLOSE_AT.startsWith(AWARDS_CLOSE_DATE)).toBe(true)
  })

  // Read as Eastern, so it lands at first pitch for an east-coast host and early for a
  // west-coast one. A regular-season award taking votes after the final has started is worse
  // than one that shut a little early, and the host is unknown until the semifinals end.
  it('closes at or before 6pm local wherever the final is played', () => {
    const close = Date.parse(AWARDS_CLOSE_AT)
    // 6pm Eastern on the day.
    expect(close).toBe(Date.parse(`${AWARDS_CLOSE_DATE}T18:00:00-04:00`))
    // Never after a 6pm Pacific first pitch.
    expect(close).toBeLessThanOrEqual(Date.parse(`${AWARDS_CLOSE_DATE}T18:00:00-07:00`))
  })

  // The one line of copy that states the deadline reads off the same constant, by string
  // surgery: a bare date through `new Date` is midnight UTC, which prints as the previous
  // evening in every American zone and would advertise the wrong day.
  it('labels the deadline from the same date', () => {
    expect(AWARDS_CLOSE_LABEL).toBe('Sep 16')
  })

  // Open the day after the regular season ends, shut when the final starts. The window has to
  // be a real one: an award that opens after it closes is a card nobody can ever answer.
  it('leaves a real window between opening and closing', () => {
    const schedule = [game({ game_date: '2026-09-06' })]
    expect(awardsOpenDate(schedule) < AWARDS_CLOSE_DATE).toBe(true)
    const mvp = awardById('mvp')!
    expect(awardState(mvp, schedule, new Date('2026-09-10T18:00:00'))).toBe('open')
    expect(awardState(mvp, schedule, new Date(Date.parse(AWARDS_CLOSE_AT) + 1000))).toBe('closed')
  })
})


describe('every manager on the ballot has a face', () => {
  // The four are hand-cropped out of the league's announcement graphics, so nothing regenerates
  // them and nothing else notices when one is missing: a manager whose art was never cut simply
  // renders as two initials on a club colour, on a tile that looks otherwise finished. That is
  // the whole failure this pins. Keyed on `key` rather than on the name for the same reason the
  // vote is: the league can respell "Rachelle" and neither the stored vote nor the portrait
  // should move.
  it('resolves a bundled portrait for each WPBL_MANAGERS entry', () => {
    for (const m of WPBL_MANAGERS) {
      expect(wpblManagerPortrait(m.key), m.name).toBeTruthy()
    }
  })

  it('has nothing to say about a player key', () => {
    expect(wpblManagerPortrait('p1')).toBeNull()
    expect(wpblManagerPortrait(null)).toBeNull()
  })
})

describe('a write-in is carded on the same figures as the shortlist', () => {
  // The failure this pins is not a crash. A slate only computes figures for the names it picked,
  // so a written-in name arrived with a blank where five numbers sit on every tile beside it, and
  // the tile still looked finished.
  const hitter = player({ id: 'h1', name: 'Rosa Lund' })
  const arm = player({ id: 'a1', name: 'Nell Cortez', position: 'p' })
  const input = {
    players: [hitter, arm], teams, games: [game()],
    batting: [
      bat({ player_id: 'h1', ab: 10, h: 4, doubles: 1, hr: 1, rbi: 3, tb: 8 }),
      // The pitcher took her turns and never reached: the line that used to read `.000 0 .000`.
      bat({ player_id: 'a1', ab: 4, h: 0, tb: 0, position: 'p' }),
    ],
    pitching: [pitch({ player_id: 'a1', gs: 2, outs: 27, so: 11, er: 3, h: 6, bb: 2 })],
    fielding: [],
  }
  const lookup = awardStatsLookup(input)
  const on = (id: string) => WPBL_AWARDS.find(a => a.id === id)!
  const labels = (award: string, playerId: string) =>
    lookup(on(award))(playerId).map(st => st.label)

  it('gives a hitter the MVP line she would have had if she were seeded', () => {
    expect(labels('mvp', 'h1')).toEqual(['AVG', 'HR', 'OPS', 'SB', 'RBI'])
  })

  it('gives a pitcher written into MVP her mound line, not five zeroes', () => {
    // Carded on her batting she reads .000 with nothing beside it, which is not the season the
    // person voting for her meant. MVP seeds hitters only, so she was never on this list and a
    // different shape of line is the honest answer.
    expect(labels('mvp', 'a1')).toEqual(['ERA', 'K', 'IP', 'WHIP'])
  })

  it('keeps a two-way hitter on the bat, since one home run is a case', () => {
    const twoWay = {
      ...input,
      pitching: [...input.pitching, pitch({ player_id: 'h1', gs: 1, outs: 15 })],
    }
    expect(awardStatsLookup(twoWay)(on('mvp'))('h1').map(st => st.label))
      .toEqual(['AVG', 'HR', 'OPS', 'SB', 'RBI'])
  })

  it('has nothing to say where the question cards nobody on numbers', () => {
    expect(labels('manager', 'h1')).toEqual([])
    expect(labels('rookie', 'h1')).toEqual([])
  })
})

// Defensive Wizard is the one award whose shortlist is written down rather than computed, and
// the header on WPBL_GLOVE_SHORTLIST says why: the feed's fielding row carries no position, so
// every ranking this could compute is an infielder's and a catcher cannot reach one. These pin
// the two things a hand-kept list can get wrong on its own.
describe('the hand-picked Defensive Wizard shortlist', () => {
  const fld = (o: Partial<WpblFieldingLine> = {}): WpblFieldingLine => ({
    id: Math.random().toString(36).slice(2), game_id: 'g1', player_id: 'p1', team_id: 'SF',
    po: 2, a: 3, e: 0, dp: 0, pb: 0, sba: 0, ci: 0, ...o,
  } as WpblFieldingLine)

  /** The real list, with a roster built to match whichever names it currently holds. */
  const named = WPBL_GLOVE_SHORTLIST.map((n, i) =>
    player({ id: `glove${i}`, name: n.name, team_id: n.teamId }))
  const input = (over: Partial<Parameters<typeof buildAwardBallot>[0]> = {}) => ({
    players: named, teams, games: [game()], batting: [], pitching: [],
    fielding: named.map((p, i) => fld({ player_id: p.id, team_id: p.team_id, po: i, a: i * 2, e: i })),
    ...over,
  } as Parameters<typeof buildAwardBallot>[0])
  const glove = (i = input()) => buildAwardBallot(i).find(e => e.award.id === 'glove')

  it('offers exactly the names on the list, in the order they are written', () => {
    expect(glove()?.candidates.map(c => c.name)).toEqual(WPBL_GLOVE_SHORTLIST.map(n => n.name))
  })

  it('cards chances and errors, which mean the same thing at every position', () => {
    // The fixture gives nominee i po: i, a: 2i, e: i, so chances come to 4i.
    expect(glove()?.candidates[2].line).toBe('8 chances, 2 errors')
    // And the singular, which a card gets wrong on exactly one nominee a season.
    expect(glove()?.candidates[1].line).toBe('4 chances, 1 error')
  })

  it('drops a name the roster cannot place and keeps the rest', () => {
    const short = glove(input({ players: named.slice(1) }))
    expect(short?.candidates.map(c => c.name)).toEqual(WPBL_GLOVE_SHORTLIST.slice(1).map(n => n.name))
  })

  // Two players of one name on one club is the case routes.ts already refuses to guess at.
  it('refuses to guess between two players sharing a name on the same club', () => {
    const twin = player({ id: 'twin', name: named[0].name, team_id: named[0].team_id })
    const names = glove(input({ players: [...named, twin] }))?.candidates.map(c => c.name)
    expect(names).not.toContain(named[0].name)
    expect(names).toHaveLength(WPBL_GLOVE_SHORTLIST.length - 1)
  })
})

// A catcher's defensive case is the one thing the feed's fielding row cannot hold, and the one
// it holds a decoy for. See gloveStats.
describe('what a catcher is carded on', () => {
  const CATCHER = WPBL_GLOVE_SHORTLIST[2]   // the one nominee who catches
  const roster = WPBL_GLOVE_SHORTLIST.map((n, i) =>
    player({ id: `glove${i}`, name: n.name, team_id: n.teamId }))
  const her = roster[2]
  const clubs: WpblTeam[] = [...teams, { id: her.team_id, name: her.team_id } as WpblTeam]
  // Enough games behind the plate for the position index to rule at all: it needs a strict
  // majority over MIN_FIELDED_GAMES, which is the guard that stops one appearance relabelling
  // anybody. The caught stealing all happens in the first of them.
  const ids = Array.from({ length: MIN_FIELDED_GAMES + 1 }, (_, i) => `g${i + 9}`)
  const schedule = ids.map(id => game({ id, home_team_id: her.team_id, away_team_id: 'LA' }))
  const herLines = ids.map(id =>
    bat({ player_id: her.id, team_id: her.team_id, game_id: id, position: 'c' }))

  const fld = (o: Partial<WpblFieldingLine> = {}): WpblFieldingLine => ({
    id: Math.random().toString(36).slice(2), game_id: ids[0], player_id: her.id, team_id: her.team_id,
    po: 90, a: 14, e: 2, dp: 0, pb: 4, sba: 12, ci: 0, ...o,
  } as WpblFieldingLine)

  const caught = (narrative: string) => ({
    game_id: ids[0], sequence: 1, inning: 1, half: 'top', team_id: 'LA',
    narrative, event_type: 'caught_stealing',
  } as never)

  const input = (plays: unknown[], over: Record<string, unknown> = {}) => ({
    players: roster, teams: clubs, games: schedule, pitching: [],
    // Her batting line is what says she catches: a fielding row carries no position at all.
    batting: herLines,
    fielding: [fld()],
    plays,
    ...over,
  } as unknown as Parameters<typeof buildAwardBallot>[0])
  const cardFrom = (i: Parameters<typeof buildAwardBallot>[0]) =>
    buildAwardBallot(i).find(e => e.award.id === 'glove')!
      .candidates.find(c => c.name === CATCHER.name)!
  const card = (plays: unknown[]) => cardFrom(input(plays))

  it('cards her on the running game, not on the strikeouts she caught', () => {
    const c = card([caught('Runner out at second c to 2b, caught stealing.')])
    expect(c.stats?.map(s => s.label)).toEqual(['CS', 'Assists', 'Errors'])
    expect(c.stats?.[0].value).toBe('1')
    expect(c.line).toBe('Threw out 1 of 12 who ran on her')
    // 90 putouts, and every one of them is her pitcher's strikeout. It must not appear.
    expect(JSON.stringify(c)).not.toContain('90')
  })

  it('says it does not know rather than saying zero, before the play log lands', () => {
    const c = card([])
    expect(c.stats?.[0]).toEqual({ label: 'CS', value: '—' })
    expect(c.line).toBe('14 assists, 2 errors')
  })

  // A pickoff starts at the pitcher and belongs to her. Three of the fifteen caught stealings
  // in the 2026 regular season were these.
  it('does not credit her with the pitcher’s pickoff', () => {
    expect(card([caught('Runner out at second p to 1b, picked off, caught stealing.')])
      .stats?.[0].value).toBe('0')
  })

  // The narrative names the runner and never the thrower, so the catcher comes from the lineup.
  it('credits nobody when the club used two catchers in that game', () => {
    const second = player({ id: 'c2', name: 'Someone Else', team_id: her.team_id })
    const c = cardFrom(input([caught('Runner out at second c to 2b, caught stealing.')], {
      players: [...roster, second],
      batting: [...herLines,
        bat({ player_id: second.id, team_id: her.team_id, game_id: ids[0], position: 'c' })],
    }))
    expect(c.stats?.[0].value).toBe('0')
  })

  // One card, one substitution: the three names beside her keep the putout, since a catch at
  // third or in right is a play she made.
  it('changes nothing but the lead figure for everyone else', () => {
    const others = buildAwardBallot(input([])).find(e => e.award.id === 'glove')!
      .candidates.filter(c => c.name !== CATCHER.name)
    for (const c of others) expect(c.stats?.map(s => s.label)).toEqual(['PO', 'Assists', 'Errors'])
  })
})

// The one award whose tiles carry nothing, and the reason the sheet's heading is literal.
describe('Most Aura, which no column holds', () => {
  const named = WPBL_AURA_SHORTLIST.map((n, i) =>
    player({ id: `aura${i}`, name: n.name, team_id: n.teamId }))
  const clubs: WpblTeam[] = [...teams,
    ...WPBL_AURA_SHORTLIST.map(n => ({ id: n.teamId, name: n.teamId } as WpblTeam))]
  // Real figures on every one of them, so a card carrying none is a decision rather than an
  // empty fixture: each has a home run and a strikeout, which is what used to seed this slate.
  const input = () => ({
    players: named, teams: clubs, games: [game()], fielding: [], plays: [],
    batting: named.map(p => bat({ player_id: p.id, team_id: p.team_id, hr: 1, ab: 4, h: 2, sb: 2 })),
    pitching: named.map(p => pitch({ player_id: p.id, team_id: p.team_id, so: 9 })),
  } as unknown as Parameters<typeof buildAwardBallot>[0])
  const aura = () => buildAwardBallot(input()).find(e => e.award.id === 'aura')

  it('offers exactly the names on the list, in the order they are written', () => {
    expect(aura()?.candidates.map(c => c.name)).toEqual(WPBL_AURA_SHORTLIST.map(n => n.name))
  })

  it('puts her team in the slot and no figure at all, though the figures are right there', () => {
    for (const [i, c] of aura()!.candidates.entries()) {
      expect(c.stats).toEqual([{ label: 'Team', value: WPBL_AURA_SHORTLIST[i].teamId }])
      expect(c.line).toBe('')
    }
  })

  // Or the one name a reader added themselves would be the only bare card in a grid of four.
  it('cards a write-in on the same one thing', () => {
    expect(awardStatsLookup(input())(awardById('aura')!)(named[0].id))
      .toEqual([{ label: 'Team', value: WPBL_AURA_SHORTLIST[0].teamId }])
  })

  // The neighbouring questions are unaffected: bare is this award's decision, not the sheet's.
  it('does not take the figures off the other player awards', () => {
    const wheels = buildAwardBallot(input()).find(e => e.award.id === 'wheels')
    expect(wheels?.candidates.length ?? 0).toBeGreaterThan(0)
    expect(wheels?.candidates[0].line).toBe('2 steals, caught 0')
  })
})

// A dead credit link is worse than no credit at all, and this one points off the site, so
// nothing else in the section would ever notice it rotting.
describe('the credit on the ballot', () => {
  it('names somebody and points somewhere', () => {
    expect(WPBL_AWARDS_CREDIT.name.trim().length).toBeGreaterThan(0)
    expect(WPBL_AWARDS_CREDIT.prefix.trim().length).toBeGreaterThan(0)
    // The sheet sets the two halves separately so the name can carry the accent; anything that
    // can only set one string gets them joined, and the two must not drift apart.
    expect(awardsCreditLine()).toBe(`${WPBL_AWARDS_CREDIT.prefix} ${WPBL_AWARDS_CREDIT.name}`)
    const url = new URL(WPBL_AWARDS_CREDIT.url)
    // https because the sheet opens it in a new tab from a page that is itself https.
    expect(url.protocol).toBe('https:')
    expect(url.hostname).toBe('www.youtube.com')
  })
})

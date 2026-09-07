import { describe, it, expect } from 'vitest'
import {
  WPBL_AWARDS, AWARDS_OPEN_FALLBACK, AWARDS_CLOSE_AT, NEXT_SEASON_CLOSE_AT,
  awardById, awardState, awardsOpenDate, anyAwardOpen, playChoiceKey, parsePlayChoice,
} from '../awards'
import { buildAwardBallot } from '../derive/awards'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblTeam } from '../types'

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
      expect(`${a.title} ${a.blurb} ${a.seededBy ?? ''}`).not.toMatch(/—/)
    }
  })

  it('gives every seeded category a line saying where its names came from', () => {
    for (const a of WPBL_AWARDS) {
      if (a.openField) expect(a.seededBy).toBeUndefined()
      else expect(a.seededBy, `${a.id} has a shortlist and no explanation of it`).toBeTruthy()
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

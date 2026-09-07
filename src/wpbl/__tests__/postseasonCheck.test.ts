import { describe, it, expect } from 'vitest'
import { findDisagreements, findCalendarDrift } from '../../../scripts/check-wpbl-postseason'

// The tripwire that tells us the feed is not marking the postseason.
//
// Worth testing far more than an ordinary script, because the situation it fires on is one
// nobody can produce on demand: the first postseason row lands Sep 9, 2026 and if this rule
// is wrong the day it arrives, the failure is that nothing happens. Everything below is the
// shape of a feed we have never seen, which is the point.

const FROM = '2026-09-09'

type Row = Parameters<typeof findDisagreements>[0][number]

const game = (over: Partial<Row>): Row => ({
  id: 'g1',
  game_date: '2026-08-15',
  status: 'final',
  game_type: 'regular',
  counts_in_standings: true,
  home_team_id: 'SF',
  away_team_id: 'BOS',
  ...over,
})

describe('findDisagreements', () => {
  it('says nothing about a regular-season game the feed marks as regular', () => {
    expect(findDisagreements([game({})], FROM)).toEqual([])
  })

  it('says nothing about a postseason game the feed flags with counts_in_standings', () => {
    const g = game({ game_date: FROM, game_type: 'regular', counts_in_standings: false })
    expect(findDisagreements([g], FROM)).toEqual([])
  })

  it('says nothing about a postseason game the feed flags through game_type alone', () => {
    // The flag untouched and only the round named: the likelier of the two shapes, since
    // counts_in_standings is the league's own column and game_type is what it prints.
    const g = game({ game_date: FROM, game_type: 'Semifinal A', counts_in_standings: true })
    expect(findDisagreements([g], FROM)).toEqual([])
  })

  it('FIRES on a postseason game the feed marks as nothing in particular', () => {
    // The case the whole job exists for. Every season total on the site is folding this in.
    const g = game({ id: 'semi1', game_date: FROM, game_type: 'regular', counts_in_standings: true })
    const found = findDisagreements([g], FROM)
    expect(found).toHaveLength(1)
    expect(found[0].kind).toBe('counted-postseason')
    // The row carries what the feed actually said, because that is the fix: the person
    // reading the failed run needs to know what to widen countsInStandings to match.
    expect(found[0]).toMatchObject({ id: 'semi1', game_type: 'regular', counts_in_standings: true })
  })

  it('fires on a postseason game with the marking fields simply absent', () => {
    const g = game({ game_date: '2026-09-16', game_type: null, counts_in_standings: null })
    expect(findDisagreements([g], FROM).map(d => d.kind)).toEqual(['counted-postseason'])
  })

  it('fires the other way when a regular-season game is marked as not counting', () => {
    // Quieter and less likely, and it would read on the site as a club having played fewer
    // games than it has, which nobody would think to question.
    const g = game({ game_date: '2026-08-15', counts_in_standings: false })
    expect(findDisagreements([g], FROM).map(d => d.kind)).toEqual(['excluded-regular'])
  })

  it('leaves a game played the day BEFORE the postseason alone', () => {
    // The boundary matters in a way a date comparison usually does not: Sep 7 and 8 are the
    // gap between the last regular-season game and the first semifinal, which is exactly
    // where a rained-out game would be made up. It counts, and it must not be flagged.
    const g = game({ game_date: '2026-09-08' })
    expect(findDisagreements([g], FROM)).toEqual([])
  })

  it('is quiet across a whole regular season, which is the state it lives in', () => {
    const season = Array.from({ length: 30 }, (_, i) =>
      game({ id: `g${i}`, game_date: `2026-08-${String((i % 28) + 1).padStart(2, '0')}` }))
    expect(findDisagreements(season, FROM)).toEqual([])
  })
})

// ─── The constant against the league's live calendar ─────────────────────────
//
// POSTSEASON_SCHEDULE was typed in from an email in August and nothing checked it for six
// weeks. It is still the fallback for who bats last, and it is what the Discord watch-party
// job names its events from, so a game the league quietly moves has to reach a person.

type Site = Parameters<typeof findCalendarDrift>[0][number]

const SCHEDULE = {
  'semifinal:A': [
    { game: 1, date: '2026-09-09', time: '6:00 PM' },
    { game: 2, date: '2026-09-11', time: '5:00 PM' },
  ],
  championship: [{ game: 1, date: '2026-09-16', time: '6:00 PM' }],
}

const site = (over: Partial<Site>): Site => ({
  game_date: '2026-09-09', start_time: '6:00 PM',
  round: 'semifinal', series_key: 'A', game_number: 1,
  ...over,
})

const CALENDAR: Site[] = [
  site({}),
  site({ game_date: '2026-09-11', start_time: '5:00 PM', game_number: 2 }),
  site({ game_date: '2026-09-16', round: 'championship', series_key: null, game_number: 1 }),
]

describe('findCalendarDrift', () => {
  it('is silent while the two agree', () => {
    expect(findCalendarDrift(CALENDAR, SCHEDULE)).toEqual([])
  })

  it('reports a game the league has moved, on the date and on the time', () => {
    const moved = CALENDAR.map(r => (r.game_number === 2 && r.round === 'semifinal'
      ? { ...r, game_date: '2026-09-12', start_time: '1:00 PM' } : r))
    expect(findCalendarDrift(moved, SCHEDULE)).toEqual([
      { kind: 'moved', game: 'semifinal:A:2', ours: '2026-09-11 5:00 PM', theirs: '2026-09-12 1:00 PM' },
    ])
  })

  it('reports a game on only one of the two', () => {
    const short = CALENDAR.filter(r => r.round !== 'championship')
    expect(findCalendarDrift(short, SCHEDULE).map(d => d.kind)).toEqual(['not-on-calendar'])
    const extra = [...CALENDAR, site({ game_date: '2026-09-13', game_number: 3 })]
    expect(findCalendarDrift(extra, SCHEDULE).map(d => d.kind)).toEqual(['not-in-constant'])
  })

  // The mirror is filled by its own cron job. "The sync has not run yet" must not read as the
  // league having cancelled the postseason.
  it('says nothing at all when the mirror is empty', () => {
    expect(findCalendarDrift([], SCHEDULE)).toEqual([])
  })
})

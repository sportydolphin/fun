import { describe, it, expect } from 'vitest'
import { computeStandings } from '../api'
import { seasonShape, standingsAt, biggestRun, leadStory } from '../derive/seasonShape'
import type { WpblGame, WpblTeam } from '../types'

// The chart sits one card under the standings table, which is the whole reason these exist.
// Two surfaces reading the same season have to agree, and the way that goes wrong is never
// dramatic: it is a tiebreak, or a postseason game, or a club that was idle on a date.

const team = (id: string): WpblTeam => ({ id, abbr: id, name: id } as WpblTeam)
const TEAMS = [team('SF'), team('NY'), team('LA'), team('BOS')]

const game = (over: Partial<WpblGame> = {}): WpblGame => ({
  id: Math.random().toString(36).slice(2),
  game_date: '2026-08-01', start_time: '6:30 PM',
  home_team_id: 'BOS', away_team_id: 'SF',
  venue: null, status: 'final',
  home_score: 5, away_score: 2, innings: 7, notes: null,
  created_at: '', updated_at: '',
  game_type: 'regular', counts_in_standings: true,
  ...over,
})

/** `home` beat `away` on `date`. */
const won = (date: string, home: string, away: string) =>
  game({ game_date: date, home_team_id: home, away_team_id: away, home_score: 4, away_score: 1 })

const SEASON = [
  won('2026-08-01', 'SF', 'BOS'),
  won('2026-08-01', 'NY', 'LA'),
  won('2026-08-03', 'SF', 'NY'),
  won('2026-08-05', 'LA', 'BOS'),
  won('2026-08-05', 'SF', 'NY'),
]

describe('the shape of a season', () => {
  it('opens with a column where nobody has played', () => {
    const s = seasonShape(TEAMS, SEASON)
    expect(s.columns[0].date).toBeNull()
    for (const t of s.tracks) expect(t.points[0]).toMatchObject({ over: 0, wins: 0, losses: 0 })
  })

  it('gives one column per playing date, not per game', () => {
    // Aug 1 carries two games and Aug 5 carries two. Splitting a doubleheader would put two
    // columns on the axis for a date the readout can only name once.
    const s = seasonShape(TEAMS, SEASON)
    expect(s.columns.map(c => c.date)).toEqual([null, '2026-08-01', '2026-08-03', '2026-08-05'])
    expect(s.columns.map(c => c.games)).toEqual([0, 2, 1, 2])
  })

  it('gives every club a point on every column, idle or not', () => {
    const s = seasonShape(TEAMS, SEASON)
    for (const t of s.tracks) expect(t.points).toHaveLength(s.columns.length)
    // LA and BOS did not play on Aug 3, so they hold whatever they were.
    const la = s.tracks.find(t => t.team.id === 'LA')!
    expect(la.points[2]).toMatchObject({ wins: 0, losses: 1 })
    expect(la.points[1]).toMatchObject({ wins: 0, losses: 1 })
  })

  // THE GUARANTEE. Not "the numbers look right" but "the last frame IS the table", which is
  // what stops the card under the standings ever contradicting the standings.
  it('ends on exactly the standings table', () => {
    const s = seasonShape(TEAMS, SEASON)
    expect(standingsAt(s, s.columns.length - 1)).toEqual(computeStandings(TEAMS, SEASON))
  })

  it('orders every frame the way the table orders it, tiebreaks included', () => {
    const s = seasonShape(TEAMS, SEASON)
    // From column 1. The opening column is the one frame that does NOT take its order from its
    // own call, because its own call has no order to give: see below.
    s.columns.forEach((_, i) => {
      if (i === 0) return
      expect(standingsAt(s, i).map(r => r.team.id))
        .toEqual(computeStandings(TEAMS, SEASON.slice(0, cumulativeGames(s, i))).map(r => r.team.id))
    })
  })

  // Every club is 0-0 before a pitch is thrown, so `computeStandings` runs out of tiebreaks and
  // hands back the order the teams arrived in. Drawn, that is four rows in an arbitrary order
  // that all slide into a real one the moment the first game lands: a reorder animation for an
  // event that did not happen.
  it('opens in the order day one produced, not the order the teams arrived in', () => {
    // BOS win the opening day, so day one puts them top and the fetch order (SF first) does not.
    const season = [won('2026-08-01', 'BOS', 'SF'), won('2026-08-03', 'BOS', 'NY')]
    const s = seasonShape(TEAMS, season)
    expect(standingsAt(s, 0).map(r => r.team.id)).toEqual(standingsAt(s, 1).map(r => r.team.id))
    expect(standingsAt(s, 0)[0].team.id).toBe('BOS')
    // The RECORDS are still the real call's: nobody has played.
    for (const r of standingsAt(s, 0)) expect(r).toMatchObject({ wins: 0, losses: 0 })
  })

  it('clamps a column index rather than returning undefined', () => {
    const s = seasonShape(TEAMS, SEASON)
    expect(standingsAt(s, -5)).toBe(standingsAt(s, 0))
    expect(standingsAt(s, 999)).toBe(standingsAt(s, s.columns.length - 1))
  })
})

describe('what the chart refuses to count', () => {
  // The trap this section keeps re-learning: the feed sends counts_in_standings: true on
  // postseason rows, so the game_type backstop is the only thing holding them out.
  it('leaves the postseason out, exactly as the table does', () => {
    const withPlayoffs = [...SEASON, won('2026-09-09', 'BOS', 'SF'), won('2026-09-11', 'BOS', 'SF')]
      .map((g, i) => (i >= SEASON.length ? { ...g, game_type: 'semifinal' } : g))
    const s = seasonShape(TEAMS, withPlayoffs)
    expect(s.games).toBe(SEASON.length)
    expect(s.columns.map(c => c.date)).not.toContain('2026-09-09')
    expect(standingsAt(s, s.columns.length - 1)).toEqual(computeStandings(TEAMS, withPlayoffs))
  })

  it('ignores a game still being played and a tie', () => {
    const s = seasonShape(TEAMS, [
      ...SEASON,
      won('2026-08-07', 'NY', 'BOS'),
    ].map((g, i) => (i === SEASON.length ? { ...g, status: 'live' as const } : g)))
    expect(s.games).toBe(SEASON.length)
  })

  it('draws an axis even before anything is played', () => {
    const s = seasonShape(TEAMS, [])
    expect(s.games).toBe(0)
    expect(s.span).toBe(1)
    expect(s.columns).toHaveLength(1)
    // Still a real frame, so a caller that renders it gets four clubs at 0-0 rather than a hole.
    expect(standingsAt(s, 0)).toHaveLength(4)
  })
})

describe('the longest climb', () => {
  it('measures from a low to a later high, never backwards', () => {
    // BOS loses three, then wins four: three under at the bottom, one over at the end, a swing
    // of four. The naive answer (first point to best point) would say one.
    const run = [
      won('2026-08-01', 'SF', 'BOS'), won('2026-08-02', 'SF', 'BOS'), won('2026-08-03', 'SF', 'BOS'),
      won('2026-08-04', 'BOS', 'NY'), won('2026-08-05', 'BOS', 'NY'),
      won('2026-08-06', 'BOS', 'NY'), won('2026-08-07', 'BOS', 'NY'),
    ]
    const best = biggestRun(seasonShape(TEAMS, run))
    expect(best?.team.id).toBe('BOS')
    expect(best?.swing).toBe(4)
  })

  it('says nothing at all when nobody has moved', () => {
    expect(biggestRun(seasonShape(TEAMS, []))).toBeNull()
  })

  // THE ONE THAT MADE THE LINE WORTH PRINTING. A club whose low is opening day has a climb that
  // is arithmetically its own record: "up 3 games since opening day" IS "3 games over .500",
  // which the standings table one card above already says, and that is the ordinary case for
  // every club for most of a season's first month.
  it('refuses a climb measured from opening day, which restates the standings', () => {
    const unbeaten = [
      won('2026-08-01', 'SF', 'BOS'), won('2026-08-02', 'SF', 'BOS'), won('2026-08-03', 'SF', 'NY'),
    ]
    const s = seasonShape(TEAMS, unbeaten)
    // SF are three over and never were below level, so their whole season is one rise out of
    // column 0. Nobody else has a trough to rise out of either.
    expect(biggestRun(s)).toBeNull()
  })

  it('still finds the smaller climb that came out of a real trough', () => {
    // SF go 3-0 (a bigger swing, but from opening day). BOS lose two and win two: level, from
    // two under, which is the run a fan would actually describe.
    const mixed = [
      won('2026-08-01', 'SF', 'NY'), won('2026-08-02', 'SF', 'NY'), won('2026-08-03', 'SF', 'NY'),
      won('2026-08-04', 'LA', 'BOS'), won('2026-08-05', 'LA', 'BOS'),
      won('2026-08-06', 'BOS', 'NY'), won('2026-08-07', 'BOS', 'NY'),
    ]
    const best = biggestRun(seasonShape(TEAMS, mixed))
    expect(best?.team.id).toBe('BOS')
    expect(best?.swing).toBe(2)
    expect(best?.from).toBeGreaterThan(0)
  })
})

describe('the race', () => {
  // What the standings table structurally cannot say, because it is one frame: a frame cannot
  // report that the lead changed hands.
  it('counts the days each club spent top of the table, and the changes', () => {
    // Aug 1: SF beat BOS, so SF lead. Aug 3: NY beat LA. Aug 5: LA beat SF twice over, taking
    // the top row off them.
    const race = [
      won('2026-08-01', 'SF', 'BOS'),
      won('2026-08-03', 'LA', 'NY'),
      won('2026-08-05', 'LA', 'SF'),
    ]
    const story = leadStory(seasonShape(TEAMS, race))!
    expect(story.dates).toBe(3)
    // Every playing date is accounted for exactly once, which is what makes the figures a
    // breakdown of the season rather than a list of moments.
    expect(story.days.reduce((n, d) => n + d.days, 0)).toBe(story.dates)
    expect(story.days[0].days).toBeGreaterThanOrEqual(story.days[story.days.length - 1].days)
    expect(story.changes).toBeGreaterThan(0)
  })

  it('reports a wire-to-wire season as no changes at all', () => {
    const runaway = [
      won('2026-08-01', 'SF', 'BOS'), won('2026-08-02', 'SF', 'BOS'),
      won('2026-08-03', 'SF', 'NY'), won('2026-08-04', 'SF', 'NY'),
    ]
    const story = leadStory(seasonShape(TEAMS, runaway))!
    expect(story.changes).toBe(0)
    expect(story.days).toHaveLength(1)
    expect(story.days[0].team.id).toBe('SF')
    expect(story.days[0].days).toBe(story.dates)
  })

  // THE OPENING COLUMN IS NOT A DAY. It is `computeStandings` on nothing, where the sort falls
  // through to a run differential of zero for all four clubs, so its top row is whichever club
  // came back from the fetch first. Counting it would hand a club a day in first for existing.
  it('never counts the column before a pitch was thrown', () => {
    const story = leadStory(seasonShape(TEAMS, SEASON))!
    expect(story.dates).toBe(seasonShape(TEAMS, SEASON).columns.length - 1)
    expect(story.days.reduce((n, d) => n + d.days, 0)).toBe(story.dates)
  })

  // FIRST PLACE IS THE TOP ROW OF THE TABLE, and that is not always the highest line on the
  // chart: the y-axis is games above .500 and the table sorts by win percentage, so a club with
  // games in hand can lead while sitting lower on the chart. The card's guarantee is that it
  // agrees with the standings, so this has to follow the standings.
  it('names whoever the standings table names, not the highest line', () => {
    const s = seasonShape(TEAMS, SEASON)
    const story = leadStory(s)!
    // Rebuild the count straight off the frames, which ARE the table at each date.
    const expected = new Map<string, number>()
    for (let i = 1; i < s.frames.length; i++) {
      const id = s.frames[i][0].team.id
      expected.set(id, (expected.get(id) ?? 0) + 1)
    }
    for (const d of story.days) expect(d.days).toBe(expected.get(d.team.id))
  })

  it('says nothing about a season with one day in it', () => {
    expect(leadStory(seasonShape(TEAMS, [won('2026-08-01', 'SF', 'BOS')]))).toBeNull()
    expect(leadStory(seasonShape(TEAMS, []))).toBeNull()
  })
})

/** Games played through column `i` of a shape, for rebuilding the same slice the shape used. */
function cumulativeGames(s: ReturnType<typeof seasonShape>, i: number): number {
  return s.columns.slice(0, i + 1).reduce((n, c) => n + c.games, 0)
}

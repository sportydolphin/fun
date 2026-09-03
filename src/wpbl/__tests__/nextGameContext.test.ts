import { describe, it, expect } from 'vitest'
import { nextGameContext } from '../Home'
import type { WpblGame, WpblTeam } from '../types'

// What Home's Next game card says under the clock.
//
// THIS SHIPS BLIND. The mirror holds no postseason row until the semifinals are seeded on
// Sep 6, so the fortnight this was written for cannot be opened and looked at first. Same
// reasoning as series.test.ts, and the same safety net: the shapes below are the only thing
// standing between "Home is series-aware" and finding out on Sep 9 that it is not.
//
// The bug being pinned: `seasonSeries` counts only games `countsInStandings` accepts, so
// during a semifinal the loudest card on the page read "Season series tied 2-2" — the August
// head-to-head — while `RecapCard` 200px below it said "Semifinal · Game 1 of 3".

const team = (id: string, city: string, name: string): WpblTeam =>
  ({ id, city, name, abbr: id, color: '#000000' } as WpblTeam)

const TEAMS = new Map([
  ['SF', team('SF', 'San Francisco', 'Firebells')],
  ['LA', team('LA', 'Los Angeles', 'Queens')],
  ['BOS', team('BOS', 'Boston', 'Hunters')],
  ['NY', team('NY', 'New York', 'Heights')],
])

let seq = 0
const post = (date: string, home: string, away: string, hs?: number, as?: number): WpblGame => ({
  id: `p${++seq}`, game_date: date, start_time: '6:00 PM',
  home_team_id: home, away_team_id: away,
  status: hs == null ? 'scheduled' : 'final',
  home_score: hs ?? null, away_score: as ?? null,
  game_type: 'postseason', counts_in_standings: false,
} as WpblGame)

/** A decided regular-season meeting, won by whoever is named first. */
const regular = (date: string, winner: string, loser: string): WpblGame => ({
  id: `r${++seq}`, game_date: date, start_time: '6:30 PM',
  home_team_id: winner, away_team_id: loser,
  status: 'final', home_score: 5, away_score: 3,
  game_type: 'regular', counts_in_standings: true,
} as WpblGame)

const START = Date.parse('2026-09-10T18:00:00Z')
const ctx = (g: WpblGame, all: WpblGame[]) => nextGameContext(g, all, TEAMS, START)

describe('Next game, in the regular season', () => {
  it('reads the season series, which is the fixture it is previewing', () => {
    const played = [regular('2026-08-01', 'SF', 'LA'), regular('2026-08-02', 'SF', 'LA')]
    const upcoming = { ...regular('2026-09-04', 'SF', 'LA'), status: 'scheduled', home_score: null, away_score: null } as WpblGame
    const { postseason, line } = ctx(upcoming, [...played, upcoming])
    expect(postseason).toBeNull()
    expect(line).toContain('Firebells lead the season series 2–0')
  })

  // The guard the whole module leans on. `countsInStandings` counts anything it does not
  // recognise, so a feed that renames its game types must leave this card exactly as it is
  // rather than blanking the line or inventing a series.
  it('stays on the season series when nothing is marked postseason', () => {
    const g = { ...regular('2026-09-10', 'SF', 'LA'), status: 'scheduled', home_score: null, away_score: null } as WpblGame
    const all = [regular('2026-08-01', 'SF', 'LA'), g]
    expect(ctx(g, all).postseason).toBeNull()
    expect(ctx(g, all).line).toContain('season series')
  })
})

describe('Next game, in the postseason', () => {
  it('names the series and the game, not the August head-to-head', () => {
    // SF beat LA twice in the regular season, so the old reading had something to say and
    // said it: this is the exact case that would have gone out wrong on Sep 9.
    const summer = [regular('2026-08-01', 'SF', 'LA'), regular('2026-08-02', 'SF', 'LA')]
    const g1 = post('2026-09-09', 'SF', 'LA', 4, 2)
    const g2 = post('2026-09-11', 'LA', 'SF')
    const { postseason, line } = ctx(g2, [...summer, g1, g2])

    expect(postseason).not.toBeNull()
    expect(postseason!.label).toBe('Semifinal')
    expect(postseason!.gameNumber).toBe(2)
    expect(postseason!.bestOf).toBe(3)
    expect(line).toBe('Firebells lead 1-0 · Firebells can clinch')
    expect(line).not.toContain('season series')
  })

  it('says nothing but the game number before a series has a result', () => {
    const g1 = post('2026-09-09', 'SF', 'LA')
    const { postseason, line } = ctx(g1, [regular('2026-08-01', 'SF', 'LA'), g1])
    expect(postseason!.gameNumber).toBe(1)
    // The record says nothing the eyebrow has not, and the August meeting is not this series.
    expect(line).toBe('')
  })

  it('calls a decider a decider', () => {
    const g1 = post('2026-09-09', 'SF', 'LA', 4, 2)
    const g2 = post('2026-09-11', 'LA', 'SF', 3, 1)
    const g3 = post('2026-09-13', 'SF', 'LA')
    const { postseason, line } = ctx(g3, [g1, g2, g3])
    expect(postseason!.gameNumber).toBe(3)
    expect(line).toBe('Series tied 1-1 · Winner takes the series')
  })

  // A real four-club bracket, because the round is inferred rather than labelled: the
  // championship is the one pairing whose BOTH clubs appear in another pairing. A fixture
  // that puts one club in both semifinals collapses to two pairings and no championship,
  // which is a bug in the fixture and not in the reading.
  it('knows the championship is longer than a semifinal', () => {
    const semiA = [post('2026-09-09', 'SF', 'LA', 4, 2), post('2026-09-11', 'LA', 'SF', 1, 5)]
    const semiB = [post('2026-09-10', 'BOS', 'NY', 3, 0), post('2026-09-12', 'NY', 'BOS', 2, 6)]
    const final1 = post('2026-09-16', 'SF', 'BOS')
    const { postseason, line } = ctx(final1, [...semiA, ...semiB, final1])
    expect(postseason!.label).toBe('Championship')
    expect(postseason!.bestOf).toBe(5)
    // Game 1 of a best-of-five: nobody leads and nobody is one win away.
    expect(line).toBe('')
  })
})

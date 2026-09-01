import { describe, it, expect } from 'vitest'
import { seriesContext, seriesContexts, postseasonRounds, pairKey } from '../derive/series'
import type { WpblGame, WpblTeam } from '../types'

// Series state, tested against a postseason that has not happened.
//
// Every surface that says "SF leads 2-1" reads this module, including two that post to places
// people cannot un-see: the Discord recap channel and Bluesky. There is no live bracket to
// check it against before Sep 9, so the shapes below are the whole safety net.

const team = (id: string, city: string, name: string): WpblTeam =>
  ({ id, city, name, abbr: id, color: '#000000' } as WpblTeam)

const TEAMS = new Map([
  ['SF', team('SF', 'San Francisco', 'Firebells')],
  ['LA', team('LA', 'Los Angeles', 'Queens')],
  ['NY', team('NY', 'New York', 'Heights')],
  ['BOS', team('BOS', 'Boston', 'Hunters')],
])

let seq = 0
/** A postseason game: marked the way the bracket card already assumes the feed will mark it. */
const post = (date: string, home: string, away: string, homeScore?: number, awayScore?: number): WpblGame => ({
  id: `p${++seq}`,
  game_date: date,
  start_time: '6:00 PM',
  home_team_id: home,
  away_team_id: away,
  status: homeScore == null ? 'scheduled' : 'final',
  home_score: homeScore ?? null,
  away_score: awayScore ?? null,
  game_type: 'postseason',
  counts_in_standings: false,
} as WpblGame)

/** An ordinary regular-season game, which must never acquire a series. */
const regular = (date: string, home: string, away: string): WpblGame => ({
  id: `r${++seq}`,
  game_date: date,
  start_time: '6:30 PM',
  home_team_id: home,
  away_team_id: away,
  status: 'final',
  home_score: 5,
  away_score: 3,
  game_type: 'regular',
  counts_in_standings: true,
} as WpblGame)

const ctx = (g: WpblGame, all: WpblGame[]) => seriesContext(g, all, TEAMS)

describe('seriesContext', () => {
  it('says nothing about a regular-season game', () => {
    const g = regular('2026-08-15', 'SF', 'BOS')
    expect(ctx(g, [g])).toBeNull()
  })

  it('says nothing at all while the feed marks no game as postseason', () => {
    // The failure the whole module is written to survive: if the feed does not flag the
    // postseason, every surface has to render exactly as it does today rather than inventing
    // a series out of the last four games two clubs happened to play.
    const season = [regular('2026-09-09', 'SF', 'BOS'), regular('2026-09-11', 'BOS', 'SF')]
    expect(seriesContexts(season, TEAMS).size).toBe(0)
    expect(ctx(season[0], season)).toBeNull()
  })

  it('numbers the games of a series in date order', () => {
    const g1 = post('2026-09-09', 'SF', 'BOS', 4, 2)
    const g2 = post('2026-09-11', 'BOS', 'SF', 1, 3)
    const all = [g2, g1]   // handed in out of order, as a schedule fetch may well be
    expect(ctx(g1, all)!.gameNumber).toBe(1)
    expect(ctx(g2, all)!.gameNumber).toBe(2)
  })

  it('reports a finished game INCLUDING itself, which is what a box score says', () => {
    const g1 = post('2026-09-09', 'SF', 'BOS', 4, 2)
    const all = [g1]
    const c = ctx(g1, all)!
    expect(c.line).toBe('Firebells lead 1-0')
    expect(c.homeWins).toBe(1)
    expect(c.awayWins).toBe(0)
  })

  it('reports a scheduled game EXCLUDING itself, which is what a preview says', () => {
    const g1 = post('2026-09-09', 'SF', 'BOS', 4, 2)
    const g2 = post('2026-09-11', 'BOS', 'SF')
    const all = [g1, g2]
    const c = ctx(g2, all)!
    // g2's home club is BOS, so the wins are reported from BOS's side of the row.
    expect(c.homeWins).toBe(0)
    expect(c.awayWins).toBe(1)
    expect(c.line).toBe('Firebells lead 1-0')
    expect(c.clinched).toBe(false)
  })

  it('calls a tied series tied', () => {
    const all = [post('2026-09-09', 'SF', 'BOS', 4, 2), post('2026-09-11', 'BOS', 'SF', 5, 1)]
    expect(ctx(all[1], all)!.line).toBe('Series tied 1-1')
  })

  it('has nothing to say about the record before game 1', () => {
    const g1 = post('2026-09-09', 'SF', 'BOS')
    expect(ctx(g1, [g1])!.line).toBeNull()
    expect(ctx(g1, [g1])!.gameNumber).toBe(1)
  })

  it('calls a semifinal clincher a clincher', () => {
    const all = [post('2026-09-09', 'SF', 'BOS', 4, 2), post('2026-09-11', 'BOS', 'SF', 1, 3)]
    const c = ctx(all[1], all)!
    expect(c.clinched).toBe(true)
    expect(c.seriesWinner?.id).toBe('SF')
    expect(c.line).toBe('Firebells win the series 2-0')
  })

  it('does not call the game BEFORE the clincher a clincher', () => {
    const all = [post('2026-09-09', 'SF', 'BOS', 4, 2), post('2026-09-11', 'BOS', 'SF', 1, 3)]
    expect(ctx(all[0], all)!.clinched).toBe(false)
  })

  it('names a club that can clinch tonight', () => {
    const all = [post('2026-09-09', 'SF', 'BOS', 4, 2), post('2026-09-11', 'BOS', 'SF')]
    expect(ctx(all[1], all)!.stakes).toBe('Firebells can clinch')
  })

  it('calls a deciding game a deciding game rather than naming one club', () => {
    // Both clubs a win away. Saying "SF can clinch" here would be true and would read as if
    // only one of them had anything at stake.
    const all = [
      post('2026-09-09', 'SF', 'BOS', 4, 2),
      post('2026-09-11', 'BOS', 'SF', 5, 1),
      post('2026-09-13', 'SF', 'BOS'),
    ]
    expect(ctx(all[2], all)!.stakes).toBe('Winner takes the series')
  })

  it('says nothing about stakes once the game has been played', () => {
    const all = [post('2026-09-09', 'SF', 'BOS', 4, 2), post('2026-09-11', 'BOS', 'SF', 1, 3)]
    expect(ctx(all[1], all)!.stakes).toBeNull()
  })

  it('does not credit anybody for a tie, which cannot decide a postseason game', () => {
    const all = [post('2026-09-09', 'SF', 'BOS', 3, 3)]
    const c = ctx(all[0], all)!
    expect(c.homeWins).toBe(0)
    expect(c.awayWins).toBe(0)
    expect(c.line).toBeNull()
  })

  it('gives nothing when handed a schedule that does not contain the game', () => {
    // A caller holding a partial schedule gets no series rather than a record computed from
    // a fraction of one, which is the same failure direction as regularSeasonLines.
    const g1 = post('2026-09-09', 'SF', 'BOS', 4, 2)
    const g2 = post('2026-09-11', 'BOS', 'SF', 1, 3)
    expect(seriesContext(g2, [g1], TEAMS)).toBeNull()
  })
})

describe('the round a series belongs to', () => {
  // Semifinal A is 1v4 and B is 2v3; the championship is the two winners. SF and LA go
  // through, so SF-LA is the final and each of them has played two pairings.
  const semiA = [post('2026-09-09', 'SF', 'BOS', 4, 2), post('2026-09-11', 'BOS', 'SF', 1, 3)]
  const semiB = [post('2026-09-10', 'LA', 'NY', 6, 5), post('2026-09-12', 'NY', 'LA', 2, 7)]
  const final = [post('2026-09-16', 'SF', 'LA', 3, 1)]

  it('reads a semifinal as a semifinal while it is the only round played', () => {
    const rounds = postseasonRounds(semiA)
    expect(rounds.get(pairKey('SF', 'BOS'))).toBe('semifinal')
  })

  it('picks the championship out by the clubs that appear in two pairings', () => {
    const all = [...semiA, ...semiB, ...final]
    const rounds = postseasonRounds(all)
    expect(rounds.get(pairKey('SF', 'LA'))).toBe('championship')
    expect(rounds.get(pairKey('SF', 'BOS'))).toBe('semifinal')
    expect(rounds.get(pairKey('LA', 'NY'))).toBe('semifinal')
  })

  it('knows the championship is best-of-five before a ball is thrown in it', () => {
    // The pairing exists as soon as the rows do, so the round is right on a scheduled game.
    const scheduled = post('2026-09-16', 'SF', 'LA')
    const all = [...semiA, ...semiB, scheduled]
    const c = ctx(scheduled, all)!
    expect(c.round).toBe('championship')
    expect(c.bestOf).toBe(5)
    expect(c.label).toBe('Championship')
  })

  it('words a championship clincher as a championship', () => {
    // The complaint this whole item was filed under: a best-of-five clincher used to be
    // reported as a 4-2 win and nothing more.
    const all = [
      ...semiA, ...semiB,
      post('2026-09-16', 'SF', 'LA', 3, 1),
      post('2026-09-17', 'SF', 'LA', 2, 5),
      post('2026-09-19', 'LA', 'SF', 0, 4),
      post('2026-09-20', 'LA', 'SF', 1, 6),
    ]
    const clincher = all[all.length - 1]
    const c = ctx(clincher, all)!
    expect(c.clinched).toBe(true)
    expect(c.seriesWinner?.id).toBe('SF')
    expect(c.line).toBe('Firebells win the championship 3-1')
  })

  it('puts the championship at stake in its own words', () => {
    const all = [
      ...semiA, ...semiB,
      post('2026-09-16', 'SF', 'LA', 3, 1),
      post('2026-09-17', 'SF', 'LA', 4, 2),
      post('2026-09-19', 'LA', 'SF', 5, 1),
      post('2026-09-20', 'LA', 'SF'),
    ]
    expect(ctx(all[all.length - 1], all)!.stakes).toBe('Firebells can clinch')
  })
})

describe('seriesContexts', () => {
  it('agrees with seriesContext game for game', () => {
    // The list view uses the bulk form and Game Center the single one. Two readings of the
    // same series that could disagree is the failure worth pinning, since the two are read
    // one after the other by someone tapping a schedule row.
    const all = [
      post('2026-09-09', 'SF', 'BOS', 4, 2),
      post('2026-09-11', 'BOS', 'SF', 1, 3),
      post('2026-09-10', 'LA', 'NY', 6, 5),
      post('2026-09-16', 'SF', 'LA'),
      regular('2026-08-15', 'SF', 'NY'),
    ]
    const bulk = seriesContexts(all, TEAMS)
    for (const g of all) {
      expect(bulk.get(g.id) ?? null).toEqual(seriesContext(g, all, TEAMS))
    }
    // And the regular-season game is not in it at all.
    expect(bulk.has(all[4].id)).toBe(false)
  })
})

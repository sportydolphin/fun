import { describe, it, expect } from 'vitest'
import {
  wpblQualifiers, plateAppearances, sumBatting,
  QUALIFY_PA_PER_GAME, QUALIFY_OUTS_PER_GAME, QUALIFY_FLOOR_PA, QUALIFY_MIN_GAMES,
} from '../stats'
import type { WpblBattingLine, WpblGame, WpblTeam } from '../types'

// The batting rate qualifier is in PLATE APPEARANCES, and this file exists to keep it there.
// It was at-bats for most of the inaugural season, which is a unit that throws away every
// walk: it charged a patient hitter for the thing OPS is half made of, and the two sides of
// the same rule disagreed with each other, since the pitching bar was already MLB's.
//
// Nothing about the switch fails loudly. Put AB back and the boards still render, still
// look plausible, and quietly exclude the hitters with the best OBP in the league.

const teams: WpblTeam[] = [{ id: 'SF' } as WpblTeam, { id: 'LA' } as WpblTeam]

const schedule = (n: number): WpblGame[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `g${i}`, status: 'final', home_team_id: 'SF', away_team_id: 'LA',
    game_type: 'regular', counts_in_standings: true,
  } as WpblGame))

const bat = (o: Partial<WpblBattingLine> = {}): WpblBattingLine => ({
  id: Math.random().toString(36).slice(2), game_id: 'g0', player_id: 'p1', team_id: 'SF',
  batting_order: 1, position: 'CF',
  ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0,
  hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0, ibb: 0, gdp: 0, ...o,
} as WpblBattingLine)

describe('plateAppearances', () => {
  it('counts every trip, walks and both sacrifices included', () => {
    const t = sumBatting([bat({ ab: 4, h: 1, bb: 2, hbp: 1, sf: 1, sh: 1 })], [])
    expect(plateAppearances(t)).toBe(9)
  })

  it('carries sac hits, which the ad-hoc copies of this sum all used to drop', () => {
    // `sh` is on the feed's line and is NOT in OBP's denominator, which is why it kept being
    // left out: the PA sum was copied from the OBP sum. Playing time counts a bunt.
    const t = sumBatting([bat({ ab: 3, sh: 2 })], [])
    expect(t.sh).toBe(2)
    expect(plateAppearances(t)).toBe(5)
  })
})

describe('wpblQualifiers', () => {
  it('holds off entirely until every team has played', () => {
    expect(wpblQualifiers(teams, schedule(QUALIFY_MIN_GAMES - 1)).active).toBe(false)
    expect(wpblQualifiers(teams, schedule(QUALIFY_MIN_GAMES)).active).toBe(true)
  })

  it('scales the batting bar in PA per team game, at MLB 3.1 scaled to seven innings', () => {
    expect(QUALIFY_PA_PER_GAME).toBeCloseTo((3.1 * 7) / 9, 1)
    expect(wpblQualifiers(teams, schedule(25)).minPa).toBe(Math.round(2.4 * 25))
  })

  it('scales the pitching bar the same way, in OUTS', () => {
    // 1.0 IP per team game is MLB's; x 7/9 is 0.78 IP, or 2.4 outs. The two 2.4s are a
    // coincidence of units and this pins them apart: if someone folds them into one constant
    // the next change to either silently moves both.
    expect(QUALIFY_OUTS_PER_GAME / 3).toBeCloseTo((1.0 * 7) / 9, 1)
    expect(wpblQualifiers(teams, schedule(25)).minOuts).toBe(Math.round(2.4 * 25))
  })

  it('floors the opening days so a 2-game bar is not one trip to the plate', () => {
    expect(wpblQualifiers(teams, schedule(2)).minPa).toBe(QUALIFY_FLOOR_PA)
  })

  it('scales off the LEAST-played team, so a club with a game in hand cannot lower its own bar', () => {
    const uneven = [...schedule(10), { id: 'extra', status: 'final', home_team_id: 'SF', away_team_id: 'SF', game_type: 'regular', counts_in_standings: true } as WpblGame]
    expect(wpblQualifiers(teams, uneven).teamGames).toBe(10)
  })

  it('qualifies the walker the at-bat bar excluded, and cuts the hacker it let in', () => {
    // The case the switch exists for. Both hitters have played the same 20 games; the first
    // has walked 20 times and the second has not walked at all, so the first has MORE playing
    // time on FEWER at-bats. Under `ab >= 2.0 * G` the ranking of the two was exactly
    // inverted, which is the bug and not a rounding difference.
    const q = wpblQualifiers(teams, schedule(20))
    const patient = sumBatting([bat({ ab: 38, h: 12, bb: 20 })], [])
    const hacker  = sumBatting([bat({ ab: 45, h: 12 })], [])
    expect(plateAppearances(patient)).toBeGreaterThan(plateAppearances(hacker))

    expect(plateAppearances(patient)).toBeGreaterThanOrEqual(q.minPa)
    expect(patient.ab).toBeLessThan(2.0 * q.teamGames)      // the old bar cut her

    expect(plateAppearances(hacker)).toBeLessThan(q.minPa)
    expect(hacker.ab).toBeGreaterThanOrEqual(2.0 * q.teamGames)  // the old bar let her in
  })
})

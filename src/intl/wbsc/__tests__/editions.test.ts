import { describe, it, expect } from 'vitest'
import type { WbscGame } from '../game'
import type { PitchingGameLine } from '../../../league/types'
import { buildWorldCupSite, standings, type EditionDef } from '../editions'

// Synthetic rows only (see fixture.ts for why): a one-event edition whose opening round is two
// groups WBSC never labeled, and a split edition of two group stages and a Finals.

let n = 0
const game = (round: string, away: string, home: string, as: number, hs: number, date = '2026-07-01'): WbscGame => {
  n++
  return {
    id: `wbsc:g:${n}`, wbsc_game_id: n, event_key: '', game_date: date, status: 'final',
    away_team_id: away, home_team_id: home, away_score: as, home_score: hs, round, start_local: `${date} 1${n % 10}:00:00`,
    timezone: null, innings: 7, venue: null, city: null, attendance: null, duration_minutes: null,
    home_hits: 0, away_hits: 0, home_errors: 0, away_errors: 0,
  }
}

const SRC = 'https://www.wbsc.org/en/events'

// The letters run against the order the groups first played, as 2016's and 2018's did.
const ONE: EditionDef = {
  slug: '2018', ordinal: null, years: [2018], hosts: ['Here'], events: [{ key: 'one', label: null }],
  groupLetters: { A: ['BBB', 'CCC'], B: ['AAA', 'YYY', 'ZZZ'] },
}
const SPLIT: EditionDef = {
  slug: '2024', ordinal: 'IX', years: [2023, 2024], hosts: ['There'],
  events: [{ key: 'ga', label: 'Group A' }, { key: 'gb', label: 'Group B' }, { key: 'fin', label: null }],
}

function oneEvent() {
  return {
    key: 'one', source: `${SRC}/one`, batting: [], pitching: [],
    games: [
      game('Opening Round', 'ZZZ', 'AAA', 1, 5, '2018-08-01'),
      game('Opening Round', 'BBB', 'CCC', 3, 2, '2018-08-01'),
      game('Opening Round', 'AAA', 'YYY', 0, 2, '2018-08-02'),
      game('Opening Round', 'ZZZ', 'YYY', 4, 4, '2018-08-03'),
      game('Super Round', 'AAA', 'BBB', 2, 1, '2018-08-04'),
      game('Bronze Medal Game', 'YYY', 'CCC', 6, 1, '2018-08-05'),
      game('World Championship Final', 'BBB', 'AAA', 2, 3, '2018-08-05'),
    ],
  }
}

describe('World Cup editions', () => {
  it('splits an unlabeled round into the groups that played each other, lettered as WBSC letters them', () => {
    const { editions, errors } = buildWorldCupSite([oneEvent()], { editions: [ONE] })
    expect(errors).toEqual([])
    const [opening, superRound, medals] = editions[0].stages
    expect(opening.label).toBe('Opening Round')
    expect(opening.groups.map(g => g.label)).toEqual(['Group A', 'Group B'])
    expect(opening.groups[1].standings.map(r => r.team).sort()).toEqual(['AAA', 'YYY', 'ZZZ'])
    expect(superRound.groups).toHaveLength(1)
    expect(superRound.groups[0].label).toBeNull()
    expect(medals.kind).toBe('medal')
    expect(editions[0].medals).toEqual({ gold: 'AAA', silver: 'BBB', bronze: 'YYY' })
  })

  it('keeps a record with runs, and a tie counts as neither', () => {
    const { editions } = buildWorldCupSite([oneEvent()], { editions: [ONE] })
    const rows = editions[0].stages[0].groups.find(g => g.label === 'Group B')!.standings
    expect(rows.find(r => r.team === 'YYY')).toEqual({ team: 'YYY', w: 1, l: 0, rs: 6, ra: 4 })
    expect(rows.find(r => r.team === 'ZZZ')).toEqual({ team: 'ZZZ', w: 0, l: 1, rs: 5, ra: 9 })
    expect(rows[0].team).toBe('YYY')
  })

  it('links every result to its box score on wbsc.org', () => {
    const { editions } = buildWorldCupSite([oneEvent()], { editions: [ONE] })
    const g = editions[0].stages[0].groups[0].games[0]
    expect(g.url).toMatch(new RegExp(`^${SRC}/one/box-score/\\d+$`))
  })

  it('makes the group-stage events one stage, and leaves a Finals without a final unmedaled', () => {
    const { editions, index } = buildWorldCupSite([
      { key: 'ga', source: `${SRC}/ga`, batting: [], pitching: [], games: [game('Group Stage Games', 'AAA', 'BBB', 1, 0)] },
      { key: 'gb', source: `${SRC}/gb`, batting: [], pitching: [], games: [game('Group Stage Games', 'CCC', 'DDD', 1, 0)] },
      { key: 'fin', source: `${SRC}/fin`, batting: [], pitching: [], games: [game('Final Stage Games', 'AAA', 'CCC', 1, 0)] },
    ], { editions: [SPLIT] })
    expect(editions[0].stages.map(s => s.label)).toEqual(['Group stage', 'Finals'])
    expect(editions[0].stages[0].groups.map(g => g.label)).toEqual(['Group A', 'Group B'])
    expect(editions[0].medals).toBeNull()
    expect(index[0]).toMatchObject({ slug: '2024', teams: 4, games: 3 })
  })

  it('carries a later round the earlier games between two teams in it, as WBSC does', () => {
    const { editions } = buildWorldCupSite([{
      key: 'one', source: '', batting: [], pitching: [],
      games: [
        game('Opening Round', 'AAA', 'YYY', 3, 1, '2018-08-01'), game('Opening Round', 'ZZZ', 'AAA', 0, 2, '2018-08-01'),
        game('Opening Round', 'YYY', 'ZZZ', 5, 0, '2018-08-02'), game('Opening Round', 'BBB', 'CCC', 2, 1, '2018-08-02'),
        // AAA and YYY move on together, so their opening game counts again; ZZZ's do not.
        game('Super Round', 'BBB', 'AAA', 1, 0, '2018-08-03'), game('Super Round', 'YYY', 'BBB', 4, 2, '2018-08-03'),
      ],
    }], { editions: [ONE] })
    const rows = editions[0].stages[1].groups[0].standings
    expect(rows.map(r => [r.team, r.w, r.l])).toEqual([['AAA', 1, 1], ['BBB', 1, 1], ['YYY', 1, 1]])
    expect(editions[0].stages[1].groups[0].games).toHaveLength(2)
  })

  it('breaks a tie by the games between the tied teams, then by Team Quality Balance in them', () => {
    // A beats B, B beats C, C beats A: level head to head, so runs per inning decide: C scored 11
    // and allowed 4, B 4 and 4, A 3 and 10, each over 14 innings.
    const games = [
      game('R', 'AAA', 'BBB', 2, 1), game('R', 'BBB', 'CCC', 3, 2), game('R', 'CCC', 'AAA', 9, 1),
      game('R', 'DDD', 'AAA', 0, 1), game('R', 'DDD', 'BBB', 0, 1), game('R', 'DDD', 'CCC', 0, 1),
    ]
    expect(standings(games, () => 7).map(r => r.team)).toEqual(['CCC', 'BBB', 'AAA', 'DDD'])
    // Head to head first: A and B are 2-1 and B beat A, so B is above A whatever the runs; D beat C.
    const two = [
      game('R', 'AAA', 'BBB', 0, 1), game('R', 'AAA', 'CCC', 20, 0), game('R', 'AAA', 'DDD', 20, 0),
      game('R', 'BBB', 'CCC', 0, 1), game('R', 'BBB', 'DDD', 1, 0), game('R', 'CCC', 'DDD', 0, 1),
    ]
    expect(standings(two, () => 7).map(r => r.team)).toEqual(['BBB', 'AAA', 'DDD', 'CCC'])
  })

  it("reads innings at bat from the other side's pitching", () => {
    // Both 1-1 and level head to head by count; A batted fewer innings for the same runs.
    const g1 = game('R', 'AAA', 'BBB', 4, 2), g2 = game('R', 'BBB', 'AAA', 4, 2)
    const line = (g: WbscGame, team: string, outs: number): PitchingGameLine => ({
      id: `${g.id}${team}`, game_id: g.id, player_id: 'p', team_id: team, outs, bf: null, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0,
      pitches: null, hbp: 0, wp: 0, bk: 0,
    })
    const { editions } = buildWorldCupSite([{
      key: 'one', source: '', batting: [],
      pitching: [line(g1, 'BBB', 15), line(g1, 'AAA', 21), line(g2, 'AAA', 21), line(g2, 'BBB', 21)],
      games: [{ ...g1, round: 'Super Round' }, { ...g2, round: 'Super Round' }],
    }], { editions: [ONE] })
    expect(editions[0].stages[0].groups[0].standings.map(r => r.team)).toEqual(['AAA', 'BBB'])
  })

  it('counts a forfeit in the standings and the results, not in the games played', () => {
    const def: EditionDef = {
      ...ONE,
      forfeits: [{ event: 'one', wbsc_game_id: 99, date: '2018-08-03', round: 'Super Round', away: 'AAA', home: 'BBB', away_score: 7, home_score: 0 }],
    }
    const { editions, index } = buildWorldCupSite([{
      key: 'one', source: '', batting: [], pitching: [], games: [game('Super Round', 'BBB', 'CCC', 2, 1, '2018-08-02')],
    }], { editions: [def] })
    const group = editions[0].stages[0].groups[0]
    expect(group.standings.map(r => [r.team, r.w, r.l, r.rs, r.ra])).toEqual([['AAA', 1, 0, 7, 0], ['BBB', 1, 1, 2, 8], ['CCC', 0, 1, 1, 2]])
    expect(group.games.map(g => g.forfeit)).toEqual([false, true])
    expect(index[0].games).toBe(1)
  })

  it('builds nothing when an edition is half imported, a round is unknown or a group has no letter', () => {
    const half = buildWorldCupSite([{ key: 'ga', source: '', batting: [], pitching: [], games: [] }], { editions: [SPLIT] })
    expect(half.errors[0]).toMatch(/gb, fin not imported/)
    const odd = buildWorldCupSite([{ key: 'one', source: '', batting: [], pitching: [], games: [game('Placement Game', 'AAA', 'BBB', 1, 0)] }], { editions: [ONE] })
    expect(odd.errors[0]).toMatch(/unknown round "Placement Game"/)
    expect(odd.editions).toEqual([])
    const unlettered = buildWorldCupSite([{ key: 'one', source: '', batting: [], pitching: [], games: [
      game('Opening Round', 'BBB', 'CCC', 1, 0), game('Opening Round', 'QQQ', 'RRR', 1, 0),
    ] }], { editions: [ONE] })
    expect(unlettered.errors[0]).toMatch(/Opening Round group \(QQQ, RRR\) has no letter/)
  })
})

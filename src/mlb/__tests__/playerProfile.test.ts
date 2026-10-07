import { describe, it, expect } from 'vitest'
import {
  careerRows, tallyAwards, rankPlayer, planRoles, parseSeasonBundle, parseGameLog, scopedLog,
  scopedLine, decision, draftLine, birthplace, careerTrendSplits,
} from '../playerProfile'

// The MLB player page's data shaping (mlb/playerProfile.ts), pinned against the shapes StatsAPI
// actually returns. Each case is one the old page got wrong or one the new page leans on.

describe('careerRows', () => {
  it('takes the season total for a traded season, not the club with the most games', () => {
    // 2024 DET 18 G then LAD 10 G, and the total row with no team: what yearByYear returns.
    const rows = careerRows([
      { season: '2024', team: { id: 116 }, stat: { gamesPlayed: 18, era: '2.95' } },
      { season: '2024', team: { id: 119 }, stat: { gamesPlayed: 10, era: '3.58' } },
      { season: '2024', numTeams: 2, stat: { gamesPlayed: 28, era: '3.17' } },
      { season: '2023', team: { id: 138 }, stat: { gamesPlayed: 20, era: '4.43' } },
    ])
    expect(rows.map(r => r.season)).toEqual([2024, 2023])
    expect(rows[0].stat.gamesPlayed).toBe(28)
    expect(rows[0].teams).toBe('DET/LAD')
    // The band wears the club the season ended with.
    expect(rows[0].lastTeamId).toBe(119)
  })

  it('feeds the trends chart oldest first with both roles on one season', () => {
    const splits = careerTrendSplits({
      hitting: careerRows([{ season: '2025', team: { id: 119 }, stat: { ops: '.900' } }]),
      pitching: careerRows([{ season: '2025', team: { id: 119 }, stat: { era: '2.00' } }, { season: '2023', team: { id: 108 }, stat: { era: '3.10' } }]),
      totals: { hitting: null, pitching: null },
    })
    expect(splits.map(s => s.season)).toEqual([2023, 2025])
    expect(splits[1].hitting?.ops).toBe('.900')
    expect(splits[1].pitching?.era).toBe('2.00')
  })
})

describe('tallyAwards', () => {
  it('keeps the honours worth a ribbon, folds AL and NL together, and drops the rest', () => {
    const t = tallyAwards([
      { id: 'ALMVP', season: '2021' }, { id: 'NLMVP', season: '2024' },
      { id: 'ALAS', season: '2021' }, { id: 'NLAS', season: '2024' }, { id: 'NLAS', season: '2024' },
      { id: 'ALPOW', season: '2021' }, { id: 'MILBORGAS', season: '2016' }, { id: 'WSCHAMP', season: '2024' },
    ])
    expect(t.map(a => [a.label, a.seasons])).toEqual([
      ['MVP', [2021, 2024]],
      ['World Series', [2024]],
      // A duplicate row for the same season counts once.
      ['All-Star', [2021, 2024]],
    ])
  })
})

describe('rankPlayer', () => {
  const line = (id: number, stat: any) => ({ player: { id }, stat })
  // 162 games is the most anyone played, so the bars are 502 PA and 162 IP.
  const pool = [
    line(1, { gamesPlayed: 162, plateAppearances: 700, avg: '.300', homeRuns: 40 }),
    line(2, { gamesPlayed: 150, plateAppearances: 650, avg: '.310', homeRuns: 40 }),
    line(3, { gamesPlayed: 100, plateAppearances: 300, avg: '.350', homeRuns: 10 }),
    line(4, { gamesPlayed: 140, plateAppearances: 600, avg: '.250', homeRuns: 5 }),
  ]
  it('ranks a rate among qualifiers only, and a count against everyone', () => {
    const r = rankPlayer(pool, 1, 'hitting')
    expect(r.minPa).toBe(502)
    // Player 3's .350 is short of the bar, so it does not push player 1 down.
    expect(r.ranks.AVG).toEqual({ rank: 2, of: 3 })
    // Tied on home runs: both are first.
    expect(r.ranks.HR).toEqual({ rank: 1, of: 4 })
  })
  it('gives a player short of the bar no rate rank at all', () => {
    const r = rankPlayer(pool, 3, 'hitting')
    expect(r.ranks.AVG).toBeUndefined()
    expect(r.ranks.HR).toEqual({ rank: 3, of: 4 })
  })
  it('never ranks a hitter on strikeouts', () => {
    expect(rankPlayer([line(1, { gamesPlayed: 1, plateAppearances: 9, strikeOuts: 3 })], 1, 'hitting').ranks.SO).toBeUndefined()
  })
  it('ranks ERA low to high', () => {
    const r = rankPlayer([
      line(1, { gamesPlayed: 30, inningsPitched: '180.0', era: '2.50' }),
      line(2, { gamesPlayed: 30, inningsPitched: '170.1', era: '3.10' }),
    ], 2, 'pitching')
    expect(r.ranks.ERA).toEqual({ rank: 2, of: 2 })
  })
})

describe('planRoles', () => {
  it('folds a pitcher\'s handful of at-bats into one line', () => {
    const p = planRoles('1', { plateAppearances: 12 }, { inningsPitched: '150.0' })
    expect(p.roles).toEqual(['pitching'])
    expect(p.battingCameo).toBe(true)
  })
  it('folds a position player\'s mop-up inning into one line', () => {
    const p = planRoles('6', { plateAppearances: 600 }, { inningsPitched: '1.0', battersFaced: 5 })
    expect(p.roles).toEqual(['hitting'])
    expect(p.pitchingCameo).toBe(true)
  })
  it('gives a genuine two-way season both roles, hitting first', () => {
    const p = planRoles('Y', { plateAppearances: 700 }, { inningsPitched: '47.0' })
    expect(p.roles).toEqual(['hitting', 'pitching'])
  })
  it('shows a pitcher with no line as a pitcher', () => {
    expect(planRoles('1', null, null).roles).toEqual(['pitching'])
  })
})

describe('parseSeasonBundle', () => {
  it('splits the one wide response into its parts', () => {
    const b = parseSeasonBundle({ stats: [
      { type: { displayName: 'season' }, group: { displayName: 'hitting' }, splits: [{ stat: { avg: '.275' } }] },
      { type: { displayName: 'sabermetrics' }, group: { displayName: 'hitting' }, splits: [{ stat: { war: 6.1 } }] },
      { type: { displayName: 'statSplits' }, group: { displayName: 'hitting' }, splits: [
        { split: { code: 'h' }, stat: { avg: '.300' } },
        { split: { code: 'risp' }, stat: { avg: '.250' } },
        { split: { code: 'vl' }, stat: { avg: '.200' } },
      ] },
      { type: { displayName: 'season' }, group: { displayName: 'fielding' }, splits: [
        { position: { abbreviation: 'DH' }, stat: { gamesPlayed: 20 } },
        { position: { abbreviation: '1B' }, stat: { gamesPlayed: 5 } },
        { position: { abbreviation: 'C' }, stat: { gamesPlayed: 100 } },
      ] },
    ] })
    expect(b.hitting?.avg).toBe('.275')
    expect(b.pitching).toBeNull()
    expect(b.saber.hitting?.war).toBe(6.1)
    // Handedness first, then home and away, then RISP, whatever order the feed sent.
    expect(b.splits.hitting.map(s => s.code)).toEqual(['vl', 'h', 'risp'])
    // Most-played position first, and DH is not a fielding line.
    expect(b.fielding.map(f => f.position)).toEqual(['C', '1B'])
  })

  it('draws a traded season as one fielding row a position, the total', () => {
    // Tarik Skubal's 2026 as StatsAPI sends it: the total with no team, then each club.
    const b = parseSeasonBundle({ stats: [
      { type: { displayName: 'season' }, group: { displayName: 'fielding' }, splits: [
        { position: { abbreviation: 'P' }, team: { id: 116 }, stat: { gamesPlayed: 16 } },
        { position: { abbreviation: 'P' }, stat: { gamesPlayed: 26 } },
        { position: { abbreviation: 'P' }, team: { id: 119 }, stat: { gamesPlayed: 10 } },
      ] },
    ] })
    expect(b.fielding).toEqual([{ position: 'P', stat: { gamesPlayed: 26 } }])
  })
})

describe('parseGameLog', () => {
  const log = parseGameLog({ stats: [
    { group: { displayName: 'hitting' }, splits: [
      { game: { gamePk: 2 }, date: '2025-10-03', gameType: 'D', isHome: true, opponent: { id: 144 }, positionsPlayed: [{ abbreviation: 'DH' }], stat: { plateAppearances: 4 } },
      { game: { gamePk: 1 }, date: '2025-09-28', gameType: 'R', isHome: false, opponent: { id: 137 }, positionsPlayed: [{ abbreviation: 'DH' }], stat: { plateAppearances: 5 } },
    ] },
    { group: { displayName: 'pitching' }, splits: [
      { game: { gamePk: 1 }, date: '2025-09-28', gameType: 'R', isHome: false, opponent: { id: 137 }, stat: { inningsPitched: '6.0', wins: 1 } },
    ] },
  ] })
  it('merges both roles of one game into one row, newest first', () => {
    expect(log.map(g => g.gamePk)).toEqual([2, 1])
    expect(log[1].hitting?.plateAppearances).toBe(5)
    expect(log[1].pitching?.inningsPitched).toBe('6.0')
    expect(log[1].opponentAbbr).toBe('SF')
  })
  it('slices by scope', () => {
    expect(scopedLog(log, 'regular').map(g => g.gamePk)).toEqual([1])
    expect(scopedLog(log, 'post').map(g => g.gamePk)).toEqual([2])
    expect(scopedLog(log, 'all')).toHaveLength(2)
  })
})

describe('the small formatters', () => {
  it('builds Both from the two lines, rates rebuilt from counts', () => {
    const both = scopedLine({ atBats: 10, hits: 3, baseOnBalls: 0, hitByPitch: 0, sacFlies: 0, doubles: 0, triples: 0, homeRuns: 0 },
      { atBats: 10, hits: 5, baseOnBalls: 0, hitByPitch: 0, sacFlies: 0, doubles: 0, triples: 0, homeRuns: 0 }, 'all')
    expect(both.avg).toBe('.400')
  })
  it('reads a decision', () => {
    expect(decision({ wins: 1 })).toBe('W')
    expect(decision({ saves: 1 })).toBe('SV')
    expect(decision({})).toBe('—')
  })
  it('writes the draft and the birthplace the way a reader would', () => {
    const bio = { id: 1, fullName: 'X', active: true, primaryPosition: { code: '2', name: 'Catcher', type: 'Catcher' },
      birthCity: 'Harrisonburg', birthStateProvince: 'VA', birthCountry: 'USA',
      drafts: [{ year: '2015', pickRound: '20', pickNumber: 600 }, { year: '2018', pickRound: '3', pickNumber: 90 }] }
    expect(draftLine(bio)).toBe('Round 3, Pick 90 · 2018 draft')
    expect(birthplace(bio)).toBe('Harrisonburg, VA')
    expect(birthplace({ ...bio, birthCity: 'Oshu', birthStateProvince: undefined, birthCountry: 'Japan' })).toBe('Oshu, Japan')
  })
})

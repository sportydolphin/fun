// ─── The search box's answers: a stat beside a name, and who leads a ranking ──
//
// "Whitmore avg" answers in the player row's subtitle and "most hr" names the leader in the ranking
// row. Both promise to agree with the stats table a tap away, which is the thing nothing else would
// catch: a wrong leader still renders, still looks plausible, and contradicts the board it links to.
// So the WPBL half is pinned on the table's own rules (the year cut, the qualifying bar on every
// sort but Overall's, ties to the bigger sample) and the MLB half on its (the bar on rates only, a
// traded player's whole-season line, the advanced figures from the table's own reads).

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../mlb/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../mlb/api')>()
  return { ...actual, fetchLeaderboardData: vi.fn(), fetchAllTimeLeaderboardData: vi.fn() }
})
vi.mock('../mlb/apiSeasonStats', async importOriginal => {
  const actual = await importOriginal<typeof import('../mlb/apiSeasonStats')>()
  return { ...actual, fetchSeasonSabermetrics: vi.fn(), fetchParkFactors: vi.fn() }
})

import CommandPalette from '../CommandPalette'
import { nameWords, typedStat } from '../league/finderParse'
import { leaderSuggestions, peekText } from '../finderSearch'
import { getRecentQuestions } from '../lib/recentQuestions'
import { boardNeeds, buildWpblBoard, wpblLeaderPeek, wpblPlayerAnswer, type WpblBoard, type WpblLines } from '../wpbl/searchAnswers'
import { mlbLeaderPeek, mlbPlayerAnswer } from '../mlb/searchAnswers'
import { fetchAllTimeLeaderboardData, fetchLeaderboardData } from '../mlb/api'
import { fetchParkFactors, fetchSeasonSabermetrics } from '../mlb/apiSeasonStats'
import type { WpblValueTotals } from '../wpbl/derive/playerValue'
import type { SearchBridgeState, SearchResultRow } from '../mlb/state/SearchBridgeContext'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblTeam } from '../wpbl/types'

describe('typedStat', () => {
  it('reads one stat beside a name', () => {
    expect(typedStat('whitmore avg')).toEqual({ hitting: 'avg' })
    expect(typedStat('ibarra strikeouts 2026')).toMatchObject({ hitting: 'so', pitching: 'so', lean: 'pitching' })
  })

  it('reads nothing without a name, without a stat, or with two stats', () => {
    expect(typedStat('avg')).toBeNull()
    expect(typedStat('whitmore')).toBeNull()
    expect(typedStat('whitmore 2026')).toBeNull()
    expect(typedStat('whitmore hr rbi')).toBeNull()
  })
})

describe('the season figures (OPS+, wRC+, FIP, WAR)', () => {
  it('ranks them under their own names, on the column each table sorts', () => {
    expect(leaderSuggestions('wpbl', 'highest wrc+')[0]).toMatchObject({
      title: 'Highest wRC+', href: '/wpbl/stats?board=players&side=hitting&sort=wrcPlus&dir=desc',
    })
    expect(leaderSuggestions('mlb', 'lowest fip')[0]).toMatchObject({ title: 'Lowest FIP', href: '/mlb/stats?lb=pitching&sort=fip&dir=asc' })
    expect(leaderSuggestions('wpbl', 'best era+')[0]).toMatchObject({ title: 'Highest ERA+', ask: { side: 'pitching', sort: 'eraPlus', dir: null } })
  })

  it("puts WAR on WPBL's Overall side, and offers no MLB row, since the site has no MLB WAR", () => {
    expect(leaderSuggestions('wpbl', 'most war')[0]).toMatchObject({
      title: 'Most WAR', subtitle: 'Overall · this season', href: '/wpbl/stats?board=players&side=overall&sort=war&dir=desc',
    })
    expect(leaderSuggestions('mlb', 'most war')).toEqual([])
  })

  it('reads one beside a name, and takes it out of the name search', () => {
    expect(typedStat('whitmore war')).toEqual({ overall: 'war' })
    expect(typedStat('ohtani wrc+')).toEqual({ hitting: 'wrcPlus' })
    expect(nameWords('whitmore war')).toBe('whitmore')
    expect(nameWords('skenes fip 2025')).toBe('skenes')
  })

  it('never makes a line question of one: "2 war" is not a game', () => {
    expect(leaderSuggestions('wpbl', '2 war')).toEqual([])
  })
})

describe('peekText', () => {
  it('names one leader, two, or counts a wider tie', () => {
    expect(peekText({ name: 'Kelsie Whitmore', others: 0, value: '9' })).toBe('Kelsie Whitmore leads with 9')
    expect(peekText({ name: 'Kelsie Whitmore', others: 1, value: '9' })).toBe('Kelsie Whitmore and 1 more lead with 9')
    expect(peekText({ name: 'Kelsie Whitmore', others: 3, value: '9' })).toBe('4 tied at 9')
  })
})

// ─── WPBL ────────────────────────────────────────────────────────────────────

const teams = [{ id: 'SF' }, { id: 'LA' }] as WpblTeam[]
const game = (id: string, game_date: string): WpblGame =>
  ({ id, game_date, status: 'final', home_team_id: 'SF', away_team_id: 'LA', game_type: 'regular', counts_in_standings: true } as WpblGame)
// Two 2026 games, so the bar is in force (6 PA, 9 outs), and a 2025 game the year cut must leave out.
const games = [game('old', '2025-07-01'), game('g1', '2026-06-01'), game('g2', '2026-06-02')]
const player = (id: string, name: string) => ({ id, name, team_id: 'SF' } as WpblPlayer)
const players = [player('p1', 'Kelsie Whitmore'), player('p2', 'Diana Ibarra'), player('p3', 'Bench Player')]

const bat = (player_id: string, game_id: string, o: Partial<WpblBattingLine>): WpblBattingLine => ({
  game_id, player_id, team_id: 'SF', ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0,
  hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0, ibb: 0, gdp: 0, ...o,
} as WpblBattingLine)
const pit = (player_id: string, game_id: string, o: Partial<WpblPitchingLine>): WpblPitchingLine => ({
  game_id, player_id, team_id: 'SF', outs: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0, ...o,
} as WpblPitchingLine)

const lines: WpblLines = {
  batting: [
    bat('p1', 'old', { ab: 4, h: 4, hr: 5 }),
    bat('p1', 'g1', { ab: 4, h: 2, hr: 1 }), bat('p1', 'g2', { ab: 3, h: 1, hr: 1 }),          // 7 PA, .429, 2 HR
    bat('p2', 'g1', { ab: 4, h: 1, hr: 2, bb: 1 }), bat('p2', 'g2', { ab: 3, h: 0 }),           // 8 PA, .143, 2 HR
    bat('p3', 'g1', { ab: 1, h: 1, hr: 1 }),                                                    // 1 PA: under the bar
  ],
  pitching: [pit('p2', 'g1', { outs: 9, er: 1, so: 5 })],
}
const fmtEra = (v: number | null) => (v == null ? '—' : v.toFixed(2))
const board = (season: number | null): WpblBoard =>
  buildWpblBoard({ season, schedule: games, players, teams, lines, env: null, plays: null, fmtEra, eraBasis: 7 })
const ask = (columns: Record<string, string>, season: number | 'career' | null = null, lean: 'hitting' | 'pitching' | null = null) =>
  ({ columns, lean, season })

describe('WPBL: the answer in the player row', () => {
  it('answers on the current season, cut against the whole schedule', () => {
    expect(wpblPlayerAnswer(players[0], ask({ hitting: 'avg' }), board(2026))).toBe('.429 AVG · 2026')
    expect(wpblPlayerAnswer(players[0], ask({ hitting: 'hr' }), board(2026))).toBe('2 HR · 2026')
  })

  it('answers a typed year, or the career', () => {
    expect(wpblPlayerAnswer(players[0], ask({ hitting: 'hr' }, 2025), board(2025))).toBe('5 HR · 2025')
    expect(wpblPlayerAnswer(players[0], ask({ hitting: 'hr' }, 'career'), board(null))).toBe('7 HR · career')
  })

  it('reads a two-sided word on the side the player has lines on, and on its lean for a two-way player', () => {
    const so = ask({ hitting: 'so', pitching: 'so' }, null, 'pitching')
    expect(wpblPlayerAnswer(players[1], so, board(2026))).toBe('5 SO · 2026')
    expect(wpblPlayerAnswer(players[0], so, board(2026))).toBe('0 SO · 2026')
  })

  it('prints ERA on the reader\'s basis, and answers nothing for a stat the player has no line for', () => {
    expect(wpblPlayerAnswer(players[1], ask({ pitching: 'era' }), board(2026))).toBe('2.33 ERA · 2026')
    expect(wpblPlayerAnswer(players[0], ask({ pitching: 'era' }), board(2026))).toBeNull()
  })
})

describe('WPBL: the leader in the ranking row', () => {
  const lead = (sort: string, side: 'hitting' | 'pitching' = 'hitting', dir: 'asc' | 'desc' | null = null) =>
    wpblLeaderPeek({ side, sort, dir, season: null, career: false }, players, board(2026))

  it('keeps out a player under the bar on every sort, as the table does', () => {
    // Bench Player's 1.000 and the 2025 game's five home runs are both off the board.
    expect(lead('avg')).toEqual({ name: 'Kelsie Whitmore', others: 0, value: '.429' })
  })

  it('breaks a tie toward the bigger sample and says the lead is shared', () => {
    expect(lead('hr')).toEqual({ name: 'Diana Ibarra', others: 1, value: '2' })
  })

  it('follows the order asked for', () => {
    expect(lead('avg', 'hitting', 'asc')).toEqual({ name: 'Diana Ibarra', others: 0, value: '.143' })
    expect(lead('era', 'pitching')).toEqual({ name: 'Diana Ibarra', others: 0, value: '2.33' })
  })

  it("ranks OPS+ against the season's own league, and offers nothing for wRC+ until the run values land", () => {
    expect(lead('opsPlus')).toMatchObject({ name: 'Kelsie Whitmore', others: 0 })
    expect(lead('wrcPlus')).toBeNull()
    expect(wpblPlayerAnswer(players[0], ask({ hitting: 'wrcPlus' }), board(2026))).toBeNull()
  })

  it('ranks WAR with no qualifier, as the Overall side does', () => {
    const value = (war: number, pa: number) => ({ war, pa, outs: 0 } as WpblValueTotals)
    // The bench player's half a win off one trip to the plate tops Overall, where nobody is barred.
    const withWar: WpblBoard = { ...board(2026), value: new Map([['p1', value(0.3, 7)], ['p3', value(0.5, 1)]]) }
    expect(wpblLeaderPeek({ side: 'overall', sort: 'war', dir: null, season: null, career: false }, players, withWar))
      .toEqual({ name: 'Bench Player', others: 0, value: '0.50' })
    expect(wpblPlayerAnswer(players[0], ask({ overall: 'war' }), withWar)).toBe('0.30 WAR · 2026')
    // Without the play log there is no WAR to give.
    expect(wpblPlayerAnswer(players[0], ask({ overall: 'war' }), board(2026))).toBeNull()
  })

  it('reads the play log only for WAR, and the run values only for the columns built on them', () => {
    expect(boardNeeds({ hitting: 'avg' })).toEqual({ weights: false, plays: false })
    expect(boardNeeds({ hitting: 'wrcPlus' })).toEqual({ weights: true, plays: false })
    expect(boardNeeds({ pitching: 'fip' })).toEqual({ weights: true, plays: false })
    expect(boardNeeds({ overall: 'war' })).toEqual({ weights: false, plays: true })
  })
})

// ─── MLB ─────────────────────────────────────────────────────────────────────

const entry = (playerId: number, playerName: string, stat: Record<string, unknown>) =>
  ({ playerId, playerName, teamAbbr: 'SEA', teamId: 136, stat })

describe('MLB: the leader in the ranking row', () => {
  afterEach(() => { vi.mocked(fetchLeaderboardData).mockReset(); vi.mocked(fetchAllTimeLeaderboardData).mockReset() })

  it('qualifies a rate stat and not a count, as the table does', async () => {
    vi.mocked(fetchLeaderboardData).mockResolvedValue([
      entry(1, 'Cal Raleigh', { plateAppearances: 600, avg: '.300', homeRuns: 40 }),
      entry(2, 'Part Timer', { plateAppearances: 100, avg: '.400', homeRuns: 10 }),
      entry(3, 'Julio Rodriguez', { plateAppearances: 590, avg: '.310', homeRuns: 40 }),
    ])
    expect(await mlbLeaderPeek({ side: 'hitting', sort: 'avg', dir: null, season: 2026, career: false }))
      .toEqual({ name: 'Julio Rodriguez', others: 0, value: '.310' })
    expect(await mlbLeaderPeek({ side: 'hitting', sort: 'hr', dir: null, season: 2026, career: false }))
      .toEqual({ name: 'Cal Raleigh', others: 1, value: '40' })
    expect(fetchLeaderboardData).toHaveBeenCalledWith('hitting', 2026)
  })

  it('ranks a career rate on the career Qualified pool only', async () => {
    vi.mocked(fetchAllTimeLeaderboardData).mockResolvedValue([
      { ...entry(1, 'Short Career', { avg: '.400' }), qualified: false },
      { ...entry(2, 'Ty Cobb', { avg: '.366' }), qualified: true },
    ])
    expect(await mlbLeaderPeek({ side: 'hitting', sort: 'avg', dir: null, season: null, career: true }))
      .toEqual({ name: 'Ty Cobb', others: 0, value: '.366' })
  })
})

describe('MLB: the season figures', () => {
  afterEach(() => {
    vi.mocked(fetchLeaderboardData).mockReset(); vi.mocked(fetchSeasonSabermetrics).mockReset(); vi.mocked(fetchParkFactors).mockReset()
  })
  const pool = [
    entry(1, 'Cal Raleigh', { plateAppearances: 600, atBats: 500, hits: 150, totalBases: 300, obp: '.350', slg: '.600' }),
    entry(2, 'Part Timer', { plateAppearances: 100, atBats: 90, hits: 40, totalBases: 120, obp: '.500', slg: '1.333' }),
    entry(3, 'Julio Rodriguez', { plateAppearances: 590, atBats: 500, hits: 150, totalBases: 250, obp: '.340', slg: '.500' }),
  ]

  it('computes a figure the table computes, from the same pool and bar', async () => {
    vi.mocked(fetchLeaderboardData).mockResolvedValue(pool)
    expect(await mlbLeaderPeek({ side: 'hitting', sort: 'iso', dir: null, season: 2026, career: false }))
      .toMatchObject({ name: 'Cal Raleigh', others: 0 })
    // ISO needs neither of the slow reads.
    expect(fetchSeasonSabermetrics).not.toHaveBeenCalled()
    expect(fetchParkFactors).not.toHaveBeenCalled()
  })

  it("reads wRC+ from StatsAPI's sabermetrics, and only for that column", async () => {
    vi.mocked(fetchLeaderboardData).mockResolvedValue(pool)
    vi.mocked(fetchSeasonSabermetrics).mockResolvedValue(new Map([[1, { wrcPlus: 150 }], [2, { wrcPlus: 300 }], [3, { wrcPlus: 160 }]]))
    expect(await mlbLeaderPeek({ side: 'hitting', sort: 'wrcPlus', dir: null, season: 2026, career: false }))
      .toEqual({ name: 'Julio Rodriguez', others: 0, value: '160' })
    expect(fetchSeasonSabermetrics).toHaveBeenCalledWith(2026)
    expect(fetchParkFactors).not.toHaveBeenCalled()
  })

  it('park adjusts OPS+ as the table does, and answers a player off the same board', async () => {
    vi.mocked(fetchLeaderboardData).mockResolvedValue(pool)
    vi.mocked(fetchParkFactors).mockResolvedValue(new Map())
    const raleigh = { id: 1, fullName: 'Cal Raleigh', primaryPosition: { abbreviation: 'C', code: '2' }, active: true }
    const answer = await mlbPlayerAnswer(raleigh, { columns: { hitting: 'opsPlus' }, lean: null, season: 2026 })
    expect(answer).toMatch(/^\d+ OPS\+ · 2026$/)
    expect(fetchParkFactors).toHaveBeenCalledWith(2026)
  })
})

describe('MLB: the answer in the player row', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('reads a traded player\'s whole season, and a pitcher\'s strikeouts as a pitcher\'s', async () => {
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      json: async () => ({ stats: [{ splits: [
        { team: { id: 1 }, stat: { strikeOuts: 100 } },
        { team: { id: 2 }, stat: { strikeOuts: 50 } },
        { stat: { strikeOuts: 150 } },
      ] }] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const pitcher = { id: 7001, fullName: 'Logan Gilbert', primaryPosition: { abbreviation: 'P', code: '1' }, active: true }
    const so = { columns: { hitting: 'k', pitching: 'k' }, lean: 'pitching' as const, season: 2025 }
    expect(await mlbPlayerAnswer(pitcher, so)).toBe('150 SO · 2025')
    expect(fetchMock.mock.calls[0][0]).toContain('/people/7001/stats?stats=season&season=2025&group=pitching')
  })
})

// ─── The palette ─────────────────────────────────────────────────────────────

const row = (key: string, title: string): SearchResultRow =>
  ({ key, title, subtitle: 'CF · SF', avatar: { fallbackText: title[0] }, onSelect: vi.fn() })

function Host({ results = [], resolveLeader, resolvePlayerStat }: {
  results?: SearchResultRow[]
  resolveLeader?: SearchBridgeState['resolveLeader']
  resolvePlayerStat?: SearchBridgeState['resolvePlayerStat']
}) {
  return <CommandPalette open onClose={() => {}} section="wpbl" results={results} idle={[]} searching={false}
    resolveLeader={resolveLeader} resolvePlayerStat={resolvePlayerStat} />
}

describe('the palette', () => {
  afterEach(() => { cleanup(); localStorage.clear() })

  it('puts the answer in front of the player row\'s subtitle', async () => {
    const user = userEvent.setup()
    const resolvePlayerStat = vi.fn(async () => '.429 AVG · 2026')
    render(<Host results={[row('player-p1', 'Kelsie Whitmore'), row('team-SF', 'San Francisco')]} resolvePlayerStat={resolvePlayerStat} />)
    await user.type(screen.getByRole('combobox'), 'whitmore avg')
    // A beat after the last key, as the compare row asks.
    await waitFor(() => expect(screen.getByRole('option', { name: /Kelsie Whitmore/ })).toHaveTextContent('.429 AVG · 2026 · CF · SF'))
    // Only player rows are asked, and with the table's column on each side the word means.
    expect(resolvePlayerStat).toHaveBeenCalledWith('player-p1', { columns: { hitting: 'avg' }, lean: null, season: null })
    expect(resolvePlayerStat.mock.calls.every(c => (c as unknown[])[0] === 'player-p1')).toBe(true)
  })

  it('names the leader in a ranking row, and keeps the name out of Recent, where it would go stale', async () => {
    const user = userEvent.setup()
    const resolveLeader = vi.fn(async () => ({ name: 'Kelsie Whitmore', others: 0, value: '9' }))
    render(<Host resolveLeader={resolveLeader} />)
    await user.type(screen.getByRole('combobox'), 'most hr')
    // "hr" is a hitting board and a pitching one ("home runs allowed"); the hitting one comes first.
    await waitFor(() => expect(screen.getAllByRole('option')[0]).toHaveTextContent('Most home runsLeaders · Kelsie Whitmore leads with 9 · Hitting · this season'))
    expect(resolveLeader).toHaveBeenCalledWith({ side: 'hitting', sort: 'hr', dir: 'desc', season: null, career: false })

    await user.keyboard('{Enter}')
    expect(getRecentQuestions('wpbl')[0]).toMatchObject({ title: 'Most home runs', subtitle: 'Leaders · Hitting · this season' })
  })
})

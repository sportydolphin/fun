import { describe, it, expect } from 'vitest'
import { computeStandings } from '../api'
import { buildBracket } from '../derive/bracket'
import {
  pythagenpat, log5, seriesWinProb, postseasonOdds, fmtOdds, HOME_EDGE,
  matchupProb, regularH2H, REGRESSION_GAMES,
} from '../derive/seriesOdds'
import type { WpblGame, WpblTeam } from '../types'

const TEAMS: WpblTeam[] = (['SF', 'LA', 'NY', 'BOS'] as const).map((id, i) => ({
  id, city: id, name: id, abbr: id, color: null, color_secondary: null,
  logo_url: null, sort_order: i, api_id: null, created_at: '',
}))

let seq = 0
const game = (over: Partial<WpblGame> = {}): WpblGame => ({
  id: `g${seq++}`,
  game_date: '2026-08-01', start_time: '6:30 PM',
  home_team_id: 'SF', away_team_id: 'LA',
  venue: null, status: 'final',
  home_score: 5, away_score: 2, innings: 7, notes: null,
  created_at: '', updated_at: '',
  game_type: 'regular', counts_in_standings: true,
  ...over,
})

// A regular-season win by `w` over `l`, with a lopsided score so run differential separates
// the clubs cleanly (the rating reads runs, not just wins).
const win = (w: string, l: string, date: string): WpblGame =>
  game({ game_date: date, home_team_id: w, away_team_id: l, home_score: 8, away_score: 1 })

const post = (w: string, l: string, type: string): WpblGame =>
  game({ home_team_id: w, away_team_id: l, home_score: 5, away_score: 3, game_type: type, counts_in_standings: false })

/** SF 1st, LA 2nd, NY 3rd, BOS 4th, with a real run environment behind the ratings. */
function season(): WpblGame[] {
  let d = 0
  const date = () => `2026-08-${String(++d % 27 + 1).padStart(2, '0')}`
  return [
    win('SF', 'BOS', date()), win('SF', 'NY', date()), win('SF', 'LA', date()), win('SF', 'BOS', date()),
    win('LA', 'BOS', date()), win('LA', 'NY', date()), win('LA', 'BOS', date()),
    win('NY', 'BOS', date()), win('NY', 'BOS', date()),
    win('BOS', 'NY', date()),
  ]
}

const oddsFor = (games: WpblGame[]) => {
  const rows = computeStandings(TEAMS, games)
  const bracket = buildBracket(rows, games)!
  return { rows, bracket, odds: postseasonOdds(bracket, rows, games)! }
}

describe('seriesOdds math', () => {
  it('pythagenpat rewards run differential and is symmetric around .5', () => {
    expect(pythagenpat(100, 100, 10)).toBeCloseTo(0.5, 6)
    expect(pythagenpat(150, 100, 10)).toBeGreaterThan(0.5)
    expect(pythagenpat(100, 150, 10)).toBeLessThan(0.5)
    // No games / no runs is a coin flip rather than a divide-by-zero.
    expect(pythagenpat(0, 0, 0)).toBe(0.5)
  })

  it('log5 is a coin flip between equals and favours the stronger club', () => {
    expect(log5(0.6, 0.6)).toBeCloseTo(0.5, 6)
    expect(log5(0.7, 0.4)).toBeGreaterThan(0.5)
    expect(log5(0.4, 0.7)).toBeLessThan(0.5)
  })

  it('seriesWinProb: certain when clinched or eliminated, and a fair best-of-1 is the game odds', () => {
    expect(seriesWinProb(0, 2, 0.3)).toBe(1)   // already has the wins it needs
    expect(seriesWinProb(2, 0, 0.9)).toBe(0)   // opponent already there
    expect(seriesWinProb(1, 1, 0.65)).toBeCloseTo(0.65, 6)  // one game to win it
    // A best-of-3 sweep-in-progress: needing 1 while up should beat the single-game odds.
    expect(seriesWinProb(1, 2, 0.5)).toBeGreaterThan(0.5)
  })

  it('HOME_EDGE is zero (single hub venue)', () => {
    expect(HOME_EDGE).toBe(0)
  })

  it('matchupProb blends the head-to-head toward the club that won it, regressed by sample size', () => {
    const [A, B] = TEAMS  // SF, LA
    const even = () => 0.5  // identical ratings, so the model alone is a coin flip
    const model = matchupProb(A, B, even, new Map())
    expect(model).toBeCloseTo(0.5, 6)  // no games → pure model

    // A swept B 8-0: the blend favours A, but not all the way, and 8 games weigh n/(n+10).
    const swept = new Map([[[A.id, B.id].sort().join('|'), new Map([[A.id, 8], [B.id, 0]])]])
    const p = matchupProb(A, B, even, swept)
    const w = 8 / (8 + REGRESSION_GAMES)
    expect(p).toBeGreaterThan(0.5)
    expect(p).toBeLessThan(1)
    expect(p).toBeCloseTo(w * 1 + (1 - w) * 0.5, 6)  // exact blend

    // More meetings at the same rate pull harder toward the record.
    const swept16 = new Map([[[A.id, B.id].sort().join('|'), new Map([[A.id, 16], [B.id, 0]])]])
    expect(matchupProb(A, B, even, swept16)).toBeGreaterThan(p)
  })

  it('regularH2H counts only decided regular-season games', () => {
    const games = [
      game({ home_team_id: 'SF', away_team_id: 'LA', home_score: 5, away_score: 2 }),
      game({ home_team_id: 'LA', away_team_id: 'SF', home_score: 9, away_score: 1 }),
      game({ home_team_id: 'SF', away_team_id: 'LA', home_score: 3, away_score: 3 }), // tie: ignored
      game({ home_team_id: 'SF', away_team_id: 'LA', home_score: 7, away_score: 4, counts_in_standings: false }), // postseason: ignored
      game({ home_team_id: 'SF', away_team_id: 'LA', status: 'scheduled', home_score: null, away_score: null }),
    ]
    const h2h = regularH2H(games)
    const pair = h2h.get(['SF', 'LA'].sort().join('|'))!
    expect(pair.get('SF')).toBe(1)
    expect(pair.get('LA')).toBe(1)
  })

  it('fmtOdds guards the tails so a live chance never reads as impossible or certain', () => {
    expect(fmtOdds(0.74)).toBe('74%')
    expect(fmtOdds(0.004)).toBe('<1%')
    expect(fmtOdds(0.999)).toBe('>99%')
    expect(fmtOdds(0)).toBe('0%')
    expect(fmtOdds(1)).toBe('100%')
  })
})

describe('postseasonOdds (projection, before any postseason game)', () => {
  it('gives every club a title chance summing to ~1', () => {
    const { odds } = oddsFor(season())
    expect(odds.title).toHaveLength(4)
    const total = odds.title.reduce((s, t) => s + t.p, 0)
    expect(total).toBeCloseTo(1, 5)
    for (const t of odds.title) expect(t.p).toBeGreaterThan(0)
  })

  it('ranks the top seed / strongest club ahead of the bottom one', () => {
    const { odds } = oddsFor(season())
    const sf = odds.title.find(t => t.team.id === 'SF')!
    const bos = odds.title.find(t => t.team.id === 'BOS')!
    expect(sf.p).toBeGreaterThan(bos.p)
    // Sorted highest-first.
    expect(odds.title[0].p).toBeGreaterThanOrEqual(odds.title[odds.title.length - 1].p)
  })

  it('a projected semifinal has live odds and no elimination flag yet', () => {
    const { odds } = oddsFor(season())
    const s = odds.semifinals[0]
    expect(s.homeWinP).toBeGreaterThan(0)
    expect(s.homeWinP).toBeLessThan(1)
    expect(s.homeWinP + s.awayWinP).toBeCloseTo(1, 6)
    expect(s.eliminationFor).toBeNull()
    expect(s.clinchFor).toBeNull()
  })
})

describe('postseasonOdds (postseason under way)', () => {
  // SF (1) beats BOS (4) once in Semifinal A: SF now leads 1-0 in a best-of-3, so one win from
  // clinching and BOS one loss from elimination.
  it('flags clinch and elimination on a 1-0 best-of-3, and shifts the leader up', () => {
    const games = [...season(), post('SF', 'BOS', 'Semifinal A')]
    const { odds } = oddsFor(games)
    const semiA = odds.semifinals.find(s => s.clinchFor || s.eliminationFor)!
    expect(semiA.clinchFor?.id).toBe('SF')
    expect(semiA.eliminationFor?.id).toBe('BOS')
    expect(semiA.homeWinP).toBeGreaterThan(0.5)
  })

  // Both semifinals decided: the two finalists carry all the title probability, the two losers
  // none, and the championship odds are read off the (still 0-0) final.
  it('once both finals slots are set, only the two finalists have title odds', () => {
    const games = [
      ...season(),
      post('SF', 'BOS', 'Semifinal A'), post('SF', 'BOS', 'Semifinal A'), // SF sweeps 4
      post('LA', 'NY', 'Semifinal B'), post('LA', 'NY', 'Semifinal B'),   // LA sweeps 3
    ]
    const { odds } = oddsFor(games)
    expect(odds.championship).not.toBeNull()
    const withOdds = odds.title.filter(t => t.p > 0).map(t => t.team.id).sort()
    expect(withOdds).toEqual(['LA', 'SF'])
    const total = odds.title.reduce((s, t) => s + t.p, 0)
    expect(total).toBeCloseTo(1, 5)
  })

  it('a champion takes 100% of the title odds', () => {
    const games = [
      ...season(),
      post('SF', 'BOS', 'Semifinal A'), post('SF', 'BOS', 'Semifinal A'),
      post('LA', 'NY', 'Semifinal B'), post('LA', 'NY', 'Semifinal B'),
      post('SF', 'LA', 'Championship'), post('SF', 'LA', 'Championship'), post('SF', 'LA', 'Championship'),
    ]
    const { odds } = oddsFor(games)
    const sf = odds.title.find(t => t.team.id === 'SF')!
    expect(sf.p).toBe(1)
    expect(odds.championship!.homeWinP).toBe(1)
  })
})

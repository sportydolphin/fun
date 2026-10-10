import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { WpblGame, WpblTeam, WpblBattingLine, WpblPlayer } from '../types'

// What the season board says about its rows beyond the numbers in them: which column it opens
// on, which places are shared, where the league sits, and who is under the qualifying bar.
//
// Each of these is invisible to `tsc` and reads as plausible when wrong. A board opening on AVG
// looks like a board; 8, 9, 10 for three hitters at .400 looks like a ranking; a faded row with
// nothing saying why looks like a rendering glitch.

vi.mock('@mui/material', async (importOriginal) => ({
  ...await importOriginal<typeof import('@mui/material')>(),
  useMediaQuery: () => PHONE,
}))

vi.mock('../../AuthContext', () => ({
  useAuth: () => ({ user: null, openAuthDialog: () => {} }),
}))

vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  fetchWpblAllPlayers: () => Promise.resolve(PLAYERS),
  fetchWpblAllLines: () => Promise.resolve({ batting: LINES, pitching: [] }),
  fetchWpblTrackedGameCount: () => Promise.resolve(0),
  getCachedWpblAllPlayers: () => PLAYERS,
  getCachedWpblAllLines: () => ({ batting: LINES, pitching: [] }),
  wpblStatsCacheAgeMs: () => 0,
  fetchWpblAllRunValuePlays: () => Promise.resolve([]),
  getCachedWpblAllRunValuePlays: () => null,
}))

// Flipped per test: the phone's table folds the league into its headers and hides the site footer.
let PHONE = false

const { default: StatsView } = await import('../StatsView')

const TEAMS: WpblTeam[] = (['SF', 'BOS'] as const).map((id, i) => ({
  id, city: id, name: id, abbr: id, color: null, color_secondary: null,
  logo_url: null, sort_order: i, api_id: null, created_at: '',
} as WpblTeam))

const game = (id: string): WpblGame => ({
  id, game_date: '2026-08-01', start_time: '6:30 PM',
  home_team_id: 'SF', away_team_id: 'BOS', venue: null, status: 'final',
  home_score: 5, away_score: 2, innings: 7, notes: null, created_at: '', updated_at: '',
  game_type: 'regular', counts_in_standings: true,
} as WpblGame)

const player = (id: string, name: string, team: string): WpblPlayer =>
  ({ id, name, team_id: team, position: 'CF' } as WpblPlayer)

const bat = (gameId: string, pid: string, team: string, ab: number, h: number): WpblBattingLine => ({
  id: `${gameId}-${pid}`, game_id: gameId, player_id: pid, team_id: team,
  batting_order: 1, position: 'CF', ab, r: 0, h, doubles: 0, triples: 0, hr: 0,
  rbi: 0, bb: 0, so: 0, hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0, ibb: 0, gdp: 0, tb: h, lob: 0,
} as WpblBattingLine)

// Three games puts the bar at 7 PA (2.4 a team game, floored at 6). Two hitters with identical
// seasons, 12 PA each, tie; a third with 3 PA is under the bar.
const GAMES = ['g1', 'g2', 'g3'].map(game)
const PLAYERS = [player('a', 'Alex Able', 'SF'), player('b', 'Bea Baker', 'BOS'), player('c', 'Cam Cole', 'SF')]
const LINES = [
  ...GAMES.flatMap(g => [bat(g.id, 'a', 'SF', 4, 2), bat(g.id, 'b', 'BOS', 4, 2)]),
  bat('g1', 'c', 'SF', 3, 0),
]

// On the Players board, which is the one these rows are on: a bare /wpbl/stats opens Leaders.
const draw = () => {
  window.history.replaceState({}, '', '/wpbl/stats?board=players')
  return render(
    <StatsView teams={TEAMS} games={GAMES} focus={{ group: 'hitting', token: 0 }} onOpenPlayer={() => {}} />
  )
}
const bodyRows = () => Array.from(document.querySelectorAll('tbody tr'))

describe('the season board rows', () => {
  it('opens the hitting board on OPS', async () => {
    draw()
    await screen.findByText('Hitting')
    expect(document.querySelector('th[data-active="true"]')?.textContent).toMatch(/^OPS/)
  })

  it('comes back to OPS from the pitching side, the same column it opened on', async () => {
    draw()
    fireEvent.click(await screen.findByText('Pitching'))
    fireEvent.click(screen.getByText('Hitting'))
    expect(document.querySelector('th[data-active="true"]')?.textContent).toMatch(/^OPS/)
  })

  it('marks a shared place as a tie', async () => {
    draw()
    await screen.findByText('Hitting')
    const ranks = bodyRows().map(r => r.querySelector('th p')?.textContent)
    expect(ranks).toEqual(['T-1', 'T-1'])
  })

  // AVG .444: 12 hits in 27 at-bats, counting the hitter the qualified filter hides, since the
  // baseline is the whole league whatever the board is showing.
  it('carries the league in the headers, rates only', async () => {
    draw()
    await screen.findByText('Hitting')
    expect(document.querySelector('tbody tr[data-league-row]')).toBeNull()
    const ths = Array.from(document.querySelectorAll('thead th'))
    const league = (label: string) => ths.find(t => t.textContent?.startsWith(label))?.querySelector('[data-league-head]')?.textContent
    expect(league('AVG')).toBe('.444')
    expect(league('HR')).toBe('')
  })

  it('fades a hitter under the bar when showing everyone, and says what the bar is', async () => {
    draw()
    await screen.findByText('Hitting')
    expect(bodyRows()).toHaveLength(2)
    fireEvent.click(screen.getByText('✓ Qualified'))
    const faded = bodyRows().filter(r => r.hasAttribute('data-faded'))
    expect(faded).toHaveLength(1)
    expect(faded[0].textContent).toContain('Cam Cole')
    expect(document.querySelector('[data-board-foot]')?.textContent).toContain('faded: under 7 PA')
  })
})

// THE PHONE'S FULL TABLE IS CAPPED TO THE SCREEN, so everything on it that is not a player row is
// a player row it cannot show. At 390x664 it showed four; these are what took it to fourteen.
describe('the season board on a phone, as a full table', () => {
  beforeEach(() => {
    PHONE = true
    localStorage.setItem('wpbl_stats_full_table', '1')
  })
  afterEach(() => {
    PHONE = false
    localStorage.removeItem('wpbl_stats_full_table')
    document.documentElement.removeAttribute('data-wpbl-stats-table')
  })

  it('carries the league in the headers, not in a row of its own', async () => {
    draw()
    await screen.findByText('Hitting')
    expect(document.querySelector('tbody tr[data-league-row]')).toBeNull()
    const heads = Array.from(document.querySelectorAll('thead [data-league-head]')).map(e => e.textContent)
    expect(heads[0]).toBe('League avg')
    expect(heads).toContain('.444')
  })

  it('puts the count in the first heading and leaves a default footer without words', async () => {
    draw()
    await screen.findByText('Hitting')
    expect(document.querySelector('thead th')?.textContent).toMatch(/^2 players/)
    expect(document.querySelector('[data-board-foot] p')).toBeNull()
  })

  it('drops the position line under each name', async () => {
    draw()
    await screen.findByText('Hitting')
    expect(bodyRows()[0].querySelector('th')?.textContent).not.toContain('CF')
  })

  it('asks the site footer to step aside, and takes the request back on the way out', async () => {
    const { unmount } = draw()
    await screen.findByText('Hitting')
    expect(document.documentElement.hasAttribute('data-wpbl-stats-table')).toBe(true)
    unmount()
    expect(document.documentElement.hasAttribute('data-wpbl-stats-table')).toBe(false)
  })
})

describe('the column headings as controls', () => {
  it('sort from the keyboard, say what they stand for, and announce the sort', async () => {
    draw()
    await screen.findByText('Hitting')
    const avg = Array.from(document.querySelectorAll('thead th')).find(h => h.textContent?.startsWith('AVG')) as HTMLElement
    expect(avg.tabIndex).toBe(0)
    expect(avg.title).toBe('Batting average')
    fireEvent.keyDown(avg, { key: 'Enter' })
    const sorted = Array.from(document.querySelectorAll('thead th[aria-sort]'))
    expect(sorted).toHaveLength(1)
    expect(sorted[0].textContent).toMatch(/^AVG/)
    expect(sorted[0].getAttribute('aria-sort')).toBe('descending')
  })
})

// Four rows never meet the cap, so there is nothing to make room for, and hiding the footer there
// only left a blank band above the nav.
describe('the teams board on a phone', () => {
  beforeEach(() => { PHONE = true; localStorage.setItem('wpbl_stats_full_table', '1') })
  afterEach(() => { PHONE = false; localStorage.removeItem('wpbl_stats_full_table') })

  it('leaves the site footer alone', async () => {
    render(<StatsView teams={TEAMS} games={GAMES} focus={{ group: 'hitting', mode: 'teams', token: 1 }} onOpenPlayer={() => {}} />)
    await screen.findByText('Hitting')
    expect(document.documentElement.hasAttribute('data-wpbl-stats-table')).toBe(false)
  })
})

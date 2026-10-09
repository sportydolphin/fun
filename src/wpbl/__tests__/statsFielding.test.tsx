import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { WpblGame, WpblTeam, WpblBattingLine, WpblPitchingLine, WpblFieldingLine, WpblPlayer } from '../types'

// The Fielding board: the season table over the fielding lines. The trap it pins: the feed writes a fielding line only
// for a game in which the player recorded something, so a fielder's G counted off fielding lines
// reads short by every quiet night, and the games bar for a fielding title would quietly drop
// regulars who simply had nothing hit to them.

vi.mock('@mui/material', async (importOriginal) => ({
  ...await importOriginal<typeof import('@mui/material')>(),
  useMediaQuery: () => false,
}))

vi.mock('../../AuthContext', () => ({
  useAuth: () => ({ user: null, openAuthDialog: () => {} }),
}))

vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  fetchWpblAllPlayers: () => Promise.resolve(PLAYERS),
  fetchWpblAllLines: () => Promise.resolve({ batting: BATTING, pitching: PITCHING }),
  fetchWpblAllFielding: () => Promise.resolve(FIELDING),
  fetchWpblTrackedGameCount: () => Promise.resolve(0),
  getCachedWpblAllPlayers: () => PLAYERS,
  getCachedWpblAllLines: () => ({ batting: BATTING, pitching: PITCHING }),
  getCachedWpblAllFielding: () => FIELDING,
  wpblStatsCacheAgeMs: () => 0,
  fetchWpblAllRunValuePlays: () => Promise.resolve([]),
  getCachedWpblAllRunValuePlays: () => null,
}))

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
  ({ id, name, team_id: team, position: 'SS' } as WpblPlayer)

const bat = (gameId: string, pid: string, team: string): WpblBattingLine => ({
  id: `b-${gameId}-${pid}`, game_id: gameId, player_id: pid, team_id: team,
  batting_order: 1, position: 'SS', ab: 4, r: 0, h: 1, doubles: 0, triples: 0, hr: 0,
  rbi: 0, bb: 0, so: 0, hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0, ibb: 0, gdp: 0, tb: 1, lob: 0,
} as WpblBattingLine)

const fld = (gameId: string, pid: string, team: string, o: Partial<WpblFieldingLine>): WpblFieldingLine => ({
  id: `f-${gameId}-${pid}`, game_id: gameId, player_id: pid, team_id: team,
  po: 0, a: 0, e: 0, pb: 0, sba: 0, ci: 0, dp: 0, created_at: '', ...o,
})

// Three games puts the fielding bar at 2 G (two thirds of the team's games).
//   Alex: in the lineup all three nights, a chance in only two of them. G 3, TC 6, .833.
//   Bea:  a chance every night. G 3, TC 6, 1.000.
//   Cam:  one start on the mound, one assist. G 1, under the bar.
const GAMES = ['g1', 'g2', 'g3'].map(game)
const PLAYERS = [player('a', 'Alex Able', 'SF'), player('b', 'Bea Baker', 'BOS'), player('c', 'Cam Cole', 'SF')]
const BATTING = GAMES.flatMap(g => [bat(g.id, 'a', 'SF'), bat(g.id, 'b', 'BOS')])
const PITCHING = [{ id: 'p-g1-c', game_id: 'g1', player_id: 'c', team_id: 'SF' } as WpblPitchingLine]
const FIELDING = [
  fld('g1', 'a', 'SF', { po: 3, e: 1 }),
  fld('g2', 'a', 'SF', { po: 2 }),
  ...GAMES.map(g => fld(g.id, 'b', 'BOS', { po: 2 })),
  fld('g1', 'c', 'SF', { a: 1 }),
]

const draw = () => render(
  <StatsView teams={TEAMS} games={GAMES} focus={{ group: 'hitting', token: 0 }} onOpenPlayer={() => {}} />
)
const bodyRows = () => Array.from(document.querySelectorAll('tbody tr'))
const headers = () => Array.from(document.querySelectorAll('thead th')).map(h => h.textContent ?? '')
/** A row's cell under a heading, read by position so the test does not care about column order. */
const cell = (row: Element, label: string) => {
  const i = headers().findIndex(h => h.startsWith(label))
  return row.children[i]?.textContent
}

describe('the Fielding side', () => {
  it('opens on fielding percentage, best first, with no Standard/Advanced switch', async () => {
    draw()
    fireEvent.click(await screen.findByText('Fielding'))
    expect(document.querySelector('th[data-active="true"]')?.textContent).toMatch(/^FPCT/)
    expect(bodyRows().map(r => r.querySelector('th')?.textContent)).toEqual([
      expect.stringContaining('Baker'), expect.stringContaining('Able'),
    ])
    expect(screen.queryByText('Advanced')).toBeNull()
  })

  it('counts games played off every line, not games with a chance in them', async () => {
    draw()
    fireEvent.click(await screen.findByText('Fielding'))
    const alex = bodyRows().find(r => r.textContent?.includes('Able'))!
    expect(cell(alex, 'G')).toBe('3')
    expect(cell(alex, 'TC')).toBe('6')
    expect(cell(alex, 'FPCT')).toBe('.833')
  })

  it('fades a fielder under the games bar and says what the bar is', async () => {
    draw()
    fireEvent.click(await screen.findByText('Fielding'))
    expect(bodyRows()).toHaveLength(2)
    fireEvent.click(screen.getByText('✓ Qualified'))
    const faded = bodyRows().filter(r => r.hasAttribute('data-faded'))
    expect(faded).toHaveLength(1)
    expect(faded[0].textContent).toContain('Cam Cole')
    expect(document.querySelector('[data-board-foot]')?.textContent).toContain('faded: under 2 G')
  })

  it('hides the Hitting/Pitching switch, and leaving returns to the side the reader had', async () => {
    draw()
    fireEvent.click(await screen.findByText('Pitching'))
    fireEvent.click(screen.getByText('Fielding'))
    expect(screen.queryByText('Hitting')).toBeNull()
    expect(screen.queryByText('Pitching')).toBeNull()
    fireEvent.click(screen.getByText('Players'))
    expect(screen.getByText('Pitching').getAttribute('aria-pressed')).toBe('true')
  })

  it('is a board in the address bar, so a pasted link opens it', async () => {
    window.history.replaceState(null, '', '/wpbl/stats')
    draw()
    fireEvent.click(await screen.findByText('Fielding'))
    expect(window.location.search).toBe('?board=fielding')
    window.history.replaceState(null, '', '/')
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { WpblGame, WpblTeam, WpblBattingLine } from '../types'

// THE TEAM ROW COMPUTES TWO OF ITS OWN FIGURES, AND THEY LEAKED.
//
// `sumBatting` and `sumPitching` take the schedule and the scope as REQUIRED arguments exactly
// so a season total cannot quietly include the postseason, and they did their job. The two
// numbers the teams branch works out for itself did not: the set of game ids came off the
// unfiltered lines, so a club's G counted its playoff games and its LOB added their runners on,
// on every scope including Regular season.
//
// Nothing about that reads as wrong at a glance, which is why it shipped: twenty filtered
// columns and two unfiltered ones in the same row. On the real 2026 season it put G at 17 in a
// fifteen-game schedule, in a row whose own W and L added to 15.
//
// LOB is the one that cannot be caught any other way. It is not summed from the player lines
// (the feed never fills those in), it is read off the GAME row, so it is the one column on the
// board that does not pass through a scoped helper at all.

vi.mock('@mui/material', async (importOriginal) => ({
  ...await importOriginal<typeof import('@mui/material')>(),
  useMediaQuery: () => false,   // desktop: the full grid, so every column is on screen
}))

vi.mock('../../AuthContext', () => ({
  useAuth: () => ({ user: null, openAuthDialog: () => {} }),
}))

// The board fetches its own players and lines, so the fixtures go in through the cache the
// component seeds from rather than through props.
vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  fetchWpblAllPlayers: () => Promise.resolve([]),
  fetchWpblAllLines: () => Promise.resolve({ batting: LINES, pitching: [] }),
  fetchWpblTrackedGameCount: () => Promise.resolve(0),
  getCachedWpblAllPlayers: () => [],
  getCachedWpblAllLines: () => ({ batting: LINES, pitching: [] }),
  wpblStatsCacheAgeMs: () => 0,
}))

const { default: StatsView } = await import('../StatsView')

const TEAMS: WpblTeam[] = (['SF', 'BOS'] as const).map((id, i) => ({
  id, city: id, name: id, abbr: id, color: null, color_secondary: null,
  logo_url: null, sort_order: i, api_id: null, created_at: '',
} as WpblTeam))

/** One game, with a LOB on each side so the column has something to add up. */
const game = (id: string, postseason: boolean): WpblGame => ({
  id, game_date: '2026-08-01', start_time: '6:30 PM',
  home_team_id: 'SF', away_team_id: 'BOS', venue: null, status: 'final',
  home_score: 5, away_score: 2, innings: 7, notes: null, created_at: '', updated_at: '',
  // The trap the section keeps re-learning: the feed sends counts_in_standings TRUE on
  // postseason rows, so game_type is the only thing holding them out.
  game_type: postseason ? 'postSeason' : 'regular', counts_in_standings: true,
  home_lob: 7, away_lob: 3,
} as WpblGame)

const bat = (gameId: string, teamId: string): WpblBattingLine => ({
  id: `${gameId}-${teamId}`, game_id: gameId, player_id: `p-${teamId}`, team_id: teamId,
  batting_order: 1, position: 'CF', ab: 4, r: 1, h: 2, doubles: 0, triples: 0, hr: 0,
  rbi: 1, bb: 0, so: 1, hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0, ibb: 0, gdp: 0, tb: 2, lob: 0,
} as WpblBattingLine)

const GAMES = [game('r1', false), game('r2', false), game('p1', true)]
const LINES = GAMES.flatMap(g => [bat(g.id, 'SF'), bat(g.id, 'BOS')])

function draw() {
  // `focus` seeds the axes; 'hitting' is the season board, which is the one with the teams
  // view on it.
  return render(
    <StatsView teams={TEAMS} games={GAMES} focus={{ group: 'hitting', token: 1 }} onOpenPlayer={() => {}} />
  )
}

/** Switch to the Teams board, which is a control rather than a prop. */
async function showTeams() {
  const tab = (await screen.findAllByText('Teams')).find(e => e.closest('[role="button"]') || e.parentElement)
  const target = tab?.closest('[role="button"]') ?? tab?.parentElement
  ;(target as HTMLElement | null)?.click()
}

/** The cells of the row whose first cell names `team`. */
function rowCells(team: string): string[] {
  const tr = Array.from(document.querySelectorAll('tbody tr'))
    .find(r => (r.textContent ?? '').includes(team))
  return Array.from(tr?.querySelectorAll('td') ?? []).map(td => (td.textContent ?? '').trim())
}

describe('the teams board under the season scope', () => {
  it('counts only regular-season games in G, and only their runners in LOB', async () => {
    draw()
    // The Teams board first: the players board has no players in these fixtures, so it has no
    // table to wait for.
    await showTeams()
    await screen.findByRole('table')
    // Two regular games and one playoff game, all three carrying a LOB. The default scope is
    // the regular season, so the honest answers are 2 games and the two regular LOBs: SF is
    // home in all three, so 7 + 7 rather than 7 + 7 + 7.
    const cells = rowCells('SF')
    expect(cells).not.toHaveLength(0)
    // G is the loud one: it sat one clear of W + L on the real board.
    expect(cells).toContain('2')
    expect(cells).toContain('14')
    // And the playoff game's runners are nowhere in the row.
    expect(cells).not.toContain('21')
    expect(cells).not.toContain('3')
  })
})

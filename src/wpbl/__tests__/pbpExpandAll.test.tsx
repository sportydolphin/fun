import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WpblGame, WpblGamePlay, WpblPitchingLine, WpblPlayer, WpblTeam } from '../types'

// Half-innings open one at a time, which is right for a reader after one at-bat and fourteen
// clicks for a reader who wants the log. What is pinned here is the one control that opens them
// all, and the part of it that makes it worth having: it is REMEMBERED, so the next game opens
// the way the last one was left.

const NY = { id: 'NY', abbr: 'NY', name: 'Heights' } as WpblTeam
const LA = { id: 'LA', abbr: 'LA', name: 'Queens' } as WpblTeam

const GAME = {
  id: 'g1', game_date: '2026-09-03', start_time: null,
  home_team_id: 'LA', away_team_id: 'NY', venue: null,
  status: 'final', home_score: 1, away_score: 2, innings: 7, notes: null,
  home_line: [{ inning: 1, runs: 1 }], away_line: [{ inning: 1, runs: 2 }],
} as WpblGame

const play = (over: Partial<WpblGamePlay>): WpblGamePlay => ({
  id: `p${over.sequence}`, game_id: 'g1', sequence: 1, inning: 1, half: 'top',
  team_id: 'NY', batter_name: null, batter_id: null, pitcher_name: null, pitcher_id: null,
  outs: 0, first_base: null, second_base: null, third_base: null, bases_loaded: false,
  narrative: '', event_type: null, is_hit: false, is_scoring_play: false, runs_scored: 0,
  pitch_sequence: null, balls: 0, strikes: 0,
  ...over,
} as WpblGamePlay)

const PLAYS: WpblGamePlay[] = [
  play({ sequence: 1, inning: 1, half: 'top', batter_name: 'Ada Vance', narrative: 'Ada Vance singled to left field.' }),
  play({ sequence: 2, inning: 1, half: 'bottom', team_id: 'LA', batter_name: 'Noor Haddad', narrative: 'Noor Haddad doubled to right center.' }),
]

const LINE = {
  id: 'l1', game_id: 'g1', player_id: 'x', team_id: 'NY',
  outs: 21, bf: 28, h: 5, r: 1, er: 1, bb: 1, so: 6, hr: 0, pitches: 92,
  decision: 'W', gs: 1, hbp: 0, ibb: 0, wp: 0, bk: 0, strikes: 60, doubles: 0, triples: 0,
} as WpblPitchingLine

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchWpblAllPlayers: () => Promise.resolve([] as WpblPlayer[]),
    fetchWpblRoster: () => Promise.resolve([] as WpblPlayer[]),
    // A line of some kind, or the sheet renders its "no box score" empty state and there are
    // no tabs to click.
    fetchWpblGameLines: () => Promise.resolve({ batting: [], pitching: [LINE] }),
    fetchWpblGamePlays: () => Promise.resolve(PLAYS),
    fetchWpblGameTracking: () => Promise.resolve([]),
    fetchWpblGameDetails: () => Promise.resolve(null),
    fetchWpblGameRevisions: () => Promise.resolve([]),
    fetchWpblGameRecapPlays: () => Promise.resolve([]),
    fetchWpblVideos: () => Promise.resolve([]),
    getCachedWpblVideos: () => [],
    fetchWpblArticles: () => Promise.resolve([]),
    getCachedWpblArticles: () => [],
    fetchWpblAllRunValuePlays: () => Promise.resolve([]),
    getCachedWpblAllRunValuePlays: () => [],
  }
})

const { default: GameDetailModal } = await import('../GameDetail')

/** The play-by-play tab, open. */
async function openPlays() {
  render(<GameDetailModal game={GAME} teams={[NY, LA]} games={[GAME]} onClose={() => {}} />)
  await userEvent.click(await screen.findByText('Play-by-Play'))
  await screen.findByText(/Top 1st/i)
}

beforeEach(() => {
  localStorage.clear()
})

describe('the half-inning headings', () => {
  // The list used to carry only the runs each half produced, which is the delta and never the
  // state: a reader scrolling to the 6th could see that two scored there and not what the score
  // was. Away first, matching the line score above it.
  it('carry the score after each half, and the runs that made it', async () => {
    await openPlays()
    const heading = (t: string) =>
      screen.getByText(new RegExp(`^${t}`)).parentElement!.textContent!.replace(/^▶/, '')
    // NY score 2 in the top of the 1st; LA answer with 1.
    expect(heading('Top 1st')).toBe('Top 1st · NY batting+22–0')
    expect(heading('Bottom 1st')).toBe('Bottom 1st · LA batting+12–1')
  })
})

describe('opening the whole play-by-play at once', () => {
  it('opens every half-inning, and says what it will do next', async () => {
    await openPlays()
    // Collapsed: the headings are there and the plays under them are not.
    expect(screen.queryByText(/singled to left field/)).toBeNull()

    await userEvent.click(screen.getByText('Expand all'))
    expect(screen.getByText(/singled to left field/)).toBeTruthy()
    expect(screen.getByText(/doubled to right center/)).toBeTruthy()

    await userEvent.click(screen.getByText('Collapse all'))
    expect(screen.queryByText(/singled to left field/)).toBeNull()
  })

  // The half that makes it worth having: fourteen half-innings to click is the same nuisance on
  // the next game as on this one.
  it('remembers the choice for the next game', async () => {
    await openPlays()
    await userEvent.click(screen.getByText('Expand all'))
    expect(localStorage.getItem('wpbl_pbp_expand_all')).toBe('1')

    // And turning it off is remembered too, rather than merely closing what is open.
    await userEvent.click(screen.getByText('Collapse all'))
    expect(localStorage.getItem('wpbl_pbp_expand_all')).toBe('0')
  })

  it('opens expanded when that is how it was left', async () => {
    localStorage.setItem('wpbl_pbp_expand_all', '1')
    await openPlays()
    expect(screen.getByText(/singled to left field/)).toBeTruthy()
    expect(screen.getByText('Collapse all')).toBeTruthy()
  })
})

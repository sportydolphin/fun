import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import type { WpblBattingLine, WpblGame, WpblGamePlay, WpblPitchingLine, WpblTeam } from '../types'

// The full-page Game Center (`layout="page"`) in the two states the offseason cannot show: a game
// in progress and a game not yet played. Both were built in October with no such game in the feed
// to open, so this is the only place either has been drawn. What it pins is the arrangement, the
// part a later edit to GameCenterPage can quietly break: Live takes the Recap's place as the lead
// board, the line score is drawn once (in the page header, not again inside Live), and a game with
// no box score is the matchup preview's three boards side by side, with no jump bar leading to
// boards that do not exist.

const SF = { id: 'SF', abbr: 'SF', name: 'Firebells' } as WpblTeam
const LA = { id: 'LA', abbr: 'LA', name: 'Queens' } as WpblTeam
const TEAMS = [SF, LA]

const LIVE = {
  id: 'live1', game_date: '2026-09-20', start_time: null,
  home_team_id: 'SF', away_team_id: 'LA', venue: null,
  status: 'live', home_score: 1, away_score: 2, innings: null, notes: null,
  home_line: [{ inning: 1, runs: 1 }, { inning: 2, runs: 0 }],
  away_line: [{ inning: 1, runs: 0 }, { inning: 2, runs: 2 }, { inning: 3, runs: 0 }],
  updated_at: new Date().toISOString(), source_updated_at: new Date().toISOString(),
  live_state: {
    complete: false, inning: 3, half: 'top', batting_team_id: 'LA', outs: 1, balls: 1, strikes: 2,
    batter_name: 'Ayuri Shimano', pitcher_name: 'Jill Albayati',
    first_base: 'Ashton Lansdell', second_base: '', third_base: '',
    bases_occupied: ['first'], bases_loaded: false, away_runs: 2, home_runs: 1,
  },
} as unknown as WpblGame

const UPCOMING = {
  id: 'next1', game_date: '2027-05-01', start_time: '19:00:00',
  home_team_id: 'SF', away_team_id: 'LA', venue: null,
  status: 'scheduled', home_score: null, away_score: null, innings: null, notes: null,
  home_line: null, away_line: null, live_state: null,
} as unknown as WpblGame

const play = (sequence: number, over: Partial<WpblGamePlay> = {}): WpblGamePlay => ({
  id: `p${sequence}`, game_id: 'live1', sequence, inning: 1, half: 'top', team_id: 'LA',
  batter_name: 'Ayuri Shimano', batter_id: null, pitcher_name: 'Jill Albayati', pitcher_id: null,
  outs: 1, first_base: null, second_base: null, third_base: null, bases_loaded: false,
  narrative: 'Ayuri Shimano grounded out to ss.', event_type: 'out', is_hit: false,
  is_scoring_play: false, runs_scored: 0, pitch_sequence: null, balls: 0, strikes: 0, fouls: 0,
  pitch_events: null,
  ...over,
} as WpblGamePlay)

const PLAYS = [play(1), play(2, { half: 'bottom', team_id: 'SF' }), play(3, { inning: 2 })]

const bat = (player_id: string, team_id: string): WpblBattingLine => ({
  id: `b-${player_id}`, game_id: 'live1', player_id, team_id, ab: 2, r: 0, h: 1, rbi: 0, bb: 0, so: 0,
  hr: 0, doubles: 0, triples: 0, sb: 0, cs: 0, hbp: 0, sh: 0, sf: 0, position: 'SS', batting_order: 1,
} as unknown as WpblBattingLine)

const pitch = (player_id: string, team_id: string): WpblPitchingLine => ({
  id: `p-${player_id}`, game_id: 'live1', player_id, team_id, outs: 6, bf: 9, h: 2, r: 1, er: 1, bb: 0,
  so: 2, hr: 0, pitches: 30, decision: null, gs: 1, hbp: 0, ibb: 0, wp: 0, bk: 0, strikes: 20,
  doubles: 0, triples: 0,
} as WpblPitchingLine)

const LINES: Record<string, { batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }> = {
  live1: {
    batting: [bat('shimano', 'LA'), bat('jorge', 'SF')],
    pitching: [pitch('sato', 'LA'), pitch('albayati', 'SF')],
  },
  next1: { batting: [], pitching: [] },
}

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchWpblAllPlayers: () => Promise.resolve([]),
    fetchWpblRoster: () => Promise.resolve([]),
    fetchWpblGameLines: (id: string) => Promise.resolve(LINES[id] ?? { batting: [], pitching: [] }),
    fetchWpblGamePlays: (id: string) => Promise.resolve(id === 'live1' ? PLAYS : []),
    fetchWpblGameLive: () => Promise.resolve(null),
    fetchWpblGameTracking: () => Promise.resolve([]),
    fetchWpblGameDetails: () => Promise.resolve(null),
    fetchWpblGameRevisions: () => Promise.resolve([]),
    fetchWpblGameRecapPlays: () => Promise.resolve([]),
    fetchWpblVideos: () => Promise.resolve([]),
    getCachedWpblVideos: () => [],
    fetchWpblArticles: () => Promise.resolve([]),
    getCachedWpblArticles: () => [],
    fetchWpblRecaps: () => Promise.resolve([]),
    getCachedWpblRecaps: () => [],
    fetchWpblAllRunValuePlays: () => Promise.resolve([]),
    getCachedWpblAllRunValuePlays: () => [],
  }
})

const { default: GameDetailModal } = await import('../GameDetail')

const page = (game: WpblGame) => render(
  <GameDetailModal layout="page" game={game} teams={TEAMS} games={[game]} onClose={() => {}} />,
)
const sectionIds = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('section[id^="gc-"]')).map(s => s.id)

describe('the full-page Game Center during a game', () => {
  it('leads with Live where a final leads with the Recap, and offers no Recap', async () => {
    const { container } = page(LIVE)
    await waitFor(() => expect(container.querySelector('#gc-live')).not.toBeNull())
    expect(container.querySelector('#gc-recap')).toBeNull()
    // DOM order is the two-column order: the narrative column (Live, then plays) before the
    // numbers column (box score). The one-column reflow is CSS `order`, not the DOM.
    expect(sectionIds(container)).toEqual(['gc-live', 'gc-plays', 'gc-box'])
  })

  it('names Live first in the jump bar, with the score beside it', async () => {
    page(LIVE)
    const nav = await screen.findByRole('navigation', { name: 'Game Center sections' })
    expect(within(nav).getAllByRole('link').map(a => a.textContent)).toEqual(['Live', 'Box score', 'Play-by-play'])
    expect(nav.textContent).toContain('LA 2')
    expect(nav.textContent).toContain('SF 1')
  })

  it('draws the line score once, in the page header, and not again inside Live', async () => {
    const { container } = page(LIVE)
    await waitFor(() => expect(container.querySelector('#gc-live')).not.toBeNull())
    const header = container.querySelector('article')!
    const live = container.querySelector('#gc-live')!
    // The line score's R column header, which only the line score draws.
    const rHeads = (el: Element) => Array.from(el.querySelectorAll('th')).filter(th => th.textContent === 'R').length
    expect(rHeads(header)).toBeGreaterThan(0)
    expect(rHeads(live)).toBe(0)
  })
})

describe('the full-page Game Center before a game', () => {
  it('lays the preview out as three boards at once, with no toggle and no box-score jump bar', async () => {
    const { container } = page(UPCOMING)
    await waitFor(() => expect(container.querySelector('#gc-matchup')).not.toBeNull())
    // The modal pages these behind a Matchup / Leaders / Rosters toggle; the page shows all three,
    // the season bars on the left and the two lists of people on the right.
    expect(sectionIds(container)).toEqual(['gc-matchup', 'gc-leaders', 'gc-rosters'])
    // "Leaders" once, as the board's own heading, and not again as a toggle option above it.
    expect(screen.getAllByText('Leaders')).toHaveLength(1)
    // The jump bar names the boards of a PLAYED game, none of which exist yet.
    expect(screen.queryByRole('navigation', { name: 'Game Center sections' })).toBeNull()
    expect(screen.queryByText('This game has not been played yet')).toBeNull()
  })
})

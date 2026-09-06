import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type {
  WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblTeam,
} from '../types'

// A box score names its players by `player_id` and nothing else, so the map that turns those
// ids into names decides whether a sheet reads at all. Built from the two clubs' CURRENT
// rosters it answers a question about NOW to name somebody who played THEN, and a player whose
// roster row has since moved is simply absent: `nameOf` falls through to '—'.
//
// Live case that produced this: Sep 4, 2026, New York 14 San Francisco 2. Emi Saiki threw six
// innings and took the win, and her roster row had been moved to Los Angeles, so the winning
// pitcher line, the Star of the Game and the pitching table all read "—" beside a blank
// portrait. Nothing was wrong with the box score; the sheet was asking the wrong question.

const SF = { id: 'SF', abbr: 'SF', name: 'Firebells' } as WpblTeam
const NY = { id: 'NY', abbr: 'NY', name: 'Heights' } as WpblTeam
const LA = { id: 'LA', abbr: 'LA', name: 'Queens' } as WpblTeam
const TEAMS = [SF, NY, LA]

const GAME = {
  id: 'g1', game_date: '2026-09-04', start_time: null,
  home_team_id: 'NY', away_team_id: 'SF', venue: null,
  status: 'final', home_score: 14, away_score: 2, innings: 7, notes: null,
  home_line: [{ inning: 1, runs: 14 }], away_line: [{ inning: 1, runs: 2 }],
} as WpblGame

/** She pitched this game for New York. Her roster row says Los Angeles. Both are true: a
 *  roster row means "now", and a box-score line means "then". */
const MOVED_ON: WpblPlayer = {
  id: 'saiki', name: 'Emi Saiki', team_id: 'LA', active: true,
} as WpblPlayer

const STAYED: WpblPlayer = {
  id: 'gilder', name: 'Liz Gilder', team_id: 'SF', active: true,
} as WpblPlayer

const pitch = (over: Partial<WpblPitchingLine>): WpblPitchingLine => ({
  id: `p-${over.player_id}`, game_id: 'g1', player_id: 'x', team_id: 'NY',
  outs: 18, bf: 24, h: 3, r: 2, er: 2, bb: 1, so: 4, hr: 0, pitches: 76,
  decision: null, gs: 1, hbp: 0, ibb: 0, wp: 0, bk: 0, strikes: 50, doubles: 0, triples: 0,
  ...over,
} as WpblPitchingLine)

const lines = {
  batting: [] as WpblBattingLine[],
  pitching: [
    pitch({ player_id: 'saiki', team_id: 'NY', decision: 'W' }),
    pitch({ player_id: 'gilder', team_id: 'SF', decision: 'L', outs: 9, er: 3 }),
  ],
}

// The two club rosters are what the sheet used to be built from, and neither carries her.
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchWpblAllPlayers: () => Promise.resolve([MOVED_ON, STAYED]),
    fetchWpblRoster: (teamId: string) =>
      Promise.resolve(teamId === 'SF' ? [STAYED] : []),
    fetchWpblGameLines: () => Promise.resolve(lines),
    fetchWpblGamePlays: () => Promise.resolve([]),
    fetchWpblGameTracking: () => Promise.resolve([]),
    fetchWpblGameDetails: () => Promise.resolve(null),
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

const open = () => render(
  <GameDetailModal game={GAME} teams={TEAMS} games={[GAME]} onClose={() => {}} />,
)

describe('a box score names everyone who played in it', () => {
  it('names a pitcher whose roster row has moved to a third club', async () => {
    open()
    // She is on neither club's roster today, and she is on this sheet twice: the decision line
    // and the pitching table.
    await waitFor(() => expect(screen.getAllByText('Emi Saiki').length).toBeGreaterThan(0))
    expect(screen.queryByText('—')).toBeNull()
  })

  it('still names the players who did not move', async () => {
    open()
    await waitFor(() => expect(screen.getAllByText('Liz Gilder').length).toBeGreaterThan(0))
  })
})

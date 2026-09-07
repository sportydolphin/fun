import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblTeam,
} from '../types'

// The pitching half of the box score had no totals row while the batting half had always had
// one, so a reader wanting the club's line added it up by eye. That is what this pins, and one
// thing about it in particular:
//
// INNINGS ARE SUMMED AS OUTS. "3.1" is three innings and one out, so 3.1 + 0.2 is 4.0 and not
// 3.3, and nothing in the string says which base it is written in. The fixture below is built
// entirely around that: a naive column sum of the printed values gives 3.3, which looks
// plausible enough to ship.

const SF = { id: 'SF', abbr: 'SF', name: 'Firebells' } as WpblTeam
const NY = { id: 'NY', abbr: 'NY', name: 'Heights' } as WpblTeam
const TEAMS = [SF, NY]

const GAME = {
  id: 'g1', game_date: '2026-09-04', start_time: null,
  home_team_id: 'NY', away_team_id: 'SF', venue: null,
  status: 'final', home_score: 4, away_score: 1, innings: 7, notes: null,
  home_line: [{ inning: 1, runs: 4 }], away_line: [{ inning: 1, runs: 1 }],
} as WpblGame

const STARTER: WpblPlayer = { id: 'starter', name: 'Ada Vance', team_id: 'NY', active: true } as WpblPlayer
const RELIEVER: WpblPlayer = { id: 'reliever', name: 'Noor Haddad', team_id: 'NY', active: true } as WpblPlayer

const pitch = (over: Partial<WpblPitchingLine>): WpblPitchingLine => ({
  id: `p-${over.player_id}`, game_id: 'g1', player_id: 'x', team_id: 'NY',
  outs: 0, bf: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0, pitches: 0,
  decision: null, gs: 0, hbp: 0, ibb: 0, wp: 0, bk: 0, strikes: 0, doubles: 0, triples: 0,
  ...over,
} as WpblPitchingLine)

// Ten outs and two outs: 3.1 + 0.2, which is four innings.
const lines = {
  // Empty on purpose, so the one "Totals" on the sheet is the pitching one.
  batting: [] as WpblBattingLine[],
  pitching: [
    pitch({ player_id: 'starter', team_id: 'NY', outs: 10, h: 6, r: 3, er: 3, bb: 2, so: 4, hr: 1, pitches: 71 }),
    pitch({ player_id: 'reliever', team_id: 'NY', outs: 2, h: 1, r: 0, er: 0, bb: 1, so: 1, hr: 0, pitches: 12 }),
  ],
}

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchWpblAllPlayers: () => Promise.resolve([STARTER, RELIEVER]),
    fetchWpblRoster: () => Promise.resolve([STARTER, RELIEVER]),
    fetchWpblGameLines: () => Promise.resolve(lines),
    fetchWpblGamePlays: () => Promise.resolve([]),
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

/** The sheet, with the Box Score tab open: a final opens on its Recap. */
async function openBoxScore() {
  render(<GameDetailModal game={GAME} teams={TEAMS} games={[GAME]} onClose={() => {}} />)
  const tab = await screen.findByText('Box Score')
  await userEvent.click(tab)
  await waitFor(() => expect(screen.queryByText('Totals')).not.toBeNull())
}

/** The cells of the row the given label starts, as text. */
const rowCells = (label: string): string[] => {
  const row = screen.getByText(label).closest('tr')!
  return Array.from(row.querySelectorAll('td')).map(c => (c.textContent ?? '').trim())
}

describe('the pitching half of a box score adds itself up', () => {
  it('totals the counting stats under the pitchers', async () => {
    await openBoxScore()
    // Totals, IP, then H R ER BB SO HR P.
    expect(rowCells('Totals')).toEqual(['Totals', '4.0', '7', '3', '3', '3', '5', '1', '83'])
  })

  it('sums innings as outs, not as the decimals it prints them in', async () => {
    await openBoxScore()
    // The two pitchers as printed, and the total that a column-wise sum of them cannot give.
    expect(rowCells('Ada Vance')[1]).toBe('3.1')
    expect(rowCells('Noor Haddad')[1]).toBe('0.2')
    expect(rowCells('Totals')[1]).toBe('4.0')
  })
})

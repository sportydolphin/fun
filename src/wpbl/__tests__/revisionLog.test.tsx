import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { WpblGame, WpblGameRevision, WpblPitchingLine, WpblPlayer, WpblTeam } from '../types'

// The scoring changelog at the foot of a recap. What is worth pinning here is not the layout
// but the two things that would be wrong quietly:
//
//   · it is COLLAPSED, because nearly every game in the season has been revised at some point
//     and an expanded block of stat corrections on every recap is chrome, not news; and
//   · a revision the log has no sentence for still renders, saying so, because the date is
//     already on the page above it and silence there reads as a broken feature.

const NY = { id: 'NY', abbr: 'NY', name: 'Heights', city: 'New York' } as WpblTeam
const LA = { id: 'LA', abbr: 'LA', name: 'Queens', city: 'Los Angeles' } as WpblTeam

const GAME = {
  id: 'g1', game_date: '2026-08-01', start_time: null,
  home_team_id: 'NY', away_team_id: 'LA', venue: null,
  status: 'final', home_score: 5, away_score: 4, innings: 7, notes: null,
  home_line: [{ inning: 1, runs: 5 }], away_line: [{ inning: 1, runs: 4 }],
  source_updated_at: '2026-08-24T02:33:01Z',
} as WpblGame

const MACKAY = { id: 'mackay', name: 'Jamie Mackay', team_id: 'LA', active: true } as WpblPlayer

/** One line is enough: the recap panel only renders once the sheet has any. */
const LINE = {
  id: 'l1', game_id: 'g1', player_id: 'mackay', team_id: 'NY',
  outs: 21, bf: 28, h: 5, r: 1, er: 1, bb: 1, so: 6, hr: 0, pitches: 92,
  decision: 'W', gs: 1, hbp: 0, ibb: 0, wp: 0, bk: 0, strikes: 60, doubles: 0, triples: 0,
} as WpblPitchingLine

let revisions: WpblGameRevision[] = []

const revision = (over: Partial<WpblGameRevision> = {}): WpblGameRevision => ({
  id: 'r1', game_id: 'g1', kind: 'league',
  source_updated_at: '2026-08-24T02:33:01Z', prior_source_updated_at: '2026-08-20T02:33:01Z',
  detected_at: '2026-08-24T07:30:00Z',
  changes: [
    { kind: 'batting', player: 'Jamie Mackay', player_id: 'mackay', field: 'h', before: 0, after: 1 },
    { kind: 'game', field: 'home_score', before: 4, after: 5 },
  ],
  change_count: 2,
  ...over,
})

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchWpblAllPlayers: () => Promise.resolve([MACKAY]),
    fetchWpblRoster: () => Promise.resolve([]),
    fetchWpblGameLines: () => Promise.resolve({ batting: [], pitching: [LINE] }),
    fetchWpblGamePlays: () => Promise.resolve([]),
    fetchWpblGameTracking: () => Promise.resolve([]),
    fetchWpblGameDetails: () => Promise.resolve(null),
    fetchWpblGameRevisions: () => Promise.resolve(revisions),
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

/** The rows read "<who> · <what>" across two spans, so a plain text match sees neither half
 *  whole. Matching on the composed text is what the reader actually sees. */
const row = (text: string) =>
  screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === text)

const open = () => render(
  <GameDetailModal game={GAME} teams={[NY, LA]} games={[GAME]} onClose={() => {}} />,
)

describe('the scoring changelog', () => {
  it('summarises without expanding, and expands on a tap', async () => {
    revisions = [revision()]
    open()
    await screen.findByText('Scoring changes')
    expect(screen.getByText(/2 changes the league made/)).toBeTruthy()
    // Collapsed: the changes themselves are not on the page yet.
    expect(screen.queryByText(/Hits/)).toBeNull()

    fireEvent.click(screen.getByText('Scoring changes'))
    await waitFor(() => expect(row('Jamie Mackay · Hits')).toBeTruthy())
    // The player is named, and the club is named rather than the column.
    expect(screen.getAllByText('Jamie Mackay').length).toBeGreaterThan(0)
    expect(screen.getAllByText('New York Heights').length).toBeGreaterThan(0)
    expect(row('New York Heights · Team runs')).toBeTruthy()
  })

  // The league's own day, not the reader's. These stamps land late evening in Springfield,
  // which is the small hours of the next day in UTC, so a second formatter here would date the
  // same revision a day away from the "Box score revised" row directly above it.
  it('dates the revision the same way the game info row does', async () => {
    revisions = [revision()]
    open()
    fireEvent.click(await screen.findByText('Scoring changes'))
    await waitFor(() => expect(screen.getByText('Revised Aug 23')).toBeTruthy())
  })

  it('says so when a revision changed nothing it can describe', async () => {
    revisions = [revision({ changes: [], change_count: 0 })]
    open()
    fireEvent.click(await screen.findByText('Scoring changes'))
    await waitFor(() => expect(
      screen.getByText('The league restamped this game without changing the box score.')).toBeTruthy())
  })

  // A wholesale re-score stores its first eighty changes and counts them all, so the page has
  // to say how much it is not showing rather than quietly reporting the smaller number.
  it('admits what the log did not keep', async () => {
    revisions = [revision({ change_count: 302 })]
    open()
    fireEvent.click(await screen.findByText('Scoring changes'))
    await waitFor(() => expect(screen.getByText(/and 300 more, not stored/)).toBeTruthy())
  })

  it('is absent entirely on a game with no revision on record', async () => {
    revisions = []
    open()
    await screen.findByText('Game info')
    expect(screen.queryByText('Scoring changes')).toBeNull()
  })
})

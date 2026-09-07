import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { WpblGame, WpblTeam } from '../types'

// The pick strip as it is drawn inside the bracket. The arithmetic is pinned in
// seriesPicks.test.ts; what is worth pinning here is the behaviour a pure function cannot
// have an opinion about: that the tally stays hidden until you answer, that a pick reaches the
// writer, and that a series already under way cannot be called after the fact.

const cast = vi.fn(() => Promise.resolve(true))
let ballot: Record<string, string> = {}
let results: Record<string, Record<string, number>> = {}

vi.mock('../awardVotes', () => ({
  awardVoterKey: () => 'test-voter-key',
  fetchWpblAwardBallot: () => Promise.resolve(ballot),
  fetchWpblAwardResults: () => Promise.resolve(results),
  castWpblAwardVote: (...args: unknown[]) => cast(...(args as [])),
}))

const { default: PlayoffBracket } = await import('../PlayoffBracket')
const { computeStandings } = await import('../api')

const TEAMS: WpblTeam[] = (['SF', 'LA', 'NY', 'BOS'] as const).map((id, i) => ({
  id, city: id, name: id, abbr: id, color: null, color_secondary: null,
  logo_url: null, sort_order: i, api_id: null, created_at: '',
} as WpblTeam))

let seq = 0
const game = (over: Partial<WpblGame> = {}): WpblGame => ({
  id: `g${seq++}`, game_date: '2026-08-01', start_time: '6:30 PM',
  home_team_id: 'SF', away_team_id: 'LA', venue: null, status: 'final',
  home_score: 5, away_score: 2, innings: 7, notes: null, created_at: '', updated_at: '',
  game_type: 'regular', counts_in_standings: true, ...over,
} as WpblGame)

const win = (w: string, l: string, date: string): WpblGame =>
  game({ game_date: date, home_team_id: w, away_team_id: l, home_score: 6, away_score: 1 })

/** SF 1st, LA 2nd, NY 3rd, BOS 4th, so semifinal A is SF against BOS. */
function season(): WpblGame[] {
  let d = 0
  const date = () => `2026-08-${String(++d % 28 + 1).padStart(2, '0')}`
  return [
    win('SF', 'BOS', date()), win('SF', 'BOS', date()), win('SF', 'BOS', date()),
    win('LA', 'BOS', date()), win('LA', 'BOS', date()),
    win('NY', 'BOS', date()), win('BOS', 'NY', date()),
    win('LA', 'NY', date()), win('SF', 'NY', date()),
  ]
}

const draw = (games = season()) =>
  render(<PlayoffBracket rows={computeStandings(TEAMS, games)} games={games} />)

beforeEach(() => { cast.mockClear(); ballot = {}; results = {} })

describe('the bracket pick strip', () => {
  it('asks each semifinal by club and by length', async () => {
    draw()
    await waitFor(() => expect(screen.getAllByRole('radio', { name: 'Semifinal A: SF in 2' })).toHaveLength(1))
    for (const name of ['SF in 2', 'SF in 3', 'BOS in 2', 'BOS in 3'].map(n => `Semifinal A: ${n}`)) {
      expect(screen.getByRole('radio', { name })).toBeTruthy()
    }
  })

  // A best-of-five is three lengths, not two. The format is read from derive/series.ts rather
  // than guessed, and this is the assertion that would fail if somebody wrote a literal.
  it('asks the championship in three, four or five', async () => {
    ballot = { 'pickem:2026:semifinal:A': 'SF:2-0', 'pickem:2026:semifinal:B': 'NY:2-1' }
    draw()
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Championship: SF in 5' })).toBeTruthy())
    expect(screen.getByRole('radio', { name: 'Championship: NY in 3' })).toBeTruthy()
    // A best-of-five cannot end 3-0 in two games, so the semifinals' shortest option must not
    // appear here. It is the one assertion that fails if the length is guessed rather than read.
    expect(screen.queryByRole('radio', { name: 'Championship: SF in 2' })).toBeNull()
  })

  // A poll that shows its results first measures how the first fifty voters felt, because
  // everyone after them is answering a different question.
  it('hides the tally until you have answered', async () => {
    results = { 'pickem:2026:semifinal:A': { 'SF:2-0': 9, 'BOS:2-1': 1 } }
    draw()
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Semifinal A: SF in 2' })).toBeTruthy())
    expect(screen.getByRole('radio', { name: 'Semifinal A: SF in 2' }).textContent).toBe('in 2')

    fireEvent.click(screen.getByRole('radio', { name: 'Semifinal A: BOS in 3' }))
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Semifinal A: SF in 2' }).textContent).toContain('%'))
  })

  it('records the pick under the series’ own permanent id', async () => {
    draw()
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Semifinal A: SF in 3' })).toBeTruthy())
    fireEvent.click(screen.getByRole('radio', { name: 'Semifinal A: SF in 3' }))
    expect(cast).toHaveBeenCalledWith('pickem:2026:semifinal:A', 'SF:2-1')
  })

  // The final cannot be asked about before its clubs exist, and the reader's own calls are
  // what supply them. Saying so beats a blank space under the one box with no question in it.
  it('asks for the semifinals before it asks for the final', async () => {
    const { container } = draw()
    await waitFor(() => expect(container.textContent).toContain('Call both semifinals'))
    expect(screen.queryByRole('radio', { name: /in 5$/ })).toBeNull()
  })

  // A prediction made after the first pitch is not a prediction.
  it('locks a series that has started', async () => {
    const started = [...season(), game({
      game_date: '2026-09-09', home_team_id: 'SF', away_team_id: 'BOS',
      home_score: 4, away_score: 2, game_type: 'Semifinal A', counts_in_standings: false,
    })]
    ballot = { 'pickem:2026:semifinal:A': 'SF:2-0' }
    results = { 'pickem:2026:semifinal:A': { 'SF:2-0': 3, 'BOS:2-1': 1 } }
    const { container } = draw(started)
    // Still shown, still counted, no longer answerable: no radio role means no way to change it.
    await waitFor(() => expect(container.textContent).toContain('Fans called it'))
    expect(screen.queryByRole('radio', { name: 'Semifinal A: SF in 2' })).toBeNull()
    expect(cast).not.toHaveBeenCalled()
  })
})

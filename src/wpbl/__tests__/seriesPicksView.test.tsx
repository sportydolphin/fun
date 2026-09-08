import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { WpblGame, WpblTeam } from '../types'

// The pick'em as it is used. The arithmetic is pinned in seriesPicks.test.ts; these are the
// things a pure function cannot have an opinion about, and each is a decision a refactor could
// quietly undo:
//
//   · the bracket card carries ONE control, and no controls at all until it is pressed;
//   · a club and a length are two questions in that order, and a club alone stores nothing;
//   · the tally stays hidden until you have answered;
//   · a series already under way cannot be called after the fact.

const cast = vi.fn(() => Promise.resolve(true))
const clear = vi.fn(() => Promise.resolve(true))
let ballot: Record<string, string> = {}
let results: Record<string, Record<string, number>> = {}

/** Swapped per test: a pick only counts with an account, so the gate is a case of its own. */
let authUser: { id: string } | null = { id: 'test-user' }
const openAuthDialog = vi.fn()

vi.mock('../../AuthContext', () => ({
  useAuth: () => ({ user: authUser, openAuthDialog }),
}))

vi.mock('../awardVotes', () => ({
  awardVoterKey: () => 'test-voter-key',
  fetchWpblAwardBallot: () => Promise.resolve(ballot),
  fetchWpblAwardResults: () => Promise.resolve(results),
  castWpblAwardVote: (...args: unknown[]) => cast(...(args as [])),
  clearWpblAwardVote: (...args: unknown[]) => clear(...(args as [])),
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

/** Press the card's one control and wait for the sheet. */
async function openSheet() {
  fireEvent.click(await screen.findByText(/Make your picks|Finish your picks|Change your picks/))
  await screen.findByText('Call the postseason')
}

const radio = (name: string) => screen.getByRole('radio', { name })
const noRadio = (name: string) => screen.queryByRole('radio', { name })

beforeEach(() => {
  cast.mockClear(); clear.mockClear(); openAuthDialog.mockClear()
  authUser = { id: 'test-user' }; ballot = {}; results = {}
})

// THE HEADER WORDING, because setup.ts answers every media query "no match" and so renders the
// desktop branch (see its comment on why that is deliberate). The button lives beside the card
// title there and says the short form; the full-width body version, with its longer labels and
// its hint line, is the open-phone-card case only. Both are the same control and the same three
// states, which is what these assert: asking, part way, done.
describe('the pick’em button', () => {
  // The card draws a bracket. Twelve permanent controls inside it, paid for by every reader
  // including the ones who never want to predict anything, is what this replaced.
  it('is the only control on the card, and asks nothing until pressed', async () => {
    draw()
    expect(await screen.findByText('Make your picks')).toBeTruthy()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
  })

  it('says how far through you are', async () => {
    ballot = { 'pickem:2026:semifinal:A': 'SF:2-0' }
    const { container } = draw()
    await waitFor(() => expect(container.textContent).toContain('Picks · 1/3'))
  })

  it('drops to a change affordance once everything open has been called', async () => {
    ballot = {
      'pickem:2026:semifinal:A': 'SF:2-0',
      'pickem:2026:semifinal:B': 'NY:2-1',
      'pickem:2026:championship': 'SF:3-2',
    }
    draw()
    expect(await screen.findByText('Your picks')).toBeTruthy()
  })
})

describe('picking a series', () => {
  it('asks for a club before it asks how long', async () => {
    draw()
    await openSheet()
    expect(radio('Semifinal A: SF to win')).toBeTruthy()
    expect(radio('Semifinal A: BOS to win')).toBeTruthy()
    expect(noRadio('Semifinal A: SF in 2')).toBeNull()

    fireEvent.click(radio('Semifinal A: SF to win'))
    expect(radio('Semifinal A: SF in 2')).toBeTruthy()
    expect(radio('Semifinal A: SF in 3')).toBeTruthy()
  })

  // A half-answer is not a prediction, and a "Firebells in ?" in the tally would be a pick
  // nobody made.
  it('stores nothing until the length is chosen', async () => {
    draw()
    await openSheet()
    fireEvent.click(radio('Semifinal A: SF to win'))
    expect(cast).not.toHaveBeenCalled()

    fireEvent.click(radio('Semifinal A: SF in 3'))
    // The account id is the third argument, which is the whole point of the gate: a pick is
    // attributed to a person rather than to a browser.
    expect(cast).toHaveBeenCalledWith('pickem:2026:semifinal:A', 'SF:2-1', 'test-user')
  })

  // A best-of-five is three lengths, not two. The format is read from derive/series.ts, and this
  // is the assertion that fails if somebody writes a literal.
  it('asks the championship in three, four or five', async () => {
    ballot = { 'pickem:2026:semifinal:A': 'SF:2-0', 'pickem:2026:semifinal:B': 'NY:2-1' }
    draw()
    await openSheet()
    fireEvent.click(radio('Championship: SF to win'))
    expect(radio('Championship: SF in 5')).toBeTruthy()
    expect(noRadio('Championship: SF in 2')).toBeNull()
  })

  // The final has no clubs until the semifinals end, and the reader's own calls are what supply
  // them. Saying so beats a blank space where the third question should be.
  it('asks for the semifinals before it will ask for the final', async () => {
    draw()
    await openSheet()
    expect(screen.getByText(/Call both semifinals/)).toBeTruthy()
    expect(noRadio('Championship: SF to win')).toBeNull()
  })

  // A poll that shows its results first measures what the first fifty voters thought, because
  // everyone after them is answering a different question.
  it('hides the tally until you have answered', async () => {
    results = { 'pickem:2026:semifinal:A': { 'SF:2-0': 9, 'BOS:2-1': 1 } }
    draw()
    await openSheet()
    expect(radio('Semifinal A: SF to win').textContent).toBe('SF')

    fireEvent.click(radio('Semifinal A: BOS to win'))
    fireEvent.click(radio('Semifinal A: BOS in 3'))
    await waitFor(() => expect(radio('Semifinal A: SF to win').textContent).toContain('%'))
  })

  // A prediction made after the first pitch is not a prediction.
  it('locks a series that has started', async () => {
    const started = [...season(), game({
      game_date: '2026-09-09', home_team_id: 'SF', away_team_id: 'BOS',
      home_score: 4, away_score: 2, game_type: 'Semifinal A', counts_in_standings: false,
    })]
    ballot = { 'pickem:2026:semifinal:A': 'SF:2-0' }
    draw(started)
    await openSheet()
    expect(screen.getByText(/Under way, so this one is locked/)).toBeTruthy()
    expect(noRadio('Semifinal A: SF to win')).toBeNull()
    expect(cast).not.toHaveBeenCalled()
  })
})

describe('a pick needs an account', () => {
  // These picks get scored and published, so "who picked what" has to survive a cleared
  // cache and follow the reader to a second device. A browser id does neither, and a
  // leaderboard built on one would credit a stranger's phone.
  it('shows the questions to a signed-out reader and takes no answer', async () => {
    authUser = null
    draw()
    await openSheet()
    // The clubs and the format are all there to read.
    expect(screen.getByText(/Semifinal A · best of 3/)).toBeTruthy()
    // The controls are not.
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    expect(screen.getByText('Sign in to make your picks')).toBeTruthy()
  })

  it('sends a signed-out reader to the sign-in dialog', async () => {
    authUser = null
    draw()
    await openSheet()
    fireEvent.click(screen.getByText('Sign in to make your picks'))
    expect(openAuthDialog).toHaveBeenCalled()
  })

  it('offers nothing to clear when there is no account to clear it from', async () => {
    authUser = null
    ballot = { 'pickem:2026:semifinal:A': 'SF:2-0' }
    draw()
    await openSheet()
    expect(screen.queryByText('Clear my picks')).toBeNull()
  })
})

describe('taking picks back', () => {
  // Withdrawing is not the same act as changing, and without it the only way out of a
  // prediction is to leave a wrong one standing.
  it('needs two taps, and only then withdraws', async () => {
    ballot = { 'pickem:2026:semifinal:A': 'SF:2-0', 'pickem:2026:semifinal:B': 'NY:2-1' }
    draw()
    await openSheet()
    fireEvent.click(screen.getByText('Clear my picks'))
    expect(clear).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Tap again to clear all 2'))
    expect(clear).toHaveBeenCalledTimes(2)
    expect(clear).toHaveBeenCalledWith('pickem:2026:semifinal:A', 'test-user')
    expect(clear).toHaveBeenCalledWith('pickem:2026:semifinal:B', 'test-user')
  })

  it('offers nothing to clear when nothing has been picked', async () => {
    draw()
    await openSheet()
    expect(screen.queryByText('Clear my picks')).toBeNull()
  })

  // A locked pick cannot be changed, so it cannot be withdrawn either: what somebody called
  // before first pitch is the whole point of having called it.
  it('leaves a series that has already started alone', async () => {
    const started = [...season(), game({
      game_date: '2026-09-09', home_team_id: 'SF', away_team_id: 'BOS',
      home_score: 4, away_score: 2, game_type: 'Semifinal A', counts_in_standings: false,
    })]
    ballot = { 'pickem:2026:semifinal:A': 'SF:2-0', 'pickem:2026:semifinal:B': 'NY:2-1' }
    draw(started)
    await openSheet()
    fireEvent.click(screen.getByText('Clear my picks'))
    fireEvent.click(screen.getByText('Tap again to clear it'))
    expect(clear).toHaveBeenCalledTimes(1)
    expect(clear).toHaveBeenCalledWith('pickem:2026:semifinal:B', 'test-user')
  })

  it('puts the card back to asking', async () => {
    ballot = { 'pickem:2026:semifinal:A': 'SF:2-0' }
    const { container } = draw()
    await openSheet()
    fireEvent.click(screen.getByText('Clear my picks'))
    fireEvent.click(screen.getByText('Tap again to clear it'))
    fireEvent.click(screen.getByText('Done'))
    await waitFor(() => expect(container.textContent).toContain('Make your picks'))
    expect(container.textContent).not.toContain('Your call')
  })
})

describe('the card afterwards', () => {
  // The receipt. A pick that vanished into a dialog would be one nobody could see they had made.
  it('shows your call on the series box', async () => {
    ballot = { 'pickem:2026:semifinal:A': 'SF:2-1' }
    const { container } = draw()
    await waitFor(() => expect(container.textContent).toContain('Your call'))
    expect(container.textContent).toContain('SF in 3')
  })

  it('marks a call that came in', async () => {
    const played = [...season(),
      game({ game_date: '2026-09-09', home_team_id: 'SF', away_team_id: 'BOS', home_score: 4, away_score: 2, game_type: 'Semifinal A', counts_in_standings: false }),
      game({ game_date: '2026-09-11', home_team_id: 'BOS', away_team_id: 'SF', home_score: 1, away_score: 5, game_type: 'Semifinal A', counts_in_standings: false }),
    ]
    ballot = { 'pickem:2026:semifinal:A': 'SF:2-0' }
    const { container } = draw(played)
    // "Called it" rather than "You called it": the row is tinted, railed and green by then, so
    // the label no longer has to carry the "you" and the two words it saves go to the pick
    // itself, which is what a narrow bracket column is short of.
    await waitFor(() => expect(container.textContent).toContain('Called it'))
  })
})

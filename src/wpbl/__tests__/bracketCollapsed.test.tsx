import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { WpblGame, WpblTeam } from '../types'

// The bracket card as a PHONE gets it: shut.
//
// That default is measured (709px on a 375px screen, arriving at 57% scroll depth) and a
// collapsed SectionCard renders none of its children, so anything in the card body is behind a
// tap on exactly the surface most of this section's traffic is on. The pick'em therefore keeps a
// second, compact control in the header, and this is what stops that being quietly deleted as a
// duplicate: the two are never both in the page, and without the header one the feature is
// invisible until somebody opens a card they have no reason to open.

vi.mock('@mui/material', async (importOriginal) => ({
  ...await importOriginal<typeof import('@mui/material')>(),
  // Phone, for every query this file asks.
  useMediaQuery: () => true,
}))

// The pick'em keys its ballot on the signed-in account, so anything that renders the
// bracket needs an auth context. Signed in here: the gate itself is covered in
// seriesPicksView.test.
vi.mock('../../AuthContext', () => ({
  useAuth: () => ({ user: { id: 'test-user' }, openAuthDialog: () => {} }),
}))

vi.mock('../awardVotes', () => ({
  awardVoterKey: () => 'test-voter-key',
  fetchWpblAwardBallot: () => Promise.resolve({}),
  fetchWpblAwardResults: () => Promise.resolve({}),
  castWpblAwardVote: () => Promise.resolve(true),
  clearWpblAwardVote: () => Promise.resolve(true),
}))

const { default: PlayoffBracket } = await import('../PlayoffBracket')
const { computeStandings } = await import('../api')

const TEAMS: WpblTeam[] = (['SF', 'LA', 'NY', 'BOS'] as const).map((id, i) => ({
  id, city: id, name: id, abbr: id, color: null, color_secondary: null,
  logo_url: null, sort_order: i, api_id: null, created_at: '',
} as WpblTeam))

let seq = 0
const win = (w: string, l: string, date: string): WpblGame => ({
  id: `g${seq++}`, game_date: date, start_time: '6:30 PM',
  home_team_id: w, away_team_id: l, venue: null, status: 'final',
  home_score: 6, away_score: 1, innings: 7, notes: null, created_at: '', updated_at: '',
  game_type: 'regular', counts_in_standings: true,
} as WpblGame)

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

// THE CLOCK HAS TO BE HELD, or this file is a time bomb and was one: it passed every run until
// Sep 9, 2026 and failed every run after. `seriesPickOpen` refuses once POSTSEASON_SCHEDULE's
// published first pitch has passed, deliberately, and that constant is a real date rather than
// anything the fixtures here control. So the moment the real postseason began, every series in
// this projected bracket read as started, `PickemButton` found nothing askable and rendered
// null, and two tests about a COLLAPSED CARD started reporting a missing button.
//
// `Date.now` is spied rather than the timers faked, because testing-library's `findBy*` polls on
// the very timers that would freeze.
const BEFORE_THE_POSTSEASON = Date.parse('2026-09-01T12:00:00Z')
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(BEFORE_THE_POSTSEASON) })
afterEach(() => { vi.restoreAllMocks() })

const draw = () => {
  const games = season()
  return render(<PlayoffBracket rows={computeStandings(TEAMS, games)} games={games} />)
}

describe('a bracket card that is shut', () => {
  it('still offers the pick’em, from its header', async () => {
    const { container } = draw()
    expect(await screen.findByText('Make your picks')).toBeTruthy()
    // The body is not rendered at all, so the full button is not merely hidden.
    expect(container.textContent).not.toContain('Who wins each series')
  })

  // From a shut card, picking is one tap rather than expand-then-scroll-then-tap.
  it('opens the sheet without expanding the card', async () => {
    draw()
    fireEvent.click(await screen.findByText('Make your picks'))
    await screen.findByText('Call the postseason')
    const header = screen.getByRole('button', { name: /Road to the title/ })
    expect(header.getAttribute('aria-expanded')).toBe('false')
  })
})

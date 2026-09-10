import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ADMIN_EMAIL } from '../../lib/admin'
import type { WpblBattingLine, WpblFieldingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblTeam } from '../types'

// The fan awards ballot is admin-only while it is being built, and this is the test that says
// so. It is worth its own file because it is the only thing standing between an unfinished
// feature and every reader of the site, and because a gate is invisible when it works: the
// failure looks exactly like a normal page until somebody who should not see the ballot sees it.
//
// BOTH BRANCHES, not just the closed one. A gate that hides the feature from everybody passes
// half of this and is useless, and that half is the easy half to write by accident.

let email: string | null = ADMIN_EMAIL
vi.mock('../../AuthContext', () => ({
  useAuth: () => ({ user: email ? { id: 'u1', email } : null, openAuthDialog: vi.fn() }),
}))

// The ballot's own reads and writes. None of them should happen for a fan either, which the
// last test checks by counting the calls.
const fetchBallot = vi.fn(() => Promise.resolve({} as Record<string, string>))
const fetchResults = vi.fn(() => Promise.resolve({} as Record<string, Record<string, number>>))
vi.mock('../awardVotes', () => ({
  awardVoterKey: () => 'test-voter-key',
  awardVoteCount: () => 0,
  fetchWpblAwardBallot: (...a: unknown[]) => fetchBallot(...(a as [])),
  fetchWpblAwardResults: (...a: unknown[]) => fetchResults(...(a as [])),
  castWpblAwardVote: () => Promise.resolve(true),
  clearWpblAwardVote: () => Promise.resolve(true),
}))

const fetchFielding = vi.fn(() => Promise.resolve([] as WpblFieldingLine[]))
vi.mock('../api', () => ({
  fetchWpblAllFielding: () => fetchFielding(),
  getCachedWpblAllFielding: () => [] as WpblFieldingLine[],
}))

const { default: FanVoteCard } = await import('../FanVote')

const teams: WpblTeam[] = (['SF', 'LA', 'NY', 'BOS'] as const).map((id, i) => ({
  id, city: id, name: id, abbr: id, color: null, color_secondary: null,
  logo_url: null, sort_order: i, api_id: null, created_at: '',
} as WpblTeam))

const players: WpblPlayer[] = teams.map((t, i) => ({
  id: `p${i}`, team_id: t.id, name: `Player ${i}`, active: true, position: 'cf',
} as WpblPlayer))

const game = { id: 'g1', game_date: '2026-09-01', home_team_id: 'SF', away_team_id: 'LA',
  status: 'final', home_score: 3, away_score: 2, game_type: 'regular', counts_in_standings: true } as WpblGame

// Enough of a season that every seeded shortlist has somebody on it, or the card declines to
// draw for its own reasons and the test would pass for the wrong one.
const batting: WpblBattingLine[] = players.map((p, i) => ({
  id: `b${i}`, game_id: 'g1', player_id: p.id, team_id: p.team_id, position: 'cf',
  ab: 4, r: 1, h: 2, doubles: 1, triples: 0, hr: 1, rbi: 2, bb: 1, so: 1,
  hbp: 0, sb: 2, cs: 0, sf: 0, sh: 0, ibb: 0, gdp: 0, tb: 6, lob: 0,
} as WpblBattingLine))

const pitching: WpblPitchingLine[] = players.map((p, i) => ({
  id: `q${i}`, game_id: 'g1', player_id: p.id, team_id: p.team_id,
  outs: 21, bf: 25, h: 4, r: 2, er: 2, bb: 1, so: 9, hr: 0, pitches: 90, decision: 'W',
  gs: 1, hbp: 0, ibb: 0, wp: 0, bk: 0, strikes: 60, doubles: 0, triples: 0,
} as WpblPitchingLine))

const draw = () => render(
  <FanVoteCard players={players} teams={teams} games={[game]}
    batting={batting} pitching={pitching}
    now={() => Date.parse('2026-09-10T12:00:00Z')} />,
)

beforeEach(() => {
  email = ADMIN_EMAIL
  fetchBallot.mockClear(); fetchResults.mockClear(); fetchFielding.mockClear()
})

describe('who can see the fan awards ballot', () => {
  it('draws for the site owner', async () => {
    draw()
    await waitFor(() => expect(screen.getByText('Fan awards')).toBeTruthy())
  })

  it('draws nothing at all for a signed-in reader who is not the owner', async () => {
    email = 'somebody.else@example.com'
    const { container } = draw()
    await waitFor(() => expect(fetchFielding).toHaveBeenCalled())
    expect(screen.queryByText('Fan awards')).toBeNull()
    expect(container.textContent).toBe('')
  })

  it('draws nothing at all for a signed-out reader', async () => {
    email = null
    const { container } = draw()
    await waitFor(() => expect(fetchFielding).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  // Not only invisible: silent. A hidden card that still reads the tally would put a row in
  // wpbl_award_votes' read path for every visitor, and the `wpbl_award_shown` event would report
  // a ballot nobody was shown.
  it('does not read the ballot or the tally for anyone but the owner', async () => {
    email = 'somebody.else@example.com'
    draw()
    await waitFor(() => expect(fetchFielding).toHaveBeenCalled())
    expect(fetchBallot).not.toHaveBeenCalled()
    expect(fetchResults).not.toHaveBeenCalled()
  })

  // The gate is the email and nothing else, so a typo in one of the two places that spell it
  // would open the ballot to nobody at all and look identical to it working.
  it('keys on the one owner email, not on being signed in', () => {
    expect(ADMIN_EMAIL).toMatch(/^[^@\s]+@[^@\s]+$/)
  })
})

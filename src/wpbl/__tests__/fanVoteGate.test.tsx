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
let uid = 'u1'
vi.mock('../../AuthContext', () => ({
  useAuth: () => ({ user: email ? { id: uid, email } : null, openAuthDialog: vi.fn() }),
}))

// The `user_roles` read behind useSiteRoles. Mocked at the SUPABASE boundary rather than by
// stubbing lib/roles, so the thing under test here is the real gate: the row shape, the
// unknown-role filter and the per-account cache all run.
let roleRows: Array<{ role: string }> = []
const roleQuery = vi.fn(() => Promise.resolve({ data: roleRows, error: null }))
vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: (...a: unknown[]) => roleQuery(...(a as [])) }) }) },
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
  uid = 'u1'
  roleRows = []
  // useSiteRoles caches its last answer per account in localStorage, so without this a role
  // granted in one test is still granted in the next one and the closed branches pass for the
  // wrong reason.
  localStorage.clear()
  fetchBallot.mockClear(); fetchResults.mockClear(); fetchFielding.mockClear(); roleQuery.mockClear()
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

// THE COLLABORATOR BRANCH. Ghost Baseboo suggested the awards and helped pick the categories,
// and the role is how he sees the thing he designed before it launches. It is a second way in,
// which is exactly the shape of change that quietly becomes a third way in for everybody, so
// each half is pinned: it opens for the role, it stays shut without it, and it does not open
// for a role this build has never heard of.
describe('the collaborator role', () => {
  it('draws for a collaborator who is not the owner', async () => {
    email = 'ghostbaseboo@example.com'
    roleRows = [{ role: 'collaborator' }]
    draw()
    await waitFor(() => expect(screen.getByText('Fan awards')).toBeTruthy())
  })

  it('draws nothing for the same reader once the role is revoked', async () => {
    email = 'ghostbaseboo@example.com'
    roleRows = []
    const { container } = draw()
    await waitFor(() => expect(fetchFielding).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  // A role added to the table after this build shipped must not become a skeleton key. The
  // client filters to the roles it knows, so an unrecognised one is no role at all.
  it('ignores a role this build does not know about', async () => {
    email = 'ghostbaseboo@example.com'
    roleRows = [{ role: 'sponsor' }]
    const { container } = draw()
    await waitFor(() => expect(fetchFielding).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  // The cache is keyed on the account. Signing out of a collaborator and into an ordinary
  // reader on the same browser must not leave the ballot on screen.
  it("does not carry one account's role over to the next account", async () => {
    email = 'ghostbaseboo@example.com'
    roleRows = [{ role: 'collaborator' }]
    const first = draw()
    await waitFor(() => expect(screen.getByText('Fan awards')).toBeTruthy())
    first.unmount()

    uid = 'someone-else'
    email = 'stranger@example.com'
    roleRows = []
    const { container } = draw()
    await waitFor(() => expect(fetchFielding).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('asks for nothing at all when nobody is signed in', async () => {
    email = null
    draw()
    await waitFor(() => expect(fetchFielding).toHaveBeenCalled())
    expect(roleQuery).not.toHaveBeenCalled()
  })
})

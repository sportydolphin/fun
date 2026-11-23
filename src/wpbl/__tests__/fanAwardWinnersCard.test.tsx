import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { WpblPlayer, WpblTeam } from '../types'

// A 2026 award is about the 2026 season, so its winner wears the club they won it for. The roster's
// `team_id` is where a player is now, and the offseason moves it: a winner traded since would
// otherwise be ringed in a club they never played for. The club is the stored season rows' one.

const portraits = vi.hoisted(() => [] as { name: string; teamId: string | null }[])
vi.mock('../ui', async importActual => {
  const actual = await importActual<typeof import('../ui')>()
  return {
    ...actual,
    PlayerPortrait: (p: { name: string; teamId: string | null }) => { portraits.push({ name: p.name, teamId: p.teamId }); return null },
  }
})
vi.mock('../api', () => ({
  fetchWpblPlayerLines: vi.fn(),
  fetchWpblPlayerSeasons: vi.fn(async () => ({
    current: false,
    rows: [{ season: 2026, scope: 'regular', player_id: 'league', batting: null, pitching: null, value: null, position: null,
      weights: { woba: null, fip: null, clubs: { traded: 'NY' } }, season_rows: 1, stamp: 's', version: 5 }],
  })),
}))
vi.mock('../awardVotes', async importActual => ({
  ...(await importActual<typeof import('../awardVotes')>()),
  getCachedWpblAwardResults: () => null,
  fetchWpblAwardResults: vi.fn(async () => ({ mvp: { traded: 10 } })),
}))

import { FanAwardWinnersCard } from '../home/PlayerCards'

describe('the fan award winners card', () => {
  it('rings a winner traded since in the club they won it for', async () => {
    const traded = { id: 'traded', name: 'Traded Winner', team_id: 'BOS', position: '3B', active: true } as unknown as WpblPlayer
    const teams = new Map<string, WpblTeam>()
    const opened: WpblPlayer[] = []
    render(<FanAwardWinnersCard players={[traded]} teams={teams} onOpenPlayer={p => opened.push(p)} onOpenTeam={() => {}} />)
    await waitFor(() => expect(screen.getAllByText(/Traded Winner|T\. Winner/).length).toBeGreaterThan(0))
    const drawn = portraits.filter(p => p.name === 'Traded Winner')
    expect(drawn[drawn.length - 1]?.teamId).toBe('NY')
  })
})

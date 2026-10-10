import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { LeaderboardView } from '../views/LeaderboardView'
import { boardSortFor } from '../state/useMlbState'
import { mlbUrlFor } from '../routes'
import { CURRENT_SEASON } from '../constants'
import type { LeaderboardEntry } from '../types'

// Leaders is the overview and the Table is the full ranking. What ties them together is that each
// Leaders card links to the Table ranked by its stat, at an address that says so, and that both
// boards agree on who shares a place.

const hitter = (id: number, name: string, hr: number): LeaderboardEntry => ({
  playerId: id, playerName: name, teamAbbr: 'BOS', teamId: 111,
  stat: { plateAppearances: 600, atBats: 520, hits: 150, avg: '.288', obp: '.370', slg: '.540', ops: '.910', homeRuns: hr, rbi: 90, stolenBases: 5 },
})
const DATA = [hitter(1, 'Ada Lovelace', 45), hitter(2, 'Grace Hopper', 45), hitter(3, 'Alan Turing', 43)]

function renderLeaders(onOpenStats = vi.fn()) {
  render(
    <LeaderboardView boardTabs={null}
      lbGroup="hitting" setLbGroup={() => {}}
      vizSeason={CURRENT_SEASON} setVizSeason={() => {}}
      gameScope="regular" setGameScope={() => {}}
      lbData={DATA} loadingLb={false}
      lbSelectedKeys={['hr']} setLbSelectedKeys={() => {}}
      isDesktop={false} canHover={false}
      handleLbPlayerClick={() => {}} onOpenStats={onOpenStats}
    />,
  )
  return onOpenStats
}

describe('MLB Leaders', () => {
  // Plain ranks, as WPBL's card draws them (src/ui/leaders.tsx): no medals since Oct 2026.
  it('shares first place between equal values, and the next place skips the one they used', () => {
    renderLeaders()
    const rows = screen.getAllByRole('link').filter(a => a.getAttribute('href')?.startsWith('/mlb/players/'))
    expect(within(rows[0]).getByText('T-1')).toBeTruthy()
    expect(within(rows[1]).getByText('T-1')).toBeTruthy()
    expect(within(rows[2]).getByText('3')).toBeTruthy()
  })

  it('links each card to the Table ranked by its stat, and opens it in the app on a plain click', () => {
    const onOpen = renderLeaders()
    const all = screen.getByRole('link', { name: /See all/ })
    expect(all.getAttribute('href')).toBe('/mlb/stats?sort=hr')
    fireEvent.click(all)
    expect(onOpen).toHaveBeenCalledWith('hr')
  })
})

describe('the Table sort on the address', () => {
  it('writes sort= on the Table only, beside the other board filters', () => {
    expect(mlbUrlFor({ view: 'stats', lb: 'pitching', games: 'post', sort: 'whip' }, CURRENT_SEASON))
      .toBe('/mlb/stats?lb=pitching&games=post&sort=whip')
    expect(mlbUrlFor({ view: 'leaderboard', sort: 'whip' }, CURRENT_SEASON)).toBe('/mlb/leaders')
  })

  it('reads a known stat back into a sort, and ignores one that names nothing on that board', () => {
    expect(boardSortFor('pitching', 'era')).toMatchObject({ sortKey: 'era', sortAsc: true, group: 'pitching' })
    expect(boardSortFor('hitting', 'era')).toBeNull()
    expect(boardSortFor('hitting', null)).toBeNull()
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { StatsView } from '../views/StatsView'
import { FULL_TABLE_KEY } from '../views/StatsRankedList'
import { CURRENT_SEASON } from '../constants'
import type { LbFullscreenState, LeaderboardEntry } from '../types'

// The phone's Stats board is a ranked list that shows the stat it is ranked by. The grid it
// replaced was sorted by OPS with the OPS column off the screen, so what these pin is that the
// number a row is ranked on is on the row, that a player is a real link, and that the grid is
// still one tap away.

const hitter = (id: number, name: string, ops: string, hr: number): LeaderboardEntry => ({
  playerId: id, playerName: name, teamAbbr: 'BOS', teamId: 111,
  stat: { plateAppearances: 600, atBats: 520, hits: 150, avg: '.288', obp: '.370', slg: '.540', ops, homeRuns: hr, rbi: 90, stolenBases: 5 },
})

const DATA: LeaderboardEntry[] = [
  hitter(1, 'Ada Lovelace', '.950', 40),
  hitter(2, 'Grace Hopper', '.910', 40),
  hitter(3, 'Alan Turing', '.910', 22),
  hitter(4, 'Edsger Dijkstra', '.800', 12),
]

function Harness({ isDesktop = false, onOpen = () => {} }: { isDesktop?: boolean; onOpen?: (id: number) => void }) {
  const [group, setGroup] = useState<'hitting' | 'pitching'>('hitting')
  const [fs, setFs] = useState<LbFullscreenState | null>(null)
  const [limit, setLimit] = useState(50)
  const [qualified, setQualified] = useState(true)
  const [season, setSeason] = useState(CURRENT_SEASON)
  const [allTime, setAllTime] = useState(false)
  const [scope, setScope] = useState<'regular' | 'post' | 'all'>('regular')
  return (
    <StatsView boardTabs={null}
      lbGroup={group} setLbGroup={setGroup}
      vizSeason={season} setVizSeason={setSeason}
      allTime={allTime} setAllTime={setAllTime}
      gameScope={scope} setGameScope={setScope}
      lbData={DATA} lbFullscreen={fs} setLbFullscreen={setFs}
      lbStatsLimit={limit} setLbStatsLimit={setLimit}
      lbQualified={qualified} setLbQualified={setQualified}
      isDesktop={isDesktop} canHover={false}
      handleLbPlayerClick={onOpen}
    />
  )
}

beforeEach(() => {
  try { localStorage.removeItem(FULL_TABLE_KEY) } catch { /* nothing to clear */ }
  window.history.replaceState({}, '', '/mlb/stats')
})

describe('MLB Stats on a phone', () => {
  it('ranks by OPS and shows OPS on every row, the column the grid pushed off screen', () => {
    render(<Harness />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByRole('button', { name: /Sort\s*OPS/ })).toBeTruthy()
    const first = screen.getByRole('link', { name: /Ada Lovelace/ })
    expect(within(first).getByText('.950')).toBeTruthy()
    // The big number is OPS, so the supporting line must not say it a second time.
    expect(within(first).queryByText(/\.950 OPS/)).toBeNull()
    // Ranked by a rate, the line leads with what it was measured over, as WPBL's does.
    expect(within(first).getByText(/600 PA · 40 HR · 90 RBI/)).toBeTruthy()
  })

  it('draws each player as a real link to their page, and a plain click stays in the app', () => {
    const onOpen = vi.fn()
    render(<Harness onOpen={onOpen} />)
    const link = screen.getByRole('link', { name: /Grace Hopper/ })
    expect(link.getAttribute('href')).toBe('/mlb/players/grace-hopper-2')
    fireEvent.click(link)
    expect(onOpen).toHaveBeenCalledWith(2)
    onOpen.mockClear()
    // A modified click is the reader asking the browser for a tab, so the app stays out of it.
    // jsdom would try to navigate on an unprevented anchor click and log that it cannot.
    link.addEventListener('click', e => e.preventDefault())
    fireEvent.click(link, { ctrlKey: true })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('shares a place between equal values rather than numbering them one to four', () => {
    render(<Harness />)
    const rows = screen.getAllByRole('link').filter(a => a.getAttribute('href')?.startsWith('/mlb/players/'))
    expect(rows.map(r => r.textContent)).toEqual([
      expect.stringContaining('Ada Lovelace'), expect.stringContaining('Grace Hopper'),
      expect.stringContaining('Alan Turing'), expect.stringContaining('Edsger Dijkstra'),
    ])
    expect(within(rows[0]).getByText('1')).toBeTruthy()
    expect(within(rows[1]).getByText('T-')).toBeTruthy()
    expect(within(rows[2]).getByText('T-')).toBeTruthy()
    expect(within(rows[3]).getByText('4')).toBeTruthy()
  })

  it('re-ranks on the stat picked in the sort sheet and says so on the pill', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /Sort\s*OPS/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Home Runs|^HR/ }))
    expect(screen.getByRole('button', { name: /Sort\s*HR/ })).toBeTruthy()
    const first = screen.getAllByRole('link').find(a => a.getAttribute('href')?.startsWith('/mlb/players/'))!
    expect(first.textContent).toContain('Ada Lovelace')
    expect(within(first).getByText('40')).toBeTruthy()
  })

  it('reverses the order from the sheet, naming it rather than calling it ascending', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /Sort\s*OPS/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Worst first' }))
    const first = screen.getAllByRole('link').find(a => a.getAttribute('href')?.startsWith('/mlb/players/'))!
    expect(first.textContent).toContain('Edsger Dijkstra')
    // The pill is the control a reader looks at again, so it carries the reversal.
    expect(screen.getByRole('button', { name: /Worst\s*OPS/ })).toBeTruthy()
  })

  it('keeps the grid one tap away, and remembers the choice', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Full table'))
    expect(screen.getByRole('table')).toBeTruthy()
    expect(localStorage.getItem(FULL_TABLE_KEY)).toBe('1')
    // The sort control stays on the full table, as WPBL's does: its column is frozen beside the name.
    expect(screen.getByRole('button', { name: /Sort\s*OPS/ })).toBeTruthy()
    fireEvent.click(screen.getByText('Ranked list'))
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('leaves the desktop on the grid', () => {
    render(<Harness isDesktop />)
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.queryByText('Full table')).toBeNull()
  })
})

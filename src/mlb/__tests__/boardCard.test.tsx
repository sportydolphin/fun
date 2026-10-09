import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LeaderboardCard, PlayerLeaderboardCard, type LbRow } from '../components/leaderboards'

// The Report Card boards draw on WPBL's SectionCard since Oct 9, 2026 (the second alignment pass in
// ROADMAP.md). These pin the parts of that a reader or a crawler depends on: the title is a real
// heading, the header link is a link where it goes somewhere with an address, and the loading state
// is the three rows ghosted rather than a spinner in a box of some other height.

const rows: LbRow[] = [
  { teamId: 111, abbr: 'BOS', name: 'Boston Red Sox', sub: '90–72', value: '.556', barFraction: 1, label: 'Legit' },
  { teamId: 136, abbr: 'SEA', name: 'Seattle Mariners', sub: '88–74', value: '.543', barFraction: 0.9, label: 'Legit' },
  { teamId: 117, abbr: 'HOU', name: 'Houston Astros', sub: '85–77', value: '.525', barFraction: 0.8, label: 'Fine' },
  { teamId: 140, abbr: 'TEX', name: 'Texas Rangers', sub: '80–82', value: '.494', barFraction: 0.6, label: 'Meh' },
]
const board = { icon: '📊', title: 'Fraud Watch', subtitle: 'Run differential against record', accent: '#60a5fa' }

describe('Report Card boards', () => {
  it('titles the card with an h2 and shows the top three', () => {
    render(<LeaderboardCard {...board} rows={rows} loading={false} onExpand={() => {}} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Fraud Watch' })).toBeTruthy()
    expect(screen.getAllByText('Boston Red Sox').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('Texas Rangers')).toHaveLength(0)
  })

  it("links Home's boards to the Charts tab, and keeps the click in the app", () => {
    const onExpand = vi.fn()
    render(<LeaderboardCard {...board} rows={rows} loading={false} onExpand={onExpand}
      actionLabel="All boards" actionHref="/mlb/charts" />)
    const a = screen.getByRole('link', { name: 'All boards' })
    expect(a.getAttribute('href')).toBe('/mlb/charts')
    fireEvent.click(a)
    expect(onExpand).toHaveBeenCalledOnce()
  })

  it('opens its own sheet from a button counting the board', () => {
    const onExpand = vi.fn()
    render(<LeaderboardCard {...board} rows={rows} loading={false} onExpand={onExpand} />)
    fireEvent.click(screen.getByRole('button', { name: 'All 4' }))
    expect(onExpand).toHaveBeenCalledOnce()
  })

  it('draws three ghosted rows while loading, with no links in them', () => {
    const { container } = render(<PlayerLeaderboardCard {...board} rows={[]} loading onExpand={() => {}} />)
    expect(screen.queryByText('No active streaks')).toBeNull()
    // The rank is the one real number in a ghost row.
    expect(['1', '2', '3'].every(n => screen.queryByText(n))).toBe(true)
    expect(container.querySelectorAll('a[href^="/mlb/players"]')).toHaveLength(0)
  })
})

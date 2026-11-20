import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EMPTY_SEARCH_LOG, type SearchLog, type SearchLogRow } from '../lib/analyticsAdmin'
import AdminSearch from '../AdminSearch'

// /admin is behind the owner gate, so this is the only way the Search tab is ever checked.

const row = (over: Partial<SearchLogRow>): SearchLogRow => ({
  at: new Date().toISOString(), section: 'wpbl', result: 'picked', kind: 'result', title: null, q: null,
  player_id: null, team_id: null, typed: 4, rank: 0, shown: null, top: true, forgiving: false,
  browser: 'abc123', me: false, user: null, ...over,
})

const log: SearchLog = {
  ...EMPTY_SEARCH_LOG,
  excluded_browsers: 3,
  totals: { ...EMPTY_SEARCH_LOG.totals, opened: 12, searches: 10, browsers: 4, picked: 7, closed: 2, nothing: 1, top_row: 5 },
  players: [{ id: 'p1', name: 'Kelsie Whitmore', team_id: 'sf', events: 5, browsers: 3, last_at: new Date().toISOString() }],
  missed: [{ section: 'wpbl', q: 'whitmoor', events: 1, browsers: 1, last_at: new Date().toISOString() }],
  recent: [
    row({ title: 'Kelsie Whitmore', browser: 'aaa111' }),
    row({ result: 'nothing', kind: null, q: 'whitmoor', browser: 'bbb222' }),
    row({ result: 'closed', kind: null, shown: 3, browser: 'aaa111' }),
  ],
}

const fetchSearchLog = vi.fn(async (..._a: unknown[]) => log)
vi.mock('../lib/analyticsAdmin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/analyticsAdmin')>()
  return { ...actual, fetchSearchLog: (...a: unknown[]) => fetchSearchLog(...a) }
})

beforeEach(() => { fetchSearchLog.mockClear(); localStorage.clear() })

describe('AdminSearch', () => {
  it('leaves the owner out by default, and asks again with them in when the chip is turned off', async () => {
    render(<AdminSearch />)
    await screen.findByText('3 of my browsers excluded')
    expect(fetchSearchLog.mock.calls[0][2]).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Exclude me' }))
    await waitFor(() => expect(fetchSearchLog.mock.calls[fetchSearchLog.mock.calls.length - 1]?.[2]).toBe(false))
    expect(localStorage.getItem('sdAdminSearchExcludeMe')).toBe('0')
  })

  it('names what was picked, quotes what found nothing, and filters the log', async () => {
    render(<AdminSearch />)
    expect(await screen.findByText('70%')).toBeInTheDocument()
    expect(screen.getAllByText('Kelsie Whitmore').length).toBeGreaterThan(1)
    expect(screen.getAllByText('“whitmoor”').length).toBe(2)
    expect(screen.getByText('Closed with 3 rows')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'No results' }))
    expect(screen.queryByText('Closed with 3 rows')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'All' }))

    await userEvent.click(screen.getAllByRole('button', { name: 'Only browser aaa111' })[0])
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
  })
})

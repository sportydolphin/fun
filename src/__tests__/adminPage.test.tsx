import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  EMPTY_OVERVIEW, EMPTY_GROWTH, EMPTY_STATS_BOARDS,
  type AnalyticsBundle,
} from '../lib/analyticsAdmin'

// /admin is behind an owner gate, so it is the one page that cannot be checked by opening a
// browser. This is the substitute: the three groups exist, they show what belongs to each of
// them and nothing that belongs to another, and the range filter is only offered where it
// actually applies.

const bundle = (over: Partial<AnalyticsBundle> = {}): AnalyticsBundle => ({
  overview: EMPTY_OVERVIEW,
  events: [],
  tabs: [],
  statsBoards: EMPTY_STATS_BOARDS,
  players: [],
  discord: { impressions: 0, shown: 0, joined: 0, dismissed: 0 },
  growth: EMPTY_GROWTH,
  ...over,
})

const fetchAnalytics = vi.fn(async () => bundle())

vi.mock('../lib/analyticsAdmin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/analyticsAdmin')>()
  return { ...actual, fetchAnalytics: (...a: unknown[]) => fetchAnalytics(...(a as [])) }
})

// The operational half reads tables directly rather than through an RPC wrapper, so the
// health hook is stubbed at the module boundary instead of mocking supabase's query builder.
vi.mock('../AdminPanel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../AdminPanel')>()
  return {
    ...actual,
    useOpsHealth: () => ({
      payroll: null,
      ingest: { ran_at: new Date().toISOString(), ok: true, mode: 'active', games: 3, boxscores: 6, error_count: 0 },
      validation: null,
      tracking: null,
      predictions: 1234,
      loading: false,
      reload: () => {},
    }),
    AdminTools: () => <div data-testid="admin-tools">tools</div>,
  }
})

const { default: AdminPage } = await import('../AdminPage')

const renderPage = () => render(
  <AdminPage apps={[]} isAppLocked={() => false} onOpenApp={() => {}} />,
)

beforeEach(() => { fetchAnalytics.mockClear() })

describe('AdminPage groups', () => {
  it('opens on Audience, with the range filter that only applies there', async () => {
    renderPage()
    expect(await screen.findByText('Activity')).toBeInTheDocument()
    expect(screen.getByText('30d')).toBeInTheDocument()
    expect(screen.queryByText('Pipelines')).not.toBeInTheDocument()
    expect(screen.queryByTestId('admin-tools')).not.toBeInTheDocument()
  })

  it('shows pipeline health from the Audience group, so trouble needs no scrolling', async () => {
    renderPage()
    await screen.findByText('Activity')
    expect(screen.getByText('Ingest')).toBeInTheDocument()
    expect(screen.getByText('Fresh')).toBeInTheDocument()
  })

  it('swaps to Health, where the strip stands down and the detail takes over', async () => {
    renderPage()
    await screen.findByText('Activity')
    await userEvent.click(screen.getByText('Health'))

    expect(screen.getByText('Pipelines')).toBeInTheDocument()
    expect(screen.getByText('WPBL ingest')).toBeInTheDocument()
    // The strip is the same four states; showing it above its own detail would be noise.
    expect(screen.queryByLabelText('Pipeline health: open the Health group')).not.toBeInTheDocument()
    // The range chips belong to the audience numbers and mean nothing here.
    expect(screen.queryByText('30d')).not.toBeInTheDocument()
    expect(screen.queryByText('Activity')).not.toBeInTheDocument()
  })

  it('swaps to Tools without re-fetching the analytics bundle', async () => {
    renderPage()
    await screen.findByText('Activity')
    const before = fetchAnalytics.mock.calls.length

    await userEvent.click(screen.getByText('Tools'))
    expect(screen.getByTestId('admin-tools')).toBeInTheDocument()
    expect(screen.queryByText('Activity')).not.toBeInTheDocument()
    expect(fetchAnalytics.mock.calls.length).toBe(before)
  })
})

describe('AdminPage events list', () => {
  const manyEvents = Array.from({ length: 20 }, (_, i) => ({
    event: `event_${i}`, events: 100 - i, browsers: 5, users: 1, prev_events: 0, prev_browsers: 0,
  }))

  it('shows a head of the long tail and keeps the rest one tap away', async () => {
    fetchAnalytics.mockResolvedValueOnce(bundle({ events: manyEvents }))
    renderPage()

    // Not scoped by section title: "Events" is also a headline tile, and the ambiguity is
    // the point of querying by the row text instead.
    expect(await screen.findByText('Event 0')).toBeInTheDocument()
    expect(screen.queryByText('Event 15')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('Show all 20'))
    expect(screen.getByText('Event 15')).toBeInTheDocument()
    expect(screen.getByText('Show fewer')).toBeInTheDocument()
  })
})

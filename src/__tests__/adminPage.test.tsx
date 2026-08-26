import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  EMPTY_OVERVIEW, EMPTY_GROWTH, EMPTY_STATS_BOARDS, EMPTY_ENTRY_POINTS, EMPTY_SEARCH,
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
  entryPoints: EMPTY_ENTRY_POINTS,
  search: EMPTY_SEARCH,
  players: [],
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

    expect(await screen.findByText('Event 0')).toBeInTheDocument()
    expect(screen.queryByText('Event 15')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('Show all 20'))
    expect(screen.getByText('Event 15')).toBeInTheDocument()
    expect(screen.getByText('Show fewer')).toBeInTheDocument()
  })
})

describe('AdminPage range filter', () => {
  // A window with a real previous window to compare against, so the delta chips have
  // something to draw and their ABSENCE on the Today range is a real assertion.
  const busy = bundle({
    overview: {
      ...EMPTY_OVERVIEW,
      tz: 'UTC',
      series: [
        { date: '2026-08-23', events: 900, browsers: 90, users: 6 },
        { date: '2026-08-24', events: 800, browsers: 80, users: 5 },
      ],
      totals: { events: 1700, browsers: 170, users: 12, signed_in_browsers: 34 },
      prev:   { events: 1000, browsers: 100, users: 10, signed_in_browsers: 20 },
      active: { today: 41, week: 300, month: 900 },
    },
    events: [{ event: 'wpbl_searched', events: 50, browsers: 9, users: 2, prev_events: 25, prev_browsers: 5 }],
  })

  it('offers Today alongside the longer ranges, and asks the RPCs for one day', async () => {
    fetchAnalytics.mockResolvedValue(busy)
    renderPage()
    await screen.findByText('Activity')

    await userEvent.click(screen.getByText('Today'))
    // days_back is the first argument of fetchAnalytics(days, league, tz).
    // The mock is declared with no parameters (it only ever returns a bundle), so its
    // recorded calls type as empty tuples. The arguments are real; the cast says so.
    const calls = fetchAnalytics.mock.calls as unknown as unknown[][]
    expect(calls[calls.length - 1][0]).toBe(1)
  })

  it('hides the change arrows on Today, because the window is a partial day', async () => {
    fetchAnalytics.mockResolvedValue(busy)
    renderPage()
    await screen.findByText('Activity')

    // 170 browsers against 100 is +70%, drawn on the tile and again on the event row.
    expect(screen.getAllByText('+70%').length).toBeGreaterThan(0)

    await userEvent.click(screen.getByText('Today'))
    // Today-so-far against all of yesterday would read negative every morning, so the whole
    // comparison stands down rather than showing a red arrow that means nothing.
    expect(screen.queryByText('+70%')).not.toBeInTheDocument()
    expect(screen.getByText(/partial day/)).toBeInTheDocument()
  })

  it('replaces the day chart with the day itself when there is only one day to plot', async () => {
    fetchAnalytics.mockResolvedValue(bundle({
      overview: {
        ...EMPTY_OVERVIEW,
        series: [{ date: '2026-08-25', events: 640, browsers: 88, users: 4 }],
        totals: { events: 640, browsers: 88, users: 3, signed_in_browsers: 9 },
      },
    }))
    renderPage()
    // A one-point polyline is an invisible line over a triangle with the same date at both
    // ends of the axis. The numbers say more than the shape does.
    expect(await screen.findByText(/640 events · 88 browsers/)).toBeInTheDocument()
    expect(screen.getByText(/at least two days/)).toBeInTheDocument()
  })
})

describe('AdminPage retired cards', () => {
  it('no longer carries the Discord funnel, whose numbers froze on Aug 19, 2026', async () => {
    fetchAnalytics.mockResolvedValue(bundle())
    renderPage()
    await screen.findByText('Activity')

    expect(screen.queryByText(/Discord invite/)).not.toBeInTheDocument()
    // And the page must not be paying for the RPC behind it either.
    expect(screen.queryByText(/Sessions that saw the card/)).not.toBeInTheDocument()
  })
})

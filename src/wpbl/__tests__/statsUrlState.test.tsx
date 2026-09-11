import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { WpblTeam } from '../types'

// The sorted column in the address bar, so a refresh lands where the reader was.
//
// WHY THE QUERY AND NOT THE PATH: `urlFor` in WpblApp sets the section's rule, that the tab is
// the path because it is a page worth indexing and anything laid over it is a param. It also
// costs nothing in the three places a new route would: /wpbl/stats is already in _redirects,
// the sitemap is unchanged, and seo.ts canonicalises the query away, so no permutation of these
// params can reach the index as a near-duplicate of the board.

vi.mock('@mui/material', async (importOriginal) => ({
  ...await importOriginal<typeof import('@mui/material')>(),
  useMediaQuery: () => false,
}))

vi.mock('../../AuthContext', () => ({
  useAuth: () => ({ user: null, openAuthDialog: () => {} }),
}))

vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  fetchWpblAllPlayers: () => Promise.resolve([]),
  fetchWpblAllLines: () => Promise.resolve({ batting: [], pitching: [] }),
  fetchWpblTrackedGameCount: () => Promise.resolve(0),
  getCachedWpblAllPlayers: () => [],
  getCachedWpblAllLines: () => ({ batting: [], pitching: [] }),
  wpblStatsCacheAgeMs: () => 0,
}))

const { default: StatsView } = await import('../StatsView')

const TEAMS: WpblTeam[] = [{
  id: 'SF', city: 'SF', name: 'SF', abbr: 'SF', color: null, color_secondary: null,
  logo_url: null, sort_order: 0, api_id: null, created_at: '',
} as WpblTeam]

const at = (url: string) => window.history.replaceState({ wpbl: { view: 'stats' } }, '', url)
const draw = () => render(
  <StatsView teams={TEAMS} games={[]} focus={{ group: 'hitting', token: 0 }} onOpenPlayer={() => {}} />
)
const url = () => window.location.pathname + window.location.search

beforeEach(() => { at('/wpbl/stats') })

describe('the stats view in the address bar', () => {
  it('leaves a default view with a clean url', async () => {
    draw()
    await screen.findByText('Hitting')
    expect(url()).toBe('/wpbl/stats')
  })

  it('writes the side the reader switched to', async () => {
    draw()
    fireEvent.click(await screen.findByText('Pitching'))
    expect(url()).toBe('/wpbl/stats?side=pitching')
  })

  // THE SNAPSHOT UNDERNEATH HAS TO SURVIVE. WpblApp keeps its navigation state on
  // history.state.wpbl, and a replaceState passing anything else, including the usual {}, wipes
  // it: Back would then render the wrong tab under this URL.
  it('does not wipe the navigation snapshot on the entry', async () => {
    draw()
    fireEvent.click(await screen.findByText('Pitching'))
    expect(window.history.state?.wpbl).toEqual({ view: 'stats' })
  })

  it('opens on the board and column a pasted link names', async () => {
    at('/wpbl/stats?side=pitching&sort=whip')
    draw()
    await screen.findByText('Hitting')
    // THE URL SURVIVING IS THE PROOF. The effect rewrites the query from the component's own
    // state on every change and strips anything that matches a default, so had the seed been
    // ignored it would have tidied these two away and left a bare /wpbl/stats — which is
    // exactly what the nonsense case below asserts. Both params still standing means the state
    // behind them is pitching, sorted by WHIP.
    expect(url()).toBe('/wpbl/stats?side=pitching&sort=whip')
  })

  // A hand-edited or stale link is the case that must not render a blank board.
  it('falls back to the default view on nonsense, and tidies the url', async () => {
    at('/wpbl/stats?board=nonsense&side=zzz&sort=notacolumn&dir=sideways')
    draw()
    await screen.findByText('Hitting')
    expect(url()).toBe('/wpbl/stats')
  })

  // The pager keeps every visited tab mounted, so an inactive board must not rewrite the URL
  // of the tab the reader is actually looking at.
  it('stays out of the address bar while it is not the tab on screen', async () => {
    at('/wpbl/schedule')
    render(
      <StatsView teams={TEAMS} games={[]} active={false}
        focus={{ group: 'pitching', token: 0 }} onOpenPlayer={() => {}} />
    )
    await screen.findByText('Hitting')
    expect(url()).toBe('/wpbl/schedule')
  })
})

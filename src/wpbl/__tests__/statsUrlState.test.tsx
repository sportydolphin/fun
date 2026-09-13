import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

const { default: StatsView, STATS_URL_PARAMS, carryStatsParams } = await import('../StatsView')

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

  // Matched on the empty state rather than on the board's own prose, because this harness
  // renders with no games: that message is BestsView's alone, so seeing it is proof the named
  // board is the one that opened, and the url surviving is proof the seed was not ignored.
  it('opens on the board a pasted link names', async () => {
    at('/wpbl/stats?board=bests')
    draw()
    expect(await screen.findByText('No games in this slice yet')).toBeTruthy()
    expect(url()).toBe('/wpbl/stats?board=bests')
  })
})

// ─── The cold load, which is where all of this was broken ────────────────────────
//
// EVERY TEST ABOVE PASSED THROUGH THE WHOLE OF THE BUG. They render StatsView on its own and
// set the address bar themselves, so they measure the half that always worked. The half that
// did not is one level up: `urlFor` in WpblApp builds a URL out of the navigation snapshot and
// nothing else, and the effect that stamps the section's first history entry calls it on mount,
// a beat before this pane renders. So a COLD LOAD of /wpbl/stats?board=runs had its query wiped
// before anything here could read it, and opened on Players with the address bar tidied to
// /wpbl/stats. Every board, since the params shipped. Found by pasting a link, not by a test.
describe('the params a cold load arrives with', () => {
  it('copies the board params onto a url and touches nothing else', () => {
    const from = new URLSearchParams('board=bests&side=pitching&sort=so&dir=asc&utm_source=x')
    const to = new URLSearchParams('game=abc')
    carryStatsParams(from, to)
    expect(to.toString()).toBe('game=abc&board=bests&side=pitching&sort=so&dir=asc')
  })

  it('carries nothing when there is nothing of ours to carry', () => {
    const to = new URLSearchParams()
    carryStatsParams(new URLSearchParams('utm_source=x'), to)
    expect(to.toString()).toBe('')
  })

  // THE WRITER AND THE CARRIER HAVE TO KNOW THE SAME FOUR NAMES, and the original bug is what
  // happens when they do not: the writer knew all of them and the carrier knew none. A fifth
  // param added to the effect and not to the list would be written to the address bar, copied
  // by a reader, and silently dropped on the way back in.
  it('names every param the writer actually writes', async () => {
    at('/wpbl/stats')
    draw()
    fireEvent.click(await screen.findByText('Pitching'))
    fireEvent.click(await screen.findByText('Run value'))
    const keys = [...new URLSearchParams(window.location.search).keys()]
    expect(keys.length).toBeGreaterThan(0)
    for (const k of keys) expect(STATS_URL_PARAMS).toContain(k)
  })

  // A SOURCE CHECK, DELIBERATELY. `urlFor` is a closure over WpblApp's component state and is
  // not exported, so the wiring cannot be reached from a unit test, and rendering the whole
  // section to assert one line of address bar would be a slow test of everything else. What
  // broke was that this call did not exist at all, and that is a thing a file can be asked.
  it('is wired into the url WpblApp builds for this tab', () => {
    const src = readFileSync(join(process.cwd(), 'src/wpbl/WpblApp.tsx'), 'utf8')
    expect(src).toContain('carryStatsParams(')
  })
})

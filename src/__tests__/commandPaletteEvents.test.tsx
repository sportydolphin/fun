// ─── The search box on its own: its rows, and every event it sends ───────────
//
// The palette is the site's only search (App.tsx opens it from the field, the icon, "/" and
// Ctrl+K), and /admin's "Search box" card is built on three promises its events make: every open
// ends in exactly one `picked` that left the box or one `dismissed`; an example row is a pick that
// does NOT leave; and a pick says what kind of row it was and where it sat. Each is pinned here,
// because a wrong one keeps the card rendering and makes it lie (docs/ADMIN_ANALYTICS.md).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

const track = vi.fn()
vi.mock('../lib/analytics', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/analytics')>()
  return { ...actual, track: (...a: unknown[]) => track(...a) }
})

import CommandPalette, { type PaletteIdleGroup } from '../CommandPalette'
import { useSearchBridge, type SearchBridgeState, type SearchResultRow } from '../mlb/state/SearchBridgeContext'

const row = (key: string, title: string, onSelect = vi.fn()): SearchResultRow =>
  ({ key, title, subtitle: 'sub', avatar: { fallbackText: title[0] }, onSelect })

function Host({ idle = [], results = [], resolveCompare, resolveGames }: {
  idle?: PaletteIdleGroup[]; results?: SearchResultRow[]; resolveCompare?: SearchBridgeState['resolveCompare']
  resolveGames?: SearchBridgeState['resolveGames']
}) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>reopen</button>
      <CommandPalette open={open} onClose={() => setOpen(false)} section="wpbl"
        results={results} idle={idle} searching={false} resolveCompare={resolveCompare} resolveGames={resolveGames} />
    </>
  )
}

const named = (name: string) => track.mock.calls.filter(c => c[0] === name).map(c => c[1])
const input = () => screen.getByRole('combobox')

describe('the search box', () => {
  beforeEach(() => { track.mockClear(); window.history.replaceState({}, '', '/wpbl') })
  afterEach(() => { cleanup() })

  it('shows the recents first when nothing is typed, and a recent pick says so', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Host idle={[{ label: 'Recent', kind: 'recent', rows: [row('p1', 'Kelsie Whitmore', onSelect)] }]} />)

    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('Kelsie Whitmore')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledOnce()
    expect(named('command_palette_picked')).toEqual([{ section: 'wpbl', kind: 'recent', rank: 0, typed: 0, top: true }])
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument())
    // A pick is the open's outcome, so there is no dismissal behind it.
    expect(named('command_palette_dismissed')).toEqual([])
  })

  it('clears the recents through the group, and reports that it did', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(<Host idle={[{ label: 'Recent', kind: 'recent', rows: [row('p1', 'Kelsie Whitmore')], onClear }]} />)
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onClear).toHaveBeenCalledOnce()
    expect(named('command_palette_recents_cleared')).toEqual([{ section: 'wpbl' }])
  })

  it('reports a close with no pick, and keeps the text only when nothing was on offer for it', async () => {
    const user = userEvent.setup()
    render(<Host />)
    await user.type(input(), 'zzyzx')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(named('command_palette_dismissed')).toEqual([{ section: 'wpbl', typed: 5, shown: 0, q: 'zzyzx' }]))
    expect(named('command_palette_picked')).toEqual([])
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument()
  })

  it('counts an example as a pick that keeps the box open, so a second pick can follow', async () => {
    const user = userEvent.setup()
    render(<Host />)
    await user.click(screen.getByRole('option', { name: /5 strikeouts no walks/ }))

    expect(input()).toHaveValue('5 strikeouts no walks')
    expect(named('command_palette_picked')).toEqual([expect.objectContaining({ kind: 'example', typed: 0 })])

    // The example's question, now answered: a Find row, then a pick that leaves.
    const find = await screen.findAllByRole('option', { name: /Strikeouts at least 5/ })
    await user.click(find[1])
    expect(window.location.search).toContain('side=hitting')
    const picks = named('command_palette_picked')
    expect(picks[1]).toEqual({ section: 'wpbl', kind: 'finder', rank: 1, typed: 21, top: false })
    expect(named('search_finder_picked')).toEqual([{
      section: 'wpbl', side: 'hitting', conditions: 2, clubs: 0, venue: 'any', ignored: 0, from: 'palette',
    }])
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument())
    expect(named('command_palette_dismissed')).toEqual([])
  })

  it('reports what a stat question named: clubs, venue, and the words it dropped', async () => {
    const user = userEvent.setup()
    render(<Host />)
    await user.type(input(), 'Whitmore 3 hits vs SF at home')
    await user.keyboard('{Enter}')
    expect(named('search_finder_picked')).toEqual([{
      section: 'wpbl', side: 'hitting', conditions: 1, clubs: 1, venue: 'home', ignored: 1, from: 'palette',
    }])
  })

  it('ranks a typed result by its place in the whole list', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Host results={[row('a', 'Alpha'), row('b', 'Bravo', onSelect)]} />)
    await user.type(input(), 'xx')
    const list = screen.getByRole('listbox')
    await user.click(within(list).getByRole('option', { name: /Bravo/ }))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(named('command_palette_picked')).toEqual([{ section: 'wpbl', kind: 'result', rank: 1, typed: 2, top: false }])
  })

  it('finds a page by name, and a page pick is a page', async () => {
    const user = userEvent.setup()
    render(<Host />)
    await user.type(input(), 'stand')
    await user.keyboard('{Enter}')
    expect(window.location.pathname).toBe('/wpbl/standings')
    expect(named('command_palette_picked')).toEqual([{ section: 'wpbl', kind: 'page', rank: 0, typed: 5, top: true }])
  })

  it('has a close button for a reader with no Escape key, and closing with it is a dismissal', async () => {
    const user = userEvent.setup()
    render(<Host />)
    await user.click(screen.getByRole('button', { name: 'Close search' }))
    await waitFor(() => expect(named('command_palette_dismissed')).toEqual([{ section: 'wpbl', typed: 0, shown: 8 }]))
  })

  it('offers the compare page for "A vs B" once the section finds both, and counts the pick', async () => {
    const user = userEvent.setup()
    const resolveCompare = vi.fn(async (a: string, b: string, season: number | null) =>
      ({ title: `${a} vs ${b}`, subtitle: String(season), href: '/wpbl/compare/x-vs-y?season=2026' }))
    render(<Host resolveCompare={resolveCompare} />)
    await user.keyboard('Whitmore vs Ibarra 2026')

    const option = await screen.findByRole('option', { name: /whitmore vs ibarra/ })
    expect(resolveCompare).toHaveBeenLastCalledWith('whitmore', 'ibarra', 2026)
    expect(option).toHaveAttribute('href', '/wpbl/compare/x-vs-y?season=2026')
    await user.keyboard('{Enter}')
    expect(named('command_palette_picked')[0]).toMatchObject({ kind: 'compare', rank: 0 })
  })

  it('searches names for the name alone and hands the typed year on beside it', async () => {
    const user = userEvent.setup()
    const Probe = () => { const b = useSearchBridge(); return <output data-testid="bridge">{`${b.query}|${b.querySeason}`}</output> }
    render(<><Host /><Probe /></>)
    await user.keyboard('Ohtani 2023')
    expect(screen.getByTestId('bridge')).toHaveTextContent('ohtani|2023')
  })

  it('asks the section for the games and offers each, with no compare lookup for the two clubs', async () => {
    const user = userEvent.setup()
    const resolveGames = vi.fn(async () => [{ title: 'SF 6 at NY 4', subtitle: 'Final · Sep 9, 2026', href: '/wpbl/games/x' }])
    const resolveCompare = vi.fn(async () => null)
    render(<Host resolveGames={resolveGames} resolveCompare={resolveCompare} />)
    await user.keyboard('SF vs NY sep 9')

    const option = await screen.findByRole('option', { name: /SF 6 at NY 4/ })
    expect(option).toHaveAttribute('href', '/wpbl/games/x')
    expect(resolveCompare).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    expect(named('command_palette_picked')[0]).toMatchObject({ kind: 'game', rank: 0 })
  })
})

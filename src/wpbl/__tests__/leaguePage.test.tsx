import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { WpblPlayer } from '../types'

// The country sections on /wpbl/league fold, and the thing that has to survive the folding is
// the anchors. This page is 118 player links and the crawl path they make is the reason it
// exists, so a closed country that returns `null` instead of hiding its grid would delete
// those links from the document a crawler reads, while looking identical to a human who
// opened the page and never touched a heading. Nothing else would catch that.

const player = (name: string, hometown: string, id: string): WpblPlayer => ({
  id, name, hometown, age: 27,
} as WpblPlayer)

const ROSTER = [
  player('Denae Benites', 'Corpus Christi, Texas, USA', 'p1'),
  player('Kelsie Whitmore', 'Temecula, California, USA', 'p2'),
  player('Ayami Sato', 'Chiba, Japan', 'p3'),
]

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchWpblAllPlayers: () => Promise.resolve(ROSTER),
    fetchWpblTeams: () => Promise.resolve([]),
    fetchWpblVideos: () => Promise.resolve([]),
    fetchWpblArticles: () => Promise.resolve([]),
    fetchWpblPhotos: () => Promise.resolve([]),
    getCachedWpblVideos: () => [],
    getCachedWpblArticles: () => [],
    getCachedWpblPhotos: () => [],
  }
})

const { default: WpblLeaguePage } = await import('../LeaguePage')

const show = () => render(<WpblLeaguePage onNavigate={() => {}} />)

/** A country's fold control, which is its whole heading row. */
const heading = (country: string) =>
  screen.getByRole('heading', { name: new RegExp(country) }).closest('[aria-expanded]') as HTMLElement

beforeEach(() => { vi.clearAllMocks() })

describe('the league page’s country sections', () => {
  it('renders every country open, so the roster is the page rather than a menu', async () => {
    show()
    await screen.findByText('Denae Benites')
    expect(heading('USA').getAttribute('aria-expanded')).toBe('true')
    expect(heading('Japan').getAttribute('aria-expanded')).toBe('true')
  })

  it('keeps a closed country’s player links in the document', async () => {
    show()
    await screen.findByText('Denae Benites')
    fireEvent.click(heading('USA'))
    await waitFor(() => expect(heading('USA').getAttribute('aria-expanded')).toBe('false'))

    // Still queryable, still an anchor, still pointing at the player's canonical URL. This is
    // the assertion the comment in LeaguePage.tsx is about.
    const link = screen.getByText('Denae Benites').closest('a')
    expect(link).not.toBeNull()
    expect(link!.getAttribute('href')).toBe('/wpbl/players/denae-benites')
  })

  it('folds one country without folding the others', async () => {
    show()
    await screen.findByText('Ayami Sato')
    fireEvent.click(heading('USA'))
    await waitFor(() => expect(heading('USA').getAttribute('aria-expanded')).toBe('false'))
    expect(heading('Japan').getAttribute('aria-expanded')).toBe('true')
  })

  it('collapses and restores every country from one control', async () => {
    show()
    await screen.findByText('Ayami Sato')
    fireEvent.click(screen.getByText('Collapse all'))
    await waitFor(() => expect(heading('USA').getAttribute('aria-expanded')).toBe('false'))
    expect(heading('Japan').getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(screen.getByText('Expand all'))
    await waitFor(() => expect(heading('USA').getAttribute('aria-expanded')).toBe('true'))
    expect(heading('Japan').getAttribute('aria-expanded')).toBe('true')
  })
})

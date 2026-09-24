import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { WpblPlayer } from '../types'

// /wpbl/league shows one country's players at a time, picked from chips, and the thing that has
// to survive that is the anchors. This page carries a link to every player and the crawl path
// they make is part of why it exists, so a country that is not picked must HIDE its grid rather
// than render nothing: returning null would delete those links from the document a crawler
// reads, while looking identical to a human. Nothing else would catch that.

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
    fetchWpblSchedule: () => Promise.resolve([]),
  }
})

const { default: WpblLeaguePage } = await import('../LeaguePage')

const show = () => render(<WpblLeaguePage onNavigate={() => {}} />)

/** A country's chip, found by its name. */
const chip = (country: string) =>
  screen.getAllByRole('button').find(b => b.textContent?.includes(country)) as HTMLElement

/** Whether a player's grid is on screen (not merely in the document). */
const gridShown = (name: string) =>
  (screen.getByText(name).closest('a')!.parentElement as HTMLElement).style.display !== 'none'
  && getComputedStyle(screen.getByText(name).closest('a')!.parentElement as HTMLElement).display !== 'none'

beforeEach(() => { vi.clearAllMocks() })

describe('About the league: where the players are from', () => {
  it('is titled About the league', async () => {
    show()
    expect(await screen.findByRole('heading', { name: 'About the league' })).toBeTruthy()
  })

  it('keeps every player link in the document before any country is picked', async () => {
    show()
    await screen.findByText('Denae Benites')
    for (const [name, slug] of [['Denae Benites', 'denae-benites'], ['Ayami Sato', 'ayami-sato']]) {
      const link = screen.getByText(name).closest('a')
      expect(link).not.toBeNull()
      expect(link!.getAttribute('href')).toBe(`/wpbl/players/${slug}`)
    }
    expect(gridShown('Denae Benites')).toBe(false)
    expect(gridShown('Ayami Sato')).toBe(false)
  })

  it('shows one country at a time', async () => {
    show()
    await screen.findByText('Ayami Sato')
    fireEvent.click(chip('USA'))
    expect(chip('USA').getAttribute('aria-pressed')).toBe('true')
    expect(gridShown('Denae Benites')).toBe(true)
    expect(gridShown('Ayami Sato')).toBe(false)

    fireEvent.click(chip('Japan'))
    expect(gridShown('Denae Benites')).toBe(false)
    expect(gridShown('Ayami Sato')).toBe(true)
  })

  it('closes a country when its chip is tapped again', async () => {
    show()
    await screen.findByText('Ayami Sato')
    fireEvent.click(chip('Japan'))
    fireEvent.click(chip('Japan'))
    expect(chip('Japan').getAttribute('aria-pressed')).toBe('false')
    expect(gridShown('Ayami Sato')).toBe(false)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { InternationalEvent } from '../../intl/wbsc/international'

// The World Cup on the player page: public, drawn empty from the bundled shapes before its read
// lands, and never asked for a player the shapes do not list (see player/WorldCup.tsx).

const reads = vi.hoisted(() => ({ calls: [] as string[], rows: [] as { events: InternationalEvent[] }[], hold: false }))

vi.mock('../../lib/analytics', () => ({ EVENTS: { WPBL_WORLD_CUP_OPENED: 'wpbl_world_cup_opened' }, track: vi.fn() }))
vi.mock('../../intl/wpblWorldCups.json', () => ({
  default: {
    p1: { batting: 1, pitching: 1, names: ['Dana Lee-Ann Quill'] },
    p3: { batting: 1, pitching: 1, names: ['Dana Quill'] },
  },
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, id: string) => {
          reads.calls.push(`${table}:${id}`)
          return reads.hold ? new Promise(() => {}) : Promise.resolve({ data: reads.rows, error: null })
        },
      }),
    }),
  },
}))

const { WorldCupSection, useWorldCupEvents, hasWorldCup, eventLabel } = await import('../player/WorldCup')

/** As PlayerDetail wires it: the page reads the rows, the section draws them. */
function Card({ id, name = 'Dana Quill' }: { id: string; name?: string }) {
  return <WorldCupSection events={useWorldCupEvents(id)} playerId={id} playerName={name} accent="#036" />
}

const EVENT: InternationalEvent = {
  event_key: '2023-ix-womens-baseball-world-cup-group-a', event: 'Test', year: 2023, team_id: 'AAA',
  wbsc_name: 'Dana Lee-Ann Quill', wbsc_id: 'wbsc:p:1:1', url: 'https://example.test/event',
  batting: { g: 5, pa: 20, ab: 16, r: 3, h: 6, doubles: 1, triples: 0, hr: 1, rbi: 4, bb: 3, ibb: 0, so: 2, hbp: 1, sb: 1, cs: 0, sf: 0, sh: 0, gdp: 0, tb: 10 },
  pitching: { g: 2, gs: 1, outs: 14, bf: 20, h: 3, r: 2, er: 2, bb: 1, so: 5, hr: 0, hbp: 0, wp: 0, bk: 0, pitches: 70, strikes: 44, w: 1, l: 0, sv: 0 },
  games: [],
}

beforeEach(() => { reads.calls = []; reads.rows = []; reads.hold = false })

describe('World Cup section', () => {
  it('draws every reader a row per event, with the WBSC name it matched and the credit', async () => {
    reads.rows = [{ events: [EVENT] }]
    render(<Card id="p1" />)
    await waitFor(() => expect(screen.getAllByText('2023 Group A')).toHaveLength(2))
    expect(reads.calls).toEqual(['wbsc_world_cup_lines:p1'])
    expect(screen.getByText('.375')).toBeTruthy() // 6 for 16
    expect(screen.getByText('4.2')).toBeTruthy() // 14 outs
    expect(screen.getByText(/Dana Lee-Ann Quill/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'WBSC' }).getAttribute('href')).toBe('https://www.wbsc.org')
    expect(screen.queryByText(/preview/i)).toBeNull()
  })

  it('draws the table empty, at its shape, while the read is out', () => {
    reads.hold = true
    const { container } = render(<Card id="p1" />)
    expect(screen.getByText('World Cup')).toBeTruthy()
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(screen.getByText('Batting')).toBeTruthy()
    expect(screen.getByText('Pitching')).toBeTruthy()
    expect(screen.queryByText('2023 Group A')).toBeNull()
    // The name line is in the empty state too, so it does not arrive with the rows.
    expect(screen.getByText(/Dana Lee-Ann Quill/)).toBeTruthy()
  })

  it('leaves out the WBSC name when it is the roster name', async () => {
    reads.rows = [{ events: [{ ...EVENT, wbsc_name: 'Dana Quill' }] }]
    render(<Card id="p3" />)
    await waitFor(() => expect(screen.getAllByText('2023 Group A')).toHaveLength(2))
    expect(screen.queryByText(/WBSC name/)).toBeNull()
  })

  it('asks for nothing and draws nothing for a player with no World Cup', async () => {
    const { container } = render(<Card id="p2" />)
    await new Promise(r => setTimeout(r, 0))
    expect(hasWorldCup('p2')).toBe(false)
    expect(reads.calls).toEqual([])
    expect(container.textContent).toBe('')
  })

  it('draws nothing once the table answers empty (a takedown after this build)', async () => {
    const { container } = render(<Card id="p1" />)
    await waitFor(() => expect(reads.calls).toEqual(['wbsc_world_cup_lines:p1']))
    await waitFor(() => expect(container.textContent).toBe(''))
  })

  it('names each event as a stat table would', () => {
    expect(eventLabel('2016-womens-baseball-world-cup')).toBe('2016')
    expect(eventLabel('2024-ix-womens-baseball-world-cup-finals')).toBe('2024 Finals')
    expect(eventLabel('2026-x-womens-baseball-world-cup-group-stage-rockford')).toBe('2026 Rockford')
  })
})

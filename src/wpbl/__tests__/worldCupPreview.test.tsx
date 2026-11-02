import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { InternationalEvent } from '../../intl/wbsc/international'

// The World Cup preview on the player page: drawn for the owner from the owner-only table, and for
// nobody else, who must not even ask (the table refuses them; see player/WorldCup.tsx).

const admin = vi.hoisted(() => ({ owner: false }))
const reads = vi.hoisted(() => ({ calls: [] as string[], rows: [] as { events: InternationalEvent[] }[] }))

vi.mock('../../lib/admin', () => ({ useIsAdmin: () => admin.owner }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, id: string) => { reads.calls.push(`${table}:${id}`); return Promise.resolve({ data: reads.rows, error: null }) },
      }),
    }),
  },
}))

const { WorldCupSection, useWorldCupEvents, eventLabel } = await import('../player/WorldCup')

/** As PlayerDetail wires it: the page reads the rows, the section draws them. */
function Card({ id, name = 'Dana Quill' }: { id: string; name?: string }) {
  return <WorldCupSection events={useWorldCupEvents(id)} playerName={name} accent="#036" />
}

const EVENT: InternationalEvent = {
  event_key: '2023-ix-womens-baseball-world-cup-group-a', event: 'Test', year: 2023, team_id: 'AAA',
  wbsc_name: 'Dana Lee-Ann Quill', wbsc_id: 'wbsc:p:1:1', url: 'https://example.test/event',
  batting: { g: 5, pa: 20, ab: 16, r: 3, h: 6, doubles: 1, triples: 0, hr: 1, rbi: 4, bb: 3, ibb: 0, so: 2, hbp: 1, sb: 1, cs: 0, sf: 0, sh: 0, gdp: 0, tb: 10 },
  pitching: { g: 2, gs: 1, outs: 14, bf: 20, h: 3, r: 2, er: 2, bb: 1, so: 5, hr: 0, hbp: 0, wp: 0, bk: 0, pitches: 70, strikes: 44, w: 1, l: 0, sv: 0 },
  games: [],
}

beforeEach(() => { admin.owner = false; reads.calls = []; reads.rows = [] })

describe('World Cup preview', () => {
  it('asks for nothing and draws nothing for anyone but the owner', async () => {
    reads.rows = [{ events: [EVENT] }]
    const { container } = render(<Card id="p1" />)
    await new Promise(r => setTimeout(r, 0))
    expect(reads.calls).toEqual([])
    expect(container.textContent).toBe('')
  })

  it('draws the owner a row per event, with the WBSC name it matched', async () => {
    admin.owner = true
    reads.rows = [{ events: [EVENT] }]
    render(<Card id="p1" />)
    await waitFor(() => expect(screen.getByText('World Cup')).toBeTruthy())
    expect(reads.calls).toEqual(['wbsc_world_cup_lines:p1'])
    expect(screen.getAllByText('2023 Group A')).toHaveLength(2)
    expect(screen.getByText('.375')).toBeTruthy() // 6 for 16
    expect(screen.getByText('4.2')).toBeTruthy() // 14 outs
    expect(screen.getByText('3.00')).toBeTruthy() // 2 ER in 14 outs, per seven
    expect(screen.getByText(/Dana Lee-Ann Quill/)).toBeTruthy()
  })

  it('leaves out the WBSC name when it is the roster name', async () => {
    admin.owner = true
    reads.rows = [{ events: [{ ...EVENT, wbsc_name: 'Dana Quill' }] }]
    render(<Card id="p1" />)
    await waitFor(() => expect(screen.getByText('World Cup')).toBeTruthy())
    expect(screen.queryByText(/WBSC name/)).toBeNull()
  })

  it('draws nothing for an owner looking at a player with no World Cup', async () => {
    admin.owner = true
    const { container } = render(<Card id="p2" />)
    await waitFor(() => expect(reads.calls).toEqual(['wbsc_world_cup_lines:p2']))
    expect(container.textContent).toBe('')
  })

  it('names each event as a stat table would', () => {
    expect(eventLabel('2016-womens-baseball-world-cup')).toBe('2016')
    expect(eventLabel('2024-ix-womens-baseball-world-cup-finals')).toBe('2024 Finals')
    expect(eventLabel('2026-x-womens-baseball-world-cup-group-stage-rockford')).toBe('2026 Rockford')
  })
})

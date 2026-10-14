import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { RoadmapItem } from '../lib/roadmap'

// The roadmap writes positions by swapping two rows, and a row that changes tier must land at the
// bottom of its new one. Both are easy to get subtly wrong (a swap that writes the same number
// twice, a moved row that collides with the new tier's first), and the page only shows it after a
// reload, so they are pinned here against a stubbed table.

const rows: RoadmapItem[] = []
const update = vi.fn(async () => true)

vi.mock('../lib/roadmap', async importOriginal => {
  const real = await importOriginal<typeof import('../lib/roadmap')>()
  return {
    ...real,
    fetchRoadmap: vi.fn(async () => rows.map(r => ({ ...r }))),
    updateRoadmapItem: (...a: unknown[]) => (update as (...x: unknown[]) => Promise<boolean>)(...a),
    addRoadmapItem: vi.fn(async (r: Partial<RoadmapItem>) => ({ ...r, id: 'new', done_at: null, created_at: '', updated_at: '' })),
    deleteRoadmapItem: vi.fn(async () => true),
  }
})

const item = (id: string, priority: RoadmapItem['priority'], position: number): RoadmapItem => ({
  id, title: `Item ${id}`, notes: '', priority, area: 'site', position, done_at: null, created_at: '', updated_at: '',
})

beforeEach(() => {
  rows.splice(0, rows.length, item('a', 'P1', 1), item('b', 'P1', 2), item('c', 'P2', 1), item('d', 'P2', 5))
  update.mockClear()
})

describe('AdminRoadmap', () => {
  it('swaps positions with the neighbour when a row moves down', async () => {
    const { default: AdminRoadmap } = await import('../AdminRoadmap')
    render(<AdminRoadmap />)
    fireEvent.click(await screen.findByRole('button', { name: 'Move Item a down' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    expect(update).toHaveBeenCalledWith('a', { position: 2 })
    expect(update).toHaveBeenCalledWith('b', { position: 1 })
  })

  it('sends a row that changes tier to the bottom of the new tier', async () => {
    const { default: AdminRoadmap } = await import('../AdminRoadmap')
    render(<AdminRoadmap />)
    const select = await screen.findByRole('combobox', { name: 'Priority of Item a' })
    fireEvent.mouseDown(select)
    fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'P2' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('a', { priority: 'P2', position: 6 }))
  })
})

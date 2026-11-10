// How the box behaves while its answers are still arriving (Nov 10, 2026 audit): a row landing above
// the lit one does not take the highlight from it, a miss on the way to a word keeps the last rows up
// instead of flashing the examples, and an answer kept by its row's link is not asked again.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CommandPalette from '../CommandPalette'
import type { PlayerQuestionRow, SearchBridgeState } from '../mlb/state/SearchBridgeContext'

vi.mock('../lib/analytics', async importOriginal => ({ ...await importOriginal<typeof import('../lib/analytics')>(), track: vi.fn() }))

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const lit = () => screen.getAllByRole('option').find(o => o.getAttribute('aria-selected') === 'true')

describe('while the answers arrive', () => {
  afterEach(() => cleanup())

  it('keeps the highlight on the row the reader has seen when a row lands above it', async () => {
    const user = userEvent.setup()
    const resolveCompare: SearchBridgeState['resolveCompare'] = async () => ({ title: 'Kelsie Whitmore vs Diana Ibarra', subtitle: 'Seasons side by side', href: '/wpbl/compare/x' })
    // The batter-vs-pitcher row, which leads its group order, arrives well after the comparison.
    const bvp: PlayerQuestionRow = { key: 'player-q-bvp', title: 'Diana Ibarra vs Kelsie Whitmore', subtitle: 'Batting, plate appearances', href: '/wpbl/stats?board=find&q=pa', matchup: true }
    const resolvePlayerQuestion: SearchBridgeState['resolvePlayerQuestion'] = async () => { await sleep(500); return [bvp] }
    render(<CommandPalette open onClose={() => {}} section="wpbl" results={[]} idle={[]} searching={false}
      resolveCompare={resolveCompare} resolvePlayerQuestion={resolvePlayerQuestion} />)
    await user.type(screen.getByRole('combobox'), 'whitmore vs ibarra')
    await waitFor(() => expect(lit()).toHaveTextContent('Kelsie Whitmore vs Diana Ibarra'))
    await waitFor(() => expect(screen.getAllByRole('option')[0]).toHaveTextContent('Diana Ibarra vs Kelsie Whitmore'), { timeout: 2000 })
    expect(lit()).toHaveTextContent('Kelsie Whitmore vs Diana Ibarra')
  })

  it('keeps the last rows up through a miss until the text settles, and Enter does nothing on them', async () => {
    const user = userEvent.setup()
    render(<CommandPalette open onClose={() => {}} section="wpbl" results={[]} idle={[]} searching={false} />)
    await user.type(screen.getByRole('combobox'), 'standings')
    expect(screen.getByRole('option', { name: /Standings/ })).toBeInTheDocument()
    await user.type(screen.getByRole('combobox'), 'qq')
    // Still the last answer, not the fifteen examples, and no "Nothing matches" yet.
    expect(screen.getByRole('option', { name: /Standings/ })).toBeInTheDocument()
    expect(screen.queryByText(/Nothing matches/)).not.toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('combobox')).toHaveValue('standingsqq')
    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /^Standings/ })).not.toBeInTheDocument()
  })

  it('asks for a Find row’s count once, and keeps it as the text moves on', async () => {
    const user = userEvent.setup()
    const resolveFindAnswer = vi.fn(async () => ({ text: '6 times · last Sep 3', target: null }))
    render(<CommandPalette open onClose={() => {}} section="wpbl" results={[]} idle={[]} searching={false} resolveFindAnswer={resolveFindAnswer} />)
    const box = screen.getByRole('combobox')
    await user.type(box, '2 hr')
    await waitFor(() => expect(screen.getAllByRole('option')[0]).toHaveTextContent('6 times'))
    const asked = resolveFindAnswer.mock.calls.length
    // Typed on and back: the same rows, so the count is there at once and is not asked again.
    await user.type(box, 'x')
    await user.type(box, '{Backspace}')
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('6 times')
    await act(() => sleep(200))
    expect(resolveFindAnswer.mock.calls.length).toBe(asked)
  })

  it('opens on what was typed before it was there, and goes on from it', async () => {
    const user = userEvent.setup()
    render(<CommandPalette open onClose={() => {}} section="wpbl" results={[]} idle={[]} searching={false} takeTypeahead={() => 'standi'} />)
    const box = screen.getByRole('combobox') as HTMLInputElement
    expect(box.value).toBe('standi')
    expect(screen.getByRole('option', { name: /Standings/ })).toBeInTheDocument()
    await act(() => sleep(0))
    await user.type(box, 'ngs')
    expect(box.value).toBe('standings')
  })
})

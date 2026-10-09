import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, act, fireEvent } from '@testing-library/react'
import { traverse } from '../../test/history'
import { TeamPickerSheet } from '../views/TeamPicker'

// The follow-a-team sheet. Following lands on Home, so a pick has to take the sheet's history entry
// down BEFORE it follows: followed first, the entry would be left under Home for the next Back to
// stop on, and Back would appear to do nothing.

describe('the team picker sheet', () => {
  beforeEach(() => { window.history.replaceState({ view: 'home' }, '', '/mlb') })

  it('lists all thirty clubs by division and marks the ones still playing', () => {
    const { getAllByRole, getByText, getByLabelText } = render(
      <TeamPickerSheet onSelect={() => {}} onClose={() => {}} playing={new Set([144])} />,
    )
    expect(getAllByRole('button', { name: /^Follow the / })).toHaveLength(30)
    for (const d of ['AL East', 'AL Central', 'AL West', 'NL East', 'NL Central', 'NL West']) getByText(d)
    getByText('Still playing this postseason')
    getByLabelText('Follow the Braves')
  })

  it('pops its own entry first, then follows', async () => {
    const order: string[] = []
    const onClose = vi.fn(() => order.push(`close@${window.history.state?.mlbSheet ?? 'none'}`))
    const onSelect = vi.fn((id: number) => order.push(`follow ${id}@${window.history.state?.mlbSheet ?? 'none'}`))
    const { getByLabelText } = render(<TeamPickerSheet onSelect={onSelect} onClose={onClose} />)
    expect(window.history.state).toMatchObject({ mlbSheet: 1 })
    await act(async () => { await traverse(() => { fireEvent.click(getByLabelText('Follow the Mariners')) }) })
    expect(order).toEqual(['close@none', 'follow 136@none'])
    expect(window.history.state).toEqual({ view: 'home' })
  })

  it('Back closes it without following anyone', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<TeamPickerSheet onSelect={onSelect} onClose={onClose} />)
    await act(async () => { await traverse(() => window.history.back()) })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })
})

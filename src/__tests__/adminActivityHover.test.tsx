import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { DayPoint } from '../lib/analyticsAdmin'

// The activity panel plots two series scaled to their OWN peaks, which is what makes it
// readable and also what makes it impossible to read a value off it: there is no shared axis,
// and the only labels are the two peaks. So the chart has to answer "what happened on this
// day" directly, and that answer is this file.

vi.mock('../AuthContext', () => ({
  useAuth: () => ({ user: null, openAuthDialog: () => {} }),
}))

const { ActivityChart } = await import('../AdminPage')
const { shortDate } = await import('../lib/analyticsAdmin')

const SERIES: DayPoint[] = [
  { date: '2026-09-07', events: 900,  browsers: 140 },
  { date: '2026-09-08', events: 1500, browsers: 260 },
  { date: '2026-09-09', events: 400,  browsers: 90  },
  { date: '2026-09-10', events: 2000, browsers: 410 },
] as DayPoint[]

const draw = () => render(<ActivityChart series={SERIES} tz="America/Chicago" />)
const plot = () => document.querySelector('[data-swipe-lock]') as HTMLElement
/** The readout's own date, which is NOT the same node as the axis end labels: those always
 *  print the first and last day of the range, so on the last day the two legitimately agree
 *  and a bare text query finds both. */
const readoutDate = () => document.querySelector('[aria-live="polite"]')?.textContent ?? ''

describe('reading a day off the activity chart', () => {
  it('shows the two peaks and no date until the reader points at it', () => {
    draw()
    expect(screen.getByText(/peak 2k/)).toBeTruthy()
    expect(screen.getByText(/peak 410/)).toBeTruthy()
    // The axis ends are always drawn; what must NOT be there is a day being reported.
    expect(readoutDate()).toBe('')
  })

  it('names the day under the cursor and both of its numbers', () => {
    draw()
    // The first press seeds the cursor at the end rather than stepping off it, so one press
    // lands on the last day and the second on the one before it.
    fireEvent.keyDown(plot(), { key: 'ArrowLeft' })
    fireEvent.keyDown(plot(), { key: 'ArrowLeft' })

    // Sep 9: the trough. Deliberately not the peak day, so a chart that just reported its
    // maximum would fail this.
    expect(readoutDate()).toBe(shortDate('2026-09-09'))
    expect(screen.getByText('400')).toBeTruthy()
    expect(screen.getByText('90')).toBeTruthy()
    // And the peaks give way to the day, so the panel never shows two numbers for one series.
    expect(screen.queryByText(/peak 2k/)).toBeNull()
  })

  it('lets go when the reader leaves, so a stale day is never left on screen', () => {
    draw()
    fireEvent.keyDown(plot(), { key: 'ArrowLeft' })
    expect(readoutDate()).toBe(shortDate('2026-09-10'))
    fireEvent.blur(plot())
    expect(readoutDate()).toBe('')
    expect(screen.getByText(/peak 2k/)).toBeTruthy()
  })

  // One day is not a shape, and the panel says so instead of drawing a triangle. The hook has
  // to be called anyway or the mount that grows into a real range breaks the rules of hooks.
  it('still renders the one-day summary rather than a chart', () => {
    render(<ActivityChart series={[SERIES[0]]} tz="America/Chicago" />)
    expect(screen.getByText(/a trend needs at least two days/)).toBeTruthy()
    expect(document.querySelector('[data-swipe-lock]')).toBeNull()
  })
})

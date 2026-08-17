import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import WpblBottomNav from '../BottomNav'

// The bar shows an optimistic selection: it moves to the tapped tab immediately and hands the
// real navigation to the next frame. That leaves one failure mode worth pinning down. If the
// navigation never lands, the optimistic state used to persist forever, and because the
// "already here?" guard compares against the OPTIMISTIC tab rather than the real one, every
// subsequent tap was swallowed. One stalled navigation killed the bar for the session.

const ITEMS = [
  { key: 'home', label: 'Home' },
  { key: 'teams', label: 'Teams' },
]

const selectedLabel = () =>
  screen.getAllByRole('tab').find(el => el.getAttribute('aria-selected') === 'true')?.getAttribute('aria-label')

describe('WpblBottomNav optimistic selection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // The component hands navigation to rAF; run it inline so the test drives the real path.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('moves to the tapped tab before the parent confirms', () => {
    const onChange = vi.fn()
    render(<WpblBottomNav items={ITEMS} value="home" onChange={onChange} />)

    act(() => { screen.getByRole('tab', { name: 'Teams' }).click() })

    expect(selectedLabel()).toBe('Teams')
    expect(onChange).toHaveBeenCalledWith('teams')
  })

  it('recovers when the navigation never lands, and accepts taps again', () => {
    // A parent that ignores onChange: `value` stays "home" forever.
    const onChange = vi.fn()
    render(<WpblBottomNav items={ITEMS} value="home" onChange={onChange} />)

    act(() => { screen.getByRole('tab', { name: 'Teams' }).click() })
    expect(selectedLabel()).toBe('Teams')

    // Give up on the optimistic state and show where the reader actually is.
    act(() => { vi.advanceTimersByTime(2100) })
    expect(selectedLabel()).toBe('Home')

    // The regression this guards: a second tap used to hit the "already there" guard,
    // because the guard compared against the stale optimistic tab.
    act(() => { screen.getByRole('tab', { name: 'Teams' }).click() })
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('ignores a tap on the tab already being travelled to', () => {
    const onChange = vi.fn()
    render(<WpblBottomNav items={ITEMS} value="home" onChange={onChange} />)

    act(() => { screen.getByRole('tab', { name: 'Teams' }).click() })
    act(() => { screen.getByRole('tab', { name: 'Teams' }).click() })

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('names a badged tab so the dot is not purely visual', () => {
    render(<WpblBottomNav
      items={[{ key: 'home', label: 'Home' }, { key: 'teams', label: 'Teams', badge: true }]}
      value="home"
      onChange={() => {}}
    />)
    expect(screen.getByRole('tab', { name: 'Teams, updated' })).toBeInTheDocument()
  })
})

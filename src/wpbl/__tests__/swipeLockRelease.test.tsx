import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import SwipeableViews from '../SwipeableViews'

// SWIPING A TAB, THEN TOUCHING SOMETHING THE PAGER DOES NOT OWN, USED TO PAGE AGAIN.
//
// Reported on a phone: swipe on the standings chart, keep the finger down, and the tab changes
// the moment you let go. The chart sets `data-swipe-lock`, so the pager declines the gesture at
// touchstart. What it did not do was CLEAR the previous gesture: `g.current` outlives a touch,
// `onEnd` bails only when `lock !== 'h'`, and a completed swipe leaves `lock` at 'h'. So the
// next touchend the pager never tracked still ran the commit path, on the previous gesture's
// direction, offset and velocity.
//
// The chart is only where it shows. Anything the pager refuses inherits the same stale lock,
// which includes the win probability chart on Game Center, live since August.

const mobile = () => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true, configurable: true,
    value: (q: string) => ({
      matches: /max-width/.test(q), media: q, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }),
  })
}

/** A touch event jsdom will dispatch: only clientX/clientY and the target are ever read. */
function touch(el: Element, type: string, x: number, y: number) {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  const point = { clientX: x, clientY: y, identifier: 1, target: el }
  Object.assign(ev, {
    touches: type === 'touchend' ? [] : [point],
    changedTouches: [point],
  })
  act(() => { el.dispatchEvent(ev) })
}

/** A committed right-to-left swipe across ordinary content: far enough to page a tab. */
function swipeToNextTab(el: Element) {
  touch(el, 'touchstart', 340, 300)
  for (const x of [300, 240, 170, 90, 20]) touch(el, 'touchmove', x, 300)
  touch(el, 'touchend', 20, 300)
}

function draw(onIndexChange = vi.fn()) {
  render(
    <SwipeableViews
      index={0}
      onIndexChange={onIndexChange}
      panels={[
        <div key="a" data-testid="pane-a" style={{ height: 900 }}>
          <div data-testid="plain">ordinary content</div>
          <div data-swipe-lock data-testid="chart">a chart that owns its own drags</div>
        </div>,
        <div key="b" style={{ height: 900 }}>second tab</div>,
      ]}
    />,
  )
  return onIndexChange
}

beforeEach(() => {
  mobile()
  vi.useFakeTimers()
})

describe('a touch the pager declines', () => {
  it('does not page the tab, however the last gesture ended', () => {
    const onIndexChange = draw()
    // First, a real swipe that pages the tab. This is what leaves a horizontal lock behind.
    swipeToNextTab(screen.getByTestId('plain'))
    act(() => { vi.advanceTimersByTime(600) })
    const pagedOnce = onIndexChange.mock.calls.length

    // Then a plain touch on the chart: down, hold, up, without moving a pixel.
    onIndexChange.mockClear()
    const chart = screen.getByTestId('chart')
    touch(chart, 'touchstart', 180, 400)
    act(() => { vi.advanceTimersByTime(400) })
    touch(chart, 'touchend', 180, 400)
    act(() => { vi.advanceTimersByTime(600) })

    // The tab must not have moved. Before the fix this replayed the swipe above.
    expect(onIndexChange).not.toHaveBeenCalled()
    // And the first swipe really did page, or this test would be asserting nothing.
    expect(pagedOnce).toBeGreaterThan(0)
  })

  it('does not page the tab when the finger drags along the chart either', () => {
    const onIndexChange = draw()
    swipeToNextTab(screen.getByTestId('plain'))
    act(() => { vi.advanceTimersByTime(600) })

    onIndexChange.mockClear()
    // A scrub: the same shape as the swipe that just paged, but on the element that owns it.
    swipeToNextTab(screen.getByTestId('chart'))
    act(() => { vi.advanceTimersByTime(600) })
    expect(onIndexChange).not.toHaveBeenCalled()
  })

  it('still pages an ordinary swipe after one the chart swallowed', () => {
    // The reset must not leave the pager deaf: a refusal clears the state, it does not disable
    // anything. This is the half a too-eager fix would break.
    const onIndexChange = draw()
    swipeToNextTab(screen.getByTestId('chart'))
    act(() => { vi.advanceTimersByTime(600) })
    expect(onIndexChange).not.toHaveBeenCalled()

    swipeToNextTab(screen.getByTestId('plain'))
    act(() => { vi.advanceTimersByTime(600) })
    expect(onIndexChange).toHaveBeenCalled()
  })
})

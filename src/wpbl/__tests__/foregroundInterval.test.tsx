import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { useForegroundInterval } from '../refresh'

// The section's polling policy, pinned. Every one of these is a failure that shows up as a
// page quietly serving old data rather than as an error, which is why they are worth a test:
// nothing on screen says a poll stopped, and the countdown beside it keeps ticking either way.

let visibility: DocumentVisibilityState = 'visible'

function setVisibility(v: DocumentVisibilityState) {
  visibility = v
  document.dispatchEvent(new Event('visibilitychange'))
}

function Poller({ fn, ms }: { fn: () => void; ms: number | null }) {
  useForegroundInterval(fn, ms)
  return null
}

beforeEach(() => {
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useForegroundInterval', () => {
  it('ticks while the page is in front', () => {
    const fn = vi.fn()
    render(<Poller fn={fn} ms={1000} />)
    act(() => { vi.advanceTimersByTime(3500) })
    expect(fn).toHaveBeenCalledTimes(3)
  })

  // The reason the timer is gated at all: a backgrounded phone browser throttles timers but
  // does not stop them, so an ungated poll wakes the radio for a screen that is off.
  it('stops while the page is hidden', () => {
    const fn = vi.fn()
    render(<Poller fn={fn} ms={1000} />)
    act(() => { setVisibility('hidden') })
    act(() => { vi.advanceTimersByTime(10000) })
    expect(fn).not.toHaveBeenCalled()
  })

  it('pulls once on the way back, then resumes ticking', () => {
    const fn = vi.fn()
    render(<Poller fn={fn} ms={1000} />)
    act(() => { setVisibility('hidden') })
    act(() => { vi.advanceTimersByTime(10000) })
    act(() => { setVisibility('visible') })
    expect(fn).toHaveBeenCalledTimes(1) // immediately, not a second later
    act(() => { vi.advanceTimersByTime(2000) })
    expect(fn).toHaveBeenCalledTimes(3)
  })

  // THE ONE THIS WAS WRITTEN FOR. iOS Safari restores a page from the back/forward cache with
  // its timers frozen and, on some restores, fires no `visibilitychange` at all. Without a
  // `pageshow` listener nothing restarts the loop and the page serves whatever it held when it
  // was frozen, for as long as the tab stays open.
  it('recovers from a bfcache restore that fires only pageshow', () => {
    const fn = vi.fn()
    render(<Poller fn={fn} ms={1000} />)
    // Frozen: no visibilitychange, so the hook still believes it is ticking.
    act(() => { vi.advanceTimersByTime(500) })
    fn.mockClear()
    act(() => { window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true })) })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  // A fresh load fires pageshow too. Refreshing on that one would double every cold start,
  // since the caller has already done its initial read.
  it('ignores a pageshow that is not a restore', () => {
    const fn = vi.fn()
    render(<Poller fn={fn} ms={1000} />)
    act(() => { window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false })) })
    expect(fn).not.toHaveBeenCalled()
  })

  // A restore can fire pageshow, visibilitychange and focus within a few milliseconds of each
  // other. Three identical reads on a connection that has just woken up is the worst moment to
  // send them.
  it('collapses the pile-up of return events into one pull', () => {
    const fn = vi.fn()
    render(<Poller fn={fn} ms={1000} />)
    act(() => {
      window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  // `null` is "there is nothing to poll for" (no live game), and it has to be inert rather
  // than a loop doing no work: the listeners come off with it.
  it('runs nothing when the interval is null', () => {
    const fn = vi.fn()
    render(<Poller fn={fn} ms={null} />)
    act(() => { vi.advanceTimersByTime(10000) })
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(fn).not.toHaveBeenCalled()
  })

  // The callback is re-read every render rather than captured, so a poll that closes over
  // state does not have to tear down and rebuild its timer to see the new value, which would
  // restart the interval on every render and never actually reach it.
  it('calls the latest callback without restarting the timer', () => {
    const first = vi.fn(), second = vi.fn()
    const { rerender } = render(<Poller fn={first} ms={1000} />)
    act(() => { vi.advanceTimersByTime(900) })
    rerender(<Poller fn={second} ms={1000} />)
    act(() => { vi.advanceTimersByTime(100) })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('stops everything on unmount', () => {
    const fn = vi.fn()
    const { unmount } = render(<Poller fn={fn} ms={1000} />)
    unmount()
    act(() => { vi.advanceTimersByTime(5000) })
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(fn).not.toHaveBeenCalled()
  })
})

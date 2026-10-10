import { describe, it, expect, vi, afterEach } from 'vitest'
import { createEventQueue, type EventRow } from '../lib/eventQueue'

const row = (event: string): EventRow => ({ event, props: {}, path: '/wpbl', user_id: null, session_id: 's' })

describe('createEventQueue', () => {
  afterEach(() => vi.useRealTimers())

  // The whole point: a page load's burst is one insert, not one request per event.
  it('holds a burst and writes it as one batch', () => {
    vi.useFakeTimers()
    const send = vi.fn(), exit = vi.fn()
    const q = createEventQueue(send, exit, 1000)
    q.push(row('a')); q.push(row('b')); q.push(row('c'))
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].map((r: EventRow) => r.event)).toEqual(['a', 'b', 'c'])
    q.push(row('d'))
    vi.advanceTimersByTime(1000)
    expect(send).toHaveBeenCalledTimes(2)
  })

  // A page left inside the hold would lose the burst to a cancelled request.
  it('sends what it holds on exit, with the exit row, and nothing twice', () => {
    vi.useFakeTimers()
    const send = vi.fn(), exit = vi.fn()
    const q = createEventQueue(send, exit, 1000)
    q.push(row('a'))
    q.flushOnExit(row('vitals'))
    expect(exit).toHaveBeenCalledWith([row('a'), row('vitals')])
    vi.advanceTimersByTime(5000)
    expect(send).not.toHaveBeenCalled()
    q.flushOnExit()
    expect(exit).toHaveBeenCalledTimes(1)
  })
})

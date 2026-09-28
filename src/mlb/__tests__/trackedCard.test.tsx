import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const trackImpression = vi.fn()
vi.mock('../../lib/analytics', async orig => ({
  ...(await orig<typeof import('../../lib/analytics')>()),
  trackImpression: (...args: unknown[]) => trackImpression(...args),
}))

import { TrackedCard } from '../components/TrackedCard'
import { EVENTS } from '../../lib/analytics'

// jsdom has no IntersectionObserver. This one hands the test the callback, so "scrolled into
// view" is something the test does rather than something that happens on mount.
let fireIntersect: (on: boolean) => void = () => {}
class FakeIO {
  constructor(cb: (e: Array<{ isIntersecting: boolean }>) => void) { fireIntersect = on => cb([{ isIntersecting: on }]) }
  observe() {}
  disconnect() {}
}

describe('TrackedCard', () => {
  beforeEach(() => {
    trackImpression.mockClear()
    vi.stubGlobal('IntersectionObserver', FakeIO)
  })

  it('counts a card as seen when it scrolls into view, not when it renders', () => {
    render(<TrackedCard card="milestones"><p>card</p></TrackedCard>)
    expect(trackImpression).not.toHaveBeenCalled()
    fireIntersect(true)
    expect(trackImpression).toHaveBeenCalledWith(EVENTS.MLB_CARD_SEEN, { card: 'milestones' }, 'milestones')
  })

  it('counts any click inside as a use, even one the card stops', () => {
    render(
      <TrackedCard card="predictions">
        <button onClick={e => e.stopPropagation()}>Pick</button>
      </TrackedCard>,
    )
    fireEvent.click(screen.getByText('Pick'))
    expect(trackImpression).toHaveBeenCalledWith(EVENTS.MLB_CARD_USED, { card: 'predictions' }, 'predictions')
  })
})

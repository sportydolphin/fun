import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// The strip at the top of a phone's Home. It is an invitation, and the thing worth pinning is
// that it stops arriving once it has been accepted: a reader who has opened the ballot or voted
// in it already has the ballot card on the same page, and the strip is only taking the first
// line of the screen to repeat itself. See markFanAwardsEngaged in FanVote.tsx.
vi.mock('../../lib/analytics', () => ({ track: vi.fn(), EVENTS: new Proxy({}, { get: (_t, k) => String(k) }) }))

import { FanAwardsCta, markFanAwardsEngaged } from '../FanVote'

// Before the close, so the deadline is never what is being measured here.
const OPEN_AT = () => Date.parse('2026-09-11T12:00:00Z')
const strip = () => screen.queryByLabelText('Vote in the WPBL fan awards')

// THE FLAG IS A MODULE SINGLETON AND THERE IS NO WAY BACK OUT OF IT, on purpose: the strip is
// not dismissable, it is spent. So these run in order, the un-engaged case first, and the file
// cannot be reordered without the second case answering the first one's question.
describe('the fan awards strip', () => {
  it('invites a reader who has never been in', () => {
    render(<FanAwardsCta now={OPEN_AT} />)
    expect(strip()).not.toBeNull()
  })

  it('goes the moment the reader opens the ballot or votes', () => {
    const { rerender } = render(<FanAwardsCta now={OPEN_AT} />)
    markFanAwardsEngaged()
    rerender(<FanAwardsCta now={OPEN_AT} />)
    expect(strip()).toBeNull()
    expect(localStorage.getItem('wpbl.awards.engaged')).toBe('1')
  })

  it('takes itself down when voting closes, whoever the reader is', () => {
    render(<FanAwardsCta now={() => Date.parse('2027-01-01T00:00:00Z')} />)
    expect(strip()).toBeNull()
  })
})

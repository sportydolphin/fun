import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { requestSectionScroll, sectionAnchorId, useSectionScroll } from '../sectionScroll'

function Page({ drawn, onArrive }: { drawn: boolean; onArrive?: (id: string) => void }) {
  useSectionScroll(onArrive)
  return drawn ? <div id={sectionAnchorId('roster')}>Roster</div> : <div>Loading</div>
}

describe('useSectionScroll', () => {
  it('waits for the part to be drawn, scrolls to it once, and opens it first', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const onArrive = vi.fn()
    requestSectionScroll('roster')
    const { rerender } = render(<Page drawn={false} onArrive={onArrive} />)
    expect(scroll).not.toHaveBeenCalled()
    rerender(<Page drawn onArrive={onArrive} />)
    expect(onArrive).toHaveBeenCalledWith('section-roster')
    expect(scroll).toHaveBeenCalledOnce()
    // Spent: a later render of the same page does not scroll again.
    rerender(<Page drawn onArrive={onArrive} />)
    expect(scroll).toHaveBeenCalledOnce()
  })
})

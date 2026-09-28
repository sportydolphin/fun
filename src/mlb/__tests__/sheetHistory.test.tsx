import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { useSheetHistory, sheetOpen, pushEntry } from '../state/sheetHistory'

// On a phone, Back with Game Center open used to leave the MLB section. These pin the three
// things that stopped it: opening pushes one entry, Back closes, and a link out of the sheet
// replaces the sheet's entry rather than stacking a copy of the page under the next one.

function Sheet({ onClose, expose }: { onClose: () => void; expose: (close: () => void) => void }) {
  const close = useSheetHistory(onClose)
  expose(close)
  return <div>sheet</div>
}

// jsdom's history.back() is asynchronous and does fire popstate, like a browser.
const popped = () => new Promise(r => setTimeout(r, 20))

describe('sheet history', () => {
  beforeEach(() => { window.history.replaceState({ view: 'home' }, '', '/mlb') })

  it('pushes one entry on open, and Back closes the sheet', async () => {
    const before = window.history.length
    const onClose = vi.fn()
    render(<Sheet onClose={onClose} expose={() => {}} />)
    expect(window.history.length).toBe(before + 1)
    expect(window.history.state).toMatchObject({ view: 'home', mlbSheet: 1 })
    expect(sheetOpen()).toBe(true)
    await act(async () => { window.history.back(); await popped() })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(window.history.state).toEqual({ view: 'home' })
  })

  it('the close button pops its own entry rather than leaving it for Back to land on', async () => {
    const onClose = vi.fn()
    let close = () => {}
    render(<Sheet onClose={onClose} expose={c => { close = c }} />)
    await act(async () => { close(); await popped() })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(window.history.state).toEqual({ view: 'home' })
  })

  it('a link out of the sheet replaces its entry', () => {
    const onClose = vi.fn()
    render(<Sheet onClose={onClose} expose={() => {}} />)
    const before = window.history.length
    pushEntry({ view: 'search', playerId: 1 })
    expect(window.history.length).toBe(before)
    expect(window.history.state).toEqual({ view: 'search', playerId: 1 })
  })

  it('an ordinary navigation still pushes', () => {
    const before = window.history.length
    pushEntry({ view: 'stats' })
    expect(window.history.length).toBe(before + 1)
  })
})

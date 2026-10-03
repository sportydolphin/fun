import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useEffect, useState } from 'react'
import SwipeableViews from '../../ui/SwipeableViews'
import { PanelActiveContext } from '../../lib/panelActive'
import { useForegroundInterval } from '../../lib/foregroundInterval'
import { MlbPageH1 } from '../components/PageHeading'

// MLB's five tabs stay mounted once visited (MlbStats), because each fetches on mount and every tab
// change used to refetch the one arrived at. Keeping a tab alive is only half of it: a hidden tab
// must also stop polling and stop holding the page's h1, or keeping it costs more than it saves.

afterEach(() => { vi.useRealTimers() })

/** A tab that counts its own mounts, the way a view's fetch-on-mount would. */
const mounts: Record<string, number> = {}
function Tab({ name }: { name: string }) {
  useEffect(() => { mounts[name] = (mounts[name] ?? 0) + 1 }, [name])
  return <div>{name} tab</div>
}

describe('kept-alive tabs on a desktop', () => {
  it('mounts each tab once, however often the reader comes back to it', () => {
    const panels = [<Tab key="a" name="home" />, <Tab key="b" name="scores" />, <Tab key="c" name="standings" />]
    const view = (index: number) => <SwipeableViews keepAlive index={index} onIndexChange={() => {}} panels={panels} />
    const { rerender } = render(view(0))
    rerender(view(1))
    rerender(view(0))
    rerender(view(1))
    expect(mounts).toEqual({ home: 1, scores: 1 })
    // The one on screen is the only one laid out.
    expect(screen.getByText('scores tab').parentElement?.style.display).toBe('')
    expect(screen.getByText('home tab').parentElement?.style.display).toBe('none')
  })

  it('still swaps the active tab outright without keepAlive, as WPBL relies on', () => {
    const { rerender } = render(<SwipeableViews index={0} onIndexChange={() => {}} panels={[<div key="a">one</div>, <div key="b">two</div>]} />)
    rerender(<SwipeableViews index={1} onIndexChange={() => {}} panels={[<div key="a">one</div>, <div key="b">two</div>]} />)
    expect(screen.queryByText('one')).toBeNull()
  })
})

describe('a tab that is kept but not shown', () => {
  function Poller({ onTick }: { onTick: () => void }) {
    useForegroundInterval(onTick, 10_000)
    return null
  }
  let show: (v: boolean) => void = () => {}
  function Harness({ onTick }: { onTick: () => void }) {
    const [shown, setShown] = useState(true)
    show = setShown
    return <PanelActiveContext.Provider value={shown}><Poller onTick={onTick} /></PanelActiveContext.Provider>
  }
  const setShown = (v: boolean) => act(() => { show(v) })

  it('does not poll, and pulls once on return only if it missed a tick', () => {
    vi.useFakeTimers()
    const onTick = vi.fn()
    render(<Harness onTick={onTick} />)
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(onTick).toHaveBeenCalledTimes(1)

    // Away for less than the interval: nothing missed, so no catch-up pull on return.
    setShown(false)
    act(() => { vi.advanceTimersByTime(4_000) })
    setShown(true)
    expect(onTick).toHaveBeenCalledTimes(1)

    // Away for a minute: no ticks while hidden, one pull the moment it is back.
    setShown(false)
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(onTick).toHaveBeenCalledTimes(1)
    setShown(true)
    expect(onTick).toHaveBeenCalledTimes(2)
  })

  it('gives up the page heading', () => {
    window.history.replaceState({}, '', '/mlb/standings')
    render(<>
      <PanelActiveContext.Provider value={false}><MlbPageH1>MLB Scores</MlbPageH1></PanelActiveContext.Provider>
      <PanelActiveContext.Provider value={true}><MlbPageH1>MLB Standings</MlbPageH1></PanelActiveContext.Provider>
    </>)
    expect(screen.getAllByRole('heading', { level: 1 }).map(h => h.textContent)).toEqual(['MLB Standings'])
  })
})

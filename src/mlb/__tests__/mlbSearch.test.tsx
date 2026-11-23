import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Player } from '../types'

// StatsAPI is the slow half of the header search. Each test holds its answers open and lets them
// land in a chosen order.
const pending = new Map<string, (people: Player[]) => void>()
vi.mock('../api', () => ({
  searchPlayers: (name: string) => new Promise<Player[]>(res => pending.set(name, res)),
  searchPlayersForgiving: async () => [],
  fetchPlayerDetails: async () => null,
  fetchClubGames: async () => [],
}))
vi.mock('../playerIndex', () => ({
  loadMlbPlayerIndex: async () => {},
  mlbPlayerIndexReady: () => false,
  searchMlbPlayerIndex: () => [],
}))

const { MlbSearch } = await import('../MlbSearch')
const { setSearchQuery, useSearchBridge } = await import('../state/SearchBridgeContext')

const person = (id: number, fullName: string) => ({ id, fullName, active: true }) as Player

let bridge: ReturnType<typeof useSearchBridge>
function Probe() { bridge = useSearchBridge(); return null }

const noop = () => {}
function mount() {
  return render(<><MlbSearch searchActive allTeams={[]} onSelectPlayer={noop} onSelectTeam={noop} /><Probe /></>)
}

afterEach(() => { pending.clear(); vi.useRealTimers() })

describe('MlbSearch', () => {
  it('keeps the latest query\'s rows when an older answer lands after them', async () => {
    vi.useFakeTimers()
    const view = mount()
    act(() => setSearchQuery('fre'))
    await act(async () => { vi.advanceTimersByTime(400) })
    act(() => setSearchQuery('freddie'))
    await act(async () => { vi.advanceTimersByTime(400) })

    await act(async () => { pending.get('freddie')!([person(2, 'Freddie Freeman')]) })
    await act(async () => { pending.get('fre')!([person(1, 'Fred Example')]) })

    expect(bridge.playerResults.map(p => p.id)).toEqual([2])
    expect(bridge.searching).toBe(false)
    view.unmount()
  })

  it('asks the network once per settled query, not per keystroke', async () => {
    vi.useFakeTimers()
    const view = mount()
    for (const q of ['fr', 'fre', 'fred', 'fredd']) {
      act(() => setSearchQuery(q))
      await act(async () => { vi.advanceTimersByTime(100) })
    }
    await act(async () => { vi.advanceTimersByTime(400) })
    expect([...pending.keys()]).toEqual(['fredd'])
    view.unmount()
  })

  it('does not re-render its parent while the reader types', async () => {
    let parentRenders = 0
    function Parent() {
      parentRenders++
      return <MlbSearch searchActive allTeams={[]} onSelectPlayer={noop} onSelectTeam={noop} />
    }
    const view = render(<Parent />)
    const before = parentRenders
    for (const q of ['k', 'ke', 'ker', 'kers']) act(() => setSearchQuery(q))
    expect(parentRenders).toBe(before)
    view.unmount()
  })
})

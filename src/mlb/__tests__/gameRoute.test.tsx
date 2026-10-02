import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { useSheetHistory, keepSheetMarker, sheetEntryUrl, sheetOpenAt } from '../state/sheetHistory'

// Game Center's address is its sheet's history entry (/mlb/games/<pk>). These pin the two ways it
// could go wrong without failing anywhere else: the address not surviving the section's own URL
// sync, and a cold landing that Back cannot get rid of because closing lands on the same address.

const summary = (gamePk: number, state = 'final') => ({
  gamePk, state, startMs: Date.UTC(2026, 9, 1, 22), statusText: 'Final',
  away: { teamId: 143, abbr: 'PHI', name: 'Philadelphia Phillies', runs: 4, hits: 8, errors: 0, isWinner: true },
  home: { teamId: 144, abbr: 'ATL', name: 'Atlanta Braves', runs: 2, hits: 5, errors: 1, isWinner: false },
  winPitcher: null, losePitcher: null, savePitcher: null,
})
const fetchGameSummary = vi.fn(async (pk: number) => (pk === 404 ? null : summary(pk)))
vi.mock('../views/FinalGames', () => ({ fetchGameSummary: (pk: number) => fetchGameSummary(pk) }))

// Both sheets stood in by the one thing that matters here: they register their address.
function StubSheet({ game, onClose }: { game: { gamePk: number }; onClose: () => void }) {
  useSheetHistory(onClose, `/mlb/games/${game.gamePk}`)
  return <div>game {game.gamePk}</div>
}
vi.mock('../views/GamePreview', () => ({ GamePreviewModal: StubSheet }))
vi.mock('../views/LiveGameCenter', () => ({ GameCenterModal: StubSheet }))

const { GameRoute } = await import('../views/GameRoute')

const settle = () => new Promise(r => setTimeout(r, 20))

describe('a sheet with an address', () => {
  beforeEach(() => { window.history.replaceState({ view: 'home' }, '', '/mlb') })

  it('pushes its address, keeps it through a restamp, and Back restores the page', async () => {
    const onClose = vi.fn()
    render(<StubSheet game={{ gamePk: 7 }} onClose={onClose} />)
    expect(window.location.pathname).toBe('/mlb/games/7')
    expect(sheetOpenAt('/mlb/games/7')).toBe(true)
    // What useMlbState's URL sync does on every render: the snapshot is the page's, the address
    // must stay the sheet's.
    window.history.replaceState(keepSheetMarker({ view: 'home' }), '', sheetEntryUrl() ?? '/mlb')
    expect(window.location.pathname).toBe('/mlb/games/7')
    await act(async () => { window.history.back(); await settle() })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(window.location.pathname).toBe('/mlb')
  })
})

describe('arriving at a game by its address', () => {
  beforeEach(() => { fetchGameSummary.mockClear() })

  it('seats Scores beneath it, so Back closes the game instead of reopening it', async () => {
    window.history.replaceState(null, '', '/mlb/games/849844')
    const { findByText, queryByText } = render(<GameRoute onPlayerClick={() => {}} onTeamClick={() => {}} />)
    await findByText('game 849844')
    expect(window.location.pathname).toBe('/mlb/games/849844')
    expect(fetchGameSummary).toHaveBeenCalledTimes(1)
    // ONE Back. Had the sheet pushed its own entry over the seated one rather than adopting it,
    // this would land on the seated entry, still the game's address, and the sheet would stay up.
    await act(async () => { window.history.back(); await settle() })
    expect(queryByText('game 849844')).toBeNull()
    expect(window.location.pathname).toBe('/mlb/scores')
    expect(window.history.state).toEqual({ view: 'scores' })
  })

  it('steps off onto Scores when there is no such game', async () => {
    window.history.replaceState(null, '', '/mlb/games/404')
    const { queryByText } = render(<GameRoute onPlayerClick={() => {}} onTeamClick={() => {}} />)
    await act(async () => { await settle(); await settle() })
    expect(queryByText(/game/)).toBeNull()
    expect(window.location.pathname).toBe('/mlb/scores')
  })

  it('reopens on Forward, onto the entry it had', async () => {
    window.history.replaceState(null, '', '/mlb/games/5')
    const { findByText, queryByText } = render(<GameRoute onPlayerClick={() => {}} onTeamClick={() => {}} />)
    await findByText('game 5')
    await act(async () => { window.history.back(); await settle() })
    expect(queryByText('game 5')).toBeNull()
    const length = window.history.length
    await act(async () => { window.history.forward(); await settle() })
    await findByText('game 5')
    expect(window.location.pathname).toBe('/mlb/games/5')
    expect(window.history.length).toBe(length)
  })
})

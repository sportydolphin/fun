// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { gamePageOf, expandGameToPage, GAME_PAGE_KEY } from '../state/gamePage'
import { keepSheetMarker, sheetEntryUrl } from '../state/sheetHistory'

// The full Game Center page is a history entry marked with its game (state/gamePage.ts). These pin
// the two things that would lose it silently: the panel's Expand must REPLACE the panel's entry
// (Back from the page lands where the panel was opened), and the section's restamps must keep the
// marker, or the URL sync rewrites the page's address to the Scores tab under it.
describe('the full Game Center page entry', () => {
  beforeEach(() => { window.history.replaceState({ view: 'home' }, '', '/mlb') })

  it('Expand replaces the panel entry with a page entry for the same game', async () => {
    window.history.pushState({ view: 'stats', mlbSheet: 1, mlbSheetUrl: '/mlb/games/777' }, '', '/mlb/games/777')
    const before = window.history.length
    expandGameToPage(777, 'box')
    expect(window.history.length).toBe(before)
    expect(window.location.pathname).toBe('/mlb/games/777')
    expect(window.history.state).toEqual({ view: 'stats', [GAME_PAGE_KEY]: 777, mlbGameTab: 'box' })
    expect(gamePageOf(window.history.state)).toEqual({ gamePk: 777, tab: 'box' })
  })

  it('a restamp keeps the marker, and the address stays the game', () => {
    window.history.pushState({ view: 'scores', [GAME_PAGE_KEY]: 5 }, '', '/mlb/games/5')
    expect(keepSheetMarker({ view: 'scores' })).toEqual({ view: 'scores', [GAME_PAGE_KEY]: 5, mlbGameTab: undefined })
    expect(sheetEntryUrl()).toBe('/mlb/games/5')
  })

  it('an ordinary entry is not a page', () => {
    expect(gamePageOf({ view: 'scores' })).toBeNull()
    expect(gamePageOf(null)).toBeNull()
  })
})

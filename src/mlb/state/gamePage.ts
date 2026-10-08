// The full Game Center page, as a history entry.
//
// A game has one address, /mlb/games/<pk>, and two ways of drawing it on a desktop: the side panel,
// for a game opened from a row, and the full page, for a game ARRIVED AT (a cold load, a shared
// link) or Expanded from the panel. Which one an entry is, the address cannot say, so the entry
// does: `mlbGamePage: <pk>`, read by GameRoute, the one place a game page is opened.
//
// Phones have no full page and never see the marker: GameRoute only writes it from `md` up, and
// reads it only there, so a page entry restored on a phone (a window narrowed across `md`) opens
// the sheet, as every game on a phone does.
import { dismissPanels, GAME_PAGE_KEY, GAME_TAB_KEY } from './sheetHistory'
import { mlbGamePath } from '../routes'

export type GameTab = 'summary' | 'box' | 'plays'

export { GAME_PAGE_KEY, GAME_TAB_KEY }

/** The game this entry draws as a page, if it is a page entry. */
export function gamePageOf(state: unknown): { gamePk: number; tab?: GameTab } | null {
  const st = state as Record<string, unknown> | null
  const pk = st?.[GAME_PAGE_KEY]
  if (typeof pk !== 'number') return null
  const tab = st?.[GAME_TAB_KEY]
  return { gamePk: pk, tab: tab === 'box' || tab === 'plays' || tab === 'summary' ? tab : undefined }
}

/**
 * The panel's Expand. It REPLACES the panel's entry rather than pushing, so Back from the page
 * lands where the panel was opened, not on the panel again: the panel was a look at the game, the
 * page is the game. The page under the panel stays recorded in the entry (the sheet's entry is the
 * page's own, plus its marker), which is what restores it on Back.
 */
export function expandGameToPage(gamePk: number, tab: GameTab): void {
  const st = { ...((window.history.state ?? {}) as Record<string, unknown>) }
  delete st.mlbSheet
  delete st.mlbSheetUrl
  window.history.replaceState({ ...st, [GAME_PAGE_KEY]: gamePk, [GAME_TAB_KEY]: tab }, '', mlbGamePath(gamePk))
  // The entry is no longer a sheet's, so this closes them without a Back: the game's panel, and a
  // player's beneath it if the game was opened from one.
  dismissPanels()
  // GameRoute opens pages on a popstate, and a replaceState fires none. A task later, once the
  // panels have unmounted and stopped holding the section's own handler off.
  window.setTimeout(() => window.dispatchEvent(new PopStateEvent('popstate')), 0)
}

// Which game the page is showing, for a card over it that links to the same game (a player's log):
// the page is already there, so the link closes the card rather than opening the game again.
let showing: number | null = null
export const setGamePageShowing = (pk: number | null): void => { showing = pk }
export const gamePageShowing = (pk: number): boolean => showing === pk

import React, { useSyncExternalStore } from 'react'
import type { SxProps, Theme } from '@mui/material'
import { TabTitleText, VisuallyHiddenH1 } from '../../ui/heading'
import { isMlbSheetPath, MLB_PATH_EVENT } from '../routes'
import { sheetEntryUrl } from '../state/sheetHistory'
import { usePanelActive } from '../../lib/panelActive'

// The ONE <h1> per MLB page, and who owns it.
//
// Until Oct 2026 only Scores and Teams had a heading. Standings, the three Stats boards, Charts,
// Home and every player and club page had none, so a crawler asking "what is this page" got the
// toolbar, and a screen reader's heading list was empty. The same problem WPBL solved in
// src/wpbl/PageHeading.tsx; the drawing is shared (src/ui/heading.tsx), the ownership is not, since
// neither section imports the other and their overlays are built differently.
//
// A game is a SHEET over a page (routes.ts), but its address is the game's while it is up, so the
// game is the page then: the heading under it steps aside (becomes a div, or is not rendered) and
// the sheet supplies the h1. Ownership is read from the address rather than threaded as a prop
// because the sheets open from a dozen places and the address is already the one record of which
// is on top: useSheetHistory and the section's URL sync both announce it with MLB_PATH_EVENT.

function subscribe(cb: () => void) {
  window.addEventListener('popstate', cb)
  window.addEventListener(MLB_PATH_EVENT, cb)
  return () => {
    window.removeEventListener('popstate', cb)
    window.removeEventListener(MLB_PATH_EVENT, cb)
  }
}
// A sheet's own address is on top: a game or a series by the shape of the path, and a player's side
// panel by its history entry, since its address is also the player's page.
const isGamePage = () => isMlbSheetPath(window.location.pathname) || sheetEntryUrl() === window.location.pathname

/** False while a game sheet is the page, and in a tab kept mounted behind the one on screen
 *  (lib/panelActive.ts), which would otherwise give the page a second h1 under `display: none`. */
export function useMlbOwnsHeading(): boolean {
  const onScreen = usePanelActive()
  return !useSyncExternalStore(subscribe, isGamePage, () => false) && onScreen
}

/** For a page's DRAWN title (Scores, Teams): spread into `component`. Looks the same either way. */
export function useMlbHeadingTag(): 'h1' | 'div' {
  return useMlbOwnsHeading() ? 'h1' : 'div'
}

/** A tab's drawn title, in the one style both sections' tabs share (TAB_TITLE_SX), so a switch
 *  between /wpbl/standings and /mlb/standings changes the words and not the type. Until Oct 9, 2026
 *  Standings and the Stats boards opened on a row of pills with a hidden h1, and Scores and Teams
 *  drew theirs at two sizes of their own. Drawn outside any loading branch, since a title needs no
 *  data. `sx` is the tab's own spacing. */
export function MlbTabTitle({ children, sx }: { children: React.ReactNode; sx?: SxProps<Theme> }) {
  return (
    <TabTitleText tag={useMlbHeadingTag()} sx={sx}>{children}</TabTitleText>
  )
}

/** A page heading that is not drawn, for a page whose title is already said by the nav (a tab)
 *  or by a graphic (a player's card). Steps aside while a game is the page. */
export function MlbPageH1({ children }: { children: React.ReactNode }) {
  return useMlbOwnsHeading() ? <MlbHiddenH1>{children}</MlbHiddenH1> : null
}

/** The full Game Center page's heading: the page's while its own address is on top, and nobody's
 *  while a player's side panel over it holds the address (the panel's heading is the page then). */
export function MlbAddressH1({ path, children }: { path: string; children: React.ReactNode }) {
  const onTop = useSyncExternalStore(subscribe, () => window.location.pathname === path, () => true)
  return onTop ? <MlbHiddenH1>{children}</MlbHiddenH1> : null
}

/** The game sheet's heading: always rendered, since while the sheet is up it is the page. */
export const MlbHiddenH1 = VisuallyHiddenH1

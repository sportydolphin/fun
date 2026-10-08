// Which player the desktop side panel is showing, if any.
//
// A module store rather than useMlbState, because the panel is opened from two places that share no
// props: the page (a row anywhere in the section, through useMlbState's open handlers) and Game
// Center, which a dozen openers render on their own and none of which should have to thread a
// player-panel callback through. MlbStats draws whatever this holds (views/MlbPlayerPanel.tsx).
//
// ONE PLAYER AT A TIME. A row clicked on the page while a player is up changes the player in place
// (the panel remounts, and sheetHistory reads the remount as a swap, so Back closes it in one step
// however many rows were looked at). `stacked` is only for a player opened from inside the Game
// Center panel, which draws over the game with a way back to it.
import { useEffect, useSyncExternalStore } from 'react'
import type { Player } from '../types'
import { sheetOpenAt, PANEL_SEASON_KEY } from './sheetHistory'
import { mlbPlayerIdFromPath } from '../routes'

export interface PanelPlayer {
  id: number
  /** What the opener already knew, for the first paint. Usually null: the card fetches its own. */
  player: Player | null
  /** Opened from inside Game Center: drawn over it, with a back control that returns to it. */
  stacked: boolean
  /** The address of the entry it is reopened on, slug and all, so the panel ADOPTS that entry
   *  rather than pushing a copy of it (useSheetHistory matches on the address). */
  path?: string
  /** The season it was showing when its entry was left, for a panel reopened by Back. */
  season?: number | 'career' | null
}

let current: PanelPlayer | null = null
const subs = new Set<() => void>()
const notify = () => subs.forEach(f => f())

export function openPlayerPanel(next: PanelPlayer): void {
  current = next
  notify()
}

/** Close the panel if it is still showing this player. A swap has already replaced it, and the old
 *  one's close must not take the new one down with it. */
export function closePlayerPanel(id: number): void {
  if (current?.id !== id) return
  current = null
  notify()
}

export function usePlayerPanel(): PanelPlayer | null {
  return useSyncExternalStore(
    f => { subs.add(f); return () => { subs.delete(f) } },
    () => current,
    () => null,
  )
}

/**
 * Reopen the panel when Back or Forward lands on its entry with nothing showing it: Back from a board
 * a rank on the panel opened (pushed over the panel's entry, see pushEntry's `overSheet`), and Back
 * down a stack whose panel was replaced on the way up (a player, a game from their log, a player
 * from that game). Without this the entry is still a player's address, and the section draws it as
 * the full page. The page under the panel is the entry's own snapshot, which the section restores
 * as it does under any sheet (restoreTarget). A desktop only: on a phone the same address is the
 * page, which is what a player is there.
 */
export function usePlayerPanelRestore(desktop: boolean): void {
  useEffect(() => {
    if (!desktop) return
    const onPop = () => {
      const st = window.history.state as Record<string, unknown> | null
      const url = typeof st?.mlbSheetUrl === 'string' ? st.mlbSheetUrl : null
      if (st?.mlbSheet == null || !url || url !== window.location.pathname) return
      const id = mlbPlayerIdFromPath(url)
      if (id == null || sheetOpenAt(url) || current?.id === id) return
      // Over another sheet's entry, which Back reopens in turn (GameRoute does for a game), so the
      // way back to it is offered as the panel's own control.
      const season = st[PANEL_SEASON_KEY]
      openPlayerPanel({
        id, player: null, stacked: Number(st.mlbSheet) > 1, path: url,
        season: typeof season === 'number' || season === 'career' ? season : null,
      })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [desktop])
}

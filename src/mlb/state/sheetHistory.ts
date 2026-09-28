// ─── Back closes a sheet ──────────────────────────────────────────────────────
//
// On a phone, Back with Game Center open used to leave the MLB section altogether: none of its
// overlays was a history entry, so the gesture went to whatever was underneath, which was often
// /wpbl. WPBL's sheets have been history entries all season; this gives MLB's the same footing.
//
// A sheet pushes ONE entry when it opens, marked `mlbSheet: <depth>` on top of whatever state the
// page already held. Back pops it, and the sheet's own popstate listener closes it. The close
// button, Escape, the backdrop and a drag all go through `close`, which pops that same entry when
// it is still on top, so closing never leaves a dead entry behind for Back to land on.
//
// THE SECTION'S OWN POPSTATE HANDLER MUST STAND DOWN while a sheet is open. useMlbState restores
// the view from every entry it lands on, and a pop that only closes a sheet lands on the entry
// the sheet was opened over, so without the check a Game Center closed over a player page would
// refetch the player underneath it. `sheetOpen()` is that check.
//
// A link OUT of a sheet (a player in the box score) replaces the sheet's entry rather than pushing
// over it (pushEntry), so Back from that player lands where the sheet was opened, not on a copy of
// it. And a sheet that mounts on an entry already marked for its depth (React's development
// double-mount, a Forward onto the entry) adopts it rather than pushing a second one.

import { useEffect, useRef, useCallback } from 'react'

let openSheets = 0

/** True while any MLB sheet is open. */
export const sheetOpen = (): boolean => openSheets > 0

/** Whether the entry on top is a sheet's own. */
export const onSheetEntry = (): boolean =>
  (window.history.state as Record<string, unknown> | null)?.mlbSheet != null

/**
 * Push a navigation, EXCEPT from a sheet's own entry, which it replaces instead.
 *
 * A link inside Game Center (a player, a team) leaves the sheet. Pushed on top of the sheet's entry,
 * that entry would outlive the sheet as a copy of the page beneath it, and Back from the player
 * would land on it and then need a second Back to get anywhere. Replacing it makes the sheet's
 * entry become the player's, so Back goes straight to where the sheet was opened.
 */
export function pushEntry(state: Record<string, unknown>): void {
  if (onSheetEntry()) window.history.replaceState(state, '', window.location.href)
  else window.history.pushState(state, '', window.location.href)
}

/** Carry the sheet marker through a replaceState, so restamping an entry does not unmark it. */
export function keepSheetMarker<T extends Record<string, unknown>>(state: T): T {
  const marker = (window.history.state as Record<string, unknown> | null)?.mlbSheet
  return marker == null ? state : { ...state, mlbSheet: marker }
}

/**
 * Register a sheet with the browser history for as long as it is mounted. Returns the function
 * every close path should call instead of `onClose`.
 */
export function useSheetHistory(onClose: () => void): () => void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const depthRef = useRef(0)

  useEffect(() => {
    openSheets += 1
    const depth = openSheets
    depthRef.current = depth
    const st = (window.history.state ?? {}) as Record<string, unknown>
    if (st.mlbSheet !== depth) window.history.pushState({ ...st, mlbSheet: depth }, '', window.location.href)

    const onPop = () => {
      const now = Number((window.history.state as Record<string, unknown> | null)?.mlbSheet ?? 0)
      if (now < depth) onCloseRef.current()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      openSheets = Math.max(0, openSheets - 1)
    }
  }, [])

  return useCallback(() => {
    const now = (window.history.state as Record<string, unknown> | null)?.mlbSheet
    // Our entry is still on top: pop it, and the listener above does the closing. Anything else
    // (a link inside the sheet already pushed a new page) is a plain close.
    if (now === depthRef.current) window.history.back()
    else onCloseRef.current()
  }, [])
}

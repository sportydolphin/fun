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
//
// A SHEET CAN HAVE AN ADDRESS OF ITS OWN (Oct 2026): Game Center is `/mlb/games/<pk>`. The entry is
// pushed at that URL and remembers it as `mlbSheetUrl`, which is what tells useMlbState's URL sync
// to leave the bar alone while the entry is on top. Without it the sync restamps the entry with the
// page underneath, and the game's address lasts one render. Back pops it like any other sheet.
//
// A SHEET CAN BE THE DESKTOP SIDE PANEL (Oct 2026, `panel`), which leaves the page clickable beside
// it, and that adds two rules. A game clicked on the page while a panel is open SWAPS the panel: the
// new sheet takes the old one's entry and depth and replaces its address, so Back closes the panel in
// one step however many rows were looked at. Without it every row would push, and Back would walk
// them all. And a navigation FROM the page (a tab, a player, a search result) closes the panel
// without a Back of its own: pushEntry replaces the panel's entry, so Back from the new page lands
// where the panel was opened. Left open, the panel would sit over a page it has nothing to do with,
// holding a sheet marker that makes the section's popstate handler stand down on the next Back.

import { useEffect, useRef, useCallback } from 'react'
import { MLB_PATH_EVENT } from '../routes'

let openSheets = 0
// The addresses of the sheets that are up, counted, since the same game can be open twice for a
// frame (a sheet closing as another opens). GameRoute asks before opening one of its own.
const openUrls = new Map<string, number>()
const holdUrl = (url: string, by: 1 | -1) => {
  const n = (openUrls.get(url) ?? 0) + by
  if (n > 0) openUrls.set(url, n)
  else openUrls.delete(url)
}

/** Every open sheet, for finding the side panels among them. `panel` is read live: a window
 *  resized across `md` turns a panel into a dialog under an open sheet. */
type OpenSheet = { depth: () => number; panel: () => boolean; dismiss: () => void }
const sheets = new Set<OpenSheet>()

/**
 * When a side panel last unmounted, and whose entry it held, for telling a SWAP from a fresh
 * opening. A sheet that seeds its state once (Game Center) changes game by remounting, and React
 * runs the old one's cleanup in the same commit as the new one's mount, so "a panel whose entry is
 * still on top went a moment ago" is a swap. A genuine close is a Back, which is a popstate a task
 * later, or a link out, which has already replaced the entry with one carrying no marker. Panels
 * only, and matched on the entry's address too: a dialog on a phone cannot be swapped from the page,
 * and a looser test once read a sheet stacked over another as replacing it.
 */
let lastGone: { depth: number; url: string | undefined; at: number } | null = null
const SWAP_MS = 50

/** Close every side panel without touching history. For a navigation from the page beside them,
 *  which replaces the panel's entry rather than stacking on it (see pushEntry). */
export function dismissPanels(): void {
  for (const s of [...sheets]) if (s.panel()) s.dismiss()
}

/** True while any MLB sheet is open. */
export const sheetOpen = (): boolean => openSheets > 0

/** True while a sheet with this address is open. */
export const sheetOpenAt = (url: string): boolean => (openUrls.get(url) ?? 0) > 0

/** How many sheets are open, so an entry seated ahead of its sheet (GameRoute) carries the depth
 *  the sheet will take when it mounts and adopts it. */
export const openSheetCount = (): number => openSheets

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
 *
 * `url` is the DESTINATION's address. Without it the entry is written at the current one and the
 * section's URL sync corrects it a render later, which looks the same until a deploy lands under
 * an open tab: lib/staleBuild.ts turns the next pushState into a full load OF ITS URL, and loading
 * the page being left is a tap that goes nowhere.
 */
export function pushEntry(state: Record<string, unknown>, url: string = window.location.href): void {
  dismissPanels()
  if (onSheetEntry()) window.history.replaceState(state, '', url)
  else window.history.pushState(state, '', url)
}

/** Carry the sheet marker, and the sheet's own address if it has one, through a replaceState, so
 *  restamping an entry does not unmark it. */
export function keepSheetMarker<T extends Record<string, unknown>>(state: T): T {
  const st = window.history.state as Record<string, unknown> | null
  const marker = st?.mlbSheet
  if (marker == null) return state
  return typeof st?.mlbSheetUrl === 'string' ? { ...state, mlbSheet: marker, mlbSheetUrl: st.mlbSheetUrl } : { ...state, mlbSheet: marker }
}

/** The address of the sheet whose entry is on top, when it has one of its own. */
export function sheetEntryUrl(): string | null {
  const st = window.history.state as Record<string, unknown> | null
  return st?.mlbSheet != null && typeof st.mlbSheetUrl === 'string' ? st.mlbSheetUrl : null
}

/**
 * Register a sheet with the browser history for as long as it is mounted. Returns the function
 * every close path should call instead of `onClose`.
 *
 * `url` gives the sheet an address of its own (see the top of the file). It may change while the
 * sheet is up (the preview's ‹ › arrows step to another game), and the entry follows it.
 *
 * `panel` says the sheet is drawing as the desktop side panel right now (see the top of the file).
 */
export function useSheetHistory(onClose: () => void, url?: string, { panel = false }: { panel?: boolean } = {}): () => void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const depthRef = useRef(0)
  const urlRef = useRef(url)
  const panelRef = useRef(panel)
  panelRef.current = panel

  useEffect(() => {
    openSheets += 1
    let depth = openSheets
    const own = urlRef.current
    const st = (window.history.state ?? {}) as Record<string, unknown>
    // A panel another opener is still showing, whose entry is on top: a game clicked on Home's
    // schedule strip while one from the drama feed is up. It is swapped out like a remount.
    const shown = panelRef.current
      ? [...sheets].find(s => s.panel() && s.depth() === st.mlbSheet)
      : undefined
    const swap = shown != null
      || (panelRef.current && lastGone != null && performance.now() - lastGone.at < SWAP_MS
        && st.mlbSheet === lastGone.depth && st.mlbSheetUrl === lastGone.url)
    if (st.mlbSheet === depth && (!own || st.mlbSheetUrl === own)) {
      // Adopted as it stands: a double-mount, or an entry seated for this sheet.
    } else if (swap) {
      // Take the old sheet's place: its depth and its entry, now at this address. Its cleanup
      // takes back the count this mount just added, so the two still agree.
      depth = Number(st.mlbSheet)
      shown?.dismiss()
      const next: Record<string, unknown> = { ...st, mlbSheet: depth }
      if (own) next.mlbSheetUrl = own
      else delete next.mlbSheetUrl
      window.history.replaceState(next, '', own ?? window.location.href)
    } else if (own && st.mlbSheetUrl === own) {
      // Forward onto a game that was opened deeper in a stack nobody has rebuilt: take the entry
      // at the depth this sheet really has, or Back would find a marker it does not expect.
      window.history.replaceState({ ...st, mlbSheet: depth }, '', own)
    } else {
      // A sheet without an address opened over one with an address inherits it along with the
      // rest of the entry, since the bar still shows it.
      const next: Record<string, unknown> = { ...st, mlbSheet: depth }
      if (own) next.mlbSheetUrl = own
      window.history.pushState(next, '', own ?? window.location.href)
    }
    depthRef.current = depth
    if (own) {
      holdUrl(own, 1)
      // A pushState fires no popstate, so the shell would keep the page's title under the sheet.
      window.dispatchEvent(new Event(MLB_PATH_EVENT))
    }

    const onPop = () => {
      const now = Number((window.history.state as Record<string, unknown> | null)?.mlbSheet ?? 0)
      // A sheet with an address also closes on landing anywhere that is not that address: an entry
      // renumbered above can sit at the same depth as the sheet it was opened over.
      const left = urlRef.current != null && window.location.pathname !== urlRef.current
      if (now < depth || left) onCloseRef.current()
    }
    window.addEventListener('popstate', onPop)
    const self: OpenSheet = {
      depth: () => depthRef.current,
      panel: () => panelRef.current,
      dismiss: () => { sheets.delete(self); onCloseRef.current() },
    }
    sheets.add(self)
    return () => {
      window.removeEventListener('popstate', onPop)
      sheets.delete(self)
      if (panelRef.current) lastGone = { depth: depthRef.current, url: urlRef.current, at: performance.now() }
      openSheets = Math.max(0, openSheets - 1)
      if (urlRef.current) holdUrl(urlRef.current, -1)
    }
  }, [])

  // Follow a change of address in place: the same sheet, showing another game.
  useEffect(() => {
    const prev = urlRef.current
    if (url === prev) return
    urlRef.current = url
    if (prev) holdUrl(prev, -1)
    if (url) holdUrl(url, 1)
    const st = window.history.state as Record<string, unknown> | null
    if (!url || st?.mlbSheet !== depthRef.current) return
    window.history.replaceState({ ...st, mlbSheetUrl: url }, '', url)
    window.dispatchEvent(new Event(MLB_PATH_EVENT))
  }, [url])

  return useCallback(() => {
    const now = (window.history.state as Record<string, unknown> | null)?.mlbSheet
    // Our entry is still on top: pop it, and the listener above does the closing. Anything else
    // (a link inside the sheet already pushed a new page) is a plain close.
    if (now === depthRef.current) window.history.back()
    else onCloseRef.current()
  }, [])
}

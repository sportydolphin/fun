import { useEffect, useSyncExternalStore } from 'react'
import { Box } from '@mui/material'
import { TYPE_SCALE } from '../../ui/card'


/**
 * Which phone panes' bands have scrolled out of view, held OUTSIDE the card's state.
 *
 * The header swaps the club for the player's name once the band scrolls away, and that swap
 * happens mid-scroll, by definition. Kept as card state it re-rendered the whole card at that
 * moment: about 150ms of styling work on a mid-range phone, landing in the middle of the swipe
 * that caused it, every time the band crossed the top in either direction. As a store only the
 * header subscribes to (BandAwareEyebrow), the swap re-renders the header and nothing else.
 */
export type BandStore = {
  get: () => Record<number, boolean>
  set: (next: Record<number, boolean> | ((prev: Record<number, boolean>) => Record<number, boolean>)) => void
  subscribe: (l: () => void) => () => void
  /** Back to "nothing hidden" without telling anyone, for the render that swaps the player: the
   *  header re-renders in that same pass and reads it, and a notification during render would be
   *  an update to another component mid-render. */
  reset: () => void
}
export function createBandStore(): BandStore {
  let value: Record<number, boolean> = {}
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: next => {
      const v = typeof next === 'function' ? next(value) : next
      if (v === value) return
      value = v
      listeners.forEach(l => l())
    },
    subscribe: l => { listeners.add(l); return () => { listeners.delete(l) } },
    reset: () => { value = {} },
  }
}

/** The sheet header: the club, or the player's name once the band has scrolled out. */
export function BandAwareEyebrow({ store, index, name, children }: { store: BandStore; index: number; name: string; children: React.ReactNode }) {
  const hidden = useSyncExternalStore(store.subscribe, store.get, store.get)
  if (!hidden[index]) return <>{children}</>
  // The NAME ALONE, in ordinary case: the header's small caps and letter-spacing are set for a club
  // nickname, and "Denae Benites · Heights" in them truncated to "DENAE BENITE…" beside Compare and
  // Copy link.
  return (
    <Box component="span" sx={{
      display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      textTransform: 'none', letterSpacing: 0, fontSize: TYPE_SCALE.title, fontWeight: 800, color: 'text.primary',
    }}>
      {name}
    </Box>
  )
}

/** Watches each phone pane's band against its own scroller and records which have scrolled out,
 *  for the header's name swap (see BandAwareEyebrow). */
export function useBandObserver(
  bandEls: React.RefObject<(HTMLDivElement | null)[]>, setBandHidden: BandStore['set'],
  bandPinned: boolean, playerId: string, twoWay: boolean, pitcherFirst: boolean, loading: boolean,
) {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const els = bandEls.current.filter((e): e is HTMLDivElement => !!e)
    if (els.length === 0) { setBandHidden({}); return }
    // Each band is measured against ITS OWN SCROLLER, not the viewport. Against the viewport, a
    // card on its way in is "scrolled out" for as long as it is off screen: the desktop panel
    // slides in from the right edge and the phone sheet rises from the bottom, so for those 220ms
    // the header named the player, then snapped back to the club once the card had landed. The
    // scroller moves with the band, so the slide no longer reads as a scroll. A pane's scroller is
    // still what clips it, so "out" keeps meaning scrolled out of the sheet.
    const scrollerOf = (el: HTMLElement): HTMLElement | null => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p
      }
      return null
    }
    const onEntries = (entries: IntersectionObserverEntry[]) => {
      setBandHidden(prev => {
        let next = prev
        for (const e of entries) {
          const i = bandEls.current.indexOf(e.target as HTMLDivElement)
          // "Out" once less than a sliver shows: the name belongs in the header as soon as the
          // band stops saying it, not only once the last pixel of it has gone.
          const out = e.intersectionRatio < 0.15
          // Only a real change makes a new object, or every callback would re-render the page.
          if (i >= 0 && prev[i] !== out) next = { ...next, [i]: out }
        }
        return next
      })
    }
    // One observer per scroller, since an observer has one root (on a phone each role pane scrolls
    // itself; in the panel and the dialog the body does).
    const byRoot = new Map<HTMLElement | null, HTMLDivElement[]>()
    for (const el of els) {
      const root = scrollerOf(el)
      byRoot.set(root, [...(byRoot.get(root) ?? []), el])
    }
    const observers = [...byRoot].map(([root, group]) => {
      const io = new IntersectionObserver(onEntries, { root, threshold: [0, 0.15, 0.5, 1] })
      group.forEach(e => io.observe(e))
      return io
    })
    return () => observers.forEach(io => io.disconnect())
    // Re-observed when the set of panes changes; the elements themselves are stable between.
    // setBandHidden is the band store's own setter, the same function for the store's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bandPinned, playerId, twoWay, pitcherFirst, loading])
}

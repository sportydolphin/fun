import { useEffect, useLayoutEffect, useState } from 'react'
import { useAxisLock } from '../../ui/useAxisLock'
import type { Side, Source, Mode, View } from './axes'
import type { Row } from './shared'

/** Everything the board measures and pins once it is on screen. Returns the two pieces of layout state
 *  the table draws with. The refs are the shell's, so each is the same object on every render: listed in
 *  the effects' dependencies because they arrive as arguments, never re-running one. */
export function useBoardLayout({ active, hideSiteFooter, loading, pinActive, listView, source, mode, side, view,
  sortKey, rows, scrollRef, barRef, stuckMarkRef }: {
  active: boolean
  hideSiteFooter: boolean
  loading: boolean
  pinActive: boolean
  listView: boolean
  source: Source
  mode: Mode
  side: Side
  view: View
  sortKey: string
  rows: Row[]
  scrollRef: React.RefObject<HTMLDivElement | null>
  barRef: React.RefObject<HTMLDivElement | null>
  stuckMarkRef: React.RefObject<HTMLDivElement | null>
}) {
  // Horizontal-scroll edges: they drive the frozen-column shadow (not at start) and the
  // right-edge fade (not at end), so it's obvious the table scrolls sideways.
  const [scrollX, setScrollX] = useState({ atStart: true, atEnd: true })
  useEffect(() => {
    if (!(active && hideSiteFooter)) return
    const root = document.documentElement
    root.setAttribute('data-wpbl-stats-table', '')
    return () => root.removeAttribute('data-wpbl-stats-table')
  }, [active, hideSiteFooter])

  // The sorted column (OPS / ERA by default) is at the far right, off-screen on a phone
  // where the table scrolls horizontally. Bring the highlighted column into view on load and
  // when switching sides, but only if it isn't already visible, so a wide desktop
  // table (all columns shown) or a user who's scrolled elsewhere is left alone.
  // A new view or side is a different set of columns, so an old sideways offset lands the reader
  // partway through a table they have not seen the start of. Back to the first column; the effect
  // below then brings the sorted one into view where it needs to. Declared first so it runs first.
  useLayoutEffect(() => {
    const c = scrollRef.current
    if (c) c.scrollLeft = 0
  }, [view, side, scrollRef])
  useLayoutEffect(() => {
    if (loading || pinActive) return // pinned: the sorted column is always in view (frozen)
    const c = scrollRef.current
    if (!c) return
    const th = c.querySelector('th[data-active="true"]') as HTMLElement | null
    if (!th) return
    const cRect = c.getBoundingClientRect()
    const tRect = th.getBoundingClientRect()
    const rightInView = tRect.right - cRect.left
    const leftInView = tRect.left - cRect.left
    if (rightInView > c.clientWidth) c.scrollLeft += rightInView - c.clientWidth + 12
    else if (leftInView < 0) c.scrollLeft += leftInView - 12
  }, [loading, side, view, sortKey, rows.length, pinActive, scrollRef])

  // ON A PHONE THE PAGE SCROLLS FIRST, THEN THE TABLE.
  //
  // The phone's cap sizes the table for where it PINS, under the bar once the title and the board
  // tabs have scrolled away, so at rest it runs about 145px further down, behind the bottom nav. That
  // is fine as long as the page gets scrolled, and nothing made it: a drag on the table scrolled the
  // table, and `overscroll-behavior: contain` kept it from ever handing the gesture to the page, so
  // the last rows and the board's footer sat behind the nav for anyone who never touched outside it.
  //
  // So the table only takes vertical scroll once it is pinned. Before that it is `overflow-y:
  // hidden`, which leaves its scroll position alone and passes the drag through to the page, which
  // carries it up until it pins. Scrolling back up at the table's top chains to the page again (the
  // Y overscroll is left to the browser on a phone for that reason) and unpins it. The same nested
  // scroll native apps do with a collapsing header.
  //
  // "At the page's bottom" also counts as pinned: if a short page cannot carry the table all the way
  // up, it must still be scrollable from wherever the page stops.
  const [boardPinned, setBoardPinned] = useState(false)
  useEffect(() => {
    if (!pinActive || listView || loading) return
    // Pinned means the BAR is being held (it sits below the zero-height marker that marks its
    // resting place; see barStuck), since the board always sits flush under the bar, held or not.
    const check = () => {
      const bar = barRef.current
      const mark = stuckMarkRef.current
      if (!bar || !mark) return
      const held = bar.getBoundingClientRect().top > mark.getBoundingClientRect().top + 0.5
      const atBottom = window.scrollY >= document.documentElement.scrollHeight - window.innerHeight - 2
      setBoardPinned(held || atBottom)
    }
    check()
    window.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    return () => { window.removeEventListener('scroll', check); window.removeEventListener('resize', check) }
  }, [pinActive, listView, loading, source, mode, barRef, stuckMarkRef])

  // ABOVE A PHONE THE TABLE IS PART OF THE PAGE, so the column headers follow the page by hand.
  //
  // The board used to be its own vertical scroller, capped to the screen, and the wheel over it
  // scrolled that box and never the page: the 25-row board ended in a box scrolled to its last row
  // with "Show all" and the rest of the page unreachable from anywhere over the table. Now it is
  // as tall as its rows and the page does all the vertical scrolling.
  //
  // It still scrolls SIDEWAYS below about 1400px, and a box that scrolls on one axis is the sticky
  // container on both, so the headers' `top: 0` pins them to a box that never moves. Each header
  // cell is shifted down by however far the table's top has gone under the control bar instead,
  // stopping at the last row. Set straight from the scroll event, not a frame later, so the header
  // does not trail the rows by a frame.
  useEffect(() => {
    const box = scrollRef.current
    const table = box?.querySelector('table')
    const head = table?.tHead
    if (pinActive || listView || loading || !box || !table || !head) return
    const update = () => {
      const bar = barRef.current
      if (!bar) return
      const t = table.getBoundingClientRect()
      const shift = Math.max(0, Math.min(bar.getBoundingClientRect().bottom - t.top, t.height - head.offsetHeight))
      box.style.setProperty('--wpbl-head-shift', `${shift}px`)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    const ro = new ResizeObserver(update)
    ro.observe(table)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      ro.disconnect()
      box.style.removeProperty('--wpbl-head-shift')
    }
  }, [pinActive, listView, loading, source, mode, side, barRef, scrollRef])

  // One axis per drag on the grid (src/ui/useAxisLock). Keyed on what mounts or replaces its scroll box.
  useAxisLock(scrollRef, `${loading}|${listView}|${source}|${mode}|${side}`)

  // Track horizontal scroll position to toggle the edge affordances.
  useEffect(() => {
    const c = scrollRef.current
    if (!c) return
    const update = () => {
      const max = c.scrollWidth - c.clientWidth
      setScrollX({ atStart: c.scrollLeft <= 1, atEnd: max <= 1 || c.scrollLeft >= max - 1 })
    }
    update()
    c.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(c)
    return () => { c.removeEventListener('scroll', update); ro.disconnect() }
  }, [loading, side, mode, rows.length, pinActive, scrollRef])

  // THE BAR PUBLISHES ITS OWN HEIGHT, because the board below pins to the BOTTOM of it and
  // nothing else on the page can know where that is: the shell reports its own chrome
  // (`--app-header-h`) and this bar pins under that, wrapping to two rows on a
  // narrow screen and back to one when the filters fold away. Same shape as the shell's own
  // variables, and read the same way.
  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const root = document.documentElement
    // THE FOOTER, BECAUSE IT IS THE ONLY THING LEFT BELOW THE BOARD, and how tall it is decides
    // how tall the board is allowed to be. A pinned board stays pinned only while its
    // containing block has somewhere left to travel, and the arithmetic comes out at exactly
    // one condition: the board must fit in the screen under the bar with room for whatever
    // follows it. Taller than that and it stops being pinned before the reader stops scrolling.
    //
    // MEASURED OFF THE `<footer>` ELEMENT, not off the document's height, and the difference is
    // the whole reason this is safe. The document's height includes the swipe pager's floor
    // (`minHeight` in SwipeableViews, which keeps a short tab a full-screen swipe target) and
    // any blank the board itself is leaving; feeding that back into the board's height is a
    // loop that runs the table down to nothing. The footer's height cannot depend on the board's.
    // Declared before `publish` so it can watch the two footers it finds (see below).
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => publish()) : null
    const publish = () => {
      // THE ONE THAT IS LAID OUT, and looked up every time rather than held from the first pass.
      // `/wpbl` keeps its swipe pager's visited tabs mounted, so the page can hold several
      // `<footer>` elements and `querySelector` may return a hidden tab's, which measures zero; and
      // the shell's footer is not guaranteed to be in the document when this board first mounts.
      // Either way a zero would be published, the board would size itself as though nothing were
      // beneath it, and the headers would slide behind the bar this arrangement exists to stop.
      const foot = Array.from(document.querySelectorAll('footer'))
        .find(f => f.getBoundingClientRect().height > 0)
      root.style.setProperty('--wpbl-stats-bar-h', `${el.getBoundingClientRect().height}px`)
      root.style.setProperty('--wpbl-foot-h', `${foot?.getBoundingClientRect().height ?? 0}px`)
      // The board's own footer, on the same terms: the laid-out one, since the ranked list and
      // the table each render it, and its height does not depend on the board's.
      const boardFoot = Array.from(document.querySelectorAll('[data-board-foot]'))
        .find(f => f.getBoundingClientRect().height > 0)
      root.style.setProperty('--wpbl-board-foot-h', `${boardFoot?.getBoundingClientRect().height ?? 0}px`)
      // WATCH THE FOOTERS THEMSELVES, not only the body. Switching to Large text grows both of
      // them without resizing the body in a way the observer reports, so the published heights
      // went stale and the board was sized for the old text: headers behind the bar at the
      // bottom of the page for anyone who changed the setting with this tab mounted, which the
      // pager keeps it. Observing an element twice is a no-op, so this is safe on every pass.
      if (foot) ro?.observe(foot)
      if (boardFoot) ro?.observe(boardFoot)
    }
    publish()
    // jsdom has no ResizeObserver in every environment this runs in; the values published above
    // are still correct for a layout that never changes.
    //
    // Watching the document as well as the bar is what catches the footer arriving, or growing
    // a row as the window narrows. It cannot feed back on itself: what gets published is the
    // FOOTER's height, and the footer does not care how tall the board is, so a republish on a
    // board resize writes the same value and stops there.
    if (ro) { ro.observe(el); ro.observe(document.body) }
    return () => {
      ro?.disconnect()
      root.style.removeProperty('--wpbl-stats-bar-h')
      root.style.removeProperty('--wpbl-foot-h')
      root.style.removeProperty('--wpbl-board-foot-h')
    }
  }, [loading, barRef])

  return { scrollX, boardPinned }
}

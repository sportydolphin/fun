import { useLayoutEffect, useState, type RefObject } from 'react'

/** How wide the fade is: about one stat column, so the column it covers reads as cut by the edge. */
const FADE_PX = 28

/**
 * A right-edge fade on a box that scrolls sideways, while there is more to its right.
 *
 * A phone cuts a ten-column stat line or a game log at its last column with nothing to say the row
 * goes on: WAR, wRC+ or TB simply looked missing (player cards at 360px, Nov 8, 2026). The fade
 * says "more this way", as the photo rails' does. Right edge only, because every table that uses
 * this pins or leads with its label column on the left, and fading that would fade the label.
 *
 * A mask on the scroller itself, not an overlay: a mask is drawn against the box, not the scrolled
 * content, so it stays put, and the page shows through it in both themes. Gone once the reader
 * reaches the end, so the last column is never left half faded.
 */
export function useEdgeFade(ref: RefObject<HTMLElement | null>): { maskImage?: string; WebkitMaskImage?: string } {
  const [more, setMore] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const sync = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
    sync()
    el.addEventListener('scroll', sync, { passive: true })
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync)
    ro?.observe(el)
    // The table inside grows as its figures land, without the scroller changing size.
    if (el.firstElementChild) ro?.observe(el.firstElementChild)
    return () => { el.removeEventListener('scroll', sync); ro?.disconnect() }
  }, [ref])
  if (!more) return {}
  const mask = `linear-gradient(to right, #000 calc(100% - ${FADE_PX}px), transparent 100%)`
  return { maskImage: mask, WebkitMaskImage: mask }
}

import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { chromeScale } from '../scale'

// ─── How wide the drawing is ─────────────────────────────────────────────────
//
// A chart that draws into a viewBox and lets the SVG stretch to its box prints its type at
// (box width / viewBox width) times the size it is written at. A fixed viewBox is therefore right
// at exactly one width and wrong at every other.
//
// It went wrong both ways. On a desktop the MLB player page's card is over 1,000 screen px, so a
// 560-unit drawing was blown up close to 2x: a rolling chart 420px tall with 19px axis labels. On a
// phone the same drawing was squeezed into 329px, and its 12.5-unit labels printed at 7px. This hook
// fixed the desktop first and kept 560 as a floor, so phones went on drawing the shrunk version
// until the Oct 2026 chart audit measured it.
//
// So the drawing is laid out at the box's own width, in chrome px, at every width: its labels stay
// the size they are written at, its height stays what it was written as (times the desktop scale,
// like everything else), and a wider box becomes more x-axis rather than bigger letters. `initial`
// is only the width of the first render before the box is measured, and `min` stops a very narrow
// box squeezing the plot area to nothing.
export function useChartViewWidth(ref: RefObject<HTMLElement | null>, initial: number, min = 280): number {
  const [w, setW] = useState(initial)
  // The box the ref points at can come and go (each chart has a "not enough games" branch with no
  // chart in it), so the observer follows whichever element is there after each render.
  const watched = useRef<{ el: Element; ro: ResizeObserver } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (watched.current?.el === el) return
    watched.current?.ro.disconnect()
    watched.current = null
    if (!el) return
    const read = () => {
      const px = el.getBoundingClientRect().width
      if (px > 0) setW(Math.max(min, Math.round(px / chromeScale())))
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    watched.current = { el, ro }
  })
  // Forgotten as well as disconnected, or a remount (React's dev double-mount, a Suspense retry)
  // finds the same element "already watched" and never observes it again.
  useLayoutEffect(() => () => { watched.current?.ro.disconnect(); watched.current = null }, [])
  return w
}

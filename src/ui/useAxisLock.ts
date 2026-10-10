import { useEffect } from 'react'
import type { RefObject } from 'react'

// ONE AXIS PER DRAG on a scroll box that scrolls both ways, both sections' stats tables.
//
// A stats table on a phone scrolls sideways through its columns and down through its rows, and a
// thumb never drags in a straight line: a swipe across to reach SLG also moved the rows a few
// places, so the row the reader was following was gone by the time the column arrived. A
// spreadsheet app locks a drag to the axis it started in, and so does this.
//
// HOW: the first few pixels of a drag decide the axis, and the other axis is set to
// `overflow: hidden` on the element for the rest of the gesture, which keeps its scroll position
// and stops it moving. It is released when the fling that follows the finger has settled
// (`scrollend`, with a timeout where the browser has none), or at the next touch.
//
// PASSIVE LISTENERS ONLY, deliberately. A cancellable touch listener makes every scroll under it
// wait for JavaScript (see CLAUDE.md), which is the jank this exists to remove, not to add. The
// lock is applied from the first touchmove, before the browser's touch slop has started a scroll,
// so the browser latches the gesture onto an element that can only move one way.
//
// Inline styles, cleared back to '' on release, so whatever the element's own styles say about
// overflow (the phone table's "hidden until the board pins") is what applies again afterwards.

const DECIDE_PX = 6
const SETTLE_FALLBACK_MS = 700

export function useAxisLock(ref: RefObject<HTMLElement | null>, key: unknown) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let x0 = 0, y0 = 0
    let locked = false
    let deciding = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const release = () => {
      if (timer) { clearTimeout(timer); timer = null }
      el.removeEventListener('scrollend', release)
      if (!locked) return
      locked = false
      el.style.overflowX = ''
      el.style.overflowY = ''
    }
    const start = (e: TouchEvent) => {
      release()
      deciding = e.touches.length === 1
      if (!deciding) return
      x0 = e.touches[0].clientX
      y0 = e.touches[0].clientY
    }
    const move = (e: TouchEvent) => {
      if (!deciding || e.touches.length !== 1) return
      const dx = Math.abs(e.touches[0].clientX - x0)
      const dy = Math.abs(e.touches[0].clientY - y0)
      if (Math.max(dx, dy) < DECIDE_PX) return
      deciding = false
      locked = true
      if (dx > dy) el.style.overflowY = 'hidden'
      else el.style.overflowX = 'hidden'
    }
    const end = () => {
      deciding = false
      if (!locked) return
      el.addEventListener('scrollend', release)
      timer = setTimeout(release, SETTLE_FALLBACK_MS)
    }

    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: true })
    el.addEventListener('touchend', end, { passive: true })
    el.addEventListener('touchcancel', end, { passive: true })
    return () => {
      release()
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  }, [ref, key])
}

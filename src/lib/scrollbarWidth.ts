// THE PAGE'S SCROLLBAR, AS A CSS LENGTH. `100vw` counts a classic scrollbar, so a column sized
// `calc(100vw - 24px)` on Windows came out 17px wider than the page it sat in: at 1440 the Stats
// boards started 4.5px from the window's edge, and 12px with an overlay scrollbar (Nov 7, 2026
// audit). The widths in src/ui/layoutWidths.ts subtract `--sd-scrollbar-w` instead of guessing.
// Zero with overlay scrollbars and on a phone, where the scrollbar takes no room.

/** Publishes the scrollbar's width on `:root`, and again whenever it appears or goes. */
export function publishScrollbarWidth(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const root = document.documentElement
  let last = -1
  const publish = () => {
    const w = Math.max(0, window.innerWidth - root.clientWidth)
    if (w === last) return
    last = w
    root.style.setProperty('--sd-scrollbar-w', `${w}px`)
  }
  publish()
  window.addEventListener('resize', publish, { passive: true })
  // The scrollbar comes and goes with the page's HEIGHT, which fires no resize: a short board that
  // grows into a long one. The root's own box narrows by exactly the scrollbar when it appears.
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(publish).observe(root)
}

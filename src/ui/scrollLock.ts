import { useEffect, useLayoutEffect } from 'react'

// Ref-counted page scroll lock: while anything is laid over the page, the page behind it must not
// scroll. Counted so stacked overlays (a game, then a player) release it only when the last one
// closes. Compensates for the removed scrollbar width so locking does not shift the page sideways.
//
// ONE COUNTER FOR THE WHOLE APP, which is why it is its own module. MLB's fullscreen views had a
// second lock with its own count until Oct 2026, and two counters cannot see each other: a sheet
// opened over a fullscreen chart, then the chart closed first, put the page's overflow back while
// the sheet was still up, so the page scrolled under it. That lock also set only <body>, which is
// not the scroller here (see below), so it never froze anything to begin with.
let scrollLockCount = 0
const savedScroll = { htmlOverflow: '', bodyOverflow: '' }

// The lock and the side panel both take the page's scrollbar away, and either can outlast the
// other, so its stand-in padding has one count: it goes only when neither needs it.
let gapHolders = 0
let savedPaddingRight = ''

function holdScrollbarGap() {
  if (gapHolders++ === 0) {
    // The viewport scroller is <html> here (not <body>), so lock both to cover
    // whichever element actually scrolls. Compensate the removed scrollbar width
    // on <body> so the page doesn't jump sideways when the bar disappears.
    //
    // CLAMPED, BECAUSE `innerWidth - clientWidth` IS NOT ALWAYS THE SCROLLBAR. It is the scrollbar
    // only when both describe the same layout viewport in CSS px. In a scaled context (the desktop
    // preview pane, a mobile webview or installed PWA, browser zoom, or a page wider than the
    // screen) `window.innerWidth` reports a larger number while `clientWidth` stays the real width,
    // so the difference is hundreds of px of nothing, and unclamped it pads the body until the whole
    // app is squeezed into a sliver behind every open sheet. A real scrollbar is at most a couple
    // dozen CSS px, so anything past that is the formula being fooled and there is no bar to
    // compensate for anyway.
    const rawGap = window.innerWidth - document.documentElement.clientWidth
    const gap = rawGap > 0 && rawGap <= 40 ? rawGap : 0
    savedPaddingRight = document.body.style.paddingRight
    if (gap > 0) document.body.style.paddingRight = `${gap}px`
  }
}

function releaseScrollbarGap() {
  if (--gapHolders === 0) document.body.style.paddingRight = savedPaddingRight
}

function lockBodyScroll() {
  if (scrollLockCount++ === 0) {
    holdScrollbarGap()
    savedScroll.htmlOverflow = document.documentElement.style.overflow
    savedScroll.bodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
  }
}

function unlockBodyScroll() {
  if (--scrollLockCount <= 0) {
    scrollLockCount = 0
    document.documentElement.style.overflow = savedScroll.htmlOverflow
    document.body.style.overflow = savedScroll.bodyOverflow
    releaseScrollbarGap()
  }
}

/** Freeze the page while `active`. Mount it in an overlay that is only mounted while open, or pass
 *  the overlay's open flag. */
export function useScrollLock(active: boolean = true) {
  useEffect(() => {
    if (!active) return
    lockBodyScroll()
    return unlockBodyScroll
  }, [active])
}

let hiddenBarCount = 0
let savedScrollbarWidth = ''

/** Hide the page's scrollbar but leave the page scrollable, for a side panel on the right edge.
 *  With both bars showing, the page's is the one on the screen edge, so dragging what looks like
 *  the panel's scrollbar scrolled the page behind it (Nov 22, 2026). A layout effect, so the panel's
 *  first frame is already on the edge and a swap never flashes the bar back. */
export function useHidePageScrollbar() {
  useLayoutEffect(() => {
    // Without support the bar stays, and padding for it would narrow the page for nothing.
    if (!globalThis.CSS?.supports?.('scrollbar-width', 'none')) return
    const root = document.documentElement
    if (hiddenBarCount++ === 0) {
      holdScrollbarGap()
      savedScrollbarWidth = root.style.scrollbarWidth
      root.style.scrollbarWidth = 'none'
    }
    return () => {
      if (--hiddenBarCount > 0) return
      root.style.scrollbarWidth = savedScrollbarWidth
      releaseScrollbarGap()
    }
  }, [])
}

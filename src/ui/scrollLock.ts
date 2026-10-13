import { useEffect } from 'react'

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
const savedScroll = { htmlOverflow: '', bodyOverflow: '', bodyPaddingRight: '' }

function lockBodyScroll() {
  if (scrollLockCount++ === 0) {
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
    savedScroll.htmlOverflow = document.documentElement.style.overflow
    savedScroll.bodyOverflow = document.body.style.overflow
    savedScroll.bodyPaddingRight = document.body.style.paddingRight
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    if (gap > 0) document.body.style.paddingRight = `${gap}px`
  }
}

function unlockBodyScroll() {
  if (--scrollLockCount <= 0) {
    scrollLockCount = 0
    document.documentElement.style.overflow = savedScroll.htmlOverflow
    document.body.style.overflow = savedScroll.bodyOverflow
    document.body.style.paddingRight = savedScroll.bodyPaddingRight
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

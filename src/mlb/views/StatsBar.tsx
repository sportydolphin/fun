import React, { useEffect, useRef, useState } from 'react'
import { Box } from '@mui/material'

// THE STATS TAB'S CONTROL BAR, PINNED, as WPBL's is (barRef in src/wpbl/StatsView.tsx): the board
// tabs and the board's own controls stay under the toolbar while a long board scrolls, so changing
// the side, the season or the view never means scrolling back to the top. Until Oct 2026 MLB's
// scrolled away with the page and WPBL's did not, the one difference left between the two tabs.
//
// ON A PHONE THE BOARD TABS SCROLL AWAY and only the controls pin, WPBL's trade: which board is a
// choice made once, the controls are what a reader reaches for while reading, and every pixel the
// bar pins comes off the screen the board has to fit in.
//
// THE BOARD PINS UNDER IT (STATS_BOARD_TOP), or scrolling the page would carry the table's column
// headings up behind the bar. That needs the bar's height, which depends on how its controls wrap,
// so the bar measures itself and publishes `--mlb-stats-bar-h`. It is only ever a sticky OFFSET,
// never a height: a wrong measurement pins a few pixels off, and cannot size anything to nothing.
//
// A sticky element holds only while its containing block has room left, so each board's root is
// stretched to fill the tab (flexGrow in MlbStats), which moves the slack from after the board to
// inside it, as WPBL's stretch does.

/** Where the bar pins: under the shell's toolbar, which publishes its own pinned height. */
export const STATS_BAR_TOP = 'var(--app-header-h, 0px)'
/** Where a board pins: under the bar. */
export const STATS_BOARD_TOP = 'calc(var(--app-header-h, 0px) + var(--mlb-stats-bar-h, 0px))'

/** Spread into a board's root, so the bar and the board have somewhere to stay pinned. */
export const STATS_BOARD_ROOT_SX = { flexGrow: 1 } as const

export function StatsBar({ tabs, isDesktop, onHeld, children }: {
  /** The board tabs: inside the bar on a desktop, above it (and not pinned) on a phone. */
  tabs: React.ReactNode
  isDesktop: boolean
  /** Told whether the bar is being held under the toolbar, or the page cannot scroll any further:
   *  the phone's full table takes vertical scroll only then (see StatsView). */
  onHeld?: (held: boolean) => void
  children: React.ReactNode
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const markRef = useRef<HTMLDivElement>(null)
  // An edge once the bar is holding something under it, and none at rest, as WPBL's: without one,
  // rows slide up and vanish into a band of page colour, which reads as the table being eaten.
  const [stuck, setStuck] = useState(false)
  const onHeldRef = useRef(onHeld)
  onHeldRef.current = onHeld

  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const root = document.documentElement
    // The rect, not offsetHeight, which rounds: a bar 54.6px tall published as 55 leaves a sliver
    // of the board's rows showing between the two.
    const publish = () => root.style.setProperty('--mlb-stats-bar-h', `${el.getBoundingClientRect().height}px`)
    publish()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish)
    ro?.observe(el)
    return () => { ro?.disconnect(); root.style.removeProperty('--mlb-stats-bar-h') }
  }, [])

  useEffect(() => {
    // Read on scroll rather than in a frame callback: a hidden pane fires none (see CLAUDE.md).
    const check = () => {
      const mark = markRef.current
      if (!mark) return
      const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-header-h')) || 0
      const held = mark.getBoundingClientRect().top < top - 0.5
      setStuck(held)
      // The page's end counts as held: a page too short to carry the board all the way up must
      // still let it scroll from wherever the page stops.
      const atBottom = window.scrollY >= document.documentElement.scrollHeight - window.innerHeight - 2
      onHeldRef.current?.(held || atBottom)
    }
    check()
    window.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    return () => { window.removeEventListener('scroll', check); window.removeEventListener('resize', check) }
  }, [])

  return (
    <>
      {!isDesktop && tabs}
      {/* Where the bar sits when nothing is pinning it. Zero height, no paint. */}
      <Box ref={markRef} aria-hidden sx={{ height: 0 }} />
      <Box ref={barRef} sx={{
        position: 'sticky', top: STATS_BAR_TOP, zIndex: 6,
        bgcolor: 'background.default',
        // The gap under the controls is padding rather than margin, so it is painted: rows passing
        // under the bar disappear at its edge, not a few pixels below it.
        pt: { xs: 0.5, sm: 1 }, pb: { xs: 1, sm: 1.5 },
        // Bottom edge only: a spread equal to minus the blur cancels the shadow's reach sideways.
        boxShadow: stuck ? '0 6px 6px -6px rgba(0,0,0,0.14)' : 'none',
        transition: 'box-shadow 0.2s',
        // Paint over the seam with the toolbar, which the two sticky offsets agree on only to within
        // a rounding error: WPBL's cover, for the same device pixel of a stats row.
        '&::before': {
          content: '""', position: 'absolute', left: 0, right: 0, top: -4, height: 4,
          bgcolor: 'background.default', pointerEvents: 'none',
        },
      }}>
        {isDesktop && tabs}
        {children}
      </Box>
    </>
  )
}

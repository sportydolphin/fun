import type React from 'react'
import { useRef } from 'react'
import { fetchSeasonPlayerStats } from '../api'

// Helpers shared by RollingWindowChart and PlayerTrendsChart. Split out of
// PlayerTrendsChart.tsx (July 2026) so the rolling chart can live in its own file
// without either component importing the other.

// ─── League avg cache (module-level, keyed "hitting-2023") ────────────────────
//
// The raw per-season payload is fetched + cached once in api.ts and shared with
// the leaderboard / rankings; here we just cache the lighter mapped-to-`.stat`
// projection so repeated chart interactions don't re-map 2,000 rows each time.

const leagueStatsCache = new Map<string, Promise<any[]>>()
const LEAGUE_CACHE_MAX = 30

export function fetchLeagueStatsBySeason(season: number, group: 'hitting' | 'pitching'): Promise<any[]> {
  const key = `${group}-${season}`
  if (!leagueStatsCache.has(key)) {
    if (leagueStatsCache.size >= LEAGUE_CACHE_MAX) {
      // Evict oldest entry (Map iteration order = insertion order)
      leagueStatsCache.delete(leagueStatsCache.keys().next().value!)
    }
    leagueStatsCache.set(key,
      fetchSeasonPlayerStats(group, season).then(splits => splits.map((s: any) => s.stat))
    )
  }
  return leagueStatsCache.get(key)!
}

// The width hook moved to src/ui/charts so WPBL's charts can lay out the same way.
export { useChartViewWidth } from '../../ui/charts/useViewWidth'

// ─── Touch: scrub sideways, scroll up and down ───────────────────────────────
//
// A finger that lands on a chart and drags UP OR DOWN is scrolling the page, and one that drags
// SIDEWAYS is reading the chart. Both charts used to claim every touch (a non-passive touchstart
// that called preventDefault), so a page could not be scrolled by a thumb that happened to start
// on the graph, which on a phone is most of a screen.
//
// THE BROWSER DECIDES, WITH NO WAIT OF OUR OWN. `touch-action: pan-y` hands vertical panning back to
// the browser and keeps horizontal movement for the page, and pointer events report the browser's
// verdict as it happens: the tip is drawn on the first contact, follows the finger while it moves
// sideways, and the moment the browser takes the gesture for a scroll it sends `pointercancel` and
// the tip goes. A hand-rolled "wait for 8px, then pick an axis" would put that 8px of nothing in
// front of every read of the chart, which is the delay this exists to avoid.
//
// ONLY A TAP SELECTS. A finger that slid along the chart was reading it, and lifting it is the end
// of the reading, not a choice: on the career chart, release used to open whichever year the slide
// happened to end on, so looking at 2021 on the way to 2023 took the reader to 2023's page. A slide
// now just lets go; a tap (a touch that stayed within a few px) still opens what is under it.
//
// The click the browser synthesizes after a tap is swallowed, or a tap would select twice, and so
// is the mousemove it synthesizes, which would otherwise leave a hover tip pinned on a screen with
// no hover.
export interface TouchScrubHandlers {
  /** The finger is at this point: draw the tip there. */
  pick: (clientX: number, clientY: number) => void
  /** A tap: act on what is under it, and drop the tip. */
  release: () => void
  /** A slide that ended, or a gesture the browser took for a scroll: drop the tip without acting. */
  clear: () => void
}

/** How far a finger may drift and still be a tap, in CSS px. A thumb rarely lands perfectly still. */
const TAP_SLOP = 10

export function useTouchScrub() {
  const handlers = useRef<TouchScrubHandlers | null>(null)
  const active = useRef(false)
  const start = useRef({ x: 0, y: 0 })
  const slid = useRef(false)
  const lastTouch = useRef(0)
  const isTouch = (e: React.PointerEvent) => e.pointerType !== 'mouse'
  const stamp = () => { lastTouch.current = Date.now() }
  const props = {
    onPointerDown: (e: React.PointerEvent) => {
      if (!isTouch(e)) return
      active.current = true; slid.current = false; stamp()
      start.current = { x: e.clientX, y: e.clientY }
      handlers.current?.pick(e.clientX, e.clientY)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!isTouch(e) || !active.current) return
      stamp()
      if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > TAP_SLOP) slid.current = true
      handlers.current?.pick(e.clientX, e.clientY)
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (!isTouch(e) || !active.current) return
      active.current = false; stamp()
      if (slid.current) handlers.current?.clear()
      else handlers.current?.release()
    },
    onPointerCancel: (e: React.PointerEvent) => {
      if (!isTouch(e)) return
      active.current = false; stamp()
      handlers.current?.clear()
    },
  }
  return {
    /** Spread on the svg, beside `touchAction: 'pan-y'` in its style. */
    props,
    /** Set each render, once the chart's geometry exists (after any early return). */
    bind: (h: TouchScrubHandlers) => { handlers.current = h },
    /** True for the mouse events a browser fires after a touch, which the chart should ignore. */
    fromTouch: () => Date.now() - lastTouch.current < 800,
  }
}

// ─── Hover-tooltip anchoring (shared by both chart tooltips) ─────────────────
//
// Always anchored above the hovered/touched point, never below, by design:
// a tooltip below the point gets covered by a finger on touch, and showing it
// on one side sometimes and the other side other times reads as inconsistent.
// The gap between the point and the tooltip differs by input: on touch, a
// finger occludes a wide area around the contact point, so the tooltip needs
// real clearance; a mouse cursor is a single pixel, so it can sit right above it.
export function tooltipAnchorSx(tipPos: { x: number; y: number }, canHover: boolean) {
  const gapPx = canHover ? 10 : 40
  const tipLeft = Math.min(Math.max(tipPos.x, 12), 82)
  return {
    left: `${tipLeft}%`,
    top: `calc(${tipPos.y}% - ${gapPx}px)`,
    transform: 'translate(-50%, -100%)',
  } as const
}

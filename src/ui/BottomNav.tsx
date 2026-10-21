import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { Box, Typography, alpha } from '@mui/material'
import {
  HomeOutlined, Home,
  FormatListNumberedOutlined, FormatListNumbered,
  BarChartOutlined, BarChart,
  GroupsOutlined, Groups,
  MoreHoriz,
  ScoreboardOutlined, Scoreboard,
} from '@mui/icons-material'
import { typePx } from './scale'
import { useGlassLevel, GLASS_DEFAULT } from './glassLevel'

// Floating bottom tab bar for a league section, phones only. Shared by /wpbl and /mlb (moved out of
// src/wpbl on Sep 28, 2026, when MLB took the same shell): the section passes its own accent. It
// replaced a sticky row of tab pills at the top, because the top of a tall phone screen is the
// least reachable place to put the section's destinations. Above a phone the tabs are in the
// toolbar (src/ToolbarNav.tsx).
//
// GLASS, since Oct 17, 2026, as the first piece of the Apple-style overhaul (ROADMAP-UI.md). It was
// opaque until then because a backdrop-filter costs a compositing layer over every scroll, the
// classic jank source on mid-range Android. The bar is small and fixed, so that layer is one pill,
// not the page; if scrolling under it stutters on a phone, the blur radius is the first thing to cut.
// The fill stays mostly opaque so the labels hold their contrast over whatever scrolls beneath, and
// a reader who asks for less transparency, or a browser without backdrop-filter, gets the old
// solid bar (GLASS_FALLBACK).

export interface BottomNavItem {
  key: string
  label: string
  /** Draws a "something new here" dot on the icon. See src/lib/seen.ts. */
  badge?: boolean
  /** The tab's address, which makes it a real link: a crawler follows it and a modified click
   *  opens it in a new tab. A plain tap still goes through `onChange`. */
  href?: string
}

// Filled icon when active, outlined when not: the standard tab-bar cue, and it means the
// bar still reads correctly for anyone who can't distinguish the accent color.
const ICONS: Record<string, { on: typeof Home; off: typeof HomeOutlined }> = {
  home:      { on: Home,                off: HomeOutlined },
  schedule:  { on: Scoreboard,          off: ScoreboardOutlined },  // WPBL's Scores tab, MLB's icon
  standings: { on: FormatListNumbered,  off: FormatListNumberedOutlined },
  stats:     { on: BarChart,            off: BarChartOutlined },
  teams:     { on: Groups,              off: GroupsOutlined },
  scores:    { on: Scoreboard,          off: ScoreboardOutlined },
  // Not a destination but a menu trigger, so there is no filled/outlined pair to swap: three dots
  // are three dots. It rides the same slot machinery as the tabs and just changes color when its
  // sheet is open. See the MORE_KEY handling below and WpblMoreSheet.
  more:      { on: MoreHoriz,           off: MoreHoriz },
}

// The sixth slot. It is a menu opener, not a view, so it is kept out of the selection machinery
// (`shown`/`pending` never land on it, and the sliding indicator only on a More page, see
// `moreCurrent`) and calls `onMore` instead.
export const MORE_KEY = 'more'

// The bar's vertical geometry, in px and in one place, because the pieces have to agree:
// the selection bubble is centered on the icon, and the label has to clear the bubble's
// bottom edge. Deriving the bubble's offset from these (rather than hand-tuning each) is
// what stops the three from drifting apart the next time one of them is nudged.
const TAB_PAD_Y = 7        // breathing room above the icon and below the label
const ICON_PX = 22         // the icon's box; both icons are drawn to fill it
const BUBBLE_W = 44        // wide enough to read as a pill, narrow enough to belong to the icon
const BUBBLE_H = 28        // 3px of air above and below a 22px icon
const ICON_LABEL_GAP = 5   // ≥ the bubble's overhang, so the pill never touches the label
const LABEL_REM = 0.62
// Descenders live below the baseline, and the label clips its own overflow to ellipsise a
// long name: at line-height 1 that clipping cuts the tail off the "g" in "Standings".
const LABEL_LINE_HEIGHT = 1.3
const FLOAT_GAP = 10       // how far the bar hovers above the bottom edge

// How long the optimistic selection may outlive reality before the bar gives up on it.
const PENDING_STALL_MS = 2000

// The inactive tab color, and it is OPAQUE ON PURPOSE. MUI's dark `text.secondary` is white at
// 0.7 alpha (the theme does not override it), and animating THAT to the opaque accent on tap raises
// the alpha toward 1 while the hue is still white, so the icon flashes white before it turns blue.
// An opaque grey of about the same weight interpolates straight to the accent with nothing white in
// between. Two values because the resting shade differs by mode; both clear AA on every skin's paper.
const INACTIVE_TAB = { dark: '#a7adb7', light: '#5f6570' } as const

// ONE DURATION AND CURVE FOR EVERY PART OF A SELECTION. A tap changes three things (the indicator
// bubble slides to the tab, the icon fills in, the icon and label recolor), and if any of them runs
// on its own timing the tap reads as disjoint: the glyph snapping first and the color catching up
// as the bubble arrives. Sharing the duration and easing makes them start and finish together. The
// same 300ms and curve as the pager's tap slide (SLIDE_EASE / TAP_MS in SwipeableViews), so the
// whole screen moves as a unit.
const SELECT_MS = 300
const SELECT_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'

// The glass, as a function of one level (0 nearly solid, 1 clear; see glassLevel.ts). At the
// default 0.5 the fill is the raised tone at 72%: low enough that colour from the page shows
// through the blur, high enough that a white headline sliding under a label cannot drag it below
// AA. Saturate is what makes it read as glass rather than frosted plastic: the blurred colour comes
// through richer instead of washed out. The lit top rim and faint inner glow are the two cues that
// make a translucent pill read as a lens with thickness; inset shadows, so they cost no layout.
const glass = (level: number) => ({
  alpha: { dark: 0.96 - 0.48 * level, light: 0.98 - 0.48 * level },
  blur: `blur(${Math.round(8 + 24 * level)}px) saturate(${Math.round(120 + 120 * level)}%)`,
  rim: {
    dark: `inset 0 1px 0 rgba(255,255,255,${(0.06 + 0.16 * level).toFixed(3)}), inset 0 0 0 1px rgba(255,255,255,${(0.08 * level).toFixed(3)})`,
    light: `inset 0 1px 0 rgba(255,255,255,0.9), inset 0 0 0 1px rgba(255,255,255,${(0.7 * level).toFixed(3)})`,
  },
})
const GLASS_FALLBACK = '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))'
const LESS_TRANSPARENCY = '@media (prefers-reduced-transparency: reduce)'

// What the bar actually measures: the px pieces above plus its 1px border top and bottom,
// and then the label, which is the one part measured in rem.
const BAR_PX = TAB_PAD_Y * 2 + ICON_PX + ICON_LABEL_GAP + 2

/** Height of the bar plus its float gap: callers reserve this much scroll room beneath the
 *  content so the last card isn't parked under the bar. Excludes the safe-area inset, which
 *  callers add on top. Derived, so that changing the bar's proportions can't quietly leave
 *  the last card parked underneath it.
 *
 *  A CSS expression rather than a number, because the label term is in rem. A px constant
 *  would assume a 16px root, and under the Large text setting the reserved strip would come up
 *  a few pixels short and park the last card under the bar. Left without a `calc()` wrapper so
 *  callers can compose it with their own terms. */
export const BOTTOM_NAV_SPACE = `${BAR_PX + FLOAT_GAP + 10}px + ${(LABEL_REM * LABEL_LINE_HEIGHT).toFixed(3)}rem`

export default function BottomNav({ items, value, onChange, onMore, moreOpen = false, moreCurrent = false, accent, badgeColor = accent, label, moreLabel }: {
  items: BottomNavItem[]
  value: string
  onChange: (key: string) => void
  /** Tapping the More slot (MORE_KEY) calls this instead of selecting a view; the parent opens the
   *  sheet. Omit it and no More slot should be passed in `items`. */
  onMore?: () => void
  /** Whether the More sheet is open, so its slot can read as active while it is. */
  moreOpen?: boolean
  /** The page on screen is one of More's (src/StandaloneBottomNav.tsx), so More is lit and holds
   *  the bubble, as the toolbar lights More on those pages above a phone. */
  moreCurrent?: boolean
  /** The section's accent: the active tab's color. */
  accent: string
  /** The "new" dot. Defaults to the accent; WPBL passes its skin-aware solid accent. */
  badgeColor?: string
  /** Names the nav for assistive tech ("WPBL sections"). */
  label: string
  /** Names the More slot ("More WPBL pages"). */
  moreLabel: string
}) {
  // Optimistic selection. The tap and the new panel's render land in the same paint, so a bar
  // driven only by `value` cannot light up until the tab's content has rendered. The bar moves on
  // its own state immediately and hands the real navigation to the next frame, so the indicator is
  // already traveling while the panel renders. `pending` clears as soon as the parent confirms
  // the new value.
  const [pending, setPending] = useState<string | null>(null)
  const stall = useRef<number | undefined>(undefined)
  const clearStall = () => {
    if (stall.current !== undefined) { clearTimeout(stall.current); stall.current = undefined }
  }
  useEffect(() => { setPending(null); clearStall() }, [value])
  useEffect(() => clearStall, [])
  const shown = pending ?? value
  const tuned = useGlassLevel()
  const g = glass(tuned ?? GLASS_DEFAULT)

  const count = Math.max(1, items.length)
  const index = Math.max(0, items.findIndex(i => i.key === (moreCurrent && !pending ? MORE_KEY : shown)))

  const select = (key: string) => {
    // `shown`, not `value`: while a selection is pending, tapping the tab we are already
    // traveling to is a no-op rather than a second navigation.
    if (key === shown) return
    setPending(key)
    // Recovery for a navigation that never lands. If `pending` were cleared only by the parent
    // confirming a new `value`, a stalled onChange would leave `shown` pointing at a tab never
    // reached, and EVERY later tap would hit the guard above and return: one stalled navigation
    // and the bar is dead for the session.
    //
    // Reachable for real: the handover below runs in a requestAnimationFrame, and rAF does not
    // fire while the document is hidden. Rather than enumerate causes, this bounds how long the
    // optimistic state may outlive reality. On expiry the indicator snaps back to where the reader
    // actually is, and taps work again.
    //
    // Generous on purpose: this only ever fires in the broken case, and a real navigation
    // updates `value` in the same commit as the parent's state change, long before this.
    clearStall()
    stall.current = window.setTimeout(() => { stall.current = undefined; setPending(null) }, PENDING_STALL_MS)
    requestAnimationFrame(() => onChange(key))
  }

  return (
    <Box
      component="nav"
      aria-label={label}
      sx={{
        position: 'fixed',
        left: 0, right: 0,
        // Sit above the home-indicator / gesture bar on iOS, and clear of Safari's bottom
        // URL bar. Falls back to a plain gap where env() is unsupported.
        bottom: `calc(${FLOAT_GAP}px + env(safe-area-inset-bottom, 0px))`,
        display: 'flex', justifyContent: 'center',
        px: 1.5,
        // Under modals (Game Center / player pages open above it) but over page content.
        zIndex: 1100,
        // NO `will-change: transform`, and none is needed: a plain fixed bar composites fine without a
        // layer hint. If this bar is ever seen anchored to the bottom of the DOCUMENT rather than the
        // viewport, look for something making the document wider than the screen (see the scroller note
        // in home/Scoreboard.tsx) before blaming layer promotion: a wider document grows a phone's
        // layout viewport, and every fixed element is placed against that.
        pointerEvents: 'none', // the strip is a positioning shell; only the pill takes taps
      }}
    >
      <Box sx={{
        pointerEvents: 'auto',
        position: 'relative',
        display: 'flex', alignItems: 'stretch',
        width: '100%', maxWidth: 460,
        borderRadius: 999,
        border: '1px solid', borderColor: 'outline',
        // Floats over the page, so it takes the raised tone (see Surfaces in ThemeContext), as glass.
        // `raised` is the app theme's own key: under a bare MUI theme it is undefined and alpha()
        // throws, taking the whole bar down, so fall back to paper.
        bgcolor: t => alpha(t.palette.background.raised ?? t.palette.background.paper, g.alpha[t.palette.mode]),
        backdropFilter: g.blur,
        WebkitBackdropFilter: g.blur,
        // Softer than the opaque bar's shadow: the blur now does part of the separating.
        boxShadow: t => `0 8px 28px rgba(0,0,0,${t.palette.mode === 'dark' ? 0.34 : 0.14}), 0 1px 4px rgba(0,0,0,${t.palette.mode === 'dark' ? 0.22 : 0.08}), ${g.rim[t.palette.mode]}`,
        overflow: 'hidden',
        [GLASS_FALLBACK]: { bgcolor: 'background.raised' },
        ...(tuned == null && { [LESS_TRANSPARENCY]: { bgcolor: 'background.raised', backdropFilter: 'none', WebkitBackdropFilter: 'none' } }),
      }}>
        {/* One indicator that slides between slots, rather than each tab animating its own
            background. Items are equal-width flex children, so its position is pure
            arithmetic: no measuring, nothing to resync on resize or font load. The easing is
            a decelerate curve, quick to leave and soft to arrive, which reads as physical. */}
        <Box aria-hidden sx={{
          position: 'absolute', top: 0, bottom: 0, left: 0,
          width: `${100 / count}%`,
          display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
          // Centered on the icon: start at the icon's top, then lift by the bubble's overhang.
          pt: `${TAB_PAD_Y - (BUBBLE_H - ICON_PX) / 2}px`,
          // Shared timing (see SELECT_MS/SELECT_EASE): the bubble, the icon fill and the recolor
          // all run this, and it matches the page pager's tap slide, so a tap moves as one unit.
          transform: `translateX(${index * 100}%)`,
          transition: `transform ${SELECT_MS}ms ${SELECT_EASE}`,
          pointerEvents: 'none',
        }}>
          {/* Wraps the ICON, not the whole slot. A full-slot bubble is one fifth of the bar wide,
              which leaves the longest label ("Standings") within a few pixels of its
              edge. Sized to the icon, label width stops mattering, and it is the same
              active-indicator shape Material uses. */}
          <Box sx={{
            width: BUBBLE_W, height: BUBBLE_H, borderRadius: 999,
            bgcolor: 'action.selected',
            // A small lens inside the big one: the same lit rim, so the selection reads as a
            // droplet sitting on the glass rather than a flat tint.
            boxShadow: t => g.rim[t.palette.mode],
          }} />
        </Box>

        {items.map(item => {
          const isMore = item.key === MORE_KEY
          // More is a menu opener, not a view: it reads active while its sheet is open, and it is
          // never the `shown` tab, so the sliding bubble travels to it only on a More page.
          const active = isMore ? moreOpen || (moreCurrent && !pending) : item.key === shown
          const set = ICONS[item.key]
          return (
            // Every item is a tab that is an anchor, or More, a button with its own key handling;
            // both come in through a conditional spread and a conditional role the lint cannot read.
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions
            <Box
              key={item.key}
              {...(item.href && !isMore ? { component: 'a' as const, href: item.href } : {})}
              onClick={(e: MouseEvent) => {
                if (item.href && !isMore) {
                  // A modified click is the reader asking the BROWSER for this URL, not the app.
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return
                  e.preventDefault()
                }
                if (isMore) onMore?.()
                else select(item.key)
              }}
              // More is the one item that is not a link, so it needs its own way in from a keyboard:
              // a tab stop and Enter or Space. The others are anchors and have both natively.
              onKeyDown={isMore ? (e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onMore?.() }
              } : undefined}
              tabIndex={isMore ? 0 : undefined}
              role={isMore ? 'button' : 'tab'}
              aria-selected={isMore ? undefined : active}
              aria-haspopup={isMore ? 'menu' : undefined}
              aria-expanded={isMore ? moreOpen : undefined}
              aria-label={isMore ? moreLabel : (item.badge ? `${item.label}, updated` : item.label)}
              sx={{
                position: 'relative', // above the sliding indicator
                flex: 1, minWidth: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: `${ICON_LABEL_GAP}px`, py: `${TAB_PAD_Y}px`,
                cursor: 'pointer', userSelect: 'none', textDecoration: 'none',
                WebkitTapHighlightColor: 'transparent',
                color: t => active ? accent : (t.palette.mode === 'dark' ? INACTIVE_TAB.dark : INACTIVE_TAB.light),
                // Drives the icon and the label (both inherit currentColor), on the shared timing
                // so the recolor finishes with the fill and the bubble rather than ahead of them.
                transition: `color ${SELECT_MS}ms ${SELECT_EASE}`,
              }}
            >
              {/* THE OUTLINE IS ALWAYS DRAWN; selection only fades the FILLED glyph in over it.
                  The two glyphs share a silhouette and a color, so with the outline permanently at
                  full opacity the icon can never leave the tab, and two half-lit glyphs can never
                  double into a dark pulse: both happen when the two glyphs are animated AGAINST each
                  other. Here only the fill moves, so the icon fills in and empties out and the
                  parent's color shift rides along. Filled is second in the DOM, so it sits ON TOP
                  and covers the outline cleanly when lit. No scale on the swap: a tab bar changes
                  often enough that a zoom on it is noise. */}
              <Box sx={{ position: 'relative', width: ICON_PX, height: ICON_PX, flexShrink: 0 }}>
                {/* Sits on the icon's top-right corner, outside its box so it never
                    overlaps the glyph. Same static dot as the toolbar tab's. */}
                {item.badge && (
                  <Box aria-hidden sx={{
                    position: 'absolute', top: -1, right: -3, zIndex: 1,
                    width: 6, height: 6, borderRadius: '50%',
                    bgcolor: badgeColor,
                    // A ring in the bar's own color, so the dot stays legible where it
                    // would otherwise sit directly on a stroke of the icon.
                    boxShadow: theme => `0 0 0 1.5px ${theme.palette.background.raised}`,
                  }} />
                )}
                {set && (
                  <>
                    <set.off sx={{ position: 'absolute', inset: 0, fontSize: `${ICON_PX}px` }} />
                    {/* Matches the parent's color transition, so the fill and the tint settle
                        together rather than one chasing the other. */}
                    <set.on sx={{
                      position: 'absolute', inset: 0, fontSize: `${ICON_PX}px`,
                      opacity: active ? 1 : 0, transition: `opacity ${SELECT_MS}ms ${SELECT_EASE}`,
                    }} />
                  </>
                )}
              </Box>
              {/* Fixed weight on purpose. Going 600 → 800 on selection changed the label's
                  width and nudged the row, which is the jolt that made the change feel janky;
                  color alone carries the state and costs no layout. */}
              <Typography sx={{
                fontSize: `${LABEL_REM}rem`,
                fontWeight: 700,
                lineHeight: LABEL_LINE_HEIGHT,
                letterSpacing: typePx(0.1),
                maxWidth: '100%',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                // The label inherits the item's color, so it already follows that transition; this
                // just keeps the declared timing consistent rather than leaving a stale 200ms here.
                transition: `color ${SELECT_MS}ms ${SELECT_EASE}`,
              }}>
                {item.label}
              </Typography>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

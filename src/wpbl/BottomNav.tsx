import { useEffect, useState } from 'react'
import { Box, Typography } from '@mui/material'
import {
  HomeOutlined, Home,
  CalendarMonthOutlined, CalendarMonth,
  FormatListNumberedOutlined, FormatListNumbered,
  BarChartOutlined, BarChart,
  GroupsOutlined, Groups,
} from '@mui/icons-material'
import { useWpblAccent } from './accent'

// Floating bottom tab bar for the WPBL section — phones only, and only when the reader has
// turned on experimental features in Settings. Being evaluated as a replacement for the
// sticky top pill nav: six destinations at the top of an 812px screen is the least
// reachable place on the device, and the sixth used to sit off-screen entirely.
//
// DELIBERATELY NOT GLASS. A backdrop-filter needs something worth blurring, and this app is
// dark cards on a near-black page — the blur would cost a compositing layer over a long
// scrolling stats table (the classic source of scroll jank on mid-range Android) and buy a
// slightly translucent bar. The floating pill shape is what gives the app-like feel; the
// blur is what would give the bug reports. Easy to add behind @supports later if a real
// device says otherwise.

export interface BottomNavItem {
  key: string
  label: string
}

// Filled icon when active, outlined when not — the standard tab-bar cue, and it means the
// bar still reads correctly for anyone who can't distinguish the accent colour.
const ICONS: Record<string, { on: typeof Home; off: typeof HomeOutlined }> = {
  home:      { on: Home,                off: HomeOutlined },
  schedule:  { on: CalendarMonth,       off: CalendarMonthOutlined },
  standings: { on: FormatListNumbered,  off: FormatListNumberedOutlined },
  stats:     { on: BarChart,            off: BarChartOutlined },
  teams:     { on: Groups,              off: GroupsOutlined },
}

// The bar's vertical geometry, in px and in one place, because the pieces have to agree:
// the selection bubble is centred on the icon, and the label has to clear the bubble's
// bottom edge. Deriving the bubble's offset from these (rather than hand-tuning each) is
// what stops the three from drifting apart the next time one of them is nudged.
const TAB_PAD_Y = 7        // breathing room above the icon and below the label
const ICON_PX = 22         // the icon's box; both icons are drawn to fill it
const BUBBLE_W = 44        // wide enough to read as a pill, narrow enough to belong to the icon
const BUBBLE_H = 28        // 3px of air above and below a 22px icon
const ICON_LABEL_GAP = 5   // ≥ the bubble's overhang, so the pill never touches the label
const LABEL_REM = 0.62
// Descenders live below the baseline, and the label clips its own overflow to ellipsise a
// long name — at line-height 1 that clipping cut the tail off the "g" in "Standings".
const LABEL_LINE_HEIGHT = 1.3
const FLOAT_GAP = 10       // how far the bar hovers above the bottom edge

// What the bar actually measures, from the pieces above plus its 1px border top and bottom.
const BAR_H = TAB_PAD_Y * 2 + ICON_PX + ICON_LABEL_GAP + Math.round(LABEL_REM * 16 * LABEL_LINE_HEIGHT) + 2

/** Height of the bar plus its float gap — callers reserve this much scroll room beneath the
 *  content so the last card isn't parked under the bar. Excludes the safe-area inset, which
 *  is added on top in the padding below. Derived, so that changing the bar's proportions
 *  can't quietly leave the last card parked underneath it. */
export const BOTTOM_NAV_SPACE = BAR_H + FLOAT_GAP + 10

export default function WpblBottomNav({ items, value, onChange }: {
  items: BottomNavItem[]
  value: string
  onChange: (key: string) => void
}) {
  // Optimistic selection. Tapping a tab used to look like it stalled: the tap and the new
  // panel's render landed in the same paint, so the bar couldn't light up until the tab's
  // content had finished rendering. The bar now moves on its own state immediately and hands
  // the real navigation to the next frame, so the indicator is already travelling while the
  // panel renders. `pending` clears as soon as the parent confirms the new value.
  const [pending, setPending] = useState<string | null>(null)
  const accent = useWpblAccent()
  useEffect(() => { setPending(null) }, [value])
  const shown = pending ?? value

  const count = Math.max(1, items.length)
  const index = Math.max(0, items.findIndex(i => i.key === shown))

  const select = (key: string) => {
    if (key === shown) return
    setPending(key)
    requestAnimationFrame(() => onChange(key))
  }

  return (
    <Box
      component="nav"
      aria-label="WPBL sections"
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
        // Keep the bar on its own compositor layer. A fixed element over a long scrolling
        // list is re-rastered as the page moves under it, and on Android that shows up as
        // the icons flickering while you scroll — this hands the bar to the compositor so
        // scrolling never repaints it.
        willChange: 'transform',
        pointerEvents: 'none', // the strip is a positioning shell; only the pill takes taps
      }}
    >
      <Box sx={{
        pointerEvents: 'auto',
        position: 'relative',
        display: 'flex', alignItems: 'stretch',
        width: '100%', maxWidth: 460,
        borderRadius: 999,
        border: '1px solid', borderColor: 'divider',
        bgcolor: 'background.paper',
        // A real shadow is what separates the bar from the page — it's doing the job the
        // blur would otherwise be doing, at no runtime cost.
        boxShadow: '0 6px 24px rgba(0,0,0,0.38), 0 2px 6px rgba(0,0,0,0.28)',
        overflow: 'hidden',
      }}>
        {/* One indicator that slides between slots, rather than each tab animating its own
            background. Items are equal-width flex children, so its position is pure
            arithmetic — no measuring, nothing to resync on resize or font load. The easing is
            a decelerate curve: quick to leave, soft to arrive, which is what makes it read as
            physical rather than linear. */}
        <Box aria-hidden sx={{
          position: 'absolute', top: 0, bottom: 0, left: 0,
          width: `${100 / count}%`,
          display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
          // Centred on the icon: start at the icon's top, then lift by the bubble's overhang.
          pt: `${TAB_PAD_Y - (BUBBLE_H - ICON_PX) / 2}px`,
          transform: `translateX(${index * 100}%)`,
          transition: 'transform 340ms cubic-bezier(0.32, 0.72, 0, 1)',
          pointerEvents: 'none',
        }}>
          {/* Wraps the ICON, not the whole slot. A full-slot bubble is only as wide as one
              fifth of the bar, so the longest labels ("Standings", "Schedule") ran within a
              few pixels of its edge and read as cramped. Sizing it to the icon takes label
              width out of the equation entirely — the labels now sit below it, free to be as
              long as they like — and it's the same active-indicator shape Material uses. */}
          <Box sx={{
            width: BUBBLE_W, height: BUBBLE_H, borderRadius: 999,
            bgcolor: 'action.selected',
          }} />
        </Box>

        {items.map(item => {
          const active = item.key === shown
          const set = ICONS[item.key]
          return (
            <Box
              key={item.key}
              onClick={() => select(item.key)}
              role="tab"
              aria-selected={active}
              aria-label={item.label}
              sx={{
                position: 'relative', // above the sliding indicator
                flex: 1, minWidth: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: `${ICON_LABEL_GAP}px`, py: `${TAB_PAD_Y}px`,
                cursor: 'pointer', userSelect: 'none',
                WebkitTapHighlightColor: 'transparent',
                color: active ? accent : 'text.secondary',
                transition: 'color 200ms ease',
              }}
            >
              {/* Both icons are mounted and swapped by opacity. Swapping the COMPONENT on
                  selection unmounted one SVG and mounted the other, which read as a dark
                  flash on the tab you just pressed — there was nothing to paint for a frame.

                  The two fades are staggered rather than simultaneous: outlined and filled
                  are the same glyph, so a plain cross-fade holds both at half opacity in the
                  middle, and the overlapping strokes make the icon swell and darken before
                  settling. That is the pulse you see on the tab you land on. Handing over in
                  sequence — old one out, then new one in — means only ever one glyph is
                  drawn. There is no scale on the swap either, for the same reason: a tab bar
                  changes tabs often enough that a zoom on every change is noise. */}
              <Box sx={{ position: 'relative', width: ICON_PX, height: ICON_PX, flexShrink: 0 }}>
                {set && ([['off', set.off] as const, ['on', set.on] as const]).map(([kind, Icon]) => {
                  const visible = kind === 'on' ? active : !active
                  return (
                    <Icon key={kind} sx={{
                      position: 'absolute', inset: 0, fontSize: `${ICON_PX}px`,
                      opacity: visible ? 1 : 0,
                      transition: visible
                        ? 'opacity 110ms ease-in 90ms'   // arriving: wait for the other to clear
                        : 'opacity 90ms ease-out',        // leaving: go first, quickly
                    }} />
                  )
                })}
              </Box>
              {/* Fixed weight on purpose. Going 600 → 800 on selection changed the label's
                  width and nudged the row, which is the jolt that made the change feel janky;
                  colour alone carries the state and costs no layout. */}
              <Typography sx={{
                fontSize: `${LABEL_REM}rem`,
                fontWeight: 700,
                lineHeight: LABEL_LINE_HEIGHT,
                letterSpacing: 0.1,
                maxWidth: '100%',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                transition: 'color 200ms ease',
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

import { useEffect, useState } from 'react'
import { Box, Typography } from '@mui/material'
import {
  HomeOutlined, Home,
  CalendarMonthOutlined, CalendarMonth,
  FormatListNumberedOutlined, FormatListNumbered,
  BarChartOutlined, BarChart,
  GroupsOutlined, Groups,
} from '@mui/icons-material'
import { WPBL_ACCENT } from './constants'

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

/** Height of the bar plus its float gap — callers reserve this much scroll room beneath the
 *  content so the last card isn't parked under the bar. Excludes the safe-area inset, which
 *  is added on top in the padding below. */
export const BOTTOM_NAV_SPACE = 76

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
        bottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
        display: 'flex', justifyContent: 'center',
        px: 1.5,
        // Under modals (Game Center / player pages open above it) but over page content.
        zIndex: 1100,
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
          pt: '3px',
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
            width: 46, height: 30, borderRadius: 999,
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
                gap: '2px', py: 0.85,
                cursor: 'pointer', userSelect: 'none',
                WebkitTapHighlightColor: 'transparent',
                color: active ? WPBL_ACCENT : 'text.secondary',
                transition: 'color 200ms ease',
              }}
            >
              {/* Both icons are mounted and cross-faded. Swapping the component on selection
                  unmounted one SVG and mounted the other, which read as a dark flash on the
                  tab you just pressed — there was nothing to paint for a frame. */}
              <Box sx={{ position: 'relative', width: '1.35rem', height: '1.35rem', flexShrink: 0 }}>
                {set && ([['off', set.off] as const, ['on', set.on] as const]).map(([kind, Icon]) => {
                  const visible = kind === 'on' ? active : !active
                  return (
                    <Icon key={kind} sx={{
                      position: 'absolute', inset: 0, fontSize: '1.35rem',
                      opacity: visible ? 1 : 0,
                      // The filled icon settles in from slightly small, so selecting has a
                      // little weight to it without moving anything around it.
                      transform: kind === 'on' && !active ? 'scale(0.82)' : 'scale(1)',
                      transition: 'opacity 200ms ease, transform 260ms cubic-bezier(0.32, 0.72, 0, 1)',
                    }} />
                  )
                })}
              </Box>
              {/* Fixed weight on purpose. Going 600 → 800 on selection changed the label's
                  width and nudged the row, which is the jolt that made the change feel janky;
                  colour alone carries the state and costs no layout. */}
              <Typography sx={{
                fontSize: '0.62rem',
                fontWeight: 700,
                lineHeight: 1,
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

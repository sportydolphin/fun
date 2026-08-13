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
        {items.map(item => {
          const active = item.key === value
          const set = ICONS[item.key]
          const Icon = set ? (active ? set.on : set.off) : null
          return (
            <Box
              key={item.key}
              onClick={() => onChange(item.key)}
              role="tab"
              aria-selected={active}
              aria-label={item.label}
              sx={{
                flex: 1, minWidth: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: '2px', py: 0.85,
                cursor: 'pointer', userSelect: 'none',
                WebkitTapHighlightColor: 'transparent',
                color: active ? WPBL_ACCENT : 'text.secondary',
                transition: 'color 0.15s',
                '&:active': { transform: 'scale(0.93)' },
              }}
            >
              {Icon && <Icon sx={{ fontSize: '1.35rem' }} />}
              <Typography sx={{
                fontSize: '0.62rem',
                fontWeight: active ? 800 : 600,
                lineHeight: 1,
                letterSpacing: 0.1,
                maxWidth: '100%',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
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

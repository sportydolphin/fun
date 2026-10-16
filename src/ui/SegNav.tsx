import React, { useEffect, useRef } from 'react'
import { Box } from '@mui/material'
import type { Theme, SxProps } from '@mui/material'
import { scrollBehavior } from '../lib/motion'
import { pressable, FOCUS_RING } from './interaction'
import { TYPE_SCALE } from './card'
import { isModified } from '../nav'

/** A "there is something new here" dot.
 *
 *  Deliberately a static 6px circle: no pulse, no "NEW" wordmark. The brief was
 *  unintrusive, and a dot is the quietest mark that still reads as "this changed". It takes
 *  the section accent rather than a notification red, because red reads as "you have a
 *  problem" and this is an invitation.
 *
 *  Invisible to a screen reader by design; the tab that owns it carries the news in its
 *  accessible name instead, so the nudge is not purely visual. */
export function NewDot({ sx }: { sx?: SxProps<Theme> }) {
  return (
    <Box aria-hidden sx={{
      width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
      bgcolor: 'var(--wpbl-accent-solid)',
      ...sx,
    }} />
  )
}

// Absolutely placed at the pill's top-right, so the dot costs no layout. An inline dot would
// widen the tab it sits on, and these pills live in a horizontal scroll strip: the whole row
// would shift the moment the badge retired, which is exactly the wrong time to move the
// thing someone just tapped.
const SEG_DOT_SX = { position: 'absolute' as const, top: 5, right: 6 }

// Pill segmented control for NAVIGATION: a page's own tabs, a sheet's tabs, a player's roles.
// Moved out of src/wpbl/ui.tsx in Oct 2026, when MLB's SegControl turned out to be this pill with
// the strip, the badge and the sizes left off; two copies of one look drift one fix at a time.
export function SegNav({ options, value, onChange, accent, mb = { xs: 0, sm: 3 }, size = 'md', fill = false }: {
  /** `badge` draws a NewDot on that option. Opt-in per item because this control is shared
   *  with the MLB section, which has nothing to announce.
   *
   *  `href` renders that pill as a real <a>. Opt-in for the same reason: WPBL's tabs are
   *  addressable routes (/wpbl/standings and friends) and Googlebot only follows anchors,
   *  so without it those pages exist but nothing links to them. The MLB tab bar passes no
   *  href and keeps its button semantics unchanged. */
  options: { value: string; label: string; badge?: boolean; href?: string }[]
  value: string
  onChange: (v: string) => void
  accent?: string
  mb?: number | { xs?: number; sm?: number }
  /** `sm` is a SETTING on a section rather than navigation: smaller pills, no edge inset, and
   *  right-aligned in whatever row it sits in. The player card's Regular / Playoffs / Both is the
   *  case: at full size, under the Pitching / Batting pills, the top of the card read as two
   *  navigation bars. */
  size?: 'md' | 'sm'
  /** On a phone, stretch to the full width of the row with the options sharing it evenly; natural
   *  width from `sm` up. For a page that stacks several of these, so they line up as one column
   *  of equal-width controls instead of three pills of three widths under each other. It never
   *  scrolls, so only for option sets short enough to fit a 343px column. */
  fill?: boolean
}) {
  const sm = size === 'sm'
  // When the strip is wider than the screen (many tabs on mobile), keep the selected
  // pill in view: on every selection change (a tap or a swipe between tabs) scroll it
  // to the container's centre, clamped at the ends. We nudge only the strip's own
  // scrollLeft, never the page, so a swipe can't jog the vertical scroll.
  // The active pill is a SURFACE-coloured chip with accent TEXT on it (see below), so the
  // accent here has to be the foreground-safe variant, since the raw #60a5fa reads at 2.2:1 on a
  // white chip. Callers passing their own accent are already handing us a team colour from
  // wpblAccent(), which is foreground-safe by construction.
  // The var rather than wpblAccentFg(useDark()): it is the same pair of blues keyed on the
  // theme, and it needs nothing from WPBL, so MLB can draw this.
  const accentFg = accent ?? 'var(--wpbl-accent-fg)'

  const scrollRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const c = scrollRef.current, a = activeRef.current
    if (!c || !a || c.scrollWidth <= c.clientWidth) return
    const cRect = c.getBoundingClientRect(), aRect = a.getBoundingClientRect()
    const delta = (aRect.left - cRect.left) - (c.clientWidth - aRect.width) / 2
    c.scrollTo({ left: c.scrollLeft + delta, behavior: scrollBehavior() })
  }, [value])

  return (
    <Box ref={scrollRef} sx={{
      display: 'flex',
      // `safe center` rather than plain centring, because this strip scrolls when it has more
      // tabs than fit. Centring overflowing content in a scroll container pushes the first item
      // off the left edge and makes it unreachable. `safe` centres when it fits and falls back to
      // flex-start when it does not. A browser that does not know the keyword drops the
      // declaration and lands on flex-start.
      justifyContent: fill ? 'flex-start' : sm ? 'flex-end' : { xs: 'safe center', sm: 'center' },
      // Desktop keeps its gap before content; on mobile the breathing gap lives on the
      // sticky wrapper (as transparent margin) so this strip hugs the bar's hairline.
      // Callers can override (e.g. the game-center tabs want it flush to the team switch).
      mb,
      overflowX: 'auto',
      // The sticky wrapper full-bleeds to the screen edge; this scroll strip sits flush
      // and re-adds the resting inset as scroll padding (px:2), so overflow content runs
      // right to the edge while the first pill still looks inset at rest.
      px: sm || fill ? 0 : { xs: 2, sm: 0 },
      '&::-webkit-scrollbar': { display: 'none' },
      msOverflowStyle: 'none', scrollbarWidth: 'none',
    }}>
      <Box sx={{ display: fill ? { xs: 'flex', sm: 'inline-flex' } : 'inline-flex', flex: fill ? { xs: 1, sm: 'none' } : undefined, bgcolor: 'action.hover', borderRadius: 999, p: '3px', gap: 0 }}>
        {options.map(opt => (
          <Box
            key={opt.value}
            ref={value === opt.value ? activeRef : undefined}
            // An anchor is already focusable and already announces itself as a link, so the
            // href variant takes neither `pressable`'s role/tabIndex nor aria-pressed: a link
            // marks its current destination with aria-current, and a toggle button is the
            // wrong thing to call a page you can open in a new tab. Modified clicks fall
            // through untouched so cmd/middle-click still opens the tab in a new window.
            {...(opt.href
              ? {
                  component: 'a' as const,
                  href: opt.href,
                  'aria-current': value === opt.value ? ('page' as const) : undefined,
                  onClick: (e: React.MouseEvent) => {
                    if (isModified(e)) return
                    e.preventDefault()
                    onChange(opt.value)
                  },
                }
              : { ...pressable(() => onChange(opt.value)), 'aria-pressed': value === opt.value })}
            // The dot is aria-hidden, so the news has to live in the name instead. Without
            // this the nudge would be purely visual.
            aria-label={opt.badge ? `${opt.label}, updated` : undefined}
            sx={{
              ...FOCUS_RING,
              textDecoration: 'none',
              position: 'relative',
              px: sm ? 1 : 1.75, py: sm ? 0.3 : 0.5,
              borderRadius: 999,
              cursor: 'pointer',
              fontSize: sm ? TYPE_SCALE.micro : TYPE_SCALE.meta,
              lineHeight: 1.4,
              whiteSpace: 'nowrap',
              ...(fill ? { flex: { xs: 1, sm: 'none' }, textAlign: 'center' } : {}),
              transition: 'all 0.15s',
              userSelect: 'none',
              // Raised neutral pill (iOS-style): the active tab is a surface-colored chip with
              // a soft shadow and accent-colored text, rather than a solid accent fill. Reads as
              // part of the page in both themes (the chip follows the surface color) and sits
              // more quietly next to the rest of the UI than a bold color block.
              bgcolor: value === opt.value ? 'background.raised' : 'transparent',
              color: value === opt.value ? accentFg : 'text.secondary',
              fontWeight: value === opt.value ? 700 : 600,
              boxShadow: value === opt.value ? '0 1px 3px rgba(0,0,0,0.20)' : 'none',
              '&:hover': value !== opt.value ? { color: 'text.primary' } : {},
              // 25px tall suits a cursor and not a thumb, and on a phone these are how a reader moves
              // between a game's or a player's views. Taller on a touch screen only, as the filter
              // chips are, so a desktop strip stays compact.
              '@media (pointer: coarse)': { py: sm ? 0.6 : 0.85 },
            }}
          >
            {opt.label}
            {opt.badge && <NewDot sx={SEG_DOT_SX} />}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

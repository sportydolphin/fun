// ─── WPBL UI primitives ─────────────────────────────────────────────────────────
// WPBL-native mirrors of the MLB app's shared primitives (`src/mlb/components/ui.tsx`)
// and modal chrome (e.g. `src/mlb/views/GamePreview.tsx`), so the two sections share
// one design language — same menus, headers, and modal shell. Kept as its own copy
// (rather than importing from src/mlb) so WPBL stays a self-contained, decoupled lazy
// chunk and the MLB side is left untouched. Only the accent differs: these are keyed
// to the section accent, so the league keeps its own color while the shape stays identical.
// If you restyle a primitive here, mirror the change in the MLB file (and vice versa).

import React, { useEffect, useCallback, useRef, useState } from 'react'
import { Box, Typography, useTheme, useMediaQuery } from '@mui/material'
import type { Theme } from '@mui/material'
import { wpblColor, wpblSecondary, wpblLogo, wpblLogoFill, readableOn } from './constants'
import { useWpblAccent, useWpblTeamId } from './accent'
import { wpblPortrait } from './portraits'
import type { WpblTeam } from './types'

// ─── Name shortening ────────────────────────────────────────────────────────────
// Compact a full name to "F. Last" once it's long enough to crowd a tight WPBL layout
// (stat tables, leader rows, box scores). Names within `maxLen` pass through untouched,
// and a single-token name is never abbreviated. Most callers should use useWpblName()
// for the viewport-aware default rather than calling this with a fixed length.
//
// `maxLen` is a character count, which only approximates what fits: pass 0 to abbreviate
// unconditionally. A fixed-width column wants that, because characters don't predict pixels
// — "Jamie Mackay" and "Alexia Jorge" are both 12 long and only one of them overflows.
export function wpblShortName(name: string, maxLen = 16): string {
  const full = (name ?? '').trim()
  if (full.length <= maxLen) return full
  const parts = full.split(/\s+/)
  if (parts.length < 2 || !parts[0]) return full
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`
}

// Surname particles that belong to the name that follows them. "Rosi del Castillo" must
// never shorten to "R. Castillo" — the particle is part of the surname, not a separate word.
// Lowercased for comparison; a capitalised "Del" is matched too.
const NAME_PARTICLES = new Set([
  'de', 'del', 'de la', 'della', 'di', 'da', 'das', 'dos', 'do',
  'la', 'le', 'los', 'san', 'santa', 'van', 'von', 'der', 'den', 'ter', 'bin', 'ibn', 'al', 'mc', 'mac', "o'",
])

/** The trailing surname of a full name, keeping any particles attached ("del Castillo"). */
function surnameOf(parts: string[]): string {
  let i = parts.length - 1
  while (i > 1 && NAME_PARTICLES.has(parts[i - 1].toLowerCase())) i--
  return parts.slice(i).join(' ')
}

// Name formatter for the FEATURED rows — the stat-leader cards and Hall of Firsts — where a
// name gets a line to itself and should read in full. Degrades in stages rather than being
// ellipsed mid-word, because a cut-off name is worse than an abbreviated one:
//
//   1. "Kelsie Whitmore"            — fits, untouched (the case for every current player)
//   2. "F. Elena Valerio Montoya"   — first initial, rest intact
//   3. "F. Montoya"                 — first initial + surname only, the last resort
//
// Stage 3 exists for a future signing whose name is longer than anyone's on the roster today,
// so the layout can't break on a name we haven't seen. Single-token names ("Ichiro") are never
// abbreviated — there's nothing to abbreviate to — and the caller's CSS ellipsis stays as the
// final net for that case. `maxLen` is a character budget, a deliberate proxy for width: it's
// deterministic and costs no layout measurement, and callers size it from a measured box with
// headroom to spare (see FEATURE_NAME_MAX in Home.tsx).
export function wpblFeatureName(name: string, maxLen: number): string {
  const stages = wpblNameStages(name)
  return stages.find(stage => stage.length <= maxLen) ?? stages[stages.length - 1]
}

// The same three stages as a list, longest first, for callers that pick by MEASURED width
// rather than a character budget — the recap's stars row renders each one and keeps the
// longest that isn't truncated (see FittedName in RecapCard). Two-part names collapse
// stages 2 and 3 into one entry, since "K. Whitmore" is both.
export function wpblNameStages(name: string): string[] {
  const full = (name ?? '').trim()
  const parts = full.split(/\s+/).filter(Boolean)
  if (parts.length < 2) return [full]   // nothing to abbreviate ("Ichiro")
  const initial = `${parts[0][0]}.`
  const withRest = `${initial} ${parts.slice(1).join(' ')}`
  const surnameOnly = `${initial} ${surnameOf(parts)}`
  return withRest === surnameOnly ? [full, surnameOnly] : [full, withRest, surnameOnly]
}

// Viewport-aware name shortener to drop into any WPBL list/table/tile. Horizontal space is
// scarcest on phones, so names abbreviate to "F. Last" past a short length there, and only
// for genuinely long names on wider screens. Returns a stable formatter.
// `mobileMaxLen` is the phone-width threshold; 0 means always abbreviate there. Desktop has
// room for the whole name either way, so it keeps its own limit regardless.
export function useWpblName(mobileMaxLen = 12): (name: string) => string {
  const isMobile = useMediaQuery('(max-width:600px)')
  const maxLen = isMobile ? mobileMaxLen : 20
  return useCallback((name: string) => wpblShortName(name, maxLen), [maxLen])
}

// Card outline color — noticeably stronger than MUI's faint `divider` so the WPBL
// cards (and the sub-cards nested inside them) read as crisply outlined in both light
// and dark mode. Use for card container borders; keep `divider` for thin inner row rules.
// Card hairline. Reads a CSS variable the section root sets from the favourite team, with
// the neutral as the fallback — so a reader with no favourite (and every view outside the
// WPBL section) gets exactly the old colour. A variable rather than a hook because this is
// consumed at 28 call sites that all pass it straight to `borderColor`; none of them
// concatenate it, which is the thing that ruled a variable out for the accent itself.
export const CARD_BORDER = (t: Theme) =>
  `var(--wpbl-card-border, ${t.palette.mode === 'dark' ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.34)'})`

// Is the app in dark mode? Used to pick foreground-safe team accents (see wpblAccent).
export function useWpblDark(): boolean {
  return useTheme().palette.mode === 'dark'
}

// Team badge — the one logo/color chip used across the section (schedule, standings,
// team grid, box scores). A team-color circle ringed in the team's secondary hue (so
// near-black or page-matching primaries stay defined), with the bundled logo on top:
// full-bleed for finished lockups (Boston), centered for transparent knockouts, or
// the abbreviation when no logo exists.
export function TeamBadge({ team, size = 34 }: { team: Pick<WpblTeam, 'id' | 'abbr'>; size?: number }) {
  const logo = wpblLogo(team.id)
  const fill = wpblLogoFill(team.id)
  return (
    <Box sx={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      bgcolor: wpblColor(team.id),
      border: `2px solid ${wpblSecondary(team.id)}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    }}>
      {logo
        ? <Box
            component="img" src={logo} alt={team.abbr}
            sx={fill
              ? { width: '100%', height: '100%', objectFit: 'cover' }
              : { width: '74%', height: '74%', objectFit: 'contain' }}
          />
        : <Typography sx={{ fontSize: size * 0.34, fontWeight: 800, color: '#fff' }}>{team.abbr}</Typography>}
    </Box>
  )
}

// Player portrait — circular headshot ringed in the team's secondary hue (matching the
// TeamBadge ring so players and teams read as one set). Falls back to the player's
// initials on the team color when no portrait is bundled (see ./portraits.ts).
export function PlayerPortrait({ name, teamId, size = 40 }: { name: string; teamId: string | null; size?: number }) {
  const src = wpblPortrait(name)
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
  return (
    <Box sx={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      bgcolor: wpblColor(teamId),
      border: `2px solid ${wpblSecondary(teamId)}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    }}>
      {src
        ? <Box component="img" src={src} alt={name} loading="lazy" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <Typography sx={{ fontSize: size * 0.36, fontWeight: 800, color: '#fff' }}>{initials}</Typography>}
    </Box>
  )
}

// Pill segmented control — the section nav "menu". Mirrors MLB's SegControl, wrapped
// in the same centered / mobile-horizontal-scroll container MlbStats uses for its tabs.
export function SegNav({ options, value, onChange, accent, mb = { xs: 0, sm: 3 } }: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
  /** Override. Omitted, the bar takes the section accent — the reader's team, or league blue. */
  accent?: string
  mb?: number | { xs?: number; sm?: number }
}) {
  const sectionAccent = useWpblAccent()
  accent = accent ?? sectionAccent
  // The solid chip is the *favourite's* badge, not a redesign of the bar. Someone who
  // declined a team keeps the original neutral chip with accent text — "skip and nothing
  // changes" has to stay literally true, or the opt-out isn't one.
  const filled = useWpblTeamId() != null
  // When the strip is wider than the screen (many tabs on mobile), keep the selected
  // pill in view: on every selection change — a tap or a swipe between tabs — scroll it
  // to the container's centre (clamped at the ends). We nudge only the strip's own
  // scrollLeft, never the page, so a swipe can't jog the vertical scroll.
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const c = scrollRef.current, a = activeRef.current
    if (!c || !a || c.scrollWidth <= c.clientWidth) return
    const cRect = c.getBoundingClientRect(), aRect = a.getBoundingClientRect()
    const delta = (aRect.left - cRect.left) - (c.clientWidth - aRect.width) / 2
    c.scrollTo({ left: c.scrollLeft + delta, behavior: 'smooth' })
  }, [value])

  return (
    <Box ref={scrollRef} sx={{
      display: 'flex', justifyContent: { xs: 'flex-start', sm: 'center' },
      // Desktop keeps its gap before content; on mobile the breathing gap lives on the
      // sticky wrapper (as transparent margin) so this strip hugs the bar's hairline.
      // Callers can override (e.g. the game-center tabs want it flush to the team switch).
      mb,
      overflowX: 'auto',
      // The sticky wrapper full-bleeds to the screen edge; this scroll strip sits flush
      // and re-adds the resting inset as scroll padding (px:2), so overflow content runs
      // right to the edge while the first pill still looks inset at rest.
      px: { xs: 2, sm: 0 },
      '&::-webkit-scrollbar': { display: 'none' },
      msOverflowStyle: 'none', scrollbarWidth: 'none',
    }}>
      <Box sx={{ display: 'inline-flex', bgcolor: 'action.hover', borderRadius: 999, p: '3px', gap: 0 }}>
        {options.map(opt => (
          <Box
            key={opt.value}
            ref={value === opt.value ? activeRef : undefined}
            {...pressable(() => onChange(opt.value))}
            aria-pressed={value === opt.value}
            sx={{
              ...FOCUS_RING,
              px: 1.75, py: 0.5,
              borderRadius: 999,
              cursor: 'pointer',
              fontSize: '0.75rem',
              lineHeight: 1.4,
              whiteSpace: 'nowrap',
              transition: 'all 0.15s',
              userSelect: 'none',
              // With a favourite, the active tab is a solid team-colour chip — the bar is the
              // first thing on the page, so it carries the identity. Label colour is measured
              // per team (readableOn), not fixed: white would fail contrast on Boston green,
              // Queens gold, and Heights blue. Without a favourite it stays the original
              // raised neutral chip with accent text.
              bgcolor: value === opt.value ? (filled ? accent : 'background.paper') : 'transparent',
              color: value === opt.value ? (filled ? readableOn(accent) : accent) : 'text.secondary',
              fontWeight: value === opt.value ? 700 : 600,
              boxShadow: value === opt.value && !filled ? '0 1px 3px rgba(0,0,0,0.20)' : 'none',
              '&:hover': value !== opt.value ? { color: 'text.primary' } : {},
            }}
          >
            {opt.label}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// Bordered content card with a left accent stripe and an icon + title + subtitle
// header, mirroring the MLB home-feed cards. `action` sits at the right of the header
// (e.g. a "View all" link); body is the children.
/**
 * Makes a non-semantic element (a clickable `Box`, a `Typography` acting as a link) behave
 * like a button for anyone not using a mouse: focusable in tab order, activated by Enter or
 * Space, and announced as a control rather than as text.
 *
 * Most of this section's rows are clickable `Box`es rather than real `<button>`s — a button
 * would fight the layout (default padding, font inheritance, no nested interactive content).
 * This is the compensation for that choice, and it belongs in one place so a new clickable
 * row can't quietly ship without it.
 *
 * Pass an undefined handler and you get nothing back: a row that isn't clickable shouldn't
 * land in the tab order announcing itself as a button.
 */
export function pressable(onClick: (() => void) | undefined) {
  if (!onClick) return {}
  return {
    onClick,
    role: 'button',
    tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent) => {
      // Space scrolls the page by default, so it has to be swallowed; Enter does not, but is
      // handled here too so both keys behave the same as a real button.
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() }
    },
  } as const
}

/** Focus ring for `pressable` targets — merge into the element's own sx. `:focus-visible`
 *  rather than `:focus` so a mouse click doesn't leave a ring behind. */
export const FOCUS_RING = {
  '&:focus-visible': {
    outline: '2px solid',
    outlineColor: 'primary.main',
    outlineOffset: '2px',
  },
} as const

export function SectionCard({ icon, title, subtitle, action, collapsed, onToggleCollapse, children }: {
  icon?: React.ReactNode
  title: string
  subtitle?: string
  action?: React.ReactNode
  /** Pass with `onToggleCollapse` to make the card collapsible. Owned by the caller, so it
   *  can persist the choice; the card itself stays presentational. */
  collapsed?: boolean
  onToggleCollapse?: () => void
  children: React.ReactNode
}) {
  const collapsible = !!onToggleCollapse
  const accent = useWpblAccent()
  return (
    <Box sx={{
      borderRadius: 3, overflow: 'hidden',
      border: '1px solid', borderColor: CARD_BORDER,
      bgcolor: 'background.paper',
      // A ~4% team wash over the surface colour, as a gradient layer rather than a mixed
      // bgcolor so the theme's own paper colour still shows through underneath and light
      // mode doesn't go muddy. Invisible on one card; the page reads warmer or cooler.
      backgroundImage: `linear-gradient(${accent}0a, ${accent}0a)`,
    }}>
      {/* The whole header toggles — a thumb-sized target rather than a small chevron hitbox.
          `action` keeps its own click (e.g. "View all"), so it stops the event bubbling. */}
      <Box
        onClick={collapsible ? onToggleCollapse : undefined}
        role={collapsible ? 'button' : undefined}
        tabIndex={collapsible ? 0 : undefined}
        aria-expanded={collapsible ? !collapsed : undefined}
        onKeyDown={collapsible ? (e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleCollapse!() }
        }) : undefined}
        sx={{
          px: 2, pt: 1.25, pb: collapsed ? 1.25 : 1, display: 'flex', alignItems: 'center', gap: 1,
          ...(collapsible ? { cursor: 'pointer', userSelect: 'none', '&:hover': { bgcolor: 'action.hover' } } : {}),
        }}
      >
        {icon != null && <Box sx={{ fontSize: '1.1rem', lineHeight: 1, flexShrink: 0 }}>{icon}</Box>}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.2 }}>{title}</Typography>
          {subtitle && <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', lineHeight: 1.3 }}>{subtitle}</Typography>}
        </Box>
        {action != null && <Box onClick={e => e.stopPropagation()} sx={{ display: 'flex', flexShrink: 0 }}>{action}</Box>}
        {collapsible && <Chevron open={!collapsed} />}
      </Box>
      {!collapsed && <Box sx={{ px: 2, pb: 1.5 }}>{children}</Box>}
    </Box>
  )
}

// Disclosure chevron, drawn from a rotated border corner rather than pulled from an icon
// font — the same approach as the highlights play triangle, and it animates for free.
function Chevron({ open }: { open: boolean }) {
  return (
    <Box sx={{
      width: 22, height: 22, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'text.secondary',
    }}>
      <Box sx={{
        width: 7, height: 7,
        borderRight: '2px solid currentColor', borderBottom: '2px solid currentColor',
        // Down-chevron when open (press to close), right-chevron when collapsed. The nudge is
        // listed BEFORE the rotation so it shifts along the box's own axes — putting it after
        // moves along the rotated frame and skews the glyph (the closed one read as a tick).
        transform: open ? 'translateY(-2px) rotate(45deg)' : 'translateX(-2px) rotate(-45deg)',
        transition: 'transform 0.18s ease',
      }} />
    </Box>
  )
}

// Small uppercase eyebrow label. Mirrors MLB's SectionLabel.
export function SectionLabel({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <Typography sx={{
      fontSize: strong ? '0.78rem' : '0.63rem',
      fontWeight: strong ? 800 : 700,
      textTransform: 'uppercase', letterSpacing: 1.8,
      color: strong ? 'text.primary' : 'text.disabled', mb: 1,
    }}>
      {children}
    </Typography>
  )
}

// Shared modal shell. Mirrors the MLB modal chrome: dimmed + blurred overlay, a
// vertically-centered card on `background.paper` with a soft shadow, Escape-to-close,
// a sticky uppercase eyebrow header, a round ✕ close button, and an optional sticky
// footer (e.g. the entry form's Save/Cancel).
// Ref-counted body scroll lock: while any ModalShell is open, the page behind it
// must not scroll. Counted so stacked modals (e.g. a game → a player) only release
// the lock when the last one closes. Compensates for the removed scrollbar width so
// locking doesn't shift the page sideways. Mirrors what MUI's Dialog does on the MLB
// side (which WPBL's custom shell doesn't get for free).
let scrollLockCount = 0
const savedScroll = { htmlOverflow: '', bodyOverflow: '', bodyPaddingRight: '' }

function lockBodyScroll() {
  if (scrollLockCount++ === 0) {
    // The viewport scroller is <html> here (not <body>), so lock both to cover
    // whichever element actually scrolls. Compensate the removed scrollbar width
    // on <body> so the page doesn't jump sideways when the bar disappears.
    const gap = window.innerWidth - document.documentElement.clientWidth
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

// A share affordance for the modal header's `actions` slot: copies a link to whatever the
// modal is showing, and says so. Deliberately reports failure rather than swallowing it —
// the whole point of the control is that the reader walks away holding a URL, so a silent
// no-op is the one outcome that must never look like success.
//
// The clipboard API needs a secure context. https and localhost both qualify, so the only
// realistic gap is a plain-http host on a LAN, which is why the execCommand path is still
// here as a fallback rather than being retired as legacy.
export function CopyLinkButton({ url, title = 'Copy link' }: { url: string; title?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copyAccent = useWpblAccent()

  const copy = useCallback(async () => {
    const ok = await writeClipboard(url)
    setState(ok ? 'copied' : 'failed')
    setTimeout(() => setState('idle'), ok ? 1600 : 2400)
  }, [url])

  const label = state === 'copied' ? 'Copied' : state === 'failed' ? "Couldn't copy" : 'Copy link'
  return (
    <Box
      onClick={copy}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copy() } }}
      title={title}
      aria-label={label}
      sx={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0.5,
        height: 26, px: 0.9, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
        // Confirmation is the accent, failure is the theme's error colour, and idle recedes
        // to match the close button beside it.
        color: state === 'copied' ? copyAccent : state === 'failed' ? 'error.main' : 'text.disabled',
        '&:hover': { bgcolor: 'action.hover', color: state === 'idle' ? 'text.primary' : undefined },
        transition: 'color 0.15s',
      }}
    >
      <Typography sx={{ fontSize: '0.72rem', lineHeight: 1 }} aria-hidden>
        {state === 'copied' ? '✓' : state === 'failed' ? '!' : '🔗'}
      </Typography>
      <Typography sx={{
        fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6,
        lineHeight: 1, whiteSpace: 'nowrap',
      }}>
        {label}
      </Typography>
    </Box>
  )
}

/** Clipboard write with the pre-secure-context fallback. Resolves false if both routes fail. */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch { /* fall through to the textarea route */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    // Keep it off-screen and non-focusable-looking so the page doesn't visibly jump.
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

export function ModalShell({ eyebrow, onClose, maxWidth = 720, zIndex = 1500, actions, footer, fillHeight, children }: {
  eyebrow: React.ReactNode
  onClose: () => void
  maxWidth?: number
  zIndex?: number
  actions?: React.ReactNode   // rendered just left of the close button
  footer?: React.ReactNode    // sticky bottom bar
  fillHeight?: boolean        // pin the card to full height (content controls its own scroll)
  children: React.ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Freeze the page behind the modal for as long as it's open.
  useEffect(() => { lockBodyScroll(); return unlockBodyScroll }, [])

  return (
    <Box
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      sx={{
        position: 'fixed', inset: 0, zIndex,
        bgcolor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        p: { xs: 1, sm: 2 },
      }}
    >
      <Box sx={{
        width: '100%', maxWidth,
        bgcolor: 'background.paper', borderRadius: 3,
        border: '1px solid', borderColor: 'divider',
        boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        // `100%` (of the padded fixed overlay), not `vh`: under the desktop `zoom`
        // wrapper viewport units don't shrink, so `92vh` overflows the screen.
        maxHeight: '100%', ...(fillHeight ? { height: '100%' } : {}),
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Sticky eyebrow header */}
        <Box sx={{
          px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider',
          display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0,
        }}>
          <Typography sx={{
            flex: 1, fontWeight: 800, fontSize: '0.72rem', color: 'text.secondary',
            textTransform: 'uppercase', letterSpacing: 1, lineHeight: 1,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {eyebrow}
          </Typography>
          {actions}
          <Box
            {...pressable(onClose)}
            aria-label="Close"
            sx={{
              flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'text.disabled',
              '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
              ...FOCUS_RING,
            }}
          >
            <Typography sx={{ fontSize: '0.75rem', lineHeight: 1 }}>✕</Typography>
          </Box>
        </Box>

        {/* Scrollable body */}
        <Box sx={{
          flex: 1, overflowY: 'auto',
          '&::-webkit-scrollbar': { width: 4 },
          '&::-webkit-scrollbar-thumb': { bgcolor: 'divider', borderRadius: 2 },
        }}>
          {children}
        </Box>

        {footer && (
          <Box sx={{ flexShrink: 0, borderTop: '1px solid', borderColor: 'divider', px: 2, py: 1.5 }}>
            {footer}
          </Box>
        )}
      </Box>
    </Box>
  )
}

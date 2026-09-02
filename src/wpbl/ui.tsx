// ─── WPBL UI primitives ─────────────────────────────────────────────────────────
// WPBL-native mirrors of the MLB app's shared primitives (`src/mlb/components/ui.tsx`)
// and modal chrome (e.g. `src/mlb/views/GamePreview.tsx`), so the two sections share
// one design language — same menus, headers, and modal shell. Kept as its own copy
// (rather than importing from src/mlb) so WPBL stays a self-contained, decoupled lazy
// chunk and the MLB side is left untouched. Only the accent differs: these are keyed
// to WPBL_ACCENT, so the league keeps its own color while the shape stays identical.
// If you restyle a primitive here, mirror the change in the MLB file (and vice versa).

import React, { useEffect, useLayoutEffect, useMemo, useCallback, useRef, useState } from 'react'
import { Box, Typography, Tooltip, useTheme, useMediaQuery } from '@mui/material'
import type { Theme, SxProps } from '@mui/material'
import { WPBL_ACCENT, wpblAccentFg, wpblColor, wpblSecondary, wpblLogo, wpblLogoFill } from './constants'
import { wpblPortrait } from './portraits'
import type { WpblTeam, WpblPlayer } from './types'
import { scrollBehavior } from '../lib/motion'
import { useSwipeNav } from '../AccessibilityContext'
import { useWpblPlayerLink } from './LinkContext'

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
//
// IT CANNOT SEE A NEIGHBOUR OR THE READER'S TEXT SCALE, and that is the whole risk. A budget
// counts glyphs against a box whose width is decided by everything ELSE on the row: the MVP
// race passed 18 here, "Kelsie Whitmore" is 15, so it came through untouched and CSS clipped
// it to "Kelsie Whit…" on the one row that also carries a TWO-WAY badge, and on any row at
// all once a reader turns Large text on. Use `FittedName` wherever the row's other contents
// can change; a budget is only safe in a box that owns its own width.
export function wpblFeatureName(name: string, maxLen: number): string {
  const stages = wpblNameStages(name)
  return stages.find(stage => stage.length <= maxLen) ?? stages[stages.length - 1]
}

// The same three stages as a list, longest first, for callers that pick by MEASURED width
// rather than a character budget — `FittedName` below renders each one and keeps the
// longest that isn't truncated. Two-part names collapse
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

// A name that degrades instead of being cut off. It renders the full name, and only if the
// browser actually truncates it does it fall back to "F. Last", then "F. Surname" — so the
// name keeps every character the column can show rather than losing its end to an ellipsis.
//
// Measured, not budgeted by character count, because the width a name gets is decided by
// what sits NEXT to it: the recap's three stars share one row and each takes only what its
// own name and statline need, and the MVP race's leader shares hers with a TWO-WAY badge.
// No fixed budget can know either, nor that the reader has turned Large text on. `fitKey` is the width
// of the row that holds them all — a width no name can influence. Re-fitting keyed on that
// (rather than on this element's own width, which shortening changes) is what keeps the
// steps monotonic: within one row width a name only ever gets shorter, so it settles in at
// most two passes instead of oscillating between two stages that each make the other fit.
// Unclaimed width in the row that holds all three stars: what is left after every column
// has taken what it needs. Read straight from the DOM at measure time rather than held in
// state, so it is never a frame stale — a name is only allowed to grow back into space
// that is genuinely free right now.
//
// Usually ~0 since the columns gained flex-grow and now share the surplus out among
// themselves. That didn't make the grow-back below redundant, it moved where the room shows
// up: the space this used to report as unclaimed is now inside the column's own clientWidth,
// which is the other half of that comparison.
// Returns 0 outside the recap's star row, which is the right answer everywhere else: no
// slack found means shrink-only, and a name that shrank a step simply stays shrunk.
function rowSlack(el: HTMLElement): number {
  const col = el.closest('[data-star-col]')
  const row = col?.parentElement
  if (!row) return 0
  const gap = parseFloat(getComputedStyle(row).columnGap) || 0
  let used = gap * (row.children.length - 1)
  for (const child of Array.from(row.children)) used += (child as HTMLElement).offsetWidth
  return row.clientWidth - used
}

export function FittedName({ name, className, sx, wrapperSx, fitKey }: {
  name: string; className?: string; sx?: object; fitKey?: number
  /** Styles for the positioning wrapper rather than the text. In practice this is one
   *  property: see the `minWidth: 0` note above the return. */
  wrapperSx?: object
}) {
  const ref = useRef<HTMLElement | null>(null)
  const fullRef = useRef<HTMLElement | null>(null)
  const stages = useMemo(() => wpblNameStages(name), [name])
  const [stage, setStage] = useState(0)
  const grew = useRef(false)

  useLayoutEffect(() => { setStage(0); grew.current = false }, [name, fitKey])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // +1 absorbs sub-pixel rounding, which would otherwise abbreviate a name that fits.
    if (el.scrollWidth > el.clientWidth + 1) {
      // Shrink a step. This is also what walks back a growth that turned out not to fit,
      // which is why growing needs no undo of its own.
      if (stage < stages.length - 1) setStage(stage + 1)
      return
    }
    // It fits — but all three names shrink together on the first pass, and shrinking two
    // of them can leave enough room for the third to have kept its full form. Take it back
    // when the measured full name fits in this column plus the row's unclaimed width. One
    // attempt per name per row width: if two names claim the same slack at once, both
    // overflow, both fall back on the next pass, and neither tries again.
    const full = fullRef.current
    if (stage > 0 && !grew.current && full && full.offsetWidth <= el.clientWidth + rowSlack(el)) {
      grew.current = true
      setStage(0)
    }
  })

  // PASS `wrapperSx={{ minWidth: 0 }}` WHEN THE PARENT IS A FLEX ROW THAT HAS TO SQUEEZE THIS.
  // A flex item defaults to `min-width: auto`, "never shrink below your content", so the
  // wrapper grows to fit the full name, `clientWidth` keeps pace with `scrollWidth`, the
  // truncation test above is never true, no stage is taken, and the ROW overflows instead of
  // the name stepping down. That is what the MVP race hit: the name drove the TWO-WAY badge
  // 10px into the total beside it.
  //
  // Opt-in rather than the default because it only means anything where a flex parent has to
  // squeeze this. The recap's star columns take their width from the flex row that holds all
  // three, and measure the same either way, so switching them is a change with no effect and
  // no test to notice if that stopped being true. Left to the one caller that needs it.
  return (
    <Box sx={{ position: 'relative', ...wrapperSx }}>
      <Typography ref={ref} className={className} noWrap title={stage > 0 ? name : undefined} sx={sx}>
        {stages[stage]}
      </Typography>
      {/* The full name, measured but never seen or read aloud, and out of flow so it adds
          nothing to the column's width. This is how a shortened name knows what it would
          cost to come back. */}
      {stage > 0 && (
        <Typography ref={fullRef} aria-hidden noWrap sx={{ ...sx, position: 'absolute', top: 0, left: 0, visibility: 'hidden', pointerEvents: 'none' }}>
          {stages[0]}
        </Typography>
      )}
    </Box>
  )
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
export const CARD_BORDER = (t: Theme) => t.palette.mode === 'dark' ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.34)'

// Is the app in dark mode? Used to pick foreground-safe team accents (see wpblAccent).
export function useWpblDark(): boolean {
  return useTheme().palette.mode === 'dark'
}

// Team badge — the one logo/color chip used across the section (schedule, standings,
// team grid, box scores). A team-color circle ringed in the team's secondary hue (so
// near-black or page-matching primaries stay defined), with the bundled logo on top:
// full-bleed for finished lockups (Boston), centered for transparent knockouts, or
// the abbreviation when no logo exists.
// ─── Form dots ──────────────────────────────────────────────────────────────────

// Green/red for a result, from the section's themed positive/negative tokens (styles.css).
// Literals here would fail contrast in one mode or the other (the dark-mode pair measures
// 2.28 and 3.76 against a light background) and these have to read as a 9px shape in both.
export const WPBL_WIN = 'var(--wpbl-pos)'
export const WPBL_LOSS = 'var(--wpbl-neg)'

const DOT = 9
const RING = 2

/**
 * A run of results as dots, oldest first: the same left-to-right order a schedule reads, and
 * the same order every form guide in sport uses.
 *
 * A win is SOLID GREEN and a loss is a RED RING. Colour alone would have been the only thing
 * telling the two apart, and red/green is precisely the pair that around one man in twelve
 * cannot separate. Everywhere else in the section the colour is redundant ("+26", "W4", "4–3"
 * all say it in text as well), and this strip must not be the exception. Filled-versus-hollow
 * survives greyscale, deuteranopia and a glance from arm's length.
 *
 * No opacity ramp for recency, either. It was competing with the fill/ring distinction for
 * the same few pixels and left the older rings too faint to read as rings at all.
 *
 * Only as many dots as there are games: five grey placeholders on opening week would suggest
 * a team had lost five, which is the one thing the strip must never imply.
 *
 * ONE STRIP FOR THE SECTION. It was TeamsGrid's until Home's next-game card wanted the same
 * thing, and two form strips is how a section ends up with a green tick on one page and a
 * team-coloured pip on another meaning the same result. `gap` is the only thing a caller
 * tunes, because a longer run needs a tighter rhythm and nothing else about a result changes
 * with where it is drawn.
 */
export function FormDots({ recent, gap = 4 }: { recent: ('W' | 'L')[]; gap?: number }) {
  if (recent.length === 0) return null
  return (
    <Box
      role="img"
      aria-label={`Last ${recent.length}, oldest first: ${recent.join(' ')}`}
      sx={{ display: 'flex', alignItems: 'center', gap: `${gap}px`, flexShrink: 0 }}
    >
      {recent.map((r, i) => (
        <Box key={i} sx={{
          width: DOT, height: DOT, borderRadius: '50%', boxSizing: 'border-box', flexShrink: 0,
          ...(r === 'W'
            ? { bgcolor: WPBL_WIN }
            : { border: `${RING}px solid ${WPBL_LOSS}` }),
        }} />
      ))}
    </Box>
  )
}

/** A structural pixel length, scaled by the desktop chrome scale.
 *
 *  STRUCTURE SCALES, ORNAMENT DOES NOT, and that line is where the `zoom` removal actually
 *  costs something. `zoom: 1.4` scaled every length in the section for free; ordinary CSS has
 *  no equivalent, so each px length either says it scales or stays at its written size. The
 *  ones that MUST scale are the ones that decide how much fits: column widths, rail widths, a
 *  dialog's cap. Left at their written size those boxes silently shrink 40% relative to the
 *  type inside them, which is how the player dialog went from one line for a name to two.
 *
 *  Ornament is deliberately left alone: hairline borders, the 6px live dot, a 4px scrollbar.
 *  At this scale they are a pixel or two either way, and a 1px border that stays 1px is
 *  sharper than one the zoom used to render at 1.4.
 */
export const chromePx = (px: number) => `calc(${px}px * var(--app-chrome, 1))`

export function TeamBadge({ team, size = 34 }: { team: Pick<WpblTeam, 'id' | 'abbr'>; size?: number }) {
  const logo = wpblLogo(team.id)
  const fill = wpblLogoFill(team.id)
  return (
    <Box sx={{
      // ART, SO IT FOLLOWS --app-chrome AND NOT THE ROOT FONT SIZE. Every caller passes a pixel
      // number, and one calc here scales all 43 of them on desktop without any of them growing
      // when a reader turns Large text on: a club badge is not type.
      width: `calc(${size}px * var(--app-chrome, 1))`, height: `calc(${size}px * var(--app-chrome, 1))`,
      borderRadius: '50%', flexShrink: 0,
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
export function PlayerPortrait({ name, teamId, size = 40, square }: {
  name: string; teamId: string | null; size?: number
  /** A rounded square instead of a circle. Opt-in, and only the player page uses it: a circle
   *  crops a head-and-shoulders portrait to the face, which is right at 32px in a table row
   *  and wasteful at 84px where there is room to show the shoulders and the uniform. */
  square?: boolean
}) {
  const src = wpblPortrait(name)
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
  return (
    <Box sx={{
      // Same as TeamBadge: art scales with the chrome, not with the reader's text size.
      width: `calc(${size}px * var(--app-chrome, 1))`, height: `calc(${size}px * var(--app-chrome, 1))`,
      borderRadius: square ? `calc(${Math.round(size * 0.18)}px * var(--app-chrome, 1))` : '50%', flexShrink: 0,
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

export function SegNav({ options, value, onChange, accent, mb = { xs: 0, sm: 3 } }: {
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
}) {
  // When the strip is wider than the screen (many tabs on mobile), keep the selected
  // pill in view: on every selection change — a tap or a swipe between tabs — scroll it
  // to the container's centre (clamped at the ends). We nudge only the strip's own
  // scrollLeft, never the page, so a swipe can't jog the vertical scroll.
  // The active pill is a SURFACE-coloured chip with accent TEXT on it (see below), so the
  // accent here has to be the foreground-safe variant, since the raw #60a5fa reads at 2.2:1 on a
  // white chip. Callers passing their own accent are already handing us a team colour from
  // wpblAccent(), which is foreground-safe by construction.
  const isDark = useWpblDark()
  const accentFg = accent ?? wpblAccentFg(isDark)

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
      // tabs than fit. Centring overflowing content in a scroll container pushes the first
      // item off the left edge and makes it unreachable, which is why this used to give up and
      // left-align on a phone even when there was room to spare. `safe` centres when it fits
      // and falls back to flex-start when it does not. A browser that does not know the
      // keyword drops the declaration and lands on flex-start, which is where this started.
      justifyContent: { xs: 'safe center', sm: 'center' },
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
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
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
              px: 1.75, py: 0.5,
              borderRadius: 999,
              cursor: 'pointer',
              fontSize: '0.75rem',
              lineHeight: 1.4,
              whiteSpace: 'nowrap',
              transition: 'all 0.15s',
              userSelect: 'none',
              // Raised neutral pill (iOS-style): the active tab is a surface-colored chip with
              // a soft shadow and accent-colored text, rather than a solid accent fill. Reads as
              // part of the page in both themes (the chip follows the surface color) and sits
              // more quietly next to the rest of the UI than a bold color block.
              bgcolor: value === opt.value ? 'background.paper' : 'transparent',
              color: value === opt.value ? accentFg : 'text.secondary',
              fontWeight: value === opt.value ? 700 : 600,
              boxShadow: value === opt.value ? '0 1px 3px rgba(0,0,0,0.20)' : 'none',
              '&:hover': value !== opt.value ? { color: 'text.primary' } : {},
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

// Compact segmented pills. The in-card sibling of SegNav: SegNav is the page-level tab bar
// and centres itself across the full width, this one is inline and sized to sit inside a
// SectionCard, either in the body beside a leaderboard or in the header's `action` slot.
//
// Solid accent fill rather than SegNav's raised surface chip, because at this size the chip's
// shadow-on-paper trick disappears against the card it is sitting on: inside a card the only
// thing that reads as "selected" at 0.68rem is colour. Use `--wpbl-accent-solid`, never
// WPBL_ACCENT. White on #60a5fa measures 2.37:1, and colour contrast is absolute, so the raw
// accent fails in dark mode too.
export function PillGroup({ options, value, onChange, mb }: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
  mb?: number
}) {
  return (
    <Box sx={{ display: 'inline-flex', bgcolor: 'action.hover', borderRadius: 999, p: '3px', mb }}>
      {options.map(opt => {
        const on = opt.value === value
        return (
          <Box
            key={opt.value}
            {...pressable(() => onChange(opt.value))}
            aria-pressed={on}
            sx={{
              ...FOCUS_RING,
              px: 1.5, py: 0.4, borderRadius: 999, cursor: 'pointer',
              fontSize: '0.68rem', fontWeight: 800, letterSpacing: 0.3,
              whiteSpace: 'nowrap', userSelect: 'none', transition: 'all 0.15s',
              bgcolor: on ? 'var(--wpbl-accent-solid)' : 'transparent',
              color: on ? '#fff' : 'text.secondary',
              '&:hover': on ? {} : { color: 'text.primary' },
            }}
          >
            {opt.label}
          </Box>
        )
      })}
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

// ─── Horizontal rail paging ─────────────────────────────────────────────────────
// The scroll-edge bookkeeping and the paging chevron, shared by every horizontal strip on
// Home. This lived as three byte-identical copies in Reading, Highlights and Photos; folding
// those rails into one card put all three copies inside a single component, which is where a
// duplicate stops being tolerable.

/**
 * State for a horizontally scrolling strip: which way it can still move, and how to move it.
 *
 * `contentKey` is whatever changes when the strip's contents do (usually the item count).
 * The reachable scroll distance depends on the content and on the width, so the edges are
 * re-checked on scroll, on content change, and on resize; miss the last one and the arrows
 * lie after a window resize.
 */
export function useRailPaging(contentKey: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canPrev, setCanPrev] = useState(false)
  const [canNext, setCanNext] = useState(false)

  const syncEdges = useCallback(() => {
    const c = scrollRef.current
    if (!c) return
    const max = c.scrollWidth - c.clientWidth
    setCanPrev(c.scrollLeft > 1)
    setCanNext(c.scrollLeft < max - 1)
  }, [])

  useEffect(() => { syncEdges() }, [contentKey, syncEdges])
  useEffect(() => {
    window.addEventListener('resize', syncEdges)
    return () => window.removeEventListener('resize', syncEdges)
  }, [syncEdges])

  // Page by most of the visible width, leaving a card of overlap so nothing is skipped.
  const page = useCallback((dir: 1 | -1) => {
    const c = scrollRef.current
    if (!c) return
    c.scrollBy({ left: dir * Math.max(c.clientWidth * 0.8, 200), behavior: scrollBehavior() })
  }, [])

  return { scrollRef, canPrev, canNext, syncEdges, page }
}

/**
 * The paging chevron that floats over a rail's edge.
 *
 * Desktop only, by media query rather than by width: touch users swipe, but a mouse user has
 * no visible scrollbar (it is hidden) and no drag affordance, so on hover-capable, fine-pointer
 * devices a chevron is the only discoverable way to reach the rest of the strip. Faded out at
 * whichever end it cannot move toward, so nobody is offered a dead control.
 */
export function RailArrow({ dir, show, onClick, label }: {
  dir: 'left' | 'right'; show: boolean; onClick: () => void
  /** What the strip holds, for the accessible name: "Previous <label>". */
  label: string
}) {
  return (
    <Box
      onClick={onClick}
      aria-label={`${dir === 'left' ? 'Previous' : 'More'} ${label}`}
      role="button"
      tabIndex={-1}
      sx={{
        position: 'absolute', top: '34%', [dir]: -4, transform: 'translateY(-50%)', zIndex: 2,
        width: 34, height: 34, borderRadius: '50%',
        display: 'none', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        bgcolor: 'background.paper', border: '1px solid', borderColor: CARD_BORDER,
        boxShadow: '0 2px 8px rgba(0,0,0,0.28)', color: 'text.primary',
        opacity: show ? 1 : 0, pointerEvents: show ? 'auto' : 'none',
        transition: 'opacity 0.15s, background 0.15s',
        '&:hover': { bgcolor: 'action.hover' },
        '@media (hover: hover) and (pointer: fine)': { display: 'flex' },
      }}
    >
      <Box sx={{
        width: 0, height: 0, borderStyle: 'solid',
        ...(dir === 'left'
          ? { borderWidth: '6px 8px 6px 0', borderColor: 'transparent currentColor transparent transparent', mr: '2px' }
          : { borderWidth: '6px 0 6px 8px', borderColor: 'transparent transparent transparent currentColor', ml: '2px' }),
      }} />
    </Box>
  )
}

/**
 * The scroller itself: hidden scrollbar, snap points, and `data-swipe-ignore` so a sideways
 * drag here never reaches SwipeableViews and changes tab underneath the reader.
 */
export function RailScroller({ onScroll, scrollRef, children }: {
  onScroll: () => void
  scrollRef: React.RefObject<HTMLDivElement | null>
  children: React.ReactNode
}) {
  return (
    <Box ref={scrollRef} onScroll={onScroll} data-swipe-ignore="true" sx={{
      display: 'flex', gap: 1.25, overflowX: 'auto', pb: 0.5,
      scrollSnapType: 'x proximity',
      '&::-webkit-scrollbar': { display: 'none' },
      msOverflowStyle: 'none', scrollbarWidth: 'none',
    }}>
      {children}
    </Box>
  )
}

/** One ranked row on a leaderboard: rank chip, portrait, name and club badge, a big value on
 *  the right. Shared by the two Stats boards that rank players outside the sortable table
 *  (Tracked and Pitches), which is why it lives here rather than inside either of them.
 *
 *  `player` null means the feed named someone no roster row matched: the row still renders,
 *  it just is not clickable, because there is no page to open. */
export function LeaderRow({ rank, player, name, teamId, value, unit, sub, accent, onOpen }: {
  rank: number
  player: WpblPlayer | null
  name: string
  teamId: string | null
  value: string
  unit?: string
  sub?: string
  accent: string
  onOpen?: (p: WpblPlayer) => void
}) {
  const clickable = !!player && !!onOpen
  // 18, not the 12 the hook defaults to. That default is sized for the stats table's 84px
  // name column; a leader row gives the name 135px after the badge, and measured at 375px the
  // longest name on the roster ("Samantha Gutierrez") draws in 130. At 12 a leaderboard came
  // out as "D. Benites, K. Whitmore, A. Lansdell, Jamie Mackay, Alexia Jorge": three initials
  // and two whole names, in five consecutive rows, for no reason a reader could see. The
  // mechanism stays for a name genuinely too long to fit, since a cut-off name reads worse
  // than an abbreviated one.
  const shortName = useWpblName(18)
  const playerLink = useWpblPlayerLink()
  return (
    <Box
      {...(clickable ? playerLink(player!, onOpen) : {})}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25, px: 0.5, py: 0.85,
        borderTop: rank === 1 ? 'none' : '1px solid', borderColor: 'divider',
        borderRadius: 1, cursor: clickable ? 'pointer' : 'default',
        WebkitTapHighlightColor: 'transparent',
        // Hover is gated on a device that actually has one, the same guard the Stats table
        // uses. A touch browser fires hover on tap and then LEAVES IT THERE: scroll a
        // leaderboard with a finger and whichever row you happened to start on stays lit for
        // the rest of the scroll, which reads as a selection nobody made.
        '@media (hover: hover)': {
          '&:hover': clickable ? { bgcolor: 'action.hover' } : undefined,
        },
      }}
    >
      <Box sx={{ width: '1.125rem', textAlign: 'center', fontSize: '0.8rem', fontWeight: 800, color: rank <= 3 ? accent : 'text.disabled', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{rank}</Box>
      <PlayerPortrait name={name} teamId={teamId} size={32} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortName(name)}</Typography>
          {teamId && <TeamBadge team={{ id: teamId, abbr: teamId }} size={16} />}
        </Box>
        {sub && <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</Typography>}
      </Box>
      <Box sx={{ textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        <Box component="span" sx={{ fontSize: '1.05rem', fontWeight: 800, color: accent }}>{value}</Box>
        {unit && <Box component="span" sx={{ fontSize: '0.65rem', fontWeight: 700, color: 'text.disabled', ml: 0.4 }}>{unit}</Box>}
      </Box>
    </Box>
  )
}

/**
 * A definition tooltip that behaves like the device it is on: hover on a mouse, TAP on a
 * touchscreen.
 *
 * WHY IT EXISTS. Every one of these used to be a plain MUI Tooltip with `enterTouchDelay={0}`,
 * which fires the moment a finger lands on the element. On a player page that is a column of
 * stat abbreviations you scroll straight through, so scrolling popped definitions open under
 * your thumb, one after another, for something nobody asked to read. Raising the delay is not
 * the fix either: MUI's touch timer is not cancelled by the finger moving, so a slow scroll
 * still opens it, just later.
 *
 * SO TOUCH GETS AN EXPLICIT GESTURE. On a device with no hover, the tooltip is controlled and
 * opens on tap alone. It closes on a second tap, on a tap anywhere else, on the next scroll,
 * and on a timer, because a tooltip nobody can dismiss is worse than one that never opened.
 * Closing on scroll matters most: it is the gesture that used to CAUSE this.
 *
 * Hover devices keep the old behaviour untouched, with the touch listener off so a hybrid
 * laptop cannot get both.
 *
 * Renders its own element rather than wrapping a child, because the touch path needs a ref to
 * know what "outside" means, and because every call site was passing a styled Box anyway.
 */
export function TapTip({ title, children, sx, component, popperZIndex }: {
  title: React.ReactNode
  children: React.ReactNode
  sx?: SxProps<Theme>
  /** For a tooltip on a table header, which has to stay a `th`. */
  component?: React.ElementType
  /** The player modal sits at zIndex 1600 and MUI's popper defaults to 1500, so a tooltip
   *  inside it renders behind it unless lifted. */
  popperZIndex?: number
}) {
  const canHover = useMediaQuery('(hover: hover)')
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLElement>(null)
  // What `open` was when the finger landed, read by the click that follows. React state is
  // not safe to toggle against here: MUI can call its own close in the same batch, and
  // `setOpen(o => !o)` would then flip that close straight back into an open, so a second tap
  // could never dismiss the tooltip. The press is the last moment nothing else has written.
  const openAtPress = useRef(false)
  const slotProps = popperZIndex ? { popper: { sx: { zIndex: popperZIndex } } } : undefined

  // Everything that should dismiss a tapped tooltip, registered only while one is open.
  useEffect(() => {
    if (canHover || !open) return
    const close = () => setOpen(false)
    const onPointerDown = (e: PointerEvent) => {
      // A second tap on the same stat toggles it shut; that is the click handler's job, so
      // ignore the press here rather than closing and letting the toggle reopen it.
      if (anchorRef.current?.contains(e.target as Node)) return
      close()
    }
    // Capture phase, and the event stops here: an open tooltip inside the player modal has to
    // be what Escape dismisses. Left to bubble it reached the modal's own handler and shut the
    // whole player page instead, which is a long way from "hide this definition".
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
    }
    // Capture, so a scroll inside any container counts and not just the page.
    window.addEventListener('scroll', close, { capture: true, passive: true })
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey, { capture: true })
    const timer = window.setTimeout(close, 4000)
    return () => {
      window.removeEventListener('scroll', close, { capture: true })
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey, { capture: true })
      window.clearTimeout(timer)
    }
  }, [canHover, open])

  return (
    <Tooltip
      title={title} arrow slotProps={slotProps}
      // ALWAYS CONTROLLED, both input types, and this is the part that bit. `useMediaQuery`
      // returns false on its first render and only then measures, so branching on it into a
      // controlled tooltip and an uncontrolled one meant every instance mounted controlled and
      // switched a tick later. MUI's useControlled decides which a component is on the FIRST
      // render and keeps it, so those tooltips stayed "controlled" with `open` now undefined:
      // hover silently stopped working on every desktop, with only a console warning to say so.
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      // The touch-hold listener is off on every device: it fires on the finger landing, which
      // on a page you scroll through means definitions popping open under your thumb, one
      // after another, for something nobody asked to read. Touch opens on a real tap instead
      // (the handler below); hover and focus stay for a device that has a pointer.
      disableTouchListener
      disableHoverListener={!canHover}
      disableFocusListener={!canHover}
    >
      <Box
        ref={anchorRef}
        component={component}
        onPointerDown={canHover ? undefined : () => { openAtPress.current = open }}
        onClick={canHover ? undefined : () => setOpen(!openAtPress.current)}
        sx={{ cursor: 'help', ...sx }}
      >
        {children}
      </Box>
    </Tooltip>
  )
}

export function SectionCard({ icon, title, subtitle, action, collapsed, onToggleCollapse, fill, bare, children }: {
  icon?: React.ReactNode
  title: string
  /** A node rather than a string, so a card can put a live figure in here without a second
   *  line of its own. Next game spends it on the countdown: the clock was a full headline row
   *  under the team rows, and on a phone a whole row is a lot to pay for six characters that
   *  belong beside the kickoff time anyway. Keep it to one line; this slot is 0.72rem and the
   *  header does not grow. */
  subtitle?: React.ReactNode
  action?: React.ReactNode
  /** Pass with `onToggleCollapse` to make the card collapsible. Owned by the caller, so it
   *  can persist the choice; the card itself stays presentational. */
  collapsed?: boolean
  onToggleCollapse?: () => void
  /** Let the card take whatever height its container gives it, and lay the body out as a
   *  column so a child can claim the slack with `mt: 'auto'` (pin to the bottom) or `flex: 1`
   *  (absorb it). For Home's paired columns, where the two cards in a row are stretched to a
   *  shared height and the shorter one has to put the difference somewhere deliberate.
   *  Off by default: a card in normal flow should stay its content's height. */
  fill?: boolean
  /** Drop the raised paper fill and let the card sit straight on the page, keeping only the
   *  border and the radius. For a card that IS a table: Standings and the season stats table
   *  are both drawn that way already, and in dark mode `background.paper` is a lifted grey, so
   *  a leaderboard using it read as a different surface from the tables beside it on the very
   *  same tab. Off by default, because a card that holds prose or mixed content wants the
   *  raised fill that separates it from the page. */
  bare?: boolean
  children: React.ReactNode
}) {
  const collapsible = !!onToggleCollapse
  return (
    <Box sx={{
      borderRadius: 3, overflow: 'hidden',
      border: '1px solid', borderColor: CARD_BORDER,
      bgcolor: bare ? 'transparent' : 'background.paper',
      // No `height: 100%` here. A grid item already stretches to its row, so this would only
      // ever be redundant there, and below md, where the container falls back to a flex
      // column, a percentage height resolves against the column's own height and makes every
      // card in it the same size. That squashed Last Game by 32px on a phone.
      ...(fill ? { display: 'flex', flexDirection: 'column' } : {}),
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
          {/* A REAL `h2`, because until Sep 1, 2026 this page had exactly one heading on it.
              Every card title on every WPBL page comes through here, and all of them were
              plain text: a screen reader landed on the `h1` and then had no way to skim the
              page at all, since heading navigation is what skimming IS without sight. MUI's
              Typography sets `margin: 0` on its root, and the size and weight are set here
              rather than inherited from a variant, so the tag change moves nothing on screen.
              The level is fixed at 2 on purpose: every consumer is a top-level section of a
              page that owns the `h1`, and a prop for it would only invite a card to lie. */}
          <Typography component="h2" sx={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.2 }}>{title}</Typography>
          {subtitle && <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', lineHeight: 1.3 }}>{subtitle}</Typography>}
        </Box>
        {action != null && <Box onClick={e => e.stopPropagation()} sx={{ display: 'flex', flexShrink: 0 }}>{action}</Box>}
        {collapsible && <Chevron open={!collapsed} />}
      </Box>
      {!collapsed && (
        <Box sx={{
          px: 2, pb: 1.5,
          // `flexShrink: 0` on every child so a filled body lays out exactly like the block
          // body it replaces: flex items shrink below their content height by default, which
          // would squash a leader board or a score row the moment the card ran short.
          ...(fill ? { flex: 1, display: 'flex', flexDirection: 'column', '& > *': { flexShrink: 0 } } : {}),
        }}>
          {children}
        </Box>
      )}
    </Box>
  )
}

/**
 * The foot of a capped list: "Show all 34 players", and "Show fewer" once it is open.
 *
 * WHY LISTS ARE CAPPED AT ALL. Everything a board offers UNDER its list (a view switch, a
 * count, the next card) is unreachable on a phone if the list is thirty rows long, and a
 * reader who has to scroll two screens to find out what else is here mostly does not. Ten
 * rows is a leaderboard, thirty is a directory, and the twenty in between are available in
 * one tap to the reader who wants them.
 *
 * Presentational only: the caller owns `expanded`, because it also owns what to do on the way
 * back down (the stats list scrolls itself back to the top; a five-row board has no need to).
 */
export function ExpandRow({ expanded, moreLabel, onToggle, flush }: {
  expanded: boolean
  /** What is behind the tap, counted: "Show all 34 players". */
  moreLabel: string
  onToggle: () => void
  /** Cancel SectionCard's body padding so the row spans the card and sits on its bottom edge,
   *  the way a footer does. Inside the padding it floats, with an inset rule above it and a
   *  band of dead card below, which reads as a link someone left at the end rather than as
   *  the foot of the list. Only correct inside a SectionCard: the numbers are its px/pb. */
  flush?: boolean
}) {
  return (
    <Box {...pressable(onToggle)} aria-expanded={expanded} sx={{
      ...FOCUS_RING,
      minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5,
      cursor: 'pointer', userSelect: 'none', WebkitTapHighlightColor: 'transparent',
      ...(flush ? { mx: -2, mb: -1.5, mt: 0.5 } : {}),
      borderTop: '1px solid', borderColor: 'divider',
      fontSize: '0.78rem', fontWeight: 800, color: 'var(--wpbl-accent-fg)',
      '@media (hover: hover)': { '&:hover': { bgcolor: 'action.hover' } },
    }}>
      {expanded ? 'Show fewer' : moreLabel}
      <Box component="span" sx={{ fontSize: '0.66rem' }}>{expanded ? '▴' : '▾'}</Box>
    </Box>
  )
}

// Disclosure chevron, drawn from a rotated border corner rather than pulled from an icon
// font — the same approach as the highlights play triangle, and it animates for free.
export function Chevron({ open }: { open: boolean }) {
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

  const copy = useCallback(async () => {
    const ok = await writeClipboard(url)
    setState(ok ? 'copied' : 'failed')
    setTimeout(() => setState('idle'), ok ? 1600 : 2400)
  }, [url])

  const isDarkCopy = useWpblDark()
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
        color: state === 'copied' ? wpblAccentFg(isDarkCopy) : state === 'failed' ? 'error.main' : 'text.disabled',
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

/**
 * Drag a bottom sheet down to dismiss it.
 *
 * WHAT IT HAS TO SHARE THE SCREEN WITH. Game Center is the busiest gesture surface in the
 * app: the tab panes scroll vertically, the tabs page horizontally under a finger, and the box
 * score scrolls sideways inside a pane. Only one of those is a real conflict.
 *
 *   - The horizontal pager settles it itself. `SwipeableViews` locks its axis after 10px and,
 *     on a vertical drag, sets `tracking = false` and hands the gesture back. This picks up
 *     exactly what it refuses, so the two can never both claim a drag.
 *   - Sideways scrollers are on the other axis and never see this.
 *   - Vertical scrolling IS the conflict, and the rule is the standard one: a downward drag
 *     dismisses only when the scroller under the finger is already at its top. Anywhere else
 *     it is a scroll, and this never calls preventDefault, so the browser handles it as usual.
 *
 * The chrome is always draggable, scroller or no scroller: a finger on the grab handle or the
 * title bar has no other possible intent. That half alone is most of the value, because the
 * close button is top-right, which is the hardest place on a phone to reach one-handed.
 *
 * OFF WHEN SWIPE NAVIGATION IS OFF, the same accessibility switch the tab pager honours, and
 * the close button never goes anywhere: a gesture is an extra way out, never the only one.
 */
/**
 * The viewport the sheet styling itself is keyed to.
 *
 * This is checked LIVE, at touchstart, rather than held in a `useMediaQuery` beside the
 * component. Whether the card LOOKS like a sheet (bottom-anchored, rounded top corners, grab
 * handle) is decided by MUI's `xs`/`sm` breakpoint in `sx`, which is a real CSS media query.
 * Whether it can be DRAGGED was decided by a separate `useMediaQuery` hook holding a copy of
 * the same threshold. Two sources of truth for one question, and when they disagree the
 * failure is silent and confusing in exactly one direction: the sheet still looks like a
 * sheet, still shows a grab handle, and cannot be grabbed.
 *
 * They can disagree. `useMediaQuery` is JS state that has to be told to update, and it was
 * measured not re-evaluating on a live viewport change in at least one browser during this
 * work. Reading `matchMedia` at the moment the finger lands cannot go stale, costs nothing on
 * a gesture that happens a few times a session, and deletes the second source of truth.
 */
const SHEET_MQ = '(max-width:600px)'

/**
 * Two thresholds, not one, and the small one is the whole reason a drag that starts on the
 * CONTENT works on a real phone.
 *
 * A touch that lands inside a scrollable pane belongs to the browser until something takes
 * it: once the finger passes the platform's slop (about 8px on Android, similar on iOS) the
 * gesture goes to the compositor as a scroll, every later `touchmove` arrives
 * `cancelable: false`, and a `touchcancel` ends the sequence. Deciding at 10px is deciding
 * one pixel too late, every time, which is why this worked perfectly against synthetic touch
 * events and did nothing on a device.
 *
 * So the claim is split from the commit. At DRAG_CLAIM_PX the handler only asks "could this
 * be a dismissal" — downward, vertical-dominant, and over a scroller that is already at its
 * top — and if so starts calling `preventDefault`, which takes the touch off the browser while
 * it is still cancelable. Nothing is lost by claiming early in exactly that case: a downward
 * drag at scrollTop 0 has nowhere to scroll to. At DRAG_LOCK_PX it re-runs the same axis test
 * on real movement and either commits or releases, and a released gesture is only ever one the
 * browser could not have scrolled anyway. Horizontal paging is unharmed because
 * `SwipeableViews` moves in JS, which `preventDefault` does not touch.
 *
 * This is what the sheet's `touch-action: none` chrome buys structurally: the same race, but
 * removed rather than won. Content cannot use that, because the pane it sits in has to scroll.
 */
const DRAG_CLAIM_PX = 4        // movement before the touch is taken off the browser
const DRAG_LOCK_PX = 10        // movement before deciding dismiss-drag vs scroll
const DRAG_DISMISS_FRACTION = 0.25 // of the sheet's height, for a slow drag
const DRAG_FLICK_VELOCITY = 0.5    // px/ms downward, which commits from anywhere
const DRAG_FLICK_MIN_PX = 24
const DRAG_ANIM_MS = 220

/** The scrollable box the finger is inside, if any, stopping at the sheet itself. */
function scrollerUnder(target: EventTarget | null, stop: HTMLElement): HTMLElement | null {
  let el = target instanceof HTMLElement ? target : null
  while (el && el !== stop.parentElement) {
    const oy = getComputedStyle(el).overflowY
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el
    el = el.parentElement
  }
  return null
}

function useSheetDrag(
  enabled: boolean,
  cardRef: React.RefObject<HTMLDivElement | null>,
  overlayRef: React.RefObject<HTMLDivElement | null>,
  chromeRef: React.RefObject<HTMLDivElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    const card = cardRef.current
    if (!enabled || !card) return

    let active = false, claimed = false, locked = false, eligible = false
    let startY = 0, startX = 0, dy = 0, lastY = 0, lastT = 0, vel = 0

    // The backdrop clears as the sheet falls, so what is behind it is readable on the way
    // out rather than at the end of it. Both halves of it: the dim AND the blur, since a
    // sheet sliding off a page that is still frosted looks like the page is broken.
    //
    // By its own alpha and filter, never by `opacity`: the sheet is a child of the overlay,
    // so fading the element would take the sheet down with it.
    const setBackdrop = (progress: number) => {
      const el = overlayRef.current
      if (!el) return
      const left = 1 - progress
      el.style.backgroundColor = `rgba(0,0,0,${(0.6 * left).toFixed(3)})`
      el.style.backdropFilter = `blur(${(2 * left).toFixed(2)}px)`
    }

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      // Live, not cached: above this width the card is an ordinary centred dialog and there is
      // nothing to push down. See SHEET_MQ.
      if (!window.matchMedia(SHEET_MQ).matches) return
      const t = e.touches[0]
      active = true; claimed = false; locked = false; dy = 0; vel = 0
      startY = lastY = t.clientY; startX = t.clientX
      lastT = performance.now()
      const el = e.target instanceof Element ? e.target : null
      // `data-sheet-drag` is how a card says "this block is my title, not my content": the
      // player page's identity band is the obvious thing to grab and pull, and it is not
      // something anyone scrolls to read. ModalShell gives anything carrying it the same
      // `touch-action: none` as the chrome, so grabbing there never enters the race above.
      const onChrome = (!!chromeRef.current && chromeRef.current.contains(e.target as Node))
        || !!el?.closest('[data-sheet-drag]')
      const scroller = scrollerUnder(e.target, card)
      eligible = onChrome || !scroller || scroller.scrollTop <= 0
    }

    const onMove = (e: TouchEvent) => {
      if (!active) return
      const t = e.touches[0]
      const moveY = t.clientY - startY
      const moveX = t.clientX - startX
      if (!locked) {
        // Claim, at DRAG_CLAIM_PX. Sideways, upward, or over a scroller that has somewhere to
        // go: not ours, and left alone so the browser handles it as usual. See DRAG_CLAIM_PX
        // for why this cannot wait for the lock threshold.
        if (!claimed) {
          if (Math.abs(moveY) < DRAG_CLAIM_PX && Math.abs(moveX) < DRAG_CLAIM_PX) return
          if (Math.abs(moveX) > Math.abs(moveY) || moveY <= 0 || !eligible) { active = false; return }
          claimed = true
        }
        // Held from here on, so the touch stays ours and stays cancelable while the axis
        // settles. This is a no-op for the gesture itself: nothing here could have scrolled.
        e.preventDefault()
        // Commit, at DRAG_LOCK_PX, on movement big enough to mean something. A gesture that
        // reads sideways or upward on real distance is handed back rather than dragged.
        if (Math.abs(moveY) < DRAG_LOCK_PX && Math.abs(moveX) < DRAG_LOCK_PX) return
        if (Math.abs(moveX) > Math.abs(moveY) || moveY <= 0) { active = false; return }
        locked = true
        card.style.transition = 'none'
      }
      const now = performance.now()
      if (now > lastT) vel = (t.clientY - lastY) / (now - lastT)
      lastY = t.clientY; lastT = now
      dy = Math.max(0, moveY)
      e.preventDefault()
      card.style.transform = `translateY(${dy}px)`
      setBackdrop(Math.min(1, dy / Math.max(card.offsetHeight, 1)))
    }

    const onEnd = () => {
      if (!active) return
      active = false
      if (!locked) return
      locked = false
      const height = Math.max(card.offsetHeight, 1)
      const go = dy > height * DRAG_DISMISS_FRACTION
        || (vel > DRAG_FLICK_VELOCITY && dy > DRAG_FLICK_MIN_PX)
      card.style.transition = `transform ${DRAG_ANIM_MS}ms ease-out`
      if (go) {
        card.style.transform = `translateY(${height}px)`
        setBackdrop(1)
        window.setTimeout(onClose, DRAG_ANIM_MS - 20)
      } else {
        card.style.transform = 'translateY(0)'
        setBackdrop(0)
      }
    }

    card.addEventListener('touchstart', onStart, { passive: true })
    card.addEventListener('touchmove', onMove, { passive: false })
    card.addEventListener('touchend', onEnd)
    card.addEventListener('touchcancel', onEnd)
    return () => {
      card.removeEventListener('touchstart', onStart)
      card.removeEventListener('touchmove', onMove)
      card.removeEventListener('touchend', onEnd)
      card.removeEventListener('touchcancel', onEnd)
    }
  }, [enabled, cardRef, overlayRef, chromeRef, onClose])
}

export function ModalShell({ eyebrow, onClose, maxWidth = 720, zIndex = 1500, actions, footer, fillHeight, sheet, sheetFill, children }: {
  eyebrow: React.ReactNode
  onClose: () => void
  /** Responsive object as well as a plain number, because a modal that is the right size for
   *  a phone sheet is not the right size for a desktop dialog. Handed straight to `sx`. */
  /** px number, or a breakpoint map. Strings allowed so a caller can hand over a
   *  `chromePx()` calc, which is how any width that used to ride the zoom is spelled now. */
  maxWidth?: number | string | Record<string, number | string>
  zIndex?: number
  actions?: React.ReactNode   // rendered just left of the close button
  footer?: React.ReactNode    // sticky bottom bar
  fillHeight?: boolean        // pin the card to full height (content controls its own scroll)
  /** Come up from the bottom edge on a phone instead of sitting in the middle of the screen,
   *  with a grab handle and square bottom corners. For a modal that is a CONTROL rather than
   *  a document: a centred dialog puts its options where a thumb has to reach across the
   *  screen, and leaves page visible above and below it, so it reads as floating over the
   *  thing you were doing rather than as the thing you are doing now. Above sm it is an
   *  ordinary centred card, which is why this is opt-in and changes nothing for the modals
   *  that do not pass it. */
  sheet?: boolean
  /**
   * Hold a constant share of the screen instead of sizing to the content, on a phone, where
   * `sheet` is in effect.
   *
   * A bottom sheet is anchored by its BOTTOM edge, so every pixel its content gains moves its
   * top edge up the screen. Game Center mounted 296px tall, showing a line score and a
   * spinner, and became 715px when the box score arrived: the sheet finished sliding up and
   * then leapt another 419px, which is most of a phone. A centred dialog hid this, because
   * growth there is split between two edges and reads as settling rather than as jumping.
   *
   * It also stops the sheet resizing when you page between tabs, since a recap and a
   * play-by-play are nothing like the same height.
   *
   * Not for every sheet. The Sort and Filter pickers are short and honest about it; holding
   * them at 88% would be 200px of nothing under six options.
   */
  sheetFill?: boolean
  children: React.ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Freeze the page behind the modal for as long as it's open.
  useEffect(() => { lockBodyScroll(); return unlockBodyScroll }, [])

  // A sheet on a phone can be pushed back down. See useSheetDrag for what that has to avoid
  // colliding with; above sm this is an ordinary centred dialog and none of it is bound.
  const overlayRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const chromeRef = useRef<HTMLDivElement>(null)
  // No `isPhone` here any more. The width test lives inside the gesture, where it is read
  // live off `matchMedia` and cannot drift from the CSS breakpoint that decides whether this
  // is a sheet at all. See SHEET_MQ.
  const swipeNav = useSwipeNav()
  useSheetDrag(!!sheet && swipeNav, cardRef, overlayRef, chromeRef, onClose)

  return (
    <Box
      ref={overlayRef}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      sx={{
        position: 'fixed', inset: 0, zIndex,
        bgcolor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)',
        display: 'flex', justifyContent: 'center',
        alignItems: sheet ? { xs: 'flex-end', sm: 'center' } : 'center',
        p: sheet ? { xs: 0, sm: 2 } : { xs: 1, sm: 2 },
      }}
    >
      <Box ref={cardRef} sx={{
        width: '100%', maxWidth,
        bgcolor: 'background.paper',
        borderRadius: sheet ? { xs: '18px 18px 0 0', sm: 3 } : 3,
        border: '1px solid', borderColor: 'divider',
        boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        // `100%` (of the padded fixed overlay), not `vh`: under the desktop `zoom`
        // wrapper viewport units don't shrink, so `92vh` overflows the screen.
        maxHeight: sheet ? { xs: '88%', sm: '100%' } : '100%',
        ...(sheet && sheetFill ? { height: { xs: '88%', sm: 'auto' } } : {}),
        ...(fillHeight ? { height: '100%' } : {}),
        display: 'flex', flexDirection: 'column',
        // It comes up from the edge it is anchored to. Without this a "bottom sheet" simply
        // appears, which reads as a dialog that happens to be at the bottom, and it leaves the
        // drag-down dismissal with no opposite gesture to have been the undoing of.
        //
        // It also buys time. Game Center opens on the recap, whose win-probability card needs
        // the league's whole play log before it can draw; 260ms of movement is 260ms in which
        // that arrives, and content that settles while the sheet is still travelling settles
        // invisibly. styles.css collapses this to nothing under prefers-reduced-motion, along
        // with every other animation on the page, so it needs no guard of its own.
        ...(sheet ? {
          '@media (max-width: 599.95px)': {
            animation: 'wpblSheetUp 260ms cubic-bezier(0.2, 0, 0, 1)',
            '@keyframes wpblSheetUp': {
              from: { transform: 'translateY(100%)' },
              to: { transform: 'translateY(0)' },
            },
            // A card's own title block, opted in with `data-sheet-drag`, gets the chrome's
            // deal: the browser never claims a touch that starts there, so useSheetDrag owns
            // it outright instead of racing the scroller it sits inside. Phones only, for the
            // same reason the chrome's is, and the cost is that the pane cannot be scrolled by
            // dragging on the title, which is the trade every bottom sheet makes for its
            // handle. Only opt in a block nobody scrolls to read.
            '& [data-sheet-drag]': { touchAction: 'none' },
          },
        } : {}),
      }}>
        {/* Grab handle. Purely a signal, and it earns its 12px: it says the card came up from
            the bottom edge, which is what tells a thumb that the backdrop left showing above
            it is the way out. */}
        {/* `touch-action: none` across the WHOLE chrome on a phone, not just the 36x4px
            handle, and this is what makes the drag work on a real device at all.

            The gesture handler cannot call `preventDefault` on the first touchmove: it has to
            wait DRAG_LOCK_PX to tell a dismissal from a scroll, and preventing before the axis
            is settled would kill scrolling on every touch that starts near the top. But a real
            browser decides what a gesture is during those same first pixels, and once it has
            handed the touch to the compositor as a scroll or an overscroll, every later
            touchmove arrives with `cancelable: false` and `preventDefault` is a no-op. So the
            drag silently did nothing on a phone while working perfectly against synthetic
            touch events, which are always cancelable. That is the whole bug.

            `touch-action: none` removes the race instead of trying to win it: the browser
            never claims a touch that starts here, so the handler still owns it at 10px. It is
            safe on this element for the reason useSheetDrag already gives for treating the
            chrome as always-draggable — a finger on the grab handle or the title bar has no
            other possible intent. Taps are unaffected: touch-action governs panning and
            zooming, not clicks, so Close and Copy link still work.

            Phones only. On desktop this is an ordinary dialog and the property would only
            disable text selection in the header. */}
        <Box ref={chromeRef} sx={{ flexShrink: 0, touchAction: sheet ? { xs: 'none', sm: 'auto' } : undefined }}>
        {sheet && (
          <Box aria-hidden sx={{
            display: { xs: 'block', sm: 'none' }, flexShrink: 0,
            width: 36, height: 4, borderRadius: 2, bgcolor: 'divider', mx: 'auto', mt: 1,
          }} />
        )}
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
        </Box>

        {/* Scrollable body.
            A flex COLUMN, not a plain block, and that is load-bearing rather than tidy. A
            child of a block box cannot be a flex item, so it can only be sized by content and
            clamped with max-height, and a clamp does not make a height definite: every
            `height: 100%` below it silently falls back to auto. That is what stopped the Game
            Center panes scrolling. With this, a child that says `flex: 1` gets a definite
            height and the chain under it resolves.

            Phones only, because that is where the sheet has a definite height for the chain to
            resolve FROM. Above sm the modal is content-height on purpose and the block layout
            it has always had is right: switching it there traded one working arrangement for a
            worse one, a 174px scrolling window inside a 538px dialog on an 800px screen. */}
        <Box sx={{
          flex: 1, overflowY: 'auto',
          // Stop a downward drag at the top of this pane from chaining out to the browser.
          // Without it Android Chrome answers that gesture with pull-to-refresh and iOS with
          // rubber-banding, both of which take ownership of the touch — which is the other
          // half of why dismissing by dragging the CONTENT (rather than the chrome) did
          // nothing on a real phone. `contain` keeps the overscroll inside this box, so the
          // touch stays cancelable and useSheetDrag can still claim it at DRAG_LOCK_PX.
          overscrollBehavior: 'contain',
          display: { xs: 'flex', sm: 'block' }, flexDirection: 'column',
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

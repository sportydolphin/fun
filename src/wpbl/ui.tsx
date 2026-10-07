// ─── WPBL UI primitives ─────────────────────────────────────────────────────────
// The section's own primitives, keyed to WPBL_ACCENT. WPBL never imports from src/mlb, so it
// stays a self-contained lazy chunk. What BOTH sections use (ModalShell, the tap and hover
// helpers) moved to src/ui on Sep 28, 2026, when MLB adopted WPBL's shell; it is re-exported
// below so nothing in the section had to change its imports.

import React, { useEffect, useLayoutEffect, useMemo, useCallback, useRef, useState } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import type { Theme, SxProps } from '@mui/material'
import { WPBL_ACCENT, wpblAccentFg, wpblColor, wpblSecondary, wpblLogo, wpblLogoFill } from './constants'
import { wpblPortraitSet, type WpblPortraitSet } from './portraits'
import type { WpblTeam, WpblPlayer } from './types'
import { scrollBehavior } from '../lib/motion'
import { useWpblPlayerLink } from './LinkContext'
import { hoverOnly, TAPPABLE, tappableIf, pressable, FOCUS_RING } from '../ui/interaction'
import { chromePx } from '../ui/scale'
import { CopyLinkButton as CopyLinkButtonBase } from '../ui/CopyLinkButton'
export { hoverOnly, TAPPABLE, tappableIf, pressable, linkPress, FOCUS_RING } from '../ui/interaction'
export { ModalShell, usePhoneLayout } from '../ui/ModalShell'
import { usePhoneLayout } from '../ui/ModalShell'

// ─── Name shortening ────────────────────────────────────────────────────────────
// Compact a full name to "F. Last" once it's long enough to crowd a tight WPBL layout
// (stat tables, leader rows, box scores). Names within `maxLen` pass through untouched,
// and a single-token name is never abbreviated. Most callers should use useWpblName()
// for the viewport-aware default rather than calling this with a fixed length.
//
// `maxLen` is a character count, which only approximates what fits: pass 0 to abbreviate
// unconditionally. A fixed-width column wants that, because characters don't predict pixels:
// "Jamie Mackay" and "Alexia Jorge" are both 12 long and only one of them overflows.
export function wpblShortName(name: string, maxLen = 16): string {
  const full = (name ?? '').trim()
  if (full.length <= maxLen) return full
  const parts = full.split(/\s+/)
  if (parts.length < 2 || !parts[0]) return full
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`
}

// Surname particles that belong to the name that follows them. "Rosi del Castillo" must
// never shorten to "R. Castillo": the particle is part of the surname, not a separate word.
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

// Name formatter for the FEATURED rows, where a name gets a line to itself and should read in
// full. Degrades in stages rather than being ellipsed mid-word, because a cut-off name is worse
// than an abbreviated one:
//
//   1. "Kelsie Whitmore"            fits, untouched (the case for every current player)
//   2. "F. Elena Valerio Montoya"   first initial, rest intact
//   3. "F. Montoya"                 first initial + surname only, the last resort
//
// Stage 3 exists for a future signing whose name is longer than anyone's on the roster today,
// so the layout can't break on a name we haven't seen. Single-token names ("Ichiro") are never
// abbreviated (there's nothing to abbreviate to), and the caller's CSS ellipsis stays as the
// final net for that case. `maxLen` is a character budget, a deliberate proxy for width: it's
// deterministic and costs no layout measurement, and callers size it from a measured box with
// headroom to spare.
//
// IT CANNOT SEE A NEIGHBOUR OR THE READER'S TEXT SCALE, and that is the whole risk. A budget
// counts glyphs against a box whose width is decided by everything ELSE on the row: "Kelsie
// Whitmore" passes a budget of 18 and still clips to "Kelsie Whit…" on a row that also carries a
// TWO-WAY badge, or on any row once a reader turns Large text on. Use `FittedName` wherever the
// row's other contents can change; a budget is only safe in a box that owns its own width.
export function wpblFeatureName(name: string, maxLen: number): string {
  const stages = wpblNameStages(name)
  return stages.find(stage => stage.length <= maxLen) ?? stages[stages.length - 1]
}

// The same three stages as a list, longest first, for callers that pick by MEASURED width
// rather than a character budget: `FittedName` below renders each one and keeps the
// longest that isn't truncated. Two-part names collapse stages 2 and 3 into one entry,
// since "K. Whitmore" is both.
export function wpblNameStages(name: string): string[] {
  const full = (name ?? '').trim()
  const parts = full.split(/\s+/).filter(Boolean)
  if (parts.length < 2) return [full]   // nothing to abbreviate ("Ichiro")
  const initial = `${parts[0][0]}.`
  const withRest = `${initial} ${parts.slice(1).join(' ')}`
  const surnameOnly = `${initial} ${surnameOf(parts)}`
  return withRest === surnameOnly ? [full, surnameOnly] : [full, withRest, surnameOnly]
}

// ─── FittedName: a name that degrades instead of being cut off ─────────────────
// It renders the full name, and only if the browser actually truncates it does it fall back to
// "F. Last", then "F. Surname", so the name keeps every character the column can show rather
// than losing its end to an ellipsis.
//
// Measured, not budgeted by character count, because the width a name gets is decided by what
// sits NEXT to it: the recap's three stars share one row and each takes only what its own name
// and statline need. No fixed budget can know that, nor that the reader has turned Large text
// on. `fitKey` is the width of the row that holds them all, a width no name can influence.
// Re-fitting keyed on that (rather than on this element's own width, which shortening changes)
// is what keeps the steps monotonic: within one row width a name only ever gets shorter, so it
// settles in at most two passes instead of oscillating between two stages.
//
// `rowSlack`: unclaimed width in the row that holds all three stars, what is left after every
// column has taken what it needs. Read straight from the DOM at measure time rather than held in
// state, so it is never a frame stale: a name may only grow back into space that is genuinely
// free right now. Usually ~0, since the columns flex-grow and share the surplus; the grow-back
// below still matters, because that room shows up inside the column's own clientWidth instead.
// Returns 0 outside the recap's star row: no slack means shrink-only, and a name that shrank a
// step stays shrunk.
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
    // It fits, but all three names shrink together on the first pass, and shrinking two of them
    // can leave enough room for the third to have kept its full form. Take it back when the
    // measured full name fits in this column plus the row's unclaimed width. One attempt per name
    // per row width: if two names claim the same slack at once, both overflow, both fall back on
    // the next pass, and neither tries again.
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
  // the name stepping down, pushing whatever sits beside it (a TWO-WAY badge, a total) aside.
  //
  // Opt-in rather than the default because it only means anything where a flex parent has to
  // squeeze this. The recap's star columns take their width from the flex row that holds all
  // three, and measure the same either way, so switching them is a change with no effect and
  // no test to notice if that stopped being true. Left to the callers that need it.
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
  // Through the theme, so a list inside the desktop side panel shortens like the phone it is laid
  // out as. See usePhoneLayout.
  const isMobile = usePhoneLayout()
  const maxLen = isMobile ? mobileMaxLen : 20
  return useCallback((name: string) => wpblShortName(name, maxLen), [maxLen])
}

// Card outline color: noticeably stronger than MUI's faint `divider` so the WPBL
// cards (and the sub-cards nested inside them) read as crisply outlined in both light
// and dark mode. Use for card container borders; keep `divider` for thin inner row rules.
//
// A FLAT CARD TAKES A STRONGER OUTLINE IN DARK MODE, through `--wpbl-card-border`. With no fill the
// border is the only thing drawing the card, and 0.30 was tuned against a lifted paper grey that
// did half that job; on the bare page it reads faint. Set by `FLAT_CARDS_DARK` on a flat page, and
// by a `bare` card on itself, so the paper cards elsewhere keep the weight they were tuned at.
export const CARD_BORDER = (t: Theme) => t.palette.mode === 'dark'
  ? 'var(--wpbl-card-border, rgba(255,255,255,0.30))'
  : 'rgba(0,0,0,0.34)'

/** The dark-mode outline of a card with no fill. */
const FLAT_BORDER_DARK = 'rgba(255,255,255,0.46)'

/** The outline of a box nested INSIDE a card (a bracket series, a game chip): `divider` on paper,
 *  where the fill around it gives it its edge, and a step up on a flat card, where `divider` alone
 *  left it barely there. Kept a clear step below the card's own outline so the nesting still reads. */
export const INNER_BORDER = (t: Theme) => `var(--wpbl-inner-border, ${t.palette.divider})`
const FLAT_INNER_BORDER_DARK = 'rgba(255,255,255,0.24)'

/** What a `bare` card sets on itself in dark mode: the flat outline, and the flat inner outline for
 *  anything nested in it. The fill is already off, so only the borders need saying. */
export const BARE_CARD_DARK = (t: Theme) => t.palette.mode === 'dark'
  ? { '--wpbl-card-border': FLAT_BORDER_DARK, '--wpbl-inner-border': FLAT_INNER_BORDER_DARK }
  : {}

/** A raised card's fill: `background.paper`, unless a page has asked for flat cards (see
 *  `FLAT_CARDS_DARK`). A variable rather than a prop because a page is more than its
 *  `SectionCard`s: Home also hand-rolls chips, a league row and skeletons on the same surface,
 *  and a prop would have to reach every one of them or leave the page half converted. */
export const CARD_FILL = (t: Theme) => `var(--wpbl-card-fill, ${t.palette.background.paper})`

/** The solid colour directly behind a card's content, for the things that must PAINT it rather
 *  than show through: the 2px ring that separates overlapping portraits. On a flat card that is
 *  the page, and a ring left in the paper grey reads as a halo around every face. */
export const CARD_INK = (t: Theme) => `var(--wpbl-card-ink, ${t.palette.background.paper})`

/** Flat cards in dark mode, set on a page's root: the fill goes and the border alone holds the
 *  card, the way the season recap draws. Dark only for now. In dark mode `background.paper` is a
 *  lifted grey, so a page of paper cards reads as grey boxes holding grey boxes (bracket rows,
 *  game chips), and the recap one click away already sits flat on the page. Light mode keeps its
 *  paper until it is decided separately. Scoped by inheritance, so it stops at the page: a
 *  `ModalShell` portals to the body and keeps its paper. */
export const FLAT_CARDS_DARK = (t: Theme) => t.palette.mode === 'dark'
  ? {
    '--wpbl-card-fill': 'transparent', '--wpbl-card-ink': t.palette.background.default,
    '--wpbl-card-border': FLAT_BORDER_DARK, '--wpbl-inner-border': FLAT_INNER_BORDER_DARK,
  }
  : {}

// Is the app in dark mode? Used to pick foreground-safe team accents (see wpblAccent).
export function useWpblDark(): boolean {
  return useTheme().palette.mode === 'dark'
}

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
 * No opacity ramp for recency, either: it competes with the fill/ring distinction for the same
 * few pixels and leaves the older rings too faint to read as rings at all.
 *
 * Only as many dots as there are games: five grey placeholders on opening week would suggest
 * a team had lost five, which is the one thing the strip must never imply.
 *
 * ONE STRIP FOR THE SECTION, so a result is never a green tick on one page and a team-coloured
 * pip on another. `gap` is the only thing a caller tunes, because a longer run needs a tighter
 * rhythm and nothing else about a result changes with where it is drawn.
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

// hoverOnly / TAPPABLE / tappableIf live in src/ui/interaction.ts (shared with MLB); re-exported above.

// chromePx lives in src/ui/scale.ts (shared with MLB); re-exported here so WPBL's imports did not change.
export { chromePx } from '../ui/scale'

/**
 * The page column the Stats boards that are prose and lists sit in, and the wider measure the
 * ones that can use a second column take on a large desktop.
 *
 * NARROW IS NOT A DEFAULT TO BE ESCAPED, it is the right answer for one column of anything: a
 * list stretched across 1,400px puts a name at one edge and its number at the other and stops
 * being a row. What a wide screen buys is a SECOND column, not a longer one, so the wide value
 * is two list measures and the gap between them rather than one long one.
 *
 * An over-generous cap is harmless: `max-width` cannot make an element wider than the box it
 * is in, so on a viewport smaller than the cap this simply means "all of it".
 */
export const BOARD_COLUMN = chromePx(720)
export const BOARD_COLUMN_WIDE = chromePx(1150)

/**
 * The floor for the smallest labels: eyebrows, chart axes, footnotes.
 *
 * A PHONE READS THE SMALLEST TYPE IN THE APP unless something stops it. `--app-type` is 1.25 at
 * 900px and up and 1 below, so every rem is 20% smaller on a phone than on a desktop, and sizes
 * chosen by eye on a desktop come out around 9.6px there.
 *
 * 0.68rem is 10.9px on a phone and 13.6px on a desktop. It is a FLOOR and not a size: anything
 * already larger keeps what it has, and the two ornament-scale marks that are not really read as
 * text (the 0.55rem TWO-WAY chip, the 6px live dot) are deliberately left alone.
 *
 * Raising the root on mobile instead is the wrong fix: every rem-sized BOX would move with it,
 * including string budgets measured against the current scale (the reminder row's 183px), and
 * one of those failing by a pixel is exactly the class of bug this section keeps paying for.
 */
export const MICRO_TEXT = '0.68rem'

/**
 * THE TYPE SCALE. Every font size on a surface that has adopted this comes from here.
 *
 * WHY IT EXISTS. Without a scale to snap to, sizes accumulate one reasonable local decision at a
 * time: nineteen distinct sizes on Home alone, with pairs less than 1px apart on screen (0.9
 * beside 0.88 beside 0.85). Differences that small are not hierarchy, they are noise. The eight
 * steps below cover all of them within nine per cent, so obeying the rule tidies a page rather
 * than redesigning it.
 *
 * `micro` is MICRO_TEXT and is only 0.04rem from `meta` on purpose. It is the ALL-CAPS step,
 * and caps set at 0.68 read larger than lowercase at 0.72 because they have no descenders and
 * fill the em: the pair is a label and its value, which is a real distinction rather than two
 * neighbouring sizes.
 *
 * `src/wpbl/__tests__/typeScale.test.ts` fails on a raw rem literal in an adopted file, so the
 * next size added has to be a decision about the scale rather than a number typed into an `sx`.
 */
export const TYPE_SCALE = {
  /** A standalone page's own title (the <h1> on /wpbl/league, /wpbl/season and the rest).
   *  Bigger than `display`, which is the largest thing INSIDE a card; this is the page itself. */
  page: '1.5rem',
  /** Club names on Next game, the one thing a card is about. */
  display: '1.2rem',
  /** Section headings, and a leaderboard's first row. */
  heading: '1.05rem',
  /** Card titles and the countdown. */
  title: '0.95rem',
  /** A sentence: a recap line, a series line, a reminder. */
  body: '0.8rem',
  /** A number or a piece of meta beside something bigger. */
  meta: '0.72rem',
  /** All-caps labels. Same value as MICRO_TEXT, which predates this and is used section-wide. */
  micro: MICRO_TEXT,
  /** The smallest label that is still a label. */
  caption: '0.6rem',
  /** The floor. A league rank under a stat value, and nothing else. */
  nano: '0.5rem',
} as const

/** A tab's own title, Home's league name included. ONE STYLE FOR ALL FIVE because they are read in
 *  sequence: with the tabs in the toolbar there is no pill row between them to absorb a change,
 *  so Home's display-size title next to four smaller ones read as the page jumping on every switch.
 *  The size of a standalone page's (WpblPage) on a desktop, a step down on a phone. */
export const TAB_TITLE_SX = {
  fontSize: { xs: TYPE_SCALE.heading, md: TYPE_SCALE.page },
  fontWeight: 800, letterSpacing: '-0.3px', lineHeight: 1.15,
} as const

/**
 * WEIGHT HAS A CEILING AT THE BOTTOM OF THIS SCALE, and it is the opposite of the instinct.
 *
 * The reflex with a label that has to carry is to make it heavier, and above `body` that works.
 * Below about 10px it stops working and starts undoing itself: the strokes thicken while the
 * counters (the holes in a, e, o, and the gaps inside an uppercase B or R) stay the same size,
 * so they close up and the word turns into a shape you match rather than letters you read. It
 * is worst on exactly what these sizes are used for, which is uppercase set with letter-spacing
 * in a saturated accent or a dimmed grey, where a second and third emphasis are already doing
 * the work weight was being asked to do.
 *
 * So, on a phone at the default text scale, where 1rem is 16px:
 *
 *   · **Under 9px: 700 at the most.** That is `nano`, and the 0.55/0.56rem sizes set by hand.
 *   · **9px to 10.5px: 800 at the most.** That is `caption`, and 0.58 to 0.62rem.
 *   · Anything larger: no ceiling, 900 is fine and several things want it.
 *
 * IN PIXELS AND NOT IN TOKEN NAMES, deliberately: a lot of the small type in this section is set
 * as a raw rem value rather than through TYPE_SCALE, so a rule phrased as "nano and caption"
 * would miss 0.55rem entirely, which is where the worst cases sit.
 *
 * A SINGLE GLYPH IS EXEMPT, and there are three: the `›` affordance on a series box, and the two
 * `*` flags on the pitching-usage grid. A symbol has no counters to close and no word shape to
 * lose, and those two want to be found rather than read.
 *
 * THE READER'S TEXT SETTING DOES NOT RESCUE THIS. Large multiplies by 1.125, so 8px becomes 9
 * and 9.6 becomes 10.8, still inside the range above; and someone who has asked for bigger text
 * is the last reader who should be handed a filled-in 8px word. The desktop scale does lift
 * these (`--app-type` puts nano at 10px), which is exactly why this goes unnoticed: the section
 * is built on a desktop and the failure is on the phone, where the traffic is.
 *
 * Nothing enforces this. `tsc` cannot see a font weight, so a new small label has to be checked
 * against these bands by whoever writes it.
 */

/**
 * Icon sizes, and they are a SEPARATE SCALE on purpose.
 *
 * MUI sizes an icon with `fontSize`, so an icon and a paragraph reach for the same CSS property
 * and a naive audit reads a 1.35rem emoji as a heading. They are not the same problem: type
 * sizes are a reading hierarchy and icon sizes are a fit against the text beside them. Keeping
 * two names means the type test can insist on TYPE_SCALE without an allowlist of exceptions
 * nobody would maintain.
 */
export const ICON_SIZE = {
  lg: '1.35rem',
  md: '1.15rem',
  sm: '0.85rem',
} as const

/**
 * THE TWO SHAPES HOME'S FIXTURE CARDS SHARE. Next game and Last game sit one above the other in
 * the same column, so their club rows and their last row are drawn the same way on both, or the
 * pair reads as two design systems on one page. The differences that DO carry meaning are in
 * the content: Next game tints both clubs because a fixture has two equals in it and Last game
 * tints only the winner because a result does not, and Next game puts a record beside the name
 * where Last game puts a score down the edge.
 *
 * Both cancel SectionCard's own body padding (`mx: -2`, and `mb: -1.5` at the foot) and put it
 * back inside, so the numbers here are tied to that component's px/pb.
 */

/** The club rows, run to the card's edges. Rows inside take `px: 2` to land back on the text
 *  column, and the 1px `gap` is the card's own paper showing through: two saturated tints
 *  meeting edge to edge blend into a third colour along the join. */
export const CLUB_BAND = { mx: -2, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '1px' } as const

/** The card's last row: the one thing you can DO, on a recessed field with the card's radius
 *  clipping its bottom corners. A rule above it instead makes a short card read as a stack of
 *  drawers, which is what both of these were doing. */
export const cardFooterBand = (isDark: boolean) => ({
  mt: 1.25, mx: -2, mb: -1.5, px: 2, py: 1.25,
  bgcolor: isDark ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.022)',
  display: 'flex', alignItems: 'center', gap: 1,
} as const)

// Team badge: the one logo/color chip used across the section (schedule, standings,
// team grid, box scores). A team-color circle ringed in the team's secondary hue (so
// near-black or page-matching primaries stay defined), with the bundled logo on top:
// full-bleed for finished lockups (Boston), centered for transparent knockouts, or
// the abbreviation when no logo exists.
export function TeamBadge({ team, size = 34, ring }: {
  team: Pick<WpblTeam, 'id' | 'abbr'>; size?: number
  /** Override the ring colour, which defaults to the club's secondary. For a surface that keys a
   *  whole card on one team colour and needs the badge ring to match it rather than compete. */
  ring?: string
}) {
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
      border: `2px solid ${ring ?? wpblSecondary(team.id)}`,
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

/**
 * Who is on, in the words a broadcast uses. The accessible name for `BaseDiamond`, and the one
 * spelling of these eight phrases on any surface that has only the three flags.
 *
 * WORD FOR WORD THE SAME EIGHT as `BASE_PHRASE` in `derive/runExpectancy.ts`, and pinned to it
 * by `baseDiamond.test.tsx`. They are not one constant because the shapes differ: that one is
 * keyed on a base bitmask, which is right where a bitmask is what you hold, and importing it
 * here would pull the whole run-expectancy engine into the live scoreboard's chunk to read a
 * string table. Two short lists and a test that compares them is cheaper than that, and the
 * test is what stops them drifting into two spellings of one phrase.
 */
export function basesPhrase(first: boolean, second: boolean, third: boolean): string {
  const on = [first && '1st', second && '2nd', third && '3rd'].filter(Boolean) as string[]
  if (on.length === 0) return 'nobody on'
  if (on.length === 3) return 'bases loaded'
  if (on.length === 1) return `runner on ${on[0]}`
  return `runners on ${on[0]} and ${on[1]}`
}

/**
 * Who is on base, as the shape a scoreboard draws.
 *
 * ONE GLYPH FOR THE WHOLE SECTION: two diamonds that disagree about which corner is second base
 * is the kind of difference a reader notices without being able to say what is wrong. Second at
 * the top, third at the left, first at the right: the view from behind the plate, which is every
 * scoreboard and every broadcast graphic.
 *
 * NO HOME PLATE, deliberately. Nobody stands on it, so drawing it adds a fourth mark that is
 * never filled and makes the three that matter harder to count at 20px.
 *
 * IT CARRIES ITS OWN NAME, AND IT WRITES IT ITSELF. Three unlabelled squares are invisible to a
 * screen reader and to anyone who cannot see the fill, so the glyph is a `role="img"` and its
 * name is derived from the same three flags it draws. Derived rather than passed because a
 * required prop is a prop a new call site can get wrong or paste from its neighbour, and a
 * diamond captioned with the wrong bases is worse than one captioned generically. On the
 * run-value table the name is also what lets the written label be dropped on a phone, which is
 * what stops that table scrolling sideways.
 *
 * `scale` IS EXPLICIT AT EVERY CALL SITE and has no default, because the two answers are both
 * right and the wrong one is invisible. `chrome` is the ordinary one: art in the page grows
 * with `--app-chrome` like TeamBadge and PlayerPortrait do. `none` is for a glyph pinned to a
 * strip whose other lengths are raw px, where scaling one of them pulls the row apart.
 * See the scale rules in CLAUDE.md.
 */
export function BaseDiamond({ first, second, third, size = 34, scale, color = '#60a5fa', context }: {
  first: boolean; second: boolean; third: boolean
  size?: number
  scale: 'chrome' | 'none'
  /** The fill for an occupied base. An empty base is an outline in `text.disabled` either way. */
  color?: string
  /** What this diamond is a picture OF, when the surface means something narrower than "who is
   *  on": "Bases after the play". A PREFIX AND NOT A LABEL, deliberately, for the reason above:
   *  the eight phrases stay derived from the three flags, so no call site can caption a diamond
   *  with bases it is not drawing. All this adds is the sentence a screen reader needs when the
   *  glyph is one of eighty down a list rather than the one live state at the top of a card. */
  context?: string
}) {
  const phrase = basesPhrase(first, second, third)
  const label = context ? `${context}: ${phrase}` : phrase
  const len = (px: number) => (scale === 'chrome' ? chromePx(px) : `${px}px`)
  // The corners are percentages of the frame, so they follow whichever unit the frame took.
  const sq = (occ: boolean, pos: object) => (
    <Box sx={{
      position: 'absolute', ...pos, width: len(size * 0.3), height: len(size * 0.3),
      transform: 'translate(-50%,-50%) rotate(45deg)',
      bgcolor: occ ? color : 'transparent',
      border: '1.5px solid', borderColor: occ ? color : 'text.disabled', borderRadius: '1px',
    }} />
  )
  return (
    <Box role="img" aria-label={label} sx={{
      position: 'relative', width: len(size), height: len(size), flexShrink: 0,
    }}>
      {sq(second, { left: '50%', top: '22%' })}
      {sq(third, { left: '22%', top: '50%' })}
      {sq(first, { left: '78%', top: '50%' })}
    </Box>
  )
}

// Player portrait: circular headshot ringed in the team's secondary hue (matching the
// TeamBadge ring so players and teams read as one set). Falls back to the player's
// initials on the team color when no portrait is bundled (see ./portraits.ts).
export function PlayerPortrait({ name, teamId, size = 40, square, src: given, ring, eager }: {
  name: string; teamId: string | null; size?: number
  /** Override the ring colour, which defaults to the club's secondary. See TeamBadge's `ring`:
   *  for a card keyed on one team colour, so the portrait ring matches it instead of stacking a
   *  second hue outside it. */
  ring?: string
  /** Load the image eagerly instead of lazily. Needed for an OFF-SCREEN capture (the share card):
   *  a lazy image parked outside the viewport never loads, so it captures blank. */
  eager?: boolean
  /** A rounded square instead of a circle. Opt-in, and only the player page uses it: a circle
   *  crops a head-and-shoulders portrait to the face, which is right at 32px in a table row
   *  and wasteful at 84px where there is room to show the shoulders and the uniform. */
  square?: boolean
  /** A face this component cannot look up, because the lookup is by a DB player name and the
   *  person is not on a roster: the four managers on the awards ballot. Everything else about
   *  the frame is the same, which is the point of routing them through here rather than
   *  redrawing the ring somewhere else. A set rather than a url so a manager gets the same
   *  rendition choice a player does; a bare string still works and simply has one. */
  src?: string | WpblPortraitSet | null
}) {
  const art: WpblPortraitSet | null =
    typeof given === 'string' ? { src: given } : (given ?? wpblPortraitSet(name))
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
  return (
    <Box sx={{
      // Same as TeamBadge: art scales with the chrome, not with the reader's text size.
      width: `calc(${size}px * var(--app-chrome, 1))`, height: `calc(${size}px * var(--app-chrome, 1))`,
      borderRadius: square ? `calc(${Math.round(size * 0.18)}px * var(--app-chrome, 1))` : '50%', flexShrink: 0,
      bgcolor: wpblColor(teamId),
      border: `2px solid ${ring ?? wpblSecondary(teamId)}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    }}>
      {art
        ? <Box
            component="img" src={art.src} srcSet={art.srcSet}
            // WHAT THE BROWSER IS BEING TOLD, and it has to be a plain length: `sizes` is read
            // before layout and cannot see `--app-chrome`, so this states the widest this frame
            // can get, which is the caller's px at the desktop chrome scale. Overstating it is
            // the safe direction (a sharper file than needed); understating it would send a
            // 2x player page the 128.
            sizes={`${Math.ceil(size * 1.4)}px`}
            alt={name} loading={eager ? 'eager' : 'lazy'}
            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        : <Typography sx={{ fontSize: size * 0.36, fontWeight: 800, color: '#fff' }}>{initials}</Typography>}
    </Box>
  )
}

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

// Pill segmented control: the section nav "menu". Mirrors MLB's SegControl, wrapped
// in the same centered / mobile-horizontal-scroll container MlbStats uses for its tabs.
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
              px: sm ? 1 : 1.75, py: sm ? 0.3 : 0.5,
              borderRadius: 999,
              cursor: 'pointer',
              fontSize: sm ? '0.68rem' : '0.75rem',
              lineHeight: 1.4,
              whiteSpace: 'nowrap',
              ...(fill ? { flex: { xs: 1, sm: 'none' }, textAlign: 'center' } : {}),
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

// PillGroup lives in src/ui/PillGroup.tsx (shared with MLB since Oct 2026); re-exported here so WPBL's
// imports did not change.
export { PillGroup } from '../ui/PillGroup'

// Bordered content card with a left accent stripe and an icon + title + subtitle
// header, mirroring the MLB home-feed cards. `action` sits at the right of the header
// (e.g. a "View all" link); body is the children.
// pressable / linkPress / FOCUS_RING live in src/ui/interaction.ts (shared with MLB); re-exported above.

// ─── Horizontal rail paging ─────────────────────────────────────────────────────
// The scroll-edge bookkeeping and the paging chevron, shared by every horizontal rail
// (Reading, Highlights, Photos) so the three cannot drift apart.

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
        // NOT `...TAPPABLE`, and the reason is one line down: this control only EXISTS on a
        // hover-capable pointer, and its own media block carries that. Spreading TAPPABLE here
        // writes the same media key and the `display: flex` below then overwrites it, silently
        // dropping the hover it was added for. A touch device never sees this arrow, so there
        // is no touch state to give it; the hover belongs inside the one gate it already has.
        '@media (hover: hover) and (pointer: fine)': {
          display: 'flex',
          ...TAPPABLE,
        },
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
export function RailScroller({ onScroll, scrollRef, children, snap = true, phoneInset = 0 }: {
  onScroll: () => void
  scrollRef: React.RefObject<HTMLDivElement | null>
  children: React.ReactNode
  /** Off while something drives the scroll itself: a snap point re-snaps every programmatic
   *  nudge, so a slow auto-scroll would never get off the tile it started on. */
  snap?: boolean
  /** For a rail its card bleeds to the card's edges on a phone (a negative margin the size of the
   *  card's padding): the same amount of room, in spacing units, put back INSIDE the scroller. The
   *  tiles then start and end in line with the rest of the card and still use the full width
   *  while scrolling. Without it the first photo sat flush against the card's border and every
   *  snap parked a photo there too. */
  phoneInset?: number
}) {
  return (
    <Box ref={scrollRef} onScroll={onScroll} data-swipe-ignore="true" sx={theme => ({
      display: 'flex', gap: 1.25, overflowX: 'auto', pb: 0.5,
      scrollSnapType: snap ? 'x proximity' : 'none',
      '&::-webkit-scrollbar': { display: 'none' },
      msOverflowStyle: 'none', scrollbarWidth: 'none',
      ...(phoneInset > 0 && {
        [theme.breakpoints.down('sm')]: {
          pl: phoneInset,
          // Snapping measures from the scroll padding, not the padding, so a snapped tile rests
          // in the same place the first one starts.
          scrollPaddingInline: theme.spacing(phoneInset),
          // The trailing room as a spacer rather than `padding-right`, which Safari leaves out of
          // a flex scroller's scrollable width: the last photo would stop flush at the border
          // again. The rail's own gap already stands before it, so it is the inset minus the gap.
          '&::after': { content: '""', flexShrink: 0, width: `calc(${theme.spacing(phoneInset)} - ${theme.spacing(1.25)})` },
        },
      }),
    })}>
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
  // 18, not the 12 the hook defaults to, which is sized for a narrow stats-table name column. A
  // leader row gives the name about 135px after the badge, where the longest name on the roster
  // ("Samantha Gutierrez") draws in 130; at 12 a board would show three initials and two whole
  // names in five consecutive rows for no reason a reader could see. The mechanism stays for a
  // name genuinely too long to fit, since a cut-off name reads worse than an abbreviated one.
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
          ...tappableIf(clickable),
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

// TapTip lives in src/ui/TapTip.tsx (shared with MLB's player page since Oct 2026); re-exported
// here so WPBL's imports did not change.
export { TapTip } from '../ui/TapTip'

export function SectionCard({ icon, title, subtitle, action, actionWraps, collapsed, onToggleCollapse, fill, bare, frameless, children }: {
  icon?: React.ReactNode
  title: string
  /** A quiet second line under the title. Keep it to one line; this slot is 0.72rem and the
   *  header does not grow. A live figure does NOT belong here: in the subtitle it reads as a
   *  footnote to the heading, at the smallest size on the card. Put it in `action`, on the
   *  title's own baseline. */
  subtitle?: React.ReactNode
  /** The header's right-hand end: a "View all" link, or a fact the card is measured by. */
  action?: React.ReactNode
  /** Let a crowded header take the space out of the action instead of the title.
   *
   *  The default is the other way round and is not a `flexShrink` on the action: the title box
   *  is `flex: 1` from a zero basis, so a wide action never overflows the row, it just leaves
   *  the title a narrow column and the TITLE wraps. Fine for a two-word link, wrong for Next
   *  game, whose action is a date and a countdown: at Large text on a narrow phone that card
   *  would be titled "Next / game". Set this and the title takes its own width while the action
   *  takes the remainder, so only an action that can wrap should ask for it. */
  actionWraps?: boolean
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
   *  a leaderboard using it reads as a different surface from the tables beside it on the very
   *  same tab. Off by default, because a card that holds prose or mixed content wants the
   *  raised fill that separates it from the page. */
  bare?: boolean
  /** On a phone, drop the border, the radius and the side padding so the card's content runs to the
   *  page's own gutter. For a reference page like the season recap where, at phone width, a card
   *  sitting inside the page's 16px gutter compresses an already-narrow chart into a column: the
   *  frame costs width the content cannot spare. Framed as normal from `sm` up, where the room is
   *  there. Off by default. */
  frameless?: boolean
  children: React.ReactNode
}) {
  const collapsible = !!onToggleCollapse
  return (
    <Box sx={[{
      borderRadius: frameless ? { xs: 0, sm: 3 } : 3, overflow: 'hidden',
      borderStyle: 'solid', borderColor: CARD_BORDER,
      borderWidth: frameless ? { xs: 0, sm: '1px' } : '1px',
      bgcolor: bare ? 'transparent' : CARD_FILL,
      // No `height: 100%` here. A grid item already stretches to its row, so this would only
      // ever be redundant there, and below md, where the container falls back to a flex
      // column, a percentage height resolves against the column's own height and makes every
      // card in it the same size, squashing the shorter ones on a phone.
      ...(fill ? { display: 'flex', flexDirection: 'column' } : {}),
    }, bare ? BARE_CARD_DARK : {}]}>
      {/* The whole header toggles: a thumb-sized target rather than a small chevron hitbox.
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
          px: frameless ? { xs: 0, sm: 2 } : 2, pt: 1.25, pb: collapsed ? 1.25 : 1,
          display: 'flex', alignItems: 'center', gap: 1,
          ...(collapsible ? { cursor: 'pointer', userSelect: 'none', ...TAPPABLE } : {}),
        }}
      >
        {icon != null && <Box sx={{ fontSize: '1.1rem', lineHeight: 1, flexShrink: 0 }}>{icon}</Box>}
        <Box sx={actionWraps ? { flexShrink: 0 } : { flex: 1, minWidth: 0 }}>
          {/* A REAL `h2`. Every card title on every WPBL page comes through here, and as plain text
              a screen reader would land on the `h1` and then have no way to skim the page, since
              heading navigation is what skimming IS without sight. MUI's Typography sets
              `margin: 0` on its root, and the size and weight are set here rather than inherited
              from a variant, so the tag moves nothing on screen. The level is fixed at 2 on
              purpose: every consumer is a top-level section of a page that owns the `h1`, and a
              prop for it would only invite a card to lie. */}
          <Typography component="h2" sx={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.2 }}>{title}</Typography>
          {subtitle && <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', lineHeight: 1.3 }}>{subtitle}</Typography>}
        </Box>
        {action != null && (
          <Box
            onClick={e => e.stopPropagation()}
            sx={{ display: 'flex', ...(actionWraps ? { flex: 1, minWidth: 0, justifyContent: 'flex-end' } : { flexShrink: 0 }) }}
          >
            {action}
          </Box>
        )}
        {collapsible && <Chevron open={!collapsed} />}
      </Box>
      {!collapsed && (
        <Box sx={{
          px: frameless ? { xs: 0, sm: 2 } : 2, pb: 1.5,
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
      cursor: 'pointer', userSelect: 'none',
      ...(flush ? { mx: -2, mb: -1.5, mt: 0.5 } : {}),
      borderTop: '1px solid', borderColor: 'divider',
      fontSize: '0.78rem', fontWeight: 800, color: 'var(--wpbl-accent-fg)',
      ...TAPPABLE,
    }}>
      {expanded ? 'Show fewer' : moreLabel}
      <Box component="span" sx={{ fontSize: '0.66rem' }}>{expanded ? '▴' : '▾'}</Box>
    </Box>
  )
}

// Disclosure chevron, drawn from a rotated border corner rather than pulled from an icon
// font: the same approach as the highlights play triangle, and it animates for free.
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
        // listed BEFORE the rotation so it shifts along the box's own axes; putting it after
        // moves along the rotated frame and skews the glyph (the closed one reads as a tick).
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

// The share chip for a sheet header, shared with MLB (src/ui/CopyLinkButton.tsx). WPBL confirms
// a copy in its own accent.
export function CopyLinkButton(props: { url: string; title?: string; onCopy?: () => void }) {
  return <CopyLinkButtonBase {...props} copiedColor={wpblAccentFg(useWpblDark())} />
}

// ModalShell lives in src/ui/ModalShell.tsx (shared with MLB); re-exported above.

/**
 * The player card's secondary block: a rule of the club's colour, a label, a line of summary,
 * and optionally something that opens.
 *
 * ONE COMPONENT for every such block on the card (`CameoBlock`, `FieldingLine`,
 * `PitchLocationCard`), so they cannot answer the same questions three ways: one disclosure
 * glyph, one label size, one summary placement. Blocks on screen together that differ read as
 * meaning something, and these differences never would.
 *
 * A chevron, not a `+`: a `+` says "add" where the control reveals, and it cannot show its own
 * state without being read. A chevron points at where the content will appear and rotates to
 * say it is already there.
 *
 * `meta` is the right-hand slot, for something true of the whole block rather than a value in
 * it. Fielding spends it on the positions those numbers came from, which is the difference
 * between a fielding line and a claim about the player's glove at the position the tab implies.
 */
export function AccentPanel({ label, summary, meta, accent, defaultOpen = false, ariaLabel, children, sx }: {
  label: string
  /** The gist, beside the label. Carries the block when it is closed, so it has to stand alone. */
  summary?: React.ReactNode
  /** Right-aligned, before the disclosure. Scope rather than value. */
  meta?: React.ReactNode
  accent: string
  defaultOpen?: boolean
  ariaLabel?: string
  /** Omit entirely for a block with nothing to open, which then draws no control at all. */
  children?: React.ReactNode
  sx?: SxProps<Theme>
}) {
  const [open, setOpen] = useState(defaultOpen)
  const canOpen = children != null
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden', ...sx }}>
      <Box
        {...(canOpen ? {
          onClick: () => setOpen(o => !o),
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) }
          },
          role: 'button', tabIndex: 0, 'aria-expanded': open,
          // The summary joins the label when it is plain text, because a screen reader meeting
          // "Pitch locations, collapsed" has been told nothing about whether it is worth
          // opening, and "44 pitches, 1 of 5 games" is the whole of that decision.
          'aria-label': ariaLabel ?? [
            label, typeof summary === 'string' ? summary : null, open ? 'Collapse' : 'Expand',
          ].filter(Boolean).join('. ') + '.',
        } : {})}
        sx={{
          display: 'flex', alignItems: 'baseline', gap: 1, px: 1.5, py: 1,
          // ORDER MATTERS AND IT IS NOT OBVIOUS. A shorthand `borderColor` would repaint the left edge
          // too, turning the club's rule the divider's grey and losing the only thing tying the panel to
          // the team. The long-hand bottom colour leaves the left edge alone. Check the computed style
          // after touching this rather than the look: at a glance a 3px grey rule still reads as a
          // deliberate border.
          borderBottom: open ? '1px solid' : 'none',
          borderBottomColor: 'divider',
          borderLeft: `3px solid ${accent}`,
          ...(canOpen ? { cursor: 'pointer', ...TAPPABLE } : {}),
          '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: -2 },
        }}
      >
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, flexShrink: 0 }}>
          {label}
        </Typography>
        {summary != null && (
          <Typography component="div" sx={{ fontSize: '0.8rem', color: 'text.secondary', fontVariantNumeric: 'tabular-nums', minWidth: 0 }}>
            {summary}
          </Typography>
        )}
        {meta != null && (
          /* THE META GIVES WAY FIRST, which is why it carries a shrink factor rather than
              `flexShrink: 0`. On a 375px phone this row is about twelve pixels wider than the space
              it has once the fielding line is in it, and without this the SUMMARY is what wraps,
              splitting the value across two lines while the scope note beside it keeps every pixel
              of "CF, P". The summary is the row's content and the meta is a caption on it, so the
              caption is the one that should be squeezed. An absurd shrink factor rather than a
              bigger one because flex shares a deficit in proportion to base size times factor, and
              the intent here is not "shrink it more", it is "take all of it from this one".
              It ellipsizes rather than wrapping for the same reason: a caption clipped to "CF…"
              still says which positions these numbers cover, and it is already an abbreviation of a
              longer list (see FieldingLine). The summary never truncates. */
          <Typography component="div" sx={{
            ml: 'auto', pl: 1, fontSize: '0.7rem', fontWeight: 700, letterSpacing: 0.3,
            color: 'text.disabled', flexShrink: 1000000, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {meta}
          </Typography>
        )}
        {canOpen && (
          /* Alignment is the reason this is a box and not a glyph: the row is baseline-aligned
             so the label and the summary sit on one line, and a triangle has no baseline to
             align to. `alignSelf: center` takes it out of that and centres it on the row. */
          <Box sx={{
            flexShrink: 0, width: 0, height: 0, alignSelf: 'center',
            ...(meta == null ? { ml: 'auto' } : { ml: 1 }),
            borderStyle: 'solid', borderWidth: '5px 4px 0 4px',
            borderColor: 'currentColor transparent transparent transparent', color: 'text.disabled',
            transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s',
          }} />
        )}
      </Box>
      {canOpen && open && <Box sx={{ px: 1.5, pb: 1.5, pt: 1.25 }}>{children}</Box>}
    </Box>
  )
}

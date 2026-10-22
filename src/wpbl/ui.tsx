// ─── WPBL UI primitives ─────────────────────────────────────────────────────────
// The section's own primitives, keyed to WPBL_ACCENT. WPBL never imports from src/mlb, so it
// stays a self-contained lazy chunk. What BOTH sections use (ModalShell, the tap and hover
// helpers) moved to src/ui on Sep 28, 2026, when MLB adopted WPBL's shell; it is re-exported
// below so nothing in the section had to change its imports.

import { useDark } from '../ui/useDark'
import { printedRanks } from '../ui/leaders'
import React, { useEffect, useLayoutEffect, useMemo, useCallback, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import type { Theme, SxProps } from '@mui/material'
import { wpblAccentFg, wpblColor, wpblSecondary, wpblLogo, wpblLogoFill } from './constants'
import { wpblPortraitSet, type WpblPortraitSet } from './portraits'
import type { WpblTeam, WpblPlayer } from './types'
import { scrollBehavior } from '../lib/motion'
import { useWpblPlayerLink } from './LinkContext'
import { TAPPABLE, tappableIf, pressable, FOCUS_RING, hoverOnly } from '../ui/interaction'
import { typePx } from '../ui/scale'
import { CopyLinkButton as CopyLinkButtonBase } from '../ui/CopyLinkButton'
import { nameStages, nameAtStage, useLineNameFit } from '../ui/names'
// The card, its surfaces and the type scale moved to src/ui/card.tsx on Oct 9, 2026, when MLB's
// glossary became the first MLB page drawn with them. Re-exported so the section's imports held.
import { TYPE_SCALE, CARD_BORDER, edge } from '../ui/card'
import { ClubBadge } from '../ui/ClubBadge'
export { TYPE_SCALE, MICRO_TEXT, CARD_BORDER, CARD_FILL, CARD_INK, INNER_BORDER, SectionCard } from '../ui/card'
export { hoverOnly, TAPPABLE, tappableIf, pressable, linkPress, FOCUS_RING } from '../ui/interaction'
export { ModalShell, usePhoneLayout, AfterShellEnters } from '../ui/ModalShell'

// ─── Name shortening ────────────────────────────────────────────────────────────
// Every name is MEASURED now: FittedName below, NameText / NameLine (src/ui/NameText.tsx) in a
// list row, useLineNameFit for a line of several. The character-count shortener that used to live
// here (`wpblShortName` / `useWpblName`) went in Oct 2026: a count cannot know the room, so it
// left a name whole on a phone that then cut it, and abbreviated one that fitted on a desktop.

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
// IT CANNOT SEE A NEIGHBOR OR THE READER'S TEXT SCALE, and that is the whole risk. A budget
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
export const wpblNameStages = nameStages

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
  // After EVERY render on purpose: it measures. Shrinking stops at the last stage and growing is
  // allowed once per name and width (`grew`), so the loop the rule warns about settles.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
 * A win is SOLID GREEN and a loss is a RED RING. Color alone would have been the only thing
 * telling the two apart, and red/green is precisely the pair that around one man in twelve
 * cannot separate. Everywhere else in the section the color is redundant ("+26", "W4", "4–3"
 * all say it in text as well), and this strip must not be the exception. Filled-versus-hollow
 * survives greyscale, deuteranopia and a glance from arm's length.
 *
 * No opacity ramp for recency, either: it competes with the fill/ring distinction for the same
 * few pixels and leaves the older rings too faint to read as rings at all.
 *
 * Only as many dots as there are games: five gray placeholders on opening week would suggest
 * a team had lost five, which is the one thing the strip must never imply.
 *
 * ONE STRIP FOR THE SECTION, so a result is never a green tick on one page and a team-colored
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

// BOARD_COLUMN / BOARD_COLUMN_WIDE live in src/ui/layoutWidths.ts (shared with MLB since Oct 2026).
export { BOARD_COLUMN, BOARD_COLUMN_WIDE } from '../ui/layoutWidths'

// TAB_TITLE_SX lives in src/ui/card.tsx, shared with MLB's Home title since Oct 9, 2026.
export { TAB_TITLE_SX } from '../ui/card'

/**
 * WEIGHT HAS A CEILING AT THE BOTTOM OF THIS SCALE, and it is the opposite of the instinct.
 *
 * The reflex with a label that has to carry is to make it heavier, and above `body` that works.
 * Below about 10px it stops working and starts undoing itself: the strokes thicken while the
 * counters (the holes in a, e, o, and the gaps inside an uppercase B or R) stay the same size,
 * so they close up and the word turns into a shape you match rather than letters you read. It
 * is worst on exactly what these sizes are used for, which is uppercase set with letter-spacing
 * in a saturated accent or a dimmed gray, where a second and third emphasis are already doing
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

// ICON_SIZE lives in src/ui/card.tsx beside TYPE_SCALE, shared with MLB since Oct 9, 2026.
export { ICON_SIZE } from '../ui/card'

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
 *  meeting edge to edge blend into a third color along the join. */
export const CLUB_BAND = { mx: -2, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '1px' } as const

/** The card's last row: the one thing you can DO, on a recessed field with the card's radius
 *  clipping its bottom corners. A rule above it instead makes a short card read as a stack of
 *  drawers, which is what both of these were doing. */
export const cardFooterBand = (isDark: boolean) => ({
  mt: 1.25, mx: -2, mb: -1.5, px: 2, py: 1.25,
  bgcolor: isDark ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.022)',
  display: 'flex', alignItems: 'center', gap: 1,
} as const)

/** A card header's "All 41 posts ›" link, in SectionCard's `action`. One style for every Home card
 *  that points at a hub, because the offseason page stacks five of them and each drew its own:
 *  gray with an arrow on the gallery, accent with a chevron on Reading, in two accent tokens.
 *  `--wpbl-accent-fg` rather than `-solid`, which is a fill color and fails as text in dark mode. */
export const CARD_LINK_SX = {
  flexShrink: 0, fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'var(--wpbl-accent-fg)',
  textDecoration: 'none', ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING,
} as const

// Team badge: the one logo/color chip used across the section (schedule, standings,
// team grid, box scores). A team-color circle ringed in the team's secondary hue (so
// near-black or page-matching primaries stay defined), with the bundled logo on top:
// full-bleed for finished lockups (Boston), centered for transparent knockouts, or
// the abbreviation when no logo exists. The drawing is src/ui/ClubBadge.tsx, shared with MLB's
// TeamLogo; this says which colors and art a WPBL club gets.
export function TeamBadge({ team, size = 34, ring }: {
  team: Pick<WpblTeam, 'id' | 'abbr'>; size?: number
  /** Override the ring color, which defaults to the club's secondary. For a surface that keys a
   *  whole card on one team color and needs the badge ring to match it rather than compete. */
  ring?: string
}) {
  return (
    <ClubBadge size={size} alt={team.abbr} src={wpblLogo(team.id) ?? undefined}
      bg={wpblColor(team.id)}
      // Through edge(): a club's secondary can sit close to the page (Firebells red on the dark
      // page measured 1.8:1), and the ring is the badge's edge. CLAUDE.md, "Borders".
      ring={edge(ring ?? wpblSecondary(team.id))}
      fit={wpblLogoFill(team.id) ? 'cover' : 'contain'} logoScale={0.65} />
  )
}

// basesPhrase and BaseDiamond live in src/ui/BaseDiamond.tsx (shared with MLB's play-by-play since
// Oct 2026); re-exported here so WPBL's imports did not change.
export { basesPhrase, BaseDiamond } from '../ui/BaseDiamond'

// Player portrait: circular headshot ringed in the team's secondary hue (matching the
// TeamBadge ring so players and teams read as one set). Falls back to the player's
// initials on the team color when no portrait is bundled (see ./portraits.ts).
export function PlayerPortrait({ name, teamId, size = 40, square, src: given, ring, eager, priority, onReady }: {
  name: string; teamId: string | null; size?: number
  /** Told once the frame has its final look: the face has loaded (or failed), or there is no
   *  face and the initials are it. For a caller that holds a placeholder over the frame until
   *  then, since the bare club-colored disc in between reads as a blink. */
  onReady?: () => void
  /** The face a card is ABOUT, drawn on arrival: the player card's band. Loads eagerly at high
   *  priority, and shows the 128 copy (almost always already cached, by the list row the card was
   *  opened from) until the full-size one has loaded. Without that the band rose into view with an
   *  empty club-colored square where the face would arrive a beat later, and a lazy image that
   *  remounts paints blank for a frame before it finds its cached copy. */
  priority?: boolean
  /** Override the ring color, which defaults to the club's secondary. See TeamBadge's `ring`:
   *  for a card keyed on one team color, so the portrait ring matches it instead of stacking a
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
  const found: WpblPortraitSet | null =
    typeof given === 'string' ? { src: given } : (given ?? wpblPortraitSet(name))
  // A face that fails to load falls back to the initials, the same as one never bundled. Until
  // Oct 21, 2026 a failed load left the club-colored disc empty, which reads as a broken image.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const art = found && found.src !== failedSrc ? found : null
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
  // With a srcset the `src` is the 128 copy (see wpblPortraitSet). Cleared once the chosen
  // rendition has loaded, because these are cut-outs: left underneath, the soft copy would show
  // through the transparent edge around the sharp one.
  const placeholder = priority && art?.srcSet ? art.src : null
  const hasArt = !!art
  useEffect(() => { if (!hasArt) onReady?.() }, [hasArt, onReady])
  return (
    <Box sx={{
      // Same as TeamBadge: art scales with the chrome, not with the reader's text size.
      width: `calc(${size}px * var(--app-chrome, 1))`, height: `calc(${size}px * var(--app-chrome, 1))`,
      borderRadius: square ? `calc(${Math.round(size * 0.18)}px * var(--app-chrome, 1))` : '50%', flexShrink: 0,
      bgcolor: wpblColor(teamId),
      ...(placeholder ? { backgroundImage: `url(${placeholder})`, backgroundSize: 'cover' } : {}),
      border: '2px solid', borderColor: edge(ring ?? wpblSecondary(teamId)),
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
            alt={name} loading={eager || priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : undefined}
            // A cached face is complete before React can hear its load event, hence the ref.
            ref={onReady ? (el: HTMLImageElement | null) => { if (el?.complete) onReady() } : undefined}
            onLoad={(e: React.SyntheticEvent<HTMLImageElement>) => {
              if (placeholder) {
                const frame = e.currentTarget.parentElement
                if (frame) frame.style.backgroundImage = 'none'
              }
              onReady?.()
            }}
            onError={() => { setFailedSrc(art.src); onReady?.() }}
            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        : <Typography sx={{ fontSize: size * 0.36, fontWeight: 800, color: '#fff' }}>{initials}</Typography>}
    </Box>
  )
}

// SegNav and NewDot live in src/ui/SegNav.tsx (shared with MLB since Oct 2026); re-exported here so
// WPBL's imports did not change.
export { SegNav, NewDot } from '../ui/SegNav'

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
      {...pressable(onClick)}
      aria-label={`${dir === 'left' ? 'Previous' : 'More'} ${label}`}
      tabIndex={-1}
      sx={{
        position: 'absolute', top: '34%', [dir]: -4, transform: 'translateY(-50%)', zIndex: 2,
        width: 34, height: 34, borderRadius: '50%',
        display: 'none', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        bgcolor: 'background.raised', border: '1px solid', borderColor: CARD_BORDER,
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
/**
 * The places for a list of `LeaderRow`s, judged on the value as printed: two rows that read the
 * same share a place and say "T-2", as the Leaders board and the Stats table do. Spread one over
 * each row (`{...places[i]}`). Without it a board numbered rows 1, 2, 3 by array position, and a
 * reader saw two players on the same figure ranked one above the other.
 */
export function leaderPlaces(texts: string[]): { rank: number; tied: boolean; wide: boolean; first: boolean }[] {
  const ranks = printedRanks(texts)
  const wide = ranks.some(r => r.tied)
  return ranks.map((r, i) => ({ ...r, wide, first: i === 0 }))
}

export function LeaderRow({ rank, tied = false, wide = false, first, player, name, teamId, value, unit, sub, accent, onOpen }: {
  rank: number
  /** A shared place, drawn "T-2". From `leaderPlaces`, with `wide` and `first`. */
  tied?: boolean
  /** Room for "T-2" on every row of a board that has one, so the names still line up. */
  wide?: boolean
  /** The top row, which carries no rule. Defaults to rank 1, which a tie for first makes two of. */
  first?: boolean
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
  // MEASURED, not counted. A character count cannot know the room: at 18 it left "Andréanne
  // Leblanc" whole on a 375px phone and the ellipsis cut it mid-name, and any lower count
  // abbreviates names that fit on a desktop. The fit steps to "F. Last" only when the row overflows.
  const fit = useLineNameFit<HTMLElement>([name])
  const playerLink = useWpblPlayerLink()
  return (
    <Box
      {...(clickable ? playerLink(player!, onOpen) : {})}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25, px: 0.5, py: 0.85,
        borderTop: (first ?? rank === 1) ? 'none' : '1px solid', borderColor: 'divider',
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
      <Box sx={{ width: wide ? '1.75rem' : '1.125rem', textAlign: 'center', fontSize: TYPE_SCALE.body, fontWeight: 800, color: rank <= 3 ? accent : 'text.disabled', flexShrink: 0, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{tied ? `T-${rank}` : rank}</Box>
      <PlayerPortrait name={name} teamId={teamId} size={32} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <Typography ref={fit.ref} sx={{ minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nameAtStage(name, fit.stage)}</Typography>
          {teamId && <TeamBadge team={{ id: teamId, abbr: teamId }} size={16} />}
        </Box>
        {sub && <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</Typography>}
      </Box>
      <Box sx={{ textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        <Box component="span" sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 800, color: accent }}>{value}</Box>
        {unit && <Box component="span" sx={{ fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.disabled', ml: 0.4 }}>{unit}</Box>}
      </Box>
    </Box>
  )
}

// TapTip lives in src/ui/TapTip.tsx (shared with MLB's player page since Oct 2026); re-exported
// here so WPBL's imports did not change.
export { TapTip } from '../ui/TapTip'

// ExpandRow lives in src/ui/ExpandRow.tsx, shared with MLB's phone Stats list since Oct 9, 2026.
export { ExpandRow } from '../ui/ExpandRow'

// TextGhost moved to src/ui/card.tsx on Oct 9, 2026, so MLB's compare page can draw the same
// loading text. Re-exported so WPBL's imports hold.
export { TextGhost } from '../ui/card'

// SectionLabel and CardLink live in src/ui/card.tsx, shared with MLB since Oct 9, 2026.
export { SectionLabel, CardLink } from '../ui/card'

// The share chip for a sheet header, shared with MLB (src/ui/CopyLinkButton.tsx). WPBL confirms
// a copy in its own accent.
export function CopyLinkButton(props: { url: string; title?: string; onCopy?: () => void }) {
  return <CopyLinkButtonBase {...props} copiedColor={wpblAccentFg(useDark())} />
}

// ModalShell lives in src/ui/ModalShell.tsx (shared with MLB); re-exported above.

/**
 * The player card's secondary block: a rule of the club's color, a label, a line of summary,
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
    <Box sx={{ border: '1px solid', borderColor: 'outline', borderRadius: 2, overflow: 'hidden', ...sx }}>
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
          // too, turning the club's rule the divider's gray and losing the only thing tying the panel to
          // the team. The long-hand bottom color leaves the left edge alone. Check the computed style
          // after touching this rather than the look: at a glance a 3px gray rule still reads as a
          // deliberate border.
          borderBottom: open ? '1px solid' : 'none',
          borderBottomColor: 'divider',
          borderLeft: `3px solid ${accent}`,
          ...(canOpen ? { cursor: 'pointer', ...TAPPABLE } : {}),
          '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: -2 },
        }}
      >
        <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 800, textTransform: 'uppercase', letterSpacing: typePx(0.6), flexShrink: 0 }}>
          {label}
        </Typography>
        {summary != null && (
          <Typography component="div" sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', fontVariantNumeric: 'tabular-nums', minWidth: 0 }}>
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
            ml: 'auto', pl: 1, fontSize: TYPE_SCALE.meta, fontWeight: 700, letterSpacing: typePx(0.3),
            color: 'text.disabled', flexShrink: 1000000, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {meta}
          </Typography>
        )}
        {canOpen && (
          /* Alignment is the reason this is a box and not a glyph: the row is baseline-aligned
             so the label and the summary sit on one line, and a triangle has no baseline to
             align to. `alignSelf: center` takes it out of that and centers it on the row. */
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

/** The "new since your last visit" marker (newSince.ts): a small "New" tag laid over the corner of a picture. Laid OVER rather than
 *  beside, so a card that gains one takes exactly the box it had without it. */
export function NewTag({ sx }: { sx?: object }) {
  return (
    <Box component="span" sx={{
      position: 'absolute', top: 6, left: 6, zIndex: 1, pointerEvents: 'none',
      px: 0.6, borderRadius: 1, bgcolor: 'var(--wpbl-accent-solid)', color: '#fff',
      fontSize: TYPE_SCALE.micro, fontWeight: 800, lineHeight: 1.6, letterSpacing: typePx(0.3),
      boxShadow: '0 1px 3px rgba(0,0,0,0.35)', ...sx,
    }}>New</Box>
  )
}

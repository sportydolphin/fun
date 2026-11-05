// The card every page in both sections is built from, the surfaces it paints, and the type scale.
// WPBL built these; they moved here on Oct 9, 2026 so MLB could draw with them (the second
// alignment pass in ROADMAP.md). The CSS variables keep their `--wpbl-` names: they are set by
// pages and read here, and renaming them is a sweep of its own with nothing to show for it.

import React from 'react'
import { Box, Typography } from '@mui/material'
import type { Theme } from '@mui/material'
import { TAPPABLE, FOCUS_RING, pressable, linkPress, hoverOnly } from './interaction'
import { edgeTone } from '../lib/contrast'
import { titleCase } from '../lib/format'

// A card's outline, which in dark mode is the whole of the card: cards there are the page color
// (see Surfaces in src/ThemeContext.tsx), so this edge is the only thing drawing one. The weight
// is a setting, published by ThemeContext as `--sd-card-border`, so DevSettings can move every card
// on the site at once. Keep `divider` for the thin rules inside a card. It is the theme's
// `palette.outline`, so a plain sx can also write `borderColor: 'outline'`.
export const CARD_BORDER = (t: Theme) => t.palette.outline
  ?? (t.palette.mode === 'dark' ? 'rgba(255,255,255,0.36)' : 'rgba(0,0,0,0.44)')

/** A color as an outline, in any sx: `borderColor: edge(teamColor)`. The color lifted toward white
 *  on the dark theme or black on the light one by the least that reaches 3:1 (edgeTone), read off
 *  the theme so a call site needs no `isDark`. For a club's or a status's own color; a plain box
 *  takes `'outline'`. CLAUDE.md, "Borders". */
export const edge = (hex: string) => (t: Theme) => edgeTone(hex, t.palette.mode === 'dark')

/** The site accent as an outline: a selected chip, a lit tab, a hovered control. The text-safe
 *  accent rather than the raw #f26b5b, which measures under 3:1 on the light page; in dark mode the
 *  two are the same red. */
export const ACCENT_EDGE = 'var(--wpbl-accent-fg)'

/** The outline of a box nested INSIDE a card (a bracket series, a game chip). The card's own
 *  weight, not the row rule's: it is still the edge of a thing, and at `divider` it measured under
 *  2:1 (CLAUDE.md, "Borders"). The nesting reads from the inset and the padding instead. */
export const INNER_BORDER = (t: Theme) => CARD_BORDER(t)

/** A card's fill: `background.paper`, which is the page color on a dark page and the raised tone
 *  inside anything floating (ModalShell re-points it), so a card always sits flush on whatever it
 *  is drawn on. A function rather than the bare token so call sites read as "the card's fill". */
export const CARD_FILL = (t: Theme) => t.palette.background.paper

/** The solid color directly behind a card's content, for the things that must PAINT it rather
 *  than show through: the 2px ring that separates overlapping portraits. Same as the fill. */
export const CARD_INK = (t: Theme) => t.palette.background.paper

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
 * neighboring sizes.
 *
 * `src/wpbl/__tests__/typeScale.test.ts` fails on a raw rem literal in an adopted file, so the
 * next size added has to be a decision about the scale rather than a number typed into an `sx`.
 */
export const TYPE_SCALE = {
  /** The page's lead and nothing else: the champion's name across the offseason Home's lead band
   *  (Nov 3, 2026). One step above `hero`, because the lead has to win on size as well as width. */
  lead: '3.5rem',
  /** The one number a page is about: a season series' or a playoff series' wins, as a scoreboard
   *  draws them. Both sections typed their own (WPBL's series page 2 to 3rem, MLB's SeriesSheet
   *  1.9 to 2.4rem) until Oct 15, 2026; one step, so the two read alike. */
  hero: '2.25rem',
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
  /** A dialog's one hero glyph above its message (the sign-in mail, the confirmed tick, the
   *  feedback thanks). Those were 2 and 2.5rem, typed in, before the shell joined the scale. */
  xl: '2rem',
  lg: '1.35rem',
  md: '1.15rem',
  sm: '0.85rem',
} as const

/** A tab's own title, Home's league name included. ONE STYLE FOR ALL FIVE because they are read in
 *  sequence: with the tabs in the toolbar there is no pill row between them to absorb a change,
 *  so Home's display-size title next to four smaller ones read as the page jumping on every switch.
 *  The size of a standalone page's (WpblPage) on a desktop, a step down on a phone. */
/** The brand color, the one hue the site owns (ROADMAP-UI.md, the audit, Nov 3, 2026). `raw` is
 *  the red for a mark, a fill or a dark-mode line; `fg` is the same accent safe as TEXT in both
 *  themes; `solid` is the fill that takes white text. The lint refuses these hexes anywhere but the
 *  token files, so the accent is changed here, in styles.css and in ThemeContext, and nowhere else. */
export const BRAND = { raw: '#f26b5b', fg: 'var(--wpbl-accent-fg)', solid: 'var(--wpbl-accent-solid)' } as const

/** The gap between two columns of sections. Wider than the 12px that sat between framed cards: with
 *  no frame, the column gutter is all that keeps two sections' rules and headings apart. */
export const SECTION_COLUMN_GAP = 4

/** The corner scale, in MUI's 4px unit, and the only values `borderRadius` may take (the lint
 *  enforces it): `sm` a chip, a bar, a row's hover; `md` a box inside a card; `lg` a card or a sheet;
 *  `pill` anything round-ended. Twelve radii from 2px to 20px collapsed onto these Nov 3, 2026. */
export const RADIUS = { none: 0, sm: 1, md: 2, lg: 3, pill: 999 } as const

/** A photograph's or a video still's corners: square, as a printed page runs a picture (Nov 4, 2026,
 *  ROADMAP-UI.md's audit). Home had square club blocks and a square champion photo beside rounded
 *  gallery, Watch and Reading thumbnails, three shapes for one kind of thing. Radius stays for
 *  controls and sheets. */
export const MEDIA_RADIUS = RADIUS.none

/** The display face, for scores, the one big number on a card, and page titles. Never a player's
 *  name: the name fits (names.ts) are measured in Inter. styles.css has the why. */
export const DISPLAY_FONT = '"Barlow Condensed", Inter, system-ui, -apple-system, "Segoe UI", sans-serif'

/** The agate, for figures in print: a stat line, a leader's value, the count or date in a section's
 *  heading row. Inter's tabular figures since Nov 4, 2026: it was Barlow Semi Condensed, a third
 *  sans that read as the display face at small sizes, and with a serif for headlines the page would
 *  have had four faces. Now each face has one job: Barlow Condensed for scores and section headings,
 *  Newsreader for headlines, Inter for the rest. Spread `AGATE_SX` rather than this alone, so the
 *  figures are always tabular. */
export const AGATE_FONT = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif'

/** The headline face (styles.css has the why). Never a player's name: names.ts measures Inter. */
export const HEADLINE_FONT = '"Newsreader", Georgia, "Times New Roman", serif'
/** A headline: the lead's club name. A touch of negative tracking, since a serif at 56px spaces
 *  itself for text sizes. */
export const HEADLINE_SX = { fontFamily: HEADLINE_FONT, fontWeight: 600, letterSpacing: '-0.01em' } as const
/** A title: an article's or a video's, in the headline face at text size. */
export const TITLE_SX = { fontFamily: HEADLINE_FONT, fontWeight: 600 } as const
/** A title's size: a serif reads about a tenth smaller than Inter at the same size, so a title takes
 *  this step up to sit level with the Inter beside it. */
export const titleSize = (size: string) => `calc(${size} * 1.12)`
export const AGATE_SX = { fontFamily: AGATE_FONT, fontWeight: 600, fontVariantNumeric: 'tabular-nums', letterSpacing: 0 } as const

/** Read, not drawn (the same recipe as ui/heading.tsx's VISUALLY_HIDDEN, which imports this file). */
const HEADING_HIDDEN_SX = {
  position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clipPath: 'inset(50%)',
  padding: 0, margin: '-1px', border: 0, whiteSpace: 'nowrap',
} as const

/** A section's heading, in the display face (Nov 3, 2026). With no box around a section, its heading
 *  is what marks it, and 15px Inter beside a condensed page title read as two voices. One size up
 *  (`display`) because a condensed face at the same size reads smaller. Hand-drawn headers that
 *  imitate a section (the followed players' list, the loading copies) spread this too.
 *
 *  In capitals under a heavy rule (SECTION_RULE), the way a sports page heads a column: in title case
 *  under a hairline it was one more app list header. A third role for caps beside stat-table heads and
 *  the champion eyebrows. CSS caps, so the text a screen reader gets is still title case. */
export const SECTION_HEADING_SX = {
  fontFamily: DISPLAY_FONT, fontSize: TYPE_SCALE.display, fontWeight: 700, lineHeight: 1.2,
  textTransform: 'uppercase', letterSpacing: '0.04em',
} as const

/** The rule on top of a section: 2px in the text color, the column rule of a sports page. A hairline
 *  in `divider` gave every section the same quiet edge, so the page read as one long list. */
export const SECTION_RULE = { borderTop: '2px solid', borderTopColor: 'text.primary' } as const

/** THE SECOND TIER (Nov 4, 2026, ROADMAP-UI.md's audit): every section on the offseason Home wore the
 *  same caps heading under the same heavy rule, so below the lead nothing outranked anything and the
 *  page read as nine equal widgets. A page marks the sections that are browsing rather than news
 *  (the gallery, Reading, Watch, the award results) by wrapping them in `MinorSections`: a hairline
 *  and a smaller heading. Context rather than a prop, because those cards are built in
 *  five files that should not each learn where Home puts them. */
const MinorSectionContext = React.createContext(false)
export function MinorSections({ children }: { children: React.ReactNode }) {
  return <MinorSectionContext.Provider value>{children}</MinorSectionContext.Provider>
}
/** The minor tier's heading: the same capitals as the news tier, a size smaller. In title case
 *  (until Nov 4, 2026) the two tiers read as two typefaces rather than two ranks, since the case
 *  changed as well as the size; now size and the rule's weight alone say which is which. Exported
 *  for a hand-drawn header in the minor tier (the Discord row). */
export const MINOR_HEADING_SX = {
  fontFamily: DISPLAY_FONT, fontSize: TYPE_SCALE.heading, fontWeight: 700, lineHeight: 1.2,
  textTransform: 'uppercase', letterSpacing: '0.04em',
} as const
export const MINOR_RULE = { borderTop: '1px solid', borderTopColor: 'divider' } as const
/** The rule and heading size of the tier a section is drawn in, for a loading copy that has to take
 *  the loaded section's exact box (a 2px rule and a `display` heading are a few px taller). */
export function useSectionTier() {
  const minor = React.useContext(MinorSectionContext)
  return minor
    ? { rule: MINOR_RULE, headingType: { fontSize: TYPE_SCALE.heading, lineHeight: 1.2 } }
    : { rule: SECTION_RULE, headingType: { fontSize: TYPE_SCALE.display, lineHeight: 1.2 } }
}

/** A section heading row's plain facts (a count, a date, a range), in the agate face. */
const HEADER_ACTION_SX = { '&, & .MuiTypography-root': { fontFamily: AGATE_FONT, fontVariantNumeric: 'tabular-nums' } } as const

export const TAB_TITLE_SX = {
  fontSize: { xs: TYPE_SCALE.heading, md: TYPE_SCALE.page },
  fontFamily: DISPLAY_FONT, fontWeight: 700, letterSpacing: 0, lineHeight: 1.15,
} as const

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

export function SectionCard({ id, title, titleAdornment, subtitle, action, actionWraps, collapsed, onToggleCollapse, fill, bare, frameless, framed, titleLink, headingHidden, children }: {
  /** An anchor a page can be asked to scroll to (lib/sectionScroll.ts). */
  id?: string
  title: string
  /** Something small on the title's own line, after it: an info tip. Outside the `h2`, so a
   *  screen reader skimming headings hears the title and nothing else. */
  titleAdornment?: React.ReactNode
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
   *  are both drawn that way already, and in dark mode `background.paper` is a lifted gray, so
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
  /** The heading as the way to more of the same: the full board, the whole gallery, every result.
   *  Spread onto the title: `linkPress(href, onOpen)` for a page, `pressable(fn)` for a sheet. Since
   *  Nov 3, 2026 a "See all ›" in the action slot is this instead: one accent link on every header
   *  was the most repeated thing on the site (ROADMAP-UI.md, the audit). Not an accent chevron on the
   *  title, which was the same tic moved up a line; a › in the heading's own ink (Nov 4, 2026), since
   *  with nothing at all a linked heading looked exactly like a plain one, and a phone has no hover to
   *  find out. The action slot keeps a verb that goes somewhere ELSE ("Choose a team") and a fact
   *  ("147 photos"). */
  titleLink?: Record<string, unknown>
  /** Keep the `h2` for a screen reader's heading list and draw nothing: for a lead whose own band
   *  already says what it is ("2026 WPBL Champions"), where a section label over it was a second
   *  headline. Drops the rule on top too, since the lead's band brings its own edge. */
  headingHidden?: boolean
  /** Draw the old outlined box. For a card that is ONE thing a reader taps or reads as an object,
   *  never for a list, a table or prose. Off by default; see the section note below. */
  framed?: boolean
  children: React.ReactNode
}) {
  const collapsible = !!onToggleCollapse
  const minor = React.useContext(MinorSectionContext)
  const headingSx = minor ? MINOR_HEADING_SX : SECTION_HEADING_SX
  const heading = titleLink ? (
    <Box component="span" {...titleLink} sx={{
      color: 'inherit', textDecoration: 'none', cursor: 'pointer', borderRadius: 1, ...FOCUS_RING,
      // A tap target taller than the 15px of type, reaching into the header's padding, without
      // making the header any taller.
      position: 'relative', '&::after': { content: '""', position: 'absolute', inset: '-12px 0' },
      ...hoverOnly({ textDecoration: 'underline' }),
    }}>
      {titleCase(title)}
      <Box component="span" aria-hidden sx={{ ml: '0.3em' }}>›</Box>
    </Box>
  ) : titleCase(title)
  // A SECTION, NOT A CARD, by default (Nov 3, 2026, ROADMAP-UI.md's audit, option B). Every module
  // on the site was the same outlined box in a grid, which is what made it read as generated. A
  // read-only grouping now has no border, no fill and no corners: its heading, the space around it
  // and one rule above it are the grouping. Not a lift either: in dark mode a lighter surface means
  // "this floats" (ThemeContext.tsx, v1.157.0), so fills stay for sheets and menus. Nothing here is
  // a control, so dropping the edge drops no 3:1 boundary (src/CLAUDE.md, "Borders"). The padding
  // stays, so a body that bleeds a row or a band to the old edge with negative margins still lands
  // inside the section and nothing moves.
  const section = !framed
  return (
    <Box id={id} sx={[section ? {
      scrollMarginTop: id ? 'calc(var(--app-header-h, 0px) + 8px)' : undefined,
      overflow: 'hidden',
      // The one rule, on top only: the heavy SECTION_RULE, or the minor tier's `divider` hairline.
      ...(headingHidden ? null : minor ? MINOR_RULE : SECTION_RULE),
      ...(fill ? { display: 'flex', flexDirection: 'column' } : {}),
    } : {
      // Lands below the pinned toolbar when scrolled to, rather than under it.
      scrollMarginTop: id ? 'calc(var(--app-header-h, 0px) + 8px)' : undefined,
      borderRadius: frameless ? { xs: 0, sm: 3 } : 3, overflow: 'hidden',
      borderStyle: 'solid', borderColor: CARD_BORDER,
      borderWidth: frameless ? { xs: 0, sm: '1px' } : '1px',
      bgcolor: bare ? 'transparent' : CARD_FILL,
      // No `height: 100%` here. A grid item already stretches to its row, so this would only
      // ever be redundant there, and below md, where the container falls back to a flex
      // column, a percentage height resolves against the column's own height and makes every
      // card in it the same size, squashing the shorter ones on a phone.
      ...(fill ? { display: 'flex', flexDirection: 'column' } : {}),
    }]}>
      {/* The whole header toggles: a thumb-sized target rather than a small chevron hitbox.
          `action` keeps its own click (e.g. "View all"), so it stops the event bubbling. */}
      <Box
        {...pressable(collapsible ? onToggleCollapse : undefined)}
        aria-expanded={collapsible ? !collapsed : undefined}
        sx={headingHidden ? HEADING_HIDDEN_SX : {
          px: frameless ? { xs: 0, sm: 2 } : 2, pt: 1.25, pb: collapsed ? 1.25 : 1,
          display: 'flex', alignItems: 'center', gap: 1,
          ...(collapsible ? { cursor: 'pointer', userSelect: 'none', ...TAPPABLE } : {}),
        }}
      >
        <Box sx={actionWraps ? { flexShrink: 0 } : { flex: 1, minWidth: 0 }}>
          {/* A REAL `h2`. Every card title on every WPBL page comes through here, and as plain text
              a screen reader would land on the `h1` and then have no way to skim the page, since
              heading navigation is what skimming IS without sight. MUI's Typography sets
              `margin: 0` on its root, and the size and weight are set here rather than inherited
              from a variant, so the tag moves nothing on screen. The level is fixed at 2 on
              purpose: every consumer is a top-level section of a page that owns the `h1`, and a
              prop for it would only invite a card to lie. */}
          {titleAdornment != null ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
              <Typography component="h2" sx={{ ...headingSx, minWidth: 0 }}>{heading}</Typography>
              {titleAdornment}
            </Box>
          ) : (
            <Typography component="h2" sx={headingSx}>{heading}</Typography>
          )}
          {subtitle && <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.3 }}>{subtitle}</Typography>}
        </Box>
        {action != null && (
          // A BARRIER, NOT A CONTROL: the header toggles the card, and a click or an Enter on the
          // action inside it (a "View all" link) must not reach the header and toggle it as well.
          // eslint-disable-next-line jsx-a11y/no-static-element-interactions
          <Box
            onClick={e => e.stopPropagation()}
            onKeyDown={e => e.stopPropagation()}
            sx={{ ...HEADER_ACTION_SX, display: 'flex', ...(actionWraps ? { flex: 1, minWidth: 0, justifyContent: 'flex-end' } : { flexShrink: 0 }) }}
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
 * Text that has not arrived, drawn as skeleton bars in the exact room the text will take.
 *
 * For the loading states (CLAUDE.md: the loaded page drawn empty). A `<Skeleton>` is one bar of a
 * width someone guessed, so a sentence that wraps to three lines on a phone and one on a desktop
 * can only be reserved by guessing the line count per breakpoint. This sets a representative
 * string in the real element, transparent, so it wraps where the real text will and every line
 * gets its own bar (`box-decoration-break: clone`). `hidden` keeps the room and draws no bar, for
 * a number inside a sentence that is otherwise already real.
 */
export function TextGhost({ children, hidden }: { children: React.ReactNode; hidden?: boolean }) {
  return (
    <Box component="span" aria-hidden sx={{
      color: 'transparent', userSelect: 'none', pointerEvents: 'none',
      ...(hidden ? { visibility: 'hidden' } : {
        bgcolor: 'action.hover', borderRadius: 1,
        boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone',
      }),
    }}>{children}</Box>
  )
}

/**
 * Small uppercase eyebrow over a block inside a card. Both sections had a copy of this, word for
 * word, until Oct 9, 2026; one definition so the two cannot drift into two eyebrows.
 */
export function SectionLabel({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <Typography sx={{
      fontSize: strong ? TYPE_SCALE.body : TYPE_SCALE.caption,
      fontWeight: strong ? 800 : 700,
      color: strong ? 'text.primary' : 'text.disabled', mb: 1,
    }}>
      {children}
    </Typography>
  )
}

/**
 * The link in a `SectionCard`'s action slot: "All 15", "Compare teams". Plain accent text, never a
 * pill. MLB's cards had a bordered "View All →" pill and an expand icon for the same job, which put
 * two controls on Home that looked like buttons beside WPBL's one that reads as a link.
 *
 * `href` makes it a real anchor when what it opens has an address (a tab, a page), so a crawler can
 * follow it and a reader can open it in a new tab. A link that opens a sheet has no address and
 * stays a button.
 */
export function CardLink({ label, onClick, href, disabled }: {
  label: string
  onClick: () => void
  href?: string
  /** Drawn in the secondary ink while there is nothing to open yet (Predictions before its games load). */
  disabled?: boolean
}) {
  return (
    <Typography
      {...(href ? linkPress(href, onClick) : pressable(onClick))}
      sx={{
        ...FOCUS_RING,
        fontSize: TYPE_SCALE.meta, fontWeight: 700, color: disabled ? 'text.secondary' : 'var(--wpbl-accent-fg)', cursor: disabled ? 'default' : 'pointer',
        py: 0.5, px: 0.5, whiteSpace: 'nowrap', borderRadius: 1, textDecoration: 'none',
        '&:hover': { textDecoration: 'underline' },
      }}
    >
      {/* One look for every header link on the site (Oct 21, 2026): the site blue and a ›, added
          here so no caller can leave it off or pick a club color instead. */}
      {label.replace(/\s*[›→]$/, '')}<span aria-hidden> ›</span>
    </Typography>
  )
}

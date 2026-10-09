// The card every page in both sections is built from, the surfaces it paints, and the type scale.
// WPBL built these; they moved here on Oct 9, 2026 so MLB could draw with them (the second
// alignment pass in ROADMAP.md). The CSS variables keep their `--wpbl-` names: they are set by
// pages and read here, and renaming them is a sweep of its own with nothing to show for it.

import React from 'react'
import { Box, Typography } from '@mui/material'
import type { Theme } from '@mui/material'
import { TAPPABLE, FOCUS_RING, pressable, linkPress } from './interaction'
import { typePx } from './scale'

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

export function SectionCard({ icon, title, titleAdornment, subtitle, action, actionWraps, collapsed, onToggleCollapse, fill, bare, frameless, children }: {
  icon?: React.ReactNode
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
          {titleAdornment != null ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
              <Typography component="h2" sx={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.2, minWidth: 0 }}>{title}</Typography>
              {titleAdornment}
            </Box>
          ) : (
            <Typography component="h2" sx={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.2 }}>{title}</Typography>
          )}
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
      fontSize: strong ? '0.78rem' : '0.63rem',
      fontWeight: strong ? 800 : 700,
      textTransform: 'uppercase', letterSpacing: typePx(1.8),
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
export function CardLink({ label, onClick, href, color = 'var(--wpbl-accent-fg)' }: {
  label: string
  onClick: () => void
  href?: string
  color?: string
}) {
  return (
    <Typography
      {...(href ? linkPress(href, onClick) : pressable(onClick))}
      sx={{
        ...FOCUS_RING,
        fontSize: TYPE_SCALE.meta, fontWeight: 700, color, cursor: 'pointer',
        py: 0.5, px: 0.5, whiteSpace: 'nowrap', borderRadius: 1, textDecoration: 'none',
        '&:hover': { textDecoration: 'underline' },
      }}
    >
      {label}
    </Typography>
  )
}

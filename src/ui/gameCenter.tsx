import React from 'react'
import { Box, Typography } from '@mui/material'
import { FOCUS_RING, hoverOnly, pressable } from './interaction'
import { chromePx, typePx } from './scale'

// GAME CENTER'S DRAWING, SHARED (Oct 2026). Both sections already shared the panel and page frames,
// but the box score and the play log inside them were two products: MLB's tables right-aligned in
// small type under a grey club band, WPBL's centred with muted zeros, a pinned name column and a
// totals row; MLB's plays as tinted cards, WPBL's as a ruled column with the bases and outs at the
// end of each row. These are WPBL's, moved here, and each section feeds them its own data. What a
// row SAYS stays with the section (WPBL parses the league's sentences, MLB reads StatsAPI's), so
// nothing here knows which league it is drawing.

// ─── The box score ─────────────────────────────────────────────────────────────

export interface BoxCol {
  key: string
  label: string
  /** The column a reader scans first (H for batters, IP for pitchers). */
  bold?: boolean
  /** Width floor in px outside dense mode. */
  w?: number
}

export interface BoxRow {
  key: string | number
  name: string
  /** Spread onto the name: a section's own player link (`{ component: 'a', href, onClick }`). */
  nameProps?: Record<string, unknown>
  /** After the name: the position, or a pitcher's decision. */
  suffix?: React.ReactNode
  /** A substitute, indented under the starter whose slot it took. */
  isSub?: boolean
  /** One per column; null draws the dash a missing value is. */
  cells: (number | string | null)[]
}

/**
 * Cap for the shrink-to-fit name column, IN REM, because it is reserving room for a name: a px
 * cap around type sized in rem clips surnames the moment the reader's text grows. Ten was set
 * against WPBL's whole roster (the median name needs 149px at the desktop ramp, the 90th
 * percentile 183, the longest 248; 10rem is 200px there), and an MLB name is no longer.
 */
const NAME_W = '10rem'
// The name column is pinned (sticky-left) so scrolling right moves only the stat columns. An
// opaque fill and a right rule keep it legible over the cells sliding underneath.
const stickyName = { position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper', borderRight: '1px solid', borderRightColor: 'divider' } as const
const nameHeadSx = { ...stickyName, width: '1%', maxWidth: NAME_W, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.6rem', fontWeight: 700, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: typePx(0.4), px: 0.4, py: 0.4 } as const
const nameCellSx = { ...stickyName, width: '1%', maxWidth: NAME_W, whiteSpace: 'nowrap', textAlign: 'left', px: 0.4, py: 0.45 } as const
// A real <table> so the columns align themselves and fill the width: the name column shrinks to
// fit and the stat columns split what is left, rather than hugging one edge.
const tableSx = { tableLayout: 'auto', borderCollapse: 'collapse', width: '100%', minWidth: 0, fontVariantNumeric: 'tabular-nums' } as const
// DENSITY RATHER THAN DROPPED COLUMNS on a phone: dropping 2B and SB would hide the two things a
// reader most often opens a box score for there, and a sideways-scrolling pitching line can only
// be read by swiping. Fixed layout divides the width; every column shows on every screen.
// `table-layout: fixed` makes it structural rather than a tuned guess: the name column takes a
// declared share, the stats split the rest, and the table can never be wider than its space.
const denseTableSx = { ...tableSx, tableLayout: 'fixed' } as const
// Sized against the longest name once abbreviated ("T. Geldenhuis") plus the position; a section
// shortens its names to fit (WPBL's BOX_NAME_MAX, MLB's boxName) and a longer one ellipsizes.
const denseNameSx = { width: '35%', maxWidth: 'none', px: 0.3 } as const

function StatHead({ children, w = 30, dense = false }: { children: React.ReactNode; w?: number; dense?: boolean }) {
  return (
    <Box component="th" sx={{
      fontSize: dense ? '0.55rem' : '0.64rem', fontWeight: 700, color: 'text.disabled',
      textTransform: 'uppercase', letterSpacing: dense ? typePx(0.1) : typePx(0.4),
      textAlign: 'center', px: dense ? 0.1 : 0.4, py: 0.4,
      // No floor in dense mode: fixed layout is doing the dividing, and a minWidth would let the
      // columns add up to more than the table is allowed to be.
      minWidth: dense ? 0 : w,
    }}>
      {children}
    </Box>
  )
}

function StatCell({ children, bold = false, dense = false }: { children: React.ReactNode; bold?: boolean; dense?: boolean }) {
  // A box score is mostly zeros; muting them (and dropping the bold on a 0) lets the real numbers
  // carry the eye instead of a wall of even-weight digits.
  const isZero = children === 0 || children === '0'
  return (
    <Box component="td" sx={{
      fontSize: dense ? '0.76rem' : '0.9rem', fontWeight: isZero ? 500 : bold ? 800 : 600,
      color: isZero ? 'text.disabled' : 'text.primary',
      textAlign: 'center', px: dense ? 0.1 : 0.4, py: dense ? 0.4 : 0.45,
      lineHeight: 1.2, fontVariantNumeric: 'tabular-nums',
    }}>
      {children}
    </Box>
  )
}

/** A position after a batter's name, or a decision after a pitcher's. */
export const BOX_POS_SX = { fontSize: '0.6rem', color: 'text.disabled', lineHeight: 1, flexShrink: 0, textTransform: 'uppercase' } as const

/**
 * One table of a box score: a club's batters or its pitchers, with a totals row under a rule in
 * the club's colour. Every column is the caller's; this only draws them.
 */
export function BoxTable({ head, cols, rows, totals, rule, dense, hoverColor }: {
  /** The name column's heading: "Batting", "Pitching". */
  head: string
  cols: BoxCol[]
  rows: BoxRow[]
  /** The totals row, one per column, or none. */
  totals?: (number | string | null)[]
  /** The club's colour, for the rule over the totals. */
  rule: string
  /** The phone's fitted table. */
  dense: boolean
  hoverColor?: string
}) {
  const nameCell = (r: BoxRow) => {
    const clickable = !!r.nameProps && 'href' in r.nameProps
    return (
      <Box component="td" sx={{ ...nameCellSx, ...(dense ? denseNameSx : {}), pl: r.isSub ? (dense ? 1.1 : 1.75) : (dense ? 0.3 : 0.4) }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, overflow: 'hidden' }}>
          {/* The ↳ marker is desktop-only. On a phone it and its gap cost about fourteen pixels of
              a hundred-pixel column, which is the difference between reading "S. Robinson" and
              "S. Robi…". The indent alone still reads as a substitute, as a printed box does. */}
          {r.isSub && !dense && <Box component="span" aria-hidden sx={{ color: 'text.disabled', fontSize: '0.72rem', flexShrink: 0, lineHeight: 1 }}>↳</Box>}
          <Typography
            component="span"
            {...(r.nameProps ?? {})}
            sx={{
              fontSize: dense ? '0.74rem' : '0.86rem', fontWeight: 600, lineHeight: 1.2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              textDecoration: 'none', color: 'inherit',
              ...(clickable ? { ...FOCUS_RING, cursor: 'pointer', ...hoverOnly({ color: hoverColor ?? 'primary.main' }) } : {}),
            }}
          >
            {r.name}
          </Typography>
          {r.suffix}
        </Box>
      </Box>
    )
  }
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box component="table" sx={dense ? denseTableSx : tableSx}>
        <Box component="thead">
          <Box component="tr">
            <Box component="th" sx={{ ...nameHeadSx, ...(dense ? denseNameSx : {}) }}>{head}</Box>
            {cols.map(c => <StatHead key={c.key} w={c.w} dense={dense}>{c.label}</StatHead>)}
          </Box>
        </Box>
        <Box component="tbody">
          {rows.map(r => (
            <Box component="tr" key={r.key} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
              {nameCell(r)}
              {r.cells.map((v, i) => <StatCell key={cols[i]?.key ?? i} dense={dense} bold={cols[i]?.bold}>{v ?? '—'}</StatCell>)}
            </Box>
          ))}
          {totals && (
            <Box component="tr" sx={{ borderTop: '2px solid', borderColor: rule }}>
              <Box component="td" sx={{ ...nameHeadSx, ...(dense ? denseNameSx : {}), color: 'text.secondary', fontSize: dense ? '0.72rem' : '0.8rem', fontWeight: 800, textTransform: 'none', letterSpacing: 0 }}>Totals</Box>
              {totals.map((v, i) => <StatCell key={cols[i]?.key ?? i} dense={dense} bold>{v ?? '—'}</StatCell>)}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  )
}

/** A club's name over its half of the box score, where both clubs are drawn abreast. */
export function BoxTeamHeading({ badge, name, color }: { badge: React.ReactNode; name: string; color: string }) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 0.75, pb: 0.75, mb: 0.75,
      borderBottom: '2px solid', borderColor: color,
    }}>
      {badge}
      <Typography sx={{ fontSize: '0.94rem', fontWeight: 800, whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {name}
      </Typography>
    </Box>
  )
}

export interface BoxSwitchTeam {
  badge: React.ReactNode
  /** The full name, where there is room. */
  name: string
  /** The short one, so the two tabs share a line on a phone. */
  short: string
  color: string
}

/** Which club's box score, below the width that draws both: underline tabs in each club's colour,
 *  deliberately not the pill the page's own tabs are. */
export function BoxTeamSwitch({ away, home, value, onChange, dense }: {
  away: BoxSwitchTeam; home: BoxSwitchTeam
  value: 'away' | 'home'; onChange: (v: 'away' | 'home') => void
  dense: boolean
}) {
  const tab = (side: 'away' | 'home', t: BoxSwitchTeam) => {
    const active = value === side
    return (
      <Box
        {...pressable(() => onChange(side))}
        aria-pressed={active}
        sx={{
          ...FOCUS_RING,
          display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'pointer', userSelect: 'none',
          px: 0.25, pb: 0.75, mb: '-1px', borderBottom: '2px solid',
          borderColor: active ? t.color : 'transparent',
          opacity: active ? 1 : 0.5, transition: 'opacity 0.15s',
          ...hoverOnly({ opacity: active ? 1 : 0.8 }),
        }}
      >
        {t.badge}
        <Typography sx={{ fontSize: dense ? '0.9rem' : '0.94rem', fontWeight: active ? 800 : 600, whiteSpace: 'nowrap' }}>
          {dense ? t.short : t.name}
        </Typography>
      </Box>
    )
  }
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', gap: { xs: 2.5, sm: 3 }, borderBottom: '1px solid', borderColor: 'divider', mb: 0.75 }}>
      {tab('away', away)}
      {tab('home', home)}
    </Box>
  )
}

// ─── The play log ──────────────────────────────────────────────────────────────

/** The green a run is drawn in, on the rail, the tint and the +N. */
export const RUN_GREEN = '#16a34a'

/**
 * A half-inning's heading: the chevron that opens it, the batting club, the inning, and on the
 * right the runs it produced and the score after it. The runs alone are the delta and never the
 * state, so the score rides with them. Away first, matching the line score above.
 */
export function HalfHeading({ open, onToggle, badge, label, runs, awayTo, homeTo, scoreLabel }: {
  open: boolean
  onToggle: () => void
  badge?: React.ReactNode
  /** "Top 1st · NY · vs Pitcher", drawn in caps. Gives way before the score does. */
  label: string
  runs: number
  awayTo: number
  homeTo: number
  /** The score spelled out for a screen reader: "NY 3, SF 1 after this half-inning". */
  scoreLabel: string
}) {
  return (
    <Box
      {...pressable(onToggle)}
      aria-expanded={open}
      sx={{
        ...FOCUS_RING,
        display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'pointer', userSelect: 'none',
        position: 'sticky', top: 0, bgcolor: 'background.paper', py: 0.5, zIndex: 1,
        borderBottom: '1px solid', borderColor: 'divider',
        ...hoverOnly({ '& .pbpChevron': { color: 'text.secondary' } }),
      }}
    >
      <Box className="pbpChevron" aria-hidden sx={{
        fontSize: '0.6rem', color: 'text.disabled', width: '0.75rem', flexShrink: 0,
        transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'none',
      }}>▶</Box>
      {badge}
      {/* The label gives way, not the score: the reader's Large text setting multiplies every rem
          on this row, and the number is what the row exists to show. */}
      <Typography noWrap sx={{ minWidth: 0, fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: typePx(1), color: 'text.secondary' }}>
        {label}
      </Typography>
      <Box component="span" sx={{ ml: 'auto', display: 'inline-flex', alignItems: 'baseline', gap: 0.6, flexShrink: 0 }}>
        {runs > 0 && (
          <Box component="span" sx={{ fontSize: '0.62rem', fontWeight: 800, color: RUN_GREEN }}>+{runs}</Box>
        )}
        <Box component="span" aria-label={scoreLabel} sx={{
          fontSize: '0.68rem', fontWeight: 700, color: 'text.disabled', fontVariantNumeric: 'tabular-nums',
        }}>{awayTo}–{homeTo}</Box>
      </Box>
    </Box>
  )
}

/**
 * One play: a rail down the left (green, over a faint wash, when it scored), the account, and a
 * column at the right for whatever the section has to set against it (the count, the pitches, the
 * bases and outs it left). `id` makes it a link target; the `#` beside it is the link.
 */
export function PlayRow({ id, scored, flashed, children, aside, linkLabel }: {
  id?: string
  scored: boolean
  flashed?: boolean
  children: React.ReactNode
  aside?: React.ReactNode
  /** Present to draw the `#` link to this play. */
  linkLabel?: string
}) {
  return (
    <Box id={id} sx={{
      display: 'flex', gap: 1, py: 0.6, pl: 1, borderLeft: '2px solid',
      borderColor: scored ? '#22c55e' : 'divider',
      bgcolor: scored ? 'rgba(34,197,94,0.06)' : 'transparent',
      // Where a link lands: loud for a moment and then gone. Only ever fades, so reduced motion is
      // respected without asking.
      ...(flashed ? {
        outline: '2px solid', outlineColor: 'primary.main', borderRadius: 1,
        transition: 'outline-color 0.8s ease-out',
      } : {}),
      ...hoverOnly({ '& .playLink': { opacity: 1 } }),
    }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
      {aside}
      {/* Reserves its space on every device rather than appearing on hover: a column that widens
          under the pointer pushes the glyphs beside it left on the row being read. */}
      {id && linkLabel && (
        <Box
          component="a"
          href={`#${id}`}
          className="playLink"
          aria-label={linkLabel}
          sx={{
            ...FOCUS_RING,
            flexShrink: 0, alignSelf: 'flex-start', lineHeight: 1.6,
            fontSize: '0.66rem', fontWeight: 700, textDecoration: 'none',
            color: 'text.disabled', opacity: 0, transition: 'opacity 0.12s',
            '&:focus-visible': { opacity: 1 },
          }}
        >#</Box>
      )}
    </Box>
  )
}

/** The play's account, first line: who, in weight, then what. */
export const PLAY_TEXT_SX = { fontSize: '0.82rem', lineHeight: 1.35 } as const
/** The quieter second line: the runners, or the rest of the sentence. */
export const PLAY_DETAIL_SX = { fontSize: '0.72rem', lineHeight: 1.35, color: 'text.secondary', mt: 0.15 } as const
/** The count, in the column at the right so it lines up down the rows. */
export const PLAY_COUNT_SX = { fontSize: '0.66rem', fontWeight: 700, color: 'text.disabled', fontVariantNumeric: 'tabular-nums', lineHeight: 1.6 } as const
/** The bases and outs a play left, top-aligned so they hold a column whatever the text wrapped to. */
export const PLAY_STATE_SX = { flexShrink: 0, alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: chromePx(5) } as const

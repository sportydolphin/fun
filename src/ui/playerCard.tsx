// ─── Player card parts ───────────────────────────────────────────────────────────
//
// The pieces a player page is built from, shared by both sections since Oct 2026: the type scale,
// the season line and its rate strip, the game log (and every other per-row stat table), the club
// band and its form strip, and the section heading and show-more control they all sit under.
//
// They were written for WPBL's card first (src/wpbl/PlayerDetail.tsx, whose comments still carry
// most of the reasoning for each choice) and lifted out when the MLB player page was rebuilt on
// them, so a box score line reads the same way on both sides of the site. What differs between
// the leagues comes in through `StatCardContext`: what a header's tooltip says, the colour a good
// number is drawn in, and how high a rank has to be before it is printed.

import React, { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, Skeleton, Typography, type Theme } from '@mui/material'
import { ExpandMore } from '@mui/icons-material'
import { TapTip } from './TapTip'
import { TAPPABLE, hoverOnly } from './interaction'
import { chromePx } from './scale'
import { usePhoneLayout } from './ModalShell'

/** What a league supplies to the card parts. */
export interface StatCardEnv {
  /** The tooltip for a column header, or null for none. */
  tip: (label: string) => React.ReactNode
  /** The colour of a good number: a lit rank, a best game. Never the club's colour (see WPBL's
   *  `useRankInk` for why). */
  ink: string
  /** A rank at or above this is printed in a counting column and lit wherever it appears. */
  rankBar: number
}

export const StatCardContext = createContext<StatCardEnv>({ tip: () => null, ink: 'primary.main', rankBar: 5 })
export const useStatCard = () => useContext(StatCardContext)

/** A league position: `rank` of `of`. WPBL's WpblStatRank and MLB's own rank both satisfy it. */
export interface StatRank { rank: number; of: number }

export function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

/** The player modal sits at zIndex 1600; MUI's tooltip defaults to 1500, so it would
 *  render behind the modal. Lift the popper above it. */
export const TIP_Z = 1700

// ─── Section heading and show-more ───────────────────────────────────────────────
//
// ONE DEFINITION EACH, because the card grew them one block at a time. By Sep 28, 2026 it had
// five heading styles (three sizes, two weights, two greys), two show-more buttons (a centred
// uppercase one in the club's colour under the tables, a left-aligned grey sentence under the
// reading list), and a good rank drawn in the club's colour a few pixels above bars where blue
// meant "better than the league". Each was reasonable on its own; together they made a card of
// correct numbers read as confused.

/** A section's label: small, uppercase, secondary. The one heading style on the card. */
export const SECTION_LABEL_SX = {
  fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5,
  color: 'text.secondary',
} as const

/** What sits on a section's right: its sample, its scope, or how to use it. */
export const SECTION_CAPTION_SX = {
  fontSize: '0.6rem', fontWeight: 700, color: 'text.disabled', fontVariantNumeric: 'tabular-nums',
} as const

/**
 * A section heading: the label on the left and, optionally, a caption on the right.
 *
 * The caption wraps under the label rather than squeezing it when a phone has no room for both,
 * which is what `flexWrap` buys; a label is never ellipsised, since it is the only thing saying
 * what the numbers under it are.
 */
export function SectionHead({ title, caption, sx }: {
  title: React.ReactNode
  caption?: React.ReactNode
  sx?: object
}) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.25, mb: 1, ...sx,
    }}>
      <Typography sx={SECTION_LABEL_SX}>{title}</Typography>
      {caption != null && <Typography sx={{ ...SECTION_CAPTION_SX, textAlign: 'right' }}>{caption}</Typography>}
    </Box>
  )
}

/**
 * Show more / show fewer (or any disclosure) under a block. Centred, uppercase, full width, in
 * the colour the caller's controls use. The ONE such control on the card, so a reader learns it
 * once: the reading list used to have its own, left-aligned and grey, which read as a different
 * kind of thing.
 */
export function ShowMoreButton({ expanded, onClick, accent, children }: {
  /** Reported to assistive tech. Omit for a one-way control. */
  expanded?: boolean
  onClick: () => void
  accent: string
  children: React.ReactNode
}) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      sx={{
        width: '100%', mt: 0.5, py: 0.75, px: 1, border: 'none', borderRadius: 1,
        bgcolor: 'transparent', color: accent, cursor: 'pointer', font: 'inherit',
        fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5,
        ...TAPPABLE,
        ...hoverOnly({ bgcolor: 'action.hover' }),
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
      }}
    >
      {children}
    </Box>
  )
}

/**
 * THE CARD'S TYPE SCALE. Five steps, and every piece of type on the player card is one of them.
 *
 * Sizes within a hair of each other (0.56 / 0.58 / 0.60) cannot be read as different levels but
 * are far enough apart to look unconsidered, which is how a card where no single element is
 * wrong ends up feeling careless. So there are five, far enough apart to mean something.
 *
 * THE STEPS ARE ROLES, NOT SIZES, which is what keeps a new block from inventing a sixth:
 *
 *   HERO     the rate line: AVG OBP SLG OPS, or ERA WHIP K/7 K/BB, wherever it is drawn
 *   FIGURE   a season total, in the line under the rates
 *   BODY     a game's numbers, and any real sentence
 *   LABEL    uppercase furniture: section headings, buttons, the fielding label
 *   MICRO    what annotates a figure: column headers, ranks, captions, populations
 *
 * NO DISPLAY STEP OVER HERO. The rates are columns of one season line, so a larger size for the
 * headline stat (OPS, ERA) would put three sizes in a single row of numbers and a hierarchy the
 * row does not have. Which rate is doing well is already said by the rank under it and the
 * club's colour on it; size in that row carries one distinction only: a rate is not a count.
 *
 * WEIGHT IS PART OF THE STEP and not a free parameter. Anything uppercase is 800, because at
 * these sizes uppercase needs the weight to hold its counters; figures are 700; running text
 * and a game's cells are 600. There is no 400 on this card, and nothing is 800 for emphasis:
 * emphasis here is the club's colour, spent in the two places named in GameLogTable.
 */
export const CARD_TYPE = {
  hero: { fontSize: '1.35rem', fontWeight: 800, letterSpacing: '-0.02em' },
  figure: { fontSize: '0.95rem', fontWeight: 700 },
  body: { fontSize: { xs: '0.74rem', sm: '0.8rem' }, fontWeight: 600 },
  label: { fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 },
  micro: { fontSize: '0.6rem', fontWeight: 700 },
} as const
const TYPE = CARD_TYPE
const sectionSx = { ...TYPE.label, color: 'text.secondary', mb: 1 } as const

/**
 * The season's name, as the heading of the season line AND the control that changes it: a native
 * select laid invisibly over a pill, so it is the platform's own picker on a phone and keyboard
 * reachable everywhere.
 *
 * DRAWN AS A CONTROL, NOT AS A HEADING WITH A HINT. It began as the plain uppercase label with a
 * small triangle after it, and on a phone nobody read that as something to tap: a label is what
 * every other heading on the card looks like. So it is a filled pill with a real chevron, drawn as
 * the same chip as the Regular / Playoffs track beside it: same fill, no border, and the track's
 * exact height (its 28px pills plus 3px of padding each side), so the two sit on one line as a pair
 * of controls rather than as two shapes that happen to be near each other.
 *
 * A player with one season gets the plain label, with no pill promising a choice that is not
 * there. That is every WPBL player until the league plays a second year, so on that side this is
 * a heading today and a picker the day a 2027 line lands, with nothing to switch on.
 */
export function SeasonPicker<C extends boolean = false>({ label, season, seasons, career, onChange }: {
  label: string
  season: C extends true ? number | 'career' : number
  seasons: number[]
  /** Offer the whole career as a first option. Not for one season, where it is that season again. */
  career?: C
  onChange: (s: C extends true ? number | 'career' : number) => void
}) {
  if (seasons.length < 2) return <Typography sx={{ ...sectionSx, mb: 0 }}>{label}</Typography>
  return (
    <Box sx={{
      position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 0.25, flexShrink: 0,
      minHeight: PILL_TRACK_H, pl: 1.25, pr: 0.75, borderRadius: 999,
      bgcolor: 'action.hover',
      transition: 'background-color 0.15s',
      ...hoverOnly({ bgcolor: 'action.selected' }),
      '&:focus-within': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
    }}>
      <Typography sx={{ ...sectionSx, mb: 0, color: 'text.primary', whiteSpace: 'nowrap' }}>{label}</Typography>
      <ExpandMore aria-hidden sx={{ fontSize: '1.1rem', color: 'text.secondary' }} />
      <Box component="select" value={season} aria-label="Change season"
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
          const v = e.target.value
          onChange((v === 'career' ? v : Number(v)) as Parameters<typeof onChange>[0])
        }}
        sx={{ position: 'absolute', inset: 0, width: '100%', opacity: 0, cursor: 'pointer', font: 'inherit' }}>
        {career && <option value="career">Career</option>}
        {seasons.map(s => <option key={s} value={s}>{s}</option>)}
      </Box>
    </Box>
  )
}

/** PillGroup's track: its 28px pills, which take the chrome scale, and 3px of padding above and
 *  below, which does not. Summed the same way, or the two drift apart by a couple of px on a desktop. */
const PILL_TRACK_H = `calc(${chromePx(28)} + 6px)`

/**
 * The season line's caption: the season (the picker), how much of one, and the scope control.
 *
 * ONE ROW OF CONTROLS ON A PHONE, the facts under it. The sample used to sit under the picker in a
 * column of its own while the scope pills were centred against that whole column, so the two
 * controls missed each other by half a line and read as misaligned. Now the picker and the pills
 * share a row and a height, and the sample takes the full width beneath. On a desktop there is room
 * for all three on one line, the sample beside the season it describes.
 */
export function LineCaption({ picker, meta, control }: {
  picker: React.ReactNode
  meta?: React.ReactNode
  control?: React.ReactNode
}) {
  return (
    <Box sx={{
      display: 'grid', alignItems: 'center', columnGap: 1.25, rowGap: 0.5, mb: 1,
      gridTemplateColumns: control ? { xs: 'auto 1fr', md: 'auto 1fr auto' } : 'auto 1fr',
      gridTemplateAreas: control
        ? { xs: '"pick ctl" "meta meta"', md: '"pick meta ctl"' }
        : '"pick meta"',
    }}>
      <Box sx={{ gridArea: 'pick', minWidth: 0 }}>{picker}</Box>
      {meta != null && meta !== '' && (
        <Typography sx={{ gridArea: 'meta', ...TYPE.micro, color: 'text.disabled', fontVariantNumeric: 'tabular-nums', minWidth: 0 }}>
          {meta}
        </Typography>
      )}
      {control && <Box sx={{ gridArea: 'ctl', justifySelf: 'end' }}>{control}</Box>}
    </Box>
  )
}

/** A stat's own spelling where its case is part of its name: wOBA, wRC+ and xBA set in capitals
 *  read as different stats (WOBA, WRC+, XBA). Every all-capitals label is untouched. */
const keepCase = (label: string) => (/[a-z]/.test(label) ? { textTransform: 'none' } as const : {})

/** A counting stat that is actually zero, which the grid dims. Deliberately NOT falsy: `'—'`
 *  is absent rather than zero, and `.000` is a measured rate, not an empty box. */
export const isZeroStat = (v: string | number): boolean => v === 0 || v === '0'

/**
 * A figure not yet known, drawn as a bar the width of `sample`: the card's loading state passes
 * typical values ("00", ".000", "00.0") so every column, fold and row comes out the size the real
 * figures will make it. Inline and in the cell's own font, so the line box it sits in is exactly
 * the height the figure's will be.
 */
function FigureBar({ sample }: { sample: string | number }) {
  return <Skeleton variant="text" sx={{ display: 'inline-block', width: `${String(sample).length * 0.6 + 0.2}em` }} />
}

/**
 * How a zero is drawn, in the season line and every row table.
 *
 * A STEP BELOW `text.disabled`, not at it. That grey is also the game log's date column and every
 * header on the card, so a zero drawn in it read as furniture of the same weight as "Sep 13", and
 * on a phone the dimming simply did not register: an 0-for-3 and a two-hit night looked equally
 * busy. Opacity over the theme's grey rather than a colour of its own, so it follows light mode's
 * stronger grey (see ThemeContext) instead of undoing it.
 */
export const ZERO_SX = { color: 'text.disabled', opacity: 0.6 } as const

/**
 * THE SEASON LINE: a table, with a header row, read left to right.
 *
 * A table rather than a wrapping grid of labelled chips: the game log directly below runs
 * fourteen columns at 375px without clipping, so the season line can too, and a header row with
 * one value row takes half the height of two ragged rows of chips, stops repeating a label per
 * box, and is the shape every reader arrives already able to read.
 *
 * THE RANK ROW sits under the value it belongs to. A rank is a fact about one number, and drawn
 * anywhere else it makes a reader hold a figure in their head on the way to it.
 *
 * THE POPULATION IS NOT PRINTED. Every other rank on this site carries its field ("2nd of
 * 33"), and this row deliberately does not: it would be the same phrase under ten columns, or
 * a line of small print under the table repeating what the two rank fields are. What is left
 * is an ordinal in a cell, which is the form a stat table has used for a century. The rate
 * columns still carry "of N" (see the lead group) for the reader who wants the denominator.
 *
 * WHICH RANKS APPEAR IS THE PROJECT'S OWN MEASURED BAR: `bestCountingRanks` keeps a top-5 gate
 * against a field of at least ten, because lighting every top-3 lights cells on the few players a
 * reader can already place and nothing at all on most of the roster. That helper's two-row CAP
 * is dropped here, because it rations vertical space and a rank in a cell costs none. So a card
 * shows every rank worth printing, and a player who leads nothing gets no row at all instead of
 * a line of "34th · 41st · 28th" that reads as a verdict.
 */
export interface LineCol {
  label: string
  value: string | number
  /** The player's league position in this column, when there is one worth printing. */
  rank?: StatRank | null
  /** Where the rank goes when pressed: MLB opens the league table sorted by this stat with the
   *  player picked out. Without it the rank is plain text. */
  onRank?: () => void
  /** Starts a new row when the line is folded onto a phone: the rates, say, so ".275 .386" and
   *  ".516 .902" are never split across two rows. Ignored while the line fits on one. */
  breakBefore?: boolean
}

/**
 * THE LEAD GROUP: rate columns, set large, ahead of the counting line in the SAME table.
 *
 * Above `md` the four rates are these first columns rather than a block beside the table (see
 * desktopRoleBlock). They differ from a counting column in three ways and no others: the figure
 * is a step or two larger, the rank carries its population, and a heavier rule closes the group.
 * Everything that makes a table a table -- one header row, one figure row, one rank row, one
 * caption over all of it -- is shared, which is the entire point: there is no second grid left
 * to fall out of alignment with.
 *
 * IT IS FED THE SAME CELLS AS THE PHONE'S STRIP, from `rateCells`, so a rate cannot read one way
 * on a phone and another on a desktop. The phone passes no lead at all: seventeen columns do not
 * fit 375px, which is why the strip exists there.
 *
 * THE RANK KEEPS "of 33" HERE and the counting ranks stay bare, which looks like an
 * inconsistency and is a fact about the data: a rate rank is taken against the QUALIFIED field
 * and a counting rank against everyone who recorded the stat, so one population printed across
 * the whole row would be wrong for half of it. The group rule is what says these are two kinds
 * of column.
 */
export function SeasonLine({ cols, lead, headline, placeholder }: {
  cols: LineCol[]
  lead?: LineCol[]
  /** The labels the headline strip above already shows, which a phone leaves out of the line. */
  headline?: string[]
  /** The loading state: every value is a sample, drawn as a bar of its width. See FigureBar. */
  placeholder?: boolean
}) {
  const phone = usePhoneLayout()
  if (!phone) return <FullSeasonLine cols={cols} lead={lead} placeholder={placeholder} />
  const inHead = new Set(headline ?? [])
  // W and L are the headline's "W-L".
  const shown = cols.filter(c => !inHead.has(c.label) && !(inHead.has('W-L') && (c.label === 'W' || c.label === 'L')))
  return <CompactSeasonLine cols={shown} placeholder={placeholder} />
}

/**
 * THE LINE ON A PHONE: what the headline does not already say, edge to edge, in as few rows as fit.
 *
 * WHY IT IS NOT THE DESKTOP LINE FOLDED. Under the four-figure headline the full line folded into
 * three or four rows at 375px (a pitching line is seventeen columns, a hitter's up to twenty), so
 * the top of the card was five rows of numbers before the first game, and four of them were printed
 * twice: large in the headline and again a few rows down. So the headline's figures are left out
 * here (W and L with a "W-L"), and what remains runs the full width of the screen the way the game
 * log under it does: the table bleeds, and its first and last columns take the gutter back so no
 * figure sits on the edge of the glass. Above a phone the line is the whole standard line, as every
 * stat site prints it, because there it is one row and the repeat costs nothing.
 *
 * FOLDED AS ONE TABLE, NOT A TABLE PER ROW. Each column is as wide as the widest cell stacked in it
 * rather than every column as wide as the widest figure on the line, which is what lets a hitter's
 * sixteen columns fold into two rows rather than three, and keeps the rows' rules lined up.
 *
 * MEASURED, before paint: each cell's natural width is read off a one-row pass, and the line takes
 * the fewest rows whose stacked columns, plus the two gutters, fit the screen. Whether that is one
 * row or two depends on the digits and on the reader's text size, so a fixed count would be wrong
 * for somebody.
 */
function CompactSeasonLine({ cols, placeholder }: { cols: LineCol[]; placeholder?: boolean }) {
  const { tip, ink } = useStatCard()
  const boxRef = useRef<HTMLDivElement>(null)
  // Columns per row, or null for the one-row measuring pass.
  const [per, setPer] = useState<number | null>(null)
  const sig = cols.map(c => `${c.label}:${c.value}:${c.rank?.rank ?? ''}`).join('|')
  const [measuredFor, setMeasuredFor] = useState(sig)
  if (measuredFor !== sig) { setMeasuredFor(sig); setPer(null) }
  const measuredW = useRef(0)
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    if (per == null) {
      const widths = Array.from(box.querySelectorAll('th')).map(th => th.getBoundingClientRect().width)
      // The bleed's negative margin IS the gutter, in whatever px the chrome scale makes it.
      const gutter = Math.abs(parseFloat(getComputedStyle(box).marginLeft)) || 0
      const room = box.clientWidth
      measuredW.current = room
      const n = widths.length
      let choice = n
      for (let r = 1; r <= n; r++) {
        const p = Math.ceil(n / r)
        let total = 2 * gutter
        for (let j = 0; j < p; j++) {
          let w = 0
          for (let k = j; k < n; k += p) w = Math.max(w, widths[k])
          total += w
        }
        if (total <= room) { choice = p; break }
      }
      setPer(Math.max(1, choice))
      return
    }
    // A new width (a rotated phone, the panel at another chrome scale) measures again from one row.
    const ro = new ResizeObserver(() => {
      if (Math.abs(box.clientWidth - measuredW.current) > 1) setPer(null)
    })
    ro.observe(box)
    return () => ro.disconnect()
  }, [per, sig])

  const measuring = per == null
  const p = per ?? cols.length
  const rows: (LineCol | null)[][] = []
  for (let i = 0; i < cols.length; i += p) {
    const row: (LineCol | null)[] = cols.slice(i, i + p)
    while (row.length < p) row.push(null)
    rows.push(row)
  }
  // The gutter, on the outer columns only, once there is a layout to put it in. The measuring pass
  // has none, so what it reads is each cell's own width.
  const edge = (j: number) => (measuring ? {} : {
    ...(j === 0 ? { pl: 2 } : {}),
    ...(j === p - 1 ? { pr: 2 } : {}),
  })
  const rule = (row: (LineCol | null)[], j: number) => (row[j] && row[j + 1] ? colRuleSx(j, p) : {})

  return (
    <Box ref={boxRef} sx={{ mx: -2, overflowX: 'auto' }}>
      <Box component="table" sx={{
        width: measuring ? 'max-content' : '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums',
      }}>
        <Box component="tbody">
          {rows.map((row, k) => (
            <React.Fragment key={k}>
              <Box component="tr">
                {row.map((c, j) => c ? (
                  <TapTip key={c.label} title={tip(c.label)} component="th" popperZIndex={TIP_Z}
                    sx={{ ...lineThSx, ...COMPACT_CELL_SX, ...(k > 0 ? { pt: 1 } : {}), ...keepCase(c.label), ...rule(row, j), ...edge(j) }}>
                    {c.label}
                  </TapTip>
                ) : <Box component="th" key={`pad${j}`} sx={{ ...lineThSx, borderBottomColor: 'transparent', ...edge(j) }} />)}
              </Box>
              <Box component="tr">
                {row.map((c, j) => c ? (
                  // The desktop line's three states: a top-five figure lit, a true zero dimmed.
                  <Box component="td" key={c.label} sx={{
                    ...lineTdSx, ...COMPACT_CELL_SX, ...COMPACT_FIGURE_SX, ...rule(row, j), ...edge(j),
                    ...(placeholder ? {} : c.rank != null ? { color: ink, fontWeight: 800 } : isZeroStat(c.value) ? ZERO_SX : {}),
                  }}>
                    {placeholder ? <FigureBar sample={c.value} /> : c.value}
                  </Box>
                ) : <Box component="td" key={`pad${j}`} sx={edge(j)} />)}
              </Box>
              {row.some(c => c?.rank != null) && (
                <Box component="tr">
                  {row.map((c, j) => c ? (
                    <Box component="td" key={c.label}
                      sx={{ ...lineRankSx, ...COMPACT_CELL_SX, ...rule(row, j), ...edge(j), ...(c.rank != null && !placeholder ? { color: ink, fontWeight: 800 } : {}) }}>
                      {/* A placeholder's rank only holds the row open: see skeletonPane. */}
                      {placeholder ? ' ' : c.rank ? <RankText onRank={c.onRank} label={c.label}>{ordinal(c.rank.rank)}</RankText> : ''}
                    </Box>
                  ) : <Box component="td" key={`pad${j}`} sx={edge(j)} />)}
                </Box>
              )}
            </React.Fragment>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

/** The compact line's cells: a little less air than the desktop's, since the columns share the screen. */
const COMPACT_CELL_SX = { px: 0.4 } as const
/** A step under `figure`, so a pitching line fits the screen in one row. */
const COMPACT_FIGURE_SX = { fontSize: '0.85rem' } as const

function FullSeasonLine({ cols, lead, placeholder }: { cols: LineCol[]; lead?: LineCol[]; placeholder?: boolean }) {
  const { tip, ink, rankBar } = useStatCard()
  const heads = lead ?? []
  const all = [...heads, ...cols]
  const isLead = (i: number) => i < heads.length
  // Lit means "a top figure": bold, in the rank ink. A counting rank is pre-gated to the league's
  // bar by the caller, so its presence is the gate; a rate rank is drawn for every qualified
  // player, so it takes the shared bar explicitly. Same bar either way, one place to change it.
  const lit = (c: LineCol, i: number) => (isLead(i) ? isLitRank(c.rank, rankBar) : c.rank != null)

  /**
   * ONE ROW WHEN IT FITS, AS MANY AS IT TAKES WHEN IT DOES NOT. A standard batting line is sixteen
   * columns, and at 375px one row ran off the right edge mid-number with nothing to say it
   * scrolled: a phone's scrollbar only appears once a finger is already moving. So the line
   * measures its one-row width and folds into equal rows of equal columns.
   *
   * MEASURED, NOT A COLUMN COUNT: whether a line fits depends on the reader's text size and on the
   * digits in it (a pitcher's "2356" pitches), and a fixed count would fold lines that fit. Measured
   * in a layout effect, before paint, so the folded line is what is first drawn and nothing moves.
   * The one-row width is remembered, because a folded table cannot say how wide one row would be.
   */
  const boxRef = useRef<HTMLDivElement>(null)
  // Measured off the one-row table: its whole width, and its widest column, which is what an equal
  // column has to hold. Splitting the total width by the room was not enough: equal columns are as
  // wide as the WIDEST figure, so "130" and "448" ran into each other at ten to a row.
  const oneRowW = useRef(0)
  const widestCol = useRef(0)
  // How many columns a folded row holds, or null while the line fits on one row.
  const [fit, setFit] = useState<number | null>(null)
  // New figures (another season, another scope) are re-measured from one row, since the remembered
  // width belongs to the old ones. Reset during render, so the stale fold never paints.
  const sig = all.map(c => `${c.label}:${c.value}`).join('|')
  const [measuredFor, setMeasuredFor] = useState(sig)
  if (measuredFor !== sig) { setMeasuredFor(sig); setFit(null) }
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const check = () => {
      if (fit == null) {
        oneRowW.current = box.scrollWidth
        // The first and last cells carry the bleed's gutter as padding, so they are not a measure.
        const cells = Array.from(box.querySelectorAll('thead th')).slice(1, -1)
        widestCol.current = Math.max(0, ...cells.map(c => c.getBoundingClientRect().width))
      }
      const css = getComputedStyle(box)
      const room = box.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)
      if (room <= 0 || !oneRowW.current) return
      // A few px of air on the widest figure, since it sets every column in a folded grid.
      const next = oneRowW.current > box.clientWidth ? Math.max(2, Math.floor(room / (widestCol.current + 6))) : null
      if (next !== fit) setFit(next)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(box)
    return () => ro.disconnect()
  }, [fit, sig])
  const folded = fit != null
  // FOLDED BY GROUP, then into rows of equal columns. Each group (the counts, the rates, the
  // extras) starts a row of its own; the largest is split into rows as even as the width allows,
  // and that row length is every row's, short rows padded with empty cells, so the rows read as one
  // grid rather than as separate tables. Six counts a row and four rates under them, not seven and
  // a rate line broken after OBP.
  const groups: { start: number; cells: LineCol[] }[] = []
  all.forEach((c, i) => {
    if (i === 0 || (folded && c.breakBefore)) groups.push({ start: i, cells: [] })
    groups[groups.length - 1].cells.push(c)
  })
  const biggest = Math.max(...groups.map(g => g.cells.length))
  const per = folded ? Math.ceil(biggest / Math.ceil(biggest / fit!)) : all.length
  const rows: { start: number; cells: (LineCol | null)[] }[] = []
  for (const g of groups) {
    for (let i = 0; i < g.cells.length; i += per) {
      const cells: (LineCol | null)[] = g.cells.slice(i, i + per)
      while (folded && cells.length < per) cells.push(null)
      rows.push({ start: g.start + i, cells })
    }
  }

  const table = (row: (LineCol | null)[], offset: number, k: number) => {
    const n = row.length
    // The hairline between columns, and a 2px one closing the lead group: it is the only thing
    // besides size saying the two halves are different kinds of number. Not a tint down the group:
    // the header's own bottom rule cuts any background into pieces (see colRuleSx). No rule after
    // the last real cell of a padded half.
    const rule = (j: number) => {
      const i = offset + j
      if (i === heads.length - 1 && cols.length > 0) return { borderRight: '2px solid', borderRightColor: 'divider' }
      return row[j + 1] ? colRuleSx(j, n) : {}
    }
    const anyRank = row.some(c => c?.rank != null)
    return (
      <Box component="table" key={k} sx={{
        width: '100%', minWidth: folded ? 0 : 'max-content', borderCollapse: 'collapse',
        fontVariantNumeric: 'tabular-nums',
        ...(folded ? { tableLayout: 'fixed', mt: k > 0 ? 1 : 0 } : {}),
      }}>
        <Box component="thead">
          <Box component="tr">
            {row.map((c, j) => c ? (
              <TapTip key={c.label} title={tip(c.label)} component="th"
                popperZIndex={TIP_Z} sx={{ ...lineThSx, ...keepCase(c.label), ...rule(j) }}>{c.label}</TapTip>
            ) : <Box component="th" key={`pad${j}`} sx={{ ...lineThSx, borderBottomColor: 'transparent' }} />)}
          </Box>
        </Box>
        <Box component="tbody">
          <Box component="tr">
            {row.map((c, j) => c ? (
              // Three states, in order of precedence. A TOP-FIVE FIGURE is bold and in the rank
              // blue: the rank row under it already says so in words, and a reader scanning
              // a dozen identical white numbers should not have to find that out by reading.
              // Only the top five light up, which is `bestCountingRanks`' own measured bar, so
              // a card lights two or three cells rather than half a row. A true zero dims,
              // because half a batting line is zeros for most of the roster. A rate reading
              // `.000` is a measurement and keeps its weight. Everything else is plain.
              <Box component="td" key={c.label}
                sx={{
                  ...lineTdSx,
                  // ONE SIZE FOR THE WHOLE LEAD GROUP. A larger OPS or ERA would put three sizes in
                  // a single row of numbers and leave a reader working out what the third one meant.
                  // The rank under the cell and the rank blue already say which rate is doing
                  // well; size here only has to separate a rate from a count.
                  // `verticalAlign: baseline` is what makes the two remaining sizes read as one row:
                  // a large OPS and a 0.95rem at-bat total sit on the same line rather than being
                  // centred against each other.
                  ...(isLead(offset + j) ? { ...TYPE.hero, lineHeight: 1.2, pt: 0.5 } : {}),
                  verticalAlign: 'baseline',
                  ...rule(j),
                  ...(placeholder ? {} : lit(c, offset + j) ? { color: ink, fontWeight: 800 }
                    : isZeroStat(c.value) ? ZERO_SX : {}),
                }}>
                {placeholder ? <FigureBar sample={c.value} /> : c.value}
              </Box>
            ) : <Box component="td" key={`pad${j}`} />)}
          </Box>
          {anyRank && (
            <Box component="tr">
              {row.map((c, j) => c ? (
                // BLANK where there is no rank, not the em dash this project spends on "no
                // value" elsewhere. That glyph is right in a cell that could have held a
                // measurement; here two thirds of the row would be dashes, and a row that is
                // mostly punctuation reads as missing data rather than as an annotation.
                <Box component="td" key={c.label}
                  sx={{ ...lineRankSx, ...rule(j), ...(lit(c, offset + j) ? { color: ink, fontWeight: 800 } : {}) }}>
                  {placeholder ? ' ' : !c.rank ? '' : (
                    <RankText onRank={c.onRank} label={c.label}>
                      {isLead(offset + j) ? `${ordinal(c.rank.rank)} of ${c.rank.of}` : ordinal(c.rank.rank)}
                    </RankText>
                  )}
                </Box>
              ) : <Box component="td" key={`pad${j}`} />)}
            </Box>
          )}
        </Box>
      </Box>
    )
  }

  return (
    // Scrolls in its own container rather than the page, per the house rule for wide content. Only
    // a folded line at a very large text size can still need it.
    // Folded, the grid sits inside the pane's gutter like every other block (the bleed is for a
    // one-row table that may scroll to the screen's edge), so its equal columns are all the same
    // width rather than the first and last losing the gutter to padding.
    <Box ref={boxRef} sx={{ overflowX: 'auto', ...(folded ? { mx: { xs: -2, md: 0 }, px: { xs: 2, md: 0 } } : bleedSx(0.3)) }}>
      {rows.map((row, k) => table(row.cells, row.start, k))}
    </Box>
  )
}

/**
 * A hairline between columns, header to rank.
 *
 * A season line is one row of a dozen numbers in one size, one weight and one colour, with
 * nothing between them: a reader checking RBI counts across from the header and loses the
 * place somewhere around BB. The log below solves the same problem with zebra ROWS, which a
 * one-row table has no way to use.
 *
 * NOT A TINTED BAND DOWN ALTERNATE COLUMNS, which looks broken. The header cell carries the rule
 * under the labels, so a band arrives in two pieces with a gap across it, and the rank row is
 * drawn only for some columns, so the pieces are different heights from one column to the next.
 * What is meant to be quiet structure reads as a rendering fault.
 *
 * A rule cannot come apart that way: it is one line, the same on every column, and it is the
 * device a printed box score has used for this exact job. Drawn to the RIGHT of every column
 * but the last, so the table does not end in a stray edge.
 */
export const colRuleSx = (i: number, n: number) => (i < n - 1
  ? { borderRight: '1px solid', borderRightColor: 'divider' }
  : {})

/**
 * EDGE TO EDGE ON A PHONE, for the card's three tables (the season line, the game log, the vs
 * table). The pane's 16px gutter cost 32px across thirteen or fourteen columns, on the one
 * element on the card that is short of width; bled to the screen's edges, the zebra rows run
 * edge to edge and a table wide enough to scroll scrolls to the edge rather than clipping 16px in.
 *
 * THE FIRST AND LAST CELLS TAKE THE GUTTER BACK, so the text in them still sits on the same line
 * as every heading and figure above it: the table bleeds, its content does not. `mdPx` is the
 * cells' own padding, restored from `md` up, where the desktop card has width to spare and keeps
 * its inset.
 *
 * `-2` is the pane's `px: 2` (see `panels`); change one and change the other.
 */
export const bleedSx = (mdPx: number) => ({
  mx: { xs: -2, md: 0 },
  '& th:first-of-type, & td:first-of-type': { pl: { xs: 2, md: mdPx } },
  '& th:last-of-type, & td:last-of-type': { pr: { xs: 2, md: mdPx } },
})

/** Worth lighting. The season line's rank row is already gated at this bar, so every
 *  rank it draws passes; the rate strip's is not, and this is what keeps a 16th of 33 from
 *  being lit like a leader. */
export const isLitRank = (r: StatRank | null | undefined, bar: number): boolean => r != null && r.rank <= bar

/** A rank, as a link to the league table it was taken from when the league offers one. A button
 *  rather than an anchor: the table it opens is a board sorted around this player, which is
 *  section state rather than a page with an address of its own. */
function RankText({ onRank, label, children }: { onRank?: () => void; label: string; children: string }) {
  if (!onRank) return <>{children}</>
  return (
    <Box component="button" type="button" onClick={onRank} aria-label={`${children} in ${label}: see the league table`}
      sx={{
        font: 'inherit', color: 'inherit', bgcolor: 'transparent', border: 'none', p: 0, m: 0,
        cursor: 'pointer', textUnderlineOffset: 2,
        ...hoverOnly({ textDecoration: 'underline' }),
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1, borderRadius: 0.5 },
      }}>
      {children}
    </Box>
  )
}

const lineThSx = {
  ...TYPE.micro, textTransform: 'uppercase', letterSpacing: 0.4,
  color: 'text.disabled', textAlign: 'center', py: 0, pb: 0.4, px: 0.3,
  borderBottom: '1px solid', borderColor: 'divider', whiteSpace: 'nowrap',
} as const
const lineTdSx = {
  ...TYPE.figure, textAlign: 'center', px: 0.3, pt: 0.6, pb: 0, whiteSpace: 'nowrap',
} as const
const lineRankSx = {
  ...TYPE.micro, textAlign: 'center', px: 0.3, pt: 0.1, pb: 0.2,
  color: 'text.secondary', whiteSpace: 'nowrap',
} as const

/**
 * The four rates, as a row, at the top of the pane.
 *
 * A full row rather than a centred headline pair, so nothing on the pane sits on an axis of its
 * own, and OBP and SLG are not left to be found further down.
 */
export function RateStrip({ cells, placeholder }: {
  cells: { label: string; value: string; rank?: StatRank | null; onRank?: () => void }[]
  /** The loading state: each value is a sample, drawn as a bar of its width. */
  placeholder?: boolean
}) {
  const { tip, ink, rankBar } = useStatCard()
  const isTopFive = (r: StatRank | null | undefined) => isLitRank(r, rankBar)
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${cells.length}, 1fr)`, gap: 0.5 }}>
      {cells.map(c => (
        <Box key={c.label} sx={{ textAlign: 'center', minWidth: 0 }}>
          <TapTip title={tip(c.label)} popperZIndex={TIP_Z}
            sx={{ ...TYPE.micro, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.disabled', display: 'block', ...keepCase(c.label) }}>
            {c.label}
          </TapTip>
          {/* THE SAME RULE AS THE SEASON LINE: top five is bold and in the rank blue, everything
              else is plain. The bar is the league's `rankBar`, shared so the two blocks cannot come
              to different views of what is worth lighting up on one card. It matters more here
              than it looks: a rate rank is drawn for every qualified player, so without the
              bar this would put the club's colour on a 16th of 33 and turn an accent into
              decoration. */}
          <Typography sx={{
            ...TYPE.hero, lineHeight: 1.15,
            fontVariantNumeric: 'tabular-nums',
            ...(isTopFive(c.rank) ? { color: ink } : {}),
          }}>{placeholder ? <FigureBar sample={c.value} /> : c.value}</Typography>
          {/* Blank when the player is not ranked, matching the season line's rank row, and a
              non-breaking space rather than nothing so the strip is exactly as tall the day before
              they qualify as the day after. Four dashes in a row under four numbers that are right
              there read as missing data; what is missing is the comparison, and the meter below
              says so in words. */}
          {/* WITH ITS POPULATION, as the desktop's lead columns print it. The phone used to say a
              bare "9th" where the desktop said "9th of 16", and the pitch profile three blocks
              down said "of 21"; every rate rank on the card now reads the same way against the
              same field. */}
          <Typography sx={{
            ...TYPE.micro, fontVariantNumeric: 'tabular-nums',
            ...(isTopFive(c.rank) ? { color: ink, fontWeight: 800 } : { color: 'text.secondary' }),
          }}>{c.rank && !placeholder ? <RankText onRank={c.onRank} label={c.label}>{`${ordinal(c.rank.rank)} of ${c.rank.of}`}</RankText> : ' '}</Typography>
        </Box>
      ))}
    </Box>
  )
}

const FORM_INK = { label: 'rgba(255,255,255,0.72)', opp: 'rgba(255,255,255,0.75)', value: '#fff' }

/**
 * The last few games, in the band's own empty middle.
 *
 * WHY HERE. The band is a row of portrait then bio, and the bio is the flexible part, so on a
 * wide card its box is far wider than its longest line: the largest uncommitted area on the page,
 * where the club's wash is strongest. This costs no height at all, which matters: the desktop card
 * already runs close to the viewport's height, so anything that grew the page would be paid for
 * out of the reading list at the bottom.
 *
 * WHAT IT IS FOR. Season totals answer "how good", and this answers "lately", which is the
 * question the totals cannot reach and the one a game log answers only if you read it. It is
 * also the honest thing to show a player the rest of the card cannot say much about: a 6 AB
 * hitter has no percentile and a rate stat that is mostly noise, but "1-3, 2-4, 0-2" is simply
 * what happened.
 *
 * CHRONOLOGICAL, oldest at the left, which is the one place in this file that disagrees with
 * the game log's newest-first order and does so on purpose. A form line is read as a shape
 * over time and time runs left to right; the log is a lookup table, where the row anyone wants
 * is last night's and it belongs at the top. Different jobs, different orders.
 */
export function FormStrip({ title, games, ink = FORM_INK }: {
  title: string
  games: { opp: string; value: string }[]
  /** The band's text colours. WPBL's defaults are measured against its wash (see BAND_WASH in
   *  PlayerDetail); MLB passes the per-club whites `teamPalette` already solved for contrast. */
  ink?: { label: string; opp: string; value: string }
}) {
  if (games.length === 0) return null
  return (
    // `md` and up. Below it the band is barely wide enough for the name.
    // WIDTH IS A BUDGET SHARED WITH THE NAME, and this side loses. Only the bio flexes, so a wide
    // strip squeezes it until the meta line ("#20 · C · B/T R/R · 23 yrs") wraps and grows the band.
    // A block that claims to cost no height has to actually cost none, so the cells carry the
    // squeezed spelling (see `oppLabel().short`), the gap is one step tighter, and `maxWidth` caps
    // the whole thing well short of what five cells could ask for.
    // The cap is in rem for the same reason the budget exists: it is measured against the bio line
    // beside it, and that line is type. In px it would stop scaling when the reader enlarges the
    // text, so the cells would overflow their own box while the bio grows.
    <Box sx={{ display: { xs: 'none', md: 'block' }, flexShrink: 0, minWidth: 0, px: 1.5, maxWidth: '12.5rem' }}>
      {/* 0.72 white, the dimmest thing on the band and so the case its wash is budgeted against.
          These sit 74% to 96% along it, which is its strongest end, and still clear 4.5:1 on all
          four clubs with about a fifth of a step to spare. See BAND_WASH. */}
      <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: ink.label, mb: 0.6 }}>
        {title}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1 }}>
        {games.map((g, i) => (
          <Box key={i} sx={{ textAlign: 'center', minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, color: ink.opp, whiteSpace: 'nowrap' }}>
              {g.opp}
            </Typography>
            <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: ink.value, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
              {g.value}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

/**
 * The other half of a player who is mostly one thing: a hitter's mop-up inning, a pitcher's
 * stray at-bats. Below the cameo thresholds this does not earn a tab (see `twoWay`), so it
 * folds into the primary pane.
 *
 * A SECTION LIKE EVERY OTHER, a heading over one line, and deliberately the same shape as the
 * fielding section: both are one honest line about a part of the season the headline is not
 * describing. It used to be a bordered panel with a rule in the club's colour, which made it the
 * loudest frame on the card for its smallest fact.
 */
export function CameoBlock({ label, text }: { label: string; text: string }) {
  return (
    <Box sx={{ mt: 2 }}>
      <SectionHead title={label} />
      <Typography sx={{ ...TYPE.body, color: 'text.secondary', mt: -0.5 }}>{text}</Typography>
    </Box>
  )
}

/**
 * Columns where "the most of it in one game" is an achievement, so the best game can be marked.
 *
 * Deliberately short of the full line, on two rules. A column has to be one where MORE IS
 * BETTER, which drops SO from the batting log outright (marking a hitter's worst game in the
 * same colour as their best is the sort of thing nobody notices until it is pointed at) and
 * drops H, R, ER, BB and HR from the pitching log for the same reason, since those are what the
 * pitcher gave up. And it has to be an ACHIEVEMENT rather than an opportunity or a workload: AB
 * is how often a hitter came up, not how they did, and a pitcher's P is how long they were left
 * in.
 *
 * BB is left out of the batting list on a softer judgement. A walk is a good outcome and it is
 * still in the line, but "most walks in a game" is not a thing anyone scans a game log for, and
 * every mark spent on it is one more piece of colour competing with the four-hit night.
 */
export const BATTING_BEST = new Set(['R', 'H', '2B', '3B', 'HR', 'RBI', 'SB', 'TB'])
// Not BF or P: facing more batters is not a better outing, it is a longer one, and marking a
// pitcher's highest pitch count as their best day would read as praise for being left in.
export const PITCHING_BEST = new Set(['IP', 'SO'])

/**
 * The best value in a column, if marking it would actually say something.
 *
 * Three ways a column declines to have a best, and all three are about not spending colour on
 * nothing. A max of zero is a stat the player has not recorded all season, and marking ten zeros
 * as ten best games is absurd. A single game cannot have a best game. And a max held by more
 * than a third of the rows is not a standout: a hitter with 1 HR in five of ten games would get
 * five marks that pick out nothing, which is worse than no marks at all, because it teaches a
 * reader the colour means nothing and they stop seeing it on the games where it does.
 *
 * Values are read through `Number` rather than assumed numeric: IP arrives as "5.2" from
 * outsToIp, and its ordering survives the coercion because the fraction digit is only ever
 * 0, 1 or 2. A column carrying anything unparseable (DEC, POS) drops out here rather than
 * needing to be listed above.
 */
export function bestInColumn(values: (string | number)[]): number | null {
  if (values.length < 2) return null
  const nums = values.map(v => Number(v))
  if (nums.some(v => !Number.isFinite(v))) return null
  const max = Math.max(...nums)
  if (max <= 0) return null
  const held = nums.filter(v => v === max).length
  return held > Math.max(1, Math.floor(values.length / 3)) ? null : max
}

/**
 * Show more / show fewer for the card's two long tables, the game log and the matchup tables.
 *
 * COLLAPSIBLE, which the log was deliberately not until Sep 28, 2026. The objection was a "show
 * fewer" yanking 1,000px out from under a finger, and it stopped being true once an expanded
 * table became its own capped scroller (LOG_MAX_H / LOG_MAX_H_XS): collapsing now removes at most
 * that cap. What is left of the objection is handled here. The inner scroller goes back to its
 * top, or the five rows a reader collapses to would be five rows from the middle of the list; and
 * if the table has slid above the viewport the section is scrolled back to it, so the reader is
 * left looking at the table they just folded rather than at whatever moved up under them.
 */
export function useCollapsibleTable() {
  const [expanded, setExpanded] = useState(false)
  const sectionRef = useRef<HTMLDivElement | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const toggle = () => {
    if (!expanded) { setExpanded(true); return }
    setExpanded(false)
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0
    // After the collapse has painted, so the measurement is of the folded table.
    requestAnimationFrame(() => {
      const el = sectionRef.current
      if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' })
    })
  }
  return { expanded, toggle, sectionRef, scrollerRef }
}

/** The control under a collapsible table: the card's one show-more button (see cardParts).
 *  The count is in the "show" label rather than a bare "Show all", because the whole question a
 *  reader is asking before they tap is how much more there is. */
export function ExpandToggle({ expanded, hidden, noun, onToggle, accent }: {
  expanded: boolean
  /** Rows the collapsed table leaves out. */
  hidden: number
  noun: [singular: string, plural: string]
  onToggle: () => void
  accent: string
}) {
  if (hidden <= 0) return null
  return (
    <ShowMoreButton expanded={expanded} onClick={onToggle} accent={accent}>
      {expanded ? 'Show fewer' : `Show ${hidden} more ${hidden === 1 ? noun[0] : noun[1]}`}
    </ShowMoreButton>
  )
}

/**
 * A table of stat lines, one row each, with lead columns on the left: a game log (Date, Opp), a
 * career (Year, Team), a set of splits (Split). Built as the per-game log and still drawn exactly
 * as one, so every row table on the card reads in the same dialect.
 *
 * Cell padding tightens under sm because at full padding the hitting log is wider than a phone's
 * box and silently clips its last columns. The horizontal scroll is the fallback for anything
 * narrower, but it is a POOR one on a phone, where the scrollbar is an overlay that appears only
 * once a finger is already moving: a reader who never tries has no way to know the row
 * continues. So the target is that the widest line FITS a 375px phone outright.
 *
 * 0.3 horizontal padding: fourteen columns at 0.4 measure 345px against the 341px a 375px sheet
 * leaves, silently clipping the TB column. 0.3 brings it to 323 with about 18px of slack, about
 * one more character of POS: enough for a player who moved twice in a game ("LF/CF/P"), and the
 * number to re-measure against if a column is ever added here again.
 */
export interface StatLogRow {
  /** The lead cells, one per `leadHeaders` entry. */
  lead: React.ReactNode[]
  cells: (string | number)[]
  /** Tapping the row opens this (a game, a season). */
  onOpen?: () => void
  /** The row the rest of the card is showing, such as the selected season in a career table. */
  selected?: boolean
}

export function StatLogTable({ title, caption, leadHeaders = ['Date', 'Opp'], statHeaders, rows, totals, totalsLabel = 'Season', best, accent, preview = LOG_PREVIEW, noun = ['game', 'games'], leadSx, placeholder }: {
  title: string
  /** The loading state: rows of samples, each cell drawn as a bar of its sample's width, and the
   *  Show more control drawn invisibly so it still takes its height. Pass samples as the lead too. */
  placeholder?: boolean
  /** On the heading's right, as every other section's. */
  caption?: React.ReactNode
  leadHeaders?: string[]
  statHeaders: string[]
  rows: StatLogRow[]
  /** The season, in the same columns as the games above it, or nothing.
   *
   *  This is the affordance a reader arriving from any stat site reaches for, it costs one
   *  row, and it puts the season in the place they are already scanning columns. It is also a
   *  standing check on the card: the totals come from `sumBatting` over the regular season
   *  while the rows are every game the player appeared in, so a log with a postseason game in it
   *  will visibly not add up, which is the correct answer and not a bug to hide. */
  totals?: (string | number)[]
  /** What the totals row calls itself. */
  totalsLabel?: string
  /** Which headers may carry a best-game mark. See BATTING_BEST / PITCHING_BEST. */
  best?: Set<string>
  accent: string
  /** Rows shown before "Show more". */
  preview?: number
  noun?: [singular: string, plural: string]
  /** Per lead column, laid over its default (the first dimmed, the rest bold). */
  leadSx?: object[]
}) {
  const { tip, ink } = useStatCard()
  // Column index → the value to mark, for the columns that have one. Computed once for the
  // table rather than per cell, which would be O(rows²) down a forty-game log.
  const marks = useMemo(() => {
    const out = new Map<number, number>()
    if (!best) return out
    statHeaders.forEach((h, j) => {
      if (!best.has(h)) return
      const top = bestInColumn(rows.map(r => r.cells[j]))
      if (top != null) out.set(j, top)
    })
    return out
  }, [best, statHeaders, rows])
  // The mark is taken over EVERY game, not over the five on screen: "their best game" is a fact
  // about the season, and recomputing it per preview would move the highlight when the reader
  // expanded the table, which is the one thing a highlight must never do.
  const { expanded, toggle, sectionRef, scrollerRef } = useCollapsibleTable()
  // NOT FOR A ROW OR TWO. "Show 1 more season" under a ten-row career is a button the height of
  // the row it hides, so a table within two rows of its preview simply shows them all.
  const cut = rows.length > preview + 2 ? preview : rows.length
  const shown = expanded ? rows : rows.slice(0, cut)
  const hidden = rows.length - cut
  if (rows.length === 0) return null
  // The first lead (the date) is furniture, so it dims; the rest (the opponent) are what a reader
  // scans down, so they carry weight.
  const leadCellSx = (k: number) => ({
    ...tdSx, textAlign: 'left',
    ...(k === 0 ? { color: 'text.disabled' } : { fontWeight: 700 }),
    ...(leadSx?.[k] ?? {}),
  })
  return (
    <Box ref={sectionRef} sx={{ mt: 2 }}>
      {caption != null ? <SectionHead title={title} caption={caption} /> : <Typography sx={sectionSx}>{title}</Typography>}
      {/* Capped and self-scrolling, with the header pinned to the top of it and the season row
          pinned to the bottom. This is the one block on the page that grows on its own: a row a
          game, and about forty by the end of a season, against a rail that stays put whatever
          happens.
          THE CAP APPLIES ON A PHONE ONLY ONCE THE READER HAS EXPANDED IT, which is why this is
          conditional rather than a breakpoint. A nested scroller buys nothing on a phone while the
          log is short and costs a touch gesture inside a sheet that already scrolls. Expanded it is
          the opposite trade: forty rows is about 1,400px of table with a header that has scrolled
          out of sight by the fourth, and a wide row of bare figures with no header above it is
          unreadable, since the column under your thumb could be 2B or SO.
          Leaving the header sticky against the PAGE cannot work: a box with `overflow-x: auto` is a
          scroll container on both axes (CSS will not let one axis scroll and the other stay
          visible), so the header sticks to a box exactly as tall as the table, which is not
          sticking at all. Giving that same box a height is what makes its sticky header work. */}
      <Box ref={scrollerRef} sx={{
        ...bleedSx(0.85),
        overflowX: 'auto',
        maxHeight: { xs: expanded ? LOG_MAX_H_XS : 'none', md: chromePx(LOG_MAX_H) },
        overflowY: 'auto',
      }}>
        <Box component="table" sx={{ width: '100%', minWidth: 'max-content', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
          <Box component="thead">
            <Box component="tr">
              {leadHeaders.map(h => (
                <Box component="th" key={h} sx={{ ...thSx, textAlign: 'left' }}>{h}</Box>
              ))}
              {/* A FLOOR UNDER EVERY STAT COLUMN. Auto layout hands spare width out in proportion to
                  what each column holds, so a one-letter header over one-digit games (R, H) got
                  almost none and its figures ran together ("0 0 0") while RBI took the slack. The
                  season row used to hide this by putting three digits in every column. In rem,
                  since it is room for a figure: it has to grow with the reader's text. */}
              {statHeaders.map(h => (
                <TapTip key={h} title={tip(h)} component="th" popperZIndex={TIP_Z} sx={{ ...thSx, ...keepCase(h), width: STAT_COL_MIN }}>{h}</TapTip>
              ))}
            </Box>
          </Box>
          <Box component="tbody">
            {shown.map((r, i) => (
              /* The row opens that game.
                 NOT an anchor, which is the one place this section departs from the house rule
                 about real hrefs, and it departs from it for the rule's own reason. A game is
                 `?game=<id>` query state on whichever tab is underneath, and seo.ts deliberately
                 canonicalises those back to the tab so that a hundred shared game links do not
                 read as a hundred near-duplicate pages. The rule exists to make routes findable;
                 these are the one thing here that is meant NOT to be indexed separately, and
                 every other game card in the section (GameGrid, the Home rail, the schedule) is
                 a `pressable` for the same reason.
                 `role` is left alone: a `role="button"` on a `tr` takes the row out of the table
                 for a screen reader, so the row keeps its semantics and picks up the keyboard
                 handler instead. */
              <Box
                component="tr"
                key={i}
                {...(r.onOpen ? {
                  onClick: r.onOpen,
                  tabIndex: 0,
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); r.onOpen?.() }
                  },
                } : {})}
                sx={{
                  // ZEBRA, at about a third of the strength a divider is drawn at. The log is
                  // the tallest block on the card and the only one with no vertical rules, so
                  // a wide row of small figures has nothing holding it together across
                  // fourteen columns; the eye loses the line somewhere around RBI. It is drawn
                  // on the ODD rows so the first row, which is last night's game and the one
                  // anybody opens this for, stays on the plain ground.
                  ...(i % 2 === 1 ? { bgcolor: 'action.hover' } : {}),
                  // Over the zebra, so the season the card is showing is findable in a long career.
                  ...(r.selected ? { bgcolor: 'action.selected' } : {}),
                  ...(r.onOpen ? {
                  cursor: 'pointer',
                  ...TAPPABLE,
                  // Inset, because an outline drawn outside a table row is clipped by the
                  // log's own scroller on the two rows that matter most, the first and last.
                  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-2px' },
                  } : {}),
                }}
              >
                {/* The opponent is plain, deliberately. The opponent's own club colour would give the log a spine to scan
                    by and cost more than it buys: a reader looking at a player's card does not need other
                    clubs competing for attention with that player's numbers, and the colour would land on
                    the one column nobody came here to read. Emphasis on this card is for the figures. See
                    the best-game marks below and the ranks in the season line. */}
                {r.lead.map((c, k) => (
                  <Box component="td" key={`lead${k}`} sx={leadCellSx(k)}>
                    {placeholder && (typeof c === 'string' || typeof c === 'number') ? <FigureBar sample={c} /> : c}
                  </Box>
                ))}
                {r.cells.map((c, j) => {
                  // The rank ink, the card's one colour for a good number. Every
                  // column that can be marked is one where more is better, so it only ever lands
                  // on good news.
                  if (placeholder) return <Box component="td" key={j} sx={tdSx}><FigureBar sample={c} /></Box>
                  const top = marks.get(j) != null && Number(c) === marks.get(j)
                  // A ZERO DIMS, exactly as it does in the season line above. It is the same
                  // argument and it bites harder here: a batting log is more than half zeros
                  // (a two-hit night reads 3 1 2 0 0 0 1 0 0 0 2), and at full weight the eye
                  // has to read every cell to find the four that happened. Dimmed, the log
                  // draws its own shape, and a quiet week looks quiet instead of looking like
                  // a wall. A dash keeps its weight: it is a column that does not apply, not a
                  // thing that did not happen.
                  return (
                    <Box component="td" key={j} sx={
                      top ? { ...tdSx, fontWeight: 800, color: ink }
                        : isZeroStat(c) ? { ...tdSx, ...ZERO_SX }
                          : tdSx
                    }>{c}</Box>
                  )
                })}
              </Box>
            ))}
          </Box>
          {totals && (
            // A `tfoot` so it stays the season whatever the rows do, and so a screen reader
            // meets it as a summary rather than as a forty-first game. Sticky to the bottom
            // edge of the capped desktop scroller for the same reason the header is sticky to
            // the top: the row exists to be compared against the games, and a total you have
            // to scroll forty rows to reach is a total nobody reads.
            <Box component="tfoot">
              <Box component="tr">
                {/* A label, so the card's label grey rather than the club's colour: red "SEASON" on the
                    Firebells sat in the same row as blue best-game marks and read as a third kind of
                    emphasis. The rule above the row is what sets it apart. */}
                <Box component="td" sx={{ ...totalTdSx, textAlign: 'left', fontSize: '0.6rem', letterSpacing: 0.5, textTransform: 'uppercase', color: 'text.secondary' }}>
                  {totalsLabel}
                </Box>
                {leadHeaders.slice(1).map(h => <Box component="td" key={h} sx={{ ...totalTdSx, textAlign: 'left' }} />)}
                {totals.map((c, j) => (
                  <Box component="td" key={j} sx={totalTdSx}>{c}</Box>
                ))}
              </Box>
            </Box>
          )}
        </Box>
      </Box>
      {placeholder
        ? <Box aria-hidden sx={{ visibility: 'hidden' }}><ExpandToggle expanded={false} hidden={hidden} noun={noun} onToggle={() => {}} accent={accent} /></Box>
        : <ExpandToggle expanded={expanded} hidden={hidden} noun={noun} onToggle={toggle} accent={accent} />}
    </Box>
  )
}

/** The narrowest a row table's stat column may be: two figures and their padding. */
const STAT_COL_MIN = '1.3rem'

/** How many games the log opens on.
 *
 *  Five, which is a week and a bit of a WPBL schedule and the same handful the band's form
 *  strip carries. The log is the tallest block on the card by a distance (a row a game, ~14 by
 *  September and ~40 over a full season), and on a phone it pushed everything under it -- the
 *  fielding line, the reading list -- past the point anybody scrolls to. What a reader wants
 *  from a game log at a glance is the recent form; what they want from the rest of it is to be
 *  able to reach it, which is what the control is for. It folds back up: see useCollapsibleTable. */
export const LOG_PREVIEW = 5

/** The log's season row. The rule above it is the club's colour and the row's own background
 *  is the paper, because it has to stay legible over whichever game row it comes to rest on
 *  while the log scrolls under it. */
export const totalTdSx = {
  ...TYPE.body, fontWeight: 800, py: 0.6, px: { xs: 0.22, sm: 0.85 },
  textAlign: 'center', whiteSpace: 'nowrap',
  position: 'sticky', bottom: 0, zIndex: 1, bgcolor: 'background.paper',
  boxShadow: (t: Theme) => `inset 0 2px 0 ${t.palette.divider}`,
} as const

// About thirteen rows, which is a little over the tallest the left rail gets. See GameLogTable.
export const LOG_MAX_H = 440
/**
 * The same cap on a phone, once the log has been expanded.
 *
 * A FRACTION OF THE SCREEN rather than a row count, because the point of it is the sticky
 * header rather than the height: whatever is on screen has to have a header above it, and the
 * only way a sticky header can hold is if the box it is sticky inside actually scrolls. Set
 * too generously it does not, and a 15-game log (465px on a 375x812 phone, which is most of
 * the roster) would sit under the cap, scroll with the page, and take its header away with it,
 * which is the bug this exists to close.
 *
 * Half the viewport leaves the log about eleven rows and keeps the rest of the pane reachable
 * around it. Re-measure against a real phone rather than against a row count if it moves: the
 * row height is type-scale-dependent and a reader at Large text has fewer of them.
 */
export const LOG_MAX_H_XS = '50vh'

// Game-log table cells. Headers are compact uppercase; body cells are tabular so columns
// stay aligned down the table. Both center-align (numeric); the Date/Opp lead columns
// override to left in the component. Horizontal padding is responsive: see GameLogTable.
//
// The header row pins, for the capped desktop log (see GameLogTable). Two details it needs:
// an opaque background, or the rows scroll THROUGH it rather than under it, and its rule drawn
// as an inset shadow rather than a border, because a `border-collapse: collapse` table hands
// its cell borders to the row boundary and a sticky cell leaves them behind. Harmless where
// the log is not capped: a sticky cell in a container that never scrolls never moves.
export const thSx = {
  ...TYPE.micro, textTransform: 'uppercase', letterSpacing: 0.4,
  color: 'text.disabled', py: 0.6, px: { xs: 0.22, sm: 0.85 }, textAlign: 'center', whiteSpace: 'nowrap',
  position: 'sticky', top: 0, zIndex: 1, bgcolor: 'background.paper',
  boxShadow: (t: Theme) => `inset 0 -1px 0 ${t.palette.divider}`,
} as const
export const tdSx = { ...TYPE.body, py: 0.55, px: { xs: 0.22, sm: 0.85 }, textAlign: 'center', borderTop: '1px solid', borderColor: 'divider', whiteSpace: 'nowrap' } as const

// ─── The club band ───────────────────────────────────────────────────────────────

/** White text on the band, as WPBL measured it against its wash (see BAND_WASH in PlayerDetail). */
const BAND_INK = { name: '#fff', meta: 'rgba(255,255,255,0.88)', line: 'rgba(255,255,255,0.75)' }

/**
 * Identity, on the club's own colours: portrait, name, the facts about the player, and room on the
 * right for the form strip. Who the player is rather than how a role went, so it carries no rates.
 *
 * THE COLOURS ARE THE CALLER'S, because each league solved them its own way. WPBL's four primaries
 * are all near-black and take a wash of the secondary across the right (PlayerDetail's BAND_WASH);
 * MLB's thirty are not, so it sits on the flat card colour `teamPalette` already deepened for white
 * text and says the club's second colour in the stripe alone.
 *
 * `data-sheet-drag` makes this the phone sheet's grab surface: the card is taller than the sheet,
 * so its body is a scroller, and a scroller takes ownership of a touch before the drag handler can.
 * Only while the band is PINNED above that scroller (see `grab`).
 */
export function PlayerBand({ bandRef, background, stripe, portrait, name, nameAs = 'div', badge, meta, lines, chips, aside, ink = BAND_INK, grab = true }: {
  bandRef?: (el: HTMLDivElement | null) => void
  /**
   * Be the sheet's grab surface. Off where the band scrolls WITH the content, as the first thing in
   * a phone pane: the grab surface takes `touch-action: none`, so the browser never scrolls from it
   * and the sheet moved the pane in JavaScript instead, a touchmove at a time with no momentum. A
   * swipe that began on the band (the biggest thing at the top of the card) felt like dragging
   * rather than scrolling, which is most of what made the player page feel unlike every other page.
   * In the pane the band needs nothing special: at the top of the pane a pull down still closes the
   * sheet by the rule any content follows.
   */
  grab?: boolean
  /** `backgroundColor` and, optionally, `backgroundImage`. */
  background: { color: string; image?: string }
  /** The 2px rule along the bottom, in the club's second colour. */
  stripe: string
  portrait: React.ReactNode
  name: string
  /** `h1` where the band is the page's heading (WPBL's card); MLB's page carries its own. */
  nameAs?: 'h1' | 'div'
  /** Beside the name: "Two-way". See BandBadge. */
  badge?: React.ReactNode
  /** The line under the name: number, position, handedness, age. */
  meta?: string
  /** Smaller lines under that, one fact each (hometown, draft), so a long one never wraps into the next. */
  lines?: string[]
  /** Under the facts: awards. */
  chips?: React.ReactNode
  /** Right of the facts, from `md` up: the form strip. */
  aside?: React.ReactNode
  ink?: { name: string; meta: string; line: string }
}) {
  return (
    <Box ref={bandRef} data-player-band data-sheet-drag={grab ? '' : undefined} sx={{
      position: 'relative', flexShrink: 0,
      backgroundColor: background.color,
      ...(background.image ? { backgroundImage: background.image } : {}),
      borderBottom: `2px solid ${stripe}`,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1.5, sm: 2 }, p: { xs: 1.75, sm: 2.25 } }}>
        {portrait}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            <Typography component={nameAs} sx={{ fontSize: { xs: '1.2rem', sm: '1.4rem' }, fontWeight: 800, lineHeight: 1.15, color: ink.name, m: 0 }}>
              {name}
            </Typography>
            {badge}
          </Box>
          {meta && (
            <Typography sx={{ fontSize: '0.8rem', color: ink.meta, mt: 0.25 }}>{meta}</Typography>
          )}
          {/* Separate lines, not one run-on: joined with a separator the draft line wraps
              mid-phrase behind a long hometown and reads as part of the address. */}
          {lines?.map(l => (
            <Typography key={l} sx={{ fontSize: '0.72rem', color: ink.line, mt: 0.1 }}>{l}</Typography>
          ))}
          {chips}
        </Box>
        {aside}
      </Box>
    </Box>
  )
}

/** A small uppercase tag beside the name. White on a translucent white wash rather than a club
 *  colour, which on some clubs' primaries measures under 4.5:1. */
export function BandBadge({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ flexShrink: 0, px: 0.85, py: 0.2, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.22)', color: '#fff', fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {children}
    </Box>
  )
}

/** A chip on the band (an award): a light wash with a hairline, which reads over both a dark band
 *  and a bright club colour. `href` makes it a link. */
export const BAND_CHIP_SX = {
  display: 'inline-flex', alignItems: 'center', gap: 0.4, textDecoration: 'none',
  px: 0.9, py: 0.3, borderRadius: 999, color: '#fff', whiteSpace: 'nowrap', flexShrink: 0,
  bgcolor: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.32)',
  fontSize: '0.66rem', fontWeight: 800, lineHeight: 1.2,
} as const

/**
 * The band's chips, on ONE ROW: as many as fit, most important first, then "+N" for the rest.
 *
 * A decorated player's honours used to wrap into as many rows as they took, and on a phone
 * Ohtani's ran to three, pushing the season a third of a screen down to say what his career was.
 * The caller passes them ranked (MVP before All-Star), so the row always keeps the biggest, and
 * "+N" opens the rest in place for a reader who wants them, with "Less" to fold them back.
 *
 * MEASURED, not a count per breakpoint: a chip is as wide as its words ("4× MVP" against
 * "Hank Aaron Award 2023"), so a fixed count either wastes the row or overflows it. An invisible
 * copy of the whole row is laid out beside the real one and read before paint, so the first frame
 * already has the right number in it and nothing reflows when the measurement lands.
 */
export function BandChips({ children, noun = ['award', 'awards'] }: {
  /** The chips, most important first, each with its own key. */
  children: React.ReactElement[]
  noun?: [singular: string, plural: string]
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(children.length)
  const [expanded, setExpanded] = useState(false)
  const n = children.length
  useLayoutEffect(() => {
    const box = boxRef.current, ghost = ghostRef.current
    if (!box || !ghost) return
    const measure = () => {
      const room = box.clientWidth
      const chips = Array.from(ghost.children) as HTMLElement[]
      const more = chips.pop()          // the ghost's last child is a "+N" chip, for its width
      if (!room || !more) return
      const gap = parseFloat(getComputedStyle(ghost).columnGap) || 0
      const right = (el: HTMLElement) => el.offsetLeft + el.offsetWidth
      // Everything, if everything fits with no "+N" at all.
      if (chips.length && right(chips[chips.length - 1]) <= room) { setFit(chips.length); return }
      let k = 0
      while (k < chips.length && right(chips[k]) + gap + more.offsetWidth <= room) k++
      // Always at least the top honour, even if "+N" then has to sit on the edge of the row.
      setFit(Math.max(1, k))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    return () => ro.disconnect()
  }, [n])
  if (n === 0) return null
  const hidden = expanded ? 0 : n - Math.min(fit, n)
  const toggleSx = {
    ...BAND_CHIP_SX, cursor: 'pointer', font: 'inherit', fontSize: BAND_CHIP_SX.fontSize, fontWeight: 800,
    ...hoverOnly({ bgcolor: 'rgba(255,255,255,0.26)' }),
    '&:focus-visible': { outline: '2px solid #fff', outlineOffset: 2 },
  }
  return (
    <Box ref={boxRef} sx={{ position: 'relative', mt: 0.6, minWidth: 0 }}>
      {/* The measuring copy: same chips, one row, never seen, never read. Clipped by a box of the
          row's own size, so its full length can never widen the page into a sideways scroll. */}
      <Box aria-hidden sx={{ position: 'absolute', inset: 0, overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none' }}>
        <Box ref={ghostRef} sx={{ position: 'absolute', left: 0, top: 0, display: 'flex', gap: 0.5, flexWrap: 'nowrap', width: 'max-content' }}>
          {children}
          <Box sx={BAND_CHIP_SX}>+{n}</Box>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: expanded ? 'wrap' : 'nowrap', overflow: 'hidden' }}>
        {expanded ? children : children.slice(0, n - hidden)}
        {(hidden > 0 || expanded) && n > 1 && fit < n && (
          <Box component="button" type="button" onClick={() => setExpanded(e => !e)} aria-expanded={expanded}
            aria-label={expanded ? `Show fewer ${noun[1]}` : `Show ${hidden} more ${hidden === 1 ? noun[0] : noun[1]}`}
            sx={toggleSx}>
            {expanded ? 'Less' : `+${hidden}`}
          </Box>
        )}
      </Box>
    </Box>
  )
}

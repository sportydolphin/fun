import React, { useEffect, useRef, useState } from 'react'
import { Box, Skeleton, Typography } from '@mui/material'
import {
  finderFields, finderUnit, finderColumns, defaultCondition, parseFinderValue, unparseFinderValue,
  displayFinderValue, describeFinderQuery,
  FINDER_OPS,
  type FinderCondition, type FinderOp, type FinderQuery, type FinderResult, type FinderRow,
  type FinderSide, type FinderSort, type FinderTally, type FinderVenue,
} from '../league/finder'
import type { LeagueGame, LeaguePlayer } from '../league/types'
import { SectionCard, TYPE_SCALE, CARD_BORDER, ACCENT_EDGE } from './card'
import { ExpandRow } from './ExpandRow'
import { LeaderCard, LeaderCardSkeleton, PORTRAIT_PX, type LeaderItem } from './leaders'
import { FOCUS_RING, TAPPABLE, hoverOnly, pressable } from './interaction'
import { NameText } from './NameText'
import { chromePx } from './scale'
import { BOARD_COLUMN } from './layoutWidths'

// The Find board's body, for both sections: every game line that matches what you asked for. How
// often has anyone struck out five in a game, who has gone four for four more than once, has a
// pitcher ever walked nobody through five. Every other board answers a question somebody thought to
// put on a board; this answers the ones nobody did.
//
// THE ENGINE IS src/league/finder.ts, with the reasoning about what can be asked, why every
// condition is AND, and why the query encodes into one query param. Until Oct 2026 each section
// drew this board for itself, MLB's a copy of WPBL's with its own sizes; what is left in each
// section is where the lines come from, its controls bar, and its own row and face parts.
//
// THE LAYOUT IS DECIDED BY CONTAINER QUERIES, NOT BREAKPOINTS. Until Oct 2026 the whole board was
// one 720px column centred in a 1540px page: a form over two cards with a gutter either side, and
// the tally squeezed into a third of the column. Three things now switch on, each only once the
// board's own width has room for it: the question moves into a rail on the left that stays pinned
// while the answers scroll; the list becomes a table with the line's columns; and the tally moves
// beside the table. The thresholds are in rem because the table's columns are, so at the Large
// text setting each switch happens later, where a px threshold or a breakpoint would switch on a
// table that then overflowed. (A container query's rem is the root's font size, as it is anywhere
// else; its `em` would be the container's, which a parent could move.)

/** How much of the result list shows before it asks. Ten rows is a leaderboard, thirty is a
 *  directory (ExpandRow's rule): uncapped, a question matching fifty games puts the tally two full
 *  screens down on a phone, where a reader who has not scrolled that far has no idea it exists. */
const RESULT_CAP = 10
/** The tally's rows. */
const TALLY_SHOWN = 10
/** Six, the cap the address decoders enforce too, so a hand-edited link cannot smuggle in a
 *  hundred conditions and make the board unreadable. */
const MAX_CONDITIONS = 6

// THE TABLE'S COLUMNS, in rem so they grow with the reader's text. The player column takes what is
// left and steps a long name down to "F. Last" (NameText) rather than pushing the numbers off.
const COL = { rank: 1.5, player: 8, game: 5.25, result: 3.75, stat: 2.4, gap: 0.4 }
/** The table's narrowest, which is what the main column must hold before it is drawn: the fixed
 *  columns, the player column's floor, the gaps, and the card's padding and borders (2 x 16 chrome
 *  px, under 2.5rem at either scale). */
const tableMinRem = (stats: number) =>
  COL.rank + COL.player + COL.game + COL.result + stats * COL.stat + (stats + 3) * COL.gap + 2.5
/** The rail's width, and the tally's when it sits beside the table. */
const RAIL_REM = 22
const TALLY_REM = 17
const PANE_GAP_REM = 1.25

const fieldSx = {
  ...FOCUS_RING,
  minHeight: chromePx(34), py: 0.4,
  borderRadius: 999, border: '1px solid', borderColor: CARD_BORDER,
  bgcolor: 'background.paper', color: 'text.primary',
  fontSize: TYPE_SCALE.meta, fontWeight: 700, fontFamily: 'inherit',
  ...hoverOnly({ borderColor: 'text.disabled' }),
} as const

/** A quiet text button the height of a field, for Add, Clear and Done. */
const textButtonSx = {
  ...FOCUS_RING,
  display: 'inline-flex', alignItems: 'center', flexShrink: 0,
  minHeight: chromePx(34), px: 1.25, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
  color: 'text.secondary', fontSize: TYPE_SCALE.meta, fontWeight: 700,
  ...hoverOnly({ color: 'text.primary' }),
} as const

/**
 * A native `<select>`, which is the one place the boards do not use the chip idiom.
 *
 * A condition picks a stat out of sixteen, and then an operator, and then does it again on the next
 * row: chips would be a wall, and a sheet per control would be three taps to change a number. A
 * native select is one tap, gives a phone its own wheel picker, is keyboard- and
 * screen-reader-complete for free, and cannot render off the edge of the screen. Taller than a
 * filter chip (34px against 25) because this is a form a thumb fills in, not a row it glances at.
 *
 * Painted to match the chips around it rather than left at the UA default, which on Windows is a
 * grey 3D box that looks like a bug next to the rest of the bar.
 */
function Picker({ value, onChange, options, label }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  label: string
}) {
  return (
    <Box component="select" aria-label={label} value={value}
      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
      sx={{
        ...fieldSx,
        appearance: 'none', WebkitAppearance: 'none',
        // Room on the right for the caret drawn as a background image, so the arrow never sits on
        // top of a long stat name.
        backgroundImage: 'linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)',
        backgroundPosition: 'right 12px center, right 7px center',
        backgroundSize: '5px 5px, 5px 5px',
        backgroundRepeat: 'no-repeat',
        // Capped at the row, for the rail: a long club name in a 22em column otherwise runs past it.
        minWidth: 0, maxWidth: '100%', flexShrink: 0, pl: 1.25, pr: 3, cursor: 'pointer',
      }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Box>
  )
}

/** One `stat op value` row. `n` is the 1-based position, spoken into the labels so a screen reader
 *  with several conditions can tell the rows apart. */
function ConditionRow({ side, n, condition, onChange, onRemove }: {
  side: FinderSide
  n: number
  condition: FinderCondition
  onChange: (c: FinderCondition) => void
  onRemove: () => void
}) {
  // WHAT THE READER TYPED, UNTIL THEY LEAVE THE BOX. The stored value is normalised (innings are
  // outs), so a purely controlled input rewrites itself under the cursor: type "4" in the innings
  // field and it becomes "4.0", and the next keystroke lands after the zero. Backspacing to empty is
  // the other half, where the parse floors at 0 and the box refills with "0". The query itself
  // updates on every keystroke either way: the draft is about what is DRAWN.
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => { setDraft(null) }, [condition.field])
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
      {/* Sized to its content, not stretched: a stat dropdown that ran the whole row was the worst
          of the board's desktop sizing. The row packs left instead. */}
      <Picker label={`Stat, condition ${n}`} value={condition.field}
        options={finderFields(side).map(f => ({ value: f.key, label: f.label }))}
        onChange={field => onChange({ ...condition, field })} />
      <Picker label={`Comparison, condition ${n}`} value={condition.op}
        options={FINDER_OPS.map(o => ({ value: o.op, label: o.label }))}
        onChange={op => onChange({ ...condition, op: op as FinderOp })} />
      {/* The value and its remove button wrap as one: on a phone the row does not fit, and a lone
          ✕ on a line of its own read as belonging to nothing. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        {/* A TEXT INPUT, NOT type="number", and innings are why. "4.2" means four and two thirds in
            this sport, so the value is parsed with `ipToOuts` rather than with Number, and a number
            input's own stepper would offer 4.3, which is not an innings figure that exists.
            `inputMode` still brings up the numeric keypad on a phone. */}
        <Box component="input" aria-label={`Value, condition ${n}`} inputMode="decimal"
          value={draft ?? unparseFinderValue(side, condition.field, condition.value)}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setDraft(e.target.value)
            onChange({ ...condition, value: parseFinderValue(side, condition.field, e.target.value) })
          }}
          onBlur={() => setDraft(null)}
          sx={{ ...fieldSx, width: '3.5rem', px: 1.25, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }} />
        <Box {...pressable(onRemove)} aria-label={`Remove condition ${n}`} sx={{
          ...FOCUS_RING,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          width: chromePx(34), height: chromePx(34), borderRadius: 999, cursor: 'pointer', userSelect: 'none',
          color: 'text.secondary', fontSize: TYPE_SCALE.body, fontWeight: 800,
          ...hoverOnly({ color: 'text.primary', bgcolor: 'action.hover' }),
        }}>✕</Box>
      </Box>
    </Box>
  )
}

/** A question worth one tap, offered as a chip. The section's own, since what counts as a long
 *  start differs between a seven-inning league and a nine-inning one. */
export interface FinderExample {
  label: string
  conditions: FinderCondition[]
}

/** One way a typed question can be read, in the shape src/league/finderParse.ts returns. */
export interface FinderReading {
  side: FinderSide
  conditions: FinderCondition[]
  teamId: string | null
  oppId: string | null
  venue: FinderVenue
  /** Words that were not understood, said back so a dropped name is visible. */
  ignored: string[]
}

const sameConditions = (a: FinderCondition[], b: FinderCondition[]) =>
  a.length === b.length && a.every((c, i) => c.field === b[i].field && c.op === b[i].op && c.value === b[i].value)

/** The club, opponent and venue in words: "for NY, vs LA, at home". */
function scopeWords(q: Pick<FinderQuery, 'teamId' | 'oppId' | 'venue'>, clubAbbr: (id: string) => string): string {
  return [
    q.teamId && `for ${clubAbbr(q.teamId)}`,
    q.oppId && `vs ${clubAbbr(q.oppId)}`,
    q.venue === 'home' ? 'at home' : q.venue === 'away' ? 'on the road' : null,
  ].filter(Boolean).join(', ')
}

/**
 * THE QUESTION TYPED AS WORDS. The pickers are how a question is corrected; this is how most of
 * them can start, since "5 strikeouts no walks" is one line on a phone keyboard against six native
 * selects. It only ever suggests: what it understood is said back in the board's own words before
 * anything happens, and a reading on the other side says so, because "5 strikeouts" is a
 * pitcher's line and a hitter's.
 */
function AskBox({ side, parse, onAsk, clubAbbr }: {
  side: FinderSide
  parse: (text: string) => FinderReading[]
  onAsk: (r: FinderReading) => void
  clubAbbr: (id: string) => string
}) {
  const [text, setText] = useState('')
  const readings = text.trim() ? parse(text) : []
  const best = readings.find(r => r.side === side) ?? readings[0] ?? null
  const ask = () => { if (best) { onAsk(best); setText('') } }
  const scope = best ? scopeWords(best, clubAbbr) : ''
  return (
    <Box>
      <Box component="input" type="search" aria-label="Ask in words" placeholder="Ask in words: 5 strikeouts no walks"
        value={text} enterKeyHint="search"
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); ask() } }}
        sx={{ ...fieldSx, boxSizing: 'border-box', width: '100%', px: 1.5, fontWeight: 600, '&::placeholder': { color: 'text.secondary', opacity: 1 } }} />
      {/* Always the same height, so the form under it does not jump on every keystroke. */}
      <Box aria-live="polite" sx={{ minHeight: '1.75rem', display: 'flex', alignItems: 'center', px: 0.5 }}>
        {!text.trim() ? null : best ? (
          <Box {...pressable(ask)} sx={{
            ...FOCUS_RING, minWidth: 0, cursor: 'pointer', borderRadius: 1, px: 0.5, mx: -0.5,
            fontSize: TYPE_SCALE.meta, color: 'text.secondary', ...TAPPABLE,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            <Box component="span" sx={{ fontWeight: 800, color: ACCENT_EDGE }}>Ask ›</Box>{' '}
            {describeFinderQuery(best.side, { conditions: best.conditions })}
            {scope && `, ${scope}`}
            {best.side !== side && ` (${best.side})`}
            {best.ignored.length > 0 && `. Ignored: ${best.ignored.join(' ')}`}
          </Box>
        ) : (
          <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Name a stat and a number: 3 hits, 0 walks, 6+ innings.
          </Typography>
        )}
      </Box>
    </Box>
  )
}

/** "Copy link", for the question: it is already the address, so a question is a thing to send. */
function CopyLink() {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const copy = () => {
    const done = (s: 'copied' | 'failed') => {
      setState(s)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setState('idle'), 2000)
    }
    if (!navigator.clipboard) { done('failed'); return }
    navigator.clipboard.writeText(window.location.href).then(() => done('copied'), () => done('failed'))
  }
  return (
    <Box {...pressable(copy)} aria-live="polite" sx={{
      ...FOCUS_RING, fontSize: TYPE_SCALE.meta, fontWeight: 700, color: ACCENT_EDGE, cursor: 'pointer',
      py: 0.5, px: 0.5, whiteSpace: 'nowrap', borderRadius: 1, userSelect: 'none',
      // The widest of its three words, so the header does not shift as it changes.
      minWidth: '5.5em', textAlign: 'right',
      ...hoverOnly({ textDecoration: 'underline' }),
    }}>
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Can’t copy' : 'Copy link'}
    </Box>
  )
}

/** A result row's ghost, the same box as GameLineFrame's. */
function RowSkeleton({ divider }: { divider: boolean }) {
  return (
    <Box aria-hidden sx={{
      display: 'flex', alignItems: 'center', gap: 1.25, px: 0.5, py: 0.85,
      borderTop: divider ? '1px solid' : 'none', borderColor: 'divider',
    }}>
      <Box sx={{ width: '1.5rem', flexShrink: 0, fontSize: TYPE_SCALE.body }}>&nbsp;</Box>
      <Skeleton variant="circular" width={chromePx(PORTRAIT_PX)} height={chromePx(PORTRAIT_PX)} sx={{ flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.body }}><Skeleton width="55%" /></Typography>
        <Typography sx={{ fontSize: TYPE_SCALE.meta }}><Skeleton width="75%" /></Typography>
      </Box>
      <Box sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 800 }}><Skeleton width="2rem" /></Box>
    </Box>
  )
}

/** What a section hands the table for one row: its face, its club mark, and its two links. */
export interface FinderRowParts {
  portrait: React.ReactNode
  club?: React.ReactNode
  /** The player's link, on the name. */
  playerLink?: object
  /** The night's link, which the whole row opens. */
  gameLink?: object
}

/** "W 5–2", from the line's own club: the roster's means "now". */
function gameResult(game: LeagueGame | null, teamId: string | null): string {
  if (!game || game.home_score == null || game.away_score == null || teamId == null) return '—'
  const home = game.home_team_id === teamId
  const us = home ? game.home_score : game.away_score
  const them = home ? game.away_score : game.home_score
  return `${us > them ? 'W' : us < them ? 'L' : 'T'} ${us}–${them}`
}

/** "8/2 at BOS", the game a line came from, with home or away off the line's own club. */
function gameLabel(game: LeagueGame | null, teamId: string | null, clubAbbr: (id: string) => string): string {
  if (!game) return ''
  const date = new Date(`${game.game_date}T00:00:00`).toLocaleDateString([], { month: 'numeric', day: 'numeric' })
  const home = teamId != null && game.home_team_id === teamId
  return `${date} ${home ? 'vs' : 'at'} ${clubAbbr(home ? game.away_team_id : game.home_team_id)}`
}

/**
 * THE TABLE. A matching line drawn as "8/2 at BOS · 2.0 IP, 2 H, 2 R, 2 BB, 4 K" is a table
 * squashed into a sentence; with the width for it the line gets its columns, the game its result,
 * and every column sorts. The columns asked about are marked, the first in the accent.
 *
 * AN ARIA TABLE OF GRID ROWS rather than a `<table>`, because the whole row is one link to the game
 * while the name is a second link to the player. The row link is a stretched anchor (its `::after`
 * covers the row), which needs the row to be a positioned box, and a `<tr>` is not reliably one.
 * Each row is its own grid on the same template, which the fixed rem columns make exact.
 */
function ResultTable<P extends LeaguePlayer, G extends LeagueGame>({
  side, query, rows, sort, onSort, headlineField, clubAbbr, rowParts, loading,
}: {
  side: FinderSide
  query: FinderQuery
  rows: FinderRow<P, G>[]
  sort: FinderSort | null
  onSort: (s: FinderSort | null) => void
  headlineField: string
  clubAbbr: (id: string) => string
  rowParts: (row: FinderRow<P, G>) => FinderRowParts
  loading: boolean
}) {
  const cols = finderColumns(side, query)
  const asked = query.conditions.map(c => c.field)
  const template = [
    `${COL.rank}rem`, `minmax(${COL.player}rem, 1fr)`, `${COL.game}rem`, `${COL.result}rem`,
    ...cols.map(() => `${COL.stat}rem`),
  ].join(' ')
  const rowSx = { display: 'grid', gridTemplateColumns: template, columnGap: `${COL.gap}rem`, alignItems: 'center' } as const
  // No sort is the question's own order, which is its first stat, highest first: drawn as that.
  const active: FinderSort = sort ?? { key: headlineField, desc: true }
  const press = (key: string) => onSort({ key, desc: active.key === key ? !active.desc : true })
  const plainHead = { fontSize: TYPE_SCALE.micro, fontWeight: 800, color: 'text.secondary', whiteSpace: 'nowrap' } as const
  const head = (key: string, label: string, title: string, align: 'left' | 'right') => {
    const on = active.key === key
    return (
      <Box key={key} role="columnheader" aria-sort={on ? (active.desc ? 'descending' : 'ascending') : 'none'}
        sx={{ textAlign: align, minWidth: 0 }}>
        <Box component="button" type="button" title={title} onClick={() => press(key)} sx={{
          all: 'unset', ...FOCUS_RING, cursor: 'pointer', borderRadius: 0.5, whiteSpace: 'nowrap',
          fontSize: TYPE_SCALE.micro, fontWeight: 800,
          color: on || asked.includes(key) ? 'text.primary' : 'text.secondary',
          borderBottom: '2px solid', borderColor: on ? ACCENT_EDGE : 'transparent',
          ...hoverOnly({ color: 'text.primary' }),
        }}>
          {label}{on ? (active.desc ? ' ▾' : ' ▴') : ''}
        </Box>
      </Box>
    )
  }
  return (
    <Box role="table" aria-label="Matching games" aria-busy={loading || undefined}>
      <Box role="rowgroup">
        <Box role="row" sx={{ ...rowSx, px: 0.5, pb: 0.75 }}>
          <Box role="columnheader" sx={{ ...plainHead, textAlign: 'center' }}>#</Box>
          <Box role="columnheader" sx={plainHead}>Player</Box>
          {head('date', 'Game', 'Sort by date', 'left')}
          <Box role="columnheader" sx={plainHead}>Result</Box>
          {cols.map(c => head(c.key, c.unit, `Sort by ${c.label.toLowerCase()}`, 'right'))}
        </Box>
      </Box>
      <Box role="rowgroup">
        {loading
          ? Array.from({ length: RESULT_CAP }, (_, i) => (
            <Box key={i} role="row" aria-hidden sx={{ ...rowSx, px: 0.5, py: 0.85, borderTop: '1px solid', borderColor: 'divider' }}>
              <Box />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <Skeleton variant="circular" width={chromePx(PORTRAIT_PX)} height={chromePx(PORTRAIT_PX)} sx={{ flexShrink: 0 }} />
                <Typography sx={{ fontSize: TYPE_SCALE.body, flex: 1 }}><Skeleton width="70%" /></Typography>
              </Box>
              <Typography sx={{ fontSize: TYPE_SCALE.meta }}><Skeleton /></Typography>
              <Typography sx={{ fontSize: TYPE_SCALE.meta }}><Skeleton /></Typography>
              {cols.map(c => <Typography key={c.key} sx={{ fontSize: TYPE_SCALE.title }}><Skeleton /></Typography>)}
            </Box>
          ))
          : rows.map((r, i) => {
            const parts = rowParts(r)
            const label = gameLabel(r.game, r.teamId, clubAbbr)
            return (
              <Box key={r.key} role="row" sx={{
                ...rowSx, position: 'relative', px: 0.5, py: 0.85, borderRadius: 1,
                borderTop: '1px solid', borderColor: 'divider',
                ...(parts.gameLink ? TAPPABLE : {}),
              }}>
                <Box role="cell" sx={{ textAlign: 'center', fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                  {i + 1}
                </Box>
                <Box role="cell" sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                  {parts.portrait}
                  {/* Raised over the row's stretched game link, so the name still opens the player. */}
                  <NameText name={r.name} linkProps={parts.playerLink} sx={{
                    position: 'relative', zIndex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit',
                    fontSize: TYPE_SCALE.body, fontWeight: 700,
                    ...(parts.playerLink ? hoverOnly({ textDecoration: 'underline' }) : {}),
                  }} />
                  {parts.club && <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', flexShrink: 0 }}>{parts.club}</Box>}
                </Box>
                <Box role="cell" sx={{ minWidth: 0, whiteSpace: 'nowrap', fontSize: TYPE_SCALE.meta }}>
                  {parts.gameLink ? (
                    <Box component="a" {...parts.gameLink} sx={{
                      ...FOCUS_RING, color: ACCENT_EDGE, fontWeight: 700, textDecoration: 'none',
                      '&::after': { content: '""', position: 'absolute', inset: 0, borderRadius: 1 },
                      ...hoverOnly({ textDecoration: 'underline' }),
                    }}>{label}</Box>
                  ) : label}
                </Box>
                <Box role="cell" sx={{ whiteSpace: 'nowrap', fontSize: TYPE_SCALE.meta, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                  {gameResult(r.game, r.teamId)}
                </Box>
                {cols.map(c => {
                  const first = c.key === asked[0]
                  const isAsked = asked.includes(c.key)
                  return (
                    <Box key={c.key} role="cell" sx={{
                      textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                      fontSize: first ? TYPE_SCALE.title : TYPE_SCALE.body,
                      fontWeight: isAsked ? 800 : 500,
                      color: first ? ACCENT_EDGE : isAsked ? 'text.primary' : 'text.secondary',
                    }}>
                      {displayFinderValue(side, c.key, r.values[c.key] ?? 0)}
                    </Box>
                  )
                })}
              </Box>
            )
          })}
      </Box>
    </Box>
  )
}

export function FinderBoard<P extends LeaguePlayer, G extends LeagueGame>({
  side, query, onQuery, result, clubs, clubAbbr, intro, loading = false, renderRow, rowParts, tallyParts,
  sort, onSort, examples, stickyTop, parse, onAsk,
}: {
  side: FinderSide
  /** Owned by the section, which mirrors it into the address bar. */
  query: FinderQuery
  onQuery: (q: FinderQuery) => void
  result: FinderResult<P, G>
  /** The league's clubs for the club and opponent pickers, in the order to offer them. */
  clubs: { value: string; label: string }[]
  clubAbbr: (id: string) => string
  /** The line under the question's title: what the board searches. */
  intro: string
  /** While the lines are still coming (MLB reads them; WPBL already holds them). */
  loading?: boolean
  /** A matching line in the section's own parts (GameLineFrame, in game mode), for the list. */
  renderRow: (row: FinderRow<P, G>, i: number, unit: string) => React.ReactNode
  /** The same line's parts, for the table. */
  rowParts: (row: FinderRow<P, G>) => FinderRowParts
  /** The section's face, club mark and link for a tally row. */
  tallyParts: (t: FinderTally<P>) => Pick<LeaderItem, 'key' | 'name' | 'portrait' | 'badge' | 'linkProps'>
  /** The table's order. Held by the section, because the engine sorts before it caps. */
  sort: FinderSort | null
  onSort: (s: FinderSort | null) => void
  /** One-tap questions for this side. */
  examples: FinderExample[]
  /** Where the rail pins: under the section's pinned chrome. */
  stickyTop: string
  /** The question typed as words. The box is drawn only when both are given. */
  parse?: (text: string) => FinderReading[]
  onAsk?: (r: FinderReading) => void
}) {
  const [allRows, setAllRows] = useState(false)
  // FOLDED ONCE THERE IS AN ANSWER, wherever there is no rail. On a phone the form is a screen of
  // selects above the list it produced, so a question that arrived whole (a shared link, an example
  // chip, the typed box) opens folded to its one-line summary, and editing is one tap. A question
  // being built from the pickers stays open, since folding it under the reader's thumb would be
  // worse. Beside a rail there is room for both, so the fold is never drawn there.
  const [folded, setFolded] = useState(() => query.conditions.length > 0)
  const unit = finderUnit(side, result.headlineField)
  const clubOptions = (blank: string) => [{ value: '', label: blank }, ...clubs]
  const hasConditions = query.conditions.length > 0
  const isFolded = folded && hasConditions

  const setCondition = (i: number, c: FinderCondition) =>
    onQuery({ ...query, conditions: query.conditions.map((x, j) => (j === i ? c : x)) })
  const removeCondition = (i: number) => onQuery({ ...query, conditions: query.conditions.filter((_, j) => j !== i) })
  const addCondition = () => onQuery({ ...query, conditions: [...query.conditions, defaultCondition(side)] })
  const askWhole = (conditions: FinderCondition[]) => { onQuery({ ...query, conditions }); setFolded(true) }

  // A NUMBER AND A SENTENCE, not just a number. "12" over a list is a fact about a question the
  // reader may have changed three controls ago; "12 games where Strikeouts at least 5" is the
  // question read back, which is the only way to notice you asked the wrong one. Club and venue
  // included: `describeFinderQuery` knows only the stat conditions, and a summary that omits the
  // who and where claims a wider search than it ran. The unasked question gets its own wording,
  // since "612 games where every game line" reads as a bug.
  const games_ = result.total === 1 ? 'game' : 'games'
  const scopeText = scopeWords(query, clubAbbr)
  const total = result.total.toLocaleString()
  const summary = hasConditions
    ? `${total} ${games_} where ${describeFinderQuery(side, query)}${scopeText ? `, ${scopeText}` : ''}`
    : scopeText
      ? `${total} ${games_} ${scopeText}. Add a condition to narrow it.`
      : `Every line: ${total} ${games_}. Add a condition to narrow it.`
  const questionText = `${describeFinderQuery(side, query)}${scopeText ? `, ${scopeText}` : ''}`
  const shownRows = allRows ? result.rows : result.rows.slice(0, RESULT_CAP)

  // Competition ranks over the games counts: 1, 1, 3.
  const tally = result.tally.slice(0, TALLY_SHOWN)
  const tallyItems: LeaderItem[] = tally.map(t => ({
    ...tallyParts(t),
    rank: tally.findIndex(x => x.games === t.games) + 1,
    tied: tally.filter(x => x.games === t.games).length > 1,
    value: String(t.games),
    valueNote: `of ${t.played}`,
  }))
  // NOBODY TWICE IS AN ANSWER, and a ranking buries it. Four rows all reading "T-1, 1" say only that
  // every match was a different player, under a title promising a leader; a sentence says it.
  const onceEach = result.tally.length > 0 && result.tally[0].games === 1
  const who = side === 'pitching' ? ['pitcher', 'pitchers'] : ['hitter', 'hitters']

  const tableRem = tableMinRem(finderColumns(side, query).length)
  // The rail switches on the STANDARD line's width rather than this question's, so a condition that
  // adds a column cannot fold the rail away under the reader's hand while they build the question.
  const railRem = RAIL_REM + PANE_GAP_REM + tableMinRem(finderColumns(side, { conditions: [] }).length)
  const inRail = `@container finder (min-width: ${railRem}rem)`
  const tableOn = `@container finder-main (min-width: ${tableRem}rem)`
  const besideRem = tableRem + PANE_GAP_REM + TALLY_REM
  const tallyBeside = `@container finder-main (min-width: ${besideRem}rem)`
  // Under the table but with the width for two of it, the tally runs down two columns: one column
  // across a wide desktop is ten names with a screen of nothing between each and its count.
  const tallySplit = `@container finder-main (min-width: ${2 * TALLY_REM + 2}rem) and (max-width: ${besideRem - 0.01}rem)`
  const listOnly = { display: 'block', [tableOn]: { display: 'none' } }
  const tableOnly = { display: 'none', [tableOn]: { display: 'block' } }

  const question = (
    <SectionCard title="The question" subtitle={intro} action={<CopyLink />}>
      {/* Folded: the question in one line, which is also the way back in. */}
      {hasConditions && (
        <Box {...pressable(() => setFolded(false))} aria-expanded={false} sx={{
          ...FOCUS_RING,
          display: isFolded ? 'flex' : 'none', [inRail]: { display: 'none' },
          alignItems: 'center', gap: 1, mt: 0.5, px: 1.25, py: 0.75, minHeight: chromePx(40), cursor: 'pointer',
          borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER, ...TAPPABLE,
        }}>
          <Typography sx={{ flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: 700, overflowWrap: 'anywhere' }}>
            {questionText}
          </Typography>
          <Box component="span" sx={{ flexShrink: 0, fontSize: TYPE_SCALE.meta, fontWeight: 800, color: ACCENT_EDGE }}>Edit</Box>
        </Box>
      )}
      <Box sx={{
        display: isFolded ? 'none' : 'flex', [inRail]: { display: 'flex' },
        flexDirection: 'column', gap: 1, pt: 0.5,
      }}>
        {parse && onAsk && (
          <AskBox side={side} parse={parse} clubAbbr={clubAbbr} onAsk={r => { onAsk(r); setFolded(true) }} />
        )}

        {examples.length > 0 && (
          // One row that scrolls sideways on a phone, where the chips wrapped would be a block of
          // their own above the form; wrapped wherever there is the width.
          <Box role="group" aria-label="Example questions" sx={{
            display: 'flex', gap: 0.75, flexWrap: { xs: 'nowrap', sm: 'wrap' }, overflowX: { xs: 'auto', sm: 'visible' },
            mx: { xs: -2, sm: 0 }, px: { xs: 2, sm: 0 }, py: 0.25,
            scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' },
          }}>
            {examples.map(ex => {
              const on = sameConditions(ex.conditions, query.conditions)
              return (
                <Box key={ex.label} {...pressable(() => askWhole(ex.conditions))} aria-pressed={on} sx={{
                  ...FOCUS_RING, flexShrink: 0, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                  display: 'inline-flex', alignItems: 'center', minHeight: chromePx(28), px: 1.25, borderRadius: 999,
                  border: '1px solid', borderColor: on ? ACCENT_EDGE : CARD_BORDER,
                  color: on ? ACCENT_EDGE : 'text.secondary', fontSize: TYPE_SCALE.meta, fontWeight: 700,
                  ...hoverOnly({ color: 'text.primary' }),
                }}>{ex.label}</Box>
              )
            })}
          </Box>
        )}

        {query.conditions.map((c, i) => (
          <ConditionRow key={i} side={side} n={i + 1} condition={c}
            onChange={next => setCondition(i, next)} onRemove={() => removeCondition(i)} />
        ))}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
          {query.conditions.length < MAX_CONDITIONS && (
            <Box {...pressable(addCondition)} sx={{
              ...textButtonSx, gap: 0.5, border: '1px dashed', borderColor: CARD_BORDER,
              ...hoverOnly({ borderColor: ACCENT_EDGE, color: 'text.primary' }),
            }}>+ Add a condition</Box>
          )}
          {hasConditions && (
            <Box {...pressable(() => { onQuery({ ...query, conditions: [] }); setFolded(false) })} sx={textButtonSx}>Clear</Box>
          )}
          {hasConditions && (
            <Box {...pressable(() => setFolded(true))} sx={{
              ...textButtonSx, ml: 'auto', color: ACCENT_EDGE, [inRail]: { display: 'none' },
            }}>Done</Box>
          )}
        </Box>

        {/* WHO AND WHERE, kept apart from the conditions above because they are a different kind
            of question: those ask what happened in a game, these ask which games to look at. */}
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap',
          pt: 1, mt: 0.5, borderTop: '1px solid', borderColor: 'divider',
        }}>
          {/* The club and the venue read as one clause ("New York, at home"), so they stay on one
              row; the opponent is the one that wraps on a phone, before this pair may split. */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', maxWidth: '100%' }}>
            <Picker label="Club" value={query.teamId ?? ''} options={clubOptions('Any club')}
              onChange={v => onQuery({ ...query, teamId: v || null })} />
            <Picker label="Home or away" value={query.venue}
              options={[
                { value: 'any', label: 'Home or away' },
                { value: 'home', label: 'At home' },
                { value: 'away', label: 'On the road' },
              ]}
              onChange={v => onQuery({ ...query, venue: v as FinderVenue })} />
          </Box>
          <Picker label="Opponent" value={query.oppId ?? ''} options={clubOptions('Any opponent')}
            onChange={v => onQuery({ ...query, oppId: v || null })} />
        </Box>
      </Box>
    </SectionCard>
  )

  const table = (
    <ResultTable side={side} query={query} rows={shownRows} sort={sort} onSort={onSort}
      headlineField={result.headlineField} clubAbbr={clubAbbr} rowParts={rowParts} loading={loading} />
  )

  return (
    /* LEFT-ALIGNED WITH THE PAGE. The board starts where the tabs and the controls bar above it
       start; centred, it sat 300px in from them on a desktop and read as a different page. Below
       `md` it keeps the ordinary board column's cap, so a tablet's form does not stretch across. */
    <Box sx={{ containerType: 'inline-size', containerName: 'finder', width: '100%' }}>
      <Box sx={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', alignItems: 'start',
        gap: { xs: 1.5, sm: 2 }, maxWidth: { xs: BOARD_COLUMN, md: 'none' },
        [inRail]: { gridTemplateColumns: `${RAIL_REM}rem minmax(0, 1fr)`, columnGap: `${PANE_GAP_REM}rem` },
      }}>
        {/* THE RAIL PINS under the section's chrome, so the question stays in reach while the answers
            scroll, and scrolls itself if a long question is taller than the window. */}
        <Box sx={{
          minWidth: 0,
          [inRail]: {
            position: 'sticky', top: `calc(${stickyTop} + ${chromePx(12)})`,
            maxHeight: `calc(100vh - ${stickyTop} - ${chromePx(24)})`, overflowY: 'auto',
          },
        }}>
          {question}
        </Box>

        <Box sx={{ minWidth: 0, containerType: 'inline-size', containerName: 'finder-main' }}>
          <Box sx={{
            display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', alignItems: 'start', gap: { xs: 1.5, sm: 2 },
            [tallyBeside]: { gridTemplateColumns: `minmax(0, 1fr) ${TALLY_REM}rem`, columnGap: `${PANE_GAP_REM}rem` },
          }}>
            {/* A no-break space while loading: a plain one collapses, and the line with it. */}
            <SectionCard title="Matching games" subtitle={loading ? String.fromCharCode(160) : summary}>
              {loading ? (
                <>
                  <Box sx={listOnly}>{Array.from({ length: RESULT_CAP }, (_, i) => <RowSkeleton key={i} divider={i > 0} />)}</Box>
                  <Box sx={tableOnly}>{table}</Box>
                  {/* The expand row a season's worth of matches always brings, so the card does not grow
                      by it when they land and push the tally under it on a phone. */}
                  <ExpandRow flush expanded={false} moreLabel="Show top 50 games" onToggle={() => {}} />
                </>
              ) : result.rows.length === 0 ? (
                <Box sx={{ py: 2 }}>
                  <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, mb: 0.5 }}>Nothing matched</Typography>
                  {/* SAYING WHAT WAS SEARCHED is what separates "nobody has done this" from "your
                      filters left nothing to look at". */}
                  <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
                    Searched {result.searched.toLocaleString()} {result.searched === 1 ? 'line' : 'lines'}
                    {side === 'pitching' ? ' from pitchers who appeared' : ' from batters who came to the plate'}.
                    Loosen a condition, or widen the club and venue.
                  </Typography>
                </Box>
              ) : (
                <>
                  {/* BOTH DRAWN, ONE SHOWN, so which one is a matter of the width alone and the first
                      paint is already the right one: a measured switch would paint the list and then
                      replace it. */}
                  <Box sx={listOnly}>{shownRows.map((r, i) => renderRow(r, i, unit))}</Box>
                  <Box sx={tableOnly}>{table}</Box>
                  {result.rows.length > RESULT_CAP && (
                    <ExpandRow flush expanded={allRows}
                      moreLabel={result.total > result.rows.length ? `Show top ${result.rows.length} games` : `Show all ${result.rows.length} games`}
                      onToggle={() => setAllRows(v => !v)} />
                  )}
                  {/* The engine caps what it returns, so a question matching half the league does not
                      hand the page six hundred rows. Said once the reader has expanded to the cap, since
                      a list that stops at fifty with nothing explaining it reads as the answer. */}
                  {allRows && result.total > result.rows.length && (
                    <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', textAlign: 'center', pt: 1 }}>
                      Showing the top {result.rows.length} of {total}. Narrow the question to see the rest.
                    </Typography>
                  )}
                </>
              )}
            </SectionCard>

            {/* THE SECOND ANSWER, and the more interesting one. The list says when it happened; this
                says who does it, which is the question behind most of the questions people bring. Free
                once the matching is done, on the Leaders board's card so it reads as those rows do.
                "of 11" beside a count is the player's appearances in the games searched, which is
                what separates doing it a lot from playing a lot. */}
            {loading
              ? <LeaderCardSkeleton title="Most games matching" rows={TALLY_SHOWN} seeAll={false} splitWhen={tallySplit} />
              : onceEach ? (
                <SectionCard bare title="Most games matching">
                  <Typography sx={{ py: 1, fontSize: TYPE_SCALE.body, color: 'text.secondary', lineHeight: 1.5 }}>
                    {result.tally.length === 1
                      ? `One ${who[0]}, once. Nobody has done it twice.`
                      : `${result.tally.length.toLocaleString()} ${who[1]}, once each. Nobody has done it twice.`}
                  </Typography>
                </SectionCard>
              )
              : <LeaderCard title="Most games matching" empty="Nobody yet." items={tallyItems} splitWhen={tallySplit} />}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

import React, { useEffect, useRef, useState } from 'react'
import { Box, Skeleton, Typography } from '@mui/material'
import {
  finderFieldGroups, finderUnit, finderColumns, defaultCondition, parseFinderValue, unparseFinderValue,
  displayFinderValue, describeFinderQuery, finderLowerBetter, conditionsForPer,
  FINDER_OPS,
  type FinderCondition, type FinderOp, type FinderPer, type FinderQuery, type FinderResult, type FinderRow,
  type FinderBoardSide, type FinderSort, type FinderTally, type FinderVenue,
} from '../league/finder'
import { GameLineFrame } from './gameLine'
import { shortDate } from '../lib/format'
import type { LeagueGame, LeaguePlayer } from '../league/types'
import { SectionCard, SectionLabel, TYPE_SCALE, CARD_BORDER, ACCENT_EDGE } from './card'
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
// one 720px column centered in a 1540px page: a form over two cards with a gutter either side, and
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
const tableMinRem = (stats: number, per: FinderPer = 'game') => per === 'season'
  ? COL.rank + COL.player + stats * COL.stat + (stats + 1) * COL.gap + 2.5
  : COL.rank + COL.player + COL.game + COL.result + stats * COL.stat + (stats + 3) * COL.gap + 2.5
/** The rail's width, and the tally's when it sits beside the table. Wide enough for a condition on
 *  one line (CONDITION_COLUMNS): at 22 the value and its ✕ wrapped under every row. */
const RAIL_REM = 24
const TALLY_REM = 17
const PANE_GAP_REM = 1.25
/** What a season question searches, the same in both sections. */
// A FIELD IS SQUARE-CORNERED AND ONLY A FIELD IS. The grain switch is a pill toggle and the examples
// are links; when all three were the same rounded outline, the form read as a heap of identical
// chips with no telling which one was the question.
const fieldSx = {
  ...FOCUS_RING,
  minHeight: chromePx(34), py: 0.4,
  borderRadius: 1.5, border: '1px solid', borderColor: CARD_BORDER,
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
 * gray 3D box that looks like a bug next to the rest of the bar.
 */
function Picker({ value, onChange, options, groups, label, title, sx }: {
  value: string
  onChange: (v: string) => void
  options?: { value: string; label: string }[]
  /** Options under headings, for the stat picker. */
  groups?: { label: string; options: { value: string; label: string }[] }[]
  label: string
  title?: string
  sx?: object
}) {
  return (
    <Box component="select" aria-label={label} title={title} value={value}
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
        textOverflow: 'ellipsis',
        ...sx,
      }}>
      {options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      {groups?.map(g => (
        <optgroup key={g.label} label={g.label}>
          {g.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </optgroup>
      ))}
    </Box>
  )
}

/** A condition's four columns. ONE LINE AT EVERY WIDTH, which is the whole point: sized to their
 *  content, the four wrapped in the desktop rail and on a phone, leaving a value and a ✕ on a line
 *  of their own under every stat. The stat takes what is left; the comparison is a symbol, so its
 *  column is narrow and fixed, and every row's columns line up under the last. */
const CONDITION_COLUMNS = `minmax(0, 1fr) 3rem 3.75rem ${chromePx(34)}`

/** One `stat op value` row. `n` is the 1-based position, spoken into the labels so a screen reader
 *  with several conditions can tell the rows apart. */
function ConditionRow({ side, per, n, condition, onChange, onRemove }: {
  side: FinderBoardSide
  per: FinderPer
  n: number
  condition: FinderCondition
  onChange: (c: FinderCondition) => void
  onRemove: () => void
}) {
  // WHAT THE READER TYPED, UNTIL THEY LEAVE THE BOX. The stored value is normalized (innings are
  // outs), so a purely controlled input rewrites itself under the cursor: type "4" in the innings
  // field and it becomes "4.0", and the next keystroke lands after the zero. Backspacing to empty is
  // the other half, where the parse floors at 0 and the box refills with "0". The query itself
  // updates on every keystroke either way: the draft is about what is DRAWN.
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => { setDraft(null) }, [condition.field])
  const op = FINDER_OPS.find(o => o.op === condition.op)
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: CONDITION_COLUMNS, alignItems: 'center', columnGap: 0.75 }}>
      <Picker label={`Stat, condition ${n}`} value={condition.field} sx={{ width: '100%' }}
        groups={finderFieldGroups(side, per).map(g => ({ label: g.label, options: g.fields.map(f => ({ value: f.key, label: f.label })) }))}
        onChange={field => onChange({ ...condition, field })} />
      {/* THE SYMBOL, with the words in the tooltip, the accessible name and the summary sentence
          over the results. "at least" made this column as wide as the stat's. */}
      <Picker label={`Comparison, condition ${n}: ${op?.label ?? ''}`} title={op?.label} value={condition.op}
        sx={{ width: '100%', pl: 1, pr: 2.25, backgroundPosition: 'right 10px center, right 5px center' }}
        options={FINDER_OPS.map(o => ({ value: o.op, label: o.symbol }))}
        onChange={o => onChange({ ...condition, op: o as FinderOp })} />
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
        sx={{ ...fieldSx, boxSizing: 'border-box', width: '100%', minWidth: 0, px: 0.75, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }} />
      <Box {...pressable(onRemove)} aria-label={`Remove condition ${n}`} sx={{
        ...FOCUS_RING,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        width: chromePx(34), height: chromePx(34), borderRadius: 999, cursor: 'pointer', userSelect: 'none',
        color: 'text.secondary', fontSize: TYPE_SCALE.body, fontWeight: 800,
        ...hoverOnly({ color: 'text.primary', bgcolor: 'action.hover' }),
      }}>✕</Box>
    </Box>
  )
}

/** A question worth one tap, offered as a chip. The section's own, since what counts as a long
 *  start differs between a seven-inning league and a nine-inning one. */
export interface FinderExample {
  label: string
  conditions: FinderCondition[]
  /** A season question, offered under Season totals. Absent is a game question. */
  per?: FinderPer
}

/** One way a typed question can be read, in the shape src/league/finderParse.ts returns. */
export interface FinderReading {
  side: FinderBoardSide
  per: FinderPer
  conditions: FinderCondition[]
  teamId: string | null
  oppId: string | null
  venue: FinderVenue
  /** Words that were not understood, said back so a dropped name is visible. */
  ignored: string[]
}

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
  side: FinderBoardSide
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
      <Box component="input" type="search" aria-label="Ask in words" placeholder="3 hits at home, 5 HR on the season"
        value={text} enterKeyHint="search"
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); ask() } }}
        sx={{ ...fieldSx, boxSizing: 'border-box', width: '100%', px: 1.5, fontWeight: 600, '&::placeholder': { color: 'text.secondary', opacity: 1 } }} />
      {/* DRAWN ONLY WHILE THERE IS TEXT. Reserved always, it was a blank band between the box and
          the conditions that read as a gap in the form; it opens on the first keystroke, which is
          the reader's own input moving the page, and then holds its height while they type. */}
      <Box aria-live="polite" sx={{ minHeight: '1.75rem', display: text.trim() ? 'flex' : 'none', alignItems: 'center', px: 0.5 }}>
        {!text.trim() ? null : best ? (
          <Box {...pressable(ask)} sx={{
            ...FOCUS_RING, minWidth: 0, cursor: 'pointer', borderRadius: 1, px: 0.5, mx: -0.5,
            fontSize: TYPE_SCALE.meta, color: 'text.secondary', ...TAPPABLE,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            <Box component="span" sx={{ fontWeight: 800, color: ACCENT_EDGE }}>Ask ›</Box>{' '}
            {best.per === 'season' && 'Season: '}{describeFinderQuery(best.side, best)}
            {scope && `, ${scope}`}
            {best.side !== side && ` (${best.side})`}
            {best.ignored.length > 0 && `. Ignored: ${best.ignored.join(' ')}`}
          </Box>
        ) : (
          <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Name a stat and a number: 3 hits, 0 walks, .300 on the season.
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

/** "Aug 2 at BOS", the game a line came from, with home or away off the line's own club. */
function gameLabel(game: LeagueGame | null, teamId: string | null, clubAbbr: (id: string) => string): string {
  if (!game) return ''
  const date = shortDate(game.game_date)
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
  side: FinderBoardSide
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
  // A SEASON ROW IS A PLAYER, so it has no night and no result: the player is its one destination,
  // and the columns start straight after the name.
  const season = query.per === 'season'
  const template = [
    `${COL.rank}rem`, `minmax(${COL.player}rem, 1fr)`, ...(season ? [] : [`${COL.game}rem`, `${COL.result}rem`]),
    ...cols.map(() => `${COL.stat}rem`),
  ].join(' ')
  const rowSx = { display: 'grid', gridTemplateColumns: template, columnGap: `${COL.gap}rem`, alignItems: 'center' } as const
  // No sort is the question's own order, which is its first stat from the good end: drawn as that.
  // A first press on a column starts at its good end too, so a press on ERA is the best ERA.
  const best = (key: string) => !finderLowerBetter(side, key)
  const active: FinderSort = sort ?? { key: headlineField, desc: best(headlineField) }
  const press = (key: string) => onSort({ key, desc: active.key === key ? !active.desc : best(key) })
  const stretched = { '&::after': { content: '""', position: 'absolute', inset: 0, borderRadius: 1 } } as const
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
    <Box role="table" aria-label={season ? 'Matching seasons' : 'Matching games'} aria-busy={loading || undefined}>
      <Box role="rowgroup">
        <Box role="row" sx={{ ...rowSx, px: 0.5, pb: 0.75 }}>
          <Box role="columnheader" sx={{ ...plainHead, textAlign: 'center' }}>#</Box>
          <Box role="columnheader" sx={plainHead}>Player</Box>
          {!season && head('date', 'Game', 'Sort by date', 'left')}
          {!season && <Box role="columnheader" sx={plainHead}>Result</Box>}
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
              {!season && <Typography sx={{ fontSize: TYPE_SCALE.meta }}><Skeleton /></Typography>}
              {!season && <Typography sx={{ fontSize: TYPE_SCALE.meta }}><Skeleton /></Typography>}
              {cols.map(c => <Typography key={c.key} sx={{ fontSize: TYPE_SCALE.title }}><Skeleton /></Typography>)}
            </Box>
          ))
          : rows.map((r, i) => {
            const parts = rowParts(r)
            const label = gameLabel(r.game, r.teamId, clubAbbr)
            const rowLink = season ? parts.playerLink : parts.gameLink
            return (
              <Box key={r.key} role="row" sx={{
                ...rowSx, position: 'relative', px: 0.5, py: 0.85, borderRadius: 1,
                borderTop: '1px solid', borderColor: 'divider',
                ...(rowLink ? TAPPABLE : {}),
              }}>
                <Box role="cell" sx={{ textAlign: 'center', fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                  {i + 1}
                </Box>
                <Box role="cell" sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                  {parts.portrait}
                  {/* Raised over the row's stretched game link, so the name still opens the player. On a
                      season row the name IS the row's link, stretched over it. */}
                  <NameText name={r.name} linkProps={parts.playerLink} sx={{
                    ...(season ? {} : { position: 'relative', zIndex: 1 }),
                    minWidth: 0, textDecoration: 'none', color: 'inherit',
                    fontSize: TYPE_SCALE.body, fontWeight: 700,
                    ...(parts.playerLink ? hoverOnly({ textDecoration: 'underline' }) : {}),
                    ...(season && parts.playerLink ? stretched : {}),
                  }} />
                  {parts.club && <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', flexShrink: 0 }}>{parts.club}</Box>}
                </Box>
                {!season && (
                  <Box role="cell" sx={{ minWidth: 0, whiteSpace: 'nowrap', fontSize: TYPE_SCALE.meta }}>
                    {parts.gameLink ? (
                      <Box component="a" {...parts.gameLink} sx={{
                        ...FOCUS_RING, color: ACCENT_EDGE, fontWeight: 700, textDecoration: 'none',
                        ...stretched, ...hoverOnly({ textDecoration: 'underline' }),
                      }}>{label}</Box>
                    ) : label}
                  </Box>
                )}
                {!season && (
                  <Box role="cell" sx={{ whiteSpace: 'nowrap', fontSize: TYPE_SCALE.meta, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                    {gameResult(r.game, r.teamId)}
                  </Box>
                )}
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

/** A season row for the list: the shared game-line frame with the player as its one link, since a
 *  season has no night for the row to open. */
function SeasonRow<P extends LeaguePlayer, G extends LeagueGame>({ row, i, unit, parts, accent }: {
  row: FinderRow<P, G>
  i: number
  unit: string
  parts: FinderRowParts
  accent?: string
}) {
  return (
    <GameLineFrame rank={i + 1} emphasizeRank={false} portrait={parts.portrait} name={row.name} club={parts.club}
      label={null} detail={row.detail} value={row.headlineDisplay} unit={unit} divider={i > 0}
      accent={accent} rowLink={parts.playerLink} />
  )
}

export function FinderBoard<P extends LeaguePlayer, G extends LeagueGame>({
  side, query, onQuery, result, clubs, clubAbbr, loading = false, renderRow, rowParts, tallyParts,
  sort, onSort, examples, stickyTop, parse, onAsk, accent,
}: {
  side: FinderBoardSide
  /** Owned by the section, which mirrors it into the address bar. */
  query: FinderQuery
  onQuery: (q: FinderQuery) => void
  result: FinderResult<P, G>
  /** The league's clubs for the club and opponent pickers, in the order to offer them. */
  clubs: { value: string; label: string }[]
  clubAbbr: (id: string) => string
  /** The line under the question's title: what the board searches. */
  /** While the lines are still coming (MLB reads them; WPBL already holds them). */
  loading?: boolean
  /** A matching game line in the section's own parts (GameLineFrame, in game mode), for the list.
   *  A season row is drawn here, from `rowParts`, since it has no game for a section's row to show. */
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
  /** The section's accent for a season row's number, as its game rows use. */
  accent?: string
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
  const season = query.per === 'season'
  const addCondition = () => onQuery({ ...query, conditions: [...query.conditions, defaultCondition(side, query.per, query.conditions)] })
  const askWhole = (ex: FinderExample) => { onQuery({ ...query, per: ex.per ?? 'game', conditions: ex.conditions }); setFolded(true) }
  // A switch of grain keeps every condition the other grain can ask. "3+ home runs" means something
  // over a season too, and is a better start than an empty form; a rate has no meaning in one game,
  // so going back to games drops it. Bare, a season opens on its headline rate, since a season of
  // every line ranks nobody.
  const setPer = (per: FinderPer) => {
    if (per === query.per) return
    const kept = conditionsForPer(side, per, query.conditions)
    onQuery({ ...query, per, conditions: kept.length || per === 'game' ? kept : [defaultCondition(side, per)] })
  }

  // A NUMBER AND A SENTENCE, not just a number. "12" over a list is a fact about a question the
  // reader may have changed three controls ago; "12 games where Strikeouts at least 5" is the
  // question read back, which is the only way to notice you asked the wrong one. Club and venue
  // included: `describeFinderQuery` knows only the stat conditions, and a summary that omits the
  // who and where claims a wider search than it ran. The unasked question gets its own wording,
  // since "612 games where every game line" reads as a bug.
  const who = side === 'pitching' ? ['pitcher', 'pitchers'] : side === 'fielding' ? ['fielder', 'fielders'] : ['hitter', 'hitters']
  const games_ = season ? (result.total === 1 ? who[0] : who[1]) : result.total === 1 ? 'game' : 'games'
  const scopeText = scopeWords(query, clubAbbr)
  const total = result.total.toLocaleString()
  const summary = hasConditions
    ? `${total} ${games_} where ${describeFinderQuery(side, query)}${scopeText ? `, ${scopeText}` : ''}`
    : scopeText
      ? `${total} ${games_} ${scopeText}`
      : `${total} ${games_}`
  const questionText = `${season ? 'Season: ' : ''}${describeFinderQuery(side, query)}${scopeText ? `, ${scopeText}` : ''}`
  // SAID, because a bar the reader did not set is a filter they cannot see. The way past it is part
  // of the sentence, since "where is the 2-for-4 hitter" has an answer and it is one condition away.
  const qualifierNote = result.qualifier
    ? result.qualifier.field === 'pa'
      ? `Qualified hitters only: ${result.qualifier.min} plate appearances or more. Add a plate appearances condition to set your own bar.`
      : result.qualifier.field === 'g'
        ? `Qualified fielders only: ${result.qualifier.min} games or more. Add a games played condition to set your own bar.`
        : `Qualified pitchers only: ${displayFinderValue(side, 'ip', result.qualifier.min)} innings or more. Add an innings condition to set your own bar.`
    : null
  // Offered only to an empty form: an example replaces the conditions, so once there are some it is a
  // way to lose them, and the chips sat between the typed box and the rows they would overwrite.
  const shownExamples = hasConditions ? [] : examples.filter(ex => (ex.per ?? 'game') === query.per)
  // The same words loading and loaded, so the row does not reflow when the answer lands. A game
  // question nearly always runs past the cap; a season one is a list of a few dozen at most, so it
  // names no count the skeleton would have to guess.
  const moreLabel = season
    ? `Show more ${who[1]}`
    : `Show ${loading || result.total > result.rows.length ? 'top' : 'all'} ${loading ? 50 : result.rows.length} games`
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

  const tableRem = tableMinRem(finderColumns(side, query).length, query.per)
  // The rail switches on the STANDARD line's width rather than this question's, so a condition that
  // adds a column cannot fold the rail away under the reader's hand while they build the question.
  // The game line's whichever grain is asked, so switching to seasons does not move it either.
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
    <SectionCard title="Search" action={<CopyLink />}>
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
        {/* THE GRAIN, first because it changes what every control under it means: "3+ home runs" is a
            night or a body of work. */}
        <Box role="radiogroup" aria-label="Search" sx={{
          display: 'flex', alignSelf: 'flex-start', p: 0.25, gap: 0.25,
          borderRadius: 999, border: '1px solid', borderColor: CARD_BORDER,
        }}>
          {([['game', 'Single games'], ['season', 'Season totals']] as const).map(([per, label]) => {
            const on = query.per === per
            return (
              <Box key={per} role="radio" aria-checked={on} {...pressable(() => setPer(per))} sx={{
                ...FOCUS_RING, display: 'inline-flex', alignItems: 'center', minHeight: chromePx(28), px: 1.25,
                borderRadius: 999, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                fontSize: TYPE_SCALE.meta, fontWeight: 700,
                bgcolor: on ? 'action.selected' : 'transparent', color: on ? 'text.primary' : 'text.secondary',
                ...hoverOnly({ color: 'text.primary' }),
              }}>{label}</Box>
            )
          })}
        </Box>

        {parse && onAsk && (
          <AskBox side={side} parse={parse} clubAbbr={clubAbbr} onAsk={r => { onAsk(r); setFolded(true) }} />
        )}

        {/* THE CONDITIONS READ AS A SENTENCE: "and" between rows, since every condition is AND and a
            stack of identical rows said nothing about how they combine. */}
        {query.conditions.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && (
              <Typography aria-hidden sx={{ fontSize: TYPE_SCALE.micro, fontWeight: 800, color: 'text.secondary', px: 0.5, mt: -0.5, mb: -0.5 }}>and</Typography>
            )}
            <ConditionRow side={side} per={query.per} n={i + 1} condition={c}
              onChange={next => setCondition(i, next)} onRemove={() => removeCondition(i)} />
          </React.Fragment>
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

        {shownExamples.length > 0 && (
          // LINKS, NOT CHIPS: a shortcut to a whole question is a different kind of thing from the
          // fields that build one, and wrapped as text they take two lines on a phone where a row
          // of chips scrolled off the side of the card.
          <Box role="group" aria-label="Example questions" sx={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 1.25, rowGap: 0.25,
            fontSize: TYPE_SCALE.meta,
          }}>
            <Box component="span" sx={{ color: 'text.secondary', fontWeight: 700 }}>Try</Box>
            {shownExamples.map(ex => (
              <Box key={ex.label} {...pressable(() => askWhole(ex))} sx={{
                ...FOCUS_RING, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', borderRadius: 0.5,
                color: ACCENT_EDGE, fontWeight: 700, ...hoverOnly({ textDecoration: 'underline' }),
              }}>{ex.label}</Box>
            ))}
          </Box>
        )}

        {/* WHO AND WHERE, kept apart from the conditions above because they are a different kind
            of question: those ask what happened in a game, these ask which games to look at. */}
        <Box sx={{ pt: 1.25, mt: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
        <SectionLabel>Club and venue</SectionLabel>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
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
      </Box>
    </SectionCard>
  )

  const table = (
    <ResultTable side={side} query={query} rows={shownRows} sort={sort} onSort={onSort}
      headlineField={result.headlineField} clubAbbr={clubAbbr} rowParts={rowParts} loading={loading} />
  )

  return (
    /* LEFT-ALIGNED WITH THE PAGE. The board starts where the tabs and the controls bar above it
       start; centered, it sat 300px in from them on a desktop and read as a different page. Below
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
            ...(season ? {} : { [tallyBeside]: { gridTemplateColumns: `minmax(0, 1fr) ${TALLY_REM}rem`, columnGap: `${PANE_GAP_REM}rem` } }),
          }}>
            {/* A no-break space while loading: a plain one collapses, and the line with it. */}
            <SectionCard title={season ? 'Matching seasons' : 'Matching games'} subtitle={loading ? String.fromCharCode(160) : summary}>
              {!loading && qualifierNote && (
                <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', pb: 1 }}>{qualifierNote}</Typography>
              )}
              {loading ? (
                <>
                  <Box sx={listOnly}>{Array.from({ length: RESULT_CAP }, (_, i) => <RowSkeleton key={i} divider={i > 0} />)}</Box>
                  <Box sx={tableOnly}>{table}</Box>
                  {/* The expand row a season's worth of matches always brings, so the card does not grow
                      by it when they land and push the tally under it on a phone. */}
                  <ExpandRow flush expanded={false} moreLabel={moreLabel} onToggle={() => {}} />
                </>
              ) : result.rows.length === 0 ? (
                <Box sx={{ py: 2 }}>
                  <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, mb: 0.5 }}>Nothing matched</Typography>
                  {/* SAYING WHAT WAS SEARCHED is what separates "nobody has done this" from "your
                      filters left nothing to look at". */}
                  <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
                    {season
                      ? `Searched the seasons of ${result.searched.toLocaleString()} ${result.searched === 1 ? who[0] : who[1]}.`
                      : `Searched ${result.searched.toLocaleString()} ${result.searched === 1 ? 'line' : 'lines'}${side === 'pitching' ? ' from pitchers who appeared' : side === 'fielding' ? ' from fielders who were in on a play' : ' from batters who came to the plate'}.`}
                    {' '}Loosen a condition, or widen the club and venue.
                  </Typography>
                </Box>
              ) : (
                <>
                  {/* BOTH DRAWN, ONE SHOWN, so which one is a matter of the width alone and the first
                      paint is already the right one: a measured switch would paint the list and then
                      replace it. */}
                  <Box sx={listOnly}>{shownRows.map((r, i) => season ? (
                    <SeasonRow key={r.key} row={r} i={i} unit={unit} parts={rowParts(r)} accent={accent} />
                  ) : renderRow(r, i, unit))}</Box>
                  <Box sx={tableOnly}>{table}</Box>
                  {result.rows.length > RESULT_CAP && (
                    <ExpandRow flush expanded={allRows}
                      moreLabel={moreLabel}
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
            {season ? null : loading
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

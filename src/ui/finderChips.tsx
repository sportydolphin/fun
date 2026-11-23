// THE FIND BOARD'S QUESTION AS CHIPS: each piece of it a chip, and a tap on one opens that piece and
// nothing else. A popover beside the chip where there is a pointer and room, a sheet from the bottom on
// a phone. Until Nov 10, 2026 the question was a form: three rows of pills, then a stack of native
// selects for every stat, comparison and number, then four more selects for the clubs and the dates,
// all open at once, so asking "8 strikeouts" meant scrolling past the whole form to see what it found.
//
// EDITS APPLY AS THEY ARE MADE. The board under the sheet answers each change, and the sheet says the
// count as it goes, so "Show 23 games" needs no draft question kept apart from the real one: Done just
// closes it. Closing never undoes, which is what a reader expects of a filter.
//
// Shared by both sections through the board (src/ui/finderBoard.tsx), which owns the question.

import React, { useEffect, useState } from 'react'
import { Box, Drawer, Popover, Typography, useMediaQuery, useTheme } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import {
  FINDER_OPS, finderFieldGroups, finderLowerBetter, finderSigned, finderStep, parseFinderValue, unparseFinderValue,
  type FinderBoardSide, type FinderCondition, type FinderOp, type FinderPer,
} from '../league/finder'
import { ACCENT_EDGE, CARD_BORDER, SectionLabel, TYPE_SCALE } from './card'
import { FOCUS_RING, hoverOnly, pressable } from './interaction'
import { PillGroup } from './PillGroup'
import { chromePx } from './scale'

/** A quiet text button, for Done and Remove. */
const textButtonSx = {
  ...FOCUS_RING,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  minHeight: chromePx(34), px: 1.25, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
  fontSize: TYPE_SCALE.meta, fontWeight: 700,
} as const

/** A square-cornered field, as the board's own (a field is square, a chip is round). */
const fieldSx = {
  ...FOCUS_RING,
  boxSizing: 'border-box', minHeight: chromePx(38), borderRadius: 1.5, border: '1px solid', borderColor: CARD_BORDER,
  bgcolor: 'background.paper', color: 'text.primary', fontFamily: 'inherit',
  fontSize: TYPE_SCALE.body, fontWeight: 700,
} as const

// ─── The surface ──────────────────────────────────────────────────────────────

/**
 * Where a chip's editor opens: a popover anchored to the chip on a wider screen, a sheet on a phone,
 * where a popover would cover the chip it came from and leave no room for a list. Not a
 * SwipeableDrawer, whose cancelable touch listener makes the list inside it scroll late (src/CLAUDE.md).
 */
export function ChipSurface({ anchor, open, onClose, title, count, children }: {
  anchor: HTMLElement | null
  open: boolean
  onClose: () => void
  title: string
  /** The answer as it stands, "23 games", said as the edits land. */
  count?: string
  children: React.ReactNode
}) {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  const head = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25 }}>
      <Typography component="h2" sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, flex: 1, minWidth: 0 }}>{title}</Typography>
      {count && (
        <Typography aria-live="polite" sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary', whiteSpace: 'nowrap' }}>{count}</Typography>
      )}
      <Box {...pressable(onClose)} sx={{ ...textButtonSx, color: ACCENT_EDGE, mr: -1, ...hoverOnly({ textDecoration: 'underline' }) }}>Done</Box>
    </Box>
  )
  const paper = { bgcolor: 'background.raised', border: '1px solid', borderColor: 'outline' } as const
  if (phone) {
    return (
      <Drawer anchor="bottom" open={open} onClose={onClose}
        slotProps={{ paper: { 'aria-label': title, sx: {
          ...paper, borderBottom: 'none', borderTopLeftRadius: 16, borderTopRightRadius: 16,
          maxHeight: '85vh', pb: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        } } }}>
        <Box sx={{ px: 2, pt: 1.75, overflowY: 'auto' }}>{head}{children}</Box>
      </Drawer>
    )
  }
  return (
    <Popover open={open && !!anchor} anchorEl={anchor} onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ paper: { 'aria-label': title, sx: {
        ...paper, mt: 0.75, p: 2, borderRadius: 2,
        // rem, since the stat names reserve room for text.
        width: 'min(calc(100vw - 32px), 26rem)', maxHeight: 'min(70vh, 34rem)',
      } } }}>
      {head}{children}
    </Popover>
  )
}

// ─── Picking from a list ──────────────────────────────────────────────────────

function SearchField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <Box sx={{ position: 'relative' }}>
      <SearchIcon aria-hidden sx={{
        position: 'absolute', left: chromePx(10), top: '50%', transform: 'translateY(-50%)',
        fontSize: chromePx(18), color: 'text.secondary', pointerEvents: 'none',
      }} />
      <Box component="input" type="search" aria-label={label} placeholder={label} value={value}
        // A phone opens on the list, not under a keyboard covering it: the search is there to narrow
        // a long list, which a pointer reaches by typing straight away.
        autoFocus={typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        sx={{ ...fieldSx, width: '100%', pl: `calc(${chromePx(10)} + ${chromePx(18)} + 0.5rem)`, pr: 1.5, fontWeight: 600,
          '&::placeholder': { color: 'text.secondary', opacity: 1 } }} />
    </Box>
  )
}

/** One choice in a list: the picked one in the accent. */
function Choice({ on, children, onPick }: { on: boolean; children: React.ReactNode; onPick: () => void }) {
  return (
    <Box {...pressable(onPick)} aria-pressed={on} sx={{
      ...FOCUS_RING, display: 'inline-flex', alignItems: 'center', minHeight: chromePx(34), px: 1.25,
      borderRadius: 999, border: '1px solid', borderColor: on ? ACCENT_EDGE : CARD_BORDER, cursor: 'pointer', userSelect: 'none',
      fontSize: TYPE_SCALE.meta, fontWeight: on ? 800 : 600, color: on ? ACCENT_EDGE : 'text.primary',
      ...hoverOnly({ borderColor: ACCENT_EDGE }),
    }}>{children}</Box>
  )
}

export type ChoiceGroup = { label: string; options: { value: string; label: string }[] }

/** A list of choices under headings, with a search once it is too long to scan. */
export function ChoiceList({ groups, value, onPick, searchLabel }: {
  groups: ChoiceGroup[]
  value: string
  onPick: (v: string) => void
  searchLabel: string
}) {
  const [q, setQ] = useState('')
  const total = groups.reduce((n, g) => n + g.options.length, 0)
  const needle = q.trim().toLowerCase()
  const shown = groups
    .map(g => ({ ...g, options: g.options.filter(o => !needle || o.label.toLowerCase().includes(needle)) }))
    .filter(g => g.options.length)
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      {total > 12 && <SearchField value={q} onChange={setQ} label={searchLabel} />}
      {shown.map(g => (
        <Box key={g.label || 'all'} role="group" aria-label={g.label || undefined}>
          {g.label && <SectionLabel>{g.label}</SectionLabel>}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {g.options.map(o => <Choice key={o.value} on={o.value === value} onPick={() => onPick(o.value)}>{o.label}</Choice>)}
          </Box>
        </Box>
      ))}
      {!shown.length && <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>No match</Typography>}
    </Box>
  )
}

/** The stats a side can ask at a grain, under the picker's headings. */
export function statGroups(side: FinderBoardSide, per: FinderPer, plays: boolean, byClub = false): ChoiceGroup[] {
  return finderFieldGroups(side, per, plays, byClub).map(g => ({ label: g.label, options: g.fields.map(f => ({ value: f.key, label: f.label })) }))
}

// ─── One condition ────────────────────────────────────────────────────────────

// A YES-OR-NO ON A PLAY: asked as exactly one, since "walk-off at least 1" is the same question said
// worse. Every other stat starts at a number a reader would plausibly ask, so the first answer is
// a list rather than everything or nothing.
const FLAGS = new Set(['walkoff', 'risp', 'leadoff', 'ph', 'bunt', 'ifh', 'won', 'tooklead'])
const RATE_STARTS: Record<string, string> = {
  avg: '.300', obp: '.400', slg: '.500', ops: '.900', era: '3.00', whip: '1.20', fpct: '.980',
}

/** A new condition on `field`, at a starting number. */
export function startCondition(side: FinderBoardSide, field: string): FinderCondition {
  if (FLAGS.has(field)) return { field, op: 'eq', value: 1 }
  const lower = finderLowerBetter(side, field)
  const raw = RATE_STARTS[field] ?? (field === 'ip' ? '5.0' : '1')
  return { field, op: lower ? 'lte' : 'gte', value: parseFinderValue(side, field, raw) }
}

const OP_ORDER: FinderOp[] = ['gte', 'eq', 'lte']

/**
 * One condition: its stat, which opens the list of stats; how it compares, as words; and its number,
 * with − and + beside the box, since a phone's keypad is the slow way to go from 5 to 6.
 */
export function ConditionEditor({ side, per, plays, byClub = false, condition, onChange, onRemove, pickFirst = false }: {
  side: FinderBoardSide
  per: FinderPer
  plays: boolean
  /** Filed under the club (`FinderQuery.byClub`), which a club's season asks different stats of. */
  byClub?: boolean
  condition: FinderCondition
  onChange: (c: FinderCondition) => void
  onRemove: () => void
  /** Open on the stats, for a condition just added. */
  pickFirst?: boolean
}) {
  const [picking, setPicking] = useState(pickFirst)
  const groups = statGroups(side, per, plays, byClub)
  const label = groups.flatMap(g => g.options).find(o => o.value === condition.field)?.label ?? condition.field
  // WHAT THE READER TYPED, UNTIL THEY LEAVE THE BOX: the stored value is normalized (innings are
  // outs), so a purely controlled box would rewrite "4" as "4.0" under the cursor.
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => { setDraft(null) }, [condition.field])
  const signed = finderSigned(side, condition.field)
  const step = finderStep(side, condition.field)
  const bump = (d: number) => {
    setDraft(null)
    const next = condition.value + d * step
    onChange({ ...condition, value: signed ? next : Math.max(0, next) })
  }
  if (picking) {
    return <ChoiceList groups={groups} value={condition.field} searchLabel="Find a stat"
      onPick={field => { onChange(field === condition.field ? condition : startCondition(side, field)); setPicking(false) }} />
  }
  const stepSx = {
    ...fieldSx, width: chromePx(38), display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', userSelect: 'none', fontSize: TYPE_SCALE.title, ...hoverOnly({ borderColor: ACCENT_EDGE }),
  } as const
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box {...pressable(() => setPicking(true))} aria-label={`Stat: ${label}`} sx={{
        ...fieldSx, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, px: 1.25, cursor: 'pointer',
        ...hoverOnly({ borderColor: ACCENT_EDGE }),
      }}>
        <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{label}</Box>
        <Box component="span" aria-hidden sx={{ color: 'text.secondary', fontSize: TYPE_SCALE.meta }}>▾</Box>
      </Box>
      <Box role="group" aria-label="Comparison">
        <PillGroup value={condition.op} onChange={op => onChange({ ...condition, op: op as FinderOp })}
          options={OP_ORDER.map(op => { const o = FINDER_OPS.find(x => x.op === op)!; return { value: op, label: o.label.replace(/^./, c => c.toUpperCase()) } })} />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Box {...pressable(() => bump(-1))} aria-label="Less" sx={stepSx}>−</Box>
        {/* A TEXT BOX, NOT type="number": "4.2" innings is four and two thirds, which a number input's
            own stepper would take to 4.3, an innings figure that does not exist. */}
        <Box component="input" aria-label={`Value, ${label}`} inputMode={signed ? 'text' : 'decimal'}
          value={draft ?? unparseFinderValue(side, condition.field, condition.value)}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setDraft(e.target.value)
            onChange({ ...condition, value: parseFinderValue(side, condition.field, e.target.value) })
          }}
          onBlur={() => setDraft(null)}
          sx={{ ...fieldSx, width: '6rem', px: 1, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }} />
        <Box {...pressable(() => bump(1))} aria-label="More" sx={stepSx}>+</Box>
        <Box {...pressable(onRemove)} sx={{ ...textButtonSx, ml: 'auto', color: 'text.secondary', ...hoverOnly({ color: 'text.primary' }) }}>Remove</Box>
      </Box>
    </Box>
  )
}

// ─── The add menu ─────────────────────────────────────────────────────────────

/** What can be added beside the stats: the who, where and when, each its own list. */
export interface ScopeEntry { key: string; label: string }

/**
 * "+ Add": the stats, and the who, where and when not yet set, in one list. Picking a stat adds it
 * and opens its number; picking a scope opens its list.
 */
export function AddMenu({ side, per, plays, byClub = false, scopes, onStat, onScope }: {
  side: FinderBoardSide
  per: FinderPer
  plays: boolean
  byClub?: boolean
  scopes: ScopeEntry[]
  onStat: (field: string) => void
  onScope: (key: string) => void
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {scopes.length > 0 && (
        <Box role="group" aria-label="Who, where, when">
          <SectionLabel>Who, where, when</SectionLabel>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {scopes.map(s => <Choice key={s.key} on={false} onPick={() => onScope(s.key)}>{s.label}</Choice>)}
          </Box>
        </Box>
      )}
      <ChoiceList groups={statGroups(side, per, plays, byClub)} value="" searchLabel="Find a stat" onPick={onStat} />
    </Box>
  )
}

import React, { useEffect, useState } from 'react'
import { Box, Skeleton, Typography } from '@mui/material'
import {
  finderFields, finderUnit, defaultCondition, parseFinderValue, unparseFinderValue, describeFinderQuery,
  FINDER_OPS,
  type FinderCondition, type FinderOp, type FinderQuery, type FinderResult, type FinderRow,
  type FinderSide, type FinderTally, type FinderVenue,
} from '../league/finder'
import type { LeagueGame, LeaguePlayer } from '../league/types'
import { SectionCard, TYPE_SCALE, CARD_BORDER } from './card'
import { ExpandRow } from './ExpandRow'
import { LeaderCard, LeaderCardSkeleton, PORTRAIT_PX, type LeaderItem } from './leaders'
import { FOCUS_RING, hoverOnly, pressable } from './interaction'
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

/** How much of the result list shows before it asks. Ten rows is a leaderboard, thirty is a
 *  directory (ExpandRow's rule): uncapped, a question matching fifty games puts the tally two full
 *  screens down below `lg`, where a reader who has not scrolled that far has no idea it exists. */
const RESULT_CAP = 10
/** The tally's rows. */
const TALLY_SHOWN = 10
/** Six, the cap the address decoders enforce too, so a hand-edited link cannot smuggle in a
 *  hundred conditions and make the board unreadable. */
const MAX_CONDITIONS = 6

const fieldSx = {
  ...FOCUS_RING,
  minHeight: chromePx(34), py: 0.4,
  borderRadius: 999, border: '1px solid', borderColor: CARD_BORDER,
  bgcolor: 'background.paper', color: 'text.primary',
  fontSize: TYPE_SCALE.meta, fontWeight: 700, fontFamily: 'inherit',
  ...hoverOnly({ borderColor: 'text.disabled' }),
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
        minWidth: 0, flexShrink: 0, pl: 1.25, pr: 3, cursor: 'pointer',
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
          color: 'text.disabled', fontSize: TYPE_SCALE.body, fontWeight: 800,
          ...hoverOnly({ color: 'text.primary', bgcolor: 'action.hover' }),
        }}>✕</Box>
      </Box>
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

export function FinderBoard<P extends LeaguePlayer, G extends LeagueGame>({
  side, query, onQuery, result, clubs, clubAbbr, intro, loading = false, renderRow, tallyParts,
}: {
  side: FinderSide
  /** Owned by the section, which mirrors it into the address bar. */
  query: FinderQuery
  onQuery: (q: FinderQuery) => void
  result: FinderResult<P, G>
  /** The league's clubs for the club and opponent pickers, in the order to offer them. */
  clubs: { value: string; label: string }[]
  clubAbbr: (id: string) => string
  /** The sentence above the question: what the board searches. */
  intro: string
  /** While the lines are still coming (MLB reads them; WPBL already holds them). */
  loading?: boolean
  /** A matching line in the section's own parts (GameLineFrame, in game mode). */
  renderRow: (row: FinderRow<P, G>, i: number, unit: string) => React.ReactNode
  /** The section's face, club mark and link for a tally row. */
  tallyParts: (t: FinderTally<P>) => Pick<LeaderItem, 'key' | 'name' | 'portrait' | 'badge' | 'linkProps'>
}) {
  const [allRows, setAllRows] = useState(false)
  const unit = finderUnit(side, result.headlineField)
  const clubOptions = (blank: string) => [{ value: '', label: blank }, ...clubs]

  const setCondition = (i: number, c: FinderCondition) =>
    onQuery({ ...query, conditions: query.conditions.map((x, j) => (j === i ? c : x)) })
  const removeCondition = (i: number) => onQuery({ ...query, conditions: query.conditions.filter((_, j) => j !== i) })
  const addCondition = () => onQuery({ ...query, conditions: [...query.conditions, defaultCondition(side)] })

  // A NUMBER AND A SENTENCE, not just a number. "12" over a list is a fact about a question the
  // reader may have changed three controls ago; "12 games where Strikeouts at least 5" is the
  // question read back, which is the only way to notice you asked the wrong one. Club and venue
  // included: `describeFinderQuery` knows only the stat conditions, and a summary that omits the
  // who and where claims a wider search than it ran. The unasked question gets its own wording,
  // since "612 games where every game line" reads as a bug.
  const games_ = result.total === 1 ? 'game' : 'games'
  const scopeText = [
    query.teamId && `for ${clubAbbr(query.teamId)}`,
    query.oppId && `vs ${clubAbbr(query.oppId)}`,
    query.venue === 'home' ? 'at home' : query.venue === 'away' ? 'on the road' : null,
  ].filter(Boolean).join(', ')
  const total = result.total.toLocaleString()
  const summary = query.conditions.length
    ? `${total} ${games_} where ${describeFinderQuery(side, query)}${scopeText ? `, ${scopeText}` : ''}`
    : scopeText
      ? `${total} ${games_} ${scopeText}. Add a condition to narrow it.`
      : `Every line: ${total} ${games_}. Add a condition to narrow it.`
  const shownRows = allRows ? result.rows : result.rows.slice(0, RESULT_CAP)

  // Competition ranks over the games counts: 1, 1, 3.
  const tally = result.tally.slice(0, TALLY_SHOWN)
  const tallyItems: LeaderItem[] = tally.map(t => ({
    ...tallyParts(t),
    rank: tally.findIndex(x => x.games === t.games) + 1,
    tied: tally.filter(x => x.games === t.games).length > 1,
    value: String(t.games),
  }))

  return (
    /* THE ORDINARY BOARD COLUMN, not the wide one Bests takes: this is a form and two result cards,
       and at the wide column the controls stretch halfway across a desktop and the cards read as
       sparse. The results split into two under the question where there is room; the tally drops
       under the list below `lg`, which is the right order on a phone. */
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 1.5, sm: 2 }, maxWidth: BOARD_COLUMN, mx: 'auto', width: '100%' }}>
      <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', lineHeight: 1.5, maxWidth: '70ch' }}>
        {intro}
      </Typography>

      <SectionCard title="The question" subtitle={query.conditions.length ? undefined : 'Add a condition to narrow it down.'}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, pt: 0.5 }}>
          {query.conditions.map((c, i) => (
            <ConditionRow key={i} side={side} n={i + 1} condition={c}
              onChange={next => setCondition(i, next)} onRemove={() => removeCondition(i)} />
          ))}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            {query.conditions.length < MAX_CONDITIONS && (
              <Box {...pressable(addCondition)} sx={{
                ...FOCUS_RING,
                display: 'inline-flex', alignItems: 'center', gap: 0.5, flexShrink: 0,
                minHeight: chromePx(34), px: 1.25, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
                border: '1px dashed', borderColor: CARD_BORDER, color: 'text.secondary',
                fontSize: TYPE_SCALE.meta, fontWeight: 700,
                ...hoverOnly({ borderColor: 'var(--wpbl-accent-fg)', color: 'text.primary' }),
              }}>+ Add a condition</Box>
            )}
            {query.conditions.length > 0 && (
              <Box {...pressable(() => onQuery({ ...query, conditions: [] }))} sx={{
                ...FOCUS_RING,
                display: 'inline-flex', alignItems: 'center', flexShrink: 0,
                minHeight: chromePx(34), px: 1.25, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
                color: 'text.secondary', fontSize: TYPE_SCALE.meta, fontWeight: 700,
                ...hoverOnly({ color: 'text.primary' }),
              }}>Clear</Box>
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
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
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

      <Box sx={{
        display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.6fr) minmax(0, 1fr)' },
        alignItems: 'start', gap: { xs: 1.5, sm: 2 },
      }}>
        {/* A no-break space while loading: a plain one collapses, and the line with it. */}
        <SectionCard title="Matching games" subtitle={loading ? String.fromCharCode(160) : summary}>
          {loading ? (
            <>
              {Array.from({ length: RESULT_CAP }, (_, i) => <RowSkeleton key={i} divider={i > 0} />)}
              {/* The expand row a season's worth of matches always brings, so the card does not grow
                  by it when they land and push the tally under it on a phone. */}
              <ExpandRow flush expanded={false} moreLabel="Show top 50 games" onToggle={() => {}} />
            </>
          ) : result.rows.length === 0 ? (
            <Box sx={{ py: 2 }}>
              <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, mb: 0.5 }}>Nothing matched</Typography>
              {/* SAYING WHAT WAS SEARCHED is what separates "nobody has done this" from "your
                  filters left nothing to look at". */}
              <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled' }}>
                Searched {result.searched.toLocaleString()} {result.searched === 1 ? 'line' : 'lines'}
                {side === 'pitching' ? ' from pitchers who appeared' : ' from batters who came to the plate'}.
                Loosen a condition, or widen the club and venue.
              </Typography>
            </Box>
          ) : (
            <>
              {shownRows.map((r, i) => renderRow(r, i, unit))}
              {result.rows.length > RESULT_CAP && (
                <ExpandRow flush expanded={allRows}
                  moreLabel={result.total > result.rows.length ? `Show top ${result.rows.length} games` : `Show all ${result.rows.length} games`}
                  onToggle={() => setAllRows(v => !v)} />
              )}
              {/* The engine caps what it returns, so a question matching half the league does not
                  hand the page six hundred rows. Said once the reader has expanded to the cap, since
                  a list that stops at fifty with nothing explaining it reads as the answer. */}
              {allRows && result.total > result.rows.length && (
                <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled', textAlign: 'center', pt: 1 }}>
                  Showing the top {result.rows.length} of {total}. Narrow the question to see the rest.
                </Typography>
              )}
            </>
          )}
        </SectionCard>

        {/* THE SECOND ANSWER, and the more interesting one. The list says when it happened; this
            says who does it, which is the question behind most of the questions people bring. Free
            once the matching is done, on the Leaders board's card so it reads as those rows do. */}
        {loading
          ? <LeaderCardSkeleton title="Most games matching" rows={TALLY_SHOWN} seeAll={false} />
          : <LeaderCard title="Most games matching" empty="Nobody yet." items={tallyItems} />}
      </Box>
    </Box>
  )
}

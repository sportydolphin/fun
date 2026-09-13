import { useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import {
  runWpblFinder, finderFields, finderUnit, defaultCondition, parseFinderValue,
  unparseFinderValue, describeFinderQuery, FINDER_OPS,
  type FinderCondition, type FinderQuery, type FinderSide, type FinderOp, type FinderVenue,
} from './derive/finder'
import { wpblAccentFg, wpblFullName } from './constants'
import {
  SectionCard, LeaderRow, ExpandRow, BOARD_COLUMN, BOARD_COLUMN_WIDE, TYPE_SCALE, CARD_BORDER,
  FOCUS_RING, pressable, useWpblDark, hoverOnly,
} from './ui'
import GameLineRow from './GameLineRow'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblTeam } from './types'

// The Find board: every game line in the league that matches what you asked for.
//
// WHY IT EXISTS. Every other board answers a question somebody thought to put on a board. This
// answers the ones nobody did, which is most of them: how often has anyone struck out five in a
// game, who has gone four for four more than once, has a pitcher ever walked nobody through
// five. Until now the only way to settle one of those was to read thirty box scores.
//
// THE ENGINE IS IN derive/finder.ts, including the reasoning about what can be asked, why every
// condition is AND, and why the query encodes into one query param rather than seven. What is
// here is the controls and the two answers.
//
// IT COSTS NO FETCH, for the same reason the Bests board does not: the season's ~750 box-score
// lines are already in memory when this tab opens. Baseball Reference built Stathead because
// MLB has millions of these and no browser can sort them; at this league's size the query engine
// is a filter and a sort. That is the whole reason this feature was a day's work rather than a
// backend.

/**
 * A native `<select>`, which is the one place this section does not use its own chip idiom.
 *
 * Everything else here picks from two to six options and uses chips or a sheet. A condition
 * picks a stat out of SIXTEEN, and then an operator, and then does it again on the next row:
 * chips would be a wall, and a sheet per control would be three taps to change a number. A
 * native select is one tap, gives a phone its own wheel picker, is keyboard- and
 * screen-reader-complete for free, and cannot render off the edge of the screen.
 *
 * Painted to match the chips around it rather than left at the UA default, which on Windows is a
 * grey 3D box that looks like a bug next to the rest of the bar.
 */
function Picker({ value, onChange, options, label, grow }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  label: string
  grow?: boolean
}) {
  return (
    <Box
      component="select"
      aria-label={label}
      value={value}
      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
      sx={{
        ...FOCUS_RING,
        appearance: 'none', WebkitAppearance: 'none',
        // Room on the right for the caret drawn as a background image, so the arrow never sits
        // on top of a long stat name.
        backgroundImage: 'linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)',
        backgroundPosition: 'right 12px center, right 7px center',
        backgroundSize: '5px 5px, 5px 5px',
        backgroundRepeat: 'no-repeat',
        minWidth: 0,
        ...(grow ? { flex: 1 } : { flexShrink: 0 }),
        minHeight: 34, pl: 1.25, pr: 3, py: 0.4,
        borderRadius: 999, border: '1px solid', borderColor: CARD_BORDER,
        bgcolor: 'background.paper', color: 'text.primary',
        fontSize: TYPE_SCALE.meta, fontWeight: 700, fontFamily: 'inherit',
        cursor: 'pointer',
        ...hoverOnly({ borderColor: 'text.disabled' }),
      }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Box>
  )
}

/** How much of the result list is shown before it asks. See the note where it is spent. */
const RESULT_CAP = 10

/** One `stat op value` row. `n` is the 1-based position, spoken into the labels so a screen
 *  reader with several conditions can tell the rows apart. */
function ConditionRow({ side, n, condition, onChange, onRemove }: {
  side: FinderSide
  n: number
  condition: FinderCondition
  onChange: (c: FinderCondition) => void
  onRemove: () => void
}) {
  const fields = finderFields(side)
  // WHAT THE READER TYPED, UNTIL THEY LEAVE THE BOX. The stored value is normalised (innings are
  // outs), so a purely controlled input rewrites itself under the cursor: type "4" in the
  // innings field and it becomes "4.0", and the next keystroke lands after the zero. Backspacing
  // to empty is the other half, where the parse floors at 0 and the box refills with "0".
  //
  // So the draft is held here while the box has focus and dropped on blur, which is when the
  // canonical spelling appears. The query itself updates on every keystroke either way: the
  // draft is about what is DRAWN, never about when the search runs.
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => { setDraft(null) }, [condition.field])
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
      <Picker
        grow
        label={`Stat, condition ${n}`}
        value={condition.field}
        options={fields.map(f => ({ value: f.key, label: f.label }))}
        onChange={field => onChange({ ...condition, field })}
      />
      <Picker
        label={`Comparison, condition ${n}`}
        value={condition.op}
        options={FINDER_OPS.map(o => ({ value: o.op, label: o.label }))}
        onChange={op => onChange({ ...condition, op: op as FinderOp })}
      />
      {/* A TEXT INPUT, NOT type="number", and innings are why. "4.2" means four and two thirds
          in this sport, so the value is parsed with `ipToOuts` rather than with Number, and a
          number input's own stepper would offer 4.3, which is not an innings figure that
          exists. `inputMode` still brings up the numeric keypad on a phone. */}
      <Box
        component="input"
        aria-label={`Value, condition ${n}`}
        inputMode="decimal"
        value={draft ?? unparseFinderValue(side, condition.field, condition.value)}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          setDraft(e.target.value)
          onChange({ ...condition, value: parseFinderValue(side, condition.field, e.target.value) })
        }}
        onBlur={() => setDraft(null)}
        sx={{
          ...FOCUS_RING,
          width: '3.5rem', minHeight: 34, px: 1.25, py: 0.4,
          borderRadius: 999, border: '1px solid', borderColor: CARD_BORDER,
          bgcolor: 'background.paper', color: 'text.primary',
          fontSize: TYPE_SCALE.meta, fontWeight: 700, fontFamily: 'inherit',
          textAlign: 'center', fontVariantNumeric: 'tabular-nums',
          ...hoverOnly({ borderColor: 'text.disabled' }),
        }}
      />
      <Box {...pressable(onRemove)} aria-label={`Remove condition ${n}`} sx={{
        ...FOCUS_RING,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        width: 34, height: 34, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
        color: 'text.disabled', fontSize: TYPE_SCALE.body, fontWeight: 800,
        ...hoverOnly({ color: 'text.primary', bgcolor: 'action.hover' }),
      }}>✕</Box>
    </Box>
  )
}

export default function WpblFindView({
  side, teams, players, batting, pitching, games, query, onQuery, onOpenPlayer, onOpenGame,
}: {
  side: FinderSide
  teams: WpblTeam[]
  players: WpblPlayer[]
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
  games: WpblGame[]
  /** Owned by StatsView, which mirrors the conditions into the address bar. */
  query: FinderQuery
  onQuery: (q: FinderQuery) => void
  onOpenPlayer?: (p: WpblPlayer) => void
  onOpenGame?: (g: WpblGame) => void
}) {
  const isDark = useWpblDark()
  const accent = wpblAccentFg(isDark)
  const [allRows, setAllRows] = useState(false)

  const result = useMemo(
    () => runWpblFinder(side, batting, pitching, players, games, query),
    [side, batting, pitching, players, games, query])

  const unit = finderUnit(side, result.headlineField)
  const clubs = useMemo(() => [...teams].sort((a, b) => a.abbr.localeCompare(b.abbr)), [teams])
  const clubOptions = (blank: string) => [
    { value: '', label: blank },
    ...clubs.map(t => ({ value: t.id, label: wpblFullName(t) })),
  ]

  const setCondition = (i: number, c: FinderCondition) =>
    onQuery({ ...query, conditions: query.conditions.map((x, j) => (j === i ? c : x)) })
  const removeCondition = (i: number) =>
    onQuery({ ...query, conditions: query.conditions.filter((_, j) => j !== i) })
  const addCondition = () =>
    onQuery({ ...query, conditions: [...query.conditions, defaultCondition(side)] })

  // A NUMBER AND A SENTENCE, not just a number. "12" over a list is a fact about a question the
  // reader may have changed three controls ago; "12 games where Strikeouts at least 5" is the
  // question read back, which is the only way to notice you asked the wrong one.
  //
  // The unasked question gets its own wording rather than the sentence with a blank in it: "612
  // games where every game line" is what the general form produces before anything is set, and
  // it reads as a bug.
  // TEN ROWS, AND THE REST BEHIND A TAP. The list is the obvious answer and the tally beside it
  // is the more interesting one, and below `lg` the tally sits underneath: uncapped, a question
  // matching fifty games put it two full screens down, where a reader who has not scrolled that
  // far has no idea it exists. The section's own rule, written on `ExpandRow`: ten rows is a
  // leaderboard, thirty is a directory.
  const shownRows = allRows ? result.rows : result.rows.slice(0, RESULT_CAP)

  // THE QUESTION READ BACK IN FULL, club and venue included. `describeFinderQuery` only knows
  // the stat conditions; the who and where live on the query beside them and are just as much
  // part of what was asked, so a summary that omits them claims a wider search than it ran. A
  // club plus an opponent plus a venue can cut the pool to a handful of lines on their own,
  // which is why the count needs them spelled out even with no stat condition set.
  const games_ = result.total === 1 ? 'game' : 'games'
  const clubAbbr = (id: string | null) => (id ? (teams.find(t => t.id === id)?.abbr ?? id) : null)
  const scopeBits = [
    query.teamId && `for ${clubAbbr(query.teamId)}`,
    query.oppId && `vs ${clubAbbr(query.oppId)}`,
    query.venue === 'home' ? 'at home' : query.venue === 'away' ? 'on the road' : null,
  ].filter(Boolean) as string[]
  const scopeText = scopeBits.join(', ')
  const summary = query.conditions.length
    ? `${result.total} ${games_} where ${describeFinderQuery(side, query)}${scopeText ? `, ${scopeText}` : ''}`
    : scopeBits.length
      ? `${result.total} ${games_} ${scopeText}. Add a condition to narrow it.`
      : `Every line so far: ${result.total} ${games_}. Add a condition to narrow it.`

  return (
    /* CAPPED AND CENTRED inside the full-bleed box StatsView puts this board in, and two columns
       on a large desktop: the results and the tally are two answers to one question and belong
       side by side where there is room. Below `lg` the tally sits under the list, which is the
       right order on a phone, since the list is what was asked for. */
    <Box sx={{
      display: 'flex', flexDirection: 'column', gap: { xs: 1.5, sm: 2 },
      maxWidth: { xs: BOARD_COLUMN, lg: BOARD_COLUMN_WIDE }, mx: 'auto',
    }}>
      <Box sx={{ maxWidth: '70ch' }}>
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', lineHeight: 1.5 }}>
          Search every box-score line for the games that match.
        </Typography>
      </Box>

      <SectionCard title="The question" subtitle={query.conditions.length ? undefined : 'Add a condition to narrow it down.'}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, pt: 0.5 }}>
          {query.conditions.map((c, i) => (
            <ConditionRow key={i} side={side} n={i + 1} condition={c}
              onChange={next => setCondition(i, next)} onRemove={() => removeCondition(i)} />
          ))}

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            {/* Six is the cap the decoder enforces too, so a hand-edited link cannot smuggle in
                a hundred conditions and make the board unreadable. */}
            {query.conditions.length < 6 && (
              <Box {...pressable(addCondition)} sx={{
                ...FOCUS_RING,
                display: 'inline-flex', alignItems: 'center', gap: 0.5, flexShrink: 0,
                minHeight: 34, px: 1.25, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
                border: '1px dashed', borderColor: CARD_BORDER, color: 'text.secondary',
                fontSize: TYPE_SCALE.meta, fontWeight: 700,
                ...hoverOnly({ borderColor: accent, color: 'text.primary' }),
              }}>+ Add a condition</Box>
            )}
            {query.conditions.length > 0 && (
              <Box {...pressable(() => onQuery({ ...query, conditions: [] }))} sx={{
                ...FOCUS_RING,
                display: 'inline-flex', alignItems: 'center', flexShrink: 0,
                minHeight: 34, px: 1.25, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
                color: 'text.disabled', fontSize: TYPE_SCALE.meta, fontWeight: 700,
                ...hoverOnly({ color: 'text.primary' }),
              }}>Clear</Box>
            )}
          </Box>

          {/* WHO AND WHERE, kept apart from the conditions above because they are a different
              kind of question: those ask what happened in a game, these ask which games to look
              at. Drawn as pickers rather than chips for the same reason the stat is. */}
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap',
            pt: 1, mt: 0.5, borderTop: '1px solid', borderColor: 'divider',
          }}>
            <Picker label="Club" value={query.teamId ?? ''} options={clubOptions('Any club')}
              onChange={v => onQuery({ ...query, teamId: v || null })} />
            <Picker label="Opponent" value={query.oppId ?? ''} options={clubOptions('Any opponent')}
              onChange={v => onQuery({ ...query, oppId: v || null })} />
            <Picker label="Home or away" value={query.venue}
              options={[
                { value: 'any', label: 'Home or away' },
                { value: 'home', label: 'At home' },
                { value: 'away', label: 'On the road' },
              ]}
              onChange={v => onQuery({ ...query, venue: v as FinderVenue })} />
          </Box>
        </Box>
      </SectionCard>

      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.6fr) minmax(0, 1fr)' },
        alignItems: 'start',
        gap: { xs: 1.5, sm: 2 },
      }}>
        <SectionCard title="Matching games" subtitle={summary}>
          {result.rows.length === 0 ? (
            <Box sx={{ py: 2 }}>
              <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, mb: 0.5 }}>
                Nothing matched
              </Typography>
              {/* SAYING WHAT WAS SEARCHED is what separates "nobody has done this" from "your
                  filters left nothing to look at". A club plus an opponent plus a venue can cut
                  the pool to three lines, and a bare "no results" would read as the former. */}
              <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled' }}>
                Searched {result.searched} {result.searched === 1 ? 'line' : 'lines'}
                {side === 'pitching' ? ' from pitchers who appeared' : ' from batters who came to the plate'}.
                Loosen a condition, or widen the club and venue.
              </Typography>
            </Box>
          ) : (
            <>
              {shownRows.map((r, i) => (
                <GameLineRow key={r.key} rank={i + 1} name={r.name} player={r.player}
                  teamId={r.teamId} game={r.game} detail={r.detail}
                  value={r.headlineDisplay} unit={unit} accent={accent} divider={i > 0}
                  nameOpens="game" compactDate emphasizeRank={false}
                  onOpenPlayer={onOpenPlayer} onOpenGame={onOpenGame} />
              ))}
              {result.rows.length > RESULT_CAP && (
                <ExpandRow flush expanded={allRows}
                  moreLabel={result.total > result.rows.length
                    ? `Show top ${result.rows.length} games`
                    : `Show all ${result.rows.length} games`}
                  onToggle={() => setAllRows(v => !v)} />
              )}
              {/* The engine caps what it returns, so a question matching half the league does
                  not hand the page six hundred rows. Said out loud once the reader has expanded
                  to the cap, because a list that stops at fifty with nothing explaining it reads
                  as the answer. Held back while collapsed: the expand row above already says the
                  count it will show, and "top 50 of 200" over ten visible rows is a third number
                  that does not match either. */}
              {allRows && result.total > result.rows.length && (
                <Typography sx={{
                  fontSize: TYPE_SCALE.meta, color: 'text.disabled', textAlign: 'center', pt: 1,
                }}>
                  Showing the top {result.rows.length} of {result.total}. Narrow the question to see the rest.
                </Typography>
              )}
            </>
          )}
        </SectionCard>

        {/* THE SECOND ANSWER, and the more interesting one. The list says when it happened; this
            says who does it, which is the question behind most of the questions people bring. It
            is free once the matching is done. */}
        <SectionCard title="Who did it most" subtitle={result.tally.length ? 'Times each player matched.' : undefined}>
          {result.tally.length === 0 ? (
            <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled', py: 1 }}>
              Nobody yet.
            </Typography>
          ) : result.tally.slice(0, 10).map((t, i) => (
            <LeaderRow key={t.player?.id ?? t.name} rank={i + 1} player={t.player} name={t.name}
              teamId={t.teamId} value={String(t.games)} unit={t.games === 1 ? 'game' : 'games'}
              accent={accent} onOpen={onOpenPlayer} />
          ))}
        </SectionCard>
      </Box>
    </Box>
  )
}

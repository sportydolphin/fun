import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress, useMediaQuery } from '@mui/material'
import {
  fetchWpblAllRunValuePlays, fetchWpblAllPlayers,
  getCachedWpblAllRunValuePlays, getCachedWpblAllPlayers,
} from './api'
import {
  BASE_ROW_ORDER, BASE_SHORT, buildRunExpectancy, describeState, eventValues, reOf, workedExample,
  fmtRe, fmtRunValue, playRunValues, runValueLeaders, type ReTable, type WorkedExample,
} from './derive/runExpectancy'
import { wpblAccentFg } from './constants'
import { SectionCard, LeaderRow, PlayerPortrait, ExpandRow, useWpblDark, useWpblName } from './ui'
import type { WpblGame, WpblPlayer, WpblTeam } from './types'

// The run-value board: what each situation in a game is worth, and which plays moved furthest
// between them.
//
// It sits beside Season and Pitch by pitch on the Stats tab's source axis for the same reason
// they sit beside each other: same season, different question. Season counts what happened,
// Pitch by pitch counts what each pitch did, and this one prices what each play was worth in
// runs. The arithmetic is all in derive/runExpectancy.ts; what lives here is the drawing.
//
// ONE BOARD. There used to be a second list, the ten biggest single plays of the season, and
// it was the most interesting thing here to somebody who already knew what run value was and
// the least useful to everybody else: ten rows of narrative, each needing the situation it
// happened in to make sense of the number beside it. The season leaderboard answers "who is
// good", which is the question people bring, and it carries the section on its own.
//
// AND ONE EXPLANATION, WHICH IS WHY THIS FILE OWNS IT. It used to be in two places and neither
// was whole. This board carried the 24-situation table and a paragraph of fine print; the
// Findings board carried the leadoff anchor, one play worked through in a ledger, and the
// formula in words. So a reader who wanted to know where a number came from met the table
// without the arithmetic on one tab and the arithmetic without the table on another, and
// nothing on either said the other half existed. They are one idea and they are now one card,
// in the order the idea is built: a situation is worth something, a play is worth what it
// changed, here is one. The Findings card keeps its measurements and points here for the
// method, because a finding and the method behind it are different jobs and only one of them
// should be duplicated. If a third surface ever needs to explain run value, it links here.
//
// WHAT A PHONE SEES FIRST IS THE PLAYERS, AND EVERYTHING ELSE MOVED TO MAKE THAT TRUE.
// Measured at 375px, the first version put the heading at y=193, a four-sentence paragraph
// under it, a worked example at y=404, the plays at y=685 and the leaderboard at y=1,584 of a
// 3,083px page. So the board a fan actually wants (who is having the best season) was two
// full screens below an explanation of how it was calculated, which is the wrong way round
// for every reader who is not already convinced. Run value is jargon-prone enough that it
// cannot open cold, but the fix for that is one sentence, not five.
//
// The order is now: one line of what this is, the leaderboard, and a shut card holding the
// whole explanation. Nobody has to read any of that to use the board, and it is one tap away
// for anyone who wants it.
//
// THE TABLE IS NOT THE OPENING ACT, AND THAT IS THE WHOLE LAYOUT. A 24-cell grid of two-decimal
// numbers is the most expert-looking thing on the section, and it led the page in the first
// version: a fan who came to see who is having a good season met a spreadsheet and left. So the
// order is now the players first, then the explanation last and folded shut. The one-line intro
// carries the idea on its own, quoting the unit inline, which is as much as a casual reader
// ever needs. The grid stays for the reader who wants it, one tap away and remembered, and it
// now sits inside step 1 where it is the evidence for a sentence rather than a spreadsheet on
// its own with a caption.
//
// WRITTEN FOR SOMEONE WHO KNOWS WHAT AN RBI IS AND NOTHING BEYOND IT. This is a two-month-old
// league whose audience mostly arrived this month, and run expectancy is the most jargon-prone
// idea on the section. So: no "base-out state", no "RE24", no "-23" down the side of the
// table, and every board says what it is measuring in a sentence before it shows a number. The
// first version of this page failed that test in about six places.
//
// EVERYTHING IS MEASURED FROM THIS LEAGUE'S OWN PLAYS, which is worth saying on the page and
// not just in a comment: this is the WPBL's own run environment, seven innings and about 15
// runs a game, and a reader who has seen a run-expectancy table before would otherwise assume
// these were the familiar numbers. Say where they come from, not what they are unlike. An
// earlier draft priced them against the majors in the same sentence; a fan of this league can
// do nothing with that, and it invites the section to be read as a comparison to another
// league rather than as a record of this one. Do not put it back.

// ── The table ────────────────────────────────────────────────────────────────────
//
// Rows are runners and columns are outs, which is the way round a fan reads a situation
// ("bases loaded, two out"), and the way that fits eight labels down a phone rather than
// across one.
//
// Every cell carries its own sample. With one season of a four-team league the common states
// are known twenty times better than the rare ones, and a grid of tidy two-decimal numbers
// implies a uniformity that does not exist. The count is the honest part of the cell.
function ReGrid({ table, accent }: { table: ReTable; accent: string }) {
  const max = Math.max(...table.cells.flat().map(c => c.re ?? 0), 0.01)
  return (
    <Box sx={{ overflowX: 'auto', display: 'flex' }}>
      <Box sx={{
        display: 'grid', gridTemplateColumns: 'auto repeat(3, minmax(56px, 1fr))',
        flex: 1, minWidth: 250,
      }}>
        <Box />
        {[0, 1, 2].map(o => (
          <Box key={o} sx={{
            fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6,
            color: 'text.secondary', textAlign: 'center', pb: 0.5,
          }}>{o} out{o === 1 ? '' : 's'}</Box>
        ))}

        {BASE_ROW_ORDER.map((bases, row) => (
          <Box key={bases} sx={{ display: 'contents' }}>
            <Box sx={{
              display: 'flex', alignItems: 'center', pr: 1.25, whiteSpace: 'nowrap',
              fontSize: '0.75rem', fontWeight: 700, color: 'text.secondary',
              borderTop: row === 0 ? 'none' : '1px solid', borderColor: 'divider',
            }}>{BASE_SHORT[bases]}</Box>
            {[0, 1, 2].map(outs => {
              const cell = table.cells[outs][bases]
              return (
                <Box key={outs} sx={{
                  position: 'relative', px: 0.5, py: 0.6, textAlign: 'center',
                  display: 'flex', flexDirection: 'column', justifyContent: 'center',
                  borderTop: row === 0 ? 'none' : '1px solid',
                  borderLeft: '1px solid', borderColor: 'divider',
                }}>
                  {/* A wash proportional to the value, so the shape of the table reads before
                      any single number does. Behind the text rather than on it: the numbers
                      are the information and must keep their contrast. */}
                  <Box sx={{
                    position: 'absolute', inset: 0, bgcolor: accent,
                    opacity: cell.re == null ? 0 : 0.06 + 0.18 * (cell.re / max),
                    pointerEvents: 'none',
                  }} />
                  <Typography sx={{
                    position: 'relative', fontSize: '0.85rem', fontWeight: 800,
                    fontVariantNumeric: 'tabular-nums',
                    color: cell.re == null ? 'text.disabled' : 'text.primary',
                  }}>{fmtRe(cell.re)}</Typography>
                  <Typography sx={{
                    position: 'relative', fontSize: '0.58rem', color: 'text.disabled',
                    fontVariantNumeric: 'tabular-nums',
                  }}>{cell.n}</Typography>
                </Box>
              )
            })}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// ── The explanation ──────────────────────────────────────────────────────────────
//
// THE THREE TERMS ARE NAMED ONCE, HERE, and both the formula and the worked example read
// these constants. They used to be two hand-written copies on two different tabs, and they had
// already drifted: the ledger's first line said "Runs it put on the board" while the sentence
// explaining it said "the runs a play scored". A reader is being asked to match three labels
// in a formula against three rows in a ledger, and matching them is the entire lesson, so the
// two must be the same words or the lesson is a puzzle instead.
const TERMS = {
  runs:   'Runs it scored',
  after:  'What it left behind',
  before: 'What it started with',
} as const

/** Remembered per browser: a reader who opened this once wants it open next time, and one who
 *  never opens it should not be asked again on every visit. Shut by default.
 *
 *  The stored name is left as it is. It has meant "the explainer", then "the table", and now
 *  the explainer again; renaming it would clear the choice of everyone who has already made
 *  one to buy nothing but a tidier string. */
const TABLE_KEY = 'wpbl_runvalue_how_open'
function readTableOpen(): boolean {
  try { return localStorage.getItem(TABLE_KEY) === '1' } catch { return false }
}

/** A numbered step.
 *
 *  The number sits INLINE with the heading rather than in a rail down the left, and that is a
 *  phone measurement rather than a preference: an indented body would take about 34px off a
 *  309px card, and the situations grid inside step 1 asks for 250px before it starts scrolling
 *  sideways. Full-width bodies keep the grid whole. */
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mt: n === 1 ? 0 : 2.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.9, mb: 0.75 }}>
        <Box aria-hidden sx={{
          width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: 'var(--wpbl-accent-solid)', color: '#fff',
          fontSize: '0.68rem', fontWeight: 800, lineHeight: 1,
        }}>{n}</Box>
        <Typography sx={{ fontSize: '0.86rem', fontWeight: 800, lineHeight: 1.2 }}>{title}</Typography>
      </Box>
      {children}
    </Box>
  )
}

/** Prose inside the explanation. One size, one colour, so a step reads as a paragraph and not
 *  as four competing weights. */
function Say({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{ fontSize: '0.82rem', lineHeight: 1.65, color: 'text.secondary' }}>
      {children}
    </Typography>
  )
}

/** The formula, as three named terms rather than a sentence.
 *
 *  Set as terms because the next thing on screen is a ledger with the same three labels down
 *  it: seeing the shape here and then the arithmetic there is what makes the example legible,
 *  and a sentence would have to be taken apart first. Wraps on a narrow screen, which is why
 *  it is a flex row of pieces and not a single line with characters in it. */
function Formula() {
  const term = (t: string) => (
    <Box component="span" sx={{
      px: 0.9, py: 0.4, borderRadius: 1.5, bgcolor: 'background.paper',
      border: '1px solid', borderColor: 'divider',
      fontSize: '0.76rem', fontWeight: 700, color: 'text.primary',
    }}>{t}</Box>
  )
  const op = (o: string) => (
    <Box component="span" aria-hidden sx={{ fontSize: '0.9rem', fontWeight: 800, color: 'text.disabled' }}>{o}</Box>
  )
  return (
    <Box sx={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
      gap: 0.75, my: 1.25,
    }}>
      {term(TERMS.runs)}
      {op('+')}
      {term(TERMS.after)}
      {/* A true minus, not a hyphen: it is set beside a plus of the same weight and a hyphen
          reads a size smaller between them. */}
      {op('−')}
      {term(TERMS.before)}
    </Box>
  )
}

/** One line of the worked example: the term, the situation it prices, and the signed amount.
 *  Three columns rather than a sentence so the numbers line up under each other and the
 *  addition can be checked down the right-hand edge. */
function Ledger({ label, detail, amount }: { label: string; detail: string; amount: number }) {
  return (
    <Box sx={{
      display: 'grid', gridTemplateColumns: '1fr auto', gap: 1, alignItems: 'baseline', py: 0.35,
    }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography component="span" sx={{ fontSize: '0.78rem', color: 'text.primary' }}>{label}</Typography>
        <Typography component="span" sx={{ fontSize: '0.72rem', color: 'text.disabled' }}> {detail}</Typography>
      </Box>
      <Typography sx={{
        fontSize: '0.82rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'text.primary',
      }}>
        {/* Explicit signs on every line, including the positive ones: the reader is being asked
            to add three numbers, and a column where two terms are signed and one is not is a
            column that has to be re-read to see which way it goes. */}
        {amount >= 0 ? '+' : '−'}{Math.abs(amount).toFixed(2)}
      </Typography>
    </Box>
  )
}

/** One real play, taken through the three terms.
 *
 *  CHOSEN, NOT WRITTEN, by `workedExample`: the run-expectancy table moves every time a game is
 *  ingested, so a hand-picked play with its numbers pasted into the copy would quietly stop
 *  matching the table the rest of the card is drawn from and nothing anywhere would report it.
 *  It picks the play nearest its own event's average, so the sum lands on a number the reader
 *  can go and check on the Findings board. */
function WorkedPlay({ worked, date, accent }: {
  worked: WorkedExample; date: string | null; accent: string
}) {
  const v = worked.value

  // THE COLUMN HAS TO ADD UP, so the total is the sum of the ROUNDED terms rather than the
  // rounded true value. This card exists for the one reader who checks the arithmetic, and
  // they were being handed a column that does not: a play worth 0.5551 prints its parts as
  // +1.00, +1.18 and −1.63, which come to 0.55, under a total reading +0.56. Nothing is wrong
  // with either number and the reader has no way to know that, so the example teaching them
  // the formula is also the example proving they cannot trust it.
  //
  // The cost is at most half a hundredth of a run on one illustrative play, which is invisible
  // and changes no ranking anywhere: `fmtRunValue(v.value, 2)` stays the number every board
  // and every leaderboard shows. Only this ledger, whose whole job is being checkable, trades
  // that last digit for adding up.
  const r2 = (n: number) => Math.round(n * 100) / 100
  const runs = r2(v.runs), after = r2(v.after), before = r2(v.before)
  const total = r2(runs + after - before)

  return (
    <Box sx={{
      border: '1px solid', borderColor: 'divider', borderRadius: 2,
      bgcolor: 'background.paper', px: 1.5, py: 1.25, mt: 1,
    }}>
      <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled', mb: 0.25 }}>
        {v.play.inning != null && `${v.play.half === 'bottom' ? 'Bottom' : 'Top'} ${ordinal(v.play.inning)}`}
        {date && ` · ${date}`}
      </Typography>
      {/* The feed's own sentence for the play, which is the one thing on this card nobody has
          to be taught to read. */}
      <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: 'text.primary', mb: 1, lineHeight: 1.45 }}>
        {v.play.narrative || `${v.play.batter_name}, ${worked.event.label.toLowerCase()}`}
      </Typography>

      <Ledger label={TERMS.runs}
        detail={v.runs === 1 ? 'a runner crossed' : `${v.runs} runners crossed`}
        amount={runs} />
      <Ledger label={TERMS.after}
        detail={v.afterBases == null || v.afterOuts == null
          ? 'the inning was over, so nothing'
          : describeState(v.afterBases, v.afterOuts)}
        amount={after} />
      <Ledger label={TERMS.before}
        detail={describeState(v.bases, v.outs)}
        amount={-before} />

      <Box sx={{
        display: 'grid', gridTemplateColumns: '1fr auto', gap: 1, alignItems: 'baseline',
        borderTop: '2px solid', borderColor: 'divider', mt: 0.75, pt: 0.75,
      }}>
        <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: 'text.primary' }}>
          That {worked.event.label.toLowerCase()} was worth
        </Typography>
        <Typography sx={{
          fontSize: '0.95rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums',
          color: total >= 0 ? accent : 'text.secondary',
        }}>
          {fmtRunValue(total, 2)}
        </Typography>
      </Box>
    </Box>
  )
}

/** Rows a phone shows before it offers the rest. Both boards hold ten; five is the half that
 *  fits beside everything else on the screen. */
const LIST_CAP = 5

function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <Box sx={{ textAlign: 'center', py: 5, px: 2, color: 'text.secondary' }}>
      <Typography sx={{ fontSize: '1rem', fontWeight: 700, mb: 0.5 }}>{title}</Typography>
      {hint && <Typography sx={{ fontSize: '0.85rem', color: 'text.disabled' }}>{hint}</Typography>}
    </Box>
  )
}

/** "6th", for an inning in a sentence. Innings only, so the teens never come up. */
function ordinal(n: number): string {
  return `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`
}

export default function WpblRunValueView({ side, teams, games, onOpenPlayer, openExplainer }: {
  side: 'hitting' | 'pitching'
  teams: WpblTeam[]
  /** Required, not convenience: nothing here can tell a postseason play from a regular-season
   *  one without the schedule, and it also needs to know which games have finished.
   *  See derive/runExpectancy.ts. */
  games: WpblGame[]
  onOpenPlayer: (p: WpblPlayer) => void
  /** Open the explanation on arrival, overriding the remembered preference.
   *
   *  For the Findings board's "how this is worked out" row, which promises an explanation and
   *  would otherwise deliver a leaderboard: the card is shut by default, so a reader who had
   *  never opened it followed a link about method and landed on a list of names with the thing
   *  they asked for folded away somewhere below. Only that link passes this. Tapping the Run
   *  value chip directly still gets whatever the reader last chose. */
  openExplainer?: boolean
}) {
  // Read once, at mount. Only one Stats board is mounted at a time, so arriving from Findings
  // is always a fresh mount and the flag is always seen; it is not a prop this component has
  // to keep watching.
  const [tableOpen, setTableOpen] = useState(() => openExplainer || readTableOpen())
  const toggleTable = useCallback(() => {
    setTableOpen(prev => {
      const next = !prev
      try { localStorage.setItem(TABLE_KEY, next ? '1' : '0') } catch { /* choice just isn't remembered */ }
      return next
    })
  }, [])
  const isNarrow = useMediaQuery('(max-width:600px)')
  const [allLeaders, setAllLeaders] = useState(false)

  const [plays, setPlays] = useState(() => getCachedWpblAllRunValuePlays())
  const [players, setPlayers] = useState<WpblPlayer[]>(() => getCachedWpblAllPlayers() ?? [])
  const [loading, setLoading] = useState(() => getCachedWpblAllRunValuePlays() == null)

  // Same shape as the pitch board: paint from the session cache, then revalidate. The bulk
  // fetchers collapse anything inside their freshness window, so flipping between the two
  // boards does not re-run the season-wide play scan.
  useEffect(() => {
    let cancelled = false
    Promise.all([fetchWpblAllRunValuePlays(), fetchWpblAllPlayers()])
      .then(([p, pl]) => {
        if (cancelled) return
        setPlays(p); setPlayers(pl); setLoading(false)
      })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const accent = wpblAccentFg(useWpblDark())

  const table = useMemo(
    () => (plays ? buildRunExpectancy(plays, games) : null), [plays, games])
  const values = useMemo(
    () => (plays && table ? playRunValues(plays, games, table) : []), [plays, games, table])
  const leaders = useMemo(
    () => runValueLeaders(values, players, side).slice(0, 10), [values, players, side])

  // The worked example, and the per-event averages it has to land on. Both were computed on
  // the Findings board and nowhere else until the explanation moved here; they are pure and
  // memoised on the same arrays the boards above already walk, so this costs a pass over the
  // season and no request.
  const rows = useMemo(() => eventValues(values), [values])
  const worked = useMemo(() => workedExample(values, rows), [values, rows])
  const workedDate = useMemo(() => {
    const g = worked && games.find(x => x.id === worked.value.play.game_id)
    return g ? new Date(`${g.game_date}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }) : null
  }, [worked, games])

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
  }
  if (!table || table.pa === 0) {
    return <EmptyState title="Nothing to price yet" hint="This board fills in from the play-by-play as games are played." />
  }

  const pitching = side === 'pitching'

  const shownLeaders = isNarrow && !allLeaders ? leaders.slice(0, LIST_CAP) : leaders

  // The two cells step 1 quotes in words, read off the same table the grid under it draws, so
  // the sentence and the spreadsheet can never disagree. Both are nullable: a state the season
  // has not produced has no value, and the sentence simply drops that clause. Bases loaded is
  // the bitmask 1|2|4.
  const leadoff = reOf(table, 0, 0)
  const loaded = reOf(table, 0, 7)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 1.5, sm: 2 } }}>
      {/* ONE SENTENCE, AND NO HEADING. The board tab directly above already says "Run value",
          so a title under it named the same board twice in two sets of words. What has to stay
          is the unit: every figure below is "runs" in a sense nobody uses at the ballpark, and
          a reader who takes +19.0 for runs scored has been misled by us rather than confused by
          the stat. That is also the whole of what the experimental flag was protecting people
          from, which is why this line, not the flag, is what the board now ships with. */}
      <Box sx={{ maxWidth: '70ch' }}>
        <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', lineHeight: 1.5 }}>
          Run value is how much better or worse off a play left a team, counted in runs,
          from this league's own {table.games} games.
        </Typography>
      </Box>

      {/* The leaderboard, full width. It shared a row with a how-it-works card until that came
          off; on its own it takes the whole measure rather than leaving half the row empty. */}
      <SectionCard title={pitching ? 'Most runs saved' : 'Most runs created'}>
        {leaders.length === 0
          ? <Typography sx={{ fontSize: '0.85rem', color: 'text.disabled', py: 1 }}>Not enough plays yet.</Typography>
          : shownLeaders.map((r, i) => (
              <LeaderRow key={r.player?.id ?? r.name} rank={i + 1} player={r.player} name={r.name}
                teamId={r.teamId} value={fmtRunValue(r.value)} unit="runs" accent={accent}
                onOpen={onOpenPlayer}
                sub={pitching ? `${r.pa} batters faced` : `${r.pa} times up`} />
            ))}
        {isNarrow && leaders.length > LIST_CAP && (
          <ExpandRow flush expanded={allLeaders} moreLabel={`Show all ${leaders.length}`}
            onToggle={() => setAllLeaders(v => !v)} />
        )}
      </SectionCard>

      {/* THE WHOLE EXPLANATION, IN ONE SHUT CARD, in the order the idea is actually built:
          a situation is worth something, a play is worth what it changed to it, and here is one
          real play doing that. Every step is a sentence and its evidence, so a reader can stop
          after any of the three and have learned something true.

          Width-capped for the same reason the grid inside it always was: four columns and a
          paragraph spread across 1,100px stop being a grid and a paragraph. */}
      <Box sx={{ maxWidth: { md: 620 } }}>
        <SectionCard title="How run value works" collapsed={!tableOpen} onToggleCollapse={toggleTable}>
          <Step n={1} title="Every situation is already worth something">
            {/* "ON AVERAGE" IS LOAD-BEARING AND GOES IN THE DEFINING SENTENCE. Without it the
                line reads as a promise ("this situation is worth 1.12 runs"), and the first
                time a reader watches a leadoff single produce nothing they have caught the site
                being wrong. It is a mean over every time the situation has come up, the cell
                counts under the grid are the sample it is a mean of, and the sentence has to
                say so before the numbers appear rather than in a caption underneath them. */}
            <Say>
              Before a pitch is thrown, the situation a batter comes up in already has a value:
              how many runs teams go on to score from there to the end of the inning, on average.
              {leadoff != null && ` Leading off an inning that is ${leadoff.toFixed(2)} runs.`}
              {loaded != null && ` With the bases loaded and nobody out, ${loaded.toFixed(2)}.`}
            </Say>
            <Box sx={{ mt: 1.25 }}>
              <ReGrid table={table} accent={accent} />
            </Box>
            {/* The caption no longer repeats "on average": the sentence above now carries it,
                and saying it twice within three lines reads as hedging rather than as care. */}
            <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', mt: 0.75, lineHeight: 1.5 }}>
              Runs from here to the end of the inning. The small number is how often the
              situation has come up.
            </Typography>
          </Step>

          <Step n={2} title="A play is worth what it changed">
            <Say>
              So what a play is worth is what it did to that number, plus anything it put on the
              board:
            </Say>
            <Formula />
            <Say>
              A play that leaves a team better off than it found them is worth a positive number
              of runs. One that leaves them worse off, like most outs, is negative.
            </Say>
          </Step>

          <Step n={3} title="One real play, from this season">
            {worked ? (
              <>
                <WorkedPlay worked={worked} date={workedDate} accent={accent} />
                <Typography sx={{ fontSize: '0.82rem', lineHeight: 1.65, color: 'text.secondary', mt: 1.25 }}>
                  That is every run-value number on the site. Do the same for all{' '}
                  {worked.event.n} {worked.event.label.toLowerCase()}s this season and the average
                  is {fmtRunValue(worked.event.per, 2)} runs, which is what a{' '}
                  {worked.event.label.toLowerCase()} has been worth in this league.
                </Typography>
              </>
            ) : (
              <Say>
                The first one the season produces will be worked through here, line by line.
              </Say>
            )}
          </Step>

          {/* The small print, and it is the last thing on purpose. Only one line of it carries a
              surprise: a steal moves the situation but nobody's total, because the feed names the
              batter standing at the plate rather than the runner who ran, so the caught stealing
              that ended an inning is priced to nobody. The rest are house rules a reader can
              assume (a walk-off inning stops when the winning run scores rather than at three
              outs, so it cannot say what the inning went on to be worth; an inning short of its
              own line score is missing rows; the postseason is out of every season number on the
              section). Spent higher up they buried the one thing worth reading.

              NO OTHER LEAGUE IN HERE, and it has been tried. The argument for building our own
              table is a comparison with the majors, and that is an argument for whoever wrote
              the code rather than for whoever is reading the card: a fan of this league can do
              nothing with it, and it invites the section to be read as a comparison to another
              league rather than as a record of this one. Say where the numbers come from, not
              what they are unlike. Do not put it back. */}
          <Typography sx={{
            fontSize: '0.72rem', color: 'text.disabled', lineHeight: 1.55,
            mt: 2.5, pt: 1.5, borderTop: '1px solid', borderColor: 'divider',
          }}>
            Measured from this league&rsquo;s own games and nowhere else: {table.pa.toLocaleString()}{' '}
            plate appearances across {table.games} games, each one scored forward to the end of
            its inning. Steals and wild pitches move the situation but not a player&rsquo;s total,
            because the feed names the batter rather than the runner. Walk-off innings, the
            postseason, and any inning the league&rsquo;s own line score says is missing runs are
            left out.
          </Typography>
        </SectionCard>
      </Box>
    </Box>
  )
}

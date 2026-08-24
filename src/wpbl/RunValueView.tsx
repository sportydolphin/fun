import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress, useMediaQuery } from '@mui/material'
import {
  fetchWpblAllRunValuePlays, fetchWpblAllPlayers,
  getCachedWpblAllRunValuePlays, getCachedWpblAllPlayers,
} from './api'
import {
  BASE_ROW_ORDER, BASE_SHORT, buildRunExpectancy, describeState,
  fmtRe, fmtRunValue, playRunValues, runValueLeaders, type PlayRunValue, type ReTable,
} from './derive/runExpectancy'
import { wpblAccentFg } from './constants'
import { SectionCard, LeaderRow, PlayerPortrait, ExpandRow, useWpblDark, useWpblName } from './ui'
import { ExperimentalChip } from '../ExperimentsContext'
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
// good", which is the question people bring, and it carries the section on its own. There was
// also a how-it-works card beside the board (two sentences and one play worked through); it
// came off too, and the one-line intro plus the shut situations table carry what it taught.
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
// 24-situation table and the caveats. Nobody has to read any of that to use the board, and it
// is one tap away for anyone who wants it.
//
// THE TABLE IS NOT THE OPENING ACT, AND THAT IS THE WHOLE LAYOUT. A 24-cell grid of two-decimal
// numbers is the most expert-looking thing on the section, and it led the page in the first
// version: a fan who came to see who is having a good season met a spreadsheet and left. So the
// order is now the players first, then the table last and folded shut. The one-line intro
// carries the idea on its own, quoting the unit inline, which is as much as a casual reader
// ever needs. The grid stays for the reader who wants it, one tap away and remembered.
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

/** Remembered per browser: a reader who opened the table once wants it open next time, and one
 *  who never opens it should not be asked again on every visit. Shut by default.
 *
 *  The stored name is left as it is. It has meant "the explainer" and now means "the table"
 *  again, and renaming it would clear the choice of everyone who has already made one to buy
 *  nothing but a tidier string. */
const TABLE_KEY = 'wpbl_runvalue_how_open'
function readTableOpen(): boolean {
  try { return localStorage.getItem(TABLE_KEY) === '1' } catch { return false }
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

export default function WpblRunValueView({ side, teams, games, onOpenPlayer }: {
  side: 'hitting' | 'pitching'
  teams: WpblTeam[]
  /** Required, not convenience: nothing here can tell a postseason play from a regular-season
   *  one without the schedule, and it also needs to know which games have finished.
   *  See derive/runExpectancy.ts. */
  games: WpblGame[]
  onOpenPlayer: (p: WpblPlayer) => void
}) {
  const [tableOpen, setTableOpen] = useState(readTableOpen)
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

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
  }
  if (!table || table.pa === 0) {
    return <EmptyState title="Nothing to price yet" hint="This board fills in from the play-by-play as games are played." />
  }

  const pitching = side === 'pitching'

  const shownLeaders = isNarrow && !allLeaders ? leaders.slice(0, LIST_CAP) : leaders

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 1.5, sm: 2 } }}>
      {/* One line, and it has to carry the unit on its own: every number below is "runs" in a
          sense nobody uses at the ballpark, and a reader who takes +19.0 for runs scored has
          been misled by us rather than confused by the stat. */}
      <Box sx={{ maxWidth: '70ch' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
          <Typography component="h2" sx={{ fontSize: { xs: '1rem', sm: '1.1rem' }, fontWeight: 800, lineHeight: 1.2 }}>
            What a play is worth
          </Typography>
          {/* The board is behind the experiments switch, and a reader who turned that on weeks
              ago has no way to tell which of the things in front of them is the one that may
              be wrong tomorrow. */}
          <ExperimentalChip />
        </Box>
        <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', mt: 0.5, lineHeight: 1.5 }}>
          Every play leaves a team better or worse off than it was. Run value is that
          difference, counted in runs, from this league's own {table.games} games.
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

      {/* The 24 situations the whole board is priced off, shut. It is the most expert-looking
          thing on the section and the least necessary: the two sentences above quote the only
          two cells anybody needs, and this is here for the reader who wants to check them.
          Width-capped, because four columns spread across 1,100px stop reading as a grid. */}
      <Box sx={{ maxWidth: { md: 560 } }}>
        <SectionCard title="What every situation is worth"
          subtitle="Runs a team goes on to score from here to the end of the inning, on average. The small number is how many times it has come up."
          collapsed={!tableOpen} onToggleCollapse={toggleTable}>
          <ReGrid table={table} accent={accent} />
        </SectionCard>
      </Box>

      <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', px: 1, lineHeight: 1.55, maxWidth: '70ch' }}>
        Worked out from the play-by-play, which records the outs and the runners every play
        started with.
        {' '}Steals and wild pitches shape the table but are left out of the player totals,
        since the feed names the batter standing there rather than the runner who ran.
        {' '}The inning a game ends on is left out, because it stopped when the game did rather
        than at three outs.
        {' '}Postseason games are left out, like every other season number here.
      </Typography>
    </Box>
  )
}

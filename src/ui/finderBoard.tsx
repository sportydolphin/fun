import React, { useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ExampleLadder } from './finderExamples'
import { Box, Skeleton, Typography } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import LinkIcon from '@mui/icons-material/Link'
import CheckIcon from '@mui/icons-material/Check'
import { FilterSelect } from './FilterChip'
import { finderColumns, finderFields, defaultCondition,
  displayFinderValue, describeFinderQuery, describeFinderConditions, describeFinderCuts, finderSpanText, finderScoreText, finderLowerBetter, finderPlainCount, conditionsForPer, finderPitcherApplies, finderPlayerApplies, finderPlayerAt, hasPlayerFilter, FINDER_MONTH_NAMES, finderSpanMonth, finderMonthSpan,
  finderCutsOf, finderDhText, finderStretchApplies, finderStretchText,
  type FinderCondition, type FinderPer, type FinderQuery, type FinderResult, type FinderRow,
  type FinderBoardSide, type FinderSort, type FinderTally, type FinderVenue,
} from '../league/finder'
import type { LeagueGame, LeaguePlayer } from '../league/types'
import { SectionCard, SectionLabel, TYPE_SCALE, CARD_BORDER, CARD_FILL, ACCENT_EDGE } from './card'
import { ExpandRow } from './ExpandRow'
import { PillGroup } from './PillGroup'
import { InfoDot } from './InfoDot'
import { LeaderCard, LeaderCardSkeleton, printedRanks, type LeaderItem } from './leaders'
import { FOCUS_RING, TAPPABLE, hoverOnly, pressable } from './interaction'
import { NameColumn, NameText } from './NameText'
import { chromePx, typePx } from './scale'
import { BOTTOM_NAV_SPACE } from './BottomNav'
import type { Theme } from '@mui/material/styles'
import { finderNearMisses } from '../league/finderNearMiss'
import { AddMenu, ChipSurface, ChoiceList, ConditionEditor, startCondition, type ChoiceGroup } from './finderChips'
import { BOARD_COLUMN } from './layoutWidths'
import { GameYearContext, gameDateText } from './gameLine'

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
// the tally squeezed into a third of the column. Two things now switch on, each only once the
// board's own width has room for it: the list becomes a table with the line's columns, and the
// tally moves beside the table. (A third, the question in a pinned rail, went on Nov 9, 2026: only
// Fielding was ever narrow enough to get it.) The thresholds are in rem because the table's columns are, so at the Large
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
// THE RANK COLUMN HOLDS "T-10" at the meta size (37px of 40 at 1440), since ties are marked. The
// half rem it gained came out of Result, whose widest score ("W 18–7") used 53px of 75, so the
// player column kept its width: taken from the player column instead, "N. Yonetani" clipped.
// THE GAME COLUMN HOLDS "Aug 28 vs BOS" in bold, 85px at 1rem = 16px: at 5.25rem it had 72px, and the
// date ran into its result (Nov 23, 2026). A two-digit day and a three-letter club is the widest night.
const COL = { rank: 2, player: 8, game: 6.25, result: 3.25, stat: 2.4, gap: 0.4 }
// A LINE'S STATS ARE COUNTS, a digit or two, so their columns are narrower than a season's rates
// (".552", "1.155") and the player column takes the difference, floor and all. At 2.4 and 8 every
// name column at 1440 sat on its floor beside the tally, and "F. Last" itself was cut by up to 31px
// ("T. Maximiliana" on PAs, "N. Yonetani" on games, Nov 9, 2026). The floor rises by what the stats
// give up, so the width where the tally moves in is where it was.
const LINE_COL = { ...COL, player: 10, stat: 2.15 }
// A STRETCH'S GAMES, "Aug 13 to Sep 22" at the meta size: sixteen characters, about 0.5rem each.
const STRETCH_COL_REM = 8.25
// A CLUB'S HALF-INNING'S SCORE, "10–5 → 12–5" at the meta size: eleven characters and an arrow.
const SCORE_COL_REM = 6.5
// EVERY SEASON AT ONCE (GameYearContext): a season row's year in a column of its own ("2026"), and
// the year on every game's date (", 2026", about six characters more in the Game column).
const YEAR_COL_REM = 3
const GAME_YEAR_REM = 3
// THE SAME LINE HEIGHTS LOADING AND LOADED, so the rows do not change height when they land: the
// placeholders took the type's default and stood 1.6px taller a row than the names that replaced them.
const NAME_LH = 1.4
const NIGHT_LH = 1.35
const colsFor = (per: FinderPer) => (per === 'season' ? COL : LINE_COL)
// A STAT COLUMN HOLDS ITS HEAD'S LONGEST WORD, sort mark included, and a two-word head wraps. Sized
// for a number alone, "HR ROW ▾" ran straight into "INN" beside it on the PAs grain (Nov 10, 2026
// audit). Widened to the whole head instead, the PAs table needed 1.2rem more and fell back to cards
// at 800px. A head is micro type (0.68rem) in heavy capitals, measured at 0.48rem a letter, and " ▾"
// takes 0.7rem: "ROW ▾" and "RBI ▾" sit at the floor, and only "BUNT", "OUTS" and "RISP" widen.
const HEAD_CHAR_REM = 0.48
const SORT_MARK_REM = 0.7
// A PLAIN COUNT IS THREE DIGITS AT MOST ("712" PA), 1.35rem at the body size with the cell's padding,
// so its floor sits under a rate's (".300", "1.155"). Every column at the rate's floor left a G or an
// HR column two thirds empty, and a phone saw four stats of twelve where it now sees six (Nov 23, 2026).
const COUNT_STAT_REM = 1.7
const statRem = (per: FinderPer, unit: string, count = false) =>
  Math.max(count ? Math.min(COUNT_STAT_REM, colsFor(per).stat) : colsFor(per).stat,
    Math.max(...unit.split(' ').map(w => w.length)) * HEAD_CHAR_REM + SORT_MARK_REM)
/** The table's narrowest, which is what the main column must hold before it is drawn: the fixed
 *  columns, the player column's floor, the gaps, and the card's padding and borders (2 x 16 chrome
 *  px, under 2.5rem at either scale). */
const tableMinRem = (units: readonly { unit: string; count: boolean }[], per: FinderPer = 'game', stretched = false, years = false, yearCol = false, scored = false) => {
  const c = colsFor(per)
  const stats = units.length
  const statsRem = units.reduce((sum, u) => sum + statRem(per, u.unit, u.count), 0)
  return per === 'season'
    ? c.rank + c.player + statsRem + (stats + 1) * c.gap + 2.5 + (stretched ? STRETCH_COL_REM + c.gap : 0) + (yearCol ? YEAR_COL_REM + c.gap : 0)
    : c.rank + c.player + c.game + c.result + statsRem + (stats + 3) * c.gap + 2.5 + (years ? GAME_YEAR_REM : 0) + (scored ? SCORE_COL_REM + c.gap : 0)
}
/** A grain's name over its examples. */
const GRAIN_LABEL: Record<FinderPer, string> = { game: 'Single games', club: 'Club games', inning: 'Single innings', pa: 'Plate appearances', season: 'Season totals' }
// THE SWITCH SAYS THEM SHORT ON EVERY SIDE. More than two do not fit a phone at the long names, and
// until Nov 9, 2026 a side with two (Fielding, MLB) said "Single games / Season totals" while the
// sides with four said "Games / Seasons" for the same two choices.
// "CLUB GAMES", NOT "CLUBS": a hitting season asks Players or Clubs right after this switch, and two
// "Clubs" a row apart meant two different things (a club's game, a club's season).
const GRAIN_SHORT: Record<FinderPer, string> = { game: 'Games', club: 'Club games', inning: 'Innings', pa: 'PAs', season: 'Seasons' }
/** What one row is, for the counts and titles: "12 games", "Most innings matching". */
const GRAIN_NOUN: Record<FinderPer, [string, string]> = {
  game: ['game', 'games'], club: ['club game', 'club games'], inning: ['inning', 'innings'], pa: ['plate appearance', 'plate appearances'], season: ['season', 'seasons'],
}
const GRAIN_LEAD: Record<FinderPer, string> = { game: '', club: 'Club: ', inning: 'Inning: ', pa: 'PA: ', season: 'Season: ' }
const DEFAULT_GRAINS: FinderPer[] = ['game', 'season']
const DEFAULT_SIDES: FinderBoardSide[] = ['hitting', 'pitching']
const SIDE_LABEL: Record<FinderBoardSide, string> = { hitting: 'Hitting', pitching: 'Pitching', fielding: 'Fielding' }
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

/** A question worth one tap, offered as a chip. The section's own, since what counts as a long
 *  start differs between a seven-inning league and a nine-inning one. */
export interface FinderExample {
  label: string
  conditions: FinderCondition[]
  /** A season question, offered under Season totals. Absent is a game question. */
  per?: FinderPer
  /** Bars to try, the most impressive first, so the tile names what the slice holds (finderExamples.ts). */
  ladder?: ExampleLadder
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
  /** A year typed with the question, or null (or absent) for the board's own season. */
  season?: number | null
  /** The rest of `FinderQuery`, where the reading says it: a club's rows, a span, an arm and the
   *  players a name in the question picked (src/league/playerQuestion.ts). Absent leaves the board's own
   *  players as they are; the section decides what the rest means. */
  byClub?: boolean
  from?: string | null
  to?: string | null
  last?: number | null
  hand?: 'L' | 'R' | null
  extra?: boolean | null
  dh?: 'any' | 1 | 2 | null
  stretch?: number | null
  playerId?: string | null
  batterId?: string | null
  pitcherId?: string | null
  /** Asked as a ranking ("Highest batting average vs LHP"), which the preview says in those words. */
  rank?: { lead: 'Most' | 'Highest' | 'Lowest'; field: string }
}

type PickGroups = { label: string; options: { value: string; label: string }[] }[]

/** The board's player pickers, under their clubs, and a picked player's name. `players` is who the
 *  side on screen files its lines under (its hitters, pitchers or fielders); the other two are a plate
 *  appearance's two sides, for the matchup. */
export interface FinderPlayerPicks {
  players: PickGroups
  batters: { label: string; options: { value: string; label: string }[] }[]
  pitchers: { label: string; options: { value: string; label: string }[] }[]
  name: (id: string) => string
}

/** The club, opponent, venue and players in words: "for NY, vs LA, at home, by K. Whitmore". */
function scopeWords(side: FinderBoardSide, q: Pick<FinderQuery, 'teamId' | 'oppId' | 'venue' | 'per' | 'batterId' | 'pitcherId' | 'playerId' | 'byClub' | 'from' | 'to' | 'last' | 'hand' | 'extra' | 'dh' | 'stretch'>,
  clubAbbr: (id: string) => string, name: (id: string) => string = id => id): string {
  const pa = q.per === 'pa'
  const against = finderPitcherApplies(side, q.per)
  return [
    !pa && q.playerId && finderPlayerApplies(side, q.per, q.byClub) && `by ${name(q.playerId)}`,
    q.teamId && `for ${clubAbbr(q.teamId)}`,
    q.oppId && `vs ${clubAbbr(q.oppId)}`,
    q.venue === 'home' ? 'at home' : q.venue === 'away' ? 'on the road' : null,
    pa && q.batterId && `by ${name(q.batterId)}`,
    against && q.pitcherId && `against ${name(q.pitcherId)}`,
    // The span, the last N games and the arm, mid-sentence: "since Aug 1", "vs LHP". A month keeps its capital.
    // A kind of game and a stretch: "in extra innings", "in a 5-game stretch".
    ...describeFinderCuts(side, q).map(c => (c.key === 'stretch' ? `in a ${c.text}`
      : c.key === 'extra' || c.key === 'dh' ? `in ${c.text.toLowerCase()}`
      : c.text.replace(/^(Since|Through|Last|Vs)\b/, w => w.toLowerCase()))),
  ].filter(Boolean).join(', ')
}

/**
 * THE QUESTION TYPED AS WORDS. The pickers are how a question is corrected; this is how most of
 * them can start, since "5 strikeouts no walks" is one line on a phone keyboard against six native
 * selects. It only ever suggests: what it understood is said back in the board's own words before
 * anything happens, and a reading on the other side says so, because "5 strikeouts" is a
 * pitcher's line and a hitter's.
 */
function AskBox({ side, parse, onAsk, clubAbbr, name, asking, answer, names }: {
  side: FinderBoardSide
  /** A question is already set, so the box adds to it rather than starting one. */
  asking: boolean
  parse: (text: string) => FinderReading[]
  onAsk: (r: FinderReading) => void
  clubAbbr: (id: string) => string
  /** A player id to the name the preview says back ("by Amira Hondras"). */
  name?: (id: string) => string
  /** The reading's answer before it is asked ("Leader .412 · Amira Hondras"), or null for none. */
  answer?: (r: FinderReading) => Promise<string | null>
  /** The players the words may mean, with the words rewritten to name them (`nameSuggestions`). */
  names?: (text: string) => { id: string; name: string; text: string }[]
}) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // WHAT THE LAST QUESTION DROPPED, kept past the Ask. Said only in the preview, it vanished with the
  // text the moment the chips appeared, and "2 hits at home vs Cleveland" became a list of every
  // home game with nothing to say the club had been left out (Nov 10, 2026 audit).
  const [dropped, setDropped] = useState<string[]>([])
  const readings = text.trim() ? parse(text) : []
  const best = readings.find(r => r.side === side) ?? readings[0] ?? null
  const ask = () => { if (best) { onAsk(best); setDropped(asTyped(best.ignored, text)); setText('') } }
  const showLine = !!text.trim() || dropped.length > 0
  // A question that is only a player and a cut ("Hondras vs RHP") has no stat to describe, so the
  // preview is the scope alone: "every season line, by Amira Hondras" buried the player, who is the question.
  const scope = best ? scopeWords(best.side, best, clubAbbr, name) : ''
  // A RANKING IS SAID AS ONE: "Highest batting average, vs LHP", where the board's statement of the same
  // question ("AVG at least .001, PA at least 10") reads as a filter nobody asked for.
  const ranked = best?.rank ? rankWords(best.side, best.per, best.rank, !!best.byClub, best.conditions) : ''
  const stated = ranked || (best && (best.conditions.length || !scope) ? describeFinderQuery(best.side, best) : '')
  const said = best ? [stated, scope].filter(Boolean).join(', ') : ''
  const lead = ranked ? '' : best ? GRAIN_LEAD[best.per] : ''
  const answered = useReadingAnswer(best, answer)
  const offered = names && text.trim() ? names(text) : []
  const take = (t: string) => { setText(`${t} `); setDropped([]); inputRef.current?.focus() }
  return (
    <Box>
      {/* A SEARCH BOX THAT LOOKS LIKE ONE: the mark and the button. Bare, its example placeholder read
          as a question already typed in (Nov 9, 2026 audit). */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Box sx={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <SearchIcon aria-hidden sx={{
            position: 'absolute', left: chromePx(10), top: '50%', transform: 'translateY(-50%)',
            fontSize: chromePx(18), color: 'text.secondary', pointerEvents: 'none',
          }} />
          <Box component="input" ref={inputRef} type="search" aria-label="Ask in words"
            // AN EXAMPLE ONLY WHILE THE BOX IS THE WHOLE QUESTION. Kept above the chips it read as the
            // question already asked, sitting over the one actually asked (Nov 10, 2026 audit).
            // Short enough for a 375px phone beside the Ask button, where the longer ones were cut.
            placeholder={asking ? 'Add: vs LA, 2+ RBI' : '3 hits at home, 5 HR'}
            value={text} enterKeyHint="search"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setText(e.target.value); setDropped([]) }}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); ask() } }}
            sx={{ ...fieldSx, boxSizing: 'border-box', width: '100%', pl: `calc(${chromePx(10)} + ${chromePx(18)} + 0.5rem)`, pr: 1.5, fontWeight: 600, textOverflow: 'ellipsis', '&::placeholder': { color: 'text.secondary', opacity: 1 } }} />
        </Box>
        <Box {...pressable(ask)} aria-disabled={!best || undefined} sx={{
          ...textButtonSx, border: '1px solid', borderColor: best ? ACCENT_EDGE : CARD_BORDER,
          color: best ? ACCENT_EDGE : 'text.secondary', cursor: best ? 'pointer' : 'default',
        }}>Ask</Box>
      </Box>
      {/* DRAWN ONLY WHILE THERE IS TEXT. Reserved always, it was a blank band between the box and
          the conditions that read as a gap in the form; it opens on the first keystroke, which is
          the reader's own input moving the page, and then holds its height while they type. */}
      <Box aria-live="polite" sx={{ minHeight: '1.75rem', display: showLine ? 'flex' : 'none', alignItems: 'center', px: 0.5 }}>
        {!text.trim() ? (dropped.length > 0 && (
          <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Ignored: {dropped.join(' ')}
          </Typography>
        )) : best ? (
          <Box {...pressable(ask)} sx={{
            ...FOCUS_RING, minWidth: 0, cursor: 'pointer', borderRadius: 1, px: 0.5, mx: -0.5,
            fontSize: TYPE_SCALE.meta, color: 'text.secondary', ...TAPPABLE,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            <Box component="span" sx={{ fontWeight: 800, color: ACCENT_EDGE }}>Ask ›</Box>{' '}
            {lead}{said}
            {best.side !== side && ` (${best.side})`}
            {best.ignored.length > 0 && `. Ignored: ${asTyped(best.ignored, text).join(' ')}`}
          </Box>
        ) : (
          <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Name a stat and a number: 3 hits, 0 walks, .300 on the season.
          </Typography>
        )}
      </Box>
      {/* THE ANSWER ON A LINE OF ITS OWN, so a long one ("7 times · last Sep 2 · most, Kelsie Whitmore
          (3)") wraps rather than cutting a name, and the question above it keeps its room. Held while
          the reading is being answered, so the line does not open under the reader's typing. */}
      {answer && text.trim() && best && (
        <Typography aria-live="polite" sx={{ minHeight: '1.5rem', px: 0.5, fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.primary' }}>
          {answered ?? ''}
        </Typography>
      )}
      {offered.length > 0 && (
        <Box role="group" aria-label="Players" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, px: 0.5, pb: 0.5 }}>
          {offered.map(o => (
            <Box key={o.id} {...pressable(() => take(o.text))} sx={{
              ...FOCUS_RING, ...TAPPABLE, display: 'inline-flex', alignItems: 'center', minWidth: 0, maxWidth: '100%',
              minHeight: chromePx(30), px: 1.25, borderRadius: 999, border: '1px solid', borderColor: ACCENT_EDGE,
              color: ACCENT_EDGE, fontSize: TYPE_SCALE.meta, fontWeight: 700, cursor: 'pointer',
            }}>
              <NameText name={o.name} component="span" sx={{ fontSize: 'inherit', fontWeight: 'inherit', color: 'inherit' }} />
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

/** A ranking in words, the way the search titles it: "Highest batting average", "Most walks in a game",
 *  then what cuts it ("Most home runs, bases loaded"). Without the cut, "most grand slams" and "most hr
 *  with risp" both previewed as the plain leaderboard they are not. The bar a rate brings (`pa`, `ip`)
 *  is the board's business, not the question's. */
function rankWords(side: FinderBoardSide, per: FinderPer, rank: { lead: string; field: string }, byClub: boolean,
  conditions: FinderQuery['conditions'] = []): string {
  const label = finderFields(side, per, true, byClub).find(f => f.key === rank.field)?.label ?? rank.field
  // An initialism keeps its capitals: "Highest OPS", "Lowest ERA".
  const stat = /^[A-Z]{2}/.test(label) ? label : label.toLowerCase()
  const at = per === 'game' ? ' in a game' : per === 'inning' ? ' in an inning' : per === 'pa' ? ' in a plate appearance' : ''
  const cuts = conditions.filter(c => c.field !== rank.field && c.field !== 'pa' && c.field !== 'ip')
  // Mid-sentence, so lower case, except an initialism ("RISP").
  const cut = cuts.length ? describeFinderConditions(side, { per, conditions: cuts })
    .map(p => (/^[A-Z]{2}/.test(p.text) ? p.text : p.text.charAt(0).toLowerCase() + p.text.slice(1))) : []
  return [`${rank.lead} ${stat}${at}${byClub ? ' by a club' : ''}`, ...cut].join(', ')
}

/**
 * The answer to the reading on screen, asked once the typing pauses, and kept by question so going
 * back over a word does not ask again. Undefined while it is being asked.
 */
function useReadingAnswer(r: FinderReading | null, answer: ((r: FinderReading) => Promise<string | null>) | undefined): string | null | undefined {
  const key = r ? JSON.stringify(r) : ''
  const done = useRef(new Map<string, string | null>())
  const [, bump] = useState(0)
  const latest = useRef(r)
  latest.current = r
  useEffect(() => {
    if (!key || !answer || done.current.has(key)) return
    let live = true
    const t = setTimeout(() => {
      const asked = latest.current
      if (!asked) return
      answer(asked).catch(() => null).then(a => { done.current.set(key, a); if (live) bump(n => n + 1) })
    }, 300)
    return () => { live = false; clearTimeout(t) }
  }, [key, answer])
  return key ? done.current.get(key) : undefined
}

/** The parser's ignored words as the reader typed them: it lowercases, and "Ignored: cleveland" read
 *  as a typo the reader had not made. */
function asTyped(words: string[], text: string): string[] {
  const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return words.map(w => text.match(new RegExp(`(?<![\\p{L}\\p{N}])${escape(w)}(?![\\p{L}\\p{N}])`, 'iu'))?.[0] ?? w)
}

/** Read by a screen reader, drawn nowhere. */
const visuallyHidden = { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const

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
  // AN ICON, so the header has room for Filters beside it on a phone. The words are still the
  // button's name, and what happened is said to a screen reader and in the tooltip.
  const words = state === 'copied' ? 'Copied' : state === 'failed' ? 'Can’t copy' : 'Copy link'
  return (
    <Box component="button" type="button" onClick={copy} aria-label={words} title={words} sx={{
      all: 'unset', ...FOCUS_RING, position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: chromePx(34), height: chromePx(34), borderRadius: 999, cursor: 'pointer', flexShrink: 0,
      color: state === 'failed' ? 'text.secondary' : ACCENT_EDGE,
      ...hoverOnly({ bgcolor: 'action.hover' }),
    }}>
      {state === 'copied' ? <CheckIcon sx={{ fontSize: chromePx(20) }} /> : <LinkIcon sx={{ fontSize: chromePx(20) }} />}
      <Box component="span" aria-live="polite" sx={visuallyHidden}>{state === 'idle' ? '' : words}</Box>
    </Box>
  )
}

/** The table's columns with the ones the question asks first, in the order asked: the answer is the
 *  first number on every row, whichever column the list is in order by. Not an exact condition ("0-2
 *  count", "bases loaded"), which reads the same on every row and is the chip's to say: first, it
 *  spent a phone card's first three cells on "B 0, S 2". */
function askedFirst(side: FinderBoardSide, query: FinderQuery): { key: string; unit: string; label: string }[] {
  const cols = finderColumns(side, query)
  const asked = query.conditions.filter(c => c.op !== 'eq').map(c => c.field)
  const exact = new Set(query.conditions.filter(c => c.op === 'eq').map(c => c.field))
  const rank = (key: string) => { const i = asked.indexOf(key); return i >= 0 ? i : exact.has(key) ? asked.length + 1 : asked.length }
  return cols.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c.key) - rank(b.c.key) || a.i - b.i).map(x => x.c)
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

/** "Aug 2 at BOS", the game a line came from, with home or away off the line's own club, and the
 *  year once the board spans seasons ("Aug 2, 2026 at BOS"). */
function gameLabel(game: LeagueGame | null, teamId: string | null, clubAbbr: (id: string) => string, withYear = false): string {
  if (!game) return ''
  const date = gameDateText(game.game_date, withYear)
  const home = teamId != null && game.home_team_id === teamId
  return `${date} ${home ? 'vs' : 'at'} ${clubAbbr(home ? game.away_team_id : game.home_team_id)}`
}

/** A row's place, and whether another row shares it. */
export interface RankMark { rank: number; tied: boolean }

/** "T-3" for a shared place, as the leader cards and the season table draw it. */
const rankText = (r: RankMark) => (r.tied ? `T-${r.rank}` : String(r.rank))

/**
 * COMPETITION RANKS ON THE COLUMN THE ROWS ARE IN ORDER BY, judged on the number as printed, the
 * rule the leader cards and the season table use (`printedRanks`). Nine lines numbered 1 to 9 that
 * all read 4 H claimed an order nobody could see (Nov 7, 2026 audit). A date order is a list, not a
 * standing, so it numbers plainly.
 */
export function finderRanks(side: FinderBoardSide, rows: { values: Record<string, number> }[], sort: FinderSort): RankMark[] {
  if (sort.key === 'date') return rows.map((_, i) => ({ rank: i + 1, tied: false }))
  return printedRanks(rows.map(r => displayFinderValue(side, sort.key, r.values[sort.key] ?? 0)))
}

/**
 * THE TABLE, at every width, built the way the site's other stat tables are (a player's game log,
 * the Stats table on a phone): a real `<table>` in a box of its own that scrolls both ways, the
 * header pinned to the top of that box, and the rank and name pinned at its left.
 *
 * Until Nov 20, 2026 this was two tables, a grid of rows with faces for a wide board and a phone one
 * without, and before that a card per match on a phone. Neither header stayed on screen: a box that
 * scrolls sideways is a scroll container on both axes, so a header sticky inside it holds only
 * while that box itself scrolls down. Hence the CAP, as on the game log: the box is never taller
 * than the screen under the pinned chrome, so with the rows expanded the header stays over them.
 *
 * NO FACES, at any width: at 32px one costs a whole stat column, and the site's tables have none.
 * A wide board gives the night and its result columns of their own (`wide`, a container query on the
 * board's width); a narrow one puts them under the name, since a Game column would push every stat
 * off the screen. Both are drawn and the query picks, so the first paint is already the right one.
 */
function FinderTable<P extends LeaguePlayer, G extends LeagueGame>({
  side, query, rows, ranks, sort, onSort, headlineField, clubAbbr, rowParts, loading, wide,
}: {
  side: FinderBoardSide
  query: FinderQuery
  rows: FinderRow<P, G>[]
  /** Each row's place in the order shown, ties marked; see `finderRanks`. */
  ranks: RankMark[]
  sort: FinderSort | null
  onSort: (s: FinderSort | null) => void
  headlineField: string
  clubAbbr: (id: string) => string
  rowParts: (row: FinderRow<P, G>) => FinderRowParts
  loading: boolean
  /** The container query under which the night and its result get columns of their own. */
  wide: string
}) {
  const cols = askedFirst(side, query)
  const asked = query.conditions.map(c => c.field)
  // A SEASON ROW IS A PLAYER, so it has no night and no result.
  const season = query.per === 'season'
  // A STRETCH ROW IS A RUN OF GAMES, and says which: a column on a wide table, a line under the name on
  // a narrow one, the way a game row says its night. Off the query, so the loading rows have it too.
  const stretched = season && !!query.stretch && finderStretchApplies(side, query)
  // EVERY SEASON AT ONCE: the year on each game's date, and a season row's year beside its name, since
  // a row of one season is no longer the board's only season. A career row is every year, so has none.
  const years = useContext(GameYearContext)
  const yearCol = season && years && !query.career
  const best = (key: string) => !finderLowerBetter(side, key)
  const active: FinderSort = sort ?? { key: headlineField, desc: best(headlineField) }
  const press = (key: string) => onSort({ key, desc: active.key === key ? !active.desc : best(key) })
  // A lone answer has no place to number.
  const ranked = loading || rows.length > 1
  const clubRow = whoFor(side, query.per, query.byClub)[0] === 'club'
  // A CLUB'S HALF AT THE PLATE says the score it changed: what makes a big inning big is the game it
  // turned, and the final beside it cannot say whether those runs came from behind.
  const scored = query.per === 'inning' && side === 'hitting'
  const narrowOnly = { [wide]: { display: 'none' } }
  const wideOnly = { display: 'none', [wide]: { display: 'table-cell' } }
  // The pinned column. A FIXED WIDTH while it holds the night under the name, so a long name steps
  // to "F. Last" (NameText) rather than widening the column and pushing the stats off a phone.
  const leadW = season ? '9.5rem' : '10.5rem'
  const widths = colsFor(query.per)
  // A stat column's width holds its head (`statRem`); a season's four-figure OPS ("1.155") is wider
  // than its head and, at the Large text size, spilled 5px out of a column sized to it; so did
  // MLB's "W 16–12" out of Result.
  const FIGURE_SLACK_REM = 0.5
  const gameRem = widths.game + (years ? GAME_YEAR_REM : 0)
  const resultRem = widths.result + FIGURE_SLACK_REM
  const statW = (key: string, unit: string) => statRem(query.per, unit, finderPlainCount(side, key)) + FIGURE_SLACK_REM
  // THE TABLE'S FLOOR, SUMMED, never `max-content`: Firefox measures a fixed-layout table at 100%
  // width as all but infinitely wide, so the name column took 17,895,156px and every figure sat that
  // far to the right, out of sight behind an overlay scrollbar (Nov 23, 2026). Chrome measured it
  // right, which is why the sweep never saw it. Cells are border-box, so a width holds its padding.
  const statsRem = cols.reduce((sum, c) => sum + statW(c.key, c.unit), 0)
  const wideRem = (yearCol ? YEAR_COL_REM : 0) + (season ? 0 : gameRem + resultRem) + (stretched ? STRETCH_COL_REM : 0) + (scored ? SCORE_COL_REM : 0)
  const floor = (rem: number) => `calc(${leadW} + ${rem}rem)`
  const headSx = {
    position: 'sticky', top: 0, zIndex: 2, bgcolor: CARD_FILL,
    fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: typePx(0.4), color: 'text.disabled',
    // CENTERED, figures and heads alike, as a stat table reads: right-aligned, each number sat
    // against its column's far edge and away from its own head (Nov 23, 2026).
    textAlign: 'center', whiteSpace: 'nowrap', verticalAlign: 'bottom', py: 0.75, px: 0.75,
    // The rule as an inset shadow: a sticky cell leaves a collapsed border behind as it moves.
    boxShadow: (t: Theme) => `inset 0 -1px 0 ${t.palette.divider}`,
  } as const
  const cellSx = {
    py: 0.6, px: 0.75, textAlign: 'center', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
    borderTop: '1px solid', borderColor: 'divider', fontSize: TYPE_SCALE.body,
  } as const
  // Opaque, or the figures scroll through the name; above the stat cells and under the header. Its
  // right edge is ruled, as the Stats table's name column is, so a figure scrolling under it reads as
  // passing behind a column rather than vanishing into the name.
  const pinnedSx = {
    position: 'sticky', left: 0, zIndex: 1, bgcolor: CARD_FILL, textAlign: 'left',
    borderRight: '1px solid', borderRightColor: 'divider',
    width: leadW, minWidth: leadW, maxWidth: leadW, [wide]: { width: 'auto', maxWidth: 'none' },
  } as const
  const rankSx = {
    display: 'inline-block', width: '2.25rem', flexShrink: 0, textAlign: 'center', whiteSpace: 'nowrap',
    fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'text.secondary', fontVariantNumeric: 'tabular-nums',
  } as const
  const plainHead = (label: string, extra?: object) => (
    <Box component="th" scope="col" sx={{ ...headSx, textAlign: 'left', ...extra }}>{label}</Box>
  )
  const sortHead = (key: string, label: string, title: string, extra?: object) => {
    const on = active.key === key
    return (
      <Box component="th" scope="col" key={key} aria-sort={on ? (active.desc ? 'descending' : 'ascending') : undefined} sx={{ ...headSx, ...extra }}>
        <Box component="button" type="button" title={title} onClick={() => press(key)} sx={{
          all: 'unset', ...FOCUS_RING, position: 'relative', cursor: 'pointer', borderRadius: 0.5,
          color: on || asked.includes(key) ? 'text.primary' : 'inherit',
          borderBottom: '2px solid', borderColor: on ? ACCENT_EDGE : 'transparent',
          ...hoverOnly({ color: 'text.primary' }),
        }}>
          {label}
          {/* The mark hangs past the label, in the room `SORT_MARK_REM` keeps, so the label itself
              stays centered over its figures whichever column the list is in order by. */}
          {on && <Box component="span" aria-hidden sx={{ position: 'absolute', left: '100%', pl: 0.25 }}>{active.desc ? '▾' : '▴'}</Box>}
        </Box>
      </Box>
    )
  }
  const night = (r: FinderRow<P, G>, parts: FinderRowParts) => {
    const label = gameLabel(r.game, r.teamId, clubAbbr, years)
    return parts.gameLink ? (
      <Box component="a" {...parts.gameLink} data-row-open="" sx={{
        ...FOCUS_RING, color: ACCENT_EDGE, fontWeight: 700, textDecoration: 'none', ...hoverOnly({ textDecoration: 'underline' }),
      }}>{label}</Box>
    ) : label
  }
  const openRow = (e: React.MouseEvent<HTMLElement>) => {
    if ((e.target as Element).closest('a, button')) return
    e.currentTarget.querySelector<HTMLAnchorElement>('a[data-row-open]')?.click()
  }
  const resultOf = (r: FinderRow<P, G>) => (r.inning?.event !== undefined ? r.inning.event ?? '—' : gameResult(r.game, r.teamId))
  return (
    <Box sx={{
      overflow: 'auto', overscrollBehaviorX: 'contain',
      // THE CAP, which is what lets the header hold (see above): the screen under the pinned chrome,
      // less the phone's bottom bar and a margin for the card's own title.
      maxHeight: {
        xs: `calc(100dvh - (${BOTTOM_NAV_SPACE}) - env(safe-area-inset-bottom, 0px) - 6rem)`,
        sm: 'calc(100dvh - var(--app-header-h, 0px) - 6rem)',
      },
    }}>
      <Box component="table" aria-label={season ? 'Matching seasons' : `Matching ${GRAIN_NOUN[query.per][1]}`} aria-busy={loading || undefined}
        // FIXED LAYOUT, every column's width set on its head: sized from its content, a column took
        // the loading row's width and then the loaded one's, and MLB's moved sideways as its lines
        // landed. The name column takes what is left on a wide board.
        sx={{
          width: '100%', tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0,
          minWidth: floor(statsRem), [wide]: { minWidth: floor(statsRem + wideRem) },
        }}>
        <Box component="thead">
          <Box component="tr">
            <Box component="th" scope="col" sx={{ ...headSx, ...pinnedSx, zIndex: 3, textAlign: 'left' }}>
              {ranked && <Box component="span" sx={{ ...rankSx, fontSize: 'inherit', color: 'inherit' }}>#</Box>}
              <Box component="span" sx={{ pl: ranked ? 0.5 : 0 }}>{clubRow ? 'CLUB' : 'PLAYER'}</Box>
            </Box>
            {yearCol && plainHead('YEAR', { ...wideOnly, width: `${YEAR_COL_REM}rem` })}
            {!season && sortHead('date', 'GAME', 'Sort by date', { ...wideOnly, textAlign: 'left', width: `${gameRem}rem` })}
            {!season && plainHead('RESULT', { ...wideOnly, width: `${resultRem}rem` })}
            {scored && plainHead('SCORE', { ...wideOnly, width: `${SCORE_COL_REM}rem` })}
            {stretched && plainHead('GAMES', { ...wideOnly, width: `${STRETCH_COL_REM}rem` })}
            {cols.map(c => sortHead(c.key, c.unit, c.label, { width: `${statW(c.key, c.unit)}rem` }))}
          </Box>
        </Box>
        <Box component="tbody">
          {loading
            ? Array.from({ length: RESULT_CAP }, (_, i) => (
              <Box component="tr" key={i} aria-hidden>
                <Box component="td" sx={{ ...cellSx, ...pinnedSx }}>
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Box sx={rankSx}>&nbsp;</Box>
                    <Box sx={{ flex: 1, pl: 0.5 }}>
                      <Typography sx={{ fontSize: TYPE_SCALE.meta, lineHeight: NAME_LH }}><Skeleton width="70%" /></Typography>
                      {(!season || stretched || yearCol) && <Typography sx={{ fontSize: TYPE_SCALE.micro, lineHeight: NIGHT_LH, ...narrowOnly }}><Skeleton width="80%" /></Typography>}
                    </Box>
                  </Box>
                </Box>
                {yearCol && <Box component="td" sx={{ ...cellSx, ...wideOnly }}><Skeleton /></Box>}
                {!season && <Box component="td" sx={{ ...cellSx, ...wideOnly }}><Skeleton /></Box>}
                {!season && <Box component="td" sx={{ ...cellSx, ...wideOnly }}><Skeleton /></Box>}
                {scored && <Box component="td" sx={{ ...cellSx, ...wideOnly }}><Skeleton /></Box>}
                {stretched && <Box component="td" sx={{ ...cellSx, ...wideOnly }}><Skeleton /></Box>}
                {cols.map(c => <Box component="td" key={c.key} sx={cellSx}><Skeleton /></Box>)}
              </Box>
            ))
            : <NameColumn names={rows.map(r => r.name)}>{rows.map((r, i) => {
              const parts = rowParts(r)
              const result = resultOf(r)
              const score = r.inning?.score ? finderScoreText(r.inning.score) : null
              return (
                // A PLATE APPEARANCE OR AN INNING OPENS ON A TAP ANYWHERE IN ITS ROW: the play is the
                // answer, and only the game's date led to it, a small target on a row that reads as one
                // thing (Nov 20, 2026). The tap follows that link, so a keyboard has the same thing
                // through it, and the name keeps opening the player.
                <Box component="tr" key={r.key} onClick={r.inning && parts.gameLink ? openRow : undefined} sx={{
                  ...(r.inning && parts.gameLink ? { cursor: 'pointer' } : {}),
                  ...hoverOnly({ '& td': { backgroundImage: (t: Theme) => `linear-gradient(${t.palette.action.hover}, ${t.palette.action.hover})` } }),
                }}>
                  <Box component="td" sx={{ ...cellSx, ...pinnedSx }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                      {ranked && <Box sx={rankSx}>{rankText(ranks[i])}</Box>}
                      <Box sx={{ flex: 1, minWidth: 0, pl: ranked ? 0.5 : 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                          {/* A CLUB ROW LEADS WITH ITS MARK, as the tally beside it does; a player's
                              mark follows the name, which is the row's subject. */}
                          {clubRow && parts.club && <Box sx={{ display: 'flex', flexShrink: 0 }}>{parts.club}</Box>}
                          <NameText name={r.name} linkProps={parts.playerLink} sx={{
                            minWidth: 0, textDecoration: 'none', color: 'inherit', fontSize: TYPE_SCALE.meta, fontWeight: 700, lineHeight: NAME_LH,
                            ...(parts.playerLink ? hoverOnly({ textDecoration: 'underline' }) : {}),
                          }} />
                          {!clubRow && parts.club && <Box sx={{ display: 'flex', flexShrink: 0 }}>{parts.club}</Box>}
                        </Box>
                        {!season && (
                          <Typography component="div" noWrap sx={{ fontSize: TYPE_SCALE.micro, color: 'text.secondary', lineHeight: NIGHT_LH, ...narrowOnly }}>
                            {night(r, parts)}{score ? ` · ${score}` : result && result !== '—' ? ` · ${result}` : ''}
                          </Typography>
                        )}
                        {(stretched || yearCol) && (
                          <Typography component="div" noWrap sx={{ fontSize: TYPE_SCALE.micro, color: 'text.secondary', lineHeight: NIGHT_LH, ...narrowOnly }}>
                            {[yearCol ? (r.season ?? '—') : null, stretched ? finderSpanText(r.stretch ?? null) || '—' : null].filter(x => x != null).join(' · ')}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  </Box>
                  {yearCol && <Box component="td" sx={{ ...cellSx, ...wideOnly, textAlign: 'left', fontSize: TYPE_SCALE.meta }}>{r.season ?? '—'}</Box>}
                  {!season && <Box component="td" sx={{ ...cellSx, ...wideOnly, textAlign: 'left', fontSize: TYPE_SCALE.meta }}>{night(r, parts)}</Box>}
                  {!season && <Box component="td" sx={{ ...cellSx, ...wideOnly, textAlign: 'left', fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{result}</Box>}
                  {scored && <Box component="td" sx={{ ...cellSx, ...wideOnly, textAlign: 'left', fontSize: TYPE_SCALE.meta }}>{score ?? '—'}</Box>}
                  {stretched && <Box component="td" sx={{ ...cellSx, ...wideOnly, textAlign: 'left', fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{finderSpanText(r.stretch ?? null) || '—'}</Box>}
                  {cols.map(c => {
                    const first = c.key === asked[0]
                    const isAsked = asked.includes(c.key)
                    return (
                      <Box component="td" key={c.key} sx={{
                        ...cellSx, fontWeight: isAsked ? 800 : 500,
                        color: first ? ACCENT_EDGE : isAsked ? 'text.primary' : 'text.secondary',
                      }}>
                        {displayFinderValue(side, c.key, r.values[c.key] ?? 0)}
                      </Box>
                    )
                  })}
                </Box>
              )
            })}</NameColumn>}
        </Box>
      </Box>
    </Box>
  )
}

/** Who a row is, for the counts: a player on every side, and a club on Hitting by the inning, where
 *  a row is a club's half-inning at the plate. */
function whoFor(side: FinderBoardSide, per: FinderPer, byClub = false): [string, string] {
  if (per === 'club' || (per === 'season' && side === 'hitting' && byClub)
    || (per === 'inning' && (side === 'hitting' || (side === 'fielding' && byClub)))) return ['club', 'clubs']
  return side === 'pitching' ? ['pitcher', 'pitchers'] : side === 'fielding' ? ['fielder', 'fielders'] : ['hitter', 'hitters']
}

/** Which piece of the question is open: some conditions (a "0-2 count" chip is two), the add menu, or
 *  one scope by its key. */
type Editing = { kind: 'cond'; indices: number[] } | { kind: 'add' } | { kind: 'scope'; key: string }

/** One who, where or when: its entry in "+ Add", its chip's words once set (null until then), and its list. */
interface Scope { key: string; label: string; text: string | null; groups: ChoiceGroup[]; value: string; pick: (v: string) => void }

/** One piece of the question: its words open its editor, its ✕ drops it. */
function QuestionChip({ text, onRemove, onEdit }: { text: string; onRemove: () => void; onEdit?: (e: React.SyntheticEvent<HTMLElement>) => void }) {
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', minWidth: 0, maxWidth: '100%', minHeight: chromePx(30),
      pl: 1.25, pr: 0.25, borderRadius: 999, border: '1px solid', borderColor: CARD_BORDER,
    }}>
      <Box {...pressable(onEdit)} {...(onEdit ? { 'aria-haspopup': 'dialog' as const } : {})} sx={{
        ...FOCUS_RING, minWidth: 0, cursor: onEdit ? 'pointer' : 'default', userSelect: 'none', borderRadius: 0.5,
        fontSize: TYPE_SCALE.meta, fontWeight: 700, overflowWrap: 'anywhere',
        ...(onEdit ? hoverOnly({ textDecoration: 'underline' }) : {}),
      }}>{text}</Box>
      <Box {...pressable(onRemove)} aria-label={`Remove ${text}`} sx={{
        ...FOCUS_RING, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        width: chromePx(26), height: chromePx(26), ml: 0.25, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
        color: 'text.secondary', fontSize: TYPE_SCALE.micro, fontWeight: 800,
        ...hoverOnly({ color: 'text.primary', bgcolor: 'action.hover' }),
      }}>✕</Box>
    </Box>
  )
}

/**
 * THE BOARD BEFORE A QUESTION: the examples, every grain's, each with how often it happened. It
 * opened on "every game line" until Nov 9, 2026, which is 612 rows ranked by hits, nine tied at T-1,
 * beside a tally where everyone had done it 15 times of 15: an answer to nothing. A count on each
 * example says which questions have interesting answers before anyone taps one.
 */
function ExampleGrid({ side, grains, examples, count, counted, href, onPick }: {
  side: FinderBoardSide
  grains: FinderPer[]
  examples: FinderExample[]
  count?: (ex: FinderExample) => number | null
  counted: FinderPer[]
  href?: (ex: FinderExample) => string
  onPick: (ex: FinderExample) => void
}) {
  const groups = grains
    .map(per => ({ per, list: examples.filter(ex => (ex.per ?? 'game') === per) }))
    .filter(g => g.list.length > 0)
    .map(g => ({ ...g, counted: counted.includes(g.per) }))
  return (
    <SectionCard title="Examples" frameless>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 0.5 }}>
        {groups.map(g => (
          <Box key={g.per}>
            <SectionLabel>{GRAIN_LABEL[g.per]}</SectionLabel>
            {/* Two across on a 375 phone: at 10rem it was one, and the pitching side a column of 22. */}
            <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 8.5rem), 1fr))' }}>
              {g.list.map(ex => {
                const n = count?.(ex) ?? null
                const noun = g.per === 'season' ? whoFor(side, g.per) : GRAIN_NOUN[g.per]
                const link = href?.(ex)
                // A REAL LINK where the section gives the address, so a tile opens in a new tab and a
                // crawler can follow it; a plain click asks in place, keeping the season on screen.
                const open = link
                  ? {
                    component: 'a' as const, href: link,
                    onClick: (e: React.MouseEvent) => {
                      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                      e.preventDefault()
                      onPick(ex)
                    },
                  }
                  : pressable(() => onPick(ex))
                return (
                  <Box key={ex.label} {...open} sx={{
                    ...FOCUS_RING, display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0,
                    px: 1.25, py: 1, borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER,
                    color: 'inherit', textDecoration: 'none', cursor: 'pointer', ...TAPPABLE,
                  }}>
                    <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, lineHeight: 1.25 }}>{ex.label}</Typography>
                    {/* A GROUP COUNTS ALL OR NONE, and says so before its numbers exist: a blank line under
                        every tile read as broken, and a line that appeared once the lines were read
                        moved the page (MLB reads its season after the board draws). */}
                    {g.counted && (
                      <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                        {n == null ? String.fromCharCode(160) : `${n.toLocaleString()} ${n === 1 ? noun[0] : noun[1]}`}
                      </Typography>
                    )}
                  </Box>
                )
              })}
            </Box>
          </Box>
        ))}
      </Box>
    </SectionCard>
  )
}

export function FinderBoard<P extends LeaguePlayer, G extends LeagueGame>({
  side, query, onQuery, result, clubs, clubAbbr, loading = false, rowParts, tallyParts,
  sort, onSort, examples, exampleCount, exampleCounted = [], exampleHref, parse, onAsk, askAnswer, askNames, grains = DEFAULT_GRAINS, picks,
  plays = true, months, kinds, countFor, askOn, sides = DEFAULT_SIDES, onSide, filters, seasonLabel,
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
  /** A matching line's parts (face, club mark, links), for the table and the cards alike. */
  rowParts: (row: FinderRow<P, G>) => FinderRowParts
  /** The section's face, club mark and link for a tally row. */
  tallyParts: (t: FinderTally<P>) => Pick<LeaderItem, 'key' | 'name' | 'portrait' | 'badge' | 'linkProps'>
  /** The table's order. Held by the section, because the engine sorts before it caps. */
  sort: FinderSort | null
  onSort: (s: FinderSort | null) => void
  /** One-tap questions for this side, every grain's: the board with no question asked is these. */
  examples: FinderExample[]
  /** How many lines an example matches, in the scope on screen, or null where the section has not
   *  read what it searches (WPBL's play log, until a play-log grain is asked or it is cached). */
  exampleCount?: (ex: FinderExample) => number | null
  /** The grains whose examples the section counts, known before the counts are: a count still
   *  loading keeps its line, and a grain left out draws none. */
  exampleCounted?: FinderPer[]
  /** An example's own address, so its tile is a real link that opens in a new tab. */
  exampleHref?: (ex: FinderExample) => string
  /** The question typed as words. The box is drawn only when both are given. */
  parse?: (text: string) => FinderReading[]
  onAsk?: (r: FinderReading) => void
  /** The typed question's answer before it is asked, from the section's own lines. */
  askAnswer?: (r: FinderReading) => Promise<string | null>
  /** The players the typed words may mean, offered to pick. */
  askNames?: (text: string) => { id: string; name: string; text: string }[]
  /** The grains this side can be asked at, in the switch's order. Single innings only where the
   *  section reads its plays and the side is pitching (src/league/inningLines.ts). */
  grains?: FinderPer[]
  /** The section reads its play log, so a game or a season can ask the play-only counts (pickoffs,
   *  pitches seen). False on MLB, which has no plays. */
  plays?: boolean
  /** The players to pick from: one player at a game, a season or a pitcher's inning, and a batter and
   *  a pitcher at a plate appearance. Absent draws no player pickers. */
  picks?: FinderPlayerPicks
  /** The months the season on screen was played in (`finderMonths`), for the Month picker, empty
   *  while the games load. Absent draws no When row; a span the search set still shows as its chip. */
  months?: number[]
  /** Whether the season on screen had extra-inning games and doubleheaders (`finderGameKinds`), so the
   *  pickers offer only a kind of game that was played. Absent offers neither; a cut the search set
   *  still shows as its chip. */
  kinds?: { extra: boolean; dh: boolean }
  /** How many lines a question matches, on any side, from the same engine call that draws the board;
   *  null where the section cannot count it without a read it has not done. For the nearest questions
   *  a question that found nothing is offered (`finderNearMisses`). Absent offers none. */
  countFor?: (side: FinderBoardSide, q: FinderQuery) => number | null
  /** Asks a question on another side, which is the section's to switch (through the address). */
  askOn?: (side: FinderBoardSide, q: FinderQuery) => void
  /** The sides the section's board has, for a question that may belong on another. */
  sides?: FinderBoardSide[]
  /** Switches the side, which the section owns (it is in the address). Given, the card draws the
   *  side switch beside the grain's, and the section's bar leaves its own off. */
  onSide?: (side: FinderBoardSide) => void
  /** The section's Filters trigger, drawn in the Question card's header (on a phone, where the
   *  section's bar has nothing else to hold on Find). */
  filters?: React.ReactNode
  /** The year on screen ("2026"), said with a season question's count: a season row has no date of
   *  its own, so nothing on the answer said which season it was. */
  seasonLabel?: string
}) {
  const [allRows, setAllRows] = useState(false)
  // ONE PIECE OF THE QUESTION OPEN AT A TIME (src/ui/finderChips.tsx), anchored to the chip it came from.
  const [editing, setEditing] = useState<Editing | null>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const edit = (e: React.SyntheticEvent<HTMLElement>, what: Editing) => { setAnchor(e.currentTarget); setEditing(what) }
  const closeEditor = () => setEditing(null)
  const clubOptions = (blank: string) => [{ value: '', label: blank }, ...clubs]
  // A PLAYER IS A QUESTION ON ITS OWN: "every trip to the plate between these two" or "every game
  // Sato pitched" asks no stat, and answers with the log rather than the examples.
  const hasConditions = query.conditions.length > 0 || hasPlayerFilter(side, query)
  const playerHere = !!picks && query.per !== 'pa' && finderPlayerApplies(side, query.per, query.byClub)

  // The When lists. A month the search set that the season on screen never played in still shows, so
  // the list never claims "Any month" over a span that is cutting the board. A run of days that is not
  // a month is its own chip (`cutChips`).
  const spanMonth = finderSpanMonth(query)
  const shownMonths = [...new Set([...(months ?? []), ...(spanMonth ? [spanMonth] : [])])].sort((a, b) => a - b)
  const monthOptions = [
    { value: '', label: 'Any month' },
    ...shownMonths.map(m => ({ value: String(m), label: FINDER_MONTH_NAMES[m - 1] })),
  ]
  const lastOptions = [
    { value: '', label: 'Every game' },
    ...[...new Set([1, 5, 10, 15, 20, ...(query.last ? [query.last] : [])])].sort((a, b) => a - b)
      .map(n => ({ value: String(n), label: n === 1 ? 'Last game' : `Last ${n} games` })),
  ]
  // A STRETCH, where the grain sums one (`finderStretchApplies`): a player's season cut to its best run.
  const stretchHere = finderStretchApplies(side, query)
  // EVERY SEASON AT ONCE (GameYearContext): a season question is each season or a career.
  const everySeason = useContext(GameYearContext)
  const careerHere = everySeason && query.per === 'season'
  const stretchOptions = [
    { value: '', label: 'Whole season' },
    ...[...new Set([3, 5, 7, 10, 15, 20, ...(query.stretch ? [query.stretch] : [])])].sort((a, b) => a - b)
      .map(n => ({ value: String(n), label: finderStretchText(n) })),
  ]

  const setCondition = (i: number, c: FinderCondition) =>
    onQuery({ ...query, conditions: query.conditions.map((x, j) => (j === i ? c : x)) })
  const season = query.per === 'season'
  const askWhole = (ex: FinderExample) => onQuery({ ...query, per: ex.per ?? 'game', conditions: ex.conditions })
  // A switch of grain keeps every condition the other grain can ask. "3+ home runs" means something
  // over a season too, and is a better start than an empty form; a rate has no meaning in one game,
  // so going back to games drops it. Bare, a season opens on its headline rate, since a season of
  // every line ranks nobody.
  const setPer = (per: FinderPer) => {
    if (per === query.per) return
    const kept = conditionsForPer(side, per, query.conditions, plays, per === 'season' && !!query.byClub)
    // The players go with the grain: a game's player is a plate appearance's batter or pitcher.
    onQuery({ ...finderPlayerAt(side, query, per), per, conditions: kept.length || per === 'game' ? kept : [defaultCondition(side, per)] })
  }

  // HOW MANY AND WHEN. The line used to read the whole question back ("12 games where Strikeouts at
  // least 5, vs SF"), which the chips above it now say piece by piece, each removable; twice over, the
  // answer was the last thing on a line that wrapped to three on a phone.
  const who = whoFor(side, query.per, query.byClub)
  const noun = GRAIN_NOUN[query.per]
  const tallyTitle = `Most ${noun[1]} matching`
  const games_ = season ? (result.total === 1 ? who[0] : who[1])
    : result.total === 1 ? noun[0] : noun[1]
  const total = result.total.toLocaleString()
  // WHEN, beside how many: the first and the latest match across all of them, since the rows are the
  // top fifty by the stat and "when did it last happen" is half of a yes-or-no question. On the same
  // line rather than a line of its own, which the skeleton would have to guess the presence of.
  const span = finderSpanText(result.span)
  // THE ANSWER, not the question again: the chips above already say what was asked, so the line is how
  // many, when, and (where nobody did it twice) that, which used to be a card of its own under the list.
  const onceEach = result.tally.length > 0 && result.tally[0].games === 1
  const onceText = !season && onceEach
    ? (result.tally.length === 1 ? `1 ${who[0]}` : `${result.tally.length.toLocaleString()} ${who[1]}, once each`)
    : ''
  const summary = [`${total} ${games_}`, season ? seasonLabel : null, span, onceText].filter(Boolean).join(' · ')
  // SHOWN, because a bar the reader did not set is a filter they cannot see. A label with its
  // definition behind an InfoDot, as every other board's qualifier is, rather than two sentences of
  // instructions above the table (house rule: labels, not narration). The way past it stays in the
  // definition, since "where is the 2-for-4 hitter" is one condition away.
  const qualifier = result.qualifier
    ? result.qualifier.field === 'pa'
      ? { label: `Qualified: ${result.qualifier.min}+ PA`, tip: `Seasons with at least ${result.qualifier.min} plate appearances, the leaderboards' bar. A plate appearances condition sets a different one.` }
      : result.qualifier.field === 'g'
        ? { label: `Qualified: ${result.qualifier.min}+ G`, tip: `Seasons with at least ${result.qualifier.min} games played, the leaderboards' bar. A games played condition sets a different one.` }
        : { label: `Qualified: ${displayFinderValue(side, 'ip', result.qualifier.min)}+ IP`, tip: `Seasons with at least ${displayFinderValue(side, 'ip', result.qualifier.min)} innings, the leaderboards' bar. An innings condition sets a different one.` }
    : null
  // The same words loading and loaded, so the row does not reflow when the answer lands. A game
  // question nearly always runs past the cap; a season one is a list of a few dozen at most, so it
  // names no count the skeleton would have to guess.
  const moreLabel = season
    ? `Show more ${who[1]}`
    : `Show ${loading || result.total > result.rows.length ? 'top' : 'all'} ${loading ? 50 : result.rows.length} ${noun[1]}`
  const shownRows = allRows ? result.rows : result.rows.slice(0, RESULT_CAP)
  // A yes-or-no answer comes back in date order (the engine's `flat`), and is drawn as that order:
  // the Game column marked, the rows numbered plainly rather than fifty-seven T-1s.
  const shownSort = sort ?? (result.flat ? { key: 'date', desc: false } : null)
  const ranks = finderRanks(side, result.rows, shownSort ?? { key: result.headlineField, desc: !finderLowerBetter(side, result.headlineField) })

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
  // every match was a different player, under a title promising a leader: the answer line says it
  // (`onceText`), and the card goes.

  const tableRem = tableMinRem(finderColumns(side, query).map(col => ({ unit: col.unit, count: finderPlainCount(side, col.key) })), query.per,
    query.per === 'season' && !!query.stretch && finderStretchApplies(side, query), everySeason, careerHere && !query.career,
    query.per === 'inning' && side === 'hitting')
  // WHAT EACH COLUMN IS. "R2", "RS" and "ON" are this board's own, and a header's `title` never shows
  // on a touchscreen, where the phone row leads with one of them ("3 RS"). One key per table, as a
  // definition behind the card's InfoDot, rather than a dot on every header.
  const columnKey = finderColumns(side, query).map(c => `${c.unit}: ${c.label}`).join(' · ')
  const tableOn = `@container finder-main (min-width: ${tableRem}rem)`
  const besideRem = tableRem + PANE_GAP_REM + TALLY_REM
  const tallyBeside = `@container finder-main (min-width: ${besideRem}rem)`
  // Under the table but with the width for two of it, the tally runs down two columns: one column
  // across a wide desktop is ten names with a screen of nothing between each and its count.
  const tallySplit = `@container finder-main (min-width: ${2 * TALLY_REM + 2}rem) and (max-width: ${besideRem - 0.01}rem)`

  // THE WHO, WHERE AND WHEN, each one list of choices: a chip once set, an entry in "+ Add" until then.
  // `''` in a list is "any", which clears it.
  const scopes: Scope[] = [
    ...(playerHere ? [{ key: 'player', label: 'Player', text: query.playerId ? picks!.name(query.playerId) : null,
      groups: [{ label: '', options: [{ value: '', label: 'Any player' }] }, ...picks!.players], value: query.playerId ?? '',
      pick: (v: string) => onQuery({ ...query, playerId: v || null }) }] : []),
    { key: 'team', label: 'Club', text: query.teamId ? `For ${clubAbbr(query.teamId)}` : null,
      groups: [{ label: '', options: clubOptions('Any club') }], value: query.teamId ?? '', pick: v => onQuery({ ...query, teamId: v || null }) },
    { key: 'opp', label: 'Opponent', text: query.oppId ? `Vs ${clubAbbr(query.oppId)}` : null,
      groups: [{ label: '', options: clubOptions('Any opponent') }], value: query.oppId ?? '', pick: v => onQuery({ ...query, oppId: v || null }) },
    { key: 'venue', label: 'Home or away', text: query.venue === 'home' ? 'At home' : query.venue === 'away' ? 'On the road' : null,
      groups: [{ label: '', options: [{ value: 'any', label: 'Home or away' }, { value: 'home', label: 'At home' }, { value: 'away', label: 'On the road' }] }],
      value: query.venue, pick: v => onQuery({ ...query, venue: (v || 'any') as FinderVenue }) },
    ...(months != null ? [{ key: 'month', label: 'Month', text: spanMonth ? FINDER_MONTH_NAMES[spanMonth - 1] : null,
      groups: [{ label: '', options: monthOptions }], value: spanMonth ? String(spanMonth) : '',
      pick: (v: string) => onQuery({ ...query, ...(v ? finderMonthSpan(Number(v)) : { from: null, to: null }) }) },
    { key: 'last', label: 'Last games', text: query.last ? (query.last === 1 ? 'Last game' : `Last ${query.last} games`) : null,
      groups: [{ label: '', options: lastOptions }], value: query.last ? String(query.last) : '',
      pick: (v: string) => onQuery({ ...query, last: v ? Number(v) : null }) }] : []),
    ...(kinds?.extra ? [{ key: 'extra', label: 'Extra innings', text: query.extra ? 'Extra innings' : null,
      groups: [{ label: '', options: [{ value: '', label: 'Any game' }, { value: '1', label: 'Extra innings' }] }], value: query.extra ? '1' : '',
      pick: (v: string) => onQuery({ ...query, extra: v ? true : null }) }] : []),
    ...(kinds?.dh ? [{ key: 'dh', label: 'Doubleheaders', text: query.dh ? finderDhText(query.dh) : null,
      groups: [{ label: '', options: [{ value: '', label: 'Any game' }, ...(['any', 1, 2] as const).map(d => ({ value: String(d), label: finderDhText(d) }))] }],
      value: query.dh ? String(query.dh) : '',
      pick: (v: string) => onQuery({ ...query, dh: v === 'any' ? 'any' : v === '1' ? 1 : v === '2' ? 2 : null }) }] : []),
    ...(careerHere ? [{ key: 'career', label: 'Seasons', text: query.career ? 'Career' : null,
      groups: [{ label: '', options: [{ value: '', label: 'Each season' }, { value: '1', label: 'Career' }] }], value: query.career ? '1' : '',
      pick: (v: string) => onQuery({ ...query, career: v ? true : null }) }] : []),
    ...(stretchHere ? [{ key: 'stretch', label: 'Stretch', text: query.stretch ? finderStretchText(query.stretch) : null,
      groups: [{ label: '', options: stretchOptions }], value: query.stretch ? String(query.stretch) : '',
      pick: (v: string) => onQuery({ ...query, stretch: v ? Number(v) : null }) }] : []),
    // THE MATCHUP, only where a line names both players: a plate appearance. A hitter's season is
    // summed from those, so it can be against one pitcher (`seasonFromPas`).
    ...(picks && plays && query.per === 'pa' ? [{ key: 'bat', label: 'Batter', text: query.batterId ? `By ${picks.name(query.batterId)}` : null,
      groups: [{ label: '', options: [{ value: '', label: 'Any batter' }] }, ...picks.batters], value: query.batterId ?? '',
      pick: (v: string) => onQuery({ ...query, batterId: v || null }) }] : []),
    ...(picks && plays && finderPitcherApplies(side, query.per) ? [{ key: 'pit', label: 'Pitcher', text: query.pitcherId ? `Against ${picks.name(query.pitcherId)}` : null,
      groups: [{ label: '', options: [{ value: '', label: 'Any pitcher' }] }, ...picks.pitchers], value: query.pitcherId ?? '',
      pick: (v: string) => onQuery({ ...query, pitcherId: v || null }) }] : []),
  ]
  // THE CUTS ONLY THE SEARCH SETS: a run of days and the other player's arm, whose chip is the one way
  // to take them off. A whole month and the last N games are scopes above.
  // A kind of game or a stretch is a scope where its picker is drawn, and a chip of its own where not.
  const cutChips = describeFinderCuts(side, query).filter(c => c.key === 'hand' || (c.key === 'span' && spanMonth == null)
    || (c.key === 'extra' && !kinds?.extra) || (c.key === 'dh' && !kinds?.dh) || (c.key === 'career' && !careerHere))
  const chips: { key: string; text: string; remove: () => void; open?: (e: React.SyntheticEvent<HTMLElement>) => void }[] = [
    ...describeFinderConditions(side, query, true).map(p => ({
      key: `c${p.indices.join('-')}`, text: p.text,
      remove: () => onQuery({ ...query, conditions: query.conditions.filter((_, j) => !p.indices.includes(j)) }),
      open: (e: React.SyntheticEvent<HTMLElement>) => edit(e, { kind: 'cond', indices: p.indices }),
    })),
    ...scopes.filter(sc => sc.text).map(sc => ({
      key: sc.key, text: sc.text!, remove: () => sc.pick(''),
      open: (e: React.SyntheticEvent<HTMLElement>) => edit(e, { kind: 'scope', key: sc.key }),
    })),
    ...cutChips.map(c => ({
      key: c.key, text: c.text,
      remove: () => onQuery(c.key === 'span' ? { ...query, from: null, to: null } : { ...query, [c.key]: null }),
    })),
  ]
  const canAdd = query.conditions.length < MAX_CONDITIONS
  // Asked only once the answer is a zero, and only of sides the section can switch to.
  const nearMisses = useMemo(() => (!loading && result.total === 0 && hasConditions && countFor
    ? finderNearMisses(side, query, askOn ? sides : [side], countFor) : []),
  [loading, result.total, hasConditions, countFor, side, query, askOn, sides])
  const clearAll = () => onQuery({ ...query, conditions: [], batterId: null, pitcherId: null, playerId: null,
    teamId: null, oppId: null, venue: 'any', ...finderCutsOf({}) })
  const anything = chips.length > 0

  // What the open editor is, and the count the sheet says as the edits land.
  const editedScope = editing?.kind === 'scope' ? scopes.find(sc => sc.key === editing.key) ?? null : null
  const editedConds = editing?.kind === 'cond' ? editing.indices.filter(i => i < query.conditions.length) : []
  const surfaceTitle = editing?.kind === 'add' ? 'Add'
    : editedScope ? editedScope.label
    // The chip's own words, which change as the number does: the stat alone is the field under it.
    : editedConds.length ? describeFinderConditions(side, query, true).find(p => p.indices.includes(editedConds[0]))?.text ?? ''
    : ''
  const countText = loading ? '' : `${total} ${games_}`
  const editor = (
    <ChipSurface anchor={anchor} open={!!editing && (editing.kind !== 'cond' || editedConds.length > 0) && (editing.kind !== 'scope' || !!editedScope)}
      onClose={closeEditor} title={surfaceTitle} count={hasConditions ? countText : undefined}>
      {editing?.kind === 'add' && (
        <AddMenu side={side} per={query.per} plays={plays} byClub={!!query.byClub}
          scopes={scopes.filter(sc => !sc.text).map(sc => ({ key: sc.key, label: sc.label }))}
          onScope={key => setEditing({ kind: 'scope', key })}
          onStat={field => {
            if (!canAdd) return
            onQuery({ ...query, conditions: [...query.conditions, startCondition(side, field)] })
            setEditing({ kind: 'cond', indices: [query.conditions.length] })
          }} />
      )}
      {editedScope && (
        <ChoiceList groups={editedScope.groups} value={editedScope.value} searchLabel={`Find a ${editedScope.label.toLowerCase()}`}
          onPick={v => { editedScope.pick(v); closeEditor() }} />
      )}
      {editedConds.map((i, n) => (
        <Box key={i} sx={n > 0 ? { mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' } : undefined}>
          <ConditionEditor side={side} per={query.per} plays={plays} byClub={!!query.byClub} condition={query.conditions[i]}
            onChange={c => setCondition(i, c)}
            onRemove={() => { onQuery({ ...query, conditions: query.conditions.filter((_, j) => !editedConds.includes(j)) }); closeEditor() }} />
        </Box>
      ))}
    </ChipSurface>
  )

  // THE SECOND "BY" SWITCH, where the grain has both: fielding by the inning is a fielder's or a
  // club's (the log places most plays on a fielder, and a club's half counts every one), and a season
  // at the plate is a player's or a club's (a club's carries its two-out runs, which no player's can).
  const byClub = side === 'fielding' && query.per === 'inning'
    ? { label: 'Innings by', options: [{ value: 'fielder', label: 'Fielders' }, { value: 'club', label: 'Clubs' }], value: query.byClub ? 'club' : 'fielder',
      pick: (v: string) => onQuery({ ...query, byClub: v === 'club', playerId: v === 'club' ? null : query.playerId,
        conditions: v === 'club' ? query.conditions.filter(c => c.field !== 'pos') : query.conditions }) }
    : side === 'hitting' && query.per === 'season'
      ? { label: 'Seasons by', options: [{ value: 'player', label: 'Players' }, { value: 'club', label: 'Clubs' }], value: query.byClub ? 'club' : 'player',
        pick: (v: string) => onQuery({ ...query, byClub: v === 'club', playerId: v === 'club' ? null : query.playerId,
          conditions: conditionsForPer(side, 'season', query.conditions, plays, v === 'club') }) }
      : null
  const sideOptions = sides.map(s => ({ value: s, label: SIDE_LABEL[s] }))
  const grainOptions = grains.map(per => ({ value: per, label: GRAIN_SHORT[per] }))
  const sideHere = !!onSide && sides.length > 1

  // "QUESTION", NOT "SEARCH": the toolbar's search is a different tool, and the card holding a
  // question under the Find tab was the second thing on the screen called Search (Nov 10, 2026 audit).
  const question = (
    <SectionCard title="Question" frameless action={
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>{filters}<CopyLink /></Box>
    }>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, pt: 0.5 }}>
        {/* WHAT IS SEARCHED, THEN AT WHAT GRAIN, in one row: the two choices a game finder starts with
            ("pitching, single games"), first because they change what every piece under them means.
            The side was the Stats bar's switch until Nov 10, 2026, with Overall drawn there disabled
            since Find has no both-ways line: a dead option on the first control of a tool, and a
            question split between the bar and the card. The bar leaves it off on Find (onSide).
            ON A PHONE, ONE LINE OF MENUS: the three switches as pills were three rows of different
            widths, a third of the screen before the first answer. A native select is the phone's
            own picker, and "Hitting, Seasons, Players" reads as the question it is. */}
        <Box sx={{ display: { xs: 'flex', sm: 'none' }, flexWrap: 'wrap', alignItems: 'center', gap: 0.75 }}>
          {sideHere && <FilterSelect value={side} options={sideOptions} onChange={v => onSide!(v as FinderBoardSide)} active={false} ariaLabel="Side" />}
          <FilterSelect value={query.per} options={grainOptions} onChange={v => setPer(v as FinderPer)} active={false} ariaLabel="Search by" />
          {byClub && <FilterSelect value={byClub.value} options={byClub.options} onChange={byClub.pick} active={false} ariaLabel={byClub.label} />}
        </Box>
        <Box sx={{ display: { xs: 'none', sm: 'flex' }, flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 1 }}>
          {sideHere && (
            <Box role="group" aria-label="Side" sx={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
              <PillGroup options={sideOptions} value={side} onChange={v => onSide!(v as FinderBoardSide)} />
            </Box>
          )}
          <Box role="group" aria-label="Search by" sx={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
            <PillGroup options={grainOptions} value={query.per} onChange={v => setPer(v as FinderPer)} />
          </Box>
          {byClub && (
            <Box role="group" aria-label={byClub.label} sx={{ alignSelf: 'flex-start' }}>
              <PillGroup options={byClub.options} value={byClub.value} onChange={byClub.pick} />
            </Box>
          )}
        </Box>
        {/* THE BOX FIRST ON A PHONE: typing the question is how a phone starts one, and the menus
            above are how it is corrected. */}
        {parse && onAsk && (
          <Box sx={{ order: { xs: -1, sm: 0 } }}>
            <AskBox side={side} parse={parse} clubAbbr={clubAbbr} name={picks?.name} onAsk={onAsk} asking={chips.length > 0}
              answer={askAnswer} names={askNames} />
          </Box>
        )}
        {/* THE QUESTION, A CHIP A PIECE: a tap opens that piece, its ✕ drops it, and "+ Add" offers a
            stat or a who, where or when. Every condition is AND, which the chips in one row say. */}
        <Box role="group" aria-label="Question" sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.75 }}>
          {chips.map(c => <QuestionChip key={c.key} text={c.text} onRemove={c.remove} onEdit={c.open} />)}
          {canAdd && (
            <Box {...pressable(e => edit(e, { kind: 'add' }))} aria-haspopup="dialog" sx={{
              // Solid, not dashed: a dashed chip read as an empty slot waiting to be filled rather than
              // a button (Nov 10, 2026 audit). The accent ink says it acts, as Copy link does.
              ...textButtonSx, minHeight: chromePx(30), gap: 0.5, border: '1px solid', borderColor: CARD_BORDER, color: ACCENT_EDGE,
              ...hoverOnly({ borderColor: ACCENT_EDGE }),
            }}>+ Add</Box>
          )}
          {anything && <Box {...pressable(clearAll)} sx={{ ...textButtonSx, minHeight: chromePx(30), ml: 'auto' }}>Clear</Box>}
        </Box>
      </Box>
      {editor}
    </SectionCard>
  )

  const table = (
    <FinderTable side={side} query={query} rows={shownRows} ranks={ranks} sort={shownSort} onSort={onSort}
      headlineField={result.headlineField} clubAbbr={clubAbbr} rowParts={rowParts} loading={loading} wide={tableOn} />
  )

  return (
    /* LEFT-ALIGNED WITH THE PAGE. The board starts where the tabs and the controls bar above it
       start; centered, it sat 300px in from them on a desktop and read as a different page. Below
       `md` it keeps the ordinary board column's cap, so a tablet's form does not stretch across. */
    // ONE LAYOUT ON EVERY SIDE: the question over the answers. The question moved into a pinned rail
    // beside them once the board was wide enough for both, which at the page's 1260px cap only a
    // five-column table ever was, so Fielding alone drew it and looked like another board (Nov 9,
    // 2026 audit). The folded chips keep the question in reach above the answers instead.
    <Box sx={{ width: '100%' }}>
      <Box sx={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', alignItems: 'start',
        gap: { xs: 1.5, sm: 2 }, maxWidth: { xs: BOARD_COLUMN, md: 'none' },
      }}>
        <Box sx={{ minWidth: 0 }}>
          {question}
        </Box>

        <Box sx={{ minWidth: 0, containerType: 'inline-size', containerName: 'finder-main' }}>
          {!hasConditions ? (
            <ExampleGrid side={side} grains={grains} examples={examples} count={exampleCount} counted={exampleCounted} href={exampleHref}
              onPick={askWhole} />
          ) : (
          <Box sx={{
            display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', alignItems: 'start', gap: { xs: 1.5, sm: 2 },
            ...(season ? {} : { [tallyBeside]: { gridTemplateColumns: `minmax(0, 1fr) ${TALLY_REM}rem`, columnGap: `${PANE_GAP_REM}rem` } }),
          }}>
            {/* A no-break space while loading: a plain one collapses, and the line with it. */}
            <SectionCard frameless title={season ? 'Matching seasons' : `Matching ${noun[1]}`} subtitle={loading ? String.fromCharCode(160) : summary}
              titleAdornment={<InfoDot label="Columns" text={columnKey} />}>
              {!loading && qualifier && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pb: 1 }}>
                  <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary' }}>{qualifier.label}</Typography>
                  <InfoDot text={qualifier.tip} label="Qualified" />
                </Box>
              )}
              {loading ? (
                <>
                  {table}
                  {/* The expand row a season's worth of matches always brings, so the card does not grow
                      by it when they land and push the tally under it on a phone. */}
                  <ExpandRow flush expanded={false} moreLabel={moreLabel} onToggle={() => {}} />
                </>
              ) : result.rows.length === 0 ? (
                <Box sx={{ py: 2 }}>
                  {/* THE COUNT SEARCHED is what separates "nobody has done this" from "your filters
                      left nothing to look at", so it stays, as a label rather than advice. The zero
                      itself is the subtitle's ("0 games where…"); a "No games" here said it twice. */}
                  <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
                    {result.searched.toLocaleString()} {season
                      ? (result.searched === 1 ? who[0] : who[1])
                      : (result.searched === 1 ? noun[0] : noun[1])} searched
                  </Typography>
                  {/* THE NEAREST QUESTIONS WITH AN ANSWER, each with its count, so a zero is a place
                      to go from rather than a dead end (src/league/finderNearMiss.ts). */}
                  {nearMisses.length > 0 && (
                    <Box role="group" aria-label="Closest" sx={{ pt: 1.75 }}>
                      <SectionLabel>Closest</SectionLabel>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                        {nearMisses.map(m => {
                          const many = m.total !== 1
                          const unit = season ? whoFor(m.side, query.per, query.byClub)[many ? 1 : 0] : noun[many ? 1 : 0]
                          return (
                            <Box key={m.text} {...pressable(() => (m.side === side ? onQuery(m.query) : askOn?.(m.side, m.query)))} sx={{
                              ...FOCUS_RING, display: 'inline-flex', alignItems: 'baseline', gap: 0.75, minHeight: chromePx(32), px: 1.25, py: 0.5,
                              borderRadius: 999, border: '1px solid', borderColor: CARD_BORDER, cursor: 'pointer', userSelect: 'none',
                              fontSize: TYPE_SCALE.meta, ...hoverOnly({ borderColor: ACCENT_EDGE }),
                            }}>
                              <Box component="span" sx={{ fontWeight: 800, color: ACCENT_EDGE }}>{m.text}</Box>
                              <Box component="span" sx={{ color: 'text.secondary', fontWeight: 600, whiteSpace: 'nowrap' }}>{m.total.toLocaleString()} {unit}</Box>
                            </Box>
                          )
                        })}
                      </Box>
                    </Box>
                  )}
                </Box>
              ) : (
                <>
                  {table}
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
                      Top {result.rows.length} of {total}
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
            {/* Nothing matched, nobody to rank: the card said "None" under the line that already says 0. */}
            {season || (!loading && result.total === 0) ? null : loading
              ? <LeaderCardSkeleton title={tallyTitle} rows={TALLY_SHOWN} seeAll={false} splitWhen={tallySplit} />
              : onceEach ? null
              : <LeaderCard title={tallyTitle} empty="None" items={tallyItems} splitWhen={tallySplit} />}
          </Box>
          )}
        </Box>
      </Box>
    </Box>
  )
}

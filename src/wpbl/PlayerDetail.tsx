import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress, useMediaQuery, type Theme } from '@mui/material'
import { fetchWpblPlayerLines, fetchWpblPitcherLocations, getCachedWpblPlayerLines, getCachedWpblPitcherLocations, fetchWpblArticles, getCachedWpblArticles, fetchWpblAllLines, type WpblPitchLoc } from './api'
import { sumBatting, sumPitching, sumFielding, plateAppearances, fmtRate, fmtTwo } from './stats'
import { computeWpblPlayerRanks, ordinal, COUNT_RANK_BAR, COUNT_RANK_MIN_FIELD, type WpblStatRank, type WpblPlayerRanks } from './percentiles'
import { useEraBasis } from './EraBasisContext'
import type { EraBasis } from './stats'
import { wpblAccent, wpblColor, wpblSecondary, wpblFullName, outsToIp } from './constants'
import { ModalShell, PlayerPortrait, CopyLinkButton, TapTip, SegNav, AccentPanel, useWpblDark, chromePx, TAPPABLE } from './ui'
import { statFull, statPlain } from './glossary'
import SwipeableViews from './SwipeableViews'
import { WrittenAbout } from './Reading'
import { PitchLocationCard } from './PitchLocation'
import { displayPosition, positionsPlayed, leadsWithPitching } from './positions'
import { wpblPlayerPath } from './routes'
import { track, EVENTS } from '../lib/analytics'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine, WpblFieldingLine, WpblArticle } from './types'

/**
 * THE CARD'S TYPE SCALE. Five steps, and every piece of type on the player card is one of them.
 *
 * They were ten sizes and three weights before, grown one block at a time, and half of them sat
 * within 0.02rem of a neighbour: 0.56 / 0.58 / 0.60 across three kinds of label, 0.70 / 0.72 /
 * 0.74 across four kinds of caption. Sizes that close cannot be read as different levels but
 * are far enough apart to look unconsidered, which is how a card where no single element is
 * wrong ends up feeling careless.
 *
 * THE STEPS ARE ROLES, NOT SIZES, which is what keeps a new block from inventing an eleventh:
 *
 *   HERO     the rate line: AVG OBP SLG OPS, or ERA WHIP K/7 K/BB, wherever it is drawn
 *   FIGURE   a season total, in the line under the rates
 *   BODY     a game's numbers, and any real sentence
 *   LABEL    uppercase furniture: section headings, buttons, the fielding label
 *   MICRO    what annotates a figure: column headers, ranks, captions, populations
 *
 * IT WAS SIX, with a DISPLAY step over HERO so that the one stat the pane is named for (OPS,
 * ERA) came a size above the three beside it. That was written when the rates were a block of
 * their own; they are columns of the season line now, so the step put THREE sizes in a single
 * row of numbers, and a reader met a hierarchy the row does not have. Which rate is doing well
 * is already said twice, by the rank under it and by the club's colour on it. Size in that row
 * now carries one distinction and only one: a rate is not a count.
 *
 * WEIGHT IS PART OF THE STEP and not a free parameter. Anything uppercase is 800, because at
 * these sizes uppercase needs the weight to hold its counters; figures are 700; running text
 * and a game's cells are 600. There is no 400 on this card, and nothing is 800 for emphasis:
 * emphasis here is the club's colour, spent in the two places named in GameLogTable.
 */
const TYPE = {
  hero: { fontSize: '1.35rem', fontWeight: 800, letterSpacing: '-0.02em' },
  figure: { fontSize: '0.95rem', fontWeight: 700 },
  body: { fontSize: { xs: '0.74rem', sm: '0.8rem' }, fontWeight: 600 },
  label: { fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 },
  micro: { fontSize: '0.6rem', fontWeight: 700 },
} as const

// Player page: profile, season totals aggregated from box-score lines, where those totals sit
// against the league, and a per-game log. Public read; opened from a roster row, a leaderboard,
// the header search, a Home chip, a Discord link or a shared URL.
//
// STRUCTURE, and why it is tabs (Aug 25, 2026). This used to stack every stat block down one
// scroll. Measured on a 375px phone that came to 1287px of scrolling against 654px of sheet,
// and a two-way player got two of everything: two hero cards, two game logs, two sets of table
// chrome for the same nine games. Worse, all four blocks carried the same visual weight, so
// fielding percentage over nine games — which is noise — sat as tall as a .400 average.
//
// Now the roles are a segmented control and only the active one is mounted, the same shape
// Game Center uses for its four boards and the media shelf uses for its three segments. The
// control appears ONLY when a player has more than one real role; the great majority of the
// roster is a hitter or a pitcher and simply sees her own numbers with no chrome around them.
//
// AND WHY IT IS TWO COLUMNS AT lg. Everything above was measured on a phone, and desktop was
// getting that column verbatim: 1143px of stacked content in a 640px dialog on a 1440px
// screen, roughly a third of it visible at a time, with ~800px of empty screen either side.
// So at `lg` the dialog widens, the season facts and the game log sit side by side, and the
// headline pair moves onto the club band, which was otherwise a gradient running most of the
// way across to nothing. Same content, ~600px tall instead of 1143. Nothing below `lg`
// changes: the phone is still the layout everything else here was measured for.

// The stat definitions moved to glossary.ts, whole. They were a private map here, which made
// this page the only surface in the section that could explain a column: Home, StatsView and
// Game Center all draw the same abbreviations and none of them could say what one meant.
// `statTip` is the render half, kept here because glossary.ts is deliberately data-only so
// anything (a Pages Function, a Discord command, a test) can import it without pulling in MUI.
const statTip = (k: string, basis: EraBasis): React.ReactNode => {
  const plain = statPlain(k)
  if (!plain) return statFull(k, basis)
  // Two tiers, because they answer different questions: the expansion says what the letters
  // are, the sentence says what the number is for. A reader who knows the first still wants
  // the second, and one run-on line makes them read it to find out which half they needed.
  return (
    <>
      <Box sx={{ fontWeight: 700 }}>{statFull(k, basis)}</Box>
      <Box sx={{ mt: 0.25 }}>{plain}</Box>
    </>
  )
}

/**
 * Where she played THAT game, off the box-score line.
 *
 * Deliberately the raw line, not `displayPosition`: that answers "what position does this
 * player play", a season-long question decided by majority vote, and it is already answered
 * once in the band at the top. The game log is asking the opposite question, one row at a
 * time, and the interesting rows are exactly the ones the season-long answer overrules: the
 * catcher's three games at first, the day the left fielder finished the game on the mound.
 * Feeding it a smoothed answer would print the same code down all forty rows.
 *
 * The feed writes a slash when she moved mid-game ("lf/p"), and that is kept whole rather than
 * truncated to the first token the way `positions.ts` does for VOTING: a vote has to count one
 * game once, but a reader looking at the row wants to know she pitched. Upper-cased because
 * the feed writes these lowercase and the rest of the page writes positions in caps.
 */
const gamePosition = (raw: string | null | undefined): string => {
  const t = String(raw ?? '').trim()
  return t ? t.toUpperCase() : '—'
}

// A batting line only counts as real batting if the player actually came to the plate — an
// at-bat, a walk, a HBP, or a sacrifice. Zero-PA rows (a pinch-runner who scored, a defensive
// sub) otherwise surface as an all-zero stat block and a phantom "0-for-0" game-log line, so
// we drop them entirely rather than show empty stats.
const hasPlateAppearance = (l: WpblBattingLine): boolean =>
  l.ab + l.bb + l.hbp + l.sf + l.sh > 0
// The player modal sits at zIndex 1600; MUI's tooltip defaults to 1500, so it would
// render behind the modal. Lift the popper above it.
const TIP_Z = 1700

type Role = 'batting' | 'pitching'

// ─── pieces ──────────────────────────────────────────────────────────────────

/**
 * Counting stats as a WRAPPING grid rather than a single row.
 *
 * The row this replaced was `display:flex; overflow-x:auto`, and on a 375px phone a batting
 * line came to 408px of content in a 307px box: SB and TB were cut off mid-row with no
 * scrollbar, no fade and no hint that anything was missing. Silent data loss is the worst
 * shape a layout bug can take, because nobody reports it. A grid cannot clip: it wraps.
 */
/**
 * How many columns the stat grid gets: the cap, near enough always.
 *
 * THIS USED TO CHASE A FULL LAST ROW, taking the widest column count that DIVIDES the tile
 * count, and that turned out to be the wrong thing to optimise. The tile count is not a
 * constant: the grid drops a stat that has never happened, so it runs 8 to 13 tiles depending
 * on whether she has tripled, been hit by a pitch, bunted, or grounded into a double play.
 * Feeding a varying count into "the widest divisor" made the GEOMETRY vary with it. Measured
 * across the roster on Sep 2, 2026, this rendered the same block at four different column
 * counts across the 38 pitchers (3, 4, 5 and 6) and six different shapes across the 63
 * batters, and nine batters landed on 13 tiles, which divides by nothing and fell back to four
 * columns with a last row holding ONE tile.
 *
 * The clearest case was one player and one tap: Kelsie Whitmore's batting grid was 12 tiles at
 * six columns, so 60px tiles, and her pitching grid was 11 tiles at four columns, so 94px
 * tiles, in the same 400px rail. A 57% jump in the size of every box, between two panes of one
 * card, because a home run total happens to divide by six and a wild pitch pushed the other
 * one to a prime.
 *
 * So the cap wins and the last row is allowed to be short. A part-empty last row is invisible
 * when every tile is the same size; a tile that changes size between two players, or between
 * two taps, is visible immediately and reads as the page having lost its grip. The one thing
 * still worth stepping down for is a last row holding a SINGLE tile, which reads as a mistake
 * rather than as a margin.
 *
 * Over every tile count this grid can actually produce (8 to 13) that step is taken once, for
 * 13 alone, which would be 6 + 6 + 1 and becomes 5 + 5 + 3. The loop is not there for those.
 * It is there because "one step is always enough" is false and looked true: `n % c` and
 * `n % (c - 1)` are both 1 whenever n is one more than a multiple of `c(c - 1)`, so a cap of
 * six orphans a tile at 31 with a single step. Searching down to four holds until 61, where n
 * is one more than a multiple of 60 and so leaves a remainder of 1 against every count in
 * range at once. That is not reachable by a stat grid and there is nothing to do about it if
 * it were, so the fallback simply takes the cap.
 */
export const gridColumns = (n: number, cap: number): number => {
  if (n <= cap) return n
  for (let c = cap; c >= 4; c--) if (n % c !== 1) return c
  return cap
}

/** A counting stat that is actually zero, which the grid dims. Deliberately NOT falsy: `'—'`
 *  is absent rather than zero, and `.000` is a measured rate, not an empty box. */
const isZeroStat = (v: string | number): boolean => v === 0 || v === '0'

/**
 * THE SEASON LINE: a table, with a header row, read left to right.
 *
 * This replaces a wrapping grid of ten labelled chips, and the case for the swap is on the
 * card already. The game log directly below it runs fourteen columns at 375px without
 * clipping, scrolling or wrapping, which means the chip grid was solving a problem the table
 * beside it does not have: `StatGrid`'s own note is a measurement of five and six columns
 * against a phone, and the answer turned out to be twelve. Two ragged rows and 90px become a
 * header and a value row in about 44, the labels stop being repeated once per box, and the
 * block finally has the shape every reader arrives here already able to read.
 *
 * THE RANK ROW IS THE OTHER HALF, and it is what lets the percentile strip go. A rank has
 * always been a fact about one number, and it was being drawn 200px below the number it
 * belonged to, where using it means holding a figure in your head on the way down. Under the
 * value it is just an annotation.
 *
 * THE POPULATION IS NOT PRINTED. Every other rank on this site carries its field ("2nd of
 * 33"), and this row deliberately does not: it would be the same phrase under ten columns, or
 * a line of small print under the table repeating what the two rank fields are. What is left
 * is an ordinal in a cell, which is the form a stat table has used for a century. The hero
 * pair on the club band still carries "of N" for the one reader who wants the denominator.
 *
 * WHICH RANKS APPEAR IS THE PROJECT'S OWN MEASURED BAR, not a new one: `bestCountingRanks`
 * keeps a top-5 gate against a field of at least ten, measured over 63 batters, because
 * lighting every top-3 lit six tiles on the two players a reader can already place and nothing
 * at all on 53 of the 63. That bar is kept here and its two-row CAP is dropped, because the
 * cap was rationing vertical space and a rank sitting in a cell costs none. So a card shows
 * every rank worth printing rather than the best two, and a player who leads nothing gets no
 * row at all instead of a line of "34th · 41st · 28th" that reads as a verdict.
 */
interface LineCol {
  label: string
  value: string | number
  /** Her league position in this column, when there is one worth printing. */
  rank?: WpblStatRank | null
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
function SeasonLine({ cols, accent, lead }: { cols: LineCol[]; accent: string; lead?: LineCol[] }) {
  const { basis: eraBasis } = useEraBasis()
  const heads = lead ?? []
  const all = [...heads, ...cols]
  const n = all.length
  const isLead = (i: number) => i < heads.length
  // Lit means "worth the club's colour". A counting rank is pre-gated to the top five by
  // `countRank`, so its presence is the gate; a rate rank is drawn for every qualified player,
  // so it takes the shared bar explicitly. Same bar either way, one place to change it.
  const lit = (c: LineCol, i: number) => (isLead(i) ? isTopFive(c.rank) : c.rank != null)
  const anyRank = all.some(c => c.rank != null)
  // The hairline between columns, and a 2px one closing the lead group: it is the only thing
  // besides size saying the two halves are different kinds of number. A tint down the group was
  // tried and is what the note under `colRuleSx` is about -- the header's own bottom rule cuts
  // any background into pieces.
  const rule = (i: number) => (i === heads.length - 1 && cols.length > 0
    ? { borderRight: '2px solid', borderRightColor: 'divider' }
    : colRuleSx(i, n))
  return (
    // Scrolls in its own container rather than the page, per the house rule for wide content.
    // It is not expected to: thirteen counting columns measure 374px and four rates add ~290,
    // against 1054 of card, and the guard is for the reader at 200% text.
    <Box sx={{ overflowX: 'auto' }}>
      <Box component="table" sx={{
        width: '100%', minWidth: 'max-content', borderCollapse: 'collapse',
        fontVariantNumeric: 'tabular-nums',
      }}>
        <Box component="thead">
          <Box component="tr">
            {all.map((c, i) => (
              <TapTip key={c.label} title={statTip(c.label, eraBasis)} component="th"
                popperZIndex={TIP_Z} sx={{ ...lineThSx, ...rule(i) }}>{c.label}</TapTip>
            ))}
          </Box>
        </Box>
        <Box component="tbody">
          <Box component="tr">
            {all.map((c, i) => (
              // Three states, in order of precedence. A TOP-FIVE FIGURE takes the club's
              // colour: the rank row under it already says so in words, and a reader scanning
              // twelve identical white numbers was being asked to find that out by reading.
              // Only the top five light up, which is `bestCountingRanks`' own measured bar, so
              // a card lights two or three cells rather than half a row. A true zero dims, the
              // same rule the chips had and for the same reason: half a batting line is zeros
              // for most of the roster. A rate reading `.000` is a measurement and keeps its
              // weight. Everything else is plain.
              <Box component="td" key={c.label}
                sx={{
                  ...lineTdSx,
                  // ONE SIZE FOR THE WHOLE LEAD GROUP. It was two, with OPS and ERA a step
                  // above their own siblings, which put three sizes in a single row of
                  // numbers and left a reader working out what the third one meant. The rank
                  // under the cell and the club's colour already say which rate is doing
                  // well; size here only has to separate a rate from a count.
                  // `verticalAlign: baseline` is what makes the two remaining sizes read as
                  // one row: a 1.35rem OPS and a 0.95rem at-bat total sit on the same line
                  // rather than being centred against each other.
                  // one row: a 1.6rem OPS and a 0.95rem at-bat total sit on the same line rather
                  // than being centred against each other.
                  ...(isLead(i) ? { ...TYPE.hero, lineHeight: 1.2, pt: 0.5 } : {}),
                  verticalAlign: 'baseline',
                  ...rule(i),
                  ...(lit(c, i) ? { color: accent }
                    : isZeroStat(c.value) ? { color: 'text.disabled' } : {}),
                }}>
                {c.value}
              </Box>
            ))}
          </Box>
          {anyRank && (
            <Box component="tr">
              {all.map((c, i) => (
                // BLANK where there is no rank, not the em dash this project spends on "no
                // value" elsewhere. That glyph is right in a cell that could have held a
                // measurement; here two thirds of the row would be dashes, and a row that is
                // mostly punctuation reads as missing data rather than as an annotation.
                <Box component="td" key={c.label}
                  sx={{ ...lineRankSx, ...rule(i), ...(lit(c, i) ? { color: accent } : {}) }}>
                  {!c.rank ? ''
                    : isLead(i) ? `${ordinal(c.rank.rank)} of ${c.rank.of}`
                      : ordinal(c.rank.rank)}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Box>
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
 * A TINTED BAND DOWN ALTERNATE COLUMNS WAS THE FIRST TRY AND LOOKED BROKEN. The header cell
 * carries the rule under the labels, so the band arrived in two pieces with a gap across it,
 * and the rank row is drawn only for some columns, so the pieces were different heights from
 * one column to the next. What is meant to be quiet structure read as a rendering fault.
 *
 * A rule cannot come apart that way: it is one line, the same on every column, and it is the
 * device a printed box score has used for this exact job. Drawn to the RIGHT of every column
 * but the last, so the table does not end in a stray edge.
 */
const colRuleSx = (i: number, n: number) => (i < n - 1
  ? { borderRight: '1px solid', borderRightColor: 'divider' }
  : {})

/** Worth the club's colour. The season line's rank row is already gated at this bar, so every
 *  rank it draws passes; the rate strip's is not, and this is what keeps a 16th of 33 from
 *  being lit like a leader. */
const isTopFive = (r: WpblStatRank | null | undefined): boolean => r != null && r.rank <= COUNT_RANK_BAR

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
 * It replaces a centred pair set against a 104px right-aligned column, which was the one
 * element on the pane aligned to an axis nothing else used, and it carries OBP and SLG rather
 * than leaving them to be found in a strip further down. The primary stat keeps the larger
 * size, so the pane still has a headline; it just has it in a row with its own siblings.
 *
 * The band's copy of the hero is deliberately NOT this. There it is one half of a two-part
 * row inside 216px, its contrast against four club washes is solved to three decimal places
 * (see BAND_WASH), and four columns do not fit. Two shapes, one for each place, is the honest
 * answer here; the numbers themselves come from the same totals either way.
 */
function RateStrip({ cells, accent }: {
  cells: { label: string; value: string; rank?: WpblStatRank | null }[]
  accent: string
}) {
  const { basis: eraBasis } = useEraBasis()
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${cells.length}, 1fr)`, gap: 0.5 }}>
      {cells.map(c => (
        <Box key={c.label} sx={{ textAlign: 'center', minWidth: 0 }}>
          <TapTip title={statTip(c.label, eraBasis)} popperZIndex={TIP_Z}
            sx={{ ...TYPE.micro, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.disabled', display: 'block' }}>
            {c.label}
          </TapTip>
          {/* THE SAME RULE AS THE SEASON LINE: top five takes the club's colour, everything
              else is plain. The bar is `COUNT_RANK_BAR`, shared so the two blocks cannot come
              to different views of what is worth lighting up on one card. It matters more here
              than it looks: a rate rank is drawn for every qualified player, so without the
              bar this would put the club's colour on a 16th of 33 and turn an accent into
              decoration. */}
          <Typography sx={{
            ...TYPE.hero, lineHeight: 1.15,
            fontVariantNumeric: 'tabular-nums',
            ...(isTopFive(c.rank) ? { color: accent } : {}),
          }}>{c.value}</Typography>
          {/* Blank when she is not ranked, matching the season line's rank row, and a
              non-breaking space rather than nothing so the strip is exactly as tall on the day
              before she qualifies as on the day after. Four em dashes in a row under four
              numbers that are right there read as missing data; what is missing is the
              comparison, and the meter below says so in words. */}
          <Typography sx={{
            ...TYPE.micro, fontVariantNumeric: 'tabular-nums',
            color: isTopFive(c.rank) ? accent : 'text.secondary',
          }}>{c.rank ? ordinal(c.rank.rank) : ' '}</Typography>
        </Box>
      ))}
    </Box>
  )
}

function StatGrid({ items }: { items: [string, string | number][] }) {
  const { basis: eraBasis } = useEraBasis()
  // A column count that DIVIDES the item count rather than a fixed four and six. Ten batting
  // chips in six columns is 6 + 4, so the row ends in two dead cells and the block reads as a
  // grid that failed to fill rather than as a stat line.
  //
  // `xs` was pinned at four on the claim that five 3-character chips do not fit a 375px phone.
  // Measured on one, they do, and so do six: at five columns the chip is 63px against a 57px
  // label, at six it is 52 against 45, and neither clips or wraps. So the phone takes the same
  // cap as everything else, and the ten batting chips go from three ragged rows to two full
  // ones (138px to 90px) while the six pitching chips collapse to a single row (90px to 45px).
  // That is worth having on the two blocks sitting directly under the headline.
  //
  // The reason six is safe on the narrowest phones is worth stating, because it is a property
  // of the data rather than of the rule: six columns can only ever be chosen for a six-item
  // grid, since six does not divide ten, and the six-item grid is the pitching one, whose
  // labels are all one or two characters. The three-character labels (RBI) live in the ten,
  // which lands on five. Re-measure if a twelve-item grid is ever added here.
  const cols = gridColumns(items.length, 6)
  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 0.75,
    }}>
      {items.map(([label, value]) => (
        <TapTip key={label} title={statTip(label, eraBasis)} popperZIndex={TIP_Z}
          sx={{ textAlign: 'center', borderRadius: 1.5, bgcolor: 'action.hover', py: 0.6, px: 0.4, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.56rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: 'text.disabled' }}>{label}</Typography>
          {/* A zero is dimmed to the weight of its own label. Half a batting grid is zeros for
              most of the roster (a 6 AB line reads 1 · 3 · 1 · 0 · 0 · 3 · 1 · 1 · 0 · 4), and
              at full weight the eye has to read all ten boxes to find the five that say
              anything. The box stays, at its full size: dropping the empty ones would reflow
              the grid per player and cost the column count that `gridColumns` exists to keep,
              and "no triples" is a fact worth being able to look up rather than one to hide.
              Only a true numeric zero dims. A rate that happens to read `.000` is a real
              measurement of something and keeps its weight. */}
          <Typography sx={{
            fontSize: '0.95rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1.25,
            ...(isZeroStat(value) ? { color: 'text.disabled' } : {}),
          }}>{value}</Typography>
        </TapTip>
      ))}
    </Box>
  )
}



/**
 * What stands where the percentile strip would be, for a player who is not ranked yet.
 *
 * This was one grey sentence, "Below the qualifying bar for league ranks", and the trouble
 * with it was not the wording. The strip is the best thing on this page, and it vanishes for
 * exactly the players a reader can least place on their own: a qualified hitter gets four bars
 * and a population, a 6 AB hitter got a refusal. Measured, the rail went from 337px of content
 * to 203px, so the card is visibly emptier the less the reader already knows.
 *
 * A refusal that shows its own arithmetic is not a refusal. The bar here is the same 6px in
 * the same four-column geometry as `PercentileStrip` (label, value, bar, right-hand figure)
 * deliberately: the two states are the same object at two points in a season, so the block
 * does not move or change shape on the day a player qualifies. It is progress toward the bar,
 * NOT a percentile, which is why the right-hand figure is the threshold rather than a rank.
 *
 * 'season-young' keeps the sentence. There is no bar to draw against a threshold the season
 * has not set yet, and a meter reading "0 of 0" would be worse than the words.
 */
function RankProgress({ reason, have, need, unit, fmt, noun, color }: {
  reason: WpblPlayerRanks['batReason']
  /** Raw units (plate appearances, or outs recorded) so the fraction is exact; `fmt` handles display. */
  have: number; need: number
  unit: string
  /** Outs print as innings, at-bats print as themselves. */
  fmt: (n: number) => string
  noun: string
  color: string
}) {
  if (reason === 'ok' || reason === 'no-data') return null
  if (reason === 'season-young') {
    return <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 1.75 }}>League ranks appear once the season is a few games old.</Typography>
  }
  if (need <= 0) return null
  const pct = Math.max(0, Math.min(1, have / need))
  return (
    <Box sx={{ mt: 1.75 }}>
      {/* "Toward qualifying", not "Toward league ranks", which is what it said until
          `CountingStrip` landed directly underneath it with the heading "Where she ranks". Two
          headings about ranks, three rows apart, over bars drawn in the same geometry whose
          right-hand column means opposite things: a THRESHOLD here (29 PA, the bar she is
          walking toward) and a RANK there (3rd, a place she holds). Both bars are near-full on
          the same card, for entirely unrelated reasons. The geometry is shared on purpose and
          stays shared, so the headings are what have to carry the difference. */}
      <Typography sx={sectionSx}>Toward qualifying</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ width: '2.375rem', flexShrink: 0, fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: 'text.disabled' }}>
          {unit}
        </Typography>
        <Typography sx={{ width: '2.75rem', flexShrink: 0, fontSize: '0.78rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {fmt(have)}
        </Typography>
        <Box sx={{ flex: 1, minWidth: 0, height: 6, borderRadius: 999, bgcolor: 'action.hover', overflow: 'hidden' }}>
          <Box sx={{ width: `${Math.round(pct * 100)}%`, height: '100%', bgcolor: color, borderRadius: 999 }} />
        </Box>
        <Typography sx={{ width: '2.125rem', flexShrink: 0, textAlign: 'right', fontSize: '0.68rem', fontWeight: 700, color: 'text.disabled', fontVariantNumeric: 'tabular-nums' }}>
          {fmt(need)}
        </Typography>
      </Box>
      {/* Says what the bar is FOR, in the same slot where the strip prints its population. */}
      <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 0.6 }}>
        {fmt(Math.max(0, need - have))} more {unit} to rank against qualified {noun}.
      </Typography>
    </Box>
  )
}

/**
 * The last few games, in the band's own empty middle.
 *
 * WHY HERE. The band is a three-part row, portrait then bio then hero, and the bio is the
 * flexible one. Measured on a 1440px window, the bio box is 471px holding a widest line of
 * 187 (the name), so 283px of the card's most colourful surface was empty by construction:
 * the single largest uncommitted area on the page, sitting where the club's wash is strongest.
 * This costs no height at all, which matters more than it sounds: the desktop card already
 * runs 893px against a 900px viewport at ten games, so anything that grew the page would be
 * paid for out of the reading list at the bottom.
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
function FormStrip({ title, games }: { title: string; games: { opp: string; value: string }[] }) {
  if (games.length === 0) return null
  return (
    // `md` and up. Below it the band is barely wide enough for the name.
    // WIDTH IS A BUDGET SHARED WITH THE NAME, and this side loses. The band's row is portrait,
    // bio and this, and only the bio flexes: at five cells spelled "vs BOS" the strip took
    // 227px, the bio fell to 225, and "#20 · C · B/T R/R · 23 yrs" wrapped to a second line,
    // which grew the band by 23px on every player whose meta line is long. A block that claims
    // to cost no height has to actually cost none, so the cells carry the squeezed spelling
    // (see `oppLabel().short`), the gap is one step tighter, and `maxWidth` caps the whole
    // thing well short of what five cells could ask for.
    // The cap is in rem for the same reason the budget exists: it is measured against the bio
    // line beside it, and that line is type. Held in px it stopped scaling the moment the
    // reader enlarged the text, so the five cells overflowed their own box at 1.375 while the
    // bio they are competing with grew as intended. 12.5rem is the 200px it has always been.
    <Box sx={{ display: { xs: 'none', md: 'block' }, flexShrink: 0, minWidth: 0, px: 1.5, maxWidth: '12.5rem' }}>
      {/* 0.72 white, the dimmest thing on the band and so the case its wash is budgeted against.
          These sit 74% to 96% along it, which is its strongest end: the strip used to stop inside
          80% with the hero to its right, and took that hero's place when it came off. Re-measured
          there it still clears 4.5:1 on all four clubs, with about a fifth of a step to spare.
          See BAND_WASH. */}
      <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'rgba(255,255,255,0.72)', mb: 0.6 }}>
        {title}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1 }}>
        {games.map((g, i) => (
          <Box key={i} sx={{ textAlign: 'center', minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, color: 'rgba(255,255,255,0.75)', whiteSpace: 'nowrap' }}>
              {g.opp}
            </Typography>
            <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
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
 * It was a run of grey 0.76rem text under the stat grid, which put "also pitched a shutout
 * inning" in the visual register of a footnote while a player one out over the same bar got a
 * whole Batting/Pitching pager. The fact is small; it is not incidental. Same frame as
 * `FieldingLine` deliberately, minus the disclosure: both are one honest line about a part of
 * the season the hero is not describing, and drawing them alike is what makes the pane read
 * as a set of blocks rather than as a stat card with sentences after it.
 */
function CameoBlock({ label, text, color }: { label: string; text: string; color: string }) {
  // No children, so `AccentPanel` draws no disclosure. This block has nothing to open: a
  // cameo is one line by definition, which is what makes it a cameo rather than a tab.
  return <AccentPanel label={label} summary={text} accent={color} sx={{ mt: 2 }} />
}

/** A figure bound to its label, so a stat line that has to wrap can only break at a
 *  separator, and after it rather than before it: the space in front of a middot is a break
 *  opportunity too, and taking it leaves the next line beginning with a lone "·". Joined with
 *  `'\u00a0· '` for that reason. See the note on `positions` below for the letter this
 *  stopped orphaning. */
const nbsp = (value: string | number, label: string): string => `${value}\u00a0${label}`

/**
 * Fielding as one expandable line rather than a hero card.
 *
 * It had a full card with .950 FPCT set as large as a batting average. Over nine games a
 * fielding percentage is almost entirely noise, and giving it that weight told a reader it
 * meant as much as the slash line above it. It is still here, in full, one tap away.
 */
function FieldingLine({ ft, color, positions }: {
  ft: ReturnType<typeof sumFielding>; color: string
  /** Where these numbers came from, most-played first, or empty to say nothing.
   *
   *  ONLY PASSED ON A CARD WITH ROLE TABS, which is the only place the block can be misread.
   *  A fielding row carries no position (see `positionsPlayed`), so a two-way player's totals
   *  are her mound work and her outfield work added together, and the pitching pane presented
   *  that sum as her fielding AS A PITCHER: Whitmore's read "1.000 FPCT · 21 PO · 0 A · 0 E"
   *  beside an ERA, and 21 putouts in five appearances is not a thing a pitcher does. On a card
   *  with one role there is no tab implying a scope, so the codes would be decoration.
   *
   *  Capped at two codes, which is a measurement rather than taste: "CF, P" is 31px, and the
   *  collapsed row has room for it only because the summary beside it is two figures rather
   *  than four. Squeezed any harder it ellipsizes to "C…", which in this of all subjects reads
   *  as a position rather than as a truncation, so the summary is what gives instead. */
  positions?: string[]
}) {
  const full: [string, string | number][] = [
    ['FPCT', fmtRate(ft.fpct)], ['PO', ft.po], ['A', ft.a], ['E', ft.e],
    ...(ft.dp ? [['DP', ft.dp] as [string, number]] : []),
    ...(ft.pb ? [['PB', ft.pb] as [string, number]] : []),
    ...(ft.sba ? [['SBA', ft.sba] as [string, number]] : []),
  ]
  return (
    <AccentPanel
      label="Fielding"
      // TWO FIGURES CLOSED, not four, and the rest one tap away in `full` above.
      //
      // The four did not fit. On a 375px phone the row came to 54px in a space for 35, so it
      // wrapped, and it wrapped in the worst place available: `nbsp` keeps a break out of the
      // gap between a number and its label, so the line broke after the assists and left a
      // second line reading "0 E". Shrinking the position codes instead only moved the damage,
      // since "CF, P" clipped to "C…" reads as a catcher.
      //
      // Which two is not arbitrary. A collapsed summary is the gist, and the gist of a
      // fielding line is how often she was clean and how often she was not. Putouts and
      // assists are how much work came her way, which is a fact about where she stands on the
      // field rather than about how she played it. Both are in the panel, with DP, PB and
      // SBA, one tap down.
      summary={[nbsp(fmtRate(ft.fpct), 'FPCT'), nbsp(ft.e, ft.e === 1 ? 'error' : 'errors')].join('\u00a0· ')}
      meta={positions && positions.length > 0
        ? `${positions.slice(0, 2).join(', ').toUpperCase()}${positions.length > 2 ? '…' : ''}`
        : undefined}
      accent={color}
      sx={{ mt: 2 }}
    >
      <StatGrid items={full} />
    </AccentPanel>
  )
}

/**
 * Columns where "the most of it in one game" is an achievement, so the best game can be marked.
 *
 * Deliberately short of the full line, on two rules. A column has to be one where MORE IS
 * BETTER, which drops SO from the batting log outright (marking a hitter's worst game in the
 * same colour as her best is the sort of thing nobody notices until it is pointed at) and drops
 * H, R, ER, BB and HR from the pitching log for the same reason, since those are what she gave
 * up. And it has to be an ACHIEVEMENT rather than an opportunity or a workload: AB is how often
 * she came up, not how she did, and a pitcher's P is how long she was left in.
 *
 * BB is left out of the batting list on a softer judgement. A walk is a good outcome and it is
 * still in the line, but "most walks in a game" is not a thing anyone scans a game log for, and
 * every mark spent on it is one more piece of colour competing with the four-hit night.
 */
const BATTING_BEST = new Set(['R', 'H', '2B', '3B', 'HR', 'RBI', 'SB', 'TB'])
// Not BF or P: facing more batters is not a better outing, it is a longer one, and marking a
// pitcher's highest pitch count as her best day would read as praise for being left in.
const PITCHING_BEST = new Set(['IP', 'SO'])

/**
 * The best value in a column, if marking it would actually say something.
 *
 * Three ways a column declines to have a best, and all three are about not spending colour on
 * nothing. A max of zero is a stat she has not done all season, and marking ten zeros as ten
 * best games is absurd. A single game cannot have a best game. And a max held by more than a
 * third of the rows is not a standout: a hitter with 1 HR in five of ten games would get five
 * marks that pick out nothing, which is worse than no marks at all, because it teaches a reader
 * the colour means nothing and they stop seeing it on the games where it does.
 *
 * Values are read through `Number` rather than assumed numeric: IP arrives as "5.2" from
 * outsToIp, and its ordering survives the coercion because the fraction digit is only ever
 * 0, 1 or 2. A column carrying anything unparseable (DEC, POS) drops out here rather than
 * needing to be listed above.
 */
function bestInColumn(values: (string | number)[]): number | null {
  if (values.length < 2) return null
  const nums = values.map(v => Number(v))
  if (nums.some(v => !Number.isFinite(v))) return null
  const max = Math.max(...nums)
  if (max <= 0) return null
  const held = nums.filter(v => v === max).length
  return held > Math.max(1, Math.floor(values.length / 3)) ? null : max
}

/**
 * Per-game log: Date and Opp lead, then that game's line.
 *
 * Cell padding tightens under sm because at 0.85 the hitting log came to 401px inside a 337px
 * box and silently clipped its last two columns. The horizontal scroll is the fallback for
 * anything narrower, but it is a POOR one on a phone, where the scrollbar is an overlay that
 * appears only once a finger is already moving: a reader who never tries has no way to know
 * the row continues. So the target is that the widest line FITS a 375px phone outright.
 *
 * 0.3 rather than the 0.4 this held until POS joined the hitting line. Fourteen columns at 0.4
 * measure 345px against the 341px a 375px sheet leaves, which is four pixels and the whole of
 * the TB column, silently. 0.3 brings it to 323 and leaves ~18px of slack, which is about one
 * more character of POS: enough for a player who moved twice in a game ("LF/CF/P"), and the
 * number to re-measure against if a column is ever added here again.
 */
function GameLogTable({ title, statHeaders, rows, totals, best, accent }: {
  title: string
  statHeaders: string[]
  rows: { date: string; opp: string; cells: (string | number)[]; onOpen?: () => void }[]
  /** The season, in the same columns as the games above it, or nothing.
   *
   *  This is the affordance a reader arriving from any stat site reaches for, it costs one
   *  row, and it puts the season in the place they are already scanning columns. It is also a
   *  standing check on the card: the totals come from `sumBatting` over the regular season
   *  while the rows are every game she appeared in, so a log with a postseason game in it
   *  will visibly not add up, which is the correct answer and not a bug to hide. */
  totals?: (string | number)[]
  /** Which headers may carry a best-game mark. See BATTING_BEST / PITCHING_BEST. */
  best?: Set<string>
  accent: string
}) {
  const { basis: eraBasis } = useEraBasis()
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
  // The mark is taken over EVERY game, not over the five on screen: "her best game" is a fact
  // about the season, and recomputing it per preview would move the highlight when the reader
  // expanded the table, which is the one thing a highlight must never do.
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? rows : rows.slice(0, LOG_PREVIEW)
  const more = rows.length - shown.length
  if (rows.length === 0) return null
  return (
    <Box sx={{ mt: 2 }}>
      <Typography sx={sectionSx}>{title}</Typography>
      {/* Capped and self-scrolling, with the header pinned to the top of it and the season row
          pinned to the bottom. This is the one block on the page that grows on its own: a row a
          game, and about forty by the end of a season, against a rail that stays put whatever
          happens.
          THE CAP APPLIES ON A PHONE ONLY ONCE THE READER HAS EXPANDED IT, which is the whole
          of why this is conditional rather than a breakpoint. A nested scroller was deliberately
          kept off the phone while the log was short: it buys nothing there and costs a touch
          gesture inside a sheet that already scrolls. Expanded it is the opposite trade. Forty
          rows is about 1,400px of table with a header that has scrolled out of sight by the
          fourth of them, and a wide row of bare figures with no header above it is unreadable:
          the column under your thumb could be 2B or SO.
          It cannot be solved by leaving the header sticky against the PAGE, which is what it
          looked like it was already doing. A box with `overflow-x: auto` is a scroll container
          on both axes -- CSS will not let one axis scroll and the other stay visible -- so the
          header was sticking to the top of a box exactly as tall as the table, which is to say
          not sticking at all. Giving that same box a height is what turns the sticky it already
          has into the sticky it was written for. */}
      <Box sx={{
        overflowX: 'auto',
        maxHeight: { xs: expanded ? LOG_MAX_H_XS : 'none', md: chromePx(LOG_MAX_H) },
        overflowY: 'auto',
      }}>
        <Box component="table" sx={{ width: '100%', minWidth: 'max-content', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
          <Box component="thead">
            <Box component="tr">
              <Box component="th" sx={{ ...thSx, textAlign: 'left' }}>Date</Box>
              <Box component="th" sx={{ ...thSx, textAlign: 'left' }}>Opp</Box>
              {statHeaders.map(h => (
                <TapTip key={h} title={statTip(h, eraBasis)} component="th" popperZIndex={TIP_Z} sx={thSx}>{h}</TapTip>
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
                  ...(r.onOpen ? {
                  cursor: 'pointer',
                  ...TAPPABLE,
                  // Inset, because an outline drawn outside a table row is clipped by the
                  // log's own scroller on the two rows that matter most, the first and last.
                  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-2px' },
                  } : {}),
                }}
              >
                <Box component="td" sx={{ ...tdSx, textAlign: 'left', color: 'text.disabled' }}>{r.date}</Box>
                {/* Plain, deliberately. This was briefly set in each opponent's own club
                    colour, which gave the log a spine to scan by and cost more than it bought:
                    a reader looking at their own player's card does not need four other clubs
                    competing for attention with her numbers, and the colour landed on the one
                    column nobody came here to read. Emphasis on this card is for the figures.
                    See the best-game marks below and the ranks in the season line. */}
                <Box component="td" sx={{ ...tdSx, textAlign: 'left', fontWeight: 700 }}>{r.opp}</Box>
                {r.cells.map((c, j) => {
                  // The accent, which is safe here in a way it was not on the percentile ranks:
                  // every column that can be marked is one where more is better, so the club's
                  // colour can only ever be attached to good news.
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
                      top ? { ...tdSx, fontWeight: 800, color: accent }
                        : isZeroStat(c) ? { ...tdSx, color: 'text.disabled' }
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
                <Box component="td" sx={{ ...totalTdSx, textAlign: 'left', fontSize: '0.6rem', letterSpacing: 0.5, textTransform: 'uppercase', color: accent }}>
                  Season
                </Box>
                <Box component="td" sx={{ ...totalTdSx, textAlign: 'left' }} />
                {totals.map((c, j) => (
                  <Box component="td" key={j} sx={totalTdSx}>{c}</Box>
                ))}
              </Box>
            </Box>
          )}
        </Box>
      </Box>
      {more > 0 && (
        /* A real button, not a row of the table: it is not a game, and a `tr` carrying a click
           handler is what the log's own rows already do for the thing that IS a game.
           The count is in the label rather than a bare "Show all", because the whole question a
           reader is asking before they tap is how much more there is. */
        <Box
          component="button"
          type="button"
          onClick={() => setExpanded(true)}
          sx={{
            width: '100%', mt: 0.5, py: 0.75, px: 1, border: 'none', borderRadius: 1,
            bgcolor: 'transparent', color: accent, cursor: 'pointer', font: 'inherit',
            ...TYPE.label,
            ...TAPPABLE,
            '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
          }}
        >
          Show {more} more {more === 1 ? 'game' : 'games'}
        </Box>
      )}
    </Box>
  )
}

/** How many games the log opens on.
 *
 *  Five, which is a week and a bit of a WPBL schedule and the same handful the band's form
 *  strip carries. The log is the tallest block on the card by a distance (a row a game, ~14 by
 *  September and ~40 over a full season), and on a phone it pushed everything under it -- the
 *  fielding line, the reading list -- past the point anybody scrolls to. What a reader wants
 *  from a game log at a glance is the recent form; what they want from the rest of it is to be
 *  able to reach it, which is what the control is for.
 *
 *  THERE IS NO COLLAPSE. Expanding is a decision to look at the whole season, and the way back
 *  is the scroll the reader already has. A "show fewer" that yanks 1,000px out from under a
 *  finger mid-scroll is a worse control than no control. */
const LOG_PREVIEW = 5

/** The log's season row. The rule above it is the club's colour and the row's own background
 *  is the paper, because it has to stay legible over whichever game row it comes to rest on
 *  while the log scrolls under it. */
const totalTdSx = {
  ...TYPE.body, fontWeight: 800, py: 0.6, px: { xs: 0.22, sm: 0.85 },
  textAlign: 'center', whiteSpace: 'nowrap',
  position: 'sticky', bottom: 0, zIndex: 1, bgcolor: 'background.paper',
  boxShadow: (t: Theme) => `inset 0 2px 0 ${t.palette.divider}`,
} as const

// ─── the modal ───────────────────────────────────────────────────────────────

export default function PlayerDetailModal({ player, teams, games, players, onClose, onOpenGame }: {
  player: WpblPlayer
  teams: WpblTeam[]
  games: WpblGame[]
  /** The full roster, needed to prove a name slug is unambiguous. Empty only during the first
   *  moment of a cold load, which the share URL falls back around. */
  players: WpblPlayer[]
  onClose: () => void
  /** Open a game from the log. The section's `openGame` closes this player as it goes, so
   *  Back walks off the game and lands on her page again, which is the same stack the reverse
   *  trip already builds (a player opened from a game sits on top of it). Optional only so a
   *  log still renders in a harness that has nowhere to send the click. */
  onOpenGame?: (game: WpblGame) => void
}) {
  const isDark = useWpblDark()
  /**
   * Which of the two layouts to BUILD, rather than which to show.
   *
   * A CSS `display` pair was the first attempt and it is wrong here, because both trees mount:
   * on a phone a two-way player would build the desktop stack as well, which is two game logs
   * and a pitch-location plot rendered to be hidden. The pager exists precisely so that only
   * the role on screen is mounted (see SwipeableViews), and a hidden second tree hands that
   * back.
   *
   * `md`, spelled out, because this file's other breakpoints are MUI's and these two have to
   * agree: the role pills and the pane's rate strip are still hidden with CSS at `md`, so a
   * disagreement would show a phone control over a desktop layout. 900px is MUI's `md`.
   */
  const wide = useMediaQuery('(min-width:900px)')
  const { basis: eraBasis, fmtEra, fmtK, kLabel } = useEraBasis()
  const team = useMemo(() => teams.find(t => t.id === player.team_id), [teams, player.team_id])

  // The same canonical URL the section writes to the address bar when a player page is open
  // (WpblApp's `urlFor`): the readable /wpbl/players/<slug> form, so a copied link matches the
  // bar, is the one Google indexes, and the OG card in ogCard.ts unfurls it as the player
  // rather than the league. Falls back to the legacy ?player=<id> form only while the roster
  // is still loading, since a name slug cannot be proven unique without it (see wpblPlayerSlug)
  // — the same window and the same fallback the address bar uses. Built from the current origin
  // rather than a hardcoded host, so a link copied out of a local or preview build points back
  // at that build instead of sending the reader to production.
  const shareUrl = useMemo(
    () => players.length
      ? `${window.location.origin}${wpblPlayerPath(player, players)}`
      : `${window.location.origin}/wpbl?player=${encodeURIComponent(player.id)}`,
    [player, players])
  const gameById = useMemo(() => new Map(games.map(g => [g.id, g])), [games])
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const color = team ? wpblAccent(team.id, isDark) : '#888'
  // The RAW club colours, for the header band only. Everywhere else on this page uses
  // `color` above, which is the foreground-safe accent.
  const teamPrimary = wpblColor(player.team_id)
  const teamSecondary = wpblSecondary(player.team_id)
  // The wash this club can carry, and its mid-ramp at 60% of it so the gradient keeps its shape
  // whatever the end is. Hex pairs because the colour is a hex string and this is appended to it.
  const wash = BAND_WASH[player.team_id ?? ''] ?? BAND_WASH_FLOOR
  const washEnd = wash.toString(16).padStart(2, '0')
  const washMid = Math.round(wash * 0.6).toString(16).padStart(2, '0')

  // SEEDED FROM THE SESSION CACHE, ON THE FIRST RENDER OF EVERY MOUNT.
  //
  // This card is a modal: closing it UNMOUNTS it, so reopening the same player is a fresh
  // mount and not a prop change. An initial value of `[]` with `loading: true` therefore spun
  // again on every open, however recently the same season had been read. Lazy initialisers,
  // because `player` is a prop and is available before the first paint; the effect below still
  // runs and revalidates behind whatever this put on screen.
  const seeded = getCachedWpblPlayerLines(player.id)
  const [loading, setLoading] = useState(!seeded)
  const [batting, setBatting] = useState<WpblBattingLine[]>(() => seeded?.batting ?? [])
  const [pitching, setPitching] = useState<WpblPitchingLine[]>(() => seeded?.pitching ?? [])
  const [fielding, setFielding] = useState<WpblFieldingLine[]>(() => seeded?.fielding ?? [])
  const [pitchLocs, setPitchLocs] = useState<WpblPitchLoc[]>([])
  // Every batting and pitching line in the league, for the percentile strip. Deliberately a
  // separate piece of state from the player's own lines: this one is allowed to never arrive.
  // `fetchWpblAllLines` is cached, deduped and already prefetched when the section lands on
  // Home, so for most readers this is a cache hit and costs nothing; for the rest the ranks
  // simply appear a moment after the totals, and if it fails they never appear at all and the
  // page is exactly what it was before.
  const [leagueLines, setLeagueLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] } | null>(null)
  // Posts that name this player. Seeded from the shared cache so reopening a player is
  // instant, then revalidated. Most players are never written about, and for them the
  // section below simply doesn't render.
  const [articles, setArticles] = useState<WpblArticle[]>(() => getCachedWpblArticles() ?? [])

  useEffect(() => {
    let cancelled = false
    fetchWpblArticles().then(a => { if (!cancelled) setArticles(a) }).catch(() => { /* keep last-good */ })
    fetchWpblAllLines()
      .then(l => { if (!cancelled) setLeagueLines({ batting: l.batting, pitching: l.pitching }) })
      .catch(() => { /* no ranks; the totals stand on their own */ })
    return () => { cancelled = true }
  }, [])

  // Every official-feed id this player has held. `api_id` alone is only her CURRENT club's
  // id, and the feed mints a new one per club. The joined string IS the value passed on: it is
  // stable across re-renders where an array would not be, and it is the cache key on the other
  // side, so the two ends agree by construction.
  const feedKey = [...new Set([...(player.api_ids ?? []), player.api_id].filter(Boolean))].sort().join(',')

  // ─── Reopening a player is instant ─────────────────────────────────────────
  //
  // This card is reached from a leaderboard, which is a list of twenty of them: open, read,
  // close, open the next, come back to the first. Every one of those used to be a fresh
  // three-table read behind a spinner, on a season that does not change between two taps.
  //
  // THE OTHER PATH IN. The state above covers opening the card; this covers the card being
  // handed a different player while it stays mounted, which is what the "did you mean" results
  // and the next/previous controls do. Seeded DURING RENDER, not in an effect, for the same
  // reason the team rail is: an effect runs after the browser has painted, so seeding there
  // still shows a frame of spinner, or of the previous player's numbers under this player's
  // name. Cache miss falls back to the spinner, which is right for a player nobody has opened.
  const [shownPlayer, setShownPlayer] = useState(player.id)
  if (shownPlayer === player.id && pitchLocs.length === 0) {
    // Seeded here rather than in the initialiser above because it is keyed on `feedKey`, which
    // is derived a few lines further down and cannot be read before it exists.
    const locs = getCachedWpblPitcherLocations(feedKey)
    if (locs && locs.length > 0) setPitchLocs(locs)
  }
  if (shownPlayer !== player.id) {
    setShownPlayer(player.id)
    const seed = getCachedWpblPlayerLines(player.id)
    setBatting(seed?.batting ?? []); setPitching(seed?.pitching ?? []); setFielding(seed?.fielding ?? [])
    setLoading(!seed)
    setPitchLocs(getCachedWpblPitcherLocations(feedKey) ?? [])
  }

  useEffect(() => {
    let cancelled = false
    fetchWpblPlayerLines(player.id).then(({ batting, pitching, fielding }) => {
      if (cancelled) return
      setBatting(batting); setPitching(pitching); setFielding(fielding); setLoading(false)
    })
    // Pitch-location tracking keys on the feed id; empty for non-pitchers / unmapped players.
    // Every id she has held, not just the current one, so a trade does not erase the half of
    // her season she threw under the old club's id.
    fetchWpblPitcherLocations(feedKey).then(locs => { if (!cancelled) setPitchLocs(locs) })
    return () => { cancelled = true }
  }, [player.id, feedKey])

  // Only real plate appearances count as batting — a 0-for-0 pinch/defensive cameo shouldn't
  // produce an all-zero batting card or a phantom game-log row.
  const battingReal = useMemo(() => batting.filter(hasPlateAppearance), [batting])
  // The season line is the REGULAR season. The game log below it still lists every game
  // the player appeared in, postseason included: a log is a record of what happened, and
  // hiding games from it would read as missing data rather than as a filtered total.
  const bt = useMemo(() => sumBatting(battingReal, games), [battingReal, games])
  const pt = useMemo(() => sumPitching(pitching, games), [pitching, games])
  const ft = useMemo(() => sumFielding(fielding), [fielding])
  const hasBatting = battingReal.length > 0
  const hasPitching = pitching.length > 0
  const hasFielding = fielding.some(f => f.po || f.a || f.e || f.dp || f.pb)
  // Off the BATTING lines, which are the only rows carrying a position at all: a fielding row
  // has none and a pitching row is always the mound. A pitching-only appearance still shows up
  // here, because the feed writes those games' batting position as "p" when she came to the
  // plate and the line simply does not exist when she did not, which is a game she fielded only
  // as a pitcher and is already covered by the 'p' the other games carry.
  const fieldedPositions = useMemo(() => positionsPlayed(batting), [batting])

  const ranks = useMemo(
    () => leagueLines
      ? computeWpblPlayerRanks(player.id, players, teams, games, leagueLines.batting, leagueLines.pitching, eraBasis)
      : null,
    [leagueLines, player.id, players, teams, games, eraBasis])

  // Lead with the skill the player is actually here for. The rule is `leadsWithPitching` in
  // positions.ts, shared with the unfurl card and the Discord card so the three cannot tell
  // one player's season two ways round. When one side is a cameo (a pitcher's stray ABs, a
  // hitter's mop-up inning) it does not earn a tab of its own: it folds into the primary pane
  // as a one-line summary, so genuine two-way players stand apart from occasional-hitting
  // pitchers. Thresholds are absolute (AB / outs) so they hold at any sample size; the whole
  // season is only days old.
  const pitcherFirst = leadsWithPitching({
    position: player.position, hasBatting, hasPitching,
    gs: pt.gs, bf: pt.bf, pa: plateAppearances(bt),
  })
  const BAT_CAMEO_AB = 10, PIT_CAMEO_OUTS = 9
  const battingCameo = pitcherFirst && hasBatting && bt.ab < BAT_CAMEO_AB
  const pitchingCameo = !pitcherFirst && hasPitching && pt.outs < PIT_CAMEO_OUTS
  const twoWay = hasBatting && hasPitching && !battingCameo && !pitchingCameo

  // Sample-size meta for each pane, flagged as thin below a rough one-week-ish bar.
  //
  // THE RETRACTION SITS WITH THE CLAIM. This line runs directly under the hero, and the hero
  // is the largest type on the card: a 6 AB player's `1.292` is set at 2rem. The card already
  // disowned that number, but it did it in `NoRanks`, 10px grey, a column away and 200px down,
  // which is not a caveat a reader meets before they have believed the number. Naming the
  // actual bar here is also worth more than the words "small sample" were: it says how far off
  // she is and what she is off from, in the same glance as the figure it qualifies.
  //
  // The league's own bar is preferred over the local one whenever ranks have loaded, so this
  // line and the rail below it cannot disagree about whether she counts. `BAT_SMALL_AB` and
  // `PIT_SMALL_OUTS` stay as the fallback for the window before `fetchWpblAllLines` lands and
  // for a season too young to have set a bar at all, where there is no number to name yet.
  const BAT_SMALL_AB = 25, PIT_SMALL_OUTS = 30 // < ~25 AB / < 10.0 IP reads as small sample
  const qual = ranks?.qualifiers
  // THE GAP, NOT THE BAR. This line printed the threshold ("29 PA to qualify") while
  // `RankProgress` at the foot of the same rail printed the distance to it ("1 more PA"), so a
  // player one plate appearance off the leaderboard had two different numbers for one fact on
  // one card, and the bigger of the two sat under the hero where a reader meets it first and
  // reads it as a quantity still owed. Twenty-nine of anything also sounds like a season away
  // in a league that plays fifteen games.
  //
  // The gap is the better retraction anyway. The bar's job here is to disown the 2rem number
  // above it, and "1 PA from qualifying" disowns it while saying the more interesting thing:
  // she is about to count. The meter below still draws the arithmetic; this is the headline of
  // it, which is why the two are not the duplication the old pair was.
  const paGap = qual ? Math.max(0, qual.minPa - plateAppearances(bt)) : 0
  const outsGap = qual ? Math.max(0, qual.minOuts - pt.outs) : 0
  // Falling through to 'small sample' on a zero gap is deliberate rather than defensive: it
  // cannot happen while this line and `computeWpblPlayerRanks` agree on the bar, and if they
  // ever stop agreeing, a vaguer caveat is a better failure than "0 PA from qualifying".
  // The season these totals belong to, taken off the SCHEDULE rather than the clock: this card
  // is a permanent page with a shareable URL, and read next January a wall-clock year would
  // relabel a 2026 line as 2027's. The latest game we hold, because a schedule that has not
  // started yet still names its own year in its first row.
  const seasonYear = useMemo(
    () => games.reduce((y, g) => { const s = g.game_date?.slice(0, 4) ?? ''; return s > y ? s : y }, ''),
    [games])
  const battingMeta = `${bt.g} G · ${plateAppearances(bt)} PA`
    + (ranks?.batReason === 'below-bar' && paGap > 0 ? ` · ${paGap} PA from qualifying`
      : bt.ab < BAT_SMALL_AB ? ' · small sample' : '')
  // No IP here: it is a column on the pitching line now. The gap to the bar is still
  // measured in innings, because that is the unit the bar is set in.
  const pitchingMeta = `${pt.g} G`
    + (ranks?.pitReason === 'below-bar' && outsGap > 0 ? ` · ${outsToIp(outsGap)} IP from qualifying`
      : pt.outs < PIT_SMALL_OUTS ? ' · small sample' : '')

  // The control only exists for a genuine two-way player. Everyone else gets her own numbers
  // with no chrome: a lone pill that cannot be switched away from is worse than no pill.
  const [role, setRole] = useState<Role>(() => (pitcherFirst ? 'pitching' : 'batting'))
  useEffect(() => { setRole(pitcherFirst ? 'pitching' : 'batting') }, [pitcherFirst])
  const selectRole = (v: string, via: 'pill' | 'swipe') => {
    const next = v as Role
    if (next === role) return
    // Whether anyone ever looks at the second role is the question this restructure raises,
    // and the tab is the only place it can be answered. Same argument as `wpbl_game_tab`.
    // `via` splits taps from swipes, which is the only way to know whether the gesture is
    // worth what it costs the layout: the band above had to become pinned chrome to give the
    // pager a definite height to live in.
    track(EVENTS.WPBL_PLAYER_ROLE, { role: next, from: role, via, playerId: player.id })
    setRole(next)
  }

  // Opponent label for a game the player appeared in.
  //
  // `lineTeam` is the club she played THAT game for, off the box-score line, not the one on
  // her roster row. A traded player's old games are still in her log, and reading the current
  // club would ask "was Los Angeles at home?" of a New York game she played in July — neither
  // side matches, so the label falls through to naming her own team and the row reads "@ NY"
  // for a game she played for New York. The line always knows; the roster row only knows now.
  const oppLabel = (gameId: string, lineTeam: string | null): { date: string; text: string; short: string } => {
    const g = gameById.get(gameId)
    if (!g) return { date: '', text: '', short: '' }
    const forTeam = lineTeam ?? player.team_id
    const isHome = g.home_team_id === forTeam
    const oppId = isHome ? g.away_team_id : g.home_team_id
    const opp = teamById.get(oppId)
    const date = new Date(`${g.game_date}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })
    const abbr = opp?.abbr ?? oppId
    // `short` is the same fact with the spaces squeezed out, for the band's form strip, which
    // is competing for width with the name beside it rather than sitting in a table column.
    // Home is unmarked and away carries the '@', which is the shortest spelling that still
    // says which it was.
    return { date, text: `${isHome ? 'vs' : '@'} ${abbr}`, short: `${isHome ? '' : '@'}${abbr}` }
  }

  // The lead columns of one game-log row, plus what tapping it does. Every log builds its
  // stat cells itself and takes the rest from here, so the two of them cannot drift on which
  // club a traded player's row is read against (see oppLabel) or on where the row goes.
  const logRow = (gameId: string, lineTeam: string | null) => {
    const g = gameById.get(gameId)
    const o = oppLabel(gameId, lineTeam)
    // No handler for a game the schedule does not hold, rather than a dead row that looks
    // pressable: the log is built from box-score lines and the schedule is fetched separately,
    // so a line can arrive for a game this render has not seen.
    return { date: o.date, opp: o.text, onOpen: g && onOpenGame ? () => onOpenGame(g) : undefined }
  }

  // Box-score lines come back in whatever order the API returns them, which is not
  // chronological, so a game log rendered straight off them reads as shuffled. Sort on the
  // game's real ISO date — not the "Aug 13" label the row displays, which would sort
  // alphabetically and put August after April. Sort is stable, so two games sharing a date
  // (a doubleheader) keep their relative order.
  //
  // NEWEST FIRST, which this was not until Aug 25, 2026. Oldest-first reads down the season
  // the way it was played, and that is the better argument right up until the log is long: at
  // ten games it is a nice narrative and at forty it buries last night at the bottom of a
  // scroll, which is the one row anyone opening a player page in September is looking for. It
  // also decides what the desktop cap shows without scrolling, since that clips the BOTTOM of
  // the list (see GameLogTable), and oldest-first would have spent those thirteen rows on August.
  const newestFirst = <T extends { game_id: string }>(lines: T[]): T[] =>
    [...lines].sort((a, b) => {
      const da = gameById.get(a.game_id)?.game_date ?? ''
      const db = gameById.get(b.game_id)?.game_date ?? ''
      return db.localeCompare(da)
    })

  // The band's form strip: the last few games for whichever role is on screen, oldest first.
  // Reversed off `newestFirst` rather than sorted again, so the two can never disagree about
  // which game is the most recent (a doubleheader shares a date, and only a stable sort of the
  // same list keeps them in the same relative order in both places).
  const FORM_GAMES = 5
  const formGames = (r: Role): { opp: string; value: string }[] =>
    r === 'pitching'
      ? newestFirst(pitching).slice(0, FORM_GAMES).reverse()
        .map(l => ({ opp: oppLabel(l.game_id, l.team_id).short, value: outsToIp(l.outs) }))
      : newestFirst(battingReal).slice(0, FORM_GAMES).reverse()
        .map(l => ({ opp: oppLabel(l.game_id, l.team_id).short, value: `${l.h}-${l.ab}` }))

  // Posts naming this player, newest first (the query already orders that way).
  const writtenAbout = useMemo(
    () => articles.filter(a => a.player_ids.includes(player.id)),
    [articles, player.id])

  // The position she has actually been playing, which is not always the one on the roster.
  // `overridden` puts the filed one alongside rather than dropping it: a reader who knows her
  // as the club's catcher should not have to wonder whether we lost her.
  const pos = displayPosition(player.position, batting)
  // Uniform number leads the meta line when the roster carries one (69 of 118 do). It is a
  // fact of identity a reader looks for first, so it goes ahead of position and handedness.
  const subParts = [player.jersey_number ? `#${player.jersey_number}` : null, pos.label, pos.overridden && pos.official ? `listed ${pos.official}` : null, [player.bats, player.throws].filter(Boolean).join('/') ? `B/T ${player.bats || '-'}/${player.throws || '-'}` : null, player.age != null ? `${player.age} yrs` : null].filter(Boolean)

  // ── the two panes ──────────────────────────────────────────────────────────

  /**
   * The headline pair for a role, in either of the two places it can live: the club band on a
   * desktop dialog, or the top of the pane on anything narrower. Same numbers either way, so
   * they are built once here rather than written twice and left to drift apart.
   */
  /**
   * A counting rank worth printing in a cell.
   *
   * The bar is `bestCountingRanks`' own, kept deliberately: top 5, against a field of at least
   * ten, and never a "1st" that is really a tie on zero. What is dropped is that helper's
   * two-row CAP, which was rationing vertical space that a rank sitting inside a cell does not
   * spend. See SeasonLine.
   */
  const countRank = (rs: WpblStatRank[] | undefined, key: string): WpblStatRank | null => {
    const r = rs?.find(x => x.key === key)
    return r && r.of >= COUNT_RANK_MIN_FIELD && r.rank <= COUNT_RANK_BAR && r.value > 0 ? r : null
  }
  const rateRank = (rs: WpblStatRank[] | undefined, key: string): WpblStatRank | null =>
    rs?.find(x => x.key === key) ?? null

  /** The four rates at the top of the card, per role. Shared by the phone's strip and the
   *  desktop band, which differ only in whether a rank has room for its population. */
  const rateCells = (r: Role) => r === 'pitching' ? [
    { label: 'ERA', value: fmtEra(pt.era), rank: rateRank(ranks?.pitching, 'era') },
    { label: 'WHIP', value: fmtTwo(pt.whip), rank: rateRank(ranks?.pitching, 'whip') },
    { label: kLabel, value: fmtK(pt.k9), rank: rateRank(ranks?.pitching, 'k9') },
    { label: 'K/BB', value: fmtTwo(pt.kbb), rank: rateRank(ranks?.pitching, 'kbb') },
  ] : [
    { label: 'AVG', value: fmtRate(bt.avg), rank: rateRank(ranks?.batting, 'avg') },
    { label: 'OBP', value: fmtRate(bt.obp), rank: rateRank(ranks?.batting, 'obp') },
    { label: 'SLG', value: fmtRate(bt.slg), rank: rateRank(ranks?.batting, 'slg') },
    { label: 'OPS', value: fmtRate(bt.ops), rank: rateRank(ranks?.batting, 'ops') },
  ]

  /**
   * The head of the pane: four rates across, on the phone, which is the only place it is
   * drawn. Above `md` the same cells are the season line's own lead columns instead, where a
   * rank has room for its population; see SeasonLine.
   *
   * IT IS FULL WIDTH NOW, and that is the change. The hero used to be a 216px group centred in
   * a 378px pane, capped and centred so a right-aligned rank could not drift away from its
   * label. That fixed the rank and left the block as the one element on the pane aligned to an
   * axis nothing else used, sitting above a stat grid and a percentile strip that both ran edge
   * to edge. Four equal columns spanning the same width as the table beneath them share the
   * table's own gridlines, so there is no second axis left to reconcile.
   */
  const paneHead = (r: Role) => (
    <Box sx={{ mb: 1.25, display: { xs: 'block', md: 'none' } }}>
      <RateStrip cells={rateCells(r)} accent={color} />
    </Box>
  )

  /** How much of a season these numbers are, in the units the qualifying bar is set in.
   *
   *  IT IS THE TABLE'S CAPTION, not a line of its own, and that is the fix. It used to float
   *  between the rate strip and the table: a centred grey line belonging to neither, sitting
   *  in the one place on the pane where two blocks needed to read as connected. Set on the
   *  table's own top rule, with the season on the left and the sample on the right, it is what
   *  every stat page puts over a line of numbers, and it closes the gap it used to sit in.
   *
   *  BOTH HALVES SHOW AT EVERY WIDTH. The sample used to stand down at `md`, where a left rail
   *  carried it under the rates; the rail is gone, and with it the only other place on the
   *  desktop card that said how much of a season these numbers are. The season label was never
   *  conditional: it is the only place the card says WHICH season these are. */
  const lineCaption = (r: Role) => (
    <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
      <Typography sx={{ ...sectionSx, mb: 0 }}>{seasonYear ? `${seasonYear} season` : 'Season'}</Typography>
      <Typography sx={{
        ...TYPE.micro, color: 'text.disabled', fontVariantNumeric: 'tabular-nums',
        textAlign: 'right',
      }}>
        {r === 'pitching'
          ? `${pitchingMeta} · ${pt.w}-${pt.l}${pt.s > 0 ? ` · ${pt.s} SV` : ''}`
          : battingMeta}
      </Typography>
    </Box>
  )

  // Each pane in two halves, because a desktop dialog puts them side by side: `season` is what
  // is true about her year, `log` is the record of the games it came out of. On anything
  // narrower they simply stack in this order and nothing about the reading changes.
  const battingPane = {
    hasLog: battingReal.length > 0,
    head: paneHead('batting'),
    line: (merged: boolean) => (
      <>
        {lineCaption('batting')}
        {/* THE ORDER IS THE BOX SCORE'S, and that is most of what makes a table worth having
            over the grid it replaced: R H 2B 3B HR RBI SB CS BB SO is the order every fan has
            read a batting line in since childhood, so the header row becomes a thing you check
            rather than a thing you read. The grid had no order to be wrong about; a table does,
            and it was, with the steals filed after the strikeouts.

            TOTAL BASES CAME OFF. It is not on a box score's batting line, SLG two rows above is
            it divided by at-bats, and `WPBL_BAT_COUNT_RANK_DEFS` already says in writing that it
            is "mostly a restatement of the hits and homers above it". A column that restates its
            neighbours costs a column of width on a phone to say nothing new. It is still ranked,
            so a total-bases lead still reaches the card through the counting ranks.

            G and PA are in the caption on the table, so they are not repeated as columns.
            RARE EVENTS APPEAR ONLY ONCE THEY HAVE HAPPENED, which is the rule the grid this
            replaced already followed and which matters more in a table: a column reading 0
            costs a whole column of width, and Andréanne Leblanc's line showed 3B 0, SB 0 and
            CS 0 beside H 17. Steals are a PAIR, because a steal total alone cannot say whether
            the running worked. Doubles stay unconditional: common enough that a zero is a fact
            about the season rather than an absence of one. */}
        {/* AB leads, unlike the grid this replaced, which left it on the sample line: a hit
            total is unreadable without the at-bats beside it, and the log below has the column
            too, so the totals row and the line now agree column for column. */}
        <SeasonLine cols={[
          { label: 'AB', value: bt.ab },
          { label: 'R', value: bt.r, rank: countRank(ranks?.battingCounts, 'c_r') },
          { label: 'H', value: bt.h, rank: countRank(ranks?.battingCounts, 'c_h') },
          { label: '2B', value: bt.doubles, rank: countRank(ranks?.battingCounts, 'c_2b') },
          ...(bt.triples ? [{ label: '3B', value: bt.triples, rank: countRank(ranks?.battingCounts, 'c_3b') }] : []),
          { label: 'HR', value: bt.hr, rank: countRank(ranks?.battingCounts, 'c_hr') },
          { label: 'RBI', value: bt.rbi, rank: countRank(ranks?.battingCounts, 'c_rbi') },
          ...(bt.sb || bt.cs ? [
            { label: 'SB', value: bt.sb, rank: countRank(ranks?.battingCounts, 'c_sb') },
            { label: 'CS', value: bt.cs },
          ] : []),
          { label: 'BB', value: bt.bb, rank: countRank(ranks?.battingCounts, 'c_bb') },
          // SO carries no rank, ever. Second in the league in strikeouts is not an
          // achievement, and the counting defs leave it out for that reason; printing a rank
          // here would put it back by the side door.
          { label: 'SO', value: bt.so },
          ...(bt.hbp ? [{ label: 'HBP', value: bt.hbp }] : []),
          ...(bt.sh ? [{ label: 'SH', value: bt.sh }] : []),
          ...(bt.sf ? [{ label: 'SF', value: bt.sf }] : []),
          ...(bt.gdp ? [{ label: 'GDP', value: bt.gdp }] : []),
        ]} accent={color} lead={merged ? rateCells('batting') : undefined} />
      </>
    ),
    season: (
      <>
        {pitchingCameo && (
          <CameoBlock label="Also pitched" color={color}
            text={`${fmtEra(pt.era)} ERA over ${outsToIp(pt.outs)} IP, ${pt.so} K`} />
        )}
        {/* Only the meter survives here: the ranks themselves have moved into the cells they
            belong to, and what is left is the administrative note about why some of them are
            missing. Drawn only for a player who is actually short of the bar. */}
        {ranks && ranks.batReason !== 'ok' && (
          <RankProgress reason={ranks.batReason} have={plateAppearances(bt)} need={ranks.qualifiers.minPa}
            unit="PA" fmt={String} noun="batters" color={color} />
        )}
      </>
    ),
    log: (
      <GameLogTable
        title="Game log"
        // The box score's order, matching the season line above it. TB stays HERE and not
        // there: over one night it is the slugging line of that night and worth marking as a
        // best game, and over a season it is SLG times at-bats.
        statHeaders={['POS', 'AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'SB', 'BB', 'SO', 'TB']}
        // No position in the totals: a season is not played at one. The em dash is this
        // project's glyph for "no value", which is exactly what that cell is.
        totals={['—', bt.ab, bt.r, bt.h, bt.doubles, bt.triples, bt.hr, bt.rbi, bt.sb, bt.bb, bt.so, bt.tb]}
        best={BATTING_BEST}
        accent={color}
        rows={newestFirst(battingReal).map(l => ({ ...logRow(l.game_id, l.team_id), cells: [gamePosition(l.position), l.ab, l.r, l.h, l.doubles, l.triples, l.hr, l.rbi, l.sb, l.bb, l.so, l.tb] }))}
      />
    ),
    /** What follows the log and the fielding line. Only the pitching pane has any. */
    extras: null,
  }

  const pitchingPane = {
    hasLog: pitching.length > 0 || pitchLocs.length > 0,
    head: paneHead('pitching'),
    line: (merged: boolean) => (
      <>
        {lineCaption('pitching')}
        {/* THE ORDER IS THE BOX SCORE'S, as on the batting line: H R ER HR BB SO, with the
            home runs beside the other things she gave up rather than stranded after the
            strikeouts.

            G, IP and the decision line are in the caption on the table. GS is a column because it
            is the one number here that says what KIND of pitcher she is, and this section now
            reads it to decide which half of a two-way season leads (see positions.ts). BF and
            P say how much work the year was, which nothing on this card could say before: it
            could tell you what she gave up and not how many batters she faced. HBP, WP and BK
            show up only once they have happened, like the batting line's sacrifices. */}
        <SeasonLine cols={[
          { label: 'GS', value: pt.gs },
          // IP is a column rather than a line of caption, which is where a box score puts it
          // and where a pitching line is unreadable without it: every counting stat to its
          // right is a rate waiting for a denominator. It comes off the caption in the same
          // breath, so the two cannot say it twice on one phone screen.
          { label: 'IP', value: outsToIp(pt.outs), rank: countRank(ranks?.pitchingCounts, 'c_outs') },
          { label: 'H', value: pt.h },
          { label: 'R', value: pt.r },
          { label: 'ER', value: pt.er },
          { label: 'HR', value: pt.hr },
          { label: 'BB', value: pt.bb },
          { label: 'SO', value: pt.so, rank: countRank(ranks?.pitchingCounts, 'c_so') },
          ...(pt.hbp ? [{ label: 'HBP', value: pt.hbp }] : []),
          ...(pt.wp ? [{ label: 'WP', value: pt.wp }] : []),
          ...(pt.bk ? [{ label: 'BK', value: pt.bk }] : []),
          // BATTERS FACED IS GONE and pitches stay. The two look like a pair and are not:
          // with innings now in the line, BF is very nearly innings times three plus the
          // baserunners already itemised two columns to its left, while a pitch count is the
          // only thing on the card that says how hard the innings were. `pt.bf` is still read,
          // by the role rule in positions.ts, which is why the column can go without the
          // number going.
          { label: 'P', value: pt.pitches },
        ]} accent={color} lead={merged ? rateCells('pitching') : undefined} />
      </>
    ),
    season: (
      <>
        {battingCameo && (
          <CameoBlock label="Also batted" color={color}
            text={`${fmtRate(bt.avg)}/${fmtRate(bt.obp)}/${fmtRate(bt.slg)}, ${bt.h}-for-${bt.ab}${bt.hr ? `, ${bt.hr} HR` : ''}`} />
        )}
        {ranks && ranks.pitReason !== 'ok' && (
          <RankProgress reason={ranks.pitReason} have={pt.outs} need={ranks.qualifiers.minOuts}
            unit="IP" fmt={outsToIp} noun="pitchers" color={color} />
        )}
      </>
    ),
    log: (
      <>
        {/* THE GAME LOG FIRST, and the pitch plot under it. This was the other way round, which
            put the least complete thing on the card at the top of its column: league pitch
            tracking reaches a handful of games, so the card's own summary line reads "44
            pitches · 1 of 5 games", and every endpoint carrying that data went API-key gated on
            Sep 1, 2026, so the gap is not going to close. A complete record of every appearance
            outranks a sample of one of them. */}
        {/* No POS column here, unlike the batting log: a pitching line's position is 'p'
            in every row of every pitcher's season. */}
        <GameLogTable
          title="Game log"
          statHeaders={['DEC', 'IP', 'H', 'R', 'ER', 'HR', 'BB', 'SO', 'P']}
          // The record stands in for the decision column, which is the only cell here whose
          // season form is a different thing from the sum of the games above it.
          totals={[`${pt.w}-${pt.l}`, outsToIp(pt.outs), pt.h, pt.r, pt.er, pt.hr, pt.bb, pt.so, pt.pitches]}
          best={PITCHING_BEST}
          accent={color}
          rows={newestFirst(pitching).map(l => ({ ...logRow(l.game_id, l.team_id), cells: [l.decision ?? '—', outsToIp(l.outs), l.h, l.r, l.er, l.hr, l.bb, l.so, l.pitches ?? '—'] }))}
        />
      </>
    ),
    extras: pitchLocs.length > 0
      ? <Box sx={{ mt: 2 }}><PitchLocationCard rows={pitchLocs} accent={color} gamesPitched={pt.g} /></Box>
      : null,
  }

  const showTabs = twoWay
  // The band only takes the hero once there is a hero to take: not while the lines are still
  // in flight, and never for a fielding-only cameo, whose empty batting totals would put a
  // .000 OPS on the card as though it were a fact about her.
  const showBandHero = !loading && (hasBatting || hasPitching)
  // The pager's index space, primary role first. A two-way player gets both panes; everyone
  // else gets exactly one, which is what keeps a lone unswitchable pill off the page. A
  // one-panel pager is not a special case: it simply has no neighbour to reach, so a sideways
  // drag rubber-bands and lets go, which is the same answer the tab bar gives.
  const roles: Role[] = twoWay
    ? (pitcherFirst ? ['pitching', 'batting'] : ['batting', 'pitching'])
    : [pitcherFirst ? 'pitching' : 'batting']
  const roleIndex = Math.max(0, roles.indexOf(role))
  // Fielding and the reading list belong to the PLAYER, not to a role, so they ride inside
  // whichever pane is on screen rather than sitting under the pager: a block below the panes
  // would be pinned chrome at the bottom of the sheet, and a block in only the primary pane
  // would hide a catcher's fielding line behind a tab.
  //
  /**
   * THE DESKTOP PAGE: one stack of full-width blocks, per role.
   *
   * WHAT WAS WRONG WITH THE RAIL. It was "rates down a left column, tables on the right", and
   * the rail had nothing left to hold: the summary sentence had gone, the percentile strip was
   * absorbed into the season line's own rank row, fielding moved under the log. Measured on
   * Sep 5, 2026 in an 1100px dialog, the pitching rail was 507px wide holding a 270px block
   * 149px tall beside a 517x529 table, and the batting rail 424px holding 215px beside 600x443.
   * About a quarter of the card was empty column, twice over on a two-way player.
   *
   * AND IT COULD NOT BE NARROWED. The log asks for its natural width and the rail takes
   * whatever is left, so the SHORTER the log the WIDER the void: a pitcher, who has the least
   * to say, got the emptiest card. Any floor small enough to fix that is one the batting log
   * would then push through, back into its own horizontal scroller.
   *
   * ACROSS THE TOP THERE IS NOTHING LEFT OVER. The rates are the season line's own first
   * columns, that table spans, the log under it spans, and the card is a single column of
   * full-width blocks, which is both the shape the phone already uses and the shape every
   * stat page has always had. See SeasonLine's `lead`.
   *
   * THE TABS STILL COME OFF, which is the other half of the desktop page and is unchanged:
   * tabs buy vertical space on a phone, a desktop dialog is not short of it, and a two-way
   * player is exactly who a stat site puts two tables on one page for. Baseball Reference has
   * never asked anyone to choose between Standard Batting and Standard Pitching. That is also
   * why the club band has no hero: it could only ever show one role.
   *
   * The phone is untouched. It keeps the pager, the pills and the four-across rate strip,
   * which is what a 375px column can hold.
   */
  const desktopRoleBlock = (r: Role, last: boolean) => {
    const pane = r === 'pitching' ? pitchingPane : battingPane
    return (
      <Box key={r} sx={{ mb: last ? 0 : 3.5 }}>
        {/* Named only when there are two of them. On a single-role card the heading would be
            answering a question nobody asked: a hitter's page does not need to say "Batting". */}
        {twoWay && (
          <Typography sx={{ ...sectionSx, color: color, mb: 1 }}>
            {r === 'pitching' ? 'Pitching' : 'Batting'}
          </Typography>
        )}
        {/* ONE TABLE, and that is the whole of it: the rates ARE the first four columns of the
            season line, not a second block set beside it.

            THE PAIR WAS ALIGNED TO NOTHING. Side by side they were two independent grids. The
            caption sat over the right one only, so the season line already started a caption's
            height below the band beside it, and from there each of the three rows that mean the
            same thing in both (label, figure, rank) landed on a line of its own, since the two
            blocks set their figures at different sizes and so at different row heights. Nothing
            was wrong with either block; there was simply no line for the eye to follow across
            the gap, which is what made a card of correct numbers read as confused.
            Alignment between two grids can only ever be arranged by hand and re-arranged every
            time a row changes height. Inside one table it is not arranged at all.

            It is also the conventional shape. Every standard batting line ever printed carries
            the rates and the counts in one row under one header; the only liberty here is that
            the rates come FIRST, because on this card they are the headline rather than the
            summary. See SeasonLine's `lead`. */}
        {pane.line(true)}
        {/* THE CAMEO AND THE QUALIFYING METER, which the rail layout dropped on the floor: it
            never rendered `pane.season` at all, so a desktop reader of a below-the-bar player
            met four unranked rates and no word about why, and a two-way cameo lost the one line
            saying she had also pitched. Capped to a reading measure, because both are sentences
            and a sentence set across 1050px is not read. */}
        <Box sx={{ maxWidth: chromePx(SENTENCE_W) }}>{pane.season}</Box>
        {pane.log}
        {/* Fielding belongs to the PLAYER, not to a role, so it is drawn once, after the last
            role's log. On a two-way card it would otherwise appear twice, and its totals are her
            mound work and her outfield work added together either way. It stays ABOVE the pitch
            plot: that data reaches two games of a season and every endpoint carrying it went
            key-gated on Sep 1, 2026, so it is the one block on the card that is genuinely
            stale. */}
        {last && hasFielding && (
          <FieldingLine ft={ft} color={color} positions={twoWay ? fieldedPositions : undefined} />
        )}
        {pane.extras}
      </Box>
    )
  }

  /**
   * THE PHONE'S PANE, and only the phone's: above 900px `wide` swaps this whole pager out for
   * `desktopRoleBlock`, and `wide` is MUI's `md` to the pixel.
   *
   * It used to be a responsive grid carrying a full `md` two-column arrangement, every line of
   * which was unreachable for that reason, describing a left rail the card no longer has. A
   * layout that cannot render is worse than no layout: it is the first thing the next reader
   * finds when they go looking for how the desktop works.
   */
  const panels = roles.map(r => {
    const pane = r === 'pitching' ? pitchingPane : battingPane
    return (
      // `pt` answers to the role pills, because what sits directly under them is the rate
      // strip: 16px of pane padding below an 8px strip, plus the optical space a large numeral
      // carries above its digits, put ~32px between the control and the numbers it controls.
      // That was the largest gap on the card, and it fell between the two things most obviously
      // part of each other.
      <Box key={r} sx={{ px: 2, pt: showTabs ? 1 : 2, pb: 2 }}>
        {pane.head}
        {pane.line(false)}
        {pane.season}
        {pane.log}
        {/* UNDER THE LOG, and the log is the reason. Over nine games a fielding percentage is
            almost entirely noise, and it was sitting above a complete record of every
            appearance; a reader met the least reliable number on the card before the most
            reliable block on it. It still has to be somewhere a catcher's line can be found,
            which is why it is here rather than at the foot of the pane, and it stays ABOVE the
            pitch plot: that data reaches two games of a season and every endpoint carrying it
            went key-gated on Sep 1, 2026, so it is the one block on the card that is genuinely
            stale. */}
        {hasFielding && <FieldingLine ft={ft} color={color} positions={showTabs ? fieldedPositions : undefined} />}
        {pane.extras}
        {/* Rendered even for a player with no line yet (see the no-stats branch below): someone
            who has been written about but has not logged a game is exactly the case where this
            is the most interesting thing on the page. Renders nothing when nobody has written
            about her, which is most of the roster. */}
        <WrittenAbout articles={writtenAbout} title={`Written about ${player.name}`} wide />
      </Box>
    )
  })

  return (
    <ModalShell
      eyebrow={team ? wpblFullName(team) : 'Player'}
      onClose={onClose}
      // IT IS NO LONGER A FLOOR SET BY ANYTHING, which is worth saying because it reads like
      // one. It was chosen for a two-column pane that has gone: the widest block on the card is
      // now the merged batting season line at 666px and the batting game log at 600, both
      // comfortably inside the 1054 this leaves. What the extra width buys is room, so a
      // fourteen-column log is not read at its own minimum. Re-measure against the SEASON LINE
      // if a column is ever added to it: it is the wide one now, not the log.
      // It is a fixed pair rather than a value derived from the content so the dialog cannot
      // resize under the reader as the season totals land. Through `chromePx` because the
      // pair was chosen while the section ran a 1.4 `zoom`: spent raw it is the same number
      // against 40% larger type, which is what wrapped this player's name onto two lines.
      maxWidth={{ xs: chromePx(640), md: chromePx(880) }}
      zIndex={1600}
      actions={<CopyLinkButton url={shareUrl} title={`Copy a link to ${player.name}`} />}
      // A sheet on a phone, like Game Center: this opens from a roster row, a leaderboard, a
      // Home chip and a shared link, and its only way out was the close button in the far top
      // corner. Now it comes up from the bottom edge with a handle and swipes back down.
      // Unchanged above sm, where a centred dialog is right.
      sheet
      // Constant height while it is a sheet, so it does not leap up the screen when the season
      // totals and game logs finish loading under the reader's thumb. Same reason as the game
      // card, whose box score lands the same way.
      sheetFill
    >
      {/* Two sizings, because the sheet and the dialog are shaped differently, and the same
          arrangement the game card uses for the same reason.
          On a phone the sheet holds a definite height, so this fills it (`flex: 1`) and every
          percentage below resolves, which is what lets each role pane scroll itself and what
          gives the pager a slot to live in at all.
          Above sm the modal is content-height on purpose, so a short player sizes it down
          instead of forcing full height, and this is clamped rather than filled. `flex: 1`
          there would collapse the pane to nothing, since a flex item with a zero basis
          contributes nothing to an auto-height parent. */}
      <Box sx={{
        display: 'flex', flexDirection: 'column', minHeight: 0,
        flex: { xs: '1 1 0%', sm: '0 1 auto' },
        maxHeight: { xs: 'none', sm: '100%' },
      }}>
      {/* Identity, on the club's own colours.
          This was a white block with a 4px accent spine down the left, which is the least a
          team colour can do. The band takes the club's PRIMARY as its background: all four
          WPBL primaries are near-black (BOS #00281e, LA #000000, NY #091b47, SF #2d1747), so
          white text clears 12:1 on every one of them and the wash of secondary across the
          right stays well under the point where it would stop being readable. The stripe along
          the bottom is the secondary at full strength, which is where each club's actual hue
          lives: orange, gold, sky, red. It carries the same 2px as the ring around the
          portrait sitting on it, deliberately, so the band reads as one object drawn in one
          weight rather than as a photo with a heavier rule under it.
          Deliberately NOT `wpblAccent`: that is the foreground-safe variant, built to be read
          as text on the page background. Here the colour IS the background. */}
      {/* `data-sheet-drag` makes this band the sheet's grab surface on a phone, and it is not
          decoration: the redesign pushed this page past the height of the sheet, so its body
          is a real scroller now, and a scroller takes ownership of a touch before the drag
          handler can. That left the 36x4px handle and the eyebrow bar as the only places a
          reader could actually pull the card back down. The band is the obvious thing to grab
          and the one block here nobody scrolls to READ, which is exactly the trade the
          attribute is for. See useSheetDrag. */}
      {/* Pinned, not scrolled away with the stats, and that is what the swipe cost: the pager
          below needs a definite height, so the band had to come out of the scroller. It pays
          for itself twice over. Whose numbers these are stays on screen at any depth, and the
          sheet's grab surface never scrolls out of reach. */}
      <Box data-sheet-drag sx={{
        position: 'relative', flexShrink: 0,
        // The secondary washes OVER an opaque primary rather than being the last stop of a
        // gradient that runs out of colour. As a plain gradient the right-hand end was
        // `secondary` at 25% alpha over whatever sat behind the card, which in light mode is
        // white, so the band faded to near-white exactly where the hero numbers now sit. This
        // keeps every point on the band dark enough for white text, and as a side effect the
        // club's actual hue is finally visible in light mode instead of washing out.
        //
        // MORE OF THE CLUB, LESS OF THE BLACK. The wash used to hold the flat primary to 42%
        // and reach only 25% secondary at the far edge, which left a band reading as black with
        // a hint of something in one corner rather than as the club's colours. It starts at 26%
        // now and ramps to whatever that club can carry. See BAND_WASH for what sets the number.
        backgroundColor: teamPrimary,
        backgroundImage: `linear-gradient(105deg, transparent 0%, transparent 26%, ${teamSecondary}${washMid} 62%, ${teamSecondary}${washEnd} 100%)`,
        borderBottom: `2px solid ${teamSecondary}`,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1.5, sm: 2 }, p: { xs: 1.75, sm: 2.25 } }}>
          {/* A rounded square rather than a circle, and bigger. A circle crops a
              head-and-shoulders portrait to the face; at this size there is room for the
              shoulders and the uniform, which is most of what makes a player recognisable. */}
          {/* One size at every width, deliberately. This was a `useMediaQuery` picking 92 on
              desktop and 76 on a phone, which is a JS media query: it does not re-render on a
              live window resize the way the CSS breakpoints on this same band do, so dragging a
              desktop window under 600px left a 92px portrait next to phone-sized padding until
              the next navigation. 84 reads well at both, and the band's padding and type still
              step at `sm` where CSS can do it properly. */}
          <PlayerPortrait name={player.name} teamId={player.team_id} square size={84} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
              {/* The page's <h1>. A player page is a modal over a tab but it is a real page
                  with its own URL and title, and the tab underneath stops rendering an h1
                  while this is open; see PageHeading.tsx. */}
              <Typography component="h1" sx={{ fontSize: { xs: '1.2rem', sm: '1.4rem' }, fontWeight: 800, lineHeight: 1.15, color: '#fff', m: 0 }}>
                {player.name}
              </Typography>
              {twoWay && (
                // White on a translucent white wash rather than the club's secondary: SF's red
                // on SF's purple measures about 3.5:1, which is thin for a badge and would be
                // the one club whose label is harder to read than the other three.
                <Box sx={{ flexShrink: 0, px: 0.85, py: 0.2, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.22)', color: '#fff', fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Two-way
                </Box>
              )}
            </Box>
            {subParts.length > 0 && (
              <Typography sx={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.88)', mt: 0.25 }}>{subParts.join(' · ')}</Typography>
            )}
            {/* Two lines, not one run-on. Joined with a separator the draft wrapped mid-phrase
                behind a long hometown, so "Round 3, Pick 12" broke across lines with the city
                and read as part of the address. They are also separate FACTS: the draft line
                now shows for a player with no hometown on file, which the old single line
                gated away by accident. */}
            {/* 0.75, not the 0.62 these were: the band carries far more of the club's hue than
                it did (see the gradient above), and at 0.62 these two lines fell to 3.7:1 over
                New York's sky blue. They are the smallest text on the card and the first thing
                a stronger wash costs. */}
            {player.hometown && (
              <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.75)', mt: 0.1 }}>
                {player.hometown}
              </Typography>
            )}
            {player.draft_round && (
              <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.75)', mt: 0.1 }}>
                Round {player.draft_round}, Pick {player.draft_pick}
              </Typography>
            )}
          </Box>
          {/* Fills the band's own slack, and takes the role the hero is showing so a two-way
              player's form line follows her tab rather than contradicting the numbers beside
              it. Costs no height: the band's height is set by the 84px portrait. */}
          {showBandHero && (() => {
            // `roles[roleIndex]`, not `role`: the same expression the hero beside it uses, so
            // the two cannot fall out of step for a two-way player mid-swipe.
            const r = roles[roleIndex]
            const g = formGames(r)
            return <FormStrip title={`Last ${g.length} · ${r === 'pitching' ? 'IP' : 'H-AB'}`} games={g} />
          })()}
          {/* NO HERO ON THE BAND ANY MORE, and the reason is the desktop layout below rather
              than anything about the band. The band can only ever show ONE role's numbers, and
              above `md` every role is now drawn with its own rates as the first columns of its
              own season line, so a band hero would either duplicate the primary role's four or
              pick one of two and hide the other. Picking is what that layout exists to stop
              doing.
              Below `md` the rates live in the pane and always did. What the band keeps is what
              is true of the player rather than of a role: who she is, and how the last few
              games went. See desktopRoleBlock. */}
        </Box>
      </Box>

      {loading ? (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : !hasBatting && !hasPitching && !hasFielding ? (
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 2 }}>
          <Box sx={{ textAlign: 'center', py: 5, color: 'text.secondary' }}>
            <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, mb: 0.5 }}>No stats yet</Typography>
            <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled' }}>Season totals appear here once this player logs a game.</Typography>
          </Box>
          <WrittenAbout articles={writtenAbout} title={`Written about ${player.name}`} />
        </Box>
      ) : (
        <>
          {showTabs && !wide && (
            /* The pinned strip the role pills live in, and its padding is not arbitrary: it
                matches Game Center's tab bar, which is the same control doing the same job over
                the same kind of pager.
                It was `pt: 2, pb: 0`, which is backwards on both counts. The pill belongs to the
                chrome ABOVE it, not to the pane below, and with no bottom padding its edge sat
                flush against the scroller's clip line: on a phone, scrolled, that put a row of
                stat chips sliced through the middle directly under the control with nothing
                between them, which reads as a broken layout rather than as content that
                continues. The 16px it was spending above bought nothing on a sheet that has
                none to spare. */
            <Box sx={{ flexShrink: 0, px: 2, pt: 0.75, pb: 1 }}>
              <SegNav
                options={roles.map(r => ({ value: r, label: r === 'pitching' ? 'Pitching' : 'Batting' }))}
                value={role}
                onChange={v => selectRole(v, 'pill')}
                accent={color}
                mb={0}
              />
            </Box>
          )}
          {/* The two roles page under a finger, the same gesture and the same component as the
              game card's tabs (`mode="pane"`, because this is a modal with a locked body and an
              inner scroller rather than the window-scrolled page the pager was first built for).
              Two panes is exactly where a swipe is worth having: the tab bar is a 40px target
              at the top of a sheet, and the thing a reader wants to compare is the other half of
              the same player.
              A role is mounted the first time it is shown and then kept, which is the pager's
              own trade: a remount mid-swipe re-shapes a whole game log and a pitch-location plot
              in the frame the finger is moving, and that stutter is the one thing that makes a
              finger-tracked pager feel broken. An unvisited role still costs nothing. */}
          {wide ? (
            /* THE DESKTOP PAGE. One scroller holding every role in full, rather than a pager
               holding one of them. See desktopRoleBlock for what each role is made of and why
               the tabs come off up here. */
            <Box sx={{ minHeight: 0, overflowY: 'auto', px: 2, pt: 2, pb: 2 }}>
              {roles.map((r, i) => desktopRoleBlock(r, i === roles.length - 1))}
              {/* Under everything, spanning, for the reason it always did: it is the one block
                  here that is neither a season fact nor a game, and a well-covered player put
                  346px of article cards against a rail with nothing like that much to say. */}
              <Box sx={{ mt: 1 }}>
                <WrittenAbout articles={writtenAbout} title={`Written about ${player.name}`} wide />
              </Box>
            </Box>
          ) : (
            <SwipeableViews
              mode="pane"
              index={roleIndex}
              onIndexChange={i => selectRole(roles[i], 'swipe')}
              panels={panels}
            />
          )}
        </>
      )}
      </Box>
    </ModalShell>
  )
}

/**
 * How much of each club's secondary the band's wash reaches at its far edge, 0-255.
 *
 * PER CLUB, because one number gave four different results. A single 40% looked right on New
 * York's pale sky blue and left Boston's orange looking like a rumour: the four secondaries have
 * nothing like the same luminance, so the same alpha over four different near-black primaries is
 * four different amounts of visible colour.
 *
 * WHAT SETS EACH NUMBER. White text has to clear 4.5:1 against the strongest point of the wash,
 * and the binding case is always the smallest text sitting in it. Each value below is the largest
 * that clears that with a step of headroom, and against the hometown and draft lines at 0.75 they
 * measure:
 *
 *   BOS 0x7a (48%) 4.80:1 · LA 0x98 (60%) 4.78:1 · NY 0x61 (38%) 4.84:1 · SF 0x8f (56%) 4.89:1
 *
 * THE FORM STRIP IS THE BINDING CASE NOW, and it was not when those were solved. It sat inside 80%
 * along the wash with the band's hero to its right; the hero came off when every role got its own
 * rates below, and the strip took its place at the end of the band, 74% to 96%. Its label is the
 * dimmest thing on the band at 0.72. Re-measured there on Sep 5, 2026 it clears 4.72 / 4.77 / 4.74
 * / 4.77 on BOS / LA / NY / SF, so all four values below still hold, with very little to spare:
 * anything dimmer than 0.72 at that end of the band fails.
 *
 * The ceilings before headroom are 51 / 62 / 41 / 61 percent, so there is not much left in any of
 * them. LA was the outlier at 0x8f/5.12, a good half-step short of its own ceiling and so visibly
 * less gold than the other three clubs are their colour; 0x98 lands it on the same ~4.8 as BOS and
 * NY, which is what "a step of headroom" is worth here. It is now within three points of failing:
 * 0xa0 (63%) measures 4.50 and does not clear.
 *
 * Change a club's colours in constants.ts, lift the wash, or move a block along the band, and
 * these have to be re-solved against every text opacity sitting in it, or the smallest lines on
 * the card quietly stop being readable on one club and nobody reports it.
 */
const BAND_WASH: Record<string, number> = { BOS: 0x7a, LA: 0x98, NY: 0x61, SF: 0x8f }
/** For a club not in the table: the tightest of the four, which is safe for any secondary. */
const BAND_WASH_FLOOR = 0x61

/**
 * A READING MEASURE, for the two blocks on the desktop card that are sentences rather than
 * figures: the cameo line and the qualifying meter.
 *
 * Everything else above `md` now spans the card, which is right for a table and wrong for a
 * sentence. "3 more PA to rank against qualified batters." set across 1050px is a line the eye
 * has to travel the whole card to finish, and the meter beside it would draw a 900px bar to say
 * a player is four at-bats short. Spent through `chromePx`, like every other structural length
 * here.
 */
const SENTENCE_W = 560
// About thirteen rows, which is a little over the tallest the left rail gets. See GameLogTable.
const LOG_MAX_H = 440
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
const LOG_MAX_H_XS = '50vh'


const sectionSx = { ...TYPE.label, color: 'text.secondary', mb: 1 } as const

// Game-log table cells. Headers are compact uppercase; body cells are tabular so columns
// stay aligned down the table. Both center-align (numeric); the Date/Opp lead columns
// override to left in the component. Horizontal padding is responsive — see GameLogTable.
//
// The header row pins, for the capped desktop log (see GameLogTable). Two details it needs:
// an opaque background, or the rows scroll THROUGH it rather than under it, and its rule drawn
// as an inset shadow rather than a border, because a `border-collapse: collapse` table hands
// its cell borders to the row boundary and a sticky cell leaves them behind. Harmless where
// the log is not capped: a sticky cell in a container that never scrolls never moves.
const thSx = {
  ...TYPE.micro, textTransform: 'uppercase', letterSpacing: 0.4,
  color: 'text.disabled', py: 0.6, px: { xs: 0.22, sm: 0.85 }, textAlign: 'center', whiteSpace: 'nowrap',
  position: 'sticky', top: 0, zIndex: 1, bgcolor: 'background.paper',
  boxShadow: (t: Theme) => `inset 0 -1px 0 ${t.palette.divider}`,
} as const
const tdSx = { ...TYPE.body, py: 0.55, px: { xs: 0.22, sm: 0.85 }, textAlign: 'center', borderTop: '1px solid', borderColor: 'divider', whiteSpace: 'nowrap' } as const

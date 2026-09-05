import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress, type Theme } from '@mui/material'
import { fetchWpblPlayerLines, fetchWpblPitcherLocations, getCachedWpblPlayerLines, getCachedWpblPitcherLocations, fetchWpblArticles, getCachedWpblArticles, fetchWpblAllLines, type WpblPitchLoc } from './api'
import { sumBatting, sumPitching, sumFielding, plateAppearances, fmtRate, fmtTwo } from './stats'
import { computeWpblPlayerRanks, ordinal, bestCountingRanks, type WpblStatRank, type WpblPlayerRanks } from './percentiles'
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
import { wpblBattingSummary, wpblPitchingSummary } from './derive/playerSummary'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine, WpblFieldingLine, WpblArticle } from './types'

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
 * The two numbers a reader came for, each on its own line with its own rank.
 *
 * This replaced a headline that read `.406/.513/.688` under the label `AVG/OBP/SLG` with a
 * floating `6th of 33` pill off to the right. Three problems, all of them the same problem:
 * the pill did not say WHICH of the three stats it ranked, a slash line is three numbers
 * where the page only needs the one that summarises them, and OBP and SLG were being given
 * hero weight while OPS — which is just the two of them added — sat in the small grey line
 * underneath. Now the rank sits on the same row as the stat it belongs to and cannot be
 * misread, and OPS leads with AVG under it because those are the two anyone asks for.
 */
function HeroStat({ value, label, rank, primary, onDark }: {
  value: string; label: string; rank?: WpblStatRank; primary?: boolean
  /** Drawn on the club band rather than on the page. The band is the club's primary, which is
   *  near-black on all four teams, so the theme's own text colours would be invisible on it in
   *  light mode. */
  onDark?: boolean
}) {
  const { basis: eraBasis } = useEraBasis()
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
      {/* One width for both rows, so the two numbers right-align into a column and the two
          labels start at the same x. They used to be 96 and 62, which put OPS and AVG at
          different indents and made the pair read as two unrelated lines. */}
      <Typography sx={{
        fontSize: primary ? '2rem' : '1.15rem', fontWeight: 800, lineHeight: 1.1,
        letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums',
        minWidth: HERO_VALUE_W, textAlign: 'right', flexShrink: 0,
        ...(onDark ? { color: '#fff' } : {}),
      }}>
        {value}
      </Typography>
      <TapTip title={statTip(label, eraBasis)} popperZIndex={TIP_Z} sx={{ flexShrink: 0 }}>
        <Typography sx={{
          fontSize: primary ? '0.75rem' : '0.68rem', fontWeight: 800, textTransform: 'uppercase',
          // 0.80 on the band, not 0.72. The band hero sits in the last 216px of the wash,
          // which is the strongest point of it, and the stronger gradient took this line to
          // 4.4:1 over New York's sky blue. Same reason as the hometown lines. See the band.
          letterSpacing: 0.6, color: onDark ? 'rgba(255,255,255,0.80)' : 'text.disabled',
        }}>
          {label}
        </Typography>
      </TapTip>
      {rank && (
        // The rank carries its population, always. "2nd" alone invites a reader to picture a
        // league of hundreds; "2nd of 17" is the same fact without the borrowed authority.
        //
        // Neutral, NOT the team accent. The accent is a club identity, and three of the four
        // are green or red, so "31st of 33" rendered in Boston green reads as good news about
        // a bad number, and a Firebells hitter leading the league would get her rank in red.
        // The rank is a fact; the colour was editorialising, at random, by club.
        <Typography sx={{
          ml: 'auto', flexShrink: 0, fontSize: '0.7rem', fontWeight: 800,
          color: onDark ? 'rgba(255,255,255,0.82)' : 'text.secondary', fontVariantNumeric: 'tabular-nums',
        }}>
          {ordinal(rank.rank)} of {rank.of}
        </Typography>
      )}
    </Box>
  )
}

/** Sample size and the counting facts that are not worth a grid cell. One line, and the ONLY
 *  place games and at-bats appear: they used to be here and again as the first two chips of
 *  the grid below, which is the same fact twice on the same screen. */
const HERO_VALUE_W = 104

/**
 * CENTRED, and it is the only element in the hero that is.
 *
 * The two stat rows are a three-column arrangement with three hard vertical lines: the values
 * right-align at one edge, the labels start at the next, the ranks right-align at the last.
 * This line was block-level and left-aligned, so it began at the hero's own left edge: 16px
 * left of the headline number, 65px left of the one under it, and level with nothing at all.
 * One element out of four aligned to a line no other element uses reads as a mistake, and it
 * is the line a reader's eye lands on last, which is why it was the piece that kept looking
 * wrong after the block itself was fixed.
 *
 * Centred rather than joined to one of the three columns, because its LENGTH varies more than
 * anything else here: "10 G · 29 AB" against "9 G · 41.2 IP · 6-2 · 3 SV · small sample". Tied
 * to the value column it would fit the first and wrap the second; centred, a long one simply
 * grows either side of the axis the whole block is already centred on.
 */
function SampleLine({ text, onDark }: { text: string; onDark?: boolean }) {
  return (
    <Typography sx={{
      // 0.76 on the band: it is the smallest thing sitting in the strongest part of the wash,
      // and 0.62 measured 3.7:1 over New York. See the band's gradient for the whole budget.
      fontSize: '0.72rem', color: onDark ? 'rgba(255,255,255,0.76)' : 'text.disabled',
      mt: 0.75, textAlign: 'center', fontVariantNumeric: 'tabular-nums',
    }}>
      {text}
    </Typography>
  )
}

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
 * Where each stat sits against the qualified field.
 *
 * The bar is position-only: it is not coloured good-to-bad, because a four-club league in its
 * first season does not support a red-to-blue scale that implies a settled distribution. The
 * population size is printed under the strip for the same reason. See percentiles.ts.
 */
/** The rank keys the hero already prints, per role, and therefore the ones the strip must not
 *  print again. Kept here as one list because the bug it fixes was two places agreeing by
 *  accident: the hero shows OPS and AVG with their ranks, the strip showed AVG, OBP, SLG, OPS,
 *  HR and K% with theirs, and a reader met ".395 AVG 10th of 31" and "AVG .395 10th" twenty
 *  pixels apart. Four of the six numbers in the block were the four already above it. What is
 *  left is what the hero cannot say: OBP and SLG under the OPS that is their sum, plus HR and
 *  K%. If the hero's pair ever changes, change it here in the same commit. */
/**
 * The summary sentence, or nothing at all.
 *
 * Rendered at body weight rather than as a caption: it is the first thing on the card that a
 * reader can read instead of parse, and a grey 0.66rem line under a 2rem OPS would be styled
 * as a footnote to the number it is there to explain. Nothing is drawn when the sentence is
 * null, and no empty box is left where it would have been.
 */
function SummaryLine({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <Typography sx={{ fontSize: '0.82rem', lineHeight: 1.45, color: 'text.secondary', mb: 1.25 }}>
      {text}
    </Typography>
  )
}

const HERO_RANK_KEYS: Record<'batting' | 'pitching', readonly string[]> = {
  batting: ['ops', 'avg'],
  pitching: ['era', 'whip'],
}

function PercentileStrip({ ranks: allRanks, counts, of, color, noun, role }: {
  ranks: WpblStatRank[]
  /** Her counting ranks, already capped and de-duplicated against the rate rows. They are
   *  taken against the SAME field as the rows above whenever she is qualified, which is what
   *  lets them sit under this block's single population line instead of needing one of their
   *  own. See the note in percentiles.ts. */
  counts: WpblStatRank[]
  of: number; color: string; noun: string
  role: 'batting' | 'pitching'
}) {
  const ranks = allRanks.filter(r => !HERO_RANK_KEYS[role].includes(r.key))
  if (ranks.length === 0 && counts.length === 0) return null
  return (
    <Box sx={{ mt: 1.75 }}>
      <Typography sx={sectionSx}>Against the league</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.55 }}>
        {/* Rates first, then counts. One list, deliberately, and NOT two blocks with a heading
            each: "Against the league" over the rates and "Where she ranks" over the counts is
            the same sentence written twice, and a reader met two identically-drawn strips
            whose only difference was a population they had no reason to be tracking. What the
            split was really encoding is that a rate needs a qualifying bar and a count does
            not, which is a fact about the arithmetic and not one worth a second heading. */}
        {ranks.map(r => <StripRow key={r.key} r={r} color={color} />)}
        {counts.map(r => <StripRow key={r.key} r={r} color={color} />)}
      </Box>
      {/* The population, and nothing else. It stays because a bar without a field size borrows
          the authority of a Statcast page built on thousands of batted balls, and this is a
          four-club league. The paragraph that used to follow it explaining that has gone: the
          number says it. */}
      <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 0.6 }}>
        Against {of} qualified {noun}.
      </Typography>
    </Box>
  )
}

/** One ranked row: label, value, bar, rank. Shared by the two strips deliberately, and the
 *  four column widths are the reason. They are what make a rate rank and a counting rank read
 *  as the same kind of statement rather than as two blocks that happen to be near each other,
 *  and the widths are in `rem` because each one is reserving room for a string that grows with
 *  the reader's text size. See the note on fixed sizes in CLAUDE.md. */
function StripRow({ r, color }: { r: WpblStatRank; color: string }) {
  const { basis: eraBasis } = useEraBasis()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <TapTip title={statTip(r.label, eraBasis)} popperZIndex={TIP_Z} sx={{ width: '2.375rem', flexShrink: 0 }}>
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: 'text.disabled' }}>
          {r.label}
        </Typography>
      </TapTip>
      <Typography sx={{ width: '2.75rem', flexShrink: 0, fontSize: '0.78rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {r.display}
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0, height: 6, borderRadius: 999, bgcolor: 'action.hover', overflow: 'hidden' }}>
        <Box sx={{ width: `${Math.round(r.pct * 100)}%`, height: '100%', bgcolor: color, borderRadius: 999 }} />
      </Box>
      <Typography sx={{ width: '2.125rem', flexShrink: 0, textAlign: 'right', fontSize: '0.68rem', fontWeight: 700, color: 'text.disabled', fontVariantNumeric: 'tabular-nums' }}>
        {ordinal(r.rank)}
      </Typography>
    </Box>
  )
}

/**
 * Where her counting totals sit in the league, which is a question the qualifying bar has no
 * business answering.
 *
 * WHY IT IS HERE AT ALL. The strip above is the best thing on this page and it disappears for
 * the player a reader can least place on her own, because a rate off nine at-bats is not a
 * fact. `RankProgress` softened that by showing the arithmetic of the refusal, but it is still
 * a refusal: the card ends up with no comparison on it anywhere. A COUNT is not subject to
 * that objection. A short sample can only deflate one, never inflate it, so "3rd in the WPBL
 * in steals" is exactly as true off 28 plate appearances as off 200, and Maïka Dumais's page
 * had no way to say it while shouting a .618 OPS it then spent two blocks disowning.
 *
 * AND WHY IT IS NOT TILE HIGHLIGHTING, which is where this started. Accenting every counting
 * tile in the league's top 3 was measured over the 63 batters who had played: it lit six of
 * the ten tiles on each of the two leaders' cards, and nothing at all on 53 of the 63. A grid
 * with six of ten tiles lit is a flat grid again, so the version that survived is a capped
 * strip. See COUNT_RANK_BAR and COUNT_RANK_ROWS.
 *
 * IT DRAWS NOTHING WHEN SHE LEADS NOTHING, which is most of the roster, and that is the
 * property that makes it safe to show to everyone rather than only to the unqualified. A
 * player below the bar is not handed a block of near-empty bars restating that she has not
 * played much: she either has a league position worth printing or the card is exactly as it
 * was. It sits under both branches for the same reason the two branches share a geometry:
 * nothing on the rail should move on the day she qualifies.
 */
function CountingStrip({ ranks, of, color, noun }: {
  ranks: WpblStatRank[]; of: number; color: string; noun: string
}) {
  const best = bestCountingRanks(ranks)
  if (best.length === 0) return null
  return (
    <Box sx={{ mt: 1.75 }}>
      {/* THE SAME HEADING as the qualified player's strip, because it is the same block. A
          card shows one or the other and never both: above the bar the counting rows merge
          into `PercentileStrip`, and this is what is left of that block when there are no rate
          rows to merge into. Only the population line differs, and it has to: this field is
          everyone who has played, which is precisely the field a below-bar player IS in. */}
      <Typography sx={sectionSx}>Against the league</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.55 }}>
        {best.map(r => <StripRow key={r.key} r={r} color={color} />)}
      </Box>
      <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 0.6 }}>
        Against {of} {noun} who have played.
      </Typography>
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
    // `lg` only. Below it the band is barely wide enough for the name, which is the same width
    // at which the hero stands down to `paneHero`.
    // WIDTH IS A BUDGET SHARED WITH THE NAME, and this side loses. The band's row is portrait,
    // bio, this, hero, and only the bio flexes: at five cells spelled "vs BOS" the strip took
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
      {/* 0.72 white, the floor the band's wash is budgeted for. See BAND_WASH: these sit at
          roughly 55-80% across, where the wash is well short of its strongest point, so they
          clear the bar with more room than the hero's own labels do. */}
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
   *  Capped at two codes, and that is a measurement rather than taste: on a 375px phone the
   *  collapsed row has 46px of slack once the label, the stat line and the chevron are in, and
   *  "CF, P" needs 29 of it. The ellipsis carries the rest honestly.
   *
   *  That slack is gone on a two-way player, whose stat line carries a rate as well as three
   *  counts, so the row wraps. It is allowed to. What it is not allowed to do is break between
   *  a number and its label, which is what `nbsp` below is for: left alone the line read
   *  ".800 FPCT · 2 PO · 6 A · 2" over a second line holding the single letter "E", and a
   *  stray letter under a stat line reads as a rendering fault rather than as a wrap. */
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
      summary={[nbsp(fmtRate(ft.fpct), 'FPCT'), nbsp(ft.po, 'PO'), nbsp(ft.a, 'A'), nbsp(ft.e, 'E')].join('\u00a0· ')}
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
function GameLogTable({ title, statHeaders, rows, best, accent }: {
  title: string
  statHeaders: string[]
  rows: { date: string; opp: string; cells: (string | number)[]; onOpen?: () => void }[]
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
  if (rows.length === 0) return null
  return (
    <Box sx={{ mt: 2 }}>
      <Typography sx={sectionSx}>{title}</Typography>
      {/* Capped and self-scrolling in the desktop two-column layout, with the header pinned.
          This is the one block on the page that grows on its own: a row a game, ten today and
          about forty by Sep 6, which is ~1200px against a left rail that stays ~340 whatever
          happens. Uncapped it would re-open the same empty-column hole the two columns were
          meant to close, just on the other side. Below `lg` there is only one column and the
          pane already scrolls, so a scroller inside a scroller would buy nothing and cost a
          touch gesture. */}
      <Box sx={{ overflowX: 'auto', maxHeight: { md: chromePx(LOG_MAX_H) }, overflowY: { md: 'auto' } }}>
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
            {rows.map((r, i) => (
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
                sx={r.onOpen ? {
                  cursor: 'pointer',
                  ...TAPPABLE,
                  // Inset, because an outline drawn outside a table row is clipped by the
                  // log's own scroller on the two rows that matter most, the first and last.
                  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-2px' },
                } : undefined}
              >
                <Box component="td" sx={{ ...tdSx, textAlign: 'left', color: 'text.disabled' }}>{r.date}</Box>
                <Box component="td" sx={{ ...tdSx, textAlign: 'left', fontWeight: 700 }}>{r.opp}</Box>
                {r.cells.map((c, j) => {
                  // The accent, which is safe here in a way it was not on the percentile ranks:
                  // every column that can be marked is one where more is better, so the club's
                  // colour can only ever be attached to good news.
                  const top = marks.get(j) != null && Number(c) === marks.get(j)
                  return (
                    <Box component="td" key={j} sx={top ? { ...tdSx, fontWeight: 800, color: accent } : tdSx}>{c}</Box>
                  )
                })}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

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
  const { basis: eraBasis, fmtEra } = useEraBasis()
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
  const battingMeta = `${bt.g} G · ${bt.ab} AB`
    + (ranks?.batReason === 'below-bar' && paGap > 0 ? ` · ${paGap} PA from qualifying`
      : bt.ab < BAT_SMALL_AB ? ' · small sample' : '')
  const pitchingMeta = `${pt.g} G · ${outsToIp(pt.outs)} IP`
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
  const heroBlock = (r: Role, onDark: boolean) => r === 'pitching' ? (
    // ERA leads and WHIP follows, on the same reasoning as OPS over AVG: ERA is the number
    // anyone asks for and WHIP is the one that says whether it is real.
    <>
      <HeroStat value={fmtEra(pt.era)} label="ERA" primary onDark={onDark}
        rank={ranks?.pitching.find(x => x.key === 'era')} />
      <HeroStat value={fmtTwo(pt.whip)} label="WHIP" onDark={onDark}
        rank={ranks?.pitching.find(x => x.key === 'whip')} />
      <SampleLine onDark={onDark} text={`${pitchingMeta} · ${pt.w}-${pt.l}${pt.s > 0 ? ` · ${pt.s} SV` : ''}`} />
    </>
  ) : (
    // OPS leads and AVG follows. OBP and SLG are still one tap down in the strip and still in
    // the grid; they do not need hero weight when the number above them is their sum. And no
    // "4-for-26": that is H and AB, both already on this line and in the grid below.
    <>
      <HeroStat value={fmtRate(bt.ops)} label="OPS" primary onDark={onDark}
        rank={ranks?.batting.find(x => x.key === 'ops')} />
      <HeroStat value={fmtRate(bt.avg)} label="AVG" onDark={onDark}
        rank={ranks?.batting.find(x => x.key === 'avg')} />
      <SampleLine onDark={onDark} text={battingMeta} />
    </>
  )

  /** The pane's own copy of the hero, which stands down at `lg` where the band is showing it.
   *
   *  Width-capped, and that is the whole point of the wrapper. The rank is right-aligned with
   *  `ml: auto`, which is right in the band's 216px box and wrong the moment the hero has a
   *  whole pane to spread across: on a 412px phone it put 189px of nothing between "OPS" and
   *  "1st of 33", so the two read as unrelated things at opposite ends of the sheet rather than
   *  as one fact about her. Capped, they stay a group, and the two rows still align on the
   *  right edge because the cap is shared. Same width as the band's copy, deliberately.
   *
   *  CENTRED, because capping it alone only moved the problem. A 216px group left-aligned in a
   *  378px pane leaves all 162px of the slack on one side, under a stat grid and a percentile
   *  strip that both run the full width, so the headline reads as shunted into the corner of a
   *  block it is supposed to be the top of. Centred it has an axis: the slack is 81px a side,
   *  and the grid's own columns below are symmetric about the same line. The band's copy is NOT
   *  centred and should not be: there it is one half of a two-part row, and its axis is the
   *  right edge it shares with the card. */
  const paneHero = (r: Role) => (
    <Box sx={{ mb: 1.75, maxWidth: chromePx(HERO_BLOCK_W), mx: 'auto', display: { xs: 'block', md: 'none' } }}>{heroBlock(r, false)}</Box>
  )

  // Each pane in two halves, because a desktop dialog puts them side by side: `season` is what
  // is true about her year, `log` is the record of the games it came out of. On anything
  // narrower they simply stack in this order and nothing about the reading changes.
  const battingPane = {
    hasLog: battingReal.length > 0,
    season: (
      <>
        {paneHero('batting')}
        {/* G and AB are on the sample line above, so they are not repeated here. */}
        {/* CS beside SB (a steal total alone cannot say whether the running worked), and the
            four trips AB does not count. All five are on the feed's line and none of them was
            shown here. The two sacrifices and GDP appear only once they have happened: a
            column of zeroes on a player who has never bunted is noise, and this grid is read
            on a phone. */}
        {/* One line of English before the evidence. See derive/playerSummary.ts: it says the
            things the tiles cannot, which are the RELATIONSHIPS between them, and it says
            nothing at all when the sample cannot carry a sentence. */}
        <SummaryLine text={wpblBattingSummary(bt)} />
        {/* THE SAME RULE THE SACRIFICES AND GDP ALREADY FOLLOWED, applied to the rest of the
            rare events. A tile reading 0 costs exactly as much room and attention as one
            reading 17, and this grid is read on a phone: Andréanne Leblanc's showed 3B 0,
            SB 0 and CS 0 at full strength beside H 17, five of thirteen tiles at nothing.
            Triples and hit-by-pitches appear once they have happened. Steals are a PAIR,
            because a steal total alone cannot say whether the running worked, so either both
            show or neither does. Doubles stay unconditional: they are common enough that a
            zero is a fact about the season rather than an absence of one. */}
        <StatGrid items={[['R', bt.r], ['H', bt.h], ['2B', bt.doubles],
          ...(bt.triples ? [['3B', bt.triples] as [string, number]] : []),
          ['HR', bt.hr], ['RBI', bt.rbi], ['BB', bt.bb], ['SO', bt.so],
          ...(bt.sb || bt.cs ? [['SB', bt.sb] as [string, number], ['CS', bt.cs] as [string, number]] : []),
          ['TB', bt.tb],
          ...(bt.hbp ? [['HBP', bt.hbp] as [string, number]] : []),
          ...(bt.gdp ? [['GDP', bt.gdp] as [string, number]] : []),
          ...(bt.sf ? [['SF', bt.sf] as [string, number]] : []),
          ...(bt.sh ? [['SH', bt.sh] as [string, number]] : [])]} />
        {pitchingCameo && (
          <CameoBlock label="Also pitched" color={color}
            text={`${fmtEra(pt.era)} ERA over ${outsToIp(pt.outs)} IP, ${pt.so} K`} />
        )}
        {/* THE COMPARISON FIRST, then the meter explaining why it is thin. That order is the
            change of mind: a league position is a fact about her season and the meter is an
            administrative note about the leaderboards, and for a while the note came first. */}
        {ranks && (ranks.batReason === 'ok'
          ? <PercentileStrip ranks={ranks.batting} counts={bestCountingRanks(ranks.battingCounts, ranks.batting)}
              of={ranks.batOf} color={color} noun="batters" role="batting" />
          : <>
              <CountingStrip ranks={ranks.battingCounts} of={ranks.batCountOf} color={color} noun="batters" />
              <RankProgress reason={ranks.batReason} have={plateAppearances(bt)} need={ranks.qualifiers.minPa}
                unit="PA" fmt={String} noun="batters" color={color} />
            </>)}
      </>
    ),
    log: (
      <GameLogTable
        title="Game log"
        statHeaders={['POS', 'AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'BB', 'SO', 'SB', 'TB']}
        best={BATTING_BEST}
        accent={color}
        rows={newestFirst(battingReal).map(l => ({ ...logRow(l.game_id, l.team_id), cells: [gamePosition(l.position), l.ab, l.r, l.h, l.doubles, l.triples, l.hr, l.rbi, l.bb, l.so, l.sb, l.tb] }))}
      />
    ),
  }

  const pitchingPane = {
    hasLog: pitching.length > 0 || pitchLocs.length > 0,
    season: (
      <>
        {paneHero('pitching')}
        {/* G and IP are on the sample line above. */}
        <SummaryLine text={wpblPitchingSummary(pt)} />
        {/* BF and P say how much work the year was, which nothing on this card could say
            before: it could tell you what she gave up and not how many batters she faced.
            GS separates a starter from a reliever. HBP, WP and BK show up only when they
            have happened, like the batting card's sacrifices. */}
        <StatGrid items={[['H', pt.h], ['R', pt.r], ['ER', pt.er], ['BB', pt.bb], ['SO', pt.so], ['HR', pt.hr], ['BF', pt.bf], ['P', pt.pitches], ['GS', pt.gs],
          ...(pt.hbp ? [['HBP', pt.hbp] as [string, number]] : []),
          ...(pt.wp ? [['WP', pt.wp] as [string, number]] : []),
          ...(pt.bk ? [['BK', pt.bk] as [string, number]] : [])]} />
        {battingCameo && (
          <CameoBlock label="Also batted" color={color}
            text={`${fmtRate(bt.avg)}/${fmtRate(bt.obp)}/${fmtRate(bt.slg)}, ${bt.h}-for-${bt.ab}${bt.hr ? `, ${bt.hr} HR` : ''}`} />
        )}
        {ranks && (ranks.pitReason === 'ok'
          ? <PercentileStrip ranks={ranks.pitching} counts={bestCountingRanks(ranks.pitchingCounts, ranks.pitching)}
              of={ranks.pitOf} color={color} noun="pitchers" role="pitching" />
          : <>
              <CountingStrip ranks={ranks.pitchingCounts} of={ranks.pitCountOf} color={color} noun="pitchers" />
              <RankProgress reason={ranks.pitReason} have={pt.outs} need={ranks.qualifiers.minOuts}
                unit="IP" fmt={outsToIp} noun="pitchers" color={color} />
            </>)}
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
          statHeaders={['DEC', 'IP', 'H', 'R', 'ER', 'BB', 'SO', 'HR', 'P']}
          best={PITCHING_BEST}
          accent={color}
          rows={newestFirst(pitching).map(l => ({ ...logRow(l.game_id, l.team_id), cells: [l.decision ?? '—', outsToIp(l.outs), l.h, l.r, l.er, l.bb, l.so, l.hr, l.pitches ?? '—'] }))}
        />
        {pitchLocs.length > 0 && (
          <Box sx={{ mt: 2 }}><PitchLocationCard rows={pitchLocs} accent={color} gamesPitched={pt.g} /></Box>
        )}
      </>
    ),
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
  // TWO COLUMNS AT lg, and why not sooner (Aug 25, 2026). Every measurement behind this page
  // was taken on a 375px phone, and desktop was simply rendering that column with ~800px of
  // empty screen either side: 1143px of stacked content in a 640px box, of which a laptop
  // shows about a third at a time. Side by side the same content is ~600px tall and needs no
  // scrolling at all.
  //
  // `lg` rather than `md` because the WPBL section runs under a 1.4x `zoom` on desktop (see
  // DESKTOP_ZOOM in mlb/constants). A media query is answered in real viewport pixels, so
  // `md` means 900px of screen but only 643px of layout to spend inside the zoom, which is
  // narrower than the single column already is. `lg` is ~860px of layout, the first width
  // where two real columns beat one. Anything below it is untouched, phone included.
  //
  // Season facts left, the record of the games right. That is also the split that keeps the
  // growing half on its own: the game log gains a row a day until Sep 6, and the left rail
  // does not grow at all.
  const panels = roles.map(r => {
    const pane = r === 'pitching' ? pitchingPane : battingPane
    // No second column without something to put in it. Only reachable by a player with no
    // game log at all, which is a fielding-only cameo. The reading list is not a reason for
    // one: it spans both columns either way.
    const twoCol = pane.hasLog
    return (
      // `pt` answers to the role pills, because on a phone what sits under it is the hero:
      // 16px of pane padding below an 8px strip, plus the optical space a 2rem numeral
      // carries above its digits, put ~32px between the control and the numbers it controls.
      // That was the largest gap on the card, and it fell between the two things most
      // obviously part of each other. Above `md` the hero has moved up to the club band and
      // this padding separates the pills from a line of body text, where 16px is right.
      <Box key={r} sx={{ px: 2, pt: { xs: showTabs ? 1 : 2, md: 2 }, pb: 2 }}>
        <Box sx={{
          display: 'grid',
          // THE LOG TAKES WHAT IT NEEDS AND THE RAIL TAKES THE REST, which is what `LEFT_RAIL`
          // was always trying to express and could not, being a constant. Its own note says
          // the 320 was "set by what is left for the game log beside it": the widest log is
          // the hitting line, and 320 was the number that left it enough. That is a batting
          // measurement, and it is applied to both panes.
          //
          // Measured on Sep 2, 2026, a batting log wants 561px and got 579, which is the fit
          // the constant was chosen for. A PITCHING log wants 454 and got the same 579, so
          // 125px went into stretching an eleven-column numeric table whose widest column is
          // 93px, while the rail beside it ran 484px tall against the log column's 303. The
          // void is structural rather than particular to one card: a pitching game log has a
          // median of 4 rows against a batting log's 9, and 35 of the league's 38 pitchers
          // have six rows or fewer. Every pitching card was inheriting a column sized for a
          // log that does not exist.
          //
          // `max-content` on the log track asks the table for its natural width, which is
          // exactly the question the constant was guessing the answer to. The rail keeps a
          // floor and takes everything above it, so a short log widens the rail instead of
          // padding a table. The floor matters: without it a narrow dialog would hand the
          // whole width to a wide batting log and leave the season facts in a gutter. Below
          // the floor the log track is the one that gives, and it already scrolls
          // horizontally for exactly this case.
          gridTemplateColumns: twoCol
            ? { xs: '1fr', md: `minmax(${chromePx(LEFT_RAIL)}, 1fr) minmax(0, max-content)` }
            : '1fr',
          columnGap: 2.5,
          alignItems: 'start',
          // A lone column stretched across a desktop dialog reads as a stat line pulled to fit
          // rather than as a column, so it keeps a measure of its own.
          ...(twoCol ? {} : { maxWidth: { md: chromePx(560) } }),
        }}>
          <Box sx={{ minWidth: 0 }}>
            {pane.season}
            {/* Fielding sits with the other season facts, which is where it belongs and where
                it can be seen: under the game log it was 1100px down the phone's scroll and
                below the fold on every desktop. */}
            {hasFielding && <FieldingLine ft={ft} color={color} positions={showTabs ? fieldedPositions : undefined} />}
          </Box>
          {/* The right rail's first block carries a top margin for the stacked layout, where it
              follows the season facts. Alongside them it has to start level with them instead. */}
          <Box sx={{ minWidth: 0, '& > :first-of-type': { mt: { md: 0 } } }}>
            {pane.log}
          </Box>
          {/* The reading list runs UNDER both columns rather than inside one of them. It is the
              one block here that is neither a season fact nor a game, its length is set by how
              often someone happened to write about her, and in the right rail a well-covered
              player put 346px of article cards against a 337px left rail: the columns ended
              360px apart, which is most of a screen of empty page beside the fielding line.
              Full width it is also two cards across instead of five very wide ones.

              Rendered even for a player with no line yet (see the no-stats branch below):
              someone who has been written about but has not logged a game is exactly the case
              where this is the most interesting thing on the page. Renders nothing when nobody
              has written about her, which is most of the roster. */}
          <Box sx={{ minWidth: 0, gridColumn: { md: '1 / -1' } }}>
            <WrittenAbout articles={writtenAbout} title={`Written about ${player.name}`} wide />
          </Box>
        </Box>
      </Box>
    )
  })

  return (
    <ModalShell
      eyebrow={team ? wpblFullName(team) : 'Player'}
      onClose={onClose}
      // Wide enough at `md` for the two-column pane below, and unchanged everywhere else. It
      // is a fixed pair rather than a value derived from the content so the dialog cannot
      // resize under the reader as the season totals land. Through `chromePx` because the
      // pair was chosen while the section ran a 1.4 `zoom`: spent raw it is the same number
      // against 40% larger type, which is what wrapped this player's name onto two lines.
      maxWidth={{ xs: chromePx(640), md: chromePx(840) }}
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
          {/* The headline numbers, on the band, at the width where the band has room for them.
              This gradient used to run most of the way across to nothing: a club colour with a
              portrait at one end and empty space at the other, while the two numbers a reader
              opened the page for sat below it in the scroller. They belong on the card that
              names her, and moving them takes ~80px off the top of the pane besides.

              Below `lg` the band is only wide enough for the name, so they stay in the pane
              (see `paneHero`) and this renders nothing. The role is the one on screen, so a
              two-way player's band follows her tab. */}
          {showBandHero && (
            <Box sx={{ display: { xs: 'none', md: 'block' }, width: chromePx(HERO_BLOCK_W), flexShrink: 0 }}>
              {heroBlock(roles[roleIndex], true)}
            </Box>
          )}
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
          {showTabs && (
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
          <SwipeableViews
            mode="pane"
            index={roleIndex}
            onIndexChange={i => selectRole(roles[i], 'swipe')}
            panels={panels}
          />
        </>
      )}
      </Box>
    </ModalShell>
  )
}

// The left rail at `lg`. Set by what is left for the game log beside it, not by what the rail
// itself wants: the widest log is the hitting line, which measures ~440px once POS joins it,
// and 320 leaves it ~453. Any wider here and the table falls back to its horizontal scroll on
// a desktop dialog, which is the one place there is plainly room for it not to.
const LEFT_RAIL = 320   // spent through chromePx; see its note
/**
 * How much of each club's secondary the band's wash reaches at its far edge, 0-255.
 *
 * PER CLUB, because one number gave four different results. A single 40% looked right on New
 * York's pale sky blue and left Boston's orange looking like a rumour: the four secondaries have
 * nothing like the same luminance, so the same alpha over four different near-black primaries is
 * four different amounts of visible colour.
 *
 * WHAT SETS EACH NUMBER. White text has to clear 4.5:1 against the strongest point of the wash,
 * and the binding case is always the smallest text sitting in it: the hometown and draft lines
 * at 0.75, and on desktop the band hero's stat label at 0.80 and its sample line at 0.76. Each
 * value below is the largest that clears that with a step of headroom, and they measure:
 *
 *   BOS 0x7a (48%) 4.80:1 · LA 0x98 (60%) 4.78:1 · NY 0x61 (38%) 4.84:1 · SF 0x8f (56%) 4.89:1
 *
 * The ceilings before headroom are 51 / 62 / 41 / 61 percent, so there is not much left in any of
 * them. LA was the outlier at 0x8f/5.12, a good half-step short of its own ceiling and so visibly
 * less gold than the other three clubs are their colour; 0x98 lands it on the same ~4.8 as BOS and
 * NY, which is what "a step of headroom" is worth here. It is now within three points of failing:
 * 0xa0 (63%) measures 4.50 and does not clear.
 *
 * Change a club's colours in constants.ts, or lift the wash, and these have to be re-solved
 * against those three text opacities, or the smallest lines on the card quietly stop being
 * readable on one club and nobody reports it.
 */
const BAND_WASH: Record<string, number> = { BOS: 0x7a, LA: 0x98, NY: 0x61, SF: 0x8f }
/** For a club not in the table: the tightest of the four, which is safe for any secondary. */
const BAND_WASH_FLOOR = 0x61

// The hero's own measure, wherever it is drawn: the 104px number column, its label, and a
// right-aligned "1st of 33", with about 27px between the label and the rank. One constant for
// the band and the pane both, because it is the same object at both sizes and the number that
// looks right in the band is the number that looks right in the pane. See paneHero for what
// goes wrong without it.
const HERO_BLOCK_W = 216
// About thirteen rows, which is a little over the tallest the left rail gets. See GameLogTable.
const LOG_MAX_H = 440

const sectionSx = { fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary', mb: 1 } as const

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
  fontSize: '0.56rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4,
  color: 'text.disabled', py: 0.6, px: { xs: 0.3, sm: 0.85 }, textAlign: 'center', whiteSpace: 'nowrap',
  position: 'sticky', top: 0, zIndex: 1, bgcolor: 'background.paper',
  boxShadow: (t: Theme) => `inset 0 -1px 0 ${t.palette.divider}`,
} as const
const tdSx = { fontSize: { xs: '0.74rem', sm: '0.8rem' }, fontWeight: 600, py: 0.55, px: { xs: 0.3, sm: 0.85 }, textAlign: 'center', borderTop: '1px solid', borderColor: 'divider', whiteSpace: 'nowrap' } as const

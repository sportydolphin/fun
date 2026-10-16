import { useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { sumFielding, fmtRate } from '../stats'
import { type SeasonScope } from '../season'
import { type WpblPlayerRanks } from '../percentiles'
import { useEraBasis } from '../EraBasisContext'
import type { EraBasis } from '../stats'
import { TapTip, chromePx, hoverOnly } from '../ui'
import { SectionHead } from '../cardParts'
import {
  CARD_TYPE as TYPE, isZeroStat, ZERO_SX, bleedSx,
  useCollapsibleTable, ExpandToggle, thSx, tdSx, LOG_MAX_H, LOG_MAX_H_XS, TIP_Z,
} from '../../ui/playerCard'
import { STAT_TERMS, statFull, statPlain } from '../glossary'
import { wpblCompareStartPath, wpblComparePath, WPBL_GLOSSARY_PAGE } from '../routes'
import { type WpblMatchupLine } from '../derive/matchups'
import { CompareArrows } from '@mui/icons-material'
import { HeaderChipLabel, HEADER_ICON_SX, headerChipSx } from '../../ui/headerBar'
import { linkTo } from '../../nav'
import { track, EVENTS } from '../../lib/analytics'
import type { WpblPlayer } from '../types'
import { typePx } from '../../ui/scale'
import { StatTip, CARD_SECTION_SX } from '../../ui/playerCard'
import { TYPE_SCALE } from '../../ui/card'

// The parts of WPBL's player card that hold no state of the card's own: the stat tooltip, the
// qualifying meter, the fielding line, the matchup table, the Compare chip and the band's colours.
// PlayerDetail.tsx composes them.

// The stat definitions live in glossary.ts, so every surface that draws an abbreviation (Home,
// StatsView, Game Center) can explain it, not just this page. `statTip` is the render half, kept
// here because glossary.ts is deliberately data-only so anything (a Pages Function, a Discord
// command, a test) can import it without pulling in MUI.
//
// Each definition ends in a link to /wpbl/glossary, as MLB's do to its own: the tooltip is where a
// reader meets the term, the page is where every term can be found, by a reader or a crawler.
const glossaryLink = linkTo(WPBL_GLOSSARY_PAGE)
export const statTip = (k: string, basis: EraBasis): React.ReactNode => {
  // An abbreviation the glossary does not define gets no link to a page that would not explain it.
  if (!STAT_TERMS[k]) return statFull(k, basis)
  return <StatTip full={statFull(k, basis)} plain={statPlain(k)} glossary={glossaryLink} />
}

/**
 * Where the player played THAT game, off the box-score line.
 *
 * Deliberately the raw line, not `displayPosition`: that answers "what position does this
 * player play", a season-long question decided by majority vote, and it is already answered
 * once in the band at the top. The game log is asking the opposite question, one row at a
 * time, and the interesting rows are exactly the ones the season-long answer overrules: the
 * catcher's three games at first, the day the left fielder finished the game on the mound.
 * Feeding it a smoothed answer would print the same code down all forty rows.
 *
 * The feed writes a slash when a player moved mid-game ("lf/p"), and that is kept whole rather
 * than truncated to the first token the way `positions.ts` does for VOTING: a vote has to count
 * one game once, but a reader looking at the row wants to know they pitched. Upper-cased because
 * the feed writes these lowercase and the rest of the page writes positions in caps.
 */
export const gamePosition = (raw: string | null | undefined): string => {
  const t = String(raw ?? '').trim()
  return t ? t.toUpperCase() : '—'
}

// A batting line only counts as real batting if the player actually came to the plate (an
// at-bat, a walk, a HBP, or a sacrifice). Zero-PA rows (a pinch-runner who scored, a defensive
// sub, a pitcher listed but never up) otherwise surface as an all-zero stat block and a phantom
// "0-for-0" game-log line, so they are dropped. `hasPlateAppearance` lives in stats.ts, shared
// with the compare card so the two cannot disagree about who batted.

export type Role = 'batting' | 'pitching'

// ─── pieces ──────────────────────────────────────────────────────────────────
// The season line, the rate strip, the game log, the form strip and the band are shared with
// MLB's player page (src/ui/playerCard.tsx). What is WPBL's own is below.

/**
 * What stands where the percentile strip would be, for a player who is not ranked yet.
 *
 * NOT A ONE-LINE REFUSAL. The strip vanishes for exactly the players a reader can least place on
 * their own, so a sentence like "Below the qualifying bar" would make the card visibly emptier
 * the less the reader already knows. A refusal that shows its own arithmetic is not a refusal.
 *
 * The bar here is the same 6px in the same four-column geometry as `PercentileStrip` (label,
 * value, bar, right-hand figure) deliberately: the two states are the same object at two points
 * in a season, so the block does not move or change shape on the day a player qualifies. It is
 * progress toward the bar, NOT a percentile, which is why the right-hand figure is the threshold
 * rather than a rank.
 *
 * 'season-young' keeps the sentence. There is no bar to draw against a threshold the season has
 * not set yet, and a meter reading "0 of 0" would be worse than the words.
 */
export function RankProgress({ reason, have, need, unit, fmt, noun, color }: {
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
    return <Typography sx={{ fontSize: TYPE_SCALE.micro, color: 'text.disabled', mt: 1.75 }}>League ranks appear once the season is a few games old.</Typography>
  }
  if (need <= 0) return null
  const pct = Math.max(0, Math.min(1, have / need))
  return (
    <Box sx={{ mt: 1.75 }}>
      {/* "Toward qualifying", not "Toward league ranks": `CountingStrip` sits directly underneath
          with a heading about ranks, over bars drawn in the same geometry whose right-hand column
          means the opposite thing, a THRESHOLD here (the bar the player is walking toward) and a
          RANK there (a place held). The geometry is shared on purpose and stays shared, so the
          headings are what carry the difference. */}
      <Typography sx={sectionSx}>Toward qualifying</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ width: '2.375rem', flexShrink: 0, fontSize: TYPE_SCALE.caption, fontWeight: 800, textTransform: 'uppercase', letterSpacing: typePx(0.4), color: 'text.disabled' }}>
          {unit}
        </Typography>
        <Typography sx={{ width: '2.75rem', flexShrink: 0, fontSize: TYPE_SCALE.body, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {fmt(have)}
        </Typography>
        <Box sx={{ flex: 1, minWidth: 0, height: 6, borderRadius: 999, bgcolor: 'action.hover', overflow: 'hidden' }}>
          <Box sx={{ width: `${Math.round(pct * 100)}%`, height: '100%', bgcolor: color, borderRadius: 999 }} />
        </Box>
        <Typography sx={{ width: '2.125rem', flexShrink: 0, textAlign: 'right', fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.disabled', fontVariantNumeric: 'tabular-nums' }}>
          {fmt(need)}
        </Typography>
      </Box>
      {/* Says what the bar is FOR, in the same slot where the strip prints its population. */}
      <Typography sx={{ fontSize: TYPE_SCALE.micro, color: 'text.disabled', mt: 0.6 }}>
        {fmt(Math.max(0, need - have))} more {unit} to rank against qualified {noun}.
      </Typography>
    </Box>
  )
}

/** A figure bound to its label, so a stat line that has to wrap can only break at a
 *  separator, and after it rather than before it: the space in front of a middot is a break
 *  opportunity too, and taking it leaves the next line beginning with a lone "·". Joined with
 *  `'\u00a0· '` for that reason. See the note on `positions` below for the letter this
 *  stopped orphaning. */
const nbsp = (value: string | number, label: string): string => `${value}\u00a0${label}`

/**
 * Fielding as a heading over one line of figures, at the foot of the card.
 *
 * Over nine games a fielding percentage is almost entirely noise, and setting it as large as a
 * batting average would tell a reader it means as much as the slash line. So it is small, and it
 * is LAST among the stats: the least reliable number on the card comes after everything else.
 *
 * ONE FORMAT FOR EVERYONE. It used to be two: a bordered panel with a club-coloured rule that
 * opened onto a grid of stat chips for a position player, and a bare inline line for a pitcher.
 * Both are now this, a section heading and a wrapping line, which is short enough to show whole:
 * the panel existed to hide PO, A and DP, and hiding four small figures cost a third frame style
 * on a card that already had too many. The line breaks only at a separator (see `nbsp`).
 */
export function FieldingLine({ ft, positions }: {
  ft: ReturnType<typeof sumFielding>
  /** Where these numbers came from, most-played first, or empty to say nothing.
   *
   *  ONLY PASSED ON A CARD WITH ROLE TABS, which is the only place the block can be misread.
   *  A fielding row carries no position (see `positionsPlayed`), so a two-way player's totals
   *  are their mound work and their outfield work added together, and the pitching pane would
   *  present that sum as fielding AS A PITCHER: a pile of outfield putouts beside an ERA. On a
   *  card with one role there is no tab implying a scope, so the codes would be decoration. */
  positions?: string[]
}) {
  const parts = [
    nbsp(fmtRate(ft.fpct), 'FPCT'),
    nbsp(ft.e, ft.e === 1 ? 'error' : 'errors'),
    nbsp(ft.po, 'PO'),
    nbsp(ft.a, 'A'),
    ...(ft.dp ? [nbsp(ft.dp, 'DP')] : []),
    ...(ft.pb ? [nbsp(ft.pb, 'PB')] : []),
    ...(ft.sba ? [nbsp(ft.sba, 'SBA')] : []),
  ]
  return (
    <Box sx={{ mt: 2 }}>
      <SectionHead title="Fielding" part="fielding" caption={positions && positions.length > 0 ? positions.join(', ').toUpperCase() : undefined} />
      <Typography sx={{ ...TYPE.body, color: 'text.secondary', mt: -0.5, fontVariantNumeric: 'tabular-nums' }}>
        {parts.join('\u00a0· ')}
      </Typography>
    </Box>
  )
}

/**
 * Her line against each opponent she has faced from one side of the plate: pitchers when she
 * bats, batters when she pitches. What four clubs make possible and a thirty-club league does
 * not, since the same hitter sees the same pitcher across a whole season.
 *
 * DRAWN AS THE GAME LOG IS, in its own header, cell and zebra styles, because it sits directly
 * above it and two tables of the same figures in two dialects read as two sites.
 *
 * MOST-FACED FIRST, never best average first (see `playerMatchups`). The samples are small, the
 * largest pair in the 2026 regular season met ten times, so PA is the first column: it is the
 * number that says how much any other number in the row can be trusted. No edge badge for the
 * same reason; "owns" over three at-bats is a claim, and the counts say what happened.
 *
 * THE NAME IS A REAL LINK to the pair's comparison page, which already draws this duel in full
 * beside both players' seasons. An anchor rather than a clickable row because the destination
 * is a real path, unlike a game in the log (see the note on those rows).
 */
export function MatchupTable({ player, side, lines, players, scope, accent }: {
  player: WpblPlayer
  side: Role
  lines: WpblMatchupLine[]
  players: WpblPlayer[]
  scope: SeasonScope
  accent: string
}) {
  const { basis: eraBasis } = useEraBasis()
  const { expanded, toggle, sectionRef, scrollerRef } = useCollapsibleTable()
  const byId = useMemo(() => new Map(players.map(p => [p.id, p])), [players])
  if (lines.length === 0) return null
  const shown = expanded ? lines : lines.slice(0, MATCHUP_PREVIEW)
  const hidden = lines.length - Math.min(lines.length, MATCHUP_PREVIEW)
  const noun = side === 'batting' ? 'pitcher' : 'batter'
  const heads = ['PA', 'AB', 'H', 'HR', 'BB', 'SO', 'AVG']
  // WHICH SLICE, AND THAT THE NAMES GO SOMEWHERE. The heading reads the same in every scope, and
  // on a phone there is no hover to reveal a link, so both are said here, in the slot and type the
  // pitch profile uses for its own coverage line directly above.
  const slice = scope === 'postseason' ? ' in the playoffs' : scope === 'all' ? ', playoffs included' : ''
  return (
    <Box ref={sectionRef} sx={{ mt: 2 }}>
      <SectionHead
        title={side === 'batting' ? 'Vs pitchers' : 'Vs batters'} part="matchups"
        caption={`${lines.length} ${lines.length === 1 ? noun : `${noun}s`}${slice} · tap a name for the matchup`}
      />
      {/* Capped once expanded, with the header pinned, for the reason written on the game log:
          past the fifth row of a 36-row list the columns are otherwise unlabelled, and PA and SO
          read the same. Same caps as the log, so the two stacked tables behave as one kind. */}
      <Box ref={scrollerRef} sx={{
        ...bleedSx(0.85),
        overflowX: 'auto',
        maxHeight: { xs: expanded ? LOG_MAX_H_XS : 'none', md: chromePx(LOG_MAX_H) },
        overflowY: 'auto',
      }}>
        <Box component="table" sx={{ width: '100%', minWidth: 'max-content', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
          <Box component="thead">
            <Box component="tr">
              <Box component="th" sx={{ ...thSx, textAlign: 'left' }}>{side === 'batting' ? 'Pitcher' : 'Batter'}</Box>
              {heads.map(h => (
                <TapTip key={h} title={statTip(h, eraBasis)} component="th" popperZIndex={TIP_Z} sx={thSx}>{h}</TapTip>
              ))}
            </Box>
          </Box>
          <Box component="tbody">
            {shown.map((l, i) => {
              const oppId = side === 'batting' ? l.pitcherId : l.batterId
              const oppName = side === 'batting' ? l.pitcherName : l.batterName
              const opp = byId.get(oppId)
              const cells: (string | number)[] = [l.pa, l.ab, l.h, l.hr, l.bb, l.so, l.avg == null ? '—' : fmtRate(l.avg)]
              return (
                <Box component="tr" key={oppId} sx={i % 2 === 1 ? { bgcolor: 'action.hover' } : undefined}>
                  <Box component="td" sx={{ ...tdSx, textAlign: 'left', fontWeight: 700 }}>
                    {opp ? (
                      <Box
                        component="a"
                        {...linkTo(wpblComparePath(player, opp, players))}
                        onClickCapture={() => track(EVENTS.WPBL_COMPARE_OPENED, { from: 'matchups', playerId: player.id })}
                        title={`Compare ${player.name} with ${opp.name}`}
                        sx={{
                          color: 'inherit', textDecoration: 'none', cursor: 'pointer',
                          ...hoverOnly({ color: accent, textDecoration: 'underline' }),
                          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
                        }}
                      >
                        {opp.name}
                      </Box>
                    ) : oppName}
                  </Box>
                  {cells.map((c, j) => (
                    <Box component="td" key={j} sx={isZeroStat(c) ? { ...tdSx, ...ZERO_SX } : tdSx}>{c}</Box>
                  ))}
                </Box>
              )
            })}
          </Box>
        </Box>
      </Box>
      <ExpandToggle expanded={expanded} hidden={hidden} noun={[noun, `${noun}s`]} onToggle={toggle} accent={accent} />
    </Box>
  )
}

/** How many opponents the matchup table opens on. The log's five, so the two tables stacked
 *  one above the other open to the same height. */
const MATCHUP_PREVIEW = 5

/** "Aug 21" for a game date. One formatter for the module: `toLocaleDateString` builds a new one
 *  per call, and at one per game-log row it was 40ms of every render on a mid-range phone. */
const SHORT_DATE = new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' })
const shortDateCache = new Map<string, string>()
export function shortDate(gameDate: string): string {
  let s = shortDateCache.get(gameDate)
  if (s == null) { s = SHORT_DATE.format(new Date(`${gameDate}T00:00:00`)); shortDateCache.set(gameDate, s) }
  return s
}

/**
 * "Compare" in the modal's header bar, beside Copy link.
 *
 * A REAL ANCHOR THROUGH `linkTo`, not an onClick, for the reason CLAUDE.md gives and this
 * section has paid for once already: a crawler does not fire click handlers, and this is the
 * only internal link that will ever point at /wpbl/compare from inside the section. Those
 * pages are deliberately absent from the sitemap (see WPBL_COMPARE_BASE), so being linked is
 * the whole of how they are found.
 *
 * It lands on the PICKER with this player filled in rather than on a comparison, because
 * there is no second player to guess at and guessing one would be a page about two people
 * chosen by a heuristic.
 *
 * Drawn as every header control is (see headerBar): they are chips in one bar and there is no
 * reason for a reader to have to tell them apart by shape.
 */
export function CompareChip({ player, roster }: { player: WpblPlayer; roster: WpblPlayer[] }) {
  // No honest slug before the roster lands, and a bare-name slug minted from one row can name
  // the wrong player outright (routes.ts). The chip simply waits; it is chrome, not content.
  if (roster.length === 0) return null
  const to = wpblCompareStartPath(player, roster)
  return (
    <Box
      {...linkTo(to)}
      onClickCapture={() => track(EVENTS.WPBL_COMPARE_OPENED, { from: 'player', playerId: player.id })}
      title={`Compare ${player.name} with somebody`}
      aria-label={`Compare ${player.name} with another player`}
      sx={headerChipSx}
    >
      <HeaderChipLabel icon={<CompareArrows aria-hidden sx={HEADER_ICON_SX} />}>Compare</HeaderChipLabel>
    </Box>
  )
}

/**
 * How much of each club's secondary the band's wash reaches at its far edge, 0-255.
 *
 * PER CLUB, because one number gives four different results: the four secondaries have nothing
 * like the same luminance, so the same alpha over four different near-black primaries is four
 * different amounts of visible colour (a single 40% looks right on New York's pale sky blue and
 * leaves Boston's orange barely there).
 *
 * WHAT SETS EACH NUMBER. White text has to clear 4.5:1 against the strongest point of the wash,
 * and the binding case is always the smallest, dimmest text sitting in it. Each value below is
 * the largest that clears that with a step of headroom. Against the hometown and draft lines at
 * 0.75 they measure:
 *
 *   BOS 0x7a (48%) 4.80:1 · LA 0x98 (60%) 4.78:1 · NY 0x61 (38%) 4.84:1 · SF 0x8f (56%) 4.89:1
 *
 * THE FORM STRIP IS THE BINDING CASE: it sits at the strong end of the band, 74% to 96% along,
 * and its label is the dimmest thing on the band at 0.72. There it clears 4.72 / 4.77 / 4.74 /
 * 4.77 on BOS / LA / NY / SF, so all four values hold with very little to spare: anything dimmer
 * than 0.72 at that end of the band fails.
 *
 * The ceilings before headroom are 51 / 62 / 41 / 61 percent, so there is not much left in any
 * of them. LA sits within three points of failing: 0xa0 (63%) measures 4.50 and does not clear.
 *
 * Change a club's colours in constants.ts, lift the wash, or move a block along the band, and
 * these have to be re-solved against every text opacity sitting in it, or the smallest lines on
 * the card quietly stop being readable on one club and nobody reports it.
 */
export const BAND_WASH: Record<string, number> = { BOS: 0x7a, LA: 0x98, NY: 0x61, SF: 0x8f }
/** For a club not in the table: the tightest of the four, which is safe for any secondary. */
export const BAND_WASH_FLOOR = 0x61

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
export const SENTENCE_W = 560

const sectionSx = CARD_SECTION_SX

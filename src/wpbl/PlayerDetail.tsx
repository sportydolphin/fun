import { startTransition, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Box, Typography, Skeleton, useMediaQuery } from '@mui/material'
import { fetchWpblPlayerLines, fetchWpblPitcherLocations, getSeedWpblPlayerLines, getCachedWpblPitcherLocations, fetchWpblArticles, getCachedWpblArticles, fetchWpblAllLines, getCachedWpblAllLines, fetchWpblPlayerMatchupPlays, getCachedWpblPlayerMatchupPlays, type WpblPitchLoc } from './api'
import { sumBatting, sumPitching, sumFielding, plateAppearances, hasPlateAppearance, fmtRate, fmtTwo } from './stats'
import { scopedLines, inSeason, seasonsPlayed, latestSeason, gamesInSeason, type SeasonScope } from './season'
import { computeWpblPlayerRanks, COUNT_RANK_BAR, COUNT_RANK_MIN_FIELD, type WpblStatRank, type WpblPlayerRanks } from './percentiles'
import { useEraBasis } from './EraBasisContext'
import type { EraBasis } from './stats'
import { wpblAccent, wpblColor, wpblSecondary, wpblFullName, outsToIp } from './constants'
import { ModalShell, AfterShellEnters, PlayerPortrait, CopyLinkButton, TapTip, SegNav, useWpblDark, chromePx, hoverOnly, CARD_BORDER } from './ui'
import { ExpandButton } from '../ui/ExpandButton'
import { DetailPageBar } from './DetailPageBar'
import { WpblVisuallyHiddenH1 } from './PageHeading'
import { PLAYER_PAGE_W } from './layoutWidths'
import { SectionHead, useRankInk } from './cardParts'
import {
  CARD_TYPE as TYPE, StatCardContext, SeasonPicker, LineCaption, SeasonLine, RateStrip, FormStrip, CameoBlock, StatLogTable,
  PlayerBand, BandBadge, BandChips, BAND_CHIP_SX, BATTING_BEST, PITCHING_BEST, isZeroStat, ZERO_SX, bleedSx,
  useCollapsibleTable, ExpandToggle, thSx, tdSx, LOG_MAX_H, LOG_MAX_H_XS, LOG_PREVIEW, TIP_Z, type StatCardEnv,
} from '../ui/playerCard'
import { statFull, statPlain } from './glossary'
import SwipeableViews from './SwipeableViews'
import { WrittenAbout } from './Reading'
import { aboutPlayerFirst } from './derive/articles'
import { FanPhotoPlayerStrip } from './FanPhotoViews'
import { PlayerClips } from './Watch'
import { PitchLocationCard } from './PitchLocation'
import SprayChart from './SprayChart'
import PitchProfileBlock from './PitchProfile'
import { fetchWpblBattedBalls, getCachedWpblBattedBalls } from './api'
import type { WpblSprayPlay } from './types'
import { displayPosition, positionsPlayed, leadsWithPitching } from './positions'
import { wpblPlayerShortPath, wpblCompareStartPath, wpblComparePath, WPBL_AWARDS_PATH } from './routes'
import { playerMatchups, playerPlayIds, type WpblMatchupLine } from './derive/matchups'
import { fetchWpblAwardResults, getCachedWpblAwardResults, fanAwardsWon } from './awardVotes'
import type { WpblAward } from './awards'
import { EmojiEvents, CompareArrows } from '@mui/icons-material'
import { HeaderChipLabel, HEADER_ICON_SX, headerChipSx } from '../ui/headerBar'
import { useTheme as useMuiTheme } from '@mui/material/styles'
import { linkTo } from '../nav'
import { track, EVENTS } from '../lib/analytics'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine, WpblFieldingLine, WpblArticle } from './types'


// Player page: profile, season totals aggregated from box-score lines, where those totals sit
// against the league, and a per-game log. Public read; opened from a roster row, a leaderboard,
// the header search, a Home chip, a Discord link or a shared URL.
//
// TABS ON A PHONE. Every stat block stacked down one scroll runs to about twice the sheet's
// height, gives a two-way player two of everything (two headline blocks, two game logs, two sets
// of table chrome for the same games), and draws noise like fielding percentage over nine games
// as tall as a .400 average. So the roles are a segmented control and only the active one is
// mounted, the same shape Game Center uses for its boards. The control appears ONLY when a
// player has more than one real role; most of the roster is a hitter or a pitcher and sees
// their own numbers with no chrome around them.
//
// ONE WIDE COLUMN FROM md UP. A desktop dialog is not short of height, so the tabs come off and
// every role is drawn as full-width blocks (see desktopRoleBlock); the phone layout is untouched.

// The stat definitions live in glossary.ts, so every surface that draws an abbreviation (Home,
// StatsView, Game Center) can explain it, not just this page. `statTip` is the render half, kept
// here because glossary.ts is deliberately data-only so anything (a Pages Function, a Discord
// command, a test) can import it without pulling in MUI.
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
const gamePosition = (raw: string | null | undefined): string => {
  const t = String(raw ?? '').trim()
  return t ? t.toUpperCase() : '—'
}

// A batting line only counts as real batting if the player actually came to the plate (an
// at-bat, a walk, a HBP, or a sacrifice). Zero-PA rows (a pinch-runner who scored, a defensive
// sub, a pitcher listed but never up) otherwise surface as an all-zero stat block and a phantom
// "0-for-0" game-log line, so they are dropped. `hasPlateAppearance` lives in stats.ts, shared
// with the compare card so the two cannot disagree about who batted.

type Role = 'batting' | 'pitching'

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
      {/* "Toward qualifying", not "Toward league ranks": `CountingStrip` sits directly underneath
          with a heading about ranks, over bars drawn in the same geometry whose right-hand column
          means the opposite thing, a THRESHOLD here (the bar the player is walking toward) and a
          RANK there (a place held). The geometry is shared on purpose and stays shared, so the
          headings are what carry the difference. */}
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
function FieldingLine({ ft, positions }: {
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
      <SectionHead title="Fielding" caption={positions && positions.length > 0 ? positions.join(', ').toUpperCase() : undefined} />
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
function MatchupTable({ player, side, lines, players, scope, accent }: {
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
        title={side === 'batting' ? 'Vs pitchers' : 'Vs batters'}
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

/**
 * Apply a read that resolved after the card mounted.
 *
 * A TRANSITION, because these land while the sheet is still rising. Each one re-renders the whole
 * card, about 115ms on a mid-range phone, and an ordinary update does that in one block that the
 * sheet's slide and the backdrop's fade have to wait out. A transition lets React do it in slices
 * between frames. Together with handing back the previous value when nothing changed (most of
 * these are cache hits returning what the card was seeded with), it keeps the slide smooth.
 */
const lateUpdate = startTransition

function sameIds(a: { id: string }[], b: { id: string }[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i].id)
}

/** Same rows, field for field, for a re-read of rows the card already holds. Shallow: every field
 *  on a line is a scalar. */
function sameRows<T extends object>(a: T[], b: T[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((x, i) => {
    const y = b[i] as Record<string, unknown>
    const xr = x as Record<string, unknown>
    const keys = Object.keys(xr)
    return keys.length === Object.keys(y).length && keys.every(k => xr[k] === y[k])
  })
}

/** "Aug 21" for a game date. One formatter for the module: `toLocaleDateString` builds a new one
 *  per call, and at one per game-log row it was 40ms of every render on a mid-range phone. */
/**
 * Which phone panes' bands have scrolled out of view, held OUTSIDE the card's state.
 *
 * The header swaps the club for the player's name once the band scrolls away, and that swap
 * happens mid-scroll, by definition. Kept as card state it re-rendered the whole card at that
 * moment: about 150ms of styling work on a mid-range phone, landing in the middle of the swipe
 * that caused it, every time the band crossed the top in either direction. As a store only the
 * header subscribes to (BandAwareEyebrow), the swap re-renders the header and nothing else.
 */
type BandStore = {
  get: () => Record<number, boolean>
  set: (next: Record<number, boolean> | ((prev: Record<number, boolean>) => Record<number, boolean>)) => void
  subscribe: (l: () => void) => () => void
  /** Back to "nothing hidden" without telling anyone, for the render that swaps the player: the
   *  header re-renders in that same pass and reads it, and a notification during render would be
   *  an update to another component mid-render. */
  reset: () => void
}
function createBandStore(): BandStore {
  let value: Record<number, boolean> = {}
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: next => {
      const v = typeof next === 'function' ? next(value) : next
      if (v === value) return
      value = v
      listeners.forEach(l => l())
    },
    subscribe: l => { listeners.add(l); return () => { listeners.delete(l) } },
    reset: () => { value = {} },
  }
}

/** The sheet header: the club, or the player's name once the band has scrolled out. */
function BandAwareEyebrow({ store, index, name, children }: { store: BandStore; index: number; name: string; children: React.ReactNode }) {
  const hidden = useSyncExternalStore(store.subscribe, store.get, store.get)
  if (!hidden[index]) return <>{children}</>
  // The NAME ALONE, in ordinary case: the header's small caps and letter-spacing are set for a club
  // nickname, and "Denae Benites · Heights" in them truncated to "DENAE BENITE…" beside Compare and
  // Copy link.
  return (
    <Box component="span" sx={{
      display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      textTransform: 'none', letterSpacing: 0, fontSize: '0.9rem', fontWeight: 800, color: 'text.primary',
    }}>
      {name}
    </Box>
  )
}

const SHORT_DATE = new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' })
const shortDateCache = new Map<string, string>()
function shortDate(gameDate: string): string {
  let s = shortDateCache.get(gameDate)
  if (s == null) { s = SHORT_DATE.format(new Date(`${gameDate}T00:00:00`)); shortDateCache.set(gameDate, s) }
  return s
}


// ─── the modal ───────────────────────────────────────────────────────────────

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
function CompareChip({ player, roster }: { player: WpblPlayer; roster: WpblPlayer[] }) {
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

export default function PlayerDetailModal({ player, teams, games, players, onClose, onOpenGame, onOpenBoard, panel = false, onBack, backLabel, layout = 'modal', onExpand }: {
  player: WpblPlayer
  teams: WpblTeam[]
  games: WpblGame[]
  /** The full roster, needed to prove a name slug is unambiguous. Empty only during the first
   *  moment of a cold load, which the share URL falls back around. */
  players: WpblPlayer[]
  onClose: () => void
  /** Open a game from the log. The section's `openGame` closes this player as it goes, so
   *  Back walks off the game and lands on the player's page again, which is the same stack the
   *  reverse trip already builds (a player opened from a game sits on top of it). Optional only so
   *  a log still renders in a harness that has nowhere to send the click. */
  onOpenGame?: (game: WpblGame) => void
  /** Open the Stats table sorted by a stat with this player picked out, from a rank on the card.
   *  Without it the ranks are plain text. */
  onOpenBoard?: (group: 'hitting' | 'pitching', sortKey: string, opts: { qualified: boolean; playerId: string }) => void
  /** Open as the desktop side panel rather than a centred dialog. See ModalShell's `panel`. */
  panel?: boolean
  /** A back control in the panel's header, for a player opened from the Game Center panel. */
  onBack?: () => void
  backLabel?: string
  /** `page` draws the player as a full desktop page instead of a modal: the desktop layout below
   *  (every role in full, no role tabs), under the same bar the full Game Center has. The caller only
   *  asks for it on a desktop. */
  layout?: 'modal' | 'page'
  /** Offer the side panel's "Expand" to the full page. Shown only while this IS the side panel. */
  onExpand?: () => void
}) {
  const isDark = useWpblDark()

  // The fan awards this player won, for the ribbon under their name. The tally read is shared and
  // cached app-wide (Home reads it for the results card), and it fails to empty, so a player page
  // never waits on it or breaks for it: the ribbon simply arrives, or does not.
  //
  // Seeded from the last tally that landed, so an award winner's band rises at its final height
  // rather than growing a row of chips mid-slide; see lateUpdate for the rest of the rule.
  const awardsFor = (id: string) => {
    const r = getCachedWpblAwardResults()
    return r ? fanAwardsWon(r, id) : []
  }
  const [awards, setAwards] = useState<WpblAward[]>(() => awardsFor(player.id))
  useEffect(() => {
    let cancelled = false
    setAwards(prev => sameIds(prev, awardsFor(player.id)) ? prev : awardsFor(player.id))
    fetchWpblAwardResults().then(r => {
      if (cancelled) return
      const won = fanAwardsWon(r, player.id)
      lateUpdate(() => setAwards(prev => (sameIds(prev, won) ? prev : won)))
    })
    return () => { cancelled = true }
  }, [player.id])

  /**
   * Every batted ball of the season, for the spray chart, seeded from the app-wide cache.
   *
   * FETCHED HERE RATHER THAN PASSED IN, because this is the only surface that wants it and
   * the read is its own cached call: a player page opened cold pays for it once and every
   * player opened afterwards is free. Deliberately NOT the plays `fetchWpblAllPlays` returns,
   * which are filtered to what can set a milestone and so contain no routine outs.
   */
  const [battedBalls, setBattedBalls] = useState<WpblSprayPlay[]>(() => getCachedWpblBattedBalls() ?? [])
  useEffect(() => {
    if (battedBalls.length > 0) return
    let cancelled = false
    fetchWpblBattedBalls().then(rows => { if (!cancelled) lateUpdate(() => setBattedBalls(rows)) })
    return () => { cancelled = true }
  }, [battedBalls.length])

  /**
   * Which of the two layouts to BUILD, rather than which to show.
   *
   * A CSS `display` pair is wrong here, because both trees would mount: on a phone a two-way
   * player would build the desktop stack as well, which is two game logs and a pitch-location
   * plot rendered to be hidden. The pager exists precisely so that only the role on screen is
   * mounted (see SwipeableViews), and a hidden second tree hands that back.
   *
   * MUI's `md`, asked of the theme, because this file's other breakpoints are MUI's and these two
   * have to agree: the role pills and the pane's rate strip are still hidden with CSS at `md`, so a
   * disagreement would show a phone control over a desktop layout.
   *
   * NEVER WIDE IN THE SIDE PANEL. The panel renders this card's content under a theme with every
   * breakpoint out of reach, so all of its CSS draws the phone layout there (see ModalShell's
   * PANEL_THEME). This hook runs HERE, though, outside that provider, where the viewport is a
   * desktop's; it has to be told, or it would build the desktop stack into a phone-width column
   * and hide the role pills it needs. ModalShell opens the panel on exactly this same `md` test.
   */
  const mdUp = useMediaQuery(useMuiTheme().breakpoints.up('md'))
  const wide = mdUp && !panel
  // Each phone pane's copy of the band, and which of them are on screen. The header takes the
  // player's name when the ACTIVE pane's band has scrolled out, so a reader deep in a game log
  // still sees whose it is. Measured against each band's own scroller (see the observer below), so
  // "out" means scrolled out of the sheet, not merely off the page or still sliding in.
  const bandEls = useRef<(HTMLDivElement | null)[]>([])
  // A store rather than state: see BandStore.
  const bandStore = useMemo(createBandStore, [])
  const setBandHidden = bandStore.set
  const { basis: eraBasis, fmtEra } = useEraBasis()

  // The SHORT /p/<code> form, for pasting into a DM or a post. functions/p 302s it to the readable
  // /wpbl/players/<slug> the address bar shows, which is what Google indexes and what
  // functions/wpbl/index.ts OG-rewrites, so the unfurl still comes across as the player. It needs
  // only the id (no wait on the roster), and is built from the current origin so a link copied out
  // of a local or preview build resolves against that build.
  const shareUrl = useMemo(
    () => `${window.location.origin}${wpblPlayerShortPath(player)}`,
    [player])
  const gameById = useMemo(() => new Map(games.map(g => [g.id, g])), [games])
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])

  // SEEDED FROM THE SESSION CACHE, ON THE FIRST RENDER OF EVERY MOUNT.
  //
  // This card is a modal: closing it UNMOUNTS it, so reopening the same player is a fresh
  // mount and not a prop change. An initial value of `[]` with `loading: true` would therefore
  // spin again on every open, however recently the same season had been read. Lazy initialisers,
  // because `player` is a prop and is available before the first paint; the effect below still
  // runs and revalidates behind whatever this put on screen.
  const seeded = getSeedWpblPlayerLines(player.id)
  const [loading, setLoading] = useState(!seeded)
  const [allBatting, setBatting] = useState<WpblBattingLine[]>(() => seeded?.batting ?? [])
  const [allPitching, setPitching] = useState<WpblPitchingLine[]>(() => seeded?.pitching ?? [])
  const [allFielding, setFielding] = useState<WpblFieldingLine[]>(() => seeded?.fielding ?? [])
  const [pitchLocs, setPitchLocs] = useState<WpblPitchLoc[]>([])

  // WHICH YEAR. Everything below the band is one season's: the lines are every game the player has
  // ever played, so each read is cut to the year on screen before anything sums it (see inSeason).
  // The player's newest season until the reader picks another, which a retired player's page needs
  // and a current one never notices. Not in the address: it resets with the player, like the scope.
  const [pickedSeason, setPickedSeason] = useState<number | null>(null)
  const seasons = useMemo(
    () => seasonsPlayed([...allBatting, ...allPitching, ...allFielding], games),
    [allBatting, allPitching, allFielding, games])
  const season: number | null = pickedSeason != null && seasons.includes(pickedSeason)
    ? pickedSeason
    : seasons[0] ?? latestSeason(games)
  // Null only with no schedule and no lines, where there is nothing to cut.
  const thisSeason = <T extends { game_id: string }>(rows: T[]): T[] => (season == null ? rows : inSeason(rows, games, season))
  const batting = useMemo(() => thisSeason(allBatting), [allBatting, games, season]) // eslint-disable-line react-hooks/exhaustive-deps
  const pitching = useMemo(() => thisSeason(allPitching), [allPitching, games, season]) // eslint-disable-line react-hooks/exhaustive-deps
  const fielding = useMemo(() => thisSeason(allFielding), [allFielding, games, season]) // eslint-disable-line react-hooks/exhaustive-deps
  // That year's games, for whatever measures a season by its schedule: the qualifying bar under
  // the ranks. The schedule handed to a sum stays whole, since the lines are already cut.
  const seasonGames = useMemo(() => (season == null ? games : gamesInSeason(games, season)), [games, season])

  // Matched on the id, never the name: the league mints a new player_id per club, so a traded
  // player's rows carry two of them, and `api_ids` is what makes them one person. The batter
  // id on a play is already our own uuid, so this is the resolved one.
  const myBattedBalls = useMemo(
    () => thisSeason(battedBalls.filter(p => p.batter_id === player.id)),
    [battedBalls, player.id, games, season]) // eslint-disable-line react-hooks/exhaustive-deps

  // The club that season was played for, off the lines, which carry the club of each game: the band
  // wears it, so a past year reads in that year's colours. The newest season keeps the roster's club,
  // which is "now" and is right for a player traded since their last game. A season with no line
  // naming a club falls back to it too.
  const clubId = useMemo(() => {
    if (season == null || season === latestSeason(games)) return player.team_id
    const last = [...batting, ...pitching]
      .filter(l => l.team_id)
      .sort((a, b) => (gameById.get(b.game_id)?.game_date ?? '').localeCompare(gameById.get(a.game_id)?.game_date ?? ''))[0]
    return last?.team_id ?? player.team_id
  }, [season, games, batting, pitching, gameById, player.team_id])
  const team = useMemo(() => teams.find(t => t.id === clubId), [teams, clubId])
  const color = team ? wpblAccent(team.id, isDark) : '#888'
  // The RAW club colours, for the header band only. Everywhere else on this page uses
  // `color` above, which is the foreground-safe accent.
  const teamPrimary = wpblColor(clubId)
  const teamSecondary = wpblSecondary(clubId)
  // The wash this club can carry, and its mid-ramp at 60% of it so the gradient keeps its shape
  // whatever the end is. Hex pairs because the colour is a hex string and this is appended to it.
  const wash = BAND_WASH[clubId ?? ''] ?? BAND_WASH_FLOOR
  const washEnd = wash.toString(16).padStart(2, '0')
  const washMid = Math.round(wash * 0.6).toString(16).padStart(2, '0')

  // Which slice of the season the whole card shows. Defaults to the regular season, which is
  // what this page has always shown and what the OG cards and the Discord `/player` card still
  // publish; the toggle below only appears for a player who actually has postseason lines. Every
  // total, the game log and the pitch plot read through this; the ranks do not (see `ranks`).
  const [scope, setScope] = useState<SeasonScope>('regular')
  // Season-scoped like every other number on this page. The tracking read asks for every pitch
  // under every feed id the player has held, which is right for finding them and wrong for
  // plotting them: the card sits beside a pitching line that follows the same scope, and its own
  // caption counts `pt.g` games from that same total.
  const seasonPitchLocs = useMemo(() => scopedLines(thisSeason(pitchLocs), games, scope), [pitchLocs, games, season, scope]) // eslint-disable-line react-hooks/exhaustive-deps
  const trackedPitchGames = useMemo(() => new Set(seasonPitchLocs.map(r => r.game_id)).size, [seasonPitchLocs])
  // Every plate appearance she took part in, for the matchup tables: her own narrow read, or her
  // slice of the league log when another page already has it (see fetchWpblPlayerMatchupPlays).
  // Starts beside the player's own lines rather than after them, so the tables land with the
  // rest of the card instead of pushing the game log down a second later.
  const [matchupPlays, setMatchupPlays] = useState(() => getCachedWpblPlayerMatchupPlays(player))
  useEffect(() => {
    let cancelled = false
    fetchWpblPlayerMatchupPlays(player)
      .then(p => { if (!cancelled) lateUpdate(() => setMatchupPlays(p)) })
      .catch(() => { /* tables omit themselves */ })
    return () => { cancelled = true }
  }, [player])
  // Follows the scope toggle like every other number on the card.
  const matchups = useMemo(
    () => (matchupPlays ? playerMatchups(new Set(playerPlayIds(player)), thisSeason(matchupPlays), games, scope) : null),
    [matchupPlays, player, games, season, scope]) // eslint-disable-line react-hooks/exhaustive-deps
  // Every batting and pitching line in the league, for the percentile strip. Deliberately a
  // separate piece of state from the player's own lines: this one is allowed to never arrive.
  // `fetchWpblAllLines` is cached, deduped and already prefetched when the section lands on
  // Home, so for most readers this is a cache hit and costs nothing; for the rest the ranks
  // simply appear a moment after the totals, and if it fails they never appear at all and the
  // page is exactly what it was before.
  const [leagueLines, setLeagueLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] } | null>(
    () => getCachedWpblAllLines())
  // Posts that name this player. Seeded from the shared cache so reopening a player is
  // instant, then revalidated. Most players are never written about, and for them the
  // section below simply doesn't render.
  const [articles, setArticles] = useState<WpblArticle[]>(() => getCachedWpblArticles() ?? [])

  useEffect(() => {
    let cancelled = false
    fetchWpblArticles().then(a => { if (!cancelled) lateUpdate(() => setArticles(a)) }).catch(() => { /* keep last-good */ })
    fetchWpblAllLines()
      .then(l => {
        if (cancelled) return
        // Usually the very arrays the initialiser was seeded with, in which case this is no change.
        lateUpdate(() => setLeagueLines(prev => (prev && prev.batting === l.batting && prev.pitching === l.pitching ? prev : { batting: l.batting, pitching: l.pitching })))
      })
      .catch(() => { /* no ranks; the totals stand on their own */ })
    return () => { cancelled = true }
  }, [])

  // Every official-feed id this player has held. `api_id` alone is only the id for the player's
  // CURRENT club, and the feed mints a new one per club. The joined string IS the value passed on:
  // it is stable across re-renders where an array would not be, and it is the cache key on the
  // other side, so the two ends agree by construction.
  const feedKey = [...new Set([...(player.api_ids ?? []), player.api_id].filter(Boolean))].sort().join(',')

  // ─── Reopening a player is instant ─────────────────────────────────────────
  //
  // This card is reached from a leaderboard, which is a list of twenty of them: open, read,
  // close, open the next, come back to the first. Without a cache every one of those is a fresh
  // three-table read behind a spinner, on a season that does not change between two taps.
  //
  // THE OTHER PATH IN. The state above covers opening the card; this covers the card being
  // handed a different player while it stays mounted, which is what the "did you mean" results
  // and the next/previous controls do. Seeded DURING RENDER, not in an effect, for the same
  // reason the team rail is: an effect runs after the browser has painted, so seeding there
  // would still show a frame of spinner, or of the previous player's numbers under this
  // player's name. Cache miss falls back to the spinner, which is right for a player nobody has
  // opened.
  const [shownPlayer, setShownPlayer] = useState(player.id)
  if (shownPlayer === player.id && pitchLocs.length === 0) {
    // Seeded here rather than in the initialiser above because it is keyed on `feedKey`, which
    // is derived a few lines further down and cannot be read before it exists.
    const locs = getCachedWpblPitcherLocations(feedKey)
    if (locs && locs.length > 0) setPitchLocs(locs)
  }
  if (shownPlayer !== player.id) {
    setShownPlayer(player.id)
    const seed = getSeedWpblPlayerLines(player.id)
    setBatting(seed?.batting ?? []); setPitching(seed?.pitching ?? []); setFielding(seed?.fielding ?? [])
    setLoading(!seed)
    setPitchLocs(getCachedWpblPitcherLocations(feedKey) ?? [])
    // The rest of what belongs to the PREVIOUS player. The side panel swaps players on every row
    // clicked down a leaderboard, so a Playoffs scope or a scrolled-away band carried over would
    // show the next player's card already filtered, or with the header naming nobody.
    setScope('regular')
    setPickedSeason(null)
    bandStore.reset()
  }
  // And the scroll position, for the same reason: the next player opens at their name, not
  // halfway down a game log at whatever depth the last one was read to. Every scroller in the
  // shell's body, since on the phone layout each role pane scrolls on its own.
  const contentRef = useRef<HTMLDivElement>(null)
  const scrolledFor = useRef(player.id)
  useEffect(() => {
    if (scrolledFor.current === player.id) return
    scrolledFor.current = player.id
    const body = contentRef.current?.parentElement
    if (!body) return
    for (const el of [body, ...Array.from(body.querySelectorAll<HTMLElement>('*'))]) {
      if (el.scrollTop > 0) el.scrollTop = 0
    }
  }, [player.id])

  useEffect(() => {
    let cancelled = false
    fetchWpblPlayerLines(player.id).then(({ batting, pitching, fielding }) => {
      if (cancelled) return
      // A card seeded from the league-wide read gets the same rows back as new arrays; keeping the
      // old ones when nothing differs is what stops that from re-rendering the card mid-slide.
      lateUpdate(() => {
        setBatting(prev => (sameRows(prev, batting) ? prev : batting))
        setPitching(prev => (sameRows(prev, pitching) ? prev : pitching))
        setFielding(prev => (sameRows(prev, fielding) ? prev : fielding))
        setLoading(false)
      })
    })
    // Pitch-location tracking keys on the feed id; empty for non-pitchers / unmapped players.
    // Every id she has held, not just the current one, so a trade does not erase the half of
    // her season she threw under the old club's id.
    fetchWpblPitcherLocations(feedKey).then(locs => { if (!cancelled) lateUpdate(() => setPitchLocs(prev => (sameRows(prev, locs) ? prev : locs))) })
    return () => { cancelled = true }
  }, [player.id, feedKey])

  // Only real plate appearances count as batting: a 0-for-0 pinch/defensive cameo shouldn't
  // produce an all-zero batting card or a phantom game-log row.
  const battingReal = useMemo(() => batting.filter(hasPlateAppearance), [batting])
  // Every total on the card follows the scope toggle. The game log follows it too (see
  // `battingLog`/`pitchingLog`): with an explicit Regular / Playoffs / Both control on the card,
  // a log filtered to the chosen slice is the answer the reader asked for, not missing data.
  const bt = useMemo(() => sumBatting(battingReal, games, scope), [battingReal, games, scope])
  const pt = useMemo(() => sumPitching(pitching, games, scope), [pitching, games, scope])
  const ft = useMemo(() => sumFielding(fielding, games, scope), [fielding, games, scope])
  // The lines behind the game log and the form strip, in the same slice as the totals above.
  const battingLog = useMemo(() => scopedLines(battingReal, games, scope), [battingReal, games, scope])
  const pitchingLog = useMemo(() => scopedLines(pitching, games, scope), [pitching, games, scope])
  // Whether the player has any postseason line at all, which is the only thing that earns the
  // scope toggle: without one, the card has nothing to switch to and stays regular-season only.
  const hasPostseason = useMemo(
    () => scopedLines(battingReal, games, 'postseason').length > 0
      || scopedLines(pitching, games, 'postseason').length > 0
      || scopedLines(fielding, games, 'postseason').length > 0,
    [battingReal, pitching, fielding, games])
  const hasBatting = battingReal.length > 0
  const hasPitching = pitching.length > 0
  // WHETHER THERE IS ANYTHING TO SUMMARISE, in the SAME scope the summary shows. `hasBatting`
  // and `hasPitching` above count every line the player has, postseason included, because the
  // game log lists those. `bt` and `pt` are summed through the schedule, which drops the
  // postseason, so the hero and the cameos below must gate on the regular-season sum having
  // content. Without this a pitcher who batted only in the playoffs has `hasBatting` true (the
  // postseason line has a plate appearance) but an empty `bt`, and the "Also batted" block
  // renders `.000/.000/.000, 0-for-0`. Symmetric for a hitter who only pitched in the postseason.
  const hasSeasonBatting = plateAppearances(bt) > 0
  const hasSeasonPitching = pt.outs > 0 || pt.bf > 0
  const hasFielding = fielding.some(f => f.po || f.a || f.e || f.dp || f.pb)
  // Off the BATTING lines, which are the only rows carrying a position at all: a fielding row
  // has none and a pitching row is always the mound. A pitching-only appearance still shows up
  // here, because the feed writes those games' batting position as "p" when the pitcher came to
  // the plate, and the line simply does not exist when they did not, which is a game fielded
  // only as a pitcher and already covered by the 'p' the other games carry.
  const fieldedPositions = useMemo(() => positionsPlayed(batting, games), [batting, games])

  // Ranks, OPS+, the percentile rail and the qualifying meter are all built against the regular
  // season: its league baseline and its qualifying bar. Laid over a playoff or combined total
  // they would rank a five-game line against a fifteen-game field, so they stand down for any
  // scope but the regular season, and every consumer already treats a null `ranks` as "not yet".
  // Against that season's league and that season's bar, so a past year is ranked among the players
  // who played it.
  const ranks = useMemo(
    () => scope === 'regular' && leagueLines
      ? computeWpblPlayerRanks(player.id, players, teams, seasonGames, thisSeason(leagueLines.batting), thisSeason(leagueLines.pitching), eraBasis)
      : null,
    [scope, leagueLines, player.id, players, teams, games, season, seasonGames, eraBasis]) // eslint-disable-line react-hooks/exhaustive-deps

  // The season line's qualified fields, handed to the pitch profile so every "of N" on the card
  // is the same N. See `batFieldIds` in percentiles.ts.
  const batRankPool = useMemo(() => (ranks ? new Set(ranks.batFieldIds) : null), [ranks])
  const pitRankPool = useMemo(() => (ranks ? new Set(ranks.pitFieldIds) : null), [ranks])
  const ink = useRankInk()
  // What the shared card parts need from this section: its stat definitions as tooltips, its rank
  // blue, and its top-five bar.
  const cardEnv = useMemo<StatCardEnv>(
    () => ({ tip: k => statTip(k, eraBasis), ink, rankBar: COUNT_RANK_BAR }),
    [eraBasis, ink])

  // Lead with the skill the player is actually here for. The rule is `leadsWithPitching` in
  // positions.ts, shared with the unfurl card and the Discord card so the three cannot tell
  // one player's season two ways round. When one side is a cameo (a pitcher's stray ABs, a
  // hitter's mop-up inning) it does not earn a tab of its own: it folds into the primary pane
  // as a one-line summary, so genuine two-way players stand apart from occasional-hitting
  // pitchers. Thresholds are absolute (AB / outs) so they hold at any sample size.
  const pitcherFirst = leadsWithPitching({
    position: player.position, hasBatting, hasPitching,
    gs: pt.gs, bf: pt.bf, pa: plateAppearances(bt),
  })
  const BAT_CAMEO_AB = 10, PIT_CAMEO_OUTS = 9
  const battingCameo = pitcherFirst && hasSeasonBatting && bt.ab < BAT_CAMEO_AB
  const pitchingCameo = !pitcherFirst && hasSeasonPitching && pt.outs < PIT_CAMEO_OUTS
  // A tab per role only when BOTH sides have real regular-season production: a side whose only
  // work was in the postseason is not a second role, it is a line in the game log, and giving
  // it a tab would open onto an empty regular-season pane.
  const twoWay = hasSeasonBatting && hasSeasonPitching && !battingCameo && !pitchingCameo

  // Sample-size meta for each pane, flagged as thin below a rough one-week-ish bar.
  //
  // THE RETRACTION SITS WITH THE CLAIM. This line runs directly under the headline rates, the
  // largest type on the card: a 6 AB player's `1.292` is set large, and a caveat a column away
  // in small grey type is not one a reader meets before believing the number. Naming the actual
  // bar here also says how far off the player is and what they are off from, in the same glance
  // as the figure it qualifies.
  //
  // The league's own bar is preferred over the local one whenever ranks have loaded, so this
  // line and the rail below it cannot disagree about whether the player counts. `BAT_SMALL_AB`
  // and `PIT_SMALL_OUTS` stay as the fallback for the window before `fetchWpblAllLines` lands
  // and for a season too young to have set a bar at all, where there is no number to name yet.
  const BAT_SMALL_AB = 25, PIT_SMALL_OUTS = 30 // < ~25 AB / < 10.0 IP reads as small sample
  const qual = ranks?.qualifiers
  // THE GAP, NOT THE BAR. `RankProgress` at the foot of the rail prints the distance to the bar
  // ("1 more PA"), so printing the threshold here ("29 PA to qualify") would give one fact two
  // numbers on one card, with the bigger one under the headline where it reads as a quantity
  // still owed. Twenty-nine of anything also sounds like a season away in a league that plays
  // fifteen games.
  //
  // The gap is the better retraction anyway. The bar's job here is to disown the large number
  // above it, and "1 PA from qualifying" does that while saying the more interesting thing: the
  // player is about to count. The meter below still draws the arithmetic; this is its headline.
  const paGap = qual ? Math.max(0, qual.minPa - plateAppearances(bt)) : 0
  const outsGap = qual ? Math.max(0, qual.minOuts - pt.outs) : 0
  // Falling through to 'small sample' on a zero gap is deliberate rather than defensive: it
  // cannot happen while this line and `computeWpblPlayerRanks` agree on the bar, and if they
  // ever stop agreeing, a vaguer caveat is a better failure than "0 PA from qualifying".
  const battingMeta = `${plateAppearances(bt)} PA`
    + (ranks?.batReason === 'below-bar' && paGap > 0 ? ` · ${paGap} PA from qualifying`
      : bt.ab < BAT_SMALL_AB ? ' · small sample' : '')
  // No IP here: it is a column on the pitching line now. The gap to the bar is still
  // measured in innings, because that is the unit the bar is set in.
  // Games and the record are columns of the line, so the caption keeps only the sample's verdict.
  const pitchingMeta = ranks?.pitReason === 'below-bar' && outsGap > 0 ? `${outsToIp(outsGap)} IP from qualifying`
    : pt.outs < PIT_SMALL_OUTS ? 'Small sample' : ''

  // The control only exists for a genuine two-way player. Everyone else gets her own numbers
  // with no chrome: a lone pill that cannot be switched away from is worse than no pill.
  //
  // The reader's pick, or null for the primary role. DERIVED rather than copied into state by an
  // effect, because an effect runs a commit late: the render where the lines land and make a
  // pitcher's card lead with pitching would still hold the old 'batting', and the pager would draw
  // the second pane for a frame before swinging back.
  const [pickedRole, setRole] = useState<Role | null>(null)
  const role: Role = pickedRole ?? (pitcherFirst ? 'pitching' : 'batting')
  useEffect(() => { setRole(null) }, [pitcherFirst])
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
  // `lineTeam` is the club the player played THAT game for, off the box-score line, not the one
  // on their roster row. A traded player's old games are still in the log, and reading the
  // current club would ask "was Los Angeles at home?" of a New York game played in July: neither
  // side matches, so the label would fall through to naming the player's own team and the row
  // would read "@ NY" for a game played for New York. The line always knows; the roster row only
  // knows now.
  const oppLabel = (gameId: string, lineTeam: string | null): { date: string; text: string; short: string } => {
    const g = gameById.get(gameId)
    if (!g) return { date: '', text: '', short: '' }
    const forTeam = lineTeam ?? player.team_id
    const isHome = g.home_team_id === forTeam
    const oppId = isHome ? g.away_team_id : g.home_team_id
    const opp = teamById.get(oppId)
    const date = shortDate(g.game_date)
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
    return { lead: [o.date, o.text], onOpen: g && onOpenGame ? () => onOpenGame(g) : undefined }
  }

  // Box-score lines come back in whatever order the API returns them, which is not
  // chronological, so a game log rendered straight off them reads as shuffled. Sort on the
  // game's real ISO date, not the "Aug 13" label the row displays, which would sort
  // alphabetically and put August after April. Sort is stable, so two games sharing a date
  // (a doubleheader) keep their relative order.
  //
  // NEWEST FIRST. Oldest-first reads down the season the way it was played, which is a nice
  // narrative at ten games and at forty buries last night at the bottom of a scroll, the one row
  // anyone opening a player page late in a season is looking for. It also decides what the
  // capped log shows without scrolling, since the cap clips the BOTTOM of the list (see
  // StatLogTable).
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
      ? newestFirst(pitchingLog).slice(0, FORM_GAMES).reverse()
        .map(l => ({ opp: oppLabel(l.game_id, l.team_id).short, value: outsToIp(l.outs) }))
      : newestFirst(battingLog).slice(0, FORM_GAMES).reverse()
        .map(l => ({ opp: oppLabel(l.game_id, l.team_id).short, value: `${l.h}-${l.ab}` }))

  // Posts naming this player: the ones whose headline names them first (the profiles), then the
  // rest, each newest first. See aboutPlayerFirst.
  const writtenAbout = useMemo(
    () => aboutPlayerFirst(articles.filter(a => a.player_ids.includes(player.id)), player.name ?? ''),
    [articles, player.id, player.name])

  // The position she has actually been playing, which is not always the one on the roster.
  // `overridden` puts the filed one alongside rather than dropping it: a reader who knows her
  // as the club's catcher should not have to wonder whether we lost her.
  const pos = displayPosition(player.position, batting, games)
  // Uniform number leads the meta line when the roster carries one (69 of 118 do). It is a
  // fact of identity a reader looks for first, so it goes ahead of position and handedness.
  const subParts = [player.jersey_number ? `#${player.jersey_number}` : null, pos.label, pos.overridden && pos.official ? `listed ${pos.official}` : null, [player.bats, player.throws].filter(Boolean).join('/') ? `B/T ${player.bats || '-'}/${player.throws || '-'}` : null, player.age != null ? `${player.age} yrs` : null].filter(Boolean)

  // ── the two panes ──────────────────────────────────────────────────────────

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

  /**
   * A printed rank opens the league table it was taken from, sorted by that stat, with this player
   * picked out: MLB's stat card did this first. A rate rank is against the QUALIFIED field and a
   * counting rank against everyone who recorded the stat, so the board opens on the same population
   * the rank was counted in, or the row it scrolls to would sit at a different place than "3rd".
   * The counting keys carry a `c_` prefix and two of them are spelled differently on the table.
   */
  const linkRanks = <C extends object>(r: Role, cells: C[]): (C & { onRank?: () => void })[] =>
    !onOpenBoard ? cells : cells.map(c => {
      const key = (c as { rank?: { key: string } | null }).rank?.key
      if (!key) return c
      const counting = key.startsWith('c_')
      const col = !counting ? key : key === 'c_outs' ? 'ip' : key === 'c_s' ? 'sv' : key.slice(2)
      const group = r === 'pitching' ? 'pitching' : 'hitting'
      return { ...c, onRank: () => onOpenBoard(group, col, { qualified: !counting, playerId: player.id }) }
    })

  /**
   * THE HEADLINE: the four numbers every stat site leads a player with. AVG, HR, RBI and OPS for a
   * hitter; W-L (or saves, for a reliever), ERA, strikeouts and WHIP for a pitcher, which is ESPN's
   * player header and MLB.com's, so a reader arriving from either finds them where they look. Drawn
   * at every width, over the standard line, with each rank's field ("2nd of 21").
   */
  const leadsWithSaves = pt.gs === 0 && pt.s > 0
  const headline = (r: Role) => {
    // A count's place in the whole field, as a rate's is in the qualified one. Nothing for a zero,
    // which is not a place.
    const countCell = (label: string, value: number, rs: WpblStatRank[] | undefined, key: string) => {
      const rk = rs?.find(x => x.key === key)
      return { label, value: String(value), rank: rk && value > 0 ? rk : null }
    }
    return r === 'pitching' ? [
      leadsWithSaves ? countCell('SV', pt.s, ranks?.pitchingCounts, 'c_s') : { label: 'W-L', value: `${pt.w}-${pt.l}` },
      { label: 'ERA', value: fmtEra(pt.era), rank: rateRank(ranks?.pitching, 'era') },
      countCell('SO', pt.so, ranks?.pitchingCounts, 'c_so'),
      { label: 'WHIP', value: fmtTwo(pt.whip), rank: rateRank(ranks?.pitching, 'whip') },
    ] : [
      { label: 'AVG', value: fmtRate(bt.avg), rank: rateRank(ranks?.batting, 'avg') },
      countCell('HR', bt.hr, ranks?.battingCounts, 'c_hr'),
      countCell('RBI', bt.rbi, ranks?.battingCounts, 'c_rbi'),
      { label: 'OPS', value: fmtRate(bt.ops), rank: rateRank(ranks?.batting, 'ops') },
    ]
  }
  /** A rate in the standard line, ranked only at the counting bar: "1st" under OBP, never "9th". */
  const lineRate = (label: string, value: string, rs: WpblStatRank[] | undefined, key: string) => {
    const rk = rs?.find(x => x.key === key)
    return { label, value, rank: rk && rk.rank <= COUNT_RANK_BAR ? rk : null }
  }

  const rateHead = (r: Role) => (
    <Box sx={{ mb: 1.5 }}>
      <RateStrip cells={linkRanks(r, headline(r))} />
    </Box>
  )

  /** How much of a season these numbers are, in the units the qualifying bar is set in.
   *
   *  IT IS THE TABLE'S CAPTION, not a line of its own: set on the table's own top rule, with the
   *  season on the left and the sample on the right, it is what every stat page puts over a line
   *  of numbers, and it connects the rate strip and the table instead of floating between them.
   *
   *  BOTH HALVES SHOW AT EVERY WIDTH. On the desktop card this is the only place that says how
   *  much of a season these numbers are, and the season label is the only place the card says
   *  WHICH season these are. */
  //
  //  THE SCOPE CONTROL SITS ON IT, AT EVERY WIDTH. It used to be a full-size segmented control of
  //  its own on a phone, directly under the band and 160px below the Pitching / Batting pills, so
  //  the top of the card read as two navigation bars. It re-slices exactly the numbers under this
  //  caption, so it belongs on it, and it is the compact size so it reads as a setting on a section
  //  rather than as navigation. On a phone the sample drops under the season label to make room.
  // Back to the regular season on a new year, as on a new player: the next one may have no playoffs.
  const pickSeason = (y: number) => {
    setPickedSeason(y)
    setScope('regular')
  }
  const lineCaption = (r: Role, scopeControl?: React.ReactNode, metaOverride?: React.ReactNode) => {
    const noun = scope === 'postseason' ? 'postseason' : 'season'
    // The year comes off the SCHEDULE rather than the clock (see `season`): this card is a
    // permanent page with a shareable URL, and read next January a wall-clock year would relabel a
    // 2026 line as 2027's.
    const label = season != null ? `${season} ${noun}` : noun.charAt(0).toUpperCase() + noun.slice(1)
    return (
      <LineCaption
        picker={season != null
          ? <SeasonPicker label={label} season={season} seasons={seasons} onChange={pickSeason} />
          : <Typography sx={{ ...sectionSx, mb: 0 }}>{label}</Typography>}
        meta={metaOverride !== undefined ? metaOverride : r === 'pitching' ? pitchingMeta : battingMeta}
        control={scopeControl}
      />
    )
  }

  // The log's totals row only off the regular season. On it the row repeated the season line a
  // few inches above, figure for figure, and on a phone it was the most cramped row on the card.
  // On Playoffs or Both it is the reminder, at the foot of a long list, of which games it adds up.
  const logTotals = scope !== 'regular'

  // Each pane in two halves, because a desktop dialog puts them side by side: `season` is what
  // is true about her year, `log` is the record of the games it came out of. On anything
  // narrower they simply stack in this order and nothing about the reading changes.
  const battingPane = {
    hasLog: battingLog.length > 0,
    /** Between the season line and the log: how the season was hit, from every pitch seen. */
    profile: <PitchProfileBlock player={player} side="batting" players={players} teams={teams} games={games} season={season} scope={scope} rankPool={batRankPool} accent={color} />,
    /** Under the profile: her line against every pitcher she has faced. */
    matchups: <MatchupTable player={player} side="batting" lines={matchups?.vsPitchers ?? []} players={players} scope={scope} accent={color} />,
    line: (scopeControl?: React.ReactNode) => (
      <>
        {lineCaption('batting', scopeControl)}
        {rateHead('batting')}
        {/* THE STANDARD LINE, in MLB.com's column order with the rates at the end, which is how
            every stat site's table reads, so the header row is a thing a reader checks rather than
            reads. Every column is always drawn: 3B and CS sit where a reader expects them even at
            zero. The less-read columns follow the rates once they have happened, in
            Baseball-Reference's order. NO TOTAL BASES: SLG is it divided by at-bats, and it is still
            ranked, so a total-bases lead still reaches the card through the counting ranks.
            A stat in the headline keeps its rank there and not here, so no figure is ranked twice.
            SO carries no rank, ever: second in the league in strikeouts is not an achievement. */}
        <SeasonLine headline={headline('batting').map(c => c.label)} cols={linkRanks('batting', [
          { label: 'G', value: bt.g },
          { label: 'AB', value: bt.ab },
          { label: 'R', value: bt.r, rank: countRank(ranks?.battingCounts, 'c_r') },
          { label: 'H', value: bt.h, rank: countRank(ranks?.battingCounts, 'c_h') },
          { label: '2B', value: bt.doubles, rank: countRank(ranks?.battingCounts, 'c_2b') },
          { label: '3B', value: bt.triples, rank: countRank(ranks?.battingCounts, 'c_3b') },
          { label: 'HR', value: bt.hr },
          { label: 'RBI', value: bt.rbi },
          { label: 'BB', value: bt.bb, rank: countRank(ranks?.battingCounts, 'c_bb') },
          { label: 'SO', value: bt.so },
          { label: 'SB', value: bt.sb, rank: countRank(ranks?.battingCounts, 'c_sb') },
          { label: 'CS', value: bt.cs },
          { label: 'AVG', value: fmtRate(bt.avg), breakBefore: true },
          lineRate('OBP', fmtRate(bt.obp), ranks?.batting, 'obp'),
          lineRate('SLG', fmtRate(bt.slg), ranks?.batting, 'slg'),
          { label: 'OPS', value: fmtRate(bt.ops) },
          // The extras start a row of their own when the line folds, whichever of them is first.
          ...[
            ...(bt.gdp ? [{ label: 'GDP', value: bt.gdp }] : []),
            ...(bt.hbp ? [{ label: 'HBP', value: bt.hbp }] : []),
            ...(bt.sh ? [{ label: 'SH', value: bt.sh }] : []),
            ...(bt.sf ? [{ label: 'SF', value: bt.sf }] : []),
          ].map((c, i) => (i === 0 ? { ...c, breakBefore: true } : c)),
        ])} />
      </>
    ),
    season: (
      <>
        {pitchingCameo && (
          <CameoBlock label="Also pitched"
            text={`${fmtEra(pt.era)} ERA over ${outsToIp(pt.outs)} IP, ${pt.so} K`} />
        )}
        {/* Only the meter survives here: the ranks themselves have moved into the cells they
            belong to, and what is left is the administrative note about why some of them are
            missing. Drawn only for a player who is actually short of the bar. */}
        {ranks && ranks.batReason !== 'ok' && (
          <RankProgress reason={ranks.batReason} have={plateAppearances(bt)} need={ranks.qualifiers.minPa}
            unit="PA" fmt={String} noun="batters" color={ink} />
        )}
      </>
    ),
    log: (
      <StatLogTable
        title="Game log"
        // The box score's order, matching the season line above it. TB stays HERE and not
        // there: over one night it is the slugging line of that night and worth marking as a
        // best game, and over a season it is SLG times at-bats.
        statHeaders={['POS', 'AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'SB', 'BB', 'SO', 'TB']}
        // No position in the totals: a season is not played at one. The em dash is this
        // project's glyph for "no value", which is exactly what that cell is. See `logTotals`.
        totals={!logTotals ? undefined : ['—', bt.ab, bt.r, bt.h, bt.doubles, bt.triples, bt.hr, bt.rbi, bt.sb, bt.bb, bt.so, bt.tb]}
        best={BATTING_BEST}
        accent={color}
        rows={newestFirst(battingLog).map(l => ({ ...logRow(l.game_id, l.team_id), cells: [gamePosition(l.position), l.ab, l.r, l.h, l.doubles, l.triples, l.hr, l.rbi, l.sb, l.bb, l.so, l.tb] }))}
      />
    ),
    /** What follows the pitch profile. */
    extras: myBattedBalls.length > 0
      ? (
        <Box sx={{ mt: 2.5 }}>
          <SectionHead title="Hit locations" />
          <SprayChart plays={myBattedBalls} bats={player.bats} />
        </Box>
      )
      : null,
  }

  const pitchingPane = {
    hasLog: pitchingLog.length > 0 || seasonPitchLocs.length > 0,
    /** Between the season line and the log: how the season was pitched, from every pitch thrown. */
    profile: <PitchProfileBlock player={player} side="pitching" players={players} teams={teams} games={games} season={season} scope={scope} rankPool={pitRankPool} accent={color} />,
    /** Under the profile: what every batter she has faced did against her. */
    matchups: <MatchupTable player={player} side="pitching" lines={matchups?.vsBatters ?? []} players={players} scope={scope} accent={color} />,
    line: (scopeControl?: React.ReactNode) => (
      <>
        {lineCaption('pitching', scopeControl)}
        {rateHead('pitching')}
        {/* MLB.com's pitching order, the rates where it puts them. The rarer columns follow WHIP once
            they have happened, and the pitch count closes the line: it is the only figure on the card
            saying how hard the innings were, which the counting stats cannot (they say what was given
            up). Batters faced is not a column, being very nearly innings times three plus the
            baserunners already itemised; `pt.bf` is still read, by the role rule in positions.ts. */}
        <SeasonLine headline={headline('pitching').map(c => c.label)} cols={linkRanks('pitching', [
          { label: 'W', value: pt.w, rank: countRank(ranks?.pitchingCounts, 'c_w') },
          { label: 'L', value: pt.l },
          { label: 'ERA', value: fmtEra(pt.era) },
          { label: 'G', value: pt.g },
          { label: 'GS', value: pt.gs },
          { label: 'SV', value: pt.s, rank: leadsWithSaves ? null : countRank(ranks?.pitchingCounts, 'c_s') },
          { label: 'IP', value: outsToIp(pt.outs), rank: countRank(ranks?.pitchingCounts, 'c_outs') },
          { label: 'H', value: pt.h },
          { label: 'R', value: pt.r },
          { label: 'ER', value: pt.er },
          { label: 'HR', value: pt.hr },
          { label: 'BB', value: pt.bb },
          { label: 'SO', value: pt.so },
          { label: 'WHIP', value: fmtTwo(pt.whip) },
          ...(pt.hbp ? [{ label: 'HBP', value: pt.hbp }] : []),
          ...(pt.wp ? [{ label: 'WP', value: pt.wp }] : []),
          ...(pt.bk ? [{ label: 'BK', value: pt.bk }] : []),
          { label: 'P', value: pt.pitches },
        ])} />
      </>
    ),
    season: (
      <>
        {battingCameo && (
          <CameoBlock label="Also batted"
            text={`${fmtRate(bt.avg)}/${fmtRate(bt.obp)}/${fmtRate(bt.slg)}, ${bt.h}-for-${bt.ab}${bt.hr ? `, ${bt.hr} HR` : ''}`} />
        )}
        {ranks && ranks.pitReason !== 'ok' && (
          <RankProgress reason={ranks.pitReason} have={pt.outs} need={ranks.qualifiers.minOuts}
            unit="IP" fmt={outsToIp} noun="pitchers" color={ink} />
        )}
      </>
    ),
    log: (
      <>
        {/* THE GAME LOG FIRST, and the pitch plot under it. League pitch tracking reaches a handful
            of games (the card's own summary reads like "44 pitches · 1 of 5 games") and the
            endpoints carrying it are key-gated, so the gap is not going to close. A complete record
            of every appearance outranks a sample of one of them. */}
        {/* No POS column here, unlike the batting log: a pitching line's position is 'p'
            in every row of every pitcher's season. */}
        <StatLogTable
          title="Game log"
          statHeaders={['DEC', 'IP', 'H', 'R', 'ER', 'HR', 'BB', 'SO', 'P']}
          // The record stands in for the decision column, which is the only cell here whose
          // season form is a different thing from the sum of the games above it.
          totals={!logTotals ? undefined : [`${pt.w}-${pt.l}`, outsToIp(pt.outs), pt.h, pt.r, pt.er, pt.hr, pt.bb, pt.so, pt.pitches]}
          best={PITCHING_BEST}
          accent={color}
          rows={newestFirst(pitchingLog).map(l => ({ ...logRow(l.game_id, l.team_id), cells: [l.decision ?? '—', outsToIp(l.outs), l.h, l.r, l.er, l.hr, l.bb, l.so, l.pitches ?? '—'] }))}
        />
      </>
    ),
    // ONLY WITH HALF THE PITCHER'S GAMES TRACKED. The league's radar reached the first couple of
    // games of the season and stopped, so for nearly every pitcher this plot was a handful of
    // pitches from one outing (13 pitches, 1 of 9 games), collapsed because it could not be
    // trusted and still taking a row to say so. The pitch profile above reads every game.
    extras: trackedPitchGames > 0 && pt.g > 0 && trackedPitchGames * 2 >= pt.g
      ? <Box sx={{ mt: 2 }}><PitchLocationCard rows={seasonPitchLocs} accent={color} gamesPitched={pt.g} /></Box>
      : null,
  }

  /**
   * THE LOADING STATE: this card drawn empty, in the same tree the loaded card uses.
   *
   * It used to be the band pinned over a spinner. When the lines landed the band moved from that
   * pinned slot into the pane's scroller, so React threw the portrait away and drew it again, and
   * everything under it arrived at once. Now the pane is the real pane holding samples (see
   * FigureBar), so the band stays put, the portrait is the same element, and the bars under it
   * become figures in place.
   *
   * THE MOST LIKELY SHAPE, where the shape depends on what has not loaded: one role, guessed off
   * the filed position (a two-way player gains the role switch above the band when the lines say
   * so); the Regular / Playoffs control, held invisibly, since every club in the league played in
   * the postseason; the hitter's sample line under the caption, which a qualified pitcher's card
   * does not have; and a game log long enough for its Show more control.
   */
  const skeletonPane = (r: Role) => {
    // A rank on every sample holds a rank row open under each row of the line, which the loaded
    // card nearly always has: every hitter measured led the league in something worth printing.
    const sample = (labels: [string, string][]) => labels.map(([label, value]) => ({ label, value, rank: { rank: 1, of: 1 } }))
    const lineCols = r === 'pitching'
      ? sample([['W', '2'], ['L', '2'], ['ERA', '4.50'], ['G', '6'], ['GS', '5'], ['SV', '0'], ['IP', '20.0'], ['H', '20'],
        ['R', '10'], ['ER', '10'], ['HR', '2'], ['BB', '10'], ['SO', '15'], ['WHIP', '1.50'], ['HBP', '1'], ['WP', '2'], ['P', '350']])
      : sample([['G', '15'], ['AB', '50'], ['R', '10'], ['H', '15'], ['2B', '3'], ['3B', '1'], ['HR', '3'], ['RBI', '10'], ['BB', '6'],
        ['SO', '8'], ['SB', '3'], ['CS', '1'], ['AVG', '.250'], ['OBP', '.350'], ['SLG', '.400'], ['OPS', '.750'], ['HBP', '1'], ['SF', '1']])
    const head = r === 'pitching'
      ? sample([['W-L', '2-2'], ['ERA', '4.50'], ['SO', '15'], ['WHIP', '1.50']])
      : sample([['AVG', '.250'], ['HR', '3'], ['RBI', '10'], ['OPS', '.750']])
    const logHeaders = r === 'pitching'
      ? ['DEC', 'IP', 'H', 'R', 'ER', 'HR', 'BB', 'SO', 'P']
      : ['POS', 'AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'SB', 'BB', 'SO', 'TB']
    const logCells = r === 'pitching' ? ['W', '5.0', '5', '2', '2', '1', '2', '5', '80'] : ['CF', '4', '1', '1', '1', '1', '1', '1', '1', '1', '1', '2']
    return {
      hasLog: true,
      profile: null,
      matchups: null,
      extras: null,
      season: null,
      line: () => (
        <>
          {lineCaption(r,
            <Box aria-hidden sx={{ visibility: 'hidden' }}>{scopeNav}</Box>,
            r === 'pitching' ? '' : <Skeleton variant="text" sx={{ display: 'inline-block', width: '3.5em' }} />)}
          <Box sx={{ mb: 1.5 }}><RateStrip cells={head} placeholder /></Box>
          <SeasonLine cols={lineCols} headline={head.map(c => c.label)} placeholder />
        </>
      ),
      log: (
        <StatLogTable
          title="Game log"
          statHeaders={logHeaders}
          accent={color}
          placeholder
          rows={Array.from({ length: LOG_PREVIEW + 3 }, () => ({ lead: ['Aug 00', '@ BOS'], cells: logCells }))}
        />
      ),
    }
  }
  const paneFor = (r: Role) => (loading ? skeletonPane(r) : r === 'pitching' ? pitchingPane : battingPane)

  // One control, drawn on the season caption at every width (see lineCaption).
  const scopeNav = (
    <SegNav
      options={[
        { value: 'regular', label: 'Regular' },
        { value: 'postseason', label: 'Playoffs' },
        { value: 'all', label: 'Both' },
      ]}
      value={scope}
      onChange={v => setScope(v as SeasonScope)}
      accent={color}
      mb={0}
      size="sm"
    />
  )

  const showTabs = twoWay
  // The band only takes the hero once there is a hero to take: not while the lines are still
  // in flight, and never for a fielding-only cameo, whose empty batting totals would put a
  // .000 OPS on the card as though it were a fact about her.
  const showBandHero = !loading && (hasBatting || hasPitching)
  // The pager's index space, primary role first. A two-way player gets both panes; everyone
  // else gets exactly one, which is what keeps a lone unswitchable pill off the page. A
  // one-panel pager is not a special case: it simply has no neighbour to reach, so a sideways
  // drag rubber-bands and lets go, which is the same answer the tab bar gives.
  //
  // While loading, the one role the filed position points to: see skeletonPane.
  const roles: Role[] = loading
    ? [/P/.test(player.position ?? '') ? 'pitching' : 'batting']
    : twoWay
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
   * NOT A RAIL OF RATES BESIDE THE TABLES. A left rail has nothing substantial to hold, and it
   * cannot be narrowed: the log asks for its natural width and the rail takes whatever is left, so
   * the SHORTER the log the WIDER the void, and a pitcher, who has the least to say, gets the
   * emptiest card. Any floor small enough to fix that is one the batting log would push through,
   * back into its own horizontal scroller.
   *
   * ACROSS THE TOP THERE IS NOTHING LEFT OVER. The headline spans, the standard line under it
   * spans, the log under that spans, and the card is a single column of full-width blocks, which
   * is both the shape the phone uses and the shape every stat page has always had.
   *
   * NO TABS ON A DESKTOP: tabs buy vertical space on a phone, a desktop dialog is not short of it,
   * and a two-way player is exactly who a stat site puts two tables on one page for. Baseball
   * Reference has never asked anyone to choose between Standard Batting and Standard Pitching.
   * That is also why the club band has no headline rates: it could only ever show one role.
   *
   * The phone keeps the pager and the pills, which is what a 375px column can hold.
   */
  const desktopRoleBlock = (r: Role, first: boolean, last: boolean) => {
    const pane = paneFor(r)
    return (
      <Box key={r} sx={{ mb: last ? 0 : 3.5 }}>
        {/* Named only when there are two of them. On a single-role card the heading would be
            answering a question nobody asked: a hitter's page does not need to say "Batting". */}
        {twoWay && (
          <Typography sx={{ ...sectionSx, color: color, mb: 1 }}>
            {r === 'pitching' ? 'Pitching' : 'Batting'}
          </Typography>
        )}
        {/* The same headline and standard line as the phone: four figures with their ranks, then
            the line in the order every stat site prints it. Until Oct 2026 the desktop put the rates
            first as the line's own lead columns, an order no other site uses. */}
        {pane.line(first && hasPostseason ? scopeNav : undefined)}
        {/* THE CAMEO AND THE QUALIFYING METER: without them a desktop reader of a below-the-bar
            player meets four unranked rates and no word about why, and a two-way cameo loses the
            one line saying the player also pitched. Capped to a reading measure, because both are
            sentences and a sentence set across 1050px is not read. */}
        <Box sx={{ maxWidth: chromePx(SENTENCE_W) }}>{pane.season}</Box>
        {/* WHAT SHE DID, THEN HOW. The game log follows the season line, as it does on every stat
            site, then her record against each opponent, then the pitch profile and the charts,
            which explain the numbers above them. The profile used to come second, and on a phone
            it put about 420px of pitch mix between the season and the games it came from. */}
        {pane.log}
        {pane.matchups}
        {pane.profile}
        {pane.extras}
        {/* Fielding belongs to the PLAYER, not to a role, so it is drawn once, after the last
            role. On a two-way card it would otherwise appear twice, and its totals are the
            player's mound work and outfield work added together either way. LAST among the stats:
            it is the least reliable number on the card. The pitch plot above it used to be the
            one block below fielding, as stale data, and it now draws only for a pitcher with at
            least half her games tracked. */}
        {last && hasFielding && (
          <FieldingLine ft={ft} positions={twoWay ? fieldedPositions : undefined} />
        )}
      </Box>
    )
  }

  /**
   * THE PHONE'S PANE, and only the phone's: above 900px `wide` swaps this whole pager out for
   * `desktopRoleBlock`, and `wide` is MUI's `md` to the pixel. Do not add `md` layout here: it
   * cannot render, and an unreachable layout is the first thing the next reader finds when they
   * go looking for how the desktop works.
   */
  /** The club band. Drawn once, pinned, on a desktop; once per pane, scrolled, on a phone. */
  const bandBlock = (ref?: (el: HTMLDivElement | null) => void) => (
    <PlayerBand
      bandRef={ref}
      // A grab surface only while pinned; a pane's copy (the one handed a ref) scrolls natively.
      // See PlayerBand.
      grab={!ref}
      // The secondary washes OVER an opaque primary rather than being the last stop of a gradient
      // that runs out of colour. As a plain gradient the right-hand end would be `secondary` at low
      // alpha over whatever sits behind the card, which in light mode is white, so the band would
      // fade to near-white exactly where text sits. Washing over the primary keeps every point on the
      // band dark enough for white text, and the club's actual hue stays visible in light mode.
      //
      // MORE OF THE CLUB, LESS OF THE BLACK: the wash starts early and ramps to whatever each club can
      // carry, so the band reads as the club's colours rather than as black with a hint of something
      // in one corner. See BAND_WASH for what sets the number.
      background={{
        color: teamPrimary,
        image: `linear-gradient(105deg, transparent 0%, transparent 26%, ${teamSecondary}${washMid} 62%, ${teamSecondary}${washEnd} 100%)`,
      }}
      stripe={teamSecondary}
      // A rounded square rather than a circle, and bigger. A circle crops a head-and-shoulders
      // portrait to the face; at this size there is room for the shoulders and the uniform, which
      // is most of what makes a player recognisable. One size at every width, deliberately: a JS
      // media query picking a size does not re-render on a live window resize the way the band's
      // CSS breakpoints do.
      portrait={<PlayerPortrait key={player.id} name={player.name} teamId={clubId} square size={84} priority />}
      // The page's <h1>. A player page is a modal over a tab but it is a real page with its own URL
      // and title, and the tab underneath stops rendering an h1 while this is open; see PageHeading.tsx.
      name={player.name}
      nameAs="h1"
      badge={twoWay ? <BandBadge>Two-way</BandBadge> : undefined}
      meta={subParts.length > 0 ? subParts.join(' · ') : undefined}
      // 0.75 alpha (PlayerBand's default): the band carries a strong club hue, and at 0.62 these two
      // lines fall to 3.7:1 over New York's sky blue. They are the smallest text on the card and
      // the first thing a stronger wash costs. Separate FACTS: the draft line shows for a player
      // with no hometown on file.
      lines={[
        ...(player.hometown ? [player.hometown] : []),
        ...(player.draft_round ? [`Round ${player.draft_round}, Pick ${player.draft_pick}`] : []),
      ]}
      // THE FAN AWARDS THIS PLAYER WON, as a seal under the facts rather than a card further down: it
      // is a fact about the player, it outlasts the season, and a card would put it below the fold on
      // a phone. A real link, so it is crawlable and opens in a new tab. Gold trophy on a light wash,
      // the one mark the results sheet itself spends on a winner.
      chips={awards.length > 0 ? (
        // One row like MLB's band, the rest behind "+N" (see BandChips).
        <BandChips noun={['fan award', 'fan awards']}>
          {awards.map(a => (
            <Box key={a.id} {...linkTo(WPBL_AWARDS_PATH)}
              onClickCapture={() => track(EVENTS.WPBL_AWARD_OPEN, { from: 'player', category: a.id })}
              aria-label={`2026 fan award: ${a.title}. See the results`}
              sx={{
                ...BAND_CHIP_SX,
                ...hoverOnly({ bgcolor: 'rgba(255,255,255,0.26)' }),
                '&:focus-visible': { outline: '2px solid #fff', outlineOffset: 2 },
              }}>
              <EmojiEvents aria-hidden sx={{ fontSize: '0.85rem', color: '#eab308' }} />
              Fan vote · {a.title}
            </Box>
          ))}
        </BandChips>
      ) : undefined}
      // Fills the band's own slack, and takes the role on screen so a two-way player's form line
      // follows the tab rather than contradicting the numbers beside it. Costs no height: the band's
      // height is set by the 84px portrait. `roles[roleIndex]`, not `role`, so the two cannot fall
      // out of step mid-swipe.
      //
      // NO HEADLINE RATES ON THE BAND. It can only ever show ONE role's numbers, and above `md` every
      // role is drawn with its own rates as the first columns of its own season line. What the band
      // keeps is what is true of the player rather than of a role. See desktopRoleBlock.
      aside={showBandHero ? (() => {
        const r = roles[roleIndex]
        const g = formGames(r)
        return <FormStrip title={`Last ${g.length} · ${r === 'pitching' ? 'IP' : 'H-AB'}`} games={g} />
      })() : undefined}
    />
  )
  const band = bandBlock()

  // Where the band and the scope toggle live, and whether the header shows the player's name.
  // Pinned on a desktop (a dialog is not short of height), and pinned while there is nothing to
  // scroll (loading, or a player with no stats), since a scroller around a spinner buys nothing.
  const noStats = !loading && !hasBatting && !hasPitching && !hasFielding
  const bandPinned = wide || noStats
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const els = bandEls.current.filter((e): e is HTMLDivElement => !!e)
    if (els.length === 0) { setBandHidden({}); return }
    // Each band is measured against ITS OWN SCROLLER, not the viewport. Against the viewport, a
    // card on its way in is "scrolled out" for as long as it is off screen: the desktop panel
    // slides in from the right edge and the phone sheet rises from the bottom, so for those 220ms
    // the header named the player, then snapped back to the club once the card had landed. The
    // scroller moves with the band, so the slide no longer reads as a scroll. A pane's scroller is
    // still what clips it, so "out" keeps meaning scrolled out of the sheet.
    const scrollerOf = (el: HTMLElement): HTMLElement | null => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p
      }
      return null
    }
    const onEntries = (entries: IntersectionObserverEntry[]) => {
      setBandHidden(prev => {
        let next = prev
        for (const e of entries) {
          const i = bandEls.current.indexOf(e.target as HTMLDivElement)
          // "Out" once less than a sliver shows: the name belongs in the header as soon as the
          // band stops saying it, not only once the last pixel of it has gone.
          const out = e.intersectionRatio < 0.15
          // Only a real change makes a new object, or every callback would re-render the page.
          if (i >= 0 && prev[i] !== out) next = { ...next, [i]: out }
        }
        return next
      })
    }
    // One observer per scroller, since an observer has one root (on a phone each role pane scrolls
    // itself; in the panel and the dialog the body does).
    const byRoot = new Map<HTMLElement | null, HTMLDivElement[]>()
    for (const el of els) {
      const root = scrollerOf(el)
      byRoot.set(root, [...(byRoot.get(root) ?? []), el])
    }
    const observers = [...byRoot].map(([root, group]) => {
      const io = new IntersectionObserver(onEntries, { root, threshold: [0, 0.15, 0.5, 1] })
      group.forEach(e => io.observe(e))
      return io
    })
    return () => observers.forEach(io => io.disconnect())
    // Re-observed when the set of panes changes; the elements themselves are stable between.
  }, [bandPinned, player.id, twoWay, pitcherFirst, loading])

  const panels = roles.map((r, i) => {
    const pane = paneFor(r)
    return (
      // `pt` answers to the role pills, because what sits directly under them is the rate strip:
      // full pane padding plus the optical space a large numeral carries above its digits would put
      // the widest gap on the card between the control and the numbers it controls.
      <Box key={r} sx={{ px: 2, pt: showTabs ? 1 : 2, pb: 2 }}>
        {/* The band bleeds to the pane's edges (it was full-width when pinned). The scope toggle
            is on the season caption below it (see lineCaption). */}
        {!bandPinned && (
          <Box sx={{ mx: -2, mt: showTabs ? -1 : -2, mb: 2 }}>
            {bandBlock(el => { bandEls.current[i] = el })}
          </Box>
        )}
        {pane.line(hasPostseason ? scopeNav : undefined)}
        {pane.season}
        {/* The desktop's order, for the reason given there. */}
        {pane.log}
        {/* Everything under the log is below the first screen of a phone, so it mounts once the
            sheet has finished rising instead of during it. See AfterShellEnters. */}
        <AfterShellEnters>
          {pane.matchups}
          {pane.profile}
          {pane.extras}
          {/* Last among the stats, as on the desktop: see desktopRoleBlock. */}
          {hasFielding && <FieldingLine ft={ft} positions={showTabs ? fieldedPositions : undefined} />}
          {/* Rendered even for a player with no line yet (see the no-stats branch below): someone
              who has been written about but has not logged a game is exactly the case where this
              is the most interesting thing on the page. Renders nothing when nobody has written
              about the player, which is most of the roster. */}
          <FanPhotoPlayerStrip playerId={player.id} players={players} />
          <PlayerClips playerId={player.id} />
          <WrittenAbout articles={writtenAbout} title={`Written about ${player.name}`} accent={color} wide />
        </AfterShellEnters>
      </Box>
    )
  })

  // Full club name where it fits, the nickname on a phone. The header row also carries the
  // Compare and Copy-link chips and the close button, and "New York Heights" plus those two
  // chips overran a 360px header and ellipsised the club to "New York Heig…". The nickname
  // ("Heights") is the same fact, shorter, and clears the row; both are the club, so this
  // reads as a compact label rather than a truncation.
  const clubEyebrow = team ? (
    // The side panel's header is as narrow as a phone's and carries the same two chips, but it
    // renders outside the panel's phone theme (it is the shell's chrome, not the card), so its
    // breakpoints see a desktop. It is told instead, or "San Francisco Firebells" ellipsises.
    mdUp && panel ? team.name : (
      <>
        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{wpblFullName(team)}</Box>
        <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>{team.name}</Box>
      </>
    )
  ) : 'Player'
  const eyebrow = bandPinned ? clubEyebrow : (
    <BandAwareEyebrow store={bandStore} index={roleIndex} name={player.name}>{clubEyebrow}</BandAwareEyebrow>
  )
  const actions = (
    <>
      <CompareChip player={player} roster={players} />
      <CopyLinkButton url={shareUrl} title={`Copy a link to ${player.name}`}
        onCopy={() => track(EVENTS.WPBL_SHARE_COPIED, { kind: 'player', playerId: player.id })} />
    </>
  )
  const body = (
    <StatCardContext.Provider value={cardEnv}>
      {/* Two sizings, because the sheet and the dialog are shaped differently, and the same
          arrangement the game card uses for the same reason.
          On a phone the sheet holds a definite height, so this fills it (`flex: 1`) and every
          percentage below resolves, which is what lets each role pane scroll itself and what
          gives the pager a slot to live in at all.
          Above sm the modal is content-height on purpose, so a short player sizes it down
          instead of forcing full height, and this is clamped rather than filled. `flex: 1`
          there would collapse the pane to nothing, since a flex item with a zero basis
          contributes nothing to an auto-height parent. */}
      {/* Busy while the panes are samples: a screen reader is told the card is still arriving
          rather than read a page of empty cells. */}
      <Box ref={contentRef} aria-busy={loading || undefined} sx={{
        display: 'flex', flexDirection: 'column', minHeight: 0,
        flex: { xs: '1 1 0%', sm: '0 1 auto' },
        maxHeight: { xs: 'none', sm: '100%' },
      }}>
      {/* Identity, on the club's own colours.
          The band takes the club's PRIMARY as its background: all four WPBL primaries are
          near-black (BOS #00281e, LA #000000, NY #091b47, SF #2d1747), so white text clears 12:1
          on every one of them and the wash of secondary across the right stays well under the
          point where it would stop being readable. The stripe along the bottom is the secondary
          at full strength, which is where each club's actual hue lives: orange, gold, sky, red.
          It carries the same 2px as the ring around the portrait sitting on it, deliberately, so
          the band reads as one object drawn in one weight rather than as a photo with a heavier
          rule under it.
          Deliberately NOT `wpblAccent`: that is the foreground-safe variant, built to be read
          as text on the page background. Here the colour IS the background. */}
      {/* `data-sheet-drag` makes this band the sheet's grab surface on a phone, and it is not
          decoration: this page is taller than the sheet, so its body is a real scroller, and a
          scroller takes ownership of a touch before the drag handler can. That would leave the
          small handle and the eyebrow bar as the only places a reader could pull the card back
          down. The band is the obvious thing to grab and the one block here nobody scrolls to
          READ, which is exactly the trade the attribute is for. See useSheetDrag. */}
      {/* PINNED ON A DESKTOP, SCROLLED ON A PHONE. It used to be pinned everywhere, which a phone could
          not afford: with the sheet's header and the scope toggle it held about 240px of an 812px
          screen still while the stats scrolled in what was left. On a phone it is now the first thing
          in each pane's scroller (see `panels`), and the sheet header takes the player's name once
          it has scrolled away (see `bandOut`), so whose numbers these are is never off screen. It
          stays a drag surface: at the top of the pane, where it is, a pull down closes the sheet. */}
      {bandPinned && band}

      {/* No loading branch: while the lines are in flight the panes below are drawn from samples
          (see skeletonPane), so the card has its finished shape from the first frame. */}
      {noStats ? (
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 2 }}>
          <Box sx={{ textAlign: 'center', py: 5, color: 'text.secondary' }}>
            <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, mb: 0.5 }}>No stats yet</Typography>
            <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled' }}>Season totals appear here once this player logs a game.</Typography>
          </Box>
          <FanPhotoPlayerStrip playerId={player.id} players={players} />
          <PlayerClips playerId={player.id} />
          <WrittenAbout articles={writtenAbout} title={`Written about ${player.name}`} accent={color} />
        </Box>
      ) : (
        <>
          {/* Regular / Playoffs / Both, for a player who actually played in the postseason. A
              card-level control, above the role pills and outside the pager's scroller, because it
              re-slices every number on the card (both roles) rather than switching between them.
              Pinned so it does not scroll away under the totals it governs. */}

          {showTabs && !wide && (
            /* The pinned strip the role pills live in, and its padding is not arbitrary: it matches
                Game Center's tab bar, which is the same control doing the same job over the same kind
                of pager.
                More padding below than above: the pill belongs to the chrome ABOVE it, not to the pane
                below, and with no bottom padding its edge would sit flush against the scroller's clip
                line, putting a row of stats sliced through the middle directly under the control, which
                reads as a broken layout rather than as content that continues. */
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
              {roles.map((r, i) => desktopRoleBlock(r, i === 0, i === roles.length - 1))}
              {/* Under everything, spanning, for the reason it always did: it is the one block
                  here that is neither a season fact nor a game, and a well-covered player put
                  346px of article cards against a rail with nothing like that much to say. */}
              <FanPhotoPlayerStrip playerId={player.id} players={players} />
              <PlayerClips playerId={player.id} />
              <Box sx={{ mt: 1 }}>
                <WrittenAbout articles={writtenAbout} title={`Written about ${player.name}`} accent={color} wide />
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
    </StatCardContext.Provider>
  )

  // THE FULL PAGE: the desktop layout as a page in the section's flow rather than a dialog over it.
  // Same card, same body, framed the way the full Game Center is (see DetailPageBar), at the width
  // the desktop dialog was measured at. The header names the club in full: a page has the room the
  // panel does not, and the band below already carries the name.
  if (layout === 'page') return (
    <Box component="article" sx={{ width: PLAYER_PAGE_W, ml: `calc((100% - ${PLAYER_PAGE_W}) / 2)`, pb: 4 }}>
      <WpblVisuallyHiddenH1>{player.name}</WpblVisuallyHiddenH1>
      <DetailPageBar onBack={onClose} eyebrow={team ? wpblFullName(team) : 'Player'} actions={actions} />
      <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: CARD_BORDER, borderRadius: 3, overflow: 'hidden' }}>
        {body}
      </Box>
    </Box>
  )

  return (
    <ModalShell
      eyebrow={eyebrow}
      onClose={onClose}
      // A fixed pair rather than a value derived from the content, so the dialog cannot resize under
      // the reader as the season totals land. The widest block on the card is the batting season
      // line (about 666px), then the batting game log (about 600), both comfortably inside the md
      // width; what the extra room buys is a fourteen-column log not read at its own minimum.
      // Re-measure against the SEASON LINE if a column is ever added to it. Through `chromePx`
      // because it is structure: spent raw against the desktop type scale it would wrap a long name
      // onto two lines.
      maxWidth={{ xs: chromePx(640), md: chromePx(880) }}
      zIndex={1600}
      actions={<>
        {panel && mdUp && onExpand && <ExpandButton onExpand={onExpand} title={`Open ${player.name}'s full page`} />}
        {actions}
      </>}
      // A sheet on a phone, like Game Center: this opens from a roster row, a leaderboard, a Home
      // chip and a shared link, and a close button in the far top corner is the furthest point on a
      // phone from the thumb holding it. So it comes up from the bottom edge with a handle and
      // swipes back down. Above sm a centred dialog is right.
      sheet
      // Constant height while it is a sheet, so it does not leap up the screen when the season
      // totals and game logs finish loading under the reader's thumb. Same reason as the game
      // card, whose box score lands the same way.
      sheetFill
      panel={panel}
      // A different player is a new opening: the panel rises over any dialog opened since it
      // first appeared, which is how a player picked in the series view lands on top of it.
      openKey={player.id}
      onBack={onBack}
      backLabel={backLabel}
    >
      {body}
    </ModalShell>
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


const sectionSx = { ...TYPE.label, color: 'text.secondary', mb: 1 } as const


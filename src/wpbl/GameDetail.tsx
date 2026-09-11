import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, CircularProgress, useMediaQuery } from '@mui/material'
import { supabase } from '../lib/supabase'
import { track, EVENTS } from '../lib/analytics'
import { fetchWpblAllPlayers, fetchWpblRoster, fetchWpblGameLines, fetchWpblGamePlays, fetchWpblGameTracking, fetchWpblGameDetails, fetchWpblGameRevisions, fetchWpblVideos, getCachedWpblVideos, fetchWpblArticles, getCachedWpblArticles, fetchWpblAllRunValuePlays, LIVE_POLL_MS } from './api'
import { WPBL_ACCENT, wpblAccent, wpblSurface, wpblFullName, outsToIp, playedInnings, formatGameTime, relativeDayLabel } from './constants'
import { seriesContext } from './derive/series'
import { canonicalFeedName } from './feedNames'
import { LiveBanner, useLiveGame, LIVE_RED } from './Live'
import { boxScoreRevision, formatRevisionDay, leagueDay } from './derive/feedHealth'
import { describeRevision, revisionOverflow } from './derive/gameRevisions'
import { useForegroundInterval } from './refresh'
import { wpblGameSlugFromPath } from './routes'
import { WpblGamePreview } from './GamePreview'
import { GameHighlightCard } from './Highlights'
import { GameStoryCard } from './Reading'
import { GameRecapView, preloadWinProb } from './RecapCard'
import LiveGameView from './LiveGameView'
import { useExperiments } from '../ExperimentsContext'
import { useWpblPlayerLink } from './LinkContext'
import { WpblVisuallyHiddenH1 } from './PageHeading'
import { wpblGameCard } from './ogCard'
import { ModalShell, SegNav, TapTip, TeamBadge, pressable, FOCUS_RING, useWpblDark, useWpblName, wpblFeatureName, chromePx, TAPPABLE } from './ui'
import SwipeableViews from './SwipeableViews'
import { parsePlay, runsOnPlay, endsInCalledThirdStrike } from './derive/playByPlay'
import { useUnits } from '../UnitsContext'
import { fmtSpeed, speedUnit } from '../lib/units'
import { prettyType } from './tracking'
import FeedDelayNote from './FeedDelayNote'
import type {
  WpblTeam, WpblGame, WpblPlayer, WpblBattingLine, WpblPitchingLine,
  WpblGamePlay, WpblPitchTracking, WpblVideo, WpblArticle, WpblGameDetails, WpblGameRevision,
  WpblCorrectionSource,
} from './types'

// Read-only game center. Fed entirely by the official-feed mirror (see wpbl-ingest):
// line score, a tabbed box score (batting / pitching, one team at a time), the
// play-by-play, and TrackMan pitch tracking. Player names open the player page. For an
// unplayed game it shows the matchup + first-pitch time.

type Tab = 'recap' | 'live' | 'box' | 'plays' | 'pitch'

// ─── which board a shared link opens on ───────────────────────────────────────
//
// A game URL is the most-shared thing the section produces: the Discord recaps, the Bluesky
// posts and the final-score cards all point at /wpbl/games/<slug>. Until this, every one of
// them landed the reader on whichever board this modal picks by default, so "look at the
// seventh" was not a thing anyone could send. The board is a state laid over the game's page
// rather than a page of its own, which is the section's rule for what belongs in a query
// param (see `urlFor` in WpblApp); seo.ts canonicalises the query away, so none of the five
// spellings can reach the index as a near-duplicate of the game.
const TABS: readonly Tab[] = ['recap', 'live', 'box', 'plays', 'pitch']

/** One of the five board names, or null for anything else. The string is captured by WpblApp
 *  at mount (see `pendingGameTab`) because `urlFor` rewrites a game's URL from its slug alone
 *  and drops the query before this modal exists; validating it is this file's half of the job,
 *  since only here is it known which boards a given game actually has. */
function asTab(raw: string | null | undefined): Tab | null {
  return raw && TABS.includes(raw as Tab) ? (raw as Tab) : null
}

// ─── Box-score column sets ─────────────────────────────────────────────────────
// Column order is importance-first: the classic box line (AB R H RBI BB SO) leads,
// then HR, then the situational extras (2B SB).
//
// Every column shows on every screen. A phone used to drop 2B and SB and let the pitching
// line scroll sideways, which meant the two things a reader most often reaches a box score
// for on a phone — did they double, did they steal — were the two the phone hid, and the
// pitching line could only be read by swiping. The width is solved by density instead (see
// denseTableSx), so nothing has to be dropped.
const BAT_COLS: { key: keyof WpblBattingLine; label: string }[] = [
  { key: 'ab', label: 'AB' }, { key: 'r', label: 'R' }, { key: 'h', label: 'H' },
  { key: 'rbi', label: 'RBI' }, { key: 'bb', label: 'BB' }, { key: 'so', label: 'SO' },
  { key: 'hr', label: 'HR' },
  { key: 'doubles', label: '2B' }, { key: 'sb', label: 'SB' },
]
const PIT_COLS: { key: keyof WpblPitchingLine; label: string }[] = [
  { key: 'h', label: 'H' }, { key: 'r', label: 'R' }, { key: 'er', label: 'ER' },
  { key: 'bb', label: 'BB' }, { key: 'so', label: 'SO' }, { key: 'hr', label: 'HR' },
  { key: 'pitches', label: 'P' },
]

// ─── Batting-line helpers (filter non-hitting pitchers, flag substitutes) ───────
// Positions arrive lowercase from the feed. A pure pitcher never bats in this league's
// DH games, so an all-zero "p" row is just clutter — drop it. Two-way players carry a
// combo position ("lf/p", "p/cf") and DID bat, so they are not pure pitchers and stay.
const PURE_PITCHER = new Set(['p', 'sp', 'rp', 'lhp', 'rhp'])
const isPurePitcher = (pos: string | null): boolean => !!pos && PURE_PITCHER.has(pos.toLowerCase())
const isPinchRole = (pos: string | null): boolean => { const p = pos?.toLowerCase(); return p === 'ph' || p === 'pr' }
const plateApps = (b: WpblBattingLine): number => b.ab + b.bb + b.hbp + b.sf + b.sh
// Did this batter come to the plate or reach the bases at all? A pinch runner who scored
// has no plate appearance but does have a run, so check baserunning too — otherwise we'd
// wrongly drop them.
const cameToBat = (b: WpblBattingLine): boolean => plateApps(b) > 0 || b.r > 0 || b.rbi > 0 || b.sb > 0 || b.cs > 0

// The batting rows to show, non-hitting pitchers removed, ordered by lineup slot with each
// slot's starter first and its substitutes (pinch hitters/runners, defensive replacements
// sharing the slot) following, flagged so the table can indent and mark them.
function buildBattingRows(batting: WpblBattingLine[]): { b: WpblBattingLine; isSub: boolean }[] {
  const shown = batting.filter(b => cameToBat(b) || !isPurePitcher(b.position))
  const bySlot = new Map<number, WpblBattingLine[]>()
  const noSlot: WpblBattingLine[] = []
  for (const b of shown) {
    if (b.batting_order == null) noSlot.push(b)
    else { const a = bySlot.get(b.batting_order) ?? []; a.push(b); bySlot.set(b.batting_order, a) }
  }
  const out: { b: WpblBattingLine; isSub: boolean }[] = []
  for (const slot of [...bySlot.keys()].sort((a, b) => a - b)) {
    // Starter leads the slot: a non-pinch role with the most plate appearances; the rest
    // (and any pinch role) are substitutes.
    const arr = bySlot.get(slot)!.slice().sort((x, y) =>
      Number(isPinchRole(x.position)) - Number(isPinchRole(y.position)) || plateApps(y) - plateApps(x))
    arr.forEach((b, i) => out.push({ b, isSub: i > 0 || isPinchRole(b.position) }))
  }
  for (const b of noSlot) out.push({ b, isSub: isPinchRole(b.position) })
  return out
}

// The feed spells names "Last, First"; flip to "First Last" for display.
const fmtFeedName = (n: string): string => {
  const [last, first] = n.split(',').map(s => s.trim())
  return first ? `${first} ${last}` : n
}

// ─── Table primitives (real <table> = auto-aligned columns that fill the width) ──
// Stat columns carry no fixed width, so with a shrink-to-fit name column they split
// the remaining width evenly and spread across the middle instead of hugging the edge.
function StatHead({ children, w = 30, dense = false }: { children: React.ReactNode; w?: number; dense?: boolean }) {
  return (
    <Box component="th" sx={{
      fontSize: dense ? '0.55rem' : '0.64rem', fontWeight: 700, color: 'text.disabled',
      textTransform: 'uppercase', letterSpacing: dense ? 0.1 : 0.4,
      textAlign: 'center', px: dense ? 0.1 : 0.4, py: 0.4,
      // No width floor in dense mode: fixed layout is doing the dividing, and a minWidth
      // would let the columns add up to more than the table is allowed to be.
      minWidth: dense ? 0 : w,
    }}>
      {children}
    </Box>
  )
}
function StatCell({ children, bold = false, dense = false }: { children: React.ReactNode; bold?: boolean; dense?: boolean }) {
  // A box score is mostly zeros; muting them (and dropping the bold on a 0) lets the real
  // numbers carry the eye instead of a wall of even-weight digits.
  const isZero = children === 0 || children === '0'
  return (
    <Box component="td" sx={{
      fontSize: dense ? '0.76rem' : '0.9rem', fontWeight: isZero ? 500 : bold ? 800 : 600,
      color: isZero ? 'text.disabled' : 'text.primary',
      textAlign: 'center', px: dense ? 0.1 : 0.4, py: dense ? 0.4 : 0.45,
      lineHeight: 1.2, fontVariantNumeric: 'tabular-nums',
    }}>
      {children}
    </Box>
  )
}

// ─── Scoreboard (team headline + line score in one) ─────────────────────────────
// One compact block instead of a tall full-name score header stacked on a separate line
// score that repeated the same teams and totals. The team name/logo lead each row; the R
// column IS the final/running score (large + winner-emphasised), so no vertical space is
// spent restating it. Team column shows the full "City Nickname" on desktop, the nickname
// alone on a phone, and the innings + R/H/E scroll horizontally if they overrun the width.
/**
 * The reference block: the facts about a game that are not the game.
 *
 * WHY IT IS AT THE FOOT OF THE RECAP AND NOT IN THE HEADER, which is where all of this used
 * to be. A reader opening a final on a phone got, above the fold and before anything else: a
 * ten-column grid, how long the game took, the weather, the umpires' names, a transcription
 * credit and a revision stamp. That is 268px of a 390x844 screen, about 43% of the sheet, and
 * nine different type treatments, none of which is why anybody opens a game. None of it is
 * junk; all of it is reference, wanted on the fifth visit and never on the first.
 *
 * ONE LABEL STYLE AND ONE VALUE STYLE, which is the other half of the same complaint. The four
 * things here used to be drawn four ways.
 *
 * THE CREDIT IS TIED TO ITS OWN DATA. Length, weather and the crew are RetroWPBL's, given with
 * permission, and the credit is the consideration: it renders whenever any of those do, in the
 * same block. Errors and the revision stamp are ours, off our own row, so a game with no
 * transcription yet shows those and no credit. Crediting them for our numbers would be worse
 * than not crediting them at all.
 *
 * IT DOES NOT REPEAT THE LINE SCORE. Errors lived here for one draft, while the line score was
 * dropping H and E on a phone; the line score kept them, so this does not carry them. One number
 * in two places is how the two come to disagree.
 */
function GameInfo({ game, details }: { game: WpblGame; details: WpblGameDetails | null }) {
  const facts: { label: string; value: string }[] = []

  if (details?.duration_minutes != null) {
    const h = Math.floor(details.duration_minutes / 60)
    facts.push({ label: 'Length', value: h > 0 ? `${h}h ${details.duration_minutes % 60}m` : `${details.duration_minutes}m` })
  }
  const weather = [
    details?.temp_f != null ? `${details.temp_f}°F` : null,
    details?.sky,
    // "none" is the transcriber saying they checked, which is not worth a line of its own.
    details?.precip && details.precip.toLowerCase() !== 'none' ? details.precip : null,
    details?.field_cond && details.field_cond.toLowerCase() !== 'dry' ? `${details.field_cond} field` : null,
  ].filter(Boolean).join(' · ')
  if (weather) facts.push({ label: 'Weather', value: weather })
  // `umpire_crew` and not the four positional columns: those are the assignment at first
  // pitch, and one game this season changed the plate umpire in the 6th, which left that
  // game's third official off the list entirely.
  const crew = details?.umpire_crew?.filter(Boolean) ?? []
  if (crew.length) facts.push({ label: crew.length > 1 ? 'Umpires' : 'Umpire', value: crew.join(', ') })
  /** Whether anything above came from RetroWPBL, which is what the credit is for. */
  const transcribed = facts.length > 0

  const revision = boxScoreRevision(game)
  if (revision) {
    facts.push({ label: 'Box score revised', value: formatRevisionDay(revision.on) })
  }
  if (!facts.length) return null

  return (
    <Box sx={{ px: 2, pt: 2.5, pb: 1 }}>
      <Typography sx={{
        fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1,
        color: 'text.disabled', mb: 0.75,
      }}>Game info</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 0.5 }}>
        {facts.map(f => (
          <Box key={f.label} sx={{ display: 'contents' }}>
            <Typography sx={{ fontSize: '0.78rem', color: 'text.disabled', whiteSpace: 'nowrap' }}>{f.label}</Typography>
            <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>{f.value}</Typography>
          </Box>
        ))}
      </Box>
      {transcribed && (
        <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', mt: 1 }}>
          Length, weather and the crew transcribed by{' '}
          <Box component="a" href="https://github.com/exu6jh/RetroWPBL" target="_blank" rel="noopener noreferrer"
            sx={{ color: 'inherit', textDecoration: 'underline' }}>RetroWPBL</Box>
          , used with permission.
        </Typography>
      )}
    </Box>
  )
}

/**
 * What the league changed about this game after it was final.
 *
 * The date alone has been on the page since v1.73.0, off `wpbl_games.source_updated_at`, and
 * the thing it could not say was WHAT changed. This is that, and it can only exist because the
 * nightly drift check writes the old scoring down before it repairs the mirror: nothing here is
 * recomputed, because after the repair there is nothing left to recompute it from.
 *
 * COLLAPSED, and that is not a default reached for out of habit. Nearly every game in this
 * season has been revised at some point, most revisions are a hit moving from one line to
 * another, and this sits at the foot of a recap somebody opened to read about a baseball game.
 * The summary line carries the only part that is news on its own, which is that there were
 * changes and how many.
 *
 * An empty `changes` on a stored revision is a real state, not a bug: the checker compares a
 * little more than it can write a sentence about, so a revision can move something the log has
 * no words for. Saying that plainly beats hiding the revision, because the date beside it is
 * already on the page and a reader who saw it deserves an answer.
 */
function RevisionLog({ revisions, gameId, away, home, names, onOpenPlayer }: {
  revisions: WpblGameRevision[]
  gameId: string
  away: WpblTeam | undefined
  home: WpblTeam | undefined
  /** The whole league, as everywhere else on this sheet. A revision stores the name the player
   *  had on the night it was written, and this is what keeps a later rename or merge from
   *  leaving one spelling of her here and another in the box score above. */
  names: Map<string, WpblPlayer>
  onOpenPlayer?: (p: WpblPlayer) => void
}) {
  const [open, setOpen] = useState(false)
  const dark = useWpblDark()
  if (!revisions.length) return null

  const clubs = { away: away ? wpblFullName(away) : null, home: home ? wpblFullName(home) : null }
  const total = revisions.reduce((t, r) => t + (r.change_count ?? 0), 0)

  return (
    <Box sx={{ px: 2, pb: 2 }}>
      <Box
        component="button"
        onClick={() => { setOpen(o => !o); if (!open) track(EVENTS.WPBL_REVISIONS_OPEN, { gameId, changes: total }) }}
        aria-expanded={open}
        sx={{
          ...pressable, ...TAPPABLE, width: '100%', textAlign: 'left', border: 0, borderRadius: 1,
          background: 'transparent', color: 'text.secondary', px: 0, py: 0.5,
          display: 'flex', alignItems: 'center', gap: 1, fontSize: '0.78rem',
          '&:focus-visible': FOCUS_RING,
        }}
      >
        <Box component="span" sx={{
          fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1,
          color: 'text.disabled',
        }}>Scoring changes</Box>
        <Box component="span" sx={{ color: 'text.disabled' }}>
          {total} {total === 1 ? 'change' : 'changes'} the league made after this game ended
        </Box>
        <Box component="span" sx={{ ml: 'auto', color: 'text.disabled' }}>{open ? '▾' : '▸'}</Box>
      </Box>

      {open && revisions.map(rev => {
        const lines = describeRevision(rev, clubs)
        const over = revisionOverflow(rev)
        const on = rev.source_updated_at ? leagueDay(rev.source_updated_at) : null
        return (
          <Box key={rev.id} sx={{ mt: 1.25 }}>
            <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', mb: 0.5 }}>
              {on ? `Revised ${formatRevisionDay(on)}` : 'Revised'}
            </Typography>
            {lines.length === 0 ? (
              <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>
                The league restamped this game without changing the box score.
              </Typography>
            ) : (
              <Box sx={{
                display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: 1.5, rowGap: 0.5,
              }}>
                {lines.map((l, i) => (
                  <Box key={i} sx={{ display: 'contents' }}>
                    <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', minWidth: 0 }}>
                      {l.who && (() => {
                        const who = l.playerId ? names.get(l.playerId) : undefined
                        return who && onOpenPlayer ? (
                          <Box
                            component="span" role="link" tabIndex={0}
                            onClick={() => onOpenPlayer(who)}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenPlayer(who) } }}
                            sx={{ ...pressable, color: dark ? WPBL_ACCENT : 'text.primary', fontWeight: 700, cursor: 'pointer' }}
                          >{who.name}</Box>
                        ) : <Box component="span" sx={{ fontWeight: 700 }}>{who?.name ?? l.who}</Box>
                      })()}
                      {l.who ? ' · ' : ''}{l.what}
                    </Typography>
                    <Typography sx={{
                      fontSize: '0.78rem', color: 'text.secondary', whiteSpace: 'normal',
                      textAlign: 'right', minWidth: 0,
                    }}>
                      <Box component="span" sx={{ color: 'text.disabled' }}>{l.before}</Box>
                      {' → '}
                      <Box component="span" sx={{ fontWeight: 700 }}>{l.after}</Box>
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
            {over > 0 && (
              <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', mt: 0.5 }}>
                and {over} more, not stored: this revision rewrote more of the game than the log keeps.
              </Typography>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

function Scoreboard({ away, home, game, awayWon, homeWon, onOpenTeam }: {
  away: WpblTeam; home: WpblTeam; game: WpblGame; awayWon: boolean; homeWon: boolean
  onOpenTeam?: (t: WpblTeam) => void
}) {
  const isMobile = useMediaQuery('(max-width:600px)')
  const isDark = useWpblDark()
  const decided = awayWon || homeWon
  // playedInnings drops the feed's phantom trailing inning (see innings.ts); the 7-column
  // floor is only about how wide the grid draws for a short or in-progress game.
  const lastInning = playedInnings(game.away_line, game.home_line)
  const innings = Math.max(lastInning, 7)
  const cols = Array.from({ length: innings }, (_, i) => i + 1)
  const runsByInning = (line: WpblGame['away_line'], n: number) =>
    line?.find(c => c.inning === n)?.runs
  // A home team that's already ahead never bats in the bottom of the final inning — the game
  // just ends. The feed still emits a {runs: 0} entry for that half, which would print as a
  // real "0" and imply a scoreless frame that was never played (the away staff's 6.0 IP in a
  // 7-inning game is the giveaway). Print the X a scorebook would. A walk-off takes the other
  // branch: the home team was tied or trailing going in, so it did bat, and its runs stand.
  // `lastInning` above is the inning that actually ended the game, not the 7-column floor,
  // so a shortened game still puts the X in the right column.
  const runsThrough = (line: WpblGame['away_line'], n: number) =>
    (line ?? []).reduce((t, c) => (c.inning <= n ? t + c.runs : t), 0)
  const homeDidNotBatLast = game.status === 'final' && lastInning > 0
    && runsThrough(game.home_line, lastInning - 1) > runsThrough(game.away_line, lastInning)
  const row = (team: WpblTeam, line: WpblGame['away_line'], runs: number | null, hits: number | null | undefined, errs: number | null | undefined, won: boolean, isHome = false) => {
    const accent = wpblAccent(team.id, isDark)
    // THE WINNING ROW IS TINTED IN THE CLUB'S OWN COLOUR, which is what carries the result now
    // that every number in the row is the same size. A line score is twelve numbers and the one
    // a reader came for is the R: making that bigger was one way to say so and this is the
    // quieter one, since the tint marks the whole row rather than competing with the innings
    // beside it. Same surface Home's club bands use, so a reader arriving from the scoreboard
    // meets the colour they tapped.
    return (
      <Box component="tr" sx={{
        borderTop: '1px solid', borderColor: 'divider',
        bgcolor: won ? wpblSurface(team.id, isDark) : 'transparent',
      }}>
        {/* Thin team-color stripe on the winning row; a transparent one on the loser keeps
            both rows aligned. */}
        <Box component="td" sx={{ py: 0.5, pr: 1.5, pl: 1, borderLeft: '3px solid', borderColor: won ? accent : 'transparent' }}>
          {/* The name opens the club. Only the NAME, not the whole cell and certainly not the
              row: the rest of the row is the innings, and a reader dragging that table
              sideways on a phone must not land on a team page for it. */}
          <Box
            {...(onOpenTeam ? pressable(() => onOpenTeam(team)) : {})}
            aria-label={onOpenTeam ? `${wpblFullName(team)} team page` : undefined}
            sx={{
              // `flex` + `fit-content`, NOT `inline-flex`. Both shrink-wrap, which is what
              // keeps the tap target off the rest of the cell, but an inline-level box sits on
              // the row's text baseline: it picks up the line box's descender space and the
              // badge rides high of the cell's centre. A block-level flex box has no baseline
              // to sit on and centres properly.
              display: 'flex', width: 'fit-content', alignItems: 'center', gap: 0.75, minWidth: 0,
              ...(onOpenTeam ? {
                cursor: 'pointer', borderRadius: 1, mx: -0.5, px: 0.5,
                ...TAPPABLE,
                ...FOCUS_RING,
              } : {}),
            }}
          >
            <TeamBadge team={team} size={24} />
            <Typography sx={{ fontSize: isMobile ? '0.86rem' : '0.95rem', fontWeight: won ? 800 : 600, lineHeight: 1.15, whiteSpace: 'nowrap', color: won || !decided ? 'text.primary' : 'text.secondary' }}>
              {isMobile ? team.name : wpblFullName(team)}
            </Typography>
          </Box>
        </Box>
        {/* Empty/scoreless innings sit muted so the innings that actually scored stand out. */}
        {cols.map(n => {
          const skipped = isHome && homeDidNotBatLast && n === lastInning
          const r = skipped ? undefined : runsByInning(line, n)
          return (
            <Box component="td" key={n} sx={{
              fontSize: '0.9rem', fontWeight: r ? 800 : 500, lineHeight: 1.2,
              color: r ? 'text.primary' : 'text.disabled',
              textAlign: 'center', px: 0.4, py: 0.45, fontVariantNumeric: 'tabular-nums',
            }}>{skipped ? 'X' : r == null ? '' : r}</Box>
          )
        })}
        <Box component="td" sx={{ width: 8 }} />
        {/* The final (R) carries the winner's team color for a pop that reinforces the result. */}
        <Box component="td" sx={{ textAlign: 'center', px: 0.4, py: 0.5 }}>
          <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', color: won ? accent : !decided ? 'text.primary' : 'text.secondary' }}>{runs ?? 0}</Typography>
        </Box>
        <StatCell>{hits ?? 0}</StatCell>
        <StatCell>{errs ?? 0}</StatCell>
      </Box>
    )
  }
  return (
    <Box sx={{ overflowX: 'auto', px: 2, pt: 1 }}>
      <Box component="table" sx={scoreTableSx}>
        <Box component="thead">
          <Box component="tr">
            <Box component="th" />
            {cols.map(n => <StatHead key={n} w={18}>{n}</StatHead>)}
            <Box component="th" sx={{ width: 8 }} />
            <StatHead w={24}>R</StatHead>
            <StatHead w={22}>H</StatHead>
            <StatHead w={22}>E</StatHead>
          </Box>
        </Box>
        <Box component="tbody">
          {row(away, game.away_line, game.away_score, game.away_hits, game.away_errors, awayWon)}
          {row(home, game.home_line, game.home_score, game.home_hits, game.home_errors, homeWon, true)}
        </Box>
      </Box>
    </Box>
  )
}

// ─── One team's box score (batting + pitching) ─────────────────────────────────
function TeamBox({ team, batting, pitching, names, onOpenPlayer }: {
  team: WpblTeam
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
  names: Map<string, WpblPlayer>
  onOpenPlayer?: (p: WpblPlayer) => void
}) {
  const isDark = useWpblDark()
  const isMobile = useMediaQuery('(max-width:600px)')
  const color = wpblAccent(team.id, isDark)
  const shortName = useWpblName()
  const playerLink = useWpblPlayerLink()
  const batCols = BAT_COLS
  // Desktop keeps the shared viewport cap; the phone uses the tighter box budget.
  const boxName = (n: string) => (isMobile ? wpblFeatureName(n, BOX_NAME_MAX) : shortName(n))
  // A substitute's name is indented under its starter and led by a ↳ marker.
  const nameCell = (playerId: string, suffix?: React.ReactNode, isSub = false) => {
    const p = names.get(playerId)
    const clickable = p && onOpenPlayer
    return (
      <Box component="td" sx={{ ...nameCellSx, ...(isMobile ? denseNameSx : {}), pl: isSub ? (isMobile ? 1.1 : 1.75) : (isMobile ? 0.3 : 0.4) }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, overflow: 'hidden' }}>
          {/* The ↳ marker is desktop-only. On a phone it and its gap cost about fourteen
              pixels of a hundred-pixel column, which is the difference between reading
              "S. Robinson" and reading "S. Robi…". The indent alone still reads as a
              substitute, the way a printed box score has always done it. */}
          {isSub && !isMobile && <Box component="span" aria-hidden sx={{ color: 'text.disabled', fontSize: '0.72rem', flexShrink: 0, lineHeight: 1 }}>↳</Box>}
          <Typography
            component="span"
            {...(clickable ? playerLink(p!, onOpenPlayer) : {})}
            sx={{ fontSize: isMobile ? '0.74rem' : '0.86rem', fontWeight: 600, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...(clickable ? { cursor: 'pointer', '&:hover': { color } } : {}) }}
          >
            {p ? boxName(p.name) : '—'}
          </Typography>
          {suffix}
        </Box>
      </Box>
    )
  }
  // Non-hitting pitchers dropped, subs ordered under their starter (see buildBattingRows).
  const battingRows = buildBattingRows(batting)
  const batTotals = battingRows.reduce((t, { b }) => {
    for (const c of batCols) (t as any)[c.key] = ((t as any)[c.key] ?? 0) + (Number(b[c.key]) || 0)
    return t
  }, {} as Record<string, number>)

  // The same row the batting table has always had, which is what a reader asked for: the
  // pitching half stopped at the last reliever and left the team's line to be added up by eye.
  //
  // IP IS SUMMED AS OUTS AND CONVERTED ONCE. Adding the printed values is the oldest arithmetic
  // trap in a box score: 6.2 + 0.1 is seven innings, not 6.3, and nothing in the string says
  // which base it is written in. `outsToIp` is the only spelling of that conversion here.
  const pitOuts = pitching.reduce((n, p) => n + (Number(p.outs) || 0), 0)
  const pitTotals = PIT_COLS.map(c => {
    const vals = pitching.map(p => p[c.key])
    // One missing value makes the column unsummable. Every cell above prints "—" when the feed
    // sent nothing, and a total that quietly leaves a reliever's pitch count out is a wrong
    // number wearing a total's clothes, where a dash is a fact.
    return vals.some(v => v == null) ? null : vals.reduce<number>((n, v) => n + (Number(v) || 0), 0)
  })

  if (battingRows.length === 0 && pitching.length === 0) return null

  return (
    <Box>
      {battingRows.length > 0 && (
        <Box sx={{ overflowX: 'auto', mb: 1.5 }}>
          <Box component="table" sx={isMobile ? denseTableSx : tableSx}>
            <Box component="thead">
              <Box component="tr">
                <Box component="th" sx={{ ...nameHeadSx, ...(isMobile ? denseNameSx : {}) }}>Batting</Box>
                {batCols.map(c => <StatHead key={c.key as string} dense={isMobile}>{c.label}</StatHead>)}
              </Box>
            </Box>
            <Box component="tbody">
              {battingRows.map(({ b, isSub }) => (
                <Box component="tr" key={b.id} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
                  {nameCell(b.player_id, b.position ? <Typography component="span" sx={{ ...posSx, textTransform: 'uppercase' }}>{b.position}</Typography> : null, isSub)}
                  {batCols.map(c => <StatCell key={c.key as string} dense={isMobile} bold={c.key === 'h'}>{Number(b[c.key]) || 0}</StatCell>)}
                </Box>
              ))}
              <Box component="tr" sx={{ borderTop: '2px solid', borderColor: color }}>
                <Box component="td" sx={{ ...nameHeadSx, ...(isMobile ? denseNameSx : {}), color: 'text.secondary', fontSize: isMobile ? '0.72rem' : '0.8rem', fontWeight: 800, textTransform: 'none', letterSpacing: 0 }}>Totals</Box>
                {batCols.map(c => <StatCell key={c.key as string} dense={isMobile} bold>{batTotals[c.key as string] ?? 0}</StatCell>)}
              </Box>
            </Box>
          </Box>
        </Box>
      )}

      {pitching.length > 0 && (
        <Box sx={{ overflowX: 'auto' }}>
          <Box component="table" sx={isMobile ? denseTableSx : tableSx}>
            <Box component="thead">
              <Box component="tr">
                <Box component="th" sx={{ ...nameHeadSx, ...(isMobile ? denseNameSx : {}) }}>Pitching</Box>
                <StatHead w={32} dense={isMobile}>IP</StatHead>
                {PIT_COLS.map(c => <StatHead key={c.key as string} dense={isMobile}>{c.label}</StatHead>)}
              </Box>
            </Box>
            <Box component="tbody">
              {pitching.map(p => (
                <Box component="tr" key={p.id} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
                  {nameCell(p.player_id, p.decision ? <Typography component="span" sx={{ fontSize: '0.56rem', fontWeight: 700, color, lineHeight: 1 }}>({p.decision})</Typography> : null)}
                  <StatCell dense={isMobile} bold>{outsToIp(p.outs)}</StatCell>
                  {PIT_COLS.map(c => <StatCell key={c.key as string} dense={isMobile}>{p[c.key] == null ? '—' : Number(p[c.key])}</StatCell>)}
                </Box>
              ))}
              {/* Drawn exactly like the batting totals: same rule above it in the club's colour,
                  same weight, same label, because they are the same thing and a reader who has
                  learned to look for one at the bottom of a table should find the other. */}
              <Box component="tr" sx={{ borderTop: '2px solid', borderColor: color }}>
                <Box component="td" sx={{ ...nameHeadSx, ...(isMobile ? denseNameSx : {}), color: 'text.secondary', fontSize: isMobile ? '0.72rem' : '0.8rem', fontWeight: 800, textTransform: 'none', letterSpacing: 0 }}>Totals</Box>
                <StatCell dense={isMobile} bold>{outsToIp(pitOuts)}</StatCell>
                {PIT_COLS.map((c, i) => (
                  <StatCell key={c.key as string} dense={isMobile} bold>{pitTotals[i] ?? '—'}</StatCell>
                ))}
              </Box>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  )
}

// ─── Play-by-play ──────────────────────────────────────────────────────────────
//
// Whether the reader has asked for every half-inning open. Per reader and per browser, not per
// game: a fourteen-click expansion is the same nuisance on the next game as on this one.
const PBP_EXPAND_KEY = 'wpbl_pbp_expand_all'
const readPbpExpandAll = (): boolean => {
  try { return localStorage.getItem(PBP_EXPAND_KEY) === '1' } catch { return false }
}
const writePbpExpandAll = (on: boolean) => {
  try { localStorage.setItem(PBP_EXPAND_KEY, on ? '1' : '0') } catch { /* private mode / quota */ }
}

// The feed logs each plate appearance as a terse pitch string like "BBFBP" — one letter
// per pitch. The letters are cryptic on their own (and the feed's own `type`/`description`
// are unreliable: it tags 'K' as "Unknown pitch code" and 'P' as "Pitchout"), so we decode
// them ourselves: color each pip and spell the full sequence out in a hover tooltip.
const PITCH_CODES: Record<string, { label: string; color: string }> = {
  B: { label: 'Ball',            color: '#16a34a' }, // green
  K: { label: 'Called strike',   color: '#dc2626' }, // red
  S: { label: 'Swinging strike', color: '#dc2626' }, // red
  F: { label: 'Foul',            color: '#d97706' }, // amber
  H: { label: 'Hit by pitch',    color: '#9333ea' }, // purple
  P: { label: 'In play',         color: '#2563eb' }, // blue
}

function PitchSequence({ seq, calledThirdStrike }: {
  seq: string
  /** Whether the last pitch was a called third strike, which is the one pitch that earns the
   *  scorekeeper's backwards K. See endsInCalledThirdStrike. */
  calledThirdStrike?: boolean
}) {
  const pitches = [...seq].map((code, i) => ({
    code, i, ...(PITCH_CODES[code] ?? { label: code, color: 'inherit' }),
  }))
  // The pitch the glyph is about says what it is, so the tooltip explains the mirroring rather
  // than leaving it as a typographic in-joke: every other K in the list reads "Called strike".
  const last = pitches[pitches.length - 1]
  if (calledThirdStrike && last?.code === 'K') last.label = 'Called third strike'
  const tip = (
    <Box sx={{ py: 0.25 }}>
      {pitches.map(p => (
        <Box key={p.i} sx={{ fontSize: '0.72rem', lineHeight: 1.5, whiteSpace: 'nowrap' }}>
          <Box component="span" sx={{ color: 'text.disabled', mr: 0.75 }}>{p.i + 1}.</Box>
          <Box component="span" sx={{ color: p.color, fontWeight: 700 }}>{p.label}</Box>
        </Box>
      ))}
    </Box>
  )
  return (
    <TapTip title={tip} sx={{
      display: 'flex', gap: '2px', flexShrink: 0,
      fontFamily: 'monospace', fontSize: '0.66rem', fontWeight: 700, lineHeight: 1.6,
    }}>
        {pitches.map(p => (
          // THE BACKWARDS K IS A STRIKEOUT LOOKING, not a called strike, so only the last
          // pitch of one is mirrored. Every K used to be, which is 1,480 pitches wearing the
          // notation for the 96 that earn it: a single on 0-2 read as a strikeout.
          <Box key={p.i} component="span" sx={{
            color: p.color,
            ...(calledThirdStrike && p.i === pitches.length - 1 && p.code === 'K'
              && { display: 'inline-block', transform: 'scaleX(-1)' }),
          }}>{p.code}</Box>
      ))}
    </TapTip>
  )
}

function PlayByPlay({ plays, teams, game, names, onOpenPlayer }: {
  plays: WpblGamePlay[]; teams: Map<string, WpblTeam>; game: WpblGame
  /** This game's two rosters, by player id, so the batter each play opens with can be opened.
   *  Resolved on `batter_id` rather than by matching the printed name: the feed fills that
   *  column on all but a couple of percent of plays, and a name match would have to survive
   *  the shortening the line has already applied to it. */
  names: Map<string, WpblPlayer>
  onOpenPlayer?: (p: WpblPlayer) => void
}) {
  const shortName = useWpblName()
  const playerLink = useWpblPlayerLink()
  // The two clubs, for the running score on each half-inning header. Off the game rather than
  // off the plays: a half-inning has one batting club and the score has two.
  const awayTeam = teams.get(game.away_team_id)
  const homeTeam = teams.get(game.home_team_id)
  // Every name the feed uses in this game, mapped to the roster's own spelling of it. The two
  // disagree on seven players (see feedNames.ts), and the play log is where a reader meets the
  // feed's version: the same at-bat reads "Emi Saki" in the sentence and Emi Saiki in the box
  // score one tab across. Built from the plays rather than the roster, so a name only shortens
  // when it is genuinely a player in this game.
  const canon = useMemo(() => {
    const feed = [...new Set(plays.flatMap(p => [p.batter_name, p.pitcher_name]).filter(Boolean) as string[])]
    return new Map(feed.map(n => [n, canonicalFeedName(n, names.values())]))
  }, [plays, names])
  // Longest first so "Elodie Ciamarro" is replaced before a bare "Ciamarro" could match part
  // of it.
  const shortenNames = useMemo(() => {
    const feed = [...canon.keys()].sort((a, b) => b.length - a.length)
    if (!feed.length) return (t: string) => t
    const re = new RegExp(feed.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
    return (t: string) => t.replace(re, m => shortName(canon.get(m) ?? m))
  }, [canon, shortName])
  // Group consecutive plays into half-innings, in order.
  //
  // The half-inning's run count comes from the line score rather than from summing the plays.
  //
  // The reason given here used to be that the feed leaves runs_scored at 0 on plays that
  // pushed a runner home, naming wild pitches, errors and fielder's choices. That is not what
  // happens: no play with runs_scored = 0 mentions anyone scoring, on any of the 1,352 rows in
  // hand, and wild pitches and fielder's choices carry their runs correctly. The whole gap was
  // home runs, where the field counts the runners and omits the batter. runsOnPlay() now
  // accounts for that, so the badges below are right.
  //
  // The line score stays the source for the half-inning total anyway, because it is the
  // number printed in the box score directly above and the two must not disagree.
  const groups = useMemo(() => {
    const scored = (inning: number, half: string) =>
      (half === 'top' ? game.away_line : game.home_line)?.find(c => c.inning === inning)?.runs ?? 0
    // Drop the same phantom inning the line score drops, so the two tabs of one box score
    // can't disagree about how long the game was. Only for a finished game, and only when
    // there's a line score to trust: a live game's plays can legitimately run ahead of it.
    const played = playedInnings(game.away_line, game.home_line)
    const inGame = (p: WpblGamePlay) => game.status !== 'final' || played === 0 || p.inning <= played
    const gs: {
      key: string; label: string; teamId: string | null; runs: number
      /** The score AFTER this half-inning, away then home, matching the line score's own order. */
      awayTo: number; homeTo: number
      plays: WpblGamePlay[]
    }[] = []
    // Running totals, carried down the list. A collapsed play-by-play is fourteen rows saying
    // how many runs each half produced, which is the delta and never the state: a reader
    // scrolling to the 6th could see that two scored there and not what the score was. Summed
    // here rather than from the plays for the same reason the badge is (see above): the line
    // score is the number printed in the header directly above, and the two must not disagree.
    let awayTo = 0, homeTo = 0
    for (const p of plays) {
      if (!inGame(p)) continue
      const key = `${p.inning}-${p.half}`
      const last = gs[gs.length - 1]
      if (!last || last.key !== key) {
        const half = p.half === 'top' ? 'Top' : 'Bottom'
        const ord = p.inning === 1 ? '1st' : p.inning === 2 ? '2nd' : p.inning === 3 ? '3rd' : `${p.inning}th`
        const runs = scored(p.inning, p.half)
        if (p.half === 'top') awayTo += runs; else homeTo += runs
        gs.push({ key, label: `${half} ${ord}`, teamId: p.team_id, runs, awayTo, homeTo, plays: [p] })
      } else { last.plays.push(p) }
    }
    return gs
  }, [plays, game.away_line, game.home_line, game.status])

  // Innings start collapsed so the tab opens compact (and the modal can size down to it); the
  // reader expands the half-innings they care about. Tracking what's OPEN — not what's closed —
  // means innings that arrive later on a live game default closed too, without extra bookkeeping.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (key: string) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  // Expand all, and REMEMBERED, which is the half that makes it worth having. A reader who
  // wants the whole log wants it on the next game too, and fourteen half-innings to click is
  // the complaint whether it is one game or every game. Stored per reader in localStorage like
  // the units and ERA-basis settings, defaulting off so the tab still opens compact for
  // everyone who has not asked.
  const [expandAll, setExpandAll] = useState(readPbpExpandAll)
  const allOpen = groups.length > 0 && groups.every(g => expanded.has(g.key))
  const toggleAll = () => {
    const next = !allOpen
    setExpandAll(next)
    writePbpExpandAll(next)
    setExpanded(next ? new Set(groups.map(g => g.key)) : new Set())
  }

  // A live game gains half-innings while the reader is watching, and with the preference on
  // those have to arrive open. Only the ones never seen before: reapplying it to every key
  // would reopen a half-inning the reader had just closed by hand, every two minutes.
  const seenGroups = useRef<Set<string>>(new Set())
  useEffect(() => {
    const fresh = groups.map(g => g.key).filter(k => !seenGroups.current.has(k))
    if (!fresh.length) return
    for (const k of fresh) seenGroups.current.add(k)
    if (expandAll) setExpanded(prev => new Set([...prev, ...fresh]))
  }, [groups, expandAll])

  if (plays.length === 0) {
    return <EmptyBody title="No play-by-play yet" hint="The feed's play log appears here once the game begins." />
  }
  return (
    /* A MEASURE, because this is a list and a list has nothing to spend extra width on.
       The same rule and the same number as the section's own list pages in WpblApp: when the
       card was 520px wide this pane took whatever it was given, and once the card grew to
       1050 for the box score's sake, a collapsed half-inning became "TOP 1ST · NY BATTING" at
       one end of a thousand pixels and "1 run" at the other. Schedule, Standings and Teams hit
       exactly this in v1.58.0 and the answer was to size the column against its own type
       again. Recap and Box Score deliberately do NOT take a measure: a win-probability chart
       and two nine-column tables are the things that can actually use the room.

       It leaves the expanded prose better off too, at roughly 50 characters a line rather than
       66, which is nearer the middle of a comfortable measure than the top of it. */
    <Box sx={{ p: 2, maxWidth: chromePx(720), mx: 'auto' }}>
      {/* One control, right-aligned above the log, in the weight of the half-inning headings it
          operates rather than as a button competing with them. It says what it will DO, so it
          reads "Collapse all" only once everything actually is open, however that happened. */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.5 }}>
        <Box
          {...pressable(toggleAll)}
          aria-label={allOpen ? 'Collapse every half-inning' : 'Expand every half-inning'}
          sx={{
            ...FOCUS_RING, display: 'inline-flex', alignItems: 'center', gap: 0.4,
            px: 0.5, py: 0.25, borderRadius: 1, cursor: 'pointer',
            fontSize: '0.68rem', fontWeight: 800, letterSpacing: 0.6,
            textTransform: 'uppercase', color: 'text.secondary', userSelect: 'none',
            '@media (hover: hover)': { '&:hover': { color: 'text.primary' } },
          }}
        >
          <Box component="span" aria-hidden sx={{ fontSize: '0.6rem', transition: 'transform 0.15s', transform: allOpen ? 'rotate(90deg)' : 'none' }}>▶</Box>
          {allOpen ? 'Collapse all' : 'Expand all'}
        </Box>
      </Box>
      {groups.map(g => {
        const team = g.teamId ? teams.get(g.teamId) : undefined
        const open = expanded.has(g.key)
        return (
          <Box key={g.key} sx={{ mb: 1.25 }}>
            <Box
              {...pressable(() => toggle(g.key))}
              aria-expanded={open}
              sx={{
                ...FOCUS_RING,
                display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'pointer',
                position: 'sticky', top: 0, bgcolor: 'background.paper', py: 0.5, zIndex: 1,
                borderBottom: '1px solid', borderColor: 'divider',
                '&:hover .pbpChevron': { color: 'text.secondary' },
              }}
            >
              <Box className="pbpChevron" sx={{
                fontSize: '0.6rem', color: 'text.disabled', width: '0.75rem', flexShrink: 0,
                transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'none',
              }}>▶</Box>
              {team && <TeamBadge team={team} size={18} />}
              {/* The label gives way, not the score. It fits at 320px today and the reader's
                  Large text setting multiplies every rem on this row, so the one thing that
                  must survive that is the number the row exists to show. */}
              <Typography noWrap sx={{ minWidth: 0, fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'text.secondary' }}>
                {g.label}{team ? ` · ${team.abbr} batting` : ''}
              </Typography>
              {/* THE SCORE AFTER THIS HALF, and the runs that made it. The list used to carry
                  only the runs, which is the delta and never the state: a reader scrolling to
                  the 6th could see that two scored there and not what the score was.
                  "+2" rather than "2 runs" because both now share the right edge of a row that
                  is already a chevron, a badge and "BOTTOM 1ST · LA BATTING" wide on a phone.
                  AWAY FIRST, matching the line score directly above, and the club that just
                  batted is named in the same row, so the first scoring half says which number
                  is whose. The aria-label spells it out for anyone the layout cannot. */}
              <Box component="span" sx={{
                ml: 'auto', display: 'inline-flex', alignItems: 'baseline', gap: 0.6, flexShrink: 0,
              }}>
                {g.runs > 0 && (
                  <Box component="span" sx={{ fontSize: '0.62rem', fontWeight: 800, color: '#16a34a' }}>
                    +{g.runs}
                  </Box>
                )}
                <Box
                  component="span"
                  aria-label={`${awayTeam?.abbr ?? 'Away'} ${g.awayTo}, ${homeTeam?.abbr ?? 'Home'} ${g.homeTo} after this half-inning`}
                  sx={{
                    fontSize: '0.68rem', fontWeight: 700, color: 'text.disabled',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >{g.awayTo}–{g.homeTo}</Box>
              </Box>
            </Box>
            {open && (
              <Box sx={{ mt: 0.75 }}>
                {g.plays.map((p, i) => {
                  const parsed = parsePlay(p.narrative, p.batter_name, shortenNames)
                  // The feed sends a handful of plays with no narrative at all. Drawn, they are
                  // an empty bordered row mid-inning, which reads as a play that failed to load.
                  if (parsed.kind === 'blank') return null
                  // A substitution is roster bookkeeping between at-bats. Given the same
                  // weight as a play it reads like one, so it gets its own quieter line.
                  if (parsed.kind === 'substitution') {
                    return (
                      <Box key={i} sx={{
                        py: 0.4, pl: 1, borderLeft: '2px solid', borderColor: 'divider',
                      }}>
                        <Typography sx={{
                          fontSize: '0.72rem', fontStyle: 'italic', color: 'text.disabled', lineHeight: 1.35,
                        }}>
                          {parsed.what}
                        </Typography>
                      </Box>
                    )
                  }
                  return (
                    // `runsOnPlay`, NOT `is_scoring_play`. The feed's flag is exactly
                    // `runs_scored > 0` and `runs_scored` never counts the batter, so a SOLO
                    // HOME RUN is flagged false and drew as an ordinary play: the green rail
                    // and tint stopped at the one hit that is always worth marking, while the
                    // "+1" beside it, which reads `runsOnPlay`, said a run had scored. One row
                    // disagreeing with itself. Reported by a reader, Sep 9, 2026, and it is the
                    // fourth surface this same field has caught (see CLAUDE.md).
                    <Box key={i} sx={{
                      display: 'flex', gap: 1, py: 0.6, pl: 1, borderLeft: '2px solid',
                      borderColor: runsOnPlay(p) > 0 ? '#22c55e' : 'divider',
                      bgcolor: runsOnPlay(p) > 0 ? 'rgba(34,197,94,0.06)' : 'transparent',
                    }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        {/* Who did what, on one line. The batter is the thing being scanned
                            for down the column, so it carries the weight; the outcome sits in
                            normal text beside it rather than as one undifferentiated sentence. */}
                        <Typography sx={{ fontSize: '0.82rem', lineHeight: 1.35 }}>
                          {parsed.who && (() => {
                            // parsePlay only fills `who` when the narrative opens with THIS
                            // play's batter, so the id on the row is the right person; a
                            // runner-only play leaves it null and nothing here is clickable.
                            const batter = p.batter_id ? names.get(p.batter_id) : undefined
                            const open = batter && onOpenPlayer ? () => onOpenPlayer(batter) : undefined
                            const link = batter && open ? playerLink(batter, onOpenPlayer) : {}
                            return (
                              <Box component="span" {...('href' in link ? link : pressable(open))} sx={{
                                fontWeight: 700,
                                ...(open ? {
                                  ...FOCUS_RING, cursor: 'pointer', borderRadius: 0.5,
                                  '@media (hover: hover)': { '&:hover': { textDecoration: 'underline' } },
                                } : {}),
                              }}>{shortName(batter?.name ?? canon.get(parsed.who) ?? parsed.who)}</Box>
                            )
                          })()}
                          {parsed.who && ' '}
                          {parsed.what}
                          {p.corrected_source && <SourceMark source={p.corrected_source} />}
                          {runsOnPlay(p) > 0 && (
                            <Box component="span" sx={{ ml: 0.5, fontSize: '0.66rem', fontWeight: 800, color: '#16a34a' }}>
                              +{runsOnPlay(p)}
                            </Box>
                          )}
                        </Typography>
                        {/* Runners, quieter and condensed. Same information, roughly half the
                            words, and no longer competing with the batter for attention. */}
                        {parsed.detail && (
                          <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.35, color: 'text.secondary', mt: 0.15 }}>
                            {parsed.detail}
                          </Typography>
                        )}
                      </Box>
                      {/* The count used to sit mid-sentence, so it landed in a different place
                          on every row. Pulled out to the pitch column, where it lines up.
                          ONE BASELINE, not two nudges: the count and the pips used to be held
                          level by a 2px top margin on one and a fitted line-height on the
                          other, which is a fixed offset between two things whose sizes both
                          move with the reader's text scale. */}
                      <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                        {parsed.count && (
                          <Typography sx={{
                            fontSize: '0.66rem', fontWeight: 700, color: 'text.disabled',
                            fontVariantNumeric: 'tabular-nums', lineHeight: 1.6,
                          }}>
                            {parsed.count}
                          </Typography>
                        )}
                        {p.pitch_sequence && (
                          <PitchSequence
                            seq={p.pitch_sequence}
                            calledThirdStrike={endsInCalledThirdStrike(p.narrative, p.pitch_sequence)}
                          />
                        )}
                      </Box>
                    </Box>
                  )
                })}
              </Box>
            )}
          </Box>
        )
      })}
      <SourceNote plays={plays} />
    </Box>
  )
}

/**
 * The mark on a play the league did not account for itself.
 *
 * A DAGGER AND NOT A CHIP, and that is the whole of the design. Thirteen consecutive rows of
 * this game are transcribed, so anything with a background or a border would turn New York's
 * sixth and seventh into a block of decoration and make the transcription look like the
 * headline rather than the footnote it is. A dagger is the printer's mark for exactly this, it
 * costs one character, and the sentence explaining it sits at the foot of the list where a
 * reader goes when they want to know.
 *
 * IT CARRIES ITS OWN NAME, because the mark is invisible to a screen reader and useless to
 * anybody who cannot see an 8px glyph. The title is what a pointer gets; the visually hidden
 * span is what everything else gets, and it reads as a sentence rather than as a symbol.
 */
function SourceMark({ source }: { source: WpblCorrectionSource }) {
  const what = SOURCE_WORDS[source]
  return (
    <>
      <Box component="span" aria-hidden title={what} sx={{
        ml: 0.4, fontSize: '0.62rem', verticalAlign: 'super',
        color: 'text.disabled', cursor: 'help',
      }}>&dagger;</Box>
      <Box component="span" sx={VISUALLY_HIDDEN}>{` (${what})`}</Box>
    </>
  )
}

/** What a source means, in the words a reader would want rather than the vocabulary
 *  docs/PLAY_VALIDATION.md uses internally: "external" is not a word anybody wants at the foot
 *  of a play.
 *
 *  TWO PHRASINGS, because the same sentence cannot do both jobs. The mark sits on ONE play and
 *  says "this play"; the footnote counts them and has to say "these". Written once as a phrase
 *  that reads either way ("transcribed by RetroWPBL") plus the clause each needs. */
const SOURCE_WORDS: Readonly<Record<WpblCorrectionSource, string>> = {
  video:    'corrected against video',
  derived:  'reconstructed from the rest of the inning',
  external: 'transcribed by RetroWPBL',
  league:   "corrected against the league's own box score",
}

/** The clause the footnote adds, where the count makes the reason worth spelling out. */
const SOURCE_WHY: Readonly<Partial<Record<WpblCorrectionSource, (n: number) => string>>> = {
  external: n => `, which the league published with no account of ${n === 1 ? 'it' : 'them'}`,
}

const VISUALLY_HIDDEN = {
  position: 'absolute', width: '1px', height: '1px', overflow: 'hidden',
  clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap',
} as const

/**
 * What the daggers mean, once, at the foot of the play-by-play.
 *
 * WHY THIS EXISTS AT ALL. The Aug 20, 2026 game showed two Katherine Murphy singles against a
 * box score crediting her one, and a reader asked. Both numbers were right about their own
 * source: the league published the whole of New York's sixth and seventh as rows carrying a
 * pitcher and a pitch sequence and nothing else, and `fill-wpbl-play-gaps` filled them from
 * RetroWPBL's independent transcription. Two accounts of one game disagree about that at-bat,
 * which is a real and unresolved thing, and the page was presenting it as one account that
 * did not add up.
 *
 * It counts the plays rather than naming them, and it renders nothing at all when the league
 * accounted for the whole game, which is every game but two.
 */
function SourceNote({ plays }: { plays: WpblGamePlay[] }) {
  const counts = new Map<WpblCorrectionSource, number>()
  for (const p of plays) {
    if (!p.corrected_source) continue
    counts.set(p.corrected_source, (counts.get(p.corrected_source) ?? 0) + 1)
  }
  if (counts.size === 0) return null
  return (
    <Box sx={{ mt: 1.5, px: 1, display: 'flex', flexDirection: 'column', gap: 0.4 }}>
      {[...counts].map(([source, n]) => (
        <Typography key={source} sx={{ fontSize: '0.68rem', color: 'text.disabled', lineHeight: 1.5 }}>
          <Box component="span" aria-hidden sx={{ verticalAlign: 'super', fontSize: '0.6rem' }}>&dagger;</Box>
          {` ${n} play${n === 1 ? '' : 's'} ${SOURCE_WORDS[source]}${SOURCE_WHY[source]?.(n) ?? ''}.`}
          {source === 'external' && (
            <>
              {' '}
              <Box component="a" href="https://github.com/exu6jh/RetroWPBL" target="_blank" rel="noopener noreferrer"
                sx={{ color: 'inherit', textDecoration: 'underline' }}>RetroWPBL</Box>
              {' is a second, independent reading of the game, so where it and the box score '
               + 'disagree, one of them watched something the other did not.'}
            </>
          )}
        </Typography>
      ))}
    </Box>
  )
}

// ─── Pitch data (TrackMan) ─────────────────────────────────────────────────────
type BoxPitcher = { name: string; teamAbbr: string; outs: number; pitches: number | null }
const normName = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

// Edit distance ≤ 1 (one insert / delete / substitute). Cheap boolean, no full matrix.
const within1 = (a: string, b: string): boolean => {
  if (a === b) return true
  const dl = a.length - b.length
  if (dl > 1 || dl < -1) return false
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++ }
    else { if (++edits > 1) return false; if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++ } }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}
// Tolerant same-pitcher check that bridges the box-score vs TrackMan spelling gap — the
// box says "Maggie Fox" while TrackMan says "Foxx, Maggie". Exact normalized match, or a
// surname within one edit plus given names that are equal / prefix / within one edit.
// Without this the two spellings look like two pitchers, which both hides one pitcher's
// velocity and breaks the single-candidate rescue for the genuinely-unnamed starter.
const samePitcher = (a: string, b: string): boolean => {
  a = normName(a); b = normName(b)
  if (a === b) return true
  const [af, ...ar] = a.split(' '); const al = ar.join(' ')
  const [bf, ...br] = b.split(' '); const bl = br.join(' ')
  if (!al || !bl) return false
  const firstOk = af === bf || af.startsWith(bf) || bf.startsWith(af) || within1(af, bf)
  return (al === bl || within1(al, bl)) && firstOk
}

type FirstHit = { batter: string | null; inning: number; half: string }
function PitchData({ tracking, boxPitchers, firstHit = null, live = false }: { tracking: WpblPitchTracking[]; boxPitchers: BoxPitcher[]; firstHit?: FirstHit | null; live?: boolean }) {
  // Real game pitches only. The feed's "rest_reconciliation" warmup/bullpen rows carry a
  // velocity but no batter (nor pitcher / inning); they are not game pitches and must not
  // count toward the velo stats or be rescued onto a real pitcher. A pitch thrown to a
  // batter always names the batter, so require one.
  const pitches = useMemo(
    () => tracking.filter(t =>
      t.release_speed != null && (t.kind == null || t.kind === 'pitch') &&
      !!(t.raw as { batter_name?: string | null } | null)?.batter_name),
    [tracking],
  )
  // Game highlights for the standout summary strip: the single hardest pitch (attributed
  // below via labelFor) and the hardest batted ball (exit velocity lives in `raw`).
  const hardestPitch = useMemo(() => {
    let best: WpblPitchTracking | null = null
    for (const t of pitches) if (best == null || (t.release_speed ?? 0) > (best.release_speed ?? 0)) best = t
    return best
  }, [pitches])
  const hardestHit = useMemo(() => {
    let exit = 0
    let batter: string | null = null
    for (const t of tracking) {
      const raw = t.raw as { exit_speed?: number | string | null; batter_name?: string | null } | null
      const ev = raw?.exit_speed == null ? NaN : Number(raw.exit_speed)
      if (Number.isFinite(ev) && ev > exit) { exit = ev; batter = raw?.batter_name ? fmtFeedName(raw.batter_name) : null }
    }
    return exit > 0 ? { exit, batter } : null
  }, [tracking])
  // Attribution: the tracking `play_id` is the FEED's play id (not our plays row), so we
  // can't join to wpbl_game_plays. The pitcher name lives in each event's raw payload
  // ("Last, First"); reconciliation events omit it, so fill from a sibling of the same
  // play_id. The remaining nameless pitches are almost always the starters the feed never
  // named (their whole outing is unnamed) — see the single-candidate rescue below.
  const pitcherFor = useMemo(() => {
    const fmt = (n: string) => {
      const [last, first] = n.split(',').map(s => s.trim())
      return first ? `${first} ${last}` : n
    }
    const rawName = (t: WpblPitchTracking) => {
      const nm = (t.raw as { pitcher_name?: string | null } | null)?.pitcher_name
      return nm ? fmt(nm) : null
    }
    const byPlay = new Map<string, string>()
    for (const t of tracking) {
      const nm = rawName(t)
      if (t.play_id && nm && !byPlay.has(t.play_id)) byPlay.set(t.play_id, nm)
    }
    return (t: WpblPitchTracking) => rawName(t) ?? (t.play_id ? byPlay.get(t.play_id) : null) ?? null
  }, [tracking])

  const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)
  const { units } = useUnits()
  const unit = speedUnit(units)
  const shortName = useWpblName()

  // Per-pitch log: every tracked pitch that carries a velocity (including the one put in
  // play), newest first. Ordered by the feed's sequence, falling back to occurred_at.
  // Reads live because the tab reloads its tracking every 5s while the game is in progress,
  // so the newest pitch stays at the top. Capped at a "recent" window; the aggregates above
  // cover the whole game.
  const fmtName = (n?: string | null): string | null => {
    if (!n) return null
    const [last, first] = n.split(',').map(s => s.trim())
    return first ? `${first} ${last}` : n
  }
  const pitchLog = useMemo(() => {
    const withVelo = tracking.filter(t => t.release_speed != null && t.release_speed > 0 &&
      !!(t.raw as { batter_name?: string | null } | null)?.batter_name) // exclude warmup rows
    withVelo.sort((a, b) =>
      a.sequence != null && b.sequence != null
        ? b.sequence - a.sequence
        : (b.occurred_at ?? '').localeCompare(a.occurred_at ?? ''))
    return withVelo.slice(0, 24).map(t => {
      const raw = t.raw as { pitch_type?: string | null; batter_name?: string | null } | null
      return {
        id:      t.activity_id,
        velo:    t.release_speed!,
        spin:    t.spin_rate_rpm,
        type:    prettyType(raw?.pitch_type ?? null),
        batter:  fmtName(raw?.batter_name),
        pitcher: pitcherFor(t),
        inPlay:  t.kind === 'hit',
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking, pitcherFor])

  // Aggregate TrackMan velo/spin by attributed name, plus an "unattributed" bucket.
  // Then merge onto the box-score pitcher list (the authoritative who-pitched, with real
  // names + IP/P). If EXACTLY ONE box pitcher has no tracking, the whole unattributed
  // bucket must be theirs — attribute it (reliable). Otherwise leave it as a footnote.
  const { rows, resolvedName, unattributed, fastest } = useMemo(() => {
    type Agg = { count: number; speeds: number[]; spins: number[] }
    const blank = (): Agg => ({ count: 0, speeds: [], spins: [] })
    const add = (a: Agg, p: WpblPitchTracking) => {
      a.count++
      if (p.release_speed != null && p.release_speed > 0) a.speeds.push(p.release_speed)
      if (p.spin_rate_rpm != null && p.spin_rate_rpm > 0) a.spins.push(p.spin_rate_rpm)
    }
    const byName = new Map<string, Agg>()
    const unatt = blank()
    for (const p of pitches) {
      const nm = pitcherFor(p)
      if (nm) { const k = normName(nm); const e = byName.get(k) ?? blank(); add(e, p); byName.set(k, e) }
      else add(unatt, p)
    }
    // Match each box pitcher to its tracking aggregate, tolerating the box↔TrackMan
    // spelling gap (Fox/Foxx). Consume matched keys so two box pitchers can't both claim
    // the same tracking bucket.
    const consumed = new Set<string>()
    const aggFor = (name: string): Agg | null => {
      const exact = normName(name)
      if (byName.has(exact) && !consumed.has(exact)) { consumed.add(exact); return byName.get(exact)! }
      for (const [k, e] of byName) if (!consumed.has(k) && samePitcher(name, k)) { consumed.add(k); return e }
      return null
    }
    const prelim = boxPitchers.map(bp => ({ bp, agg: aggFor(bp.name) }))
    const missing = prelim.filter(x => x.agg == null).map(x => x.bp)
    const resolved = missing.length === 1 && unatt.count > 0 ? missing[0].name : null

    const rws = prelim.map(({ bp, agg }) => ({
      ...bp,
      agg: agg ?? (resolved && bp.name === resolved ? unatt : null),
    })).sort((a, b) => a.teamAbbr === b.teamAbbr ? b.outs - a.outs : a.teamAbbr.localeCompare(b.teamAbbr))

    const fast = [...pitches].sort((a, b) => (b.release_speed ?? 0) - (a.release_speed ?? 0)).slice(0, 8)
    return { rows: rws, resolvedName: resolved, unattributed: resolved ? 0 : unatt.count, fastest: fast }
  }, [pitches, pitcherFor, boxPitchers])

  const labelFor = (t: WpblPitchTracking) => pitcherFor(t) ?? resolvedName ?? 'Unattributed'

  if (pitches.length === 0) {
    return <EmptyBody title="No pitch tracking" hint="TrackMan velocity & spin data appears here when available." />
  }
  const speeds = pitches.map(p => p.release_speed!).filter(v => v > 0)
  const spins = pitches.map(p => p.spin_rate_rpm).filter((v): v is number => v != null && v > 0)
  const tile = (label: string, value: string) => (
    <Box sx={{ textAlign: 'center', flex: 1, minWidth: '4.25rem' }}>
      <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
      <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'text.disabled' }}>{label}</Typography>
    </Box>
  )
  const sectionLabel = (t: string) => (
    <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'text.secondary', mb: 1 }}>{t}</Typography>
  )
  // Standout game-highlights tile for the summary strip: bigger value + who did it.
  const hl = (emoji: string, label: string, value: string, sub: string, first: boolean) => (
    <Box sx={{ flex: 1, minWidth: 0, textAlign: 'center', px: 0.75, ...(first ? {} : { borderLeft: '1px solid', borderColor: 'divider' }) }}>
      {/* 700 under 9px: see the weight ceiling under TYPE_SCALE in ui.tsx. */}
      <Typography sx={{ fontSize: '0.55rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'text.disabled', whiteSpace: 'nowrap' }}>{emoji} {label}</Typography>
      <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, lineHeight: 1.25, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</Typography>
      <Typography sx={{ fontSize: '0.62rem', color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</Typography>
    </Box>
  )
  const highlights = [
    hardestPitch && { e: '⚡', l: 'Hardest pitch', v: `${fmtSpeed(hardestPitch.release_speed, units)} ${unit}`, s: shortName(labelFor(hardestPitch)) },
    hardestHit   && { e: '💥', l: 'Hardest hit',   v: `${fmtSpeed(hardestHit.exit, units)} ${unit}`,          s: hardestHit.batter ? shortName(hardestHit.batter) : '—' },
    firstHit     && { e: '🥇', l: 'First hit',      v: firstHit.batter ? shortName(firstHit.batter) : '—',     s: `${firstHit.half === 'top' ? 'Top' : 'Bot'} ${firstHit.inning}` },
  ].filter(Boolean) as { e: string; l: string; v: string; s: string }[]

  return (
    <Box sx={{ p: 2 }}>
      {/* Standout game highlights — the marquee of this game's TrackMan moments. */}
      {highlights.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'stretch', mb: 2, py: 1.25, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'action.hover' }}>
          {highlights.map((h, i) => hl(h.e, h.l, h.v, h.s, i === 0))}
        </Box>
      )}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2.5, flexWrap: 'wrap' }}>
        {tile('Pitches', String(pitches.length))}
        {tile(`Avg ${unit}`, fmtSpeed(avg(speeds), units))}
        {tile(`Top ${unit}`, speeds.length ? fmtSpeed(Math.max(...speeds), units) : '—')}
        {tile('Avg spin', avg(spins) != null ? `${Math.round(avg(spins)!)}` : '—')}
      </Box>

      {/* Per-pitch log — newest first; live during the game, browsable after. */}
      {pitchLog.length > 0 && (
        <Box sx={{ mb: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
            {live && (
              <Box sx={{
                width: 7, height: 7, borderRadius: '50%', bgcolor: '#ef4444', flexShrink: 0,
                animation: 'wpblpulse 1.5s ease-in-out infinite',
                '@keyframes wpblpulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.3 }, '100%': { opacity: 1 } },
              }} />
            )}
            {sectionLabel(live ? 'Live pitches' : 'Recent pitches')}
          </Box>
          <Box>
            {pitchLog.map((p, i) => (
              <Box key={p.id} sx={{
                display: 'flex', alignItems: 'center', gap: 1.25, px: 0.75, py: 0.6,
                borderTop: i === 0 ? 'none' : '1px solid', borderColor: 'divider',
                borderRadius: 1, bgcolor: live && i === 0 ? 'action.hover' : 'transparent',
              }}>
                {/* Velocity + unit */}
                <Box sx={{ flexShrink: 0, width: '4rem', fontVariantNumeric: 'tabular-nums' }}>
                  <Typography component="span" sx={{ fontSize: '1rem', fontWeight: 800 }}>{fmtSpeed(p.velo, units)}</Typography>
                  <Typography component="span" sx={{ fontSize: '0.56rem', fontWeight: 700, color: 'text.disabled', ml: 0.3 }}>{unit}</Typography>
                </Box>
                {/* Pitch type chip */}
                <Box sx={{ flexShrink: 0, minWidth: '3.875rem' }}>
                  {p.type && (
                    <Box component="span" sx={{ px: 0.75, py: 0.15, borderRadius: 1, bgcolor: 'action.selected', fontSize: '0.64rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {p.type}
                    </Box>
                  )}
                </Box>
                {/* Batter faced (+ pitcher beneath) */}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  {p.batter && (
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <Box component="span" sx={{ color: 'text.disabled', fontWeight: 700 }}>vs </Box>{shortName(p.batter)}
                      {p.inPlay && <Box component="span" sx={{ ml: 0.5, fontSize: '0.58rem', fontWeight: 800, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.4 }}>in play</Box>}
                    </Typography>
                  )}
                  {p.pitcher && (
                    <Typography sx={{ fontSize: '0.64rem', color: 'text.disabled', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortName(p.pitcher)}</Typography>
                  )}
                </Box>
                {/* Spin */}
                <Box sx={{ flexShrink: 0, color: 'text.secondary', fontSize: '0.72rem', fontVariantNumeric: 'tabular-nums' }}>
                  {p.spin != null ? `${Math.round(p.spin)} rpm` : ''}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {rows.length > 0 && (
        <>
          {sectionLabel('By pitcher')}
          <Box component="table" sx={{ ...tableSx, mb: unattributed > 0 ? 1 : 2.5 }}>
            <Box component="thead">
              <Box component="tr">
                <Box component="th" sx={nameHeadSx}>Pitcher</Box>
                <StatHead w={36}>IP</StatHead>
                <StatHead w={30}>P</StatHead>
                <StatHead w={40}>Avg</StatHead>
                <StatHead w={40}>Top</StatHead>
                <StatHead w={44}>Spin</StatHead>
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map(r => {
                const a = r.agg
                return (
                  <Box component="tr" key={`${r.teamAbbr}-${r.name}`} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
                    <Box component="td" sx={{ ...nameCellSx, overflow: 'hidden' }}>
                      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, overflow: 'hidden' }}>
                        <Typography component="span" sx={{ fontSize: '0.86rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortName(r.name)}</Typography>
                        <Typography component="span" sx={{ ...posSx, textTransform: 'uppercase' }}>{r.teamAbbr}</Typography>
                      </Box>
                    </Box>
                    <StatCell>{outsToIp(r.outs)}</StatCell>
                    <StatCell>{r.pitches ?? '—'}</StatCell>
                    <StatCell>{a && avg(a.speeds) != null ? fmtSpeed(avg(a.speeds), units) : '—'}</StatCell>
                    <StatCell bold>{a && a.speeds.length ? fmtSpeed(Math.max(...a.speeds), units) : '—'}</StatCell>
                    <StatCell>{a && avg(a.spins) != null ? Math.round(avg(a.spins)!) : '—'}</StatCell>
                  </Box>
                )
              })}
            </Box>
          </Box>
          {unattributed > 0 && (
            <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mb: 2.5 }}>
              Avg / Top / Spin come from TrackMan. {unattributed} tracked pitches (the feed left them unnamed — usually a starter) couldn't be matched to a pitcher.
            </Typography>
          )}
        </>
      )}

      {sectionLabel(`Hardest thrown (${unit})`)}
      <Box sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {fastest.map((p, i) => (
          <Box key={p.activity_id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.55, borderTop: i === 0 ? 'none' : '1px solid', borderColor: 'divider', fontSize: '0.82rem' }}>
            <Box sx={{ width: '1.125rem', color: 'text.disabled', fontSize: '0.72rem', flexShrink: 0 }}>{i + 1}</Box>
            <Box sx={{ width: '3.25rem', fontWeight: 800, flexShrink: 0 }}>{fmtSpeed(p.release_speed, units)}</Box>
            <Box sx={{ flex: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortName(labelFor(p))}</Box>
            <Box sx={{ color: 'text.secondary', fontSize: '0.75rem', flexShrink: 0 }}>{p.spin_rate_rpm != null ? `${Math.round(p.spin_rate_rpm)} rpm` : ''}</Box>
          </Box>
        ))}
      </Box>
      <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 2 }}>
        {tracking.length} tracked events · TrackMan
      </Typography>
    </Box>
  )
}

function EmptyBody({ title, hint }: { title: string; hint: string }) {
  return (
    <Box sx={{ textAlign: 'center', py: 5, px: 2, color: 'text.secondary' }}>
      <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, mb: 0.5 }}>{title}</Typography>
      <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled' }}>{hint}</Typography>
    </Box>
  )
}

/**
 * One club's heading above its own box score, for the side-by-side layout at `lg`.
 *
 * Drawn to match the ACTIVE `TeamSwitch` tab exactly: same badge, same 0.94rem at weight 800,
 * same 2px rule in the club's accent. They are the same object at two widths, one of which
 * happens also to be a control, and a reader who widens the window should recognise what they
 * were tapping a moment ago rather than meet a new thing.
 */
function TeamHeading({ team }: { team: WpblTeam }) {
  const isDark = useWpblDark()
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 0.75, pb: 0.75, mb: 0.75,
      borderBottom: '2px solid', borderColor: wpblAccent(team.id, isDark),
    }}>
      <TeamBadge team={team} size={24} />
      <Typography sx={{ fontSize: '0.94rem', fontWeight: 800, whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {wpblFullName(team)}
      </Typography>
    </Box>
  )
}

// ─── Team switch (underline tabs — deliberately distinct from the pill SegNav) ──
function TeamSwitch({ away, home, value, onChange }: {
  away: WpblTeam; home: WpblTeam
  value: 'away' | 'home'; onChange: (v: 'away' | 'home') => void
}) {
  const isDark = useWpblDark()
  const isMobile = useMediaQuery('(max-width:600px)')
  const tab = (side: 'away' | 'home', team: WpblTeam) => {
    const active = value === side
    const color = wpblAccent(team.id, isDark)
    return (
      <Box
        onClick={() => onChange(side)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'pointer',
          px: 0.25, pb: 0.75, mb: '-1px', borderBottom: '2px solid',
          borderColor: active ? color : 'transparent',
          opacity: active ? 1 : 0.5, transition: 'opacity 0.15s',
          '&:hover': { opacity: active ? 1 : 0.8 },
        }}
      >
        <TeamBadge team={team} size={isMobile ? 22 : 24} />
        {/* Nickname only on a phone (e.g. "Heights") so the two tabs sit on one line
            instead of wrapping "New York / Heights"; full "City Nickname" on desktop. */}
        <Typography sx={{ fontSize: isMobile ? '0.9rem' : '0.94rem', fontWeight: active ? 800 : 600, whiteSpace: 'nowrap' }}>
          {isMobile ? team.name : wpblFullName(team)}
        </Typography>
      </Box>
    )
  }
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', gap: { xs: 2.5, sm: 3 }, borderBottom: '1px solid', borderColor: 'divider', mb: 0.75 }}>
      {tab('away', away)}
      {tab('home', home)}
    </Box>
  )
}

// ─── Modal root ────────────────────────────────────────────────────────────────
export default function GameDetailModal({ game: seed, initialTab, teams, games = [], onClose, onOpenPlayer, onOpenTeam }: {
  game: WpblGame
  /** The raw `?tab=` a shared link carried, captured by WpblApp at mount because `urlFor` has
   *  dropped it from the address bar by the time this mounts. Unvalidated on purpose: which
   *  boards exist depends on data only this component has. */
  initialTab?: string | null
  teams: WpblTeam[]
  games?: WpblGame[]
  onClose: () => void
  onOpenPlayer?: (p: WpblPlayer) => void
  /** Open a club's page from a team name here. Same shape as `onOpenPlayer`: the section
   *  closes this modal as it goes, so Back walks off the team page and lands on the game. */
  onOpenTeam?: (t: WpblTeam) => void
}) {
  const game = useLiveGame(seed)  // fresh score + live_state while the game is live
  const byId = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const home = byId.get(game.home_team_id)
  const away = byId.get(game.away_team_id)

  const gcUid = useRef(Math.random().toString(36).slice(2)).current
  // Seeded from the session cache, so a second look at a game paints before it fetches.
  const cached = gameCache.get(seed.id)
  const [loading, setLoading] = useState(!cached)
  // Where a game opens. A finished one opens on its recap and a live one opens on the live
  // view, which is the same rule twice: the tables are what a reader goes looking for, not what
  // they arrive wanting. An unplayed game has neither and lands on the box score, which is
  // where the tab bar starts anyway.
  // A LINK'S BOARD WINS OVER THE LANDING RULE, which is the whole point of the param: somebody
  // sent this to be read, and what they sent is more specific than what the modal would have
  // guessed. `urlTab` is kept so the correction below can tell a stale link from the reader's
  // own choice.
  const urlTab = useRef(asTab(initialTab)).current
  const [tab, setTab] = useState<Tab>(() =>
    urlTab ?? (seed.status === 'final' ? 'recap' : seed.status === 'live' ? 'live' : 'box'))
  const [boxTeam, setBoxTeam] = useState<'away' | 'home'>('away')
  const [lines, setLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }>(
    () => cached?.lines ?? { batting: [], pitching: [] })
  const [plays, setPlays] = useState<WpblGamePlay[]>(() => cached?.plays ?? [])
  const [tracking, setTracking] = useState<WpblPitchTracking[]>(() => cached?.tracking ?? [])
  const [details, setDetails] = useState<WpblGameDetails | null>(() => cached?.details ?? null)
  const [revisions, setRevisions] = useState<WpblGameRevision[]>(() => cached?.revisions ?? [])
  const [names, setNames] = useState<Map<string, WpblPlayer>>(() => cached?.names ?? new Map())
  // The same roster as a list, for the handful of places that match a feed NAME rather than
  // look an id up. Empty until the fetch lands, which is correct rather than merely tolerable:
  // an unmatched name prints as the feed spelled it, which is what it did before any of this.
  const roster = useMemo(() => [...names.values()], [names])
  // The recap video for this game, if the league has published one. Read from the shared
  // wpbl_videos cache (a tiny table, fetched once app-wide), matched on game_id.
  const [video, setVideo] = useState<WpblVideo | null>(() =>
    getCachedWpblVideos()?.find(v => v.game_id === seed.id) ?? null)
  // The written recap of this game, when someone has written one and the sync was confident
  // enough to link it (see matchGame in derive/articles.ts). Same shared-cache treatment as
  // the video above.
  const [story, setStory] = useState<WpblArticle | null>(() =>
    getCachedWpblArticles()?.find(a => a.game_id === seed.id) ?? null)

  const reload = useCallback((withSpinner = false) => {
    if (withSpinner) setLoading(true)
    let cancelled = false
    Promise.all([
      // THE WHOLE LEAGUE, not the two clubs, and that is the fix for a name that renders as a
      // dash. Every line and play on this sheet carries a `player_id` and nothing else; the
      // name comes from this map, and built from the two clubs' CURRENT rosters it asks a
      // question about NOW to answer one about THEN. A player whose roster row has since moved
      // is simply absent, and `nameOf` falls through to '—': on Sep 4, 2026 the New York
      // pitcher who threw six innings and took the win was the winning pitcher line, a Star of
      // the Game and a blank portrait, all reading "—", because her roster row had been moved
      // to Los Angeles. This is the trap CLAUDE.md states as "team_id on a roster row means
      // now, never then", one step further on: it is not only the CLUB that has to come off the
      // line, it is the fact that the line's player is on the sheet at all.
      //
      // Cheap: the section fetches this list anyway for search and for the slug rules, and it
      // is cached app-wide, so in practice this is a map lookup rather than a request.
      fetchWpblAllPlayers(),
      // Kept underneath it, because the league list is the one read here that can come back
      // EMPTY on a cold failure (`safe` answers with `[]`), and these two are the rosters this
      // modal cannot do without. Layered over the top, so where they overlap they agree.
      away ? fetchWpblRoster(away.id) : Promise.resolve([]),
      home ? fetchWpblRoster(home.id) : Promise.resolve([]),
      fetchWpblGameLines(seed.id),
      fetchWpblGamePlays(seed.id),
      fetchWpblGameTracking(seed.id),
      // The transcribed extras (first pitch, length, crew, weather). Null for any game
      // RetroWPBL has not written up yet, which is every recent one, so it rides along with
      // the rest of the load rather than gating anything on it.
      fetchWpblGameDetails(seed.id),
      // What the league changed after this game went final. Finals only: on anything else the
      // table is empty by construction, since a game has to be stored final before the drift
      // check will ever re-read it.
      seed.status === 'final' ? fetchWpblGameRevisions(seed.id) : Promise.resolve([]),
    ]).then(([all, a, h, l, pl, tr, det, rev]) => {
      const names = new Map([...all, ...a, ...h].map(p => [p.id, p]))
      const lines = { batting: l.batting, pitching: l.pitching }
      // Written whether or not this render is still mounted: the reader who just closed the
      // modal is the likeliest person to open it again, and the answer is already in hand.
      gameCache.set(seed.id, { names, lines, plays: pl, tracking: tr, details: det, revisions: rev })
      if (cancelled) return
      setNames(names)
      setLines(lines); setPlays(pl); setTracking(tr)
      setDetails(det)
      setRevisions(rev)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [seed.id, away?.id, home?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // The spinner is for a modal that has nothing to show, which is not the case when the
  // session cache seeded it. Asking for one anyway threw the cached content away for 200ms
  // and put a spinner in its place, so a REOPENED game flashed where a first open did not.
  // Captured once, because `cached` is recomputed every render and this is a question about
  // how this modal opened.
  const openedCold = useRef(!cached).current
  useEffect(() => reload(openedCold), [reload, openedCold])

  // The win-probability card's two costs, started at the same moment the modal does rather
  // than when the card first renders.
  //
  // It needs the league's ENTIRE play log, not this game's, which is the single slowest thing
  // Game Center asks for and the reason the recap used to settle a second late and shove
  // itself down the screen. Started here it overlaps the game's own load and the sheet's
  // 260ms slide, and by the time the recap has anything to draw the model usually has too.
  // Both calls are idempotent and cached by the layer beneath, so this is a head start and
  // never a second fetch.
  useEffect(() => {
    preloadWinProb()
    fetchWpblAllRunValuePlays().catch(() => { /* the card retries on its own */ })
  }, [])

  // Resolve this game's recap video. Cheap shared read (deduped + cached by the api layer);
  // revalidates in the background so a recap that lands after the game repaints on next open.
  useEffect(() => {
    let cancelled = false
    fetchWpblVideos()
      .then(vs => { if (!cancelled) setVideo(vs.find(v => v.game_id === seed.id) ?? null) })
      .catch(() => { /* keep last-good */ })
    return () => { cancelled = true }
  }, [seed.id])

  // Same again for the written recap. She files the morning after a night game, so this is
  // routinely absent when the game first goes final and present the next time it's opened.
  useEffect(() => {
    let cancelled = false
    fetchWpblArticles()
      .then(as => { if (!cancelled) setStory(as.find(a => a.game_id === seed.id) ?? null) })
      .catch(() => { /* keep last-good */ })
    return () => { cancelled = true }
  }, [seed.id])

  // While the game is live, keep the box score + play-by-play fresh (poll + realtime). The
  // poll runs only while the page is in front and pulls once on the way back, which matters
  // more here than anywhere else in the section: `reload` is five queries, and this used to
  // fire them every fifteen seconds against a hidden tab for the length of a game. See
  // refresh.ts.
  useForegroundInterval(() => reload(false), game.status === 'live' ? LIVE_POLL_MS : null)
  useEffect(() => {
    if (game.status !== 'live') return
    const ch = supabase.channel(`wpbl-gc-${seed.id}-${gcUid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wpbl_game_plays', filter: `game_id=eq.${seed.id}` }, () => reload(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wpbl_batting_lines', filter: `game_id=eq.${seed.id}` }, () => reload(false))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [game.status, seed.id, reload, gcUid])

  const final = game.status === 'final' && game.home_score != null && game.away_score != null
  const live = game.status === 'live'
  // Which postseason series this is, and where it stands. Null for every regular-season game,
  // and null when the caller passed no schedule: a series record cannot be read off one row,
  // so a partial schedule gets nothing rather than a record computed from part of a series.
  const series = useMemo(() => seriesContext(game, games, byId), [game, games, byId])
  const hasLines = lines.batting.length > 0 || lines.pitching.length > 0
  const awayWon = final && (game.away_score ?? 0) > (game.home_score ?? 0)
  const homeWon = final && (game.home_score ?? 0) > (game.away_score ?? 0)
  // The same label the scoreboard chips carry, so a game called "Yesterday" on Home is still
  // "Yesterday" once it is opened. It falls back to a written date beyond the two days a
  // reader orients around, which is what the old hand-rolled version always produced.
  const dateLabel = relativeDayLabel(game.game_date)
  const showScore = final || live

  // The badge and the name are the target, and the SCORE is deliberately outside it. The
  // score is the thing a reader's eye is on and the thing a thumb rests on while reading a
  // live game, and "open Boston's page" is not what either means.
  const scoreLine = (team: WpblTeam | undefined, score: number | null, won: boolean) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box
        {...(team && onOpenTeam ? pressable(() => onOpenTeam(team)) : {})}
        aria-label={team && onOpenTeam ? `${wpblFullName(team)} team page` : undefined}
        sx={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1,
          ...(team && onOpenTeam ? {
            cursor: 'pointer', borderRadius: 1.5, mx: -0.75, px: 0.75, py: 0.25,
            ...TAPPABLE,
            ...FOCUS_RING,
          } : {}),
        }}
      >
        {team && <TeamBadge team={team} size={30} />}
        <Typography sx={{ flex: 1, minWidth: 0, fontSize: '1rem', fontWeight: won ? 800 : 600 }}>{team ? wpblFullName(team) : ''}</Typography>
      </Box>
      {showScore && <Typography sx={{ flexShrink: 0, fontSize: '1.25rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: won ? 'text.primary' : 'text.secondary' }}>{score ?? 0}</Typography>}
    </Box>
  )

  const tabs = [
    ...(final ? [{ value: 'recap' as Tab, label: 'Recap' }] : []),
    // The live view, in the slot the Recap takes once the game is final, so the two swap in
    // place when a game ends under a reader who has the modal open. It is the landing tab for a
    // live game for the same reason Recap is for a final one: a table is not what either
    // reader came for.
    //
    // It is a TAB and not more of the header, which is where a live extra wants to go. The
    // header block is paid for by every tab, and on a phone it had already grown past half the
    // screen once (see the note where the highlight reel used to live); a live game pays the
    // most for that, being the one that also carries the situation banner. A tab costs a reader
    // one swipe and gives this the whole pane.
    //
    // Gated on having plays, exactly as Pitch Data is gated on having tracking: the win
    // probability card renders nothing under two points, and a tab that opens on half a pane is
    // worse than a tab that is not there yet.
    //
    // `loading ||` keeps it offered through the first fetch. Without it the landing tab does
    // not exist on first paint, the bar draws with Box Score selected, and the pill jumps a
    // beat later when the plays land. A live game with fewer than two plays does exist (the
    // ingest can call one live off a ball or a strike alone), and there the tab appears and
    // then goes, which is the rarer and the more honest of the two.
    ...(live && (loading || plays.length >= 2) ? [{ value: 'live' as Tab, label: 'Live' }] : []),
    { value: 'box' as Tab, label: 'Box Score' },
    { value: 'plays' as Tab, label: 'Play-by-Play' },
    // Only when the feed has actually posted TrackMan for this game. It used to appear for
    // every played game and explain itself with an empty state, on the reasoning that tracking
    // often lands late and a missing tab hides the gap. Two of nineteen final games have any,
    // so in practice that was a fourth tab leading nowhere on seventeen games out of nineteen,
    // and the gap it was surfacing is the league's, not ours. The Tracked board on the Stats
    // tab hides itself for the same reason.
    ...(tracking.length > 0 ? [{ value: 'pitch' as Tab, label: 'Pitch Data' }] : []),
  ]

  // The tab list is dynamic — 'recap' only once the game is final, 'pitch' only once it has
  // been played — so the pager's index is derived from the active tab each render rather than
  // stored. That keeps it correct when a live game finishes with the modal open and 'recap'
  // appears at the front, shifting every other tab along. Clamped, since a tab can also stop
  // being offered underneath us.
  const tabIndex = Math.max(0, tabs.findIndex(t => t.value === tab))

  // Which of the four boards actually gets read. `game_center_opened` says only that a reader
  // arrived; the Recap / Box Score / Play-by-Play / Pitch Data axis never touches the URL, so
  // Cloudflare cannot see it either and nothing distinguished the tab that opened by default
  // from the one someone chose. Same argument that already put `wpbl_stats_board` in place.
  //
  // `via` is that distinction: 'open' is the landing tab this modal picked, 'pill' and 'swipe'
  // are the reader choosing. Gated on `hasLines` because the bar paints before the data does,
  // and a board with nothing under it has not been read.
  /**
   * The board in the address bar, so a shared link opens on the one that was sent.
   *
   * `replaceState`, NEVER `pushState`: switching board is not navigation, and Back in this
   * section means "close the thing on top" (see `closeTop` in WpblApp). Pushed, a reader who
   * looked at three boards would need three Backs to shut the game.
   *
   * THE EXISTING HISTORY STATE IS CARRIED THROUGH. WpblApp keeps its navigation snapshot on
   * history.state.wpbl, and replacing it with anything else, `{}` included, would leave Back
   * rendering the wrong thing under this URL.
   *
   * ONLY ON THE GAME'S OWN PATH, and only for a board that is not the one this game opens on:
   * a link to the landing board says nothing, so the URL stays clean and the param appears
   * exactly when it is carrying information.
   */
  const landingTab: Tab = game.status === 'final' ? 'recap' : game.status === 'live' ? 'live' : 'box'
  useEffect(() => {
    if (!wpblGameSlugFromPath(window.location.pathname)) return
    const q = new URLSearchParams(window.location.search)
    if (tab === landingTab) q.delete('tab'); else q.set('tab', tab)
    const str = q.toString()
    const url = str ? `${window.location.pathname}?${str}` : window.location.pathname
    if (url === window.location.pathname + window.location.search) return
    window.history.replaceState(window.history.state, '', url)
  }, [tab, landingTab])

  // A LINK NAMING A BOARD THIS GAME DOES NOT HAVE. The tab list is built from data that is not
  // there at mount, so `?tab=pitch` on a game with no TrackMan, or `?tab=recap` on one that has
  // not finished, is only knowable once the fetch lands. Corrected once, and only for a tab
  // that came from the URL: the reader's own choices are left alone, and so is the live-to-final
  // transition that adds Recap underneath an open modal.
  const urlTabChecked = useRef(false)
  useEffect(() => {
    if (urlTabChecked.current || !urlTab || loading || tabs.length === 0) return
    urlTabChecked.current = true
    if (!tabs.some(t => t.value === urlTab)) setTab(landingTab)
  }, [urlTab, loading, tabs, landingTab])

  const tabVia = useRef<'open' | 'pill' | 'swipe'>('open')
  const selectTab = useCallback((v: Tab, via: 'pill' | 'swipe') => { tabVia.current = via; setTab(v) }, [])
  useEffect(() => {
    if (!hasLines) return
    track(EVENTS.WPBL_GAME_TAB, { tab, via: tabVia.current, status: game.status, gameId: game.id })
  }, [tab, hasLines, game.status, game.id])

  // The authoritative pitcher list (real names + IP/P) that the Pitch Data tab merges
  // TrackMan velo/spin onto — see PitchData.
  const boxPitchers = useMemo(() => lines.pitching.map(p => ({
    name: names.get(p.player_id)?.name ?? '—',
    teamAbbr: byId.get(p.team_id)?.abbr ?? '',
    outs: p.outs,
    pitches: p.pitches,
  })), [lines.pitching, names, byId])

  // First hit of the game (plays are ordered by sequence) — feeds the Pitch Data highlights.
  const firstHit = useMemo(() => {
    const p = plays.find(pl => pl.is_hit)
    return p ? { batter: p.batter_name, inning: p.inning, half: p.half } : null
  }, [plays])

  return (
    <ModalShell
      // A final game says WHEN it was: the modal is opened from Home, from Schedule and from a
      // shared link, and "Final" on its own is the one thing on the header that could belong
      // to any night of the season. A live game does not, because a live game is now.
      eyebrow={
        final ? `Final${game.innings && game.innings !== 7 ? ` / ${game.innings}` : ''} · ${dateLabel}`
        // RED, and pulsing, because this is the one state of the header that is a claim about
        // RIGHT NOW rather than a label for a thing that happened. It is the same red and the
        // same beat as Home's LIVE hero and its scoreboard chip, so a reader who came from
        // either arrives at the word they tapped. The keyframes are declared here rather than
        // borrowed: the hero defines them inside its own sx, so they do not exist on this tree.
        : live ? (
          <Box component="span" sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.7, color: LIVE_RED,
            '@keyframes wpblLiveBeat': { '0%': { opacity: 1 }, '50%': { opacity: 0.3 }, '100%': { opacity: 1 } },
          }}>
            <Box component="span" sx={{
              width: 7, height: 7, borderRadius: '50%', bgcolor: LIVE_RED,
              animation: 'wpblLiveBeat 1.5s ease-in-out infinite',
            }} />
            Live
          </Box>
        )
        : `${dateLabel}${game.start_time ? ` · ${formatGameTime(game.game_date, game.start_time)}` : ''}`
      }
      onClose={onClose}
      // THE SAME RAW-PIXEL BUG one level up, and then the width the card was actually asking
      // for. 520 was a phone column that never learned the section is drawn a quarter larger on
      // a desktop, so this dialog sat at 514px inside a 1440px window: 36% of the width, while
      // running 860 to 1009px tall inside a 900px one. It overflowed vertically and had space
      // to spare horizontally, which is the one combination a layout can always fix.
      //
      // `lg` rather than `md` for the wide step, because the wide step is what lets the box
      // score put both clubs side by side, and two of those tables want about 474px each. At
      // `md` the viewport itself is 900px and they would be squeezed back into a scroll. So
      // the middle band gets the scale correction alone, which is already a quarter more room
      // than it had, and `lg` gets the layout.
      maxWidth={{ xs: chromePx(520), lg: chromePx(840) }}
      // A sheet on a phone: this is the most-opened surface in the section, every game row on
      // Home and Schedule leads here, and its only way out was a close button in the top right
      // corner, which is the furthest point on a phone from the thumb holding it. Now it comes
      // up from the bottom edge with a handle and goes back down the same way. Unchanged above
      // sm, where a centred dialog is right and there is no thumb to accommodate.
      sheet
      // And a constant height while it is one, so the sheet does not grow 419px under the
      // reader's thumb when the box score lands, or resize every time they page a tab.
      sheetFill
    >
      {/* Two sizings, because the sheet and the dialog are shaped differently.
          On a phone the sheet holds a definite height, so this fills it (`flex: 1`) and every
          percentage below resolves, which is what lets each tab pane scroll itself.
          Above sm the modal is content-height on purpose, so a short tab sizes it down instead
          of forcing full height, and this is clamped rather than filled. `flex: 1` there would
          collapse the pane to nothing, since a flex item with a zero basis contributes nothing
          to an auto-height parent. */}
      <Box sx={{
        display: 'flex', flexDirection: 'column', minHeight: 0,
        flex: { xs: '1 1 0%', sm: '0 1 auto' },
        maxHeight: { xs: 'none', sm: '100%' },
      }}>
        {/* The page's <h1>, matching the <title> word for word, and not drawn. Game Center
            deliberately shows no written headline (the line score below says it better; the
            reasoning is in RecapCard next to the omission), which left a real page with its
            own URL carrying no heading at all for a screen reader or a crawler. */}
        <WpblVisuallyHiddenH1>{wpblGameCard(game, teams).ogTitle}</WpblVisuallyHiddenH1>

        {/* Score header — one combined scoreboard for a played game (teams + line + R/H/E),
            or a plain name matchup for an unplayed one. */}
        <Box sx={{ flexShrink: 0, pb: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          {showScore && away && home ? (
            <Scoreboard away={away} home={home} game={game} awayWon={awayWon} homeWon={homeWon} onOpenTeam={onOpenTeam} />
          ) : (
            <Box sx={{ px: 2, pt: 2, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {scoreLine(away, game.away_score, awayWon)}
              {scoreLine(home, game.home_score, homeWon)}
            </Box>
          )}
          {/* The series this game belongs to. Postseason baseball is series-shaped and this
              header was not: a best-of-five clincher read as a 4-2 win and nothing else.
              Above the venue because it is the second thing about the game after the score,
              and the one thing on this header the score cannot say.

              Both readings are here, unlike the schedule row which shows the record alone:
              `line` is where the series stands (after this game once it is final, entering it
              while it is not) and `stakes` is what a win would settle. This is the surface
              someone opens to watch a game on, so what is at stake is the point of being
              here. */}
          {series && (
            <Box sx={{ px: 2, mt: 1.25, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 1 }}>
              <Typography sx={{ fontSize: '0.66rem', fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: WPBL_ACCENT }}>
                {series.label} · Game {series.gameNumber} of {series.bestOf}
              </Typography>
              {series.line && (
                <Typography sx={{ fontSize: '0.8rem', fontWeight: 700 }}>{series.line}</Typography>
              )}
              {series.stakes && (
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: 'text.secondary' }}>{series.stakes}</Typography>
              )}
            </Box>
          )}
          {game.venue && <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', px: 2, mt: 1 }}>{game.venue}</Typography>}

          {/* The written recap. The highlight reel used to sit directly above it here and now
              renders at the foot of the Recap tab instead: everything in this header block is
              paid for by every tab, and on a phone the header had grown past half the screen
              (see the note in RecapCard). This card is a paragraph and stays. */}
          {final && story && (
            <Box sx={{ px: 2, mt: 1.5 }}><GameStoryCard article={story} /></Box>
          )}
        </Box>

        {/* Why the game is not moving, when it is not. Directly under the matchup and above the
            live banner, because it explains the thing the reader is staring at: a scoreboard
            that has not changed. Renders null in the ordinary case and ticks itself, so it can
            appear during a session that started before first pitch. */}
        <Box sx={{ flexShrink: 0, px: 2, pt: 1.25 }}>
          <FeedDelayNote game={game} />
        </Box>

        {/* Live situation banner (inning / count / bases / matchup).
            Not while the Live tab is the one showing: that pane opens with the same inning,
            count, bases and matchup drawn large and with the runners named, so the banner is a
            strict subset of the thing directly beneath it. The header is paid for by every tab,
            and this is the tab that can least afford to pay for it twice. It stays for Box
            Score, Play-by-Play and Pitch Data, where it is the only situation on screen. */}
        {live && tab !== 'live' && game.live_state && away && home && (
          <Box sx={{ flexShrink: 0 }}><LiveBanner state={game.live_state} away={away} home={home} lines={{ away: game.away_line, home: game.home_line }} players={roster} sourceUpdatedAt={game.source_updated_at} /></Box>
        )}

        {/* The tab bar is structural, not data, so it does not wait for a fetch. Which tabs a
            played game has is knowable from the game row alone, and drawing them immediately
            is the difference between a modal that opens and one that opens later. Pitch Data
            is the exception and appears with its data, which is the right way round: it is the
            only tab whose existence depends on what came back. */}
        {showScore && (loading || hasLines) && (
          <Box sx={{ flexShrink: 0, pt: 0.75, pb: 1 }}>
            <SegNav options={tabs} value={tab} onChange={v => selectTab(v as Tab, 'pill')} mb={0} />
          </Box>
        )}

        {loading ? (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>
        ) : hasLines ? (
          <>
            {/* Scroll region — fixed height, one per tab. */}
            {/* Scroll region — one scroller per tab, paged by the same swipe as the home tabs
                (`mode="pane"`, since this is a modal with a locked body and an inner scroller
                rather than the window-scrolled page the pager was first built for). */}
            <SwipeableViews
              mode="pane"
              index={tabIndex}
              onIndexChange={i => selectTab(tabs[i].value, 'swipe')}
              panels={tabs.map(t => (
                t.value === 'recap' && away && home ? (
                  <>
                    <GameRecapView game={game} teams={byId} batting={lines.batting} pitching={lines.pitching} plays={plays} names={names} games={games} video={final ? video : null} onOpenPlayer={onOpenPlayer} />
                    {/* Last, and only here. It used to sit in the header, where it was the
                        first thing on a phone and none of it is why anybody opens a game. */}
                    <GameInfo game={game} details={details} />
                    {/* Under the info list, because "revised on Sep 2" is the line this
                        expands on. */}
                    <RevisionLog revisions={revisions} gameId={game.id} away={away} home={home} names={names} onOpenPlayer={onOpenPlayer} />
                  </>
                ) : t.value === 'live' && away && home ? (
                  <LiveGameView
                    game={game} teams={byId} away={away} home={home} plays={plays}
                    batting={lines.batting} pitching={lines.pitching} names={names}
                    games={games} onOpenPlayer={onOpenPlayer}
                  />
                ) : t.value === 'box' && away && home ? (() => {
                  const box = (team: WpblTeam) => (
                    <TeamBox
                      team={team}
                      batting={lines.batting.filter(b => b.team_id === team.id)}
                      pitching={lines.pitching.filter(p => p.team_id === team.id)}
                      names={names}
                      onOpenPlayer={onOpenPlayer}
                    />
                  )
                  return (
                    <Box sx={{ px: 2, pb: 2, pt: 0 }}>
                      {/* BOTH CLUBS AT ONCE once there is room, and the switch goes away with
                          them. A box score is two teams, and the reason this ever showed one is
                          width: at 520px the second could only live behind a control. Reading
                          one club's half of a game and then tapping to see who they did it to
                          is a worse way to read a box score than having both in front of you,
                          and comparing the two starting pitchers took two taps and a memory.

                          CSS rather than a media-query hook, so both are always in the DOM.
                          That costs a second table of about thirteen rows and buys two things:
                          no flash of the wrong club while a JS query settles on first paint,
                          and the browser's own find-in-page reaching a player on the club you
                          are not currently looking at, which on a phone it could not. */}
                      <Box sx={{ display: { xs: 'block', lg: 'none' } }}>
                        <TeamSwitch away={away} home={home} value={boxTeam} onChange={setBoxTeam} />
                      </Box>
                      <Box sx={{
                        display: 'grid', alignItems: 'start',
                        gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, columnGap: 2.5,
                      }}>
                      {/* Measured at the reader's Large text setting: two of these tables at
                          490px each is tight, and one of the four ends up about 8px over and
                          scrolls inside its own wrapper. That is the escape hatch this table
                          was built with and the failure it is supposed to have, and it is not
                          the name column doing it: capping the name harder does not move it,
                          because it is nine columns of numbers at 12.5% larger type. Not worth
                          narrowing the default layout for everyone to avoid. */}
                        {([['away', away], ['home', home]] as const).map(([side, team]) => (
                          <Box key={side} sx={{ minWidth: 0, display: { xs: boxTeam === side ? 'block' : 'none', lg: 'block' } }}>
                            {/* The heading only exists where the switch does not. Below `lg`
                                the switch IS the heading, and drawing both would name the club
                                twice inside forty pixels. */}
                            <Box sx={{ display: { xs: 'none', lg: 'block' } }}><TeamHeading team={team} /></Box>
                            {box(team)}
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  )
                })() : t.value === 'plays' ? (
                  <PlayByPlay plays={plays} teams={byId} game={game} names={names} onOpenPlayer={onOpenPlayer} />
                ) : t.value === 'pitch' ? (
                  <PitchData tracking={tracking} boxPitchers={boxPitchers} firstHit={firstHit} live={live} />
                ) : null
              ))}
            />
          </>
        ) : final ? (
          <Box sx={{ flex: 1, p: 2 }}>
            <EmptyBody
              title="Box score not available yet"
              hint="The feed has not posted a box score for this game."
            />
            {/* No lines means no tabs, so there is no Recap tab holding the reel. A game with
                video and no box score is exactly the game somebody wants the video from. */}
            {video && <Box sx={{ mt: 2 }}><GameHighlightCard video={video} /></Box>}
          </Box>
        ) : away && home ? (
          // Unplayed game: a pre-game matchup card comparing the two clubs' season stats,
          // in place of a bare "not played yet" message (mirrors the MLB game preview).
          <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <WpblGamePreview away={away} home={home} teams={teams} games={games} onOpenTeam={onOpenTeam} />
          </Box>
        ) : (
          <Box sx={{ flex: 1, p: 2 }}>
            <EmptyBody title="This game has not been played yet" hint="Check back after first pitch." />
          </Box>
        )}
      </Box>
    </ModalShell>
  )
}

/**
 * What a game's modal needs, kept for the session so opening the same game twice is instant.
 *
 * Nothing under here changes once a game is final, and browsing a schedule means opening one
 * game, going back, and opening the next: the second look at any of them was refetching four
 * queries to redraw a page that could not have changed. Painted from here on mount and then
 * revalidated in the background, which is the same pattern the stats boards use.
 *
 * A live game revalidates on its own poll anyway, so a stale first paint there lasts until the
 * next tick and is still better than an empty one.
 */
const gameCache = new Map<string, {
  names: Map<string, WpblPlayer>
  lines: { batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }
  plays: WpblGamePlay[]
  tracking: WpblPitchTracking[]
  details: WpblGameDetails | null
  revisions: WpblGameRevision[]
}>()

// ─── styles ────────────────────────────────────────────────────────────────────
// Box tables (batting / pitching / by-pitcher): table-layout:auto with a shrink-to-fit name
// column (width:'1%' + nowrap makes it take only its content width), so the name column is
// as narrow as the names allow and the stat columns claim the freed space — more columns fit
// before the wrapper scrolls. maxWidth caps a very long name (inner text ellipsizes); minWidth
// floors the table so it still scrolls on a narrow phone.
const tableSx = { tableLayout: 'auto', borderCollapse: 'collapse', width: '100%', minWidth: 0, fontVariantNumeric: 'tabular-nums' } as const
// The phone box score. Nine batting columns and eight pitching columns will not fit a phone
// at auto layout, and the honest fix is density rather than hiding stats or scrolling.
//
// `table-layout: fixed` is what makes this structural instead of a tuned guess: the name
// column takes a declared share and the stat columns split what is left equally, so the
// table can never be wider than the space it is given, whatever the names in it are. A long
// name ellipsizes rather than shoving columns off the screen, which is the failure mode
// every width-by-content table eventually hits.
const denseTableSx = { ...tableSx, tableLayout: 'fixed' } as const
// Sized against the longest name on the roster once abbreviated ("T. Geldenhuis"), plus the
// position badge; the rest goes to the stats. BOX_NAME_MAX below is the matching character
// budget, so the two are set together — widen one and the other has to move with it.
const denseNameSx = { width: '35%', maxWidth: 'none', px: 0.3 } as const
// What fits that column at the dense font. wpblFeatureName degrades in stages to hit it
// ("Ticara Geldenhuis" → "T. Geldenhuis"), which beats the CSS ellipsis: the shared 12-char
// cap left names truncated mid-word as "M. Paddis…" and "Hyeonah K…", losing the surname,
// which is the one part of a box-score name a reader actually needs.
//
// Set to 11 by measurement, not arithmetic. A character count is a proxy for width and the
// proxy is loose: at 13 the column held "T. Geldenhuis" but clipped "Denver Bryant", which
// is the same length in characters and wider in pixels.
//
// Checked against the whole roster, not just one game. 113 of 118 names reach a form the
// column holds. The five that don't are the ones whose SHORTEST possible form is still too
// long — "R. del Castillo", "N. Rivera-Moats", "B. Espinoza-Molina" — because a particle or
// a hyphenated surname can't be abbreviated further without destroying the name. Those
// ellipsize, which is what wpblFeatureName documents as the final net, and they keep the
// start of the surname, which is the part that identifies the player.
const BOX_NAME_MAX = 11
/**
 * Cap for the shrink-to-fit name column, IN REM, because it is reserving room for a name.
 *
 * It was 150 raw pixels, and that is the trap CLAUDE.md spells out: a box sized in px around
 * type sized in rem looks perfectly right until the type changes size, and on `/wpbl` the type
 * IS a different size, a quarter larger from `md` up. So the column went on holding what 150px
 * held at 16px type while the names inside it grew, and three of them in a single Aug 30 box
 * score came out clipped: "Natsuki Yon…", "Elodie Ciam…", "Claire O'Sulliv…". A box score whose
 * first column is the player is the last place to lose the end of a surname.
 *
 * A rem, so it grows with the desktop ramp and with the reader's Large text setting, both of
 * which make the names wider. The table does not get any wider to pay for it: the name column
 * simply stops being starved by stat columns that had no use for the space.
 *
 * TEN, set against the whole roster rather than against the game that exposed the bug. All 119
 * names were measured in this cell's own font at the desktop ramp, including the cell's 29px of
 * padding and position badge: the median name needs 149px, the 90th percentile 183, and the
 * longest 248. At 10rem, which is 200px there, 116 of the 119 fit. The three that do not are
 * Flor Elena Valerio Montoya, Maria José Valenzuela and Bella Espinoza-Molina, and they
 * ellipsize, which is what a cap is for and what this one already documented itself as doing.
 *
 * Going further has a price and buys little: 11rem would seat 118 of 119 and take another 20px
 * off nine stat columns that are showing one and two digit numbers. Restoring the old 150px
 * behaviour (9.375rem) would seat 110, which is where the clipping came from.
 */
const NAME_W = '10rem'
// The name column is pinned (sticky-left) so scrolling right moves only the stat columns.
// An opaque bg + right divider keep it legible over the stat cells sliding underneath.
const stickyName = { position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper', borderRight: '1px solid', borderRightColor: 'divider' } as const
const nameHeadSx = { ...stickyName, width: '1%', maxWidth: NAME_W, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.6rem', fontWeight: 700, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.4, px: 0.4, py: 0.4 } as const
const nameCellSx = { ...stickyName, width: '1%', maxWidth: NAME_W, whiteSpace: 'nowrap', textAlign: 'left', px: 0.4, py: 0.45 } as const
const posSx = { fontSize: '0.6rem', color: 'text.disabled', lineHeight: 1, flexShrink: 0 } as const
// Scoreboard: team name column absorbs slack; innings + R/H/E hug the right and scroll if
// they overrun. minWidth:max-content floors it so a phone scrolls rather than crushing.
const scoreTableSx = { borderCollapse: 'collapse', width: '100%', minWidth: 'max-content', fontVariantNumeric: 'tabular-nums' } as const

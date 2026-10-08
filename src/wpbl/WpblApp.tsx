import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Box, Typography, Skeleton, CircularProgress, useMediaQuery, SwipeableDrawer } from '@mui/material'
import { useTheme as useMuiTheme } from '@mui/material/styles'
import {
  fetchWpblTeams, fetchWpblSchedule, fetchWpblAllPlayers, computeStandings,
  fetchWpblAllLines, fetchWpblTrackedGameIds, fetchWpblArticles, fetchWpblSiteGames, fetchWpblFanPhotoIndex, fetchWpblVideos,
  getCachedWpblTeams, getCachedWpblSchedule, getCachedWpblSiteGames,
} from './api'
import { WPBL_ACCENT, wpblAccent, wpblColor, wpblSecondary, wpblLogo, wpblLogoFill, wpblFullName, formatGameTime } from './constants'
import { applyLeagueStartTimes } from './startTimes'
import { wpblPortraitSet } from './portraits'
import { buildPositionIndex, displayPositionFromIndex, type PrimaryPosition } from './positions'
import { SectionLabel, TeamBadge, useWpblDark, CARD_BORDER, chromePx, hoverOnly, tappableIf, pressable, TAPPABLE, FOCUS_RING } from './ui'
import { panelShiftSx, useSidePanelOpen } from '../ui/ModalShell'
import { HOME_WIDE_W, STATS_FULL_BLEED_W, GAME_PAGE_W, PLAYER_PAGE_W } from './layoutWidths'
import { useSearchBridge, updateSearchBridge, setSearchQuery, onFirstSearchFocus } from '../mlb/state/SearchBridgeContext'
import type { SearchResultRow } from '../mlb/state/SearchBridgeContext'
import { getWpblRecents, mergeWpblRecent, setWpblRecents, type WpblRecentItem } from './recentSearches'
import { jerseyQuery, jerseyOf } from './playerSearch'
import type { WpblTeam, WpblPlayer, WpblGame, WpblSiteGame } from './types'
import { fmtSigned } from './stats'
import { seriesContexts } from './derive/series'
import { boxScoreRevision, formatRevisionDay } from './derive/feedHealth'
import { postseasonScheduleRows, postseasonSlots, type PostseasonScheduleRow, type PostseasonSlot } from './derive/bracket'
import { track, EVENTS } from '../lib/analytics'
import { shouldShowBadge, markBadgeSeen } from '../lib/seen'
import WpblHome, { WpblHomeSkeleton, homeLandingReadsLines, offseasonByCalendar } from './Home'
import FanAwardsSheet from './FanAwardsSheet'
import { awardsResultsShowOnHome } from './awards'
import WpblStatsView, { StatsSkeleton, carryStatsParams, type WpblStatsFocus } from './StatsView'
import SeasonShapeCard from './SeasonShapeCard'
import { seasonShape, standingsAt, type SeasonPreview } from './derive/seasonShape'
import { useRowFlip, useRowDividers } from './rowFlip'
import TeamPage from './TeamPage'
import TeamsGrid from './TeamsGrid'
import { WpblMatchupPreview } from './GamePreview'
import SwipeableViews from './SwipeableViews'
import WpblBottomNav, { BOTTOM_NAV_SPACE, MORE_KEY } from './BottomNav'
import {
  WPBL_NAV, wpblPathFor, wpblViewFromPath, normalizeWpblView, WPBL_PATH_EVENT,
  wpblPlayerPath, wpblPlayerSlugFromPath, findWpblPlayerBySlug, wpblAppOwnsPath,
  wpblGamePath, wpblGameSlugFromPath, findWpblGameBySlug,
  wpblTeamPath, wpblTeamSlugFromPath, findWpblTeamBySlug,
  WPBL_AWARDS_PATH, isWpblAwardsPage,
  WPBL_SHORT_REF_PARAM, WPBL_SHORT_REF_VALUE,
  type WpblView,
} from './routes'
import { linkTo } from '../nav'
import { publishSectionNav, clearSectionNav } from '../sectionNav'
import { playFragmentFor } from './entryUrl'
import { WpblLinkProvider, useWpblGameLink } from './LinkContext'
import { WPBL_MORE_PAGES } from './morePages'
import { useForegroundInterval } from '../lib/foregroundInterval'
import { PanelActiveContext } from '../lib/panelActive'
import { WpblHeadingOwnerProvider, TabTitle } from './PageHeading'
import { wpblGameCard } from './ogCard'
import { setDynamicSeo } from '../seo'
import { AppErrorBoundary } from '../AppErrorBoundary'

// The two detail modals, split out of the section's chunk.
//
// Neither is on screen when /wpbl loads (both open on a tap), and together they are a large share
// of what the landing view would otherwise download and parse. GameDetail is the biggest single
// file in the section (line score, box score, play-by-play, pitch data, recap tab) and it drags
// Highlights, GamePreview and the live poller along with it.
const GameDetailModal = lazy(() => import('./GameDetail'))
/**
 * The same import, run while the section is idle.
 *
 * Opening a game is the primary act in this section: every row on Home and Schedule leads there.
 * Waiting until the tap to fetch the chunk buys nothing and costs the one thing an opening
 * animation cannot survive, a gap before it starts: a spinner in the middle of the screen and
 * then, a beat later, a sheet sliding up from the bottom edge, two unrelated movements for one
 * gesture. Warmed here, the sheet is simply there on the first frame and the fallback below is a
 * formality.
 */
function usePreloadGameDetail() {
  useEffect(() => {
    // The player card too: it is reached from every leaderboard, roster and box score, and cold its
    // chunk cost the first open a fetch, a Suspense tick and a parse before the sheet could move.
    const warm = () => { void import('./GameDetail'); void import('./PlayerDetail') }
    const hasRIC = typeof window.requestIdleCallback === 'function'
    const id = hasRIC ? window.requestIdleCallback(warm, { timeout: 2000 }) : window.setTimeout(warm, 800)
    return () => { if (hasRIC) window.cancelIdleCallback(id as number); else window.clearTimeout(id as number) }
  }, [])
}
const PlayerDetailModal = lazy(() => import('./PlayerDetail'))

// Shown while a modal's chunk loads. A tap should visibly do something immediately, so this
// paints the scrim the modal itself is about to paint, and the panel then fills in over it
// rather than the tap appearing to have missed.
/**
 * Nothing at all for the first moment, then a spinner if the chunk really is slow.
 *
 * React.lazy suspends for at least a tick even when the module is already in memory, so an
 * immediate fallback renders on EVERY open: a dimmed screen and a spinner for a few hundred
 * milliseconds, then a sheet sliding up, two unrelated movements for one tap.
 *
 * A delay is the right shape for this rather than deleting the fallback outright. The common
 * case is warm and instant and should show nothing; the rare cold one on a bad connection
 * still needs to say something is happening.
 */
const CHUNK_SPINNER_DELAY_MS = 400

function ModalChunkFallback() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), CHUNK_SPINNER_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [])
  if (!slow) return null
  return (
    <Box sx={{
      position: 'fixed', inset: 0, zIndex: 1300,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      bgcolor: 'rgba(0,0,0,0.5)',
    }}>
      <CircularProgress size={28} sx={{ color: WPBL_ACCENT }} />
    </Box>
  )
}

// WPBL section root. Reads the official-feed mirror from Supabase (games, box scores,
// play-by-play, live state) and renders it; everything shows a friendly empty state until
// the feed has been ingested. Self-contained (no MLB/StatsAPI coupling).

// The view list and the path map live in ./routes, which App.tsx and seo.ts also read.
// See the note there for why it is a separate, import-free module.
const NAV = WPBL_NAV

// ─── Shared bits ──────────────────────────────────────────────────────────────

// SHOWN WHILE THE FIRST TEAMS/SCHEDULE READ IS IN FLIGHT, ONE PER TAB, and each is its tab drawn
// empty: the real title (TabTitle, which needs no data) over grey blocks the size of what replaces
// them, so the only change when the tab lands is grey turning into content. Home has its own
// (WpblHomeSkeleton) and so does Stats (StatsSkeleton, beside the full-bleed rule it shares).
//
// One generic dashboard shape served all four until Oct 2026 and matched none of them: no title,
// and its first block 20px below where every tab's title sits, so every cold load jumped. The
// schedule's is built from the schedule's own pieces (SectionLabel, the card's padding and badge);
// the rest are desktop measurements over the 1.25 scale, in chromePx, which holds on a phone too.
// Check any change with `?devSlow=2500` (src/dev/slowLoad.ts) against the loaded tab.
/** The full game or player page while its chunk loads: the card's own outline, not a tab's. */
/** The empty result list, one array for good: the bridge compares by identity, and a fresh `[]`
 *  per publish would wake every subscriber to say nothing changed. */
const NO_ROWS: SearchResultRow[] = []

function DetailPageSkeleton() {
  return <Skeleton variant="rounded" sx={{ height: chromePx(480), borderRadius: 3, mt: 4.5 }} />
}

function TabSkeleton({ view }: { view: WpblView }) {
  const block = (height: unknown, key?: number) => (
    <Skeleton key={key} variant="rounded" sx={{ height, borderRadius: 2 }} />
  )
  switch (view) {
    case 'schedule': {
      // The schedule's own pieces, empty: a date label over a game card, with the card's padding,
      // gap and badge size. A postseason game carries a series strip under the matchup.
      const gameCard = (strip: boolean) => (
        <Box sx={{
          display: 'flex', flexDirection: 'column', gap: 0.5, p: 1.25,
          borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER,
        }}>
          {[0, 1].map(row => (
            <Box key={row} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Skeleton variant="circular" sx={{ width: chromePx(26), height: chromePx(26), flexShrink: 0 }} />
              <Typography sx={{ fontSize: '0.9rem', flex: 1 }}><Skeleton width="9rem" /></Typography>
            </Box>
          ))}
          {strip && (
            <Box sx={{ pt: 0.6, borderTop: '1px solid', borderColor: 'divider' }}>
              <Typography sx={{ fontSize: '0.72rem' }}><Skeleton width="14rem" /></Typography>
              {/* The series line wraps under its label on a phone. */}
              <Typography sx={{ fontSize: '0.72rem', mt: 0.75, display: { xs: 'block', sm: 'none' } }}><Skeleton width="10rem" /></Typography>
            </Box>
          )}
        </Box>
      )
      const day = (key: number, body: React.ReactNode) => (
        <Box key={key}>
          <SectionLabel><Skeleton width="5.5rem" /></SectionLabel>
          {body}
        </Box>
      )
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <TabTitle sx={{ mb: 0.25 }}>WPBL Scores</TabTitle>
          {offseasonByCalendar() ? (
            // THE OFFSEASON LIST OPENS DIFFERENTLY, and the calendar alone knows it (see
            // offseasonByCalendar): today, which has no games, then the day of the final, whose
            // card carries the series strip, then everything earlier under its own label.
            <>
              {day(0, (
                <Box sx={{ px: 1.25, py: 0.6, borderRadius: 2, border: '1px dashed', borderColor: CARD_BORDER, display: 'flex', justifyContent: 'center' }}>
                  <Typography sx={{ fontSize: '0.72rem' }}><Skeleton width="4rem" /></Typography>
                </Box>
              ))}
              {day(1, gameCard(true))}
              <SectionLabel>Earlier</SectionLabel>
              {[2, 3, 4].map(i => day(i, gameCard(false)))}
            </>
          ) : [0, 1, 2, 3, 4].map(i => day(i, gameCard(false)))}
        </Box>
      )
    }
    case 'standings':
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TabTitle>WPBL Standings</TabTitle>
          {/* The table's caption, which says this before any data has arrived too. */}
          <Typography sx={{ mb: -1.25, fontSize: '0.72rem', fontWeight: 600, color: 'text.disabled' }}>
            Current standings
          </Typography>
          {block(chromePx(193))}
          {/* The chart card wraps its subtitle and summary lines on a phone, so it is taller there. */}
          {block({ xs: '388px', sm: chromePx(337) })}
        </Box>
      )
    case 'teams':
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TabTitle>WPBL Teams</TabTitle>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
            {[0, 1, 2, 3].map(i => block(chromePx(96), i))}
          </Box>
          {/* Club profiles, at the height it has once its chart is drawn (TeamsGrid draws the
              chart's box grey until then), and Head to head. Taller on a phone, where the chart
              is near the card's full width and so near its full height. Both are there only once the season
              has a result, which every season since the first week has. */}
          {block({ xs: '404px', sm: chromePx(329.6) })}
          {block(chromePx(261))}
        </Box>
      )
    default:
      return null
  }
}

function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <Box sx={{ textAlign: 'center', py: 6, px: 2, color: 'text.secondary' }}>
      <Typography sx={{ fontSize: '1rem', fontWeight: 700, mb: 0.5 }}>{title}</Typography>
      {hint && <Typography sx={{ fontSize: '0.85rem', color: 'text.disabled' }}>{hint}</Typography>}
    </Box>
  )
}

// ─── Views ────────────────────────────────────────────────────────────────────

/**
 * How recent a revision has to be to be worth marking on the schedule.
 *
 * A week. The league revises box scores for weeks after the fact and most of a season's games
 * carry a revision of some kind, so a mark on every one of those is a mark on nothing. A week is
 * "changed since you last looked", which is the question a reader scanning for scoring changes is
 * asking.
 */
const REVISION_RECENT_MS = 7 * 24 * 60 * 60 * 1000

const recentRevision = (g: WpblGame): boolean => {
  const r = boxScoreRevision(g)
  return !!r && Date.now() - r.at < REVISION_RECENT_MS
}

const revisedLabel = (g: WpblGame): string => {
  const r = boxScoreRevision(g)
  return r ? formatRevisionDay(r.on) : ''
}

function ScheduleView({ teams, games, siteGames = [], onOpenGame, onOpenTeam, onOpenPlayer }: {
  teams: WpblTeam[]; games: WpblGame[]; siteGames?: WpblSiteGame[]; onOpenGame: (g: WpblGame) => void
  /** For the postseason matchup preview's roster and club links; optional so the view still
   *  renders without them. */
  onOpenTeam?: (t: WpblTeam) => void
  onOpenPlayer?: (p: WpblPlayer) => void
  active?: boolean // accepted (call site passes it) but unused now that ordering replaced auto-scroll
}) {
  const byId = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const isDark = useWpblDark()
  const gameLink = useWpblGameLink()
  // A postseason placeholder opened as a matchup preview. These have no feed game row to open,
  // so this is a local modal rather than a history-managed page: season comparison and the two
  // rosters, which is what a seeded-but-unplayed fixture can answer.
  const [matchup, setMatchup] = useState<{ away: WpblTeam; home: WpblTeam; eyebrow: string } | null>(null)
  // The postseason is series-shaped and this list was not: a best-of-three read as three
  // unrelated games between the same two clubs. Empty all regular season, and empty for as
  // long as the feed marks no game as postseason, so nothing here changes shape on its own.
  const series = useMemo(() => seriesContexts(games, byId), [games, byId])
  // Season-to-date record per team, so upcoming games can show each side's W-L.
  const standings = useMemo(() => computeStandings(teams, games), [teams, games])
  const recordById = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of standings) m.set(r.team.id, `${r.wins}-${r.losses}`)
    return m
  }, [standings])
  // The postseason, from the calendar the league published, for as long as the feed has no rows
  // of its own. Without this the schedule would end with the regular season while the bracket card
  // is already counting down to the first playoff game. Each row retires itself the day a real game
  // lands on its date; see postseasonScheduleRows.
  const postRows = useMemo(
    () => postseasonScheduleRows(standings, games, siteGames), [standings, games, siteGames])
  const postByDate = useMemo(() => {
    const m = new Map<string, PostseasonScheduleRow[]>()
    for (const r of postRows) m.set(r.date, [...(m.get(r.date) ?? []), r])
    return m
  }, [postRows])
  // Snap the schedule to the current point in the season when it opens: the next live or
  // upcoming game lands at the top, with the just-played games directly above it, instead
  // of starting on the season opener. Games are date-ascending, so the first non-final one
  // is the next game; once the season is over, fall back to the last game.
  const anchorDate = useMemo(() => {
    const next = games.find(g => g.status !== 'final')
    return next?.game_date ?? games[games.length - 1]?.game_date ?? null
  }, [games])
  if (games.length === 0) {
    return <EmptyState title="No games scheduled yet" hint="The 2026 schedule loads here once it is added." />
  }
  const byDate = new Map<string, WpblGame[]>()
  for (const g of games) {
    const list = byDate.get(g.game_date) ?? []
    list.push(g); byDate.set(g.game_date, list)
  }

  // Open on the current point in the season by *ordering*, not scrolling: the previous
  // game's date leads, then the next/live game and everything upcoming; earlier completed
  // games follow under an "Earlier" divider. Nothing moves the window, so switching to this tab
  // never scrolls the page under the reader.
  //
  // Fill the calendar gaps between the first and last game so off-days show up as a slim
  // "no games" marker: it reads as a continuous run of days, making the rhythm of when
  // games land easy to see. Nothing is added after the final game.
  const gameDates = [...byDate.keys()] // date-ascending
  const dates: string[] = []
  {
    const cursor = new Date(`${gameDates[0]}T00:00:00`)
    // Runs to the last date anything is scheduled on, which after the regular season is the
    // published postseason rather than the feed. Taking the later of the two keeps the calendar
    // continuous in both directions: before the league draws the bracket the tail is the published
    // calendar, and once it does the feed's own rows are the later date and take over.
    const lastFeed = gameDates[gameDates.length - 1]
    const lastPost = postRows.length ? postRows[postRows.length - 1].date : lastFeed
    const end = new Date(`${(lastPost > lastFeed ? lastPost : lastFeed)}T00:00:00`)
    while (cursor <= end) {
      const y = cursor.getFullYear()
      const m = String(cursor.getMonth() + 1).padStart(2, '0')
      const d = String(cursor.getDate()).padStart(2, '0')
      dates.push(`${y}-${m}-${d}`)
      cursor.setDate(cursor.getDate() + 1)
    }
  }
  // The first date the postseason occupies, which is where the divider goes. Taken from the
  // rows rather than from a constant, so it moves on its own once the feed starts publishing
  // real games and the placeholders retire.
  const firstPostDate = postRows[0]?.date ?? null
  const anchorIdx = anchorDate ? Math.max(0, dates.indexOf(anchorDate)) : 0
  const start = Math.max(0, anchorIdx - 1) // include the previous game's date
  const lead = dates.slice(start)
  const earlier = dates.slice(0, start)

  // "Today" / "Tomorrow" / "Yesterday" for the nearby days (with the date kept alongside so the
  // label stays informative), otherwise the weekday + date.
  const dateLabel = (date: string) => {
    const d = new Date(`${date}T00:00:00`)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
    const rel = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : null
    const md = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    return rel ? `${rel} · ${md}` : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  }

  // A postseason game the league has dated but not yet drawn. Deliberately a different object
  // from a game card: dashed rather than solid, no score column, no link, and slots that name a
  // seed rather than a club. A reader must not be able to mistake it for a fixture that exists.
  const renderPostseason = (r: PostseasonScheduleRow) => {
    // Away over home when the league has designated one, seed order when it has not, and no venue
    // marker either way, matching the real game card: one ballpark means "home" is only batting last.
    const { slots } = postseasonSlots(r)
    // Both clubs seeded: there is a matchup to preview even though there is no game to open, so the
    // card goes solid and clickable. A slot still holding a seed number (team null) has no matchup
    // yet, so that card stays dashed and inert, the way it always was.
    const preview = r.first.team && r.second.team
      ? { away: slots[0].team!, home: slots[1].team!,
          eyebrow: `${r.label} · Game ${r.gameNumber} · ${dateLabel(r.date)}` }
      : null
    const slot = (p: PostseasonSlot, i: number) => (
      <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        {p.team ? <TeamBadge team={p.team} size={26} /> : (
          // The empty seat, sized exactly like a badge so a settled slot and an open one do not
          // shift the row when the seeding locks mid-week.
          <Box aria-hidden sx={{
            width: 26, height: 26, flexShrink: 0, borderRadius: '50%',
            border: '1px dashed', borderColor: CARD_BORDER,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.7rem', fontWeight: 800, color: 'text.disabled',
          }}>{p.seed ?? ''}</Box>
        )}
        <Typography noWrap sx={{
          fontSize: '0.9rem', fontWeight: p.team ? 600 : 500, flex: 1, minWidth: 0,
          color: p.team ? 'text.primary' : 'text.secondary',
        }}>
          {p.team ? wpblFullName(p.team) : p.label}
        </Typography>
        {p.team && recordById.get(p.team.id) && (
          <Typography sx={{ flexShrink: 0, fontSize: '0.72rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'text.disabled' }}>
            {recordById.get(p.team.id)}
          </Typography>
        )}
      </Box>
    )
    return (
      <Box key={r.id}
        {...(preview ? pressable(() => setMatchup(preview)) : {})}
        aria-label={preview ? `Preview ${preview.away.abbr} at ${preview.home.abbr}` : undefined}
        sx={{
          display: 'flex', flexDirection: 'column', gap: 0.5, p: 1.25,
          // Solid and clickable once both clubs are seeded (there is a matchup to preview); dashed
          // and inert while a seat is still a seed number.
          borderRadius: 2, border: preview ? '1px solid' : '1px dashed', borderColor: CARD_BORDER,
          bgcolor: 'background.paper',
          ...(preview ? { cursor: 'pointer', ...TAPPABLE, ...FOCUS_RING, transition: 'border-color 0.15s', ...hoverOnly({ borderColor: 'text.disabled' }) } : {}),
        }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {slots.map(slot)}
          </Box>
          <Box sx={{ flexShrink: 0, textAlign: 'right', minWidth: '3.625rem', whiteSpace: 'nowrap' }}>
            {/* The league published Central wall-clock times, and formatGameTime converts them
                to the reader's zone the same way it does for a feed game. */}
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'text.secondary' }}>
              {formatGameTime(r.date, r.time) || r.time}
            </Typography>
          </Box>
        </Box>
        <Box sx={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 0.75,
          pt: 0.6, borderTop: '1px solid', borderColor: 'divider',
        }}>
          <Typography sx={{ fontSize: '0.66rem', fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: WPBL_ACCENT }}>
            {r.label} · Game {r.gameNumber}
          </Typography>
          {/* Spelled out rather than left as the bracket's asterisk: there is no key beside a
              schedule row to explain what the asterisk meant. "Seeding TBD" replaces the bare
              "Scheduled" rather than joining it, because a row that is here at all is scheduled:
              what the reader needs is the one thing about it we do not know, which is which of
              these two clubs is the higher seed. */}
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: 'text.disabled' }}>
            {r.ifNecessary ? 'If necessary' : r.seedOrderTbd ? 'Seeding TBD' : 'Scheduled'}
          </Typography>
        </Box>
      </Box>
    )
  }

  const renderDate = (date: string) => {
    const dayGames = byDate.get(date)
    const dayPost = postByDate.get(date)
    // Off-day: a slim dashed marker instead of game cards, so gaps between game days are visible.
    if (!dayGames && !dayPost) {
      return (
        <Box key={date}>
          <SectionLabel>{dateLabel(date)}</SectionLabel>
          <Box sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75,
            px: 1.25, py: 0.6, borderRadius: 2, border: '1px dashed', borderColor: CARD_BORDER,
          }}>
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: 'text.disabled', letterSpacing: 0.2 }}>
              No games
            </Typography>
          </Box>
        </Box>
      )
    }
    return (
    <Box key={date}>
      {/* One divider where the regular season stops, so a reader scrolling past the last
          regular-season date is told what the dashed cards below it are before meeting one. */}
      {date === firstPostDate && <SectionLabel>Postseason</SectionLabel>}
      <SectionLabel>{dateLabel(date)}</SectionLabel>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {(dayGames ?? []).map(g => {
          const home = byId.get(g.home_team_id)
          const away = byId.get(g.away_team_id)
          const final = g.status === 'final' && g.home_score != null && g.away_score != null
          const live = g.status === 'live'
          const ser = series.get(g.id)
          return (
            // Every card is a real <a href="/wpbl/games/<slug>">. This is the section's
            // crawl path to all 41 recaps, and it was a bare onClick div: no href for a
            // crawler, no tab stop for a keyboard, nothing to open in a new tab.
            <Box key={g.id} {...gameLink(g, onOpenGame)} sx={{
              // A column, so a postseason game can carry a series strip under the matchup.
              // The matchup and the status keep their own row inside it and are unchanged.
              display: 'flex', flexDirection: 'column', gap: 0.5, p: 1.25, cursor: 'pointer',
              // Completed games get a muted fill so past reads as visually settled vs. crisp upcoming cards.
              // action.hover is too faint against the dark paper, so use a stronger explicit tint there.
              borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER,
              bgcolor: final ? (isDark ? 'rgba(255,255,255,0.09)' : 'action.hover') : 'background.paper',
              transition: 'border-color 0.15s', ...hoverOnly({ borderColor: 'text.disabled' }),
            }}>
             <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
              <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {[away, home].map((t, i) => {
                  const score = i === 0 ? g.away_score ?? 0 : g.home_score ?? 0
                  const other = i === 0 ? g.home_score ?? 0 : g.away_score ?? 0
                  const won = final && score > other
                  return t && (
                  <Box key={t.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                    {/* Winner caret on finals: a fixed-width slot keeps both rows' badges aligned. */}
                    {final && (
                      <Box sx={{ width: '0.4375rem', flexShrink: 0, mx: -0.5, textAlign: 'center', fontSize: '0.8rem', lineHeight: 1, color: wpblAccent(t.id, isDark) }}>{won ? '▸' : ''}</Box>
                    )}
                    <TeamBadge team={t} size={26} />
                    {/* Away on top, home on the bottom, and no "@" marking the home side: the league
                        plays every game in one ballpark, so "home" means batting last and nothing
                        else, and a venue marker pointing at a ground that never changes is noise. */}
                    <Typography noWrap sx={{ fontSize: '0.9rem', fontWeight: won ? 800 : 600, flex: 1, minWidth: 0, color: final && !won ? 'text.secondary' : 'text.primary' }}>
                      {wpblFullName(t)}
                    </Typography>
                    {(final || live) ? (
                      <Typography sx={{ flexShrink: 0, minWidth: '1.125rem', textAlign: 'right', fontSize: '0.95rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: final && !won ? 'text.disabled' : 'text.primary' }}>
                        {score}
                      </Typography>
                    ) : recordById.get(t.id) && (
                      <Typography sx={{ flexShrink: 0, textAlign: 'right', fontSize: '0.72rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'text.disabled' }}>
                        {recordById.get(t.id)}
                      </Typography>
                    )}
                  </Box>
                )})}
              </Box>
              <Box sx={{ flexShrink: 0, textAlign: 'right', minWidth: '3.625rem', whiteSpace: 'nowrap' }}>
                <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: live ? '#ef4444' : final ? 'text.secondary' : WPBL_ACCENT }}>
                  {live ? '● Live' : final ? `Final${g.innings && g.innings !== 7 ? `/${g.innings}` : ''}` : formatGameTime(g.game_date, g.start_time) || 'TBD'}
                </Typography>
              </Box>
             </Box>
              {/* "Semifinal · Game 2" and the record, which is the unit a fan tracks in the
                  postseason and the one thing three rows between the same two clubs cannot say
                  for themselves. The record only, not what a win would clinch: that is
                  broadcast copy and it belongs on the game's own page, where there is room
                  for it. Wraps rather than truncates, because the club names in it are as
                  long as the row is wide on a small phone. */}
              {ser && (
                <Box sx={{
                  display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 0.75,
                  pt: 0.6, borderTop: '1px solid', borderColor: 'divider',
                }}>
                  <Typography sx={{ fontSize: '0.66rem', fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: WPBL_ACCENT }}>
                    {ser.label} · Game {ser.gameNumber}
                  </Typography>
                  {ser.line && (
                    <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: 'text.secondary' }}>
                      {ser.line}
                    </Typography>
                  )}
                </Box>
              )}
              {/* The league changed this box score in the last week. THE WINDOW IS WHAT MAKES
                  IT A SIGNAL: most of a season's games get revised at some point, so marking all
                  of them says nothing, where "changed since you last looked" is the question a
                  reader scanning the schedule for scoring changes is actually asking. The game's
                  own page carries the date whenever there is one, however old. See
                  boxScoreRevision. */}
              {recentRevision(g) && (
                <Box sx={{
                  display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 0.6,
                  pt: 0.6, borderTop: '1px solid', borderColor: 'divider',
                }}>
                  <Typography sx={{ fontSize: '0.66rem', fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: 'text.disabled' }}>
                    Box score revised
                  </Typography>
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: 'text.secondary' }}>
                    {revisedLabel(g)}
                  </Typography>
                </Box>
              )}
            </Box>
          )
        })}
        {(dayPost ?? []).map(renderPostseason)}
      </Box>
    </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      {/* The page's one <h1>: /wpbl/schedule, named for what someone would search. Demoted to
          a plain div while a game or player modal is the page; see PageHeading.tsx. */}
      <TabTitle sx={{ mb: 0.25 }}>WPBL Scores</TabTitle>
      {lead.map(renderDate)}
      {earlier.length > 0 && <SectionLabel>Earlier</SectionLabel>}
      {earlier.map(renderDate)}
      {matchup && (
        <WpblMatchupPreview
          away={matchup.away} home={matchup.home} teams={teams} games={games}
          eyebrow={matchup.eyebrow} onClose={() => setMatchup(null)}
          onOpenTeam={onOpenTeam} onOpenPlayer={onOpenPlayer}
        />
      )}
    </Box>
  )
}

function StandingsView({ teams, games, onOpenTeam }: {
  teams: WpblTeam[]; games: WpblGame[]; onOpenTeam?: (t: WpblTeam) => void
}) {
  // ONE READ OF THE SEASON FOR BOTH SURFACES. The chart under the table is drawn from this, and
  // so is the table: `standingsAt(shape, last)` is `computeStandings(teams, games)` by
  // construction (see derive/seasonShape.ts), so there is no version of this page where the two
  // disagree, and pointing at the chart is just asking this object for a different column.
  const shape = useMemo(() => seasonShape(teams, games), [teams, games])
  const last = shape.columns.length - 1
  // What the reader is pointing at on the chart, in two speeds: see SeasonPreview. Held here
  // rather than in the card because it is the TABLE that changes.
  const [preview, setPreview] = useState<SeasonPreview>({ live: null, settled: null })
  const onPreview = useCallback((view: SeasonPreview) => setPreview(view), [])
  // How long until the next date arrives, when something other than the reader is driving. The
  // rows are animated to fit inside it: a move that outlasts the gap between two reorders can
  // never land, and a table that never lands trails the chart cursor by a growing margin.
  const cadence = preview.cadenceMs

  // THE SORT AND THE FIGURES COME FROM DIFFERENT COLUMNS, which is the whole of this. `order`
  // is the settled day and decides which club is on which line; `figures` is the day under the
  // cursor and fills those lines in. A club's row is therefore its rank on one day and its
  // record on another for as long as the settle lasts, which is the trade SeasonPreview argues
  // for: digits ticking in place are free to read, and re-sorting four rows is not.
  const order = standingsAt(shape, preview.settled ?? last)
  const figures = standingsAt(shape, preview.live ?? last)
  const rows = useMemo(() => {
    if (order === figures) return order
    const byTeam = new Map(figures.map(r => [r.team.id, r]))
    return order.map(r => byTeam.get(r.team.id) ?? r)
  }, [order, figures])
  // Four clubs changing places is the whole reading of a scrub, so the rows travel rather than
  // jump. The DOM still reorders, which is what keeps a screen reader's order true; see
  // rowFlip.ts for why that rules out the cheaper way of doing this.
  // Keyed off the ORDER rather than off `rows`, so the flip is not asked to re-measure on every
  // pointermove: `order` is one of the shape's own frames, so its identity only changes when the
  // settled day does, which is exactly when a row can have moved.
  const rowRef = useRowFlip(useMemo(() => order.map(r => r.team.id), [order]), cadence)
  // The lines between the clubs, lifted off the rows and drawn over them. A border on a row
  // travels with the club standing in it and is painted under the backing a moving row needs,
  // so a reorder took every divider in the table with it. See `useRowDividers`.
  const dividers = useRowDividers(order.length)
  // Labels the FIGURES, because that is what a reader is reading. The sort may still be a
  // fraction of a second behind it.
  // THREE STATES, NOT TWO. The opening column is a real place on the chart and its date is
  // null, so "is there a date" read it as "the reader is not pointing at anything" and labelled
  // four clubs at 0-0 as the current standings. Null here means the present; anything else is
  // the words for the day being shown.
  const asOf = (() => {
    if (preview.live == null || preview.live === last) return null
    const date = shape.columns[preview.live].date
    return date
      ? `As of ${new Date(`${date}T00:00:00`).toLocaleDateString([], { month: 'long', day: 'numeric' })}`
      : 'Before opening day'
  })()
  if (teams.length === 0) {
    return <EmptyState title="No teams yet" hint="Standings appear once teams and results are added." />
  }
  const played = games.some(g => g.status === 'final')
  const clickable = !!onOpenTeam
  // .667 (drop the leading zero); em dash before a team has played.
  const fmtPct = (pct: number, gp: number) => gp === 0 ? '—' : pct.toFixed(3).replace(/^0\./, '.')
  const th = { py: 0.85, px: 0.4, fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 0.4, color: 'text.secondary', textAlign: 'right' as const, whiteSpace: 'nowrap' as const }
  const td = { py: 1, px: 0.4, fontSize: '0.85rem', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const }
  // The numeric columns, in rem rather than px because `tableLayout: 'fixed'` means these widths
  // are the whole story: a cell wider than its column does not push it out, it spills. In px, PCT
  // and STRK overflow at a 1.5 text scale, which on a tabular-nums figure reads as a rendering
  // fault rather than as text being large. 2.125rem and 2.875rem are 34px and 46px at the default
  // root size.
  const NUM = 2.125, WIDE = 2.875
  const col = (rem: number) => `${rem}rem`
  // Below this the eight columns do not fit, and `tableLayout: 'fixed'` spends the shortfall
  // entirely on the one column without a width: at 320px the club name is left under 5px, so the
  // table renders as a badge and a single letter and three of the four clubs read alike.
  // GB and DIFF go rather than a few pixels off each of the others, because they are the two
  // a reader can rebuild from what is beside them (GB from the W-L columns, the run
  // differential from the team page), and because shaving all seven only moves the clipping
  // to the next text scale.
  //
  // A px threshold, and deliberately above the widest phone rather than at the 371px where
  // it starts to fit: a media query cannot read `--sd-text-scale`, so the one number here has
  // to clear the Large-text case too (every rem in the row is 12.5% wider, which puts the
  // same row back over the edge at 408px). The alternative, a breakpoint that holds only at
  // the default text size, fails silently and only for the readers who most need the setting.
  const FITS_ALL = '@media (min-width:420px)'
  // Applied to both the header cell and the body cell of a dropped column: they are separate
  // elements, and a column hidden in one and not the other shifts every cell after it by one.
  const dropNarrow = { display: 'none', [FITS_ALL]: { display: 'table-cell' } }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    {/* The page's one <h1>. This is /wpbl/standings, a distinct route with its own title, so
        it gets a heading that names the term someone would search ("WPBL standings"). */}
    <TabTitle>WPBL Standings</TabTitle>
    {/* WHICH DAY THIS TABLE IS. Always drawn, never toggled, and that is the whole design: a
        note that appears when you point at the chart would move the table down 20px under the
        finger doing the pointing, on every scrub, which is worse than the note is good. So the
        line is always there, says "Current standings" at rest, and changes its words and its
        colour when the chart is showing an earlier day. A reader who never touches the chart
        reads it once as a statement of fact and never again.

        It also has to be honest by construction rather than by care: `asOf` is null whenever
        the table is showing the last column, so the two cannot disagree about whether this is
        today's table. */}
    {/* Pulled DOWN to the table, not up to the heading: this line is the table's caption, so
        the column `gap` belongs above it (under the h1) and not below it. `mb` eats half the
        gap to the table; on a phone the h1 is hidden, so this is the first thing drawn and the
        column gap above it is simply gone. */}
    <Typography aria-live="polite" sx={{
      mb: -1.25, fontSize: '0.72rem', fontWeight: asOf ? 800 : 600, textAlign: 'left',
      color: asOf ? 'var(--wpbl-accent-fg)' : 'text.disabled',
      fontVariantNumeric: 'tabular-nums',
    }}>
      {asOf ?? 'Current standings'}
    </Typography>
    {/* `position: relative` is load-bearing twice over: it is what the divider overlay is
        placed against, and it is what makes the rows' `offsetTop` resolve to this box rather
        than to the page. See `useRowDividers`. */}
    <Box ref={dividers.ref} sx={{ position: 'relative', border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, overflow: 'hidden' }}>
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <Box component="thead">
          <Box component="tr" sx={{ bgcolor: 'action.hover' }}>
            <Box component="th" sx={{ ...th, textAlign: 'left', pl: 1.25 }}>Team</Box>
            <Box component="th" sx={{ ...th, width: col(NUM) }}>W</Box>
            <Box component="th" sx={{ ...th, width: col(NUM) }}>L</Box>
            <Box component="th" sx={{ ...th, width: col(WIDE) }}>PCT</Box>
            <Box component="th" sx={{ ...th, width: col(NUM), ...dropNarrow }}>GB</Box>
            <Box component="th" sx={{ ...th, width: col(WIDE), ...dropNarrow }}>DIFF</Box>
            <Box component="th" sx={{ ...th, width: col(WIDE), display: { xs: 'none', sm: 'table-cell' } }}>L10</Box>
            <Box component="th" sx={{ ...th, width: col(NUM + 0.5), pr: 1.25 }}>STRK</Box>
          </Box>
        </Box>
        <Box component="tbody">
          {rows.map(r => {
            const gp = r.wins + r.losses
            const l10 = r.lastTen
            const l10Color = l10.wins > l10.losses ? 'var(--wpbl-pos)' : l10.wins < l10.losses ? 'var(--wpbl-neg)' : 'text.secondary'
            return (
              <Box component="tr" key={r.team.id} ref={rowRef(r.team.id)}
                onClick={clickable ? () => onOpenTeam!(r.team) : undefined}
                sx={{
                  // THE BORDER IS HERE FOR ITS HEIGHT, AND IS DRAWN BY THE OVERLAY BELOW.
                  // Painted transparent rather than removed, so the row keeps the pixel the
                  // slots have always been spaced by and nothing above this reflows.
                  borderTop: '1px solid', borderColor: 'transparent',
                  cursor: clickable ? 'pointer' : 'default', ...tappableIf(clickable),
                  // ONLY WHILE IT IS MOVING. A row has no background of its own, so two clubs
                  // swapping print through each other at the crossing; this gives the pair an
                  // opaque page-coloured backing and a stacking order for exactly as long as
                  // the move lasts. `background.default` and not a hardcoded colour because it
                  // has to be the page's own, in both themes. See rowFlip.ts.
                  '&[data-moving]': { position: 'relative', bgcolor: 'background.default' },
                  '&[data-moving="up"]': { zIndex: 2 },
                  '&[data-moving="down"]': { zIndex: 1 },
                }}>
                <Box component="td" sx={{ ...td, textAlign: 'left', pl: 1.25 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                    <TeamBadge team={r.team} size={24} />
                    {/* Full name would truncate on mobile once the numeric columns claim their
                        fixed widths, so fall back to the nickname there (the badge carries the city). */}
                    <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: { xs: 'none', sm: 'block' } }}>{wpblFullName(r.team)}</Typography>
                    <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: { xs: 'block', sm: 'none' } }}>{r.team.name}</Typography>
                  </Box>
                </Box>
                <Box component="td" sx={{ ...td, fontWeight: 700 }}>{r.wins}</Box>
                <Box component="td" sx={{ ...td, fontWeight: 700 }}>{r.losses}</Box>
                <Box component="td" sx={td}>{fmtPct(r.pct, gp)}</Box>
                <Box component="td" sx={{ ...td, color: 'text.secondary', ...dropNarrow }}>{r.gamesBack === 0 ? '—' : r.gamesBack.toFixed(1)}</Box>
                {(() => {
                  const diff = r.runsFor - r.runsAgainst
                  const diffColor = gp === 0 ? 'text.disabled' : diff > 0 ? 'var(--wpbl-pos)' : diff < 0 ? 'var(--wpbl-neg)' : 'text.secondary'
                  return <Box component="td" sx={{ ...td, color: diffColor, fontWeight: 600, ...dropNarrow }}>{gp === 0 ? '—' : fmtSigned(diff)}</Box>
                })()}
                <Box component="td" sx={{ ...td, display: { xs: 'none', sm: 'table-cell' }, color: gp === 0 ? 'text.disabled' : l10Color, fontWeight: 600 }}>
                  {gp === 0 ? '—' : `${l10.wins}-${l10.losses}`}
                </Box>
                <Box component="td" sx={{ ...td, pr: 1.25, fontWeight: 700, color: r.streak ? (r.streak.type === 'W' ? 'var(--wpbl-pos)' : 'var(--wpbl-neg)') : 'text.disabled' }}>
                  {r.streak ? `${r.streak.type}${r.streak.count}` : '—'}
                </Box>
              </Box>
            )
          })}
        </Box>
      </Box>
      {!played && (
        <Box sx={{ px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          <Typography sx={{ fontSize: '0.78rem', color: 'text.disabled' }}>No games played yet. Records update as results are added.</Typography>
        </Box>
      )}
      {/* THE DIVIDERS, over the rows rather than on them. One line at the top of each slot, so
          the top one doubles as the rule under the header, where a row's own border would be.
          `zIndex` has to clear the 2 a row moving UP takes, or the lines go back under the
          thing they exist to survive. */}
      {dividers.tops.map((top, i) => (
        <Box key={i} aria-hidden sx={{
          position: 'absolute', left: 0, right: 0, top: `${top}px`,
          // Ornament: a hairline, carrying no type and reserving room for none, so raw px is
          // the unit and it stays one line on every device. See CLAUDE.md.
          height: '1px', bgcolor: 'divider', pointerEvents: 'none', zIndex: 3,
        }} />
      ))}
    </Box>
      {/* The season the table above is the last frame of. Under it rather than over it: the
          table is what somebody came to /wpbl/standings for, and a chart above it would make
          them scroll to reach the thing they asked for. It renders nothing until a game has
          been played, so it cannot be an empty box on opening day. */}
      <SeasonShapeCard shape={shape} onPreview={onPreview} page="standings" />

      {/* NO SEEDING CARD once the regular season is over. It existed to say what the
          remaining games were FOR, since all four clubs qualify and the order was the whole
          stake; with the order settled it answers a question nobody has, and the bracket on
          Home carries the postseason with the pairings drawn. `seedingRace` itself stays and
          is load-bearing: derive/bracket.ts builds the whole bracket out of it. */}
    </Box>
  )
}

function TeamsView({ teams, games, selected, onSelect, onOpenGame, onOpenPlayer, onOpenStats }: {
  teams: WpblTeam[]; games: WpblGame[]; selected: WpblTeam | null
  onSelect: (t: WpblTeam | null) => void
  onOpenGame: (g: WpblGame) => void
  onOpenPlayer: (p: WpblPlayer) => void
  onOpenStats: (g: 'hitting' | 'pitching', sortKey?: string,
                opts?: Pick<WpblStatsFocus, 'mode' | 'teamId' | 'qualified'>) => void
}) {
  if (teams.length === 0) {
    return <EmptyState title="No teams yet" hint="The four inaugural teams appear here once added." />
  }

  // Full team page (results, totals, leaders, roster with inline stats).
  if (selected) {
    return (
      <TeamPage
        team={selected}
        teams={teams}
        games={games}
        // Walk history back to wherever the team page was opened from (Home chips, the
        // Teams grid, a schedule link…) rather than always landing on the Teams grid.
        onBack={() => window.history.back()}
        // Up to the grid, as distinct from Back. Back returns you to wherever you opened the
        // team from (Stats, a Home chip, a schedule link); this always goes to all four.
        onAllTeams={() => onSelect(null)}
        // The sticky header's team rail: switching clubs from inside a team page, without
        // a trip back out to the grid.
        onSelectTeam={onSelect}
        onOpenGame={onOpenGame}
        onOpenPlayer={onOpenPlayer}
        onOpenStats={onOpenStats}
      />
    )
  }

  return <TeamsGrid teams={teams} games={games} onSelect={onSelect} />
}

// ─── Section root ───────────────────────────────────────────────────────────────

// A navigable WPBL location, persisted in history.state.wpbl so browser Back unwinds the
// section one step at a time (tab → team detail → game/player modal) instead of leaping
// straight out to /mlb. The MLB|WPBL toolbar switch pushes its own /mlb or /wpbl entry, so
// it sits in the same back-stack for free. game/player hold the full row (plain Supabase
// objects, structured-clonable), so a modal reopens intact on Back or refresh.
type WpblSnap = {
  view: WpblView
  team: WpblTeam | null
  game: WpblGame | null
  player: WpblPlayer | null
  /**
   * The fan awards ballot, which is a modal over Home with an address of its own.
   *
   * A BOOLEAN AND NOT AN OBJECT, unlike the three above it, because there is exactly one
   * ballot: nothing has to be resolved out of the URL, so it needs no roster, no schedule and
   * none of the pending-slug machinery those three carry. `/wpbl/awards` says everything there
   * is to say about this state.
   *
   * OPTIONAL BECAUSE OLD ENTRIES EXIST. Every snapshot already sitting in a reader's back stack
   * was written before this field, so it arrives `undefined`; read it through `!!` and an old
   * entry means "closed", which is what it was.
   */
  awards?: boolean
  /**
   * The open game is drawn as the full desktop page rather than the side panel. Same URL either
   * way: the address names the game, and how it is presented depends on how the reader got here.
   * A game opened from inside the section is the panel, so the page they were on stays beside it;
   * a game ARRIVED AT (a cold load, a shared link, a link from a page outside this component) is
   * the page, because there is nothing beside it worth keeping. "Expand" turns one into the other.
   * Ignored on a phone, where both are the sheet. Optional because old entries exist; see `awards`.
   */
  gamePage?: boolean
  /**
   * The open player is drawn as their full desktop page rather than the side panel, on the same
   * terms as `gamePage`: same URL, chosen by how the reader got here (arrived at, or "Expand").
   * Never alongside `gamePage`: a player over the full Game Center is the panel beside it.
   */
  playerPage?: boolean
}
const normalizeView = normalizeWpblView
const HOME_SNAP: WpblSnap = { view: 'home', team: null, game: null, player: null, awards: false }

/**
 * The view a cold load is asking for.
 *
 * A legacy `?view=` is read BEFORE the path, because it is the only one of the two that can
 * still say `tracking`. That group lives inside Stats now, so the edge 301s such a link to
 * /wpbl/stats and deliberately keeps the param (see functions/wpbl/index.ts); reading the
 * path first would see plain `stats`, and the Tracked board the link asked for would
 * silently not open. Every other legacy value is 301'd with the param stripped, so in
 * practice this only ever fires for tracking.
 */
function viewFromLocation(): string | null {
  return new URLSearchParams(window.location.search).get('view')
    ?? wpblViewFromPath(window.location.pathname)
}

// The WPBL pages that are not tabs. The footer links them, which is a fine crawl path and a poor
// way for a reader to find anything, so this menu is one discovery surface for all of them,
// WITHOUT a sixth tab: WPBL_NAV, the pager and the mobile bottom bar all stay at five, because a
// sixth does not fit a phone's bar (see BottomNav.tsx and the note on WPBL_LEAGUE_PAGE).
//
// Not a tab and switches nothing in the pager: it opens a menu (the toolbar's, src/ToolbarNav.tsx,
// above a phone; the sheet below on one). Each item is a real <a href> via linkTo, so it is
// crawlable and cmd/middle-click opens it in a new tab. The list itself lives in morePages.ts,
// shared with the footer, so the desktop menu, the phone sheet and the footer cannot disagree
// about what a reader is offered.
const useMorePages = () => WPBL_MORE_PAGES

// The phone's counterpart to the toolbar's More menu (ToolbarNav): the same non-tab pages, reached
// from the bottom bar's More slot as a bottom sheet instead of a dropdown. The toolbar carries no
// tabs on a phone; this is how those pages stay reachable without a footer scroll. Every row is a real <a href> (linkTo), so it is crawlable and cmd/long-press opens
// a new tab, the same rule the footer and the menu follow.
function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pages = useMorePages()
  return (
    <SwipeableDrawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      // SwipeableDrawer, not Drawer, so a phone can flick the sheet down to dismiss it (the grabber
      // above is the affordance). onOpen is required by the type but never fires: the sheet is only
      // ever opened by the bar's More slot, never by an edge swipe, so disableSwipeToOpen is on.
      onOpen={() => {}}
      disableSwipeToOpen
      // Capped and centred to the bar's own width, with rounded top corners and clearance for the
      // iOS home indicator, so it reads as a sheet the bar raised rather than a full-bleed slab.
      PaperProps={{ sx: {
        maxWidth: 460, mx: 'auto', left: 0, right: 0,
        borderTopLeftRadius: 16, borderTopRightRadius: 16,
        bgcolor: 'background.paper',
        pb: 'calc(env(safe-area-inset-bottom, 0px) + 8px)',
      } }}
    >
      <Box sx={{ px: 2, pt: 1 }}>
        <Box aria-hidden sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'divider', mx: 'auto', mb: 1.5 }} />
        {/* The same flat list as the desktop menu, from morePages.ts, with a line under each
            name saying what is there. */}
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          {pages.map(l => {
            const props = linkTo(l.href)
            return (
              <Box
                key={l.href}
                {...props}
                // linkTo navigates and lets a modified click through to the browser; the sheet
                // only has to close itself once a plain click has been taken, and a tracked item
                // records the open through the same funnel its other entry points use.
                onClick={e => {
                  const modified = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0
                  if (l.event && !modified) track(l.event, l.eventProps ?? {})
                  props.onClick(e)
                  if (e.defaultPrevented) onClose()
                }}
                sx={{
                  display: 'flex', flexDirection: 'column', gap: 0.1,
                  textDecoration: 'none', color: 'text.primary',
                  py: 1, borderBottom: '1px solid', borderColor: 'divider',
                  '&:last-of-type': { borderBottom: 'none' },
                  ...hoverOnly({ color: 'text.primary' }),
                }}
              >
                <Typography sx={{ fontSize: '0.95rem', fontWeight: 700 }}>{l.label}</Typography>
                <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', lineHeight: 1.35 }}>{l.hint}</Typography>
              </Box>
            )
          })}
        </Box>
      </Box>
    </SwipeableDrawer>
  )
}

function WpblApp({ renderFooter }: { renderFooter?: () => ReactNode } = {}) {
  // Section is public and read-only (feed-driven), so it needs no admin flag; ingest-health
  // freshness lives in the site Admin panel.

  // Seed from the snapshot already on this history entry (Back/refresh into a deep state),
  // then the URL's path, else home. Read once per state (history.state is stable at mount).
  const seed = (): WpblSnap => {
    const s = (window.history.state?.wpbl ?? null) as WpblSnap | null
    if (s) return { ...s, view: normalizeView(s.view).view }
    const v = viewFromLocation()
    if (v != null) return { ...HOME_SNAP, view: normalizeView(v).view }
    // /wpbl/teams/<slug> is the Teams tab with a club chosen, and `viewFromLocation` says
    // null for it because it is not a tab path. Left at that fallback the section seeds on
    // HOME, the very first replaceState rewrites the address bar to /wpbl, and the club that
    // then resolves out of the path has had its own URL thrown away before it arrives. The
    // club itself cannot be seeded here (the roster has not loaded), only the tab.
    if (wpblTeamSlugFromPath(window.location.pathname)) return { ...HOME_SNAP, view: 'teams' }
    // /wpbl/awards is Home with the ballot open. Unlike a club or a player there is nothing to
    // resolve, so this is the whole of the cold-load path for it: no pending ref, no effect
    // waiting on a fetch.
    if (isWpblAwardsPage(window.location.pathname)) return { ...HOME_SNAP, awards: true }
    return HOME_SNAP
  }
  // A legacy ?view=tracking (or a restored snapshot) should open Stats already on the
  // tracking group, with token 1 so the panel treats it as a real request on first mount.
  const seedTracking = () =>
    normalizeView(window.history.state?.wpbl?.view ?? viewFromLocation()).wasTracking
  const [view, setView] = useState<WpblView>(() => seed().view)
  const [selectedTeam, setSelectedTeam] = useState<WpblTeam | null>(() => seed().team)
  const [detailGame, setDetailGame] = useState<WpblGame | null>(() => seed().game)
  const [detailPlayer, setDetailPlayer] = useState<WpblPlayer | null>(() => seed().player)
  const [awardsOpen, setAwardsOpen] = useState<boolean>(() => !!seed().awards)
  const [gamePage, setGamePage] = useState<boolean>(() => !!seed().gamePage)
  const [playerPage, setPlayerPage] = useState<boolean>(() => !!seed().playerPage)
  // Whether a player or a game opens as the desktop side panel: always, on a desktop, including from
  // the ballot and the series view. ModalShell lifts the panel over whichever of those it was opened
  // from, and a player opened from the Game Center panel lands exactly over it with a back control.
  // The `md` test is ModalShell's own, so the two cannot disagree about which it is.
  const playerAsPanel = useMediaQuery(useMuiTheme().breakpoints.up('md'))
  // The full Game Center is a desktop layout; on a phone the same entry is the sheet.
  const showGamePage = gamePage && !!detailGame && playerAsPanel
  // The player's full page, the same way. The game page wins if both are somehow set: a player over
  // it is the panel beside it, which is the arrangement every route into that state means.
  const showPlayerPage = playerPage && !!detailPlayer && playerAsPanel && !showGamePage
  // The page moves aside for the side panel (see panelShiftSx), by the width of the widest thing on
  // the current surface: the column itself, or one of the surfaces that break out of it.
  const panelOpen = useSidePanelOpen()
  const contentW = showGamePage ? GAME_PAGE_W : showPlayerPage ? PLAYER_PAGE_W : view === 'home' ? HOME_WIDE_W : view === 'stats' ? STATS_FULL_BLEED_W : chromePx(720)
  // The page takes the window's scroll, so it opens at its top and hands the tab back its place.
  // Layout effect, so neither the page nor the returning tab paints a frame at the wrong depth.
  // Keyed on the game as well: one page can lead to another (a player's log beside it), and the
  // next game should open at its own top, not at the depth the last one was read to. Only the
  // first page remembers the tab's depth, since that is where Back eventually lands.
  const scrollBeforePage = useRef<number | null>(null)
  // Either full page, by what it shows, so moving from one page to another lands at the new top.
  const pageGameId = showGamePage ? `g:${detailGame?.id}` : showPlayerPage ? `p:${detailPlayer?.id}` : null
  // The panel's board, handed to the page Expand turned it into (see expandGame). Spent once the
  // page has mounted with it: Game Center reads its initial tab once, at mount.
  const expandTab = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (pageGameId) {
      expandTab.current = null
      if (scrollBeforePage.current === null) scrollBeforePage.current = window.scrollY
      window.scrollTo(0, 0)
    } else if (scrollBeforePage.current !== null) {
      window.scrollTo(0, scrollBeforePage.current)
      scrollBeforePage.current = null
    }
  }, [pageGameId])
  // Mirror of the MLB game-center event, fired whenever the opened game changes. `from` is the
  // surface the game was tapped on: without it the busiest modal in the section is one flat
  // count that cannot say whether the Home scoreboard, the schedule grid or a team page is
  // what actually feeds it, which is the question any change to those three has to answer.
  useEffect(() => {
    if (detailGame) {
      track(EVENTS.GAME_CENTER_OPENED, {
        league: 'wpbl', gameId: detailGame.id, status: detailGame.status,
        from: view === 'teams' && selectedTeam ? 'team' : view,
      })
    }
    // Deliberately keyed on the game alone: `view` and `selectedTeam` are read for the label
    // and must not re-fire this when a reader swipes tabs with a game still open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailGame?.id])
  // What the Stats tab should be showing when it's opened from another surface ("View all",
  // "Full stats"). `token` is the part that matters: the Stats panel stays MOUNTED once visited
  // (SwipeableViews keeps visited tabs alive), so a plain prop can't re-seed its state on a second
  // visit. Bumping the token on every jump gives the panel an unambiguous "re-focus now" signal, and
  // leaves it alone when the reader reaches Stats by tapping the tab or swiping.
  const [statsFocus, setStatsFocus] = useState<WpblStatsFocus>(
    () => (seedTracking() ? { group: 'tracking', token: 1 } : { group: 'hitting', token: 0 }))

  // "Something new here" dots for the two boards that shipped together on the Stats tab, Bests
  // and Find. The Stats PILL in the nav wears ONE dot to say "there is something new in here";
  // it is retired the moment the reader is on the Stats tab, by any route, because that is the
  // whole of what the pill was asking. Each CHIP inside then wears its own dot to point the
  // rest of the way, retired only by opening that board (reported by StatsView via onBoardSeen).
  // Clearing the pill does NOT touch the chips: reaching a chip means being on the tab, so the
  // pill is always retired at or before either chip anyway. Read once at mount: shouldShowBadge()
  // consults localStorage and an expiry date, and neither changes under us mid-session.
  //
  // A badge is pulled by hand once its board has been on the tab long enough that the dot means
  // "there is a dot" rather than "new"; each registration goes with its call site (see lib/seen.ts).
  const [statsPillNew, setStatsPillNew] = useState(() => shouldShowBadge('stats-tab-v184'))
  const [newBoards, setNewBoards] = useState<Set<string>>(() => {
    const s = new Set<string>()
    if (shouldShowBadge('bests-v184')) s.add('bests')
    if (shouldShowBadge('find-v184')) s.add('find')
    return s
  })
  const markBoardSeen = useCallback((key: string) => {
    const badge = key === 'bests' ? 'bests-v184' : key === 'find' ? 'find-v184' : null
    if (!badge) return
    markBadgeSeen(badge)
    setNewBoards(prev => {
      if (!prev.has(key)) return prev
      const next = new Set(prev); next.delete(key); return next
    })
  }, [])
  const navBadge = (key: string): boolean => key === 'stats' && statsPillNew
  // Retire the Stats pill dot the moment the reader is on the tab, whichever board opens: a
  // tap, a swipe, or a deep link all set view to 'stats'. The chip dots inside are untouched
  // and keep pointing at the two new boards.
  useEffect(() => {
    if (view === 'stats' && statsPillNew) { markBadgeSeen('stats-tab-v184'); setStatsPillNew(false) }
  }, [view, statsPillNew])

  // SEEDED FROM THE LAST GOOD READS, the way the overlay hosts are. This component unmounts
  // whenever the reader opens a page from the More menu (App renders those instead of it), so
  // without a seed every Back from one repainted the whole Home skeleton while it re-read two
  // tables it had read seconds earlier. The reads below still run on every mount, so the seed is
  // only ever what paints first, never what stays.
  const [teams, setTeams] = useState<WpblTeam[]>(() => getCachedWpblTeams() ?? [])
  const [feedGames, setFeedGames] = useState<WpblGame[]>(() => getCachedWpblSchedule() ?? [])
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  // The league's own website calendar, mirrored nightly. It answers two questions the stats
  // feed answers worse: for a postseason game the feed has not published yet, which club bats
  // last, and for one it HAS published, when the game actually starts (see
  // applyLeagueStartTimes). Held here rather than fetched twice, because the Schedule tab and
  // Home's Next game card build their postseason rows from the same function and must not
  // disagree about who is at home. An empty list is a working state, not a broken one: see
  // postseasonScheduleRows.
  const [siteGames, setSiteGames] = useState<WpblSiteGame[]>(() => getCachedWpblSiteGames() ?? [])
  /**
   * THE SCHEDULE THE WHOLE SECTION RENDERS, which is the feed's with the league's own published
   * first pitches over it. Every start time, countdown and reminder below reads `games`.
   *
   * HERE AND NOT AT `fetchWpblSchedule`, WHICH IS WHERE THE OTHER THREE SCHEDULE RULES LIVE, for
   * one reason: this rule needs a second table and the section deliberately does not wait on that
   * table (see the fetch below). Applying it at the read would either block the first paint on
   * the calendar or run before the calendar had landed, which is the same as not running. A memo
   * over both pieces of state is the version that corrects itself the moment the calendar
   * arrives, without anything else in the section knowing that it did.
   */
  const games = useMemo(() => applyLeagueStartTimes(feedGames, siteGames), [feedGames, siteGames])
  // Only the first visit waits. A return with both reads cached paints at once (see the seed).
  const [loading, setLoading] = useState(() => !(getCachedWpblTeams() && getCachedWpblSchedule()))
  // `noSsr` so this is right on the FIRST render, not one tick late. Without it MUI returns `false`
  // on the initial client render and corrects in an effect, so the bottom bar would be absent from
  // the first paint and inserted a frame later into an already laid-out page. Reading matchMedia synchronously keeps the bar in the initial layout.
  const isMobileView = useMediaQuery('(max-width:600px)', { noSsr: true })
  // Bottom tab bar, phones only. Above a phone the tabs are in the shell's toolbar instead (see
  // the publish below selectTab), because a bottom bar is wrong at 1280px.
  const bottomNav = isMobileView
  // The bottom bar's More sheet (the mobile way into the non-tab pages). Owned here, not in the
  // bar, because the sheet renders above the bar and outlives a tab swipe.
  const [moreSheetOpen, setMoreSheetOpen] = useState(false)

  // Toolbar search bridge: WpblApp owns the shared header search while /wpbl is mounted.
  const bridge = useSearchBridge()

  // ── History-driven navigation ────────────────────────────────────────────────
  const apply = useCallback((s: WpblSnap) => {
    // Normalise on the way in too: history entries pushed before Tracking folded into Stats
    // are still in the reader's back stack, and Back must not land on a tab that's gone.
    const { view: v, wasTracking } = normalizeView(s.view)
    if (wasTracking) setStatsFocus(f => ({ group: 'tracking', token: f.token + 1 }))
    setView(v); setSelectedTeam(s.team); setDetailGame(s.game); setDetailPlayer(s.player)
    setAwardsOpen(!!s.awards)
    setGamePage(!!s.gamePage)
    setPlayerPage(!!s.playerPage)
  }, [])
  // The tab is the PATH (/wpbl/standings); the open modal stays a query param on top of it.
  // The two are different kinds of thing: a tab is a page worth indexing under its own
  // title, a modal is a state laid over whichever page you were on. Keeping the modal in
  // the query is also what lets seo.ts canonicalise it back to the tab underneath, so a
  // hundred shared game links do not read as a hundred near-duplicate pages.
  // Memoised on `players` and threaded through push's deps below: it reads the roster now,
  // so leaving it out would freeze `push` around the empty roster of the first render and
  // every player URL would come out in the legacy query form.
  const urlFor = useCallback((s: WpblSnap) => {
    const q = new URLSearchParams()
    if (s.game) q.set('game', s.game.id) // deep-linkable game center

    // A game with nothing open on top of it owns the path, for the same reasons a player
    // does: `?game=<uuid>` is one URL as far as seo.ts is concerned (it canonicalises a
    // query back to the tab underneath, so a hundred shared game links do not read as a
    // hundred near-duplicates of Schedule), which would make every recap unindexable by
    // design. It also gives the schedule cards an href, which is what makes them links a
    // crawler can follow rather than onClick divs.
    //
    // A PLAYER opened from a game keeps the player's path and leaves the game on the query:
    // the deeper modal is the page, the one under it is state.
    //
    // Falls back to the query form while the schedule or the clubs are still in flight,
    // since a slug cannot be proven unique without the whole schedule (see wpblGameSlug).
    if (s.game && !s.player && games.length > 0 && teams.length > 0) {
      // The play fragment a reader arrived on rides the game's own URL and nothing else.
      // See entryUrl.ts for why it has to be captured rather than read.
      const path = wpblGamePath(s.game, teams, games)
      return `${path}${playFragmentFor(path)}`
    }

    // An open player takes over the path, so a player has ONE canonical URL no matter which
    // tab it was opened from. The alternative, ?player=<uuid> hanging off five different
    // tabs, is five near-duplicate URLs for one person, none of them readable.
    //
    // Falls back to the old query form only while the roster is still in flight, since the
    // slug cannot be proven unique without it (see wpblPlayerSlug). That window is the first
    // moment of a cold load, and the URL corrects itself on the next navigation.
    if (s.player) {
      const path = players.length
        ? wpblPlayerPath(s.player, players)
        : `${wpblPathFor(s.view)}`
      const str = q.toString()
      if (players.length) return str ? `${path}?${str}` : path
      q.set('player', s.player.id)
      return `${path}?${q.toString()}`
    }

    // THE STATS BOARD'S OWN PARAMS RIDE THROUGH, and this is the only query this function does
    // not mint itself. `urlFor` builds a URL out of the snapshot, so anything on the address the
    // reader arrived at that the snapshot has never heard of is discarded the moment the mount
    // effect below stamps the first entry, a beat before the Stats pane renders: without this,
    // `/wpbl/stats?board=runs` opens on Players with the query gone. See STATS_URL_PARAMS for why
    // the list lives over there.
    //
    // ONLY ONTO THIS TAB, and only with nothing laid over it. Carried blindly, a reader leaving a
    // sorted board for Schedule would take `?sort=ops` with them onto a page that has no columns,
    // and a player opened from the board would get a URL claiming a board underneath them. Reading
    // the CURRENT search is what makes it work at all: at mount that is still the address the
    // reader opened, and on every later navigation it is wherever they actually are, so there is
    // nothing to carry unless they are already on this tab.
    if (s.view === 'stats' && !s.game && !s.player && !s.awards) {
      carryStatsParams(new URLSearchParams(window.location.search), q)
    }

    // THE BALLOT, THEN A CLUB, CAN OWN THE PATH, both BELOW the game and player branches above for
    // the reason those are ordered that way: the deeper modal is the page and what is under it is
    // state.
    //
    // The ballot: a player opened from it keeps the player's URL, and closing that player returns to
    // /wpbl/awards, because the entry underneath still carries `awards: true`.
    //
    // A club selected on its own tab opens a whole page of content (results, team stats, lineup
    // history, pitching usage, leaders, the roster) that would otherwise have no URL: unindexable,
    // unlinkable, and with no href to give the cards. Only on the Teams tab, because `selectedTeam`
    // deliberately rides along through a tab switch: a reader who picks a club and swipes to Stats is
    // on Stats, and the path has to say so.
    const str = q.toString()
    if (s.awards && !s.game && !s.player) {
      return str ? `${WPBL_AWARDS_PATH}?${str}` : WPBL_AWARDS_PATH
    }

    if (s.view === 'teams' && s.team && !s.game && !s.player && teams.length > 0) {
      const path = wpblTeamPath(s.team, teams)
      return str ? `${path}?${str}` : path
    }

    return str ? `${wpblPathFor(s.view)}?${str}` : wpblPathFor(s.view)
  }, [players, games, teams])
  // A ?player=<id> / ?game=<id> from a pasted or shared link, resolved once the data they
  // name has loaded. Both are read at mount only: a restored history snapshot already
  // carries the real objects, so the query string is the cold-start path.
  const pendingParam = (key: string) =>
    window.history.state?.wpbl ? null : new URLSearchParams(window.location.search).get(key)
  const pendingPlayerId = useRef<string | null>(pendingParam('player'))
  const pendingGameId = useRef<string | null>(pendingParam('game'))
  // The same idea for /wpbl/players/<slug>, which is the canonical form. Read from the path
  // rather than the query, and likewise only on a cold load: a restored history entry
  // already carries the player object.
  const pendingPlayerSlug = useRef<string | null>(
    window.history.state?.wpbl ? null : wpblPlayerSlugFromPath(window.location.pathname),
  )
  /** The same, for /wpbl/games/<slug>. */
  const pendingGameSlug = useRef<string | null>(
    window.history.state?.wpbl ? null : wpblGameSlugFromPath(window.location.pathname),
  )
  /**
   * Which board a shared game link asked for, captured HERE rather than read by GameDetail.
   *
   * It has to be. `urlFor` builds a game's URL from its slug alone and carries no query, so by
   * the time the modal mounts the address bar has already been rewritten and `?tab=` is gone.
   * Every other cold-start parameter in this file is read at mount for the same reason; this is
   * one more of them. Validated in GameDetail, which is the half that knows which boards this
   * particular game actually has.
   */
  const pendingGameTab = useRef<string | null>(pendingParam('tab'))
  /** The box score's club (`?side=home`), dropped by `urlFor` for the same reason as the tab. */
  const pendingGameSide = useRef<string | null>(pendingParam('side'))
  /** And for /wpbl/teams/<slug>, which selects a club on the Teams tab rather than opening a
   *  modal, so it is applied with the tab itself rather than through `openFromLink`. */
  const pendingTeamSlug = useRef<string | null>(
    window.history.state?.wpbl ? null : wpblTeamSlugFromPath(window.location.pathname),
  )
  /** `?ref=short` on the landing URL means a short link (functions/p, functions/g) sent this
   *  reader here. Read at mount before `urlFor` rewrites the address bar and drops it, so the
   *  open can be counted through the ordinary analytics path rather than the edge taking on a
   *  write of its own. Only human loads run this JS, which is the point: it counts opens, never
   *  the crawler fetches that unfurl the card. */
  const arrivedViaShort = useRef(pendingParam(WPBL_SHORT_REF_PARAM) === WPBL_SHORT_REF_VALUE)
  // Count the short-link open once, on the load it happened. `kind` comes from what the landing
  // path names, which the edge resolved the code into: a player slug, a game slug, or neither.
  useEffect(() => {
    if (!arrivedViaShort.current) return
    arrivedViaShort.current = false
    const kind = pendingPlayerSlug.current ? 'player' : pendingGameSlug.current ? 'game' : 'other'
    track(EVENTS.WPBL_SHARE_OPENED, { kind })
  }, [])
  // Every forward navigation = one history entry (apply state + push a matching snapshot).
  const push = useCallback((s: WpblSnap) => {
    apply(s)
    window.history.pushState({ ...window.history.state, wpbl: s }, '', urlFor(s))
    // Tell the shell the path moved, so useSeo re-runs for the tab we just landed on.
    window.dispatchEvent(new Event(WPBL_PATH_EVENT))
  }, [apply, urlFor])

  /**
   * Open a modal that a shared link asked for, on a cold load.
   *
   * THIS IS NOT `push`, AND IT IS NOT `replaceState` EITHER. Opening the modal with replaceState
   * would make the whole session history a single entry that already has the modal open, and
   * `closeTop` is `history.back()`, so the X, the backdrop and Escape would have nothing to walk
   * back to: from the only entry in the session, back() either does nothing or leaves the site,
   * trapping anyone who arrived on a player from a pasted link.
   *
   * So seat a modal-less entry underneath first, then push the modal on top. Back and the X
   * then behave exactly as they would had the reader opened the player themselves, which is
   * the invariant closeTop is built on.
   *
   * Both halves run in the same synchronous block on purpose: seating the base at mount
   * instead would leave the address bar showing a bare /wpbl for as long as the roster took
   * to load, and a link copied in that window would have lost its player.
   *
   * The base is seated ONCE. A link can name a game and a player at the same time
   * (?game=X&player=Y is what the address bar holds once you open a player from a game), and
   * those arrive as two independent effects racing on two different fetches. Seating a fresh
   * base on the second one would throw away the first one's entry.
   */
  const linkBaseSeated = useRef(false)
  // Whether this entry was reached by a click inside the site rather than by arriving
  // directly. src/App.tsx's `navigate` pushes `{}`, a cold load has null, and a restored
  // WPBL entry never reaches openFromLink at all, so the three cases are distinguishable.
  //
  // It matters because seating a base is only correct when there is nothing behind us. The
  // players index at /wpbl/players is a separate route, so following a link from it remounts
  // this component and lands here: seating a base there would REPLACE the index entry with a
  // bare /wpbl, and Back from a player would return to the section root instead of the list the
  // reader was just reading.
  const arrivedByInAppLink = useRef(window.history.state != null)
  const openFromLink = useCallback((s: WpblSnap) => {
    // Came from a link inside the site: the shell already pushed an entry for this exact
    // URL, so FILL IT IN rather than seating a base under it or pushing a second entry with
    // the same address. Pushing would leave two /wpbl/players/<slug> entries back to back,
    // the lower one carrying no snapshot, so Back would render Home under a player's URL.
    if (arrivedByInAppLink.current) {
      arrivedByInAppLink.current = false
      apply(s)
      window.history.replaceState({ ...window.history.state, wpbl: s }, '', urlFor(s))
      window.dispatchEvent(new Event(WPBL_PATH_EVENT))
      return
    }
    if (!linkBaseSeated.current) {
      linkBaseSeated.current = true
      const base: WpblSnap = { view: s.view, team: s.team, game: null, player: null }
      window.history.replaceState({ ...window.history.state, wpbl: base }, '', urlFor(base))
    }
    push(s)
  }, [push, apply, urlFor])

  // Navigation intents. Tab/team switches clear any open modal; opening a player keeps the
  // game beneath it (so Back closes the player first, then the game).
  // Tab switches carry HOW the reader got there. Cloudflare already counts the tab paths, so
  // this deliberately isn't a page-view log (see analytics.ts): the part Cloudflare can't answer
  // is the `via`. A pill tap is a deliberate choice, a swipe often just passes through on the
  // way somewhere else, and a card link is the Home feed doing its job, which is what says
  // whether the nav is actually working on a phone. Back/forward navigations go through
  // popstate, not here, and aren't counted.
  const selectTab = useCallback((v: WpblView, via: 'pill' | 'swipe' | 'link' = 'pill') => {
    if (v !== view) track(EVENTS.WPBL_TAB_VIEWED, { view: v, via, from: view })
    // Tapping the tab you are already on returns it to its root. This matters for Teams and
    // nowhere else: `selectedTeam` rides along through every tab switch (so swiping out to
    // Stats and back keeps the team page you were reading), and without this nothing would clear
    // it, so once any team page had been opened the four-team grid would be unreachable. A team
    // opened from the Stats table is the stuck case: Back goes to Stats, and the Teams pill would
    // just re-open the same team.
    const backToRoot = v === view && via === 'pill'
    push({ view: v, team: backToRoot ? null : selectedTeam, game: null, player: null })
  }, [push, selectedTeam, view])
  // THE TOOLBAR'S TABS ABOVE A PHONE. The shell draws them (src/sectionNav.ts); this says which is
  // lit, carries the Stats dot, and routes a tap through selectTab so it is tracked as a pill and
  // a second tap on Teams still returns to the grid. The handler goes through a ref so the publish
  // is keyed on the two values that change, not on a fresh closure per render: every publish
  // re-renders the shell.
  const selectTabRef = useRef(selectTab)
  selectTabRef.current = selectTab
  const statsBadge = navBadge('stats')
  useEffect(() => {
    publishSectionNav({
      section: 'wpbl',
      tabs: NAV.map(n => ({ key: n.key, label: n.label, href: wpblPathFor(n.key), badge: n.key === 'stats' && statsBadge })),
      active: view,
      onSelect: k => selectTabRef.current(k as WpblView, 'pill'),
    })
  }, [view, statsBadge])
  useEffect(() => () => clearSectionNav('wpbl'), [])
  // Every team-page open in the section funnels through here, so it is the only place that can
  // count them all: the Teams grid, the standings table, the Stats table, the bracket and the
  // header search all reach a team page through it.
  //
  // `from` names the SURFACE, not the widget, and card-level events stay where they are because
  // they carry extra detail (the seed), so a bracket click lands in both. That is deliberate:
  // `wpbl_team_opened` is the total, `wpbl_bracket_team` is that card's own funnel. Adding the
  // two together double-counts.
  const selectTeam = useCallback(
    (t: WpblTeam | null, from = 'unknown') => {
      if (t) track(EVENTS.WPBL_TEAM_OPENED, { teamId: t.id, from })
      push({ view: 'teams', team: t, game: null, player: null })
    },
    [push],
  )
  // Bound per surface rather than as an inline arrow at each render site: StatsView takes
  // `onOpenTeam` into a useMemo dependency list, and a fresh identity on every render would
  // rebuild its whole table whenever anything else in the tree changed.
  const selectTeamFromHome      = useCallback((t: WpblTeam | null) => selectTeam(t, 'home'), [selectTeam])
  const selectTeamFromStandings = useCallback((t: WpblTeam | null) => selectTeam(t, 'standings'), [selectTeam])
  const selectTeamFromStats     = useCallback((t: WpblTeam | null) => selectTeam(t, 'stats'), [selectTeam])
  const selectTeamFromTeams     = useCallback((t: WpblTeam | null) => selectTeam(t, 'teams'), [selectTeam])
  const selectTeamFromSchedule  = useCallback((t: WpblTeam | null) => selectTeam(t, 'schedule'), [selectTeam])
  // From a game: the score lines at the top of Game Center, the box score's own team rows,
  // and the preview card's legend chips. Like `openGame` from a player, this closes the game
  // as it goes, so Back walks off the team page and lands back on the game.
  const selectTeamFromGame      = useCallback((t: WpblTeam) => selectTeam(t, 'game'), [selectTeam])
  // `opts` is how the team page asks for a specific board: the four-team comparison, or the
  // player table already filtered to one club. Omitted by every other caller, which keeps
  // the leader-card jumps behaving exactly as they did.
  const openStats  = useCallback((
    g: WpblStatsFocus['group'],
    sortKey?: string,
    opts?: Pick<WpblStatsFocus, 'mode' | 'teamId' | 'qualified' | 'playerId'>,
  ) => {
    setStatsFocus(f => ({ group: g, sortKey, ...opts, token: f.token + 1 }))
    selectTab('stats', 'link')
  }, [selectTab])
  // Tracking is a Stats group now, so "view the tracking boards" means "open Stats on it".
  const openTracking = useCallback(() => openStats('tracking'), [openStats])
  // A rank on a player's card: the full player board, unfiltered by club, so the row is there to
  // pick out. Pushed like any tab switch, so Back closes the board and reopens the card.
  const openBoardFromPlayer = useCallback((g: 'hitting' | 'pitching', sortKey: string, o: { qualified: boolean; playerId: string }) =>
    openStats(g, sortKey, { mode: 'players', teamId: null, ...o }), [openStats])
  // `awards` rides along on both of these: a player opened from the ballot leaves the ballot
  // open underneath, so her X returns to /wpbl/awards rather than dropping the reader on Home
  // with the sheet shut and their place in it lost.
  //
  // WHERE THE CLICK CAME FROM decides the history, on a desktop, because the side panel leaves the
  // page clickable. A row clicked on the PAGE while a panel is open is the reader working down a
  // list, so it SWAPS the panel (one entry, replaced, whatever was in it: a game or a player). A
  // link followed INSIDE a card (a player in Game Center's box score, a game in a player's log) is
  // a trip from that card, so it STACKS, and Back returns to the card. The cards are handed their
  // own openers below (openPlayerFromGame, openGameFromPlayer) for that; everything else on the page
  // calls these. Until Oct 6, 2026 a player clicked on the page with a game panel open landed over
  // the game behind a "‹ Game" control, which went back to a game the reader had not come from.
  const swapTo = useCallback((s: WpblSnap) => {
    apply(s)
    window.history.replaceState({ ...window.history.state, wpbl: s }, '', urlFor(s))
    window.dispatchEvent(new Event(WPBL_PATH_EVENT))
  }, [apply, urlFor])
  // A panel on screen right now, which a click on the page swaps rather than stacks on.
  const panelShowing = playerAsPanel && ((!!detailPlayer && !showPlayerPage) || (!!detailGame && !showGamePage))
  const openGameAt = useCallback((g: WpblGame, fromCard: boolean) => {
    // From a full page, a game opens as a page too: another game from beside the Game Center (a
    // player's log), or a game from the log on a player's own page. Page to page, so it pushes.
    const s: WpblSnap = { view, team: selectedTeam, game: g, player: null, awards: awardsOpen, gamePage: (gamePage && !!detailGame) || showPlayerPage }
    // Never from the full page, which is a PAGE: following a link from one page to another adds a
    // step to Back everywhere else on the web, and a reader who went from game 4 of a series to
    // game 5 expects Back to return to game 4, not to the schedule they started on.
    if (!fromCard && panelShowing && !showGamePage) { swapTo(s); return }
    push(s)
  }, [push, swapTo, view, selectedTeam, awardsOpen, detailGame, gamePage, panelShowing, showGamePage, showPlayerPage])
  const openGame = useCallback((g: WpblGame) => openGameAt(g, false), [openGameAt])
  const openGameFromPlayer = useCallback((g: WpblGame) => openGameAt(g, true), [openGameAt])
  /**
   * The side panel's Expand: the same entry, now the full page. REPLACED rather than pushed, so
   * Back from the page goes where Back from the panel would have, to the tab underneath, rather
   * than shrinking the page back into a panel.
   */
  const expandGame = useCallback((tab: string | null) => {
    if (!detailGame) return
    // The board the panel was showing, so the page opens scrolled to it. A ref of its own rather
    // than pendingGameTab, which a cold link fills and every later game would then inherit.
    expandTab.current = tab
    const s: WpblSnap = { view, team: selectedTeam, game: detailGame, player: null, awards: awardsOpen, gamePage: true }
    apply(s)
    window.history.replaceState({ ...window.history.state, wpbl: s }, '', urlFor(s))
    window.dispatchEvent(new Event(WPBL_PATH_EVENT))
  }, [apply, urlFor, view, selectedTeam, detailGame, awardsOpen])
  /** The player panel's Expand, on expandGame's terms: the same entry, now the full page, so Back
   *  from the page goes where Back from the panel would have. Whatever the panel sat over (a game
   *  panel, the ballot) goes with it: the page replaces the view, and a dialog over a page that has
   *  replaced the tabs would be over nothing. */
  const expandPlayer = useCallback(() => {
    if (!detailPlayer) return
    swapTo({ view, team: selectedTeam, game: null, player: detailPlayer, awards: false, playerPage: true })
  }, [swapTo, view, selectedTeam, detailPlayer])
  // `from` defaults to the surface the reader is standing on, which is right for every in-page
  // link. The header search has to override it: search works from every tab, so left to the
  // default a player opened from the search box reports whichever tab happened to be behind it.
  // Opening a player page is the retention event, which makes that the one attribution error
  // here worth spending a parameter on.
  const openPlayerAt = useCallback((p: WpblPlayer, from: string | undefined, fromCard: boolean) => {
    track(EVENTS.WPBL_PLAYER_OPENED, { playerId: p.id, teamId: p.team_id, from: from ?? (fromCard || showGamePage ? 'game' : view) })
    // The game stays under the player when the player came FROM it (the "‹ Game" panel), and when
    // the game is the full page, which is still on screen beside the panel; closing the player
    // then returns to the page rather than demoting the game to a panel. A player clicked on the
    // page over a game PANEL replaces the game instead.
    const keepGame = fromCard || showGamePage || !playerAsPanel
    const s: WpblSnap = { view, team: selectedTeam, game: keepGame ? detailGame : null, player: p, awards: awardsOpen, gamePage: keepGame && gamePage }
    // A player already open in the side panel is SWAPPED, not stacked: the panel leaves the page
    // clickable precisely so a reader can go down a leaderboard row by row, and a push per row
    // would make Back walk every one of them before it closed the panel. Replacing keeps the one
    // entry the panel opened with, so Back (and the X, which is Back) closes it in one step.
    if (!fromCard && panelShowing) { swapTo(s); return }
    push(s)
  }, [push, swapTo, view, selectedTeam, detailGame, awardsOpen, playerAsPanel, gamePage, panelShowing, showGamePage])
  const openPlayer = useCallback((p: WpblPlayer, from?: string) => openPlayerAt(p, from, false), [openPlayerAt])
  const openPlayerFromGame = useCallback((p: WpblPlayer) => openPlayerAt(p, undefined, true), [openPlayerAt])
  /**
   * Open the ballot, which is a push like any other modal so that Back closes it.
   *
   * `view` IS CARRIED RATHER THAN FORCED TO HOME. The card that opens this only exists on Home,
   * so in practice it is always 'home'; carrying it means that if the ballot ever gets a second
   * entry point, Back from it returns to the tab the reader was actually on rather than teleporting
   * them. A cold load of /wpbl/awards seeds Home underneath, which is where the ballot lives.
   */
  const openAwards = useCallback(() => {
    push({ view, team: selectedTeam, game: null, player: null, awards: true })
  }, [push, view, selectedTeam])
  // Closing a modal (X or Escape) walks history back, so it and the browser Back button are
  // the same action and never fall out of sync.
  const closeTop   = useCallback(() => window.history.back(), [])
  /**
   * The ballot's own ✕ and backdrop, which on a desktop can be clicked while a player panel opened
   * FROM the ballot is still on screen beside it. Plain Back would close the panel, the entry on
   * top, and leave the ballot open: the control the reader pressed would be the one thing that did
   * not close. Two steps instead, the player's entry and the ballot's under it, which is exactly
   * how the two were opened (openPlayer pushes over the ballot and only ever replaces after that).
   * Escape still takes the panel first, as the newest shell.
   */
  const closeAwards = useCallback(() => {
    if (detailPlayer && playerAsPanel) window.history.go(-2)
    else window.history.back()
  }, [detailPlayer, playerAsPanel])
  usePreloadGameDetail()

  // ── Toolbar search ─────────────────────────────────────────────────────────────
  // Register as the search owner for the shared header while /wpbl is mounted, and hand
  // it back (clearing any typed query + stale rows) on unmount so switching to /mlb starts
  // clean. The MLB section registers itself the same way from MlbStats.
  useEffect(() => {
    updateSearchBridge({ isRegistered: true, source: 'wpbl' })
    return () => {
      updateSearchBridge({ isRegistered: false, source: null, resultRows: [], recentRows: [], searching: false, clearRecentSearches: null })
      setSearchQuery('')
    }
  }, [])

  // Full roster of every player, loaded once — the pool the header search filters over.
  useEffect(() => { fetchWpblAllPlayers().then(setPlayers).catch(() => {}) }, [])

  // Warm the datasets the landing view will ask for, in parallel with the teams/schedule
  // read above rather than after it.
  //
  // Home owns these reads, but Home cannot mount until `loading` clears, and `loading`
  // clears only when teams+schedule resolve, so without this they queue behind that round trip:
  // a serialized second of latency that buys nothing, since none of these reads depend on teams
  // or games. Firing them here overlaps the two waves.
  //
  // This is a warm-up, not a load: the results land in the api layer's session cache and the
  // rest is unchanged. Home still owns the fetching, still renders from the same cache
  // getters, and still revalidates on its own schedule. If Home mounts while these are in
  // flight, `once()` hands it the same promises instead of issuing a second set; if they have
  // already settled, Home seeds straight from cache and skips the round trip entirely.
  //
  // Deliberately scoped to a Home landing. Deep links (a shared ?game=, or ?view=stats) open
  // a view that wants a different, smaller slice, so this should not be speculative. The
  // whole-season play log is not warmed here: it is the most expensive read on the section and
  // Home fetches it last on purpose (see the play-log effect in Home.tsx). Nor are the box-score
  // lines when the calendar says Home will not draw them (homeLandingReadsLines): warming a read
  // nothing consumes is the whole cost and none of the benefit.
  const landsOnHome = useRef(view === 'home')
  useEffect(() => {
    if (!landsOnHome.current) return
    void Promise.all([
      homeLandingReadsLines() ? fetchWpblAllLines() : null,
      fetchWpblTrackedGameIds(),
      fetchWpblArticles(),
      // The gallery, which leads Home in the offseason and so is the card most in need of the
      // head start.
      fetchWpblFanPhotoIndex(),
      // The Watch card's posters. It sits on Home in both halves of the year and second from the
      // top in the offseason, and without this its read queued behind the Home chunk, starting
      // half a second after everything else.
      fetchWpblVideos(),
    ]).catch(() => { /* Home's own effect surfaces failures; this is only a head start */ })
  }, [])

  // Open the game named in a shared ?game=<id> link, once the schedule is available. A
  // final opens on its Recap tab by itself (see GameDetailModal), which is what the Discord
  // recap link is pointing at.
  //
  // Two spellings, as with a player: the canonical /wpbl/games/<slug> path, and the legacy
  // ?game=<uuid> still carried by shared links, push payloads and the Discord bot's posts.
  // A slug naming no game is left alone rather than falling back to the tab: the edge has
  // already answered a real 404 for it, and rendering the section instead would turn a dead
  // link into a soft 404. The slug needs the clubs as well as the schedule, because the
  // matchup half of it is nicknames.
  useEffect(() => {
    const id = pendingGameId.current
    const slug = pendingGameSlug.current
    if ((!id && !slug) || detailGame || games.length === 0) return
    if (slug && teams.length === 0) return
    pendingGameId.current = null
    pendingGameSlug.current = null
    const g = slug ? findWpblGameBySlug(slug, games, teams) : games.find(gm => gm.id === id)
    if (!g) return
    // A game arrived at, rather than opened from a row, is the full page. See WpblSnap.gamePage.
    openFromLink({ view, team: selectedTeam, game: g, player: detailPlayer, gamePage: true })
  }, [games, teams, detailGame, view, selectedTeam, detailPlayer, openFromLink])

  // Open the player named by the URL, once the roster is available. Two spellings: the
  // canonical /wpbl/players/<slug> path, and the legacy ?player=<uuid> that shared links and
  // the Discord bot still carry (the edge 301s those, but a client-side entry can skip it).
  //
  // A slug that resolves to nobody is left alone rather than falling back to Home: the edge
  // has already answered 404 for it on a cold load, and quietly showing the section instead
  // would turn a dead link into a soft 404.
  useEffect(() => {
    if (detailPlayer || players.length === 0) return
    const slug = pendingPlayerSlug.current
    const id = pendingPlayerId.current
    if (!slug && !id) return
    pendingPlayerSlug.current = null
    pendingPlayerId.current = null
    const p = slug ? findWpblPlayerBySlug(slug, players) : players.find(pl => pl.id === id)
    if (!p) return
    // Arrived at, so the full page, unless the link names a game as well (`?game=`): then the game
    // is the page and the player the panel beside it, whichever of the two resolves first.
    const withGame = !!detailGame || !!pendingGameSlug.current || !!pendingGameId.current
    openFromLink({ view, team: selectedTeam, game: detailGame, player: p, gamePage, playerPage: !withGame })
  }, [players, detailPlayer, view, selectedTeam, detailGame, gamePage, openFromLink])

  // A cold load on /wpbl/teams/<slug>: select that club once the clubs are in.
  //
  // `replaceState` rather than `openFromLink`, which is the whole difference between this and
  // the player effect above. A club is not a modal over a tab, it is the tab in a particular
  // state, so there is nothing for Back to unwind to and nothing to seat an entry under: the
  // reader is already where the URL says. Pushing here would make Back a no-op that appears
  // to do nothing, which is the trap openFromLink exists to avoid in the other direction.
  //
  // A slug that names no club is left alone rather than falling back to the bare tab. The
  // edge never sees these (they are enumerated in _redirects, so an unknown one is a real 404
  // before the app loads), but a stale link from a renamed club should not quietly render the
  // Teams tab under a URL claiming to be a club that no longer exists.
  useEffect(() => {
    if (teams.length === 0) return
    const slug = pendingTeamSlug.current
    if (!slug) return
    pendingTeamSlug.current = null
    const t = findWpblTeamBySlug(slug, teams)
    if (!t) return
    setSelectedTeam(t)
    setView('teams')
    // Stamp the entry the shell already created, which was seated before the clubs loaded and
    // so carries `team: null`. Without this the club is on screen and absent from the
    // snapshot, and the first Back or a refresh drops it while the address bar still names it.
    const snap: WpblSnap = { view: 'teams', team: t, game: null, player: null }
    // The club's own path, NOT `window.location.href`: anything that ran before the roster
    // landed has already had a chance to rewrite the bar, and re-stamping whatever is in it
    // would make that rewrite permanent. This is the one place that knows the URL is right.
    window.history.replaceState({ ...window.history.state, wpbl: snap }, '', wpblTeamPath(t, teams))
    window.dispatchEvent(new Event(WPBL_PATH_EVENT))
  }, [teams])

  // A player page is titled with the player's name and a game page with its final score,
  // neither of which ROUTES in seo.ts can know from the path. Register whichever one owns
  // the page, and clear it the moment that modal closes so the tag cannot outlive the page
  // it describes.
  //
  // ONE effect for both, in the same precedence urlFor uses. Two effects each calling
  // setDynamicSeo(null) on the state they do not own would race on every commit: closing a
  // player over a game would leave whichever ran last in charge, and the tags would end up
  // describing the game or nothing depending on render order.
  useEffect(() => {
    if (detailPlayer && players.length > 0) {
      const team = teams.find(t => t.id === detailPlayer.team_id)
      const club = team ? wpblFullName(team) : 'the WPBL'
      setDynamicSeo({
        path: wpblPlayerPath(detailPlayer, players),
        seo: {
          title: `${detailPlayer.name} Stats 2026 | WPBL | sportydolphin.fun`,
          description:
            `${detailPlayer.name} of the ${club}: 2026 Women's Pro Baseball League batting and pitching stats, game log, and season splits.`,
        },
      })
      return () => setDynamicSeo(null)
    }
    if (!detailPlayer && detailGame && games.length > 0 && teams.length > 0) {
      // The same wording the edge function serves an unfurler, from the same module, so a
      // crawler that renders the JS and one that only reads the HTML are told the same
      // thing about the same URL.
      const card = wpblGameCard(detailGame, teams)
      setDynamicSeo({
        path: wpblGamePath(detailGame, teams, games),
        seo: { title: card.title, description: card.description },
      })
      return () => setDynamicSeo(null)
    }
    setDynamicSeo(null)
  }, [detailPlayer, detailGame, players, games, teams])

  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])

  // Where each player has actually been playing, for the header search rows. Its own effect
  // rather than the landing-view warm-up below, because search works from every tab and that
  // warm-up only runs when the section opens on Home. fetchWpblAllLines is deduped and cached
  // app-wide, so asking again here costs nothing once anything else has asked.
  //
  // NOT UNTIL THE SEARCH IS FOCUSED. Every box-score line of the season is the largest read in the
  // section (~340KB of JSON, ~73KB gzipped), and this effect used to pull it on every tab for every
  // visitor, most of whom never search. Focus comes a few hundred ms before the first typed letter,
  // which is about what the read takes, and until it lands a row falls back to the roster's own
  // position label rather than showing nothing.
  const [positionIndex, setPositionIndex] = useState<Map<string, PrimaryPosition>>(() => new Map())
  const [searchUsed, setSearchUsed] = useState(false)
  useEffect(() => onFirstSearchFocus(() => setSearchUsed(true)), [])
  useEffect(() => {
    if (!searchUsed) return
    let cancelled = false
    fetchWpblAllLines()
      .then(l => { if (!cancelled) setPositionIndex(buildPositionIndex(l.batting, games)) })
      .catch(() => { /* search falls back to the roster's own labels */ })
    return () => { cancelled = true }
    // Keyed on the LENGTH rather than on `games` itself: the array's identity changes on every
    // live poll, and rebuilding a map of 118 names to hand every search row a new object thirty
    // times an hour buys nothing. What the index actually needs from the schedule is which
    // games to leave out, and that only moves when the schedule gains a game.
  }, [games.length, searchUsed])

  // Recent searches: the players and teams opened from the header search, newest first, so
  // the empty-query dropdown has something to show (opening a player page is the retention
  // event, and a search box with nothing typed would otherwise be a dead end). localStorage
  // only; see recentSearches.ts for why this is not the MLB recents store.
  const [recentSearches, setRecentSearches] = useState<WpblRecentItem[]>(getWpblRecents)
  const recordRecent = useCallback((item: WpblRecentItem) => {
    setRecentSearches(prev => {
      const next = mergeWpblRecent(prev, item)
      setWpblRecents(next)
      return next
    })
  }, [])
  const clearRecents = useCallback(() => { setRecentSearches([]); setWpblRecents([]) }, [])

  // The row handlers reach these through refs, so the builders below keep one identity. Both
  // close over the view, so as dependencies they rebuilt the builders on every tab switch, which
  // re-ran the two effects that publish rows to the search bridge, and each publish (a fresh
  // array, even an empty one) re-rendered the shell, this section and the tab just shown a second
  // and third time after the click. A row only needs the handler of the moment it is picked.
  const openPlayerRef = useRef(openPlayer)
  openPlayerRef.current = openPlayer
  const selectTeamRef = useRef(selectTeam)
  selectTeamRef.current = selectTeam

  // One place that turns a player/team into a self-describing toolbar row. Shared by the typed
  // results and the recents list so both look identical and both record the selection (a
  // recent re-selected bumps back to the front). The avatar is rebuilt from the live roster on
  // every render, so a traded player carries their current tint and team rather than a stale one.
  const buildPlayerRow = useCallback((p: WpblPlayer, source: 'result' | 'recent'): SearchResultRow => {
    const team = p.team_id ? teamById.get(p.team_id) : undefined
    const initials = p.name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
    return {
      key: `player-${p.id}`,
      title: p.name,
      // The number goes in the subtitle because a search CAN now be a number: type 7 and four
      // players come back, and without it the row that answered the question does not show the
      // thing it was asked about. Costs six characters on every other search.
      subtitle: [
        jerseyOf(p) ? `#${jerseyOf(p)}` : null,
        displayPositionFromIndex(p, positionIndex).label,
        team?.abbr,
      ].filter(Boolean).join(' · ') || undefined,
      avatar: {
        // The thumb, not the 512: this is a 32px avatar in a dropdown that can hold
        // twenty of them, and the shell's search takes one url rather than a set.
        imageUrl: wpblPortraitSet(p.name)?.src,
        fallbackText: initials,
        bg: wpblColor(p.team_id), ring: wpblSecondary(p.team_id),
        fit: 'cover', circle: true,
      },
      onSelect: () => {
        track(EVENTS.WPBL_SEARCH_PICKED, { type: 'player', id: p.id, source })
        recordRecent({ type: 'player', id: p.id, name: p.name }); setSearchQuery(''); openPlayerRef.current(p, 'search')
      },
    }
  }, [teamById, positionIndex, recordRecent])

  const buildTeamRow = useCallback((t: WpblTeam, source: 'result' | 'recent'): SearchResultRow => ({
    key: `team-${t.id}`,
    title: wpblFullName(t),
    subtitle: t.abbr,
    avatar: {
      imageUrl: wpblLogo(t.id) ?? undefined,
      fallbackText: t.abbr,
      bg: wpblColor(t.id), ring: wpblSecondary(t.id),
      fit: wpblLogoFill(t.id) ? 'cover' : 'contain', circle: true,
    },
    onSelect: () => {
      track(EVENTS.WPBL_SEARCH_PICKED, { type: 'team', id: t.id, source })
      recordRecent({ type: 'team', id: t.id, name: wpblFullName(t) }); setSearchQuery(''); selectTeamRef.current(t, 'search')
    },
  }), [recordRecent])

  // Filter players + teams on the typed query and push self-describing rows up to the
  // toolbar. The rows carry primitive avatar data (portrait/logo URLs + team colors) so the
  // always-loaded toolbar renders them without importing this lazy chunk; each onSelect
  // routes back through openPlayer/selectTeam, keeping the section's back-stack intact.
  // Matching is its own memo so the rows and the analytics below read the same answer rather
  // than filtering twice and being free to disagree. Counts are taken BEFORE the display slice:
  // "6 players" has to mean six, not "the cap".
  const matches = useMemo(() => {
    const raw = bridge.query.trim()
    // A jersey number, answered before the name path and on a SINGLE character: "7" is a real
    // search and cannot mean anything else, since no name contains a digit. 21 of the league's
    // numbers are worn by more than one player, so this returns all of them, in league order so
    // the four #7s arrive grouped by club rather than alphabetically interleaved.
    const jersey = jerseyQuery(raw)
    if (jersey) {
      const order = new Map(teams.map((t, i) => [t.id, i]))
      const p = players
        .filter(pl => jerseyOf(pl) === jersey)
        .sort((a, b) => (order.get(a.team_id ?? '') ?? 99) - (order.get(b.team_id ?? '') ?? 99)
          || a.name.localeCompare(b.name))
      return { q: raw.toLowerCase(), players: p, teams: [] as WpblTeam[] }
    }
    const q = raw.toLowerCase()
    if (q.length < 2) return null
    const p = players.filter(pl => pl.name.toLowerCase().includes(q))
    const t = teams.filter(tm => `${tm.city} ${tm.name} ${tm.abbr}`.toLowerCase().includes(q))
    return { q, players: p, teams: t }
  }, [bridge.query, players, teams])

  useEffect(() => {
    if (!matches) { updateSearchBridge({ resultRows: NO_ROWS }); return }
    const playerRows = matches.players.slice(0, 6).map(p => buildPlayerRow(p, 'result'))
    const teamRows = matches.teams.slice(0, 4).map(t => buildTeamRow(t, 'result'))
    updateSearchBridge({ resultRows: [...playerRows, ...teamRows] })
  }, [matches, buildPlayerRow, buildTeamRow])

  // The header search is on screen on every page in the section and was entirely unmeasured.
  // One event per SETTLED query, never per keystroke: a debounce, plus a per-mount set of
  // queries already logged so backspacing back through a word cannot re-fire it.
  //
  // The typed text is kept ONLY when the query matched nothing, because that is the one case
  // where the string itself is the finding: a player we are missing, or a spelling the filter
  // cannot reach, neither of which anyone will ever report. A query that did match is already
  // described by whichever row the reader picked, so storing it would be collecting freeform
  // user text for nothing.
  const loggedQueries = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!matches || loggedQueries.current.has(matches.q)) return
    const { q, players: pl, teams: tm } = matches
    const id = setTimeout(() => {
      loggedQueries.current.add(q)
      const empty = pl.length + tm.length === 0
      track(EVENTS.WPBL_SEARCHED, {
        length: q.length, players: pl.length, teams: tm.length,
        ...(empty ? { q: q.slice(0, 40) } : {}),
      })
    }, 700)
    return () => clearTimeout(id)
  }, [matches])

  // Resolve stored recents against the live roster and push them up as rows. A recent whose
  // player/team no longer exists (a rare merge or roster change) is dropped rather than shown
  // dead. Cleared on unmount along with the rest of the bridge (see the register effect).
  useEffect(() => {
    const rows = recentSearches.flatMap<SearchResultRow>(r => {
      if (r.type === 'player') {
        const p = players.find(pl => pl.id === r.id)
        return p ? [buildPlayerRow(p, 'recent')] : []
      }
      const t = teams.find(tm => tm.id === r.id)
      return t ? [buildTeamRow(t, 'recent')] : []
    })
    updateSearchBridge({ recentRows: rows, clearRecentSearches: clearRecents })
  }, [recentSearches, players, teams, buildPlayerRow, buildTeamRow, clearRecents])

  // Stamp the entry App created for /wpbl with the initial snapshot the first time we land,
  // so the first Back leaves the section and a refresh restores the view. On a Back/remount
  // the entry already carries a snapshot: leave it untouched.
  useEffect(() => {
    if (!window.history.state?.wpbl) {
      // `awards` IS LOAD-BEARING HERE. This runs on a cold load, before anything else, and `urlFor`
      // of a snapshot without it returns /wpbl: landing on /wpbl/awards would rewrite the address bar
      // to the section root in the first tick, so a copied link would lose the ballot before the page
      // had drawn. Same failure the Teams branch of `seed` describes.
      const s: WpblSnap = {
        view, team: selectedTeam, game: detailGame, player: detailPlayer, awards: awardsOpen,
      }
      // A LINK STRAIGHT TO THE BALLOT NEEDS SOMETHING TO CLOSE BACK ONTO, which is the whole of
      // what `openFromLink` exists to do for a player link, spelled out here because the ballot
      // needs none of the rest of it: there is nothing to resolve out of the URL, so it never
      // reaches that function. Stamped as one entry that already has the sheet open, the session
      // would have a single history entry, and `closeTop` is `history.back()`, so the X, the
      // backdrop and Escape would walk the reader out of the site instead of onto Home. So seat a
      // sheet-less entry underneath and push the ballot on top, and closing behaves exactly as it
      // would had they opened it themselves. Both halves run in this one synchronous block, so
      // nothing paints on /wpbl.
      if (s.awards) {
        const base: WpblSnap = { ...s, awards: false }
        window.history.replaceState({ ...window.history.state, wpbl: base }, '', urlFor(base))
        window.history.pushState({ ...window.history.state, wpbl: s }, '', urlFor(s))
      } else {
        window.history.replaceState({ ...window.history.state, wpbl: s }, '', urlFor(s))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply snapshots as the user moves through history. Pops that land outside /wpbl are the
  // App router swapping sections (MLB|WPBL): ignore them here.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      // Any path the section renders, which is every tab AND a player page. Comparing
      // against '/wpbl' alone would ignore every Back/Forward taken from /wpbl/standings and
      // friends; testing the tabs alone dropped every pop that LANDED on /wpbl/players/<slug>,
      // leaving the modals frozen while the address bar moved. See wpblAppOwnsPath.
      if (!wpblAppOwnsPath(window.location.pathname)) return
      apply(((e.state?.wpbl ?? null) as WpblSnap | null) ?? HOME_SNAP)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [apply])

  // The single in-progress game (there is only ever one at a time). The Game Center
  // (GameDetail) handles live + final alike, so opening any game routes there.
  const liveGame = useMemo(() => games.find(g => g.status === 'live') ?? null, [games])

  const reload = useCallback(() => {
    let cancelled = false
    // Don't spin forever if the backend is slow/overloaded: reveal the section (its views
    // show friendly empty states) after a few seconds. The reads still resolve and populate
    // teams/games when they land, so late data just fills in.
    const revealTimer = setTimeout(() => { if (!cancelled) setLoading(false) }, 10000)
    Promise.all([fetchWpblTeams(), fetchWpblSchedule()]).then(([t, g]) => {
      if (cancelled) return
      clearTimeout(revealTimer)
      setTeams(t); setFeedGames(g); setLoading(false)
    })
    // Deliberately NOT in that Promise.all: nothing waits on the mirrored calendar, and the
    // section must not sit behind it. It fills in the home clubs on the postseason rows when
    // it lands, and if it never lands those rows print exactly what they printed before the
    // table existed.
    fetchWpblSiteGames().then(rows => { if (!cancelled) setSiteGames(rows) }).catch(() => { /* keep last-good */ })
    return () => { cancelled = true; clearTimeout(revealTimer) }
  }, [])

  useEffect(() => reload(), [reload])

  // Keep the schedule / scoreboard / standings live as the official-feed ingest writes scores
  // and status changes. Teams are static, so only the schedule is re-fetched. Faster while a
  // game is in progress; `useForegroundInterval` owns the rest of the policy (front-of-screen
  // only, and a pull the moment the page comes back, bfcache restores included) for this and
  // the section's other live polls.
  //
  // THIS IS ALSO THE POLL THAT DISCOVERS A GAME HAS STARTED. The live surfaces below only ever
  // refresh a row they already believe is live, so a page opened before first pitch learns
  // about it here or not at all: whatever stops this loop freezes the whole section on a
  // pre-game schedule while every countdown on it keeps ticking.
  useForegroundInterval(
    () => { fetchWpblSchedule().then(setFeedGames).catch(() => {}) },
    liveGame ? 20000 : 60000,
  )

  return (
    // The roster the whole section links players by. It sits at the top because a slug needs
    // the FULL roster to know whether a name is ambiguous, and a board holding only its own
    // club's list would mint a bare slug for a name someone on another club also holds. See
    // LinkContext.tsx.
    <WpblLinkProvider roster={players} schedule={games} teams={teams}>
    {/* While a player or game modal is open it IS the page, so the tab underneath stops
        rendering an <h1> and the modal supplies it. See PageHeading.tsx. */}
    <WpblHeadingOwnerProvider owned={!detailPlayer && !detailGame}>
    {/* Cap + center on wide screens (site convention); full width on mobile. */}
    {/* THE COLUMN TRACKS THE SCALE, it is not a fixed screen width. What a text column is
        designed against is its own type, so pinning it at a screen width while the desktop
        scale moves makes every row wider than the words in it: club names on the left of a
        Teams card with their record marooned at the far right, a schedule row with a gulf
        between the matchup and the time. Home and the stats table break out of this column on
        purpose and DO spend extra width, on another chip and more columns; a list has nothing
        to spend it on. `chromePx` keeps the ratio the design was drawn at whatever the scale
        becomes. */}
    {/* A little room under the toolbar on a phone, where the first block (the scoreboard) would
        otherwise sit ~4px from it. A -1.5 tuck lived here for the pill row the phone used to pin
        up there, which the bottom bar replaced. */}
    <Box sx={{
      maxWidth: { xs: 720, md: chromePx(720) }, mx: 'auto', mt: { xs: 0.5, sm: 0 },
      ...panelShiftSx(panelOpen, contentW),
    }}>
      {/* No tab row here: on a phone the tabs are the bottom bar, and above that the shell's
          toolbar draws them from what this section publishes (src/sectionNav.ts). */}

      {/* Floor the view height on mobile so even a short tab (e.g. Standings) is tall enough to
          scroll the app toolbar fully off, so the page can keep it hidden (matching the tucked
          state the tab pager restores) instead of springing the toolbar back. */}
      <Box sx={{
        minHeight: { xs: 'calc(100dvh - 24px)', sm: 'auto' },
        // Scroll room under the floating bar, plus the device's own safe-area inset, so the
        // last card in a tab can always be scrolled clear of it.
        pb: bottomNav ? `calc(${BOTTOM_NAV_SPACE} + env(safe-area-inset-bottom, 0px))` : 0,
      }}>
      {/* THE FULL GAME CENTER, in place of the tabs rather than over them. The pager below stays
          mounted, hidden, so the tab a reader came from is exactly as they left it when Back
          closes the page. */}
      {showGamePage && detailGame && (
        <AppErrorBoundary inline where="tab">
          <Suspense fallback={<DetailPageSkeleton />}>
            <GameDetailModal
              key={detailGame.id}
              layout="page"
              game={detailGame}
              initialTab={expandTab.current ?? pendingGameTab.current}
              initialSide={pendingGameSide.current}
              teams={teams}
              games={games}
              onClose={closeTop}
              onOpenPlayer={openPlayer}
              onOpenTeam={selectTeamFromGame}
            />
          </Suspense>
        </AppErrorBoundary>
      )}
      {/* A PLAYER'S FULL PAGE, on the same terms. Its game log opens games as pages too (see
          openGameAt), so a reader can go page to page and Back walks them in order. */}
      {showPlayerPage && detailPlayer && (
        <AppErrorBoundary inline where="tab">
          <Suspense fallback={<DetailPageSkeleton />}>
            <PlayerDetailModal
              key={detailPlayer.id}
              layout="page"
              player={detailPlayer}
              teams={teams}
              games={games}
              players={players}
              onClose={closeTop}
              onOpenGame={openGameFromPlayer}
              onOpenBoard={openBoardFromPlayer}
            />
          </Suspense>
        </AppErrorBoundary>
      )}
      {loading
        ? (showGamePage || showPlayerPage ? null : view === 'home' ? <WpblHomeSkeleton /> : view === 'stats' ? <StatsSkeleton /> : <TabSkeleton view={view} />)
        : (
          // One panel per nav tab, in NAV order, so mobile can swipe between them. The `active` flag lets a
          // view react to becoming current after a swipe reuses its already-mounted node (e.g. Schedule
          // re-snapping to the next game); SwipeableViews keeps visited tabs mounted but hidden.
          // Full-bleed the swipe track to the screen edge on mobile (cancel the app's p:2 gutter), then hand
          // that 16px back to each pane via `padX`, so a swiped pane slides fully off-screen instead of
          // disappearing under a padded barrier.
          <Box sx={{ mx: { xs: -2, sm: 0 }, display: showGamePage || showPlayerPage ? 'none' : undefined }}>
          <SwipeableViews
            index={NAV.findIndex(n => n.key === view)}
            onIndexChange={i => selectTab(NAV[i].key, 'swipe')}
            minHeight={isMobileView ? 'calc(100dvh - 24px)' : undefined}
            padX={isMobileView ? 16 : 0}
            // KEPT ALIVE ON A DESKTOP TOO, as MLB's are. Without it the pager renders the active tab
            // alone above a phone's width, so every switch to Home threw away the gallery, Reading,
            // Watch and the rest and rebuilt them from their fetches: a waste the reader saw, since
            // each card redrew from its skeleton. A hidden tab neither polls nor holds the <h1>
            // (PanelActiveContext below, lib/panelActive.ts).
            keepAlive
            panels={NAV.map(n => {
              // EACH TAB HOLDS ITS OWN ERRORS. The pager keeps every visited tab mounted, so without
              // this a crash in one board took the bottom nav and the other four tabs down with it.
              const content = <AppErrorBoundary inline where="tab">{(() => {
                switch (n.key) {
                  case 'home':      return <WpblHome teams={teams} games={games} siteGames={siteGames} liveGame={liveGame} onOpenGame={openGame} onOpenPlayer={openPlayer} onOpenTeam={selectTeamFromHome} onViewStats={openStats} onViewTracking={openTracking} awardsOpen={awardsOpen} onOpenAwards={openAwards} onCloseAwards={closeAwards} />
                  case 'schedule':  return <ScheduleView teams={teams} games={games} siteGames={siteGames} onOpenGame={openGame} onOpenTeam={selectTeamFromSchedule} onOpenPlayer={openPlayer} active={view === 'schedule'} />
                  case 'standings': return <StandingsView teams={teams} games={games} onOpenTeam={selectTeamFromStandings} />
                  case 'stats':     return <WpblStatsView teams={teams} games={games} focus={statsFocus} active={view === 'stats'} newBoards={newBoards} onBoardSeen={markBoardSeen} onOpenPlayer={openPlayer} onOpenTeam={selectTeamFromStats} onOpenGame={openGame} />
                  case 'teams':     return <TeamsView teams={teams} games={games} selected={selectedTeam} onSelect={selectTeamFromTeams} onOpenGame={openGame} onOpenPlayer={openPlayer} onOpenStats={openStats} />
                }
              })()}</AppErrorBoundary>
              // On mobile the footer lives at the bottom of each tab pane rather than as one shared element
              // below the swipe area, so it slides with its page. Swiping lands on the new tab's top (its
              // footer off-screen) and a partial swipe that springs back moves nothing; no shared footer
              // reflows or pops mid-swipe. `mt: auto` pins it to the bottom of the floored pane on short tabs,
              // right after content on tall ones.
              const panel = (body: React.ReactNode) => (
                <PanelActiveContext.Provider key={n.key} value={n.key === view}>{body}</PanelActiveContext.Provider>
              )
              if (!isMobileView || !renderFooter) return panel(content)
              return panel(
                // Short tabs (Standings) don't scroll, so the footer pinned to the bottom of this
                // floored column landed underneath the floating bar. Shorten the floor by the
                // bar's height when it's on, so the footer comes to rest just above it.
                <Box sx={{ display: 'flex', flexDirection: 'column',
                  minHeight: bottomNav
                    ? `calc(100dvh - 24px - (${BOTTOM_NAV_SPACE}) - env(safe-area-inset-bottom, 0px))`
                    : 'calc(100dvh - 24px)' }}>
                  {content}
                  <Box sx={{ mt: 'auto' }}>{renderFooter()}</Box>
                </Box>
              )
            })}
          />
          </Box>
        )}
      </Box>

      {bottomNav && (
        <WpblBottomNav
          items={[
            ...NAV.map(n => ({ key: n.key, label: n.label, badge: navBadge(n.key) })),
            // The sixth slot: opens the sheet of non-tab pages (the phone's counterpart to the
            // toolbar's More menu).
            { key: MORE_KEY, label: 'More' },
          ]}
          value={view}
          onChange={k => selectTab(k as WpblView, 'pill')}
          onMore={() => setMoreSheetOpen(true)}
          moreOpen={moreSheetOpen}
        />
      )}
      {bottomNav && <MoreSheet open={moreSheetOpen} onClose={() => setMoreSheetOpen(false)} />}

      {/* /wpbl/awards after the ballot card has left Home: see FanAwardsSheet. Before that date the
          card draws the sheet itself, so exactly one of the two ever does. */}
      {awardsOpen && !awardsResultsShowOnHome() && (
        <FanAwardsSheet teams={teams} games={games} scheduleSettled={!loading}
          onOpenPlayer={openPlayer} onOpenTeam={selectTeamFromHome}
          onOpen={openAwards} onClose={closeTop} />
      )}

      {detailPlayer && !showPlayerPage && (
        <Suspense fallback={<ModalChunkFallback />}>
          <PlayerDetailModal
            player={detailPlayer}
            teams={teams}
            games={games}
            players={players}
            onClose={closeTop}
            onOpenGame={openGameFromPlayer}
            onOpenBoard={openBoardFromPlayer}
            panel={playerAsPanel}
            // Over the Game Center panel, this is one panel that navigated: Back is the way out.
            // Not beside the full page, which is still on screen and needs no way back to.
            onBack={detailGame && playerAsPanel && !showGamePage ? closeTop : undefined}
            backLabel="Game"
            onExpand={expandPlayer}
          />
        </Suspense>
      )}

      {detailGame && !showGamePage && (
        <Suspense fallback={<ModalChunkFallback />}>
          <GameDetailModal
            // Keyed, so a swap to another game remounts it (see GameOverlayHost).
            key={detailGame.id}
            game={detailGame}
            initialTab={pendingGameTab.current}
            initialSide={pendingGameSide.current}
            teams={teams}
            games={games}
            onClose={closeTop}
            onOpenPlayer={openPlayerFromGame}
            onOpenTeam={selectTeamFromGame}
            panel={playerAsPanel}
            onExpand={expandGame}
          />
        </Suspense>
      )}
    </Box>
    </WpblHeadingOwnerProvider>
    </WpblLinkProvider>
  )
}

// Memoized, as MlbStats is: the shell re-renders on every path change, which is the end of every
// tab click, and the section follows the address through its own popstate listener, so a shell
// render has nothing to tell it. Its one prop is a stable callback (App's renderWpblFooter).
export default memo(WpblApp)

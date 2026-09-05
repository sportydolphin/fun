import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Box, Typography, Skeleton, CircularProgress, useMediaQuery } from '@mui/material'
import {
  fetchWpblTeams, fetchWpblSchedule, fetchWpblAllPlayers, computeStandings,
  fetchWpblAllLines, fetchWpblAllTracking, fetchWpblVideos, fetchWpblArticles,
} from './api'
import { WPBL_ACCENT, wpblAccent, wpblColor, wpblSecondary, wpblLogo, wpblLogoFill, wpblFullName, formatGameTime } from './constants'
import { wpblPortrait } from './portraits'
import { buildPositionIndex, displayPositionFromIndex, type PrimaryPosition } from './positions'
import { SegNav, SectionLabel, TeamBadge, useWpblDark, CARD_BORDER, chromePx, hoverOnly, tappableIf } from './ui'
import { useSearchBridge, updateSearchBridge, setSearchQuery } from '../mlb/state/SearchBridgeContext'
import type { SearchResultRow } from '../mlb/state/SearchBridgeContext'
import { getWpblRecents, mergeWpblRecent, setWpblRecents, type WpblRecentItem } from './recentSearches'
import { jerseyQuery, jerseyOf } from './playerSearch'
import type { WpblTeam, WpblPlayer, WpblGame } from './types'
import { fmtSigned } from './stats'
import { seriesContexts } from './derive/series'
import { postseasonScheduleRows, type PostseasonScheduleRow, type PostseasonSlot } from './derive/bracket'
import { track, EVENTS } from '../lib/analytics'
import { shouldShowBadge, markBadgeSeen } from '../lib/seen'
import WpblHome, { WpblHomeSkeleton } from './Home'
import WpblStatsView, { type WpblStatsFocus } from './StatsView'
import TeamPage from './TeamPage'
import TeamsGrid from './TeamsGrid'
import SeedingRace from './SeedingRace'
import SwipeableViews from './SwipeableViews'
import WpblBottomNav, { BOTTOM_NAV_SPACE } from './BottomNav'
import { useExperiments } from '../ExperimentsContext'
import {
  WPBL_NAV, wpblPathFor, wpblViewFromPath, normalizeWpblView, WPBL_PATH_EVENT,
  wpblPlayerPath, wpblPlayerSlugFromPath, findWpblPlayerBySlug, isWpblPlayersIndex, wpblAppOwnsPath,
  wpblGamePath, wpblGameSlugFromPath, findWpblGameBySlug,
  wpblTeamPath, wpblTeamSlugFromPath, findWpblTeamBySlug,
  type WpblView,
} from './routes'
import { WpblLinkProvider, useWpblGameLink } from './LinkContext'
import { useForegroundInterval } from './refresh'
import { WpblHeadingOwnerProvider, useWpblHeadingTag, HIDE_ON_PHONE } from './PageHeading'
import { wpblGameCard } from './ogCard'
import { setDynamicSeo } from '../seo'

// The two detail modals, split out of the section's chunk.
//
// Neither is on screen when /wpbl loads — both open on a tap — but together they were about
// a third of what the landing view had to download and parse. GameDetail is the biggest
// single file in the section (line score, box score, play-by-play, pitch data, recap tab) and
// it drags Highlights, GamePreview and the live poller along with it.
const GameDetailModal = lazy(() => import('./GameDetail'))
/**
 * The same import, run while the section is idle.
 *
 * Opening a game is the primary act in this section: every row on Home and Schedule leads
 * there. Waiting until the tap to fetch a 32kB chunk buys nothing, and it costs the one thing
 * an opening animation cannot survive, which is a gap before it starts. The tap used to put a
 * spinner in the middle of the screen and then, a beat later, slide a sheet up from the
 * bottom edge: two unrelated movements for one gesture. Warmed here, the sheet is simply
 * there on the first frame and the fallback below is a formality.
 */
function usePreloadGameDetail() {
  useEffect(() => {
    const warm = () => { void import('./GameDetail') }
    const hasRIC = typeof window.requestIdleCallback === 'function'
    const id = hasRIC ? window.requestIdleCallback(warm, { timeout: 2000 }) : window.setTimeout(warm, 800)
    return () => { if (hasRIC) window.cancelIdleCallback(id as number); else window.clearTimeout(id as number) }
  }, [])
}
const PlayerDetailModal = lazy(() => import('./PlayerDetail'))

// Shown while a modal's chunk loads. A tap should visibly do something immediately, so this
// paints the scrim the modal itself is about to paint — the panel then fills in over it,
// rather than the tap appearing to have missed.
/**
 * Nothing at all for the first moment, then a spinner if the chunk really is slow.
 *
 * React.lazy suspends for at least a tick even when the module is already in memory, so this
 * rendered on EVERY open: a dimmed screen and a spinner in the middle, for 326ms measured,
 * and then a sheet sliding up from the bottom edge. Two unrelated movements for one tap, and
 * the reason opening felt unstable while closing felt fine.
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

// Shown while the first teams/schedule read is in flight, for every tab EXCEPT Home, which
// has its own (WpblHomeSkeleton, beside the layout it copies).
//
// This one used to serve Home as well and could not: it is drawn inside the section's 720px
// page column, and Home is the single view that breaks out of that column, so the placeholder
// and the page it stood in for were never the same width or anywhere near the same height.
// Everything else here IS a 720px view, which is what is left.
function ViewSkeleton() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
      <Skeleton variant="rounded" height={40} />
      <Skeleton variant="rounded" height={112} />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.4fr 1fr' }, columnGap: 2.5, rowGap: 2 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Skeleton variant="rounded" height={64} />
          <Skeleton variant="rounded" height={220} />
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Skeleton variant="rounded" height={200} />
          <Skeleton variant="rounded" height={160} />
        </Box>
      </Box>
    </Box>
  )
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

function ScheduleView({ teams, games, onOpenGame }: {
  teams: WpblTeam[]; games: WpblGame[]; onOpenGame: (g: WpblGame) => void
  active?: boolean // accepted (call site passes it) but unused now that ordering replaced auto-scroll
}) {
  const byId = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const isDark = useWpblDark()
  const gameLink = useWpblGameLink()
  const headingTag = useWpblHeadingTag()
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
  // The postseason, from the calendar the league published, for as long as the feed has no
  // rows of its own. Without this the schedule ended on Sep 6 while the bracket card two tabs
  // away was already counting down to Sep 9. Each row retires itself the day a real game
  // lands on its date; see postseasonScheduleRows.
  const postRows = useMemo(() => postseasonScheduleRows(standings, games), [standings, games])
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
  // games follow under an "Earlier" divider. Nothing moves the window, so the top pill nav
  // stays put when switching tabs (it isn't sticky on desktop).
  //
  // Fill the calendar gaps between the first and last game so off-days show up as a slim
  // "no games" marker — it reads as a continuous run of days, making the rhythm of when
  // games land easy to see. Nothing is added after the final game.
  const gameDates = [...byDate.keys()] // date-ascending
  const dates: string[] = []
  {
    const cursor = new Date(`${gameDates[0]}T00:00:00`)
    // Runs to the last date anything is scheduled on, which past Sep 6 is the published
    // postseason rather than the feed. Taking the later of the two keeps the calendar
    // continuous in both directions: before the league draws the bracket the tail is the
    // constant, and once it does the feed's own rows are the later date and take over.
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
      <Box key={r.id} sx={{
        display: 'flex', flexDirection: 'column', gap: 0.5, p: 1.25,
        borderRadius: 2, border: '1px dashed', borderColor: CARD_BORDER, bgcolor: 'background.paper',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {[r.first, r.second].map(slot)}
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
              schedule row to explain what the asterisk meant. */}
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: 'text.disabled' }}>
            {r.ifNecessary ? 'If necessary' : 'Scheduled'}
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
      {/* One divider where the regular season stops, so a reader scrolling past Sep 6 is told
          what the dashed cards below it are before meeting one. */}
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
                    {/* Winner caret on finals — fixed-width slot keeps both rows' badges aligned. */}
                    {final && (
                      <Box sx={{ width: '0.4375rem', flexShrink: 0, mx: -0.5, textAlign: 'center', fontSize: '0.8rem', lineHeight: 1, color: wpblAccent(t.id, isDark) }}>{won ? '▸' : ''}</Box>
                    )}
                    <TeamBadge team={t} size={26} />
                    {/* Away is the top row, home the bottom — a muted "@" prefix on the home team
                        reads as "away @ home" without a reserved gutter throwing off the spacing. */}
                    <Typography noWrap sx={{ fontSize: '0.9rem', fontWeight: won ? 800 : 600, flex: 1, minWidth: 0, color: final && !won ? 'text.secondary' : 'text.primary' }}>
                      {i === 1 && <Box component="span" sx={{ color: 'text.disabled', fontWeight: 600, mr: 0.5 }}>@</Box>}
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
              {/* "Semifinal · Game 2" and the record, which is the unit a fan tracks in
                  October and the one thing three rows between the same two clubs cannot say
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
      <Typography component={headingTag} sx={{ fontSize: '1.1rem', fontWeight: 800, letterSpacing: '-0.3px', lineHeight: 1.2, mb: 0.25, ...HIDE_ON_PHONE }}>
        WPBL Schedule
      </Typography>
      {lead.map(renderDate)}
      {earlier.length > 0 && <SectionLabel>Earlier</SectionLabel>}
      {earlier.map(renderDate)}
    </Box>
  )
}

function StandingsView({ teams, games, onOpenTeam }: {
  teams: WpblTeam[]; games: WpblGame[]; onOpenTeam?: (t: WpblTeam) => void
}) {
  const rows = useMemo(() => computeStandings(teams, games), [teams, games])
  const headingTag = useWpblHeadingTag()
  if (teams.length === 0) {
    return <EmptyState title="No teams yet" hint="Standings appear once teams and results are added." />
  }
  const played = games.some(g => g.status === 'final')
  const clickable = !!onOpenTeam
  // .667 (drop the leading zero); em dash before a team has played.
  const fmtPct = (pct: number, gp: number) => gp === 0 ? '—' : pct.toFixed(3).replace(/^0\./, '.')
  const th = { py: 0.85, px: 0.4, fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 0.4, color: 'text.secondary', textAlign: 'right' as const, whiteSpace: 'nowrap' as const }
  const td = { py: 1, px: 0.4, fontSize: '0.85rem', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const }
  // The numeric columns, in rem rather than px because `tableLayout: 'fixed'` means these
  // widths are the whole story: a cell wider than its column does not push it out, it spills.
  // At a 1.5 text scale the px versions had PCT and STRK overflowing by 2px, which on a
  // tabular-nums figure reads as a rendering fault rather than as text being large. 2.125rem
  // and 2.875rem are the 34px and 46px they have always been at the default root size.
  const NUM = 2.125, WIDE = 2.875
  const col = (rem: number) => `${rem}rem`
  // Below this the eight columns do not fit, and `tableLayout: 'fixed'` spends the shortfall
  // entirely on the one column without a width: at 320 the club name was left 4.8px, so the
  // table rendered as a badge and a single letter and three of the four clubs read alike.
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
    <Typography component={headingTag} sx={{ fontSize: '1.1rem', fontWeight: 800, letterSpacing: '-0.3px', lineHeight: 1.2, ...HIDE_ON_PHONE }}>
      WPBL Standings
    </Typography>
    <Box sx={{ border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, overflow: 'hidden' }}>
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
              <Box component="tr" key={r.team.id}
                onClick={clickable ? () => onOpenTeam!(r.team) : undefined}
                sx={{ borderTop: '1px solid', borderColor: 'divider', cursor: clickable ? 'pointer' : 'default', ...tappableIf(clickable) }}>
                <Box component="td" sx={{ ...td, textAlign: 'left', pl: 1.25 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                    <TeamBadge team={r.team} size={24} />
                    {/* Full name would truncate on mobile once the numeric columns claim their
                        fixed widths — fall back to the nickname there (the badge carries the city). */}
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
    </Box>
      {/* The table says who is ahead; this says what being ahead is FOR. All four clubs
          qualify, so the order is the entire stake of the remaining games, and the table on
          its own reads as a race for a place nobody can miss. Sits directly under it, in the
          same order, so a club can be carried from one to the other by eye.

          LIVE FOR EVERYONE from Sep 1, with five regular-season games left. It was opt-in
          because it is the first thing on the section to make a forward-looking claim, and the
          flag was the right caution in August. It stopped being right in September: this card
          is the only thing on the page with an expiry date on it, and an experiment nobody can
          see is not being tested. */}
      {played && <SeedingRace rows={rows} games={games} onOpenTeam={onOpenTeam} />}
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
}
const normalizeView = normalizeWpblView
const HOME_SNAP: WpblSnap = { view: 'home', team: null, game: null, player: null }

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

export default function WpblApp({ renderFooter }: { renderFooter?: () => ReactNode } = {}) {
  // Section is public/read-only (feed-driven). Ingest-health freshness moved to the site
  // Admin panel, so the section no longer needs an admin flag.

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
    return HOME_SNAP
  }
  // A legacy ?view=tracking (or a restored snapshot) should open Stats already on the
  // tracking group — token 1 so the panel treats it as a real request on first mount.
  const seedTracking = () =>
    normalizeView(window.history.state?.wpbl?.view ?? viewFromLocation()).wasTracking
  const [view, setView] = useState<WpblView>(() => seed().view)
  const [selectedTeam, setSelectedTeam] = useState<WpblTeam | null>(() => seed().team)
  const [detailGame, setDetailGame] = useState<WpblGame | null>(() => seed().game)
  const [detailPlayer, setDetailPlayer] = useState<WpblPlayer | null>(() => seed().player)
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
  // Which stat group the Stats view opens on (set when jumping there from Home leaders).
  // What the Stats tab should be showing when it's opened from a Home leader card. `token`
  // is the part that matters: the Stats panel stays MOUNTED once visited (SwipeableViews keeps
  // visited tabs alive), so a plain prop can't re-seed its state on a second visit — before
  // this, a second "View all" from the other card silently left the table on its first target.
  // Bumping the token on every jump gives the panel an unambiguous "re-focus now" signal, and
  // leaves it alone when the reader reaches Stats by tapping the tab or swiping.
  const [statsFocus, setStatsFocus] = useState<WpblStatsFocus>(
    () => (seedTracking() ? { group: 'tracking', token: 1 } : { group: 'hitting', token: 0 }))

  // "Something new here" dot for the Run value board, which lives one level deeper than a
  // tab: it is drawn on the Stats pill AND on the chip inside it, and only opening the board
  // retires it (see the note in lib/seen.ts). Cleared from StatsView, which is the only thing
  // that knows the reader actually got there. Read once at mount: shouldShowBadge() consults
  // localStorage and an expiry date, and neither changes under us mid-session.
  //
  // Two tabs have carried this dot before and neither does now: Teams for the v1.45.0 rebuild,
  // Pitch by pitch for v1.47.0. Each was pulled by hand rather than left to expire, and each
  // registration went with its call site, which is what lib/seen.ts means by deleting a badge
  // in one go. One dot at a time: a second would land on this same Stats pill and say nothing
  // the first had not.
  const [runsBadge, setRunsBadge] = useState(() => shouldShowBadge('runs-v152'))
  // Impression, logged once per mount rather than per render, so the click-through rate has
  // an honest denominator. Without this half of the point is lost: a nudge you cannot
  // measure is a nudge you will be guessing about next time.
  const runsBadgeLogged = useRef(false)
  useEffect(() => {
    if (!runsBadge || runsBadgeLogged.current) return
    runsBadgeLogged.current = true
    track(EVENTS.NEW_BADGE_SHOWN, { badge: 'runs-v152' })
  }, [runsBadge])
  // Guarded by a ref rather than by the state it sets, for two reasons: the callback stays
  // referentially stable (StatsView calls it from an effect, and a changing identity would
  // re-run that effect on every retirement), and the click is tracked OUTSIDE a state updater,
  // which React is free to run twice.
  const runsBadgeLive = useRef(runsBadge)
  const retireRunsBadge = useCallback((via: string) => {
    if (!runsBadgeLive.current) return
    runsBadgeLive.current = false
    track(EVENTS.NEW_BADGE_CLICKED, { badge: 'runs-v152', via })
    markBadgeSeen('runs-v152')
    setRunsBadge(false)
  }, [])

  // Which tabs are wearing a dot. Kept as a function rather than inlined into both navs, so a
  // future badge is added in one place and the two navs cannot disagree.
  const navBadge = (key: string): boolean => key === 'stats' && runsBadge

  const [teams, setTeams] = useState<WpblTeam[]>([])
  const [games, setGames] = useState<WpblGame[]>([])
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  const [loading, setLoading] = useState(true)
  const isMobileView = useMediaQuery('(max-width:600px)')
  const navRef = useRef<HTMLDivElement>(null)
  // Experimental bottom tab bar — phones only, opt-in from Settings. While it's on it
  // REPLACES the sticky top pills rather than sitting alongside them: two navs for the same
  // five destinations would be worse than either alone, and the point is to feel the bottom
  // bar as it would actually ship. Desktop keeps the pills regardless — a bottom bar is
  // wrong at 1280px.
  const experiments = useExperiments()
  const bottomNav = experiments && isMobileView

  // Mobile: once the page scrolls and the sticky pill bar pins to the top, give it a
  // hairline + soft shadow so content reads as sliding *under* a bar rather than under a
  // dead grey band. Cheap window-scroll listener, passive.
  const [navStuck, setNavStuck] = useState(false)

  // Publish this bar's pinned height as --wpbl-nav-h, the mobile counterpart to the
  // toolbar's --app-header-h. Exactly one of the two is sticky at a time — the toolbar on
  // desktop, this bar on mobile — so a view that wants to pin something of its own below
  // the chrome can offset by the sum and be right on both. Keyed off the computed position
  // (and re-measured on resize) so the static desktop case reports 0 rather than a height
  // nothing is actually holding, and so the bottom-nav experiment, which hides this bar
  // entirely, collapses to 0 on its own.
  useEffect(() => {
    const el = navRef.current
    const publish = () => {
      const pinned = el && getComputedStyle(el).position === 'sticky'
      // The RECT height, not offsetHeight, which rounds to a whole pixel. A bar 43.67px tall
      // published itself as 44, so anything sticking at that offset sat a third of a pixel
      // below this one's bottom edge and the page scrolled through the crack: one device
      // pixel of a stats row, running along under the nav the whole way down. Fractional CSS
      // pixels are what the browser is laying out in, so hand it those.
      //
      // No division any more: this section renders at the desktop scale in CSS rather than
      // under a `zoom`, so a rect and a sticky `top` are the same pixel here. The division
      // that used to sit here was a no-op even then (this bar only pins on mobile, where the
      // zoom was 1), kept against the day the conditions moved. They moved by being removed.
      document.documentElement.style.setProperty(
        '--wpbl-nav-h', pinned ? `${el!.getBoundingClientRect().height}px` : '0px')
    }
    publish()
    const ro = new ResizeObserver(publish)
    if (el) ro.observe(el)
    window.addEventListener('resize', publish)
    return () => { ro.disconnect(); window.removeEventListener('resize', publish) }
  }, [bottomNav, isMobileView])

  useEffect(() => {
    const onScroll = () => setNavStuck(window.scrollY > 4)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Toolbar search bridge — WpblApp owns the shared header search while /wpbl is mounted.
  const bridge = useSearchBridge()

  // ── History-driven navigation ────────────────────────────────────────────────
  const apply = useCallback((s: WpblSnap) => {
    // Normalise on the way in too: history entries pushed before Tracking folded into Stats
    // are still in the reader's back stack, and Back must not land on a tab that's gone.
    const { view: v, wasTracking } = normalizeView(s.view)
    if (wasTracking) setStatsFocus(f => ({ group: 'tracking', token: f.token + 1 }))
    setView(v); setSelectedTeam(s.team); setDetailGame(s.game); setDetailPlayer(s.player)
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
    // hundred near-duplicates of Schedule), which meant every recap the section has ever
    // rendered was unindexable by design. It also gives the schedule cards an href, which
    // is what makes them links a crawler can follow rather than onClick divs.
    //
    // A PLAYER opened from a game keeps the player's path and leaves the game on the query,
    // unchanged from before: the deeper modal is the page, the one under it is state.
    //
    // Falls back to the query form while the schedule or the clubs are still in flight,
    // since a slug cannot be proven unique without the whole schedule (see wpblGameSlug).
    if (s.game && !s.player && games.length > 0 && teams.length > 0) {
      return wpblGamePath(s.game, teams, games)
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

    // A CLUB SELECTED ON ITS OWN TAB OWNS THE PATH. Selecting one opens roughly 2,800px of
    // content (results, team stats, lineup history, pitching usage, both leader boards, the
    // roster) that had no URL at all until Sep 2, 2026: unindexable, unlinkable, and with no
    // href to give the cards, which is why they were role="button" divs.
    //
    // Only on the Teams tab, because `selectedTeam` deliberately rides along through a tab
    // switch: a reader who picks a club and swipes to Stats is on Stats, and the path has to
    // say so. Below the game and player branches above for the same reason those are ordered
    // that way, the deeper modal being the page and what is under it being state.
    const str = q.toString()
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
  /** And for /wpbl/teams/<slug>, which selects a club on the Teams tab rather than opening a
   *  modal, so it is applied with the tab itself rather than through `openFromLink`. */
  const pendingTeamSlug = useRef<string | null>(
    window.history.state?.wpbl ? null : wpblTeamSlugFromPath(window.location.pathname),
  )
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
   * THIS IS NOT `push`, AND IT IS NOT `replaceState` EITHER, WHICH IS THE BUG THIS FIXES.
   * A deep link used to open its modal with replaceState, so the whole session history was a
   * single entry that already had the modal open. `closeTop` is `history.back()`, so the X,
   * the backdrop and Escape all had nothing to walk back to: from the only entry in the
   * session, back() either does nothing or leaves the site. Anyone arriving on a player from
   * a pasted link was trapped in the modal.
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
  // this component and lands here: seating a base there REPLACED the index entry with a bare
  // /wpbl, and Back from a player returned to the section root instead of the list the reader
  // was just reading.
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
  // Tab switches carry HOW the reader got there. Cloudflare already counts the ?view= paths,
  // so this deliberately isn't a page-view log (see analytics.ts) — the part Cloudflare can't
  // answer is the `via`: a pill tap is a deliberate choice, a swipe often just passes through
  // on the way somewhere else, and a card link is the Home feed doing its job. That's what
  // tells us whether the six-tab nav is actually working on a phone, where the last tab sits
  // off-screen. Back/forward navigations go through popstate, not here, and aren't counted.
  const selectTab = useCallback((v: WpblView, via: 'pill' | 'swipe' | 'link' = 'pill') => {
    if (v !== view) track(EVENTS.WPBL_TAB_VIEWED, { view: v, via, from: view })
    // Tapping the tab you are already on returns it to its root. This matters for Teams and
    // nowhere else: `selectedTeam` rides along through every tab switch (so swiping out to
    // Stats and back keeps the team page you were reading), but nothing ever cleared it — so
    // once any team page had been opened, the four-team grid became unreachable. A team
    // opened from the Stats table was especially stuck: Back went to Stats, and the Teams
    // pill just re-opened the same team.
    const backToRoot = v === view && via === 'pill'
    push({ view: v, team: backToRoot ? null : selectedTeam, game: null, player: null })
  }, [push, selectedTeam, view])
  // Every team-page open in the section funnels through here, so it is the only place that can
  // count them all. Until this existed the only team opens on record were the seeding card's and
  // the bracket's, which measured two widgets rather than the surface: the Teams grid, the
  // standings table, the Stats table and the header search all reached a team page unseen.
  //
  // `from` names the SURFACE, not the widget, and the two card events stay where they are
  // because they carry the seed, so a bracket click lands in both. That is deliberate:
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
    opts?: Pick<WpblStatsFocus, 'mode' | 'teamId' | 'qualified'>,
  ) => {
    setStatsFocus(f => ({ group: g, sortKey, ...opts, token: f.token + 1 }))
    selectTab('stats', 'link')
  }, [selectTab])
  // Tracking is a Stats group now, so "view the tracking boards" means "open Stats on it".
  const openTracking = useCallback(() => openStats('tracking'), [openStats])
  const openGame   = useCallback((g: WpblGame) => push({ view, team: selectedTeam, game: g, player: null }), [push, view, selectedTeam])
  // `from` defaults to the surface the reader is standing on, which is right for every in-page
  // link. The header search has to override it: search works from every tab, so left to the
  // default a player opened from the search box reports whichever tab happened to be behind it.
  // Opening a player page is the retention event, which makes that the one attribution error
  // here worth spending a parameter on.
  const openPlayer = useCallback((p: WpblPlayer, from?: string) => {
    track(EVENTS.WPBL_PLAYER_OPENED, { playerId: p.id, teamId: p.team_id, from: from ?? (detailGame ? 'game' : view) })
    push({ view, team: selectedTeam, game: detailGame, player: p })
  }, [push, view, selectedTeam, detailGame])
  // Closing a modal (X or Escape) walks history back, so it and the browser Back button are
  // the same action and never fall out of sync.
  const closeTop   = useCallback(() => window.history.back(), [])
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
  // clears only when teams+schedule resolve — so they used to queue behind that round trip.
  // On production the first three requests went out at 444 ms and the remaining ones did not
  // start until 1454 ms: a full second of serialized latency that bought nothing, since none
  // of these reads depend on teams or games. Firing them here overlaps the two waves.
  //
  // This is a warm-up, not a load: the results land in the api layer's session cache and the
  // rest is unchanged. Home still owns the fetching, still renders from the same cache
  // getters, and still revalidates on its own schedule. If Home mounts while these are in
  // flight, `once()` hands it the same promises instead of issuing a second set; if they have
  // already settled, Home seeds straight from cache and skips the round trip entirely.
  //
  // Deliberately scoped to a Home landing. Deep links (a shared ?game=, or ?view=stats) open
  // a view that wants a different, smaller slice, so this should not be speculative.
  //
  // The whole-season play-by-play used to be prefetched here as well, and it was by far the
  // most expensive read on the section. It fed the Hall of Firsts card and nothing else, so
  // retiring that card retired the read with it.
  const landsOnHome = useRef(view === 'home')
  useEffect(() => {
    if (!landsOnHome.current) return
    void Promise.all([
      fetchWpblAllLines(),
      fetchWpblAllTracking(),
      fetchWpblVideos(),
      fetchWpblArticles(),
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
    openFromLink({ view, team: selectedTeam, game: g, player: detailPlayer })
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
    openFromLink({ view, team: selectedTeam, game: detailGame, player: p })
  }, [players, detailPlayer, view, selectedTeam, detailGame, openFromLink])

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
  const [positionIndex, setPositionIndex] = useState<Map<string, PrimaryPosition>>(() => new Map())
  useEffect(() => {
    let cancelled = false
    fetchWpblAllLines()
      .then(l => { if (!cancelled) setPositionIndex(buildPositionIndex(l.batting)) })
      .catch(() => { /* search falls back to the roster's own labels */ })
    return () => { cancelled = true }
  }, [])

  // Recent searches: the players and teams opened from the header search, newest first, so
  // the empty-query dropdown has something to show (traffic says opening a player page is the
  // retention event, and the search box was a dead end with nothing typed). localStorage only
  // — see recentSearches.ts for why this is not the MLB recents store.
  const [recentSearches, setRecentSearches] = useState<WpblRecentItem[]>(getWpblRecents)
  const recordRecent = useCallback((item: WpblRecentItem) => {
    setRecentSearches(prev => {
      const next = mergeWpblRecent(prev, item)
      setWpblRecents(next)
      return next
    })
  }, [])
  const clearRecents = useCallback(() => { setRecentSearches([]); setWpblRecents([]) }, [])

  // One place that turns a player/team into a self-describing toolbar row. Shared by the typed
  // results and the recents list so both look identical and both record the selection (a
  // recent re-selected bumps back to the front). The avatar is rebuilt from the live roster on
  // every render, so a traded player carries her current tint and team rather than a stale one.
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
        imageUrl: wpblPortrait(p.name) ?? undefined,
        fallbackText: initials,
        bg: wpblColor(p.team_id), ring: wpblSecondary(p.team_id),
        fit: 'cover', circle: true,
      },
      onSelect: () => {
        track(EVENTS.WPBL_SEARCH_PICKED, { type: 'player', id: p.id, source })
        recordRecent({ type: 'player', id: p.id, name: p.name }); setSearchQuery(''); openPlayer(p, 'search')
      },
    }
  }, [teamById, positionIndex, recordRecent, openPlayer])

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
      recordRecent({ type: 'team', id: t.id, name: wpblFullName(t) }); setSearchQuery(''); selectTeam(t, 'search')
    },
  }), [recordRecent, selectTeam])

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
    if (!matches) { updateSearchBridge({ resultRows: [] }); return }
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
  // the entry already carries a snapshot — leave it untouched.
  useEffect(() => {
    if (!window.history.state?.wpbl) {
      const s: WpblSnap = { view, team: selectedTeam, game: detailGame, player: detailPlayer }
      window.history.replaceState({ ...window.history.state, wpbl: s }, '', urlFor(s))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply snapshots as the user moves through history. Pops that land outside /wpbl are the
  // App router swapping sections (MLB|WPBL) — ignore them here.
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
      setTeams(t); setGames(g); setLoading(false)
    })
    return () => { cancelled = true; clearTimeout(revealTimer) }
  }, [])

  useEffect(() => reload(), [reload])

  // Keep the schedule / scoreboard / standings live as the official-feed ingest writes scores
  // and status changes. Teams are static, so only the schedule is re-fetched. Faster while a
  // game is in progress; `useForegroundInterval` owns the rest of the policy (front-of-screen
  // only, and a pull the moment the page comes back, bfcache restores included) for this and
  // the three live polls that used to each answer the question differently.
  //
  // THIS IS ALSO THE POLL THAT DISCOVERS A GAME HAS STARTED. The live surfaces below only ever
  // refresh a row they already believe is live, so a page opened before first pitch learns
  // about it here or not at all: whatever stops this loop freezes the whole section on a
  // pre-game schedule while every countdown on it keeps ticking.
  useForegroundInterval(
    () => { fetchWpblSchedule().then(setGames).catch(() => {}) },
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
    {/* Cap + center on wide screens (site convention); full width on mobile.
        On mobile, pull up to trim most of the app's top gutter (p:2) above the pill nav: the
        toolbar already sits right above it, so the extra gap just reads as dead space at rest. */}
    {/* THE COLUMN TRACKS THE SCALE, it is not a fixed screen width.
        It was pinned at 1008 for one commit, on the reasoning that 720 layout px under the old
        1.4 zoom rendered at 1008 and the column should keep the width it had. That is the wrong
        invariant. What a text column is designed against is its own type, and the scale moved
        to 1.25 while 1008 stayed put, so every row in here got 12% wider than the words in it:
        club names on the left of a Teams card with their record marooned at the far right, a
        schedule row with a gulf between the matchup and the time. Home and the stats table
        break out of this column on purpose and DO spend extra width, on another chip and more
        columns; a list has nothing to spend it on. `chromePx` keeps the ratio the design was
        drawn at whatever the scale becomes. */}
    <Box sx={{ maxWidth: { xs: 720, md: chromePx(720) }, mx: 'auto', mt: { xs: -1.5, sm: 0 } }}>
      {/* Section nav — shared SegControl pill bar, matching the MLB tab bar. */}
      {/* Tab bar stays put on mobile (sticky under the toolbar) so it doesn't scroll away
          when swiping to a tab or when the schedule snaps to the next game. */}
      <Box ref={navRef} sx={{
        display: bottomNav ? { xs: 'none', sm: 'block' } : 'block',
        position: { xs: 'sticky', sm: 'static' }, top: { xs: 0, sm: 'auto' }, zIndex: 3,
        bgcolor: 'background.default',
        // Tight opaque bar that hugs the pills; the breathing gap below is transparent
        // margin (not painted), so content scrolls right up under the pills with no slab.
        // Equal padding above and below the pills so the bar sits symmetric around them.
        pt: { xs: 0.75, sm: 0 }, pb: { xs: 0.75, sm: 0 }, mb: { xs: 0.75, sm: 0 },
        // Full-bleed the bar (bg + hairline) to the screen edge on mobile; SegNav sits
        // flush inside and supplies its own resting inset via scroll padding.
        mx: { xs: -2, sm: 0 },
        transition: 'box-shadow 0.2s, border-color 0.2s',
        borderBottom: '1px solid',
        borderColor: navStuck ? 'divider' : 'transparent',
        boxShadow: navStuck ? '0 4px 12px rgba(0,0,0,0.06)' : 'none',
      }}>
        {/* href per pill: these are five separate URLs now, and a crawler only finds the
            other four by following a real link from this bar. */}
        <SegNav
          options={NAV.map(n => ({
            value: n.key, label: n.label, badge: navBadge(n.key), href: wpblPathFor(n.key),
          }))}
          value={view}
          onChange={v => selectTab(v as WpblView, 'pill')}
        />
      </Box>

      {/* Floor the view height on mobile so even a short tab (e.g. Standings) is tall enough to
          scroll the app toolbar fully off — leaving room for roughly the sticky pill nav's
          height means the page can still scroll the toolbar away and keep it hidden (matching
          the tucked state the tab pager restores), instead of springing the toolbar back. */}
      <Box sx={{
        minHeight: { xs: 'calc(100dvh - 24px)', sm: 'auto' },
        // Scroll room under the floating bar, plus the device's own safe-area inset, so the
        // last card in a tab can always be scrolled clear of it.
        pb: bottomNav ? `calc(${BOTTOM_NAV_SPACE} + env(safe-area-inset-bottom, 0px))` : 0,
      }}>
      {loading
        ? (view === 'home' ? <WpblHomeSkeleton /> : <ViewSkeleton />)
        : (
          // One panel per nav tab, in NAV order, so mobile can swipe between them (the
          // active one — and, mid-swipe, its neighbour — are the only ones mounted). The
          // `active` flag lets a view react to becoming current after a swipe reuses its
          // already-mounted node (e.g. Schedule re-snapping to the next game).
          // Full-bleed the swipe track to the screen edge on mobile (cancel the app's p:2
          // gutter), then hand that 16px back to each pane via `padX` — so a swiped pane
          // slides fully off-screen instead of disappearing under a padded barrier.
          <Box sx={{ mx: { xs: -2, sm: 0 } }}>
          <SwipeableViews
            index={NAV.findIndex(n => n.key === view)}
            onIndexChange={i => selectTab(NAV[i].key, 'swipe')}
            minHeight={isMobileView ? 'calc(100dvh - 24px)' : undefined}
            stickyNavRef={navRef}
            padX={isMobileView ? 16 : 0}
            panels={NAV.map(n => {
              const content = (() => {
                switch (n.key) {
                  case 'home':      return <WpblHome teams={teams} games={games} liveGame={liveGame} onOpenGame={openGame} onOpenPlayer={openPlayer} onOpenTeam={selectTeamFromHome} onViewStats={openStats} onViewTracking={openTracking} />
                  case 'schedule':  return <ScheduleView teams={teams} games={games} onOpenGame={openGame} active={view === 'schedule'} />
                  case 'standings': return <StandingsView teams={teams} games={games} onOpenTeam={selectTeamFromStandings} />
                  case 'stats':     return <WpblStatsView teams={teams} games={games} focus={statsFocus} active={view === 'stats'} newBoardBadge={runsBadge} onNewBoardSeen={retireRunsBadge} onOpenPlayer={openPlayer} onOpenTeam={selectTeamFromStats} />
                  case 'teams':     return <TeamsView teams={teams} games={games} selected={selectedTeam} onSelect={selectTeamFromTeams} onOpenGame={openGame} onOpenPlayer={openPlayer} onOpenStats={openStats} />
                }
              })()
              // On mobile the footer lives at the bottom of each tab pane rather than as one
              // shared element below the swipe area — so it slides with its page. Swiping lands
              // on the new tab's top (its footer off-screen) and a partial swipe that springs
              // back moves nothing; no shared footer reflows/pops mid-swipe. `mt: auto` pins it
              // to the bottom of the floored pane on short tabs, right after content on tall ones.
              if (!isMobileView || !renderFooter) return content
              return (
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
          items={NAV.map(n => ({ key: n.key, label: n.label, badge: navBadge(n.key) }))}
          value={view}
          onChange={k => selectTab(k as WpblView, 'pill')}
        />
      )}

      {detailPlayer && (
        <Suspense fallback={<ModalChunkFallback />}>
          <PlayerDetailModal
            player={detailPlayer}
            teams={teams}
            games={games}
            players={players}
            onClose={closeTop}
            onOpenGame={openGame}
          />
        </Suspense>
      )}

      {detailGame && (
        <Suspense fallback={<ModalChunkFallback />}>
          <GameDetailModal
            game={detailGame}
            teams={teams}
            games={games}
            onClose={closeTop}
            onOpenPlayer={openPlayer}
            onOpenTeam={selectTeamFromGame}
          />
        </Suspense>
      )}
    </Box>
    </WpblHeadingOwnerProvider>
    </WpblLinkProvider>
  )
}

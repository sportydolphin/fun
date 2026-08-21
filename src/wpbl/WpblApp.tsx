import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Box, Typography, Skeleton, CircularProgress, useMediaQuery } from '@mui/material'
import {
  fetchWpblTeams, fetchWpblSchedule, fetchWpblAllPlayers, computeStandings,
  fetchWpblAllLines, fetchWpblAllTracking, fetchWpblVideos, fetchWpblArticles,
} from './api'
import { WPBL_ACCENT, wpblAccent, wpblColor, wpblSecondary, wpblLogo, wpblLogoFill, wpblFullName, formatGameTime } from './constants'
import { wpblPortrait } from './portraits'
import { buildPositionIndex, displayPositionFromIndex, type PrimaryPosition } from './positions'
import { SegNav, SectionLabel, TeamBadge, useWpblDark, CARD_BORDER } from './ui'
import { useSearchBridge, updateSearchBridge, setSearchQuery } from '../mlb/state/SearchBridgeContext'
import type { SearchResultRow } from '../mlb/state/SearchBridgeContext'
import type { WpblTeam, WpblPlayer, WpblGame } from './types'
import { fmtSigned } from './stats'
import { track, EVENTS } from '../lib/analytics'
import { shouldShowBadge, markBadgeSeen } from '../lib/seen'
import WpblHome from './Home'
import WpblStatsView, { type WpblStatsFocus } from './StatsView'
import TeamPage from './TeamPage'
import TeamsGrid from './TeamsGrid'
import HeadToHead from './HeadToHead'
import SeedingRace from './SeedingRace'
import SwipeableViews from './SwipeableViews'
import WpblBottomNav, { BOTTOM_NAV_SPACE } from './BottomNav'
import { useExperiments } from '../ExperimentsContext'

// The two detail modals, split out of the section's chunk.
//
// Neither is on screen when /wpbl loads — both open on a tap — but together they were about
// a third of what the landing view had to download and parse. GameDetail is the biggest
// single file in the section (line score, box score, play-by-play, pitch data, recap tab) and
// it drags Highlights, GamePreview and the live poller along with it.
const GameDetailModal = lazy(() => import('./GameDetail'))
const PlayerDetailModal = lazy(() => import('./PlayerDetail'))

// Shown while a modal's chunk loads. A tap should visibly do something immediately, so this
// paints the scrim the modal itself is about to paint — the panel then fills in over it,
// rather than the tap appearing to have missed.
function ModalChunkFallback() {
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

type WpblView = 'home' | 'schedule' | 'standings' | 'stats' | 'teams'

const NAV: { key: WpblView; label: string }[] = [
  { key: 'home',      label: 'Home' },
  { key: 'schedule',  label: 'Schedule' },
  { key: 'standings', label: 'Standings' },
  { key: 'stats',     label: 'Stats' },
  { key: 'teams',     label: 'Teams' },
]

// ─── Shared bits ──────────────────────────────────────────────────────────────

// Shown while the first teams/schedule read is in flight. Roughly mirrors the Home
// layout (header strip, scoreboard, two-column card stack) so the initial render
// approximates the final page instead of a centered spinner popping into a full page.
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
  // Season-to-date record per team, so upcoming games can show each side's W-L.
  const recordById = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of computeStandings(teams, games)) m.set(r.team.id, `${r.wins}-${r.losses}`)
    return m
  }, [teams, games])
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
    const end = new Date(`${gameDates[gameDates.length - 1]}T00:00:00`)
    while (cursor <= end) {
      const y = cursor.getFullYear()
      const m = String(cursor.getMonth() + 1).padStart(2, '0')
      const d = String(cursor.getDate()).padStart(2, '0')
      dates.push(`${y}-${m}-${d}`)
      cursor.setDate(cursor.getDate() + 1)
    }
  }
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

  const renderDate = (date: string) => {
    const dayGames = byDate.get(date)
    // Off-day: a slim dashed marker instead of game cards, so gaps between game days are visible.
    if (!dayGames) {
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
      <SectionLabel>{dateLabel(date)}</SectionLabel>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {dayGames.map(g => {
          const home = byId.get(g.home_team_id)
          const away = byId.get(g.away_team_id)
          const final = g.status === 'final' && g.home_score != null && g.away_score != null
          const live = g.status === 'live'
          return (
            <Box key={g.id} onClick={() => onOpenGame(g)} sx={{
              display: 'flex', alignItems: 'center', gap: 1, p: 1.25, cursor: 'pointer',
              // Completed games get a muted fill so past reads as visually settled vs. crisp upcoming cards.
              // action.hover is too faint against the dark paper, so use a stronger explicit tint there.
              borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER,
              bgcolor: final ? (isDark ? 'rgba(255,255,255,0.09)' : 'action.hover') : 'background.paper',
              transition: 'border-color 0.15s', '&:hover': { borderColor: 'text.disabled' },
            }}>
              <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {[away, home].map((t, i) => {
                  const score = i === 0 ? g.away_score ?? 0 : g.home_score ?? 0
                  const other = i === 0 ? g.home_score ?? 0 : g.away_score ?? 0
                  const won = final && score > other
                  return t && (
                  <Box key={t.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                    {/* Winner caret on finals — fixed-width slot keeps both rows' badges aligned. */}
                    {final && (
                      <Box sx={{ width: 7, flexShrink: 0, mx: -0.5, textAlign: 'center', fontSize: '0.8rem', lineHeight: 1, color: wpblAccent(t.id, isDark) }}>{won ? '▸' : ''}</Box>
                    )}
                    <TeamBadge team={t} size={26} />
                    {/* Away is the top row, home the bottom — a muted "@" prefix on the home team
                        reads as "away @ home" without a reserved gutter throwing off the spacing. */}
                    <Typography noWrap sx={{ fontSize: '0.9rem', fontWeight: won ? 800 : 600, flex: 1, minWidth: 0, color: final && !won ? 'text.secondary' : 'text.primary' }}>
                      {i === 1 && <Box component="span" sx={{ color: 'text.disabled', fontWeight: 600, mr: 0.5 }}>@</Box>}
                      {wpblFullName(t)}
                    </Typography>
                    {(final || live) ? (
                      <Typography sx={{ flexShrink: 0, minWidth: 18, textAlign: 'right', fontSize: '0.95rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: final && !won ? 'text.disabled' : 'text.primary' }}>
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
              <Box sx={{ flexShrink: 0, textAlign: 'right', minWidth: 58, whiteSpace: 'nowrap' }}>
                <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: live ? '#ef4444' : final ? 'text.secondary' : WPBL_ACCENT }}>
                  {live ? '● Live' : final ? `Final${g.innings && g.innings !== 7 ? `/${g.innings}` : ''}` : formatGameTime(g.game_date, g.start_time) || 'TBD'}
                </Typography>
              </Box>
            </Box>
          )
        })}
      </Box>
    </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
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
  // Opt-in, like the bracket on Home. It reads nothing the table below it does not, and it is
  // the one card here that makes a forward-looking claim ("8 to lock 1st") rather than
  // reporting a result, so off stays the shipped view.
  const experiments = useExperiments()
  if (teams.length === 0) {
    return <EmptyState title="No teams yet" hint="Standings appear once teams and results are added." />
  }
  const played = games.some(g => g.status === 'final')
  const clickable = !!onOpenTeam
  // .667 (drop the leading zero); em dash before a team has played.
  const fmtPct = (pct: number, gp: number) => gp === 0 ? '—' : pct.toFixed(3).replace(/^0\./, '.')
  const th = { py: 0.85, px: 0.4, fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 0.4, color: 'text.secondary', textAlign: 'right' as const, whiteSpace: 'nowrap' as const }
  const td = { py: 1, px: 0.4, fontSize: '0.85rem', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const }
  const NUM = 34, WIDE = 46

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    <Box sx={{ border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, overflow: 'hidden' }}>
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <Box component="thead">
          <Box component="tr" sx={{ bgcolor: 'action.hover' }}>
            <Box component="th" sx={{ ...th, textAlign: 'left', pl: 1.25 }}>Team</Box>
            <Box component="th" sx={{ ...th, width: NUM }}>W</Box>
            <Box component="th" sx={{ ...th, width: NUM }}>L</Box>
            <Box component="th" sx={{ ...th, width: WIDE }}>PCT</Box>
            <Box component="th" sx={{ ...th, width: NUM }}>GB</Box>
            <Box component="th" sx={{ ...th, width: WIDE }}>DIFF</Box>
            <Box component="th" sx={{ ...th, width: WIDE, display: { xs: 'none', sm: 'table-cell' } }}>L10</Box>
            <Box component="th" sx={{ ...th, width: NUM + 8, pr: 1.25 }}>STRK</Box>
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
                sx={{ borderTop: '1px solid', borderColor: 'divider', cursor: clickable ? 'pointer' : 'default', '&:hover': clickable ? { bgcolor: 'action.hover' } : undefined }}>
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
                <Box component="td" sx={{ ...td, color: 'text.secondary' }}>{r.gamesBack === 0 ? '—' : r.gamesBack.toFixed(1)}</Box>
                {(() => {
                  const diff = r.runsFor - r.runsAgainst
                  const diffColor = gp === 0 ? 'text.disabled' : diff > 0 ? 'var(--wpbl-pos)' : diff < 0 ? 'var(--wpbl-neg)' : 'text.secondary'
                  return <Box component="td" sx={{ ...td, color: diffColor, fontWeight: 600 }}>{gp === 0 ? '—' : fmtSigned(diff)}</Box>
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
          same order, so a club can be carried from one to the other by eye. */}
      {played && experiments && <SeedingRace rows={rows} games={games} onOpenTeam={onOpenTeam} />}
      {/* The table answers "who is ahead"; this answers "of whom". They are the same four
          clubs in the same order, so the eye can carry a row straight down from one to the
          other. Only once there is a result to show: before that it is sixteen dots. */}
      {played && onOpenTeam && <HeadToHead rows={rows} games={games} onSelect={onOpenTeam} />}
    </Box>
  )
}

function TeamsView({ teams, games, selected, onSelect, onOpenGame, onOpenPlayer, onOpenStats }: {
  teams: WpblTeam[]; games: WpblGame[]; selected: WpblTeam | null
  onSelect: (t: WpblTeam | null) => void
  onOpenGame: (g: WpblGame) => void
  onOpenPlayer: (p: WpblPlayer) => void
  onOpenStats: (g: 'hitting' | 'pitching', sortKey?: string,
                opts?: Pick<WpblStatsFocus, 'mode' | 'teamId'>) => void
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
const isWpblView = (v: unknown): v is WpblView => NAV.some(n => n.key === v)

// Tracking used to be its own tab; it's now a stat group inside Stats. Any old bookmark,
// shared link, or restored history snapshot still naming it lands on Stats instead of
// falling back to Home. `wasTracking` tells the caller to open Stats *on* that group.
const LEGACY_TRACKING = 'tracking'
function normalizeView(v: unknown): { view: WpblView; wasTracking: boolean } {
  if (v === LEGACY_TRACKING) return { view: 'stats', wasTracking: true }
  return { view: isWpblView(v) ? v : 'home', wasTracking: false }
}
const HOME_SNAP: WpblSnap = { view: 'home', team: null, game: null, player: null }

export default function WpblApp({ renderFooter }: { renderFooter?: () => ReactNode } = {}) {
  // Section is public/read-only (feed-driven). Ingest-health freshness moved to the site
  // Admin panel, so the section no longer needs an admin flag.

  // Seed from the snapshot already on this history entry (Back/refresh into a deep state),
  // then the URL's ?view=, else home. Read once per state (history.state is stable at mount).
  const seed = (): WpblSnap => {
    const s = (window.history.state?.wpbl ?? null) as WpblSnap | null
    if (s) return { ...s, view: normalizeView(s.view).view }
    const v = new URLSearchParams(window.location.search).get('view')
    return v == null ? HOME_SNAP : { ...HOME_SNAP, view: normalizeView(v).view }
  }
  // A legacy ?view=tracking (or a restored snapshot) should open Stats already on the
  // tracking group — token 1 so the panel treats it as a real request on first mount.
  const seedTracking = () =>
    normalizeView(window.history.state?.wpbl?.view ?? new URLSearchParams(window.location.search).get('view')).wasTracking
  const [view, setView] = useState<WpblView>(() => seed().view)
  const [selectedTeam, setSelectedTeam] = useState<WpblTeam | null>(() => seed().team)
  const [detailGame, setDetailGame] = useState<WpblGame | null>(() => seed().game)
  const [detailPlayer, setDetailPlayer] = useState<WpblPlayer | null>(() => seed().player)
  // Mirror of the MLB game-center event, fired whenever the opened game changes.
  useEffect(() => {
    if (detailGame) track(EVENTS.GAME_CENTER_OPENED, { league: 'wpbl', gameId: detailGame.id, status: detailGame.status })
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

  // "Something new here" dot on the Teams tab, pointing at the v1.45.0 rebuild. Read once at
  // mount: shouldShowBadge() consults localStorage and an expiry date, and neither changes
  // under us mid-session. See src/lib/seen.ts.
  const [teamsBadge, setTeamsBadge] = useState(() => shouldShowBadge('teams-v145'))
  // Impression, logged once per mount rather than per render, so the click-through rate has
  // an honest denominator. Without this half of the point is lost: a nudge you cannot
  // measure is a nudge you will be guessing about next time.
  const badgeLogged = useRef(false)
  useEffect(() => {
    if (!teamsBadge || badgeLogged.current) return
    badgeLogged.current = true
    track(EVENTS.NEW_BADGE_SHOWN, { badge: 'teams-v145' })
  }, [teamsBadge])

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
      document.documentElement.style.setProperty('--wpbl-nav-h', pinned ? `${el!.offsetHeight}px` : '0px')
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
  const urlFor = (s: WpblSnap) => {
    const q = new URLSearchParams()
    if (s.view !== 'home') q.set('view', s.view)
    if (s.game) q.set('game', s.game.id)       // deep-linkable game center
    if (s.player) q.set('player', s.player.id) // deep-linkable player page
    const str = q.toString()
    return str ? `/wpbl?${str}` : '/wpbl'
  }
  // A ?player=<id> / ?game=<id> from a pasted or shared link, resolved once the data they
  // name has loaded. Both are read at mount only: a restored history snapshot already
  // carries the real objects, so the query string is the cold-start path.
  const pendingParam = (key: string) =>
    window.history.state?.wpbl ? null : new URLSearchParams(window.location.search).get(key)
  const pendingPlayerId = useRef<string | null>(pendingParam('player'))
  const pendingGameId = useRef<string | null>(pendingParam('game'))
  // Every forward navigation = one history entry (apply state + push a matching snapshot).
  const push = useCallback((s: WpblSnap) => {
    apply(s)
    window.history.pushState({ ...window.history.state, wpbl: s }, '', urlFor(s))
  }, [apply])

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
  const openFromLink = useCallback((s: WpblSnap) => {
    if (!linkBaseSeated.current) {
      linkBaseSeated.current = true
      const base: WpblSnap = { view: s.view, team: s.team, game: null, player: null }
      window.history.replaceState({ ...window.history.state, wpbl: base }, '', urlFor(base))
    }
    push(s)
  }, [push])

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
    // Opening Teams retires the dot, whether the reader tapped the nav, swiped into it, or
    // followed a card link. `via` rides along so a tap and a swipe can be told apart: only
    // one of the three is the badge actually doing its job.
    if (v === 'teams' && teamsBadge) {
      track(EVENTS.NEW_BADGE_CLICKED, { badge: 'teams-v145', via })
      markBadgeSeen('teams-v145')
      setTeamsBadge(false)
    }
    // Tapping the tab you are already on returns it to its root. This matters for Teams and
    // nowhere else: `selectedTeam` rides along through every tab switch (so swiping out to
    // Stats and back keeps the team page you were reading), but nothing ever cleared it — so
    // once any team page had been opened, the four-team grid became unreachable. A team
    // opened from the Stats table was especially stuck: Back went to Stats, and the Teams
    // pill just re-opened the same team.
    const backToRoot = v === view && via === 'pill'
    push({ view: v, team: backToRoot ? null : selectedTeam, game: null, player: null })
  }, [push, selectedTeam, view, teamsBadge])
  const selectTeam = useCallback((t: WpblTeam | null) => push({ view: 'teams', team: t, game: null, player: null }), [push])
  // `opts` is how the team page asks for a specific board: the four-team comparison, or the
  // player table already filtered to one club. Omitted by every other caller, which keeps
  // the leader-card jumps behaving exactly as they did.
  const openStats  = useCallback((
    g: WpblStatsFocus['group'],
    sortKey?: string,
    opts?: Pick<WpblStatsFocus, 'mode' | 'teamId'>,
  ) => {
    setStatsFocus(f => ({ group: g, sortKey, ...opts, token: f.token + 1 }))
    selectTab('stats', 'link')
  }, [selectTab])
  // Tracking is a Stats group now, so "view the tracking boards" means "open Stats on it".
  const openTracking = useCallback(() => openStats('tracking'), [openStats])
  const openGame   = useCallback((g: WpblGame) => push({ view, team: selectedTeam, game: g, player: null }), [push, view, selectedTeam])
  const openPlayer = useCallback((p: WpblPlayer) => {
    track(EVENTS.WPBL_PLAYER_OPENED, { playerId: p.id, teamId: p.team_id, from: detailGame ? 'game' : view })
    push({ view, team: selectedTeam, game: detailGame, player: p })
  }, [push, view, selectedTeam, detailGame])
  // Closing a modal (X or Escape) walks history back, so it and the browser Back button are
  // the same action and never fall out of sync.
  const closeTop   = useCallback(() => window.history.back(), [])

  // ── Toolbar search ─────────────────────────────────────────────────────────────
  // Register as the search owner for the shared header while /wpbl is mounted, and hand
  // it back (clearing any typed query + stale rows) on unmount so switching to /mlb starts
  // clean. The MLB section registers itself the same way from MlbStats.
  useEffect(() => {
    updateSearchBridge({ isRegistered: true, source: 'wpbl' })
    return () => {
      updateSearchBridge({ isRegistered: false, source: null, resultRows: [], searching: false })
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
  useEffect(() => {
    const id = pendingGameId.current
    if (!id || detailGame || games.length === 0) return
    pendingGameId.current = null
    const g = games.find(gm => gm.id === id)
    if (!g) return
    openFromLink({ view, team: selectedTeam, game: g, player: detailPlayer })
  }, [games, detailGame, view, selectedTeam, detailPlayer, openFromLink])

  // Open the player named in a shared ?player=<id> link, once the roster is available.
  useEffect(() => {
    const id = pendingPlayerId.current
    if (!id || detailPlayer || players.length === 0) return
    pendingPlayerId.current = null
    const p = players.find(pl => pl.id === id)
    if (!p) return
    openFromLink({ view, team: selectedTeam, game: detailGame, player: p })
  }, [players, detailPlayer, view, selectedTeam, detailGame, openFromLink])

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

  // Filter players + teams on the typed query and push self-describing rows up to the
  // toolbar. The rows carry primitive avatar data (portrait/logo URLs + team colors) so the
  // always-loaded toolbar renders them without importing this lazy chunk; each onSelect
  // routes back through openPlayer/selectTeam, keeping the section's back-stack intact.
  useEffect(() => {
    const q = bridge.query.trim().toLowerCase()
    if (q.length < 2) { updateSearchBridge({ resultRows: [] }); return }

    const playerRows = players
      .filter(p => p.name.toLowerCase().includes(q))
      .slice(0, 6)
      .map<SearchResultRow>(p => {
        const team = p.team_id ? teamById.get(p.team_id) : undefined
        const initials = p.name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
        return {
          key: `player-${p.id}`,
          title: p.name,
          subtitle: [displayPositionFromIndex(p, positionIndex).label, team?.abbr].filter(Boolean).join(' · ') || undefined,
          avatar: {
            imageUrl: wpblPortrait(p.name) ?? undefined,
            fallbackText: initials,
            bg: wpblColor(p.team_id), ring: wpblSecondary(p.team_id),
            fit: 'cover', circle: true,
          },
          onSelect: () => { setSearchQuery(''); openPlayer(p) },
        }
      })

    const teamRows = teams
      .filter(t => `${t.city} ${t.name} ${t.abbr}`.toLowerCase().includes(q))
      .slice(0, 4)
      .map<SearchResultRow>(t => ({
        key: `team-${t.id}`,
        title: wpblFullName(t),
        subtitle: t.abbr,
        avatar: {
          imageUrl: wpblLogo(t.id) ?? undefined,
          fallbackText: t.abbr,
          bg: wpblColor(t.id), ring: wpblSecondary(t.id),
          fit: wpblLogoFill(t.id) ? 'cover' : 'contain', circle: true,
        },
        onSelect: () => { setSearchQuery(''); selectTeam(t) },
      }))

    updateSearchBridge({ resultRows: [...playerRows, ...teamRows] })
  }, [bridge.query, players, teams, teamById, openPlayer, selectTeam])

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
      if (window.location.pathname !== '/wpbl') return
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

  // Keep the schedule / scoreboard / standings live as the official-feed ingest writes
  // scores and status changes. Teams are static, so only the schedule is re-fetched.
  // Poll faster while a game is in progress, and refresh whenever the tab regains focus.
  // Stop the timer outright while the tab is hidden, rather than letting it tick against a
  // page nobody is looking at. A backgrounded phone browser throttles timers but does not
  // stop them, so this was still waking the radio to re-pull the schedule — on cellular, for
  // a screen that is off. Becoming visible refreshes immediately and restarts the interval,
  // so the reader still sees current scores the moment they come back; they just do not pay
  // for the gap. Same reason `focus` refreshes without starting a second timer.
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | undefined
    const refresh = () => { fetchWpblSchedule().then(setGames).catch(() => {}) }
    const stop = () => { if (id !== undefined) { clearInterval(id); id = undefined } }
    const start = () => {
      stop()
      if (document.visibilityState === 'visible') id = setInterval(refresh, liveGame ? 20000 : 60000)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
      start()
    }
    start()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', refresh)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', refresh)
    }
  }, [liveGame?.id])

  return (
    // Cap + center on wide screens (site convention); full width on mobile.
    // On mobile, pull up to trim most of the app's top gutter (p:2) above the pill nav — the
    // toolbar already sits right above it, so the extra gap just reads as dead space at rest.
    <Box sx={{ maxWidth: 720, mx: 'auto', mt: { xs: -1.5, sm: 0 } }}>
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
        <SegNav
          options={NAV.map(n => ({ value: n.key, label: n.label, badge: n.key === 'teams' && teamsBadge }))}
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
        ? <ViewSkeleton />
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
                  case 'home':      return <WpblHome teams={teams} games={games} liveGame={liveGame} onOpenGame={openGame} onOpenPlayer={openPlayer} onOpenTeam={selectTeam} onViewStats={openStats} onViewTracking={openTracking} />
                  case 'schedule':  return <ScheduleView teams={teams} games={games} onOpenGame={openGame} active={view === 'schedule'} />
                  case 'standings': return <StandingsView teams={teams} games={games} onOpenTeam={selectTeam} />
                  case 'stats':     return <WpblStatsView teams={teams} games={games} focus={statsFocus} active={view === 'stats'} onOpenPlayer={openPlayer} onOpenTeam={selectTeam} />
                  case 'teams':     return <TeamsView teams={teams} games={games} selected={selectedTeam} onSelect={selectTeam} onOpenGame={openGame} onOpenPlayer={openPlayer} onOpenStats={openStats} />
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
          items={NAV.map(n => ({ key: n.key, label: n.label, badge: n.key === 'teams' && teamsBadge }))}
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
            onClose={closeTop}
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
          />
        </Suspense>
      )}
    </Box>
  )
}

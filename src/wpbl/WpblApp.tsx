import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, Skeleton, useMediaQuery } from '@mui/material'
import { fetchWpblTeams, fetchWpblSchedule, fetchWpblAllPlayers, computeStandings } from './api'
import { WPBL_ACCENT, wpblAccent, wpblColor, wpblSecondary, wpblLogo, wpblLogoFill, wpblFullName, formatGameTime } from './constants'
import { wpblPortrait } from './portraits'
import { SegNav, SectionLabel, TeamBadge, useWpblDark, CARD_BORDER } from './ui'
import { useSearchBridge, updateSearchBridge, setSearchQuery } from '../mlb/state/SearchBridgeContext'
import type { SearchResultRow } from '../mlb/state/SearchBridgeContext'
import type { WpblTeam, WpblPlayer, WpblGame } from './types'
import GameDetailModal from './GameDetail'
import PlayerDetailModal from './PlayerDetail'
import { track, EVENTS } from '../lib/analytics'
import WpblHome from './Home'
import WpblStatsView from './StatsView'
import WpblTrackingView from './TrackingView'
import TeamPage from './TeamPage'
import SwipeableViews from './SwipeableViews'

// WPBL section root. Reads the official-feed mirror from Supabase (games, box scores,
// play-by-play, live state) and renders it; everything shows a friendly empty state until
// the feed has been ingested. Self-contained (no MLB/StatsAPI coupling).

type WpblView = 'home' | 'schedule' | 'standings' | 'stats' | 'tracking' | 'teams'

const NAV: { key: WpblView; label: string }[] = [
  { key: 'home',      label: 'Home' },
  { key: 'schedule',  label: 'Schedule' },
  { key: 'standings', label: 'Standings' },
  { key: 'stats',     label: 'Stats' },
  { key: 'tracking',  label: 'Tracking' },
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

function ScheduleView({ teams, games, onOpenGame, active = true }: {
  teams: WpblTeam[]; games: WpblGame[]; onOpenGame: (g: WpblGame) => void
  active?: boolean // false while mounted off-screen as a swipe neighbour — don't auto-scroll then
}) {
  const byId = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  // Snap the schedule to the current point in the season when it opens: the next live or
  // upcoming game lands at the top, with the just-played games directly above it, instead
  // of starting on the season opener. Games are date-ascending, so the first non-final one
  // is the next game; once the season is over, fall back to the last game.
  const anchorDate = useMemo(() => {
    const next = games.find(g => g.status !== 'final')
    return next?.game_date ?? games[games.length - 1]?.game_date ?? null
  }, [games])
  const anchorRef = useRef<HTMLDivElement | null>(null)
  // Skip the auto-scroll on mobile: with the sticky tab bar it would slide the top margin
  // under the pills (a jarring shift), and the swipe already lands you on the tab.
  const isMobile = useMediaQuery('(max-width:600px)')
  useEffect(() => {
    if (!active || isMobile || !anchorRef.current) return
    // `nearest`: scroll the minimum to reveal the next game — nothing if it's already in
    // view — so we don't snap the anchor to the top and scroll the pill nav off-screen.
    const id = requestAnimationFrame(() => anchorRef.current?.scrollIntoView({ block: 'nearest' }))
    return () => cancelAnimationFrame(id)
  }, [anchorDate, active, isMobile])

  if (games.length === 0) {
    return <EmptyState title="No games scheduled yet" hint="The 2026 schedule loads here once it is added." />
  }
  const byDate = new Map<string, WpblGame[]>()
  for (const g of games) {
    const list = byDate.get(g.game_date) ?? []
    list.push(g); byDate.set(g.game_date, list)
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {[...byDate.entries()].map(([date, dayGames]) => (
        <Box key={date} ref={date === anchorDate ? anchorRef : undefined} sx={{ scrollMarginTop: 72 }}>
          <SectionLabel>
            {new Date(`${date}T00:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
          </SectionLabel>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {dayGames.map(g => {
              const home = byId.get(g.home_team_id)
              const away = byId.get(g.away_team_id)
              const final = g.status === 'final' && g.home_score != null && g.away_score != null
              const live = g.status === 'live'
              return (
                <Box key={g.id} onClick={() => onOpenGame(g)} sx={{
                  display: 'flex', alignItems: 'center', gap: 1.5, p: 1.25, cursor: 'pointer',
                  borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER, bgcolor: 'background.paper',
                  transition: 'border-color 0.15s', '&:hover': { borderColor: 'text.disabled' },
                }}>
                  <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {[away, home].map((t, i) => t && (
                      <Box key={t.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <TeamBadge team={t} size={26} />
                        <Typography sx={{ fontSize: '0.9rem', fontWeight: 600, flex: 1 }}>{wpblFullName(t)}</Typography>
                        {(final || live) && (
                          <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                            {i === 0 ? g.away_score ?? 0 : g.home_score ?? 0}
                          </Typography>
                        )}
                      </Box>
                    ))}
                  </Box>
                  <Box sx={{ textAlign: 'right', minWidth: 84 }}>
                    <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: live ? '#ef4444' : final ? 'text.secondary' : WPBL_ACCENT }}>
                      {live ? '● Live' : final ? `Final${g.innings && g.innings !== 7 ? `/${g.innings}` : ''}` : formatGameTime(g.game_date, g.start_time) || 'TBD'}
                    </Typography>
                  </Box>
                </Box>
              )
            })}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

function StandingsView({ teams, games, onOpenTeam }: {
  teams: WpblTeam[]; games: WpblGame[]; onOpenTeam?: (t: WpblTeam) => void
}) {
  const rows = useMemo(() => computeStandings(teams, games), [teams, games])
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
            const l10Color = l10.wins > l10.losses ? '#22c55e' : l10.wins < l10.losses ? '#ef4444' : 'text.secondary'
            return (
              <Box component="tr" key={r.team.id}
                onClick={clickable ? () => onOpenTeam!(r.team) : undefined}
                sx={{ borderTop: '1px solid', borderColor: 'divider', cursor: clickable ? 'pointer' : 'default', '&:hover': clickable ? { bgcolor: 'action.hover' } : undefined }}>
                <Box component="td" sx={{ ...td, textAlign: 'left', pl: 1.25 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                    <TeamBadge team={r.team} size={24} />
                    <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{wpblFullName(r.team)}</Typography>
                  </Box>
                </Box>
                <Box component="td" sx={{ ...td, fontWeight: 700 }}>{r.wins}</Box>
                <Box component="td" sx={{ ...td, fontWeight: 700 }}>{r.losses}</Box>
                <Box component="td" sx={td}>{fmtPct(r.pct, gp)}</Box>
                <Box component="td" sx={{ ...td, color: 'text.secondary' }}>{r.gamesBack === 0 ? '—' : r.gamesBack.toFixed(1)}</Box>
                {(() => {
                  const diff = r.runsFor - r.runsAgainst
                  const diffColor = gp === 0 ? 'text.disabled' : diff > 0 ? '#22c55e' : diff < 0 ? '#ef4444' : 'text.secondary'
                  return <Box component="td" sx={{ ...td, color: diffColor, fontWeight: 600 }}>{gp === 0 ? '—' : diff > 0 ? `+${diff}` : diff}</Box>
                })()}
                <Box component="td" sx={{ ...td, display: { xs: 'none', sm: 'table-cell' }, color: gp === 0 ? 'text.disabled' : l10Color, fontWeight: 600 }}>
                  {gp === 0 ? '—' : `${l10.wins}-${l10.losses}`}
                </Box>
                <Box component="td" sx={{ ...td, pr: 1.25, fontWeight: 700, color: r.streak ? (r.streak.type === 'W' ? '#22c55e' : '#ef4444') : 'text.disabled' }}>
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
  )
}

function TeamsView({ teams, games, selected, onSelect, onOpenGame, onOpenPlayer }: {
  teams: WpblTeam[]; games: WpblGame[]; selected: WpblTeam | null
  onSelect: (t: WpblTeam | null) => void
  onOpenGame: (g: WpblGame) => void
  onOpenPlayer: (p: WpblPlayer) => void
}) {
  const isDark = useWpblDark()

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
        onBack={() => onSelect(null)}
        onOpenGame={onOpenGame}
        onOpenPlayer={onOpenPlayer}
      />
    )
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
      {teams.map(t => (
        <Box key={t.id} onClick={() => onSelect(t)} sx={{
          display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, cursor: 'pointer',
          borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER, bgcolor: 'background.paper',
          transition: 'border-color 0.15s', '&:hover': { borderColor: wpblAccent(t.id, isDark) },
        }}>
          <TeamBadge team={t} size={40} />
          <Box>
            <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.15 }}>{wpblFullName(t)}</Typography>
            <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{t.abbr}</Typography>
          </Box>
        </Box>
      ))}
    </Box>
  )
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
const HOME_SNAP: WpblSnap = { view: 'home', team: null, game: null, player: null }

export default function WpblApp() {
  // Section is public/read-only (feed-driven). Ingest-health freshness moved to the site
  // Admin panel, so the section no longer needs an admin flag.

  // Seed from the snapshot already on this history entry (Back/refresh into a deep state),
  // then the URL's ?view=, else home. Read once per state (history.state is stable at mount).
  const seed = (): WpblSnap => {
    const s = (window.history.state?.wpbl ?? null) as WpblSnap | null
    if (s) return s
    const v = new URLSearchParams(window.location.search).get('view')
    return isWpblView(v) ? { ...HOME_SNAP, view: v } : HOME_SNAP
  }
  const [view, setView] = useState<WpblView>(() => seed().view)
  const [selectedTeam, setSelectedTeam] = useState<WpblTeam | null>(() => seed().team)
  const [detailGame, setDetailGame] = useState<WpblGame | null>(() => seed().game)
  const [detailPlayer, setDetailPlayer] = useState<WpblPlayer | null>(() => seed().player)
  // Mirror of the MLB game-center event, fired whenever the opened game changes.
  useEffect(() => {
    if (detailGame) track(EVENTS.GAME_CENTER_OPENED, { league: 'wpbl', gameId: detailGame.id, status: detailGame.status })
  }, [detailGame?.id])
  // Which stat group the Stats view opens on (set when jumping there from Home leaders).
  const [statsGroup, setStatsGroup] = useState<'hitting' | 'pitching'>('hitting')

  const [teams, setTeams] = useState<WpblTeam[]>([])
  const [games, setGames] = useState<WpblGame[]>([])
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  const [loading, setLoading] = useState(true)
  const isMobileView = useMediaQuery('(max-width:600px)')
  const navRef = useRef<HTMLDivElement>(null)

  // Mobile: once the page scrolls and the sticky pill bar pins to the top, give it a
  // hairline + soft shadow so content reads as sliding *under* a bar rather than under a
  // dead grey band. Cheap window-scroll listener, passive.
  const [navStuck, setNavStuck] = useState(false)
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
    setView(s.view); setSelectedTeam(s.team); setDetailGame(s.game); setDetailPlayer(s.player)
  }, [])
  const urlFor = (s: WpblSnap) => {
    const q = new URLSearchParams()
    if (s.view !== 'home') q.set('view', s.view)
    if (s.player) q.set('player', s.player.id) // deep-linkable player page
    const str = q.toString()
    return str ? `/wpbl?${str}` : '/wpbl'
  }
  // A ?player=<id> from a pasted/shared link, resolved to the player once the roster loads.
  const pendingPlayerId = useRef<string | null>(
    window.history.state?.wpbl ? null : new URLSearchParams(window.location.search).get('player'),
  )
  // Every forward navigation = one history entry (apply state + push a matching snapshot).
  const push = useCallback((s: WpblSnap) => {
    apply(s)
    window.history.pushState({ ...window.history.state, wpbl: s }, '', urlFor(s))
  }, [apply])

  // Navigation intents. Tab/team switches clear any open modal; opening a player keeps the
  // game beneath it (so Back closes the player first, then the game).
  const selectTab  = useCallback((v: WpblView) => push({ view: v, team: selectedTeam, game: null, player: null }), [push, selectedTeam])
  const selectTeam = useCallback((t: WpblTeam | null) => push({ view: 'teams', team: t, game: null, player: null }), [push])
  const openStats  = useCallback((g: 'hitting' | 'pitching') => { setStatsGroup(g); push({ view: 'stats', team: selectedTeam, game: null, player: null }) }, [push, selectedTeam])
  const openTracking = useCallback(() => push({ view: 'tracking', team: selectedTeam, game: null, player: null }), [push, selectedTeam])
  const openGame   = useCallback((g: WpblGame) => push({ view, team: selectedTeam, game: g, player: null }), [push, view, selectedTeam])
  const openPlayer = useCallback((p: WpblPlayer) => push({ view, team: selectedTeam, game: detailGame, player: p }), [push, view, selectedTeam, detailGame])
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

  // Open the player named in a shared ?player=<id> link, once the roster is available.
  useEffect(() => {
    const id = pendingPlayerId.current
    if (!id || detailPlayer || players.length === 0) return
    pendingPlayerId.current = null
    const p = players.find(pl => pl.id === id)
    if (!p) return
    setDetailPlayer(p)
    const s: WpblSnap = { view, team: selectedTeam, game: detailGame, player: p }
    window.history.replaceState({ ...window.history.state, wpbl: s }, '', urlFor(s))
  }, [players, detailPlayer, view, selectedTeam, detailGame])

  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])

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
          subtitle: [p.position, team?.abbr].filter(Boolean).join(' · ') || undefined,
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
  useEffect(() => {
    const refresh = () => { fetchWpblSchedule().then(setGames).catch(() => {}) }
    const id = setInterval(refresh, liveGame ? 20000 : 60000)
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', refresh)
    }
  }, [liveGame?.id])

  return (
    // Cap + center on wide screens (site convention); full width on mobile.
    <Box sx={{ maxWidth: 720, mx: 'auto' }}>
      {/* Section nav — shared SegControl pill bar, matching the MLB tab bar. */}
      {/* Tab bar stays put on mobile (sticky under the toolbar) so it doesn't scroll away
          when swiping to a tab or when the schedule snaps to the next game. */}
      <Box ref={navRef} sx={{
        position: { xs: 'sticky', sm: 'static' }, top: { xs: 0, sm: 'auto' }, zIndex: 3,
        bgcolor: 'background.default',
        // Tight opaque bar that hugs the pills; the breathing gap below is transparent
        // margin (not painted), so content scrolls right up under the pills with no slab.
        py: { xs: 0.75, sm: 0 }, mb: { xs: 2, sm: 0 },
        // Full-bleed the bar (bg + hairline) to the screen edge on mobile; SegNav sits
        // flush inside and supplies its own resting inset via scroll padding.
        mx: { xs: -2, sm: 0 },
        transition: 'box-shadow 0.2s, border-color 0.2s',
        borderBottom: '1px solid',
        borderColor: navStuck ? 'divider' : 'transparent',
        boxShadow: navStuck ? '0 4px 12px rgba(0,0,0,0.06)' : 'none',
      }}>
        <SegNav
          options={NAV.map(n => ({ value: n.key, label: n.label }))}
          value={view}
          onChange={v => selectTab(v as WpblView)}
        />
      </Box>

      {/* Floor the view height on mobile so short tabs (e.g. Standings) still scroll a little
          and the footer doesn't jam against the content. */}
      <Box sx={{ minHeight: { xs: 'calc(100dvh - 128px)', sm: 'auto' } }}>
      {loading
        ? <ViewSkeleton />
        : (
          // One panel per nav tab, in NAV order, so mobile can swipe between them (the
          // active one — and, mid-swipe, its neighbour — are the only ones mounted). The
          // `active` flag lets a view react to becoming current after a swipe reuses its
          // already-mounted node (e.g. Schedule re-snapping to the next game).
          <SwipeableViews
            index={NAV.findIndex(n => n.key === view)}
            onIndexChange={i => selectTab(NAV[i].key)}
            minHeight={isMobileView ? 'calc(100dvh - 128px)' : undefined}
            stickyNavRef={navRef}
            panels={NAV.map(n => {
              switch (n.key) {
                case 'home':      return <WpblHome teams={teams} games={games} liveGame={liveGame} onOpenGame={openGame} onOpenPlayer={openPlayer} onOpenTeam={selectTeam} onViewStats={openStats} onViewTracking={openTracking} />
                case 'schedule':  return <ScheduleView teams={teams} games={games} onOpenGame={openGame} active={view === 'schedule'} />
                case 'standings': return <StandingsView teams={teams} games={games} onOpenTeam={selectTeam} />
                case 'stats':     return <WpblStatsView teams={teams} games={games} initialGroup={statsGroup} onOpenPlayer={openPlayer} onOpenTeam={selectTeam} />
                case 'tracking':  return <WpblTrackingView teams={teams} onOpenPlayer={openPlayer} />
                case 'teams':     return <TeamsView teams={teams} games={games} selected={selectedTeam} onSelect={selectTeam} onOpenGame={openGame} onOpenPlayer={openPlayer} />
              }
            })}
          />
        )}
      </Box>

      {detailPlayer && (
        <PlayerDetailModal
          player={detailPlayer}
          teams={teams}
          games={games}
          onClose={closeTop}
        />
      )}

      {detailGame && (
        <GameDetailModal
          game={detailGame}
          teams={teams}
          onClose={closeTop}
          onOpenPlayer={openPlayer}
        />
      )}
    </Box>
  )
}

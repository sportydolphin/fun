import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import { fetchWpblTeams, fetchWpblSchedule, fetchWpblRoster, computeStandings } from './api'
import { WPBL_ACCENT, wpblAccent, wpblFullName, formatGameTime, positionRank } from './constants'
import { SegNav, SectionLabel, TeamBadge, PlayerPortrait, useWpblDark, CARD_BORDER } from './ui'
import type { WpblTeam, WpblPlayer, WpblGame } from './types'
import GameDetailModal from './GameDetail'
import PlayerDetailModal from './PlayerDetail'
import WpblHome from './Home'
import WpblStatsView from './StatsView'

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
}) {
  const byId = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
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
        <Box key={date}>
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

function StandingsView({ teams, games }: { teams: WpblTeam[]; games: WpblGame[] }) {
  const rows = useMemo(() => computeStandings(teams, games), [teams, games])
  if (teams.length === 0) {
    return <EmptyState title="No teams yet" hint="Standings appear once teams and results are added." />
  }
  const played = games.some(g => g.status === 'final')
  return (
    <Box sx={{ border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', px: 1.5, py: 0.75, bgcolor: 'action.hover', fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary' }}>
        <Box sx={{ flex: 1 }}>Team</Box>
        <Box sx={{ width: 40, textAlign: 'right' }}>W</Box>
        <Box sx={{ width: 40, textAlign: 'right' }}>L</Box>
        <Box sx={{ width: 56, textAlign: 'right' }}>Diff</Box>
      </Box>
      {rows.map(r => {
        const diff = r.runsFor - r.runsAgainst
        return (
          <Box key={r.team.id} sx={{ display: 'flex', alignItems: 'center', px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider', fontVariantNumeric: 'tabular-nums' }}>
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
              <TeamBadge team={r.team} size={26} />
              <Typography sx={{ fontSize: '0.88rem', fontWeight: 600 }}>{wpblFullName(r.team)}</Typography>
            </Box>
            <Box sx={{ width: 40, textAlign: 'right', fontWeight: 700 }}>{r.wins}</Box>
            <Box sx={{ width: 40, textAlign: 'right', fontWeight: 700 }}>{r.losses}</Box>
            <Box sx={{ width: 56, textAlign: 'right', color: diff > 0 ? 'success.main' : diff < 0 ? 'error.main' : 'text.secondary' }}>
              {diff > 0 ? `+${diff}` : diff}
            </Box>
          </Box>
        )
      })}
      {!played && (
        <Box sx={{ px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          <Typography sx={{ fontSize: '0.78rem', color: 'text.disabled' }}>No games played yet. Records update as results are added.</Typography>
        </Box>
      )}
    </Box>
  )
}

function TeamsView({ teams, selected, onSelect, onOpenPlayer }: {
  teams: WpblTeam[]; selected: WpblTeam | null
  onSelect: (t: WpblTeam | null) => void; onOpenPlayer: (p: WpblPlayer) => void
}) {
  const isDark = useWpblDark()
  const [roster, setRoster] = useState<WpblPlayer[] | null>(null)
  const [loadingRoster, setLoadingRoster] = useState(false)

  useEffect(() => {
    if (!selected) { setRoster(null); return }
    let cancelled = false
    setLoadingRoster(true)
    fetchWpblRoster(selected.id).then(r => {
      if (cancelled) return
      const sorted = [...r].sort((a, b) => positionRank(a.position) - positionRank(b.position) || a.name.localeCompare(b.name))
      setRoster(sorted); setLoadingRoster(false)
    })
    return () => { cancelled = true }
  }, [selected])

  if (teams.length === 0) {
    return <EmptyState title="No teams yet" hint="The four inaugural teams appear here once added." />
  }

  if (selected) {
    return (
      <Box>
        <Box onClick={() => onSelect(null)} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 2, cursor: 'pointer', color: 'text.secondary', fontSize: '0.85rem', fontWeight: 600, '&:hover': { color: 'text.primary' } }}>
          ← All teams
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
          <TeamBadge team={selected} size={48} />
          <Box>
            <Typography sx={{ fontSize: '1.2rem', fontWeight: 800, lineHeight: 1.1 }}>{wpblFullName(selected)}</Typography>
            <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>Roster</Typography>
          </Box>
        </Box>
        {loadingRoster
          ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={24} /></Box>
          : roster && roster.length > 0
            ? (
              <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                {roster.map(p => (
                  <Box key={p.id} onClick={() => onOpenPlayer(p)} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 1, cursor: 'pointer', borderBottom: '1px solid', borderColor: 'divider', '&:hover': { bgcolor: 'action.hover' } }}>
                    <Typography sx={{ width: 28, textAlign: 'center', flexShrink: 0, fontSize: '0.74rem', fontWeight: 800, color: wpblAccent(selected.id, isDark) }}>
                      {p.position || '—'}
                    </Typography>
                    <PlayerPortrait name={p.name} teamId={p.team_id} size={40} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: '0.9rem', fontWeight: 600, lineHeight: 1.2 }}>{p.name}</Typography>
                      {p.hometown && (
                        <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {p.hometown}
                        </Typography>
                      )}
                    </Box>
                    <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                      {p.age != null && <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, lineHeight: 1.2 }}>{p.age} yrs</Typography>}
                      {(p.bats || p.throws) && (
                        <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled' }}>B/T {p.bats || '-'}/{p.throws || '-'}</Typography>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
            )
            : <EmptyState title="Roster coming soon" hint="Players appear here once the roster is added." />}
      </Box>
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

export default function WpblApp({ isAdmin = false }: { isAdmin?: boolean }) {
  // Section is public/read-only (feed-driven); isAdmin now only gates the ingest-health
  // freshness indicator on the home header.

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
  // Which stat group the Stats view opens on (set when jumping there from Home leaders).
  const [statsGroup, setStatsGroup] = useState<'hitting' | 'pitching'>('hitting')

  const [teams, setTeams] = useState<WpblTeam[]>([])
  const [games, setGames] = useState<WpblGame[]>([])
  const [loading, setLoading] = useState(true)

  // ── History-driven navigation ────────────────────────────────────────────────
  const apply = useCallback((s: WpblSnap) => {
    setView(s.view); setSelectedTeam(s.team); setDetailGame(s.game); setDetailPlayer(s.player)
  }, [])
  const urlFor = (s: WpblSnap) => (s.view === 'home' ? '/wpbl' : `/wpbl?view=${s.view}`)
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
  const openGame   = useCallback((g: WpblGame) => push({ view, team: selectedTeam, game: g, player: null }), [push, view, selectedTeam])
  const openPlayer = useCallback((p: WpblPlayer) => push({ view, team: selectedTeam, game: detailGame, player: p }), [push, view, selectedTeam, detailGame])
  // Closing a modal (X or Escape) walks history back, so it and the browser Back button are
  // the same action and never fall out of sync.
  const closeTop   = useCallback(() => window.history.back(), [])

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
    Promise.all([fetchWpblTeams(), fetchWpblSchedule()]).then(([t, g]) => {
      if (cancelled) return
      setTeams(t); setGames(g); setLoading(false)
    })
    return () => { cancelled = true }
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
      <SegNav
        options={NAV.map(n => ({ value: n.key, label: n.label }))}
        value={view}
        onChange={v => selectTab(v as WpblView)}
      />

      {loading
        ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
        : (
          <>
            {view === 'home'      && <WpblHome teams={teams} games={games} liveGame={liveGame} isAdmin={isAdmin} onOpenGame={openGame} onOpenPlayer={openPlayer} onOpenTeam={selectTeam} onViewStats={openStats} />}
            {view === 'schedule'  && <ScheduleView teams={teams} games={games} onOpenGame={openGame} />}
            {view === 'standings' && <StandingsView teams={teams} games={games} />}
            {view === 'stats'     && <WpblStatsView teams={teams} games={games} initialGroup={statsGroup} onOpenPlayer={openPlayer} />}
            {view === 'teams'     && <TeamsView teams={teams} selected={selectedTeam} onSelect={selectTeam} onOpenPlayer={openPlayer} />}
          </>
        )}

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

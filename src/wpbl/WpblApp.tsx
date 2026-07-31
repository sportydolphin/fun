import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import { fetchWpblTeams, fetchWpblSchedule, fetchWpblRoster, computeStandings } from './api'
import { WPBL_ACCENT, wpblAccent, wpblFullName, formatGameTime, positionRank } from './constants'
import { SegNav, SectionLabel, TeamBadge, useWpblDark, CARD_BORDER } from './ui'
import type { WpblTeam, WpblPlayer, WpblGame } from './types'
import GameEntryModal from './GameEntry'
import GameDetailModal from './GameDetail'
import PlayerDetailModal from './PlayerDetail'
import WpblHome from './Home'

// Phase 0 skeleton for the WPBL section. Reads from Supabase and renders whatever is
// there; everything shows a friendly empty state until the tables are seeded. Views
// are intentionally lean and self-contained (no MLB/StatsAPI coupling).

type WpblView = 'home' | 'schedule' | 'standings' | 'teams'

const NAV: { key: WpblView; label: string }[] = [
  { key: 'home',      label: 'Home' },
  { key: 'schedule',  label: 'Schedule' },
  { key: 'standings', label: 'Standings' },
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

function ScheduleView({ teams, games, isAdmin, onEditGame, onOpenGame }: {
  teams: WpblTeam[]; games: WpblGame[]; isAdmin: boolean
  onEditGame: (g: WpblGame) => void; onOpenGame: (g: WpblGame) => void
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
                        {final && (
                          <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                            {i === 0 ? g.away_score : g.home_score}
                          </Typography>
                        )}
                      </Box>
                    ))}
                  </Box>
                  <Box sx={{ textAlign: 'right', minWidth: 84 }}>
                    <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: final ? 'text.secondary' : WPBL_ACCENT }}>
                      {final ? `Final${g.innings && g.innings !== 7 ? `/${g.innings}` : ''}` : formatGameTime(g.game_date, g.start_time) || 'TBD'}
                    </Typography>
                  </Box>
                  {isAdmin && (
                    <Box
                      onClick={(e) => { e.stopPropagation(); onEditGame(g) }}
                      sx={{ flexShrink: 0, cursor: 'pointer', userSelect: 'none', fontSize: '0.66rem', fontWeight: 800, color: WPBL_ACCENT, border: '1px solid', borderColor: `${WPBL_ACCENT}66`, borderRadius: 999, px: 1, py: '3px', '&:hover': { bgcolor: `${WPBL_ACCENT}18` } }}
                    >
                      {final ? 'Edit' : 'Enter'}
                    </Box>
                  )}
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
                    <Typography sx={{ width: 40, textAlign: 'center', flexShrink: 0, fontSize: '0.74rem', fontWeight: 800, color: wpblAccent(selected.id, isDark) }}>
                      {p.position || '—'}
                    </Typography>
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

export default function WpblApp({ isAdmin = false }: { isAdmin?: boolean }) {
  const [view, setView] = useState<WpblView>('home')
  const [teams, setTeams] = useState<WpblTeam[]>([])
  const [games, setGames] = useState<WpblGame[]>([])
  const [loading, setLoading] = useState(true)
  const [editGame, setEditGame] = useState<WpblGame | null>(null)
  const [detailGame, setDetailGame] = useState<WpblGame | null>(null)
  const [detailPlayer, setDetailPlayer] = useState<WpblPlayer | null>(null)
  // Team detail lives in the Teams view; lifted here so Home can open a team into it.
  const [selectedTeam, setSelectedTeam] = useState<WpblTeam | null>(null)

  const openTeam = useCallback((t: WpblTeam) => { setSelectedTeam(t); setView('teams') }, [])

  const reload = useCallback(() => {
    let cancelled = false
    Promise.all([fetchWpblTeams(), fetchWpblSchedule()]).then(([t, g]) => {
      if (cancelled) return
      setTeams(t); setGames(g); setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => reload(), [reload])

  return (
    // Cap + center on wide screens (site convention); full width on mobile.
    <Box sx={{ maxWidth: 720, mx: 'auto' }}>
      {/* Section nav — shared SegControl pill bar, matching the MLB tab bar. */}
      <SegNav
        options={NAV.map(n => ({ value: n.key, label: n.label }))}
        value={view}
        onChange={v => setView(v as WpblView)}
      />

      {loading
        ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
        : (
          <>
            {view === 'home'      && <WpblHome teams={teams} games={games} onOpenGame={setDetailGame} onOpenPlayer={setDetailPlayer} onOpenTeam={openTeam} />}
            {view === 'schedule'  && <ScheduleView teams={teams} games={games} isAdmin={isAdmin} onEditGame={setEditGame} onOpenGame={setDetailGame} />}
            {view === 'standings' && <StandingsView teams={teams} games={games} />}
            {view === 'teams'     && <TeamsView teams={teams} selected={selectedTeam} onSelect={setSelectedTeam} onOpenPlayer={setDetailPlayer} />}
          </>
        )}

      {detailPlayer && (
        <PlayerDetailModal
          player={detailPlayer}
          teams={teams}
          games={games}
          onClose={() => setDetailPlayer(null)}
        />
      )}

      {detailGame && (
        <GameDetailModal
          game={detailGame}
          teams={teams}
          onClose={() => setDetailGame(null)}
          onEdit={isAdmin ? (g) => { setDetailGame(null); setEditGame(g) } : undefined}
        />
      )}

      {editGame && (
        <GameEntryModal
          game={editGame}
          teams={teams}
          onClose={() => setEditGame(null)}
          onSaved={() => { setEditGame(null); reload() }}
        />
      )}
    </Box>
  )
}

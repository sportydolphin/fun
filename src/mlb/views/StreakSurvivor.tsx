import React, { useState, useEffect, useCallback } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import { ACCENT, TEAM_ABBR, TEAM_NICKNAME } from '../constants'
import { useIsDark, highlightColor, defaultBorder } from '../lib/colorUtils'
import { useAuth } from '../../AuthContext'
import { searchPlayers } from '../api'
import { Player } from '../types'
import { TeamLogo } from './Standings'
import {
  survivorToday, fetchMyPick, fetchMyStats, fetchHotHitters, fetchPickableTeams, saveMyPick,
  fetchSurvivorLeaderboard, fetchMyRecentPicks,
  SurvivorPick, SurvivorStats, HotHitter, SurvivorLeaderRow, SurvivorResult,
} from './survivorData'

const ZERO_STATS: SurvivorStats = { currentStreak: 0, longestStreak: 0, totalHits: 0, totalPicks: 0 }

// ─── Small pieces ─────────────────────────────────────────────────────────────

const RESULT_META: Record<SurvivorResult, { label: string; color: string }> = {
  hit:     { label: 'Hit',     color: '#22c55e' },
  miss:    { label: 'No hit',  color: '#ef4444' },
  void:    { label: 'No game', color: '#94a3b8' },
  pending: { label: 'Locked',  color: '#eab308' },
}

function ResultPill({ result }: { result: SurvivorResult }) {
  const m = RESULT_META[result]
  return (
    <Box sx={{
      px: 1, py: '2px', borderRadius: 999, bgcolor: `${m.color}22`,
      fontSize: '0.62rem', fontWeight: 800, color: m.color,
      textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap',
    }}>
      {m.label}
    </Box>
  )
}

function StreakBadge({ current, longest }: { current: number; longest: number }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
      <Box sx={{ textAlign: 'right' }}>
        <Typography sx={{ fontSize: '0.98rem', fontWeight: 800, lineHeight: 1, color: current > 0 ? '#f97316' : 'text.primary' }}>
          {current > 0 ? `🔥 ${current}` : '0'}
        </Typography>
        <Typography sx={{ fontSize: '0.54rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.disabled', mt: '2px' }}>
          Current
        </Typography>
      </Box>
      <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: 'divider' }} />
      <Box sx={{ textAlign: 'right' }}>
        <Typography sx={{ fontSize: '0.98rem', fontWeight: 800, lineHeight: 1, color: 'text.primary' }}>{longest}</Typography>
        <Typography sx={{ fontSize: '0.54rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.disabled', mt: '2px' }}>
          Best
        </Typography>
      </Box>
    </Box>
  )
}

// One selectable hitter (a hot-streak suggestion or a search result).
function HitterRow({ name, teamId, subtitle, disabled, onPick }: {
  name: string; teamId: number; subtitle?: string; disabled?: boolean; onPick: () => void
}) {
  const abbr = TEAM_ABBR[teamId] ?? '—'
  return (
    <Box
      onClick={() => !disabled && onPick()}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: '7px', borderRadius: 2,
        border: '1px solid', borderColor: 'divider',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
        '&:hover': { bgcolor: disabled ? undefined : 'action.hover', borderColor: disabled ? 'divider' : ACCENT },
        transition: 'background 0.12s, border-color 0.12s',
      }}
    >
      <TeamLogo teamId={teamId} abbr={abbr} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name}
        </Typography>
        <Typography sx={{ fontSize: '0.64rem', color: 'text.disabled', lineHeight: 1.2 }}>
          {abbr}{subtitle ? ` · ${subtitle}` : ''}
        </Typography>
      </Box>
      <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, color: disabled ? 'text.disabled' : ACCENT, whiteSpace: 'nowrap' }}>
        {disabled ? 'Started' : 'Pick'}
      </Typography>
    </Box>
  )
}

// ─── Leaderboard modal ──────────────────────────────────────────────────────

function LeaderRow({ entry }: { entry: SurvivorLeaderRow }) {
  const medal = entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : null
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: '9px',
      borderBottom: '1px solid', borderColor: 'divider',
      bgcolor: entry.isMe ? `${ACCENT}18` : undefined,
    }}>
      <Typography sx={{ minWidth: 26, textAlign: 'center', fontSize: '0.8rem', fontWeight: 800, color: 'text.secondary' }}>
        {medal ?? entry.rank}
      </Typography>
      <Typography sx={{ flex: 1, minWidth: 0, fontSize: '0.84rem', fontWeight: entry.isMe ? 800 : 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {entry.displayName}{entry.isMe ? ' (you)' : ''}
      </Typography>
      {entry.currentStreak > 0 && (
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: '#f97316', whiteSpace: 'nowrap' }}>
          🔥 {entry.currentStreak}
        </Typography>
      )}
      <Typography sx={{ minWidth: 34, textAlign: 'right', fontSize: '0.9rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
        {entry.longestStreak}
      </Typography>
    </Box>
  )
}

function SurvivorLeaderboardModal({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const isDark = useIsDark()
  const [rows, setRows] = useState<SurvivorLeaderRow[] | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    fetchSurvivorLeaderboard(userId).then(setRows).catch(() => setRows([]))
    return () => window.removeEventListener('keydown', onKey)
  }, [userId, onClose])

  return (
    <Box
      onClick={onClose}
      sx={{ position: 'fixed', inset: 0, zIndex: 1500, bgcolor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}
    >
      <Box
        onClick={e => e.stopPropagation()}
        sx={{
          width: '100%', maxWidth: 440, maxHeight: '90vh', overflow: 'auto',
          borderRadius: 3, border: '1px solid', borderColor: defaultBorder(isDark), bgcolor: 'background.paper',
        }}
      >
        <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.95rem' }}>Streak Survivor leaderboard</Typography>
          <Box onClick={onClose} sx={{ cursor: 'pointer', px: 1, fontSize: '1.1rem', color: 'text.secondary', '&:hover': { color: 'text.primary' } }}>✕</Box>
        </Box>

        <Box sx={{ px: 1.5, py: '6px', display: 'flex', alignItems: 'center', gap: 1.25, bgcolor: 'action.hover' }}>
          <Typography sx={{ minWidth: 26, textAlign: 'center', fontSize: '0.56rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.disabled' }}>#</Typography>
          <Typography sx={{ flex: 1, fontSize: '0.56rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.disabled' }}>Player</Typography>
          <Typography sx={{ minWidth: 34, textAlign: 'right', fontSize: '0.56rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.disabled' }}>Best</Typography>
        </Box>

        {rows === null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress size={28} sx={{ color: ACCENT }} /></Box>
        ) : rows.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6, px: 2 }}>
            <Typography sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>
              No streaks yet. Make the first pick and you're on the board tomorrow.
            </Typography>
          </Box>
        ) : (
          rows.map(r => <LeaderRow key={r.userId} entry={r} />)
        )}
      </Box>
    </Box>
  )
}

// ─── Widget ─────────────────────────────────────────────────────────────────

export function StreakSurvivorWidget() {
  const { user, openAuthDialog } = useAuth()
  const isDark = useIsDark()
  const today = survivorToday()
  const season = new Date().getFullYear()

  const [myPick, setMyPick]         = useState<SurvivorPick | null>(null)
  const [stats, setStats]           = useState<SurvivorStats>(ZERO_STATS)
  const [pickable, setPickable]     = useState<Set<number>>(new Set())
  const [hotHitters, setHotHitters] = useState<HotHitter[]>([])
  const [recent, setRecent]         = useState<SurvivorPick[]>([])
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [changing, setChanging]     = useState(false)   // expanded picker even though a pick exists
  const [query, setQuery]           = useState('')
  const [results, setResults]       = useState<Player[]>([])
  const [lbOpen, setLbOpen]         = useState(false)

  // Slate-wide data (hot hitters + which teams are still pickable today) — no auth
  // needed, so it loads for signed-out visitors too as a teaser.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([fetchHotHitters(season), fetchPickableTeams(today)])
      .then(([hh, pk]) => { if (!cancelled) { setHotHitters(hh); setPickable(pk) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [today, season])

  // Per-user state.
  useEffect(() => {
    let cancelled = false
    if (!user) { setMyPick(null); setStats(ZERO_STATS); setRecent([]); return }
    fetchMyPick(user.id, today).then(p => { if (!cancelled) setMyPick(p) })
    fetchMyStats(user.id).then(s => { if (!cancelled) setStats(s) })
    fetchMyRecentPicks(user.id, 6).then(r => { if (!cancelled) setRecent(r) })
    return () => { cancelled = true }
  }, [user?.id, today]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced hitter search (hitters with a current team only).
  useEffect(() => {
    const q = query.trim()
    if (q.length < 3) { setResults([]); return }
    let cancelled = false
    const t = setTimeout(() => {
      searchPlayers(q).then(ps => {
        if (cancelled) return
        setResults(ps.filter(p =>
          p.currentTeam && p.primaryPosition?.code !== '1' && p.primaryPosition?.type !== 'Pitcher'
        ).slice(0, 6))
      }).catch(() => { if (!cancelled) setResults([]) })
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query])

  const pick = useCallback(async (p: { playerId: number; playerName: string; teamId: number }) => {
    if (!user) { openAuthDialog('signin'); return }
    if (!pickable.has(p.teamId)) return
    setSaving(true)
    const err = await saveMyPick(user.id, today, p)
    setSaving(false)
    if (!err) {
      setMyPick({ gameDate: today, ...p, result: 'pending' })
      setChanging(false); setQuery(''); setResults([])
    }
  }, [user, pickable, today, openAuthDialog])

  const border = defaultBorder(isDark)
  const pickLocked = myPick != null && !pickable.has(myPick.teamId)
  // Graded picks only (hit/miss/void), oldest-left, capped for the form dots.
  const recentForm = recent.filter(r => r.result !== 'pending').slice(0, 6).reverse()

  // ── Card shell ──
  const Shell = (children: React.ReactNode) => (
    <Box sx={{ borderRadius: 3, border: '1px solid', borderColor: border, bgcolor: 'background.paper', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 1.75, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.9rem', lineHeight: 1.15 }}>🎯 Streak Survivor</Typography>
          <Typography sx={{ fontSize: '0.64rem', color: 'text.disabled', lineHeight: 1.2 }}>Pick a hitter. Keep the streak alive.</Typography>
        </Box>
        {user && <StreakBadge current={stats.currentStreak} longest={stats.longestStreak} />}
      </Box>
      {children}
      {/* Recent form — last few graded picks, oldest-left */}
      {user && recentForm.length > 0 && (
        <Box sx={{ px: 1.75, py: '8px', borderTop: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ fontSize: '0.56rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.disabled' }}>Recent</Typography>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {recentForm.map((r, i) => (
              <Box key={i} title={`${r.gameDate}: ${RESULT_META[r.result].label} (${r.playerName})`} sx={{
                width: 9, height: 9, borderRadius: '50%', bgcolor: RESULT_META[r.result].color,
              }} />
            ))}
          </Box>
        </Box>
      )}
      {/* Footer */}
      <Box
        onClick={() => setLbOpen(true)}
        sx={{ px: 1.75, py: '9px', borderTop: '1px solid', borderColor: 'divider', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75, '&:hover': { bgcolor: 'action.hover' } }}
      >
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: ACCENT }}>View leaderboard</Typography>
      </Box>
    </Box>
  )

  const suggestions = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {/* Search */}
      <Box
        component="input"
        value={query}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
        placeholder="Search any hitter…"
        sx={{
          width: '100%', px: 1.25, py: '8px', borderRadius: 2, fontSize: '0.82rem',
          border: '1px solid', borderColor: 'divider', bgcolor: 'background.default',
          color: 'text.primary', outline: 'none', '&:focus': { borderColor: ACCENT },
          '&::placeholder': { color: 'text.disabled' },
        }}
      />
      {(results.length ? results.map(p => ({
        playerId: p.id, playerName: p.fullName, teamId: p.currentTeam!.id,
        subtitle: p.primaryPosition?.abbreviation, disabled: !pickable.has(p.currentTeam!.id),
      })) : hotHitters.map(h => ({
        playerId: h.playerId, playerName: h.playerName, teamId: h.teamId,
        subtitle: `${h.streak}-game hit streak`, disabled: !pickable.has(h.teamId),
      }))).map(opt => (
        <HitterRow
          key={opt.playerId}
          name={opt.playerName}
          teamId={opt.teamId}
          subtitle={opt.subtitle}
          disabled={opt.disabled || saving}
          onPick={() => pick({ playerId: opt.playerId, playerName: opt.playerName, teamId: opt.teamId })}
        />
      ))}
      {!results.length && !hotHitters.length && (
        <Typography sx={{ fontSize: '0.76rem', color: 'text.disabled', textAlign: 'center', py: 1.5 }}>
          Search for a hitter to make your pick.
        </Typography>
      )}
    </Box>
  )

  // ── Body states ──
  let body: React.ReactNode

  if (loading) {
    body = <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={26} sx={{ color: ACCENT }} /></Box>
  } else if (!user) {
    body = (
      <Box sx={{ px: 1.75, py: 1.75 }}>
        <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', mb: 1.25, lineHeight: 1.4 }}>
          Pick one hitter a day. A hit keeps your streak going, an 0-fer starts you over. How long can you last?
        </Typography>
        <Box
          onClick={() => openAuthDialog('signin')}
          sx={{ px: 1.5, py: '9px', borderRadius: 2, bgcolor: ACCENT, color: '#fff', textAlign: 'center', cursor: 'pointer', fontWeight: 800, fontSize: '0.82rem', '&:hover': { opacity: 0.9 } }}
        >
          Sign in to play
        </Box>
      </Box>
    )
  } else if (myPick && !changing) {
    body = (
      <Box sx={{ px: 1.75, py: 1.5 }}>
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'text.disabled', mb: 0.75 }}>
          Today's pick
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TeamLogo teamId={myPick.teamId} abbr={TEAM_ABBR[myPick.teamId] ?? '—'} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, lineHeight: 1.2 }}>{myPick.playerName}</Typography>
            <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled' }}>
              {TEAM_NICKNAME[myPick.teamId] ?? TEAM_ABBR[myPick.teamId]}
            </Typography>
          </Box>
          <ResultPill result={myPick.result} />
        </Box>
        <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', mt: 1.25 }}>
          {pickLocked
            ? 'Their game has started, so your pick is locked in. Good luck.'
            : "You can change your pick until their game starts."}
        </Typography>
        {!pickLocked && myPick.result === 'pending' && (
          <Box
            onClick={() => setChanging(true)}
            sx={{ mt: 1, px: 1.25, py: '7px', borderRadius: 2, border: '1px solid', borderColor: 'divider', textAlign: 'center', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 700, color: 'text.secondary', '&:hover': { borderColor: ACCENT, color: ACCENT } }}
          >
            Change pick
          </Box>
        )}
      </Box>
    )
  } else {
    body = (
      <Box sx={{ px: 1.75, py: 1.5 }}>
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'text.disabled', mb: 0.75 }}>
          {changing ? 'Change your pick' : "Pick today's hitter"}
        </Typography>
        {suggestions}
        {changing && (
          <Box onClick={() => { setChanging(false); setQuery(''); setResults([]) }} sx={{ mt: 1, textAlign: 'center', cursor: 'pointer', fontSize: '0.72rem', color: 'text.disabled', '&:hover': { color: 'text.secondary' } }}>
            Cancel
          </Box>
        )}
      </Box>
    )
  }

  return (
    <>
      {Shell(body)}
      {lbOpen && <SurvivorLeaderboardModal userId={user?.id ?? null} onClose={() => setLbOpen(false)} />}
    </>
  )
}

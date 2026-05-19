import React, { useState, useEffect } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import { ACCENT, TEAM_BG } from './constants'
import { fetchStandings } from './api'
import { StandingsDivision, StandingsTeamRecord } from './types'
import { computeWildCardIds } from './Standings'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlayoffTeam {
  team: StandingsTeamRecord
  slot: 'div' | 'wc1' | 'wc2' | 'wc3' | 'out'
  wcGB: string   // games behind last WC spot (or '-' if in)
}

// ─── Build ordered playoff list for one league ────────────────────────────────

function buildLeagueList(divisions: StandingsDivision[], leagueId: number): PlayoffTeam[] {
  const leagueDivs = divisions.filter(d => d.leagueId === leagueId)
  const allTeams = leagueDivs.flatMap(d => d.teams)

  // Div leaders: one per division, sort by record
  const divLeaders = allTeams
    .filter(t => t.divisionRank === 1)
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses)

  // Non-leaders sorted by record
  const nonLeaders = allTeams
    .filter(t => t.divisionRank !== 1)
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses)

  const wcTeams = nonLeaders.slice(0, 3)
  const outTeams = nonLeaders.slice(3)

  // Games out of last WC: reference is wcTeams[2]
  const lastWC = wcTeams[2]
  const gbFromLastWC = (t: StandingsTeamRecord): string => {
    if (!lastWC) return '-'
    const diff = (lastWC.wins - lastWC.losses) - (t.wins - t.losses)
    if (diff <= 0) return '-'
    return (diff / 2).toFixed(1).replace(/\.0$/, '')
  }

  return [
    ...divLeaders.map(t => ({ team: t, slot: 'div' as const, wcGB: '-' })),
    ...wcTeams.map((t, i) => ({ team: t, slot: `wc${i + 1}` as 'wc1' | 'wc2' | 'wc3', wcGB: '-' })),
    ...outTeams.map(t => ({ team: t, slot: 'out' as const, wcGB: gbFromLastWC(t) })),
  ]
}

// ─── Slot badge ───────────────────────────────────────────────────────────────

function SlotBadge({ slot }: { slot: PlayoffTeam['slot'] }) {
  if (slot === 'div') return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      px: 0.75, height: 18, borderRadius: 1,
      bgcolor: 'rgba(34,197,94,0.12)', color: '#22c55e',
      fontSize: '0.58rem', fontWeight: 800, letterSpacing: 0.4,
    }}>DIV</Box>
  )
  if (slot === 'wc1' || slot === 'wc2' || slot === 'wc3') return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      px: 0.75, height: 18, borderRadius: 1,
      bgcolor: 'rgba(96,165,250,0.12)', color: ACCENT,
      fontSize: '0.58rem', fontWeight: 800, letterSpacing: 0.4,
    }}>WC</Box>
  )
  return null
}

// ─── Single team row ──────────────────────────────────────────────────────────

function TeamRow({ pt, isLast, showSep }: { pt: PlayoffTeam; isLast: boolean; showSep: boolean }) {
  const teamColor = TEAM_BG[pt.team.teamId] ?? '#666'
  const isIn = pt.slot !== 'out'

  return (
    <>
      <Box sx={{
        display: 'flex', alignItems: 'center',
        px: 1.5, py: '9px',
        borderBottom: isLast ? 'none' : '1px solid',
        borderColor: 'divider',
        borderLeft: `3px solid ${teamColor}`,
        gap: 1.25,
        opacity: isIn ? 1 : 0.7,
        '&:hover': { bgcolor: 'action.hover' },
        transition: 'background 0.12s',
      }}>
        {/* Color dot */}
        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: teamColor, flexShrink: 0 }} />

        {/* Team name */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, lineHeight: 1.2 }}>{pt.team.abbr}</Typography>
          <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', lineHeight: 1.2, display: { xs: 'none', sm: 'block' } }}>
            {pt.team.teamName}
          </Typography>
        </Box>

        {/* W-L */}
        <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: 'text.secondary', minWidth: 42, textAlign: 'right' }}>
          {pt.team.wins}–{pt.team.losses}
        </Typography>

        {/* PCT */}
        <Typography sx={{ fontSize: '0.78rem', color: 'text.disabled', minWidth: 32, textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>
          {pt.team.pct}
        </Typography>

        {/* Status badge / games back */}
        <Box sx={{ minWidth: 36, display: 'flex', justifyContent: 'flex-end' }}>
          {isIn ? (
            <SlotBadge slot={pt.slot} />
          ) : (
            <Typography sx={{ fontSize: '0.75rem', color: 'text.disabled', fontWeight: 600 }}>
              +{pt.wcGB}
            </Typography>
          )}
        </Box>

        {/* Streak */}
        <Typography sx={{
          fontSize: '0.75rem', fontWeight: 700, minWidth: 24, textAlign: 'right',
          color: pt.team.streakCode.startsWith('W') ? '#22c55e' : pt.team.streakCode.startsWith('L') ? '#ef4444' : 'text.disabled',
        }}>
          {pt.team.streakCode || '—'}
        </Typography>
      </Box>

      {/* Playoff cutoff dashed line */}
      {showSep && (
        <Box sx={{ mx: 1.5, borderBottom: '1.5px dashed', borderColor: `${ACCENT}40` }} />
      )}
    </>
  )
}

// ─── League column ────────────────────────────────────────────────────────────

function LeagueColumn({ label, teams }: { label: string; teams: PlayoffTeam[] }) {
  // Last "in" team index (to place the separator)
  const inIdxs = [...teams].map((t, i) => t.slot !== 'out' ? i : -1).filter(i => i >= 0)
  const lastInIdx = inIdxs.length > 0 ? inIdxs[inIdxs.length - 1] : -1

  return (
    <Box sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', overflow: 'hidden' }}>
      {/* League header */}
      <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.8, color: 'text.disabled' }}>
          {label}
        </Typography>
        {/* Column labels */}
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
          {['W–L', 'PCT', ''].map((h, i) => (
            <Typography key={i} sx={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'text.disabled', minWidth: i === 0 ? 42 : i === 1 ? 32 : 36, textAlign: 'right', display: i === 1 ? { xs: 'none', sm: 'block' } : 'block' }}>
              {h}
            </Typography>
          ))}
          <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'text.disabled', minWidth: 24, textAlign: 'right' }}>
            Strk
          </Typography>
        </Box>
      </Box>

      {/* Teams */}
      {teams.map((pt, i) => (
        <TeamRow
          key={pt.team.teamId}
          pt={pt}
          isLast={i === teams.length - 1}
          showSep={i === lastInIdx && lastInIdx < teams.length - 1}
        />
      ))}
    </Box>
  )
}

// ─── Playoffs component ───────────────────────────────────────────────────────

interface PlayoffsProps {
  season: number
}

export function Playoffs({ season }: PlayoffsProps) {
  const [divisions, setDivisions] = useState<StandingsDivision[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setDivisions([])
    fetchStandings(season)
      .then(data => { if (!cancelled) setDivisions(data) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [season])

  if (loading) return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
      <CircularProgress size={36} sx={{ color: ACCENT }} />
    </Box>
  )
  if (error) return (
    <Box sx={{ textAlign: 'center', py: 8 }}>
      <Typography sx={{ color: 'text.secondary' }}>Could not load standings. Please try again.</Typography>
    </Box>
  )
  if (!divisions.length) return null

  const alTeams = buildLeagueList(divisions, 103)
  const nlTeams = buildLeagueList(divisions, 104)

  return (
    <Box>
      <Box sx={{ mb: 2 }}>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2, color: 'text.disabled' }}>
          Playoff Picture · {season}
        </Typography>
        <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', mt: 0.5 }}>
          3 division leaders + 3 wild cards per league · dashed line = playoff cutoff
        </Typography>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2.5 }}>
        <LeagueColumn label="American League" teams={alTeams} />
        <LeagueColumn label="National League" teams={nlTeams} />
      </Box>
    </Box>
  )
}

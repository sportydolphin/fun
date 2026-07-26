import React, { useState, useEffect } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import { ACCENT, TEAM_NICKNAME } from '../constants'
import { useIsDark, highlightColor } from '../lib/colorUtils'
import { fetchPlayoffOdds, PlayoffOddsRow } from '../api'
import { TeamLogo } from './Standings'

// Percent shown to one significant "feel": near-locks read as >99% rather than a
// misleadingly exact 100%, and live-but-tiny chances read as <1% rather than 0%.
function fmtPct(p: number): string {
  const pct = p * 100
  if (pct >= 99.95) return '>99%'
  if (pct > 0 && pct < 0.5) return '<1%'
  return `${Math.round(pct)}%`
}

// Green when a team is comfortably in, amber in the thick of the race, muted once
// it's a long shot — a quick read down the column before any numbers register.
function pctColor(p: number): string {
  if (p >= 0.85) return '#22c55e'
  if (p >= 0.25) return '#eab308'
  if (p > 0) return 'text.secondary'
  return 'text.disabled'
}

// ─── One team row ─────────────────────────────────────────────────────────────

function OddsRow({ row, isLast, onTeamClick, highlightTeamId }: {
  row: PlayoffOddsRow
  isLast: boolean
  onTeamClick?: (teamId: number) => void
  highlightTeamId?: number | null
}) {
  const isDark = useIsDark()
  const teamColor = highlightColor(row.teamId, isDark)
  const clickable = !!onTeamClick
  const isMine = highlightTeamId != null && row.teamId === highlightTeamId

  return (
    <Box
      onClick={() => onTeamClick?.(row.teamId)}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25,
        px: 1.5, py: '9px',
        borderBottom: isLast ? 'none' : '1px solid', borderColor: 'divider',
        borderLeft: `3px solid ${teamColor}`,
        bgcolor: isMine ? `${teamColor}22` : undefined,
        cursor: clickable ? 'pointer' : 'default',
        '&:hover': { bgcolor: clickable ? 'action.hover' : undefined },
        transition: 'background 0.12s',
      }}
    >
      <TeamLogo teamId={row.teamId} abbr={row.abbr} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.84rem', fontWeight: isMine ? 800 : 700, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {TEAM_NICKNAME[row.teamId] ?? row.abbr}
        </Typography>
        <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', lineHeight: 1.2, mt: '1px' }}>
          proj {row.projWins}–{row.projLosses}
        </Typography>
      </Box>

      {/* Make playoffs — the headline number, with a slim meter under it */}
      <Box sx={{ minWidth: 60, textAlign: 'right' }}>
        <Typography sx={{ fontSize: '0.86rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: pctColor(row.makePlayoffs), lineHeight: 1.2 }}>
          {fmtPct(row.makePlayoffs)}
        </Typography>
        <Box sx={{ mt: '3px', height: 3, borderRadius: 2, bgcolor: 'action.hover', overflow: 'hidden' }}>
          <Box sx={{ height: '100%', width: `${Math.max(0, Math.min(1, row.makePlayoffs)) * 100}%`, bgcolor: teamColor, borderRadius: 2 }} />
        </Box>
      </Box>

      {/* Win the division — secondary, hidden on the narrowest screens */}
      <Box sx={{ minWidth: 42, textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>
        <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: row.winDivision > 0 ? 'text.secondary' : 'text.disabled' }}>
          {fmtPct(row.winDivision)}
        </Typography>
      </Box>
    </Box>
  )
}

// ─── One league card ──────────────────────────────────────────────────────────

function LeagueOddsCard({ label, leagueId, rows, onTeamClick, highlightTeamId }: {
  label: string
  leagueId: number
  rows: PlayoffOddsRow[]
  onTeamClick?: (teamId: number) => void
  highlightTeamId?: number | null
}) {
  const teams = rows
    .filter(r => r.leagueId === leagueId)
    .sort((a, b) => b.makePlayoffs - a.makePlayoffs || b.winDivision - a.winDivision)
  if (!teams.length) return null

  return (
    <Box sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', overflow: 'hidden' }}>
      {/* League header + column labels */}
      <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: 'text.primary' }}>{label}</Typography>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
          <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.disabled', minWidth: 60, textAlign: 'right' }}>
            Playoffs
          </Typography>
          <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.disabled', minWidth: 42, textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>
            Div
          </Typography>
        </Box>
      </Box>

      {teams.map((row, i) => (
        <OddsRow
          key={row.teamId}
          row={row}
          isLast={i === teams.length - 1}
          onTeamClick={onTeamClick}
          highlightTeamId={highlightTeamId}
        />
      ))}
    </Box>
  )
}

// ─── Board ────────────────────────────────────────────────────────────────────

export function PlayoffOddsBoard({ season, onTeamClick, highlightTeamId }: {
  season: number
  onTeamClick?: (teamId: number) => void
  highlightTeamId?: number | null
}) {
  const [rows, setRows] = useState<PlayoffOddsRow[] | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setRows(null)
    fetchPlayoffOdds(season)
      .then(d => { if (!cancelled) setRows(d) })
      .catch(() => { if (!cancelled) setRows(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [season])

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress size={36} sx={{ color: ACCENT }} /></Box>
  }

  if (!rows || !rows.length) {
    return (
      <Box sx={{ textAlign: 'center', py: 8, px: 2 }}>
        <Typography sx={{ color: 'text.secondary', fontSize: '0.9rem' }}>
          Playoff odds aren't up yet. They post once the season's underway and refresh every night.
        </Typography>
      </Box>
    )
  }

  return (
    <Box>
      <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', mb: 2 }}>
        Chance of reaching the postseason, from a nightly simulation of every remaining game. Updated each morning.
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2.5 }}>
        <LeagueOddsCard label="American League" leagueId={103} rows={rows} onTeamClick={onTeamClick} highlightTeamId={highlightTeamId} />
        <LeagueOddsCard label="National League" leagueId={104} rows={rows} onTeamClick={onTeamClick} highlightTeamId={highlightTeamId} />
      </Box>
    </Box>
  )
}

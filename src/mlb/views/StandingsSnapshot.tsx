import React, { useState, useEffect } from 'react'
import { Box, Typography } from '@mui/material'
import { fetchStandings, fetchPlayoffOdds, PlayoffOddsRow } from '../api'
import { StandingsDivision, StandingsTeamRecord } from '../types'
import { TEAM_NICKNAME, ACCENT } from '../constants'
import { useIsDark, highlightColor, fmtGB, defaultBorder } from '../lib/colorUtils'
import { TeamLogo } from './Standings'

// Within this many games of the division lead → the division race is still live,
// so show that. Otherwise the wild card is the more meaningful picture.
const DIV_CLOSE_GB = 5
const MAX_ROWS = 5

// Games back from the wild-card cutoff (the 3rd/last-in team): + ahead of the
// line, − behind it, "-" for the cutoff itself. Mirrors the Standings page.
function fmtWcGap(gap: number): string {
  if (gap === 0) return '-'
  const s = Math.abs(gap).toFixed(1).replace(/\.0$/, '')
  return gap > 0 ? `+${s}` : `-${s}`
}

// Playoff-odds percent for the header strip — matches the Odds board's phrasing so
// a near-lock reads >99% and a live long shot reads <1%.
function fmtOddsPct(p: number): string {
  const pct = p * 100
  if (pct >= 99.95) return '>99%'
  if (pct > 0 && pct < 0.5) return '<1%'
  return `${Math.round(pct)}%`
}

// ─── One standings row ──────────────────────────────────────────────────────────

function SnapshotRow({ team, rightLabel, rightColor, isMine, isLast, showSep, onTeamClick }: {
  team:        StandingsTeamRecord
  rightLabel:  string
  rightColor:  string
  isMine:      boolean
  isLast:      boolean
  showSep:     boolean
  onTeamClick?: (id: number) => void
}) {
  const isDark    = useIsDark()
  const teamColor = highlightColor(team.teamId, isDark)
  const clickable = !!onTeamClick

  return (
    <>
      <Box
        onClick={() => onTeamClick?.(team.teamId)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1,
          px: 1.5, py: '7px',
          borderBottom: isLast ? 'none' : '1px solid', borderColor: 'divider',
          borderLeft: `3px solid ${teamColor}`,
          bgcolor: isMine ? `${teamColor}22` : undefined,
          cursor: clickable ? 'pointer' : 'default',
          '&:hover': { bgcolor: clickable ? 'action.hover' : undefined },
          transition: 'background 0.12s',
        }}
      >
        <TeamLogo teamId={team.teamId} abbr={team.abbr} />
        <Typography sx={{
          flex: 1, minWidth: 0, fontSize: '0.82rem', fontWeight: isMine ? 800 : 700,
          lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {TEAM_NICKNAME[team.teamId] ?? team.abbr}
        </Typography>
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: 'text.secondary', minWidth: 44, textAlign: 'right' }}>
          {team.wins}–{team.losses}
        </Typography>
        <Typography sx={{
          fontSize: '0.76rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
          minWidth: 40, textAlign: 'right', color: rightColor,
        }}>
          {rightLabel}
        </Typography>
      </Box>
      {showSep && <Box sx={{ borderBottom: '2px dashed', borderColor: `${ACCENT}66` }} />}
    </>
  )
}

// ─── View selection ─────────────────────────────────────────────────────────────

type SnapshotView =
  | { kind: 'division'; division: StandingsDivision; highlightId: number | null }
  | { kind: 'wildcard'; leagueId: number; highlightId: number }

function pickView(divisions: StandingsDivision[], followedTeamId: number | null): SnapshotView | null {
  if (!divisions.length) return null

  const division = followedTeamId != null
    ? divisions.find(d => d.teams.some(t => t.teamId === followedTeamId))
    : undefined
  const team = division?.teams.find(t => t.teamId === followedTeamId)

  // No team followed (or not found in standings): show a date-stable "random" division.
  if (!division || !team) {
    const idx = new Date().getDate() % divisions.length
    return { kind: 'division', division: divisions[idx], highlightId: null }
  }

  const gbNum = parseFloat(team.gamesBack)
  const gb = Number.isFinite(gbNum) ? gbNum : Infinity
  if (team.divisionRank === 1 || gb <= DIV_CLOSE_GB) {
    return { kind: 'division', division, highlightId: team.teamId }
  }
  return { kind: 'wildcard', leagueId: division.leagueId, highlightId: team.teamId }
}

// ─── Row assembly ───────────────────────────────────────────────────────────────

interface RowSpec { team: StandingsTeamRecord; rightLabel: string; rightColor: string; isMine: boolean; showSep: boolean }

function divisionRows(division: StandingsDivision, highlightId: number | null): RowSpec[] {
  return [...division.teams]
    .sort((a, b) => a.divisionRank - b.divisionRank)
    .slice(0, MAX_ROWS)
    .map(t => ({
      team: t,
      rightLabel: fmtGB(t.gamesBack),
      rightColor: t.gamesBack === '-' ? 'text.disabled' : 'text.primary',
      isMine: t.teamId === highlightId,
      showSep: false,
    }))
}

function wildcardRows(divisions: StandingsDivision[], leagueId: number, highlightId: number): RowSpec[] {
  const wcTeams = divisions
    .filter(d => d.leagueId === leagueId)
    .flatMap(d => d.teams.filter(t => t.divisionRank !== 1))
    .sort((a, b) => {
      const ra = a.wcRank || 99, rb = b.wcRank || 99
      return ra !== rb ? ra - rb : (b.wins - a.wins || a.losses - b.losses)
    })
  if (!wcTeams.length) return []

  const cutoff = wcTeams[2] // top 3 hold the wild card spots
  const gapFromCutoff = (t: StandingsTeamRecord) =>
    cutoff ? ((t.wins - cutoff.wins) + (cutoff.losses - t.losses)) / 2 : 0

  // 5-team window ending at the followed team once it's past row 5 — so the team
  // sits at the bottom and the rows above show the spots it's chasing (the 3rd/last
  // wild card spot included). Teams inside the top 5 just show the top 5.
  const teamIdx = Math.max(0, wcTeams.findIndex(t => t.teamId === highlightId))
  const start   = teamIdx < MAX_ROWS ? 0 : teamIdx - (MAX_ROWS - 1)
  const window  = wcTeams.slice(start, start + MAX_ROWS)
  const sepLocalIdx = 2 - start // playoff cutoff falls after the 3rd overall WC team

  return window.map((t, i) => {
    const gap = gapFromCutoff(t)
    return {
      team: t,
      rightLabel: fmtWcGap(gap),
      rightColor: gap > 0 ? '#22c55e' : gap < 0 ? '#ef4444' : 'text.disabled',
      isMine: t.teamId === highlightId,
      showSep: i === sepLocalIdx && sepLocalIdx >= 0 && sepLocalIdx < window.length - 1,
    }
  })
}

// ─── StandingsSnapshot ──────────────────────────────────────────────────────────

export function StandingsSnapshot({ followedTeamId, season, onTeamClick }: {
  followedTeamId: number | null
  season:         number
  onTeamClick?:   (id: number) => void
}) {
  const isDark = useIsDark()
  const [divisions, setDivisions] = useState<StandingsDivision[]>([])
  const [myOdds, setMyOdds] = useState<PlayoffOddsRow | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchStandings(season)
      .then(d => { if (!cancelled) setDivisions(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [season])

  // Followed team's playoff odds for the header strip. Missing/stale precompute
  // just hides the strip — no fallback, same as the Odds board.
  useEffect(() => {
    let cancelled = false
    setMyOdds(null)
    if (followedTeamId == null) return
    fetchPlayoffOdds(season)
      .then(rows => { if (!cancelled) setMyOdds(rows?.find(r => r.teamId === followedTeamId) ?? null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [season, followedTeamId])

  const view = pickView(divisions, followedTeamId)
  if (!view) return null

  const rows = view.kind === 'division'
    ? divisionRows(view.division, view.highlightId)
    : wildcardRows(divisions, view.leagueId, view.highlightId)
  if (!rows.length) return null

  const leagueAbbr = (id: number) => (id === 103 ? 'AL' : 'NL')
  const title    = view.kind === 'division' ? view.division.divisionName : `${leagueAbbr(view.leagueId)} Wild Card`
  const subtitle = 'GB'

  return (
    <Box sx={{
      borderRadius: 3, border: '1px solid', borderColor: defaultBorder(isDark),
      bgcolor: 'background.paper', overflow: 'hidden',
    }}>
      {/* Header */}
      <Box sx={{
        px: 1.5, py: 1.1, borderBottom: '1px solid', borderColor: 'divider',
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1,
      }}>
        <Typography sx={{
          fontWeight: 800, fontSize: '0.72rem', textTransform: 'uppercase',
          letterSpacing: 1.2, color: ACCENT,
        }}>
          {title}
        </Typography>
        <Typography sx={{
          fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: 0.5, color: 'text.disabled',
        }}>
          {subtitle}
        </Typography>
      </Box>

      {/* Followed team's playoff odds — a one-line strip above the standings rows */}
      {myOdds && (
        <Box sx={{
          px: 1.5, py: '6px', borderBottom: '1px solid', borderColor: 'divider',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
          bgcolor: 'action.hover',
        }}>
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: 'text.secondary' }}>
            Playoff odds
          </Typography>
          <Typography sx={{
            fontSize: '0.74rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums',
            color: myOdds.makePlayoffs >= 0.85 ? '#22c55e' : myOdds.makePlayoffs >= 0.25 ? '#eab308' : 'text.secondary',
          }}>
            {fmtOddsPct(myOdds.makePlayoffs)}
          </Typography>
        </Box>
      )}

      {/* Rows */}
      {rows.map((r, i) => (
        <SnapshotRow
          key={r.team.teamId}
          team={r.team}
          rightLabel={r.rightLabel}
          rightColor={r.rightColor}
          isMine={r.isMine}
          isLast={i === rows.length - 1}
          showSep={r.showSep}
          onTeamClick={onTeamClick}
        />
      ))}
    </Box>
  )
}

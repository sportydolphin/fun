import { useDark } from '../../ui/useDark'
import React, { useState, useEffect } from 'react'
import { Box, Typography } from '@mui/material'
import { TEAM_NICKNAME } from '../constants'
import { highlightColor } from '../lib/colorUtils'
import { fetchPlayoffOdds, PlayoffOddsRow } from '../api'
import { TeamLogo } from '../components/TeamLogo'
import { chromePx, typePx } from '../../ui/scale'
import { teamLink, LINK_SX } from '../lib/links'
import { TYPE_SCALE } from '../../ui/card'
import { bracketLikely } from '../postseason'

// Percent shown to one significant "feel": near-locks read as >99% rather than a
// misleadingly exact 100%, and live-but-tiny chances read as <1% rather than 0%.
function fmtPct(p: number): string {
  const pct = p * 100
  if (pct >= 99.95) return '>99%'
  if (pct > 0 && pct < 0.5) return '<1%'
  return `${Math.round(pct)}%`
}

// Green when a team is comfortably in, amber in the thick of the race, muted once
// it's a long shot: a quick read down the column before any numbers register.
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
  const isDark = useDark()
  const teamColor = highlightColor(row.teamId, isDark)
  const clickable = !!onTeamClick
  const isMine = highlightTeamId != null && row.teamId === highlightTeamId

  return (
    <Box
      {...teamLink(row.teamId, onTeamClick)}
      sx={{
        ...LINK_SX, display: 'flex', alignItems: 'center', gap: 1.25,
        px: 1.5, py: chromePx(9),
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
        <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: isMine ? 800 : 700, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {TEAM_NICKNAME[row.teamId] ?? row.abbr}
        </Typography>
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled', lineHeight: 1.2, mt: '1px' }}>
          proj {row.projWins}–{row.projLosses}
        </Typography>
      </Box>

      {/* Make playoffs: the headline number, with a slim meter under it */}
      <Box sx={{ minWidth: chromePx(60), textAlign: 'right' }}>
        <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: pctColor(row.makePlayoffs), lineHeight: 1.2 }}>
          {fmtPct(row.makePlayoffs)}
        </Typography>
        <Box sx={{ mt: chromePx(3), height: chromePx(3), borderRadius: 2, bgcolor: 'action.hover', overflow: 'hidden' }}>
          <Box sx={{ height: '100%', width: `${Math.max(0, Math.min(1, row.makePlayoffs)) * 100}%`, bgcolor: teamColor, borderRadius: 2 }} />
        </Box>
      </Box>

      {/* Win the division: secondary, hidden on the narrowest screens */}
      <Box sx={{ minWidth: chromePx(42), textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>
        <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: row.winDivision > 0 ? 'text.secondary' : 'text.disabled' }}>
          {fmtPct(row.winDivision)}
        </Typography>
      </Box>
    </Box>
  )
}

// The loading row: OddsRow's own box with nothing in it. Each line holds a non-breaking space in the
// loaded row's Typography so it takes the same line box, and the badge slot is TeamLogo's 28px,
// because a row drawn from guessed heights is what made the old spinner-then-board jump.
function BlankOddsRow({ isLast }: { isLast: boolean }) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: chromePx(9),
      borderBottom: isLast ? 'none' : '1px solid', borderColor: 'divider',
      borderLeft: '3px solid', borderLeftColor: 'action.hover',
    }}>
      <Box sx={{ width: chromePx(28), height: chromePx(28), borderRadius: '50%', bgcolor: 'action.hover', flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, lineHeight: 1.2 }}>{' '}</Typography>
        <Typography sx={{ fontSize: TYPE_SCALE.meta, lineHeight: 1.2, mt: '1px' }}>{' '}</Typography>
      </Box>
      <Box sx={{ minWidth: chromePx(60), textAlign: 'right' }}>
        <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 800, lineHeight: 1.2 }}>{' '}</Typography>
        <Box sx={{ mt: chromePx(3), height: chromePx(3), borderRadius: 2, bgcolor: 'action.hover' }} />
      </Box>
      <Box sx={{ minWidth: chromePx(42), display: { xs: 'none', sm: 'block' } }}>
        <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700 }}>{' '}</Typography>
      </Box>
    </Box>
  )
}

// ─── One league card ──────────────────────────────────────────────────────────

function LeagueOddsCard({ label, leagueId, rows, onTeamClick, highlightTeamId }: {
  label: string
  leagueId: number
  /** null while loading: the card draws its header and fifteen blank rows, a league's full field. */
  rows: PlayoffOddsRow[] | null
  onTeamClick?: (teamId: number) => void
  highlightTeamId?: number | null
}) {
  const teams = rows
    ? rows.filter(r => r.leagueId === leagueId)
      .sort((a, b) => b.makePlayoffs - a.makePlayoffs || b.winDivision - a.winDivision)
    : null
  if (teams && !teams.length) return null

  return (
    <Box sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'outline', bgcolor: 'background.paper', overflow: 'hidden' }}>
      {/* League header + column labels */}
      <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, color: 'text.primary' }}>{label}</Typography>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
          <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, textTransform: 'uppercase', letterSpacing: typePx(0.5), color: 'text.disabled', minWidth: '3.75rem', textAlign: 'right' }}>
            Playoffs
          </Typography>
          <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, textTransform: 'uppercase', letterSpacing: typePx(0.5), color: 'text.disabled', minWidth: '2.625rem', textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>
            Div
          </Typography>
        </Box>
      </Box>

      {teams
        ? teams.map((row, i) => (
          <OddsRow
            key={row.teamId}
            row={row}
            isLast={i === teams.length - 1}
            onTeamClick={onTeamClick}
            highlightTeamId={highlightTeamId}
          />
        ))
        : Array.from({ length: TEAMS_PER_LEAGUE }, (_, i) => <BlankOddsRow key={i} isLast={i === TEAMS_PER_LEAGUE - 1} />)}
    </Box>
  )
}

const TEAMS_PER_LEAGUE = 15

// ─── Board ────────────────────────────────────────────────────────────────────

export function PlayoffOddsBoard({ season, onTeamClick, highlightTeamId }: {
  season: number
  onTeamClick?: (teamId: number) => void
  highlightTeamId?: number | null
}) {
  const [rows, setRows] = useState<PlayoffOddsRow[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setRows(null)
    fetchPlayoffOdds(season)
      .then(d => { if (!cancelled) setRows(d) })
      .catch(() => { if (!cancelled) setRows(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [season])

  // WHILE LOADING, DRAW WHAT WILL ARRIVE. A spinner here was replaced by either a full board or a
  // one-line message, so the page jumped whichever came back. The odds go stale and hide a few days
  // after the regular season ends, which is the same window the bracket is up for, so the calendar
  // picks the likely answer: the message from late September to spring, the blank board otherwise.
  if (loading && !bracketLikely()) return <OddsBoardFrame rows={null} />

  if (loading || !rows || !rows.length) {
    return (
      <Box sx={{ textAlign: 'center', py: 8, px: 2 }}>
        <Typography sx={{ color: 'text.secondary', fontSize: TYPE_SCALE.title }}>
          Regular season only
        </Typography>
      </Box>
    )
  }

  return <OddsBoardFrame rows={rows} onTeamClick={onTeamClick} highlightTeamId={highlightTeamId} />
}

function OddsBoardFrame({ rows, onTeamClick, highlightTeamId }: {
  rows: PlayoffOddsRow[] | null
  onTeamClick?: (teamId: number) => void
  highlightTeamId?: number | null
}) {
  return (
    <Box>
      <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', mb: 2 }}>
        Postseason % · simulated nightly
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2.5 }}>
        <LeagueOddsCard label="American League" leagueId={103} rows={rows} onTeamClick={onTeamClick} highlightTeamId={highlightTeamId} />
        <LeagueOddsCard label="National League" leagueId={104} rows={rows} onTeamClick={onTeamClick} highlightTeamId={highlightTeamId} />
      </Box>
    </Box>
  )
}

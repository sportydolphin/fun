import React, { useState, useEffect } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import { ACCENT, TEAM_BG } from './constants'
import { fetchStandings } from './api'
import { StandingsDivision, StandingsTeamRecord } from './types'
import { SegControl } from './components'

// ─── Division display order ───────────────────────────────────────────────────

const AL_ORDER = [201, 202, 200] // East, Central, West
const NL_ORDER = [204, 205, 203]

const TEAM_LOGO = (id: number) =>
  `https://www.mlbstatic.com/team-logos/team-cap-on-dark/${id}.svg`

// ─── Wild card computation ────────────────────────────────────────────────────

function computeWildCardIds(divisions: StandingsDivision[], leagueId: number): Set<number> {
  const nonLeaders = divisions
    .filter(d => d.leagueId === leagueId)
    .flatMap(d => d.teams.filter(t => t.divisionRank !== 1))
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses)
  return new Set(nonLeaders.slice(0, 3).map(t => t.teamId))
}

// ─── Stat cells ───────────────────────────────────────────────────────────────

function StreakCell({ code }: { code: string }) {
  if (!code) return <Box component="span" sx={{ color: 'text.disabled' }}>—</Box>
  return (
    <Box component="span" sx={{ color: code.startsWith('W') ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
      {code}
    </Box>
  )
}

function L10Cell({ value }: { value: string }) {
  if (!value || value === '—') return <Box component="span" sx={{ color: 'text.disabled' }}>—</Box>
  const wins = parseInt(value.split('-')[0] ?? '0', 10)
  return (
    <Box component="span" sx={{ color: wins > 5 ? '#22c55e' : wins < 5 ? '#ef4444' : 'text.secondary', fontWeight: 600 }}>
      {value}
    </Box>
  )
}

function DiffCell({ diff }: { diff: number }) {
  return (
    <Box component="span" sx={{ color: diff > 0 ? '#22c55e' : diff < 0 ? '#ef4444' : 'text.secondary', fontWeight: 600 }}>
      {diff > 0 ? `+${diff}` : diff}
    </Box>
  )
}

// ─── Team logo — always shown on a team-colored circle so it's visible in both light + dark mode

function TeamLogo({ teamId, abbr }: { teamId: number; abbr: string }) {
  const [failed, setFailed] = useState(false)
  const bg = TEAM_BG[teamId] ?? '#444'
  return (
    <Box sx={{
      width: 28, height: 28, borderRadius: '50%',
      bgcolor: bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, overflow: 'hidden',
    }}>
      {failed ? (
        // Fallback: team abbreviation initials on the color circle
        <Typography sx={{ fontSize: '0.5rem', fontWeight: 800, color: '#fff', lineHeight: 1, userSelect: 'none' }}>
          {abbr.slice(0, 3)}
        </Typography>
      ) : (
        <Box
          component="img"
          src={TEAM_LOGO(teamId)}
          alt={abbr}
          onError={() => setFailed(true)}
          sx={{ width: 20, height: 20, objectFit: 'contain', display: 'block' }}
        />
      )}
    </Box>
  )
}

// ─── Shared th/td styles ──────────────────────────────────────────────────────

const thSx = {
  py: '6px', px: '10px',
  fontSize: '0.58rem', fontWeight: 700,
  letterSpacing: '0.5px', textTransform: 'uppercase' as const,
  whiteSpace: 'nowrap' as const, userSelect: 'none' as const,
  color: 'text.disabled',
  borderBottom: '1px solid', borderColor: 'divider',
  textAlign: 'right' as const,
}

const tdSx = {
  py: '8px', px: '10px',
  fontSize: '0.8rem', whiteSpace: 'nowrap' as const,
  textAlign: 'right' as const,
}

// Columns hidden on small screens
const hiddenXs = { display: { xs: 'none', sm: 'table-cell' } }

// ─── Division card ────────────────────────────────────────────────────────────

function DivisionCard({ division, wcIds, onTeamClick }: {
  division: StandingsDivision
  wcIds: Set<number>
  onTeamClick?: (teamId: number) => void
}) {
  const teams = [...division.teams].sort((a, b) => a.divisionRank - b.divisionRank)

  let lastPlayoffIdx = -1
  for (let i = 0; i < teams.length; i++) {
    if (teams[i].divisionRank === 1 || wcIds.has(teams[i].teamId)) lastPlayoffIdx = i
  }
  const showSeparator = lastPlayoffIdx >= 0 && lastPlayoffIdx < teams.length - 1

  return (
    <Box sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', overflow: 'hidden' }}>
      {/* Division header — prominent label */}
      <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: 'text.primary' }}>
          {division.divisionName}
        </Typography>
      </Box>

      {/* Full-width table — no horizontal scroll */}
      <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%' }}>
        <Box component="thead" sx={{ position: 'sticky', top: 0, zIndex: 2, bgcolor: 'background.paper' }}>
          <Box component="tr">
            <Box component="th" sx={{ ...thSx, textAlign: 'left', pl: '12px', width: '99%' }}>Team</Box>
            <Box component="th" sx={thSx}>W</Box>
            <Box component="th" sx={thSx}>L</Box>
            <Box component="th" sx={thSx}>PCT</Box>
            <Box component="th" sx={thSx}>GB</Box>
            <Box component="th" sx={{ ...thSx, ...hiddenXs }}>L10</Box>
            <Box component="th" sx={{ ...thSx, ...hiddenXs }}>Strk</Box>
            <Box component="th" sx={{ ...thSx, ...hiddenXs }}>DIFF</Box>
          </Box>
        </Box>

        <Box component="tbody">
          {teams.map((t, i) => {
            const teamColor = TEAM_BG[t.teamId] ?? '#666'
            const notLast = i < teams.length - 1
            const isSepRow = showSeparator && i === lastPlayoffIdx
            const borderSx = { borderBottom: notLast ? '1px solid' : 'none', borderColor: 'divider' }
            const clickable = !!onTeamClick

            return (
              <React.Fragment key={t.teamId}>
                <Box
                  component="tr"
                  onClick={() => onTeamClick?.(t.teamId)}
                  sx={{
                    cursor: clickable ? 'pointer' : 'default',
                    '&:hover > td': { bgcolor: clickable ? 'action.hover' : undefined },
                    transition: 'background 0.12s',
                  }}
                >
                  {/* Team cell */}
                  <Box component="td" sx={{
                    ...tdSx, ...borderSx, textAlign: 'left', pl: '9px',
                    borderLeft: `3px solid ${teamColor}`,
                  }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <TeamLogo teamId={t.teamId} abbr={t.abbr} />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, lineHeight: 1.2 }}>{t.abbr}</Typography>
                        <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', lineHeight: 1.2, display: { xs: 'none', md: 'block' } }}>
                          {t.teamName}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>

                  <Box component="td" sx={{ ...tdSx, ...borderSx }}>{t.wins}</Box>
                  <Box component="td" sx={{ ...tdSx, ...borderSx }}>{t.losses}</Box>
                  <Box component="td" sx={{ ...tdSx, ...borderSx, color: 'text.secondary' }}>{t.pct}</Box>
                  <Box component="td" sx={{ ...tdSx, ...borderSx, color: t.gamesBack === '-' ? 'text.disabled' : 'text.primary' }}>{t.gamesBack}</Box>
                  <Box component="td" sx={{ ...tdSx, ...borderSx, ...hiddenXs }}><L10Cell value={t.lastTen} /></Box>
                  <Box component="td" sx={{ ...tdSx, ...borderSx, ...hiddenXs }}><StreakCell code={t.streakCode} /></Box>
                  <Box component="td" sx={{ ...tdSx, ...borderSx, ...hiddenXs }}><DiffCell diff={t.runDiff} /></Box>
                </Box>

                {isSepRow && (
                  <Box component="tr">
                    <Box component="td" colSpan={8} sx={{ py: 0, borderBottom: '1.5px dashed', borderColor: `${ACCENT}40` }} />
                  </Box>
                )}
              </React.Fragment>
            )
          })}
        </Box>
      </Box>
    </Box>
  )
}

// ─── League section ───────────────────────────────────────────────────────────

function LeagueSection({ label, order, leagueId, divisions, onTeamClick }: {
  label: string
  order: number[]
  leagueId: number
  divisions: StandingsDivision[]
  onTeamClick?: (teamId: number) => void
}) {
  const wcIds = computeWildCardIds(divisions, leagueId)
  const sorted = order
    .map(id => divisions.find(d => d.divisionId === id))
    .filter((d): d is StandingsDivision => d != null)

  if (!sorted.length) return null

  return (
    <Box>
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2, color: 'text.disabled', mb: 1.5 }}>
        {label}
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' }, gap: 2 }}>
        {sorted.map(div => (
          <DivisionCard key={div.divisionId} division={div} wcIds={wcIds} onTeamClick={onTeamClick} />
        ))}
      </Box>
    </Box>
  )
}

// ─── Playoff picture ──────────────────────────────────────────────────────────

interface WCTeam { team: StandingsTeamRecord; wcGB: string; inSpot: boolean }

function buildWCList(divisions: StandingsDivision[], leagueId: number): WCTeam[] {
  const nonLeaders = divisions
    .filter(d => d.leagueId === leagueId)
    .flatMap(d => d.teams.filter(t => t.divisionRank !== 1))
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses)
  const lastWC = nonLeaders[2]
  return nonLeaders.map((t, i) => {
    const inSpot = i < 3
    if (inSpot) return { team: t, wcGB: '-', inSpot }
    const diff = lastWC ? ((lastWC.wins - lastWC.losses) - (t.wins - t.losses)) / 2 : 0
    const gb = diff > 0 ? `-${diff.toFixed(1).replace(/\.0$/, '')}` : '-'
    return { team: t, wcGB: gb, inSpot }
  })
}

function PlayoffTeamRow({ team, label, gb, isIn, isLast, showSep, onTeamClick }: {
  team: StandingsTeamRecord; label?: React.ReactNode; gb?: string
  isIn: boolean; isLast: boolean; showSep: boolean
  onTeamClick?: (teamId: number) => void
}) {
  const teamColor = TEAM_BG[team.teamId] ?? '#666'
  const clickable = !!onTeamClick

  return (
    <>
      <Box
        onClick={() => onTeamClick?.(team.teamId)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1.25,
          px: 1.5, py: '9px',
          borderBottom: isLast ? 'none' : '1px solid', borderColor: 'divider',
          borderLeft: `3px solid ${teamColor}`,
          opacity: isIn ? 1 : 0.6,
          cursor: clickable ? 'pointer' : 'default',
          '&:hover': { bgcolor: clickable ? 'action.hover' : undefined },
          transition: 'background 0.12s',
        }}
      >
        <TeamLogo teamId={team.teamId} abbr={team.abbr} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, lineHeight: 1.2 }}>{team.abbr}</Typography>
          <Typography sx={{ fontSize: '0.61rem', color: 'text.disabled', lineHeight: 1.2, display: { xs: 'none', sm: 'block' } }}>
            {team.teamName}
          </Typography>
        </Box>
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: 'text.secondary', minWidth: 44, textAlign: 'right' }}>
          {team.wins}–{team.losses}
        </Typography>
        <Typography sx={{ fontSize: '0.75rem', color: 'text.disabled', minWidth: 34, textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>
          {team.pct}
        </Typography>
        {/* Badge or GB */}
        <Box sx={{ minWidth: 40, textAlign: 'right' }}>
          {label ?? (
            <Typography sx={{ fontSize: '0.75rem', color: 'text.disabled', fontWeight: 600 }}>{gb}</Typography>
          )}
        </Box>
        {/* Streak */}
        <Typography sx={{
          fontSize: '0.74rem', fontWeight: 700, minWidth: 26, textAlign: 'right',
          color: team.streakCode.startsWith('W') ? '#22c55e' : team.streakCode.startsWith('L') ? '#ef4444' : 'text.disabled',
        }}>
          {team.streakCode || '—'}
        </Typography>
      </Box>
      {showSep && <Box sx={{ mx: 1.5, borderBottom: '1.5px dashed', borderColor: `${ACCENT}40` }} />}
    </>
  )
}

const ColHeaders = () => (
  <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
    {(['W–L', 'PCT', '', 'Strk'] as const).map((h, i) => (
      <Typography key={i} sx={{
        fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: 0.5, color: 'text.disabled', textAlign: 'right',
        minWidth: i === 0 ? 44 : i === 1 ? 34 : i === 2 ? 40 : 26,
        display: i === 1 ? { xs: 'none', sm: 'block' } : 'block',
      }}>{h}</Typography>
    ))}
  </Box>
)

function PlayoffLeagueCard({ label, divisions, leagueId, onTeamClick }: {
  label: string; divisions: StandingsDivision[]; leagueId: number
  onTeamClick?: (teamId: number) => void
}) {
  const divWinners = divisions
    .filter(d => d.leagueId === leagueId)
    .flatMap(d => d.teams.filter(t => t.divisionRank === 1))
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses)

  const wcList = buildWCList(divisions, leagueId)
  const lastInIdx = wcList.reduce((acc, t, i) => t.inSpot ? i : acc, -1)

  const DIV_BADGE = (
    <Box sx={{ display: 'inline-flex', px: 0.75, height: 18, borderRadius: 1, alignItems: 'center', bgcolor: 'rgba(34,197,94,0.12)', color: '#22c55e', fontSize: '0.58rem', fontWeight: 800 }}>DIV</Box>
  )
  const WC_BADGE = (
    <Box sx={{ display: 'inline-flex', px: 0.75, height: 18, borderRadius: 1, alignItems: 'center', bgcolor: `${ACCENT}18`, color: ACCENT, fontSize: '0.58rem', fontWeight: 800 }}>WC</Box>
  )

  return (
    <Box sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', overflow: 'hidden' }}>
      {/* League header */}
      <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: 'text.primary' }}>{label}</Typography>
        <ColHeaders />
      </Box>

      {/* Division Winners sub-header */}
      <Box sx={{ px: 2, py: '6px', bgcolor: 'action.hover' }}>
        <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: 'text.disabled' }}>
          Division Winners
        </Typography>
      </Box>
      {divWinners.map((t, i) => (
        <PlayoffTeamRow
          key={t.teamId} team={t} label={DIV_BADGE} isIn={true}
          isLast={false} showSep={false} onTeamClick={onTeamClick}
        />
      ))}

      {/* Wild Card sub-header */}
      <Box sx={{ px: 2, py: '6px', bgcolor: 'action.hover', borderTop: '1px solid', borderColor: 'divider' }}>
        <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: 'text.disabled' }}>
          Wild Card Race
        </Typography>
      </Box>
      {wcList.map((wc, i) => (
        <PlayoffTeamRow
          key={wc.team.teamId} team={wc.team}
          label={wc.inSpot ? WC_BADGE : undefined}
          gb={wc.inSpot ? undefined : wc.wcGB}
          isIn={wc.inSpot}
          isLast={i === wcList.length - 1}
          showSep={i === lastInIdx && lastInIdx < wcList.length - 1}
          onTeamClick={onTeamClick}
        />
      ))}
    </Box>
  )
}

function PlayoffPicture({ divisions, onTeamClick }: {
  divisions: StandingsDivision[]
  onTeamClick?: (teamId: number) => void
}) {
  return (
    <Box>
      <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', mb: 2 }}>
        3 division winners + 3 wild cards per league · dashed line = playoff cutoff
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2.5 }}>
        <PlayoffLeagueCard label="American League" divisions={divisions} leagueId={103} onTeamClick={onTeamClick} />
        <PlayoffLeagueCard label="National League" divisions={divisions} leagueId={104} onTeamClick={onTeamClick} />
      </Box>
    </Box>
  )
}

// ─── Standings component ──────────────────────────────────────────────────────

export function Standings({ season, onTeamClick }: {
  season: number
  onTeamClick?: (teamId: number) => void
}) {
  const [mode, setMode] = useState<'divisions' | 'playoffs'>('divisions')
  const [divisions, setDivisions] = useState<StandingsDivision[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(false); setDivisions([])
    fetchStandings(season)
      .then(data => { if (!cancelled) setDivisions(data) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [season])

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
        <SegControl
          options={[{ value: 'divisions', label: 'Divisions' }, { value: 'playoffs', label: 'Playoff Picture' }]}
          value={mode}
          onChange={v => setMode(v as 'divisions' | 'playoffs')}
        />
      </Box>

      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress size={36} sx={{ color: ACCENT }} /></Box>}
      {!loading && error && <Box sx={{ textAlign: 'center', py: 8 }}><Typography sx={{ color: 'text.secondary' }}>Could not load standings. Please try again.</Typography></Box>}

      {!loading && !error && divisions.length > 0 && (
        mode === 'divisions' ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <LeagueSection label="American League" order={AL_ORDER} leagueId={103} divisions={divisions} onTeamClick={onTeamClick} />
            <LeagueSection label="National League" order={NL_ORDER} leagueId={104} divisions={divisions} onTeamClick={onTeamClick} />
          </Box>
        ) : (
          <PlayoffPicture divisions={divisions} onTeamClick={onTeamClick} />
        )
      )}
    </Box>
  )
}

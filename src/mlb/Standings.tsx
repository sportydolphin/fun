import React, { useState, useEffect } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import { ACCENT, TEAM_BG } from './constants'
import { fetchStandings } from './api'
import { StandingsDivision, StandingsTeamRecord } from './types'
import { SegControl } from './components'

// ─── Division display order ───────────────────────────────────────────────────

const AL_ORDER = [201, 202, 200] // East, Central, West
const NL_ORDER = [204, 205, 203]

// ─── Table cell styles ────────────────────────────────────────────────────────

const thSx = {
  py: '6px',
  px: { xs: '8px', sm: '10px' },
  fontSize: '0.58rem',
  fontWeight: 700,
  letterSpacing: '0.6px',
  textTransform: 'uppercase' as const,
  whiteSpace: 'nowrap' as const,
  userSelect: 'none' as const,
  color: 'text.disabled',
  borderBottom: '1px solid',
  borderColor: 'divider',
  textAlign: 'right' as const,
}

const tdSx = {
  py: '7px',
  px: { xs: '8px', sm: '10px' },
  fontSize: { xs: '0.78rem', sm: '0.8rem' },
  whiteSpace: 'nowrap' as const,
  textAlign: 'right' as const,
  borderBottom: '1px solid',
  borderColor: 'divider',
}

// ─── Wild card computation ────────────────────────────────────────────────────

function computeWildCardIds(divisions: StandingsDivision[], leagueId: number): Set<number> {
  const leagueDivs = divisions.filter(d => d.leagueId === leagueId)
  // All non-division-leader teams
  const nonLeaders = leagueDivs.flatMap(d => d.teams.filter(t => t.divisionRank !== 1))
  // Sort by wins desc, losses asc
  nonLeaders.sort((a, b) => b.wins - a.wins || a.losses - b.losses)
  return new Set(nonLeaders.slice(0, 3).map(t => t.teamId))
}

// ─── Streak cell ─────────────────────────────────────────────────────────────

function StreakCell({ code }: { code: string }) {
  if (!code) return <Box component="span" sx={{ color: 'text.disabled' }}>—</Box>
  const isWin = code.startsWith('W')
  return (
    <Box component="span" sx={{ color: isWin ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
      {code}
    </Box>
  )
}

// ─── L10 cell ────────────────────────────────────────────────────────────────

function L10Cell({ value }: { value: string }) {
  if (!value || value === '—') return <Box component="span" sx={{ color: 'text.disabled' }}>—</Box>
  const wins = parseInt(value.split('-')[0] ?? '0', 10)
  const color = wins > 5 ? '#22c55e' : wins < 5 ? '#ef4444' : 'text.secondary'
  return <Box component="span" sx={{ color, fontWeight: 600 }}>{value}</Box>
}

// ─── Diff cell ───────────────────────────────────────────────────────────────

function DiffCell({ diff }: { diff: number }) {
  const color = diff > 0 ? '#22c55e' : diff < 0 ? '#ef4444' : 'text.secondary'
  const label = diff > 0 ? `+${diff}` : String(diff)
  return <Box component="span" sx={{ color, fontWeight: 600 }}>{label}</Box>
}

// ─── WC cell ─────────────────────────────────────────────────────────────────

function WCCell({ value }: { value: string }) {
  if (value === '-' || value === '—') {
    return <Box component="span" sx={{ color: 'text.disabled' }}>-</Box>
  }
  const num = parseFloat(value)
  const color = !isNaN(num) && num <= 3 ? '#f59e0b' : '#ef4444'
  return <Box component="span" sx={{ color, fontWeight: 600 }}>{value}</Box>
}

// ─── Division card ────────────────────────────────────────────────────────────

interface DivisionCardProps {
  division: StandingsDivision
  wcIds: Set<number>
  onNavigateToTeam?: (teamId: number) => void
}

function DivisionCard({ division, wcIds, onNavigateToTeam }: DivisionCardProps) {
  const teams = [...division.teams].sort((a, b) => a.divisionRank - b.divisionRank)

  // Find last playoff team index (div leader or WC)
  let lastPlayoffIdx = -1
  for (let i = 0; i < teams.length; i++) {
    if (teams[i].divisionRank === 1 || wcIds.has(teams[i].teamId)) {
      lastPlayoffIdx = i
    }
  }
  // Only show separator if there are teams after the last playoff team
  const showSeparator = lastPlayoffIdx >= 0 && lastPlayoffIdx < teams.length - 1

  return (
    <Box sx={{
      borderRadius: 2.5,
      border: '1px solid',
      borderColor: 'divider',
      bgcolor: 'background.paper',
      overflow: 'hidden',
    }}>
      {/* Division header */}
      <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography sx={{
          fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: 1.8, color: 'text.disabled',
        }}>
          {division.divisionName}
        </Typography>
      </Box>

      {/* Table scroll wrapper */}
      <Box sx={{ width: 'fit-content', maxWidth: '100%', overflowX: 'auto' }}>
        <Box component="table" sx={{ borderCollapse: 'collapse', width: 'max-content' }}>

          {/* Header */}
          <Box component="thead" sx={{ position: 'sticky', top: 0, zIndex: 2, bgcolor: 'background.paper' }}>
            <Box component="tr">
              <Box component="th" sx={{ ...thSx, textAlign: 'left', pl: { xs: '10px', sm: '14px' }, minWidth: { xs: 130, sm: 160 } }}>
                Team
              </Box>
              {['W', 'L', 'PCT', 'GB', 'WC', 'L10', 'Strk', 'DIFF'].map(h => (
                <Box component="th" key={h} sx={thSx}>{h}</Box>
              ))}
            </Box>
          </Box>

          <Box component="tbody">
            {teams.map((t, i) => {
              const isDivLeader = t.divisionRank === 1
              const isWC = !isDivLeader && wcIds.has(t.teamId)
              const borderColor = isDivLeader ? '#22c55e' : isWC ? '#f59e0b' : 'transparent'
              const notLast = i < teams.length - 1
              const isSepRow = showSeparator && i === lastPlayoffIdx

              return (
                <React.Fragment key={t.teamId}>
                  <Box
                    component="tr"
                    onClick={() => onNavigateToTeam?.(t.teamId)}
                    sx={{
                      cursor: onNavigateToTeam ? 'pointer' : 'default',
                      '&:hover > td': onNavigateToTeam ? { bgcolor: 'action.hover' } : {},
                      transition: 'background 0.12s',
                    }}
                  >
                    {/* Team cell */}
                    <Box component="td" sx={{
                      ...tdSx,
                      textAlign: 'left',
                      pl: { xs: '7px', sm: '11px' },
                      borderBottom: notLast ? '1px solid' : 'none',
                      borderColor: 'divider',
                      borderLeft: `3px solid ${borderColor}`,
                    }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {/* Team color dot */}
                        <Box sx={{
                          width: 10, height: 10,
                          borderRadius: '50%',
                          bgcolor: TEAM_BG[t.teamId] ?? '#666',
                          flexShrink: 0,
                        }} />
                        <Box>
                          <Typography sx={{
                            fontSize: { xs: '0.8rem', sm: '0.82rem' },
                            fontWeight: 700, lineHeight: 1.2,
                            color: isDivLeader ? '#22c55e' : isWC ? '#f59e0b' : 'text.primary',
                          }}>
                            {t.abbr}
                          </Typography>
                          <Typography sx={{
                            fontSize: '0.63rem', color: 'text.disabled', lineHeight: 1.2,
                            display: { xs: 'none', sm: 'block' },
                          }}>
                            {t.teamName}
                          </Typography>
                        </Box>
                      </Box>
                    </Box>

                    {/* Stat cells */}
                    {[
                      <Box component="span">{t.wins}</Box>,
                      <Box component="span">{t.losses}</Box>,
                      <Box component="span" sx={{ color: 'text.secondary' }}>{t.pct}</Box>,
                      <Box component="span" sx={{ color: t.gamesBack === '-' ? 'text.disabled' : 'text.primary' }}>{t.gamesBack}</Box>,
                      <WCCell value={t.wcGamesBack} />,
                      <L10Cell value={t.lastTen} />,
                      <StreakCell code={t.streakCode} />,
                      <DiffCell diff={t.runDiff} />,
                    ].map((cell, ci) => (
                      <Box component="td" key={ci} sx={{
                        ...tdSx,
                        borderBottom: notLast ? '1px solid' : 'none',
                        borderColor: 'divider',
                      }}>
                        {cell}
                      </Box>
                    ))}
                  </Box>

                  {/* Playoff cutoff separator */}
                  {isSepRow && (
                    <Box component="tr">
                      <Box component="td" colSpan={9} sx={{
                        py: 0, borderBottom: '1px dotted',
                        borderColor: `${ACCENT}50`,
                      }} />
                    </Box>
                  )}
                </React.Fragment>
              )
            })}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

// ─── Standings component ──────────────────────────────────────────────────────

interface StandingsProps {
  season: number
  onNavigateToTeam?: (teamId: number) => void
}

export function Standings({ season, onNavigateToTeam }: StandingsProps) {
  const [league, setLeague] = useState<'AL' | 'NL'>('AL')
  const [divisions, setDivisions] = useState<StandingsDivision[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setDivisions([])
    fetchStandings(season)
      .then(data => {
        if (!cancelled) setDivisions(data)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [season])

  const alWCIds = computeWildCardIds(divisions, 103)
  const nlWCIds = computeWildCardIds(divisions, 104)
  const wcIds = league === 'AL' ? alWCIds : nlWCIds

  const order = league === 'AL' ? AL_ORDER : NL_ORDER
  const leagueId = league === 'AL' ? 103 : 104
  const sorted = order
    .map(id => divisions.find(d => d.divisionId === id))
    .filter((d): d is StandingsDivision => d != null && d.leagueId === leagueId)

  return (
    <Box>
      {/* League toggle */}
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
        <SegControl
          options={[
            { value: 'AL', label: 'American League' },
            { value: 'NL', label: 'National League' },
          ]}
          value={league}
          onChange={v => setLeague(v as 'AL' | 'NL')}
        />
      </Box>

      {/* Loading */}
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress size={36} sx={{ color: ACCENT }} />
        </Box>
      )}

      {/* Error */}
      {!loading && error && (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <Typography sx={{ color: 'text.secondary', fontSize: '0.9rem' }}>
            Could not load standings. Please try again.
          </Typography>
        </Box>
      )}

      {/* Empty */}
      {!loading && !error && sorted.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <Typography sx={{ color: 'text.secondary', fontSize: '0.9rem' }}>
            No standings data for {season}.
          </Typography>
        </Box>
      )}

      {/* Division grid */}
      {!loading && !error && sorted.length > 0 && (
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
          gap: 2.5,
        }}>
          {sorted.map(div => (
            <DivisionCard
              key={div.divisionId}
              division={div}
              wcIds={wcIds}
              onNavigateToTeam={onNavigateToTeam}
            />
          ))}
        </Box>
      )}
    </Box>
  )
}

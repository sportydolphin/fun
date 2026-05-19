import React from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import { useState, useEffect } from 'react'
import { ACCENT, TEAM_BG } from './constants'
import { fetchStandings } from './api'
import { StandingsDivision, StandingsTeamRecord } from './types'

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
}

// ─── Wild card computation ────────────────────────────────────────────────────

export function computeWildCardIds(divisions: StandingsDivision[], leagueId: number): Set<number> {
  const leagueDivs = divisions.filter(d => d.leagueId === leagueId)
  const nonLeaders = leagueDivs.flatMap(d => d.teams.filter(t => t.divisionRank !== 1))
  nonLeaders.sort((a, b) => b.wins - a.wins || a.losses - b.losses)
  return new Set(nonLeaders.slice(0, 3).map(t => t.teamId))
}

// ─── Stat cells ───────────────────────────────────────────────────────────────

function StreakCell({ code }: { code: string }) {
  if (!code) return <Box component="span" sx={{ color: 'text.disabled' }}>—</Box>
  const isWin = code.startsWith('W')
  return (
    <Box component="span" sx={{ color: isWin ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
      {code}
    </Box>
  )
}

function L10Cell({ value }: { value: string }) {
  if (!value || value === '—') return <Box component="span" sx={{ color: 'text.disabled' }}>—</Box>
  const wins = parseInt(value.split('-')[0] ?? '0', 10)
  const color = wins > 5 ? '#22c55e' : wins < 5 ? '#ef4444' : 'text.secondary'
  return <Box component="span" sx={{ color, fontWeight: 600 }}>{value}</Box>
}

function DiffCell({ diff }: { diff: number }) {
  const color = diff > 0 ? '#22c55e' : diff < 0 ? '#ef4444' : 'text.secondary'
  const label = diff > 0 ? `+${diff}` : String(diff)
  return <Box component="span" sx={{ color, fontWeight: 600 }}>{label}</Box>
}

function WCCell({ value }: { value: string }) {
  if (value === '-' || value === '—') {
    return <Box component="span" sx={{ color: 'text.disabled' }}>-</Box>
  }
  const num = parseFloat(value)
  const color = !isNaN(num) && num <= 3 ? '#f59e0b' : 'text.secondary'
  return <Box component="span" sx={{ color }}>{value}</Box>
}

// ─── Division card ────────────────────────────────────────────────────────────

function DivisionCard({ division, wcIds }: {
  division: StandingsDivision
  wcIds: Set<number>
}) {
  const teams = [...division.teams].sort((a, b) => a.divisionRank - b.divisionRank)

  // Find last playoff team index (div leader or WC)
  let lastPlayoffIdx = -1
  for (let i = 0; i < teams.length; i++) {
    if (teams[i].divisionRank === 1 || wcIds.has(teams[i].teamId)) lastPlayoffIdx = i
  }
  const showSeparator = lastPlayoffIdx >= 0 && lastPlayoffIdx < teams.length - 1

  return (
    <Box sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', overflow: 'hidden' }}>
      {/* Division header */}
      <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.8, color: 'text.disabled' }}>
          {division.divisionName}
        </Typography>
      </Box>

      {/* Table */}
      <Box sx={{ width: 'fit-content', maxWidth: '100%', overflowX: 'auto' }}>
        <Box component="table" sx={{ borderCollapse: 'collapse', width: 'max-content' }}>

          <Box component="thead" sx={{ position: 'sticky', top: 0, zIndex: 2, bgcolor: 'background.paper' }}>
            <Box component="tr">
              <Box component="th" sx={{ ...thSx, textAlign: 'left', pl: { xs: '10px', sm: '14px' }, minWidth: { xs: 130, sm: 155 } }}>
                Team
              </Box>
              {['W', 'L', 'PCT', 'GB', 'WC', 'L10', 'Strk', 'DIFF'].map(h => (
                <Box component="th" key={h} sx={thSx}>{h}</Box>
              ))}
            </Box>
          </Box>

          <Box component="tbody">
            {teams.map((t, i) => {
              const teamColor = TEAM_BG[t.teamId] ?? '#666'
              const notLast = i < teams.length - 1
              const isSepRow = showSeparator && i === lastPlayoffIdx

              return (
                <React.Fragment key={t.teamId}>
                  <Box component="tr" sx={{ '&:hover > td': { bgcolor: 'action.hover' }, transition: 'background 0.12s' }}>

                    {/* Team cell */}
                    <Box component="td" sx={{
                      ...tdSx, textAlign: 'left',
                      pl: { xs: '7px', sm: '11px' },
                      borderBottom: notLast ? '1px solid' : 'none',
                      borderColor: 'divider',
                      borderLeft: `3px solid ${teamColor}`,
                    }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: teamColor, flexShrink: 0 }} />
                        <Box>
                          <Typography sx={{ fontSize: { xs: '0.8rem', sm: '0.82rem' }, fontWeight: 700, lineHeight: 1.2 }}>
                            {t.abbr}
                          </Typography>
                          <Typography sx={{ fontSize: '0.63rem', color: 'text.disabled', lineHeight: 1.2, display: { xs: 'none', sm: 'block' } }}>
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
                      <Box component="td" colSpan={9} sx={{ py: 0, borderBottom: '1.5px dashed', borderColor: `${ACCENT}40` }} />
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

// ─── League section ───────────────────────────────────────────────────────────

function LeagueSection({ label, order, leagueId, divisions }: {
  label: string
  order: number[]
  leagueId: number
  divisions: StandingsDivision[]
}) {
  const wcIds = computeWildCardIds(divisions, leagueId)
  const sorted = order
    .map(id => divisions.find(d => d.divisionId === id))
    .filter((d): d is StandingsDivision => d != null)

  if (!sorted.length) return null

  return (
    <Box>
      <Typography sx={{
        fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: 2, color: 'text.disabled', mb: 1.5,
      }}>
        {label}
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
        {sorted.map(div => (
          <DivisionCard key={div.divisionId} division={div} wcIds={wcIds} />
        ))}
      </Box>
    </Box>
  )
}

// ─── Standings component ──────────────────────────────────────────────────────

interface StandingsProps {
  season: number
}

export function Standings({ season }: StandingsProps) {
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
      <Typography sx={{ color: 'text.secondary', fontSize: '0.9rem' }}>Could not load standings. Please try again.</Typography>
    </Box>
  )
  if (!divisions.length) return null

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <LeagueSection label="American League" order={AL_ORDER} leagueId={103} divisions={divisions} />
      <LeagueSection label="National League" order={NL_ORDER} leagueId={104} divisions={divisions} />
    </Box>
  )
}

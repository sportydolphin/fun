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

// ─── Team logo ────────────────────────────────────────────────────────────────

function TeamLogo({ teamId, abbr }: { teamId: number; abbr: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <Box sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: TEAM_BG[teamId] ?? '#666', flexShrink: 0 }} />
    )
  }
  return (
    <Box
      component="img"
      src={TEAM_LOGO(teamId)}
      alt={abbr}
      onError={() => setFailed(true)}
      sx={{ width: 24, height: 24, objectFit: 'contain', flexShrink: 0, display: 'block' }}
    />
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

// Columns that are hidden on small screens
const hiddenXs = { display: { xs: 'none', sm: 'table-cell' } }

// ─── Division card ────────────────────────────────────────────────────────────

function DivisionCard({ division, wcIds }: { division: StandingsDivision; wcIds: Set<number> }) {
  const teams = [...division.teams].sort((a, b) => a.divisionRank - b.divisionRank)

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

            return (
              <React.Fragment key={t.teamId}>
                <Box component="tr" sx={{ '&:hover > td': { bgcolor: 'action.hover' }, transition: 'background 0.12s' }}>

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
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2, color: 'text.disabled', mb: 1.5 }}>
        {label}
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' }, gap: 2 }}>
        {sorted.map(div => <DivisionCard key={div.divisionId} division={div} wcIds={wcIds} />)}
      </Box>
    </Box>
  )
}

// ─── Playoff picture ──────────────────────────────────────────────────────────

interface PlayoffTeam { team: StandingsTeamRecord; slot: 'div' | 'wc' | 'out'; wcGB: string }

function buildLeagueList(divisions: StandingsDivision[], leagueId: number): PlayoffTeam[] {
  const allTeams = divisions.filter(d => d.leagueId === leagueId).flatMap(d => d.teams)
  const divLeaders = allTeams.filter(t => t.divisionRank === 1).sort((a, b) => b.wins - a.wins || a.losses - b.losses)
  const nonLeaders = allTeams.filter(t => t.divisionRank !== 1).sort((a, b) => b.wins - a.wins || a.losses - b.losses)
  const wcTeams = nonLeaders.slice(0, 3)
  const outTeams = nonLeaders.slice(3)
  const lastWC = wcTeams[2]
  const gbFromLastWC = (t: StandingsTeamRecord) => {
    if (!lastWC) return '-'
    const diff = (lastWC.wins - lastWC.losses) - (t.wins - t.losses)
    if (diff <= 0) return '-'
    return (diff / 2).toFixed(1).replace(/\.0$/, '')
  }
  return [
    ...divLeaders.map(t => ({ team: t, slot: 'div' as const, wcGB: '-' })),
    ...wcTeams.map(t => ({ team: t, slot: 'wc' as const, wcGB: '-' })),
    ...outTeams.map(t => ({ team: t, slot: 'out' as const, wcGB: gbFromLastWC(t) })),
  ]
}

function PlayoffTeamRow({ pt, isLast, showSep }: { pt: PlayoffTeam; isLast: boolean; showSep: boolean }) {
  const teamColor = TEAM_BG[pt.team.teamId] ?? '#666'
  const isIn = pt.slot !== 'out'

  return (
    <>
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1.25,
        px: 1.5, py: '10px',
        borderBottom: isLast ? 'none' : '1px solid', borderColor: 'divider',
        borderLeft: `3px solid ${teamColor}`,
        opacity: isIn ? 1 : 0.65,
        '&:hover': { bgcolor: 'action.hover' }, transition: 'background 0.12s',
      }}>
        <TeamLogo teamId={pt.team.teamId} abbr={pt.team.abbr} />

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, lineHeight: 1.2 }}>{pt.team.abbr}</Typography>
          <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', lineHeight: 1.2, display: { xs: 'none', sm: 'block' } }}>
            {pt.team.teamName}
          </Typography>
        </Box>

        {/* W-L */}
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: 'text.secondary', minWidth: 44, textAlign: 'right' }}>
          {pt.team.wins}–{pt.team.losses}
        </Typography>

        {/* PCT */}
        <Typography sx={{ fontSize: '0.75rem', color: 'text.disabled', minWidth: 34, textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>
          {pt.team.pct}
        </Typography>

        {/* Badge / GB */}
        <Box sx={{ minWidth: 38, textAlign: 'right' }}>
          {pt.slot === 'div' && (
            <Box sx={{ display: 'inline-flex', px: 0.75, height: 18, borderRadius: 1, alignItems: 'center', bgcolor: 'rgba(34,197,94,0.12)', color: '#22c55e', fontSize: '0.58rem', fontWeight: 800 }}>DIV</Box>
          )}
          {pt.slot === 'wc' && (
            <Box sx={{ display: 'inline-flex', px: 0.75, height: 18, borderRadius: 1, alignItems: 'center', bgcolor: `${ACCENT}18`, color: ACCENT, fontSize: '0.58rem', fontWeight: 800 }}>WC</Box>
          )}
          {pt.slot === 'out' && (
            <Typography sx={{ fontSize: '0.75rem', color: 'text.disabled', fontWeight: 600 }}>+{pt.wcGB}</Typography>
          )}
        </Box>

        {/* Streak */}
        <Typography sx={{
          fontSize: '0.75rem', fontWeight: 700, minWidth: 26, textAlign: 'right',
          color: pt.team.streakCode.startsWith('W') ? '#22c55e' : pt.team.streakCode.startsWith('L') ? '#ef4444' : 'text.disabled',
        }}>
          {pt.team.streakCode || '—'}
        </Typography>
      </Box>

      {showSep && <Box sx={{ mx: 1.5, borderBottom: '1.5px dashed', borderColor: `${ACCENT}40` }} />}
    </>
  )
}

function PlayoffColumn({ label, teams }: { label: string; teams: PlayoffTeam[] }) {
  const inIdxs = teams.map((t, i) => t.slot !== 'out' ? i : -1).filter(i => i >= 0)
  const lastInIdx = inIdxs.length > 0 ? inIdxs[inIdxs.length - 1] : -1

  return (
    <Box sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', overflow: 'hidden' }}>
      <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.8, color: 'text.disabled' }}>
          {label}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          {['W–L', 'PCT', '', 'Strk'].map((h, i) => (
            <Typography key={i} sx={{
              fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.disabled',
              minWidth: i === 0 ? 44 : i === 1 ? 34 : i === 2 ? 38 : 26, textAlign: 'right',
              display: i === 1 ? { xs: 'none', sm: 'block' } : 'block',
            }}>{h}</Typography>
          ))}
        </Box>
      </Box>
      {teams.map((pt, i) => (
        <PlayoffTeamRow
          key={pt.team.teamId}
          pt={pt}
          isLast={i === teams.length - 1}
          showSep={i === lastInIdx && lastInIdx < teams.length - 1}
        />
      ))}
    </Box>
  )
}

function PlayoffPicture({ divisions }: { divisions: StandingsDivision[] }) {
  const al = buildLeagueList(divisions, 103)
  const nl = buildLeagueList(divisions, 104)
  return (
    <Box>
      <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', mb: 2 }}>
        3 division leaders + 3 wild cards per league · dashed line = playoff cutoff
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2.5 }}>
        <PlayoffColumn label="American League" teams={al} />
        <PlayoffColumn label="National League" teams={nl} />
      </Box>
    </Box>
  )
}

// ─── Standings component ──────────────────────────────────────────────────────

export function Standings({ season }: { season: number }) {
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
      {/* Mode toggle */}
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
            <LeagueSection label="American League" order={AL_ORDER} leagueId={103} divisions={divisions} />
            <LeagueSection label="National League" order={NL_ORDER} leagueId={104} divisions={divisions} />
          </Box>
        ) : (
          <PlayoffPicture divisions={divisions} />
        )
      )}
    </Box>
  )
}

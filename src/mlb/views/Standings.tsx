import React, { useState, useEffect, lazy, Suspense } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import { ACCENT, TEAM_NICKNAME } from '../constants'
import { fmtGB, useIsDark, ringColor, teamLogoBg, teamLogoSrc, teamLogoCrop, highlightColor } from '../lib/colorUtils'
import { fetchStandings } from '../api'
import { StandingsDivision, StandingsTeamRecord } from '../types'
import { SegControl } from '../components'

// Dev-only icon tuner — lazy so it's stripped from production builds.
const IconStudio = import.meta.env.DEV ? lazy(() => import('../dev/IconStudio')) : null

// ─── Division display order ───────────────────────────────────────────────────

const AL_ORDER = [201, 202, 200] // East, Central, West
const NL_ORDER = [204, 205, 203]

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

// ─── Team logo — a team-color ring framing a logo, adapted per theme so it reads
// for all 30 teams in both modes:
//   • Light mode: full-color primary logo on a white center.
//   • Dark mode: per-team locked-in bg / ring / logo (TEAM_ICON_STYLE).
// The team-color ring carries the team identity in both modes.

export function TeamLogo({ teamId, abbr }: { teamId: number; abbr: string }) {
  const [failed, setFailed] = useState(false)
  const isDark = useIsDark()
  const ring = ringColor(teamId, isDark)
  return (
    <Box sx={{
      width: 28, height: 28, borderRadius: '50%',
      bgcolor: teamLogoBg(teamId, isDark), border: `2.5px solid ${ring}`,
      boxShadow: `0 0 0 1px ${ring}30`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, overflow: 'hidden',
    }}>
      {failed ? (
        // Fallback: team abbreviation initials
        <Typography sx={{ fontSize: '0.5rem', fontWeight: 800, color: isDark ? '#fff' : ring, lineHeight: 1, userSelect: 'none' }}>
          {abbr.slice(0, 3)}
        </Typography>
      ) : (
        <Box
          component="img"
          src={teamLogoSrc(teamId, isDark)}
          alt={abbr}
          onError={() => setFailed(true)}
          sx={{ width: 19, height: 19, objectFit: 'contain', display: 'block', transform: teamLogoCrop(teamId, isDark), transformOrigin: 'center' }}
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

function DivisionCard({ division, wcIds, onTeamClick, highlightTeamId }: {
  division: StandingsDivision
  wcIds: Set<number>
  onTeamClick?: (teamId: number) => void
  highlightTeamId?: number | null
}) {
  const teams = [...division.teams].sort((a, b) => a.divisionRank - b.divisionRank)
  const isDark = useIsDark()

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
            const teamColor = highlightColor(t.teamId, isDark)
            const notLast = i < teams.length - 1
            const isSepRow = showSeparator && i === lastPlayoffIdx
            const isMine = highlightTeamId != null && t.teamId === highlightTeamId
            const borderSx = { borderBottom: notLast ? '1px solid' : 'none', borderColor: 'divider' }
            const highlightSx = isMine ? { bgcolor: `${teamColor}22` } : undefined
            const clickable = !!onTeamClick

            return (
              <React.Fragment key={t.teamId}>
                <Box
                  component="tr"
                  onClick={() => onTeamClick?.(t.teamId)}
                  sx={{
                    cursor: clickable ? 'pointer' : 'default',
                    '& > td': highlightSx,
                    '&:hover > td': { bgcolor: clickable ? 'action.hover' : undefined },
                    transition: 'background 0.12s',
                  }}
                >
                  {/* Team cell */}
                  <Box component="td" sx={{
                    ...tdSx, ...borderSx, ...highlightSx, textAlign: 'left', pl: '9px',
                    borderLeft: `3px solid ${teamColor}`,
                    fontWeight: isMine ? 800 : undefined,
                  }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <TeamLogo teamId={t.teamId} abbr={t.abbr} />
                      <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, lineHeight: 1.2 }}>
                        {TEAM_NICKNAME[t.teamId] ?? t.abbr}
                      </Typography>
                    </Box>
                  </Box>

                  <Box component="td" sx={{ ...tdSx, ...borderSx }}>{t.wins}</Box>
                  <Box component="td" sx={{ ...tdSx, ...borderSx }}>{t.losses}</Box>
                  <Box component="td" sx={{ ...tdSx, ...borderSx, color: 'text.secondary' }}>{t.pct}</Box>
                  <Box component="td" sx={{ ...tdSx, ...borderSx, color: t.gamesBack === '-' ? 'text.disabled' : 'text.primary' }}>{fmtGB(t.gamesBack)}</Box>
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

function LeagueSection({ label, order, leagueId, divisions, onTeamClick, highlightTeamId }: {
  label: string
  order: number[]
  leagueId: number
  divisions: StandingsDivision[]
  onTeamClick?: (teamId: number) => void
  highlightTeamId?: number | null
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
          <DivisionCard key={div.divisionId} division={div} wcIds={wcIds} onTeamClick={onTeamClick} highlightTeamId={highlightTeamId} />
        ))}
      </Box>
    </Box>
  )
}

// ─── Playoff picture ──────────────────────────────────────────────────────────

// Games back from the wild-card cutoff (the 3rd/last-in team). Positive = ahead of
// the line, negative = behind, "-" = the cutoff itself, so the column always fills.
function fmtWcGap(gap: number): string {
  if (gap === 0) return '-'
  const s = Math.abs(gap).toFixed(1).replace(/\.0$/, '')
  return gap > 0 ? `+${s}` : `-${s}`
}

function PlayoffTeamRow({ team, gbText, isIn, isLast, showSep, onTeamClick, highlightTeamId }: {
  team: StandingsTeamRecord; gbText: string
  isIn: boolean; isLast: boolean; showSep: boolean
  onTeamClick?: (teamId: number) => void
  highlightTeamId?: number | null
}) {
  const isDark = useIsDark()
  const teamColor = highlightColor(team.teamId, isDark)
  const clickable = !!onTeamClick
  const isMine = highlightTeamId != null && team.teamId === highlightTeamId
  const gapNum = parseFloat(gbText)

  return (
    <>
      <Box
        onClick={() => onTeamClick?.(team.teamId)}
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
        <Box sx={{ display: 'flex' }}>
          <TeamLogo teamId={team.teamId} abbr={team.abbr} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.84rem', fontWeight: isMine ? 800 : 700, lineHeight: 1.2 }}>
            {TEAM_NICKNAME[team.teamId] ?? team.abbr}
          </Typography>
        </Box>
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: 'text.secondary', minWidth: 44, textAlign: 'right' }}>
          {team.wins}–{team.losses}
        </Typography>
        <Typography sx={{ fontSize: '0.75rem', color: 'text.disabled', minWidth: 34, textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>
          {team.pct}
        </Typography>
        {/* Games back from the wild-card line */}
        <Box sx={{ minWidth: 60, textAlign: 'right' }}>
          <Typography sx={{
            fontSize: '0.75rem', fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            color: gapNum > 0 ? '#22c55e' : gapNum < 0 ? '#ef4444' : 'text.disabled',
          }}>{gbText}</Typography>
        </Box>
        {/* Streak */}
        <Typography sx={{
          fontSize: '0.74rem', fontWeight: 700, minWidth: 26, textAlign: 'right',
          color: team.streakCode.startsWith('W') ? '#22c55e' : team.streakCode.startsWith('L') ? '#ef4444' : 'text.disabled',
        }}>
          {team.streakCode || '—'}
        </Typography>
      </Box>
      {showSep && <Box sx={{ borderBottom: '2px solid', borderColor: ACCENT }} />}
    </>
  )
}

const ColHeaders = () => (
  <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
    {(['W–L', 'PCT', 'GB', 'Strk'] as const).map((h, i) => (
      <Typography key={i} sx={{
        fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: 0.5, color: 'text.disabled', textAlign: 'right',
        minWidth: i === 0 ? 44 : i === 1 ? 34 : i === 2 ? 60 : 26,
        display: i === 1 ? { xs: 'none', sm: 'block' } : 'block',
      }}>{h}</Typography>
    ))}
  </Box>
)

function PlayoffLeagueCard({ label, divisions, leagueId, onTeamClick, highlightTeamId }: {
  label: string; divisions: StandingsDivision[]; leagueId: number
  onTeamClick?: (teamId: number) => void
  highlightTeamId?: number | null
}) {
  // Wild card race only: every non-division-leader, ordered by the API's own wild
  // card rank (record as a tiebreak). Games-back comes straight from the API so
  // the numbers always match MLB's official standings.
  const wcTeams = divisions
    .filter(d => d.leagueId === leagueId)
    .flatMap(d => d.teams.filter(t => t.divisionRank !== 1))
    .sort((a, b) => {
      const ra = a.wcRank || 99, rb = b.wcRank || 99
      return ra !== rb ? ra - rb : (b.wins - a.wins || a.losses - b.losses)
    })
  const lastInIdx = 2 // top 3 hold the wild card spots
  // The 3rd wild-card team is the cutoff line; every team's games-back is measured
  // against it so the column fills top-to-bottom (+ ahead of the line, − behind it).
  const cutoff = wcTeams[lastInIdx]
  const gapFromCutoff = (t: StandingsTeamRecord) =>
    cutoff ? ((t.wins - cutoff.wins) + (cutoff.losses - t.losses)) / 2 : 0

  return (
    <Box sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', overflow: 'hidden' }}>
      {/* League header */}
      <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: 'text.primary' }}>{label}</Typography>
        <ColHeaders />
      </Box>

      {/* Wild Card sub-header */}
      <Box sx={{ px: 2, py: '6px', bgcolor: 'action.hover' }}>
        <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: 'text.disabled' }}>
          Wild Card
        </Typography>
      </Box>
      {wcTeams.map((t, i) => {
        const isIn = i <= lastInIdx
        return (
          <PlayoffTeamRow
            key={t.teamId} team={t}
            gbText={fmtWcGap(gapFromCutoff(t))}
            isIn={isIn}
            isLast={i === wcTeams.length - 1}
            showSep={i === lastInIdx && lastInIdx < wcTeams.length - 1}
            onTeamClick={onTeamClick}
            highlightTeamId={highlightTeamId}
          />
        )
      })}
    </Box>
  )
}

function PlayoffPicture({ divisions, onTeamClick, highlightTeamId }: {
  divisions: StandingsDivision[]
  onTeamClick?: (teamId: number) => void
  highlightTeamId?: number | null
}) {
  return (
    <Box>
      <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', mb: 2 }}>
        Wild card race · 3 spots per league · line = playoff cutoff
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2.5 }}>
        <PlayoffLeagueCard label="American League" divisions={divisions} leagueId={103} onTeamClick={onTeamClick} highlightTeamId={highlightTeamId} />
        <PlayoffLeagueCard label="National League" divisions={divisions} leagueId={104} onTeamClick={onTeamClick} highlightTeamId={highlightTeamId} />
      </Box>
    </Box>
  )
}

// ─── Standings component ──────────────────────────────────────────────────────

export function Standings({ season, onTeamClick, highlightTeamId }: {
  season: number
  onTeamClick?: (teamId: number) => void
  highlightTeamId?: number | null
}) {
  const [mode, setMode] = useState<'divisions' | 'playoffs'>('divisions')
  const [divisions, setDivisions] = useState<StandingsDivision[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [studioOpen, setStudioOpen] = useState(false)

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
    <Box sx={{ position: 'relative' }}>
      {/* Dev-only: open the icon-styling tuner */}
      {import.meta.env.DEV && (
        <Box
          onClick={() => setStudioOpen(true)}
          sx={{
            position: 'absolute', top: -4, right: 0, zIndex: 3,
            px: 1.1, py: 0.4, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
            fontSize: '0.62rem', fontWeight: 700, color: 'text.secondary',
            border: '1px solid', borderColor: 'divider',
            '&:hover': { color: 'text.primary', borderColor: 'text.secondary' },
          }}
        >
          🎨 Icon Studio
        </Box>
      )}

      {IconStudio && studioOpen && (
        <Suspense fallback={null}>
          <IconStudio onClose={() => setStudioOpen(false)} />
        </Suspense>
      )}

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
            <LeagueSection label="American League" order={AL_ORDER} leagueId={103} divisions={divisions} onTeamClick={onTeamClick} highlightTeamId={highlightTeamId} />
            <LeagueSection label="National League" order={NL_ORDER} leagueId={104} divisions={divisions} onTeamClick={onTeamClick} highlightTeamId={highlightTeamId} />
          </Box>
        ) : (
          <PlayoffPicture divisions={divisions} onTeamClick={onTeamClick} highlightTeamId={highlightTeamId} />
        )
      )}
    </Box>
  )
}

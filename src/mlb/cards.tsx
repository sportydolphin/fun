// ─── Card components ──────────────────────────────────────────────────────────

import React from 'react'
import { Box, Typography } from '@mui/material'
import { RankMode, Palette, StatDef, Player, Team, TeamPlayerStat, TeamStandingInfo, StandingsDivision } from './types'
import { ACCENT, HITTING_STAT_DEFS, PITCHING_STAT_DEFS, TEAM_HITTING_DEFS, TEAM_PITCHING_DEFS, HEADSHOT, TEAM_BG } from './constants'
import { StatGrid } from './ui'

// ─── Player card inner ────────────────────────────────────────────────────────

export interface CardInnerProps {
  player: Player
  hittingStats: any
  pitchingStats: any
  hitLeaders: Map<string, number[]>
  pitLeaders: Map<string, number[]>
  palette: Palette
  season: number | string
  teamDisplay: string
  rankMode: RankMode
  showPosition: boolean
  showTeam: boolean
  showAge: boolean
  showNumber: boolean
  large?: boolean
  selectedHitStats: string[]
  selectedPitStats: string[]
  onToggleHitStat?: (key: string) => void
  onTogglePitStat?: (key: string) => void
}

export function CardInner({ player, hittingStats, pitchingStats, hitLeaders, pitLeaders, palette, season, teamDisplay, rankMode, showPosition, showTeam, showAge, showNumber, large, selectedHitStats, selectedPitStats, onToggleHitStat, onTogglePitStat }: CardInnerProps) {
  const photoSize = large ? 200 : 120
  const hasHitting = hittingStats && HITTING_STAT_DEFS.some(d => selectedHitStats.includes(d.key))

  // Auto-show saves for closers/relievers who have them
  const saves = pitchingStats ? Number(pitchingStats.saves ?? 0) : 0
  const gamesStarted = pitchingStats ? Number(pitchingStats.gamesStarted ?? 0) : 0
  const effectivePitStats = saves > 0 && !selectedPitStats.includes('sv')
    ? gamesStarted < 3
      ? ['sv', ...selectedPitStats.filter(k => k !== 'wl')]  // pure reliever: swap W-L for SV
      : [...selectedPitStats, 'sv']
    : selectedPitStats

  const subtitleParts: string[] = []
  if (showPosition && player.primaryPosition?.name) subtitleParts.push(player.primaryPosition.name)
  if (showTeam && teamDisplay) subtitleParts.push(teamDisplay)
  if (showAge && player.currentAge != null) subtitleParts.push(`Age ${player.currentAge}`)
  if (showNumber && player.primaryNumber) subtitleParts.push(`#${player.primaryNumber}`)

  return (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: large ? 2.5 : 1.5 }}>
        <Box sx={{
          width: photoSize,
          height: Math.round(photoSize * 1.2),
          borderRadius: 3,
          overflow: 'hidden',
          border: `3px solid ${palette.text}`,
          flexShrink: 0,
          bgcolor: palette.divider,
          backgroundImage: `url(${HEADSHOT(player.id)})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center 20%',
        }} />
      </Box>

      <Typography sx={{
        textAlign: 'center', color: palette.text, fontWeight: 800,
        fontSize: large ? { xs: '2rem', sm: '2.4rem' } : { xs: '1.3rem', sm: '1.6rem' },
        lineHeight: 1.1, letterSpacing: '-0.3px', mb: 0.5,
      }}>
        {player.fullName}
      </Typography>

      {subtitleParts.length > 0 ? (
        <Typography sx={{
          textAlign: 'center', color: palette.sub,
          fontSize: large ? '1rem' : { xs: '0.75rem', sm: '0.82rem' },
          fontWeight: 500, mb: large ? 3.5 : 2,
        }}>
          {subtitleParts.join(' · ')}
        </Typography>
      ) : <Box sx={{ mb: large ? 3.5 : 2 }} />}

      <StatGrid
        defs={HITTING_STAT_DEFS} stats={hittingStats} selected={selectedHitStats}
        palette={palette} rankMode={rankMode} playerId={player.id} leaders={hitLeaders}
        season={season} label="Hitting" large={large} onToggle={onToggleHitStat}
      />
      <StatGrid
        defs={PITCHING_STAT_DEFS} stats={pitchingStats} selected={effectivePitStats}
        palette={palette} rankMode={rankMode} playerId={player.id} leaders={pitLeaders}
        season={season} label="Pitching" large={large} onToggle={onTogglePitStat}
        mt={hasHitting ? 1 : 0}
      />
    </>
  )
}

// ─── Team card inner ──────────────────────────────────────────────────────────

export interface TeamCardInnerProps {
  team: Team
  hittingStats: any
  pitchingStats: any
  palette: Palette
  season: number
  rankMode: RankMode
  hitLeaders: Map<string, number[]>
  pitLeaders: Map<string, number[]>
  large?: boolean
  selectedHitStats: string[]
  selectedPitStats: string[]
  onToggleHitStat?: (key: string) => void
  onTogglePitStat?: (key: string) => void
  standing?: TeamStandingInfo
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

export function TeamCardInner({ team, hittingStats, pitchingStats, palette, season, rankMode, hitLeaders, pitLeaders, large, selectedHitStats, selectedPitStats, onToggleHitStat, onTogglePitStat, standing }: TeamCardInnerProps) {
  const logoSize = large ? 160 : 72

  const wins = pitchingStats?.wins ?? hittingStats?.wins
  const losses = pitchingStats?.losses ?? hittingStats?.losses
  const gp = wins != null && losses != null ? wins + losses : null
  const pct = gp ? (wins / gp).toFixed(3).replace(/^0/, '') : null

  const divisionLabel = team.division?.name
    ? team.division.name.replace(/American League |National League /, '')
    : ''
  const leagueShort = team.league?.name?.includes('American') ? 'AL' : team.league?.name?.includes('National') ? 'NL' : ''
  const subtitle = [leagueShort, divisionLabel].filter(Boolean).join(' · ')

  const hasHitting = hittingStats && TEAM_HITTING_DEFS.some(d => selectedHitStats.includes(d.key))

  const standingLine = standing
    ? [
        `${ordinal(standing.divisionRank)} in ${standing.divisionName}`,
        !standing.divisionLeader && standing.gamesBack !== '-' ? `${standing.gamesBack} GB` : null,
        !standing.divisionLeader && standing.wcRank >= 1 && standing.wcRank <= 3
          ? `WC #${standing.wcRank}${standing.wcGamesBack !== '-' ? ` · ${standing.wcGamesBack} GB` : ''}`
          : null,
      ].filter(Boolean).join(' · ')
    : null

  const logoEl = (
    <Box sx={{
      width: logoSize, height: logoSize,
      borderRadius: '50%',
      border: `3px solid ${palette.text}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      bgcolor: '#fff',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      <Box
        component="img"
        src={`https://www.mlbstatic.com/team-logos/${team.id}.svg`}
        alt={team.abbreviation}
        crossOrigin="anonymous"
        sx={{ width: '82%', height: '82%', objectFit: 'contain' }}
      />
    </Box>
  )

  return (
    <>
      {large ? (
        /* Fullscreen: keep original vertical layout */
        <>
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2.5 }}>{logoEl}</Box>
          <Typography sx={{
            textAlign: 'center', color: palette.text, fontWeight: 800,
            fontSize: { xs: '1.8rem', sm: '2.2rem' },
            lineHeight: 1.1, letterSpacing: '-0.3px', mb: 0.5,
          }}>
            {team.name}
          </Typography>
          {standingLine ? (
            <Typography sx={{ textAlign: 'center', color: palette.rank, fontSize: '0.82rem', fontWeight: 700, mb: 2.5 }}>
              {standingLine}
            </Typography>
          ) : subtitle ? (
            <Typography sx={{ textAlign: 'center', color: palette.sub, fontSize: '1rem', fontWeight: 500, mb: 2.5 }}>
              {subtitle}
            </Typography>
          ) : null}
          {wins != null && losses != null && (
            <Box sx={{ display: 'flex', justifyContent: 'center', gap: 4, mb: 2.5 }}>
              {[['W', wins], ['L', losses], ...(pct ? [['PCT', pct]] : [])].map(([lbl, val]) => (
                <Box key={lbl as string} sx={{ textAlign: 'center' }}>
                  <Typography sx={{ color: palette.rank, fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2, mb: 0.5 }}>{lbl}</Typography>
                  <Typography sx={{ color: palette.text, fontWeight: 800, fontSize: '2.2rem', lineHeight: 1 }}>{val}</Typography>
                </Box>
              ))}
            </Box>
          )}
        </>
      ) : (
        /* Normal: horizontal header — logo left, name/record right */
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
          {logoEl}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{
              color: palette.text, fontWeight: 800,
              fontSize: { xs: '1.2rem', sm: '1.5rem' },
              lineHeight: 1.1, letterSpacing: '-0.3px', mb: 0.25,
            }}>
              {team.name}
            </Typography>
            {standingLine ? (
              <Typography sx={{ color: palette.rank, fontSize: '0.75rem', fontWeight: 700, mb: wins != null ? 0.75 : 0 }}>
                {standingLine}
              </Typography>
            ) : subtitle ? (
              <Typography sx={{ color: palette.sub, fontSize: '0.82rem', fontWeight: 500, mb: wins != null ? 1 : 0 }}>
                {subtitle}
              </Typography>
            ) : null}
            {wins != null && losses != null && (
              <Box sx={{ display: 'flex', gap: 2.5 }}>
                {[['W', wins], ['L', losses], ...(pct ? [['PCT', pct]] : [])].map(([lbl, val]) => (
                  <Box key={lbl as string}>
                    <Typography sx={{ color: palette.rank, fontSize: '0.55rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, mb: 0.25 }}>{lbl}</Typography>
                    <Typography sx={{ color: palette.text, fontWeight: 800, fontSize: '1.35rem', lineHeight: 1 }}>{val}</Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </Box>
      )}

      <StatGrid
        defs={TEAM_HITTING_DEFS} stats={hittingStats} selected={selectedHitStats}
        palette={palette} rankMode={rankMode} playerId={team.id} leaders={hitLeaders}
        season={season} label="Hitting" large={large} onToggle={onToggleHitStat}
      />
      <StatGrid
        defs={TEAM_PITCHING_DEFS} stats={pitchingStats} selected={selectedPitStats}
        palette={palette} rankMode={rankMode} playerId={team.id} leaders={pitLeaders}
        season={season} label="Pitching" large={large} onToggle={onTogglePitStat}
        mt={hasHitting ? 1 : 0}
      />
    </>
  )
}

// ─── Featured player mini-card ────────────────────────────────────────────────
//
// Each card is pinned to a specific team-leader award (Highest OPS, Lowest ERA,
// Most HR, Most SB).  The award label is shown as a banner, and the displayed
// stats are chosen to give context around that award category.

const AWARD_STATS: Record<string, string[]> = {
  ops: ['ops', 'avg', 'hr'],
  era: ['era', 'wl', 'k'],
  hr:  ['hr', 'rbi', 'avg'],
  sb:  ['sb', 'avg', 'ops'],
}

export function FeaturedMiniCard({
  entry, teamId, hitLeaders, pitLeaders, onClick, awardLabel, highlightStat,
}: {
  entry: TeamPlayerStat & { isPitcher: boolean }
  teamId: number
  hitLeaders: Map<string, number[]>
  pitLeaders: Map<string, number[]>
  onClick: () => void
  awardLabel: string
  highlightStat: string
}) {
  const isStarter = entry.isPitcher && entry.gamesStarted >= 3
  const isCloser  = entry.isPitcher && !isStarter && entry.saves >= 3

  const posLabel = entry.isPitcher
    ? (isStarter ? 'SP' : isCloser ? 'CL' : 'RP')
    : entry.position

  const defs    = entry.isPitcher ? PITCHING_STAT_DEFS : HITTING_STAT_DEFS
  const leaders = entry.isPitcher ? pitLeaders : hitLeaders

  const statKeys = AWARD_STATS[highlightStat] ?? [highlightStat]
  const statDefs = statKeys
    .map(k => defs.find(d => d.key === k))
    .filter((d): d is StatDef => d != null)

  const teamColor = TEAM_BG[teamId] ?? ACCENT

  return (
    <Box
      onClick={onClick}
      sx={{
        borderRadius: 2.5, border: '1px solid', borderColor: 'divider',
        bgcolor: 'background.paper', overflow: 'hidden',
        cursor: 'pointer', transition: 'border-color 0.15s, box-shadow 0.15s',
        '&:hover': { borderColor: ACCENT, boxShadow: `0 0 0 1px ${ACCENT}50` },
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        minWidth: 0,
      }}
    >
      {/* Award label banner */}
      <Box sx={{
        width: '100%', bgcolor: `${teamColor}22`,
        borderBottom: `1px solid ${teamColor}40`,
        px: 1, py: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Typography sx={{
          fontSize: '0.58rem', fontWeight: 800, textTransform: 'uppercase',
          letterSpacing: 0.8, color: teamColor, lineHeight: 1,
        }}>
          {awardLabel}
        </Typography>
      </Box>

      <Box sx={{ px: 1.25, pt: 1.25, pb: 1.5, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* Headshot */}
        <Box sx={{
          width: 56, height: 68, borderRadius: 2, overflow: 'hidden',
          border: `2px solid ${teamColor}`, bgcolor: 'action.hover',
          flexShrink: 0, mb: 0.75, mx: 'auto',
        }}>
          <Box
            component="img"
            src={HEADSHOT(entry.playerId)}
            alt={entry.playerName}
            sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 15%', display: 'block' }}
          />
        </Box>

        {/* Full name */}
        <Typography sx={{
          fontWeight: 700, fontSize: '0.74rem', lineHeight: 1.2,
          textAlign: 'center', mb: 0.25, px: 0.5,
          display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {entry.playerName}
        </Typography>

        {/* Position badge */}
        <Box sx={{
          display: 'inline-flex', px: 0.75, height: 15, borderRadius: 1,
          alignItems: 'center', justifyContent: 'center',
          bgcolor: `${teamColor}22`, mb: 1.25,
        }}>
          <Typography sx={{ fontSize: '0.54rem', fontWeight: 800, color: teamColor, letterSpacing: 0.5 }}>
            {posLabel}
          </Typography>
        </Box>

        {/* Stat columns — first stat is the award stat, shown slightly larger */}
        <Box sx={{ display: 'flex', width: '100%' }}>
          {statDefs.map((def, i) => {
            const value = def.format(def.getValue(entry.stat))
            const ids   = def.leaderCategory ? (leaders.get(def.leaderCategory) ?? []) : []
            const rank  = ids.indexOf(entry.playerId)
            const isElite = rank !== -1 && rank < 5
            const isAward = i === 0
            return (
              <Box key={def.key} sx={{
                flex: 1, textAlign: 'center',
                borderLeft: i > 0 ? '1px solid' : 'none',
                borderColor: 'divider',
                px: 0.25,
              }}>
                <Typography sx={{
                  fontSize: '0.52rem', fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: 0.6, color: isAward ? teamColor : 'text.disabled',
                  lineHeight: 1, mb: 0.4,
                }}>
                  {def.label}
                </Typography>
                <Typography sx={{
                  fontSize: isAward ? '1.05rem' : '0.9rem',
                  fontWeight: 800, lineHeight: 1,
                  color: isElite ? ACCENT : isAward ? 'text.primary' : 'text.secondary',
                }}>
                  {value}
                </Typography>
                {isElite && (
                  <Typography sx={{ fontSize: '0.5rem', color: ACCENT, fontWeight: 700, mt: 0.3, lineHeight: 1 }}>
                    #{rank + 1}
                  </Typography>
                )}
              </Box>
            )
          })}
        </Box>
      </Box>
    </Box>
  )
}

// ─── Division standings card ───────────────────────────────────────────────────

export function DivisionStandingsCard({
  division, highlightTeamId, season,
}: {
  division: StandingsDivision
  highlightTeamId: number
  season: number
}) {
  const sorted = [...division.teams].sort((a, b) => a.divisionRank - b.divisionRank)
  const teamColor = TEAM_BG[highlightTeamId] ?? ACCENT

  const hdrSx = {
    fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase' as const,
    letterSpacing: 0.5, color: 'text.disabled', lineHeight: 1,
  }
  const cellSx = { fontSize: '0.75rem', fontWeight: 600, lineHeight: 1 }

  return (
    <Box sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{
        px: 1.5, py: 0.85,
        background: `linear-gradient(90deg, ${teamColor}20 0%, transparent 100%)`,
        borderBottom: '1px solid', borderColor: 'divider',
        display: 'flex', alignItems: 'baseline', gap: 1,
      }}>
        <Typography sx={{ fontWeight: 800, fontSize: '0.82rem', letterSpacing: '-0.2px' }}>
          {division.divisionName}
        </Typography>
        <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', fontWeight: 600 }}>
          {season}
        </Typography>
      </Box>

      {/* Column headers */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '18px 40px 1fr 26px 26px 36px', px: 1.25, py: 0.5, borderBottom: '1px solid', borderColor: 'divider', gap: '4px' }}>
        <Typography sx={hdrSx}>#</Typography>
        <Box />
        <Typography sx={hdrSx}>Team</Typography>
        <Typography sx={{ ...hdrSx, textAlign: 'right' }}>W</Typography>
        <Typography sx={{ ...hdrSx, textAlign: 'right' }}>L</Typography>
        <Typography sx={{ ...hdrSx, textAlign: 'right' }}>GB</Typography>
      </Box>

      {/* Team rows */}
      {sorted.map((t, idx) => {
        const isHL = t.teamId === highlightTeamId
        return (
          <Box key={t.teamId} sx={{
            display: 'grid', gridTemplateColumns: '18px 40px 1fr 26px 26px 36px',
            alignItems: 'center', gap: '4px',
            px: 1.25, py: 0.7,
            bgcolor: isHL ? `${teamColor}14` : undefined,
            borderLeft: `3px solid ${isHL ? teamColor : 'transparent'}`,
            borderBottom: idx < sorted.length - 1 ? '1px solid' : 'none',
            borderColor: 'divider',
          }}>
            {/* Rank */}
            <Typography sx={{ ...cellSx, color: isHL ? teamColor : 'text.disabled', fontWeight: isHL ? 800 : 600 }}>
              {t.divisionRank}
            </Typography>
            {/* Logo */}
            <Box sx={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Box
                component="img"
                src={`https://www.mlbstatic.com/team-logos/${t.teamId}.svg`}
                alt={t.abbr}
                crossOrigin="anonymous"
                sx={{ width: 20, height: 20, objectFit: 'contain', opacity: isHL ? 1 : 0.7 }}
              />
            </Box>
            {/* Name */}
            <Typography sx={{ ...cellSx, fontWeight: isHL ? 800 : 600, color: isHL ? 'text.primary' : 'text.secondary' }}>
              {t.abbr}
            </Typography>
            {/* W */}
            <Typography sx={{ ...cellSx, textAlign: 'right', color: 'text.primary' }}>{t.wins}</Typography>
            {/* L */}
            <Typography sx={{ ...cellSx, textAlign: 'right', color: 'text.secondary' }}>{t.losses}</Typography>
            {/* GB */}
            <Typography sx={{
              ...cellSx, textAlign: 'right',
              color: t.divisionLeader ? (isHL ? teamColor : ACCENT) : 'text.disabled',
              fontWeight: t.divisionLeader ? 800 : 600,
            }}>
              {t.gamesBack}
            </Typography>
          </Box>
        )
      })}
    </Box>
  )
}

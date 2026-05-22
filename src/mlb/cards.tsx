// ─── Card components ──────────────────────────────────────────────────────────

import React from 'react'
import { Box, Typography } from '@mui/material'
import { RankMode, Palette, StatDef, Player, Team, TeamPlayerStat, TeamStandingInfo } from './types'
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
        season={season} label="Hitting" large={large}
      />
      <StatGrid
        defs={PITCHING_STAT_DEFS} stats={pitchingStats} selected={effectivePitStats}
        palette={palette} rankMode={rankMode} playerId={player.id} leaders={pitLeaders}
        season={season} label="Pitching" large={large}
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
        !standing.divisionLeader && standing.wcGamesBack !== '-' ? `WC: ${standing.wcGamesBack}` : null,
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
          {subtitle && (
            <Typography sx={{ textAlign: 'center', color: palette.sub, fontSize: '1rem', fontWeight: 500, mb: standingLine ? 0.75 : 2.5 }}>
              {subtitle}
            </Typography>
          )}
          {standingLine && (
            <Typography sx={{ textAlign: 'center', color: palette.rank, fontSize: '0.78rem', fontWeight: 700, mb: 2.5 }}>
              {standingLine}
            </Typography>
          )}
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
            {subtitle && (
              <Typography sx={{ color: palette.sub, fontSize: '0.82rem', fontWeight: 500, mb: standingLine ? 0.25 : wins != null ? 1 : 0 }}>
                {subtitle}
              </Typography>
            )}
            {standingLine && (
              <Typography sx={{ color: palette.rank, fontSize: '0.72rem', fontWeight: 700, mb: wins != null ? 0.75 : 0 }}>
                {standingLine}
              </Typography>
            )}
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
// Shown as a trio of cards below the team stat card. Each card surfaces the
// 3 stats where the player ranks best in the league (from a curated candidate
// set), falling back to sensible positional defaults when no rank data is
// available.

const HIT_MINI_CANDIDATES  = ['avg', 'hr', 'rbi', 'ops', 'obp', 'slg', 'sb', '2b', '3b', 'bb']
const HIT_MINI_FALLBACK    = ['avg', 'hr', 'ops']
const PIT_SP_CANDIDATES    = ['era', 'k', 'whip', 'so9', 'ip']
const PIT_SP_FALLBACK      = ['era', 'k', 'whip']
const PIT_RP_CANDIDATES    = ['era', 'sv', 'k', 'whip']
const PIT_RP_FALLBACK      = ['era', 'sv', 'k']

function pickMiniStats(
  playerId: number,
  isPitcher: boolean,
  isCloser: boolean,
  defs: StatDef[],
  leaders: Map<string, number[]>,
): StatDef[] {
  const candidates = isPitcher
    ? (isCloser ? PIT_RP_CANDIDATES : PIT_SP_CANDIDATES)
    : HIT_MINI_CANDIDATES
  const fallback = isPitcher
    ? (isCloser ? PIT_RP_FALLBACK : PIT_SP_FALLBACK)
    : HIT_MINI_FALLBACK

  // Score each candidate by league rank (lower rank = better)
  const scored = candidates
    .map(key => {
      const def = defs.find(d => d.key === key)
      if (!def) return null
      const ids = def.leaderCategory ? (leaders.get(def.leaderCategory) ?? []) : []
      const rank = ids.indexOf(playerId)
      return { def, rank: rank === -1 ? 9999 : rank }
    })
    .filter((x): x is { def: StatDef; rank: number } => x !== null)
    .sort((a, b) => a.rank - b.rank)

  // Take best-ranked stats first, then fill with fallbacks
  const selected: StatDef[] = []
  for (const { def, rank } of scored) {
    if (selected.length >= 3) break
    if (rank < 9999) selected.push(def)
  }
  for (const key of fallback) {
    if (selected.length >= 3) break
    const def = defs.find(d => d.key === key)
    if (def && !selected.find(s => s.key === key)) selected.push(def)
  }

  // Return in the natural defs order so layout is consistent
  const keys = new Set(selected.map(d => d.key))
  return defs.filter(d => keys.has(d.key)).slice(0, 3)
}

export function FeaturedMiniCard({
  entry, teamId, hitLeaders, pitLeaders, onClick,
}: {
  entry: TeamPlayerStat & { isPitcher: boolean }
  teamId: number
  hitLeaders: Map<string, number[]>
  pitLeaders: Map<string, number[]>
  onClick: () => void
}) {
  const isStarter = entry.isPitcher && entry.gamesStarted >= 3
  const isCloser  = entry.isPitcher && !isStarter && entry.saves >= 3

  // Derive a clean position label from stats when the API gives a generic 'P'
  const posLabel = entry.isPitcher
    ? (isStarter ? 'SP' : isCloser ? 'CL' : 'RP')
    : entry.position

  const defs    = entry.isPitcher ? PITCHING_STAT_DEFS : HITTING_STAT_DEFS
  const leaders = entry.isPitcher ? pitLeaders : hitLeaders
  const statDefs = pickMiniStats(entry.playerId, entry.isPitcher, isCloser, defs, leaders)

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
      {/* Thin team-color accent bar */}
      <Box sx={{ width: '100%', height: 3, bgcolor: teamColor, flexShrink: 0 }} />

      <Box sx={{ px: 1.25, pt: 1.5, pb: 1.5, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* Headshot — portrait rectangle so the full face fits */}
        <Box sx={{
          width: 64, height: 78, borderRadius: 2, overflow: 'hidden',
          border: `2px solid ${teamColor}`, bgcolor: 'action.hover',
          flexShrink: 0, mb: 1, mx: 'auto',
        }}>
          <Box
            component="img"
            src={HEADSHOT(entry.playerId)}
            alt={entry.playerName}
            sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 15%', display: 'block' }}
          />
        </Box>

        {/* Full name — wraps to 2 lines for long names */}
        <Typography sx={{
          fontWeight: 700, fontSize: '0.76rem', lineHeight: 1.25,
          textAlign: 'center', mb: 0.25, px: 0.5,
          display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {entry.playerName}
        </Typography>

        {/* Position badge */}
        <Box sx={{
          display: 'inline-flex', px: 0.75, height: 16, borderRadius: 1,
          alignItems: 'center', justifyContent: 'center',
          bgcolor: `${teamColor}22`, mb: 1.5,
        }}>
          <Typography sx={{ fontSize: '0.56rem', fontWeight: 800, color: teamColor, letterSpacing: 0.5 }}>
            {posLabel}
          </Typography>
        </Box>

        {/* Stat columns */}
        <Box sx={{ display: 'flex', width: '100%' }}>
          {statDefs.map((def, i) => {
            const value = def.format(def.getValue(entry.stat))
            const ids   = def.leaderCategory ? (leaders.get(def.leaderCategory) ?? []) : []
            const rank  = ids.indexOf(entry.playerId)
            const isElite = rank !== -1 && rank < 5
            return (
              <Box key={def.key} sx={{
                flex: 1, textAlign: 'center',
                borderLeft: i > 0 ? '1px solid' : 'none',
                borderColor: 'divider',
                px: 0.25,
              }}>
                <Typography sx={{
                  fontSize: '0.52rem', fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: 0.6, color: 'text.disabled', lineHeight: 1, mb: 0.4,
                }}>
                  {def.label}
                </Typography>
                <Typography sx={{
                  fontSize: '0.95rem', fontWeight: 800, lineHeight: 1,
                  color: isElite ? ACCENT : 'text.primary',
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

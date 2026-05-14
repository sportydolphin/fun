import React, { useState } from 'react'
import { Box, Typography } from '@mui/material'
import { Popover } from '@mui/material'
import { KeyboardArrowDown } from '@mui/icons-material'
import { RankMode, Palette, StatDef, Player, Team } from './types'
import { ACCENT, HITTING_STAT_DEFS, PITCHING_STAT_DEFS, TEAM_HITTING_DEFS, TEAM_PITCHING_DEFS, HEADSHOT } from './constants'
import { statCols } from './utils'

// ─── UI primitives ────────────────────────────────────────────────────────────

export function SegControl({ options, value, onChange }: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <Box sx={{
      display: 'inline-flex',
      bgcolor: 'action.hover',
      borderRadius: 999,
      p: '3px',
      gap: 0,
    }}>
      {options.map(opt => (
        <Box
          key={opt.value}
          onClick={() => onChange(opt.value)}
          sx={{
            px: 1.75, py: 0.5,
            borderRadius: 999,
            cursor: 'pointer',
            fontSize: '0.75rem',
            fontWeight: 600,
            lineHeight: 1.4,
            transition: 'all 0.15s',
            userSelect: 'none',
            bgcolor: value === opt.value ? ACCENT : 'transparent',
            color: value === opt.value ? '#fff' : 'text.secondary',
            '&:hover': value !== opt.value ? { color: 'text.primary' } : {},
          }}
        >
          {opt.label}
        </Box>
      ))}
    </Box>
  )
}

export function PillChip({ label, selected, onChange }: {
  label: string; selected: boolean; onChange: () => void
}) {
  return (
    <Box
      onClick={onChange}
      sx={{
        px: 1.75, py: 0.45,
        borderRadius: 999,
        border: '1.5px solid',
        borderColor: selected ? ACCENT : 'divider',
        bgcolor: selected ? `${ACCENT}20` : 'transparent',
        color: selected ? ACCENT : 'text.secondary',
        fontSize: '0.75rem',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.15s',
        userSelect: 'none',
        '&:hover': !selected ? { borderColor: ACCENT, color: ACCENT } : {},
      }}
    >
      {label}
    </Box>
  )
}

// Shared pill button style for action row
export const pillActionSx = {
  display: 'inline-flex', alignItems: 'center', gap: 0.6,
  px: 2, py: 0.75,
  borderRadius: 999,
  border: '1.5px solid',
  borderColor: 'divider',
  cursor: 'pointer',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: 'text.secondary',
  transition: 'all 0.15s',
  userSelect: 'none' as const,
  '&:hover': { borderColor: ACCENT, color: ACCENT },
}

// Shared style for external link pills in the options bar
export const linkPillSx = {
  display: 'inline-flex', alignItems: 'center',
  px: 1.75, py: 0.45,
  borderRadius: 999,
  border: '1.5px solid',
  borderColor: 'divider',
  color: 'text.secondary',
  fontSize: '0.75rem',
  fontWeight: 600,
  textDecoration: 'none',
  transition: 'all 0.15s',
  '&:hover': { borderColor: ACCENT, color: ACCENT },
}

// ─── Stat item ───────────────────────────────────────────────────────────────

export interface StatItemProps {
  label: string
  value: string
  playerId: number
  leaderCategory: string
  leaders: Map<string, number[]>
  palette: Palette
  rankMode: RankMode
  large?: boolean
  poop?: boolean
}

export function StatItem({ label, value, playerId, leaderCategory, leaders, palette, rankMode, large, poop }: StatItemProps) {
  const ids = leaderCategory ? (leaders.get(leaderCategory) ?? []) : []
  const rank = ids.indexOf(playerId)
  const inTop5 = rank !== -1 && rank < 5
  const bottomN = ids.length > 0 && ids.length <= 30 ? 5 : 20
  const inBottom = rank !== -1 && ids.length > 0 && rank >= ids.length - bottomN

  let badge = ''
  if (rankMode !== 'none' && rank !== -1) {
    const showBadge = rankMode === 'all' || (rankMode === 'top5' && (inTop5 || inBottom))
    if (showBadge) {
      if (inTop5) badge = `${poop ? '💩' : '🔥'} #${rank + 1}`
      else if (inBottom) badge = `${poop ? '🔥' : '💩'} #${rank + 1}`
      else badge = `#${rank + 1}`
    }
  }

  return (
    <Box sx={{ textAlign: 'center' }}>
      <Typography sx={{
        color: palette.text, fontWeight: 800,
        fontSize: large ? { xs: '0.8rem', sm: '0.9rem' } : { xs: '0.7rem', sm: '0.8rem' },
        textTransform: 'uppercase', letterSpacing: 1.5, opacity: 0.7, mb: 0.4,
      }}>
        {label}
      </Typography>
      <Typography sx={{
        color: palette.text, fontWeight: 700,
        fontSize: large ? { xs: '2rem', sm: '2.4rem' } : { xs: '1.75rem', sm: '2.1rem' },
        lineHeight: 1, letterSpacing: '-0.5px',
      }}>
        {value}
      </Typography>
      <Typography sx={{ color: palette.rank, fontSize: '0.63rem', fontWeight: 700, mt: 0.4, height: '1rem', letterSpacing: 0.5 }}>
        {badge}
      </Typography>
    </Box>
  )
}

// ─── Stat picker ─────────────────────────────────────────────────────────────

export interface StatPickerProps {
  defs: StatDef[]
  selected: string[]
  onToggle: (key: string) => void
  label: string
}

export function StatPicker({ defs, selected, onToggle, label }: StatPickerProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <Box
        onClick={e => setAnchor(e.currentTarget as HTMLElement)}
        sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.4,
          px: 1.75, py: 0.5,
          borderRadius: 999,
          border: '1.5px solid',
          borderColor: anchor ? ACCENT : 'divider',
          cursor: 'pointer',
          fontSize: '0.75rem',
          fontWeight: 600,
          color: anchor ? ACCENT : 'text.secondary',
          transition: 'all 0.15s',
          userSelect: 'none',
          '&:hover': { borderColor: ACCENT, color: ACCENT },
        }}
      >
        {label}
        <KeyboardArrowDown sx={{ fontSize: '0.9rem', mt: '1px' }} />
      </Box>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        PaperProps={{ sx: { borderRadius: 2.5, p: 1.5, mt: 0.75, maxWidth: 210, boxShadow: '0 8px 32px rgba(0,0,0,0.14)' } }}
      >
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {defs.map(def => (
            <PillChip
              key={def.key}
              label={def.label}
              selected={selected.includes(def.key)}
              onChange={() => onToggle(def.key)}
            />
          ))}
        </Box>
      </Popover>
    </>
  )
}

// ─── Stat grid (shared) ───────────────────────────────────────────────────────

export interface StatGridProps {
  defs: StatDef[]
  stats: any
  selected: string[]
  palette: Palette
  rankMode: RankMode
  playerId: number
  leaders: Map<string, number[]>
  season: number
  label: string
  large?: boolean
  onToggle?: (key: string) => void
  mt?: number
}

export function StatGrid({ defs, stats, selected, palette, rankMode, playerId, leaders, season, label, large, onToggle, mt }: StatGridProps) {
  const visible = defs.filter(d => selected.includes(d.key))
  if (!stats || visible.length === 0) return null
  const cols = statCols(visible.length)
  return (
    <Box sx={{ borderTop: `1px solid ${palette.divider}`, pt: 2.5, mt: mt ?? 0 }}>
      <Typography sx={{ textAlign: 'center', color: palette.rank, fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2.5, mb: 2 }}>
        {season} {label}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
        {visible.map(def => (
          <Box
            key={def.key}
            onClick={() => onToggle?.(def.key)}
            sx={{
              width: `${100 / cols}%`, pb: 2,
              cursor: onToggle ? 'pointer' : 'default',
              transition: 'opacity 0.15s',
              '&:hover': onToggle ? { opacity: 0.6 } : {},
            }}
          >
            <StatItem
              label={def.label}
              value={def.format(def.getValue(stats))}
              playerId={playerId}
              leaderCategory={def.leaderCategory}
              leaders={leaders}
              palette={palette}
              rankMode={rankMode}
              large={large}
              poop={def.poop}
            />
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// ─── Player card inner ────────────────────────────────────────────────────────

export interface CardInnerProps {
  player: Player
  hittingStats: any
  pitchingStats: any
  hitLeaders: Map<string, number[]>
  pitLeaders: Map<string, number[]>
  palette: Palette
  season: number
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
}

export function TeamCardInner({ team, hittingStats, pitchingStats, palette, season, rankMode, hitLeaders, pitLeaders, large, selectedHitStats, selectedPitStats, onToggleHitStat, onTogglePitStat }: TeamCardInnerProps) {
  const logoSize = large ? 160 : 120

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

  return (
    <>
      {/* Team logo */}
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2.5 }}>
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
      </Box>

      <Typography sx={{
        textAlign: 'center', color: palette.text, fontWeight: 800,
        fontSize: large ? { xs: '1.8rem', sm: '2.2rem' } : { xs: '1.4rem', sm: '1.8rem' },
        lineHeight: 1.1, letterSpacing: '-0.3px', mb: 0.5,
      }}>
        {team.name}
      </Typography>

      {subtitle && (
        <Typography sx={{
          textAlign: 'center', color: palette.sub,
          fontSize: large ? '1rem' : '0.85rem',
          fontWeight: 500, mb: 2.5,
        }}>
          {subtitle}
        </Typography>
      )}

      {/* Record */}
      {wins != null && losses != null && (
        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 4, mb: 2.5 }}>
          {[['W', wins], ['L', losses], ...(pct ? [['PCT', pct]] : [])].map(([lbl, val]) => (
            <Box key={lbl as string} sx={{ textAlign: 'center' }}>
              <Typography sx={{ color: palette.rank, fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2, mb: 0.5 }}>
                {lbl}
              </Typography>
              <Typography sx={{ color: palette.text, fontWeight: 800, fontSize: large ? '2.2rem' : '1.8rem', lineHeight: 1 }}>
                {val}
              </Typography>
            </Box>
          ))}
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

// ─── Section label ────────────────────────────────────────────────────────────

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{ fontSize: '0.63rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.8, color: 'text.disabled', mb: 1 }}>
      {children}
    </Typography>
  )
}

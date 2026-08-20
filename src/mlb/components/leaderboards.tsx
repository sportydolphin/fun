import React, { useState } from 'react'
import { Box, Typography, Tooltip, CircularProgress, IconButton } from '@mui/material'
import { OpenInFull, Close } from '@mui/icons-material'
import { InfoTip } from './ui'
import { ACCENT, TEAM_BG, HEADSHOT } from '../constants'
import { useIsDark, ringColor, teamLogoBg, teamLogoSrc, teamLogoCrop, defaultBorder, photoBorderAlpha } from '../lib/colorUtils'
import { useScrollLock } from '../lib/useScrollLock'

// ─── Leaderboard row model — shared by every Report Card board ───────────────

export interface LbRow {
  teamId: number
  abbr: string
  name: string
  sub?: string
  value: string
  barFraction: number   // 0..1
  label?: string        // snarky verdict — only shown in the 3-row mini card
}

export interface Board {
  id: string
  icon: string
  title: string
  subtitle: string
  accent: string
  tooltipText?: string
  rows: LbRow[]
  loading: boolean
}

export function TeamLogo({ teamId, abbr, size = 36, accent, highlighted }: {
  teamId: number; abbr: string; size?: number; accent?: string; highlighted?: boolean
}) {
  const [failed, setFailed] = useState(false)
  const isDark = useIsDark()
  const ring = ringColor(teamId, isDark)
  return (
    <Box sx={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      bgcolor: failed ? ring : teamLogoBg(teamId, isDark),
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      boxShadow: highlighted && accent ? `0 0 0 2.5px ${accent}` : `0 0 0 1px ${ring}30`,
    }}>
      {failed ? (
        <Typography sx={{ color: '#fff', fontWeight: 900, fontSize: abbr.length > 2 ? '0.48rem' : '0.6rem', lineHeight: 1 }}>
          {abbr}
        </Typography>
      ) : (
        <Box
          component="img"
          src={teamLogoSrc(teamId, isDark)}
          alt={abbr}
          crossOrigin="anonymous"
          onError={() => setFailed(true)}
          sx={{ width: '78%', height: '78%', objectFit: 'contain', display: 'block', transform: teamLogoCrop(teamId, isDark), transformOrigin: 'center' }}
        />
      )}
    </Box>
  )
}

export function LeaderboardRowItem({ row, rank, accent, showLabel, onSelect }: {
  row: LbRow; rank: number; accent: string; showLabel: boolean; onSelect?: (id: number) => void
}) {
  return (
    <Box
      onClick={onSelect ? () => onSelect(row.teamId) : undefined}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25,
        py: 0.9, px: 0.75, borderRadius: 2,
        ...(onSelect ? { cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } } : {}),
        transition: 'background-color 0.15s',
      }}
    >
      <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', fontWeight: 700, width: 16, textAlign: 'right', flexShrink: 0 }}>
        {rank}
      </Typography>

      <TeamLogo teamId={row.teamId} abbr={row.abbr} accent={accent} />

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {row.name}
        </Typography>
        {row.sub && (
          <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', fontWeight: 500, mt: 0.1 }}>
            {row.sub}
          </Typography>
        )}
      </Box>

      <Box sx={{ width: 124, flexShrink: 0 }}>
        <Box sx={{ height: 7, bgcolor: 'action.hover', borderRadius: 1, overflow: 'hidden', mb: 0.5 }}>
          <Box sx={{ height: '100%', width: `${Math.max(row.barFraction, 0) * 100}%`, bgcolor: accent, borderRadius: 1, opacity: 0.85, transition: 'width 0.3s' }} />
        </Box>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: accent, textAlign: 'right', lineHeight: 1 }}>
          {row.value}
        </Typography>
      </Box>

      {showLabel && (
        <Typography sx={{
          fontSize: '0.54rem', fontWeight: 800, color: accent,
          width: 54, flexShrink: 0, textAlign: 'right',
          letterSpacing: '0.3px', lineHeight: 1.25,
          textTransform: 'uppercase',
        }}>
          {row.label ?? ''}
        </Typography>
      )}
    </Box>
  )
}

// ─── Mini card — top 3 rows + snarky labels ───────────────────────────────────

export function LeaderboardCard({ icon, title, subtitle, accent, tooltipText, rows, loading, onExpand, onSelectTeam, expandLabel }: Omit<Board, 'id'> & {
  onExpand: () => void
  onSelectTeam?: (id: number) => void
  expandLabel?: string   // when set, renders a "View All →"-style pill instead of the fullscreen icon
}) {
  const top3 = rows.slice(0, 3)
  const isDark = useIsDark()
  return (
    <Box sx={{ borderRadius: 2, border: '1px solid', borderColor: defaultBorder(isDark), bgcolor: 'background.paper', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>{icon} {title}</Typography>
            {tooltipText && (
              <InfoTip text={
                <>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5 }}>What this shows</Typography>
                  <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>{tooltipText}</Typography>
                </>
              } />
            )}
          </Box>
          <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', mt: 0.1 }}>{subtitle}</Typography>
        </Box>
        {expandLabel ? (
          <Box
            onClick={onExpand}
            sx={{
              px: 1, py: '3px', borderRadius: 999, flexShrink: 0,
              bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider',
              cursor: 'pointer', transition: 'border-color 0.12s',
              '&:hover': { borderColor: 'text.secondary' },
            }}
          >
            <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, color: 'text.secondary', letterSpacing: 0.3, lineHeight: 1 }}>
              {expandLabel}
            </Typography>
          </Box>
        ) : (
          <Tooltip title="View all teams" arrow placement="top">
            <IconButton size="small" aria-label="Expand" onClick={onExpand} sx={{ color: 'text.disabled', '&:hover': { color: ACCENT } }}>
              <OpenInFull sx={{ fontSize: '1rem' }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Rows */}
      <Box sx={{ px: 0.5, py: 0.5 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={22} sx={{ color: ACCENT }} />
          </Box>
        ) : (
          top3.map((row, idx) => (
            <LeaderboardRowItem key={row.teamId} row={row} rank={idx + 1} accent={accent} showLabel onSelect={onSelectTeam} />
          ))
        )}
      </Box>

    </Box>
  )
}

// ─── Fullscreen modal — full scrollable ranking, no snarky labels ─────────────

export function LeaderboardModal({ open, onClose, icon, title, subtitle, accent, rows, onSelectTeam }: {
  open: boolean
  onClose: () => void
  icon?: string
  title?: string
  subtitle?: string
  accent?: string
  rows: LbRow[]
  onSelectTeam?: (id: number) => void
}) {
  // Lock background scroll while a board is fullscreened
  useScrollLock(open)

  if (!open) return null
  return (
    <Box
      sx={{
        position: 'fixed', inset: 0, zIndex: 1300,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        bgcolor: 'rgba(0,0,0,0.55)', p: 2,
      }}
      onClick={onClose}
    >
      <Box
        sx={{
          bgcolor: 'background.paper',
          borderRadius: 3,
          width: '100%',
          maxWidth: 540,
          // `100%` of the padded fixed overlay (not `vh`) so the card stays on-screen
          // under the desktop `zoom` wrapper, which doesn't shrink viewport units.
          maxHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <Box sx={{
          px: 2.5, py: 1.75,
          borderBottom: '1px solid', borderColor: 'divider',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>{icon} {title}</Typography>
            {subtitle && (
              <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', mt: 0.1 }}>{subtitle}</Typography>
            )}
          </Box>
          <IconButton size="small" aria-label="Close" onClick={onClose} sx={{ ml: 1, color: 'text.secondary', '&:hover': { color: 'text.primary' } }}>
            <Close sx={{ fontSize: '1.1rem' }} />
          </IconButton>
        </Box>
        {/* Scrollable body — all teams, no verdict labels */}
        <Box sx={{ overflowY: 'auto', p: 1.5 }}>
          {rows.map((row, idx) => (
            <LeaderboardRowItem key={row.teamId} row={row} rank={idx + 1} accent={accent ?? ACCENT} showLabel={false} onSelect={onSelectTeam} />
          ))}
        </Box>
      </Box>
    </Box>
  )
}

// ─── Player report cards — headshot rows for the active-streak boards ─────────

export interface PlayerLbRow {
  playerId: number
  playerName: string
  teamId: number
  teamAbbr: string
  value: string
  barFraction: number   // 0..1
  label?: string        // snarky verdict — only shown in the 3-row mini card
}

export interface PlayerBoard {
  id: string
  icon: string
  title: string
  subtitle: string
  accent: string
  tooltipText?: string
  rows: PlayerLbRow[]
  loading: boolean
}

export function PlayerHeadshot({ playerId, name, size = 36, accent, highlighted, variant = 'circle', teamId }: {
  playerId: number; name: string; size?: number; accent?: string; highlighted?: boolean
  variant?: 'circle' | 'portrait'; teamId?: number
}) {
  const isDark = useIsDark()

  // Cropped rounded-rectangle portrait, matching the home-screen player cards
  // (TopPerformers / Spotlight): the face framed near the top rather than a tight
  // circle that clips the head, inside a team-colored border.
  if (variant === 'portrait') {
    const border = teamId ? photoBorderAlpha(TEAM_BG[teamId] ?? '#888', isDark) : 'rgba(128,128,128,0.3)'
    return (
      <Box sx={{
        flexShrink: 0, width: size, height: Math.round(size * 70 / 58),
        borderRadius: 1.5, overflow: 'hidden',
        border: `2px solid ${border}`, bgcolor: 'action.hover',
      }}>
        <Box
          component="img"
          src={HEADSHOT(playerId)}
          alt={name}
          sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%', display: 'block' }}
        />
      </Box>
    )
  }

  return (
    <Box
      component="img"
      src={HEADSHOT(playerId)}
      alt={name}
      sx={{
        width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
        bgcolor: 'action.hover',
        boxShadow: highlighted && accent ? `0 0 0 2.5px ${accent}` : '0 0 0 1px rgba(128,128,128,0.25)',
      }}
    />
  )
}

export function PlayerLeaderboardRowItem({ row, rank, accent, showLabel, onSelect }: {
  row: PlayerLbRow; rank: number; accent: string; showLabel: boolean; onSelect?: (id: number) => void
}) {
  const isDark = useIsDark()
  return (
    <Box
      onClick={onSelect ? () => onSelect(row.playerId) : undefined}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25,
        py: 0.9, px: 0.75, borderRadius: 2,
        ...(onSelect ? { cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } } : {}),
        transition: 'background-color 0.15s',
      }}
    >
      <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', fontWeight: 700, width: 16, textAlign: 'right', flexShrink: 0 }}>
        {rank}
      </Typography>

      <PlayerHeadshot playerId={row.playerId} name={row.playerName} variant="portrait" teamId={row.teamId} />

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {row.playerName}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.15 }}>
          {row.teamId > 0 && (
            <Box sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: teamLogoBg(row.teamId, isDark), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
              <Box
                component="img"
                src={teamLogoSrc(row.teamId, isDark)}
                alt={row.teamAbbr}
                sx={{ width: 11, height: 11, objectFit: 'contain', transform: teamLogoCrop(row.teamId, isDark), transformOrigin: 'center' }}
                onError={(ev: React.SyntheticEvent<HTMLImageElement>) => { ev.currentTarget.parentElement!.style.display = 'none' }}
              />
            </Box>
          )}
          <Typography sx={{ fontSize: '0.62rem', color: 'text.secondary', fontWeight: 600, lineHeight: 1 }}>
            {row.teamAbbr}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ width: 124, flexShrink: 0 }}>
        <Box sx={{ height: 7, bgcolor: 'action.hover', borderRadius: 1, overflow: 'hidden', mb: 0.5 }}>
          <Box sx={{ height: '100%', width: `${Math.max(row.barFraction, 0) * 100}%`, bgcolor: accent, borderRadius: 1, opacity: 0.85, transition: 'width 0.3s' }} />
        </Box>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: accent, textAlign: 'right', lineHeight: 1 }}>
          {row.value}
        </Typography>
      </Box>

      {showLabel && (
        <Typography sx={{
          fontSize: '0.54rem', fontWeight: 800, color: accent,
          width: 54, flexShrink: 0, textAlign: 'right',
          letterSpacing: '0.3px', lineHeight: 1.25,
          textTransform: 'uppercase',
        }}>
          {row.label ?? ''}
        </Typography>
      )}
    </Box>
  )
}

export function PlayerLeaderboardCard({ icon, title, subtitle, accent, tooltipText, rows, loading, onExpand, onSelectPlayer }: Omit<PlayerBoard, 'id'> & {
  onExpand: () => void
  onSelectPlayer?: (id: number) => void
}) {
  const top3 = rows.slice(0, 3)
  const isDark = useIsDark()
  return (
    <Box sx={{ borderRadius: 2, border: '1px solid', borderColor: defaultBorder(isDark), bgcolor: 'background.paper', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>{icon} {title}</Typography>
            {tooltipText && (
              <InfoTip text={
                <>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5 }}>What this shows</Typography>
                  <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>{tooltipText}</Typography>
                </>
              } />
            )}
          </Box>
          <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', mt: 0.1 }}>{subtitle}</Typography>
        </Box>
        <Tooltip title="View all players" arrow placement="top">
          <IconButton size="small" aria-label="Expand" onClick={onExpand} sx={{ color: 'text.disabled', '&:hover': { color: ACCENT } }}>
            <OpenInFull sx={{ fontSize: '1rem' }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Rows */}
      <Box sx={{ px: 0.5, py: 0.5 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={22} sx={{ color: ACCENT }} />
          </Box>
        ) : top3.length === 0 ? (
          <Typography sx={{ textAlign: 'center', py: 2.5, fontSize: '0.72rem', color: 'text.disabled' }}>
            No active streaks
          </Typography>
        ) : (
          top3.map((row, idx) => (
            <PlayerLeaderboardRowItem key={row.playerId} row={row} rank={idx + 1} accent={accent} showLabel onSelect={onSelectPlayer} />
          ))
        )}
      </Box>
    </Box>
  )
}

export function PlayerLeaderboardModal({ open, onClose, icon, title, subtitle, accent, rows, onSelectPlayer }: {
  open: boolean
  onClose: () => void
  icon?: string
  title?: string
  subtitle?: string
  accent?: string
  rows: PlayerLbRow[]
  onSelectPlayer?: (id: number) => void
}) {
  useScrollLock(open)

  if (!open) return null
  return (
    <Box
      sx={{ position: 'fixed', inset: 0, zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(0,0,0,0.55)', p: 2 }}
      onClick={onClose}
    >
      <Box
        sx={{
          bgcolor: 'background.paper', borderRadius: 3, width: '100%', maxWidth: 540,
          maxHeight: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <Box sx={{ px: 2.5, py: 1.75, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>{icon} {title}</Typography>
            {subtitle && <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', mt: 0.1 }}>{subtitle}</Typography>}
          </Box>
          <IconButton size="small" aria-label="Close" onClick={onClose} sx={{ ml: 1, color: 'text.secondary', '&:hover': { color: 'text.primary' } }}>
            <Close sx={{ fontSize: '1.1rem' }} />
          </IconButton>
        </Box>
        <Box sx={{ overflowY: 'auto', p: 1.5 }}>
          {rows.map((row, idx) => (
            <PlayerLeaderboardRowItem key={row.playerId} row={row} rank={idx + 1} accent={accent ?? ACCENT} showLabel={false} onSelect={onSelectPlayer} />
          ))}
        </Box>
      </Box>
    </Box>
  )
}

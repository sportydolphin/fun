import React, { useState, useEffect } from 'react'
import { Box, Typography, IconButton, CircularProgress } from '@mui/material'
import { Close, KeyboardArrowDown } from '@mui/icons-material'
import { fetchRosterMoves, RosterMove } from '../api'
import { CURRENT_SEASON, ACCENT, TEAM_ABBR } from '../constants'
import { useIsDark, defaultBorder, ringColor } from '../colorUtils'
import { TeamLogo, PlayerHeadshot } from './VizView'
import { getHomeOverlay, clearOverlayIf, stampOverlay } from '../homeOverlay'

// ─── Roster Moves — trades, DFAs, claims, signings from the transactions feed ─
//
// Home "Around the League" card showing the last two weeks of notable roster
// moves (fetchRosterMoves filters the churn), with a trade-deadline countdown
// through July. "View All →" opens the full list grouped by day.

const MOVE_STYLE: Record<string, { label: string; color: string }> = {
  TR:  { label: 'Trade',     color: '#f97316' },
  CLW: { label: 'Claimed',   color: '#818cf8' },
  DES: { label: 'DFA',       color: '#94a3b8' },
  REL: { label: 'Released',  color: '#94a3b8' },
  SFA: { label: 'Signed',    color: '#22c55e' },
  SU:  { label: 'Suspended', color: '#ef4444' },
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtMoveDate(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number)
  return m && d ? `${MONTHS[m - 1]} ${d}` : ymd
}

function fmtMoveDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  const weekday = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long' })
  return `${weekday} · ${MONTHS[m - 1]} ${d}`
}

// Countdown chip through July: null outside the 30 days before the deadline.
function deadlineInfo(): { label: string; hot: boolean } | null {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const deadline = new Date(CURRENT_SEASON, 6, 31)  // Jul 31
  const days = Math.round((deadline.getTime() - today.getTime()) / 86400000)
  if (days < 0 || days > 30) return null
  return { label: days === 0 ? 'DEADLINE TODAY' : `Deadline in ${days}d`, hot: days <= 3 }
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function MoveRowItem({ move, showDescription, onPlayerClick, onTeamClick }: {
  move: RosterMove
  showDescription?: boolean
  onPlayerClick?: (id: number) => void
  onTeamClick?:   (id: number) => void
}) {
  const style = MOVE_STYLE[move.typeCode] ?? { label: move.typeDesc, color: '#94a3b8' }
  const teamClick = (id: number) => (e: React.MouseEvent) => {
    if (!onTeamClick) return
    e.stopPropagation()
    onTeamClick(id)
  }
  return (
    <Box
      onClick={onPlayerClick ? () => onPlayerClick(move.playerId) : undefined}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25,
        py: 0.9, px: 0.75, borderRadius: 2,
        ...(onPlayerClick ? { cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } } : {}),
        transition: 'background-color 0.15s',
      }}
    >
      <PlayerHeadshot playerId={move.playerId} name={move.playerName} size={34} />

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {move.playerName}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mt: 0.2 }}>
          <Box component="span" sx={{
            px: 0.6, py: '1px', borderRadius: 999, flexShrink: 0,
            bgcolor: `${style.color}1c`, border: `1px solid ${style.color}55`,
            fontSize: '0.55rem', fontWeight: 800, color: style.color,
            letterSpacing: 0.4, textTransform: 'uppercase', lineHeight: 1.4,
          }}>
            {style.label}
          </Box>
          <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', fontWeight: 600, whiteSpace: 'nowrap' }}>
            {fmtMoveDate(move.date)}
          </Typography>
        </Box>
        {showDescription && move.description && (
          <Typography sx={{
            fontSize: '0.66rem', color: 'text.secondary', mt: 0.35, lineHeight: 1.35,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {move.description}
          </Typography>
        )}
      </Box>

      {/* Team(s): from → to for trades/claims, single club otherwise */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
        {move.fromTeamId != null && (
          <Box onClick={teamClick(move.fromTeamId)} sx={onTeamClick ? { cursor: 'pointer' } : undefined}>
            <TeamLogo teamId={move.fromTeamId} abbr="" size={24} />
          </Box>
        )}
        {move.fromTeamId != null && move.toTeamId != null && (
          <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled', fontWeight: 700, lineHeight: 1 }}>→</Typography>
        )}
        {move.toTeamId != null && (
          <Box onClick={teamClick(move.toTeamId)} sx={onTeamClick ? { cursor: 'pointer' } : undefined}>
            <TeamLogo teamId={move.toTeamId} abbr="" size={24} />
          </Box>
        )}
      </Box>
    </Box>
  )
}

// ─── Fullscreen modal — every move in the window, grouped by day ──────────────

function RosterMovesModal({ open, onClose, moves, onPlayerClick, onTeamClick }: {
  open: boolean
  onClose: () => void
  moves: RosterMove[]
  onPlayerClick?: (id: number) => void
  onTeamClick?:   (id: number) => void
}) {
  const isDark = useIsDark()
  // Filter to one club (null = all) and per-day collapse. Both survive close/
  // reopen within a visit — the selected chip and chevrons make the state visible.
  const [filterTeam, setFilterTeam]       = useState<number | null>(null)
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set())

  // Lock background scroll while fullscreened (same pattern as LeaderboardModal)
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  if (!open) return null

  // Cross-links leave Home, which unmounts this modal — stamp the overlay so
  // the Back button can reopen it.
  const stampedPlayer = onPlayerClick ? stampOverlay({ kind: 'rosterMoves' }, onPlayerClick) : undefined
  const stampedTeam   = onTeamClick   ? stampOverlay({ kind: 'rosterMoves' }, onTeamClick)   : undefined

  // Every club appearing in the window, alphabetical by abbreviation
  const teamIdSet = new Set<number>()
  for (const m of moves) {
    if (m.fromTeamId != null) teamIdSet.add(m.fromTeamId)
    if (m.toTeamId   != null) teamIdSet.add(m.toTeamId)
  }
  const filterTeams = [...teamIdSet].sort((a, b) => (TEAM_ABBR[a] ?? '').localeCompare(TEAM_ABBR[b] ?? ''))

  const shown = filterTeam == null
    ? moves
    : moves.filter(m => m.fromTeamId === filterTeam || m.toTeamId === filterTeam)

  const byDay: Array<{ day: string; items: RosterMove[] }> = []
  for (const m of shown) {
    const last = byDay[byDay.length - 1]
    if (last && last.day === m.date) last.items.push(m)
    else byDay.push({ day: m.date, items: [m] })
  }

  const toggleDay = (day: string) => setCollapsedDays(prev => {
    const next = new Set(prev)
    if (next.has(day)) next.delete(day)
    else next.add(day)
    return next
  })

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
        <Box sx={{
          px: 2.5, py: 1.75,
          borderBottom: '1px solid', borderColor: 'divider',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>🔄 Roster Moves</Typography>
            <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', mt: 0.1 }}>
              Trades, DFAs, claims and signings · last 14 days
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose} sx={{ ml: 1, color: 'text.secondary', '&:hover': { color: 'text.primary' } }}>
            <Close sx={{ fontSize: '1.1rem' }} />
          </IconButton>
        </Box>

        {/* Team filter — every club in the window; tap to isolate, tap again to clear */}
        {filterTeams.length > 0 && (
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 0.75,
            px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider',
            overflowX: 'auto', flexShrink: 0,
            scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' },
          }}>
            <Box
              onClick={() => setFilterTeam(null)}
              sx={{
                px: 1, py: '5px', borderRadius: 999, flexShrink: 0, cursor: 'pointer',
                border: '1px solid',
                borderColor: filterTeam == null ? 'text.secondary' : 'divider',
                bgcolor: filterTeam == null ? 'action.selected' : 'transparent',
                transition: 'border-color 0.12s, background-color 0.12s',
              }}
            >
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, lineHeight: 1, color: filterTeam == null ? 'text.primary' : 'text.secondary' }}>
                All
              </Typography>
            </Box>
            {filterTeams.map(id => (
              <Box
                key={id}
                onClick={() => setFilterTeam(filterTeam === id ? null : id)}
                sx={{
                  flexShrink: 0, cursor: 'pointer', borderRadius: '50%',
                  opacity: filterTeam == null || filterTeam === id ? 1 : 0.35,
                  transition: 'opacity 0.15s',
                }}
              >
                <TeamLogo teamId={id} abbr={TEAM_ABBR[id] ?? '?'} size={26} accent={ringColor(id, isDark)} highlighted={filterTeam === id} />
              </Box>
            ))}
          </Box>
        )}

        <Box sx={{ overflowY: 'auto', p: 1.5 }}>
          {byDay.map(group => {
            const collapsed = collapsedDays.has(group.day)
            return (
              <Box key={group.day} sx={{ mb: 1 }}>
                <Box
                  onClick={() => toggleDay(group.day)}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 0.4,
                    px: 0.75, pt: 0.75, pb: 0.25,
                    cursor: 'pointer', userSelect: 'none', borderRadius: 1,
                    '&:hover .day-label': { color: 'text.secondary' },
                  }}
                >
                  <KeyboardArrowDown sx={{
                    fontSize: '0.95rem', color: 'text.disabled',
                    transform: collapsed ? 'rotate(-90deg)' : 'none',
                    transition: 'transform 0.15s',
                  }} />
                  <Typography className="day-label" sx={{
                    fontSize: '0.6rem', fontWeight: 800, color: 'text.disabled',
                    textTransform: 'uppercase', letterSpacing: 1,
                    transition: 'color 0.12s',
                  }}>
                    {fmtMoveDay(group.day)}
                  </Typography>
                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: 'text.disabled', ml: 'auto', pr: 0.5 }}>
                    {group.items.length} {group.items.length === 1 ? 'move' : 'moves'}
                  </Typography>
                </Box>
                {!collapsed && group.items.map(m => (
                  <MoveRowItem key={m.id} move={m} showDescription onPlayerClick={stampedPlayer} onTeamClick={stampedTeam} />
                ))}
              </Box>
            )
          })}
          {shown.length === 0 && (
            <Typography sx={{ fontSize: '0.75rem', color: 'text.disabled', textAlign: 'center', py: 4 }}>
              {filterTeam != null
                ? `No moves for the ${TEAM_ABBR[filterTeam] ?? ''} in the last two weeks.`
                : 'No notable moves in the last two weeks.'}
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export function RosterMovesCard({ onPlayerClick, onTeamClick }: {
  onPlayerClick?: (id: number) => void
  onTeamClick?:   (id: number) => void
}) {
  const isDark = useIsDark()
  const [moves, setMoves]     = useState<RosterMove[] | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    fetchRosterMoves().then(setMoves).catch(() => setMoves([]))
  }, [])

  // Back-from-Search restore: reopen the full list the user cross-linked from.
  useEffect(() => {
    if (getHomeOverlay()?.kind === 'rosterMoves') setShowAll(true)
  }, [])

  const deadline = deadlineInfo()
  const top = (moves ?? []).slice(0, 4)

  return (
    <Box sx={{ borderRadius: 2, border: '1px solid', borderColor: defaultBorder(isDark), bgcolor: 'background.paper', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>🔄 Roster Moves</Typography>
            {deadline && (
              <Box sx={{
                px: 0.75, py: '2px', borderRadius: 999, flexShrink: 0,
                bgcolor: deadline.hot ? '#ef44441c' : '#f973161c',
                border: `1px solid ${deadline.hot ? '#ef4444' : '#f97316'}55`,
              }}>
                <Typography sx={{
                  fontSize: '0.55rem', fontWeight: 800, letterSpacing: 0.4, lineHeight: 1.3,
                  color: deadline.hot ? '#ef4444' : '#f97316',
                }}>
                  ⏳ {deadline.label}
                </Typography>
              </Box>
            )}
          </Box>
          <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', mt: 0.1 }}>
            Trades, DFAs, claims and signings
          </Typography>
        </Box>
        <Box
          onClick={() => setShowAll(true)}
          sx={{
            px: 1, py: '3px', borderRadius: 999, flexShrink: 0,
            bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider',
            cursor: 'pointer', transition: 'border-color 0.12s',
            '&:hover': { borderColor: 'text.secondary' },
          }}
        >
          <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, color: 'text.secondary', letterSpacing: 0.3, lineHeight: 1 }}>
            View All →
          </Typography>
        </Box>
      </Box>

      {/* Rows */}
      <Box sx={{ px: 0.5, py: 0.5 }}>
        {moves === null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={22} sx={{ color: ACCENT }} />
          </Box>
        ) : top.length === 0 ? (
          <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', textAlign: 'center', py: 2.5 }}>
            No notable moves lately.
          </Typography>
        ) : (
          top.map(m => (
            <MoveRowItem key={m.id} move={m} onPlayerClick={onPlayerClick} onTeamClick={onTeamClick} />
          ))
        )}
      </Box>

      <RosterMovesModal
        open={showAll}
        onClose={() => { setShowAll(false); clearOverlayIf('rosterMoves') }}
        moves={moves ?? []}
        onPlayerClick={onPlayerClick}
        onTeamClick={onTeamClick}
      />
    </Box>
  )
}

import { useState, useEffect } from 'react'
import { Box, Typography } from '@mui/material'
import { DramaEvent, DramaKind, fetchLiveDrama, ord } from '../lib/liveDrama'
import { useDevDrama } from '../dev/devDrama'
import { TEAM_NICKNAME } from '../constants'
import { useIsDark } from '../lib/colorUtils'
import { TeamLogo } from '../components/leaderboards'
import { FinalGameSummary } from './FinalGames'
import { GameCenterModal } from './LiveGameCenter'
import { stampOverlay, clearOverlayIf } from '../state/homeOverlay'

// ─── "Happening Now" — live drama card ────────────────────────────────────────
// Appears on Home only while something dramatic is live (no-hitter, walk-off
// watch, cycle watch, free baseball). One card, events stacked by severity;
// tapping a row opens the Game Center. Detection lives in ../liveDrama.ts; in
// dev, the DevSettings drama simulator can feed it fake events instead.

const POLL_MS = 60_000
const MAX_ROWS = 4

const KIND_ACCENT: Record<DramaKind, string> = {
  perfect:  '#dc2626',
  nohitter: '#ef4444',
  walkoff:  '#f97316',
  cycle:    '#a855f7',
  marathon: '#3b82f6',
}

const KIND_TAG: Record<DramaKind, string> = {
  perfect:  'PERFECT GAME',
  nohitter: 'NO-HITTER',
  walkoff:  'WALK-OFF',
  cycle:    'CYCLE',
  marathon: 'EXTRAS',
}

function DramaRow({ event, onOpen }: { event: DramaEvent; onOpen?: () => void }) {
  const accent = KIND_ACCENT[event.kind]
  return (
    <Box
      onClick={onOpen}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25,
        px: 1.5, py: 1,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 1,
        ...(onOpen ? { cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } } : {}),
        transition: 'background-color 0.15s',
      }}
    >
      {/* Matchup logos */}
      <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <TeamLogo teamId={event.away.id} abbr={event.away.abbr} size={26} />
        <Box sx={{ ml: -0.75, zIndex: 1 }}>
          <TeamLogo teamId={event.home.id} abbr={event.home.abbr} size={26} />
        </Box>
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0 }}>
          <Box component="span" sx={{
            px: 0.55, py: '1px', borderRadius: 999, flexShrink: 0,
            bgcolor: `${accent}1c`, border: `1px solid ${accent}55`,
            fontSize: '0.5rem', fontWeight: 800, color: accent,
            letterSpacing: 0.5, lineHeight: 1.4, whiteSpace: 'nowrap',
          }}>
            {KIND_TAG[event.kind]}
          </Box>
          <Typography sx={{
            fontWeight: 800, fontSize: '0.84rem', lineHeight: 1.2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {event.headline}
          </Typography>
        </Box>
        <Typography sx={{
          fontSize: '0.66rem', color: 'text.secondary', mt: 0.3, lineHeight: 1.35,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {event.detail}
        </Typography>
      </Box>

      {/* Score + inning */}
      <Box sx={{ flexShrink: 0, textAlign: 'right' }}>
        <Typography sx={{ fontWeight: 800, fontSize: '0.9rem', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
          {event.away.score}–{event.home.score}
        </Typography>
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: accent, lineHeight: 1.3 }}>
          {event.half === 'bottom' ? '▼' : '▲'} {ord(event.inning)}
        </Typography>
      </Box>
    </Box>
  )
}

export function LiveDramaCard({ onPlayerClick, onTeamClick }: {
  onPlayerClick?: (id: number) => void
  onTeamClick?:   (id: number) => void
}) {
  const isDark = useIsDark()
  const devDrama  = useDevDrama()
  const simActive = import.meta.env.DEV && devDrama.enabled

  const [events, setEvents]     = useState<DramaEvent[]>([])
  const [openGame, setOpenGame] = useState<FinalGameSummary | null>(null)

  useEffect(() => {
    if (simActive) return
    let alive = true
    const poll = () => fetchLiveDrama().then(e => { if (alive) setEvents(e) })
    poll()
    const t = setInterval(poll, POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [simActive])

  const shown = (simActive ? devDrama.events : events).slice(0, MAX_ROWS)
  if (shown.length === 0) return null

  const topAccent = KIND_ACCENT[shown[0].kind]

  const openEvent = (e: DramaEvent) => {
    // Simulated events point at games that don't exist — nothing to open.
    if (e.gamePk >= 9_000_000) return
    const side = (s: 'away' | 'home') => ({
      teamId: e[s].id, abbr: e[s].abbr,
      name: TEAM_NICKNAME[e[s].id] ?? e[s].abbr,
      runs: e[s].score, hits: e[s].hits, errors: 0,
      isWinner: false,
    })
    setOpenGame({
      gamePk: e.gamePk, state: 'live', startMs: Date.now(),
      statusText: `${e.half === 'bottom' ? '▼' : '▲'} ${ord(e.inning)}`,
      away: side('away'), home: side('home'),
      winPitcher: null, losePitcher: null, savePitcher: null,
    })
  }

  return (
    <Box sx={{
      mb: 2, borderRadius: 2, overflow: 'hidden',
      border: `1px solid ${topAccent}${isDark ? '66' : '55'}`,
      bgcolor: 'background.paper',
      background: `linear-gradient(135deg, ${topAccent}${isDark ? '14' : '0d'} 0%, transparent 55%)`,
    }}>
      {/* Header */}
      <Box sx={{
        px: 2, py: 1.1,
        display: 'flex', alignItems: 'center', gap: 0.9,
        borderBottom: '1px solid', borderColor: 'divider',
      }}>
        <Box sx={{
          width: 8, height: 8, borderRadius: '50%', bgcolor: topAccent, flexShrink: 0,
          '@keyframes dramaPulse': {
            '0%': { opacity: 1 }, '50%': { opacity: 0.25 }, '100%': { opacity: 1 },
          },
          animation: 'dramaPulse 1.6s ease-in-out infinite',
        }} />
        <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>
          Happening Now
        </Typography>
        <Typography sx={{ fontSize: '0.62rem', color: 'text.secondary', ml: 'auto' }}>
          live around the league
        </Typography>
      </Box>

      {/* Event rows */}
      <Box sx={{ px: 0.75, py: 0.75, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        {shown.map(e => (
          <DramaRow key={e.id} event={e} onOpen={e.gamePk < 9_000_000 ? () => openEvent(e) : undefined} />
        ))}
      </Box>

      {openGame && (
        <GameCenterModal
          game={openGame}
          onClose={() => { setOpenGame(null); clearOverlayIf('scoreGame') }}
          onPlayerClick={onPlayerClick ? stampOverlay({ kind: 'scoreGame', game: openGame }, onPlayerClick) : undefined}
          onTeamClick={onTeamClick ? stampOverlay({ kind: 'scoreGame', game: openGame }, onTeamClick) : undefined}
        />
      )}
    </Box>
  )
}

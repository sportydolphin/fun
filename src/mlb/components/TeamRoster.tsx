import React, { useState } from 'react'
import { Box, Typography } from '@mui/material'
import { ACCENT, HEADSHOT, TEAM_BG } from '../constants'
import { RosterEntry } from '../types'

// Position-type groups, in the order they appear on a scorecard. `match` decides
// which group a roster entry falls into (positionType from the API, with a code
// fallback for the odd DH/utility case).
const GROUPS: Array<{ key: string; label: string; match: (e: RosterEntry) => boolean }> = [
  { key: 'P',  label: 'Pitchers',    match: e => e.positionType === 'Pitcher' || e.positionCode === '1' },
  { key: 'C',  label: 'Catchers',    match: e => e.positionType === 'Catcher' || e.positionCode === '2' },
  { key: 'IF', label: 'Infielders',  match: e => e.positionType === 'Infielder' },
  { key: 'OF', label: 'Outfielders', match: e => e.positionType === 'Outfielder' },
  { key: 'DH', label: 'Designated Hitters', match: e => e.positionType === 'Hitter' || e.positionCode === '10' },
  { key: 'TW', label: 'Two-Way',     match: e => e.positionType === 'Two-Way Player' },
]

// Small circular headshot on a team-colored disc, matching the standings/search look.
function RosterHeadshot({ playerId, teamId }: { playerId: number; teamId: number }) {
  const [failed, setFailed] = useState(false)
  const bg = TEAM_BG[teamId] ?? '#444'
  return (
    <Box sx={{
      width: 34, height: 34, borderRadius: '50%', bgcolor: bg, flexShrink: 0,
      overflow: 'hidden', display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      {!failed && (
        <Box
          component="img"
          src={HEADSHOT(playerId)}
          alt=""
          onError={() => setFailed(true)}
          sx={{ width: 34, height: 34, objectFit: 'cover', objectPosition: 'center 20%', display: 'block' }}
        />
      )}
    </Box>
  )
}

function isInjured(statusCode: string) {
  // Anything that isn't plain Active — IL (D7/D10/D60), bereavement, paternity, etc.
  return statusCode !== 'A'
}

function RosterRow({ entry, teamId, onPlayerClick }: {
  entry: RosterEntry
  teamId: number
  onPlayerClick?: (id: number) => void
}) {
  const clickable = !!onPlayerClick
  const injured = isInjured(entry.statusCode)
  const hand = entry.positionCode === '1'
    ? (entry.throws ? `${entry.throws}HP` : '')       // pitchers → throwing hand
    : (entry.bats ? `B: ${entry.bats}` : '')          // hitters → bat side

  return (
    <Box
      onClick={() => onPlayerClick?.(entry.playerId)}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1,
        px: 1, py: 0.75, borderRadius: 1.5,
        border: '1px solid', borderColor: 'divider',
        bgcolor: 'background.paper',
        cursor: clickable ? 'pointer' : 'default',
        transition: 'border-color 0.12s, background 0.12s',
        '&:hover': clickable ? { borderColor: ACCENT, bgcolor: 'action.hover' } : {},
      }}
    >
      {/* Jersey number */}
      <Typography sx={{
        minWidth: 22, textAlign: 'right', flexShrink: 0,
        fontSize: '0.8rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums',
        color: entry.jerseyNumber ? 'text.secondary' : 'text.disabled',
      }}>
        {entry.jerseyNumber ? `${entry.jerseyNumber}` : '—'}
      </Typography>

      <RosterHeadshot playerId={entry.playerId} teamId={teamId} />

      {/* Name + handedness */}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{
          fontSize: '0.82rem', fontWeight: 700, lineHeight: 1.2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {entry.fullName}
        </Typography>
        <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', lineHeight: 1.2 }}>
          {[entry.positionAbbr, hand].filter(Boolean).join(' · ')}
        </Typography>
      </Box>

      {/* IL badge */}
      {injured && (
        <Box sx={{
          flexShrink: 0, px: 0.6, height: 16, borderRadius: 0.75,
          display: 'inline-flex', alignItems: 'center',
          bgcolor: '#ef444422', color: '#ef4444',
          fontSize: '0.55rem', fontWeight: 800, letterSpacing: 0.3,
        }}>
          IL
        </Box>
      )}
    </Box>
  )
}

export function TeamRoster({ roster, teamId, onPlayerClick }: {
  roster: RosterEntry[]
  teamId: number
  onPlayerClick?: (id: number) => void
}) {
  if (!roster.length) return null

  // Bucket each player into the first group they match; anything unmatched falls
  // into a trailing "Other" group so nobody silently disappears.
  const used = new Set<number>()
  const groups = GROUPS.map(g => {
    const players = roster
      .filter(e => !used.has(e.playerId) && g.match(e))
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
    players.forEach(p => used.add(p.playerId))
    return { label: g.label, players }
  }).filter(g => g.players.length > 0)

  const other = roster.filter(e => !used.has(e.playerId))
  if (other.length) groups.push({ label: 'Other', players: other })

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {groups.map(g => (
        <Box key={g.label}>
          <Typography sx={{
            fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: 1.4, color: 'text.disabled', mb: 0.75,
          }}>
            {g.label} · {g.players.length}
          </Typography>
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
            gap: 1,
          }}>
            {g.players.map(p => (
              <RosterRow key={p.playerId} entry={p} teamId={teamId} onPlayerClick={onPlayerClick} />
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

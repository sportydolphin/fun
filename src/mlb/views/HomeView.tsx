import React, { useState } from 'react'
import { Box, Typography } from '@mui/material'
import { Team } from '../types'
import { TEAM_BG, TEAM_SECONDARY } from '../constants'

// ─── Team logo (SVG from MLB CDN, falls back to abbr text) ────────────────────

function TeamLogo({ teamId, abbr, size }: { teamId: number; abbr: string; size: number }) {
  const [failed, setFailed] = useState(false)
  const bg = TEAM_BG[teamId] ?? '#444'
  if (failed) {
    return (
      <Box sx={{
        width: size, height: size, borderRadius: '50%', bgcolor: bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Typography sx={{ color: '#fff', fontWeight: 900, fontSize: size * 0.28, lineHeight: 1 }}>
          {abbr}
        </Typography>
      </Box>
    )
  }
  return (
    <Box
      component="img"
      src={`https://www.mlbstatic.com/team-logos/team-cap-on-dark/${teamId}.svg`}
      alt={abbr}
      onError={() => setFailed(true)}
      sx={{ width: size, height: size, objectFit: 'contain', display: 'block', filter: 'drop-shadow(0 6px 20px rgba(0,0,0,0.45))' }}
    />
  )
}

// ─── Team picker (shown when no team is followed) ─────────────────────────────

function TeamPicker({ allTeams, onSelect }: { allTeams: Team[]; onSelect: (id: number) => void }) {
  const sorted = [...allTeams].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <Box>
      <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', mb: 0.5 }}>
        Pick Your Team
      </Typography>
      <Typography sx={{ color: 'text.secondary', fontSize: '0.82rem', mb: 3 }}>
        Follow a team to make this your home base
      </Typography>

      <Box sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))',
        gap: 1,
      }}>
        {sorted.map(t => {
          const bg        = TEAM_BG[t.id] ?? '#333'
          const secondary = TEAM_SECONDARY[t.id] ?? '#ffffff'
          return (
            <Box
              key={t.id}
              onClick={() => onSelect(t.id)}
              sx={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75,
                p: 1.25, borderRadius: 2,
                border: '1.5px solid', borderColor: 'transparent',
                cursor: 'pointer', userSelect: 'none',
                transition: 'all 0.15s',
                '&:hover': {
                  borderColor: bg,
                  bgcolor: `${bg}20`,
                  transform: 'scale(1.04)',
                },
              }}
            >
              {/* Colored circle with logo */}
              <Box sx={{
                width: 44, height: 44, borderRadius: '50%', bgcolor: bg,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', flexShrink: 0,
              }}>
                <Box
                  component="img"
                  src={`https://www.mlbstatic.com/team-logos/team-cap-on-dark/${t.id}.svg`}
                  alt={t.abbreviation}
                  sx={{ width: 34, height: 34, objectFit: 'contain' }}
                  onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                    const img = e.currentTarget
                    img.style.display = 'none'
                    // show abbr fallback via parent bg
                  }}
                />
              </Box>
              <Typography sx={{
                fontSize: '0.62rem', fontWeight: 800,
                color: 'text.primary', textAlign: 'center', lineHeight: 1.2,
              }}>
                {t.abbreviation}
              </Typography>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

// ─── Home screen (shown once a team is followed) ──────────────────────────────

export interface HomeViewProps {
  allTeams: Team[]
  followedTeamId: number | null
  onFollowTeam:   (teamId: number) => void
  onUnfollowTeam: () => void
}

export function HomeView({ allTeams, followedTeamId, onFollowTeam, onUnfollowTeam }: HomeViewProps) {
  // ── No team followed → show picker ──────────────────────────────────────────
  if (!followedTeamId) {
    return <TeamPicker allTeams={allTeams} onSelect={onFollowTeam} />
  }

  const team      = allTeams.find(t => t.id === followedTeamId)
  const bg        = TEAM_BG[followedTeamId]        ?? '#1a2035'
  const secondary = TEAM_SECONDARY[followedTeamId] ?? '#ffffff'
  const abbr      = team?.abbreviation ?? '—'
  const name      = team?.name         ?? '—'

  // Split team name into city + nickname for stacked display
  // Works for most: "Los Angeles Dodgers" → ["Los Angeles", "Dodgers"]
  // Falls back to single line for anything unusual
  const words     = name.split(' ')
  const nickname  = words[words.length - 1]
  const city      = words.slice(0, -1).join(' ')

  return (
    <Box sx={{
      minHeight: 'calc(100vh - 130px)',
      borderRadius: { xs: 0, sm: 3 },
      bgcolor: bg,
      mx: { xs: -2, sm: 0 },   // bleed to viewport edges on mobile
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden',
      px: 3, py: 8,
    }}>

      {/* Subtle radial glow behind the logo in the secondary color */}
      <Box sx={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `radial-gradient(ellipse 70% 55% at 50% 38%, ${secondary}22 0%, transparent 70%)`,
      }} />

      {/* ★ YOUR TEAM label */}
      <Typography sx={{
        fontSize: '0.68rem', fontWeight: 800,
        textTransform: 'uppercase', letterSpacing: '3px',
        color: secondary, opacity: 0.65, mb: 2.5,
        position: 'relative',
      }}>
        ★&ensp;Your Team
      </Typography>

      {/* Big logo */}
      <Box sx={{ mb: 4, position: 'relative' }}>
        <TeamLogo teamId={followedTeamId} abbr={abbr} size={130} />
      </Box>

      {/* City name (smaller) */}
      {city && (
        <Typography sx={{
          fontSize: { xs: '1rem', sm: '1.2rem' },
          fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '4px',
          color: secondary, opacity: 0.75,
          lineHeight: 1, mb: 0.5,
          position: 'relative',
        }}>
          {city}
        </Typography>
      )}

      {/* Nickname (massive) */}
      <Typography sx={{
        fontSize: { xs: '2.8rem', sm: '4rem' },
        fontWeight: 900, textTransform: 'uppercase',
        letterSpacing: '-2px', lineHeight: 1,
        color: secondary,
        textShadow: `0 4px 24px rgba(0,0,0,0.35)`,
        mb: 4,
        position: 'relative',
      }}>
        {nickname}
      </Typography>

      {/* Change team button */}
      <Box
        onClick={onUnfollowTeam}
        sx={{
          position: 'relative',
          px: 3, py: '8px',
          borderRadius: 999,
          border: `1.5px solid ${secondary}45`,
          color: secondary, opacity: 0.55,
          fontSize: '0.76rem', fontWeight: 700,
          cursor: 'pointer', userSelect: 'none',
          transition: 'opacity 0.15s, border-color 0.15s',
          '&:hover': { opacity: 1, borderColor: secondary },
        }}
      >
        Change Team
      </Box>
    </Box>
  )
}

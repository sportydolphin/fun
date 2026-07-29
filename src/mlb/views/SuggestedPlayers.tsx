import React, { useState, useEffect } from 'react'
import { Box, Typography } from '@mui/material'
import { TEAM_BG, TEAM_ABBR, HEADSHOT, ACCENT, CURRENT_SEASON } from '../constants'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SuggestionPlayer {
  id:           number
  fullName:     string
  position:     string
  teamId:       number
  teamAbbr:     string
  isTeamPlayer: boolean
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

export async function fetchSuggestions(teamId: number, followedIds: number[]): Promise<SuggestionPlayer[]> {
  const out: SuggestionPlayer[] = []

  // ── Roster from followed team (rotated daily for variety) ─────────────────
  try {
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/teams/${teamId}/roster?season=${CURRENT_SEASON}&rosterType=active`
    ).then(r => r.json())
    const teamAbbr = TEAM_ABBR[teamId] ?? '?'
    const picks = ((res.roster ?? []) as any[])
      .filter((p: any) => !followedIds.includes(Number(p.person?.id)))
    // Rotate starting index daily so different players surface each day
    const offset  = new Date().getDate() % Math.max(picks.length, 1)
    const rotated = [...picks.slice(offset), ...picks.slice(0, offset)]
    rotated.slice(0, 3).forEach((p: any) => {
      out.push({
        id:           Number(p.person.id),
        fullName:     p.person.fullName ?? '',
        position:     p.position?.abbreviation ?? '?',
        teamId,
        teamAbbr,
        isTeamPlayer: true,
      })
    })
  } catch { /* non-fatal */ }

  // ── League OPS leaders (outside the followed team) ────────────────────────
  try {
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/stats/leaders?leaderCategories=onBasePlusSlugging` +
      `&season=${CURRENT_SEASON}&limit=30&sportId=1&statGroup=hitting`
    ).then(r => r.json())
    const leaders: any[] = res?.leagueLeaders?.[0]?.leaders ?? []
    leaders
      .filter((p: any) => {
        const id = Number(p.person?.id)
        return !followedIds.includes(id) && Number(p.team?.id) !== teamId
      })
      .slice(0, 3)
      .forEach((p: any) => {
        const tid = Number(p.team?.id ?? 0)
        out.push({
          id:           Number(p.person.id),
          fullName:     p.person.fullName ?? '',
          position:     p.rank != null ? `#${p.rank} OPS` : 'OPS',
          teamId:       tid,
          teamAbbr:     TEAM_ABBR[tid] ?? '?',
          isTeamPlayer: false,
        })
      })
  } catch { /* non-fatal */ }

  return out
}

// ─── SuggestionChip ───────────────────────────────────────────────────────────

export function SuggestionChip({ player, alreadyFollowed, onFollow, onPlayerClick, large }: {
  player:          SuggestionPlayer
  alreadyFollowed: boolean
  onFollow:        () => void
  onPlayerClick?:  (id: number) => void
  /** Full-width list row (matches the search results in the Followed-players dropdown)
      rather than a compact chip. Bigger avatar + readable text. */
  large?:          boolean
}) {
  const col      = TEAM_BG[player.teamId] ?? '#444'
  // Show last name for brevity (keeps chips narrow)
  const lastName = player.fullName.split(' ').slice(1).join(' ') || player.fullName

  return (
    <Box
      onClick={alreadyFollowed ? undefined : onFollow}
      sx={{
      flexShrink: 0,
      display: 'flex', alignItems: 'center', gap: 0.75,
      px: 1, py: large ? 0.9 : 0.75, borderRadius: 2,
      border: '1px solid',
      borderColor: player.isTeamPlayer ? `${col}40` : 'divider',
      bgcolor:     player.isTeamPlayer ? `${col}08` : 'transparent',
      minWidth: large ? 0 : 138,
      cursor: alreadyFollowed ? 'default' : 'pointer',
      transition: 'border-color 0.15s, background-color 0.15s',
      '&:hover': alreadyFollowed ? {} : { borderColor: `${col}60`, bgcolor: `${col}10` },
    }}>
      {/* Headshot */}
      <Box sx={{
        width: large ? 32 : 28, height: large ? 32 : 28, borderRadius: '50%',
        overflow: 'hidden', bgcolor: 'action.hover',
        flexShrink: 0, border: `1.5px solid ${col}40`,
      }}>
        <Box component="img" src={HEADSHOT(player.id)} alt={player.fullName}
          sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%' }} />
      </Box>

      {/* Name + meta */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{
          fontWeight: 700,
          fontSize: large ? '0.82rem' : { xs: '0.7rem', sm: '0.78rem' },
          lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {lastName}
        </Typography>
        <Typography sx={{ fontSize: large ? '0.68rem' : { xs: '0.56rem', sm: '0.64rem' }, color: 'text.secondary', lineHeight: large ? 1.3 : 1 }}>
          {player.position} · {player.teamAbbr}
          {player.isTeamPlayer && (
            <Box component="span" sx={{ color: col, fontWeight: 800 }}> ★</Box>
          )}
        </Typography>
      </Box>

      {/* Already-followed indicator */}
      {alreadyFollowed && (
        <Box sx={{
          flexShrink: 0, width: 20, height: 20, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '1.5px solid #22c55e60',
          color: '#22c55e', fontSize: '0.6rem', fontWeight: 900, lineHeight: 1,
        }}>
          ✓
        </Box>
      )}
    </Box>
  )
}

// ─── SuggestedPlayersSection ──────────────────────────────────────────────────

export function SuggestedPlayersSection({ teamId, followedPlayerIds, onFollow }: {
  teamId:            number
  followedPlayerIds: number[]
  onFollow:          (id: number) => void
}) {
  const [suggestions, setSuggestions] = useState<SuggestionPlayer[]>([])
  const [loading,     setLoading]     = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchSuggestions(teamId, followedPlayerIds)
      .then(setSuggestions)
      .finally(() => setLoading(false))
  }, [teamId]) // refetch only if team changes; followedIds reflected via alreadyFollowed

  if (!loading && suggestions.length === 0) return null

  return (
    <Box sx={{
      borderRadius: 3, border: '1px solid', borderColor: 'divider',
      bgcolor: 'background.paper', overflow: 'hidden',
    }}>
      {/* Header */}
      <Box sx={{
        px: 2, py: 1.25,
        borderBottom: '1px solid', borderColor: 'divider',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Typography sx={{
          fontWeight: 800, fontSize: { xs: '0.65rem', sm: '0.72rem' },
          textTransform: 'uppercase', letterSpacing: 1.2, color: ACCENT,
        }}>
          Suggested Players
        </Typography>
        <Typography sx={{ fontSize: { xs: '0.58rem', sm: '0.64rem' }, color: 'text.disabled' }}>
          ★ = your team
        </Typography>
      </Box>

      <Box sx={{ px: 2, py: 1.5 }}>
        {loading ? (
          <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled' }}>Loading suggestions…</Typography>
        ) : (
          <Box sx={{
            display: 'flex', gap: 1, overflowX: 'auto', pb: 0.5,
            flexWrap: 'wrap',
            '&::-webkit-scrollbar': { display: 'none' },
            scrollbarWidth: 'none',
          }}>
            {suggestions.map(p => (
              <SuggestionChip
                key={p.id}
                player={p}
                alreadyFollowed={followedPlayerIds.includes(p.id)}
                onFollow={() => onFollow(p.id)}
              />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  )
}

import React from 'react'
import { pressable } from '../../ui/interaction'
import { edge, TYPE_SCALE } from '../../ui/card'
import { Box, Typography } from '@mui/material'
import { TEAM_BG, TEAM_ABBR, HEADSHOT, CURRENT_SEASON, TONE } from '../constants'
import { chromePx } from '../../ui/scale'
import { useTextTone } from '../lib/colorUtils'
import { cachedJson, FRESH_LONG_MS } from '../lib/readCache'

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
  // Skipped with no team: the toolbar asks with `followedTeamId ?? 0`, and team 0's roster is a
  // request on every load that can only come back empty.
  if (teamId > 0) try {
    const res = await cachedJson<any>(
      `https://statsapi.mlb.com/api/v1/teams/${teamId}/roster?season=${CURRENT_SEASON}&rosterType=active`, FRESH_LONG_MS)
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
    const res = await cachedJson<any>(
      `https://statsapi.mlb.com/api/v1/stats/leaders?leaderCategories=onBasePlusSlugging` +
      `&season=${CURRENT_SEASON}&limit=30&sportId=1&statGroup=hitting`, FRESH_LONG_MS)
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

export function SuggestionChip({ player, alreadyFollowed, onFollow, large }: {
  player:          SuggestionPlayer
  alreadyFollowed: boolean
  onFollow:        () => void
  onPlayerClick?:  (id: number) => void
  /** Full-width list row (matches the search results in the Followed-players dropdown)
      rather than a compact chip. Bigger avatar + readable text. */
  large?:          boolean
}) {
  const tone = useTextTone()
  const col      = TEAM_BG[player.teamId] ?? '#444'
  // Show last name for brevity (keeps chips narrow)
  const lastName = player.fullName.split(' ').slice(1).join(' ') || player.fullName

  return (
    <Box
      {...pressable(alreadyFollowed ? undefined : onFollow)}
      sx={{
      flexShrink: 0,
      display: 'flex', alignItems: 'center', gap: 0.75,
      px: 1, py: large ? 0.9 : 0.75, borderRadius: 2,
      border: '1px solid',
      borderColor: player.isTeamPlayer ? edge(col) : 'outline',
      bgcolor:     player.isTeamPlayer ? `${col}08` : 'transparent',
      minWidth: large ? 0 : chromePx(138),
      cursor: alreadyFollowed ? 'default' : 'pointer',
      transition: 'border-color 0.15s, background-color 0.15s',
      '&:hover': alreadyFollowed ? {} : { borderColor: edge(col), bgcolor: `${col}10` },
    }}>
      {/* Headshot */}
      <Box sx={{
        width: large ? chromePx(32) : chromePx(28), height: large ? chromePx(32) : chromePx(28), borderRadius: '50%',
        overflow: 'hidden', bgcolor: 'action.hover',
        flexShrink: 0, border: '1.5px solid', borderColor: edge(col),
      }}>
        <Box component="img" src={HEADSHOT(player.id)} alt={player.fullName}
          sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%' }} />
      </Box>

      {/* Name + meta */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{
          fontWeight: 700,
          fontSize: large ? TYPE_SCALE.body : { xs: TYPE_SCALE.meta, sm: TYPE_SCALE.body },
          lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {lastName}
        </Typography>
        <Typography sx={{ fontSize: large ? TYPE_SCALE.micro : TYPE_SCALE.caption, color: 'text.secondary', lineHeight: large ? 1.3 : 1 }}>
          {player.position} · {player.teamAbbr}
          {player.isTeamPlayer && (
            <Box component="span" sx={{ color: tone(col), fontWeight: 800 }}> ★</Box>
          )}
        </Typography>
      </Box>

      {/* Already-followed indicator */}
      {alreadyFollowed && (
        <Box sx={{
          flexShrink: 0, width: chromePx(20), height: chromePx(20), borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '1.5px solid #22c55e60',
          color: TONE.green, fontSize: TYPE_SCALE.caption, fontWeight: 900, lineHeight: 1,
        }}>
          ✓
        </Box>
      )}
    </Box>
  )
}

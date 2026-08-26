import { useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { fetchWpblAllLines, getCachedWpblAllLines } from './api'
import { TeamBadge, useWpblDark, pressable, FOCUS_RING } from './ui'
import { wpblAccent, wpblFullName } from './constants'
import {
  computeWpblTeamStats, WPBL_TEAM_STAT_DEFS,
  type WpblTeamStatValue,
} from './stats'
import type { WpblTeam, WpblGame } from './types'

// The WPBL game-preview matchup card — the analogue of the MLB app's GamePreview
// TeamComparison, shown inside GameDetail for a game that hasn't been played yet. Each
// row is a diverging bar scaled to the league's range for that stat, so the two clubs read
// against each other (and against the league) at a glance. Bars always grow toward "better",
// including for ERA/WHIP where the lower number wins. Built from the same box-score lines the
// leaders read (cached by Home), so it needs no extra fetch on a warm app.

const CURRENT_SEASON = 2026

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th'
    : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'
  return `${n}${suffix}`
}

// Bar colors come from the shared team accent palette (constants.ts `wpblAccent`), which
// exists for exactly this reason: the raw primaries are all near-black and unusable as
// foreground. Keeping one source means a palette tweak lands everywhere at once.
export function WpblGamePreview({ away, home, teams, games, onOpenTeam }: {
  away: WpblTeam
  home: WpblTeam
  teams: WpblTeam[]
  games: WpblGame[]
  /** Open a club's page from its chip. Optional so the preview still renders anywhere that
   *  has nowhere to send the tap. */
  onOpenTeam?: (team: WpblTeam) => void
}) {
  const isDark = useWpblDark()
  const [lines, setLines] = useState(() => getCachedWpblAllLines())
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (lines) return              // warm cache — no fetch, no flash
    let cancelled = false
    fetchWpblAllLines()
      .then(l => { if (!cancelled) setLines(l) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [])

  const stats = useMemo(
    () => (lines ? computeWpblTeamStats(teams, games, lines.batting, lines.pitching) : null),
    [lines, teams, games],
  )

  const awayStats = stats?.get(away.id)
  const homeStats = stats?.get(home.id)
  const loading = !stats && !failed

  // Nothing to compare yet (opening days, neither club has logged a line) — say so plainly
  // rather than drawing empty tracks.
  if (!loading && (failed || (!awayStats && !homeStats))) {
    return (
      <Box sx={{ px: 2, py: 3, textAlign: 'center' }}>
        <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, mb: 0.5 }}>This game hasn't been played yet</Typography>
        <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled' }}>
          Season stats to compare appear once both clubs have played.
        </Typography>
      </Box>
    )
  }

  const awayColor = wpblAccent(away.id, isDark)
  const homeColor = wpblAccent(home.id, isDark)
  const trackBg = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'

  const shimmer = {
    bgcolor: 'action.hover', borderRadius: 0.75,
    '@keyframes wpblPvPulse': { '0%,100%': { opacity: 0.5 }, '50%': { opacity: 0.85 } },
    animation: 'wpblPvPulse 1.1s ease-in-out infinite',
  } as const

  // value + rank stacked on the outer edge, bar growing inward from it.
  const valueCell = (v: WpblTeamStatValue | undefined, better: boolean, color: string, align: 'right' | 'left') => (
    <Box sx={{ width: 44, flexShrink: 0, textAlign: align }}>
      {loading ? (
        <Box sx={{ ...shimmer, width: 32, height: '0.8rem', ml: align === 'right' ? 'auto' : 0 }} />
      ) : (
        <>
          <Typography sx={{
            fontSize: '0.82rem', fontWeight: better ? 900 : 600, lineHeight: 1.1,
            color: better ? color : 'text.secondary', fontVariantNumeric: 'tabular-nums',
          }}>
            {v?.display ?? '—'}
          </Typography>
          <Typography sx={{ fontSize: '0.5rem', fontWeight: 600, color: 'text.disabled', lineHeight: 1.2 }}>
            {v ? ordinal(v.rank) : ''}
          </Typography>
        </>
      )}
    </Box>
  )

  // Half-track: bar anchored at the center label, growing outward, its length the team's
  // position in the league range for that stat.
  const bar = (v: WpblTeamStatValue | undefined, better: boolean, color: string, side: 'away' | 'home') => (
    <Box sx={{
      flex: 1, minWidth: 0, height: 8, borderRadius: 999, bgcolor: trackBg,
      position: 'relative', overflow: 'hidden',
    }}>
      {!loading && v && (
        <Box sx={{
          position: 'absolute', top: 0, bottom: 0,
          [side === 'away' ? 'right' : 'left']: 0,
          // Floor keeps a last-in-league value visible rather than zero-width.
          width: `${Math.max(5, v.pct * 100)}%`,
          bgcolor: color, opacity: better ? 1 : 0.4,
          borderRadius: 999,
          transition: 'width 0.35s ease, opacity 0.2s',
        }} />
      )}
    </Box>
  )

  const row = (def: typeof WPBL_TEAM_STAT_DEFS[number]) => {
    const a = awayStats?.[def.key]
    const h = homeStats?.[def.key]
    // Rank already encodes direction (1 = best), so it decides the winner for both
    // higher-is-better and lower-is-better stats.
    const awayBetter = !!a && !!h && a.rank < h.rank
    const homeBetter = !!a && !!h && h.rank < a.rank

    return (
      <Box key={def.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: 0.4 }}>
        {valueCell(a, awayBetter, awayColor, 'right')}
        {bar(a, awayBetter, awayColor, 'away')}
        <Typography sx={{
          flexShrink: 0, width: 38, textAlign: 'center',
          fontSize: '0.56rem', fontWeight: 800, color: 'text.secondary',
          textTransform: 'uppercase', letterSpacing: 0.4, lineHeight: 1,
        }}>
          {def.label}
        </Typography>
        {bar(h, homeBetter, homeColor, 'home')}
        {valueCell(h, homeBetter, homeColor, 'left')}
      </Box>
    )
  }

  // A hairline rule with the group name set into it — separates Offense from Pitching
  // without a second heavy all-caps header competing with the row labels.
  const groupBlock = (group: 'hitting' | 'pitching', label: string) => (
    <Box sx={{ mt: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.4 }}>
        <Typography sx={{
          fontSize: '0.5rem', fontWeight: 800, color: 'text.disabled',
          textTransform: 'uppercase', letterSpacing: 1, lineHeight: 1, flexShrink: 0,
        }}>
          {label}
        </Typography>
        <Box sx={{ flex: 1, height: '1px', bgcolor: 'divider' }} />
      </Box>
      {WPBL_TEAM_STAT_DEFS.filter(d => d.group === group).map(row)}
    </Box>
  )

  // Team chip — the club's badge (logo) plus its abbr in the bar color, so the row-side ↔
  // team ↔ color mapping is unmistakable without decoding a legend.
  //
  // And it opens the club. This card is a wall of the two teams' season numbers, so "how is
  // Boston actually doing" is the obvious next question and the badge is the obvious thing to
  // press for it. `pressable` rather than an anchor, like every other team target in the
  // section: a club page is history state on /wpbl/teams rather than a URL of its own, so
  // there is no href to give it.
  const teamChip = (team: WpblTeam, color: string, align: 'right' | 'left') => (
    <Box
      {...(onOpenTeam ? pressable(() => onOpenTeam(team)) : {})}
      aria-label={onOpenTeam ? `${wpblFullName(team)} team page` : undefined}
      sx={{
        flex: 1, display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0,
        flexDirection: align === 'right' ? 'row-reverse' : 'row',
        ...(onOpenTeam ? {
          cursor: 'pointer', borderRadius: 1, mx: -0.5, px: 0.5, py: 0.25,
          '&:hover': { bgcolor: 'action.hover' },
          ...FOCUS_RING,
        } : {}),
      }}
    >
      <TeamBadge team={team} size={18} />
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color, lineHeight: 1 }}>{team.abbr}</Typography>
    </Box>
  )

  return (
    <Box sx={{ px: 2, py: 1.5 }}>
      <Typography sx={{
        fontSize: '0.58rem', fontWeight: 700, color: 'text.disabled',
        textTransform: 'uppercase', letterSpacing: 0.8, lineHeight: 1, mb: 1,
      }}>
        Season Comparison
      </Typography>

      {/* Legend: which color is which club */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
        {teamChip(away, awayColor, 'right')}
        <Typography sx={{ fontSize: '0.54rem', fontWeight: 700, color: 'text.disabled', flexShrink: 0, lineHeight: 1 }}>VS</Typography>
        {teamChip(home, homeColor, 'left')}
      </Box>

      {groupBlock('hitting', 'Offense')}
      {groupBlock('pitching', 'Pitching')}

      <Typography sx={{ fontSize: '0.52rem', color: 'text.disabled', mt: 1, textAlign: 'center', lineHeight: 1.5 }}>
        {CURRENT_SEASON} season · bar length = rank in the league, longer is better
      </Typography>
    </Box>
  )
}

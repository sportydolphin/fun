import { useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { fetchWpblAllLines, getCachedWpblAllLines } from './api'
import { TeamBadge, useWpblDark, pressable, FOCUS_RING, MICRO_TEXT, TAPPABLE } from './ui'
import { wpblAccent, wpblFullName } from './constants'
import {
  computeWpblTeamStats, WPBL_TEAM_STAT_DEFS,
  type WpblTeamStatValue,
} from './stats'
import { useEraBasis } from './EraBasisContext'
import type { WpblTeam, WpblGame } from './types'

// The WPBL game-preview matchup card — the analogue of the MLB app's GamePreview
// TeamComparison, shown inside GameDetail for a game that hasn't been played yet. Each
// row is a diverging bar scaled to the league's range for that stat, so the two clubs read
// against each other (and against the league) at a glance. Bars always grow toward "better",
// including for ERA/WHIP where the lower number wins. Built from the same box-score lines the
// leaders read (cached by Home), so it needs no extra fetch on a warm app.

const CURRENT_SEASON = 2026

/** The three rows the compact cut keeps: how many runs a club scores, how well it hits, how
 *  many runs it gives up. Score, hit, prevent: the shortest honest description of a baseball
 *  team, and the three a reader can hold in their head between the team rows above and the
 *  first pitch. The full nine live one tap away in Game Center, which is where somebody who
 *  wants WHIP has already gone. */
const COMPACT_KEYS = ['rpg', 'ops', 'era'] as const

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th'
    : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'
  return `${n}${suffix}`
}

// Bar colors come from the shared team accent palette (constants.ts `wpblAccent`), which
// exists for exactly this reason: the raw primaries are all near-black and unusable as
// foreground. Keeping one source means a palette tweak lands everywhere at once.
export function WpblGamePreview({ away, home, teams, games, onOpenTeam, compact }: {
  away: WpblTeam
  home: WpblTeam
  teams: WpblTeam[]
  games: WpblGame[]
  /** Open a club's page from its chip. Optional so the preview still renders anywhere that
   *  has nowhere to send the tap. */
  onOpenTeam?: (team: WpblTeam) => void
  /** Three rows instead of nine, one line per value instead of two, and no chrome of its own:
   *  no card padding, no legend, no footnote, no group rules. For Home's Next game card, which
   *  is a card already and supplies all of that, and which has room for a tale of the tape but
   *  not for a second card's worth of it.
   *
   *  It also renders NOTHING rather than an empty state. In GameDetail this component IS the
   *  pane, so "this game hasn't been played yet" is the answer to the reader's question; on
   *  Home it is the last block of a card that has already said plenty, and a card that grows a
   *  paragraph of apology on the season's first day is worse than one that simply stops. */
  compact?: boolean
}) {
  const isDark = useWpblDark()
  const { basis: eraBasis, kLabel } = useEraBasis()
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
    () => (lines ? computeWpblTeamStats(teams, games, lines.batting, lines.pitching, eraBasis) : null),
    [lines, teams, games, eraBasis],
  )

  const awayStats = stats?.get(away.id)
  const homeStats = stats?.get(home.id)
  const loading = !stats && !failed

  // Nothing to compare yet (opening days, neither club has logged a line) — say so plainly
  // rather than drawing empty tracks.
  if (!loading && (failed || (!awayStats && !homeStats))) {
    if (compact) return null
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
    <Box sx={{ width: '2.75rem', flexShrink: 0, textAlign: align }}>
      {loading ? (
        <Box sx={{ ...shimmer, width: '2rem', height: '0.8rem', ml: align === 'right' ? 'auto' : 0 }} />
      ) : (
        <>
          <Typography sx={{
            fontSize: '0.82rem', fontWeight: better ? 900 : 600, lineHeight: 1.1,
            color: better ? color : 'text.secondary', fontVariantNumeric: 'tabular-nums',
          }}>
            {v?.display ?? '—'}
          </Typography>
          {/* The league rank under the value, and the first thing the compact cut drops: it is
              a second line on every cell, so it is a third of the block's height, and it is the
              detail a reader goes to Game Center for. The bar already says the same thing in
              the only resolution that matters at this size, which is longer or shorter. */}
          {!compact && (
            <Typography sx={{ fontSize: '0.5rem', fontWeight: 600, color: 'text.disabled', lineHeight: 1.2 }}>
              {v ? ordinal(v.rank) : ''}
            </Typography>
          )}
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
      <Box key={def.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: compact ? 0.25 : 0.4 }}>
        {valueCell(a, awayBetter, awayColor, 'right')}
        {bar(a, awayBetter, awayColor, 'away')}
        <Typography sx={{
          flexShrink: 0, width: '2.375rem', textAlign: 'center',
          fontSize: MICRO_TEXT, fontWeight: 800, color: 'text.secondary',
          textTransform: 'uppercase', letterSpacing: 0.4, lineHeight: 1,
        }}>
          {def.key === 'k9' ? kLabel : def.label}
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
          ...TAPPABLE,
          ...FOCUS_RING,
        } : {}),
      }}
    >
      <TeamBadge team={team} size={18} />
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color, lineHeight: 1 }}>{team.abbr}</Typography>
    </Box>
  )

  // The compact cut: three rows, and everything a host card already provides is left to it.
  // No padding of its own, no legend (the two team rows directly above it carry the badges in
  // the same club colours these bars use), no season footnote, no group rules for three stats
  // that do not need dividing into two groups.
  if (compact) {
    return (
      <Box>
        <Typography sx={{
          fontSize: '0.6rem', fontWeight: 800, color: 'text.secondary',
          textTransform: 'uppercase', letterSpacing: 0.8, lineHeight: 1, mb: 0.5,
        }}>
          Season so far
        </Typography>
        {COMPACT_KEYS.map(k => WPBL_TEAM_STAT_DEFS.find(d => d.key === k)).map(d => d && row(d))}
      </Box>
    )
  }

  return (
    <Box sx={{ px: 2, py: 1.5 }}>
      <Typography sx={{
        fontSize: MICRO_TEXT, fontWeight: 700, color: 'text.disabled',
        textTransform: 'uppercase', letterSpacing: 0.8, lineHeight: 1, mb: 1,
      }}>
        Season Comparison
      </Typography>

      {/* Legend: which color is which club */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
        {teamChip(away, awayColor, 'right')}
        <Typography sx={{ fontSize: MICRO_TEXT, fontWeight: 700, color: 'text.disabled', flexShrink: 0, lineHeight: 1 }}>VS</Typography>
        {teamChip(home, homeColor, 'left')}
      </Box>

      {groupBlock('hitting', 'Offense')}
      {groupBlock('pitching', 'Pitching')}

      <Typography sx={{ fontSize: MICRO_TEXT, color: 'text.disabled', mt: 1, textAlign: 'center', lineHeight: 1.5 }}>
        {CURRENT_SEASON} season · bar length = rank in the league, longer is better
      </Typography>
    </Box>
  )
}

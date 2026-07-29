// Game preview modal — the pre-game matchup card (probable pitchers, weather,
// season-stat comparison bars) shown from the Scores scoreboard and the team
// ScheduleStrip. Extracted from FinalGames.tsx.

import React, { useState, useEffect } from 'react'
import { Box, Typography } from '@mui/material'
import { ChevronLeft, ChevronRight } from '@mui/icons-material'
import { TEAM_BG, HEADSHOT, CURRENT_SEASON } from '../constants'
import { useIsDark, accentColor, borderAlpha, photoBorderAlpha } from '../lib/colorUtils'
import { useScrollLock } from '../lib/useScrollLock'
import { fetchTeamSeasonStats, TEAM_STAT_DEFS, TeamSeasonStats, TeamStatValue } from '../api'
import { LogoBubble, SectionLabel } from '../components/boxScore'

// ─── Game preview types ───────────────────────────────────────────────────────

interface ProbablePitcher {
  id:     number
  name:   string
  hand:   string          // 'R' | 'L' | 'S' | '?'
  era:    string | null
  wins:   number
  losses: number
  whip:   string | null
  k:      number
  ip:     string | null
}

interface GamePreviewData {
  venueName:    string
  weather:      { condition: string; temp: string; wind: string } | null
  awayPitcher:  ProbablePitcher | null
  homePitcher:  ProbablePitcher | null
}

// Minimal game shape the shared preview modal needs. FinalGameSummary satisfies this
// structurally (scoreboard), and the team ScheduleStrip builds one from its own game
// objects — so both surfaces render the exact same preview card.
export interface PreviewGame {
  gamePk:     number
  statusText: string
  reason?:    string          // postponement reason ("Rain"/...) when statusText is "Postponed"
  away: { teamId: number; abbr: string }
  home: { teamId: number; abbr: string }
}

async function fetchGamePreview(gamePk: number): Promise<GamePreviewData | null> {
  try {
    const season = new Date().getFullYear()
    const schedRes = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&gamePk=${gamePk}` +
      `&hydrate=probablePitcher,venue,weather`
    ).then(r => r.json()).catch(() => null)

    const game = schedRes?.dates?.[0]?.games?.[0]
    if (!game) return null

    const venueName = game.venue?.name ?? ''
    const w = game.weather
    const weather = (w && (w.condition || w.temp || w.wind))
      ? { condition: w.condition ?? '', temp: w.temp ?? '', wind: w.wind ?? '' }
      : null

    const fetchPitcher = async (raw: any): Promise<ProbablePitcher | null> => {
      if (!raw?.id) return null
      try {
        const r = await fetch(
          `https://statsapi.mlb.com/api/v1/people/${raw.id}?hydrate=stats(group=pitching,type=season,season=${season})`
        ).then(r => r.json())
        const person = r.people?.[0]
        const stat = person?.stats?.find((s: any) => s.group?.displayName === 'pitching')?.splits?.[0]?.stat
        return {
          id:     raw.id,
          name:   raw.fullName,
          hand:   person?.pitchHand?.code ?? '?',
          era:    stat?.era    ?? null,
          wins:   Number(stat?.wins      ?? 0),
          losses: Number(stat?.losses    ?? 0),
          whip:   stat?.whip   ?? null,
          k:      Number(stat?.strikeOuts ?? 0),
          ip:     stat?.inningsPitched ?? null,
        }
      } catch {
        return { id: raw.id, name: raw.fullName, hand: '?', era: null, wins: 0, losses: 0, whip: null, k: 0, ip: null }
      }
    }

    const [awayPitcher, homePitcher] = await Promise.all([
      fetchPitcher(game.teams?.away?.probablePitcher),
      fetchPitcher(game.teams?.home?.probablePitcher),
    ])

    return { venueName, weather, awayPitcher, homePitcher }
  } catch { return null }
}


// ─── Season comparison (preview modal) ────────────────────────────────────────

function ordinal(n: number): string {
  // 11th/12th/13th are the exceptions to the 1st/2nd/3rd pattern.
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th'
    : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'
  return `${n}${suffix}`
}

// Hue (0–360) of a hex color, for judging whether two team colors are telling
// enough apart to carry meaning on their own.
function hexHue(hex: string): number {
  if (!hex.startsWith('#') || hex.length < 7) return 0
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  if (d === 0) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}

// Plenty of matchups are two navy clubs (MIN/CLE) or two red ones (BOS/STL) —
// team colors would then be indistinguishable, and color is doing real work
// here. When the hues are too close, both sides fall back to a colorblind-safe
// blue/orange pair instead.
const FALLBACK_AWAY = '#3b82f6'
const FALLBACK_HOME = '#f97316'
const MIN_HUE_GAP   = 40

function comparisonColors(awayId: number, homeId: number, isDark: boolean): [string, string] {
  const a = accentColor(TEAM_BG[awayId] ?? '#444', isDark)
  const h = accentColor(TEAM_BG[homeId] ?? '#444', isDark)
  const gap = Math.abs(hexHue(a) - hexHue(h))
  const hueGap = Math.min(gap, 360 - gap)
  return hueGap < MIN_HUE_GAP ? [FALLBACK_AWAY, FALLBACK_HOME] : [a, h]
}

// Head-to-head season splits for the two clubs. Each row is a diverging bar
// scaled to the league's range for that stat, so the two sides can be read
// against each other and against MLB at a glance. Bars always grow toward
// "better", including for ERA/WHIP/BAA where the lower number wins.
// Purely informational, so a failed fetch renders nothing rather than an error.
function TeamComparison({ away, home }: {
  away: { teamId: number; abbr: string }
  home: { teamId: number; abbr: string }
}) {
  const isDark = useIsDark()
  const [stats, setStats] = useState<Map<number, TeamSeasonStats> | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetchTeamSeasonStats()
      .then(m => { if (!cancelled) setStats(m) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [])

  const awayStats = stats?.get(away.teamId)
  const homeStats = stats?.get(home.teamId)
  const loading   = !stats && !failed
  if (failed || (stats && !awayStats && !homeStats)) return null

  const [awayColor, homeColor] = comparisonColors(away.teamId, home.teamId, isDark)
  const trackBg = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'

  const shimmer = {
    bgcolor: 'action.hover', borderRadius: 0.75,
    '@keyframes pvPulse': { '0%,100%': { opacity: 0.5 }, '50%': { opacity: 0.85 } },
    animation: 'pvPulse 1.1s ease-in-out infinite',
  } as const

  // value + rank stacked on the outer edge, bar growing inward from it.
  const valueCell = (v: TeamStatValue | undefined, better: boolean, color: string, align: 'right' | 'left') => (
    <Box sx={{ width: 42, flexShrink: 0, textAlign: align }}>
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

  // Half-track: bar is anchored at the center label and grows outward, its
  // length the team's position in the league range for that stat.
  const bar = (v: TeamStatValue | undefined, better: boolean, color: string, side: 'away' | 'home') => (
    <Box sx={{
      flex: 1, minWidth: 0, height: 8, borderRadius: 999, bgcolor: trackBg,
      position: 'relative', overflow: 'hidden',
    }}>
      {!loading && v && (
        <Box sx={{
          position: 'absolute', top: 0, bottom: 0,
          [side === 'away' ? 'right' : 'left']: 0,
          // Floor keeps a last-in-MLB value visible rather than zero-width.
          width: `${Math.max(5, v.pct * 100)}%`,
          bgcolor: color, opacity: better ? 1 : 0.4,
          borderRadius: 999,
          transition: 'width 0.35s ease, opacity 0.2s',
        }} />
      )}
    </Box>
  )

  const row = (def: typeof TEAM_STAT_DEFS[number]) => {
    const a = awayStats?.[def.key]
    const h = homeStats?.[def.key]
    // Rank already encodes direction (1 = best), so it decides the winner for
    // both higher-is-better and lower-is-better stats.
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

  // A hairline rule with the group name set into it — separates Offense from
  // Pitching without another heavy all-caps header competing with the labels.
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
      {TEAM_STAT_DEFS.filter(d => d.group === group).map(row)}
    </Box>
  )

  // Team chip — a colored dot tying the abbr to its bars.
  const teamChip = (abbr: string, color: string, align: 'right' | 'left') => (
    <Box sx={{
      flex: 1, display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0,
      flexDirection: align === 'right' ? 'row-reverse' : 'row',
    }}>
      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color, lineHeight: 1 }}>
        {abbr}
      </Typography>
    </Box>
  )

  return (
    <Box sx={{ borderTop: '1px solid', borderColor: 'divider', px: 2, py: 1.5 }}>
      <Box sx={{ mb: 1 }}>
        <SectionLabel>Season Comparison</SectionLabel>
      </Box>

      {/* Legend: which color is which club */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
        {teamChip(away.abbr, awayColor, 'right')}
        <Typography sx={{ fontSize: '0.54rem', fontWeight: 700, color: 'text.disabled', flexShrink: 0, lineHeight: 1 }}>
          VS
        </Typography>
        {teamChip(home.abbr, homeColor, 'left')}
      </Box>

      {groupBlock('hitting', 'Offense')}
      {groupBlock('pitching', 'Pitching')}

      <Typography sx={{ fontSize: '0.52rem', color: 'text.disabled', mt: 1, textAlign: 'center', lineHeight: 1.5 }}>
        {CURRENT_SEASON} season · bar length = rank among all 30 clubs, longer is better
      </Typography>
    </Box>
  )
}

// ─── Game preview modal ───────────────────────────────────────────────────────

export function GamePreviewModal({ game, onClose, onPlayerClick, onTeamClick, onPrev, onNext }: {
  game: PreviewGame
  onClose: () => void
  onPlayerClick?: (id: number) => void
  onTeamClick?:   (id: number) => void
  // Jump to the previous / next scheduled game without leaving the popup. Undefined at
  // the ends of the list (arrow hidden).
  onPrev?: () => void
  onNext?: () => void
}) {
  useScrollLock()
  // Tag the loaded data with the game it belongs to. When `game` switches (‹ › nav) the
  // tag no longer matches, so `loading` flips true immediately — the skeleton shows in the
  // very first frame instead of briefly re-showing the previous game's pitchers.
  const [entry, setEntry] = useState<{ pk: number; data: GamePreviewData | null } | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchGamePreview(game.gamePk).then(d => { if (!cancelled) setEntry({ pk: game.gamePk, data: d }) })
    return () => { cancelled = true }
  }, [game.gamePk])
  const loading = !entry || entry.pk !== game.gamePk
  const preview = loading ? null : entry!.data

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft'  && onPrev) { e.preventDefault(); onPrev() }
      else if (e.key === 'ArrowRight' && onNext) { e.preventDefault(); onNext() }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose, onPrev, onNext])

  const isDark = useIsDark()

  // Shimmer placeholder block — reserves the pitcher card's full height while probable
  // starters load, so stepping between games with ‹ › doesn't collapse then re-expand.
  const shimmerSx = {
    bgcolor: 'action.hover', borderRadius: 0.75,
    '@keyframes pvPulse': { '0%,100%': { opacity: 0.5 }, '50%': { opacity: 0.85 } },
    animation: 'pvPulse 1.1s ease-in-out infinite',
  } as const

  function PitcherCard({ pitcher, team, loading }: { pitcher: ProbablePitcher | null; team: { teamId: number; abbr: string }; loading?: boolean }) {
    const teamColor  = TEAM_BG[team.teamId] ?? '#444'
    const accentText = accentColor(teamColor, isDark)
    const clickable  = !loading && !!pitcher && !!onPlayerClick
    return (
      <Box
        onClick={clickable ? () => { onPlayerClick!(pitcher!.id); onClose() } : undefined}
        sx={{
          flex: 1, p: 1.5, borderRadius: 2,
          bgcolor: `${teamColor}10`,
          border: '1px solid', borderColor: borderAlpha(teamColor, isDark),
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75,
          cursor: clickable ? 'pointer' : 'default',
          transition: 'border-color 0.15s',
          ...(clickable ? { '&:hover': { borderColor: `${teamColor}60` } } : {}),
        }}
      >
        {/* Headshot (or its shimmer while loading) */}
        <Box sx={{
          width: 58, height: 70, borderRadius: 1.5, overflow: 'hidden',
          border: `2px solid ${photoBorderAlpha(teamColor, isDark)}`, bgcolor: 'action.hover', flexShrink: 0,
          ...(loading ? shimmerSx : {}),
        }}>
          {!loading && (pitcher ? (
            <Box component="img"
              src={HEADSHOT(pitcher.id)} alt={pitcher.name}
              sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%', display: 'block' }}
            />
          ) : (
            <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography sx={{ fontSize: '1.4rem', lineHeight: 1 }}>?</Typography>
            </Box>
          ))}
        </Box>

        {/* Name / hand (or shimmer bars) */}
        {loading ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, py: 0.15 }}>
            <Box sx={{ ...shimmerSx, width: 84, height: '0.86rem' }} />
            <Box sx={{ ...shimmerSx, width: 52, height: '0.56rem' }} />
          </Box>
        ) : (
          <Box sx={{ textAlign: 'center', minWidth: 0 }}>
            <Typography sx={{
              fontWeight: 800, fontSize: '0.8rem', lineHeight: 1.2,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {pitcher?.name ?? 'TBD'}
            </Typography>
            <Typography sx={{ fontSize: '0.62rem', color: 'text.secondary', lineHeight: 1, mt: 0.2 }}>
              {pitcher ? `${pitcher.hand}HP · ${team.abbr}` : team.abbr}
            </Typography>
          </Box>
        )}

        {/* Stat row — real numbers, shimmer cells while loading, or nothing for a TBD starter */}
        {loading ? (
          <Box sx={{ display: 'flex', gap: 1.25, justifyContent: 'center' }}>
            {[0, 1, 2, 3].map(i => (
              <Box key={i} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.35 }}>
                <Box sx={{ ...shimmerSx, width: 20, height: '0.8rem' }} />
                <Box sx={{ ...shimmerSx, width: 16, height: '0.46rem' }} />
              </Box>
            ))}
          </Box>
        ) : pitcher ? (
          <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap', justifyContent: 'center' }}>
            {[
              { label: 'W-L',  value: pitcher.era !== null ? `${pitcher.wins}-${pitcher.losses}` : '—' },
              { label: 'ERA',  value: pitcher.era  ?? '—' },
              { label: 'WHIP', value: pitcher.whip ?? '—' },
              { label: 'K',    value: String(pitcher.k) },
            ].map(s => (
              <Box key={s.label} sx={{ textAlign: 'center' }}>
                <Typography sx={{ fontSize: '0.9rem', fontWeight: 900, lineHeight: 1, color: accentText, letterSpacing: '-0.3px' }}>
                  {s.value}
                </Typography>
                <Typography sx={{
                  fontSize: '0.56rem', fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: 0.4, color: 'text.secondary', lineHeight: 1, mt: 0.2,
                }}>
                  {s.label}
                </Typography>
              </Box>
            ))}
          </Box>
        ) : null}
      </Box>
    )
  }

  const teamSide = (t: { teamId: number; abbr: string }) => (
    <Box
      onClick={onTeamClick ? () => { onTeamClick(t.teamId); onClose() } : undefined}
      sx={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.6,
        cursor: onTeamClick ? 'pointer' : 'default',
      }}
    >
      <LogoBubble teamId={t.teamId} abbr={t.abbr} size={48} ring={2.5} />
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'text.secondary', lineHeight: 1 }}>{t.abbr}</Typography>
    </Box>
  )

  // Prev/next-game arrows straddling the card edges — half in the backdrop margin, half
  // over the card's padding gutter so they never cover content. Vertically centered.
  const navArrowSx = (side: 'left' | 'right') => ({
    position: 'absolute' as const, top: '50%', [side]: 0,
    transform: side === 'left' ? 'translate(-50%, -50%)' : 'translate(50%, -50%)',
    zIndex: 2, width: 36, height: 36, borderRadius: '50%',
    bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
    color: 'text.secondary',
    transition: 'background-color 0.12s, color 0.12s',
    '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
  } as const)

  return (
    <Box
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      sx={{
        position: 'fixed', inset: 0, zIndex: 1500,
        bgcolor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        p: { xs: 1, sm: 2 },
      }}
    >
      <Box sx={{ position: 'relative', width: '100%', maxWidth: 480, maxHeight: '100%', display: 'flex' }}>
        {onPrev && (
          <Box onClick={e => { e.stopPropagation(); onPrev() }} sx={navArrowSx('left')} aria-label="Previous game">
            <ChevronLeft sx={{ fontSize: '1.4rem' }} />
          </Box>
        )}
        {onNext && (
          <Box onClick={e => { e.stopPropagation(); onNext() }} sx={navArrowSx('right')} aria-label="Next game">
            <ChevronRight sx={{ fontSize: '1.4rem' }} />
          </Box>
        )}
      <Box sx={{
        bgcolor: 'background.paper', borderRadius: 3,
        border: '1px solid', borderColor: 'divider',
        width: '100%',
        // `100%` of the padded fixed overlay (not `vh`) so the card stays on-screen
        // under the desktop `zoom` wrapper, which doesn't shrink viewport units.
        maxHeight: '100%', overflowY: 'auto',
        boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        '&::-webkit-scrollbar': { width: 4 },
        '&::-webkit-scrollbar-thumb': { bgcolor: 'divider', borderRadius: 2 },
      }}>

        {/* Header */}
        <Box sx={{
          px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider',
          display: 'flex', alignItems: 'center', gap: 1,
          position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 1,
        }}>
          <Typography sx={{
            flex: 1, fontWeight: 800, fontSize: '0.72rem', color: 'text.secondary',
            textTransform: 'uppercase', letterSpacing: 1, lineHeight: 1,
          }}>
            {game.statusText === 'Postponed'
              ? (game.reason ? `Postponed · ${game.reason}` : 'Postponed')
              : `Preview · ${game.statusText}`}
          </Typography>
          <Box
            onClick={onClose}
            sx={{
              flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'text.disabled',
              '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
            }}
          >
            <Typography sx={{ fontSize: '0.75rem', lineHeight: 1 }}>✕</Typography>
          </Box>
        </Box>

        {/* Matchup */}
        <Box sx={{ px: 2, pt: 2.5, pb: 1.75, display: 'flex', alignItems: 'center', gap: 1 }}>
          {teamSide(game.away)}
          <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled', px: 1 }}>@</Typography>
          {teamSide(game.home)}
        </Box>

        {/* Venue + weather — one line. While loading, a placeholder occupies exactly one
            text line-box (fontSize × line-height) so the card height doesn't grow the
            few px a raw-height bar would miss when the real text arrives. */}
        {loading ? (
          <Box sx={{ px: 2, pb: 1.5, display: 'flex', justifyContent: 'center' }}>
            <Box sx={{ height: 'calc(0.68rem * 1.4)', display: 'flex', alignItems: 'center' }}>
              <Box sx={{ ...shimmerSx, width: 176, height: '0.62rem' }} />
            </Box>
          </Box>
        ) : preview && (preview.venueName || preview.weather) ? (
          <Box sx={{ px: 2, pb: 1.5 }}>
            <Typography sx={{ fontSize: '0.68rem', lineHeight: 1.4, color: 'text.secondary', textAlign: 'center' }}>
              {[
                preview.venueName || null,
                preview.weather ? `${preview.weather.temp}°F · ${preview.weather.condition}${preview.weather.wind ? ` · ${preview.weather.wind}` : ''}` : null,
              ].filter(Boolean).join('  ·  ')}
            </Typography>
          </Box>
        ) : null}

        {/* Probable starters */}
        <Box sx={{ borderTop: '1px solid', borderColor: 'divider', px: 2, py: 1.5 }}>
          <Typography sx={{
            fontSize: '0.58rem', fontWeight: 700, color: 'text.disabled',
            textTransform: 'uppercase', letterSpacing: 0.8, lineHeight: 1, mb: 1.25,
          }}>
            Probable Starters
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <PitcherCard pitcher={preview?.awayPitcher ?? null} team={game.away} loading={loading} />
            <PitcherCard pitcher={preview?.homePitcher ?? null} team={game.home} loading={loading} />
          </Box>
        </Box>

        {/* How the two clubs stack up on the season */}
        <TeamComparison away={game.away} home={game.home} />

      </Box>
      </Box>
    </Box>
  )
}

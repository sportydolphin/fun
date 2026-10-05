// Game preview modal: the pre-game matchup card (probable pitchers, weather,
// season-stat comparison bars) shown from the Scores scoreboard and the team
// ScheduleStrip. Extracted from FinalGames.tsx.

import React, { useState, useEffect } from 'react'
import { Box, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'
import { ChevronLeft, ChevronRight } from '@mui/icons-material'
import { TEAM_BG, HEADSHOT, CURRENT_SEASON } from '../constants'
import { useIsDark, accentColor, borderAlpha, photoBorderAlpha, textTone } from '../lib/colorUtils'
import { ModalShell } from '../../ui/ModalShell'
import { useSheetHistory } from '../state/sheetHistory'
import { useGameSeo } from '../state/gameSeo'
import { mlbGamePath } from '../routes'
import { MlbCopyLink } from '../components/CopyLink'
import { fetchTeamSeasonStats, TEAM_STAT_DEFS, TeamSeasonStats, TeamStatValue } from '../api'
import { LogoBubble, SectionLabel } from '../components/boxScore'
import { chromePx, typePx } from '../../ui/scale'
import { MlbHiddenH1 } from '../components/PageHeading'

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
// objects, so both surfaces render the exact same preview card.
export interface PreviewGame {
  gamePk:     number
  statusText: string
  reason?:    string          // why it was not played ("Rain"/...) when statusText is "Postponed" or "Cancelled"
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

// Plenty of matchups are two navy clubs (MIN/CLE) or two red ones (BOS/STL), and
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
  // Held to AA like the club colours above them (accentColor): these are printed as the numbers.
  return hueGap < MIN_HUE_GAP ? [textTone(FALLBACK_AWAY, isDark, isDark ? undefined : '#f6f7f9'), textTone(FALLBACK_HOME, isDark, isDark ? undefined : '#f6f7f9')] : [a, h]
}

// Head-to-head season splits for the two clubs. Each row is a diverging bar
// scaled to the league's range for that stat, so the two sides can be read
// against each other and against MLB at a glance. Bars always grow toward
// "better", including for ERA/WHIP/BAA where the lower number wins.
// Purely informational, so a failed fetch renders nothing rather than an error.
export function TeamComparison({ away, home, sx }: {
  away: { teamId: number; abbr: string }
  home: { teamId: number; abbr: string }
  /** The series sheet sets its own gutter and divider; the preview keeps these. */
  sx?: SxProps<Theme>
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
    <Box sx={{ width: chromePx(42), flexShrink: 0, textAlign: align }}>
      {loading ? (
        <Box sx={{ ...shimmer, width: chromePx(32), height: '0.8rem', ml: align === 'right' ? 'auto' : 0 }} />
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
      flex: 1, minWidth: 0, height: chromePx(8), borderRadius: 999, bgcolor: trackBg,
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
          flexShrink: 0, width: '2.375rem', textAlign: 'center',
          fontSize: '0.56rem', fontWeight: 800, color: 'text.secondary',
          textTransform: 'uppercase', letterSpacing: typePx(0.4), lineHeight: 1,
        }}>
          {def.label}
        </Typography>
        {bar(h, homeBetter, homeColor, 'home')}
        {valueCell(h, homeBetter, homeColor, 'left')}
      </Box>
    )
  }

  // A hairline rule with the group name set into it, separating Offense from
  // Pitching without another heavy all-caps header competing with the labels.
  const groupBlock = (group: 'hitting' | 'pitching', label: string) => (
    <Box sx={{ mt: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.4 }}>
        <Typography sx={{
          fontSize: '0.5rem', fontWeight: 800, color: 'text.disabled',
          textTransform: 'uppercase', letterSpacing: typePx(1), lineHeight: 1, flexShrink: 0,
        }}>
          {label}
        </Typography>
        <Box sx={{ flex: 1, height: '1px', bgcolor: 'divider' }} />
      </Box>
      {TEAM_STAT_DEFS.filter(d => d.group === group).map(row)}
    </Box>
  )

  // Team chip: a colored dot tying the abbr to its bars.
  const teamChip = (abbr: string, color: string, align: 'right' | 'left') => (
    <Box sx={{
      flex: 1, display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0,
      flexDirection: align === 'right' ? 'row-reverse' : 'row',
    }}>
      <Box sx={{ width: chromePx(8), height: chromePx(8), borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color, lineHeight: 1 }}>
        {abbr}
      </Typography>
    </Box>
  )

  return (
    <Box sx={[{ borderTop: '1px solid', borderColor: 'divider', px: 2, py: 1.5 }, ...(Array.isArray(sx) ? sx : [sx])]}>
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
  // Back closes the sheet rather than leaving the section; see sheetHistory.ts. The entry carries
  // the game's address, and follows the ‹ › arrows from one game to the next.
  const close = useSheetHistory(onClose, mlbGamePath(game.gamePk))
  const heading = useGameSeo({ ...game, state: 'preview' })
  // Tag the loaded data with the game it belongs to. When `game` switches (‹ › nav) the
  // tag no longer matches, so `loading` flips true immediately and the skeleton shows in the
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
      // Escape is ModalShell's, and goes through `close`.
      if (e.key === 'ArrowLeft'  && onPrev) { e.preventDefault(); onPrev() }
      else if (e.key === 'ArrowRight' && onNext) { e.preventDefault(); onNext() }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onPrev, onNext])

  const isDark = useIsDark()

  // Shimmer placeholder block that reserves the pitcher card's full height while probable
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
          width: chromePx(58), height: chromePx(70), borderRadius: 1.5, overflow: 'hidden',
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
            <Box sx={{ ...shimmerSx, width: chromePx(84), height: '0.86rem' }} />
            <Box sx={{ ...shimmerSx, width: chromePx(52), height: '0.56rem' }} />
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

        {/* Stat row: real numbers, shimmer cells while loading, or nothing for a TBD starter */}
        {loading ? (
          <Box sx={{ display: 'flex', gap: 1.25, justifyContent: 'center' }}>
            {[0, 1, 2, 3].map(i => (
              <Box key={i} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.35 }}>
                <Box sx={{ ...shimmerSx, width: chromePx(20), height: '0.8rem' }} />
                <Box sx={{ ...shimmerSx, width: chromePx(16), height: '0.46rem' }} />
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
                <Typography sx={{ fontSize: '0.9rem', fontWeight: 900, lineHeight: 1, color: accentText, letterSpacing: typePx(-0.3) }}>
                  {s.value}
                </Typography>
                <Typography sx={{
                  fontSize: '0.56rem', fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: typePx(0.4), color: 'text.secondary', lineHeight: 1, mt: 0.2,
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

  // Prev/next-game arrows, in the sheet's header beside the close button. They used to straddle the
  // card's edges, which a bottom sheet the width of a phone has nowhere to put.
  const navArrowSx = {
    flexShrink: 0, width: chromePx(26), height: chromePx(26), borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', color: 'text.secondary',
    '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
  } as const
  const unplayed = game.statusText === 'Postponed' || game.statusText === 'Cancelled'

  return (
    <ModalShell
      onClose={close}
      maxWidth={chromePx(480)}
      sheet
      eyebrow={unplayed
        ? (game.reason ? `${game.statusText} · ${game.reason}` : game.statusText)
        : `Preview · ${game.statusText}`}
      actions={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
          <MlbCopyLink target={{ kind: 'game', gamePk: game.gamePk }} title="Copy a link to this game" />
          {(onPrev || onNext) && <>
            <Box onClick={onPrev} aria-label="Previous game" role="button"
              sx={{ ...navArrowSx, visibility: onPrev ? 'visible' : 'hidden' }}>
              <ChevronLeft sx={{ fontSize: '1.2rem' }} />
            </Box>
            <Box onClick={onNext} aria-label="Next game" role="button"
              sx={{ ...navArrowSx, visibility: onNext ? 'visible' : 'hidden' }}>
              <ChevronRight sx={{ fontSize: '1.2rem' }} />
            </Box>
          </>}
        </Box>
      }
    >
      {/* While the sheet is up the game is the page (PageHeading.tsx). */}
      <MlbHiddenH1>{heading}</MlbHiddenH1>
        {/* Matchup */}
        <Box sx={{ px: 2, pt: 2.5, pb: 1.75, display: 'flex', alignItems: 'center', gap: 1 }}>
          {teamSide(game.away)}
          <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled', px: 1 }}>@</Typography>
          {teamSide(game.home)}
        </Box>

        {/* Venue + weather on one line. While loading, a placeholder occupies exactly one
            text line-box (fontSize × line-height) so the card height doesn't grow the
            few px a raw-height bar would miss when the real text arrives. */}
        {loading ? (
          <Box sx={{ px: 2, pb: 1.5, display: 'flex', justifyContent: 'center' }}>
            <Box sx={{ height: 'calc(0.68rem * 1.4)', display: 'flex', alignItems: 'center' }}>
              <Box sx={{ ...shimmerSx, width: chromePx(176), height: '0.62rem' }} />
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
            textTransform: 'uppercase', letterSpacing: typePx(0.8), lineHeight: 1, mb: 1.25,
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
    </ModalShell>
  )
}

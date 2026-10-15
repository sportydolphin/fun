// Game preview modal: the pre-game matchup card (probable pitchers, weather,
// season-stat comparison bars) shown from the Scores scoreboard and the team
// ScheduleStrip. MLB's binding of src/ui/gamePreview.tsx: it feeds StatsAPI's numbers, the
// club logos, headshots and links, and fills the probable-starters slot only StatsAPI has.

import { useDark } from '../../ui/useDark'
import { TeamLogo } from '../components/TeamLogo'
import { pressable } from '../../ui/interaction'
import { edge, TYPE_SCALE, ICON_SIZE } from '../../ui/card'
import { useState, useEffect } from 'react'
import { Box, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'
import { ChevronLeft, ChevronRight } from '@mui/icons-material'
import { TEAM_BG, HEADSHOT, CURRENT_SEASON } from '../constants'
import { accentColor, textTone } from '../lib/colorUtils'
import { ModalShell, useOpensAsPanel } from '../../ui/ModalShell'
import { useSheetHistory } from '../state/sheetHistory'
import { useGameSeo } from '../state/gameSeo'
import { mlbGamePath } from '../routes'
import { MlbCopyLink } from '../components/CopyLink'
import { fetchTeamSeasonStats, TEAM_STAT_DEFS, TeamSeasonStats } from '../api'
import { ComparisonBars, MatchupHeader, PreviewFrame, PreviewHeading, PREVIEW_SHIMMER, type PreviewSide } from '../../ui/gamePreview'
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

// MLB's binding of the season comparison (the drawing is src/ui/gamePreview.tsx): StatsAPI's team
// season stats, the club logos, and the hue check above, which WPBL's four clubs never need.
// Purely informational, so a failed fetch renders nothing rather than an error.
export function TeamComparison({ away, home, sx, onTeamClick }: {
  away: { teamId: number; abbr: string }
  home: { teamId: number; abbr: string }
  /** The series sheet sets its own gutter and divider; the preview keeps these. */
  sx?: SxProps<Theme>
  /** Open a club from its chip in the legend. */
  onTeamClick?: (id: number) => void
}) {
  const isDark = useDark()
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
  const side = (t: { teamId: number; abbr: string }, color: string): PreviewSide => ({
    abbr: t.abbr, color,
    mark: size => <TeamLogo teamId={t.teamId} abbr={t.abbr} size={size} />,
    onOpen: onTeamClick ? () => onTeamClick(t.teamId) : undefined,
    openLabel: `${t.abbr} team page`,
  })

  return (
    <PreviewFrame
      sx={[{ borderTop: '1px solid', borderColor: 'divider' }, ...(Array.isArray(sx) ? sx : [sx])]}
      boards={[{
        value: 'comparison', label: 'Matchup',
        node: (
          <ComparisonBars
            away={side(away, awayColor)} home={side(home, homeColor)} defs={TEAM_STAT_DEFS}
            awayStats={awayStats} homeStats={homeStats} loading={loading}
            footnote={`${CURRENT_SEASON} season · bar length = rank among all 30 clubs, longer is better`}
          />
        ),
      }]}
    />
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
  // On a desktop, the side panel, as Game Center is. See sheetHistory.ts for what that changes.
  const asPanel = useOpensAsPanel()
  const close = useSheetHistory(onClose, mlbGamePath(game.gamePk), { panel: asPanel })
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

  const isDark = useDark()
  const openTeam = onTeamClick ? (id: number) => { onTeamClick(id); onClose() } : undefined

  // The probable starter's card, the slot only StatsAPI can fill. Every line of its loading
  // shape is the loaded line's own box (font size times line height), so stepping between games
  // with ‹ › neither collapses nor re-expands the card.
  // Called as a function, not rendered as <PitcherCard>: declared inside this component, it would be
  // a new component type on every render, so React would remount the card and reload its headshot.
  function pitcherCard({ pitcher, team, loading }: { pitcher: ProbablePitcher | null; team: { teamId: number; abbr: string }; loading?: boolean }) {
    const teamColor  = TEAM_BG[team.teamId] ?? '#444'
    const accentText = accentColor(teamColor, isDark)
    const clickable  = !loading && !!pitcher && !!onPlayerClick
    const line = (size: string, lineHeight: number, width: number, mt = 0) => (
      <Box sx={{ height: `calc(${size} * ${lineHeight})`, mt, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Box sx={{ ...PREVIEW_SHIMMER, width: chromePx(width), height: '80%' }} />
      </Box>
    )
    return (
      <Box
        {...pressable(clickable ? () => { onPlayerClick!(pitcher!.id); onClose() } : undefined)}
        sx={{
          flex: 1, p: 1.5, borderRadius: 2,
          bgcolor: `${teamColor}10`,
          border: '1px solid', borderColor: edge(teamColor),
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75,
          cursor: clickable ? 'pointer' : 'default',
          transition: 'border-color 0.15s',
          ...(clickable ? { '&:hover': { borderColor: edge(teamColor) } } : {}),
        }}
      >
        {/* Headshot (or its shimmer while loading) */}
        <Box sx={{
          width: chromePx(58), height: chromePx(70), borderRadius: 1.5, overflow: 'hidden',
          border: '2px solid', borderColor: edge(teamColor), bgcolor: 'action.hover', flexShrink: 0,
          ...(loading ? PREVIEW_SHIMMER : {}),
        }}>
          {!loading && (pitcher ? (
            <Box component="img"
              src={HEADSHOT(pitcher.id)} alt={pitcher.name}
              sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%', display: 'block' }}
            />
          ) : (
            <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography sx={{ fontSize: TYPE_SCALE.page, lineHeight: 1 }}>?</Typography>
            </Box>
          ))}
        </Box>

        {/* Name / hand (or shimmer bars) */}
        {loading ? (
          <Box>
            {line(TYPE_SCALE.body, 1.2, 84)}
            {line(TYPE_SCALE.caption, 1, 52, 0.2)}
          </Box>
        ) : (
          <Box sx={{ textAlign: 'center', minWidth: 0 }}>
            <Typography sx={{
              fontWeight: 800, fontSize: TYPE_SCALE.body, lineHeight: 1.2,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {pitcher?.name ?? 'TBD'}
            </Typography>
            <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.secondary', lineHeight: 1, mt: 0.2 }}>
              {pitcher ? `${pitcher.hand}HP · ${team.abbr}` : team.abbr}
            </Typography>
          </Box>
        )}

        {/* Stat row: real numbers, shimmer cells while loading, or nothing for a TBD starter */}
        {loading ? (
          <Box sx={{ display: 'flex', gap: 1.25, justifyContent: 'center' }}>
            {[0, 1, 2, 3].map(i => (
              <Box key={i}>
                {line(TYPE_SCALE.title, 1, 20)}
                {line(TYPE_SCALE.caption, 1, 16, 0.2)}
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
                {/* 800, the comparison's own winner weight: at 900 a club accent on a tabular
                    figure closes up its counters. */}
                <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, lineHeight: 1, color: accentText, letterSpacing: typePx(-0.3) }}>
                  {s.value}
                </Typography>
                <Typography sx={{
                  fontSize: TYPE_SCALE.caption, fontWeight: 700, textTransform: 'uppercase',
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

  const headerSide = (t: { teamId: number; abbr: string }) => ({
    abbr: t.abbr,
    mark: (size: number) => <TeamLogo teamId={t.teamId} abbr={t.abbr} size={size} />,
    onOpen: openTeam ? () => openTeam(t.teamId) : undefined,
    openLabel: `${t.abbr} team page`,
  })

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
      panel
      openKey={game.gamePk}
      eyebrow={unplayed
        ? (game.reason ? `${game.statusText} · ${game.reason}` : game.statusText)
        : `Preview · ${game.statusText}`}
      actions={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
          <MlbCopyLink target={{ kind: 'game', gamePk: game.gamePk }} title="Copy a link to this game" />
          {(onPrev || onNext) && <>
            <Box {...pressable(onPrev)} aria-label="Previous game"
              sx={{ ...navArrowSx, visibility: onPrev ? 'visible' : 'hidden' }}>
              <ChevronLeft sx={{ fontSize: ICON_SIZE.md }} />
            </Box>
            <Box {...pressable(onNext)} aria-label="Next game"
              sx={{ ...navArrowSx, visibility: onNext ? 'visible' : 'hidden' }}>
              <ChevronRight sx={{ fontSize: ICON_SIZE.md }} />
            </Box>
          </>}
        </Box>
      }
    >
      {/* While the sheet is up the game is the page (PageHeading.tsx). */}
      <MlbHiddenH1>{heading}</MlbHiddenH1>
        <MatchupHeader away={headerSide(game.away)} home={headerSide(game.home)} />

        {/* Venue + weather on one line, the meta under the matchup. While loading, a placeholder
            occupies exactly one text line-box (fontSize × line-height) so the card height doesn't
            grow the few px a raw-height bar would miss when the real text arrives. */}
        {loading ? (
          <Box sx={{ px: 2, pt: 1, pb: 1.5, display: 'flex', justifyContent: 'center' }}>
            <Box sx={{ height: `calc(${TYPE_SCALE.meta} * 1.4)`, display: 'flex', alignItems: 'center' }}>
              <Box sx={{ ...PREVIEW_SHIMMER, width: chromePx(176), height: '0.62rem' }} />
            </Box>
          </Box>
        ) : preview && (preview.venueName || preview.weather) ? (
          <Box sx={{ px: 2, pt: 1, pb: 1.5 }}>
            <Typography sx={{ fontSize: TYPE_SCALE.meta, lineHeight: 1.4, color: 'text.secondary', textAlign: 'center' }}>
              {[
                preview.venueName || null,
                preview.weather ? `${preview.weather.temp}°F · ${preview.weather.condition}${preview.weather.wind ? ` · ${preview.weather.wind}` : ''}` : null,
              ].filter(Boolean).join('  ·  ')}
            </Typography>
          </Box>
        ) : <Box sx={{ pb: 1.5 }} />}

        {/* Probable starters */}
        <Box sx={{ borderTop: '1px solid', borderColor: 'divider', px: 2, py: 1.5 }}>
          <PreviewHeading>Probable Starters</PreviewHeading>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            {pitcherCard({ pitcher: preview?.awayPitcher ?? null, team: game.away, loading })}
            {pitcherCard({ pitcher: preview?.homePitcher ?? null, team: game.home, loading })}
          </Box>
        </Box>

        {/* How the two clubs stack up on the season */}
        <TeamComparison away={game.away} home={game.home} onTeamClick={openTeam} />
    </ModalShell>
  )
}

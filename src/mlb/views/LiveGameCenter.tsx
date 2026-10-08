import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Box, Typography, useMediaQuery } from '@mui/material'
import { TEAM_BG, TEAM_ABBR, TEAM_NICKNAME, HEADSHOT, TONE } from '../constants'
import { useIsDark, accentColor, chartPairColors, inkOn, textTone, borderAlpha, photoBorderAlpha, useTextTone } from '../lib/colorUtils'
import { ModalShell, useOpensAsPanel } from '../../ui/ModalShell'
import { useSheetHistory } from '../state/sheetHistory'
import { useGameSeo } from '../state/gameSeo'
import { mlbGamePath } from '../routes'
import { MlbCopyLink } from '../components/CopyLink'
import { teamLink, LINK_SX } from '../lib/links'
import { hoverOnly, pressable, FOCUS_RING } from '../../ui/interaction'
import { FinalGameSummary } from './FinalGames'
import { useForegroundInterval } from '../../lib/foregroundInterval'
import { scrollBehavior } from '../../lib/motion'
import {
  BoxScore, parseBoxScoreData,
  LogoBubble, LiveDot, TeamBoxSection,
} from '../components/boxScore'
import { chromePx, typePx } from '../../ui/scale'
import { MlbHiddenH1, MlbAddressH1 } from '../components/PageHeading'
import { DetailPageBar } from '../../ui/DetailPageBar'
import { ExpandButton } from '../../ui/ExpandButton'
import { GC_CAPS, GC_META, GC_BODY, runGreen } from './gameType'
import { useChartScrub } from '../../ui/chartScrub'
import { pushEntry, sheetOpenAt, stackNextPanel } from '../state/sheetHistory'
import { openPlayerPanel } from '../state/playerPanel'
import { expandGameToPage } from '../state/gamePage'
import { track, EVENTS } from '../../lib/analytics'
import { mlbSeriesPath } from '../routes'
import {
  useGameSeries, SeriesBand, SeriesBandSkeleton, TopPerformers, BiggestSwings, GameInfo, biggestSwings,
} from './GameSummary'
import type { Performer, GameInfoData } from './GameSummary'

// ─── Types ────────────────────────────────────────────────────────────────────

interface GcTeam {
  teamId: number
  abbr:   string
  name:   string
  runs:   number
  hits:   number
  errors: number
}

interface GcMatchupPlayer {
  id:    number
  name:  string
  line1: string   // today's line: "2-3 today" / "5.1 IP · 6 K"
  line2: string   // season context: "AVG .312 · OPS .901" / "72 pitches · ERA 3.21"
}

interface GcSituation {
  batter:        GcMatchupPlayer | null
  pitcher:       GcMatchupPlayer | null
  onFirst:       boolean
  onSecond:      boolean
  onThird:       boolean
  balls:          number
  strikes:        number
  outs:           number
  betweenInnings: boolean   // Middle/End of inning: count/outs/bases don't apply; batter+pitcher are "due up"
  battingTeamId:  number
  fieldingTeamId: number
}

interface GcPlay {
  atBatIndex:    number
  inning:        number
  half:          'top' | 'bottom'
  isScoring:     boolean
  event:         string
  description:   string
  awayScore:     number
  homeScore:     number
  battingTeamId: number
  batter:        string
  pitcher:       string
  outs:          number
}

interface GameCenterData {
  state:      'preview' | 'live' | 'final'
  statusText: string
  away:       GcTeam
  home:       GcTeam
  situation:  GcSituation | null   // only while live
  plays:      GcPlay[]             // chronological
  box:        BoxScore
  gameType:   string               // StatsAPI's: R, F, D, L, W, ...
  season:     number
  performers: Performer[]          // the feed's own top performers
  info:       GameInfoData
}

interface WpPoint {
  wp:         number   // home team win probability after the play, 0–100
  before:     number   // and before it
  inning:     number
  atBatIndex: number   // joins to a GcPlay for hover detail
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchGameCenter(gamePk: number): Promise<GameCenterData | null> {
  try {
    const r  = await fetch(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`)
    const d  = await r.json()
    const gd = d.gameData ?? {}
    const ld = d.liveData ?? {}
    const ls = ld.linescore ?? {}

    const abs = gd.status?.abstractGameState
    // Warmup reports "Live" ~20 min before first pitch, so treat it as a preview.
    const state: GameCenterData['state'] =
      abs === 'Final' ? 'final'
      : abs === 'Live' && gd.status?.detailedState !== 'Warmup' ? 'live'
      : 'preview'

    const mkTeam = (side: 'home' | 'away'): GcTeam => {
      const t   = gd.teams?.[side] ?? {}
      const lst = ls.teams?.[side] ?? {}
      const id  = Number(t.id ?? 0)
      return {
        teamId: id,
        abbr:   TEAM_ABBR[id] ?? t.abbreviation ?? '???',
        name:   t.name ?? '',
        runs:   lst.runs   ?? 0,
        hits:   lst.hits   ?? 0,
        errors: lst.errors ?? 0,
      }
    }
    const away = mkTeam('away')
    const home = mkTeam('home')

    let statusText: string
    const ord = ls.currentInningOrdinal
    if (state === 'final') {
      const scheduled = ls.scheduledInnings ?? 9
      const played    = ls.currentInning ?? scheduled
      statusText = played > scheduled ? `Final/${played}` : 'Final'
    } else if (state === 'live' && ord) {
      const st = ls.inningState
      statusText =
        st === 'Middle' ? `Mid ${ord}` :
        st === 'End'    ? `End ${ord}` :
        `${ls.isTopInning ? '▲' : '▼'} ${ord}`
    } else {
      statusText = gd.status?.detailedState ?? '—'
    }

    let situation: GcSituation | null = null
    if (state === 'live') {
      const off     = ls.offense ?? {}
      const def     = ls.defense ?? {}
      const isTop   = Boolean(ls.isTopInning)
      const between = ls.inningState === 'Middle' || ls.inningState === 'End'
      const batSide = isTop ? 'away' : 'home'
      const pitSide = isTop ? 'home' : 'away'
      const batPlayers = ld.boxscore?.teams?.[batSide]?.players ?? {}
      const pitPlayers = ld.boxscore?.teams?.[pitSide]?.players ?? {}

      const mkBatter = (raw: any): GcMatchupPlayer | null => {
        if (!raw?.id) return null
        const p = batPlayers[`ID${raw.id}`] ?? {}
        const g = p.stats?.batting ?? {}
        const s = p.seasonStats?.batting ?? {}
        // A walk is a plate appearance with 0 AB, so key off PA (not AB) to know they've batted.
        const played     = (g.plateAppearances ?? 0) > 0
        const gameLine   = `${g.hits ?? 0}-${g.atBats ?? 0} today`
        const seasonLine = `AVG ${s.avg ?? '—'} · OPS ${s.ops ?? '—'}`
        return {
          id:    Number(raw.id),
          name:  raw.fullName ?? '—',
          // Due up, one line: game stats once they've batted (incl. a walk), else season stats.
          line1: between ? (played ? gameLine : seasonLine) : (played ? gameLine : 'First AB'),
          line2: between ? '' : seasonLine,
        }
      }

      const mkPitcher = (raw: any): GcMatchupPlayer | null => {
        if (!raw?.id) return null
        const p = pitPlayers[`ID${raw.id}`] ?? {}
        const g = p.stats?.pitching ?? {}
        const s = p.seasonStats?.pitching ?? {}
        const pitches = g.pitchesThrown ?? g.numberOfPitches
        const pitched = (g.battersFaced ?? 0) > 0 || parseFloat(g.inningsPitched ?? '0') > 0
        const gameLine   = `${g.inningsPitched ?? '0.0'} IP · ${g.strikeOuts ?? 0} K`
        const seasonLine = `ERA ${s.era ?? '—'}`
        return {
          id:    Number(raw.id),
          name:  raw.fullName ?? '—',
          // Due up: game line only once they've thrown to a batter, else season stats.
          line1: between ? (pitched ? gameLine : seasonLine) : gameLine,
          line2: between ? '' : `${pitches != null ? `${pitches} pitches · ` : ''}ERA ${s.era ?? '—'}`,
        }
      }

      situation = {
        batter:        mkBatter(off.batter),
        pitcher:       mkPitcher(def.pitcher),
        onFirst:       Boolean(off.first),
        onSecond:      Boolean(off.second),
        onThird:       Boolean(off.third),
        balls:          ls.balls   ?? 0,
        strikes:        ls.strikes ?? 0,
        outs:           ls.outs    ?? 0,
        betweenInnings: between,
        battingTeamId:  isTop ? away.teamId : home.teamId,
        fieldingTeamId: isTop ? home.teamId : away.teamId,
      }
    }

    const plays: GcPlay[] = (ld.plays?.allPlays ?? [])
      .filter((p: any) => p.result?.description)
      .map((p: any) => ({
        atBatIndex:    p.about?.atBatIndex ?? 0,
        inning:        p.about?.inning ?? 0,
        half:          p.about?.halfInning === 'bottom' ? 'bottom' as const : 'top' as const,
        isScoring:     Boolean(p.about?.isScoringPlay),
        event:         p.result?.event ?? '',
        description:   p.result?.description ?? '',
        awayScore:     p.result?.awayScore ?? 0,
        homeScore:     p.result?.homeScore ?? 0,
        battingTeamId: p.about?.halfInning === 'bottom' ? home.teamId : away.teamId,
        batter:        p.matchup?.batter?.fullName ?? '',
        pitcher:       p.matchup?.pitcher?.fullName ?? '',
        outs:          p.count?.outs ?? 0,
      }))

    const box = parseBoxScoreData(ls, ld.boxscore ?? {})

    // The feed picks these itself (by game score), which is the same three a broadcast would name.
    // The club comes from which side's box lists the player, not `parentTeamId`, which is the
    // organisation and so is wrong for nobody here but is the wrong question.
    const awayIds = ld.boxscore?.teams?.away?.players ?? {}
    const performers: Performer[] = (ld.boxscore?.topPerformers ?? [])
      .filter((t: any) => t?.player?.person?.id)
      .map((t: any) => {
        const id = Number(t.player.person.id)
        const side = awayIds[`ID${id}`] ? away : home
        const st = t.player.stats ?? {}
        const summary: string = (t.type === 'hitter' ? st.batting?.summary : st.pitching?.summary) ?? ''
        return {
          id, name: t.player.person.fullName ?? '', teamId: side.teamId, abbr: side.abbr,
          kind: String(t.type ?? ''), line: summary.replace(/\s*\|\s*/g, ' · '),
        }
      })

    const gi = gd.gameInfo ?? {}
    const info: GameInfoData = {
      venue:       gd.venue?.name ?? null,
      attendance:  typeof gi.attendance === 'number' ? gi.attendance : null,
      firstPitch:  gi.firstPitch ?? null,
      durationMin: typeof gi.gameDurationMinutes === 'number' ? gi.gameDurationMinutes : null,
      weather:     gd.weather && (gd.weather.temp || gd.weather.condition) ? gd.weather : null,
    }

    return {
      state, statusText, away, home, situation, plays, box,
      gameType: gd.game?.type ?? '', season: Number(gd.game?.season) || 0, performers, info,
    }
  } catch { return null }
}

async function fetchWinProb(gamePk: number): Promise<WpPoint[]> {
  try {
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1/game/${gamePk}/winProbability` +
      `?fields=atBatIndex,homeTeamWinProbability,homeTeamWinProbabilityAdded,about,inning`
    )
    const d = await r.json()
    if (!Array.isArray(d)) return []
    return d
      .filter((p: any) => typeof p.homeTeamWinProbability === 'number')
      .map((p: any) => ({
        wp: p.homeTeamWinProbability,
        before: p.homeTeamWinProbability - (typeof p.homeTeamWinProbabilityAdded === 'number' ? p.homeTeamWinProbabilityAdded : 0),
        inning: p.about?.inning ?? 0,
        atBatIndex: p.atBatIndex ?? -1,
      }))
  } catch { return [] }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

// ─── Bases diamond + outs ─────────────────────────────────────────────────────

// ─── Live situation panel ─────────────────────────────────────────────────────

function MatchupCard({ label, player, teamId, onSelect }: {
  label:    string
  player:   GcMatchupPlayer | null
  teamId:   number
  onSelect?: (id: number) => void
}) {
  const tone = useTextTone()
  const isDark = useIsDark()
  const col    = TEAM_BG[teamId] ?? '#444'
  const accent = accentColor(col, isDark)
  return (
    <Box
      onClick={player && onSelect ? () => onSelect(player.id) : undefined}
      sx={{
        flex: 1, minWidth: 0, p: 1.25, borderRadius: 2,
        bgcolor: `${col}10`,
        border: '1px solid', borderColor: borderAlpha(col, isDark),
        display: 'flex', alignItems: 'center', gap: 1,
        cursor: player && onSelect ? 'pointer' : 'default',
        transition: 'border-color 0.15s',
        ...(player && onSelect ? { '&:hover': { borderColor: `${col}60` } } : {}),
      }}
    >
      <Box sx={{
        width: chromePx(40), height: chromePx(50), borderRadius: 1.5, overflow: 'hidden', flexShrink: 0,
        border: `2px solid ${photoBorderAlpha(col, isDark)}`, bgcolor: 'action.hover',
      }}>
        {player && (
          <Box component="img"
            src={HEADSHOT(player.id)} alt={player.name}
            sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%', display: 'block' }}
          />
        )}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.54rem', fontWeight: 800, color: tone(accent), textTransform: 'uppercase', letterSpacing: typePx(0.8), lineHeight: 1 }}>
          {label}
        </Typography>
        <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, lineHeight: 1.2, mt: 0.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {player?.name ?? 'TBD'}
        </Typography>
        {player && (
          <>
            <Typography sx={{ fontSize: '0.64rem', fontWeight: 700, color: 'text.primary', lineHeight: 1.2, mt: 0.2 }}>
              {player.line1}
            </Typography>
            {player.line2 && (
              <Typography sx={{ fontSize: '0.6rem', color: 'text.secondary', lineHeight: 1.2 }}>
                {player.line2}
              </Typography>
            )}
          </>
        )}
      </Box>
    </Box>
  )
}

function SituationPanel({ sit, onPlayerClick }: {
  sit: GcSituation
  onPlayerClick?: (id: number) => void
}) {
  return (
    <Box sx={{ px: 2, py: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
      {sit.betweenInnings && (
        // Between innings there's no live count/outs/bases, so just flag who's due up.
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mb: 1.25 }}>
          <Box sx={{ width: chromePx(6), height: chromePx(6), borderRadius: '50%', bgcolor: 'text.disabled', flexShrink: 0 }} />
          <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: typePx(0.8) }}>
            Due up next inning
          </Typography>
        </Box>
      )}
      <Box sx={{ display: 'flex', gap: 1 }}>
        <MatchupCard label={sit.betweenInnings ? 'Leading Off' : 'At Bat'}   player={sit.batter}  teamId={sit.battingTeamId}  onSelect={onPlayerClick} />
        <MatchupCard label={sit.betweenInnings ? 'On the Mound' : 'Pitching'} player={sit.pitcher} teamId={sit.fieldingTeamId} onSelect={onPlayerClick} />
      </Box>
    </Box>
  )
}

// ─── Win probability chart ────────────────────────────────────────────────────
//
// WPBL's chart (src/wpbl/WinProbView.tsx), drawn from StatsAPI's numbers instead of a model of our
// own, so a reader moving between the two sections reads one chart. Each club's share of the game
// is its territory in its own colour (the away club above the line, the home club below), the
// readout box sits ABOVE the plot so a finger on the chart never covers the answer, and the plot is
// read by hovering, holding or arrowing along it (the shared scrub hook, src/ui/chartScrub.ts).
// WPBL's notes on why each of those is the way it is apply here unchanged.
//
// At rest the readout shows the biggest swing, and the Summary's numbered list of swings is marked
// on the line with the same numbers.

/** The readout's height, fixed so the card does not move under a finger. In rem because it holds
 *  type; see CAPTION_H in WinProbView.tsx for what px does here. */
const WP_CAPTION_H = '4.25rem'
const WP_CHART_H = { xs: chromePx(132), sm: chromePx(178) }

function WpLabel({ children, sx }: { children: React.ReactNode; sx: object }) {
  return (
    <Typography sx={{
      position: 'absolute', fontSize: GC_CAPS, fontWeight: 800, letterSpacing: typePx(0.5),
      color: 'text.secondary', pointerEvents: 'none', ...sx,
    }}>{children}</Typography>
  )
}

function WinProbChart({ pts, plays, away, home, live, marks = [] }: {
  pts: WpPoint[]; plays: GcPlay[]; away: GcTeam; home: GcTeam; live: boolean
  /** Point indexes to number on the line, biggest first: the Summary's swings. */
  marks?: number[]
}) {
  const isDark = useIsDark()
  const canHover = useMediaQuery('(hover: hover)')
  const scrub = useChartScrub(pts.length,
    'Win probability through the game. Press and hold the chart, or use the arrow keys, to read any moment of it.')
  if (pts.length < 2) return null

  // Not the club primaries: half of them are near-black and two of them at 30% are one grey.
  // See chartPairColors.
  const [awayCol, homeCol] = chartPairColors(away.teamId, home.teamId, isDark)

  // In a 0..100 box stretched to the card. Vertex i is the state BEFORE play i; the last vertex is
  // where the last play left it. StatsAPI gives each play's after-value and how much it added.
  const n = pts.length
  const x = (i: number) => (i / n) * 100
  const y = (homePct: number) => 100 - homePct
  const verts = pts.map((p, i) => `${x(i).toFixed(3)},${y(p.before).toFixed(3)}`)
  verts.push(`100,${y(pts[n - 1].wp).toFixed(3)}`)
  const homeFill = `M0,100 L${verts.join(' L')} L100,100 Z`
  const awayFill = `M0,0 L${verts.join(' L')} L100,0 Z`

  const innings: { inning: number; from: number; to: number }[] = []
  pts.forEach((p, i) => {
    const last = innings[innings.length - 1]
    if (last && last.inning === p.inning) last.to = x(i)
    else innings.push({ inning: p.inning, from: x(i), to: x(i) })
  })
  if (innings.length) innings[innings.length - 1].to = 100

  const playByIdx = new Map(plays.map(p => [p.atBatIndex, p] as const))
  // "SEA 52% → 82%", named for the club the play left in front, as WPBL's readout does.
  const pctLine = (before: number, after: number) => {
    const homeSide = after >= 50
    const f = (v: number) => `${Math.round(homeSide ? v : 100 - v)}%`
    const abbr = homeSide ? home.abbr : away.abbr
    return f(before) === f(after) ? `${abbr} ${f(after)}` : `${abbr} ${f(before)} → ${f(after)}`
  }
  const ord = (k: number) => ordinal(k)

  const restIdx = marks.length ? marks[0] : -1
  const at = scrub.index == null ? null : pts[scrub.index]
  let read: { label: string; pct: string; text: string; note: string } | null = null
  if (at) {
    const p = playByIdx.get(at.atBatIndex)
    read = {
      label: p ? `${p.half === 'bottom' ? 'Bot' : 'Top'} ${ord(p.inning)} · ${p.outs} out` : `Inning ${at.inning}`,
      pct: pctLine(at.before, at.wp),
      text: p?.description ?? '',
      note: p ? `${away.abbr} ${p.awayScore}, ${home.abbr} ${p.homeScore}` : '',
    }
  } else if (restIdx >= 0) {
    const pt = pts[restIdx]
    const p = playByIdx.get(pt.atBatIndex)
    read = {
      label: `${live ? 'Biggest swing so far' : 'Swing of the game'}${p ? ` · ${ord(p.inning)}` : ''}`,
      pct: pctLine(pt.before, pt.wp),
      text: p?.description ?? '',
      note: `${canHover ? 'Hover' : 'Hold'} the chart for any play`,
    }
  }
  const last = pts[n - 1].wp
  const now = live ? `${last >= 50 ? home.abbr : away.abbr} ${Math.round(last >= 50 ? last : 100 - last)}%` : null

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <Box sx={{ px: 1.5, pt: 1.25, pb: 0.75, display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.2 }}>Win probability</Typography>
        {now && (
          <Typography sx={{ ml: 'auto', fontSize: '0.72rem', fontWeight: 800, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: textTone(last >= 50 ? homeCol : awayCol, isDark) }}>
            {now}
          </Typography>
        )}
      </Box>

      <Box sx={{
        px: 1.5, pt: 0.25, pb: 1, mb: 1, height: WP_CAPTION_H, overflow: 'hidden',
        borderBottom: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.25 }}>
          <Typography sx={{
            fontSize: GC_CAPS, fontWeight: 800, textTransform: 'uppercase', letterSpacing: typePx(0.8),
            color: 'primary.main', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{read?.label}</Typography>
          <Typography sx={{ ml: 'auto', fontSize: GC_META, fontWeight: 800, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: 'text.primary' }}>
            {read?.pct}
          </Typography>
        </Box>
        <Typography aria-live="polite" sx={{ fontSize: '0.85rem', lineHeight: 1.45, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {read?.text}
        </Typography>
        <Typography sx={{
          mt: 'auto', pt: 0.25, fontSize: GC_CAPS, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: typePx(0.7), color: 'text.secondary', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
        }}>{read?.note}</Typography>
      </Box>

      <Box
        {...scrub.props}
        data-swipe-lock="true"
        sx={{
          position: 'relative', height: WP_CHART_H,
          touchAction: 'pan-y', WebkitTapHighlightColor: 'transparent',
          userSelect: 'none', WebkitTouchCallout: 'none', cursor: 'crosshair', outline: 'none',
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-2px' },
        }}
      >
        <Box component="svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden
          sx={{ display: 'block', width: '100%', height: '100%', color: 'text.primary' }}>
          <path d={awayFill} fill={awayCol} opacity={0.3} />
          <path d={homeFill} fill={homeCol} opacity={0.3} />
          {innings.slice(1).map(iv => (
            <line key={iv.inning} x1={iv.from} x2={iv.from} y1={0} y2={100}
              stroke="currentColor" strokeOpacity={0.12} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          <line x1={0} x2={100} y1={50} y2={50}
            stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          {restIdx >= 0 && scrub.index == null && (
            <line x1={x(restIdx + 1)} x2={x(restIdx + 1)} y1={0} y2={100}
              stroke="currentColor" strokeOpacity={0.3} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          )}
          <polyline points={verts.join(' ')} fill="none"
            stroke="currentColor" strokeOpacity={0.85} strokeWidth={2}
            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {scrub.index != null && (
            <line x1={x(scrub.index)} x2={x(scrub.index)} y1={0} y2={100}
              stroke="currentColor" strokeOpacity={0.55} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          )}
        </Box>

        {/* The swings, numbered to match the list under the chart. HTML dots, because an SVG
            circle in a box stretched by preserveAspectRatio="none" comes out an ellipse. Each sits
            where its play LANDED, the next vertex. Faded while the chart is being read. */}
        {marks.map((i, k) => pts[i] && (
          <Box key={i} aria-hidden sx={{
            position: 'absolute',
            left: `${Math.min(Math.max(x(i + 1), 2), 98)}%`,
            top: `${Math.min(Math.max(y(pts[i].wp), 8), 92)}%`,
            transform: 'translate(-50%, -50%)',
            width: '1.05rem', height: '1.05rem', borderRadius: '50%',
            bgcolor: pts[i].wp >= pts[i].before ? homeCol : awayCol,
            border: '2px solid', borderColor: 'background.paper',
            color: inkOn(pts[i].wp >= pts[i].before ? homeCol : awayCol), fontSize: '0.56rem', fontWeight: 900, lineHeight: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', opacity: scrub.index == null ? 1 : 0, transition: 'opacity 120ms ease',
          }}>{k + 1}</Box>
        ))}

        {at && scrub.index != null && (
          <Box aria-hidden sx={{
            position: 'absolute',
            left: `${Math.min(Math.max(x(scrub.index), 1.5), 98.5)}%`,
            top: `${Math.min(Math.max(y(at.before), 3), 97)}%`,
            transform: 'translate(-50%, -50%)',
            width: chromePx(11), height: chromePx(11), borderRadius: '50%',
            bgcolor: 'text.primary', border: '2px solid', borderColor: 'background.paper', pointerEvents: 'none',
          }} />
        )}

        <WpLabel sx={{ top: 4, left: 6, color: textTone(awayCol, isDark) }}>{away.abbr}</WpLabel>
        <WpLabel sx={{ bottom: 4, left: 6, color: textTone(homeCol, isDark) }}>{home.abbr}</WpLabel>
        <WpLabel sx={{ top: '50%', right: 6, transform: 'translateY(-50%)', opacity: 0.75 }}>50%</WpLabel>
      </Box>

      <Box aria-hidden sx={{ position: 'relative', height: '0.95rem', mt: '2px' }}>
        {innings.filter(iv => iv.to - iv.from >= 3.5).map(iv => (
          <Typography key={iv.inning} sx={{
            position: 'absolute', left: `${(iv.from + iv.to) / 2}%`, transform: 'translateX(-50%)',
            fontSize: '0.62rem', fontWeight: 700, color: 'text.secondary', lineHeight: 1,
          }}>{iv.inning}</Typography>
        ))}
      </Box>
      <Typography aria-hidden sx={{
        height: '0.8rem', mb: 0.75, textAlign: 'center', fontSize: '0.58rem', fontWeight: 700,
        letterSpacing: typePx(0.8), textTransform: 'uppercase', color: 'text.secondary', lineHeight: 1,
      }}>Inning</Typography>
    </Box>
  )
}

// ─── Play-by-play list ────────────────────────────────────────────────────────
//
// Two readings, as on WPBL's Plays tab (GameDetail.tsx). SCORING is the runs, flat, every
// half-inning that had one. ALL is every play, grouped by half-inning and COLLAPSED, each heading
// saying how many runs that half produced and what the score was after it: eighty rows open at
// once is a wall, and fourteen headings is a game you can scan. Expand all is remembered per
// reader, for WPBL's reason: a reader who wants the whole log wants it on the next game too.

const PBP_EXPAND_KEY = 'mlb_pbp_expand_all'
const readPbpExpandAll = (): boolean => {
  try { return localStorage.getItem(PBP_EXPAND_KEY) === '1' } catch { return false }
}
const writePbpExpandAll = (on: boolean) => {
  try { localStorage.setItem(PBP_EXPAND_KEY, on ? '1' : '0') } catch { /* private mode / quota */ }
}

interface HalfInning {
  key: string
  inning: number
  half: 'top' | 'bottom'
  battingTeamId: number
  runs: number
  /** The score after this half. */
  awayTo: number
  homeTo: number
  plays: GcPlay[]
}

/** Plays grouped by half-inning, in game order. Runs are the change in the batting club's score
 *  across the half, so they agree with the line score rather than with any one play's flag. */
function halfInnings(plays: GcPlay[]): HalfInning[] {
  const out: HalfInning[] = []
  for (const p of plays) {
    const key = `${p.inning}-${p.half}`
    let g = out[out.length - 1]
    if (!g || g.key !== key) {
      g = { key, inning: p.inning, half: p.half, battingTeamId: p.battingTeamId, runs: 0, awayTo: 0, homeTo: 0, plays: [] }
      out.push(g)
    }
    g.plays.push(p)
    g.awayTo = p.awayScore
    g.homeTo = p.homeScore
  }
  let away = 0, home = 0
  for (const g of out) {
    g.runs = g.half === 'top' ? g.awayTo - away : g.homeTo - home
    away = g.awayTo; home = g.homeTo
  }
  return out
}

/** One play. A scoring play is marked in its club's CHART colour (chartPairColors), not its
 *  primary: the primary is near-black for a third of the league, and a brown rail on a 5% brown
 *  wash is how the Padres' runs used to look like everybody else's outs. */
function PlayCard({ p, away, home }: { p: GcPlay; away: GcTeam; home: GcTeam }) {
  const isDark = useIsDark()
  const [awayCol, homeCol] = chartPairColors(away.teamId, home.teamId, isDark)
  const col = p.battingTeamId === home.teamId ? homeCol : awayCol
  return (
    <Box sx={{
      px: 1.5, py: 1, borderRadius: 1.5,
      borderLeft: '3px solid',
      borderLeftColor: p.isScoring ? col : 'divider',
      bgcolor: p.isScoring ? `${col}${isDark ? '1f' : '14'}` : 'transparent',
    }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
        <Typography sx={{ fontSize: GC_BODY, fontWeight: 800, lineHeight: 1.3 }}>
          {p.event}
        </Typography>
        {p.isScoring && (
          <Typography sx={{ ml: 'auto', fontSize: GC_META, fontWeight: 800, lineHeight: 1.3, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            {away.abbr} {p.awayScore} · {home.abbr} {p.homeScore}
          </Typography>
        )}
      </Box>
      <Typography sx={{ fontSize: GC_META, color: 'text.secondary', lineHeight: 1.5, mt: 0.25 }}>
        {p.description}
      </Typography>
    </Box>
  )
}

const halfLabel = (g: { half: 'top' | 'bottom'; inning: number; battingTeamId: number }) =>
  `${g.half === 'top' ? '▲' : '▼'} ${ordinal(g.inning)} · ${TEAM_ABBR[g.battingTeamId] ?? ''} batting`

function PlaysList({ plays, away, home, scoringOnly, expanded, onToggle }: {
  plays: GcPlay[]; away: GcTeam; home: GcTeam; scoringOnly: boolean
  /** The open half-innings, by key, for the All reading. */
  expanded: ReadonlySet<string>
  onToggle: (key: string) => void
}) {
  const isDark = useIsDark()
  const shown = scoringOnly ? plays.filter(p => p.isScoring) : plays
  if (shown.length === 0) {
    return (
      <Box sx={{ py: 3, textAlign: 'center' }}>
        <Typography sx={{ fontSize: GC_META, color: 'text.secondary' }}>
          {scoringOnly ? 'No scoring plays yet' : 'No plays yet'}
        </Typography>
      </Box>
    )
  }

  // Latest first, so a live game opens on what just happened.
  if (scoringOnly) {
    const rev = [...shown].reverse()
    let lastKey = ''
    return (
      <Box>
        {rev.map(p => {
          const key = `${p.half}${p.inning}`
          const showHeader = key !== lastKey
          lastKey = key
          return (
            <React.Fragment key={p.atBatIndex}>
              {showHeader && (
                <Typography sx={{
                  px: 2, pt: 1.75, pb: 0.75,
                  fontSize: GC_CAPS, fontWeight: 800, color: 'text.secondary',
                  textTransform: 'uppercase', letterSpacing: typePx(0.8), lineHeight: 1,
                }}>
                  {halfLabel(p)}
                </Typography>
              )}
              <Box sx={{ mx: 2, mb: 0.75 }}><PlayCard p={p} away={away} home={home} /></Box>
            </React.Fragment>
          )
        })}
      </Box>
    )
  }

  const groups = halfInnings(plays).reverse()
  return (
    <Box sx={{ pt: 0.5 }}>
      {groups.map(g => {
        const open = expanded.has(g.key)
        return (
          <Box key={g.key}>
            <Box
              {...pressable(() => onToggle(g.key))}
              aria-expanded={open}
              sx={{
                ...FOCUS_RING, display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer',
                // A finger-sized row (chromePx: a tap target must not shrink with small text).
                mx: 2, minHeight: chromePx(44), borderBottom: '1px solid', borderColor: 'divider', userSelect: 'none',
                ...hoverOnly({ '& .pbpChevron': { color: 'text.primary' } }),
              }}
            >
              <Box className="pbpChevron" aria-hidden sx={{
                fontSize: '0.62rem', color: 'text.secondary', width: '0.75rem', flexShrink: 0,
                transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'none',
              }}>▶</Box>
              <LogoBubble teamId={g.battingTeamId} abbr={TEAM_ABBR[g.battingTeamId] ?? ''} size={20} ring={1} />
              <Typography noWrap sx={{
                minWidth: 0, fontSize: GC_CAPS, fontWeight: 800, textTransform: 'uppercase',
                letterSpacing: typePx(0.8), color: 'text.primary',
              }}>
                {g.half === 'top' ? 'Top' : 'Bottom'} {ordinal(g.inning)}
              </Typography>
              {g.runs > 0 && (
                <Typography sx={{ fontSize: GC_CAPS, fontWeight: 800, color: runGreen(isDark), whiteSpace: 'nowrap' }}>
                  +{g.runs} {g.runs === 1 ? 'run' : 'runs'}
                </Typography>
              )}
              <Typography sx={{
                ml: 'auto', flexShrink: 0, fontSize: GC_META, fontWeight: 700, color: 'text.secondary',
                fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
              }}>
                {away.abbr} {g.awayTo} · {home.abbr} {g.homeTo}
              </Typography>
            </Box>
            {/* Indented to the heading's text, past the chevron, so the plays read as the
                contents of the half above them rather than as the next row of the list. */}
            {open && (
              <Box sx={{ ml: { xs: 2, sm: 4.5 }, mr: 2, pt: 1, pb: 1.5, display: 'grid', gap: 0.75 }}>
                {[...g.plays].reverse().map(p => <PlayCard key={p.atBatIndex} p={p} away={away} home={home} />)}
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

// ─── Full box score: both clubs once there is room, a toggle below that ───────
//
// WPBL's arrangement (GameDetail.tsx): a box score is two teams, and the only reason to show one
// is width. From `lg` the sheet is wide enough for both tables abreast and the toggle goes; CSS
// rather than a media hook, so both are always in the DOM and find-in-page reaches either club.

function TeamBoxColumns({ box, onPlayerClick, stacked = false }: {
  box: BoxScore
  onPlayerClick?: (id: number) => void
  /** Both clubs, one above the other, at every width: the full page's right-hand column, which is
   *  half the width that puts them abreast in the sheet. */
  stacked?: boolean
}) {
  const [side, setSide] = useState<'away' | 'home'>('away')

  const teamChip = (value: 'away' | 'home', team: BoxScore['away']) => (
    <Box
      onClick={() => setSide(value)}
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.6,
        px: 1.5, py: 0.6, borderRadius: 99, cursor: 'pointer', userSelect: 'none',
        fontSize: GC_META, fontWeight: 800, lineHeight: 1,
        color: side === value ? 'background.paper' : 'text.secondary',
        bgcolor: side === value ? 'text.primary' : 'action.hover',
        transition: 'all 0.15s',
      }}
    >
      <LogoBubble teamId={team.teamId} abbr={team.abbr} size={16} ring={1} />
      {team.abbr}
    </Box>
  )

  return (
    <Box>
      <Box sx={{ display: stacked ? 'none' : { xs: 'flex', lg: 'none' }, px: 2, py: 1.25, gap: 0.75, justifyContent: 'center' }}>
        {teamChip('away', box.away)}
        {teamChip('home', box.home)}
      </Box>
      <Box sx={{ display: 'grid', alignItems: 'start', gridTemplateColumns: stacked ? 'minmax(0, 1fr)' : { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) minmax(0, 1fr)' } }}>
        {(['away', 'home'] as const).map(k => (
          <Box key={k} sx={stacked ? {
            minWidth: 0, borderTopStyle: 'solid', borderTopColor: 'divider', borderTopWidth: k === 'home' ? '1px' : 0,
          } : {
            minWidth: 0, display: { xs: side === k ? 'block' : 'none', lg: 'block' },
            borderLeftStyle: 'solid', borderLeftColor: 'divider', borderLeftWidth: { xs: 0, lg: k === 'home' ? '1px' : 0 },
          }}>
            <TeamBoxSection team={box[k]} onPlayerClick={onPlayerClick} />
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// ─── The scoreboard ───────────────────────────────────────────────────────────
//
// The header is the line score itself, as on WPBL's game page: club, innings, R H E in one table,
// the winning row tinted in its club's colour. It used to be two 48px logos and two 2.2rem scores
// stacked over a separate line score saying the same runs again, which spent the first 330px of
// the sheet on one number per club.

function Scoreboard({ box, decided, onTeam, blank = false }: {
  box: BoxScore; decided: boolean; onTeam?: (id: number) => void
  /** Before the game is known at all (a cold landing on the full page): the table's own rows with
   *  the clubs left empty, so the header is its loaded height from the first frame. */
  blank?: boolean
}) {
  const isDark = useIsDark()
  const lastNum = box.innings.length ? box.innings[box.innings.length - 1].num : 0
  const byNum = new Map(box.innings.map(i => [i.num, i] as const))
  const cols = Array.from({ length: Math.max(9, lastNum) }, (_, k) => k + 1)
  // Narrower below `sm`, where nine innings, R H E and a club have to share a phone's width
  // without the R H E scrolling off the edge.
  const head = (label: React.ReactNode, w = '1.5rem') => (
    <Box component="th" sx={{
      fontSize: GC_CAPS, fontWeight: 700, color: 'text.secondary', textAlign: 'center',
      px: { xs: 0.2, sm: 0.4 }, pb: 0.5, minWidth: { xs: '1.05rem', sm: w }, letterSpacing: typePx(0.4),
    }}>{label}</Box>
  )
  const row = (k: 'away' | 'home') => {
    const t = box[k]
    const other = k === 'away' ? box.home : box.away
    const won = decided && t.runs > other.runs
    const col = TEAM_BG[t.teamId] ?? '#888888'
    const accent = accentColor(col, isDark)
    const muted = decided && !won
    return (
      <Box component="tr" key={k} sx={{ borderTop: '1px solid', borderColor: 'divider', bgcolor: won ? `${col}${isDark ? '26' : '12'}` : 'transparent' }}>
        <Box component="td" sx={{ py: 0.6, pl: { xs: 0.75, sm: 1 }, pr: { xs: 0.75, sm: 1.5 }, borderLeft: '3px solid', borderLeftColor: won ? accent : 'transparent' }}>
          <Box {...teamLink(t.teamId, onTeam)} sx={{
            ...LINK_SX, display: 'flex', width: 'fit-content', alignItems: 'center', gap: 0.75,
            ...(onTeam ? { cursor: 'pointer', borderRadius: 1, ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING } : {}),
          }}>
            {blank
              // LogoBubble's own box: its ring is a border outside the 24px.
              ? <Box sx={{ width: chromePx(24), height: chromePx(24), borderRadius: '50%', bgcolor: 'action.hover', border: '1.5px solid transparent', flexShrink: 0 }} />
              : <LogoBubble teamId={t.teamId} abbr={t.abbr} size={24} ring={1.5} />}
            <Typography sx={{ fontSize: { xs: '0.84rem', sm: '0.92rem' }, fontWeight: won ? 800 : 600, lineHeight: 1.15, whiteSpace: 'nowrap', color: muted ? 'text.secondary' : 'text.primary' }}>
              <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>{t.abbr}</Box>
              <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{TEAM_NICKNAME[t.teamId] ?? t.name}</Box>
            </Typography>
          </Box>
        </Box>
        {cols.map(num => {
          const i = byNum.get(num)
          const v = i ? (k === 'away' ? i.away : i.home) : undefined
          // Home team that did not bat in its last frame: the X a scorebook prints.
          const text = !i ? '' : v == null ? (k === 'home' ? 'X' : '-') : v
          return (
            <Box component="td" key={num} sx={{
              fontSize: { xs: '0.8rem', sm: '0.88rem' }, fontWeight: v ? 800 : 500, color: v ? 'text.primary' : 'text.secondary',
              textAlign: 'center', px: { xs: 0.2, sm: 0.4 }, fontVariantNumeric: 'tabular-nums',
            }}>{text}</Box>
          )
        })}
        <Box component="td" sx={{ width: chromePx(4) }} />
        <Box component="td" sx={{ textAlign: 'center', px: { xs: 0.2, sm: 0.4 }, fontSize: { xs: '0.95rem', sm: '1.05rem' }, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: won ? accent : muted ? 'text.secondary' : 'text.primary' }}>{t.runs}</Box>
        <Box component="td" sx={{ textAlign: 'center', px: { xs: 0.2, sm: 0.4 }, fontSize: { xs: '0.78rem', sm: '0.84rem' }, fontWeight: 600, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{t.hits}</Box>
        <Box component="td" sx={{ textAlign: 'center', px: { xs: 0.2, sm: 0.4 }, fontSize: { xs: '0.78rem', sm: '0.84rem' }, fontWeight: 600, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{t.errors}</Box>
      </Box>
    )
  }
  return (
    // flexShrink 0: the sheet's body is a flex column, and an `overflow: auto` child of one may
    // shrink below its content. Once Summary grew taller than a phone, this scoreboard was squeezed
    // to a 12px strip with the score scrolled out of sight inside it.
    <Box data-swipe-ignore="true" sx={{ flexShrink: 0, overflowX: 'auto', px: { xs: 1.5, sm: 2 }, pt: 1.5, '&::-webkit-scrollbar': { display: 'none' }, scrollbarWidth: 'none' }}>
      <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', minWidth: 'max-content' }}>
        <Box component="thead">
          <Box component="tr">
            <Box component="th" />
            {cols.map(n => <React.Fragment key={n}>{head(n)}</React.Fragment>)}
            <Box component="th" />
            {head('R', '1.75rem')}{head('H', '1.75rem')}{head('E', '1.75rem')}
          </Box>
        </Box>
        <Box component="tbody">{row('away')}{row('home')}</Box>
      </Box>
    </Box>
  )
}

// ─── Game Center modal ────────────────────────────────────────────────────────

type GameCenterProps = {
  game: FinalGameSummary
  onClose: () => void
  onPlayerClick?: (id: number) => void
  onTeamClick?:   (id: number) => void
  initialTab?:    'summary' | 'box' | 'plays'
  /** The side panel's Expand, to the full page, with the board that was showing. */
  onExpand?:      (tab: 'summary' | 'box' | 'plays') => void
}

/**
 * Keyed by the game, so another game is a remount rather than a re-render. Its tabs, its folded
 * half-innings and its data are all seeded once, and on a desktop the side panel swaps from one game
 * to the next as the reader clicks down the scoreboard: re-rendered in place, the new game's header
 * sat over the old game's box score until the fetch landed. sheetHistory reads the remount as a swap.
 */
export function GameCenterModal(props: GameCenterProps) {
  return <GameCenterSheet key={props.game.gamePk} {...props} />
}

function GameCenterSheet(props: GameCenterProps) {
  // On a desktop, the side panel beside the page rather than a dialog over it (ModalShell's
  // `panel`), which changes how the history entry behaves. See sheetHistory.ts.
  const asPanel = useOpensAsPanel()
  // Every way out (the close button, Escape, the backdrop, a drag down, Back) goes through this,
  // so Back closes the sheet instead of leaving the section. The sheet's entry carries the game's
  // own address, which is the page a shared link or a search result opens. See sheetHistory.ts.
  const close = useSheetHistory(props.onClose, mlbGamePath(props.game.gamePk), { panel: asPanel })
  // Expand is the same from every opener, so it is the sheet's own unless an opener says otherwise.
  return <GameCenterView {...props} layout="sheet" asPanel={asPanel} close={close}
    onExpand={props.onExpand ?? (tab => expandGameToPage(props.game.gamePk, tab))} />
}

/**
 * GAME CENTER AS A FULL PAGE, on a desktop: reached by a game's address arrived at from outside the
 * section (a cold load, a shared link) and by the side panel's Expand. WPBL's arrangement
 * (GameCenterPage in wpbl/GameDetail.tsx): NO TABS, since a recap read against its box score is
 * exactly the case tabs fail, so the summary and the plays run down the left and both box scores
 * down the right, with a pinned bar carrying the score and links to each. One column below `lg`.
 * Same address as the panel; which one draws is the history entry's to say (see GameRoute).
 */
export function GameCenterPage(props: GameCenterProps & { onBack: () => void }) {
  return <GameCenterView key={props.game.gamePk} {...props} layout="page" asPanel={false} close={props.onClose} />
}

function GameCenterView({ game, onClose, onPlayerClick, onTeamClick, initialTab, layout, asPanel, close, onBack, onExpand }: GameCenterProps & {
  layout: 'sheet' | 'page'
  asPanel: boolean
  close: () => void
  /** The page's back control. */
  onBack?: () => void
}) {
  const isPage = layout === 'page'
  const [data,        setData]        = useState<GameCenterData | null>(null)
  const [wp,          setWp]          = useState<WpPoint[]>([])
  const [loading,     setLoading]     = useState(true)
  const [tab,         setTab]         = useState<'summary' | 'box' | 'plays'>(initialTab ?? 'summary')
  const [scoringOnly, setScoringOnly] = useState(true)

  // The All reading's open half-innings. Tracked as what is OPEN, so halves that arrive later on a
  // live game start closed without bookkeeping, unless the reader has asked for everything open.
  const halfKeys = useMemo(() => [...new Set((data?.plays ?? []).map(p => `${p.inning}-${p.half}`))], [data?.plays])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [expandAll, setExpandAll] = useState(readPbpExpandAll)
  const allOpen = halfKeys.length > 0 && halfKeys.every(k => expanded.has(k))
  const toggleHalf = (key: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })
  const toggleAll = () => {
    const next = !allOpen
    setExpandAll(next)
    writePbpExpandAll(next)
    setExpanded(next ? new Set(halfKeys) : new Set())
  }
  // New halves: all of them open with the preference on; otherwise a live game opens the half
  // being played, and only while it is new, so closing it by hand is not overruled on the next poll.
  const seenHalves = useRef<Set<string>>(new Set())
  useEffect(() => {
    const fresh = halfKeys.filter(k => !seenHalves.current.has(k))
    if (!fresh.length) return
    for (const k of fresh) seenHalves.current.add(k)
    if (expandAll) { setExpanded(prev => new Set([...prev, ...fresh])); return }
    const current = halfKeys[halfKeys.length - 1]
    if (data?.state === 'live' && fresh.includes(current)) setExpanded(prev => new Set([...prev, current]))
  }, [halfKeys, expandAll, data?.state])

  const load = useCallback(async () => {
    const [d, w] = await Promise.all([fetchGameCenter(game.gamePk), fetchWinProb(game.gamePk)])
    if (d) setData(d)
    setWp(w)
    setLoading(false)
  }, [game.gamePk])

  useEffect(() => { setLoading(true); load() }, [load])

  // Poll while the game is live. Paused while the tab is hidden and pulled at once on return: see useForegroundInterval.
  useForegroundInterval(load, data?.state === 'live' ? 15000 : null)

  const isLive     = (data?.state ?? game.state) === 'live'
  const isFinal    = (data?.state ?? game.state) === 'final'
  const statusText = data?.statusText ?? game.statusText
  const away       = data?.away ?? { teamId: game.away.teamId, abbr: game.away.abbr, runs: game.away.runs }
  const home       = data?.home ?? { teamId: game.home.teamId, abbr: game.home.abbr, runs: game.home.runs }
  const hasScoring = Boolean(data?.plays.some(p => p.isScoring))
  const heading = useGameSeo({ ...game, state: data?.state ?? game.state, away, home })

  // As the side panel, a player is a trip FROM the game: their panel draws over this one with a
  // "‹ Game" back control, and this stays mounted beneath it. Otherwise the game makes way for the
  // player's page, as it always has.
  const selectPlayer = isPage
    ? (id: number) => {
      // The page is a page: a player from it is the side panel beside it, as from any list.
      track(EVENTS.MLB_PLAYER_OPENED, { playerId: id, from: 'game' })
      openPlayerPanel({ id, player: null, stacked: false })
    }
    : asPanel
    ? (id: number) => {
      track(EVENTS.MLB_PLAYER_OPENED, { playerId: id, from: 'game' })
      stackNextPanel()
      openPlayerPanel({ id, player: null, stacked: true })
    }
    : onPlayerClick ? (id: number) => { onPlayerClick(id); onClose() } : undefined

  const decisions = [
    game.winPitcher  && { label: 'W',  name: game.winPitcher },
    game.losePitcher && { label: 'L',  name: game.losePitcher },
    game.savePitcher && { label: 'SV', name: game.savePitcher },
  ].filter(Boolean) as Array<{ label: string; name: string }>

  const tabChip = (value: 'summary' | 'box' | 'plays', label: string) => (
    <Box
      onClick={() => setTab(value)}
      sx={{
        px: 1.6, py: 0.75, borderRadius: 99, cursor: 'pointer', userSelect: 'none',
        fontSize: GC_META, fontWeight: 800, lineHeight: 1,
        color: tab === value ? 'background.paper' : 'text.secondary',
        bgcolor: tab === value ? 'text.primary' : 'action.hover',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </Box>
  )

  const filterChip = (value: boolean, label: string) => (
    <Box
      onClick={() => setScoringOnly(value)}
      sx={{
        px: 1.25, py: 0.6, borderRadius: 99, cursor: 'pointer', userSelect: 'none',
        fontSize: GC_CAPS, fontWeight: 800, lineHeight: 1,
        color: scoringOnly === value ? 'text.primary' : 'text.secondary',
        border: '1px solid', borderColor: scoringOnly === value ? 'text.secondary' : 'divider',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </Box>
  )

  const series = useGameSeries(game.gamePk, data?.gameType, data?.season)
  const swings = data ? biggestSwings(wp, data.plays, data.away, data.home) : []

  // Into the series sheet. Opened FROM that sheet, it is still underneath, so closing is the way
  // back. Otherwise the game's entry becomes the series' address (pushEntry replaces a sheet's own
  // entry, so Back from the series does not land on this game again) and SeriesRoute opens it on
  // the popstate, once this sheet has unmounted and stopped holding the section's handler off.
  const openSeries = () => {
    if (!series || !data) return
    const url = mlbSeriesPath(data.season, series.id)
    if (sheetOpenAt(url)) { close(); return }
    pushEntry({ view: 'standings' }, url)
    // The page has no sheet to close: the new address takes it away (GameRoute hears it).
    if (!isPage) close()
    window.setTimeout(() => window.dispatchEvent(new PopStateEvent('popstate')), 0)
  }

  const toTeam = onTeamClick ? (id: number) => { onTeamClick(id); if (!isPage) onClose() } : undefined

  // ── The boards, shared by the sheet and the page ─────────────────────────────

  const scoreHeader = (
    <>
      {/* Before the box score lands, the same table from what the scoreboard already had: the
          clubs, the runs, hits and errors, and nine empty innings, so nothing moves when it does. */}
      <Scoreboard box={data?.box ?? { innings: [], away: game.away, home: game.home } as unknown as BoxScore} decided={isFinal} onTeam={toTeam} />

      {/* W/L/SV decisions (finals) */}
      {isFinal && decisions.length > 0 && (
        <Box sx={{ px: 2, pt: 1.25, display: 'flex', flexWrap: 'wrap', gap: 1.75 }}>
          {decisions.map(d => (
            <Box key={d.label} sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
              <Typography sx={{ fontSize: GC_CAPS, fontWeight: 800, color: 'text.secondary', lineHeight: 1 }}>{d.label}</Typography>
              <Typography sx={{ fontSize: GC_META, fontWeight: 700, lineHeight: 1 }}>{d.name}</Typography>
            </Box>
          ))}
        </Box>
      )}

      {loading && !data && !isPage && (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <Typography sx={{ fontSize: GC_META, color: 'text.secondary' }}>Loading game…</Typography>
        </Box>
      )}
    </>
  )

  const playsControls = (
    <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
      {/* Only in All: Scoring is a flat list of the runs, with nothing to fold. */}
      {!(scoringOnly && hasScoring) && (
        <Box
          {...pressable(toggleAll)}
          aria-label={allOpen ? 'Collapse every half-inning' : 'Expand every half-inning'}
          sx={{
            ...FOCUS_RING, display: 'inline-flex', alignItems: 'center', gap: 0.4, mr: 0.5,
            px: 0.75, minHeight: chromePx(28), borderRadius: 1, cursor: 'pointer', userSelect: 'none',
            fontSize: GC_CAPS, fontWeight: 800, letterSpacing: typePx(0.6), textTransform: 'uppercase',
            color: 'text.secondary', ...hoverOnly({ color: 'text.primary' }),
          }}
        >
          <Box component="span" aria-hidden sx={{ fontSize: '0.58rem', transition: 'transform 0.15s', transform: allOpen ? 'rotate(90deg)' : 'none' }}>▶</Box>
          {allOpen ? 'Collapse all' : 'Expand all'}
        </Box>
      )}
      {hasScoring && filterChip(true, 'Scoring')}
      {filterChip(false, 'All')}
    </Box>
  )

  const summaryBoard = data && (
    <Box>
      {series ? <SeriesBand s={series} gamePk={game.gamePk} season={data.season} onOpen={openSeries} />
        : series === undefined && game.series ? <SeriesBandSkeleton /> : null}
      {isLive && data.situation && <SituationPanel sit={data.situation} onPlayerClick={selectPlayer} />}
      {wp.length >= 2 && (
        <Box sx={{ px: 2, py: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
          <WinProbChart pts={wp} plays={data.plays} away={data.away} home={data.home} live={isLive} marks={swings.map(w => w.index)} />
        </Box>
      )}
      {(data.performers.length > 0 || swings.length > 0) && (
        <Box sx={{
          display: 'grid', alignItems: 'start', borderTop: '1px solid', borderColor: 'divider',
          // Abreast from `lg` in the sheet; never on the page, whose column is half that.
          gridTemplateColumns: isPage ? 'minmax(0, 1fr)' : { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) minmax(0, 1fr)' },
        }}>
          {data.performers.length > 0 && (
            <Box sx={{ minWidth: 0, borderRightStyle: 'solid', borderRightColor: 'divider', borderRightWidth: isPage ? 0 : { xs: 0, lg: swings.length ? '1px' : 0 } }}>
              <TopPerformers performers={data.performers} onPlayerClick={selectPlayer} />
            </Box>
          )}
          {swings.length > 0 && (
            <Box sx={{ minWidth: 0, borderTopStyle: 'solid', borderTopColor: 'divider', borderTopWidth: isPage ? (data.performers.length ? '1px' : 0) : { xs: data.performers.length ? '1px' : 0, lg: 0 } }}>
              <BiggestSwings swings={swings} away={data.away.teamId} home={data.home.teamId} />
            </Box>
          )}
        </Box>
      )}
      <GameInfo info={data.info} />
    </Box>
  )

  const playsBoard = data && (
    <Box sx={{ pb: 1.5 }}>
      <PlaysList plays={data.plays} away={data.away} home={data.home} scoringOnly={scoringOnly && hasScoring}
        expanded={expanded} onToggle={toggleHalf} />
    </Box>
  )

  const copyLink = <MlbCopyLink target={{ kind: 'game', gamePk: game.gamePk }} title="Copy a link to this game" />
  const eyebrow = (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, color: isLive ? TONE.red : 'inherit' }}>
      {isLive && <LiveDot size={6} />}
      {statusText}
    </Box>
  )

  if (isPage) return (
    <GamePageLayout
      gamePk={game.gamePk} heading={heading} eyebrow={eyebrow} actions={copyLink} onBack={onBack ?? onClose}
      header={scoreHeader} away={away} home={home} showScore={isFinal || isLive}
      summaryLabel={isLive ? 'Live' : 'Summary'}
      summary={summaryBoard} box={data && <TeamBoxColumns box={data.box} onPlayerClick={selectPlayer} stacked />}
      plays={playsBoard} playsControls={playsControls} initialTab={initialTab} ready={!!data} postseason={!!game.series}
    />
  )

  // The shared sheet (src/ui/ModalShell): a bottom sheet on a phone that drags down to close, a
  // centred card above that. Laid out as WPBL's game page is (GameDetail.tsx): the line score as the
  // header, then tabs, and from `lg` a sheet wide enough to use: the win probability across its
  // full width, and both clubs' box scores at once. It was 560px at every
  // width, so a desktop reader scrolled one long column with most of the window empty beside it.
  return (
    <ModalShell
      onClose={close}
      maxWidth={{ xs: chromePx(560), lg: chromePx(840) }}
      sheet
      sheetFill
      // Between a phone and a desktop, full height from the first frame (see ModalShell).
      dialogFill
      panel
      openKey={game.gamePk}
      actions={<>
        {asPanel && onExpand && <ExpandButton onExpand={() => onExpand(tab)} title="Open the full Game Center" />}
        {copyLink}
      </>}
      eyebrow={eyebrow}
    >
      {/* While the sheet is up the game is the page (PageHeading.tsx). */}
      <MlbHiddenH1>{heading}</MlbHiddenH1>

      {scoreHeader}

      {data && (
        <>
          {/* Tabs, WPBL's three: the story of the game, the tables, every play. */}
          <Box sx={{
            mt: 1.5, px: 2, py: 1.25, borderTop: '1px solid', borderColor: 'divider',
            display: 'flex', alignItems: 'center', gap: 0.75,
            position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 1,
          }}>
            {tabChip('summary', isLive ? 'Live' : 'Summary')}
            {tabChip('box', 'Box Score')}
            {tabChip('plays', 'Plays')}
            {tab === 'plays' && playsControls}
          </Box>

          {tab === 'summary' ? summaryBoard : tab === 'box' ? (
            <TeamBoxColumns box={data.box} onPlayerClick={selectPlayer} />
          ) : playsBoard}
        </>
      )}
    </ModalShell>
  )
}

// ─── Before the game is known ─────────────────────────────────────────────────

/**
 * The full page while GameRoute is still reading which game the address names: a cold landing has
 * nothing but the gamePk. The same layout, the scoreboard's table with its clubs left blank, and the
 * decisions line held open, since a game reached by a link is most often a finished one.
 */
export function GamePageSkeleton({ gamePk, onBack }: { gamePk: number; onBack: () => void }) {
  const blankTeam = { teamId: 0, abbr: '', name: ' ', runs: '', hits: '', errors: '' }
  return (
    <GamePageLayout
      gamePk={gamePk} heading="MLB Game Center" eyebrow={' '} onBack={onBack}
      actions={<MlbCopyLink target={{ kind: 'game', gamePk }} title="Copy a link to this game" />}
      header={<>
        <Scoreboard blank box={{ innings: [], away: blankTeam, home: blankTeam } as unknown as BoxScore} decided={false} />
        <Box aria-hidden sx={{ px: 2, pt: 1.25, display: 'flex', gap: 1.75, visibility: 'hidden' }}>
          <Typography sx={{ fontSize: GC_META, fontWeight: 700, lineHeight: 1 }}>W</Typography>
        </Box>
      </>}
      away={{ abbr: '' }} home={{ abbr: '' }} showScore={false} summaryLabel="Summary"
      summary={null} box={null} plays={null} playsControls={null} ready={false} postseason={false}
    />
  )
}

// ─── The full page's layout ───────────────────────────────────────────────────
//
// The sheet's three tabs as three sections on one page. From `lg`, two columns: the story of the
// game on the left (the summary, then every play) and the numbers on the right (both box scores,
// one above the other), so a swing in the plays can be read against the line it came from. Below
// `lg`, one column in reading order: summary, box scores, plays. The jump bar stands in for the
// tabs: pinned under the toolbar with the score at its left, so a reader deep in the plays still
// sees the score and can reach any board in one click. Real links to the sections' ids, so they
// also work as anchors.

const GC_SECTION = { summary: 'gc-summary', box: 'gc-box', plays: 'gc-plays' } as const

function GamePageLayout({ gamePk, heading, eyebrow, actions, onBack, header, away, home, showScore, summaryLabel, summary, box, plays, playsControls, initialTab, ready, postseason }: {
  gamePk: number
  heading: string
  eyebrow: React.ReactNode
  actions: React.ReactNode
  onBack: () => void
  header: React.ReactNode
  away: { abbr: string; runs?: number }
  home: { abbr: string; runs?: number }
  showScore: boolean
  summaryLabel: string
  summary: React.ReactNode
  box: React.ReactNode
  plays: React.ReactNode
  playsControls: React.ReactNode
  initialTab?: 'summary' | 'box' | 'plays'
  ready: boolean
  /** A postseason game, whose summary opens with the series band: its room is held while loading. */
  postseason: boolean
}) {
  // Expand from the panel's Box Score or Plays lands on that board, once, when there is a board to
  // land on. Not the summary: that is where the page starts anyway.
  const landed = useRef(false)
  useEffect(() => {
    if (!ready || landed.current) return
    landed.current = true
    if (!initialTab || initialTab === 'summary') return
    requestAnimationFrame(() => document.getElementById(GC_SECTION[initialTab])?.scrollIntoView({ block: 'start' }))
  }, [ready, initialTab])

  const jump = (to: keyof typeof GC_SECTION) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    document.getElementById(GC_SECTION[to])?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
  }

  const cardSx = {
    bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 3, overflow: 'hidden',
  } as const
  // Clear of the toolbar and the jump bar when a link lands a section at the top.
  const scrollMarginTop = `calc(var(--app-header-h, 0px) + ${chromePx(56)})`
  // THE PAGE IS DRAWN BEFORE ITS DATA, as every loading state here is (CLAUDE.md): the bar, the
  // header, the jump bar and the three cards at their loaded places, each body holding about the
  // room its board takes on a nine-inning game, so the cards beside and below do not move when the
  // boards land. Measured at 1440 on a final ALDS game: summary 1216px, box 1350, plays 1161.
  const reserve = { summary: chromePx(973), box: chromePx(1080), plays: chromePx(929) }
  const pending = (key: keyof typeof GC_SECTION) => (
    <Box aria-busy sx={{ minHeight: reserve[key] }}>
      {key === 'summary' && postseason && <SeriesBandSkeleton />}
    </Box>
  )
  const section = (key: keyof typeof GC_SECTION, title: string, body: React.ReactNode, controls?: React.ReactNode) => (
    <Box component="section" id={GC_SECTION[key]} aria-label={title} sx={{ ...cardSx, gridArea: key, minWidth: 0, scrollMarginTop }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography component="h2" sx={{ fontSize: GC_CAPS, fontWeight: 800, letterSpacing: typePx(0.6), textTransform: 'uppercase', color: 'text.secondary' }}>
          {title}
        </Typography>
        {/* The plays' controls are drawn from the first frame, hidden, so the header is its own height
            before there are plays to filter. */}
        {/* One height whichever controls a game has (the fold toggle is taller than the two chips),
            so the header does not change size when the plays land and pick theirs. */}
        {controls !== undefined && (
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', minHeight: chromePx(28), visibility: ready ? 'visible' : 'hidden' }}>{controls}</Box>
        )}
      </Box>
      {ready ? body : pending(key)}
    </Box>
  )
  const linkSx = {
    ...FOCUS_RING, fontSize: GC_META, fontWeight: 700, color: 'text.secondary', textDecoration: 'none', borderRadius: 1,
    ...hoverOnly({ color: 'text.primary' }),
  } as const

  return (
    <Box component="article" sx={{ width: '100%', maxWidth: chromePx(1200), mx: 'auto', pb: 4 }}>
      {/* While the page is up the game is the page (PageHeading.tsx), as with the sheet, until a
          player's panel over it takes the address. */}
      <MlbAddressH1 path={mlbGamePath(gamePk)}>{heading}</MlbAddressH1>
      <DetailPageBar onBack={onBack} eyebrow={eyebrow} actions={actions} />
      <Box sx={{ ...cardSx, pb: 1.5, mb: 1.5 }}>{header}</Box>

      <Box component="nav" aria-label="Game Center sections" sx={{
        position: 'sticky', top: 'var(--app-header-h, 0px)', zIndex: 3,
        bgcolor: 'background.default', py: 1, mb: 1.5,
        display: 'flex', alignItems: 'center', gap: 2,
        borderBottom: '1px solid', borderColor: 'divider',
      }}>
        <Box component="a" href={`#${GC_SECTION.summary}`} onClick={jump('summary')} sx={linkSx}>{summaryLabel}</Box>
        <Box component="a" href={`#${GC_SECTION.box}`} onClick={jump('box')} sx={linkSx}>Box Score</Box>
        <Box component="a" href={`#${GC_SECTION.plays}`} onClick={jump('plays')} sx={linkSx}>Plays</Box>
        {/* The score at the far end, so the links stay put while it is not known yet: at the start of
            the bar its width, which depends on the clubs, would slide them along when it arrived. */}
        <Typography sx={{ ml: 'auto', fontSize: GC_BODY, fontWeight: 800, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', visibility: showScore ? 'visible' : 'hidden' }}>
          {showScore ? `${away.abbr} ${away.runs ?? 0}, ${home.abbr} ${home.runs ?? 0}` : ' '}
        </Typography>
      </Box>

      <Box sx={{
        display: 'grid', gap: 1.5, alignItems: 'start',
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) minmax(0, 1fr)' },
        gridTemplateAreas: { xs: '"summary" "box" "plays"', lg: '"summary box" "plays box"' },
        // The box column is one long card beside two; without this the first row stretches to it
        // and leaves a gap under the summary as tall as the box scores.
        gridTemplateRows: { lg: 'auto 1fr' },
      }}>
        {section('summary', summaryLabel, summary)}
        {section('box', 'Box Score', box)}
        {section('plays', 'Plays', plays, playsControls)}
        </Box>
    </Box>
  )
}

// What Game Center's Summary tab carries under the win probability graph: where the game sits in
// its postseason series (with a way into the series itself), the feed's top performers, the plays
// that moved the graph most, and the game's particulars. Each piece draws nothing when it has
// nothing to say, so a spring game or a feed missing a field simply shows less.
import { useEffect, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { ChevronRight } from '@mui/icons-material'
import { HEADSHOT, TEAM_BG, TEAM_NICKNAME } from '../constants'
import { LogoBubble, SectionLabel } from '../components/boxScore'
import { useIsDark, photoBorderAlpha, chartPairColors, inkOn, textTone } from '../lib/colorUtils'
import { playerLink, LINK_SX } from '../lib/links'
import { linkPress, hoverOnly, FOCUS_RING } from '../../ui/interaction'
import { chromePx, typePx } from '../../ui/scale'
import { useUnits } from '../../UnitsContext'
import { fetchBracket, seriesName, winsNeeded } from '../postseason'
import type { PsSeries } from '../postseason'
import { mlbSeriesPath } from '../routes'
import { GC_CAPS, GC_META, GC_BODY } from './gameType'
import type { MlbSeriesId } from '../routes'

const POSTSEASON_TYPES = new Set(['F', 'D', 'L', 'W'])

// ─── The series ───────────────────────────────────────────────────────────────

export interface SeriesRef { season: number; id: MlbSeriesId }

/** The series this game belongs to, from the bracket (cached app-wide), or null for a game that
 *  is not in one. The bracket is the only read that knows which slot a gamePk sits in. UNDEFINED
 *  while the bracket is still being read for a postseason game, so the band's room can be held
 *  until it lands (SeriesBandSkeleton) rather than the band pushing the summary down when it does. */
export function useGameSeries(gamePk: number, gameType: string | undefined, season: number | undefined): PsSeries | null | undefined {
  const [series, setSeries] = useState<PsSeries | null | undefined>(null)
  useEffect(() => {
    if (!gameType || !POSTSEASON_TYPES.has(gameType) || !season) { setSeries(null); return }
    setSeries(undefined)
    let alive = true
    fetchBracket(season).then(b => {
      if (!alive) return
      if (!b) { setSeries(null); return }
      setSeries(Object.values(b.series).find(s => s.games.some(g => g.gamePk === gamePk)) ?? null)
    })
    return () => { alive = false }
  }, [gamePk, gameType, season])
  return series
}

/** "ALCS · Game 5 of 7" and where the series stood once THIS game ended (or stands going into it),
 *  not where it stands today: a reader opening game 2 in November wants game 2's series. */
export function SeriesBand({ s, gamePk, season, onOpen }: {
  s: PsSeries; gamePk: number; season: number; onOpen: () => void
}) {
  const g = s.games.find(x => x.gamePk === gamePk)
  if (!g) return null
  const counted = s.games.filter(x => x.state === 'final' && (x.number < g.number || x.gamePk === gamePk))
  const wTop = counted.filter(x => x.winnerId === s.top.id).length
  const wBot = counted.filter(x => x.winnerId === s.bottom.id).length
  const need = winsNeeded(s)
  const name = (t: PsSeries['top']) => t.real ? (TEAM_NICKNAME[t.id] ?? t.abbr) : t.abbr
  const lead = wTop > wBot ? s.top : wBot > wTop ? s.bottom : null
  const hi = Math.max(wTop, wBot), lo = Math.min(wTop, wBot)
  const done = g.state === 'final'
  const line = hi === need ? `The ${name(lead!)} win the series ${hi}-${lo}`
    : lead ? `The ${name(lead)} lead ${hi}-${lo}${done ? '' : ' going in'}`
    : hi + lo === 0 ? (done ? '' : 'Game 1')
    : `Series tied ${hi}-${lo}${done ? '' : ' going in'}`
  return (
    <Box sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', borderTop: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: GC_CAPS, fontWeight: 800, letterSpacing: typePx(0.6), textTransform: 'uppercase', color: 'primary.main', lineHeight: 1.3 }}>
          {seriesName(s)} · Game {g.number} of {s.bestOf}
        </Typography>
        {line && <Typography sx={{ fontSize: GC_BODY, fontWeight: 700, lineHeight: 1.35 }}>{line}</Typography>}
      </Box>
      <Box {...linkPress(mlbSeriesPath(season, s.id), onOpen)} sx={{
        ...LINK_SX, display: 'inline-flex', alignItems: 'center', gap: 0.25, flexShrink: 0, cursor: 'pointer',
        fontSize: GC_META, fontWeight: 800, color: 'text.secondary', px: 1.4, py: 0.6, borderRadius: 999,
        border: '1px solid', borderColor: 'divider', ...hoverOnly({ bgcolor: 'action.hover', color: 'text.primary' }), ...FOCUS_RING,
      }}>
        View series <ChevronRight sx={{ fontSize: '0.95rem' }} />
      </Box>
    </Box>
  )
}

/** The band's room while the bracket loads: the same box, both lines and the chip, drawn invisible,
 *  so the summary under it does not move when the band arrives. */
export function SeriesBandSkeleton() {
  return (
    <Box aria-hidden sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', gap: 1.5, borderTop: '1px solid', borderColor: 'divider', visibility: 'hidden' }}>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: GC_CAPS, fontWeight: 800, letterSpacing: typePx(0.6), textTransform: 'uppercase', lineHeight: 1.3 }}>Series</Typography>
        <Typography sx={{ fontSize: GC_BODY, fontWeight: 700, lineHeight: 1.35 }}>Series</Typography>
      </Box>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, flexShrink: 0, fontSize: GC_META, fontWeight: 800, px: 1.4, py: 0.6, border: '1px solid' }}>
        View series <ChevronRight sx={{ fontSize: '0.95rem' }} />
      </Box>
    </Box>
  )
}

// ─── Top performers ───────────────────────────────────────────────────────────

export interface Performer { id: number; name: string; teamId: number; abbr: string; kind: string; line: string }

const KIND_LABEL: Record<string, string> = { hitter: 'At the plate', starter: 'Starter', reliever: 'Out of the pen' }

export function TopPerformers({ performers, onPlayerClick }: {
  performers: Performer[]; onPlayerClick?: (id: number) => void
}) {
  const isDark = useIsDark()
  if (!performers.length) return null
  return (
    <Box sx={{ px: 2, py: 1.5 }}>
      <SectionLabel>Top performers</SectionLabel>
      <Box sx={{ mt: 1.25, display: 'grid', gap: 1.25 }}>
        {performers.map(p => (
          <Box key={p.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
            <Box sx={{ position: 'relative', flexShrink: 0 }}>
              <Box component="img" src={HEADSHOT(p.id)} alt="" loading="lazy" sx={{
                width: chromePx(42), height: chromePx(42), borderRadius: '50%', objectFit: 'cover', display: 'block',
                bgcolor: 'action.hover', border: '1.5px solid', borderColor: photoBorderAlpha(TEAM_BG[p.teamId] ?? '#888888', isDark),
              }} />
              <Box sx={{ position: 'absolute', right: chromePx(-4), bottom: chromePx(-3) }}>
                <LogoBubble teamId={p.teamId} abbr={p.abbr} size={18} ring={1} />
              </Box>
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: GC_CAPS, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: typePx(0.6), lineHeight: 1.3 }}>
                {KIND_LABEL[p.kind] ?? p.kind}
              </Typography>
              <Typography {...playerLink(p.id, p.name, onPlayerClick)} sx={{
                ...LINK_SX, display: 'block', fontSize: GC_BODY, fontWeight: 800, lineHeight: 1.3,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                ...(onPlayerClick ? { cursor: 'pointer', ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING } : {}),
              }}>
                {p.name}
              </Typography>
              <Typography sx={{ fontSize: GC_META, color: 'text.secondary', lineHeight: 1.35 }}>{p.line}</Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// ─── Biggest swings ───────────────────────────────────────────────────────────

export interface Swing {
  /** Index into the win probability points, so the graph can mark it. */
  index: number
  /** Points of win probability, toward the club named. */
  delta: number
  teamId: number
  abbr: string
  inning: number
  half: 'top' | 'bottom'
  event: string
  description: string
}

/** The plays that moved home win probability most, largest first, each by its own before and
 *  after (StatsAPI's figure for that play, so the first play of the game counts too). */
export function biggestSwings<P extends { atBatIndex: number; inning: number; half: 'top' | 'bottom'; event: string; description: string }>(
  pts: { wp: number; before: number; atBatIndex: number }[], plays: P[],
  away: { teamId: number; abbr: string }, home: { teamId: number; abbr: string }, count = 3,
): Swing[] {
  const byIdx = new Map(plays.map(p => [p.atBatIndex, p] as const))
  const out: Swing[] = []
  for (let i = 0; i < pts.length; i++) {
    const d = pts[i].wp - pts[i].before
    const play = byIdx.get(pts[i].atBatIndex)
    if (!play || Math.abs(d) < 1) continue
    const side = d > 0 ? home : away
    out.push({
      index: i, delta: Math.round(Math.abs(d)), teamId: side.teamId, abbr: side.abbr,
      inning: play.inning, half: play.half, event: play.event, description: play.description,
    })
  }
  return out.sort((a, b) => b.delta - a.delta).slice(0, count)
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/** Coloured as the chart colours each club, so a numbered dot here matches the one on the line. */
export function BiggestSwings({ swings, away, home }: { swings: Swing[]; away: number; home: number }) {
  const isDark = useIsDark()
  const [awayCol, homeCol] = chartPairColors(away, home, isDark)
  if (!swings.length) return null
  return (
    <Box sx={{ px: 2, py: 1.5 }}>
      <SectionLabel>Biggest swings</SectionLabel>
      <Box sx={{ mt: 1.25, display: 'grid', gap: 1.5 }}>
        {swings.map((w, i) => {
          const col = w.teamId === home ? homeCol : awayCol
          return (
            <Box key={w.index} sx={{ display: 'flex', gap: 1.25, minWidth: 0 }}>
              {/* The number the graph marks this play with. */}
              <Box sx={{
                flexShrink: 0, width: '1.4rem', height: '1.4rem', borderRadius: '50%', bgcolor: col,
                color: inkOn(col), fontSize: '0.66rem', fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{i + 1}</Box>
              <Box sx={{ minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, flexWrap: 'wrap' }}>
                  <Typography sx={{ fontSize: GC_BODY, fontWeight: 800, lineHeight: 1.3 }}>{w.event}</Typography>
                  <Typography sx={{ fontSize: GC_META, color: 'text.secondary', lineHeight: 1.3 }}>
                    {w.half === 'top' ? '▲' : '▼'} {ordinal(w.inning)}
                  </Typography>
                  <Typography sx={{ fontSize: GC_META, fontWeight: 800, color: textTone(col, isDark), lineHeight: 1.3, fontVariantNumeric: 'tabular-nums' }}>
                    +{w.delta}% {w.abbr}
                  </Typography>
                </Box>
                <Typography sx={{
                  fontSize: GC_META, color: 'text.secondary', lineHeight: 1.5, mt: 0.25,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>
                  {w.description}
                </Typography>
              </Box>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

// ─── The particulars ──────────────────────────────────────────────────────────

export interface GameInfoData {
  venue: string | null
  attendance: number | null
  firstPitch: string | null
  durationMin: number | null
  weather: { condition?: string; temp?: string; wind?: string } | null
}

export function GameInfo({ info }: { info: GameInfoData }) {
  const { units } = useUnits()
  const metric = units === 'metric'
  const temp = info.weather?.temp != null && info.weather.temp !== ''
    ? metric ? `${Math.round((Number(info.weather.temp) - 32) * 5 / 9)}°C` : `${info.weather.temp}°F`
    : null
  // "1 mph, Varies": the speed converts, the direction is words.
  const wind = info.weather?.wind
    ? info.weather.wind.replace(/(\d+)\s*mph/, (_, n) => metric ? `${Math.round(Number(n) * 1.609)} km/h` : `${n} mph`)
    : null
  const rows: [string, string | null][] = [
    ['Venue', info.venue],
    ['First pitch', info.firstPitch ? new Date(info.firstPitch).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null],
    ['Time', info.durationMin ? `${Math.floor(info.durationMin / 60)}:${String(info.durationMin % 60).padStart(2, '0')}` : null],
    ['Attendance', info.attendance ? info.attendance.toLocaleString() : null],
    ['Weather', [temp, info.weather?.condition].filter(Boolean).join(', ') || null],
    ['Wind', wind],
  ]
  const shown = rows.filter((r): r is [string, string] => !!r[1])
  if (!shown.length) return null
  return (
    <Box sx={{ px: 2, py: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
      <SectionLabel>Game info</SectionLabel>
      <Box sx={{ mt: 1.25, display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))' }, columnGap: 2, rowGap: 1.5 }}>
        {shown.map(([k, v]) => (
          <Box key={k} sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: GC_CAPS, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: typePx(0.6), lineHeight: 1.3 }}>{k}</Typography>
            <Typography sx={{ fontSize: GC_BODY, fontWeight: 600, lineHeight: 1.35, mt: 0.25 }}>{v}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

export const isPostseasonType = (t: string | undefined) => !!t && POSTSEASON_TYPES.has(t)

import React, { useState, useEffect, useRef } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import { CareerStatSplit, RecentGameEntry } from './types'
import { ACCENT, CURRENT_SEASON, TEAM_BG } from './constants'
import { fmtR, parseIP } from './utils'
import { SegControl } from './components'
import { TREND_HIT_DEFS, TREND_PIT_DEFS } from './trendDefs'
import { fetchSeasonPlayerStats } from './api'

export { TREND_HIT_DEFS, TREND_PIT_DEFS } from './trendDefs'


// ─── League avg cache (module-level, keyed "hitting-2023") ────────────────────
//
// The raw per-season payload is fetched + cached once in api.ts and shared with
// the leaderboard / rankings; here we just cache the lighter mapped-to-`.stat`
// projection so repeated chart interactions don't re-map 2,000 rows each time.

const leagueStatsCache = new Map<string, Promise<any[]>>()
const LEAGUE_CACHE_MAX = 30

function fetchLeagueStatsBySeason(season: number, group: 'hitting' | 'pitching'): Promise<any[]> {
  const key = `${group}-${season}`
  if (!leagueStatsCache.has(key)) {
    if (leagueStatsCache.size >= LEAGUE_CACHE_MAX) {
      // Evict oldest entry (Map iteration order = insertion order)
      leagueStatsCache.delete(leagueStatsCache.keys().next().value!)
    }
    leagueStatsCache.set(key,
      fetchSeasonPlayerStats(group, season).then(splits => splits.map((s: any) => s.stat))
    )
  }
  return leagueStatsCache.get(key)!
}

// ─── Rolling window chart (current season) ───────────────────────────────────

function RollingWindowChart({ games, isPitcher, season, onGameSelect }: {
  games: RecentGameEntry[]
  isPitcher: boolean
  season: number
  onGameSelect?: (date: string) => void
}) {
  const [hovIdx, setHovIdx] = useState<number | null>(null)
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 })
  const [leagueAvg, setLeagueAvg] = useState<number | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const rafRef = useRef<number | null>(null)
  const hovIdxRef = useRef<number | null>(null)
  // Background-colored halo behind on-chart text labels so they stay legible even
  // where the trendline passes through them.
  const labelHalo = { stroke: useTheme().palette.background.paper, strokeWidth: 3.5, strokeLinejoin: 'round', paintOrder: 'stroke' } as const

  // Fetch league-average OPS (hitters) or ERA (pitchers) for this season
  useEffect(() => {
    let cancelled = false
    setLeagueAvg(null)
    fetchLeagueStatsBySeason(season, isPitcher ? 'pitching' : 'hitting').then(all => {
      if (cancelled) return
      if (!isPitcher) {
        const lgH   = all.reduce((s, x) => s + Number(x.hits ?? 0), 0)
        const lgAB  = all.reduce((s, x) => s + Number(x.atBats ?? 0), 0)
        const lgBB  = all.reduce((s, x) => s + Number(x.baseOnBalls ?? 0), 0)
        const lgHBP = all.reduce((s, x) => s + Number(x.hitByPitch ?? 0), 0)
        const lgSF  = all.reduce((s, x) => s + Number(x.sacFlies ?? 0), 0)
        const lgTB  = all.reduce((s, x) =>
          s + Number(x.hits ?? 0) + Number(x.doubles ?? 0) + 2*Number(x.triples ?? 0) + 3*Number(x.homeRuns ?? 0), 0)
        const denom = lgAB + lgBB + lgHBP + lgSF
        if (denom > 0 && lgAB > 0) setLeagueAvg((lgH + lgBB + lgHBP) / denom + lgTB / lgAB)
      } else {
        const lgER = all.reduce((s, x) => s + Number(x.earnedRuns ?? 0), 0)
        const lgIP = all.reduce((s, x) => s + parseIP(x.inningsPitched ?? '0'), 0)
        if (lgIP > 0) setLeagueAvg((lgER * 9) / lgIP)
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [season, isPitcher]) // eslint-disable-line react-hooks/exhaustive-deps

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const fmtDate = (d: string) => {
    if (!d) return ''
    const [, m, day] = d.split('-').map(Number)
    return `${MONTHS[m - 1]} ${day}`
  }

  // Sort chronologically (API returns newest-first)
  const chrono = [...games].reverse().filter(g => isPitcher ? g.pitching != null : g.hitting != null)

  // Detect SP vs RP: if ≥50% of appearances are 3+ IP → starter
  const isStarter = isPitcher && (() => {
    if (!chrono.length) return true
    const long = chrono.filter(g => parseIP(g.pitching?.inningsPitched ?? '0') >= 3).length
    return long / chrono.length >= 0.5
  })()

  // Fixed window sizes — no growing logic
  const HIT_WINDOW   = 10        // hitters: last 10 games
  const SP_WINDOW    = 5         // starters: last 5 starts
  const RP_IP_TARGET = 15        // relievers: last ~15 innings
  const RP_MIN_IP    = 3         // minimum IP before we start plotting for RP

  // Player's own season stat computed from the full game log
  const seasonStat = (() => {
    if (!isPitcher) {
      const h   = chrono.reduce((s, x) => s + Number(x.hitting?.hits          ?? 0), 0)
      const ab  = chrono.reduce((s, x) => s + Number(x.hitting?.atBats        ?? 0), 0)
      const bb  = chrono.reduce((s, x) => s + Number(x.hitting?.baseOnBalls   ?? 0), 0)
      const hbp = chrono.reduce((s, x) => s + Number(x.hitting?.hitByPitch    ?? 0), 0)
      const sf  = chrono.reduce((s, x) => s + Number(x.hitting?.sacFlies      ?? 0), 0)
      const tb  = chrono.reduce((s, x) => {
        const hx = x.hitting; if (!hx) return s
        return s + Number(hx.hits ?? 0) + Number(hx.doubles ?? 0) + 2*Number(hx.triples ?? 0) + 3*Number(hx.homeRuns ?? 0)
      }, 0)
      const denom = ab + bb + hbp + sf
      const ops   = denom > 0 && ab > 0 ? (h + bb + hbp) / denom + tb / ab : null
      return { stat: ops, volume: ab, volumeLabel: 'AB' as const }
    } else {
      const er = chrono.reduce((s, x) => s + Number(x.pitching?.earnedRuns     ?? 0), 0)
      const ip = chrono.reduce((s, x) => s + parseIP(x.pitching?.inningsPitched ?? '0'), 0)
      return { stat: ip > 0 ? (er * 9) / ip : null, volume: ip, volumeLabel: 'IP' as const }
    }
  })()

  const pts = chrono
    .map((g, i) => {
      if (!isPitcher) {
        // Hitters: fixed 10-game window
        if (i < HIT_WINDOW - 1) return null
        const win = chrono.slice(i - HIT_WINDOW + 1, i + 1)
        const h   = win.reduce((s, x) => s + Number(x.hitting?.hits ?? 0), 0)
        const ab  = win.reduce((s, x) => s + Number(x.hitting?.atBats ?? 0), 0)
        const bb  = win.reduce((s, x) => s + Number(x.hitting?.baseOnBalls ?? 0), 0)
        const hbp = win.reduce((s, x) => s + Number(x.hitting?.hitByPitch ?? 0), 0)
        const sf  = win.reduce((s, x) => s + Number(x.hitting?.sacFlies ?? 0), 0)
        const tb  = win.reduce((s, x) => {
          const hx = x.hitting; if (!hx) return s
          return s + Number(hx.hits ?? 0) + Number(hx.doubles ?? 0) + 2*Number(hx.triples ?? 0) + 3*Number(hx.homeRuns ?? 0)
        }, 0)
        const denom = ab + bb + hbp + sf
        const obp = denom > 0 ? (h + bb + hbp) / denom : 0
        const slg = ab > 0 ? tb / ab : 0
        const value = ab > 0 ? obp + slg : null
        return { date: g.date, opp: g.opponentAbbr, isHome: g.isHome, value, size: HIT_WINDOW, ip: null as number | null }
      } else if (isStarter) {
        // SP: fixed 5-start window
        if (i < SP_WINDOW - 1) return null
        const win = chrono.slice(i - SP_WINDOW + 1, i + 1)
        const er  = win.reduce((s, x) => s + Number(x.pitching?.earnedRuns ?? 0), 0)
        const ip  = win.reduce((s, x) => s + parseIP(x.pitching?.inningsPitched ?? '0'), 0)
        const value = ip > 0 ? (er * 9) / ip : null
        return { date: g.date, opp: g.opponentAbbr, isHome: g.isHome, value, size: SP_WINDOW, ip }
      } else {
        // RP: rolling ~15-inning window — go back until we've accumulated RP_IP_TARGET IP
        const cumIP = chrono.slice(0, i + 1).reduce((s, x) => s + parseIP(x.pitching?.inningsPitched ?? '0'), 0)
        if (cumIP < RP_MIN_IP) return null
        let winIP = 0, winStart = i
        for (let j = i; j >= 0; j--) {
          winIP += parseIP(chrono[j].pitching?.inningsPitched ?? '0')
          winStart = j
          if (winIP >= RP_IP_TARGET) break
        }
        const win = chrono.slice(winStart, i + 1)
        const er  = win.reduce((s, x) => s + Number(x.pitching?.earnedRuns ?? 0), 0)
        const ip  = win.reduce((s, x) => s + parseIP(x.pitching?.inningsPitched ?? '0'), 0)
        const value = ip > 0 ? (er * 9) / ip : null
        return { date: g.date, opp: g.opponentAbbr, isHome: g.isHome, value, size: win.length, ip }
      }
    })
    .filter((p): p is NonNullable<typeof p> & { value: number } => p != null && p.value != null)

  // Touch support
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !boxRef.current) return
    const W_SVG = 560, M_L = 42, IW = W_SVG - 42 - 16
    const handleTouch = (e: TouchEvent) => {
      e.preventDefault()
      const touch = e.touches[0] ?? e.changedTouches[0]
      if (!touch || !boxRef.current) return
      const rect = boxRef.current.getBoundingClientRect()
      const relX = ((touch.clientX - rect.left) / rect.width) * W_SVG - M_L
      const frac = Math.max(0, Math.min(1, relX / IW))
      setHovIdx(Math.round(frac * (pts.length - 1)))
      hovIdxRef.current = Math.round(frac * (pts.length - 1))
      setTipPos({ x: (touch.clientX - rect.left) / rect.width * 100, y: (touch.clientY - rect.top) / rect.height * 100 })
    }
    const handleTouchEnd = () => {
      if (hovIdxRef.current != null && pts[hovIdxRef.current]) {
        onGameSelect?.(pts[hovIdxRef.current].date)
      }
      hovIdxRef.current = null
      setHovIdx(null)
    }
    svg.addEventListener('touchstart', handleTouch, { passive: false })
    svg.addEventListener('touchmove',  handleTouch, { passive: false })
    svg.addEventListener('touchend',   handleTouchEnd)
    return () => {
      svg.removeEventListener('touchstart', handleTouch)
      svg.removeEventListener('touchmove',  handleTouch)
      svg.removeEventListener('touchend',   handleTouchEnd)
    }
  }, [pts.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (pts.length < 3) {
    return (
      <Box sx={{ py: 3, textAlign: 'center' }}>
        <Typography color="text.secondary" sx={{ fontSize: '0.85rem' }}>
          Not enough games yet to show a trend
        </Typography>
      </Box>
    )
  }

  const label     = isPitcher ? 'ERA' : 'OPS'
  const fmt       = isPitcher ? (v: number) => v.toFixed(2) : (v: number) => fmtR(v, 3)
  const currentPt = pts[pts.length - 1]
  // A past season is finished — its trailing window is just the end of the year,
  // not "recent form", so drop the "Last N games/starts" summary tile.
  const seasonComplete = season < CURRENT_SEASON

  // SVG layout — matches the career chart's tight gutters + taller body
  const W = 560, H = 224
  const m = { t: 18, r: 16, b: 30, l: 42 }
  const iW = W - m.l - m.r, iH = H - m.t - m.b
  const n = pts.length

  const vals = pts.map(p => p.value)
  const allVals = leagueAvg != null ? [...vals, leagueAvg] : vals
  const lo = Math.min(...allVals), hi = Math.max(...allVals)
  const rng = hi - lo || 0.1
  const yPad = rng * 0.28
  const yMin = Math.max(0, lo - yPad), yMax = hi + yPad

  // Line/area span the full plot width, right up to the axes.
  const sx = (i: number) => m.l + (n <= 1 ? iW / 2 : (i / (n - 1)) * iW)
  const sy = (v: number) => m.t + ((yMax - v) / (yMax - yMin)) * iH

  const gradId = `rolling-${isPitcher ? 'p' : 'h'}`
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(p.value).toFixed(1)}`).join(' ')
  const fillPath = `${linePath} L${sx(n-1).toFixed(1)},${(m.t + iH).toFixed(1)} L${sx(0).toFixed(1)},${(m.t + iH).toFixed(1)} Z`

  // X-axis ticks: one per calendar month (labeled "May", "Jun", …), placed at that
  // month's first game. Markers jammed against either edge are dropped so labels
  // never clip. If the span is too short for ≥2 month markers (a cup of coffee, or
  // a scattered/injury-shortened year), fall back to a few edge-anchored dates.
  const xTicks: Array<{ idx: number; label: string }> = (() => {
    const monthFirsts: Array<{ idx: number; label: string }> = []
    let lastKey = ''
    pts.forEach((p, i) => {
      const [y, mo] = p.date.split('-').map(Number)
      const key = `${y}-${mo}`
      if (key !== lastKey) { monthFirsts.push({ idx: i, label: MONTHS[mo - 1] }); lastKey = key }
    })
    // Drop month markers sitting within 4% of either end (avoids start/end clipping
    // and the partial first month, while keeping legit early/late-month labels).
    const pad = (n - 1) * 0.04
    const monthTicks = monthFirsts.filter(t => t.idx >= pad && t.idx <= (n - 1) - pad)
    if (monthTicks.length >= 2) return monthTicks
    // Fallback for very short / sparse spans: up to 3 spaced date labels.
    const count = Math.min(3, n)
    return Array.from({ length: count }, (_, k) => {
      const idx = Math.round(k * (n - 1) / Math.max(1, count - 1))
      return { idx, label: fmtDate(pts[idx].date) }
    })
  })()

  // Y ticks — pick the step from a candidate list that gives ~6 lines
  const yTicks = (() => {
    if (yMin >= yMax) return [yMin]
    const range = yMax - yMin
    const steps = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100]
    const step = steps.reduce((best, s) =>
      Math.abs(range / s - 6) < Math.abs(range / best - 6) ? s : best
    )
    const lo2 = Math.ceil(yMin / step - 1e-9) * step
    const ticks: number[] = []
    for (let v = lo2; v <= yMax + 1e-9; v = parseFloat((v + step).toPrecision(10))) {
      ticks.push(parseFloat(v.toPrecision(10)))
    }
    return ticks.length ? ticks : [yMin, yMax]
  })()

  const hov = hovIdx != null ? pts[hovIdx] : null

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!boxRef.current) return
    const clientX = e.clientX, clientY = e.clientY
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      if (!boxRef.current) return
      const rect = boxRef.current.getBoundingClientRect()
      const relX = ((clientX - rect.left) / rect.width) * W - m.l
      const frac = Math.max(0, Math.min(1, relX / iW))
      setHovIdx(Math.round(frac * (n - 1)))
      setTipPos({ x: (clientX - rect.left) / rect.width * 100, y: (clientY - rect.top) / rect.height * 100 })
    })
  }

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!boxRef.current) return
    const rect = boxRef.current.getBoundingClientRect()
    const relX = ((e.clientX - rect.left) / rect.width) * W - m.l
    const frac = Math.max(0, Math.min(1, relX / iW))
    const idx  = Math.round(frac * (n - 1))
    if (pts[idx]) onGameSelect?.(pts[idx].date)
  }

  return (
    <Box>
      {/* Chart title */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1.25 }}>
        <Typography sx={{ fontWeight: 800, fontSize: '1.5rem', letterSpacing: '-0.02em' }}>
          {label}
        </Typography>
        <Typography sx={{ fontSize: '1.5rem', color: 'text.secondary', fontWeight: 800, letterSpacing: '-0.02em' }}>
          {season}
        </Typography>
      </Box>

      {/* Summary row */}
      <Box sx={{ display: 'flex', gap: 3, mb: 1.5, flexWrap: 'wrap' }}>
        {!seasonComplete && (
          <Box>
            <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: 0.2, color: 'text.disabled' }}>
              {isPitcher && !isStarter ? `Last ${currentPt.ip != null ? currentPt.ip.toFixed(1) : '—'} IP` : `Last ${currentPt.size} ${isPitcher ? 'starts' : 'games'}`}
            </Typography>
            <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', color: ACCENT, lineHeight: 1.2 }}>
              {fmt(currentPt.value)}
            </Typography>
          </Box>
        )}
        {seasonStat.stat != null && (
          <Box>
            <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: 0.2, color: 'text.disabled' }}>
              Season {label}
            </Typography>
            <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', lineHeight: 1.2, color: seasonComplete ? ACCENT : 'text.primary' }}>
              {fmt(seasonStat.stat)}
            </Typography>
          </Box>
        )}
        <Box>
          <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, color: 'text.disabled' }}>
            {seasonStat.volumeLabel}
          </Typography>
          <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', lineHeight: 1.2 }}>
            {seasonStat.volumeLabel === 'IP' ? seasonStat.volume.toFixed(1) : seasonStat.volume}
          </Typography>
        </Box>
      </Box>

      {/* Chart */}
      <Box ref={boxRef} sx={{ position: 'relative', userSelect: 'none' }}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
          style={{ width: '100%', height: 'auto', display: 'block' }}
          onMouseMove={handleMouseMove}
          onClick={handleSvgClick}
          onMouseLeave={() => {
            if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
            setHovIdx(null)
          }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={ACCENT} stopOpacity={0.20} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0.01} />
            </linearGradient>
          </defs>

          {/* Grid */}
          {yTicks.map((v, i) => (
            <line key={i} x1={m.l} y1={sy(v)} x2={m.l + iW} y2={sy(v)} stroke="currentColor" strokeOpacity={0.10} strokeWidth={1} />
          ))}

          {/* Hover guide */}
          {hovIdx != null && (
            <line x1={sx(hovIdx)} y1={m.t} x2={sx(hovIdx)} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.22} strokeWidth={1.5} />
          )}

          {/* Fill */}
          <path d={fillPath} fill={`url(#${gradId})`} />

          {/* League avg dashed line (label drawn on top, later) */}
          {leagueAvg != null && (
            <line x1={m.l} y1={sy(leagueAvg)} x2={m.l + iW} y2={sy(leagueAvg)} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3" strokeOpacity={0.6} />
          )}

          {/* Line */}
          <path d={linePath} fill="none" stroke={ACCENT} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

          {/* Dots — only on hover; the line runs edge-to-edge with no endpoint markers */}
          {pts.map((p, i) => {
            if (hovIdx !== i) return null
            return (
              <circle key={i} cx={sx(i)} cy={sy(p.value)} r={7}
                fill={ACCENT} stroke="currentColor" strokeWidth={0} opacity={1} />
            )
          })}

          {/* League-avg label — drawn after the trendline so its halo sits on top */}
          {leagueAvg != null && (
            <text x={m.l + 5} y={sy(leagueAvg) - 5} fill="#f59e0b" fillOpacity={1} fontSize={10} fontWeight={700} {...labelHalo}>
              lg avg {fmt(leagueAvg)}
            </text>
          )}

          {/* Axes */}
          <line x1={m.l} y1={m.t} x2={m.l} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1.5} />
          <line x1={m.l} y1={m.t + iH} x2={m.l + iW} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1.5} />

          {/* Y ticks */}
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={m.l - 5} y1={sy(v)} x2={m.l} y2={sy(v)} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} />
              <text x={m.l - 8} y={sy(v) + 4} textAnchor="end" fill="currentColor" fillOpacity={0.9} fontSize={12.5} fontWeight={600}>
                {fmt(v)}
              </text>
            </g>
          ))}

          {/* X ticks (month markers, or dates for short spans) */}
          {xTicks.map(({ idx, label }) => {
            const anchor = idx <= 0 ? 'start' : idx >= n - 1 ? 'end' : 'middle'
            return (
              <g key={idx}>
                <line x1={sx(idx)} y1={m.t + iH} x2={sx(idx)} y2={m.t + iH + 5} stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} />
                <text x={sx(idx)} y={m.t + iH + 18} textAnchor={anchor} fill="currentColor" fillOpacity={0.9} fontSize={12.5} fontWeight={600}>
                  {label}
                </text>
              </g>
            )
          })}
        </svg>

        {/* Tooltip */}
        {hov && (() => {
          const tipLeft = Math.min(Math.max(tipPos.x, 12), 82)
          const tipAbove = tipPos.y > 40
          return (
            <Box sx={{
              position: 'absolute',
              left: `${tipLeft}%`,
              top: tipAbove ? `${tipPos.y - 16}%` : `${tipPos.y + 4}%`,
              transform: tipAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 8px)',
              pointerEvents: 'none',
              bgcolor: 'background.paper', border: '1.5px solid', borderColor: 'divider',
              borderRadius: 2, px: 1.5, py: 1, boxShadow: '0 4px 18px rgba(0,0,0,0.13)',
              minWidth: 90, zIndex: 10,
            }}>
              <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', lineHeight: 1 }}>{fmtDate(hov.date)}</Typography>
              <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', mt: 0.2 }}>
                {hov.isHome ? 'vs' : '@'} {hov.opp}
              </Typography>
              <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: ACCENT, mt: 0.3, lineHeight: 1 }}>
                {fmt(hov.value)}
              </Typography>
              <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', mt: 0.2 }}>
                {isPitcher && !isStarter
                  ? `last ${hov.size} apps · ${hov.ip != null ? hov.ip.toFixed(1) : '?'} IP`
                  : `last ${hov.size} ${isPitcher ? 'starts' : 'games'}`}
              </Typography>
            </Box>
          )
        })()}
      </Box>

      <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mt: 0.75 }}>
        {isPitcher && !isStarter
          ? `${season} rolling ERA · each point = last ~${RP_IP_TARGET} innings (${currentPt.size} apps)`
          : `${season} rolling ${label} · each point = last ${isPitcher ? `${SP_WINDOW} starts` : `${HIT_WINDOW} games`}`}
      </Typography>
    </Box>
  )
}

// ─── Player trends chart ──────────────────────────────────────────────────────

// Shared native-select style used in PlayerTrendsChart range pickers (module-scope, stable reference)
const trendSelSx: React.CSSProperties = {
  border: 'none', outline: 'none', background: 'transparent',
  fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
  color: 'inherit', padding: '4px 10px', borderRadius: 999, fontFamily: 'inherit',
}

export function PlayerTrendsChart({ splits, isPitcher, isTwoWay, gameLog, season, chartMode, onGameSelect, onYearSelect }: {
  splits: CareerStatSplit[]
  isPitcher: boolean
  isTwoWay: boolean
  gameLog?: RecentGameEntry[]
  season: number
  chartMode: 'career' | 'rolling'
  onGameSelect?: (date: string) => void
  onYearSelect?: (season: number) => void
}) {
  const initGroup: 'hitting' | 'pitching' = (isPitcher && !isTwoWay) ? 'pitching' : 'hitting'
  const [group, setGroup] = useState<'hitting' | 'pitching'>(initGroup)
  const [statKey, setStatKey] = useState(initGroup === 'pitching' ? 'era' : 'ops')
  // Background-colored halo behind on-chart text labels so they stay legible even
  // where the trendline passes through them.
  const labelHalo = { stroke: useTheme().palette.background.paper, strokeWidth: 3.5, strokeLinejoin: 'round', paintOrder: 'stroke' } as const
  const boxRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const rafRef = useRef<number | null>(null)
  const [hovIdx, setHovIdx] = useState<number | null>(null)
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 })
  // Refs for career-chart year selection via touch
  const onYearSelectRef = useRef(onYearSelect)
  useEffect(() => { onYearSelectRef.current = onYearSelect }, [onYearSelect])
  const careerHovIdxRef = useRef<number | null>(null)
  const currentFptsRef  = useRef<Array<{ season: number }>>([]) // kept in sync before SVG render
  const [rangeStart, setRangeStart] = useState<number | null>(null)
  const [rangeEnd, setRangeEnd] = useState<number | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const [leagueAvgPts, setLeagueAvgPts] = useState<Map<number, number>>(new Map())

  // Reset to sensible default when group changes
  useEffect(() => { setStatKey(group === 'pitching' ? 'era' : 'ops') }, [group])
  // Reset all when player changes (splits identity changes)
  useEffect(() => {
    const g: 'hitting' | 'pitching' = (isPitcher && !isTwoWay) ? 'pitching' : 'hitting'
    setGroup(g)
    setStatKey(g === 'pitching' ? 'era' : 'ops')
    setRangeStart(null)
    setRangeEnd(null)
    setLeagueAvgPts(new Map())
  }, [splits]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch per-year league averages (must be before any early return — React hook rule)
  useEffect(() => {
    const defs = group === 'hitting' ? TREND_HIT_DEFS : TREND_PIT_DEFS
    const def = defs.find(d => d.key === statKey) ?? defs[0]
    if (chartMode === 'rolling') { setLeagueAvgPts(new Map()); return }
    if (!def?.careerAvg) { setLeagueAvgPts(new Map()); return }
    const seasonsSorted = splits
      .map(s => { const stat = group === 'hitting' ? s.hitting : s.pitching; return stat != null && def.get(stat) != null ? s.season : null })
      .filter((s): s is number => s != null)
    if (seasonsSorted.length < 2) return
    const start = rangeStart ?? seasonsSorted[0]
    const end = rangeEnd ?? seasonsSorted[seasonsSorted.length - 1]
    const seasons = seasonsSorted.filter(s => s >= start && s <= end)
    let cancelled = false
    Promise.all(seasons.map(async season => {
      const objs = await fetchLeagueStatsBySeason(season, group)
      return [season, def.careerAvg!(objs)] as [number, number | null]
    })).then(results => {
      if (cancelled) return
      const m = new Map<number, number>()
      for (const [s, v] of results) { if (v != null) m.set(s, v) }
      setLeagueAvgPts(m)
    })
    return () => { cancelled = true }
  }, [group, statKey, rangeStart, rangeEnd, splits, chartMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Touch drag support — non-passive so we can preventDefault scroll while dragging along the chart
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !boxRef.current) return
    const W_SVG = 560, M_L = 42, IW = W_SVG - 42 - 16
    const handleTouch = (e: TouchEvent) => {
      e.preventDefault()
      const touch = e.touches[0] ?? e.changedTouches[0]
      if (!touch || !boxRef.current) return
      const rect = boxRef.current.getBoundingClientRect()
      const relX = ((touch.clientX - rect.left) / rect.width) * W_SVG - M_L
      const frac = Math.max(0, Math.min(1, relX / IW))
      // n captured at effect time via closure; effect re-runs whenever n changes
      const idx = Math.round(frac * (currentN.current - 1))
      careerHovIdxRef.current = idx
      setHovIdx(idx)
      setTipPos({ x: (touch.clientX - rect.left) / rect.width * 100, y: (touch.clientY - rect.top) / rect.height * 100 })
    }
    const handleTouchEnd = () => {
      if (careerHovIdxRef.current != null) {
        const sel = currentFptsRef.current[careerHovIdxRef.current]
        if (sel) onYearSelectRef.current?.(sel.season)
      }
      careerHovIdxRef.current = null
      setHovIdx(null)
    }
    svg.addEventListener('touchstart', handleTouch, { passive: false })
    svg.addEventListener('touchmove',  handleTouch, { passive: false })
    svg.addEventListener('touchend',   handleTouchEnd)
    return () => {
      svg.removeEventListener('touchstart', handleTouch)
      svg.removeEventListener('touchmove',  handleTouch)
      svg.removeEventListener('touchend',   handleTouchEnd)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Stable ref so the touch handler always sees the current point count without re-registering
  const currentN = useRef(0)

  const allDefs = group === 'hitting' ? TREND_HIT_DEFS : TREND_PIT_DEFS

  // Only expose stats that have real data for at least 1 season
  const availableDefs = allDefs.filter(def =>
    splits.some(s => { const stat = group === 'hitting' ? s.hitting : s.pitching; return stat != null && def.get(stat) != null })
  )
  const currentDef = availableDefs.find(d => d.key === statKey) ?? availableDefs[0]
  if (!currentDef) return null

  // For pitchers: compute career-median games-played so the pace projection uses the player's own
  // typical workload (starters ≈ 30 games/season, relievers ≈ 65) rather than the meaningless 162.
  // Requires history to project; with no prior seasons we skip pace entirely to avoid absurd numbers.
  const pitcherMedianGP = group === 'pitching' ? (() => {
    const gps = splits
      .filter(s => s.season !== CURRENT_SEASON && s.pitching?.gamesPlayed != null)
      .map(s => Number(s.pitching!.gamesPlayed))
      .filter(g => g > 0)
    if (!gps.length) return null
    const sorted = [...gps].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  })() : null

  // Build data points — project current-season counting stats to full-season pace
  const pts = splits
    .map(s => {
      const stat = group === 'hitting' ? s.hitting : s.pitching
      const val = stat != null ? currentDef.get(stat) : null
      if (val == null) return null
      let value = val
      let actual: number | undefined
      let isPace = false
      if (currentDef.counting && s.season === CURRENT_SEASON) {
        const gp = Number(stat?.gamesPlayed ?? 0)
        if (gp > 0 && val > 0) {
          if (group === 'pitching') {
            // Pitchers: use career-median games as the "full season" denominator.
            // Require ≥15% of that typical season played to avoid wild early-season projections.
            if (pitcherMedianGP != null && gp >= Math.max(3, Math.round(pitcherMedianGP * 0.15))) {
              actual = val
              value = val * pitcherMedianGP / gp
              isPace = true
            }
          } else {
            // Hitters: project to 162 games; require ≥24 games played (~15% of season).
            if (gp >= 24) {
              actual = val
              value = val * 162 / gp
              isPace = true
            }
          }
        }
      }
      // Volume: AB for hitters, IP for pitchers (shown in tooltip)
      const vol = group === 'hitting'
        ? (stat?.atBats != null ? Number(stat.atBats) : null)
        : (stat?.inningsPitched != null ? parseIP(stat.inningsPitched) : null)
      return { season: s.season, value, actual, isPace, teamId: s.teamId, teamAbbr: s.teamAbbr, statObj: stat, vol }
    })
    .filter((p): p is NonNullable<typeof p> => p != null)

  if (pts.length < 2) {
    return (
      <Box sx={{ py: 3, textAlign: 'center' }}>
        <Typography color="text.secondary" sx={{ fontSize: '0.85rem' }}>Not enough seasons to show a trend</Typography>
      </Box>
    )
  }

  // Season range — null means "use full extent"
  const allSeasonsList = pts.map(p => p.season)
  const minSeason = allSeasonsList[0], maxSeason = allSeasonsList[allSeasonsList.length - 1]
  const effStart = rangeStart ?? minSeason
  const effEnd = rangeEnd ?? maxSeason
  const isRangeModified = effStart !== minSeason || effEnd !== maxSeason
  const fptsRaw = pts.filter(p => p.season >= effStart && p.season <= effEnd)
  const fpts = fptsRaw.length >= 2 ? fptsRaw : pts // fall back to all if range too narrow

  // SVG layout — tight gutters (just enough for the axis labels) with a taller
  // body so the plot fills more of the card.
  const W = 560, H = 272
  const m = { t: 20, r: 16, b: 30, l: 42 }
  const iW = W - m.l - m.r, iH = H - m.t - m.b
  const n = fpts.length
  currentN.current = n        // keep touch handler in sync without re-registering
  currentFptsRef.current = fpts  // keep year-select touch handler in sync

  const vals = fpts.map(p => p.value)
  const leagueValsInRange = fpts.map(p => leagueAvgPts.get(p.season)).filter((v): v is number => v != null)
  const allVals = leagueValsInRange.length > 0 ? [...vals, ...leagueValsInRange] : vals
  const minVal = Math.min(...allVals), maxVal = Math.max(...allVals)
  const range = maxVal - minVal || (maxVal * 0.1) || 1
  const yPad = range * 0.28
  const yMin = Math.max(0, minVal - yPad), yMax = maxVal + yPad

  // Line/area span the full plot width, right up to the axes. The endpoint dots
  // are skipped below so nothing sits on top of the axis / y-axis numbers.
  const sx = (i: number) => m.l + (n === 1 ? iW / 2 : (i / (n - 1)) * iW)
  const sy = (v: number) => m.t + ((yMax - v) / (yMax - yMin)) * iH

  // Short-season detection: career-median volume × 0.4, with an absolute floor.
  // Pitchers with very few IP (injury/TJ) and hitters with few AB should look visually distinct.
  const careerVolMedian = (() => {
    const vols = fpts
      .filter(p => !p.isPace && p.vol != null && p.season !== CURRENT_SEASON)
      .map(p => p.vol!)
    if (!vols.length) return null
    const sorted = [...vols].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  })()
  const shortFloor = group === 'pitching' ? 30 : 100
  const shortThreshold = careerVolMedian != null
    ? Math.max(shortFloor, careerVolMedian * 0.4)
    : shortFloor
  // A point is "short" if it has volume data that falls below the threshold (and isn't a pace projection)
  const isShort = (p: typeof fpts[0]) => !p.isPace && p.vol != null && p.vol < shortThreshold

  // Line segments — switch to dashed + faded when either endpoint is a short season
  const lineSegs = fpts.slice(1).map((_, rawI) => {
    const i = rawI + 1
    return {
      d: `M${sx(i-1).toFixed(1)},${sy(fpts[i-1].value).toFixed(1)} L${sx(i).toFixed(1)},${sy(fpts[i].value).toFixed(1)}`,
      short: isShort(fpts[i-1]) || isShort(fpts[i]),
    }
  })

  // Fill area — uses full polyline regardless of short seasons (background only)
  const fillD = `${fpts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(p.value).toFixed(1)}`).join(' ')} L${sx(n - 1).toFixed(1)},${(m.t + iH).toFixed(1)} L${sx(0).toFixed(1)},${(m.t + iH).toFixed(1)} Z`

  // Career avg for summary row (player's own weighted avg for rate stats, mean for counting)
  const statObjs = fpts.map(p => p.statObj)
  const avg: number | null = currentDef.noAvg
    ? null
    : currentDef.careerAvg
      ? currentDef.careerAvg(statObjs)
      : currentDef.counting
        ? vals.reduce((s, v) => s + v, 0) / vals.length
        : null
  // Horizontal avg line only shown for counting stats; rate stats get league avg line instead
  const showHorizAvg = avg != null && !!currentDef.counting
  const showLeagueAvgLine = !!currentDef.careerAvg && leagueValsInRange.length >= 2
  const volLabel = group === 'hitting' ? 'AB' : 'IP'
  const avgY = showHorizAvg ? sy(avg!) : 0

  // niceTicks needs to be imported from utils — use it via inline import at top of file
  const niceTicks = (dataMin: number, dataMax: number, target = 5): number[] => {
    if (!isFinite(dataMin) || !isFinite(dataMax) || dataMin >= dataMax) {
      return isFinite(dataMin) ? [dataMin] : []
    }
    const range = dataMax - dataMin
    const roughStep = range / Math.max(2, target - 1)
    const mag = Math.pow(10, Math.floor(Math.log10(roughStep)))
    const norm = roughStep / mag
    let step: number
    if      (norm <= 1)   step = mag
    else if (norm <= 2)   step = 2 * mag
    else if (norm <= 2.5) step = 2.5 * mag
    else if (norm <= 5)   step = 5 * mag
    else                  step = 10 * mag

    const lo = Math.ceil(dataMin  / step - 1e-9) * step
    const hi = Math.floor(dataMax / step + 1e-9) * step
    const count = Math.round((hi - lo) / step)
    const ticks: number[] = []
    for (let i = 0; i <= count; i++) {
      ticks.push(parseFloat((lo + i * step).toPrecision(12)))
    }
    return ticks.length ? ticks : [dataMin, dataMax]
  }

  const yTicks = niceTicks(yMin, yMax, 5)
  const gradId = `trendgrad-${group}-${statKey}`

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!boxRef.current) return
    const clientX = e.clientX, clientY = e.clientY
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      if (!boxRef.current) return
      const rect = boxRef.current.getBoundingClientRect()
      const relX = ((clientX - rect.left) / rect.width) * W - m.l
      const frac = Math.max(0, Math.min(1, relX / iW))
      setHovIdx(Math.round(frac * (n - 1)))
      setTipPos({ x: (clientX - rect.left) / rect.width * 100, y: (clientY - rect.top) / rect.height * 100 })
    })
  }

  const hov = hovIdx != null ? fpts[hovIdx] : null
  // Best season — never a pace projection or a short/injury season
  const bestIdx = (() => {
    const cands = fpts.map((p, i) => ({ i, v: p.value, p })).filter(c => !c.p.isPace && !isShort(c.p))
    const pool = cands.length ? cands : fpts.map((p, i) => ({ i, v: p.value, p })) // fallback: all points
    return (currentDef.lowerBetter
      ? pool.reduce((a, b) => b.v < a.v ? b : a)
      : pool.reduce((a, b) => b.v > a.v ? b : a)
    ).i
  })()



  return (
    <Box sx={isFullscreen ? { position: 'fixed', inset: 0, zIndex: 9999, bgcolor: 'background.default', overflow: 'auto', p: 2 } : {}}>
      {/* Group toggle for two-way players */}
      {isTwoWay && (
        <Box sx={{ mb: 1.5 }}>
          <SegControl
            options={[{ value: 'hitting', label: 'Batting' }, { value: 'pitching', label: 'Pitching' }]}
            value={group}
            onChange={v => setGroup(v as 'hitting' | 'pitching')}
          />
        </Box>
      )}

      {chartMode === 'rolling' && gameLog ? (
        <RollingWindowChart games={gameLog} isPitcher={group === 'pitching'} season={season} onGameSelect={onGameSelect} />
      ) : (
      <>

      {/* Controls row: stat picker + season range on one line */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.75, flexWrap: 'wrap' }}>
        {/* Stat dropdown */}
        <Box sx={{ border: '1.5px solid', borderColor: 'divider', borderRadius: 999, flexShrink: 0, '&:hover': { borderColor: ACCENT }, '&:focus-within': { borderColor: ACCENT } }}>
          <select value={statKey} onChange={e => setStatKey(e.target.value)} style={trendSelSx}>
            {availableDefs.map(def => <option key={def.key} value={def.key}>{def.label}</option>)}
          </select>
        </Box>

        {/* Season range */}
        {pts.length >= 3 && (<>
          <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled', fontWeight: 600 }}>·</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ border: '1.5px solid', borderColor: 'divider', borderRadius: 999, '&:hover': { borderColor: ACCENT } }}>
              <select value={effStart} onChange={e => { setRangeStart(Number(e.target.value)); setHovIdx(null) }} style={trendSelSx}>
                {allSeasonsList.filter(y => y <= effEnd).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </Box>
            <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>–</Typography>
            <Box sx={{ border: '1.5px solid', borderColor: 'divider', borderRadius: 999, '&:hover': { borderColor: ACCENT } }}>
              <select value={effEnd} onChange={e => { setRangeEnd(Number(e.target.value)); setHovIdx(null) }} style={trendSelSx}>
                {allSeasonsList.filter(y => y >= effStart).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </Box>
          </Box>
          {isRangeModified && (
            <Box onClick={() => { setRangeStart(null); setRangeEnd(null); setHovIdx(null) }}
              sx={{ fontSize: '0.72rem', color: ACCENT, fontWeight: 600, cursor: 'pointer', '&:hover': { opacity: 0.7 } }}>
              Reset
            </Box>
          )}
        </>)}

        {/* Fullscreen toggle */}
        <Box component="button" onClick={() => setIsFullscreen(f => !f)}
          sx={{
            ml: 'auto', flexShrink: 0, border: '1.5px solid', borderColor: 'divider',
            borderRadius: 999, background: 'transparent', cursor: 'pointer', color: 'inherit',
            px: 1.25, py: 0.4, display: 'flex', alignItems: 'center',
            '&:hover': { borderColor: ACCENT },
          }}>
          {isFullscreen ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
          )}
        </Box>
      </Box>

      {/* Summary row */}
      <Box sx={{ display: 'flex', gap: 3, mb: 1.5, flexWrap: 'wrap' }}>
        {avg != null && (
          <Box>
            <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: 0.2, color: 'text.disabled' }}>
              {currentDef.counting ? `Avg / yr` : `Career ${currentDef.label}`}
            </Typography>
            <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', color: ACCENT, lineHeight: 1.2 }}>{currentDef.fmt(avg)}</Typography>
          </Box>
        )}
        <Box>
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: 0.2, color: 'text.disabled' }}>Best season</Typography>
          <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', lineHeight: 1.2 }}>
            {currentDef.fmt(fpts[bestIdx].isPace ? fpts[bestIdx].actual! : fpts[bestIdx].value)}
            <Typography component="span" sx={{ fontSize: '0.72rem', color: 'text.secondary', fontWeight: 600, ml: 0.75 }}>({fpts[bestIdx].season})</Typography>
          </Typography>
        </Box>
        <Box>
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: 0.2, color: 'text.disabled' }}>Seasons</Typography>
          <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', lineHeight: 1.2 }}>{n}</Typography>
        </Box>
      </Box>

      {/* Chart */}
      <Box ref={boxRef} sx={{ position: 'relative', userSelect: 'none' }}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', cursor: onYearSelect ? 'pointer' : 'default' }}
          onMouseMove={handleMouseMove}
          onClick={onYearSelect ? ((e: React.MouseEvent<SVGSVGElement>) => {
            if (!boxRef.current) return
            const rect = boxRef.current.getBoundingClientRect()
            const relX = ((e.clientX - rect.left) / rect.width) * W - m.l
            const frac = Math.max(0, Math.min(1, relX / iW))
            const idx  = Math.round(frac * (n - 1))
            if (fpts[idx]) onYearSelect(fpts[idx].season)
          }) : undefined}
          onMouseLeave={() => {
            if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
            setHovIdx(null)
          }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.22} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0.01} />
            </linearGradient>
          </defs>

          {/* Grid */}
          {yTicks.map((v, i) => (
            <line key={i} x1={m.l} y1={sy(v)} x2={m.l + iW} y2={sy(v)} stroke="currentColor" strokeOpacity={0.10} strokeWidth={1} />
          ))}

          {/* Hover vertical guide */}
          {hovIdx != null && (
            <line x1={sx(hovIdx)} y1={m.t} x2={sx(hovIdx)} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.22} strokeWidth={1.5} />
          )}

          {/* Fill */}
          <path d={fillD} fill={`url(#${gradId})`} />

          {/* Horizontal avg line — counting stats only (label drawn on top, later) */}
          {showHorizAvg && (
            <line x1={m.l} y1={avgY} x2={m.l + iW} y2={avgY} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3" strokeOpacity={0.6} />
          )}

          {/* League avg line — rate stats, one point per season (label drawn on top, later) */}
          {showLeagueAvgLine && (
            <path
              d={fpts.map((p, i) => {
                const v = leagueAvgPts.get(p.season)
                return v != null ? `${i === 0 || !fpts[i - 1] || leagueAvgPts.get(fpts[i - 1].season) == null ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}` : null
              }).filter(Boolean).join(' ')}
              fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3" strokeOpacity={0.6} strokeLinejoin="round"
            />
          )}

          {/* Line — solid for normal seasons, dashed+faded when either endpoint is a short season */}
          {lineSegs.map((seg, i) => (
            <path key={i} d={seg.d} fill="none"
              stroke={ACCENT} strokeWidth={2.5} strokeLinecap="round"
              strokeDasharray={seg.short ? '5 5' : undefined}
              strokeOpacity={seg.short ? 0.3 : 1}
            />
          ))}

          {/* Dots — endpoints touch the axes, so skip their static marker (the line
              still reaches the axis; hover still shows a dot). */}
          {fpts.map((p, i) => {
            const isHov = hovIdx === i
            const isEdge = i === 0 || i === n - 1
            if (isEdge && !isHov) return null
            const isBest = i === bestIdx
            const short = isShort(p)
            const color = p.teamId ? (TEAM_BG[p.teamId] ?? ACCENT) : ACCENT
            return (
              <g key={p.season} opacity={short && !isHov ? 0.45 : 1}>
                {isBest && !isHov && (
                  <circle cx={sx(i)} cy={sy(p.value)} r={10} fill={color} fillOpacity={0.18} />
                )}
                <circle cx={sx(i)} cy={sy(p.value)} r={isHov ? 8 : (isBest ? 6.5 : 5)}
                  fill={short ? 'transparent' : color}
                  stroke={color} strokeWidth={isHov ? 2.5 : short ? 2 : 2} />
              </g>
            )
          })}

          {/* Avg / league-avg labels — drawn here (after the trendline) so their
              halo sits on top of the line and stays legible. */}
          {showHorizAvg && (
            <text x={m.l + 4} y={avgY - 6} fill="#f59e0b" fillOpacity={1} fontSize={10.5} fontWeight={700} {...labelHalo}>avg {currentDef.fmt(avg!)}</text>
          )}
          {showLeagueAvgLine && (() => {
            const lastPt = [...fpts].reverse().find(p => leagueAvgPts.has(p.season))
            const lastIdx = lastPt ? fpts.indexOf(lastPt) : -1
            if (!lastPt || lastIdx < 0) return null
            return (
              <text x={sx(lastIdx) - 4} y={sy(leagueAvgPts.get(lastPt.season)!) - 6}
                textAnchor="end" fill="#f59e0b" fillOpacity={1} fontSize={10} fontWeight={700} {...labelHalo}>lg avg</text>
            )
          })()}

          {/* Best season star annotation — anchor to the nearest edge so it never
              runs past the y-axis when the best year is the first/last point */}
          {!hov && (
            <text x={sx(bestIdx)} y={sy(fpts[bestIdx].value) - 14}
              fill="currentColor" fillOpacity={0.6} fontSize={11.5} fontWeight={600}
              textAnchor={bestIdx === 0 ? 'start' : bestIdx === n - 1 ? 'end' : 'middle'}>★ {fpts[bestIdx].season}</text>
          )}

          {/* Current-year pace label on the dot */}
          {(() => {
            const paceIdx = fpts.findIndex(p => p.isPace)
            if (paceIdx === -1 || hovIdx === paceIdx) return null
            const pp = fpts[paceIdx]
            return (
              <text x={sx(paceIdx)} y={sy(pp.value) - 14}
                fill={ACCENT} fillOpacity={0.85} fontSize={10.5} fontWeight={700}
                textAnchor={paceIdx === n - 1 ? 'end' : paceIdx === 0 ? 'start' : 'middle'}>
                ~{currentDef.fmt(pp.value)} pace
              </text>
            )
          })()}

          {/* Axes */}
          <line x1={m.l} y1={m.t} x2={m.l} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1.5} />
          <line x1={m.l} y1={m.t + iH} x2={m.l + iW} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1.5} />

          {/* Y ticks */}
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={m.l - 5} y1={sy(v)} x2={m.l} y2={sy(v)} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} />
              <text x={m.l - 8} y={sy(v) + 4} textAnchor="end" fill="currentColor" fillOpacity={0.9} fontSize={12.5} fontWeight={600}>{currentDef.fmt(v)}</text>
            </g>
          ))}

          {/* X ticks — always show every year as 2-digit label ('24) */}
          {fpts.map((p, i) => (
            <g key={p.season}>
              <line x1={sx(i)} y1={m.t + iH} x2={sx(i)} y2={m.t + iH + 5} stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} />
              <text x={sx(i)} y={m.t + iH + 19} textAnchor="middle" fill="currentColor" fillOpacity={0.9} fontSize={12.5} fontWeight={600}>
                '{String(p.season).slice(2)}
              </text>
            </g>
          ))}
        </svg>

        {/* Tooltip */}
        {hov && (() => {
          const tipLeft = Math.min(Math.max(tipPos.x, 12), 82)
          const tipAbove = tipPos.y > 40
          return (
            <Box sx={{
              position: 'absolute',
              left: `${tipLeft}%`,
              top: tipAbove ? `${tipPos.y - 16}%` : `${tipPos.y + 4}%`,
              transform: tipAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 8px)',
              pointerEvents: 'none',
              bgcolor: 'background.paper',
              border: '1.5px solid',
              borderColor: 'divider',
              borderRadius: 2,
              px: 1.5, py: 1,
              boxShadow: '0 4px 18px rgba(0,0,0,0.13)',
              minWidth: 90,
              zIndex: 10,
            }}>
              <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', lineHeight: 1 }}>{hov.season}</Typography>
              {hov.teamAbbr && (() => {
                const traded = hov.teamAbbr.includes('/')
                return (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.3 }}>
                    {!traded && hov.teamId && (
                      <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: TEAM_BG[hov.teamId] ?? 'grey.500', flexShrink: 0 }} />
                    )}
                    <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', fontStyle: traded ? 'italic' : 'normal' }}>
                      {hov.teamAbbr}
                    </Typography>
                  </Box>
                )
              })()}
              {hov.isPace ? (
                <>
                  <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: ACCENT, mt: 0.25, lineHeight: 1 }}>
                    {currentDef.fmt(hov.value)} <Typography component="span" sx={{ fontSize: '0.65rem', color: 'text.disabled', fontWeight: 600 }}>pace</Typography>
                  </Typography>
                  <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', mt: 0.2 }}>
                    {currentDef.fmt(hov.actual!)} actual ({Math.round((hov.actual! / hov.value) * 162)}g played)
                  </Typography>
                </>
              ) : (
                <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: ACCENT, mt: 0.25, lineHeight: 1 }}>
                  {currentDef.fmt(hov.value)}
                </Typography>
              )}
              {showLeagueAvgLine && leagueAvgPts.has(hov.season) && (
                <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mt: 0.3 }}>
                  lg avg {currentDef.fmt(leagueAvgPts.get(hov.season)!)}
                </Typography>
              )}
              {hov.vol != null && (
                <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mt: 0.15 }}>
                  {group === 'hitting' ? Math.round(hov.vol) : hov.vol.toFixed(1)} {volLabel}
                </Typography>
              )}
              {isShort(hov) && (
                <Typography sx={{ fontSize: '0.65rem', color: 'warning.main', mt: 0.25, fontWeight: 600 }}>
                  limited sample
                </Typography>
              )}
            </Box>
          )
        })()}
      </Box>

      </>
      )}
    </Box>
  )
}

export default PlayerTrendsChart

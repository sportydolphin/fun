import React, { useState, useEffect, useRef } from 'react'
import { Box, Typography, useTheme, useMediaQuery } from '@mui/material'
import { RecentGameEntry } from '../types'
import { ACCENT, CURRENT_SEASON } from '../constants'
import { fmtR, parseIP } from '../lib/utils'
import { fetchLeagueStatsBySeason, tooltipAnchorSx } from './trendChartUtils'

// The current-season rolling-window trendline (OPS for hitters, ERA for pitchers).
// Split out of PlayerTrendsChart.tsx (July 2026); the career chart lives there.

// ─── Rolling window chart (current season) ───────────────────────────────────

export function RollingWindowChart({ games, isPitcher, season, onGameSelect }: {
  games: RecentGameEntry[]
  isPitcher: boolean
  season: number
  onGameSelect?: (date: string) => void
}) {
  const canHover = useMediaQuery('(hover: hover)')
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

        {/* Tooltip — always above the hovered point (see tooltipAnchorSx) */}
        {hov && (
            <Box sx={{
              position: 'absolute',
              ...tooltipAnchorSx(tipPos, canHover),
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
        )}
      </Box>

      <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mt: 0.75 }}>
        {isPitcher && !isStarter
          ? `${season} rolling ERA · each point = last ~${RP_IP_TARGET} innings (${currentPt.size} apps)`
          : `${season} rolling ${label} · each point = last ${isPitcher ? `${SP_WINDOW} starts` : `${HIT_WINDOW} games`}`}
      </Typography>
    </Box>
  )
}

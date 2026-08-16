import { useMemo, useState } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import { aggregateBatting, aggregatePitching, fmtRate, fmtTwo } from './stats'
import { CARD_BORDER } from './ui'
import type { WpblPlayer, WpblBattingLine, WpblPitchingLine } from './types'

// "Do earlier draft picks actually produce better players?" — a scatter of every drafted
// player's season rate stat against where they were taken, with the per-round average drawn
// over the top as a line.
//
// The honest answer this season is no, and the chart is built so that reads correctly
// rather than accidentally. Three deliberate choices, all of them guarding the same
// failure — a six-round draft against two weeks of baseball leaves the late rounds with
// one or two players each, and a naive line through those means would show a dramatic
// "5th rounders rake" trend that is really one hot bat:
//
//   • dot area scales with playing time, so a 2-PA cameo can't look like a regular's season
//   • every round-average marker is labelled with the n behind it, and goes hollow and
//     faint below MIN_SOLID_N, so a point resting on one player never reads as a finding
//   • the correlation is computed live and stated in words above the chart, including when
//     it is nothing — the number is the headline, not the shape of the line
//
// Hitters and pitchers are two separate panels on purpose. They are different measures on
// different scales, and putting them on one plot with two y-axes would invent a
// relationship out of how the axes happen to line up.

// A pick is stored as (round, pick-within-round). The draft ran 20 picks a round, but read
// it off the data rather than hardcoding it, so a different draft size still lays out right.
function overallPickOf(p: WpblPlayer, roundSize: number): number | null {
  if (!p.draft_round || !p.draft_pick) return null
  return (p.draft_round - 1) * roundSize + p.draft_pick
}

/** Pearson r. Null when there aren't enough points, or when one axis doesn't vary. */
function pearson(pts: { x: number; y: number }[]): number | null {
  if (pts.length < 3) return null
  const n = pts.length
  const mx = pts.reduce((s, p) => s + p.x, 0) / n
  const my = pts.reduce((s, p) => s + p.y, 0) / n
  let num = 0, dx = 0, dy = 0
  for (const p of pts) {
    num += (p.x - mx) * (p.y - my)
    dx += (p.x - mx) ** 2
    dy += (p.y - my) ** 2
  }
  const den = Math.sqrt(dx * dy)
  return den === 0 ? null : num / den
}

// Below this many players, a round average is one person's week and is drawn as such.
const MIN_SOLID_N = 5

interface Pt {
  x: number            // overall pick
  y: number            // the rate stat
  weight: number       // playing time (PA or IP) — drives dot area
  name: string
  player: WpblPlayer
  round: number
  sample: string       // "34 PA" / "12.1 IP", for the tooltip
}

interface PanelSpec {
  title: string
  yLabel: string
  better: 'higher' | 'lower'
  fmt: (v: number) => string
  points: Pt[]
  /** Playing-time floor currently applied, for the empty-state copy. */
  minLabel: string
}

// ─── One panel ────────────────────────────────────────────────────────────────

const PAD = { l: 46, r: 14, t: 14, b: 34 }
const VB = { w: 560, h: 250 }

function Panel({ spec, onOpenPlayer }: { spec: PanelSpec; onOpenPlayer?: (p: WpblPlayer) => void }) {
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  // Categorical slots 1 and 2 (blue, orange), light/dark steps. Validated for the
  // lightness band, chroma floor, CVD separation and contrast against both surfaces.
  const DOT = dark ? '#3987e5' : '#2a78d6'
  const LINE = dark ? '#d95926' : '#eb6834'
  const surface = theme.palette.background.paper

  const [hover, setHover] = useState<Pt | null>(null)

  const { points } = spec
  const plotW = VB.w - PAD.l - PAD.r
  const plotH = VB.h - PAD.t - PAD.b

  const geom = useMemo(() => {
    if (!points.length) return null
    const xs = points.map(p => p.x)
    const xMax = Math.max(...xs, 1)
    const ys = points.map(p => p.y)
    let yLo = Math.min(...ys), yHi = Math.max(...ys)
    if (yLo === yHi) { yLo -= 0.5; yHi += 0.5 }
    const padY = (yHi - yLo) * 0.12
    yLo -= padY; yHi += padY
    // Both measures are rates that floor at zero, so the padding must never open up a
    // negative stretch of axis — a gridline reading "-0.248 OPS" is nonsense.
    yLo = Math.max(0, yLo)

    const px = (x: number) => PAD.l + (x / (xMax + 1)) * plotW
    const py = (y: number) => PAD.t + plotH - ((y - yLo) / (yHi - yLo)) * plotH

    // Round averages — the line the question is really asking about.
    const byRound = new Map<number, Pt[]>()
    for (const p of points) byRound.set(p.round, [...(byRound.get(p.round) ?? []), p])
    const rounds = [...byRound.entries()]
      .map(([round, ps]) => ({
        round,
        n: ps.length,
        meanX: ps.reduce((s, p) => s + p.x, 0) / ps.length,
        meanY: ps.reduce((s, p) => s + p.y, 0) / ps.length,
      }))
      .sort((a, b) => a.meanX - b.meanX)

    // Ticks: five across the y range, and one per round on x.
    const yTicks = Array.from({ length: 5 }, (_, i) => yLo + ((yHi - yLo) * i) / 4)
    const maxWeight = Math.max(...points.map(p => p.weight), 1)
    return { px, py, rounds, yTicks, xMax, maxWeight }
  }, [points, plotW, plotH, spec.better])

  if (!geom) {
    return (
      <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
        <Typography sx={{ fontSize: '0.85rem' }}>No drafted player has reached {spec.minLabel} yet.</Typography>
      </Box>
    )
  }
  const { px, py, rounds, yTicks, maxWeight } = geom

  // Area ∝ playing time, so the radius is a square root. Floor of 3 keeps a cameo visible
  // as a point without letting it carry visual weight it hasn't earned.
  const radius = (w: number) => 3 + 6 * Math.sqrt(w / maxWeight)
  const r = pearson(points)

  return (
    <Box sx={{ position: 'relative' }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.25 }}>
        <Typography sx={{ fontSize: '0.9rem', fontWeight: 800 }}>{spec.title}</Typography>
        <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>
          {spec.yLabel} · {spec.better} is better
        </Typography>
      </Box>
      <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', mb: 0.75 }}>
        {r == null
          ? `Only ${points.length} players here, too few to measure.`
          : `Draft slot vs ${spec.yLabel}: r = ${r >= 0 ? '+' : ''}${r.toFixed(2)}, ${describeR(r, spec.better)}`}
      </Typography>

      <Box
        component="svg"
        viewBox={`0 0 ${VB.w} ${VB.h}`}
        sx={{ width: '100%', height: 'auto', display: 'block', color: 'text.secondary', overflow: 'visible' }}
        onMouseLeave={() => setHover(null)}
      >
        {/* y grid — hairline, solid, recessive */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} y1={py(t)} x2={VB.w - PAD.r} y2={py(t)}
              stroke="currentColor" strokeOpacity={0.14} strokeWidth={1} />
            <text x={PAD.l - 7} y={py(t) + 3.5} textAnchor="end"
              fill="currentColor" fillOpacity={0.75} style={{ fontSize: 10 }}>
              {spec.fmt(t)}
            </text>
          </g>
        ))}

        {/* x axis: one tick per round boundary */}
        {rounds.map(rd => (
          <text key={rd.round} x={px(rd.meanX)} y={VB.h - PAD.b + 15} textAnchor="middle"
            fill="currentColor" fillOpacity={0.75} style={{ fontSize: 10 }}>
            R{rd.round}
          </text>
        ))}
        <text x={PAD.l + plotW / 2} y={VB.h - 3} textAnchor="middle"
          fill="currentColor" fillOpacity={0.6} style={{ fontSize: 10 }}>
          round drafted, earliest at left
        </text>

        {/* every drafted player */}
        {points.map(p => (
          <circle
            key={p.player.id}
            cx={px(p.x)} cy={py(p.y)} r={radius(p.weight)}
            fill={DOT} fillOpacity={hover && hover.player.id !== p.player.id ? 0.22 : 0.55}
            stroke={surface} strokeWidth={2}
            style={{ cursor: onOpenPlayer ? 'pointer' : 'default' }}
            onMouseEnter={() => setHover(p)}
            onClick={() => onOpenPlayer?.(p.player)}
          />
        ))}

        {/* The round-average line — what "do earlier picks do better" actually looks like.
            Drawn as separate segments between CONSECUTIVE rounds rather than one polyline
            through every point: under a playing-time cut whole rounds drop out (no hitter
            from round 3 or 4 clears 20 PA), and a single line would run straight across
            that hole, drawing a confident decline through two rounds it never measured. A
            gap is the honest mark for "no data here". */}
        {rounds.slice(1).map((rd, i) => {
          const prev = rounds[i]
          if (rd.round !== prev.round + 1) return null
          return (
            <line key={rd.round}
              x1={px(prev.meanX)} y1={py(prev.meanY)} x2={px(rd.meanX)} y2={py(rd.meanY)}
              stroke={LINE} strokeWidth={2} strokeLinecap="round" />
          )
        })}
        {rounds.map(rd => {
          const solid = rd.n >= MIN_SOLID_N
          return (
            <g key={rd.round}>
              <circle cx={px(rd.meanX)} cy={py(rd.meanY)} r={5}
                fill={solid ? LINE : surface} stroke={LINE} strokeWidth={2}
                opacity={solid ? 1 : 0.75} />
              {/* n is a direct label, always: it is the difference between a trend and a fluke.
                  Painted with a surface-coloured halo (stroke first, then fill) because it
                  lands wherever the round average lands — which in the busy early rounds is
                  right on top of a cluster of player dots. */}
              <text x={px(rd.meanX)} y={py(rd.meanY) - 11} textAnchor="middle"
                fill="currentColor" fillOpacity={solid ? 0.85 : 0.55}
                stroke={surface} strokeWidth={3} strokeLinejoin="round" paintOrder="stroke"
                style={{ fontSize: 9.5 }}>
                n={rd.n}
              </text>
            </g>
          )
        })}
      </Box>

      {/* legend — two series, so it is always present */}
      <Box sx={{ display: 'flex', gap: 2, mt: 0.5, flexWrap: 'wrap' }}>
        <LegendKey color={DOT} label="one player, sized by playing time" />
        <LegendKey color={LINE} label="round average" />
        <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>
          hollow = fewer than {MIN_SOLID_N} players
        </Typography>
      </Box>

      {hover && (
        <Box sx={{
          position: 'absolute', top: 0, right: 0, px: 1, py: 0.5, borderRadius: 1,
          bgcolor: 'background.paper', border: '1px solid', borderColor: CARD_BORDER,
          boxShadow: 2, pointerEvents: 'none', maxWidth: 240,
        }}>
          <Typography sx={{ fontSize: '0.78rem', fontWeight: 800 }}>{hover.name}</Typography>
          <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>
            Round {hover.round} · {spec.yLabel} {spec.fmt(hover.y)} · {hover.sample}
          </Typography>
        </Box>
      )}
    </Box>
  )
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
      <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>{label}</Typography>
    </Box>
  )
}

/** Put the coefficient in words, so the reader isn't left to guess what 0.05 means. */
function describeR(r: number, better: 'higher' | 'lower'): string {
  const mag = Math.abs(r)
  if (mag < 0.2) return 'no real pattern'
  // "Earlier is better" means a NEGATIVE r for higher-is-better stats (small pick number,
  // big stat) and a POSITIVE r when lower is better (small pick number, small ERA).
  const earlyBetter = better === 'higher' ? r < 0 : r > 0
  const strength = mag < 0.4 ? 'a slight' : mag < 0.6 ? 'a moderate' : 'a strong'
  return `${strength} lean to ${earlyBetter ? 'earlier picks' : 'later picks'}`
}

// ─── The view ─────────────────────────────────────────────────────────────────

type Cut = 'all' | 'sample'

export default function WpblDraftValue({ players, batting, pitching, onOpenPlayer }: {
  players: WpblPlayer[]
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
  onOpenPlayer?: (p: WpblPlayer) => void
}) {
  const [cut, setCut] = useState<Cut>('all')

  // The two floors the "meaningful sample" cut applies. Deliberately low — this is a
  // two-week-old season — but enough to drop one-game cameos.
  const MIN_PA = 20, MIN_IP = 5

  const { hitters, pitchers, roundSize, roundCount, drafted, gamesPlayed } = useMemo(() => {
    // Draft shape and season length both come off the data. Nothing about this view is
    // written down as a fact that a later week can falsify: the round count, the picks per
    // round, how many players were drafted and how far into the season we are all move on
    // their own as games are ingested.
    const size = Math.max(...players.map(p => p.draft_pick ?? 0), 1)
    const lastRound = Math.max(...players.map(p => p.draft_round ?? 0), 1)
    const draftedCount = players.filter(p => p.draft_round && p.draft_pick).length
    const games = new Set(batting.map(l => l.game_id)).size

    const bat: Pt[] = []
    for (const { player, totals } of aggregateBatting(players, batting)) {
      const x = overallPickOf(player, size)
      const pa = totals.ab + totals.bb + totals.hbp + totals.sf
      if (x == null || totals.ops == null || pa === 0) continue
      if (cut === 'sample' && pa < MIN_PA) continue
      bat.push({
        x, y: totals.ops, weight: pa, name: player.name, player,
        round: player.draft_round as number, sample: `${pa} PA`,
      })
    }

    const pit: Pt[] = []
    for (const { player, totals } of aggregatePitching(players, pitching)) {
      const x = overallPickOf(player, size)
      const ip = totals.outs / 3
      if (x == null || totals.era == null || ip === 0) continue
      if (cut === 'sample' && ip < MIN_IP) continue
      pit.push({
        x, y: totals.era, weight: ip, name: player.name, player,
        round: player.draft_round as number,
        sample: `${Math.floor(ip)}.${totals.outs % 3} IP`,
      })
    }
    return {
      hitters: bat, pitchers: pit, roundSize: size, roundCount: lastRound,
      drafted: draftedCount, gamesPlayed: games,
    }
  }, [players, batting, pitching, cut])

  return (
    <Box>
      <Typography sx={{ fontSize: '0.84rem', color: 'text.secondary', mb: 1.5 }}>
        Where a player went in the draft, against how they have hit or pitched since.
        {' '}{drafted} players over {roundCount} rounds of {roundSize}. The line is each
        round's average.
      </Typography>

      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <Chip active={cut === 'all'} onClick={() => setCut('all')}>Everyone who played</Chip>
        <Chip active={cut === 'sample'} onClick={() => setCut('sample')}>
          {MIN_PA}+ PA / {MIN_IP}+ IP
        </Chip>
      </Box>

      <Box sx={{
        display: 'grid', gap: 3,
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
      }}>
        <Panel onOpenPlayer={onOpenPlayer} spec={{
          title: 'Hitters', yLabel: 'OPS', better: 'higher',
          fmt: fmtRate, points: hitters,
          minLabel: `${MIN_PA} PA`,
        }} />
        <Panel onOpenPlayer={onOpenPlayer} spec={{
          title: 'Pitchers', yLabel: 'ERA', better: 'lower',
          fmt: fmtTwo, points: pitchers,
          minLabel: `${MIN_IP} IP`,
        }} />
      </Box>

      <Typography sx={{ fontSize: '0.74rem', color: 'text.disabled', mt: 2, lineHeight: 1.5 }}>
        {gamesPlayed} games into the season. Any round showing a hollow marker is down to
        one or two players with any playing time, so a single good night swings its average
        a long way. That is what the n on each point is for. Flip between the two filters
        above and watch the trend change shape.
      </Typography>
    </Box>
  )
}

// Matches the chip in StatsView — same shape, same states.
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Box onClick={onClick} sx={{
      px: 1.25, py: 0.4, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
      border: '1px solid', borderColor: active ? 'transparent' : CARD_BORDER,
      bgcolor: active ? 'action.selected' : 'transparent',
      color: active ? 'text.primary' : 'text.secondary',
      fontSize: '0.78rem', fontWeight: active ? 800 : 600,
      '&:hover': { color: 'text.primary' },
    }}>
      {children}
    </Box>
  )
}

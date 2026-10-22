import { useMemo, useState } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import { aggregateBatting, aggregatePitching, fmtRate, fmtTwo, plateAppearances, scaleToBasis } from './stats'
import { useEraBasis } from './EraBasisContext'
import { CARD_BORDER } from './ui'
import { FilterChip } from '../ui/FilterChip'
import { InfoDot } from '../ui/InfoDot'
import type { WpblPlayer, WpblBattingLine, WpblPitchingLine } from './types'
import { regularSeasonLines, type WpblSeasonGame } from './season'
import { TYPE_SCALE } from '../ui/card'

// "Do earlier draft picks actually produce better players?": a scatter of every drafted
// player's season rate stat against where they were taken, with the per-round average drawn
// over the top as a line.
//
// The honest answer this season is no, and the chart is built so that reads correctly
// rather than accidentally. Three deliberate choices, all of them guarding the same
// failure: a six-round draft against one short season leaves the late rounds with one or
// two players each, and a naive line through those means would show a dramatic
// "5th rounders rake" trend that is really one hot bat:
//
//   • dot area scales with playing time, so a 2-PA cameo can't look like a regular's season
//   • every round-average marker is labeled with the n behind it, and goes hollow and
//     faint below MIN_SOLID_N, so a point resting on one player never reads as a finding
//   • the correlation is computed live and printed as a stat, "r −0.31", with no sentence
//     reading it: a headline like "earlier picks hit a little better" is the page arguing a
//     finding from twenty players, and copy on this site is a label (house rule, Oct 21, 2026).
//     The info dot says what r is and which sign means earlier picks did better.
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
  weight: number       // playing time (PA or IP): drives dot area
  name: string
  player: WpblPlayer
  round: number
  sample: string       // "34 PA" / "12.1 IP", for the tooltip
}

interface PanelSpec {
  title: string
  yLabel: string
  /** The stat in words, for the info dot: "OPS (on-base plus slugging)". */
  yName: string
  better: 'higher' | 'lower'
  fmt: (v: number) => string
  points: Pt[]
  /** The draft and the sample, for the info dot: "120 drafted players, 6 rounds of 20, ..." */
  sample: string
}

/** 1, 2, 2.5 or 5 times a power of ten, the smallest at least `raw`. */
function niceStep(raw: number): number {
  const mag = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? 10 * mag
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
    // negative stretch of axis: a gridline reading "-0.248 OPS" is nonsense.
    yLo = Math.max(0, yLo)

    const px = (x: number) => PAD.l + (x / (xMax + 1)) * plotW
    const py = (y: number) => PAD.t + plotH - ((y - yLo) / (yHi - yLo)) * plotH

    // Round averages: the line the question is really asking about.
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

    // Ticks on round numbers, about five of them. Five even fifths of a padded range put
    // ".491" and "1.472" down the axis, which reads as data rather than as a scale; the range
    // is widened to the ticks so the top and bottom gridlines still close the plot.
    const step = niceStep((yHi - yLo) / 4)
    yLo = Math.max(0, Math.floor(yLo / step) * step)
    yHi = Math.ceil(yHi / step) * step
    const yTicks: number[] = []
    for (let t = yLo; t <= yHi + step / 2; t += step) yTicks.push(t)
    const maxWeight = Math.max(...points.map(p => p.weight), 1)
    return { px, py, rounds, yTicks, xMax, maxWeight }
  }, [points, plotW, plotH])

  if (!geom) {
    return (
      <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
        <Typography sx={{ fontSize: TYPE_SCALE.body }}>No data</Typography>
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
      {/* The stat's definition and what r means live in the info dot. The line under the title
          is the coefficient as a stat, the way a table would print it. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800 }}>{spec.title}</Typography>
        <InfoDot text={[
          `Each dot is a drafted player's ${spec.yName} this regular season, placed at the pick they were taken with, and sized by how much they played. ${spec.better === 'higher' ? 'Higher' : 'Lower'} is better. The orange line joins each round's average; a hollow marker rests on fewer than ${MIN_SOLID_N} players.`,
          `r is the correlation between pick number and ${spec.yLabel}, from −1 to +1. Near 0 is no pattern. Because ${spec.better} ${spec.yLabel} is better, ${spec.better === 'higher' ? 'a minus' : 'a plus'} means earlier picks did better. It needs at least three players.`,
          spec.sample,
        ]} />
      </Box>
      <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700, lineHeight: 1.35, mt: 0.25, mb: 0.75, fontVariantNumeric: 'tabular-nums' }}>
        <Box component="span" sx={{ color: 'text.secondary', fontWeight: 600 }}>r </Box>
        {r == null ? '—' : `${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(2)}`}
      </Typography>

      <Box
        component="svg"
        viewBox={`0 0 ${VB.w} ${VB.h}`}
        sx={{ width: '100%', height: 'auto', display: 'block', color: 'text.secondary', overflow: 'visible' }}
        onMouseLeave={() => setHover(null)}
      >
        {/* y grid: hairline, solid, recessive */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} y1={py(t)} x2={VB.w - PAD.r} y2={py(t)}
              stroke="currentColor" strokeOpacity={0.14} strokeWidth={1} />
            <text x={PAD.l - 7} y={py(t) + 3.5} textAnchor="end"
              fill={theme.palette.text.secondary} fontSize={10}>
              {spec.fmt(t)}
            </text>
          </g>
        ))}

        {/* x axis: one tick per round boundary */}
        {rounds.map(rd => (
          <text key={rd.round} x={px(rd.meanX)} y={VB.h - PAD.b + 15} textAnchor="middle"
            fill={theme.palette.text.secondary} fontSize={10}>
            R{rd.round}
          </text>
        ))}
        <text x={PAD.l + plotW / 2} y={VB.h - 3} textAnchor="middle"
          fill={theme.palette.text.secondary} fontSize={10}>
          Round drafted
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

        {/* The round-average line: what "do earlier picks do better" actually looks like.
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
              Painted with a surface-colored halo (stroke first, then fill) because it
              lands wherever the round average lands, which in the busy early rounds is
              right on top of a cluster of player dots. */}
              <text x={px(rd.meanX)} y={py(rd.meanY) - 11} textAnchor="middle"
                fill={solid ? theme.palette.text.primary : theme.palette.text.secondary}
                stroke={surface} strokeWidth={3} strokeLinejoin="round" paintOrder="stroke"
                fontSize={9.5}>
                n={rd.n}
              </text>
            </g>
          )
        })}
      </Box>

      {/* legend: two series, so it is always present */}
      <Box sx={{ display: 'flex', gap: 2, mt: 0.5, flexWrap: 'wrap' }}>
        <LegendKey color={DOT} label="Player" />
        <LegendKey color={LINE} label="Round average" />
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled' }}>
          Hollow: n &lt; {MIN_SOLID_N}
        </Typography>
      </Box>

      {hover && (
        <Box sx={{
          position: 'absolute', top: 0, right: 0, px: 1, py: 0.5, borderRadius: 1,
          bgcolor: 'background.paper', border: '1px solid', borderColor: CARD_BORDER,
          boxShadow: 2, pointerEvents: 'none', maxWidth: '15rem',
        }}>
          <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 800 }}>{hover.name}</Typography>
          <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
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
      <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{label}</Typography>
    </Box>
  )
}

// ─── The view ─────────────────────────────────────────────────────────────────

type Cut = 'all' | 'sample'

export default function WpblDraftValue({ players, batting, pitching, games: schedule, onOpenPlayer, side }: {
  /** One panel for this side (the Stats tab's Hitting/Pitching switch), or both when omitted. */
  side?: 'hitting' | 'pitching'
  players: WpblPlayer[]
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
  // Renamed on the way in because the body already calls its own game COUNT `games`.
  games: WpblSeasonGame[]
  onOpenPlayer?: (p: WpblPlayer) => void
}) {
  const { basis: eraBasis } = useEraBasis()
  const [cut, setCut] = useState<Cut>('all')

  // The two floors the "meaningful sample" cut applies. Deliberately low, since this is one
  // short season, but enough to drop one-game cameos.
  const MIN_PA = 20, MIN_IP = 5

  const { hitters, pitchers, roundSize, roundCount, drafted, gamesPlayed } = useMemo(() => {
    // Draft shape and season length both come off the data. Nothing about this view is
    // written down as a fact that a later week can falsify: the round count, the picks per
    // round, how many players were drafted and how far into the season we are all move on
    // their own as games are ingested.
    const size = Math.max(...players.map(p => p.draft_pick ?? 0), 1)
    const lastRound = Math.max(...players.map(p => p.draft_round ?? 0), 1)
    const draftedCount = players.filter(p => p.draft_round && p.draft_pick).length
    // Regular-season games only, or the "N games in" line under the chart starts counting
    // playoff games as season progress the moment the postseason begins.
    const games = new Set(regularSeasonLines(batting, schedule).map(l => l.game_id)).size

    const bat: Pt[] = []
    for (const { player, totals } of aggregateBatting(players, batting, schedule)) {
      const x = overallPickOf(player, size)
      const pa = plateAppearances(totals)
      if (x == null || totals.ops == null || pa === 0) continue
      if (cut === 'sample' && pa < MIN_PA) continue
      bat.push({
        x, y: totals.ops, weight: pa, name: player.name, player,
        round: player.draft_round as number, sample: `${pa} PA`,
      })
    }

    const pit: Pt[] = []
    for (const { player, totals } of aggregatePitching(players, pitching, schedule)) {
      const x = overallPickOf(player, size)
      const ip = totals.outs / 3
      if (x == null || totals.era == null || ip === 0) continue
      if (cut === 'sample' && ip < MIN_IP) continue
      pit.push({
        // Scaled here, at the point the model's y-axis is built, because the axis carries an
        // ERA label and its ticks are drawn from these values: an unscaled point would put a
        // per-9 number under a chart the rest of the section is showing per 7.
        x, y: scaleToBasis(totals.era, eraBasis) as number, weight: ip, name: player.name, player,
        round: player.draft_round as number,
        sample: `${Math.floor(ip)}.${totals.outs % 3} IP`,
      })
    }
    return {
      hitters: bat, pitchers: pit, roundSize: size, roundCount: lastRound,
      drafted: draftedCount, gamesPlayed: games,
    }
  }, [players, batting, pitching, cut, eraBasis, schedule])

  const sample = `${drafted} drafted players, ${roundCount} rounds of ${roundSize}, across ${gamesPlayed} regular-season games.`
  const hitterPanel = (
    <Panel onOpenPlayer={onOpenPlayer} spec={{
      title: 'Hitters', yLabel: 'OPS', yName: 'OPS (on-base percentage plus slugging)', better: 'higher',
      fmt: fmtRate, points: hitters, sample,
    }} />
  )
  const pitcherPanel = (
    <Panel onOpenPlayer={onOpenPlayer} spec={{
      title: 'Pitchers', yLabel: 'ERA', yName: `ERA (earned runs allowed per ${eraBasis === 7 ? 'seven' : 'nine'} innings)`, better: 'lower',
      fmt: fmtTwo, points: pitchers, sample,
    }} />
  )
  const floor = side === 'hitting' ? `${MIN_PA}+ PA` : side === 'pitching' ? `${MIN_IP}+ IP` : `${MIN_PA}+ PA / ${MIN_IP}+ IP`

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <FilterChip active={cut === 'all'} onClick={() => setCut('all')}>All</FilterChip>
        <FilterChip active={cut === 'sample'} onClick={() => setCut('sample')}>{floor}</FilterChip>
      </Box>

      {side ? (side === 'hitting' ? hitterPanel : pitcherPanel) : (
        <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
          {hitterPanel}
          {pitcherPanel}
        </Box>
      )}
    </Box>
  )
}

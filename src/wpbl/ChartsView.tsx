import { useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { fetchWpblAllPitchPlays, getCachedWpblAllPitchPlays } from './api'
import { aggregatePitchCodes, pitchQualifiers } from './derive/pitches'
import {
  eraFipChart, firstStrikeWalkChart, obpSlgChart, swingContactChart, twoWayChart,
  type ChartData,
} from './derive/charts'
import type { PlayerValueSeason } from './derive/playerValue'
import { fmtRate, fmtTwo, wpblQualifiers, type FipWeights, type WpblBatSeason, type WpblPitSeason, type WpblBattingTotals, type WpblPitchingTotals } from './stats'
import { useEraBasis } from './EraBasisContext'
import { useWpblSeason } from './SeasonContext'
import { useWpblPlayerLink } from './LinkContext'
import type { WpblGame, WpblPlayer, WpblTeam } from './types'
import { ScatterFrame, ScatterPlot, type ScatterAxis, type ScatterGuides, type ScatterPoint } from '../ui/charts/ScatterPlot'
import { niceDomain, sharedDomain, sumLevels } from '../ui/charts/scale'
import { nameStages } from '../ui/names'
import { FilterChip } from '../ui/FilterChip'
import { InfoDot } from '../ui/InfoDot'
import { TYPE_SCALE } from '../ui/card'
import { typePx } from '../ui/scale'

// THE CHARTS BOARD: every player on two stats at once (derive/charts.ts says what each chart asks).
// The section's take on MLB's Charts page, which plots the 30 clubs; four clubs make a thin plot, so
// here the dots are players. Hitting shows the two hitter charts, Pitching the two pitcher charts and
// Overall the two-way chart, so the side switch above means what it means on every other board.
//
// Two of the five need nothing new: the season totals are the ones the Players table is built from
// (the stored seasons when they are current). The swing and first-pitch charts count every pitch,
// so they read the play log the Pitch by pitch board reads, from the same cache.

const pct = (v: number) => `${Math.round(v * 100)}%`
const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`
const war = (v: number) => (v < 0 ? `−${Math.abs(v).toFixed(1)}` : v.toFixed(1))

interface ChartSpec {
  key: string
  title: string
  info: string
  data: ChartData | null
  x: { label: string; name: string; fmt: (v: number) => string; tick: (v: number) => string; floor?: number; invert?: boolean }
  y: { label: string; name: string; fmt: (v: number) => string; tick: (v: number) => string; floor?: number; invert?: boolean }
  guides: (x: ScatterAxis, y: ScatterAxis, avg: ChartData['avg']) => ScatterGuides
  /** Both axes on one scale, for a chart whose diagonal means "equal". */
  shared?: boolean
  /** Shown in the frame when there is nothing to draw. */
  empty: string
}

export default function WpblChartsView({ side, teams, players, games, batting, pitching, league, valueSeasons, fWeights, onOpenPlayer }: {
  side: 'hitting' | 'pitching' | 'overall'
  teams: WpblTeam[]
  /** Every player, for naming the play log's batters and pitchers (traded players included). */
  players: WpblPlayer[]
  games: WpblGame[]
  /** Regular-season totals for the year on screen. */
  batting: WpblBatSeason[]
  pitching: WpblPitSeason[]
  league: { batting: WpblBattingTotals; pitching: WpblPitchingTotals }
  /** Null until the play log or the stored seasons have answered. */
  valueSeasons: PlayerValueSeason<WpblPlayer>[] | null
  fWeights: FipWeights | null
  onOpenPlayer: (p: WpblPlayer) => void
}) {
  const { basis } = useEraBasis()
  const [everyone, setEveryone] = useState(false)
  const qual = useMemo(() => wpblQualifiers(teams, games), [teams, games])
  const pitchMins = useMemo(() => pitchQualifiers(qual.active ? qual.teamGames : 0), [qual])

  // The play log, only for the two pitch-by-pitch charts. Same read and cache as Pitch by pitch,
  // held with the season it was read for so a year picked from the menu reads afresh.
  const { season, cut } = useWpblSeason()
  const wantPitches = side !== 'overall'
  const [read, setRead] = useState(() => ({ season, plays: getCachedWpblAllPitchPlays(season) }))
  const allPlays = read.season === season ? read.plays : null
  useEffect(() => {
    if (!wantPitches) return
    let cancelled = false
    // An empty log on failure, so the chart says there is nothing to draw rather than holding its frame.
    fetchWpblAllPitchPlays(season).then(p => { if (!cancelled) setRead({ season, plays: p }) })
      .catch(() => { if (!cancelled) setRead(prev => (prev.season === season && prev.plays ? prev : { season, plays: [] })) })
    return () => { cancelled = true }
  }, [wantPitches, season])
  const pitchBoard = useMemo(
    () => (allPlays && wantPitches ? aggregatePitchCodes(cut(allPlays), players, games) : null),
    [allPlays, wantPitches, cut, players, games])

  // Every chart's points, built whichever side is showing, so the hooks run in the same order on
  // every render; each is cheap beside the reads behind it.
  const obpSlg = useMemo(() => obpSlgChart(batting, league.batting, qual.minPa), [batting, league.batting, qual.minPa])
  const eraFip = useMemo(() => eraFipChart(pitching, league.pitching, fWeights, qual.minOuts, basis), [pitching, league.pitching, fWeights, qual.minOuts, basis])
  const swingContact = useMemo(() => (pitchBoard ? swingContactChart(pitchBoard.batters, pitchBoard.league, pitchMins.minBatter) : null), [pitchBoard, pitchMins.minBatter])
  const firstStrike = useMemo(() => (pitchBoard ? firstStrikeWalkChart(pitchBoard.pitchers, pitchBoard.league, pitchMins.minPitcher) : null), [pitchBoard, pitchMins.minPitcher])
  const twoWay = useMemo(() => (valueSeasons ? twoWayChart(valueSeasons, qual.minPa, qual.minOuts) : null), [valueSeasons, qual.minPa, qual.minOuts])

  const specs: ChartSpec[] = side === 'hitting' ? [
    {
      key: 'obp-slg', title: 'OBP vs SLG',
      info: 'One dot per hitter, sized by PA. Dotted lines: OPS. Dashed lines: league average.',
      data: obpSlg,
      x: { label: 'OBP', name: 'OBP', fmt: fmtRate, tick: fmtRate, floor: 0 },
      y: { label: 'SLG', name: 'SLG', fmt: fmtRate, tick: fmtRate, floor: 0 },
      guides: (x, y, avg) => ({
        avg: avg ? { ...avg, label: 'League avg' } : undefined,
        sums: sumLevels(x, y, 5).map(v => ({ value: v, label: `${fmtRate(v)} OPS` })),
      }),
      empty: 'No data',
    },
    {
      key: 'swing-contact', title: 'Swing% vs Contact%',
      info: 'One dot per hitter, sized by pitches seen. Swing%: swings over pitches. Contact%: fouls and balls in play over swings. From the play-by-play. Dashed lines: league average.',
      data: swingContact,
      x: { label: 'Swing%', name: 'Swing%', fmt: pct1, tick: pct, floor: 0 },
      y: { label: 'Contact%', name: 'Contact%', fmt: pct1, tick: pct, floor: 0 },
      guides: (_x, _y, avg) => ({ avg: avg ? { ...avg, label: 'League avg' } : undefined }),
      empty: 'No data',
    },
  ] : side === 'pitching' ? [
    {
      key: 'era-fip', title: 'ERA vs FIP',
      info: `One dot per pitcher, sized by IP. ERA and FIP per ${basis} innings. FIP uses this league's run values. Dashed line: ERA = FIP.`,
      data: eraFip,
      x: { label: 'FIP', name: 'FIP', fmt: fmtTwo, tick: fmtTwo, floor: 0 },
      y: { label: 'ERA', name: 'ERA', fmt: fmtTwo, tick: fmtTwo, floor: 0 },
      shared: true,
      guides: () => ({ diagonal: { above: 'ERA > FIP', below: 'ERA < FIP' } }),
      empty: 'No data',
    },
    {
      key: 'first-strike-walks', title: 'F-Strike% vs BB%',
      info: 'One dot per pitcher, sized by pitches. F-Strike%: batters whose first pitch was a strike. BB%: walks over batters faced, axis inverted. From the play-by-play. Dashed lines: league average.',
      data: firstStrike,
      x: { label: 'F-Strike%', name: 'F-Strike%', fmt: pct1, tick: pct, floor: 0 },
      y: { label: 'BB% (inverted)', name: 'BB%', fmt: pct1, tick: pct, floor: 0, invert: true },
      guides: (_x, _y, avg) => ({ avg: avg ? { ...avg, label: 'League avg' } : undefined }),
      empty: 'No data',
    },
  ] : [
    {
      key: 'two-way', title: 'Pos WAR vs Pit WAR',
      info: 'Players with at least one PA and one out recorded, sized by PA plus outs. Pos WAR: batting, baserunning and fielding. Pit WAR: pitching. The two sum to WAR. Solid lines: zero.',
      data: twoWay,
      x: { label: 'Pos WAR', name: 'Pos WAR', fmt: war, tick: war },
      y: { label: 'Pit WAR', name: 'Pit WAR', fmt: war, tick: war },
      guides: (x, y) => ({
        zero: true,
        sums: sumLevels(x, y, 3).filter(v => v > 0).map(v => ({ value: v, label: `${war(v)} WAR` })),
      }),
      empty: 'No data',
    },
  ]

  return (
    <Box>
      {qual.active && (
        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
          <FilterChip active={!everyone} onClick={() => setEveryone(e => !e)}>Qualified</FilterChip>
        </Box>
      )}
      <Box sx={{ display: 'grid', gap: { xs: 3.5, md: 4 }, gridTemplateColumns: { xs: '1fr', md: specs.length > 1 ? '1fr 1fr' : '1fr' } }}>
        {specs.map(s => (
          <ChartPanel key={s.key} spec={s} everyone={everyone || !qual.active} onOpenPlayer={onOpenPlayer} narrowSingle={specs.length === 1} />
        ))}
      </Box>
    </Box>
  )
}

function ChartPanel({ spec, everyone, onOpenPlayer, narrowSingle }: {
  spec: ChartSpec
  everyone: boolean
  onOpenPlayer: (p: WpblPlayer) => void
  /** A lone chart on a wide screen is capped, so it is not a 1,000px-wide plot of twelve dots. */
  narrowSingle: boolean
}) {
  const playerLink = useWpblPlayerLink()
  const { data } = spec
  const shown = useMemo(() => (data ? data.points.filter(p => everyone || p.qualified) : []), [data, everyone])

  const axes = useMemo(() => {
    if (!data || shown.length === 0) return null
    const xs = shown.map(p => p.x), ys = shown.map(p => p.y)
    const avg = data.avg
    const dx = spec.shared ? sharedDomain(xs, ys, { floor: spec.x.floor }) : niceDomain(xs, { floor: spec.x.floor, include: avg ? [avg.x] : [] })
    const dy = spec.shared ? dx : niceDomain(ys, { floor: spec.y.floor, include: avg ? [avg.y] : [] })
    const x: ScatterAxis = { ...dx, label: spec.x.label, fmt: spec.x.tick, invert: spec.x.invert }
    const y: ScatterAxis = { ...dy, label: spec.y.label, fmt: spec.y.tick, invert: spec.y.invert }
    return { x, y, guides: spec.guides(x, y, avg) }
    // spec's functions are rebuilt every render; what they draw depends on these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, shown, spec.key])

  const points = useMemo<ScatterPoint[]>(() => shown.map(p => {
    const link = playerLink(p.player, onOpenPlayer) as { href?: string; onClick?: (e: React.MouseEvent) => void }
    const stages = nameStages(p.player.name)
    return {
      id: p.player.id, x: p.x, y: p.y, weight: p.weight,
      label: stages[stages.length - 1],
      ariaLabel: `${p.player.name}: ${spec.x.name} ${spec.x.fmt(p.x)}, ${spec.y.name} ${spec.y.fmt(p.y)}, ${p.sample}`,
      href: link.href,
      onOpen: link.onClick,
      tip: (
        <>
          <Typography sx={{ fontWeight: 800, fontSize: TYPE_SCALE.body, lineHeight: 1.25, mb: 0.25 }}>{p.player.name}</Typography>
          <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
            {spec.x.name} <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{spec.x.fmt(p.x)}</Box>
          </Typography>
          <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
            {spec.y.name} <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{spec.y.fmt(p.y)}</Box>
          </Typography>
          <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{p.sample}</Typography>
        </>
      ),
    }
    // spec's formatters are rebuilt every render; they change only with the chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [shown, playerLink, onOpenPlayer, spec.key])

  return (
    <Box sx={{ minWidth: 0, ...(narrowSingle ? { maxWidth: { md: '34rem' } } : {}) }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
        <Typography component="h3" sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, letterSpacing: typePx(-0.2) }}>{spec.title}</Typography>
        <InfoDot label={`About ${spec.title}`} text={spec.info} />
      </Box>
      {data == null ? <ScatterFrame /> : axes == null ? (
        <Box sx={{ position: 'relative' }}>
          <ScatterFrame />
          <Typography sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', px: 3, textAlign: 'center', fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>
            {spec.empty}
          </Typography>
        </Box>
      ) : (
        <ScatterPlot points={points} x={axes.x} y={axes.y} guides={axes.guides}
          labeled={data.notable} title={spec.title} />
      )}
    </Box>
  )
}

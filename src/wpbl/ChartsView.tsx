import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Typography, useMediaQuery, useTheme, type Theme } from '@mui/material'
import { fetchWpblAllLines, fetchWpblAllPitchPlays, getCachedWpblAllLines, getCachedWpblAllPitchPlays } from './api'
import { aggregatePitchCodes, pitchQualifiers } from './derive/pitches'
import {
  averagePowerChart, eraFipChart, obpSlgChart, pitcherStrikeoutWalkChart, swingContactChart, walkStrikeoutChart, type ChartData,
} from './derive/charts'
import { fip, fipConstant, fmtRate, fmtTwo, scaleToBasis, sumBatting, sumPitching, wpblQualifiers, type FipWeights, type WpblBatSeason, type WpblPitSeason, type WpblBattingTotals, type WpblPitchingTotals } from './stats'
import { useEraBasis } from './EraBasisContext'
import { useWpblSeason } from './SeasonContext'
import { useWpblPlayerLink, useWpblTeamLink } from './LinkContext'
import type { WpblGame, WpblPlayer, WpblTeam } from './types'
import { ScatterFrame, ScatterPlot, type ScatterAxis, type ScatterGuides, type ScatterPoint } from '../ui/charts/ScatterPlot'
import { niceDomain, sharedDomain, stepDecimals, tickStep, axisValues } from '../ui/charts/scale'
import { nameStages } from '../ui/names'
import { FilterChip, filterChipSx } from '../ui/FilterChip'
import { wpblAccent, wpblFullName } from './constants'
import { InfoDot } from '../ui/InfoDot'
import { usePhoneLayout } from '../ui/ModalShell'
import { TYPE_SCALE } from '../ui/card'
import { typePx } from '../ui/scale'

// THE CHARTS BOARD: every player on two stats at once (derive/charts.ts says what each chart asks).
// The section's take on MLB's Charts page, which plots the 30 clubs; four clubs make a thin plot, so
// here the dots are players. Hitting shows the hitter charts and Pitching the pitcher charts, so the
// side switch above means what it means on every other board. Overall has no chart: Pos WAR vs Pit
// WAR held only the handful who did both, and plotted a thin corner of the league.
//
// Most need nothing new: the season totals are the ones the Players table is built from (the stored
// seasons when they are current). The swing chart counts every pitch, so it reads the play log the
// Pitch by pitch board reads, from the same cache.

// Tick formatters take the axis's step, so a tick prints as many decimals as the step needs: an ERA
// axis read "10.00" at a fixed two decimals.
const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`
const pctTick = (v: number, step: number) => `${(v * 100).toFixed(stepDecimals(step * 100))}%`
const runsTick = (v: number, step: number) => v.toFixed(stepDecimals(step))

interface AxisSpec {
  label: string
  name: string
  fmt: (v: number) => string
  /** A gridline's label, given the step between gridlines. */
  tick: (v: number, step: number) => string
  /** The stat's natural bounds, so padding never draws a gridline at a value nobody can reach
   *  (a negative rate, a Contact% over 100%). */
  floor?: number
  ceil?: number
  invert?: boolean
}

interface ChartSpec {
  key: string
  title: string
  info: string
  data: ChartData | null
  x: AxisSpec
  y: AxisSpec
  guides: (x: ScatterAxis, y: ScatterAxis, avg: ChartData['avg']) => ScatterGuides
  /** Both axes on one scale, for a chart whose diagonal means "equal". */
  shared?: boolean
  /** Shown in the frame when there is nothing to draw. */
  empty: string
  /** What a dot's size counts, for the key beside the title. */
  size: string
  /** A third figure the two axes make together, for the card (OPS on OBP vs SLG). */
  extra?: { name: string; value: (x: number, y: number) => string }
  /** A club's place on the chart from its season totals, for the Clubs overlay. Absent on the
   *  pitch-by-pitch chart, which has no club line to read it from. */
  club?: (t: ClubTotals) => { x: number; y: number } | null
}

interface ClubTotals { batting: WpblBattingTotals; pitching: WpblPitchingTotals }

const both = (x: number | null, y: number | null) => (x != null && y != null ? { x, y } : null)

export default function WpblChartsView({ side, teams, players, games, batting, pitching, league, fWeights, onOpenPlayer, onOpenTeam }: {
  side: 'hitting' | 'pitching'
  teams: WpblTeam[]
  /** Every player, for naming the play log's batters and pitchers (traded players included). */
  players: WpblPlayer[]
  games: WpblGame[]
  /** Regular-season totals for the year on screen. */
  batting: WpblBatSeason[]
  pitching: WpblPitSeason[]
  league: { batting: WpblBattingTotals; pitching: WpblPitchingTotals }
  fWeights: FipWeights | null
  onOpenPlayer: (p: WpblPlayer) => void
  onOpenTeam?: (t: WpblTeam) => void
}) {
  const { basis } = useEraBasis()
  const [everyone, setEveryone] = useState(false)
  const qual = useMemo(() => wpblQualifiers(teams, games), [teams, games])
  const pitchMins = useMemo(() => pitchQualifiers(qual.active ? qual.teamGames : 0), [qual])

  // The play log, only for the pitch-by-pitch chart on Hitting. Same read and cache as Pitch by
  // pitch, held with the season it was read for so a year picked from the menu reads afresh.
  const { season, cut } = useWpblSeason()
  const wantPitches = side === 'hitting'
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
  const walkK = useMemo(() => walkStrikeoutChart(batting, league.batting, qual.minPa), [batting, league.batting, qual.minPa])
  const avgIso = useMemo(() => averagePowerChart(batting, league.batting, qual.minPa), [batting, league.batting, qual.minPa])
  const pitKbb = useMemo(() => pitcherStrikeoutWalkChart(pitching, league.pitching, qual.minOuts), [pitching, league.pitching, qual.minOuts])
  const fipC = useMemo(() => fipConstant(league.pitching, fWeights), [league.pitching, fWeights])

  const specs: ChartSpec[] = side === 'hitting' ? [
    {
      key: 'obp-slg', title: 'OBP vs SLG',
      info: 'One dot per hitter, sized by PA. Dashed lines: league average.',
      data: obpSlg,
      x: { label: 'OBP', name: 'OBP', fmt: fmtRate, tick: fmtRate, floor: 0, ceil: 1 },
      y: { label: 'SLG', name: 'SLG', fmt: fmtRate, tick: fmtRate, floor: 0, ceil: 4 },
      // No OPS lines: drawn diagonally across the league average's crosshair they read as a second
      // set of averages. OPS is on each dot's card instead.
      guides: (_x, _y, avg) => ({ avg: avg ? { ...avg, label: 'League avg' } : undefined }),
      empty: 'No data',
      size: 'PA',
      extra: { name: 'OPS', value: (x, y) => fmtRate(x + y) },
      club: t => both(t.batting.obp, t.batting.slg),
    },
    {
      key: 'avg-iso', title: 'AVG vs ISO',
      info: 'One dot per hitter, sized by PA. ISO: SLG minus AVG, extra bases per at-bat. Dashed lines: league average.',
      data: avgIso,
      x: { label: 'AVG', name: 'AVG', fmt: fmtRate, tick: fmtRate, floor: 0, ceil: 1 },
      y: { label: 'ISO', name: 'ISO', fmt: fmtRate, tick: fmtRate, floor: 0, ceil: 3 },
      guides: (_x, _y, avg) => ({ avg: avg ? { ...avg, label: 'League avg' } : undefined }),
      empty: 'No data',
      size: 'PA',
      extra: { name: 'SLG', value: (x, y) => fmtRate(x + y) },
      club: t => both(t.batting.avg, t.batting.iso),
    },
    {
      key: 'bb-k', title: 'BB% vs K%',
      info: 'One dot per hitter, sized by PA. BB% and K%: walks and strikeouts over plate appearances. K% axis inverted. Dashed lines: league average.',
      data: walkK,
      x: { label: 'BB%', name: 'BB%', fmt: pct1, tick: pctTick, floor: 0, ceil: 1 },
      y: { label: 'K% (inverted)', name: 'K%', fmt: pct1, tick: pctTick, floor: 0, ceil: 1, invert: true },
      guides: (_x, _y, avg) => ({ avg: avg ? { ...avg, label: 'League avg' } : undefined }),
      empty: 'No data',
      size: 'PA',
      club: t => both(t.batting.bbPct, t.batting.kPct),
    },
    {
      key: 'swing-contact', title: 'Swing% vs Contact%',
      info: 'One dot per hitter, sized by pitches seen. Swing%: swings over pitches. Contact%: fouls and balls in play over swings. From the play-by-play. Dashed lines: league average.',
      data: swingContact,
      x: { label: 'Swing%', name: 'Swing%', fmt: pct1, tick: pctTick, floor: 0, ceil: 1 },
      y: { label: 'Contact%', name: 'Contact%', fmt: pct1, tick: pctTick, floor: 0, ceil: 1 },
      guides: (_x, _y, avg) => ({ avg: avg ? { ...avg, label: 'League avg' } : undefined }),
      empty: 'No data',
      size: 'Pitches',
    },
  ] : [
    {
      key: 'era-fip', title: 'ERA vs FIP',
      info: `One dot per pitcher, sized by IP. ERA and FIP per ${basis} innings. FIP uses this league's run values. Dashed line: ERA = FIP.`,
      data: eraFip,
      x: { label: 'FIP', name: 'FIP', fmt: fmtTwo, tick: runsTick, floor: 0 },
      y: { label: 'ERA', name: 'ERA', fmt: fmtTwo, tick: runsTick, floor: 0 },
      shared: true,
      guides: () => ({ diagonal: { above: 'ERA > FIP', below: 'ERA < FIP' } }),
      empty: 'No data',
      size: 'IP',
      extra: { name: 'ERA − FIP', value: (x, y) => (y - x >= 0 ? '+' : '−') + Math.abs(y - x).toFixed(2) },
      club: t => {
        const f = fip(t.pitching, fWeights, fipC)
        return f == null || t.pitching.era == null ? null : { x: scaleToBasis(f, basis)!, y: scaleToBasis(t.pitching.era, basis)! }
      },
    },
    {
      key: 'k-bb-pitching', title: 'K% vs BB%',
      info: 'One dot per pitcher, sized by batters faced. K% and BB%: strikeouts and walks over batters faced. BB% axis inverted. Dashed lines: league average.',
      data: pitKbb,
      x: { label: 'K%', name: 'K%', fmt: pct1, tick: pctTick, floor: 0, ceil: 1 },
      y: { label: 'BB% (inverted)', name: 'BB%', fmt: pct1, tick: pctTick, floor: 0, ceil: 1, invert: true },
      guides: (_x, _y, avg) => ({ avg: avg ? { ...avg, label: 'League avg' } : undefined }),
      empty: 'No data',
      size: 'BF',
      extra: { name: 'K−BB%', value: (x, y) => (x - y < 0 ? '−' : '') + pct1(Math.abs(x - y)) },
      club: t => both(t.pitching.kPct, t.pitching.bbPct),
    },
  ]

  // What the reader has narrowed the dots to: one club, a name typed into the search, or both.
  // Everything else stays drawn, faded, so a player is still seen against the league.
  const [club, setClub] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const focus = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!club && !q) return null
    return new Set(players
      .filter(p => (!club || p.team_id === club) && (!q || p.name.toLowerCase().includes(q)))
      .map(p => p.id))
  }, [players, club, query])
  // The player lit on one chart, ringed and named on the other: the same hitter's power on one
  // and their swing decisions on the next, without hunting for the dot twice.
  const [lit, setLit] = useState<string | null>(null)
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const dark = useTheme().palette.mode === 'dark'
  // Two charts across a full desktop row: each draws in the plot's large box. Through the theme, so
  // inside the desktop side panel this reads as the phone it is laid out as. `noSsr` so the first
  // paint already has the right box, rather than the wide one and then a jump.
  const large = useMediaQuery((t: Theme) => t.breakpoints.up('lg'), { noSsr: true })
  // A club's color is its accent, the hand-picked hue it wears on every board (constants.ts says
  // why none is derived from the primaries). The primaries lifted off the page came out as slate,
  // a gray-blue and a dull red, and New York's dots read as faded rather than as a club.
  const clubColor = useCallback((id: string | null | undefined) => (id && teamById.has(id) ? wpblAccent(id, dark) : undefined), [teamById, dark])
  // THE CLUBS OVERLAY: each club's season on the same axes, drawn over its players. A club's
  // totals come from the box-score lines, which carry the club that game was played for, so a
  // traded player's months count for the club they were played for (summing the players by
  // roster club would not). The lines are the board's heaviest read and the Charts board
  // otherwise never needs them, so they are read only once a reader turns this on.
  const [clubsOn, setClubsOn] = useState(false)
  const [clubLines, setClubLines] = useState(() => getCachedWpblAllLines())
  useEffect(() => {
    if (!clubsOn || clubLines) return
    let cancelled = false
    fetchWpblAllLines().then(l => { if (!cancelled) setClubLines(l) }).catch(() => {})
    return () => { cancelled = true }
  }, [clubsOn, clubLines])
  const clubTotals = useMemo(() => {
    if (!clubsOn || !clubLines) return null
    const bat = cut(clubLines.batting), pit = cut(clubLines.pitching)
    return new Map(teams.map(t => [t.id, {
      batting: sumBatting(bat.filter(l => l.team_id === t.id), games),
      pitching: sumPitching(pit.filter(l => l.team_id === t.id), games),
    }]))
  }, [clubsOn, clubLines, cut, teams, games])
  const teamLink = useWpblTeamLink()
  const clubPointsFor = (spec: ChartSpec): ScatterPoint[] | null => {
    if (!clubTotals || !spec.club) return null
    const out: ScatterPoint[] = []
    for (const t of teams) {
      const totals = clubTotals.get(t.id)
      const at = totals && (totals.batting.ab > 0 || totals.pitching.outs > 0) ? spec.club(totals) : null
      if (!at) continue
      const link = teamLink(t, onOpenTeam ? () => onOpenTeam(t) : undefined) as { href?: string; onClick?: (e: React.MouseEvent) => void }
      const extra = spec.extra ? { name: spec.extra.name, value: spec.extra.value(at.x, at.y) } : null
      out.push({
        id: `club:${t.id}`, x: at.x, y: at.y, weight: 0, badge: t.abbr, label: t.abbr, color: clubColor(t.id),
        ariaLabel: `${wpblFullName(t)}: ${spec.x.name} ${spec.x.fmt(at.x)}, ${spec.y.name} ${spec.y.fmt(at.y)}${extra ? `, ${extra.name} ${extra.value}` : ''}`,
        href: link.href, onOpen: link.onClick,
        tip: (
          <>
            <Typography sx={{ fontWeight: 800, fontSize: TYPE_SCALE.body, lineHeight: 1.25, mb: 0.25 }}>{wpblFullName(t)}</Typography>
            <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
              {spec.x.name} <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{spec.x.fmt(at.x)}</Box>
            </Typography>
            <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
              {spec.y.name} <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{spec.y.fmt(at.y)}</Box>
            </Typography>
            {extra && (
              <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
                {extra.name} <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{extra.value}</Box>
              </Typography>
            )}
          </>
        ),
      })
    }
    return out
  }
  const clubAbbr = useCallback((id: string | null) => (id ? teamById.get(id)?.abbr ?? null : null), [teamById])

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        {qual.active && <FilterChip active={!everyone} onClick={() => setEveryone(e => !e)}>Qualified</FilterChip>}
        {specs.some(sp => sp.club) && <FilterChip active={clubsOn} onClick={() => setClubsOn(c => !c)}>Clubs</FilterChip>}
        {[...teams].sort((a, b) => a.sort_order - b.sort_order).map(t => (
          <FilterChip key={t.id} active={club === t.id} onClick={() => setClub(c => (c === t.id ? null : t.id))}>
            <Box component="span" aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: clubColor(t.id), mr: 0.6, flexShrink: 0 }} />
            <Box component="span" title={wpblFullName(t)}>{t.abbr}</Box>
          </FilterChip>
        ))}
        <Box component="input" type="search" value={query} placeholder="Find player" aria-label="Find player"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          sx={{
            ...filterChipSx(query.trim() !== ''), cursor: 'text', userSelect: 'text', fontFamily: 'inherit', lineHeight: 'inherit',
            fontSize: TYPE_SCALE.meta, fontWeight: 700, width: '9rem', outline: 'none', bgcolor: 'transparent',
            color: 'text.primary', '&::placeholder': { color: 'text.secondary', opacity: 1 },
          }} />
      </Box>
      {/* Two columns on a wide screen even for one chart, so a lone chart is drawn at the size of
          a pair's and not as a 1,000px plot of a dozen dots. */}
      <Box sx={{ display: 'grid', gap: { xs: 3.5, md: 4, lg: 6 }, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
        {specs.map(s => (
          <ChartPanel key={s.key} spec={s} everyone={everyone || !qual.active} onOpenPlayer={onOpenPlayer}
            focus={focus} lit={lit} onLit={setLit} clubOf={clubAbbr} colorOf={clubColor} clubPoints={clubPointsFor(s)} large={large} />
        ))}
      </Box>
    </Box>
  )
}

function ChartPanel({ spec, everyone, onOpenPlayer, focus, lit, onLit, clubOf, colorOf, clubPoints, large }: {
  spec: ChartSpec
  everyone: boolean
  onOpenPlayer: (p: WpblPlayer) => void
  /** The players the reader has narrowed to, or null for everyone. */
  focus: ReadonlySet<string> | null
  lit: string | null
  onLit: (id: string | null) => void
  /** A club's abbreviation and its dot color. The roster club, as on the Players table. */
  clubOf: (teamId: string | null) => string | null
  colorOf: (teamId: string | null) => string | undefined
  /** The clubs, drawn over the players when the overlay is on; null when it is off. */
  clubPoints: ScatterPoint[] | null
  /** Each chart has half a full-width desktop row, so it draws in the plot's large box. */
  large: boolean
}) {
  const playerLink = useWpblPlayerLink()
  const { data } = spec
  const shown = useMemo(() => (data ? data.points.filter(p => everyone || p.qualified) : []), [data, everyone])

  const axes = useMemo(() => {
    if (!data || shown.length === 0) return null
    // Regulars set the axes; a cameo past their spread sits on the edge (axisValues).
    const xs = axisValues(shown.map(p => ({ v: p.x, keep: p.qualified }))), ys = axisValues(shown.map(p => ({ v: p.y, keep: p.qualified })))
    const avg = data.avg
    const dx = spec.shared ? sharedDomain(xs, ys, { floor: spec.x.floor, ceil: spec.x.ceil })
      : niceDomain(xs, { floor: spec.x.floor, ceil: spec.x.ceil, include: avg ? [avg.x] : [] })
    const dy = spec.shared ? dx : niceDomain(ys, { floor: spec.y.floor, ceil: spec.y.ceil, include: avg ? [avg.y] : [] })
    const sx = tickStep(dx), sy = tickStep(dy)
    const x: ScatterAxis = { ...dx, label: spec.x.label, fmt: v => spec.x.tick(v, sx), invert: spec.x.invert }
    const y: ScatterAxis = { ...dy, label: spec.y.label, fmt: v => spec.y.tick(v, sy), invert: spec.y.invert }
    return { x, y, guides: spec.guides(x, y, avg) }
    // spec's functions are rebuilt every render; what they draw depends on these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, shown, spec.key])

  const points = useMemo<ScatterPoint[]>(() => shown.map(p => {
    const link = playerLink(p.player, onOpenPlayer) as { href?: string; onClick?: (e: React.MouseEvent) => void }
    const stages = nameStages(p.player.name)
    const club = clubOf(p.player.team_id)
    const extra = spec.extra ? { name: spec.extra.name, value: spec.extra.value(p.x, p.y) } : null
    return {
      id: p.player.id, x: p.x, y: p.y, weight: p.weight,
      label: stages[stages.length - 1],
      ariaLabel: `${p.player.name}${club ? `, ${club}` : ''}: ${spec.x.name} ${spec.x.fmt(p.x)}, ${spec.y.name} ${spec.y.fmt(p.y)}${extra ? `, ${extra.name} ${extra.value}` : ''}, ${p.sample}`,
      href: link.href,
      onOpen: link.onClick,
      color: colorOf(p.player.team_id),
      muted: focus != null && !focus.has(p.player.id),
      tip: (
        <>
          <Typography sx={{ fontWeight: 800, fontSize: TYPE_SCALE.body, lineHeight: 1.25, mb: 0.25 }}>{p.player.name}</Typography>
          <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
            {spec.x.name} <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{spec.x.fmt(p.x)}</Box>
          </Typography>
          <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
            {spec.y.name} <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{spec.y.fmt(p.y)}</Box>
          </Typography>
          {extra && (
            <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
              {extra.name} <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{extra.value}</Box>
            </Typography>
          )}
          <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{club ? `${club} · ${p.sample}` : p.sample}</Typography>
        </>
      ),
    }
    // spec's formatters are rebuilt every render; they change only with the chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [shown, playerLink, onOpenPlayer, spec.key, focus, clubOf, colorOf])

  // Narrowed to a club or a name, the names go to the players in focus: the notable ones among
  // them first, then the rest by playing time.
  const playerLabels = useMemo(() => {
    if (!data) return undefined
    if (!focus) return data.notable
    const inFocus = shown.filter(p => focus.has(p.player.id)).sort((a, b) => b.weight - a.weight).map(p => p.player.id)
    return [...data.notable.filter(id => focus.has(id)), ...inFocus.filter(id => !data.notable.includes(id))]
  }, [data, focus, shown])
  // With the clubs drawn, the players step back (faded, unnamed) so the four clubs read first.
  const drawn = useMemo(() => (clubPoints?.length
    ? [...points.map(p => ({ ...p, muted: true })), ...clubPoints]
    : points), [points, clubPoints])
  // A club's badge carries its letters on a wide screen; a phone's badge is too small for them,
  // so there the clubs are named beside their dots instead.
  const phone = usePhoneLayout()
  const labeled = clubPoints?.length ? (phone ? clubPoints.map(c => c.id) : []) : playerLabels

  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
        <Typography component="h3" sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, letterSpacing: typePx(-0.2) }}>{spec.title}</Typography>
        <InfoDot label={`About ${spec.title}`} text={spec.info} />
        {/* The size key: a small dot and a big one, and what the size counts. */}
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary', flexShrink: 0 }}>
          <Box component="span" aria-hidden sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: 'currentColor' }} />
          <Box component="span" aria-hidden sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'currentColor' }} />
          <Typography component="span" sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700 }}>Size: {spec.size}</Typography>
        </Box>
      </Box>
      {data == null ? <ScatterFrame large={large} /> : axes == null ? (
        <Box sx={{ position: 'relative' }}>
          <ScatterFrame large={large} />
          <Typography sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', px: 3, textAlign: 'center', fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>
            {spec.empty}
          </Typography>
        </Box>
      ) : (
        <ScatterPlot points={drawn} x={axes.x} y={axes.y} guides={axes.guides}
          labeled={labeled} title={spec.title} onActive={onLit} echo={lit} large={large} />
      )}
    </Box>
  )
}

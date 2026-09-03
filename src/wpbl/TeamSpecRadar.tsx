import { useId, useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { wpblAccent } from './constants'
import { useWpblDark, CARD_BORDER } from './ui'
import {
  TEAM_SPEC_AXES, TEAM_SPEC_MIN_GAMES, formatSpecStat,
  type TeamSpecKey, type TeamSpecs,
} from './derive/teamSpec'
import type { WpblTeam } from './types'

// The spec chart. Six spokes, one polygon per club, drawn as SVG because the repo has no chart
// library and a hexagon does not justify adding one: the whole geometry is `pt()` below.
//
// TWO CALLERS, ONE COMPONENT, AND THE DIFFERENCE IS ONLY WHICH CLUBS ARE SOLID. A club's own
// page draws that club in its colour with the other three as faint outlines, so the shape is
// read against the league rather than in a vacuum. The Teams grid draws all four solid, because
// there is no subject there and the comparison IS the point.
//
// WHY THE POLYGON IS NOT ALSO THE ACCESSIBLE VERSION. A radar is a picture of six numbers, and a
// screen reader gets nothing from a `points` attribute, so the numbers are also rendered as a
// real list beside it on the team page and as an SVG <desc> here. Do not delete the desc to
// tidy the markup: it is the only thing a non-visual reader gets from this file.

/** Where a spoke's end lands. `-PI/2` starts the first axis at twelve o'clock, and the rest run
 *  clockwise, which is the direction a reader expects a spec chart to be labelled in. */
function pt(cx: number, cy: number, r: number, i: number, n: number): [number, number] {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

const polygon = (cx: number, cy: number, R: number, values: number[]): string =>
  values.map((v, i) => pt(cx, cy, (R * v) / 100, i, values.length).map(n => n.toFixed(1)).join(',')).join(' ')

export interface TeamSpecRadarProps {
  specs: TeamSpecs
  teams: WpblTeam[]
  /** The club drawn solid. Null on the Teams grid, where every club is. */
  focusId?: string | null
  /** Ring radius in px. The box adds the label margins below. */
  radius?: number
  showLabels?: boolean
}

/**
 * Room for the labels, and the two are NOT the same number.
 *
 * The four side labels hang outward from a spoke at 60 degrees off vertical, so most of a word
 * sits beyond the ring: "Contact" is about 58px at this size, and a uniform 40px margin cut it
 * to "Conta" on the team page. The top and bottom labels are centred on their spoke and need
 * only their own line height. A single padding wide enough for the sides would waste 40px of
 * vertical on a chart that is already fighting for it, so the box is deliberately not square.
 */
const LABEL_GAP = 14
const HPAD = 62
const VPAD = 26

export function TeamSpecRadar({ specs, teams, focusId = null, radius = 96, showLabels = true }: TeamSpecRadarProps) {
  const isDark = useWpblDark()
  const titleId = useId()
  const n = TEAM_SPEC_AXES.length
  const w = (radius + (showLabels ? HPAD : 8)) * 2
  const h = (radius + (showLabels ? VPAD : 8)) * 2
  const cx = w / 2
  const cy = h / 2

  const byId = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  // Faint first, focus last, so the club whose page this is draws on top of the others rather
  // than under whichever club happens to sort first.
  const ordered = useMemo(() => {
    const rows = specs.rows.filter(r => byId.has(r.teamId))
    return focusId ? [...rows.filter(r => r.teamId !== focusId), ...rows.filter(r => r.teamId === focusId)] : rows
  }, [specs, byId, focusId])

  const grid = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'
  const gridMid = isDark ? 'rgba(255,255,255,0.26)' : 'rgba(0,0,0,0.22)'
  const labelFill = isDark ? 'rgba(255,255,255,0.62)' : 'rgba(0,0,0,0.58)'

  const desc = ordered.map(r => {
    const t = byId.get(r.teamId)!
    return `${t.name}: ${TEAM_SPEC_AXES.map(a => `${a.label} ${r.score[a.key]}`).join(', ')}`
  }).join('. ')

  return (
    <Box
      component="svg"
      role="img"
      aria-labelledby={titleId}
      viewBox={`0 0 ${w} ${h}`}
      sx={{ width: '100%', height: 'auto', display: 'block', maxWidth: w, mx: 'auto' }}
    >
      <title id={titleId}>
        {focusId && byId.get(focusId)
          ? `${byId.get(focusId)!.name} team profile against the league, six traits`
          : 'All four clubs compared on six traits'}
      </title>
      <desc>{desc}</desc>

      {[0.25, 0.5, 0.75, 1].map(f => (
        <polygon
          key={f}
          points={polygon(cx, cy, radius, Array(n).fill(f * 100))}
          fill="none"
          stroke={f === 0.5 ? gridMid : grid}
          strokeWidth={1}
        />
      ))}
      {Array.from({ length: n }, (_, i) => {
        const [x, y] = pt(cx, cy, radius, i, n)
        return <line key={i} x1={cx} y1={cy} x2={x.toFixed(1)} y2={y.toFixed(1)} stroke={grid} strokeWidth={1} />
      })}

      {ordered.map(r => {
        const t = byId.get(r.teamId)!
        const focused = !focusId || r.teamId === focusId
        const colour = wpblAccent(t.id, isDark)
        return (
          <polygon
            key={r.teamId}
            points={polygon(cx, cy, radius, TEAM_SPEC_AXES.map(a => r.score[a.key]))}
            fill={colour}
            fillOpacity={focused ? (focusId ? 0.3 : 0.13) : 0}
            stroke={colour}
            strokeWidth={focused ? 2 : 1}
            // A faint club is an outline only, and dashed as well as pale: on the two clubs
            // whose accents are closest together, opacity alone left the outlines telling the
            // same story, and a colour-blind reader had nothing at all.
            strokeOpacity={focused ? 1 : 0.55}
            strokeDasharray={focused ? undefined : '3 3'}
            strokeLinejoin="round"
          />
        )
      })}

      {showLabels && TEAM_SPEC_AXES.map((a, i) => {
        const [x, y] = pt(cx, cy, radius + LABEL_GAP, i, n)
        // The two spokes on the vertical are centred; the four on the sides hang off their own
        // side, or a long word crosses back over the polygon it is labelling.
        const anchor = Math.abs(x - cx) < 1 ? 'middle' : x > cx ? 'start' : 'end'
        return (
          <text
            key={a.key}
            x={x.toFixed(1)}
            y={(y + 4).toFixed(1)}
            textAnchor={anchor}
            fontSize={12}
            fontWeight={700}
            fill={labelFill}
          >
            {a.label}
          </text>
        )
      })}
    </Box>
  )
}

/** The six numbers as text, beside the chart. Also the whole of what a crawler and a screen
 *  reader get, so it is a real list rather than a second drawing. */
export function TeamSpecReadout({ specs, teamId, kLabel, scaleK }: {
  specs: TeamSpecs
  teamId: string
  /** "K/9" or "K/7", from the reader's basis setting. */
  kLabel: string
  /** Rescales the stored per-9 strikeout rate to that basis. Identity on the default. */
  scaleK: (v: number) => number
}) {
  const row = specs.byTeam.get(teamId)
  if (!row) return null
  const value = (key: TeamSpecKey) => formatSpecStat(key, key === 'arms' ? scaleK(row.raw[key]) : row.raw[key])
  const leagueValue = (key: TeamSpecKey) => formatSpecStat(key, key === 'arms' ? scaleK(specs.league[key]) : specs.league[key])
  return (
    <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'auto 1fr auto', columnGap: 1, rowGap: 0.35, alignItems: 'baseline' }}>
      {TEAM_SPEC_AXES.map(a => (
        <Box key={a.key} sx={{ display: 'contents' }}>
          <Typography component="dt" sx={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: 0.2, color: 'text.secondary' }}>
            {a.label}
          </Typography>
          <Typography component="dd" sx={{ m: 0, fontSize: '0.7rem', color: 'text.disabled' }}>
            {a.key === 'arms' ? kLabel : a.stat}
          </Typography>
          <Typography component="dd" sx={{ m: 0, fontSize: '0.74rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
            {value(a.key)}
            {/* The league number in the same cell, because a rate nobody has a feel for yet
                ("11.1% strikeouts") says nothing without the thing it is being measured
                against, and that comparison is the entire chart. */}
            <Box component="span" sx={{ color: 'text.disabled', fontWeight: 600 }}> / {leagueValue(a.key)}</Box>
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

/**
 * What stands in the space when there is no chart. Says WHY rather than rendering an empty box,
 * which reads as a bug.
 *
 * TWO DIFFERENT NOTHINGS, and collapsing them says something false. `teamSpecs` returns null
 * both when the league has not played enough AND when the box-score lines have not arrived yet,
 * and the first draft printed the games copy for both: on a page whose lines were still in
 * flight it read "appears once every club has played 5 games. The league is on 13", which is a
 * sentence arguing with itself. `ready` is what separates them, and it is the caller's `lines`
 * state rather than anything this component can work out.
 */
export function TeamSpecPlaceholder({ minGames, ready = true }: { minGames: number | null; ready?: boolean }) {
  const waiting = !ready
  return (
    <Box sx={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 0.5, py: 3, px: 2, borderRadius: 2, border: '1px dashed', borderColor: CARD_BORDER,
    }}>
      <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: 'text.secondary' }}>
        Team profile
      </Typography>
      <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', textAlign: 'center' }}>
        {waiting
          ? 'Loading.'
          : minGames == null
            ? `Appears once every club has played ${TEAM_SPEC_MIN_GAMES} games.`
            : `Appears once every club has played ${TEAM_SPEC_MIN_GAMES} games. The league is on ${minGames}.`}
      </Typography>
    </Box>
  )
}

export default TeamSpecRadar

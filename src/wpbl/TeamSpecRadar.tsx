import { useId, useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { wpblAccent } from './constants'
import { useWpblDark, CARD_BORDER } from './ui'
import {
  TEAM_SPEC_AXES, TEAM_SPEC_MIN_GAMES, formatSpecStat, specHighlights, specRank,
  type TeamSpecKey, type TeamSpecs,
} from './derive/teamSpec'
import type { WpblTeam } from './types'

// The spec chart. Six spokes, one polygon per club, drawn as SVG because the repo has no chart
// library and a hexagon does not justify adding one: the whole geometry is `pt()` below.
//
// TWO CALLERS, ONE COMPONENT, AND `focusId` IS THE WHOLE DIFFERENCE. Set, it draws that club
// and only that club: the league context comes from the RINGS, whose midpoint is the league
// average by construction, not from three more polygons. It shipped with the other three as
// faint dashed outlines and they were noise, because a spec chart is read as a silhouette and
// four overlapping ones have no silhouette. Unset, every club is drawn solid, which is the
// Teams grid, where there is no subject and the comparison is the point.
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
  /** The one club to draw. Null on the Teams grid, where every club is drawn. */
  focusId?: string | null
  /** Ring radius in px. The box adds the label margins below. */
  radius?: number
  showLabels?: boolean
  /**
   * The club's own number for each axis, printed under the trait name.
   *
   * This is the phone layout. With the numbers on the spokes the six-row readout beside the
   * chart has nothing left to say that the chart is not already saying, and it comes off: on a
   * 390px screen that table was 121px of the 312px the whole block spent, and the chart it
   * explained was drawing at 210px inside a 358px column. The league value is the one thing
   * lost, and it is not really lost, because the middle ring IS the league average.
   */
  values?: Partial<Record<TeamSpecKey, string>> | null
  /** The axis a reader has tapped, drawn brighter with its spoke picked out. */
  selected?: TeamSpecKey | null
  /** Tapping a label. Tapping the selected one again clears it, so there is always a way back
   *  to the summary without hunting for a close button. */
  onSelect?: (key: TeamSpecKey | null) => void
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
/**
 * Horizontal reserve, PER SIDE, because the six words are not the same length.
 *
 * The right-hand labels are "Contact" and "Eye", the left-hand ones "Glove" and "Arms", and at
 * 12px bold the longest of those is 47px against 35. One HPAD for both therefore left 30px of
 * air on the left and 17 on the right: the hexagon sat at the exact centre of its box while the
 * INK did not, which reads as the chart being off-centre. Reserving each side for its own
 * longest word puts the ink back in the middle. Both are measured with the widest value a
 * number can be ("Steal attempts" is the longest stat name but never renders here; the values
 * are at most six characters and always narrower than the word above them).
 */
const HPAD_L = 50
const HPAD_R = 62
const VPAD = 26

/** Extra room when a label is two lines (trait over value) rather than one. The side labels
 *  gain nothing horizontally, since the value is always narrower than the word above it.
 *
 *  8, not 16, since the blocks were centred: half a line came back the moment the top label
 *  stopped needing a whole one below its anchor, and 16 left 13px of dead margin at each end of
 *  a chart that is already the tallest thing on the phone layout. Measured after the change,
 *  the outermost text clears the box by 5px top and 6px bottom. */
const VALUE_VPAD = 8

/**
 * The distance between the two baselines of a label, and the drop from a point to the baseline
 * of a single line centred on it.
 *
 * These exist because a two-line label has to be CENTRED ON ITS ANCHOR, and the first version
 * was not: both baselines were placed downward from the anchor (`y + 4` and `y + 18`), so every
 * block hung below the point it belonged to. That is invisible with one line and obvious with
 * two, because the anchor itself moves radially: it is above the spoke on the upper axes and
 * below it on the lower ones, so a block growing downward lands centred on Contact and Glove
 * and 13.5px too low on Eye and Arms. Measured on a phone, block centre against spoke end:
 * Power 14.5 above, Contact 0.5 above, Eye 13.5 BELOW, Speed 27.5 below, with 13px of air
 * above the top label and 0 below the bottom one. A vertical `shift` on the top and bottom
 * labels was papering over the same thing from the other end and is gone.
 */
const LINE = 14
const CAP = 4

/** A tap target around each label. 44px is the smallest thing a thumb reliably hits, and the
 *  words themselves are 34 to 58px wide by 14 tall, so the box has to be drawn rather than
 *  inherited from the text. Transparent, and only present when there is a handler. */
const HIT_W = 76
const HIT_H = 44

export function TeamSpecRadar({
  specs, teams, focusId = null, radius = 96, showLabels = true,
  values = null, selected = null, onSelect,
}: TeamSpecRadarProps) {
  const isDark = useWpblDark()
  const titleId = useId()
  const n = TEAM_SPEC_AXES.length
  const padL = showLabels ? HPAD_L : 8
  const padR = showLabels ? HPAD_R : 8
  const w = radius * 2 + padL + padR
  const h = (radius + (showLabels ? VPAD + (values ? VALUE_VPAD : 0) : 8)) * 2
  // NOT w / 2: the two reserves differ, so the ring's centre is offset from the box's.
  const cx = radius + padL
  const cy = h / 2

  const byId = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const ordered = useMemo(() => {
    const rows = specs.rows.filter(r => byId.has(r.teamId))
    return focusId ? rows.filter(r => r.teamId === focusId) : rows
  }, [specs, byId, focusId])

  const grid = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'
  const gridMid = isDark ? 'rgba(255,255,255,0.26)' : 'rgba(0,0,0,0.22)'
  const labelFill = isDark ? 'rgba(255,255,255,0.62)' : 'rgba(0,0,0,0.58)'
  // The number is the thing being read, so it gets full-strength ink while the trait name
  // beside it stays secondary. Both drop to the club's colour on the tapped axis.
  const valueFill = isDark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.88)'
  const focusColour = focusId && byId.has(focusId) ? wpblAccent(focusId, isDark) : null

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
          ? `${byId.get(focusId)!.name} team profile against the league average, six traits`
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
        const on = selected === TEAM_SPEC_AXES[i].key
        return (
          <line key={i} x1={cx} y1={cy} x2={x.toFixed(1)} y2={y.toFixed(1)}
            stroke={on ? gridMid : grid} strokeWidth={on ? 2 : 1} />
        )
      })}

      {ordered.map(r => {
        const t = byId.get(r.teamId)!
        const colour = wpblAccent(t.id, isDark)
        return (
          <polygon
            key={r.teamId}
            points={polygon(cx, cy, radius, TEAM_SPEC_AXES.map(a => r.score[a.key]))}
            fill={colour}
            // A single club can afford a solid-looking fill. Four overlapping ones cannot: at
            // anything above about 0.15 the middle of the Teams chart turns to mud and the
            // outlines stop being readable through it.
            fillOpacity={focusId ? 0.3 : 0.13}
            stroke={colour}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        )
      })}

      {showLabels && TEAM_SPEC_AXES.map((a, i) => {
        const [x, y] = pt(cx, cy, radius + LABEL_GAP, i, n)
        // The two spokes on the vertical are centred; the four on the sides hang off their own
        // side, or a long word crosses back over the polygon it is labelling.
        const anchor = Math.abs(x - cx) < 1 ? 'middle' : x > cx ? 'start' : 'end'
        const on = selected === a.key
        // Centred on the anchor, so a two-line block reaches as far above the point as below it
        // and every label sits the same way round its own spoke. See LINE / CAP.
        const stacked = values?.[a.key] != null
        const first = y + CAP - (stacked ? LINE / 2 : 0)
        const label = (
          <>
            <text x={x.toFixed(1)} y={first.toFixed(1)} textAnchor={anchor}
              fontSize={12} fontWeight={700} fill={on ? focusColour ?? labelFill : labelFill}>
              {a.label}
            </text>
            {stacked && (
              <text x={x.toFixed(1)} y={(first + LINE).toFixed(1)} textAnchor={anchor}
                fontSize={12.5} fontWeight={800} fill={on ? focusColour ?? valueFill : valueFill}
                style={{ fontVariantNumeric: 'tabular-nums' }}>
                {values![a.key]}
              </text>
            )}
          </>
        )
        if (!onSelect) return <g key={a.key}>{label}</g>
        return (
          <g key={a.key} role="button" tabIndex={0}
            aria-pressed={on}
            aria-label={`${a.label}, ${a.stat}${values?.[a.key] ? ` ${values[a.key]}` : ''}`}
            style={{ cursor: 'pointer' }}
            onClick={() => onSelect(on ? null : a.key)}
            onKeyDown={e => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              onSelect(on ? null : a.key)
            }}>
            {/* The thumb target. The words are 34 to 58px wide and 14 tall, which is well under
                the 44px a finger reliably lands on, so the box is drawn rather than inherited
                from the text. Transparent, and never in the way when nothing can be tapped. */}
            <rect
              x={(anchor === 'start' ? x - 8 : anchor === 'end' ? x - HIT_W + 8 : x - HIT_W / 2).toFixed(1)}
              y={(y - HIT_H / 2).toFixed(1)}
              width={HIT_W} height={HIT_H} fill="transparent"
            />
            {label}
          </g>
        )
      })}
    </Box>
  )
}

const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th', '6th']

/**
 * The one line under the chart on a phone, which is what the six-row readout becomes there.
 *
 * TWO STATES, AND THE DEFAULT ONE IS THE POINT. Untapped it names the club's strongest and
 * weakest trait, which is the silhouette said out loud: a reader who does not parse charts gets
 * the same answer the shape gives, in 32px instead of the readout's 121. Tapped, it becomes the
 * detail that used to sit in the readout's middle column permanently: the stat behind the axis,
 * the league average, and where the club ranks.
 *
 * The rank is here rather than in the chart because it is the figure a fan actually says. "1st
 * of 4" travels; an ISO of .192 means nothing yet in a league playing its first season.
 */
export function TeamSpecDetail({ specs, teamId, selected, kLabel, scaleK, onClear }: {
  specs: TeamSpecs
  teamId: string
  selected: TeamSpecKey | null
  kLabel: string
  scaleK: (v: number) => number
  onClear: () => void
}) {
  const isDark = useWpblDark()
  const row = specs.byTeam.get(teamId)
  if (!row) return null
  const accent = wpblAccent(teamId, isDark)
  const shell = {
    px: 1.25, py: 0.9, borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER,
    display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 0.75, minHeight: 34,
  } as const

  if (selected) {
    const ax = TEAM_SPEC_AXES.find(a => a.key === selected)!
    const shown = (v: number) => formatSpecStat(selected, selected === 'arms' ? scaleK(v) : v)
    const rank = specRank(specs, teamId, selected)
    return (
      <Box sx={{ ...shell, cursor: 'pointer' }} onClick={onClear} role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClear() } }}>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: accent }}>{ax.label}</Typography>
        <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>
          {selected === 'arms' ? kLabel : ax.stat}
        </Typography>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {shown(row.raw[selected])}
        </Typography>
        <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', fontVariantNumeric: 'tabular-nums' }}>
          League {shown(specs.league[selected])}
        </Typography>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'text.secondary', ml: 'auto', fontVariantNumeric: 'tabular-nums' }}>
          {ORDINAL[rank] ?? rank} of {specs.rows.length}
        </Typography>
      </Box>
    )
  }

  const high = specHighlights(specs, teamId)
  return (
    <Box sx={shell}>
      {high ? (
        <>
          <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>Best</Typography>
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: accent }}>{high.best.label}</Typography>
          <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', ml: 0.5 }}>Weakest</Typography>
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: 'text.secondary' }}>{high.worst.label}</Typography>
        </>
      ) : (
        <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>Even across all six.</Typography>
      )}
      {/* Says the chart is tappable, which nothing else on it does. Drops away the moment a
          reader has tapped once, because by then they know. */}
      <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', ml: 'auto' }}>Tap a trait</Typography>
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

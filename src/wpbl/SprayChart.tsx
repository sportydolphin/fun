import { useMemo, useState } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import {
  sprayProfile, pullProfile, OUTFIELD_ZONES, INFIELD_ZONES,
} from './derive/spray'
import type { SprayZone, ZoneTally } from './derive/spray'
import type { WpblSprayPlay } from './types'
import { TYPE_SCALE } from './ui'

// ─── Spray chart ──────────────────────────────────────────────────────────────
//
// WHERE A HITTER PUTS THE BALL, out of the only thing the feed publishes about it: the
// scorer's English. There is no coordinate anywhere in the league's data (see derive/spray.ts),
// so this is ELEVEN ZONES AND NOT A SCATTER PLOT, and it is drawn as eleven shaded regions
// precisely so that nobody reads a position out of it that the league never recorded.
//
// THE TEMPTATION IS TO SCATTER DOTS INSIDE THE WEDGES and it has to be refused. Jittered
// points inside a zone look like the chart everyone has seen on a major-league site, and every
// one of those dots would be a coordinate we invented. When RetroWPBL's hit locations land,
// the zones stay correct and gain real points inside them; a chart that had been faking it
// until then would have no way to tell a reader which season was which.
//
// The count that could not be placed is on the card, not hidden. It is 1% of the season's
// batted balls, and a chart that quietly drops what it cannot read claims a completeness it
// does not have.

// THE VIEWBOX HAS TO HOLD THE FOUL LINES, which is not obvious and was wrong first time. A
// 90-degree fan of radius r is r*sin(45) = 0.707r wide EITHER SIDE of home plate, so a 300
// radius on a 400-wide box put both corners about 12px outside it and the two zones that
// matter most to a pull hitter were clipped off. The box is wider than it is tall for the
// same reason, and R_OUT plus the label ring has to fit inside half of it.
const VW = 440, VH = 424
const CX = 220, CY = 366      // home plate
const BASE = 100              // home to first, along the foul line
const R_DIRT = 170            // the edge of the infield dirt
const R_IN = 174, R_OUT = 288 // the outfield band
const R_LABEL = R_OUT + 13    // the zone names, just outside the fence
const SPAN = 45               // foul line to foul line, degrees either side of straight away

/** Screen point for a polar coordinate measured from home plate, 0 = straight to centre. */
function polar(r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180
  return [CX + r * Math.sin(rad), CY - r * Math.cos(rad)]
}

/** An annulus sector: the shape of one outfield zone. */
function wedgePath(a1: number, a2: number, r0 = R_IN, r1 = R_OUT): string {
  const [x1, y1] = polar(r1, a1), [x2, y2] = polar(r1, a2)
  const [x3, y3] = polar(r0, a2), [x4, y4] = polar(r0, a1)
  return `M${x1} ${y1} A${r1} ${r1} 0 0 1 ${x2} ${y2} L${x3} ${y3} A${r0} ${r0} 0 0 0 ${x4} ${y4} Z`
}

// Five equal wedges across the fair 90 degrees, and six fielders where they stand. The infield
// spots are positions rather than areas, so they are drawn as discs: a wedge would imply the
// second baseman covers a slice of the outfield behind her.
const OUTFIELD_WEDGE: Record<string, [number, number]> = {
  LF:  [-SPAN, -27], LCF: [-27, -9], CF: [-9, 9], RCF: [9, 27], RF: [27, SPAN],
}
/**
 * Where each fielder stands, as [radius, degrees] from home plate.
 *
 * THE CATCHER IS BEHIND THE PLATE, which is a NEGATIVE radius: off the bottom of the fan
 * rather than inside it. She takes 23 balls in a season and nearly every one is a foul pop, so
 * putting her among the infielders would draw all of them in fair territory.
 */
const INFIELD_SPOT: Record<string, [number, number]> = {
  '3B': [120, -37], SS: [152, -20], P: [68, 0], '2B': [152, 20], '1B': [120, 37],
  C: [-27, 0],
}

/** First, second, third. Home is added by the caller, since it is also the apex of the fan. */
const BASES: ReadonlyArray<[number, number]> = [
  [BASE, 45], [BASE * Math.SQRT2, 0], [BASE, -45],
]

type Mode = 'all' | 'hits' | 'outs'
const MODES: ReadonlyArray<[Mode, string]> = [['all', 'All'], ['hits', 'Hits'], ['outs', 'Outs']]

const valueOf = (t: ZoneTally | undefined, mode: Mode): number =>
  !t ? 0 : mode === 'hits' ? t.hits : mode === 'outs' ? t.outs : t.total

export default function SprayChart({ plays, bats, maxWidth = 460 }: {
  plays: readonly WpblSprayPlay[]
  /** From the roster. Null or 'S' means no pull rate is claimed; see spraySide. */
  bats?: string | null
  /** SIZED BY WIDTH, NOT HEIGHT. A fixed height letterboxes the fan inside a wide column:
   *  the box is 420x380, so at height 320 it drew 353px wide in a 700px card and left most of
   *  the space empty. Width-first fills the column it is given, scales down on a phone for
   *  free, and the cap stops it becoming a poster on a desktop. */
  maxWidth?: number
}) {
  const [mode, setMode] = useState<Mode>('all')
  const theme = useTheme()

  const profile = useMemo(() => sprayProfile(plays), [plays])
  const pull = useMemo(() => pullProfile(plays, bats), [plays, bats])

  const byZone = useMemo(() => {
    const m = new Map<SprayZone, ZoneTally>()
    for (const z of profile.zones) m.set(z.zone, z)
    return m
  }, [profile])

  const max = useMemo(
    () => Math.max(1, ...profile.zones.map(z => valueOf(z, mode))),
    [profile, mode])

  if (profile.placed === 0) {
    return (
      <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.disabled' }}>
        No batted balls with a direction yet.
      </Typography>
    )
  }

  // Opacity, floored so a zone with one ball in it is still visibly different from an empty
  // one. Linear in share of the busiest zone: this is a count, not a rate, and a perceptual
  // curve here would make a hot zone look hotter than it is.
  const shade = (n: number) => (n === 0 ? 0 : 0.18 + 0.72 * (n / max))

  // THE NUMBER HAS TO BEAT ITS OWN BACKGROUND, and in the first version it did not: the count
  // and the zone under it were both `currentColor`, so a zone's figure faded out exactly as
  // that zone got busier and the hottest cell on the chart (17 balls to left field) was the
  // least readable thing on it. The fill is the heat and the number is the fact; they cannot
  // be the same ink. Past roughly half opacity the accent is dark enough in either theme that
  // white is the only readable choice, and below it the card's own text colour is.
  const inkFor = (n: number) => (shade(n) >= 0.5 ? '#fff' : theme.palette.text.primary)

  const line = theme.palette.divider
  const dirt = theme.palette.text.disabled
  const [lfx, lfy] = polar(R_OUT, -SPAN)
  const [rfx, rfy] = polar(R_OUT, SPAN)

  const label = (zone: SprayZone, x: number, y: number) => {
    const n = valueOf(byZone.get(zone), mode)
    if (!n) return null
    return (
      <text key={`t-${zone}`} x={x} y={y} textAnchor="middle" dominantBaseline="central"
        fontSize={15} fontWeight={800} fill={inkFor(n)}>{n}</text>
    )
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 0.5, mb: 1 }}>
        {MODES.map(([m, text]) => (
          <Box key={m} onClick={() => setMode(m)} role="button" tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMode(m) } }}
            sx={{
              px: 1.1, py: 0.35, borderRadius: 999, cursor: 'pointer',
              border: '1px solid', borderColor: mode === m ? 'transparent' : 'divider',
              bgcolor: mode === m ? 'text.primary' : 'transparent',
            }}>
            <Typography sx={{
              fontSize: TYPE_SCALE.caption, fontWeight: 800,
              color: mode === m ? 'background.paper' : 'text.secondary',
            }}>{text}</Typography>
          </Box>
        ))}
      </Box>

      <Box
        component="svg" viewBox={`0 0 ${VW} ${VH}`}
        role="img"
        aria-label={
          `Where this batter put the ball: ${profile.zones
            .map(z => `${valueOf(z, mode)} to ${z.zone}`).join(', ')}.`}
        sx={{
          width: '100%', maxWidth, height: 'auto', display: 'block', mx: 'auto',
          color: 'var(--wpbl-accent-solid, #2563eb)',
        }}
      >
        {/* THE FIELD, DRAWN BEFORE THE DATA. The first version had none of this and the six
            infield positions were discs floating on nothing, which read as abstract blobs
            rather than as fielders. A position is only legible against the field it stands
            on, so: grass, dirt, foul lines, fence, then the diamond and its bases. */}
        <path d={wedgePath(-SPAN, SPAN, 0, R_OUT)} fill="currentColor" opacity={0.045} />
        <path d={wedgePath(-SPAN, SPAN, 0, R_DIRT)} fill={dirt} opacity={0.1} />

        <line x1={CX} y1={CY} x2={lfx} y2={lfy} stroke={line} strokeWidth={1.5} />
        <line x1={CX} y1={CY} x2={rfx} y2={rfy} stroke={line} strokeWidth={1.5} />
        <path d={wedgePath(-SPAN, SPAN, R_OUT - 1, R_OUT)} fill={line} />

        <path
          d={`M${CX} ${CY} ${BASES.map(([r, a]) => { const [x, y] = polar(r, a); return `L${x} ${y}` }).join(' ')} Z`}
          fill="none" stroke={line} strokeWidth={1.5} />
        {([[0, 0], ...BASES] as ReadonlyArray<[number, number]>).map(([r, a], i) => {
          const [x, y] = polar(r, a)
          return <rect key={i} x={x - 4} y={y - 4} width={8} height={8} fill={line}
            transform={`rotate(45 ${x} ${y})`} />
        })}

        {OUTFIELD_ZONES.map(z => {
          const [a1, a2] = OUTFIELD_WEDGE[z]
          return (
            <path key={z} d={wedgePath(a1, a2)} fill="currentColor"
              opacity={shade(valueOf(byZone.get(z), mode))}
              stroke={line} strokeWidth={0.75} />
          )
        })}

        {INFIELD_ZONES.map(z => {
          const [r, a] = INFIELD_SPOT[z]
          const [x, y] = polar(r, a)
          const n = valueOf(byZone.get(z), mode)
          return (
            <g key={z}>
              {/* An opaque disc under the shade, so a fielder reads the same against dirt as
                  against grass and an empty position is a visible zero rather than a hole. */}
              <circle cx={x} cy={y} r={20} fill={theme.palette.background.paper} opacity={0.92} />
              <circle cx={x} cy={y} r={20} fill="currentColor" opacity={shade(n)}
                stroke={line} strokeWidth={1} />
              {n === 0 && (
                <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
                  fontSize={9} fontWeight={700} fill={dirt}>{z}</text>
              )}
            </g>
          )
        })}

        {/* Counts on top of everything, so a dark zone does not swallow its own number. */}
        <g>
          {OUTFIELD_ZONES.map(z => {
            const [a1, a2] = OUTFIELD_WEDGE[z]
            const [x, y] = polar((R_IN + R_OUT) / 2, (a1 + a2) / 2)
            return label(z, x, y)
          })}
          {INFIELD_ZONES.map(z => {
            const [r, a] = INFIELD_SPOT[z]
            const [x, y] = polar(r, a)
            return label(z, x, y)
          })}
        </g>

        {/* Zone names, small, outside the band, so the picture can be read without a legend. */}
        {OUTFIELD_ZONES.map(z => {
          const [a1, a2] = OUTFIELD_WEDGE[z]
          const [x, y] = polar(R_LABEL, (a1 + a2) / 2)
          return (
            <text key={`n-${z}`} x={x} y={y} textAnchor="middle" dominantBaseline="central"
              fontSize={11} fontWeight={800} fill={theme.palette.text.secondary}>{z}</text>
          )
        })}
      </Box>

      <Box sx={{ mt: 0.75, display: 'flex', flexWrap: 'wrap', gap: 1.25 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.secondary' }}>
          {profile.hits} {profile.hits === 1 ? 'hit' : 'hits'} · {profile.outs} in play {profile.outs === 1 ? 'out' : 'outs'}
        </Typography>
        {pull.pullPct != null && (
          <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.secondary' }}>
            {Math.round(pull.pullPct)}% pull · {Math.round((pull.oppo / pull.total) * 100)}% oppo
          </Typography>
        )}
      </Box>

      {/* SAID OUT LOUD, NEVER HIDDEN. These are zones read out of the scorer's words, not
          measured locations, and the balls whose wording named no direction are counted here
          rather than quietly left out of the picture. */}
      <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.disabled', mt: 0.5, lineHeight: 1.5 }}>
        Zones, not coordinates: the league publishes no hit locations, so these are read from
        each play's description.
        {profile.unplaced > 0 && ` ${profile.unplaced} batted ${profile.unplaced === 1 ? 'ball' : 'balls'} named no direction and ${profile.unplaced === 1 ? 'is' : 'are'} not drawn.`}
        {pull.pullPct == null && pull.total === 0 && profile.placed > 0
          && ' No pull rate: the feed records a switch hitter only on the roster, never per plate appearance.'}
      </Typography>
    </Box>
  )
}

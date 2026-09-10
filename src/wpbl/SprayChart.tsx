import { useMemo, useState } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import { sprayProfile, pullProfile, OUTFIELD_ZONES } from './derive/spray'
import type { SprayZone, ZoneTally } from './derive/spray'
import type { WpblSprayPlay } from './types'
import { TYPE_SCALE, chromePx } from './ui'

// ─── Spray chart ──────────────────────────────────────────────────────────────
//
// WHERE A HITTER PUTS THE BALL, out of the only thing the feed publishes about it: the
// scorer's English. There is no coordinate anywhere in the league's data (see derive/spray.ts),
// so this is ELEVEN ZONES AND NOT A SCATTER PLOT, and it is drawn as eleven shaded regions
// precisely so that nobody reads a position out of it that the league never recorded.
//
// THE TEMPTATION IS TO SCATTER DOTS INSIDE THE ZONES and it has to be refused. Jittered points
// look like the chart everyone has seen on a major-league site and every one of them would be
// a coordinate we invented. When RetroWPBL's hit locations land, these zones stay correct and
// gain real points inside them; a chart that had been faking it until then would have no way
// to tell a reader which season was which.
//
// THE ZONES TILE THE WHOLE FIELD, which is the third arrangement of this and the first that
// reads as a spray chart. It went: discs floating on an empty fan, then discs on a drawn
// field, and both had the same flaw underneath, which is that A POSITION IS NOT A REGION. A
// ball is hit somewhere, every somewhere on this field belongs to exactly one zone, and the
// picture should therefore have no gaps in it: the pitcher's circle at the apex, four infield
// wedges across the dirt, five outfield wedges beyond it, and the catcher behind the plate in
// the one piece of foul ground a batted ball routinely lands in.
//
// TWO EARLIER MISTAKES ARE KEPT IN THE COMMENTS BELOW, because both are easy to make again:
// painting a count in the same ink as the zone under it, and drawing fielders with no field.

// Geometry. The fan is 90 degrees, so a radius r is r*sin(45) = 0.707r wide EITHER SIDE of
// home plate: the box has to be wider than it is tall, and R_OUT plus the label ring has to
// fit inside half its width or the corner zones clip.
const VW = 440, VH = 430
const CX = 220, CY = 360        // home plate
const BASE = 100                // home to first, along the foul line
const R_MOUND = 64              // the pitcher's circle
const R_DIRT = 168              // the edge of the infield dirt
const R_OUT = 286               // the fence
const R_BACKSTOP = 48           // how far behind the plate the catcher's ground reaches
const R_LABEL = R_OUT + 13
const SPAN = 45                 // foul line to foul line, degrees either side of straight away

/** Screen point for a polar coordinate measured from home plate, 0 = straight to centre. */
function polar(r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180
  return [CX + r * Math.sin(rad), CY - r * Math.cos(rad)]
}

/**
 * An annulus sector, or a pie slice when the inner radius is zero.
 *
 * The zero case is not decoration: the pitcher's circle and the catcher's ground both start at
 * home plate, and an arc of radius 0 draws nothing, so they need the apex as a point instead.
 */
function sector(a1: number, a2: number, r0: number, r1: number): string {
  const [x1, y1] = polar(r1, a1), [x2, y2] = polar(r1, a2)
  const outer = `A${r1} ${r1} 0 0 1 ${x2} ${y2}`
  if (r0 <= 0) return `M${CX} ${CY} L${x1} ${y1} ${outer} Z`
  const [x3, y3] = polar(r0, a2), [x4, y4] = polar(r0, a1)
  return `M${x1} ${y1} ${outer} L${x3} ${y3} A${r0} ${r0} 0 0 0 ${x4} ${y4} Z`
}

/**
 * Every zone's shape, as [from, to, innerRadius, outerRadius] in degrees and pixels.
 *
 * THE INFIELD IS FOUR WEDGES AND THE OUTFIELD IS FIVE, and the boundaries deliberately do not
 * line up. Four fielders stand across the dirt, while the scorer describes the outfield in
 * fifths ("left", "left centre", "centre"...), so forcing one onto the other would either
 * invent a fifth infielder or throw away the centre-field splits the narrative actually makes.
 * Two rings divided differently is how a real spray chart reads anyway.
 *
 * THE CATCHER IS BEHIND THE PLATE, in foul ground, which is the one region here outside the
 * fair 90 degrees. Her 23 balls in a season are almost all foul pops, and putting her among
 * the infielders, as the first two versions did, drew every one of them in fair territory.
 */
const ZONE_SHAPE: Record<SprayZone, [number, number, number, number]> = {
  LF:   [-SPAN, -27, R_DIRT, R_OUT],
  LCF:  [-27, -9, R_DIRT, R_OUT],
  CF:   [-9, 9, R_DIRT, R_OUT],
  RCF:  [9, 27, R_DIRT, R_OUT],
  RF:   [27, SPAN, R_DIRT, R_OUT],
  '3B': [-SPAN, -22.5, R_MOUND, R_DIRT],
  SS:   [-22.5, 0, R_MOUND, R_DIRT],
  '2B': [0, 22.5, R_MOUND, R_DIRT],
  '1B': [22.5, SPAN, R_MOUND, R_DIRT],
  P:    [-SPAN, SPAN, 0, R_MOUND],
  C:    [135, 225, 0, R_BACKSTOP],
}

const ALL_ZONES = Object.keys(ZONE_SHAPE) as SprayZone[]

/** The infield names go inside their own wedge; the outfield's sit outside the fence. */
const NAMED_INSIDE: readonly SprayZone[] = ['3B', 'SS', '2B', '1B', 'P', 'C']

/** Where a zone's figure sits: the middle of its arc, at the middle of its band. */
function centreOf(zone: SprayZone): [number, number] {
  const [a1, a2, r0, r1] = ZONE_SHAPE[zone]
  // FURTHER OUT IN THE INFIELD THAN THE MIDDLE OF ITS BAND. A wedge gets wider the further
  // from home it goes, and at the midpoint a 22.5-degree infield slice is about 45px across,
  // which is not enough to hold a position name over a two-digit count. At 0.62 it is 55px.
  const t = r0 === 0 ? 0.55 : (r1 === R_DIRT ? 0.62 : 0.5)
  return polar(r0 + (r1 - r0) * t, (a1 + a2) / 2)
}

/** First, second, third. Home is the apex of the fan and is added by the caller. */
const BASES: ReadonlyArray<[number, number]> = [
  [BASE, 45], [BASE * Math.SQRT2, 0], [BASE, -45],
]

type Mode = 'all' | 'hits' | 'outs'
const MODES: ReadonlyArray<[Mode, string]> = [['all', 'All'], ['hits', 'Hits'], ['outs', 'Outs']]

const valueOf = (t: ZoneTally | undefined, mode: Mode): number =>
  !t ? 0 : mode === 'hits' ? t.hits : mode === 'outs' ? t.outs : t.total

export default function SprayChart({ plays, bats, maxWidth = 520 }: {
  plays: readonly WpblSprayPlay[]
  /** From the roster. Null or 'S' means no pull rate is claimed; see spraySide. */
  bats?: string | null
  /** SIZED BY WIDTH, NOT HEIGHT. A fixed height letterboxes the fan inside a wide column and
   *  leaves most of the card empty; width-first fills the column and scales down on a phone. */
  maxWidth?: number
}) {
  const [mode, setMode] = useState<Mode>('all')
  const theme = useTheme()

  const profile = useMemo(() => sprayProfile(plays), [plays])
  /**
   * The plays the chart is currently showing, which is what the pull rate has to be measured
   * over too.
   *
   * It was measured over ALL batted balls regardless of the mode, so on Hits the three figures
   * at the top of the breakdown described a different set of balls from the list directly
   * beneath them: a hitter reading 56% pull over a list whose zones sum to a different split.
   * Two numbers on one card that disagree about the same question.
   */
  const modePlays = useMemo(
    () => (mode === 'all' ? plays : plays.filter(p => !!p.is_hit === (mode === 'hits'))),
    [plays, mode])
  const pull = useMemo(() => pullProfile(modePlays, bats), [modePlays, bats])

  const byZone = useMemo(() => {
    const m = new Map<SprayZone, ZoneTally>()
    for (const z of profile.zones) m.set(z.zone, z)
    return m
  }, [profile])

  const max = useMemo(
    () => Math.max(1, ...profile.zones.map(z => valueOf(z, mode))),
    [profile, mode])

  // THE DENOMINATOR IS THE ZONES, NOT THE PROFILE'S TOTALS. `profile.hits` counts every hit
  // including the ones whose wording named no direction, so dividing by it would leave the
  // shares adding up to less than 100 and quietly blame the difference on the zones.
  const placedInMode = useMemo(
    () => profile.zones.reduce((n, z) => n + valueOf(z, mode), 0),
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
  // that zone got busier and the hottest cell on the chart was the least readable thing on it.
  // The fill is the heat and the number is the fact; they cannot be the same ink.
  //
  // THE THRESHOLD IS CALIBRATED FOR LIGHT MODE AND ONLY LIGHT MODE, which is why one constant
  // does for both. In dark mode `text.primary` is already near-white, so both branches return
  // a light ink and where the line sits changes nothing. In light mode it is near-black, and
  // the crossover is the only thing standing between a mid-red zone and an unreadable figure:
  // at 0.5 the middle of the scale printed white on medium red, which is the worst pairing on
  // the card.
  const inkFor = (n: number) => (shade(n) >= 0.62 ? '#fff' : theme.palette.text.primary)

  /**
   * A zone's share of the balls on screen.
   *
   * ROUNDED, BUT NEVER TO ZERO. A single ball in a season is 2% of a busy hitter's chart and
   * about 0.7% of the league's, and printing "0%" over a zone that visibly has something in it
   * reads as a bug rather than as a small number.
   */
  const pct = (n: number): string => {
    if (!placedInMode) return ''
    const p = (n / placedInMode) * 100
    return p < 1 ? '<1%' : `${Math.round(p)}%`
  }

  /**
   * The heat colour, and it is deliberately NOT the section accent.
   *
   * Every other chart in this section is drawn in the WPBL blue, which is exactly the problem:
   * on a player page the accent is already carrying the club, the header band and half the
   * furniture, so a blue field read as more chrome. Red is the convention for a spray chart
   * anyway, and it is the only warm thing on the page, which is what makes the busy zones the
   * first thing the eye lands on.
   *
   * Two of them, because one red cannot serve both themes: the darker one holds up against
   * white, the brighter one against a near-black card.
   */
  const heat = theme.palette.mode === 'dark' ? '#ef4444' : '#d92020'

  const line = theme.palette.divider
  const faint = theme.palette.text.disabled
  const [lfx, lfy] = polar(R_OUT, -SPAN)
  const [rfx, rfy] = polar(R_OUT, SPAN)

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

      {/* THE PICTURE AND THE NUMBERS, SIDE BY SIDE ON A DESKTOP.
          
          The chart was capped at 460px and centred inside a 1,080px card, so most of the block
          was empty and the only place to read a small zone was the 11px label inside it. A
          list beside it fixes both at once: the space is used, and every zone has a figure in
          ordinary type that does not depend on the wedge being big enough to hold one.
          
          It stacks below `md`, where the card is a sheet and there is no width to share. */}
      <Box sx={{
        display: 'flex', flexDirection: { xs: 'column', md: 'row' },
        alignItems: { md: 'center' }, gap: { xs: 1, md: 2.5 },
      }}>
      <Box
        component="svg" viewBox={`0 0 ${VW} ${VH}`}
        role="img"
        aria-label={`Where this batter put the ball: ${profile.zones
          .map(z => `${valueOf(z, mode)} to ${z.zone}`).join(', ')}.`}
        /* Counts, not shares: the figure on screen is a percentage, but the underlying record
           is the number of balls and that is what a reader listening to this wants. */
        sx={{
          width: '100%', maxWidth, height: 'auto', display: 'block', mx: 'auto',
          flex: { md: '1 1 auto' }, minWidth: 0,
          color: heat,
        }}
      >
        {/* The dirt, UNDER the zones rather than over them, so an empty infield still reads as
            an infield instead of as a hole in the fan. */}
        <path d={sector(-SPAN, SPAN, 0, R_DIRT)} fill={faint} opacity={0.12} />
        {/* The catcher's ground gets the same treatment, or the one zone outside fair
            territory is the one blank thing on a chart that otherwise tiles the field. */}
        <path d={sector(135, 225, 0, R_BACKSTOP)} fill={faint} opacity={0.12} />

        <path
          d={`M${CX} ${CY} ${BASES.map(([r, a]) => { const [x, y] = polar(r, a); return `L${x} ${y}` }).join(' ')} Z`}
          fill="none" stroke={line} strokeWidth={1.5} />
        {([[0, 0], ...BASES] as ReadonlyArray<[number, number]>).map(([r, a], i) => {
          const [x, y] = polar(r, a)
          return <rect key={i} x={x - 4} y={y - 4} width={8} height={8} fill={line}
            transform={`rotate(45 ${x} ${y})`} />
        })}

        {/* EVERY ZONE, TILING THE WHOLE FIELD. An empty one is drawn at zero opacity over the
            ground beneath it, which is why nothing here is ever blank. */}
        {ALL_ZONES.map(z => {
          const [a1, a2, r0, r1] = ZONE_SHAPE[z]
          return (
            <path key={z} d={sector(a1, a2, r0, r1)} fill="currentColor"
              opacity={shade(valueOf(byZone.get(z), mode))}
              stroke={line} strokeWidth={0.75} />
          )
        })}

        {/* THE OUTLINE OF THE FIELD ON TOP, THE DIAMOND UNDERNEATH. The diamond crosses the
            infield band at exactly the radius the figures live at, so drawn over the shading
            it ran a line through every infield label. Beneath them it still says "this is a
            ballfield" wherever the shading is light, and gets out of the way where it is not.
            The foul lines, the fence and the dirt's edge stay on top: those are the outline,
            and an outline a busy zone can swallow is not one. */}
        <line x1={CX} y1={CY} x2={lfx} y2={lfy} stroke={line} strokeWidth={1.5} />
        <line x1={CX} y1={CY} x2={rfx} y2={rfy} stroke={line} strokeWidth={1.5} />
        <path d={sector(-SPAN, SPAN, R_OUT - 1.5, R_OUT)} fill={line} />
        <path d={sector(-SPAN, SPAN, R_DIRT - 1, R_DIRT)} fill={line} opacity={0.7} />

        {/* Figures last, so nothing can be painted over a number. */}
        {ALL_ZONES.map(z => {
          const n = valueOf(byZone.get(z), mode)
          const [x, y] = centreOf(z)
          const named = NAMED_INSIDE.includes(z)
          // AN EMPTY POSITION IS THE HARDEST THING ON THE CHART TO READ, and it used to be
          // drawn in the faintest ink the theme has, at 9px, over ground that is nearly the
          // page colour. In Hits mode most of the infield is empty, so most of the labels
          // were the unreadable case. `text.secondary` is the quietest colour that is still
          // meant to be read, which is what a label is.
          const ink = n === 0 ? theme.palette.text.secondary : inkFor(n)
          return (
            <g key={`f-${z}`}>
              {named && (
                <text x={x} y={y - (n === 0 ? 0 : 10)} textAnchor="middle" dominantBaseline="central"
                  fontSize={11} fontWeight={800} fill={ink}>{z}</text>
              )}
              {n > 0 && (
                <text x={x} y={named ? y + 6 : y} textAnchor="middle" dominantBaseline="central"
                  fontSize={14} fontWeight={800} fill={ink}>{pct(n)}</text>
              )}
            </g>
          )
        })}

        {/* Outfield names outside the fence, so the picture reads without a legend. */}
        {OUTFIELD_ZONES.map(z => {
          const [a1, a2] = ZONE_SHAPE[z]
          const [x, y] = polar(R_LABEL, (a1 + a2) / 2)
          return (
            <text key={`n-${z}`} x={x} y={y} textAnchor="middle" dominantBaseline="central"
              fontSize={11} fontWeight={800} fill={theme.palette.text.secondary}>{z}</text>
          )
        })}
      </Box>

      {/* The breakdown. Busiest zone first, which is the order a reader asks for it in. */}
      <Box sx={{ flex: { md: '0 0 auto' }, width: { md: chromePx(210) }, minWidth: 0 }}>
        {/* WHERE THE MISSING FIGURE IS, rather than in the note at the foot of the card. "Pull"
            is defined by which box she stood in, and the feed records a switch hitter's
            handedness only on the roster, never per plate appearance. Eight players are in
            that position and the blank was previously explained a paragraph away from it. */}
        {pull.pullPct == null && profile.placed > 0 && (
          <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.disabled', mb: 1, lineHeight: 1.45 }}>
            No pull rate: the feed records a switch hitter only on the roster.
          </Typography>
        )}
        {pull.pullPct != null && (
          <Box sx={{ display: 'flex', gap: 1.5, mb: 1 }}>
            {([['Pull', pull.pull], ['Centre', pull.center], ['Oppo', pull.oppo]] as const).map(([label, n]) => (
              <Box key={label} sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: TYPE_SCALE.nano, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: 'text.disabled' }}>
                  {label}
                </Typography>
                <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>
                  {Math.round((n / pull.total) * 100)}%
                </Typography>
              </Box>
            ))}
          </Box>
        )}
        {profile.zones
          .filter(z => valueOf(z, mode) > 0)
          .sort((a, b) => valueOf(b, mode) - valueOf(a, mode))
          .map(z => {
            const n = valueOf(z, mode)
            return (
              <Box key={z.zone} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: 0.25 }}>
                <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 800, width: chromePx(26), flexShrink: 0, color: 'text.secondary' }}>
                  {z.zone}
                </Typography>
                <Box sx={{ flex: 1, height: 4, borderRadius: 999, bgcolor: 'action.hover', overflow: 'hidden', minWidth: 0 }}>
                  <Box sx={{ width: `${(n / max) * 100}%`, height: '100%', bgcolor: heat }} />
                </Box>
                <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                  {pct(n)}
                </Typography>
              </Box>
            )
          })}
        {/* THE DENOMINATOR, because the field shows shares and a share with no count behind it
            cannot be judged: 100% of one ball and 44% of thirty-two look equally confident. */}
        <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.disabled', mt: 0.75, display: 'block' }}>
          {placedInMode} of {profile.hits + profile.outs} batted {profile.hits + profile.outs === 1 ? 'ball' : 'balls'} placed
        </Typography>
      </Box>
      </Box>

      {/* ONE LINE, AND IT STILL HAS TO SAY THE HONEST THING. The zones are read out of the
          scorer's words rather than measured, and a reader who takes them for coordinates has
          been misled by us. What went is the explanation of WHY the league has none, which is
          our problem rather than theirs, and the switch-hitter caveat, which has moved to the
          Pull tiles where the figure it explains is missing. The count that could not be
          placed stays, because a chart quietly dropping what it cannot read claims a
          completeness it does not have. */}
      <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.disabled', mt: 0.5, lineHeight: 1.5 }}>
        Read from each play's description, not measured locations.
        {profile.unplaced > 0 && ` ${profile.unplaced} not placed.`}
      </Typography>
    </Box>
  )
}

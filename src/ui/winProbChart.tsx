import React from 'react'
import { Box, Typography, useMediaQuery } from '@mui/material'
import { useChartScrub } from './chartScrub'
import { InfoDot } from './InfoDot'
import { TYPE_SCALE } from './card'
import { chromePx, typePx } from './scale'
import { nameAtStage, useLineNameFit } from './names'

/**
 * The win probability chart both sections draw in Game Center: each club's share of the game as its
 * territory in its own color (the away club above the line, the home club below), a readout box
 * ABOVE the plot, and the plot read by hovering, holding or arrowing along it.
 *
 * ONE COPY BECAUSE THERE WERE TWO. MLB's was a port of WPBL's, line for line, and from the day it
 * landed the two drifted: different type, different marks, one sized in px and one through the
 * scale, and an off-by-one in WPBL's x axis that stacked the last play's before and after on the
 * right edge. A reader moving between the sections is reading one chart, so it is drawn once. The
 * sections differ only in where the numbers come from (WPBL's own model, StatsAPI's) and in the
 * words, so those are the props: points, two clubs' colors, and a readout for any moment.
 *
 * Everything here is a fixed height, so the card does not move as the model lands or as a finger
 * moves along it. `WinProbFrame` is the same card with no data, for the loading state.
 */

/** One play. Probabilities are the HOME club's, 0..1. */
export interface WinProbPlotPoint {
  before: number
  after: number
  inning: number
}

/** A club: its abbreviation, the color of its territory, and (optionally) a text-safe ink for its
 *  label on the plot. Without one the label is the secondary ink. */
export interface WinProbSide {
  abbr: string
  fill: string
  ink?: string
}

/** A play marked on the line, where it LANDED. Numbered when it has a label (MLB's swings, matched
 *  to the list under the chart), a plain haloed dot when it does not (WPBL's one resting play). The
 *  first mark is the one the readout rests on, and gets a rule down the plot while nothing is
 *  being read. */
export interface WinProbMark {
  index: number
  color: string
  /** Text color on `color`, for a numbered mark. */
  ink?: string
  label?: string
}

/** The three rows the readout box holds, filled the same way whether the card is resting on a play
 *  or following a finger. One shape means a reader learns to read it once. */
export interface Readout {
  /** Row 1 left: what this moment is. A label at rest, the inning and outs while scrubbing. */
  label: string
  /** Row 1 right: the win probability at it. */
  pct: string
  /** Row 2: the play itself. */
  text: string
  /** The person's name `text` starts with, if any. The row is one line, so this is the part that
   *  gives way: it steps down to "F. Last", measured, before anything is cut (CLAUDE.md). */
  who?: string
  /** Row 3: the score there, or, at rest, the hint that the chart can be read. */
  note: string
}

/**
 * The readout's height, reserved from the first paint and never negotiated afterwards.
 *
 * FIXED rather than fitted, because the text changes under a moving finger and a box that resized
 * as it did would be the one thing this card must never do. That is also why the play is one line:
 * the height has to be the worst case.
 *
 * IN REM, NEVER PX. It reserves room for three rows of type. In px it does not clip when the type
 * grows; it is a flex column with the note pinned to the floor, so what it does instead is crush
 * the middle row, which is the play, to a sliver of its letters at Large text. 4.25rem rather than
 * 4 because the natural height measured a shade under 4rem, which would fit by nothing at all.
 */
const CAPTION_H = '4.25rem'

/** Tall enough for the shape to read, short enough that the card it sits in is still a summary.
 *  The phone figure pays for the readout above it: Game Center is a sheet. */
const CHART_H = { xs: chromePx(132), sm: chromePx(178) }

/** The inning axis: the row of numbers, and the word saying what they are. In rem: they hold type. */
const AXIS_H = '0.95rem'
const AXIS_LABEL_H = '0.8rem'

const CARD_SX = { border: '1px solid', borderColor: 'outline', borderRadius: 2, overflow: 'hidden' } as const

/** The card before its data: the real header, and an empty chart of the real height. Same order
 *  and the same boxes as the real card, or whatever is under it moves when the data lands. */
export function WinProbFrame({ away, home, info }: { away: string; home: string; info: React.ReactNode }) {
  return (
    <Box sx={CARD_SX}>
      <CardHeader info={info} />
      <Box sx={{ height: CAPTION_H, mb: 1, borderBottom: '1px solid', borderColor: 'divider' }} />
      <Box sx={{ position: 'relative', height: CHART_H }}>
        <Box aria-hidden sx={{
          position: 'absolute', left: 0, right: 0, top: '50%',
          borderTop: '1px dashed', borderColor: 'divider', opacity: 0.6,
        }} />
        <Label sx={{ top: 4, left: 6 }}>{away}</Label>
        <Label sx={{ bottom: 4, left: 6 }}>{home}</Label>
      </Box>
      <Box sx={{ height: AXIS_H, mt: '2px' }} />
      <Box sx={{ height: AXIS_LABEL_H, mb: 0.75 }} />
    </Box>
  )
}

/**
 * Shared by the frame and the card, so the two can never disagree about the header.
 *
 * `now` is a live game's headline: where it stands, this second. It is deliberately NOT in the
 * readout, which rests on a play and must keep resting there; a live figure jumping between "the
 * play you are pointing at" and "now" on every poll would be the one thing on the card that cannot
 * be trusted to hold still. It sits on the title's own line, so the frame without it is exactly as
 * tall as the card with it.
 */
function CardHeader({ info, now }: { info: React.ReactNode; now?: { text: string; color: string } | null }) {
  return (
    <Box sx={{ px: 1.5, pt: 1.25, pb: 0.75, display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700, lineHeight: 1.2 }}>Win probability</Typography>
      <InfoDot text={info} label="How win probability is worked out" />
      {now && (
        /* Tabular figures and a nowrap: this repaints on every poll, and a number that reflows the
           row as it lands reads as a glitch rather than as news. */
        <Typography sx={{
          ml: 'auto', fontSize: TYPE_SCALE.meta, fontWeight: 800, whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums', color: now.color,
        }}>{now.text}</Typography>
      )}
    </Box>
  )
}

export function WinProbChart({ points, away, home, info, now, accent, marks = [], readout }: {
  points: readonly WinProbPlotPoint[]
  away: WinProbSide
  home: WinProbSide
  /** The ⓘ beside the title: what the model is and what it does not know. */
  info: React.ReactNode
  now?: { text: string; color: string } | null
  /** Text-safe accent for the readout's label row and the plot's focus ring. */
  accent: string
  marks?: readonly WinProbMark[]
  /** What the readout says at a moment: `index` is the play under the finger, or null at rest. */
  readout: (index: number | null, canHover: boolean) => Readout | null
}) {
  const canHover = useMediaQuery('(hover: hover)')
  const scrub = useChartScrub(points.length,
    'Win probability through the game. Press and hold the chart, or use the arrow keys, to read any moment of it.')
  if (points.length < 2) return null

  // In a 0..100 box stretched to the card; `preserveAspectRatio="none"` lets it take any width and
  // the strokes are told not to stretch with it. Vertex i is the state BEFORE play i, and one more
  // vertex at the right edge is where the last play left it, so n plays are n segments.
  const n = points.length
  const x = (i: number) => (i / n) * 100
  const y = (p: number) => (1 - p) * 100
  const verts = points.map((p, i) => `${x(i).toFixed(3)},${y(p.before).toFixed(3)}`)
  verts.push(`100,${y(points[n - 1].after).toFixed(3)}`)
  const homeFill = `M0,100 L${verts.join(' L')} L100,100 Z`
  const awayFill = `M0,0 L${verts.join(' L')} L100,0 Z`

  // One span per inning, so the chart can be read against the game: the readout says "6th" and
  // there has to be a way to find the 6th. Both halves are consecutive in play order.
  const innings: { inning: number; from: number; to: number }[] = []
  points.forEach((p, i) => {
    const last = innings[innings.length - 1]
    if (last && last.inning === p.inning) last.to = x(i)
    else innings.push({ inning: p.inning, from: x(i), to: x(i) })
  })
  if (innings.length > 0) innings[innings.length - 1].to = 100

  const resting = marks.find(m => points[m.index])
  const at = scrub.index == null ? null : points[scrub.index]
  const read = readout(scrub.index, canHover)

  return (
    <Box sx={CARD_SX}>
      <CardHeader info={info} now={now} />

      {/* The readout, ABOVE the plot: a tooltip would cover the chart it describes and sit under
          the hand doing the pointing, and in a sheet on a phone a readout below the plot lands
          under the fold along with the hint that the chart can be held at all. */}
      <Box sx={{
        px: 1.5, pt: 0.25, pb: 1, mb: 1, height: CAPTION_H, overflow: 'hidden',
        borderBottom: '1px solid', borderColor: 'divider',
        // The note is pushed to the floor, so it holds still whatever the play row does.
        display: 'flex', flexDirection: 'column',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.25 }}>
          <Typography sx={{
            fontSize: TYPE_SCALE.caption, fontWeight: 800, textTransform: 'uppercase', letterSpacing: typePx(0.8),
            color: accent, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{read?.label}</Typography>
          {/* Tabular, because this changes under a moving finger and proportional digits make
              the whole row twitch. */}
          <Typography sx={{
            ml: 'auto', fontSize: TYPE_SCALE.meta, fontWeight: 800, whiteSpace: 'nowrap',
            fontVariantNumeric: 'tabular-nums', color: 'text.primary',
          }}>{read?.pct}</Typography>
        </Box>
        {/* ONE line, whatever the feed writes: a second costs 20px of a card that has to fit
            above the fold of a sheet. The ellipsis is the net under the batter's name, which the
            readout has already shortened. */}
        <PlayLine read={read} />
        <Typography sx={{
          mt: 'auto', pt: 0.25, fontSize: TYPE_SCALE.caption, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: typePx(0.7), color: 'text.secondary', whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
        }}>{read?.note}</Typography>
      </Box>

      <Box
        {...scrub.props}
        // Sideways belongs to the scrub, not to the tab pager underneath it.
        data-swipe-lock="true"
        sx={{
          position: 'relative', height: CHART_H,
          // Vertical belongs to the page; sideways is claimed before the browser can pan with it.
          touchAction: 'pan-y', WebkitTapHighlightColor: 'transparent',
          userSelect: 'none', WebkitTouchCallout: 'none', cursor: 'crosshair', outline: 'none',
          '&:focus-visible': { outline: '2px solid', outlineColor: accent, outlineOffset: '-2px' },
        }}
      >
        <Box component="svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden
          sx={{ display: 'block', width: '100%', height: '100%', color: 'text.primary' }}>
          <path d={awayFill} fill={away.fill} opacity={0.3} />
          <path d={homeFill} fill={home.fill} opacity={0.3} />
          {innings.slice(1).map(iv => (
            <line key={iv.inning} x1={iv.from} x2={iv.from} y1={0} y2={100}
              stroke="currentColor" strokeOpacity={0.12} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          <line x1={0} x2={100} y1={50} y2={50}
            stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          {/* The resting play, ruled the full height so the readout points somewhere a reader can
              see before touching the chart. Only at rest: once a finger lands, the crosshair is
              the line that matters and two would compete. */}
          {resting && scrub.index == null && (
            <line x1={x(resting.index + 1)} x2={x(resting.index + 1)} y1={0} y2={100}
              stroke={resting.color} strokeOpacity={0.5} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          )}
          <polyline points={verts.join(' ')} fill="none"
            stroke="currentColor" strokeOpacity={0.85} strokeWidth={2}
            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {scrub.index != null && (
            <line x1={x(scrub.index)} x2={x(scrub.index)} y1={0} y2={100}
              stroke="currentColor" strokeOpacity={0.55} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          )}
        </Box>

        {/* HTML dots, not SVG circles: the box is stretched by preserveAspectRatio="none", and a
            circle in it comes out an ellipse. Each sits where its play LANDED, nudged off the
            corners so the last play of a game is not half-clipped. Faded rather than unmounted
            while the chart is being read, so they do not blink as a linger expires. */}
        {marks.map(m => points[m.index] && (
          <Box key={m.index} aria-hidden sx={{
            position: 'absolute',
            left: `${Math.min(Math.max(x(m.index + 1), 2), 98)}%`,
            top: `${Math.min(Math.max(y(points[m.index].after), 8), 92)}%`,
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%', bgcolor: m.color,
            border: '2px solid', borderColor: 'background.paper',
            pointerEvents: 'none', opacity: scrub.index == null ? 1 : 0, transition: 'opacity 120ms ease',
            ...(m.label != null ? {
              width: '1.05rem', height: '1.05rem',
              color: m.ink, fontSize: TYPE_SCALE.caption, fontWeight: 900, lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            } : {
              width: chromePx(10), height: chromePx(10),
              // A soft halo of its own color, so it reads as the point of the chart.
              boxShadow: `0 0 0 5px color-mix(in srgb, ${m.color} 22%, transparent)`,
            }),
          }}>{m.label}</Box>
        ))}

        {at && scrub.index != null && (
          <Box aria-hidden sx={{
            position: 'absolute',
            left: `${Math.min(Math.max(x(scrub.index), 1.5), 98.5)}%`,
            top: `${Math.min(Math.max(y(at.before), 3), 97)}%`,
            transform: 'translate(-50%, -50%)',
            width: chromePx(11), height: chromePx(11), borderRadius: '50%',
            bgcolor: 'text.primary', border: '2px solid', borderColor: 'background.paper', pointerEvents: 'none',
          }} />
        )}

        {/* The clubs on their own halves rather than in a legend, so the chart needs no key. The
            midline is labeled once, on the right, where the line has almost always left it. */}
        <Label sx={{ top: 4, left: 6, color: away.ink ?? 'text.secondary' }}>{away.abbr}</Label>
        <Label sx={{ bottom: 4, left: 6, color: home.ink ?? 'text.secondary' }}>{home.abbr}</Label>
        <Label sx={{ top: '50%', right: 6, transform: 'translateY(-50%)' }}>50%</Label>
      </Box>

      {/* Innings under their own stretch of the chart, numbered wherever two labels will not
          collide. 3.5% rather than anything rounder: 7% quietly drops the seventh from a game the
          home side won without batting in it, the one inning a reader most wants to find. */}
      <Box aria-hidden sx={{ position: 'relative', height: AXIS_H, mt: '2px' }}>
        {innings.filter(iv => iv.to - iv.from >= 3.5).map(iv => (
          <Typography key={iv.inning} sx={{
            position: 'absolute', left: `${(iv.from + iv.to) / 2}%`, transform: 'translateX(-50%)',
            fontSize: TYPE_SCALE.caption, fontWeight: 700, color: 'text.secondary', lineHeight: 1,
          }}>{iv.inning}</Typography>
        ))}
      </Box>
      {/* A bare row of numbers under a baseball chart is a good guess rather than a label. */}
      <Typography aria-hidden sx={{
        height: AXIS_LABEL_H, mb: 0.75, textAlign: 'center', fontSize: TYPE_SCALE.caption, fontWeight: 700,
        letterSpacing: typePx(0.8), textTransform: 'uppercase', color: 'text.secondary', lineHeight: 1,
      }}>Inning</Typography>
    </Box>
  )
}

/** Row 2, measured: the name at its front steps down before the ellipsis takes anything. */
function PlayLine({ read }: { read: Readout | null }) {
  const who = read?.who && read.text.startsWith(read.who) ? read.who : null
  const fit = useLineNameFit<HTMLParagraphElement>(who ? [who] : [])
  return (
    <Typography ref={fit.ref} aria-live="polite" noWrap sx={{ fontSize: TYPE_SCALE.body, lineHeight: 1.45 }}>
      {who ? nameAtStage(who, fit.stage) + read!.text.slice(who.length) : read?.text}
    </Typography>
  )
}

function Label({ children, sx }: { children: React.ReactNode; sx: object }) {
  return (
    <Typography sx={{
      position: 'absolute', fontSize: TYPE_SCALE.caption, fontWeight: 800, letterSpacing: typePx(0.5),
      color: 'text.secondary', pointerEvents: 'none', ...sx,
    }}>{children}</Typography>
  )
}

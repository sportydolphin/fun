import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import { usePhoneLayout } from '../ModalShell'
import { TYPE_SCALE } from '../card'
import { ChartTooltip } from './ChartTooltip'
import { placeLabels, sumSegment, type Domain, type LabelBox } from './scale'

/**
 * A scatter of every player (or club) on two stats, shared by both sections. Grown out of MLB's team
 * plots (Pitching vs Hitting, Wins vs Run Margin), which drew 30 clubs with hover only; this one has
 * to carry about a hundred players on a phone, so three things differ:
 *
 *   • EVERY DOT IS A REAL LINK when the caller gives it an href, so the plot is crawlable and a
 *     player opens the way a row in a table does (CLAUDE.md: internal links are `<a href>`).
 *   • A TAP PINS BEFORE IT OPENS. A phone has no hover, and a dot that navigated on the first touch
 *     would never show its numbers. The first tap on a dot shows the card; a second opens the player.
 *     A mouse click opens straight away, since the pointer has already shown the card.
 *   • THE VIEWBOX IS ABOUT THE WIDTH IT IS DRAWN AT. SVG type scales with the box, so MLB's
 *     560-wide box squeezed into a 343px phone prints its axis labels at about 6px. There is one box
 *     for a phone and one for half a desktop column, and a caller drawing a lone chart caps its width.
 *
 * The box is a fixed aspect ratio, so `ScatterFrame` (the same box with no points) is the loading
 * state, and nothing below the chart moves when the points land.
 *
 * MLB's team plots came back onto this in Oct 2026 (`badge`, `curves`, `onActive`). Until then they
 * were a second copy of the same chart in src/mlb/components/charts.tsx, and every fix had to land
 * twice: the house rule against faded text did not, and their labels sat under 4.5:1 for months.
 */

export interface ScatterPoint {
  id: string
  x: number
  y: number
  /** Dot AREA is proportional to this (plate appearances, outs), so a cameo cannot look like a
   *  regular's season. */
  weight: number
  /** Direct label, drawn only for ids in `labeled`. The caller passes the "F. Last" stage: a label
   *  on a plot has no width to fit a full name into, and is never cut mid-name. */
  label: string
  /** Read aloud for the dot, and the link's accessible name. */
  ariaLabel: string
  /** The tooltip's body. */
  tip: React.ReactNode
  /** Drawn faint, behind the rest: a club not highlighted. */
  muted?: boolean
  /** A club's own color for the dot. Default: the chart's one blue. */
  color?: string
  /** A few letters printed in the dot (a club's abbreviation), for a plot of thirty clubs where
   *  every dot is worth naming. The dot is solid and one fixed size: a club is not a sample. */
  badge?: string
  href?: string
  /** The link's click, as `linkTo` / `playerLink` hand it back: it cancels the browser's own
   *  navigation and opens the page in the app. */
  onOpen?: (e: React.MouseEvent) => void
}

export interface ScatterAxis extends Domain {
  /** The axis title, with the direction of good in it where that is not obvious. */
  label: string
  fmt: (v: number) => string
  /** Lower is better, so the axis runs the other way and "better" is up and to the right on
   *  every chart. */
  invert?: boolean
}

export interface ScatterGuides {
  /** A dashed crosshair at the league's line, which splits the plot into four quadrants. The label
   *  sits at the crossing, or at the top of the vertical line where thirty clubs bunch at the
   *  crossing and would bury it. */
  avg?: { x: number; y: number; label?: string; labelAt?: 'center' | 'top' }
  /** Words in the four corners, read in SCREEN terms (after any inversion). */
  corners?: { tl?: string; tr?: string; bl?: string; br?: string }
  /** The y = x line, for two stats on one scale (ERA against FIP), with what each side means. */
  diagonal?: { above?: string; below?: string }
  /** Lines of constant x + y (OPS across OBP and SLG), each labeled where it leaves the plot. */
  sums?: { value: number; label: string }[]
  /** Solid zero lines, for two stats that can go negative (wins above replacement). */
  zero?: boolean
  /** Dashed reference curves in data terms (a Pythagorean expectation, a league trend line), each
   *  labeled at its right end. Points outside the plot are the caller's to leave out. */
  curves?: { points: readonly { x: number; y: number }[]; label?: string }[]
}

const BOX = {
  phone: { w: 360, h: 330, m: { t: 12, r: 12, b: 38, l: 42 } },
  // Sized for the half-column each chart gets beside another (about 420px), so its type prints
  // at about the size it is set at rather than three-quarters of it.
  wide: { w: 440, h: 360, m: { t: 14, r: 14, b: 42, l: 48 } },
}
// Categorical slot 1 (blue), light and dark steps. Validated against both surfaces for the
// lightness band, chroma floor and contrast; the same pair DraftValue's dots use.
const DOT = { light: '#2a78d6', dark: '#3987e5' }
// The fixed radius of a badge dot, sized for a three-letter abbreviation at a readable size.
const BADGE_R = { phone: 10.5, wide: 11.5 }
// Characters to px at the label size, for collision only: an estimate errs toward dropping a label.
const LABEL_CHAR_W = 5.6
const LABEL_FONT = 10

function useBoxWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setW(el.getBoundingClientRect().width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

/** The geometry both the chart and its empty frame are drawn from. */
function useGeometry() {
  const box = usePhoneLayout() ? BOX.phone : BOX.wide
  const iw = box.w - box.m.l - box.m.r
  const ih = box.h - box.m.t - box.m.b
  return { ...box, iw, ih }
}

/** The chart's box with nothing in it, for the loading state. Same aspect ratio, same height. */
export function ScatterFrame() {
  const g = useGeometry()
  return (
    <Box component="svg" viewBox={`0 0 ${g.w} ${g.h}`} aria-hidden
      sx={{ width: '100%', height: 'auto', display: 'block', color: 'text.secondary' }}>
      <line x1={g.m.l} y1={g.m.t} x2={g.m.l} y2={g.m.t + g.ih} stroke="currentColor" strokeOpacity={0.3} />
      <line x1={g.m.l} y1={g.m.t + g.ih} x2={g.m.l + g.iw} y2={g.m.t + g.ih} stroke="currentColor" strokeOpacity={0.3} />
    </Box>
  )
}

export function ScatterPlot({ points, x, y, guides = {}, labeled, title, onActive }: {
  points: ScatterPoint[]
  x: ScatterAxis
  y: ScatterAxis
  guides?: ScatterGuides
  /** Ids to label directly, most important first. A label that would collide is dropped. */
  labeled?: readonly string[]
  /** The chart's accessible name. */
  title: string
  /** Told which dot is showing its card, or null: lets a page light the same club on its other charts. */
  onActive?: (id: string | null) => void
}) {
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const dot = dark ? DOT.dark : DOT.light
  const surface = theme.palette.background.default
  const ink = theme.palette.text.primary
  const soft = theme.palette.text.secondary
  const g = useGeometry()
  const boxRef = useRef<HTMLDivElement>(null)
  const boxW = useBoxWidth(boxRef)

  // Which dot the card is showing, and whether a tap pinned it (a pinned card outlives the pointer
  // leaving, and a second tap on the same dot opens it).
  const [active, setActive] = useState<{ id: string; pinned: boolean } | null>(null)
  const pointerType = useRef<string>('mouse')
  const activeId = active?.id ?? null
  const onActiveRef = useRef(onActive)
  useLayoutEffect(() => { onActiveRef.current = onActive })
  useEffect(() => { onActiveRef.current?.(activeId) }, [activeId])

  const sx = (v: number) => {
    const t = (v - x.lo) / (x.hi - x.lo)
    return g.m.l + (x.invert ? 1 - t : t) * g.iw
  }
  const sy = (v: number) => {
    const t = (v - y.lo) / (y.hi - y.lo)
    return g.m.t + (y.invert ? t : 1 - t) * g.ih
  }

  const maxWeight = Math.max(1, ...points.map(p => p.weight))
  const phone = g.w === BOX.phone.w
  // Area ∝ weight, so the radius is a square root. The floor keeps a cameo visible as a point.
  const radius = (p: ScatterPoint) => (p.badge ? (phone ? BADGE_R.phone : BADGE_R.wide)
    : (phone ? 2.5 : 3) + (phone ? 5 : 6.5) * Math.sqrt(Math.max(0, p.weight) / maxWeight))

  // Muted first, then the biggest, so a small dot is never hidden under a big one.
  const order = useMemo(() => [...points].sort((a, b) =>
    (a.muted ? 0 : 1) - (b.muted ? 0 : 1) || b.weight - a.weight), [points])

  const shownLabels = useMemo(() => {
    const placed = new Map<string, { tx: number; ty: number; anchor: 'start' | 'end' }>()
    if (!labeled?.length) return placed
    const byId = new Map(points.map(p => [p.id, p]))
    const candidates: { item: string; spots: LabelBox[]; own: LabelBox }[] = []
    for (const id of labeled) {
      const p = byId.get(id)
      if (!p) continue
      const cx = sx(p.x), cy = sy(p.y), r = radius(p)
      const w = p.label.length * LABEL_CHAR_W
      const y0 = cy + 3.5 - LABEL_FONT
      const right = { x: cx + r + 3, y: y0, w, h: LABEL_FONT + 2 }
      const left = { x: cx - r - 3 - w, y: y0, w, h: LABEL_FONT + 2 }
      // Right of the dot first, then left; a side that runs off the plot is not offered.
      const spots = [right, left].filter(b => b.x >= g.m.l && b.x + b.w <= g.m.l + g.iw)
      candidates.push({ item: id, spots, own: { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r } })
    }
    // The corner words are fixed, so a name moves off them rather than over them.
    const cw = (t?: string) => (t ? t.length * (phone ? 5.6 : 6.3) : 0)
    const words = guides.corners ?? {}
    const tl = guides.diagonal?.above ?? words.tl, br = guides.diagonal?.below ?? words.br
    const corners: LabelBox[] = [
      { x: g.m.l, y: g.m.t, w: cw(tl) + 8, h: 18 },
      { x: g.m.l + g.iw - cw(words.tr) - 8, y: g.m.t, w: cw(words.tr) + 8, h: 18 },
      { x: g.m.l, y: g.m.t + g.ih - 18, w: cw(words.bl) + 8, h: 18 },
      { x: g.m.l + g.iw - cw(br) - 8, y: g.m.t + g.ih - 18, w: cw(br) + 8, h: 18 },
    ].filter(b => b.w > 8)
    for (const { item, spot } of placeLabels(candidates, [...candidates.map(c => c.own), ...corners])) {
      const c = candidates.find(k => k.item === item)!
      const b = c.spots[spot]
      const onRight = b.x > c.own.x
      placed.set(item, { tx: onRight ? b.x : b.x + b.w, ty: b.y + LABEL_FONT, anchor: onRight ? 'start' : 'end' })
    }
    return placed
    // sx, sy and radius are pure functions of the props listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labeled, points, x, y, g.w, maxWeight, guides])

  const activePoint = active ? points.find(p => p.id === active.id) ?? null : null
  const tip = activePoint && boxW > 0 ? (() => {
    const k = boxW / g.w
    const px = sx(activePoint.x) * k
    return { x: px, y: Math.max(sy(activePoint.y) * k, 36), flip: px > boxW * 0.55 }
  })() : null

  const L = g.m.l, R = g.m.l + g.iw, T = g.m.t, B = g.m.t + g.ih
  const avg = guides.avg
  const corner = guides.corners ?? {}
  const cornerText = (text: string | undefined, where: 'tl' | 'tr' | 'bl' | 'br') => {
    if (!text) return null
    const left = where[1] === 'l'
    const top = where[0] === 't'
    return (
      <text x={left ? L + 6 : R - 6} y={top ? T + 13 : B - 7} textAnchor={left ? 'start' : 'end'}
        fill={soft} fontSize={phone ? 8.5 : 9.5} fontWeight={800} letterSpacing="0.06em">
        {text.toUpperCase()}
      </text>
    )
  }

  return (
    <Box ref={boxRef} sx={{ position: 'relative', userSelect: 'none' }}>
      <Box component="svg" viewBox={`0 0 ${g.w} ${g.h}`} role="group" aria-label={title}
        sx={{ width: '100%', height: 'auto', display: 'block', color: 'text.secondary', overflow: 'visible' }}
        onClick={(e: React.MouseEvent) => {
          // A tap on the plot itself, not on a dot: put the pinned card away.
          if (!(e.target as Element).closest('a, [data-dot]')) setActive(null)
        }}
        onMouseLeave={() => setActive(a => (a?.pinned ? a : null))}>
        {/* Gridlines: hairline and recessive, so the dots carry the plot. */}
        {x.ticks.map(t => <line key={`gx${t}`} x1={sx(t)} y1={T} x2={sx(t)} y2={B} stroke="currentColor" strokeOpacity={0.12} />)}
        {y.ticks.map(t => <line key={`gy${t}`} x1={L} y1={sy(t)} x2={R} y2={sy(t)} stroke="currentColor" strokeOpacity={0.12} />)}

        {guides.zero && x.lo < 0 && x.hi > 0 && <line x1={sx(0)} y1={T} x2={sx(0)} y2={B} stroke={soft} strokeWidth={1} />}
        {guides.zero && y.lo < 0 && y.hi > 0 && <line x1={L} y1={sy(0)} x2={R} y2={sy(0)} stroke={soft} strokeWidth={1} />}

        {guides.sums?.map(s => {
          const seg = sumSegment(s.value, x, y)
          if (!seg) return null
          // Labeled where the line leaves the RIGHT edge, inside it: the left end is where the
          // corner words sit, and the middle is the cloud of dots. A line that leaves by the
          // bottom instead goes unlabeled; its neighbors say what the lines are.
          const right = Math.abs(sx(seg.x2) - R) < 0.5 ? { x: R - 4, y: sy(seg.y2) - 5 } : null
          return (
            <g key={`s${s.value}`}>
              <line x1={sx(seg.x1)} y1={sy(seg.y1)} x2={sx(seg.x2)} y2={sy(seg.y2)}
                stroke={soft} strokeWidth={1} strokeDasharray="2 3" />
              {right && right.y > T + 18 && (
                <text x={right.x} y={right.y} textAnchor="end" fill={soft} fontSize={phone ? 8.5 : 9.5} fontWeight={700}
                  stroke={surface} strokeWidth={3} strokeLinejoin="round" paintOrder="stroke">{s.label}</text>
              )}
            </g>
          )
        })}

        {guides.diagonal && (() => {
          const lo = Math.max(x.lo, y.lo), hi = Math.min(x.hi, y.hi)
          if (hi <= lo) return null
          return <line x1={sx(lo)} y1={sy(lo)} x2={sx(hi)} y2={sy(hi)} stroke={soft} strokeWidth={1.25} strokeDasharray="6 4" />
        })()}

        {guides.curves?.map((c, i) => {
          if (c.points.length < 2) return null
          const last = c.points[c.points.length - 1]
          return (
            <g key={`c${i}`}>
              <polyline points={c.points.map(q => `${sx(q.x).toFixed(1)},${sy(q.y).toFixed(1)}`).join(' ')}
                fill="none" stroke={soft} strokeWidth={1.5} strokeDasharray="6 3" strokeLinejoin="round" />
              {c.label && (
                <text x={sx(last.x) - 4} y={Math.max(T + 11, sy(last.y) - 6)} textAnchor="end" fill={soft} fontSize={phone ? 8.5 : 9.5} fontWeight={700}
                  stroke={surface} strokeWidth={3} strokeLinejoin="round" paintOrder="stroke">{c.label}</text>
              )}
            </g>
          )
        })}

        {avg && (
          <g>
            <line x1={sx(avg.x)} y1={T} x2={sx(avg.x)} y2={B} stroke={soft} strokeWidth={1} strokeDasharray="5 4" />
            <line x1={L} y1={sy(avg.y)} x2={R} y2={sy(avg.y)} stroke={soft} strokeWidth={1} strokeDasharray="5 4" />
            {avg.label && (
              <text x={sx(avg.x) + 4} y={avg.labelAt === 'top' ? T + 11 : sy(avg.y) - 5} fill={soft} fontSize={phone ? 8.5 : 9.5} fontWeight={700}
                stroke={surface} strokeWidth={3} strokeLinejoin="round" paintOrder="stroke">{avg.label}</text>
            )}
          </g>
        )}

        {cornerText(guides.diagonal?.above ?? corner.tl, 'tl')}
        {cornerText(corner.tr, 'tr')}
        {cornerText(corner.bl, 'bl')}
        {cornerText(guides.diagonal?.below ?? corner.br, 'br')}

        {/* Axes and their ticks. */}
        <line x1={L} y1={T} x2={L} y2={B} stroke="currentColor" strokeOpacity={0.35} strokeWidth={1.25} />
        <line x1={L} y1={B} x2={R} y2={B} stroke="currentColor" strokeOpacity={0.35} strokeWidth={1.25} />
        {x.ticks.map(t => (
          <text key={`tx${t}`} x={sx(t)} y={B + 14} textAnchor="middle" fill={soft} fontSize={phone ? 9 : 10}>{x.fmt(t)}</text>
        ))}
        {y.ticks.map(t => (
          <text key={`ty${t}`} x={L - 6} y={sy(t) + 3.5} textAnchor="end" fill={soft} fontSize={phone ? 9 : 10}>{y.fmt(t)}</text>
        ))}
        <text x={L + g.iw / 2} y={g.h - 4} textAnchor="middle" fill={ink} fontSize={phone ? 10 : 11} fontWeight={700}>{x.label}</text>
        <text transform={`translate(${phone ? 10 : 12},${T + g.ih / 2}) rotate(-90)`} textAnchor="middle"
          fill={ink} fontSize={phone ? 10 : 11} fontWeight={700}>{y.label}</text>

        {order.map(p => {
          const cx = sx(p.x), cy = sy(p.y), r = radius(p)
          const on = active?.id === p.id
          const faded = p.muted || (active != null && !on)
          const show = () => setActive(a => (a?.pinned && a.id !== p.id ? a : { id: p.id, pinned: false }))
          const body = p.badge ? (
            // A badge is solid in its club's color, so the fade is the whole mark's, letters
            // included: the deliberately faded case the contrast rules exempt (a club not in focus).
            <g opacity={on ? 1 : faded ? (p.muted ? 0.18 : 0.35) : 1}>
              <circle cx={cx} cy={cy} r={Math.max(r, phone ? 10 : 7)} fill="transparent" />
              <circle cx={cx} cy={cy} r={on ? r + 2 : r} fill={p.color ?? dot}
                stroke={on ? ink : surface} strokeWidth={on ? 2 : 1.25} />
              <text x={cx} y={cy + 3} textAnchor="middle" fill="#fff" pointerEvents="none" fontWeight={800}
                fontSize={p.badge.length > 2 ? (phone ? 6 : 6.5) : (phone ? 7 : 7.5)}>{p.badge}</text>
            </g>
          ) : (
            <>
              {/* A hit target bigger than the mark: a cameo's 3px dot is not something a thumb can find. */}
              <circle cx={cx} cy={cy} r={Math.max(r, phone ? 10 : 7)} fill="transparent" />
              <circle cx={cx} cy={cy} r={r} fill={p.color ?? dot}
                fillOpacity={on ? 1 : faded ? (p.muted ? 0.16 : 0.3) : 0.6}
                stroke={on ? ink : surface} strokeWidth={on ? 2 : 1.5} />
            </>
          )
          const handlers = {
            onPointerDown: (e: React.PointerEvent) => { pointerType.current = e.pointerType },
            onMouseEnter: () => { if (pointerType.current === 'mouse') show() },
            onMouseLeave: () => setActive(a => (a?.id === p.id && !a.pinned ? null : a)),
            onFocus: () => setActive({ id: p.id, pinned: false }),
            onBlur: () => setActive(a => (a?.id === p.id && !a.pinned ? null : a)),
            onClick: (e: React.MouseEvent) => {
              // The first tap on a dot shows its card; a second tap on the same dot opens it.
              if (pointerType.current !== 'mouse' && !(active?.id === p.id && active.pinned)) {
                e.preventDefault()
                setActive({ id: p.id, pinned: true })
                return
              }
              p.onOpen?.(e)
            },
          }
          return p.href ? (
            <a key={p.id} href={p.href} aria-label={p.ariaLabel} style={{ cursor: 'pointer', outline: 'none' }} {...handlers}>{body}</a>
          ) : (
            // No address to open (rendered outside the section's link provider): the dot still
            // shows its card under a pointer, and is named for a screen reader.
            <g key={p.id} data-dot aria-label={p.ariaLabel} role="img" {...handlers}>{body}</g>
          )
        })}

        {/* Labels last, over every dot, haloed in the surface color so a label crossing a dot reads. */}
        {points.map(p => {
          const l = shownLabels.get(p.id)
          if (!l) return null
          return (
            <text key={`l${p.id}`} x={l.tx} y={l.ty} textAnchor={l.anchor} fill={ink} fontSize={LABEL_FONT}
              fontWeight={700} stroke={surface} strokeWidth={3} strokeLinejoin="round" paintOrder="stroke"
              pointerEvents="none" aria-hidden>{p.label}</text>
          )
        })}
      </Box>

      {activePoint && tip && (
        <ChartTooltip tipPos={tip}>
          {activePoint.tip}
          {active?.pinned && activePoint.href && (
            <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', mt: 0.5 }}>Tap again to open</Typography>
          )}
        </ChartTooltip>
      )}
    </Box>
  )
}

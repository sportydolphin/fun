import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import { usePhoneLayout } from '../ModalShell'
import { TYPE_SCALE } from '../card'
import { ChartTooltip } from './ChartTooltip'
import { boxesMeet, labelSpots, leaderLine, placeLabels, sumSegment, type Domain, type LabelBox, type LabelSpot } from './scale'

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
  phone: { w: 360, h: 330, m: { t: 12, r: 12, b: 40, l: 46 } },
  // Sized for the half-column each chart gets beside another (about 420px), so its type prints
  // at about the size it is set at rather than three-quarters of it.
  wide: { w: 440, h: 360, m: { t: 14, r: 14, b: 44, l: 50 } },
  // For a caller laying two charts across a full desktop width (WPBL's Charts board, each about
  // 560 to 760px). The wide box drawn there printed its 11-unit type at 17px; this one keeps it
  // near the size it is set at, and spends the room on the plot instead.
  large: { w: 600, h: 450, m: { t: 16, r: 16, b: 46, l: 54 } },
}
// Type sizes in viewBox units. The phone box is drawn about 0.95 of its size at 375px, so nothing
// here is under 10.5: the layout sweep fails any chart text printed under 10px on a phone. These
// were 8.5 to 10 until Oct 2026, which printed the axis numbers at 8px.
const FONT = { tick: 11, guide: 11, axis: 12, label: 11 }
// Categorical slot 1 (blue), light and dark steps. Validated against both surfaces for the
// lightness band, chroma floor and contrast; the same pair DraftValue's dots use.
const DOT = { light: '#2a78d6', dark: '#3987e5' }
// The fixed radius of a badge dot, sized for a three-letter abbreviation. A phone has no room for
// letters big enough to read inside a dot (they printed at 5.7px), so there the dot is smaller and
// plain, and the abbreviation becomes a direct label beside it, placed like a player's name.
const BADGE_R = { phone: 7, wide: 11.5 }
// Characters to px at the label size, for collision only: an estimate errs toward dropping a label.
const LABEL_CHAR_W = FONT.label * 0.6
const LABEL_FONT = FONT.label
// The most names a caller's `labeled` list may put on one plot. Past this a plot of a hundred
// players reads as a wall of words, and a phone has half the room.
const LABEL_CAP = { phone: 5, wide: 9, large: 12 }
// The same for the corner words, which are bold capitals with tracking.
const CORNER_CHAR_W = FONT.guide * 0.68
// A guide's own label ("League avg", "Pythagorean"): bold, mixed case.
const GUIDE_CHAR_W = FONT.guide * 0.6

interface PlacedLabel {
  tx: number
  ty: number
  anchor: 'start' | 'middle' | 'end'
  leader: { x1: number; y1: number; x2: number; y2: number } | null
}

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
function useGeometry(large = false) {
  const box = usePhoneLayout() ? BOX.phone : large ? BOX.large : BOX.wide
  const iw = box.w - box.m.l - box.m.r
  const ih = box.h - box.m.t - box.m.b
  return { ...box, iw, ih }
}

/** The chart's box with nothing in it, for the loading state. Same aspect ratio, same height. */
export function ScatterFrame({ large }: { large?: boolean } = {}) {
  const g = useGeometry(large)
  return (
    <Box component="svg" viewBox={`0 0 ${g.w} ${g.h}`} aria-hidden
      sx={{ width: '100%', height: 'auto', display: 'block', color: 'text.secondary' }}>
      <line x1={g.m.l} y1={g.m.t} x2={g.m.l} y2={g.m.t + g.ih} stroke="currentColor" strokeOpacity={0.3} />
      <line x1={g.m.l} y1={g.m.t + g.ih} x2={g.m.l + g.iw} y2={g.m.t + g.ih} stroke="currentColor" strokeOpacity={0.3} />
    </Box>
  )
}

export function ScatterPlot({ points, x, y, guides = {}, labeled, title, onActive, echo, large }: {
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
  /** A dot lit from outside, the player in focus on the chart beside this one: ringed and named
   *  as if pointed at, with no card. The reader's own pointer wins over it. */
  echo?: string | null
  /** Drawn in the large box (the caller is a full-width desktop layout); ignored on a phone.
   *  Pass the same to the `ScatterFrame` that stands in for it while loading. */
  large?: boolean
}) {
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const dot = dark ? DOT.dark : DOT.light
  const surface = theme.palette.background.default
  const ink = theme.palette.text.primary
  const soft = theme.palette.text.secondary
  const g = useGeometry(large)
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
  // A dot's place, held inside the plot. A caller may draw its axes short of an outlier (a cameo's
  // 27.00 ERA would squeeze every regular into one corner), and that dot sits on the edge with an
  // arrow pointing the way it went off; its card still gives the real numbers.
  const clampTo = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b)
  const pxOf = (p: ScatterPoint) => clampTo(sx(p.x), g.m.l, g.m.l + g.iw)
  const pyOf = (p: ScatterPoint) => clampTo(sy(p.y), g.m.t, g.m.t + g.ih)
  /** Which way, on screen, a dot ran off the plot: -1, 0 or 1 on each axis. */
  const offEdge = (p: ScatterPoint) => {
    const ex = sx(p.x), ey = sy(p.y)
    return {
      dx: ex < g.m.l - 0.5 ? -1 : ex > g.m.l + g.iw + 0.5 ? 1 : 0,
      dy: ey < g.m.t - 0.5 ? -1 : ey > g.m.t + g.ih + 0.5 ? 1 : 0,
    }
  }

  const maxWeight = Math.max(1, ...points.map(p => p.weight))
  const phone = g.w === BOX.phone.w
  // Area ∝ weight, so the radius is a square root. The floor keeps a cameo visible as a point.
  const radius = (p: ScatterPoint) => (p.badge ? (phone ? BADGE_R.phone : BADGE_R.wide)
    : (phone ? 2.5 : 3) + (phone ? 5 : 6.5) * Math.sqrt(Math.max(0, p.weight) / maxWeight))

  // Muted first, then the biggest, so a small dot is never hidden under a big one.
  const order = useMemo(() => [...points].sort((a, b) =>
    (a.muted ? 0 : 1) - (b.muted ? 0 : 1) || b.weight - a.weight), [points])

  // Which dots get a direct label. On a phone a badge plot labels its clubs instead of printing in
  // the dots: the one in focus first, then the farthest from the middle of the cloud, since those
  // are the clubs a reader is looking for and the ones with room around them.
  const labelIds = useMemo(() => {
    if (labeled) return labeled
    if (!phone || !points.some(p => p.badge)) return undefined
    const cx = (x.lo + x.hi) / 2, cy = (y.lo + y.hi) / 2
    const far = (p: ScatterPoint) => Math.hypot((p.x - cx) / (x.hi - x.lo), (p.y - cy) / (y.hi - y.lo))
    return [...points].sort((a, b) => (a.muted ? 1 : 0) - (b.muted ? 1 : 0) || far(b) - far(a)).map(p => p.id)
  }, [labeled, phone, points, x, y])

  const L = g.m.l, R = g.m.l + g.iw, T = g.m.t, B = g.m.t + g.ih
  const avg = guides.avg
  const corner = guides.corners ?? {}
  const inPlot = (b: LabelBox) => b.x >= L && b.x + b.w <= R && b.y >= T && b.y + b.h <= B

  // The middle of every dot, which no label may cover: a name may graze a dot's edge, haloed, but
  // a dot whose center is under a word is a dot nobody can see.
  const dotCores = useMemo(() => points.map(p => {
    const r = radius(p), k = Math.max(2, r * 0.6)
    return { id: p.id, box: { x: pxOf(p) - k, y: pyOf(p) - k, w: 2 * k, h: 2 * k } }
    // sx, sy and radius are pure functions of the props listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [points, x, y, g.w, maxWeight])

  // Where the guides' own labels go, placed before any name so the names move off them. The
  // average's label used to sit at the crossing, which is the middle of the cloud: on three of
  // WPBL's charts it printed over the dots. It now takes the first of several spots along its two
  // lines that clears the corner words and every dot, and only then falls back to where it was.
  const guideLabels = useMemo(() => {
    const lineH = FONT.guide + 4
    const placed: LabelBox[] = []
    const cornerBox = (text: string | undefined, left: boolean, top: boolean) => {
      if (!text) return
      const w = text.length * CORNER_CHAR_W
      placed.push({ x: left ? L + 6 : R - 6 - w, y: top ? T + 2 : B - 18, w, h: lineH })
    }
    cornerBox(guides.diagonal?.above ?? corner.tl, true, true)
    cornerBox(corner.tr, false, true)
    cornerBox(corner.bl, true, false)
    cornerBox(guides.diagonal?.below ?? corner.br, false, false)
    const clearOfDots = (b: LabelBox) => !dotCores.some(d => boxesMeet(d.box, b))
    const clearOfLabels = (b: LabelBox) => !placed.some(k => boxesMeet(k, b))
    const settle = (box: LabelBox) => {
      for (let i = 0; i < 4 && !clearOfLabels(box); i++) box = { ...box, y: box.y + lineH }
      placed.push(box)
      return box
    }
    let avgLabel: { x: number; y: number; anchor: 'start' | 'end' } | null = null
    if (avg?.label) {
      const w = avg.label.length * GUIDE_CHAR_W
      const vx = sx(avg.x), hy = sy(avg.y)
      const spot = (x0: number, baseline: number, anchor: 'start' | 'end') =>
        ({ box: { x: anchor === 'start' ? x0 : x0 - w, y: baseline - FONT.guide, w, h: lineH }, anchor })
      const crossing = spot(vx + 4, hy - 5, 'start')
      const spots = [
        spot(vx + 4, T + 13, 'start'), spot(vx - 4, T + 13, 'end'),
        spot(R - 4, hy - 5, 'end'), spot(L + 4, hy - 5, 'start'),
        spot(R - 4, hy + FONT.guide + 3, 'end'), spot(L + 4, hy + FONT.guide + 3, 'start'),
        spot(vx + 4, B - 6, 'start'), spot(vx - 4, B - 6, 'end'),
      ]
      if (avg.labelAt === 'center') spots.unshift(crossing)
      let pick = spots.find(c => inPlot(c.box) && clearOfLabels(c.box) && clearOfDots(c.box))
      if (pick) placed.push(pick.box)
      else pick = { ...spots[0], box: settle(spots[0].box) }
      avgLabel = { x: pick.anchor === 'start' ? pick.box.x : pick.box.x + w, y: pick.box.y + FONT.guide, anchor: pick.anchor }
    }
    const curveY = (guides.curves ?? []).map(c => {
      if (!c.label || c.points.length < 2) return 0
      const last = c.points[c.points.length - 1]
      const w = c.label.length * GUIDE_CHAR_W
      return settle({ x: sx(last.x) - 4 - w, y: Math.max(T + 11, sy(last.y) - 6) - FONT.guide, w, h: lineH }).y + FONT.guide
    })
    // A sum line is labeled where it leaves the RIGHT edge, inside it: the left end is where the
    // corner words sit, and the middle is the cloud of dots. A line that leaves by the bottom, or
    // whose label would cover a dot, goes unlabeled; its neighbors say what the lines are.
    const sumLabels = new Map<number, { x: number; y: number }>()
    for (const sm of guides.sums ?? []) {
      const seg = sumSegment(sm.value, x, y)
      if (!seg || Math.abs(sx(seg.x2) - R) >= 0.5) continue
      const by = sy(seg.y2) - 5
      if (by <= T + 18) continue
      const w = sm.label.length * GUIDE_CHAR_W
      const box = { x: R - 4 - w, y: by - FONT.guide, w, h: lineH }
      if (!clearOfDots(box) || !clearOfLabels(box)) continue
      placed.push(box)
      sumLabels.set(sm.value, { x: R - 4, y: by })
    }
    return { avgLabel, curveY, sumLabels, boxes: placed }
    // sx and sy are pure functions of the props listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guides, x, y, g.w, dotCores])

  const placedLabel = (spot: LabelSpot, p: ScatterPoint): PlacedLabel => {
    const b = spot.box
    const tx = spot.anchor === 'start' ? b.x : spot.anchor === 'end' ? b.x + b.w : b.x + b.w / 2
    return { tx, ty: b.y + LABEL_FONT, anchor: spot.anchor, leader: spot.leader ? leaderLine(pxOf(p), pyOf(p), radius(p), b) : null }
  }

  // Which names are drawn, and where. Each tries every spot `labelSpots` offers, in order, and
  // takes the first that stays inside the plot and clears the guide labels, the names already
  // placed and the middle of every other dot. A crowd drops the lesser name, never the first.
  const labelCap = labeled ? (phone ? LABEL_CAP.phone : g.w === BOX.large.w ? LABEL_CAP.large : LABEL_CAP.wide) : Infinity
  const shownLabels = useMemo(() => {
    const placed = new Map<string, PlacedLabel>()
    if (!labelIds?.length) return placed
    const byId = new Map(points.map(p => [p.id, p]))
    const cores = new Map(dotCores.map(d => [d.id, d.box]))
    const candidates: { item: string; spots: LabelSpot[]; own: LabelBox }[] = []
    for (const id of labelIds) {
      const p = byId.get(id)
      const own = cores.get(id)
      if (!p || !own) continue
      const spots = labelSpots(pxOf(p), pyOf(p), radius(p), p.label.length * LABEL_CHAR_W, LABEL_FONT).filter(sp => inPlot(sp.box))
      candidates.push({ item: id, spots, own })
    }
    const kept = placeLabels(
      candidates.map(c => ({ item: c.item, own: c.own, spots: c.spots.map(sp => sp.box) })),
      [...dotCores.map(d => d.box), ...guideLabels.boxes],
    )
    for (const { item, spot } of kept.slice(0, labelCap)) {
      const c = candidates.find(k => k.item === item)!
      placed.set(item, placedLabel(c.spots[spot], byId.get(item)!))
    }
    return placed
    // sx, sy, radius and placedLabel are pure functions of the props listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelIds, points, x, y, g.w, maxWeight, guideLabels, dotCores, labelCap])

  const activePoint = active ? points.find(p => p.id === active.id) ?? null : null
  const tip = activePoint && boxW > 0 ? (() => {
    const k = boxW / g.w
    const px = pxOf(activePoint) * k
    return { x: px, y: Math.max(pyOf(activePoint) * k, 36), flip: px > boxW * 0.55 }
  })() : null

  // The lit dot: the one showing its card, else the one lit from the chart beside this one.
  const litPoint = activePoint ?? (echo ? points.find(p => p.id === echo) ?? null : null)

  // The lit dot is always named, even one the crowd left unlabeled: a reader who found a dot by
  // pointing at it should not have to read the card to learn whose it is. Its name takes the first
  // spot clear of the other dots and the guides, or the first spot at all.
  const litLabel = (() => {
    if (!litPoint || !labelIds || shownLabels.has(litPoint.id)) return null
    const spots = labelSpots(pxOf(litPoint), pyOf(litPoint), radius(litPoint), litPoint.label.length * LABEL_CHAR_W, LABEL_FONT)
      .filter(sp => inPlot(sp.box))
    if (!spots.length) return null
    const blocked = [...dotCores.filter(d => d.id !== litPoint.id).map(d => d.box), ...guideLabels.boxes]
    return placedLabel(spots.find(sp => !blocked.some(o => boxesMeet(o, sp.box))) ?? spots[0], litPoint)
  })()

  // Arrow keys step from the focused dot to its nearest neighbor that way, so a keyboard reaches
  // a dot by where it sits on the plot. Tab alone walks the dots biggest first, which is no order
  // a reader can see.
  const svgRef = useRef<SVGSVGElement>(null)
  const onKeyDown = (e: React.KeyboardEvent) => {
    const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
    const from = (e.target as Element).closest?.('[data-pid]')?.getAttribute('data-pid')
    const here = from ? points.find(p => p.id === from) : null
    if (!dir || !here) return
    const hx = pxOf(here), hy = pyOf(here)
    let best: { id: string; score: number } | null = null
    for (const p of points) {
      if (p.id === here.id || !p.href) continue
      const vx = pxOf(p) - hx, vy = pyOf(p) - hy
      const along = vx * dir[0] + vy * dir[1]
      if (along <= 0.5) continue
      const across = Math.abs(vx * dir[1] - vy * dir[0])
      // Mostly along the arrow, a little across it: a neighbor straight ahead beats a nearer one
      // off to the side.
      const score = along + 2 * across
      if (!best || score < best.score) best = { id: p.id, score }
    }
    if (!best) return
    e.preventDefault()
    svgRef.current?.querySelector<SVGElement>(`[data-pid="${CSS.escape(best.id)}"]`)?.focus()
  }

  const cornerText = (text: string | undefined, where: 'tl' | 'tr' | 'bl' | 'br') => {
    if (!text) return null
    const left = where[1] === 'l'
    const top = where[0] === 't'
    return (
      <text x={left ? L + 6 : R - 6} y={top ? T + 13 : B - 7} textAnchor={left ? 'start' : 'end'}
        fill={soft} fontSize={FONT.guide} fontWeight={800} letterSpacing="0.03em">
        {text.toUpperCase()}
      </text>
    )
  }

  return (
    <Box ref={boxRef} sx={{ position: 'relative', userSelect: 'none' }}>
      <Box component="svg" ref={svgRef} viewBox={`0 0 ${g.w} ${g.h}`} role="group" aria-label={title} onKeyDown={onKeyDown}
        data-scatter="" data-names={labelIds?.length ? '' : undefined}
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
          const right = guideLabels.sumLabels.get(s.value)
          return (
            <g key={`s${s.value}`}>
              <line x1={sx(seg.x1)} y1={sy(seg.y1)} x2={sx(seg.x2)} y2={sy(seg.y2)}
                stroke={soft} strokeWidth={1} strokeDasharray="2 3" />
              {right && (
                <text x={right.x} y={right.y} textAnchor="end" fill={soft} fontSize={FONT.guide} fontWeight={700}
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
                <text x={sx(last.x) - 4} y={guideLabels.curveY[i]} textAnchor="end" fill={soft} fontSize={FONT.guide} fontWeight={700}
                  stroke={surface} strokeWidth={3} strokeLinejoin="round" paintOrder="stroke">{c.label}</text>
              )}
            </g>
          )
        })}

        {avg && (
          <g>
            <line x1={sx(avg.x)} y1={T} x2={sx(avg.x)} y2={B} stroke={soft} strokeWidth={1} strokeDasharray="5 4" />
            <line x1={L} y1={sy(avg.y)} x2={R} y2={sy(avg.y)} stroke={soft} strokeWidth={1} strokeDasharray="5 4" />
            {avg.label && guideLabels.avgLabel && (
              <text x={guideLabels.avgLabel.x} y={guideLabels.avgLabel.y} textAnchor={guideLabels.avgLabel.anchor} fill={soft} fontSize={FONT.guide} fontWeight={700}
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
          <text key={`tx${t}`} x={sx(t)} y={B + 15} textAnchor="middle" fill={soft} fontSize={FONT.tick}>{x.fmt(t)}</text>
        ))}
        {y.ticks.map(t => (
          <text key={`ty${t}`} x={L - 6} y={sy(t) + 3.5} textAnchor="end" fill={soft} fontSize={FONT.tick}>{y.fmt(t)}</text>
        ))}
        <text x={L + g.iw / 2} y={g.h - 4} textAnchor="middle" fill={ink} fontSize={FONT.axis} fontWeight={700}>{x.label}</text>
        <text transform={`translate(${phone ? 11 : 13},${T + g.ih / 2}) rotate(-90)`} textAnchor="middle"
          fill={ink} fontSize={FONT.axis} fontWeight={700}>{y.label}</text>

        {order.map(p => {
          const cx = pxOf(p), cy = pyOf(p), r = radius(p)
          const on = litPoint?.id === p.id
          const faded = p.muted || (litPoint != null && !on)
          const off = offEdge(p)
          const show = () => setActive(a => (a?.pinned && a.id !== p.id ? a : { id: p.id, pinned: false }))
          const body = p.badge ? (
            // A badge is solid in its club's color, so the fade is the whole mark's, letters
            // included: the deliberately faded case the contrast rules exempt (a club not in focus).
            <g opacity={on ? 1 : faded ? (p.muted ? 0.18 : 0.35) : 1}>
              <circle cx={cx} cy={cy} r={Math.max(r, phone ? 10 : 7)} fill="transparent" />
              <circle cx={cx} cy={cy} r={on ? r + 2 : r} fill={p.color ?? dot}
                stroke={on ? ink : surface} strokeWidth={on ? 2 : 1.25} />
              {!phone && (
                <text x={cx} y={cy + 3} textAnchor="middle" fill="#fff" pointerEvents="none" fontWeight={800}
                  fontSize={p.badge.length > 2 ? 6.5 : 7.5}>{p.badge}</text>
              )}
            </g>
          ) : (
            <>
              {/* A hit target bigger than the mark: a cameo's 3px dot is not something a thumb can find. */}
              <circle cx={cx} cy={cy} r={Math.max(r, phone ? 10 : 7)} fill="transparent" />
              <circle cx={cx} cy={cy} r={r} fill={p.color ?? dot}
                fillOpacity={on ? 1 : faded ? (p.muted ? 0.16 : 0.3) : 0.6}
                stroke={on ? ink : surface} strokeWidth={on ? 2 : 1.5} />
              {(off.dx !== 0 || off.dy !== 0) && (() => {
                // A chevron just past the dot, pointing the way it left the plot.
                const len = Math.hypot(off.dx, off.dy)
                const ux = off.dx / len, uy = off.dy / len
                const tx = cx + ux * (r + 7), ty = cy + uy * (r + 7)
                const bx = cx + ux * (r + 2), by = cy + uy * (r + 2)
                return <polygon points={`${tx},${ty} ${bx - uy * 3.5},${by + ux * 3.5} ${bx + uy * 3.5},${by - ux * 3.5}`} fill={ink} />
              })()}
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
            <a key={p.id} data-pid={p.id} href={p.href} aria-label={p.ariaLabel} style={{ cursor: 'pointer', outline: 'none' }} {...handlers}>{body}</a>
          ) : (
            // No address to open (rendered outside the section's link provider): the dot still
            // shows its card under a pointer, and is named for a screen reader.
            <g key={p.id} data-dot aria-label={p.ariaLabel} role="img" {...handlers}>{body}</g>
          )
        })}

        {/* Labels last, over every dot, haloed in the surface color so a label crossing a dot reads.
            The lit dot's name, when the crowd had left it out, goes on top of the rest. */}
        {[
          ...points.flatMap(p => { const l = shownLabels.get(p.id); return l ? [{ p, l }] : [] }),
          ...(litLabel && litPoint ? [{ p: litPoint, l: litLabel }] : []),
        ].map(({ p, l }) => (
          <g key={`l${p.id}`} data-name-label="" pointerEvents="none" aria-hidden>
            {l.leader && <line {...l.leader} stroke={soft} strokeWidth={1} />}
            <text x={l.tx} y={l.ty} textAnchor={l.anchor} fill={ink} fontSize={LABEL_FONT}
              fontWeight={700} stroke={surface} strokeWidth={3} strokeLinejoin="round" paintOrder="stroke">{p.label}</text>
          </g>
        ))}
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

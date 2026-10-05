// WHERE EVERY BALL WENT: the season's batted balls on two fields, right-handed hitters beside
// left-handed ones, so the mirror image of pulling is the first thing a reader sees.
//
// ZONES, NEVER DOTS. The league publishes no hit coordinates; the only location is the scorer's
// wording ("singled to left field"), which places a ball in one of eleven zones and no finer
// (src/wpbl/derive/spray.ts). Dots jittered inside a zone would be positions we invented, on an
// image that outlives any correction, so this is the site's own shaded-zone chart and the footer
// says why.
//
// TWO FIELDS, NOT ONE, because pull and opposite field are defined by which box the hitter stood
// in. A single league chart averages a righty's pull into a lefty's opposite field and shows a
// field that nobody actually hits to. Switch hitters are left out for the same reason the season
// page leaves them out: the feed never says which side they batted from on a given ball.
//
// Regular season only (countsInStandings), matching the season page this links to; a number here
// that disagreed with the page under the link would be the first reply.
import { countsInStandings } from '../../src/wpbl/season'
import { applyPlayCorrections, type WpblPlayCorrection } from '../../src/wpbl/corrections'
import { isBattedBall, pullProfile, sprayZone, OUTFIELD_ZONES, type SprayZone } from '../../src/wpbl/derive/spray'
import type { WpblGame, WpblPlayer, WpblSprayPlay } from '../../src/wpbl/types'
import { P, readArchive, text, type Box, type Frame, type Visual } from './kit'

type Hand = 'R' | 'L'

interface Side {
  hand: Hand
  balls: number
  /** Share of this side's PLACED balls in each zone, 0..1. */
  share: Map<SprayZone, number>
  pullPct: number
}

interface Data {
  sides: Side[]
  total: number
  placed: number
  switchBalls: number
  rightyHr: number
  rightyHrLeft: number
}

// ─── Field geometry ─────────────────────────────────────────────────────────────
// Copied from src/wpbl/SprayChart.tsx, which is a React component and cannot be bundled for Node.
// Change the zones there, change them here: the visual has to read as the chart on the page.
const VW = 440, VH = 430
const CX = 220, CY = 360
const BASE = 100
const R_MOUND = 64, R_DIRT = 168, R_OUT = 286, R_BACKSTOP = 48
const R_LABEL = R_OUT + 16
const SPAN = 45

const ZONE_SHAPE: Record<SprayZone, [number, number, number, number]> = {
  LF: [-SPAN, -27, R_DIRT, R_OUT],
  LCF: [-27, -9, R_DIRT, R_OUT],
  CF: [-9, 9, R_DIRT, R_OUT],
  RCF: [9, 27, R_DIRT, R_OUT],
  RF: [27, SPAN, R_DIRT, R_OUT],
  '3B': [-SPAN, -22.5, R_MOUND, R_DIRT],
  SS: [-22.5, 0, R_MOUND, R_DIRT],
  '2B': [0, 22.5, R_MOUND, R_DIRT],
  '1B': [22.5, SPAN, R_MOUND, R_DIRT],
  P: [-SPAN, SPAN, 0, R_MOUND],
  C: [135, 225, 0, R_BACKSTOP],
}
const ALL_ZONES = Object.keys(ZONE_SHAPE) as SprayZone[]
const NAMED_INSIDE: readonly SprayZone[] = ['3B', 'SS', '2B', '1B', 'P', 'C']

// The site's dark-mode heat. Red rather than a club colour: two clubs' worth of hitters are on
// each field, and a team accent would claim them for one.
const HEAT = '#ef4444'
const LINE = '#3a4556'

const fmt = (n: number) => n.toLocaleString('en-US')

const LABEL: Record<Hand, string> = { R: 'RIGHT-HANDED HITTERS', L: 'LEFT-HANDED HITTERS' }

/** One field, scaled `s` with its top-left at (ox, oy). */
function field(side: Side, max: number, ox: number, oy: number, s: number): string {
  const polar = (r: number, deg: number): [number, number] => {
    const rad = (deg * Math.PI) / 180
    return [ox + (CX + r * Math.sin(rad)) * s, oy + (CY - r * Math.cos(rad)) * s]
  }
  const sector = (a1: number, a2: number, r0: number, r1: number): string => {
    const [x1, y1] = polar(r1, a1), [x2, y2] = polar(r1, a2)
    const R1 = (r1 * s).toFixed(1), R0 = (r0 * s).toFixed(1)
    const outer = `A${R1} ${R1} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`
    if (r0 <= 0) {
      const [hx, hy] = polar(0, 0)
      return `M${hx.toFixed(1)} ${hy.toFixed(1)} L${x1.toFixed(1)} ${y1.toFixed(1)} ${outer} Z`
    }
    const [x3, y3] = polar(r0, a2), [x4, y4] = polar(r0, a1)
    return `M${x1.toFixed(1)} ${y1.toFixed(1)} ${outer} L${x3.toFixed(1)} ${y3.toFixed(1)} A${R0} ${R0} 0 0 0 ${x4.toFixed(1)} ${y4.toFixed(1)} Z`
  }
  // Linear in share, floored so one ball still differs from none: the same rule as the page.
  const shade = (v: number) => (v === 0 ? 0 : 0.16 + 0.74 * (v / max))
  const out: string[] = []

  out.push(`<path d="${sector(-SPAN, SPAN, 0, R_DIRT)}" fill="${P.land}"/>`)
  out.push(`<path d="${sector(135, 225, 0, R_BACKSTOP)}" fill="${P.land}"/>`)
  const bases: [number, number][] = [[0, 0], [BASE, 45], [BASE * Math.SQRT2, 0], [BASE, -45]]
  out.push(`<path d="M${bases.map(([r, a]) => polar(r, a).map(v => v.toFixed(1)).join(' ')).join(' L')} Z" fill="none" stroke="${LINE}" stroke-width="${(1.5 * s).toFixed(2)}"/>`)

  for (const z of ALL_ZONES) {
    const [a1, a2, r0, r1] = ZONE_SHAPE[z]
    out.push(`<path d="${sector(a1, a2, r0, r1)}" fill="${HEAT}" fill-opacity="${shade(side.share.get(z) ?? 0).toFixed(3)}" stroke="${LINE}" stroke-width="${(0.9 * s).toFixed(2)}"/>`)
  }
  const [lfx, lfy] = polar(R_OUT, -SPAN), [rfx, rfy] = polar(R_OUT, SPAN), [hx, hy] = polar(0, 0)
  out.push(`<path d="M${lfx.toFixed(1)} ${lfy.toFixed(1)} L${hx.toFixed(1)} ${hy.toFixed(1)} L${rfx.toFixed(1)} ${rfy.toFixed(1)}" fill="none" stroke="${P.muted}" stroke-width="${(1.6 * s).toFixed(2)}"/>`)
  out.push(`<path d="${sector(-SPAN, SPAN, R_OUT - 2, R_OUT)}" fill="${P.muted}"/>`)

  // Figures last, so no shading can be painted over a number. White over the busy zones, the
  // panel's text colour over the faint ones: the fill is the heat and the number is the fact.
  for (const z of ALL_ZONES) {
    const v = side.share.get(z) ?? 0
    const [a1, a2, r0, r1] = ZONE_SHAPE[z]
    const t = r0 === 0 ? 0.55 : (r1 === R_DIRT ? 0.62 : 0.5)
    const [x, y] = polar(r0 + (r1 - r0) * t, (a1 + a2) / 2)
    const named = NAMED_INSIDE.includes(z)
    const ink = shade(v) >= 0.55 ? '#ffffff' : P.text
    const pct = v === 0 ? '' : v * 100 < 1 ? '<1%' : `${Math.round(v * 100)}%`
    const big = (z === 'C' ? 12 : 17) * s
    if (named) out.push(text(x, y - (pct ? 3 * s : -4 * s), z, 11 * s, ink, { weight: 700, anchor: 'middle', opacity: 0.85 }))
    if (pct) out.push(text(x, y + (named ? big * 0.95 : big * 0.35), pct, big, ink, { weight: 800, anchor: 'middle' }))
  }
  for (const z of OUTFIELD_ZONES) {
    const [a1, a2] = ZONE_SHAPE[z]
    const [x, y] = polar(R_LABEL, (a1 + a2) / 2)
    out.push(text(x, y + 4 * s, z, 12 * s, P.faint, { weight: 700, anchor: 'middle' }))
  }
  return out.join('')
}

/** A field with its heading, fitted into `b`. Returns the SVG and the y its drawing ends at. */
function panel(side: Side, max: number, b: Box, f: Frame): { svg: string; bottom: number } {
  const head = 15 * f.k, sub = 13 * f.k
  const headH = head + sub + 18 * f.k
  // The fan's drawable height starts at the outfield labels, not at y=0 of the viewBox.
  const top = CY - R_LABEL - 14
  const h = VH - top
  const s = Math.min(b.w / VW, (b.h - headH) / h)
  const ox = b.x + (b.w - VW * s) / 2
  const oy = b.y + headH - top * s
  const cx = b.x + b.w / 2
  return {
    svg: text(cx, b.y + head, LABEL[side.hand], head, P.text, { weight: 800, anchor: 'middle', spacing: 1.2 * f.k }) +
      text(cx, b.y + head + sub + 8 * f.k, `${fmt(side.balls)} balls in play`, sub, P.muted, { weight: 600, anchor: 'middle' }) +
      field(side, max, ox, oy, s),
    bottom: oy + VH * s,
  }
}

interface Fact { big: string; lines: string[] }

function facts(d: Data): Fact[] {
  const r = d.sides.find(x => x.hand === 'R')!, l = d.sides.find(x => x.hand === 'L')!
  return [
    { big: `${Math.round(r.pullPct)}%`, lines: ['pulled by right-handed', `hitters; ${Math.round(l.pullPct)}% by lefties`] },
    { big: `${d.rightyHrLeft} of ${d.rightyHr}`, lines: ['right-handed homers went', 'to left or left-center'] },
    { big: fmt(d.placed), lines: [`of ${fmt(d.total)} balls placed from`, 'the scorer\'s own words'] },
  ]
}

function factBlock(fs: Fact[], x: number, y: number, gap: number, big: number, small: number): string {
  return fs.map((fct, i) => {
    const top = y + i * gap
    return text(x, top + big * 0.8, fct.big, big, P.gold, { weight: 800 }) +
      fct.lines.map((ln, j) => text(x, top + big + small * 0.9 + 6 + j * small * 1.3, ln, small, P.soft)).join('')
  }).join('')
}

const visual: Visual<Data> = {
  slug: 'every-ball',
  title: 'Where every ball went',
  subtitle: ['Every ball put in play in the 2026 regular season,', 'by the side of the plate the hitter batted from'],
  path: '/wpbl/season',
  duration: 0,
  landscape: 'header',
  source: 'Data: WPBL league feed, scorer\'s play-by-play',

  async load() {
    const games = readArchive<WpblGame>('wpbl_games')
    const regular = new Set(games.filter(g => g.status === 'final' && countsInStandings(g)).map(g => g.id))
    // Corrections before anything else: a play credited to the wrong batter puts her ball on
    // the wrong side of the plate, and a filled-in narrative is a ball the raw mirror cannot place.
    const plays = applyPlayCorrections(
      readArchive<WpblSprayPlay>('wpbl_game_plays'),
      readArchive<WpblPlayCorrection>('wpbl_play_corrections'),
    ).filter(p => regular.has(p.game_id) && isBattedBall(p.event_type))
    const bats = new Map(readArchive<WpblPlayer>('wpbl_players').map(p => [p.id, (p.bats ?? '').trim().toUpperCase()[0] ?? '']))

    const sides: Side[] = (['R', 'L'] as const).map(hand => {
      const mine = plays.filter(p => bats.get(p.batter_id ?? '') === hand)
      const counts = new Map<SprayZone, number>()
      let placed = 0
      for (const p of mine) {
        const z = sprayZone(p.narrative)
        if (!z) continue
        placed++
        counts.set(z, (counts.get(z) ?? 0) + 1)
      }
      const share = new Map([...counts].map(([z, n]) => [z, n / placed] as [SprayZone, number]))
      return { hand, balls: mine.length, share, pullPct: pullProfile(mine, hand).pullPct ?? 0 }
    })

    const rightyHrs = plays.filter(p => p.event_type === 'home_run' && bats.get(p.batter_id ?? '') === 'R')
    const data: Data = {
      sides,
      total: plays.length,
      placed: plays.filter(p => sprayZone(p.narrative)).length,
      switchBalls: plays.filter(p => bats.get(p.batter_id ?? '') === 'S').length,
      rightyHr: rightyHrs.length,
      rightyHrLeft: rightyHrs.filter(p => { const z = sprayZone(p.narrative); return z === 'LF' || z === 'LCF' }).length,
    }
    console.log(JSON.stringify({ ...data, sides: sides.map(x => ({ ...x, share: Object.fromEntries(x.share) })) }, null, 1))
    return data
  },

  chart(d, _t, box, f) {
    // One scale for both fields, so a zone that looks hotter on one side IS a bigger share.
    const max = Math.max(...d.sides.flatMap(s => [...s.share.values()]))
    const fs = facts(d)
    if (f.landscape) {
      // Field, facts, field: the two mirror images either side of the numbers that explain them.
      const mid = 300
      const w = (box.w - mid) / 2
      return panel(d.sides[0], max, { x: box.x, y: box.y, w, h: box.h }, f).svg +
        panel(d.sides[1], max, { x: box.x + w + mid, y: box.y, w, h: box.h }, f).svg +
        factBlock(fs, box.x + w + 34, box.y + 18, 112, 34, 15)
    }
    // Portrait: the fields are width-bound, so they leave height over. The fields and the facts
    // move as one group, centred between the subtitle and the notes, so the slack is split evenly
    // rather than left as one dead band. The notes sit at the foot of the kit's extras region,
    // whose height this repeats (kit.ts, shell); 50 * k is the two note lines and their margin.
    const extrasH = (f.h === 1920 ? 300 : 250) * f.k / 1.35
    const areaEnd = box.y + box.h + 10 * f.k + extrasH - 50 * f.k
    const w = box.w / 2
    const fields = (y: number) => [
      panel(d.sides[0], max, { x: 24 * f.k, y, w: w - 24 * f.k, h: box.h }, f),
      panel(d.sides[1], max, { x: w, y, w: w - 24 * f.k, h: box.h }, f),
    ]
    const big = 34 * f.k, small = 14 * f.k
    const gap = 44 * f.k
    const factsH = big + small * 2.6 + 10
    const groupH = fields(box.y)[0].bottom - box.y + gap + factsH
    const [left, right] = fields(box.y + Math.max(0, (areaEnd - box.y - groupH) / 2))
    const y = left.bottom + gap
    const x0 = 64, colW = (box.w - 128) / 3
    return left.svg + right.svg + fs.map((fct, i) => {
      const x = x0 + i * colW
      return text(x, y + big * 0.8, fct.big, big, P.gold, { weight: 800 }) +
        fct.lines.map((ln, j) => text(x, y + big + small + 4 + j * small * 1.3, ln, small, P.soft)).join('')
    }).join('')
  },

  extras(d, _t, box, f) {
    const note = `Zones from the scorer's wording: the league records no hit coordinates. ` +
      `Switch hitters (${fmt(d.switchBalls)} balls) left out, since the feed never says which side they batted from.`
    if (f.landscape) {
      // The footer note sits on one line under the whole chart.
      return text(box.x, box.y + box.h - 10, note, 10.5, P.faint)
    }
    const n1 = `Zones from the scorer's wording: the league records no hit coordinates.`
    const n2 = `Switch hitters (${fmt(d.switchBalls)} balls) left out: the feed never says which side they batted from.`
    return text(box.x, box.y + box.h - 22 * f.k, n1, 10.5 * f.k, P.faint) +
      text(box.x, box.y + box.h - 22 * f.k + 15 * f.k, n2, 10.5 * f.k, P.faint)
  },
}

export default visual

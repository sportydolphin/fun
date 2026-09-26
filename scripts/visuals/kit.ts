/**
 * The Offseason Visuals kit: everything a share visual has in common, so each one in this folder
 * draws only its own chart.
 *
 * A visual is a `Visual` (below): a title, a loader, and a `chart` function that returns an SVG
 * fragment for time `t` inside the box it is given. The kit wraps that in the series frame (the
 * "Offseason Visual #N" tag, the title block, the footer), lays it out at three sizes, and turns
 * it into files: every frame rendered with resvg and piped into ffmpeg, so a clip never drops a
 * frame and two runs give the same bytes.
 *
 *   1200x630   Bluesky and link previews (the 1.91:1 band every og:image here uses)
 *   1080x1350  Instagram feed, Discord, Reddit
 *   1080x1920  stories (the top and bottom 250px stay clear of the app's own chrome)
 *
 * Type is Inter, the site's face. resvg reads TTF rather than the site's variable WOFF2, so the
 * first run cuts static weights out of public/fonts/InterVariable.woff2 with Python's fontTools
 * into node_modules/.cache.
 *
 * Run through scripts/make-visual.ts (`npm run visual -- <slug> --n <number>`).
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import ffmpegPath from 'ffmpeg-static'

// ─── The look ───────────────────────────────────────────────────────────────────

/** The series palette: one night panel for every visual, so the series reads as a series. */
export const P = {
  bg: '#0d1117', land: '#1f2735', coast: '#313c50', text: '#e6edf3', muted: '#9aa4b2',
  faint: '#6b7684', soft: '#c9d1d9', pin: '#ffffff', gold: '#e6c35c',
}
/** The four clubs in their DARK-surface accents, copied from WPBL_ACCENTS in
 *  src/wpbl/constants.ts rather than imported: that module pulls the team logos in as Vite
 *  assets, which an esbuild bundle for Node cannot load. Change them there, change them here. */
export const CLUBS = [
  { id: 'BOS', name: 'Hunters', color: '#37b06d' },
  { id: 'LA', name: 'Queens', color: '#d9ad4a' },
  { id: 'NY', name: 'Heights', color: '#5bb2ec' },
  { id: 'SF', name: 'Firebells', color: '#f05a5a' },
] as const
export const FAMILY = 'Inter'
export const FPS = 30

export interface Box { x: number; y: number; w: number; h: number }

export type FormatName = '1200x630' | '1080x1350' | '1080x1920'

export interface Frame {
  format: FormatName
  w: number
  h: number
  /** Type scale: 1 at the landscape size. Multiply every font size and stroke by it. */
  k: number
  landscape: boolean
}

// ─── A visual ───────────────────────────────────────────────────────────────────

export interface Visual<D = unknown> {
  slug: string
  title: string
  /** One or two short lines under the title. */
  subtitle: string[]
  /** The page on the site this links to, e.g. '/wpbl/league'. Printed in the footer. */
  path: string
  /** Seconds. 0 makes a still only. */
  duration: number
  /** Landscape layout: the title across the top ('header'), or in a column on the left
   *  ('column', for a chart that is wide and wants the full height). */
  landscape?: 'header' | 'column'
  /** Where the data came from, printed small in the footer. */
  source?: string
  load(): Promise<D>
  /** The chart at time `t` (seconds), drawn inside `box`. */
  chart(d: D, t: number, box: Box, f: Frame): string
  /** Optional extras under the chart (a counter, a legend, a fact or two), drawn inside `box`. */
  extras?(d: D, t: number, box: Box, f: Frame): string
}

// ─── Drawing helpers ────────────────────────────────────────────────────────────

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function text(x: number, y: number, s: string, size: number, fill: string, opts: {
  weight?: number; anchor?: 'start' | 'middle' | 'end'; spacing?: number; halo?: string; opacity?: number
} = {}): string {
  const { weight = 400, anchor = 'start', spacing, halo, opacity } = opts
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${FAMILY}" font-size="${size.toFixed(1)}" ` +
    `font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"` +
    (spacing ? ` letter-spacing="${spacing}"` : '') +
    (opacity != null ? ` opacity="${opacity.toFixed(3)}"` : '') +
    (halo ? ` stroke="${halo}" stroke-width="${(size / 3.5).toFixed(1)}" paint-order="stroke" stroke-linejoin="round"` : '') +
    `>${esc(s)}</text>`
}

/** The four clubs as a key, in a row or a column. Returns the SVG and how much room it took. */
export function clubKey(x: number, y: number, f: Frame, dir: 'row' | 'column' = 'row', size = 14): string {
  const s = size * f.k
  return CLUBS.map((c, i) => {
    const cx = dir === 'row' ? x + i * s * 8.4 : x
    const cy = dir === 'row' ? y : y + i * s * 1.75
    return `<circle cx="${(cx + s * 0.42).toFixed(1)}" cy="${(cy - s * 0.35).toFixed(1)}" r="${(s * 0.42).toFixed(1)}" fill="${c.color}"/>` +
      text(cx + s * 1.3, cy, c.name, s, P.soft, { weight: 600 })
  }).join('')
}

/** Fades a clipped edge of a picture into the panel, so a map or a photo does not end in a hard
 *  line. Pass the picture's box and which edges sit inside the frame. */
export function edgeFades(b: Box, edges: ('l' | 'r' | 't' | 'b')[], size = 70): string {
  const id = `fade${Math.round(b.x)}x${Math.round(b.y)}`
  const grad = (d: string) => {
    const [x1, y1, x2, y2] = d === 'l' ? [0, 0, 1, 0] : d === 'r' ? [1, 0, 0, 0] : d === 't' ? [0, 0, 0, 1] : [0, 1, 0, 0]
    return `<linearGradient id="${id}${d}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${P.bg}"/><stop offset="1" stop-color="${P.bg}" stop-opacity="0"/></linearGradient>`
  }
  const rect = (d: string) =>
    d === 'l' ? `<rect x="${b.x - 1}" y="${b.y}" width="${size}" height="${b.h}" fill="url(#${id}l)"/>`
      : d === 'r' ? `<rect x="${b.x + b.w - size + 1}" y="${b.y}" width="${size}" height="${b.h}" fill="url(#${id}r)"/>`
        : d === 't' ? `<rect x="${b.x}" y="${b.y - 1}" width="${b.w}" height="${size}" fill="url(#${id}t)"/>`
          : `<rect x="${b.x}" y="${b.y + b.h - size + 1}" width="${b.w}" height="${size}" fill="url(#${id}b)"/>`
  return `<defs>${edges.map(grad).join('')}</defs>${edges.map(rect).join('')}`
}

/** Fit something `w`x`h` inside a box, centred. Returns the scale and the top-left corner. */
export function fit(w: number, h: number, b: Box): { s: number; x: number; y: number } {
  const s = Math.min(b.w / w, b.h / h)
  return { s, x: b.x + (b.w - w * s) / 2, y: b.y + (b.h - h * s) / 2 }
}

export const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x)
export const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2)
/** 0 before `start`, 1 after `start + dur`, eased in between. */
export const tween = (t: number, start: number, dur: number) => easeInOut(clamp01((t - start) / dur))

// ─── The series frame ───────────────────────────────────────────────────────────

const FORMATS: Record<FormatName, Frame> = {
  '1200x630': { format: '1200x630', w: 1200, h: 630, k: 1, landscape: true },
  '1080x1350': { format: '1080x1350', w: 1080, h: 1350, k: 1.35, landscape: false },
  '1080x1920': { format: '1080x1920', w: 1080, h: 1920, k: 1.5, landscape: false },
}
export const FORMAT_NAMES = Object.keys(FORMATS) as FormatName[]

interface Regions { chart: Box; extras: Box }

/** The tag, title, subtitle and footer, and the two boxes left for the visual. */
function shell(v: Visual, f: Frame, n: number | null): { svg: string; regions: Regions } {
  const out: string[] = []
  const tag = (n != null ? `OFFSEASON VISUAL #${n}` : 'OFFSEASON VISUAL') + '  ·  WPBL 2026'
  const url = `sportydolphin.fun${v.path}`
  const { w, h, k } = f

  if (f.landscape && v.landscape === 'column') {
    const x = 44
    out.push(text(x, 64, tag, 11, P.gold, { weight: 700, spacing: 1.3 }))
    // A two-word-per-line title reads better in a 300px column than one long line.
    const words = v.title.split(' ')
    const mid = Math.ceil(words.length / 2)
    const lines = words.length > 2 ? [words.slice(0, mid).join(' '), words.slice(mid).join(' ')] : [v.title]
    lines.forEach((l, i) => out.push(text(x, 118 + i * 52, l, 46, P.text, { weight: 800 })))
    const subTop = 118 + (lines.length - 1) * 52 + 38
    v.subtitle.forEach((l, i) => out.push(text(x, subTop + i * 24, l, 18, P.muted)))
    out.push(text(x, h - 42, url, 12, P.faint, { weight: 600 }))
    if (v.source) out.push(text(x, h - 22, v.source, 10, P.faint))
    return {
      svg: out.join(''),
      regions: {
        chart: { x: 340, y: 16, w: w - 348, h: h - 32 },
        extras: { x, y: subTop + v.subtitle.length * 24 + 18, w: 290, h: h - 70 - (subTop + v.subtitle.length * 24 + 18) },
      },
    }
  }

  if (f.landscape) {
    const x = 48
    out.push(text(x, 54, tag, 12, P.gold, { weight: 700, spacing: 1.4 }))
    out.push(text(x, 96, v.title, 38, P.text, { weight: 800 }))
    v.subtitle.forEach((l, i) => out.push(text(x, 126 + i * 22, l, 17, P.muted)))
    const top = 126 + v.subtitle.length * 22 + 8
    out.push(text(w - 48, h - 22, url, 12, P.faint, { weight: 600, anchor: 'end' }))
    if (v.source) out.push(text(x, h - 22, v.source, 11, P.faint))
    return {
      svg: out.join(''),
      regions: {
        chart: { x: 40, y: top, w: w - 80, h: h - top - 84 },
        extras: { x, y: h - 76, w: w - 96, h: 44 },
      },
    }
  }

  // Portrait: header, chart across the full width, extras, footer.
  const story = f.h === 1920
  const x = 64
  const top = story ? 250 : 92
  const bottom = story ? h - 250 : h - 72
  out.push(text(x, top, tag, 13 * k, P.gold, { weight: 700, spacing: 1.5 * k }))
  out.push(text(x, top + 62 * k, v.title, 44 * k, P.text, { weight: 800 }))
  v.subtitle.forEach((l, i) => out.push(text(x, top + (96 + i * 26) * k, l, 19 * k, P.muted)))
  const headEnd = top + (96 + v.subtitle.length * 26) * k + 10 * k
  out.push(text(x, bottom, url, 12 * k, P.faint, { weight: 600 }))
  if (v.source) out.push(text(w - x, bottom, v.source, 10 * k, P.faint, { anchor: 'end' }))
  const extrasH = (story ? 300 : 250) * k / 1.35
  return {
    svg: out.join(''),
    regions: {
      chart: { x: 0, y: headEnd, w, h: bottom - 40 * k - extrasH - headEnd },
      extras: { x, y: bottom - 30 * k - extrasH, w: w - x * 2, h: extrasH },
    },
  }
}

export function frameSvg<D>(v: Visual<D>, d: D, f: Frame, t: number, n: number | null): string {
  const { svg, regions } = shell(v as Visual, f, n)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f.w}" height="${f.h}" viewBox="0 0 ${f.w} ${f.h}">` +
    `<rect width="${f.w}" height="${f.h}" fill="${P.bg}"/>` +
    v.chart(d, t, regions.chart, f) +
    (v.extras ? v.extras(d, t, regions.extras, f) : '') +
    svg + '</svg>'
}

// ─── Files ──────────────────────────────────────────────────────────────────────

const FONT_DIR = 'node_modules/.cache/visual-fonts'
const WEIGHTS = [400, 600, 700, 800]

export function ensureFonts(): string[] {
  const files = WEIGHTS.map(w => join(FONT_DIR, `Inter-${w}.ttf`))
  if (files.every(f => existsSync(f))) return files
  mkdirSync(FONT_DIR, { recursive: true })
  const py = `
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
for w in [${WEIGHTS.join(',')}]:
    f = TTFont('public/fonts/InterVariable.woff2')
    axes = {a.axisTag for a in f['fvar'].axes}
    inst = instantiateVariableFont(f, {'wght': w, **({'opsz': 14} if 'opsz' in axes else {})})
    inst.flavor = None
    for rec in inst['name'].names:
        if rec.nameID in (1, 16): rec.string = '${FAMILY}'
    inst['OS/2'].usWeightClass = w
    inst.save('${FONT_DIR}/Inter-%d.ttf' % w)
`
  execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', py], { stdio: 'inherit' })
  return files
}

export function renderPng(svg: string, fontFiles: string[]): Buffer {
  return new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: FAMILY } }).render().asPng()
}

export async function writeStill<D>(file: string, v: Visual<D>, d: D, f: Frame, t: number, n: number | null, fonts: string[]) {
  await writeFile(file, renderPng(frameSvg(v, d, f, t, n), fonts))
}

export async function writeVideo<D>(file: string, v: Visual<D>, d: D, f: Frame, n: number | null, fonts: string[]) {
  if (!ffmpegPath) throw new Error('ffmpeg-static has no binary for this platform')
  const ff = spawn(ffmpegPath as unknown as string, [
    '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', file,
  ], { stdio: ['pipe', 'inherit', 'inherit'] })
  const done = new Promise<void>((ok, fail) => ff.on('close', c => (c === 0 ? ok() : fail(new Error(`ffmpeg exited ${c}`)))))
  const frames = Math.round(v.duration * FPS)
  for (let i = 0; i < frames; i++) {
    const png = renderPng(frameSvg(v, d, f, i / FPS, n), fonts)
    if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r))
    if (i % 60 === 0) process.stdout.write(`\r  ${f.format}: frame ${i}/${frames}   `)
  }
  ff.stdin.end()
  await done
  process.stdout.write(`\r  ${f.format}: ${frames} frames → ${file}\n`)
}

export function formatFor(name: FormatName): Frame { return FORMATS[name] }

export function outDir(slug: string): string {
  const dir = join('share', 'visuals', slug)
  mkdirSync(dir, { recursive: true })
  return dir
}

// ─── Data ───────────────────────────────────────────────────────────────────────

/**
 * Every row of a table, as the anonymous client sees it. PAGED WITH A DETERMINISTIC ORDER on
 * purpose: PostgREST caps a bare read at 1000 rows with no error, and paging without a total
 * order can return one row twice and skip another (CLAUDE.md, "Read every row"). The play table
 * alone is past 3,700 rows.
 */
export async function fetchAll<T>(table: string, select: string, order: string): Promise<T[]> {
  const base = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!base || !key) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (in .env)')
  const rows: T[] = []
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const url = `${base.replace(/\/+$/, '')}/rest/v1/${table}?select=${encodeURIComponent(select)}&order=${encodeURIComponent(order)}&offset=${offset}&limit=${PAGE}`
    const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
    if (!res.ok) throw new Error(`${table} read failed: ${res.status} ${await res.text()}`)
    const page = await res.json() as T[]
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

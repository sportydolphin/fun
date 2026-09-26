#!/usr/bin/env node
/**
 * make-visual.ts: render one Offseason Visual into share files.
 *
 *   npm run visual -- <slug> --n 3             every size, video (if animated) and stills
 *   npm run visual -- <slug> --stills          stills only: the last frame, plus two mid-frames
 *                                              of an animated one, to check the look quickly
 *   npm run visual -- <slug> 1080x1350         just one size
 *   npm run visual -- --list                   what exists
 *
 * Files land in share/visuals/<slug>/ (gitignored), named with the series number when --n is
 * given, e.g. offseason-visual-03-home-runs-1080x1350.mp4. See scripts/visuals/kit.ts.
 */
import { join } from 'node:path'
import { readdirSync } from 'node:fs'
import { FORMAT_NAMES, ensureFonts, formatFor, outDir, writeStill, writeVideo, type FormatName } from './visuals/kit'
import { VISUALS } from './visuals/index'

const args = process.argv.slice(2)
if (args.includes('--list') || args.length === 0) {
  console.log('Visuals:\n' + Object.values(VISUALS).map(v => `  ${v.slug.padEnd(24)} ${v.duration ? `${v.duration.toFixed(1)}s` : 'still'}  ${v.title}`).join('\n'))
  process.exit(0)
}
const slug = args.find(a => !a.startsWith('--') && !FORMAT_NAMES.includes(a as FormatName) && !/^\d+$/.test(a))
const v = slug ? VISUALS[slug] : undefined
if (!v) { console.error(`No visual "${slug}". Try --list.`); process.exit(1) }
const nArg = args.indexOf('--n')
const n = nArg >= 0 ? Number(args[nArg + 1]) : null
if (n != null && !Number.isInteger(n)) { console.error('--n takes a whole number'); process.exit(1) }
const only = args.filter(a => FORMAT_NAMES.includes(a as FormatName)) as FormatName[]
const stills = args.includes('--stills') || v.duration === 0

const fonts = ensureFonts()
console.log(`Loading ${v.slug}…`)
const data = await v.load()
const dir = outDir(v.slug)
const base = (n != null ? `offseason-visual-${String(n).padStart(2, '0')}-` : '') + v.slug

for (const name of only.length ? only : FORMAT_NAMES) {
  const f = formatFor(name)
  if (stills) {
    await writeStill(join(dir, `${base}-${name}.png`), v, data, f, v.duration, n, fonts)
    if (v.duration > 0) {
      for (const at of [0.35, 0.65]) {
        const t = Math.round(v.duration * at * 10) / 10
        await writeStill(join(dir, `${base}-${name}-t${t}.png`), v, data, f, t, n, fonts)
      }
    }
    console.log(`  ${name}: stills`)
  } else {
    await writeVideo(join(dir, `${base}-${name}.mp4`), v, data, f, n, fonts)
    await writeStill(join(dir, `${base}-${name}.png`), v, data, f, v.duration, n, fonts)
  }
}
console.log(`✓ ${readdirSync(dir).length} files in ${dir}`)

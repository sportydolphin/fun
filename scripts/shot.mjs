#!/usr/bin/env node
/**
 * shot.mjs: one page, one width, one PNG, from headless Chrome.
 *
 *   npm run shot -- /wpbl/stats 375
 *   npm run shot -- /mlb/standings 1440 --theme dark
 *   npm run shot -- /wpbl 760 --full --text large
 *
 * Why it exists: looking at a page used to mean the desktop app's preview pane, and when the pane
 * was hidden its screenshots failed and a session rebuilt a throwaway Playwright script in a temp
 * folder, which went with the session (Nov 2026). This needs nothing on screen.
 *
 * Reuses the dev server at --base (http://localhost:5173) when one answers, and otherwise starts
 * Vite on that port for this one shot and stops it afterwards, so no server is left behind. The
 * PNG goes to `shots/` (gitignored) and its path is the last line printed.
 *
 * Flags: --theme light|dark (default: light), --full (the whole page, not the first screen),
 * --text large (the app's Large text setting), --out <file>, --base <url>, --wait <ms> (extra
 * settle time after the page goes quiet, default 800).
 * Uses your installed Chrome (playwright-core ships no browser); SWEEP_CHROME=<path> overrides.
 */

import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const flag = name => argv.includes(`--${name}`)
const valued = new Set(['theme', 'text', 'out', 'base', 'wait'])
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && valued.has(argv[i - 1].slice(2))))

// Git Bash rewrites an argument that starts with a slash into a Windows path (/wpbl/stats becomes
// C:/Program Files/Git/wpbl/stats) before node sees it, so that shape is turned back, and the
// leading slash is optional anyway.
const rawPath = positional[0] ?? '/'
const gitBash = /^[A-Za-z]:[\\/].*?[\\/]Git([\\/].*)$/.exec(rawPath)
const route = (gitBash ? gitBash[1].replace(/\\/g, '/') : rawPath).replace(/^\/?/, '/')
const width = Number(positional[1] ?? 1440)
const theme = opt('theme', 'light')
if (!Number.isFinite(width) || width < 200 || !['light', 'dark'].includes(theme)) {
  console.error('Usage: npm run shot -- <path> <width> [--theme light|dark] [--full] [--text large] [--out file]')
  process.exit(2)
}
const BASE = opt('base', 'http://localhost:5173').replace(/\/$/, '')
const WAIT = Number(opt('wait', '800'))
// The sweep's heights, so a shot at a width it checks is the screen it checks.
const HEIGHT = { 375: 812, 760: 1024, 960: 900, 1440: 900 }

const answers = () => fetch(BASE).then(r => r.ok, () => false)

/** Starts Vite on BASE's port when nothing answers there. Returns a stop function. */
async function ensureServer() {
  if (await answers()) return () => {}
  const port = new URL(BASE).port || '80'
  console.log(`Nothing answering at ${BASE}; starting Vite on port ${port} for this shot.`)
  // Through a shell because npx is npx.cmd on Windows, which spawn cannot run directly; one string,
  // since Node deprecates separate args with a shell. The port is digits from a parsed URL.
  const child = spawn(`npx vite --port ${Number(port)} --strictPort`, { shell: true, stdio: 'ignore' })
  const stop = () => {
    // The shell's child is Vite; on Windows only taskkill /T takes the whole tree down with it.
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill('SIGTERM')
  }
  for (let i = 0; i < 60; i++) {
    if (await answers()) return stop
    if (child.exitCode != null) break
    await new Promise(r => setTimeout(r, 1000))
  }
  stop()
  console.error(`Vite did not come up on ${BASE}. Start it yourself (npm run dev) and run this again.`)
  process.exit(2)
}

async function main() {
  const stopServer = await ensureServer()
  const browser = await chromium.launch(process.env.SWEEP_CHROME
    ? { executablePath: process.env.SWEEP_CHROME } : { channel: 'chrome' })
  try {
    const ctx = await browser.newContext({
      viewport: { width, height: HEIGHT[width] ?? 900 },
      // Below 768 the app is a phone: touch, no hover, the bottom nav (as in the layout sweep).
      isMobile: width < 768, hasTouch: width < 768,
      colorScheme: theme,
      serviceWorkers: 'block',
    })
    await ctx.addInitScript(scale => {
      try { localStorage.setItem('a11yTextScale', scale) } catch { /* private mode */ }
    }, opt('text', 'default') === 'large' ? 'large' : 'default')
    const page = await ctx.newPage()
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
    // The live poll can keep the network busy for ever, so idle is a hope, not a requirement.
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    // Until the skeletons have been gone for a full second, capped: the network goes quiet between
    // a page's first reads and the ones they unlock, and before React has drawn anything there is
    // no skeleton to see either. Both shot WPBL Stats as a column of gray bars on a first try. A
    // page that keeps one on purpose (an empty slot) still gets its picture after 15s.
    let clear = 0
    for (let t = 0; t < 60 && clear < 4; t++) {
      // index.html's static bar sits in #app until React replaces it on mounting.
      const loading = await page.evaluate(() => !!document.querySelector('#app > .sd-bar')
        || [...document.querySelectorAll('.MuiSkeleton-root, [aria-busy="true"]')].some(el => el.getBoundingClientRect().width > 0))
      clear = loading ? 0 : clear + 1
      await page.waitForTimeout(250)
    }
    if (clear < 4) console.log('Still loading after 15s; shooting it as it is.')
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
    await page.evaluate(() => document.fonts.ready)
    // A dialog sliding in, capped; a skeleton's pulse repeats for ever and is not waited on.
    await page.evaluate(() => Promise.race([
      Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))),
      new Promise(r => setTimeout(r, 2000)),
    ]))
    await page.waitForTimeout(WAIT)

    const slug = route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '_').replace(/_+$/, '') || 'root'
    const out = path.resolve(opt('out', path.join('shots', `${slug}-${width}${theme === 'dark' ? '-dark' : ''}.png`)))
    fs.mkdirSync(path.dirname(out), { recursive: true })
    await page.screenshot({ path: out, fullPage: flag('full') })
    console.log(out)
  } finally {
    await browser.close()
    stopServer()
  }
}

main().catch(err => { console.error(err); process.exit(1) })

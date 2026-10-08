#!/usr/bin/env node
/**
 * layout-sweep.mjs: the two layout checks CLAUDE.md asks for, run instead of eyeballed.
 *
 * 1. OVERFLOW. Every page, at 375 / 760 / 960 / 1440 and at both text sizes, for:
 *    - the page scrolling sideways,
 *    - text cut off by a box that hides its overflow (a hard clip, not an intended ellipsis),
 *    - text spilling visibly out of its own box, which is what a px box around rem type does
 *      the day someone enlarges the text ("a box whose content is wider than it is"),
 *    - text pushed off the right edge of the screen with nothing that scrolls to reach it.
 *    The rem/px rules can only be checked this way: tsc and lint see none of it.
 *
 * 2. LOADING SHIFT (--shift). Loads each page with ?devSlow, records where every piece of text
 *    sits while the skeleton is up, then again once the content lands, and reports what moved.
 *    The house rule is that a skeleton is the loaded page drawn empty, with the real titles in
 *    the real places, so a title that moves is a skeleton the wrong size. Compares rects rather
 *    than reading CLS, because a hidden or headless browser records no layout-shift entries.
 *
 * Every session that did this by hand rebuilt the same throwaway script, three times in one day
 * on Oct 7, 2026, which is why it lives here now.
 *
 * Runs against the dev server, never production: ?devSlow exists only in dev builds, and the dev
 * server's data is the real data, so the pages have something in them. Analytics skips automated
 * browsers (navigator.webdriver, see src/lib/analytics.ts), so a sweep is not a traffic spike.
 * Uses your installed Chrome (playwright-core ships no browser); SWEEP_CHROME=<path> overrides.
 *
 * Usage:
 *   npm run dev                                   # in another terminal
 *   npm run sweep                                 # overflow, every page, every size
 *   npm run sweep -- --shift                      # plus the loading-shift check
 *   npm run sweep -- --routes /wpbl,/wpbl/stats --widths 375,1440 --text large
 *   npm run sweep -- --ellipsis                   # also list intended "…" truncations
 *   npm run sweep -- --json sweep.json            # machine-readable, for diffing two runs
 *
 * Exits 1 when anything is reported, so it can gate a pull request once it has a place to run.
 */

import { chromium } from 'playwright-core'
import fs from 'node:fs'

// ─── Options ──────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const flag = name => argv.includes(`--${name}`)

const BASE = opt('base', 'http://localhost:5173').replace(/\/$/, '')
const WIDTHS = opt('widths', '375,760,960,1440').split(',').map(Number)
const TEXT = opt('text', 'default,large').split(',')
const SHIFT = flag('shift')
const ELLIPSIS = flag('ellipsis')
const JSON_OUT = opt('json', '')
const CONCURRENCY = Number(opt('concurrency', '4'))
// Long enough that every skeleton is still up when the first snapshot is taken, short of the 8s
// that trips the request timeout and renders "No teams yet" (CLAUDE.md, loading states).
const SLOW_MS = Number(opt('slow', '2500'))

const HEIGHT = { 375: 812, 760: 1024, 960: 900, 1440: 900 }

/** One player and one game page, taken from the sitemap so the sweep needs no database. */
function samplePages() {
  try {
    const xml = fs.readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8')
    const locs = [...xml.matchAll(/<loc>https?:\/\/[^/]+(\/[^<]*)<\/loc>/g)].map(m => m[1])
    return ['/wpbl/players/', '/wpbl/games/'].map(p => locs.find(l => l.startsWith(p) && l.length > p.length)).filter(Boolean)
  } catch { return [] }
}

const DEFAULT_ROUTES = [
  '/wpbl', '/wpbl/schedule', '/wpbl/standings', '/wpbl/stats', '/wpbl/teams', '/wpbl/teams/hunters',
  '/wpbl/players', '/wpbl/league', '/wpbl/season', '/wpbl/matchups', '/wpbl/awards', '/wpbl/compare',
  '/wpbl/reading', '/wpbl/watch', '/wpbl/glossary', ...samplePages(),
  '/mlb', '/mlb/scores', '/mlb/standings', '/mlb/leaders', '/mlb/stats', '/mlb/teams/mariners',
]
// The leading slash is optional because Git Bash rewrites an argument that starts with one into a
// Windows path (/wpbl becomes C:/Program Files/Git/wpbl) before node ever sees it.
const ROUTES = opt('routes', '')
  ? opt('routes', '').split(',').map(r => (r.startsWith('/') ? r : `/${r}`))
  : DEFAULT_ROUTES

// ─── In-page probes (run inside the browser, so plain DOM only) ──────────────

/** Every visible element that holds text of its own, with what the checks need to know. */
function probeOverflow(includeEllipsis) {
  const de = document.documentElement
  const vw = de.clientWidth
  const out = { pageOverflow: Math.max(0, de.scrollWidth - vw), issues: [] }
  const describe = el => {
    const text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60)
    const chain = []
    for (let n = el; n && n !== document.body && chain.length < 3; n = n.parentElement) {
      chain.unshift(n.tagName.toLowerCase() + (n.getAttribute('aria-label') ? `[${n.getAttribute('aria-label')}]` : ''))
    }
    return { text, where: chain.join(' > ') }
  }
  const scrollsX = n => { const o = getComputedStyle(n).overflowX; return o === 'auto' || o === 'scroll' }
  // An ancestor that scrolls OR clips sideways owns what lies past the edge: a table that scrolls,
  // or a carousel track parking the next slide off-screen (overflow hidden, by design).
  // Only one narrower than the screen counts: a page-wide `overflow-x: hidden` wrapper would
  // otherwise excuse every real off-screen bug under it.
  const containsX = n => scrollsX(n) || (getComputedStyle(n).overflowX !== 'visible' && n.getBoundingClientRect().width < vw - 1)
  for (const el of document.body.querySelectorAll('*')) {
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue
    const r = el.getBoundingClientRect()
    // A 1px box is the visually-hidden pattern (the SEO <h1> on every page): clipped by design.
    if (r.width <= 1 || r.height <= 1) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'inline') {
      // An inline box has no clientWidth to compare against; its block parent is checked instead.
      if (cs.display === 'inline' && r.right > vw + 1) {
        let n = el.parentElement, scrolled = false
        for (; n && n !== document.body; n = n.parentElement) if (containsX(n)) { scrolled = true; break }
        if (!scrolled) out.issues.push({ kind: 'offscreen', px: Math.round(r.right - vw), ...describe(el) })
      }
      continue
    }
    const over = el.scrollWidth - el.clientWidth
    // A single glyph (▸, a medal emoji) is often set in a box deliberately narrower than it, with
    // negative margins, so it can hang into the gutter. Words and numbers are what clip.
    const glyph = [...el.textContent.trim()].length === 1
    if (over > 1 && !(glyph && cs.overflowX === 'visible')) {
      if (cs.overflowX === 'visible') out.issues.push({ kind: 'spills', px: over, ...describe(el) })
      else if (cs.textOverflow === 'ellipsis') { if (includeEllipsis) out.issues.push({ kind: 'ellipsis', px: over, ...describe(el) }) }
      else if (!scrollsX(el)) out.issues.push({ kind: 'clipped', px: over, ...describe(el) })
    }
    if (r.right > vw + 1) {
      let n = el, scrolled = false
      for (; n && n !== document.body; n = n.parentElement) if (containsX(n)) { scrolled = true; break }
      if (!scrolled) out.issues.push({ kind: 'offscreen', px: Math.round(r.right - vw), ...describe(el) })
    }
  }
  return out
}

/** Where every piece of text sits, keyed by tag, text and repeat count. */
function probeAnchors() {
  const seen = new Map(), out = {}
  for (const el of document.body.querySelectorAll('*')) {
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim().replace(/\s+/g, ' ')
    if (!own || own.length > 80) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    // Text nobody can see cannot be seen to move. This is a skeleton's placeholder words: MUI's
    // Skeleton hides its children and draws its bar with `transform: scale(1, 0.6)`, which the
    // rect reports, so a stat label held open under a bar read as 40% shorter than the real one
    // (the awards sheet's "AVG", dh=5) when the box it reserves is exactly the loaded one.
    if (getComputedStyle(el).visibility === 'hidden') continue
    const base = `${el.tagName.toLowerCase()}|${own}`
    const nth = (seen.get(base) ?? 0) + 1
    seen.set(base, nth)
    out[`${base}|${nth}`] = { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }
  }
  return out
}

// ─── Driver ───────────────────────────────────────────────────────────────────

const settle = async (page, ms) => {
  // The live poll can keep the network busy for ever, so idle is a hope, not a requirement.
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
  await page.waitForTimeout(ms)
}

async function runCase(browser, route, width, text) {
  const ctx = await browser.newContext({
    viewport: { width, height: HEIGHT[width] ?? 900 },
    // Below 768 the app is a phone: touch, no hover, the bottom nav (usePhoneLayout and the raw
    // device queries both read this).
    isMobile: width < 768, hasTouch: width < 768,
  })
  await ctx.addInitScript(scale => {
    try { localStorage.setItem('a11yTextScale', scale) } catch { /* private mode */ }
  }, text === 'large' ? 'large' : 'default')
  const page = await ctx.newPage()
  const result = { route, width, text, pageOverflow: 0, issues: [], shifts: [], error: null }
  try {
    if (SHIFT) {
      const sep = route.includes('?') ? '&' : '?'
      await page.goto(`${BASE}${route}${sep}devSlow=${SLOW_MS}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(Math.min(1200, SLOW_MS / 2))
      const before = await page.evaluate(probeAnchors)
      await page.waitForTimeout(SLOW_MS)
      await settle(page, 800)
      const after = await page.evaluate(probeAnchors)
      // Only what was on screen while the skeleton was. Below the fold, a list of unknown length
      // (the schedule, Reading) must push the footer somewhere, and nobody sees it happen.
      const fold = HEIGHT[width] ?? 900
      for (const [key, a] of Object.entries(before)) {
        const b = after[key]
        if (!b || a.y >= fold) continue
        const dy = Math.round(b.y - a.y), dx = Math.round(b.x - a.x), dh = Math.round(b.h - a.h)
        if (Math.abs(dy) > 1 || Math.abs(dx) > 1 || Math.abs(dh) > 1) {
          result.shifts.push({ text: key.split('|')[1], y: Math.round(a.y), dy, dx, dh })
        }
      }
      result.shifts.sort((p, q) => p.y - q.y)
    }
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
    await settle(page, 600)
    const o = await page.evaluate(probeOverflow, ELLIPSIS)
    result.pageOverflow = o.pageOverflow
    result.issues = o.issues
  } catch (err) {
    result.error = String(err?.message ?? err).split('\n')[0]
  } finally {
    await ctx.close()
  }
  return result
}

async function main() {
  try {
    const res = await fetch(BASE)
    if (!res.ok) throw new Error(String(res.status))
  } catch {
    console.error(`Nothing answering at ${BASE}. Start the dev server first: npm run dev`)
    process.exit(2)
  }

  const browser = await chromium.launch(process.env.SWEEP_CHROME
    ? { executablePath: process.env.SWEEP_CHROME } : { channel: 'chrome' })
  const cases = ROUTES.flatMap(r => WIDTHS.flatMap(w => TEXT.map(t => [r, w, t])))
  const results = []
  let next = 0
  const worker = async () => {
    while (next < cases.length) {
      const [r, w, t] = cases[next++]
      const res = await runCase(browser, r, w, t)
      results.push(res)
      process.stderr.write(`\r${results.length}/${cases.length}`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  await browser.close()
  process.stderr.write('\n')

  results.sort((a, b) => ROUTES.indexOf(a.route) - ROUTES.indexOf(b.route) || a.width - b.width || a.text.localeCompare(b.text))
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(results, null, 2))

  let problems = 0
  for (const r of results) {
    const lines = []
    if (r.error) lines.push(`  ERROR ${r.error}`)
    if (r.pageOverflow > 0) lines.push(`  page scrolls sideways by ${r.pageOverflow}px`)
    // One line per distinct thing: a repeated row would otherwise print once per row.
    const seen = new Set()
    for (const i of r.issues) {
      const k = `${i.kind}|${i.text}`
      if (seen.has(k)) continue
      seen.add(k)
      lines.push(`  ${i.kind.padEnd(9)} ${String(i.px).padStart(4)}px  "${i.text}"  (${i.where})`)
    }
    if (r.shifts.length) {
      // The topmost thing that moved is where to look; everything under it usually moved with it.
      const top = r.shifts[0]
      lines.push(`  shift     ${r.shifts.length} moved while loading; first at y=${top.y}: "${top.text}" dy=${top.dy} dx=${top.dx} dh=${top.dh}`)
    }
    if (lines.length) {
      problems += lines.length
      console.log(`\n${r.route}  ${r.width}px  ${r.text} text`)
      for (const l of lines) console.log(l)
    }
  }
  console.log(problems ? `\n${problems} finding(s) across ${results.length} page loads.` : `\nClean: ${results.length} page loads.`)
  process.exit(problems ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(2) })

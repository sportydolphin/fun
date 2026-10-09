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
 * 3. RECORD AND REPLAY, which is what lets CI run this. CI has no `.env` and must not read the
 *    production database, and a page with no data is an empty state, which checks nothing. So
 *    `--record` captures every response the pages fetch (Supabase, StatsAPI) and the size of every
 *    image they draw into FIXTURE, and `--replay` serves the pages from it with the network shut.
 *    Both run with the clock frozen at the moment of recording, because the queries carry dates
 *    (today's scoreboard, "games since"), and a query that differs by a millisecond is a miss.
 *    Images come back as blank SVGs of the recorded size: a layout check needs the box, not the
 *    picture, and the bytes would make the fixture tens of megabytes.
 *    A replay that asks for something the fixture lacks FAILS rather than drawing an empty board,
 *    since an empty board passes every check and a sweep that quietly checks less is the failure
 *    this file exists to remove. Change a query, re-record: `npm run sweep:record`.
 *
 * 4. EXPERIMENTS (--experiments). Turns the experiments flag on, which no other check does.
 *    CLAUDE.md ("a fixed px size") is why: the seeding race sat behind the flag through the whole
 *    desktop rebuild and carried four scale bugs into September.
 *
 * Usage:
 *   npm run dev                                   # in another terminal
 *   npm run sweep                                 # overflow, every page, every size
 *   npm run sweep -- --shift                      # plus the loading-shift check
 *   npm run sweep -- --routes /wpbl,/wpbl/stats --widths 375,1440 --text large
 *   npm run sweep -- --ellipsis                   # also list intended "…" truncations
 *   npm run sweep -- --json sweep.json            # machine-readable, for diffing two runs
 *   npm run sweep:record                          # refresh FIXTURE from the real data (.env)
 *   npm run sweep -- --replay --shift --baseline  # what CI runs: no database, no network
 *   npm run sweep -- --replay --shift --update-baseline   # after fixing a known finding
 *   npm run sweep -- --experiments --routes wpbl/stats?board=runs
 *   npm run sweep -- --replay --shift --cpu 4      # CI's slower machine, to reproduce its timing
 *   npm run sweep -- --replay --shift --shots out  # save both frames of every case that shifts
 *   npm run sweep -- --replay --shift --shard 2/4  # the second of four slices, as CI runs it
 *
 * Exits 1 when anything is reported. CI runs it on every pull request (the `layout` job).
 */

import { chromium } from 'playwright-core'
import fs from 'node:fs'
import zlib from 'node:zlib'

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
const EXPERIMENTS = flag('experiments')
// CPU slowdown (Chrome's own throttling). A shift that depends on what is still loading when the
// first snapshot is taken can show on CI's runner and never on a fast desktop; this brings it home.
const CPU = Number(opt('cpu', '1'))
// Where to save the two frames of a case that shifted. CI uploads this directory when the job
// fails, because a shift that depends on timing may not happen again anywhere else, and a log
// line saying "2" moved 12px is not enough to tell a real move from the sweep misreading one.
const SHOTS = opt('shots', '')
const RECORD = flag('record')
const REPLAY = flag('replay')
const FIXTURE = new URL('./fixtures/layout-sweep.json.gz', import.meta.url)
// THE FINDINGS ALREADY ON MAIN when CI started running this: 94 of them, mostly the footer sitting
// above the fold under a skeleton shorter than the page it stands in for. A gate that failed on
// those would have to be switched off on day one, so they are listed here, and CI fails only on
// a finding NOT in the list. It is a to-do list, not an allowance: fix one, then shrink the list
// with --update-baseline (which a replay asks for when it sees an entry stop happening).
const UPDATE_BASELINE = flag('update-baseline')
const BASELINE = flag('baseline') || UPDATE_BASELINE
const BASELINE_FILE = new URL('./fixtures/layout-sweep-baseline.json', import.meta.url)
function readBaseline() {
  try { return new Set(JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))) } catch { return new Set() }
}

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
  '/wpbl', '/wpbl/schedule', '/wpbl/standings', '/wpbl/stats', '/wpbl/stats?board=fielding', '/wpbl/stats?board=runs', '/wpbl/teams', '/wpbl/teams/hunters',
  '/wpbl/players', '/wpbl/league', '/wpbl/season', '/wpbl/matchups', '/wpbl/awards', '/wpbl/compare',
  '/wpbl/reading', '/wpbl/watch', '/wpbl/glossary', ...samplePages(),
  '/mlb', '/mlb/scores', '/mlb/standings', '/mlb/leaders', '/mlb/stats', '/mlb/teams/mariners',
]
// The leading slash is optional because Git Bash rewrites an argument that starts with one into a
// Windows path (/wpbl becomes C:/Program Files/Git/wpbl) before node ever sees it.
const ALL_ROUTES = opt('routes', '')
  ? opt('routes', '').split(',').map(r => (r.startsWith('/') ? r : `/${r}`))
  : DEFAULT_ROUTES
// --shard i/n: every n-th route from the i-th, so CI can split the sweep across parallel jobs. By
// ROUTE rather than by page load, so each job warms only the routes it sweeps: warming all of them
// took a minute and a half of a thirteen-minute job before it was split.
const SHARD = /^(\d+)\/(\d+)$/.exec(opt('shard', '1/1'))
if (!SHARD || +SHARD[1] < 1 || +SHARD[1] > +SHARD[2]) {
  console.error('--shard takes i/n, with 1 <= i <= n')
  process.exit(2)
}
const ROUTES = ALL_ROUTES.filter((_, k) => k % +SHARD[2] === +SHARD[1] - 1)

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

/** Where every piece of text sits: for each tag and text, the boxes of every copy of it. */
function probeAnchors() {
  const out = {}
  // Whether an element rides in a fixed box (a dialog, the bottom bar), memoised up the tree.
  const fixed = new Map()
  const isFixed = el => {
    if (!el || el === document.body) return false
    if (!fixed.has(el)) fixed.set(el, getComputedStyle(el).position === 'fixed' || isFixed(el.parentElement))
    return fixed.get(el)
  }
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
    // Nor can text under an open modal, which MUI marks aria-hidden. /wpbl/awards is a dialog over
    // Home, and Home loading behind it is invisible; measured, its own "Fan awards" heading paired
    // with the dialog's title and failed CI on a slow runner.
    if (el.closest('[aria-hidden="true"]')) continue
    const key = `${el.tagName.toLowerCase()}|${own}`
    // A fixed box is measured against the screen and everything else against the document, so a
    // page that scrolls itself while loading (WPBL Home tucks the toolbar on a touch screen) does
    // not read as the dialog over it moving: /wpbl/awards' title "moved" 129px that way.
    const [ox, oy] = isFixed(el) ? [0, 0] : [scrollX, scrollY]
    ;(out[key] ??= []).push({ x: r.left + ox, y: r.top + oy, w: r.width, h: r.height })
  }
  return out
}

/** Lets a running transition finish (a dialog sliding in), capped, so a snapshot never measures
 *  something mid-flight. A skeleton's pulse repeats for ever and is not waited on. */
function settleAnimations() {
  const finite = document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity)
  return Promise.race([
    Promise.all(finite.map(a => a.finished.catch(() => {}))),
    new Promise(r => setTimeout(r, 2000)),
  ])
}

/**
 * Pairs each copy of a text with a copy of the same text in the loaded page, nearest first.
 * NOT BY DOCUMENT ORDER, which is what this did until Oct 2026: "the third 2" is a different
 * element once the loaded page has another "2" earlier in the DOM, and /wpbl/awards, whose ballot
 * ranks are a column of 2s and 3s, reported six shifts of about 1,500px that were nothing moving
 * at all. A real shift still shows, because every copy of the text moves with it; what this
 * cannot see is a copy that moves to exactly where another copy used to be.
 */
function pairAnchors(before, after) {
  const pairs = []
  for (const [key, as] of Object.entries(before)) {
    const bs = after[key]
    if (!bs) continue
    const cand = as.flatMap((a, i) => bs.map((b, j) => ({
      i, j, d: Math.abs(b.y - a.y) + Math.abs(b.x - a.x) + Math.abs(b.h - a.h) })))
    cand.sort((p, q) => p.d - q.d)
    const usedA = new Set(), usedB = new Set()
    for (const { i, j } of cand) {
      if (usedA.has(i) || usedB.has(j)) continue
      usedA.add(i); usedB.add(j)
      pairs.push({ text: key.slice(key.indexOf('|') + 1), a: as[i], b: bs[j] })
    }
  }
  return pairs
}

// ─── Record and replay ────────────────────────────────────────────────────────

/** What makes two requests the same request. Supabase is matched on path, not origin, because
 *  CI points the client at a placeholder URL (no `.env`); `prefer` and `range` change what
 *  PostgREST answers (a count, a page), and an RPC's arguments are its POST body. */
function requestKey(req) {
  const u = new URL(req.url())
  const supabase = /^\/(rest|functions|storage)\/v1\//.test(u.pathname)
  const h = req.headers()
  return [req.method(), supabase ? `supabase${u.pathname}${u.search}` : u.href,
    h.prefer ?? '', h.range ?? '', req.postData() ?? ''].join(' ')
}

/** The same idea for an image: one in Supabase storage is named by the client's URL, which CI changes. */
const imageKey = url => url.replace(/^https?:\/\/[^/]+(?=\/storage\/v1\/)/, 'supabase')

const fixture = { recordedAt: 0, responses: {}, images: {}, misses: new Set() }

function loadFixture() {
  try {
    Object.assign(fixture, JSON.parse(zlib.gunzipSync(fs.readFileSync(FIXTURE)).toString('utf8')))
    fixture.images = Object.fromEntries(Object.entries(fixture.images).map(([k, v]) => [imageKey(k), v]))
  } catch (err) {
    console.error(`No fixture to replay. Record one first: npm run sweep:record\n${err.message}`)
    process.exit(2)
  }
}

function saveFixture() {
  const { recordedAt, responses, images } = fixture
  fs.mkdirSync(new URL('.', FIXTURE), { recursive: true })
  fs.writeFileSync(FIXTURE, zlib.gzipSync(JSON.stringify({ recordedAt, responses, images }), { level: 9 }))
  console.log(`Recorded ${Object.keys(responses).length} responses and ${Object.keys(images).length} image sizes.`)
}

const isApp = url => url.startsWith(BASE)
const TEXTUAL = /json|text|javascript|xml|csv/

/** Wire a context for --record or --replay; a plain sweep leaves the network alone. */
async function wireContext(ctx) {
  if (!RECORD && !REPLAY) return
  await ctx.clock.setFixedTime(fixture.recordedAt)
  // And seed the dice: MLB's home feed picks its featured clubs and players at random, and a
  // different pick is a different request.
  await ctx.addInitScript(() => {
    let a = 0x5eed
    Math.random = () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  })
  if (RECORD) {
    ctx.on('response', async res => {
      const req = res.request()
      if (isApp(req.url()) || !['fetch', 'xhr'].includes(req.resourceType())) return
      const key = requestKey(req)
      if (key in fixture.responses) return
      try {
        const body = await res.body()
        const type = res.headers()['content-type'] ?? ''
        const keep = ['content-type', 'content-range', 'preference-applied']
        fixture.responses[key] = {
          status: res.status(),
          headers: Object.fromEntries(Object.entries(res.headers()).filter(([k]) => keep.includes(k))),
          ...(TEXTUAL.test(type) ? { text: body.toString('utf8') } : { base64: body.toString('base64') }),
        }
      } catch { /* a redirect or an aborted poll has no body; the next copy of it will */ }
    })
    return
  }
  await ctx.route(url => !isApp(url.href), async route => {
    const req = route.request()
    if (req.resourceType() === 'image') {
      const [w, h] = fixture.images[imageKey(req.url())] ?? [1, 1]
      return route.fulfill({ status: 200, contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#8884"/></svg>` })
    }
    const hit = fixture.responses[requestKey(req)]
    if (!hit) {
      fixture.misses.add(`${req.method()} ${req.url()}`)
      return route.abort()
    }
    return route.fulfill({ status: hit.status, headers: hit.headers,
      body: hit.text ?? Buffer.from(hit.base64, 'base64') })
  })
}

/** The natural size of every picture on the page, so a replay can draw a box that size. */
function probeImages() {
  return [...document.images].filter(i => i.complete && i.naturalWidth)
    .map(i => [i.currentSrc, i.naturalWidth, i.naturalHeight])
}

async function recordImages(page) {
  if (!RECORD) return
  for (const [src, w, h] of await page.evaluate(probeImages)) {
    if (!isApp(src)) fixture.images[imageKey(src)] = [w, h]
  }
}

// ─── Driver ───────────────────────────────────────────────────────────────────

const settle = async (page, ms) => {
  // The live poll can keep the network busy for ever, so idle is a hope, not a requirement.
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
  await page.waitForTimeout(ms)
}

async function runCase(browser, route, width, text, { warm = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height: HEIGHT[width] ?? 900 },
    // Below 768 the app is a phone: touch, no hover, the bottom nav (usePhoneLayout and the raw
    // device queries both read this).
    isMobile: width < 768, hasTouch: width < 768,
    // A service worker answers requests before page.route sees them, so a replay would leak.
    serviceWorkers: 'block',
  })
  await wireContext(ctx)
  await ctx.addInitScript(([scale, experiments]) => {
    try {
      localStorage.setItem('a11yTextScale', scale)
      if (experiments) localStorage.setItem('experimentalFeatures', '1')
    } catch { /* private mode */ }
  }, [text === 'large' ? 'large' : 'default', EXPERIMENTS])
  const page = await ctx.newPage()
  if (CPU > 1) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: CPU })
  const result = { route, width, text, pageOverflow: 0, issues: [], shifts: [], error: null }
  try {
    if (warm) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
      await settle(page, 300)
      return result
    }
    if (SHIFT) {
      const sep = route.includes('?') ? '&' : '?'
      await page.goto(`${BASE}${route}${sep}devSlow=${SLOW_MS}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(Math.min(1200, SLOW_MS / 2))
      await page.evaluate(settleAnimations)
      const before = await page.evaluate(probeAnchors)
      const beforeShot = SHOTS ? await page.screenshot() : null
      await page.waitForTimeout(SLOW_MS)
      await settle(page, 800)
      await recordImages(page)
      await page.evaluate(settleAnimations)
      const after = await page.evaluate(probeAnchors)
      // Only what was on screen while the skeleton was. Below the fold, a list of unknown length
      // (the schedule, Reading) must push the footer somewhere, and nobody sees it happen.
      const fold = HEIGHT[width] ?? 900
      for (const { text, a, b } of pairAnchors(before, after)) {
        if (a.y >= fold) continue
        const dy = Math.round(b.y - a.y), dx = Math.round(b.x - a.x), dh = Math.round(b.h - a.h)
        if (Math.abs(dy) > 1 || Math.abs(dx) > 1 || Math.abs(dh) > 1) {
          result.shifts.push({ text, y: Math.round(a.y), dy, dx, dh })
        }
      }
      result.shifts.sort((p, q) => p.y - q.y)
      if (SHOTS && result.shifts.length) {
        const name = `${route.replace(/[^a-z0-9]+/gi, '_')}-${width}-${text}${EXPERIMENTS ? '-exp' : ''}`
        fs.mkdirSync(SHOTS, { recursive: true })
        fs.writeFileSync(`${SHOTS}/${name}-before.png`, beforeShot)
        await page.screenshot({ path: `${SHOTS}/${name}-after.png` })
      }
    }
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
    await settle(page, 600)
    await recordImages(page)
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

  if (RECORD && REPLAY) {
    console.error('--record and --replay are opposites; pick one.')
    process.exit(2)
  }
  if (REPLAY) loadFixture()
  if (RECORD) fixture.recordedAt = Date.now()

  const browser = await chromium.launch(process.env.SWEEP_CHROME
    ? { executablePath: process.env.SWEEP_CHROME } : { channel: 'chrome' })

  // WARM THE DEV SERVER FIRST. Vite compiles each module on its first request and, when it meets a
  // dependency it has not pre-bundled, re-optimizes and RELOADS every open page. On a cold server
  // (CI, always) that lands inside the first cases: a skeleton snapshot taken before anything has
  // rendered, or a page reloaded between the two snapshots, reads as a layout shift.
  for (const r of ROUTES) await runCase(browser, r, WIDTHS[WIDTHS.length - 1], 'default', { warm: true })

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
  if (RECORD) saveFixture()

  results.sort((a, b) => ROUTES.indexOf(a.route) - ROUTES.indexOf(b.route) || a.width - b.width || a.text.localeCompare(b.text))
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(results, null, 2))

  const baseline = BASELINE ? readBaseline() : new Set()
  const found = new Set()
  let problems = 0, known = 0
  for (const r of results) {
    const lines = []
    // Each line carries the key it is known by in the baseline. A shift is keyed on the page and
    // size alone: which piece of text moves first varies from run to run, the fact that the
    // skeleton is the wrong size does not.
    const caseKey = `${r.route}${EXPERIMENTS ? ' +experiments' : ''}|${r.width}|${r.text}`
    if (r.error) lines.push([null, `  ERROR ${r.error}`])
    if (r.pageOverflow > 0) lines.push([`${caseKey}|page`, `  page scrolls sideways by ${r.pageOverflow}px`])
    // One line per distinct thing: a repeated row would otherwise print once per row.
    const seen = new Set()
    for (const i of r.issues) {
      const k = `${i.kind}|${i.text}`
      if (seen.has(k)) continue
      seen.add(k)
      lines.push([`${caseKey}|${k}`, `  ${i.kind.padEnd(9)} ${String(i.px).padStart(4)}px  "${i.text}"  (${i.where})`])
    }
    if (r.shifts.length) {
      // The topmost thing that moved is where to look; everything under it usually moved with it.
      const top = r.shifts[0]
      lines.push([`${caseKey}|shift`, `  shift     ${r.shifts.length} moved while loading; first at y=${top.y}: "${top.text}" dy=${top.dy} dx=${top.dx} dh=${top.dh}`])
    }
    const fresh = lines.filter(([k]) => !(k && baseline.has(k)))
    for (const [k] of lines) if (k) found.add(k)
    known += lines.length - fresh.length
    if (fresh.length) {
      problems += fresh.length
      console.log(`\n${r.route}  ${r.width}px  ${r.text} text`)
      for (const [, l] of fresh) console.log(l)
    }
  }
  if (BASELINE) {
    const covered = new Set(results.map(r => `${r.route}${EXPERIMENTS ? ' +experiments' : ''}|${r.width}|${r.text}`))
    const caseOf = k => k.split('|').slice(0, 3).join('|')
    if (UPDATE_BASELINE && !fixture.misses.size) {
      // Only the cases this run looked at are replaced, so a narrowed run (--routes) or the
      // experiments pass cannot wipe what the other run recorded.
      const merged = [...[...baseline].filter(k => !covered.has(caseOf(k))), ...found].sort()
      fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(merged, null, 2)}\n`)
      console.log(`\nBaseline now holds ${merged.length} known finding(s).`)
      process.exit(0)
    }
    const gone = [...baseline].filter(k => covered.has(caseOf(k)) && !found.has(k))
    if (known) console.log(`\n${known} known finding(s) in the baseline, not repeated here.`)
    if (gone.length) {
      console.log(`${gone.length} baseline finding(s) no longer happen. Fixed? Then: npm run sweep -- --replay --shift --update-baseline`)
      for (const g of gone) console.log(`  ${g}`)
    }
  }
  if (fixture.misses.size) {
    problems += fixture.misses.size
    console.log(`\n${fixture.misses.size} request(s) not in the fixture, so those pages were swept with less on them`)
    console.log('than they draw. A query changed: re-record with npm run sweep:record.')
    for (const m of [...fixture.misses].sort()) console.log(`  ${m.length > 200 ? `${m.slice(0, 200)}…` : m}`)
  }
  console.log(problems ? `\n${problems} finding(s) across ${results.length} page loads.` : `\nClean: ${results.length} page loads.`)
  process.exit(problems ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(2) })

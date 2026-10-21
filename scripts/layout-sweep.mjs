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
 *    And every outline (a box bordered on all four sides) at under 3:1 against what is behind it,
 *    in both themes (probeBorders, CLAUDE.md "Borders").
 *
 * 2. LOADING SHIFT (--shift), at the default text size only. Loads each page with ?devSlow,
 *    records where every piece of text sits while the skeleton is up, then again once the content
 *    lands, and reports what moved.
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
 *    FIXTURE is a directory, one gzipped file per response named by a hash of its request, plus
 *    `images.json` (one line per image) and `meta.json` (the clock). It was one .json.gz until
 *    Oct 2026, and any two pull requests that both re-recorded conflicted on it as a binary git
 *    cannot merge; now two branches that add different reads touch different files.
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
 *   npm run sweep:record -- --merge --routes mlb/compare   # add one page's reads to FIXTURE
 *   npm run sweep -- --replay --shift --baseline  # what CI runs: no database, no network
 *   npm run sweep -- --replay --shift --update-baseline   # after fixing a known finding
 *   npm run sweep -- --experiments --routes wpbl/stats?board=runs
 *   npm run sweep -- --replay --shift --cpu 4      # CI's slower machine, to reproduce its timing
 *   npm run sweep -- --replay --shift --shots out  # save both frames of every case that shifts
 *   npm run sweep -- --replay --shift --shard 2/8  # the second of eight slices, as CI runs it
 *
 * Exits 1 when anything is reported. CI runs it on every pull request (the `layout` job).
 */

import { chromium } from 'playwright-core'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import zlib from 'node:zlib'
import crypto from 'node:crypto'

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
// that trips the request timeout and renders "No teams" (CLAUDE.md, loading states).
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
// --record --merge: add to the fixture rather than replace it, with the clock frozen at ITS moment.
// For a new page or a new read on one page. A full re-record moves the clock and every page's data
// at once, so a pull request adding one route would also carry a day of unrelated data changes,
// and any finding they surface, under the same check.
const MERGE = flag('merge')
const FIXTURE = new URL('./fixtures/layout-sweep/', import.meta.url)
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
  // Fielding as a side of Leaders and Teams, and an Analysis board other than Run value (Oct 2026).
  '/wpbl/stats?side=fielding', '/wpbl/stats?board=teams&side=fielding', '/wpbl/stats?board=pitches',
  // The scatter plots, on the side that reads the play log and the one that reads WAR (Oct 2026).
  '/wpbl/stats?board=charts', '/wpbl/stats?board=charts&side=overall',
  '/wpbl/players', '/wpbl/league', '/wpbl/season', '/wpbl/matchups', '/wpbl/awards', '/wpbl/compare',
  // A season series that went on to meet in the final, the longest shape the page takes.
  '/wpbl/series/firebells-vs-queens',
  '/wpbl/reading', '/wpbl/watch', '/wpbl/glossary', ...samplePages(),
  // Naming who is in a photo, on the dev queue (src/wpbl/dev/devPhotoTagging.ts): the real queue is
  // unpublished photos, which a recorded snapshot must never hold, so the page is swept on the
  // published ones the gallery already shows.
  '/wpbl/photos/tag?devTagQueue=1',
  '/mlb', '/mlb/scores', '/mlb/standings', '/mlb/leaders', '/mlb/stats', '/mlb/team-stats', '/mlb/fielding', '/mlb/bests', '/mlb/find', '/mlb/teams/mariners', '/mlb/glossary', '/mlb/compare',
  '/mlb/charts', '/mlb/report-cards', '/mlb/leaders?lb=fielding', '/mlb/team-stats?lb=fielding',
  // Find with a question asked, in both sections: the rail, the table and the tally only exist once
  // there are matches, and the board switches between its layouts on its own width (Oct 2026).
  '/wpbl/stats?board=find&q=h.gte.3', '/mlb/find?q=h.gte.3',
  '/wpbl/stats?board=find&q=season~avg.gte.300', '/mlb/find?q=season~hr.gte.30',
  // One slot filled, and a pair: two hitters, the shape the pair's skeleton reserves.
  '/mlb/compare/zack-wheeler-554430', '/mlb/compare/bobby-witt-jr-677951-vs-julio-rodriguez-677594',
  // A player page, one of each role. None was swept until Oct 20, 2026, when the field reports found
  // the page's spinner letting the contract draw first and then jump a screen down (0.39 on a phone).
  '/mlb/players/francisco-lindor-596019', '/mlb/players/tarik-skubal-669373',
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
// WCAG 1.4.11's floor for the edge of a component, and CLAUDE.md's "Borders" rule.
const BORDER_FLOOR = 3
// axe-core, the accessibility engine behind Lighthouse and most browser audits, injected into each
// page after it settles. Its rules cover what only a rendered page can show: text
// contrast against what is really behind it, a control with no name, an image with no alt, an
// input with no label. axe has no rule for the contrast of a BORDER (1.4.11), which is why
// probeBorders above exists beside it.
const AXE_SOURCE = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
// The rules enforced, by name rather than by WCAG tag, so turning one on is a decision: each of
// these read clean on every page the day it was added. Text contrast, and every control, link,
// image and input carrying a name a screen reader can say.
const AXE_RULES = ['color-contrast', 'link-in-text-block', 'button-name', 'aria-command-name', 'link-name', 'image-alt', 'input-button-name', 'label', 'select-name']

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
    // SVG TEXT HAS NO BOX TO SPILL. A chart's <text> reports a scrollWidth and a clientWidth that
    // are the same meaningless number, and the label lies wherever the drawing puts it, so the box
    // checks below read every axis label on /mlb/charts as spilling (636 findings, none of them
    // real). Off the screen is still worth knowing, so that check alone runs for them.
    const svgText = el instanceof SVGElement
    const over = svgText ? 0 : el.scrollWidth - el.clientWidth
    // A single glyph (▸, a medal emoji) is often set in a box deliberately narrower than it, with
    // negative margins, so it can hang into the gutter. Words and numbers are what clip.
    // Counted as the reader sees it, by grapheme: ⚔️ and 🏖️ are two code points each (the emoji and a
    // variation selector), and counted by code point they read as a word that spills its box.
    const glyph = [...new Intl.Segmenter().segment(el.textContent.trim())].length === 1
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

/**
 * Every drawn outline that is too faint to see: a box bordered on all four sides (a card, a chip,
 * a button, a series box) whose edge comes out under `floor` against what is behind it.
 * CLAUDE.md's "Borders" rule, at WCAG's 3:1 for the edge of a component.
 *
 * WHAT COUNTS AS THE EDGE. The border against the first opaque color behind the box, after
 * compositing every translucent layer between them, with the box's own opacity (and its
 * ancestors') applied. If the box's FILL already stands out from what is behind it, the fill is
 * the edge and the border is decoration, so the better of the two is what is measured: a team-
 * colored chip needs no outline. A row rule (one side only) is not an outline and is not checked,
 * nor is anything disabled, which WCAG exempts. Anything over a background image or gradient is
 * skipped, since there is no single color to measure against.
 */
function probeBorders(floor) {
  const parse = c => {
    const m = c.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
    return [r, g, b, a]
  }
  const over = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3]))
  const lum = rgb => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])
  }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const pageBg = parse(getComputedStyle(document.body).backgroundColor) ?? [255, 255, 255, 1]
  /** The solid color behind `el`, or null over an image or a gradient. */
  const behind = el => {
    const layers = []
    for (let n = el.parentElement; n; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.backgroundImage !== 'none') return null
      const c = parse(cs.backgroundColor)
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break }
    }
    let base = pageBg.slice(0, 3)
    for (const l of layers.reverse()) base = over(l, base)
    return base
  }
  const out = []
  const seen = new Set()
  for (const el of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    const w = ['Top', 'Right', 'Bottom', 'Left'].map(sd => parseFloat(cs[`border${sd}Width`]))
    if (w.some(v => !(v >= 1)) || cs.borderTopStyle === 'none' || cs.borderTopStyle === 'hidden') continue
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const r = el.getBoundingClientRect()
    if (r.width < 12 || r.height < 12) continue
    if (el.matches(':disabled, [aria-disabled="true"]') || el.closest('[aria-hidden="true"]')) continue
    const border = parse(cs.borderTopColor)
    if (!border || border[3] === 0) continue
    const bg = behind(el)
    if (!bg) continue
    // OVER A PICTURE, NOT A PAGE: a rail's arrow or a play badge sits on a photo, which the
    // ancestors' backgrounds know nothing about, so there is no one color to measure against.
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    if (document.elementsFromPoint(cx, cy).some(n => !el.contains(n) && !n.contains(el) && /^(IMG|VIDEO|CANVAS|PICTURE)$/.test(n.tagName))) continue
    let opacity = 1
    for (let n = el; n; n = n.parentElement) opacity *= parseFloat(getComputedStyle(n).opacity)
    // Faded on purpose (an eliminated club's row in the bracket, at 50%), which is the same signal
    // as a disabled control and is exempt for the same reason; or faded out entirely (a rail arrow
    // with nothing to scroll to), which is not on screen at all.
    if (opacity < 0.75) continue
    const edge = ratio(over([...border.slice(0, 3), border[3] * opacity], bg), bg)
    const fill = parse(cs.backgroundColor)
    const fillEdge = fill && fill[3] > 0 ? ratio(over([...fill.slice(0, 3), fill[3] * opacity], bg), bg) : 1
    const best = Math.max(edge, fillEdge)
    if (best >= floor) continue
    const text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40)
    const key = `${cs.borderTopColor}|${text}`
    if (seen.has(key)) continue
    seen.add(key)
    const chain = []
    for (let n = el; n && n !== document.body && chain.length < 3; n = n.parentElement) {
      chain.unshift(n.tagName.toLowerCase() + (n.getAttribute('aria-label') ? `[${n.getAttribute('aria-label')}]` : ''))
    }
    out.push({ kind: 'border', px: Number(best.toFixed(2)), text: `${cs.borderTopColor} ${text}`.trim(), where: chain.join(' > ') })
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

// misses: request -> the routes that asked for it, so the report can name the re-record to run.
const fixture = { recordedAt: 0, responses: {}, images: {}, misses: new Map(), loaded: new Set() }

/** One file per response, named by its request: a branch that adds a read adds a file, and only
 *  two branches re-recording the SAME read can conflict. The key is kept inside for reading. */
const responseFile = key => `${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)}.json.gz`

function loadFixture() {
  try {
    const dir = fs.readdirSync(FIXTURE)
    fixture.recordedAt = JSON.parse(fs.readFileSync(new URL('meta.json', FIXTURE), 'utf8')).recordedAt
    fixture.images = Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(new URL('images.json', FIXTURE), 'utf8')))
      .map(([k, v]) => [imageKey(k), v]))
    for (const f of dir.filter(f => f.endsWith('.json.gz'))) {
      const { key, ...res } = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(f, FIXTURE))).toString('utf8'))
      fixture.responses[key] = res
      fixture.loaded.add(key)
    }
  } catch (err) {
    console.error(`No fixture to replay. Record one first: npm run sweep:record\n${err.message}`)
    process.exit(2)
  }
}

function saveFixture() {
  const { recordedAt, responses, images } = fixture
  fs.mkdirSync(FIXTURE, { recursive: true })
  // A full record replaces the fixture, so a read no page makes any more leaves with it. A merge
  // only adds, and rewrites nothing it did not record, which is what keeps its diff to its reads.
  const keep = new Set(Object.keys(responses).map(responseFile))
  if (!MERGE) for (const f of fs.readdirSync(FIXTURE)) if (f.endsWith('.json.gz') && !keep.has(f)) fs.rmSync(new URL(f, FIXTURE))
  for (const [key, res] of Object.entries(responses)) {
    const file = new URL(responseFile(key), FIXTURE)
    if (MERGE && fixture.loaded.has(key)) continue
    // mtime 0 in the gzip header, so recording the same answer twice writes the same bytes.
    fs.writeFileSync(file, zlib.gzipSync(JSON.stringify({ key, ...res }), { level: 9 }))
  }
  // Sorted, one image a line, so two branches' new images merge as text.
  const sorted = Object.keys(images).sort().map(k => `  ${JSON.stringify(k)}: ${JSON.stringify(images[k])}`)
  fs.writeFileSync(new URL('images.json', FIXTURE), `{\n${sorted.join(',\n')}\n}\n`)
  fs.writeFileSync(new URL('meta.json', FIXTURE), `${JSON.stringify({ recordedAt }, null, 2)}\n`)
  console.log(`Recorded ${Object.keys(responses).length} responses and ${Object.keys(images).length} image sizes.`)
}

const isApp = url => url.startsWith(BASE)
const TEXTUAL = /json|text|javascript|xml|csv/

/** Wire a context for --record or --replay; a plain sweep leaves the network alone. */
async function wireContext(ctx, route) {
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
  await ctx.route(url => !isApp(url.href), async handle => {
    const req = handle.request()
    if (req.resourceType() === 'image') {
      const [w, h] = fixture.images[imageKey(req.url())] ?? [1, 1]
      return handle.fulfill({ status: 200, contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#8884"/></svg>` })
    }
    const hit = fixture.responses[requestKey(req)]
    if (!hit) {
      const miss = `${req.method()} ${req.url()}`
      fixture.misses.set(miss, (fixture.misses.get(miss) ?? new Set()).add(route))
      return handle.abort()
    }
    return handle.fulfill({ status: hit.status, headers: hit.headers,
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
  await wireContext(ctx, route)
  await ctx.addInitScript(([scale, experiments]) => {
    try {
      localStorage.setItem('a11yTextScale', scale)
      if (experiments) localStorage.setItem('experimentalFeatures', '1')
      // The photo-tagging key is random per browser and rides in the queue call's POST body, which
      // is part of a recorded request's key: unpinned, every run asks a question the fixture lacks.
      localStorage.setItem('sd_photo_tag_key', 'layout-sweep-fixed-photo-tag-key')
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
    // ON THE DEFAULT TEXT SIZE ONLY. Large text is what breaks overflow, so that check keeps both
    // sizes; it almost never changes whether a skeleton is the size of the page it stands in for.
    // This pass is most of a case's fixed waits (devSlow, the first snapshot, the settle), so
    // running it at both sizes nearly doubled every CI slice to look again at the same skeletons.
    if (SHIFT && text === 'default') {
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
    // Both themes, on the same load: the theme follows the device until a reader picks one, so
    // flipping the emulated scheme re-renders the page in the other one without a second visit.
    // ON THE DEFAULT TEXT SIZE ONLY. A color, a contrast ratio or a control's name is the same at
    // Large text, and these two passes are the slowest part of a case, so running them at both
    // sizes doubled their cost in every CI slice and could never find anything new.
    if (text === 'default') {
      // Transitions off first: a border-color easing toward the new theme measures as a color that
      // is neither, and a probe that runs mid-fade reports outlines that do not exist.
      await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' })
      for (const scheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: scheme })
        await page.waitForTimeout(300)
        for (const i of await page.evaluate(probeBorders, BORDER_FLOOR)) result.issues.push({ ...i, text: `${scheme}: ${i.text}` })
        if (scheme === 'light') await page.addScriptTag({ content: AXE_SOURCE })
        const violations = await page.evaluate(async tags => {
          const r = await window.axe.run(document, { runOnly: { type: 'rule', values: tags }, resultTypes: ['violations'] })
          return r.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target.join(' '), html: n.html.slice(0, 80), summary: n.failureSummary?.split(String.fromCharCode(10)).slice(1).join(' ').slice(0, 120) })) }))
        }, AXE_RULES)
        for (const v of violations) for (const n of v.nodes) {
          result.issues.push({ kind: 'a11y', px: 0, text: `${scheme}: ${v.id} ${n.html}`, where: n.summary ?? n.target })
        }
      }
    }
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
  if (REPLAY || (RECORD && MERGE)) loadFixture()
  if (RECORD && !MERGE) fixture.recordedAt = Date.now()

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
      // A terminal only: piped (CI, an agent's shell) each \r is one more line of a log nobody reads.
      if (process.stderr.isTTY) process.stderr.write(`\r${results.length}/${cases.length}`)
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
      const measure = i.kind === 'border' ? `${i.px.toFixed(2)}:1` : i.kind === 'a11y' ? '' : `${String(i.px).padStart(4)}px`
      lines.push([`${caseKey}|${k}`, `  ${i.kind.padEnd(9)} ${measure}  "${i.text}"  (${i.where})`])
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
    // A shift key at Large text names a check runCase no longer makes, so this run neither clears
    // it nor calls it fixed. The keys still carry the text size, so an entry made before then reads.
    const checked = k => covered.has(caseOf(k)) && !(k.endsWith('|shift') && k.split('|')[2] !== 'default')
    if (UPDATE_BASELINE && !fixture.misses.size) {
      // Only the cases this run looked at are replaced, so a narrowed run (--routes) or the
      // experiments pass cannot wipe what the other run recorded.
      const merged = [...[...baseline].filter(k => !checked(k)), ...found].sort()
      fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(merged, null, 2)}\n`)
      console.log(`\nBaseline now holds ${merged.length} known finding(s).`)
      process.exit(0)
    }
    const gone = [...baseline].filter(k => checked(k) && !found.has(k))
    if (known) console.log(`\n${known} known finding(s) in the baseline, not repeated here.`)
    if (gone.length) {
      console.log(`${gone.length} baseline finding(s) no longer happen. Fixed? Then: npm run sweep -- --replay --shift --update-baseline`)
      for (const g of gone) console.log(`  ${g}`)
    }
  }
  if (fixture.misses.size) {
    problems += fixture.misses.size
    console.log(`\n${fixture.misses.size} request(s) not in the fixture, so those pages were swept with less on them`)
    console.log('than they draw. A query changed, so record what is missing (needs .env), and commit the fixture:')
    // Without the leading slash, which Git Bash would rewrite into a Windows path.
    const routes = [...new Set([...fixture.misses.values()].flatMap(r => [...r]))].map(r => r.replace(/^\//, ''))
    console.log(`\n  npm run sweep:record -- --merge --routes ${routes.join(',')}\n`)
    console.log('or run the "Sweep: record" workflow on the branch (docs/CI.md). The reads:')
    for (const m of [...fixture.misses.keys()].sort()) console.log(`  ${m.length > 200 ? `${m.slice(0, 200)}…` : m}`)
  }
  console.log(problems ? `\n${problems} finding(s) across ${results.length} page loads.` : `\nClean: ${results.length} page loads.`)
  process.exit(problems ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(2) })

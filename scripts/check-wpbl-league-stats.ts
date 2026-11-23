/**
 * check-wpbl-league-stats.ts: compare our season totals with the ones the league prints.
 *
 * WHY THIS EXISTS. Every other check tests us against ourselves, the play log or RetroWPBL's hand
 * transcription. None asks whether our season lines match the league's own. That is the gap the
 * 2026 ERA mistake lived in: we computed ERA per 9 innings after the league had moved to per 7,
 * and nothing noticed, because nothing looked at the league's printed ERA.
 *
 * WHY THE PLAYER PAGES AND NOT THE FEED. The feed's box score carries `obp`, `slg`, `ops` and
 * `whip` on each line, which look like the league's figures and are not useful: they are that one
 * game's rates, recomputed from the counts on the same line, so they can only agree with what we
 * mirror. The `whip` is also wrong for partial innings (it reads "3.1" as 3.1, not 3 1/3: Jaida
 * Lee's 0.1 inning with five runners prints 50.00, not 15.00). The feed has no season endpoint.
 * The league site's player pages (the box score's `profile_url`) do print season lines, summed on
 * their side, for both the regular season and the postseason. Those are the league's figures.
 *
 * WHAT A MATCH PROVES, AND WHAT IT DOES NOT. The site is fed by the same Presto data as the feed,
 * so agreement does not show a game was scored right (RetroWPBL is the independent check for
 * that). It shows our totals use the league's definitions (ERA basis, the OBP denominator, which
 * games count, what G means) and that no correction reached their totals without reaching ours.
 *
 * RUN IT ONCE OR TWICE A SEASON, BY HAND: opening week, when a definition is most likely to have
 * changed, and after the postseason. It is a scraper of someone's web pages, so it is not a
 * nightly job: a layout change would be a red run nobody needs. A page it cannot read is reported
 * as an error, never as a match.
 *
 * POLITE BY DESIGN. robots.txt allows /players/, but the site's Cloudflare cut a quick curl loop
 * off after about eight requests (Nov 23, 2026). So one request at a time, DELAY_MS apart, with a
 * backoff on failure. A full season is about 150 pages and takes ten minutes.
 *
 * Usage:
 *   npm run check-league-stats                       # the latest season
 *   npm run check-league-stats -- --season 2026
 *   npm run check-league-stats -- --player kelsie-whitmore
 *   npm run check-league-stats -- --cache            # keep pages in node_modules/.cache, for reruns
 *   npm run check-league-stats -- --json
 *
 * Needs VITE_SUPABASE_URL and the anon key (it only reads). Exits 1 on any gap or unread page.
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { cleanSchedule } from '../src/wpbl/gameOver'
import { seasonOf } from '../src/wpbl/season'
import {
  aggregateBatting, aggregateFielding, aggregatePitching,
  type WpblBattingTotals, type WpblFieldingTotals, type WpblPitchingTotals,
} from '../src/wpbl/stats'
import type { WpblBattingLine, WpblFieldingLine, WpblGame, WpblPitchingLine, WpblPlayer } from '../src/wpbl/types'

const FEED = 'https://stats.womensprobaseballleague.com/v1'
const SITE = 'https://www.womensprobaseballleague.com'
const DELAY_MS = 3000
const UA = 'Mozilla/5.0 (compatible; sportydolphin-stat-check)'

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] ?? null : null
}
const JSON_OUT = process.argv.includes('--json')
const USE_CACHE = process.argv.includes('--cache')
const ONE_PLAYER = arg('--player')
const CACHE_DIR = 'node_modules/.cache/league-pages'

// Made in main, not here, so the test can import the parser without a database.
let db: ReturnType<typeof createClient>

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Every row, paged and ordered: a bare select stops at 1000 in silence. */
async function readAll<T>(table: string, order: string[]): Promise<T[]> {
  const out: T[] = []
  let total: number | null = null
  for (let from = 0; total == null || from < total; from += 1000) {
    let q = db.from(table).select('*', { count: 'exact' })
    for (const col of order) q = q.order(col, { ascending: true })
    const { data, error, count } = await q.range(from, from + 999)
    if (error) throw new Error(`${table} read failed: ${error.message}`)
    total = count ?? 0
    out.push(...((data ?? []) as T[]))
    if (!data || data.length === 0) break
  }
  if (out.length !== total) throw new Error(`${table}: read ${out.length} of ${total} rows`)
  return out
}

// ─── reading the league's page ───────────────────────────────────────────────

export interface LeagueTable { header: string[]; rows: { label: string; cells: string[] }[] }

const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
  .replace(/&#0?39;|&#8217;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

/**
 * The "Season Statistics" tables, keyed by their h3 (Batting, Pitching, Fielding). Columns are
 * read from the header's abbreviations, never by position, so a column the league adds or moves
 * lands in the right place or is ignored.
 */
export function parseSeasonTables(html: string): Map<string, LeagueTable> {
  const out = new Map<string, LeagueTable>()
  const start = html.indexOf('Season Statistics')
  const end = html.indexOf('Game Log', start)
  if (start < 0) return out
  const section = html.slice(start, end > -1 ? end : undefined)
  const re = /<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<table[^>]*wpbl-player-stats__table[^>]*>([\s\S]*?)<\/table>/g
  for (const m of section.matchAll(re)) {
    const title = text(m[1]).toLowerCase()
    const thead = m[2].match(/<thead>([\s\S]*?)<\/thead>/)?.[1] ?? ''
    const header = [...thead.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(h => text(h[1]).toUpperCase())
    const tbody = m[2].match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? ''
    const rows = [...tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(r => {
      const cells = [...r[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(c => text(c[1]))
      return { label: cells[0] ?? '', cells: cells.slice(1) }
    })
    out.set(title, { header: header.slice(1), rows })
  }
  return out
}

/** Accents off, case folded, spaces collapsed, so "Maïka" on one side meets "Maika" on the other. */
export const normName = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim()

/** The site's slug for a name: "Mo'ne Davis" is `mone-davis`. */
export const slugOf = (name: string): string => normName(name).replace(/['’.]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** The player's name from the page's own heading. */
export const pageName = (html: string): string =>
  normName(text(html.match(/<h1[^>]*wpbl-player-bio__name[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? ''))

/** The page's own message for a season it has no line for: "No statistics available for 2026 ·
 *  Postseason." or "Statistics are temporarily unavailable." */
export const emptyNotice = (html: string): string | null =>
  text(html).match(/No statistics available for [^.]*\.|Statistics are temporarily unavailable\./)?.[0] ?? null

/** Whether the page's transactions show a trade in `year`. The league's page for a player traded
 *  mid-season counts only the games before the trade (Diana Ibarra and Suzu Narasaki, traded for
 *  each other on Aug 21, 2026), so a shortfall on such a page is theirs, not ours. */
export const tradedIn = (html: string, year: number): boolean =>
  new RegExp(`[A-Z][a-z]{2} \\d{1,2}, ${year} Traded`).test(text(html))

/** Innings as the league prints them ("24.0", "6.2") to outs. */
export const ipToOuts = (ip: string): number => {
  const [whole, third = '0'] = ip.split('.')
  return Number(whole) * 3 + Number(third)
}

/**
 * The column map: the league's header to our field. `rate` columns are compared at the league's
 * printed precision; everything else must match exactly. Fielding's GS is left out because our
 * fielding lines do not carry starts. Pitching SV and fielding DP are left out because the league
 * does not fill them: every one of the 2026 pages printed 0 in both (Nov 23, 2026), against
 * saves and double plays the box scores do record. Put them back when a page prints one.
 */
type Col = { ours: string; kind: 'count' | 'ip' | 'rate3' | 'rate2' }
export const BATTING_COLS: Record<string, Col> = {
  G: { ours: 'g', kind: 'count' }, AB: { ours: 'ab', kind: 'count' }, R: { ours: 'r', kind: 'count' },
  H: { ours: 'h', kind: 'count' }, '2B': { ours: 'doubles', kind: 'count' }, '3B': { ours: 'triples', kind: 'count' },
  HR: { ours: 'hr', kind: 'count' }, RBI: { ours: 'rbi', kind: 'count' }, BB: { ours: 'bb', kind: 'count' },
  SO: { ours: 'so', kind: 'count' }, SB: { ours: 'sb', kind: 'count' },
  AVG: { ours: 'avg', kind: 'rate3' }, OBP: { ours: 'obp', kind: 'rate3' },
  SLG: { ours: 'slg', kind: 'rate3' }, OPS: { ours: 'ops', kind: 'rate3' },
}
export const PITCHING_COLS: Record<string, Col> = {
  G: { ours: 'g', kind: 'count' }, GS: { ours: 'gs', kind: 'count' }, W: { ours: 'w', kind: 'count' },
  L: { ours: 'l', kind: 'count' }, ERA: { ours: 'era', kind: 'rate2' }, IP: { ours: 'outs', kind: 'ip' },
  H: { ours: 'h', kind: 'count' }, R: { ours: 'r', kind: 'count' }, ER: { ours: 'er', kind: 'count' },
  BB: { ours: 'bb', kind: 'count' }, SO: { ours: 'so', kind: 'count' }, HR: { ours: 'hr', kind: 'count' },
}
export const FIELDING_COLS: Record<string, Col> = {
  G: { ours: 'g', kind: 'count' }, PO: { ours: 'po', kind: 'count' }, A: { ours: 'a', kind: 'count' },
  E: { ours: 'e', kind: 'count' }, TC: { ours: 'tc', kind: 'count' },
  FPCT: { ours: 'fpct', kind: 'rate3' },
}

const RATE_STATS = new Set(['AVG', 'OBP', 'SLG', 'OPS', 'ERA', 'FPCT'])
/** A gap's printed figure back to a number: innings ("23.2") as outs, a count as itself. */
const ipOrCount = (v: string): number => (v.includes('.') ? ipToOuts(v) : Number(v))

export interface Gap { player: string; scope: string; group: string; stat: string; league: string; ours: string }

/** A rate printed to `digits` places agrees when ours rounds to the same figure; a hair of slack
 *  covers a sum that lands exactly on a half. A dash on their side means no value. */
function rateAgrees(league: string, ours: number | null, digits: number): boolean {
  if (league === '' || league === '—' || league === '-') return ours == null
  if (ours == null) return false
  return Math.abs(Number(league) - ours) <= 0.5 * 10 ** -digits + 1e-9
}

const show = (v: unknown, kind: Col['kind']): string => {
  if (v == null) return '—'
  if (kind === 'ip') return `${Math.floor(Number(v) / 3)}.${Number(v) % 3}`
  if (kind === 'rate3') return Number(v).toFixed(3)
  if (kind === 'rate2') return Number(v).toFixed(2)
  return String(v)
}

/**
 * One table against our totals. A player who changed clubs mid-season would get one row per
 * club; their counts are summed and the rates skipped, since a rate cannot be summed and we
 * would be comparing ours with a figure nobody printed.
 */
export function compareTable(
  table: LeagueTable | undefined, cols: Record<string, Col>,
  ours: Record<string, number | null> | null, year: number,
  who: { player: string; scope: string; group: string },
): { gaps: Gap[]; error: string | null } {
  const rows = (table?.rows ?? []).filter(r => r.label.startsWith(String(year)))
  if (rows.length === 0 && !ours) return { gaps: [], error: null }
  const gaps: Gap[] = []
  const gap = (stat: string, league: string, v: string) => gaps.push({ ...who, stat, league, ours: v })
  if (rows.length === 0) { gap('line', 'none', 'present'); return { gaps, error: null } }
  const header = table!.header
  // A designated hitter's game: the league prints a fielding row with no chances, and the feed
  // sends no fielding line for it, so we have none. Both say the same thing.
  const tc = header.indexOf('TC')
  if (!ours && tc > -1 && rows.every(r => Number(r.cells[tc]) === 0)) return { gaps, error: null }
  if (!ours) { gap('line', 'present', 'none'); return { gaps, error: null } }
  const unknown = Object.keys(cols).filter(k => !header.includes(k))
  if (unknown.length) return { gaps, error: `${who.group} table lacks ${unknown.join(', ')}; the layout changed` }
  for (const [label, col] of Object.entries(cols)) {
    const i = header.indexOf(label)
    const ourV = ours[col.ours] ?? null
    if (col.kind === 'rate3' || col.kind === 'rate2') {
      if (rows.length > 1) continue
      if (!rateAgrees(rows[0].cells[i], ourV, col.kind === 'rate3' ? 3 : 2)) gap(label, rows[0].cells[i], show(ourV, col.kind))
      continue
    }
    const league = rows.reduce((s, r) => s + (col.kind === 'ip' ? ipToOuts(r.cells[i]) : Number(r.cells[i])), 0)
    if (!Number.isFinite(league)) return { gaps, error: `${who.group} ${label} is not a number: "${rows.map(r => r.cells[i]).join(', ')}"` }
    if (league !== (ourV ?? 0)) gap(label, show(league, col.kind), show(ourV ?? 0, col.kind))
  }
  return { gaps, error: null }
}

// ─── fetching, politely ──────────────────────────────────────────────────────

let lastSiteFetch = 0
async function sitePage(url: string): Promise<string> {
  const key = url.replace(/[^a-z0-9]+/gi, '_')
  const file = path.join(CACHE_DIR, `${key}.html`)
  if (USE_CACHE && fs.existsSync(file)) return fs.readFileSync(file, 'utf8')
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastSiteFetch + DELAY_MS * (attempt === 0 ? 1 : 10 * attempt) - Date.now()
    if (wait > 0) await sleep(wait)
    lastSiteFetch = Date.now()
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA } })
      if (res.status === 404) throw new Error('404')
      if (!res.ok) continue
      const html = await res.text()
      if (USE_CACHE) { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(file, html) }
      return html
    } catch (e) {
      if ((e as Error).message === '404') throw new Error(`${url} → 404`)
    }
  }
  throw new Error(`${url}: no answer after 4 tries`)
}

interface FeedPlayer { id: string; name: string; profile_url?: string }

/** Each player's page, from the box scores of the season's games: the feed is the only place
 *  that links our player (by `api_ids`) to the league's page. */
async function profileUrls(games: WpblGame[]): Promise<Map<string, { url: string; name: string }>> {
  const byFeedId = new Map<string, { url: string; name: string }>()
  for (const g of games) {
    if (!g.api_game_id) continue
    const res = await fetch(`${FEED}/games/${g.api_game_id}/boxscore`)
    if (!res.ok) throw new Error(`boxscore ${g.api_game_id} → ${res.status}`)
    const box = (await res.json()).boxscore
    for (const t of box?.teams ?? []) for (const p of (t.players ?? []) as FeedPlayer[]) {
      if (p.profile_url) byFeedId.set(String(p.id), { url: p.profile_url, name: p.name })
    }
  }
  return byFeedId
}

// ─── the run ─────────────────────────────────────────────────────────────────

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
  const key = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!supabaseUrl || !key) {
    console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (try: npm run check-league-stats)')
    process.exit(2)
  }
  db = createClient(supabaseUrl, key, { auth: { persistSession: false } })
  const [rawGames, players, batting, pitching, fielding] = await Promise.all([
    readAll<WpblGame>('wpbl_games', ['game_date', 'id']),
    readAll<WpblPlayer>('wpbl_players', ['id']),
    readAll<WpblBattingLine>('wpbl_batting_lines', ['id']),
    readAll<WpblPitchingLine>('wpbl_pitching_lines', ['id']),
    readAll<WpblFieldingLine>('wpbl_fielding_lines', ['id']),
  ])
  const schedule = cleanSchedule(rawGames)
  const years = [...new Set(schedule.filter(g => g.status === 'final').map(seasonOf))].filter((y): y is number => y != null)
  const year = Number(arg('--season') ?? Math.max(...years))
  // Every bulk read is every season: cut to this one before summing.
  const games = schedule.filter(g => seasonOf(g) === year)
  const ids = new Set(games.map(g => g.id))
  const cut = <T extends { game_id: string }>(ls: T[]) => ls.filter(l => ids.has(l.game_id))
  const [bat, pit, fld] = [cut(batting), cut(pitching), cut(fielding)]

  const finals = games.filter(g => g.status === 'final')
  if (!JSON_OUT) console.log(`${year}: ${finals.length} finals. Reading box scores for player pages...`)
  const pages = await profileUrls(finals)

  const scopes = ['regular', 'postseason'] as const
  const ours = new Map<string, Record<string, Record<string, Record<string, number | null> | null>>>()
  for (const scope of scopes) {
    const put = (pid: string, group: string, t: WpblBattingTotals | WpblPitchingTotals | WpblFieldingTotals) => {
      const p = ours.get(pid) ?? { regular: {}, postseason: {} }
      p[scope][group] = t as unknown as Record<string, number | null>
      ours.set(pid, p)
    }
    for (const s of aggregateBatting(players, bat, games, scope)) put(s.player.id, 'batting', s.totals)
    for (const s of aggregatePitching(players, pit, games, scope)) put(s.player.id, 'pitching', s.totals)
    for (const s of aggregateFielding(players, fld, bat, pit, games, scope)) put(s.player.id, 'fielding', s.totals)
  }

  const gaps: Gap[] = []
  const errors: string[] = []
  const unlinked: string[] = []
  // Gaps whose cause is on the league's page, listed so a rerun reads them, never failing it.
  const leagueSide: string[] = []
  let checked = 0
  const byId = new Map(players.map(p => [p.id, p]))
  const todo = [...ours.keys()].map(pid => byId.get(pid)!).sort((a, b) => a.name.localeCompare(b.name))
  for (const p of todo) {
    let page = (p.api_ids ?? []).map(a => pages.get(String(a))).find(Boolean)
    // Some of the feed's lines carry no `profile_url` (Paloma Benach's, among others), though the
    // page exists. The site's slugs are the name, so try that, and believe it only when the page's
    // own heading is the same person: a guessed slug can land on someone else.
    if (!page) {
      const url = `${SITE}/players/${slugOf(p.name)}/`
      if (ONE_PLAYER && !url.includes(`/${ONE_PLAYER}/`)) continue
      try {
        if (pageName(await sitePage(url)) === normName(p.name)) page = { url, name: p.name }
      } catch { /* a 404 is an unlinked player, reported below */ }
    }
    if (!page) { unlinked.push(p.name); continue }
    if (ONE_PLAYER && !page.url.includes(`/${ONE_PLAYER}/`)) continue
    const mine = ours.get(p.id)!
    for (const scope of scopes) {
      const any = Object.keys(mine[scope]).length > 0
      // A postseason page is fetched only for someone with a postseason line: their box
      // scores are the same feed's, so a line they have and we lack would show up in the drift
      // check, not here. The regular season is always fetched.
      if (scope === 'postseason' && !any) continue
      const url = `${page.url}?stats_category=${scope}&stats_year=${year}&stats_discipline=all`
      let html: string
      try {
        html = await sitePage(url)
      } catch (e) {
        errors.push(`${p.name} ${scope}: ${(e as Error).message}`)
        continue
      }
      const tables = parseSeasonTables(html)
      if (tables.size === 0) {
        // The page answers but holds no line for a season we have lines in. Claire O'Sullivan's
        // 2026 postseason and four whole pages (Paloma Benach's among them) did this.
        const notice = emptyNotice(html)
        if (notice) leagueSide.push(`${p.name} ${scope}: the page says "${notice}" and we have lines`)
        else errors.push(`${p.name} ${scope}: no Season Statistics tables on the page`)
        continue
      }
      const traded = tradedIn(html, year)
      for (const [group, cols] of [['batting', BATTING_COLS], ['pitching', PITCHING_COLS], ['fielding', FIELDING_COLS]] as const) {
        const r = compareTable(tables.get(group), cols, mine[scope][group] ?? null, year, { player: p.name, scope, group })
        // Traded, and the league short on every count that differs: their page lost the games
        // after the trade. Ours over theirs on one stat and under on another is not that.
        // Rates are left out of the test: a part-season rate can sit either side of the whole.
        const counts = r.gaps.filter(g => !RATE_STATS.has(g.stat) && g.stat !== 'line')
        const short = counts.length > 0 && counts.every(g => ipOrCount(g.league) < ipOrCount(g.ours))
        if (traded && short) {
          const games = counts.find(g => g.stat === 'G')
          leagueSide.push(`${p.name} ${scope} ${group}: traded in ${year}; the page counts ${games ? `${games.league} games to our ${games.ours}` : 'less'}`)
        }
        else gaps.push(...r.gaps)
        if (r.error) errors.push(`${p.name} ${scope}: ${r.error}`)
      }
      checked++
      if (!JSON_OUT) process.stdout.write('.')
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ season: year, checked, gaps, errors, unlinked, leagueSide }, null, 2))
  } else {
    console.log(`\n${checked} player pages checked.`)
    if (unlinked.length) console.log(`Not checked, no league page in the box scores: ${unlinked.join(', ')}`)
    if (leagueSide.length) console.log(`League side, not ours (${leagueSide.length}):\n${leagueSide.map(l => `  ${l}`).join('\n')}`)
    for (const e of errors) console.log(`ERROR ${e}`)
    if (gaps.length === 0) console.log('No gaps.')
    else {
      console.log(`${gaps.length} gap(s):`)
      for (const g of gaps) console.log(`  ${g.player} · ${g.scope} ${g.group} ${g.stat}: league ${g.league}, ours ${g.ours}`)
    }
  }
  if (gaps.length || errors.length) process.exit(1)
}

// Bundled by run-ts.mjs, so the bundle is argv[1]; the guard keeps the tests' import inert.
if (process.argv[1]?.includes('check-wpbl-league-stats')) {
  main().catch(e => { console.error(e); process.exit(2) })
}

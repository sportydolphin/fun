/**
 * import-wbsc.ts: the WBSC Women's Baseball World Cup, from wbsc.org into files.
 *
 *   npm run wbsc -- <event-key> [...]   import those events
 *   npm run wbsc -- --all               every event in EVENTS
 *   npm run wbsc -- --list              the known events
 *   npm run wbsc -- --propose           candidate WPBL matches, into the review file
 *   npm run wbsc -- --confirm           move the reviewed ones into the crosswalk
 *   flags: --refresh (refetch cached games), --offline (cache only, no network),
 *          --check (compare with the files on disk, write nothing)
 *
 * THE OUTPUT IS GITIGNORED, AND THAT IS THE POINT, NOT AN OVERSIGHT. This repository is public,
 * so committing WBSC's data publishes it, and WBSC has been asked but has not yet said yes. Until
 * it does, `archive/wbsc/` and `.wbsc-cache/` stay on the machine that ran this; nothing reads
 * them at runtime and nothing deploys them. Permission flips the `.gitignore` line, and the first
 * commit of the folder is the publication. See docs/WBSC_INGEST.md.
 *
 * POLITE BY CONSTRUCTION. One request per game, ever: a final game in the cache is never fetched
 * again unless --refresh says so, and requests are spaced 1.5 s apart under a user agent that
 * names the site. The whole back catalog is under 200 requests.
 *
 * ALL OR NOTHING PER EVENT. A game that fails validation (game.ts) is printed with its reasons
 * and the event is not written at all, for the archive's reason: a file quietly missing a game
 * looks complete, which is worse than no file.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { applyDecisions, EMPTY_CROSSWALK, propose } from '../src/intl/wbsc/crosswalk'
import type { Crosswalk, CrosswalkWpblPlayer, Review } from '../src/intl/wbsc/crosswalk'
import { inertiaFromHtml } from '../src/intl/wbsc/page'
import { transformGame, validateGame } from '../src/intl/wbsc/game'
import type { WbscPlayer } from '../src/intl/wbsc/game'
import type { WbscEvent, WbscGamePage, WbscScheduleGame } from '../src/intl/wbsc/types'

/** Every event the importer knows, oldest first. A key is wbsc.org's, as in /en/events/<key>/. */
const EVENTS: WbscEvent[] = [
  { key: '2016-womens-baseball-world-cup', year: 2016, name: 'Women\'s Baseball World Cup 2016' },
  { key: '2018-womens-baseball-world-cup', year: 2018, name: 'Women\'s Baseball World Cup 2018' },
  { key: '2023-ix-womens-baseball-world-cup-group-a', year: 2023, name: 'Women\'s Baseball World Cup 2023, Group A' },
  { key: '2023-ix-womens-baseball-world-cup-group-b', year: 2023, name: 'Women\'s Baseball World Cup 2023, Group B' },
  { key: '2024-ix-womens-baseball-world-cup-finals', year: 2024, name: 'Women\'s Baseball World Cup Finals 2024' },
  { key: '2026-x-womens-baseball-world-cup-group-stage-rockford', year: 2026, name: 'Women\'s Baseball World Cup 2026, Group Rockford' },
  { key: '2026-x-womens-baseball-world-cup-group-stage-tainan', year: 2026, name: 'Women\'s Baseball World Cup 2026, Group Tainan' },
]

const SITE = 'https://www.wbsc.org'
const OUT_DIR = 'archive/wbsc'
const CACHE_DIR = '.wbsc-cache'
const GAP_MS = 1500
const USER_AGENT = 'sportydolphin.fun WBSC importer (+https://sportydolphin.fun)'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const REFRESH = flag('refresh'), OFFLINE = flag('offline'), CHECK = flag('check')

// ── Network, spaced ─────────────────────────────────────────────────────────────

let lastRequest = 0
async function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
  if (OFFLINE) throw new Error(`--offline, and ${url} is not cached`)
  const wait = lastRequest + GAP_MS - Date.now()
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastRequest = Date.now()
  return fetch(url, { headers: { 'user-agent': USER_AGENT, ...headers } })
}

async function getHtml(url: string): Promise<string> {
  const res = await get(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res.text()
}

// ── Cache ───────────────────────────────────────────────────────────────────────

const cachePath = (event: string, name: string) => join(CACHE_DIR, event, `${name}.json.gz`)
const readCache = <T>(path: string): T | null =>
  existsSync(path) ? JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as T : null
function writeCache(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, gzipSync(JSON.stringify(value)))
}

// ── The two pages ───────────────────────────────────────────────────────────────

interface Schedule { version: string | null; games: WbscScheduleGame[] }

/** The schedule, fetched fresh unless --offline: a schedule is what changes while an event is
 *  on. It also hands over the asset version the JSON requests for each game must echo. */
async function schedule(event: WbscEvent): Promise<Schedule> {
  const path = cachePath(event.key, 'schedule')
  if (OFFLINE) {
    const cached = readCache<Schedule>(path)
    if (!cached) throw new Error(`${event.key}: --offline and no cached schedule`)
    return { version: null, games: cached.games }
  }
  const page = inertiaFromHtml<{ games: WbscScheduleGame[] }>(
    await getHtml(`${SITE}/en/events/${event.key}/schedule-and-results`))
  if (!Array.isArray(page.props.games)) throw new Error(`${event.key}: the schedule page has no games list`)
  const out = { version: page.version, games: page.props.games }
  writeCache(path, out)
  return out
}

/** One game's page data, from the cache when it is there. Asked as JSON first (half the bytes),
 *  and as HTML when the JSON request fails, which a WBSC deploy mid-run (a new version) causes. */
async function gamePage(event: WbscEvent, id: number, version: string | null): Promise<WbscGamePage> {
  const path = cachePath(event.key, String(id))
  if (!REFRESH) {
    const cached = readCache<WbscGamePage>(path)
    if (cached) return cached
  }
  const url = `${SITE}/en/events/${event.key}/schedule-and-results/box-score/${id}`
  type Props = { viewData?: { original?: WbscGamePage } }
  let original: WbscGamePage | undefined
  if (version) {
    const res = await get(url, { 'x-inertia': 'true', 'x-inertia-version': version, 'x-requested-with': 'XMLHttpRequest' })
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
      original = ((await res.json()) as { props?: Props }).props?.viewData?.original
    }
  }
  original ??= inertiaFromHtml<Props>(await getHtml(url)).props.viewData?.original
  if (!original?.gameData) throw new Error(`${event.key} game ${id}: the page holds no game data`)
  writeCache(path, original)
  return original
}

// ── Files ───────────────────────────────────────────────────────────────────────

/** Keys sorted, so the same rows always serialise to the same bytes and the same digest. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>).sort()) out[k] = stable((value as Record<string, unknown>)[k])
    return out
  }
  return value
}
const serialise = (rows: unknown[]) => JSON.stringify(stable(rows), null, 1) + '\n'
const digest = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)
const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

interface ManifestEntry { table: string; rows: number; sha256: string; bytes: number }

// ── One event ───────────────────────────────────────────────────────────────────

async function importEvent(event: WbscEvent): Promise<boolean> {
  console.log(`\n${event.key}`)
  const sched = await schedule(event)
  const tables = {
    games: [] as { id: string }[], players: [] as WbscPlayer[], batting_lines: [] as { id: string }[],
    pitching_lines: [] as { id: string }[], fielding_lines: [] as { id: string }[],
    plays: [] as { game_id: string; sequence: number }[],
  }
  const players = new Map<string, WbscPlayer>()
  let failed = 0, skipped = 0

  for (const s of [...sched.games].sort((a, b) => a.id - b.id)) {
    // Not a game to import: a forfeit carries a score and no status, a postponement neither.
    if (s.gamestatustext !== 'F') {
      console.log(`  skip     ${s.id} ${s.awayioc} @ ${s.homeioc}: not final ("${s.gamestatustext ?? ''}")`)
      skipped++
      continue
    }
    const page = await gamePage(event, s.id, sched.version)
    const problems = validateGame(page)
    if (problems.length) {
      failed++
      console.log(`  FAILED   ${s.id} ${s.awayioc} @ ${s.homeioc}`)
      for (const p of problems) console.log(`             ${p}`)
      continue
    }
    const rows = transformGame(page, event)
    for (const n of rows.notes) console.log(`  note     ${s.id} ${n}`)
    tables.games.push(rows.game)
    tables.batting_lines.push(...rows.batting)
    tables.pitching_lines.push(...rows.pitching)
    tables.fielding_lines.push(...rows.fielding)
    tables.plays.push(...rows.plays)
    for (const p of rows.players) {
      const had = players.get(p.id)
      if (had && had.team_id !== p.team_id) {
        failed++
        console.log(`  FAILED   player ${p.id} plays for ${had.team_id} and ${p.team_id}`)
      }
      players.set(p.id, had ?? p)
    }
    console.log(`  ok       ${s.id} ${s.awayioc} ${rows.game.away_score} @ ${s.homeioc} ${rows.game.home_score}, ${rows.plays.length} plays`)
  }
  tables.players = [...players.values()]

  if (failed) {
    console.log(`  ${failed} failed; ${event.key} not written.`)
    return false
  }

  const dir = join(OUT_DIR, event.key)
  const files: [string, unknown[]][] = [
    ['games', byId(tables.games)],
    ['players', byId(tables.players)],
    ['batting_lines', byId(tables.batting_lines)],
    ['pitching_lines', byId(tables.pitching_lines)],
    ['fielding_lines', byId(tables.fielding_lines)],
    ['plays', [...tables.plays].sort((a, b) => (a.game_id === b.game_id ? a.sequence - b.sequence : a.game_id < b.game_id ? -1 : 1))],
  ]
  const entries: ManifestEntry[] = files.map(([table, rows]) => {
    const text = serialise(rows)
    return { table, rows: rows.length, sha256: digest(text), bytes: Buffer.byteLength(text) }
  })

  if (CHECK) {
    const path = join(dir, 'manifest.json')
    if (!existsSync(path)) { console.log(`  MISSING  ${dir} (run without --check)`); return false }
    const recorded = new Map((JSON.parse(readFileSync(path, 'utf8')) as { tables: ManifestEntry[] }).tables.map(e => [e.table, e]))
    let same = true
    for (const e of entries) {
      const was = recorded.get(e.table)
      const ok = was?.sha256 === e.sha256 && existsSync(join(dir, `${e.table}.json`))
        && digest(readFileSync(join(dir, `${e.table}.json`), 'utf8')) === e.sha256
      if (!ok) same = false
      console.log(`  ${ok ? 'same    ' : 'DIFFERS '} ${e.table} (${e.rows} rows)`)
    }
    return same
  }

  mkdirSync(dir, { recursive: true })
  files.forEach(([table, rows]) => writeFileSync(join(dir, `${table}.json`), serialise(rows)))
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    event: event.key, name: event.name, year: event.year,
    source: `${SITE}/en/events/${event.key}/schedule-and-results`,
    games: tables.games.length, skipped,
    tables: entries,
  }, null, 2) + '\n')
  const bytes = entries.reduce((n, e) => n + e.bytes, 0)
  console.log(`  wrote ${tables.games.length} games, ${entries.find(e => e.table === 'plays')?.rows} plays, ${(bytes / 1e6).toFixed(2)} MB to ${dir}`)
  return true
}

// ── The crosswalk (src/intl/wbsc/crosswalk.ts) ──────────────────────────────────
//
// Both files sit in archive/wbsc/, so both are gitignored with the rest of WBSC's data: a link
// names a WBSC player, which is WBSC's data too.

const CROSSWALK = join(OUT_DIR, 'crosswalk.json')
const REVIEW = join(OUT_DIR, 'crosswalk-review.json')
const ROSTER = 'archive/wpbl/wpbl_players.json'

const readJson = <T>(path: string, fallback: T): T => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as T : fallback)
const writeJson = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')

/** Every player of every event imported so far. */
function importedPlayers(): WbscPlayer[] {
  if (!existsSync(OUT_DIR)) return []
  return readdirSync(OUT_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(OUT_DIR, d.name, 'players.json')))
    .flatMap(d => readJson<WbscPlayer[]>(join(OUT_DIR, d.name, 'players.json'), []))
}

function proposeLinks(): boolean {
  // Never overwrite a review in progress: a decision typed into the file and not yet confirmed
  // would be lost without a word.
  const open = readJson<Review | null>(REVIEW, null)
  if (open?.candidates.some(c => c.decision !== '')) {
    console.log(`${REVIEW} holds decisions not yet confirmed. Run --confirm first.`)
    return false
  }
  const players = importedPlayers()
  if (!players.length) { console.log(`No imported events in ${OUT_DIR}. Import one first.`); return false }
  const roster = readJson<CrosswalkWpblPlayer[]>(ROSTER, [])
  const crosswalk = readJson<Crosswalk>(CROSSWALK, EMPTY_CROSSWALK)
  const candidates = propose(players, roster, crosswalk)
  writeJson(REVIEW, { checked_by: open?.checked_by ?? '', candidates } satisfies Review)

  for (const c of candidates) {
    const flags = [c.match === 'initial' ? 'INITIAL ONLY' : '', c.ambiguous ? 'AMBIGUOUS' : ''].filter(Boolean).join(', ')
    console.log(`  ${c.wbsc_team ?? '   '}  ${c.wbsc_name.padEnd(36)} → ${c.wpbl_name.padEnd(24)} ${c.wpbl_hometown ?? ''}${flags ? `  [${flags}]` : ''}`)
  }
  const n = (f: (c: typeof candidates[number]) => boolean) => candidates.filter(f).length
  console.log(`\n${candidates.length} candidates from ${players.length} WBSC players against ${roster.length} WPBL players`
    + ` (${n(c => c.match === 'name')} by name, ${n(c => c.match === 'initial')} by surname and initial,`
    + ` ${n(c => c.ambiguous)} ambiguous); ${crosswalk.links.length} already linked, ${crosswalk.rejected.length} ruled out.`)
  console.log(`Review: set "checked_by", mark each "decision" yes or no in ${REVIEW}, then run --confirm.`)
  return true
}

function confirmLinks(): boolean {
  const review = readJson<Review | null>(REVIEW, null)
  if (!review) { console.log(`No ${REVIEW}. Run --propose first.`); return false }
  const known = {
    wbsc: new Set(importedPlayers().map(p => p.id)),
    wpbl: new Set(readJson<CrosswalkWpblPlayer[]>(ROSTER, []).map(p => p.id)),
  }
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const before = readJson<Crosswalk>(CROSSWALK, EMPTY_CROSSWALK)
  const result = applyDecisions(before, review, known, today)
  if (result.errors.length) {
    console.log('Nothing confirmed:')
    for (const e of result.errors) console.log(`  ${e}`)
    return false
  }
  writeJson(CROSSWALK, result.crosswalk)
  writeJson(REVIEW, { checked_by: review.checked_by, candidates: result.remaining } satisfies Review)
  console.log(`${result.crosswalk.links.length - before.links.length} linked, ${result.crosswalk.rejected.length - before.rejected.length} ruled out, `
    + `${result.remaining.length} still to review. ${CROSSWALK} now holds ${result.crosswalk.links.length} links.`)
  return true
}

// ── Main ────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (flag('propose')) { if (!proposeLinks()) process.exitCode = 1; return }
  if (flag('confirm')) { if (!confirmLinks()) process.exitCode = 1; return }
  const keys = args.filter(a => !a.startsWith('--'))
  if (flag('list') || (!keys.length && !flag('all'))) {
    for (const e of EVENTS) console.log(`${e.key}  (${e.name})`)
    if (!flag('list')) { console.log('\nName an event, or pass --all.'); process.exitCode = 1 }
    return
  }
  const unknown = keys.filter(k => !EVENTS.some(e => e.key === k))
  if (unknown.length) throw new Error(`not in EVENTS: ${unknown.join(', ')}`)
  const chosen = flag('all') ? EVENTS : EVENTS.filter(e => keys.includes(e.key))

  let ok = true
  for (const e of chosen) ok = (await importEvent(e)) && ok
  if (!ok) process.exitCode = 1
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1 })

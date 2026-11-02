/**
 * import-wbsc.ts: the WBSC Women's Baseball World Cup, from wbsc.org into files.
 *
 *   npm run wbsc -- <event-key> [...]   import those events
 *   npm run wbsc -- --all               every event in EVENTS
 *   npm run wbsc -- --list              the known events
 *   npm run wbsc -- --propose           candidate WPBL matches, into the review file
 *   npm run wbsc -- --review            review them in the browser (wbsc-review.ts; --no-open)
 *   npm run wbsc -- --confirm           move the reviewed ones into the crosswalk
 *   npm run wbsc -- --international     international.json for the player page, from the crosswalk
 *   npm run wbsc -- --upload            that file into the owner-only table the preview reads
 *   npm run wbsc -- --same              the same player across World Cups: rules decide, the rest to review
 *   npm run wbsc -- --confirm-same      move the reviewed answers into same-person.json
 *   npm run wbsc -- --people            people.json, one person per player across every competition
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
import pg from 'pg'
import { applyDecisions, EMPTY_CROSSWALK, propose } from '../src/intl/wbsc/crosswalk'
import type { Crosswalk, CrosswalkWpblPlayer, Review } from '../src/intl/wbsc/crosswalk'
import { inertiaFromHtml } from '../src/intl/wbsc/page'
import { isFinal, transformGame, validateGame } from '../src/intl/wbsc/game'
import type { WbscBattingLine, WbscGame, WbscPlayer } from '../src/intl/wbsc/game'
import { buildInternational, type International, type InternationalEventInput } from '../src/intl/wbsc/international'
import { buildPeople, type PeopleWpblPlayer } from '../src/intl/people'
import { EMPTY_SAME_PERSON, proposeSamePerson, type SamePersonCandidate, type SamePersonFile } from '../src/intl/wbsc/samePerson'
import type { PitchingGameLine } from '../src/league/types'
import type { WbscEvent, WbscGamePage, WbscScheduleGame } from '../src/intl/wbsc/types'
import { serveReview } from './wbsc-review'

/** Every event the importer knows, oldest first. A key is wbsc.org's, as in /en/events/<key>/. */
const EVENTS: WbscEvent[] = [
  { key: '2016-womens-baseball-world-cup', year: 2016, name: 'Women\'s Baseball World Cup 2016', legacy: true },
  { key: '2018-womens-baseball-world-cup', year: 2018, name: 'Women\'s Baseball World Cup 2018' },
  { key: '2023-ix-womens-baseball-world-cup-group-a', year: 2023, name: 'Women\'s Baseball World Cup 2023, Group A' },
  { key: '2023-ix-womens-baseball-world-cup-group-b', year: 2023, name: 'Women\'s Baseball World Cup 2023, Group B' },
  { key: '2024-ix-womens-baseball-world-cup-finals', year: 2024, name: 'Women\'s Baseball World Cup Finals 2024' },
  { key: '2026-x-womens-baseball-world-cup-group-stage-rockford', year: 2026, name: 'Women\'s Baseball World Cup 2026, Group Rockford' },
  { key: '2026-x-womens-baseball-world-cup-group-stage-tainan', year: 2026, name: 'Women\'s Baseball World Cup 2026, Group Tainan' },
]

/**
 * Errors in WBSC's own pages that validation finds and nothing here can correct, keyed by WBSC game
 * id, each problem quoted exactly. The game is written as WBSC published it, and the manifest
 * records what was accepted. EXACT STRINGS, NOT A SWITCH: a second, different problem in one of
 * these games still fails the event, so this can only ever let through what someone has read.
 * Found on the back catalog import, Nov 2, 2026.
 */
const ACCEPTED: Record<number, { why: string; problems: string[] }> = {
  // 2016, three Australia games. O'Sullivan bats in the play log and is in none of the three box
  // scores. The plays keep the runner on base under the prose's name, with no player id, and
  // Australia's batting falls short of what the other side's pitchers allowed by exactly that
  // batter's line. In 1832 (AUS @ KOR) it is also a hit short of the line score: O'Sullivan's single.
  1815: {
    why: 'a batter missing from the box score',
    problems: [
      "O'SULLIVAN is in the plays and not in the box score",
      "AUS: 29 plate appearances batting, 31 allowed by the other side's pitchers",
      "AUS: 2 strikeouts batting, 3 allowed by the other side's pitchers",
    ],
  },
  1831: {
    why: 'a batter missing from the box score',
    problems: [
      "O'SULLIVAN is in the plays and not in the box score",
      "AUS: 32 plate appearances batting, 33 allowed by the other side's pitchers",
    ],
  },
  1832: {
    why: 'a batter missing from the box score, and the hit with them',
    problems: [
      'AUS: box score hits 8, line score has 9',
      "O'SULLIVAN is in the plays and not in the box score",
      "AUS: 32 plate appearances batting, 35 allowed by the other side's pitchers",
      "AUS: 8 hits batting, 9 allowed by the other side's pitchers",
    ],
  },
  // 2018, PUR @ USA. One plate appearance in the log names a batter the lineup slot does not hold;
  // the box credits it to the substitute. The box score is what the totals read.
  3533: {
    why: 'one plate appearance credited to the wrong batter in the play log',
    problems: [
      'inning 3 top, play 145: batter 23504 but lineup slot 1090 is GARCIA GONZALEZ, and the narrative names neither',
      'batter 23490: 0 plate appearances in the play log, 1 in the box score',
    ],
  },
  // 2018, DOM @ HKG. A pinch hitter has no WBSC player id, so that one at bat is dropped, and the
  // log gives the plate appearance to the starter who was hit for.
  3549: {
    why: 'a pinch hitter with no player id',
    problems: [
      'DOM: DIAZ DURAN has no player id',
      'batter 23198: 5 plate appearances in the play log, 4 in the box score',
    ],
  },
  // 2018, TPE @ USA. The play log has two singles for one batter and the box score one hit; the
  // line score sides with the box, so one of the log's singles is wrong.
  3556: { why: 'a hit in the play log the box score lacks', problems: ['batter 23327: h 2 in the play log, 1 in the box score'] },
  // 2018, AUS @ PUR. The box gives one batter's strikeout (and the at bat) to another, who has no
  // plate appearance in either the log or the box: it reads 0 PA on 1 AB.
  3569: {
    why: 'a strikeout filed under the wrong batter in the box score',
    problems: ['batter 22038: so 1 in the play log, 0 in the box score', 'batter 22018: so 0 in the play log, 1 in the box score'],
  },
  // 2018, CUB @ PUR. The log gives a substitute's two plate appearances to the starter.
  3573: {
    why: 'two plate appearances credited to the wrong batter in the play log',
    problems: [
      'batter 22264: 4 plate appearances in the play log, 2 in the box score',
      'batter 22276: 0 plate appearances in the play log, 2 in the box score',
    ],
  },
}

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

/** Keys sorted, so the same rows always serialize to the same bytes and the same digest. */
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
  const accepted: { game: number; why: string; problems: string[] }[] = []

  for (const s of [...sched.games].sort((a, b) => a.id - b.id)) {
    // Not a game to import: a forfeit carries a score and no status, a postponement neither.
    if (!isFinal(s.gamestatustext)) {
      console.log(`  skip     ${s.id} ${s.awayioc} @ ${s.homeioc}: not final ("${s.gamestatustext ?? ''}")`)
      skipped++
      continue
    }
    const page = await gamePage(event, s.id, sched.version)
    const found = validateGame(page, { legacy: event.legacy })
    const known = ACCEPTED[s.id]
    const problems = found.filter(p => !known?.problems.includes(p))
    if (known && !problems.length) {
      accepted.push({ game: s.id, why: known.why, problems: found })
      console.log(`  accepted ${s.id} ${s.awayioc} @ ${s.homeioc}: ${known.why}`)
    }
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
    games: tables.games.length, skipped, accepted,
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
const INTERNATIONAL = join(OUT_DIR, 'international.json')
const PEOPLE = join(OUT_DIR, 'people.json')
const SAME_PERSON = join(OUT_DIR, 'same-person.json')
const SAME_REVIEW = join(OUT_DIR, 'same-person-review.json')

/** The reviewer's file for the same-person questions. */
interface SameReview { checked_by: string; questions: SamePersonCandidate[] }

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
    const flags = [c.match !== 'name' ? c.match.toUpperCase() : '', c.ambiguous ? 'AMBIGUOUS' : ''].filter(Boolean).join(', ')
    console.log(`  ${c.wbsc_team ?? '   '}  ${c.wbsc_name.padEnd(36)} → ${c.wpbl_name.padEnd(24)} ${c.wpbl_hometown ?? ''}${flags ? `  [${flags}]` : ''}`)
  }
  const n = (f: (c: typeof candidates[number]) => boolean) => candidates.filter(f).length
  console.log(`\n${candidates.length} candidates from ${players.length} WBSC players against ${roster.length} WPBL players`
    + ` (${n(c => c.match === 'name')} by name, ${n(c => c.match !== 'name')} by surname and something weaker,`
    + ` ${n(c => c.ambiguous)} ambiguous); ${crosswalk.links.length} already linked, ${crosswalk.rejected.length} ruled out.`)
  console.log(`Review: set "checked_by", mark each "decision" yes or no in ${REVIEW}, then run --confirm.`)
  return true
}

function confirmLinks(log: (line: string) => void = console.log): boolean {
  const review = readJson<Review | null>(REVIEW, null)
  if (!review) { log(`No ${REVIEW}. Run --propose first.`); return false }
  const known = {
    wbsc: new Set(importedPlayers().map(p => p.id)),
    wpbl: new Set(readJson<CrosswalkWpblPlayer[]>(ROSTER, []).map(p => p.id)),
  }
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const before = readJson<Crosswalk>(CROSSWALK, EMPTY_CROSSWALK)
  const result = applyDecisions(before, review, known, today)
  if (result.errors.length) {
    log('Nothing confirmed:')
    for (const e of result.errors) log(`  ${e}`)
    return false
  }
  writeJson(CROSSWALK, result.crosswalk)
  writeJson(REVIEW, { checked_by: review.checked_by, candidates: result.remaining } satisfies Review)
  log(`${result.crosswalk.links.length - before.links.length} linked, ${result.crosswalk.rejected.length - before.rejected.length} ruled out, `
    + `${result.remaining.length} still to review. ${CROSSWALK} now holds ${result.crosswalk.links.length} links.`)
  return true
}

// ── international.json (src/intl/wbsc/international.ts) ──────────────────────────
//
// Gitignored with the rest: it is WBSC's numbers, regrouped.

function buildInternationalFile(): boolean {
  const crosswalk = readJson<Crosswalk>(CROSSWALK, EMPTY_CROSSWALK)
  if (!crosswalk.links.length) { console.log(`${CROSSWALK} holds no links. Review and --confirm first.`); return false }
  const events: InternationalEventInput[] = readdirSync(OUT_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(OUT_DIR, d.name, 'manifest.json')))
    .map(d => {
      const dir = join(OUT_DIR, d.name)
      const m = readJson<{ event: string; name: string; year: number; source: string }>(join(dir, 'manifest.json'), { event: d.name, name: d.name, year: 0, source: '' })
      return {
        key: m.event, name: m.name, year: m.year, source: m.source,
        games: readJson<WbscGame[]>(join(dir, 'games.json'), []),
        playerIds: new Set(readJson<WbscPlayer[]>(join(dir, 'players.json'), []).map(p => p.id)),
        batting: readJson<WbscBattingLine[]>(join(dir, 'batting_lines.json'), []),
        pitching: readJson<PitchingGameLine[]>(join(dir, 'pitching_lines.json'), []),
      }
    })
  const roster = new Set(readJson<CrosswalkWpblPlayer[]>(ROSTER, []).map(p => p.id))
  const { international, errors, unplayed } = buildInternational(crosswalk, events, roster)
  if (errors.length) {
    console.log('Nothing written:')
    for (const e of errors) console.log(`  ${e}`)
    return false
  }
  for (const u of unplayed) console.log(`  unplayed ${u.wbsc_name} → ${u.wpbl_name}, on ${u.event_key}'s roster and in none of its games`)
  writeJson(INTERNATIONAL, international)
  const rows = Object.values(international).reduce((n, p) => n + p.events.length, 0)
  console.log(`${INTERNATIONAL}: ${Object.keys(international).length} WPBL players, ${rows} event rows, from ${crosswalk.links.length} links.`)
  return true
}

// ── The owner's preview ─────────────────────────────────────────────────────────
//
// international.json into `wbsc_world_cup_lines`, which only the site owner can read (see its
// migration, 20261102200647). Over SUPABASE_DB_URL, as the migrations are applied: the table has
// no write policy, and no key that ships to a browser can write it. The whole table is replaced
// in one transaction, so a player whose links were taken back loses their rows too.

async function uploadInternational(): Promise<boolean> {
  if (!existsSync(INTERNATIONAL)) { console.log(`No ${INTERNATIONAL}. Run --international first.`); return false }
  const conn = process.env.SUPABASE_DB_URL
  if (!conn) { console.log('SUPABASE_DB_URL is not set (see scripts/migrations/README.md).'); return false }
  const international = readJson<International>(INTERNATIONAL, {})
  const client = new pg.Client({ connectionString: conn, ssl: /@(localhost|127.0.0.1)/.test(conn) ? false : { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query('begin')
    await client.query('delete from public.wbsc_world_cup_lines')
    for (const [id, p] of Object.entries(international)) {
      await client.query('insert into public.wbsc_world_cup_lines (wpbl_player_id, events) values ($1, $2)', [id, JSON.stringify(p.events)])
    }
    await client.query('commit')
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    await client.end()
  }
  const rows = Object.values(international).reduce((n, p) => n + p.events.length, 0)
  console.log(`wbsc_world_cup_lines: ${Object.keys(international).length} players, ${rows} event rows. Readable by the site owner only.`)
  return true
}

// ── The same player across World Cups (src/intl/wbsc/samePerson.ts) ─────────────
//
// Both files gitignored with the rest. same-person.json keeps every decision, the rules' and the
// reviewer's, each saying which, so no pair is asked twice.

const today = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function proposeSame(): boolean {
  const open = readJson<SameReview | null>(SAME_REVIEW, null)
  if (open?.questions.some(q => q.decision !== '')) { console.log(`${SAME_REVIEW} holds answers not yet confirmed. Run --confirm-same first.`); return false }
  const file = readJson<SamePersonFile>(SAME_PERSON, EMPTY_SAME_PERSON)
  const { decided, review } = proposeSamePerson(importedPlayers(), readJson<Crosswalk>(CROSSWALK, EMPTY_CROSSWALK), file, today())
  writeJson(SAME_PERSON, { decisions: [...file.decisions, ...decided] } satisfies SamePersonFile)
  writeJson(SAME_REVIEW, { checked_by: open?.checked_by ?? '', questions: review } satisfies SameReview)
  const by = new Map<string, number>()
  for (const d of decided) by.set(`${d.decided_by} ${d.same ? 'yes' : 'no'}`, (by.get(`${d.decided_by} ${d.same ? 'yes' : 'no'}`) ?? 0) + 1)
  for (const [k, n] of [...by].sort()) console.log(`  ${String(n).padStart(4)}  ${k}`)
  for (const q of review) console.log(`  ask   ${q.reason.padEnd(13)} ${q.a_name} (${q.a_team} ${q.a_event.slice(0, 4)}) | ${q.b_name} (${q.b_team} ${q.b_event.slice(0, 4)})`)
  console.log(`${decided.length} decided by rule, ${review.length} to review in ${SAME_REVIEW}: set "checked_by" and each "decision", then --confirm-same.`)
  return true
}

function confirmSame(): boolean {
  const review = readJson<SameReview | null>(SAME_REVIEW, null)
  if (!review) { console.log(`No ${SAME_REVIEW}. Run --same first.`); return false }
  const answered = review.questions.filter(q => q.decision !== '')
  const bad = answered.filter(q => q.decision !== 'yes' && q.decision !== 'no')
  if (answered.length && !review.checked_by.trim()) { console.log('checked_by is empty: say who answered these.'); return false }
  if (bad.length) { console.log(`Not yes or no: ${bad.map(q => q.a_name).join(', ')}`); return false }
  const byId = new Map(importedPlayers().map(p => [p.id, p]))
  const file = readJson<SamePersonFile>(SAME_PERSON, EMPTY_SAME_PERSON)
  const decisions = answered.flatMap(q => q.covers.map(({ a, b }) => {
    const [x, y] = [byId.get(a), byId.get(b)]
    return {
      a, b, a_name: x?.name ?? a, b_name: y?.name ?? b, a_event: x?.event_key ?? '', b_event: y?.event_key ?? '',
      a_team: x?.team_id ?? null, b_team: y?.team_id ?? null,
      same: q.decision === 'yes', decided_by: review.checked_by.trim(), decided_at: today(),
    }
  }))
  writeJson(SAME_PERSON, { decisions: [...file.decisions, ...decisions] } satisfies SamePersonFile)
  writeJson(SAME_REVIEW, { checked_by: review.checked_by, questions: review.questions.filter(q => q.decision === '') } satisfies SameReview)
  console.log(`${answered.length} answered (${decisions.length} pairs), ${review.questions.length - answered.length} still to review. Run --people next.`)
  return true
}

// ── people.json (src/intl/people.ts) ────────────────────────────────────────────
//
// Gitignored with the rest while it names WBSC's players. Run it after every --confirm, beside
// --international.

function buildPeopleFile(): boolean {
  const roster = readJson<PeopleWpblPlayer[]>(ROSTER, [])
  if (!roster.length) { console.log(`No ${ROSTER}.`); return false }
  const { people, errors } = buildPeople(roster, importedPlayers(), readJson<Crosswalk>(CROSSWALK, EMPTY_CROSSWALK), readJson<SamePersonFile>(SAME_PERSON, EMPTY_SAME_PERSON))
  if (errors.length) {
    console.log('Nothing written:')
    for (const e of errors) console.log(`  ${e}`)
    return false
  }
  writeJson(PEOPLE, people)
  const n = (f: (p: typeof people[number]) => boolean) => people.filter(f).length
  console.log(`${PEOPLE}: ${people.length} people. ${n(p => !!p.wpbl_id && p.wbsc.length > 0)} WPBL players with a World Cup,`
    + ` ${n(p => !!p.wpbl_id && !p.wbsc.length)} without, ${n(p => !p.wpbl_id)} World Cup players with no WPBL row`
    + ` (one person per World Cup career, as far as same-person.json has joined them).`)
  return true
}

// ── Main ────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (flag('propose')) { if (!proposeLinks()) process.exitCode = 1; return }
  if (flag('confirm')) { if (!confirmLinks()) process.exitCode = 1; return }
  if (flag('international')) { if (!buildInternationalFile()) process.exitCode = 1; return }
  if (flag('same')) { if (!proposeSame()) process.exitCode = 1; return }
  if (flag('confirm-same')) { if (!confirmSame()) process.exitCode = 1; return }
  if (flag('people')) { if (!buildPeopleFile()) process.exitCode = 1; return }
  if (flag('upload')) { if (!(await uploadInternational())) process.exitCode = 1; return }
  if (flag('review')) {
    serveReview({ outDir: OUT_DIR, reviewPath: REVIEW, rosterPath: ROSTER, readJson, writeJson, confirm: confirmLinks, open: !flag('no-open') })
    return
  }
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

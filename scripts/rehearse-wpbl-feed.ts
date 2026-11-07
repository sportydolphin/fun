// The spring rehearsal: read the whole league feed through the ingest's own transforms and diff
// every row it would write against the archived season, without touching the database.
//
//   npm run rehearse              # diff, print a summary, write the report
//   npm run rehearse -- --strict  # also exit 1 on any difference (for CI or a pre-season gate)
//
// WHY. Every trap in supabase/functions/wpbl-ingest/CLAUDE.md is a thing the 2026 feed did that
// it never said, and each was found by a reader or a broken page, mid-season. The feed sleeps
// all winter and can change shape before Opening Day (it minted new club and player ids for the
// postseason and changed the ERA basis mid-season), so the alternative to this is re-reading the
// traps and hoping. Run it now and the 2026 diff is the baseline; run it again when the feed
// wakes in the spring and anything new in the diff is a change to learn before the first game.
//
// WHY NOT A SCRATCH SCHEMA. The archive is our mirrored tables, not the raw feed, so there was
// nothing to replay, and running the edge function into a second schema means writing to the live
// project. The rows the ingest writes are decided in transform.ts with no database in it, so
// running that over the feed and comparing with archive/ tests the same thing with no writes.
//
// WHAT IT CANNOT SEE. The roster resolver here only reads (feed id, then club and exact name,
// then exact name on any club), where the ingest's also forgives spelling and inserts newcomers.
// A player it cannot place is listed by name rather than guessed, and that player's lines then
// show as missing. The feed also only serves its current version of a game, so a final the
// league edited after the season shows up as a difference; check-wpbl-drift.mjs is what records
// those, in wpbl_game_revisions.
//
// The raw feed responses are saved beside the report (node_modules/.cache/wpbl-rehearsal/), so a
// spring run can be compared with this one response by response, not only row by row.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkBoxscore, checkGameList } from '../supabase/functions/wpbl-ingest/feed-contract.ts'
import { contestedNames, normName } from '../supabase/functions/wpbl-ingest/names.ts'
import {
  FEED, s, phantomGameIds, gameRowOf, boxscoreRows, fetchTracking, trackingRows, type BoxResolver,
} from '../supabase/functions/wpbl-ingest/transform.ts'

const STRICT = process.argv.includes('--strict')
const SEASON = 2026
const OUT = join('node_modules', '.cache', 'wpbl-rehearsal')
const RAW = join(OUT, 'feed')
mkdirSync(RAW, { recursive: true })

type Row = Record<string, unknown>
const load = (path: string): Row[] => JSON.parse(readFileSync(path, 'utf8'))
const archive = {
  teams: load('archive/wpbl/wpbl_teams.json'),
  players: load('archive/wpbl/wpbl_players.json'),
  games: load(`archive/wpbl-${SEASON}/wpbl_games.json`),
  batting: load(`archive/wpbl-${SEASON}/wpbl_batting_lines.json`),
  pitching: load(`archive/wpbl-${SEASON}/wpbl_pitching_lines.json`),
  fielding: load(`archive/wpbl-${SEASON}/wpbl_fielding_lines.json`),
  plays: load(`archive/wpbl-${SEASON}/wpbl_game_plays.json`),
  tracking: load(`archive/wpbl-${SEASON}/wpbl_pitch_tracking.json`),
}

async function getJson(path: string, saveAs: string): Promise<any> {
  const res = await fetch(`${FEED}${path}`)
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  const body = await res.json()
  writeFileSync(join(RAW, saveAs), JSON.stringify(body, null, 1))
  return body
}

// ─── clubs and players, read only ─────────────────────────────────────────────

const teamSlug = new Map<string, string>()
const teamByName = new Map<string, string>()
for (const t of archive.teams) {
  for (const a of [...((t.api_ids as string[]) ?? []), t.api_id]) if (a) teamSlug.set(String(a), String(t.id))
  teamByName.set(normName(`${s(t.city)} ${s(t.name)}`), String(t.id))
  if (t.abbr) teamByName.set(normName(String(t.abbr)), String(t.id))
}
/** Club ids the ingest would ADOPT by exact name: new to us, and worth knowing about. */
const adopted = new Map<string, string>()
const slugFor = (apiTeamId: string, feedName: string): string | undefined => {
  const known = teamSlug.get(apiTeamId)
  if (known) return known
  const slug = teamByName.get(normName(feedName))
  if (apiTeamId && slug) { teamSlug.set(apiTeamId, slug); adopted.set(apiTeamId, `${feedName} → ${slug}`) }
  return slug
}

const byApi = new Map<string, string>()
const byName = new Map<string, Row[]>()
for (const p of archive.players) {
  for (const a of [...((p.api_ids as string[]) ?? []), p.api_id]) if (a) byApi.set(String(a), String(p.id))
  const nm = normName(s(p.name))
  byName.set(nm, [...(byName.get(nm) ?? []), p])
}
const unresolved = new Map<string, number>()
// The feed's spellings of a name, learned from entries placed by feed id, as the ingest's
// `link` learns them: a play names its batter with no id beside it, so "Val Perez" in a play is
// only findable once a box-score line with Valerie Perez's feed id has said so.
const alias = new Map<string, string>()
const resolver: BoxResolver = {
  async resolve(feed, team) {
    const apiId = s(feed.id)
    const nm = normName(s(feed.name))
    const same = byName.get(nm) ?? []
    const onClub = same.filter(p => p.team_id === team)
    const hit = (apiId ? byApi.get(apiId) : undefined)
      ?? (onClub.length === 1 ? String(onClub[0].id) : undefined)
      ?? (same.length === 1 ? String(same[0].id) : undefined)
      ?? alias.get(nm)
    if (hit) {
      if (!same.some(p => p.id === hit)) alias.set(nm, hit)
      return hit
    }
    const key = `${s(feed.name)} (${team || 'no club'})`
    unresolved.set(key, (unresolved.get(key) ?? 0) + 1)
    return null
  },
  // The ingest's order: a unique roster name, then a learned spelling.
  resolveName(name) {
    const nm = normName(name)
    const same = byName.get(nm)
    if (same?.length === 1) return String(same[0].id)
    return same ? null : alias.get(nm) ?? null
  },
}

// ─── the diff ─────────────────────────────────────────────────────────────────

const stable = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]]))
    : x)
function same(a: unknown, b: unknown): boolean {
  a ??= null; b ??= null
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a === 'object' || typeof b === 'object') return stable(a) === stable(b)
  // A timestamp the database hands back as `+00:00` and the feed as `Z` is one instant.
  const iso = /^\d{4}-\d\d-\d\dT\d\d:\d\d/
  if (typeof a === 'string' && typeof b === 'string' && iso.test(a) && iso.test(b)) return Date.parse(a) === Date.parse(b)
  const na = Number(a), nb = Number(b)
  if (a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na === nb
  return String(a) === String(b)
}

interface TableDiff { matched: number; changed: { key: string; fields: Record<string, [unknown, unknown]> }[]; onlyFeed: string[]; onlyArchive: string[] }
const diffs: Record<string, TableDiff> = {}
/** Columns the ingest writes that the archive does not hold, per table: nothing to compare. */
const unarchived: Record<string, Set<string>> = {}

/** Compare the rows the feed makes with the archive's, both keyed the same way. Columns the
 *  archive was written by something else (a `sub_out`, an `id`) never appear on the feed side,
 *  so only the ingest's own columns are compared. */
function diffTable(table: string, feedRows: Map<string, Row>, archived: Map<string, Row>, skip: string[] = []) {
  const d: TableDiff = diffs[table] ??= { matched: 0, changed: [], onlyFeed: [], onlyArchive: [] }
  for (const [key, row] of feedRows) {
    const old = archived.get(key)
    if (!old) { d.onlyFeed.push(key); continue }
    const fields: Record<string, [unknown, unknown]> = {}
    for (const [col, v] of Object.entries(row)) {
      if (skip.includes(col)) continue
      if (!(col in old)) { (unarchived[table] ??= new Set()).add(col); continue }
      if (!same(v, old[col])) fields[col] = [old[col] ?? null, v ?? null]
    }
    if (Object.keys(fields).length) d.changed.push({ key, fields })
    else d.matched++
  }
  for (const key of archived.keys()) if (!feedRows.has(key)) d.onlyArchive.push(key)
}

const index = <T extends Row>(rows: T[], key: (r: T) => string) => new Map(rows.map(r => [key(r), r]))

// ─── the run ──────────────────────────────────────────────────────────────────

const contract: string[] = []
const list = checkGameList(await getJson('/games?limit=1000', 'games.json'))
if (list.fatal) { console.error(`Feed contract, fatal: ${list.fatal}`); process.exit(1) }
if (list.games.length < list.count) {
  console.error(`/games truncated: ${list.games.length} of ${list.count}`); process.exit(1)
}
contract.push(...list.breaks)

const phantoms = phantomGameIds(list.games)
const archivedGames = index(archive.games, g => s(g.api_game_id))
const gameUuid = new Map([...archivedGames].map(([api, g]) => [api, String(g.id)]))
const apiOf = new Map([...gameUuid].map(([api, id]) => [id, api]))
const feedGameRows = new Map<string, Row>()
const lines = { batting: new Map<string, Row>(), pitching: new Map<string, Row>(), fielding: new Map<string, Row>() }
const playRows = new Map<string, Row>()
const trackRows = new Map<string, Row>()
let boxes = 0

for (const fg of list.games) {
  const apiGameId = s(fg.game_id)
  if (!apiGameId || phantoms.has(apiGameId)) continue
  if (!s(fg.home_team_id) || !s(fg.away_team_id)) continue // a TBD bracket slot
  const home = slugFor(s(fg.home_team_id), s(fg.home_team_name))
  const away = slugFor(s(fg.away_team_id), s(fg.away_team_name))
  if (!home || !away) { contract.push(`unmapped team in ${apiGameId}`); continue }

  const { row } = gameRowOf(fg, home, away)
  // A game the archive does not have is keyed on its feed id, which is what the report prints.
  const uuid = gameUuid.get(apiGameId) ?? apiGameId

  let gamePatch: Row = {}
  if (row.status !== 'scheduled') {
    try {
      const body = await getJson(`/games/${apiGameId}/boxscore`, `box-${apiGameId}.json`)
      contract.push(...checkBoxscore(body, apiGameId))
      const box = body.boxscore
      const slugOf = (id: string) => teamSlug.get(id) ?? null
      const contested = contestedNames((box.teams ?? []).flatMap((t: any) =>
        (t.players ?? []).map((pl: any) => ({ club: slugOf(s(t.id)) ?? '', name: s(pl.name) }))))
      const out = await boxscoreRows(box, uuid, row.game_date, slugOf, resolver, s(fg.completed_at), contested, normName)
      gamePatch = out.gamePatch
      for (const r of out.batting) lines.batting.set(`${apiGameId}|${r.player_id}`, r)
      for (const r of out.pitching) lines.pitching.set(`${apiGameId}|${r.player_id}`, r)
      for (const r of out.fielding) lines.fielding.set(`${apiGameId}|${r.player_id}`, r)
      for (const r of out.plays) playRows.set(`${apiGameId}|${r.sequence}`, r)
      const tracked = await fetchTracking(apiGameId, box.tracking_activity ?? [])
      writeFileSync(join(RAW, `activity-${apiGameId}.json`), JSON.stringify(tracked, null, 1))
      for (const r of trackingRows(tracked, uuid)) trackRows.set(String(r.activity_id), r)
      boxes++
    } catch (e) {
      contract.push(`box ${apiGameId}: ${e instanceof Error ? e.message : e}`)
    }
  }
  // What the game row ends up as after both writers, the list upsert and then the box score.
  feedGameRows.set(apiGameId, { ...row, ...gamePatch })
}

// The archive is keyed by our game uuid; the feed side by feed id. Bring them to one key.
const viaApi = (rows: Row[], rest: (r: Row) => string) =>
  index(rows.filter(r => apiOf.has(String(r.game_id))), r => `${apiOf.get(String(r.game_id))}|${rest(r)}`)
// `updated_at` and the rest of the clock columns are when we wrote, not what the feed said.
const CLOCK = ['updated_at', 'tracking_checked_at', 'created_at']
diffTable('wpbl_games', feedGameRows, archivedGames, CLOCK)
diffTable('wpbl_batting_lines', lines.batting, viaApi(archive.batting, r => String(r.player_id)), ['game_id'])
diffTable('wpbl_pitching_lines', lines.pitching, viaApi(archive.pitching, r => String(r.player_id)), ['game_id'])
diffTable('wpbl_fielding_lines', lines.fielding, viaApi(archive.fielding, r => String(r.player_id)), ['game_id'])
diffTable('wpbl_game_plays', playRows, viaApi(archive.plays, r => String(r.sequence)), ['game_id'])
diffTable('wpbl_pitch_tracking', trackRows, index(archive.tracking, r => String(r.activity_id)), ['game_id'])

// ─── the report ───────────────────────────────────────────────────────────────

// TrackMan reads through its own endpoint, and fetchTracking falls back quietly when it fails, so
// a missing table here could be the league not publishing or the endpoint refusing us. Ask once.
// On Nov 6, 2026 it refused every game with `401 missing api key`, where it had answered with no
// key all season; the box score dropped its own capped copy (`tracking_activity`) before that.
let trackmanStatus = 'not checked'
const probe = list.games.find((fg: any) => s(fg.completed_at))
if (probe) {
  const res = await fetch(`${FEED}/games/${s(probe.game_id)}/activity?limit=1`)
  trackmanStatus = res.ok ? 'open' : `${res.status} ${(await res.text()).slice(0, 80).trim()}`
}

const report = {
  ran_at: new Date().toISOString(),
  feed: { games: list.count, phantoms: phantoms.size, box_scores: boxes, trackman: trackmanStatus },
  contract_breaks: contract,
  adopted_club_ids: Object.fromEntries(adopted),
  unresolved_players: Object.fromEntries(unresolved),
  unarchived_columns: Object.fromEntries(Object.entries(unarchived).map(([t, c]) => [t, [...c].sort()])),
  tables: diffs,
}
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))

console.log(`Feed: ${list.count} games, ${phantoms.size} duplicate copies skipped, ${boxes} box scores read.`)
console.log(`Contract breaks: ${contract.length}`)
console.log(`TrackMan /activity: ${trackmanStatus}`)
for (const b of contract.slice(0, 10)) console.log(`  ${b}`)
if (adopted.size) console.log(`Club ids adopted by name: ${[...adopted.values()].join('; ')}`)
if (unresolved.size) console.log(`Players not placed: ${[...unresolved.keys()].join('; ')}`)
console.log('')
console.log('Table'.padEnd(22), 'Same'.padStart(6), 'Changed'.padStart(8), 'Feed only'.padStart(10), 'Archive only'.padStart(13))
let differences = contract.length
for (const [table, d] of Object.entries(diffs)) {
  console.log(table.padEnd(22), String(d.matched).padStart(6), String(d.changed.length).padStart(8),
    String(d.onlyFeed.length).padStart(10), String(d.onlyArchive.length).padStart(13))
  differences += d.changed.length + d.onlyFeed.length + d.onlyArchive.length
}
// The columns that changed, most first: one line says whether a diff is one rule or many.
const byColumn = new Map<string, number>()
for (const [table, d] of Object.entries(diffs)) for (const c of d.changed) for (const f of Object.keys(c.fields)) {
  const k = `${table}.${f}`; byColumn.set(k, (byColumn.get(k) ?? 0) + 1)
}
if (byColumn.size) {
  console.log('\nChanged columns:')
  for (const [k, c] of [...byColumn].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${k}: ${c}`)
}
console.log(`\nReport: ${join(OUT, 'report.json')}; raw feed: ${RAW}`)
if (STRICT && differences) process.exit(1)

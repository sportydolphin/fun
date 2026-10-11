#!/usr/bin/env node
/**
 * sync-mlb-lines.mjs: mirror every finished MLB game's box-score lines into Supabase.
 *
 * WHAT FOR. MLB's Bests and Find boards run WPBL's engines (src/league/), which read every game
 * line of a season. StatsAPI has no endpoint for that; it has one box score per game. So this
 * reads each final's box score once and keeps its lines in mlb_games, mlb_batting_lines,
 * mlb_pitching_lines and mlb_players (scripts/migrations/20261010233420_mlb_lines_mirror.sql).
 * ROADMAP.md item 6, step 3.
 *
 * WHICH GAMES. Every final not yet stored, plus every final from the last RECENT_DAYS days again:
 * the official scorer's changes reach StatsAPI over the following day or two, and a box score read
 * the night of the game would otherwise keep its first version for good. `--all` re-reads the
 * whole season, for a schema change or a correction found later.
 *
 * FINAL MEANS codedGameState 'F'. A postponed game reports abstractGameState "Final" too (28 of
 * them in 2026), and its makeup reuses the same gamePk on a later date, so the abstract state
 * would store an empty box score under a game that was played weeks later.
 *
 * ONE TRANSACTION PER BATCH OF GAMES. A game's lines are replaced whole (the scorer can take an
 * appearance away as well as change one), and a reader must never catch a game with half its
 * lines. BATCH_GAMES games share a transaction because the round trip to Supabase is the whole
 * cost: one game per transaction ran at three seconds a game, two hours for a season.
 * Nothing else is ever deleted: a short schedule read leaves stored games alone.
 *
 * Usage:
 *   node --env-file=.env scripts/sync-mlb-lines.mjs                  this season, new and recent
 *   node --env-file=.env scripts/sync-mlb-lines.mjs --season 2026 --all
 *   node --env-file=.env scripts/sync-mlb-lines.mjs --dry-run --limit 5
 *
 * Required env: SUPABASE_DB_URL (not needed for --dry-run).
 */

import pg from 'pg'
import { pathToFileURL } from 'node:url'

const API = 'https://statsapi.mlb.com/api/v1'
/** Regular season and the four postseason rounds. Spring training and exhibitions are not MLB's record. */
const GAME_TYPES = ['R', 'F', 'D', 'L', 'W']
const RECENT_DAYS = 3
/** Box scores fetched at once. StatsAPI is undocumented and free; a backfill is ~2,500 reads. */
const CONCURRENCY = 4
/** Games written per transaction. Postgres takes 65,535 parameters; 25 games is about 1,300 rows. */
const BATCH_GAMES = 25

// ─── Pure: what a schedule and a box score say ────────────────────────────────

/**
 * The season's finished games, one per gamePk.
 *
 * A gamePk can appear more than once: on the date it was postponed (codedGameState D) and on the
 * date it was made up. Only the final entry is kept, and if two entries are both final (a suspended
 * game finished on a later date) the later date wins, which is the date it ended.
 */
export function finalsFromSchedule(schedule, season) {
  const byPk = new Map()
  for (const d of schedule?.dates ?? []) {
    for (const g of d.games ?? []) {
      if (g.status?.codedGameState !== 'F' || !GAME_TYPES.includes(g.gameType)) continue
      const row = {
        game_pk: g.gamePk,
        season,
        game_date: g.officialDate ?? d.date,
        game_type: g.gameType,
        // Definitive in src/league/season.ts, which cannot match MLB's one-letter round codes.
        counts_in_standings: g.gameType === 'R',
        status: 'final',
        home_team_id: g.teams?.home?.team?.id,
        away_team_id: g.teams?.away?.team?.id,
        home_score: g.teams?.home?.score ?? null,
        away_score: g.teams?.away?.score ?? null,
      }
      if (row.home_team_id == null || row.away_team_id == null) continue
      const prev = byPk.get(g.gamePk)
      if (!prev || row.game_date > prev.game_date) byPk.set(g.gamePk, row)
    }
  }
  return [...byPk.values()]
}

const n = v => (Number.isFinite(Number(v)) ? Number(v) : 0)
const nOrNull = v => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))

/**
 * One game's lines, from its box score.
 *
 * A batting row only for an appearance: the `batters` list carries every player on the card,
 * pitchers and unused bench included (8 of 18 on one side of a game checked while writing this).
 * A pinch runner who scored or stole has no plate appearance and is still an appearance.
 */
export function linesFromBox(box, gamePk) {
  const batting = [], pitching = [], players = []
  for (const side of ['away', 'home']) {
    const t = box?.teams?.[side]
    const teamId = t?.team?.id
    if (teamId == null) continue
    const person = id => t.players?.[`ID${id}`]
    for (const id of t.batters ?? []) {
      const p = person(id)
      const s = p?.stats?.batting ?? {}
      if (!(n(s.plateAppearances) > 0 || n(s.runs) > 0 || n(s.stolenBases) > 0 || n(s.caughtStealing) > 0)) continue
      batting.push({
        game_pk: gamePk, player_id: id, team_id: teamId,
        ab: n(s.atBats), r: n(s.runs), h: n(s.hits), doubles: n(s.doubles), triples: n(s.triples),
        hr: n(s.homeRuns), rbi: n(s.rbi), bb: n(s.baseOnBalls), so: n(s.strikeOuts),
        hbp: n(s.hitByPitch), sb: n(s.stolenBases), cs: n(s.caughtStealing), sf: n(s.sacFlies),
        sh: n(s.sacBunts), gdp: n(s.groundIntoDoublePlay), tb: n(s.totalBases),
      })
      if (p?.person?.fullName) players.push({ player_id: id, name: p.person.fullName, team_id: teamId })
    }
    for (const id of t.pitchers ?? []) {
      const p = person(id)
      const s = p?.stats?.pitching
      if (!s) continue
      pitching.push({
        game_pk: gamePk, player_id: id, team_id: teamId,
        outs: n(s.outs), bf: nOrNull(s.battersFaced), h: n(s.hits), r: n(s.runs), er: n(s.earnedRuns),
        bb: n(s.baseOnBalls), so: n(s.strikeOuts), hr: n(s.homeRuns),
        pitches: nOrNull(s.numberOfPitches ?? s.pitchesThrown), strikes: nOrNull(s.strikes),
        hbp: n(s.hitBatsmen), wp: n(s.wildPitches), bk: n(s.balks),
      })
      if (p?.person?.fullName && !players.some(x => x.player_id === id)) {
        players.push({ player_id: id, name: p.person.fullName, team_id: teamId })
      }
    }
  }
  return { batting, pitching, players }
}

// ─── Writing ──────────────────────────────────────────────────────────────────

const BATTING_COLS = ['game_pk', 'player_id', 'team_id', 'ab', 'r', 'h', 'doubles', 'triples', 'hr',
  'rbi', 'bb', 'so', 'hbp', 'sb', 'cs', 'sf', 'sh', 'gdp', 'tb']
const PITCHING_COLS = ['game_pk', 'player_id', 'team_id', 'outs', 'bf', 'h', 'r', 'er', 'bb', 'so',
  'hr', 'pitches', 'strikes', 'hbp', 'wp', 'bk']
const GAME_COLS = ['game_pk', 'season', 'game_date', 'game_type', 'counts_in_standings', 'status',
  'home_team_id', 'away_team_id', 'home_score', 'away_score']

const MAX_PARAMS = 60_000

function insertSql(table, cols, rows, tail = '') {
  const values = [], params = []
  for (const row of rows) {
    values.push(`(${cols.map(c => { params.push(row[c]); return `$${params.length}` }).join(', ')})`)
  }
  return { text: `insert into public.${table} (${cols.join(', ')}) values ${values.join(', ')} ${tail}`, values: params }
}

/** Insert in statements under Postgres's parameter cap. */
async function insertAll(client, table, cols, rows, tail = '') {
  const per = Math.floor(MAX_PARAMS / cols.length)
  for (let i = 0; i < rows.length; i += per) await client.query(insertSql(table, cols, rows.slice(i, i + per), tail))
}

/** A batch of games and every one of their lines, replaced in one transaction. */
async function writeBatch(client, batch) {
  const pks = batch.map(b => b.game.game_pk)
  await client.query('begin')
  try {
    const set = GAME_COLS.filter(c => c !== 'game_pk').map(c => `${c} = excluded.${c}`).join(', ')
    await insertAll(client, 'mlb_games', GAME_COLS, batch.map(b => b.game),
      `on conflict (game_pk) do update set ${set}, synced_at = now()`)
    await client.query('delete from public.mlb_batting_lines where game_pk = any($1)', [pks])
    await client.query('delete from public.mlb_pitching_lines where game_pk = any($1)', [pks])
    await insertAll(client, 'mlb_batting_lines', BATTING_COLS, batch.flatMap(b => b.lines.batting))
    await insertAll(client, 'mlb_pitching_lines', PITCHING_COLS, batch.flatMap(b => b.lines.pitching))
    await client.query('commit')
  } catch (e) {
    await client.query('rollback')
    throw e
  }
}

/** Names always take the newest spelling; the club moves only forward in time. */
async function writePlayers(client, latest) {
  const rows = [...latest.values()]
  for (let i = 0; i < rows.length; i += 500) {
    const q = insertSql('mlb_players', ['player_id', 'name', 'team_id', 'team_as_of'], rows.slice(i, i + 500),
      `on conflict (player_id) do update set
         name = excluded.name,
         team_id = case when mlb_players.team_as_of is null or excluded.team_as_of >= mlb_players.team_as_of
                        then excluded.team_id else mlb_players.team_id end,
         team_as_of = greatest(mlb_players.team_as_of, excluded.team_as_of)`)
    await client.query(q)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const argValue = name => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : null
}

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url)
      if (!r.ok) throw new Error(`${r.status} ${url}`)
      return await r.json()
    } catch (e) {
      if (attempt >= 3) throw e
      await new Promise(res => setTimeout(res, 1000 * attempt))
    }
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const all = process.argv.includes('--all')
  const season = Number(argValue('--season') ?? new Date().getUTCFullYear())
  const limit = Number(argValue('--limit') ?? Infinity)
  if (!dryRun && !process.env.SUPABASE_DB_URL) {
    console.error('Set SUPABASE_DB_URL before running (or pass --dry-run)')
    process.exit(1)
  }

  const schedule = await getJson(`${API}/schedule?sportId=1&season=${season}&gameType=${GAME_TYPES.join(',')}` +
    '&fields=dates,date,games,gamePk,gameType,officialDate,status,codedGameState,teams,away,home,team,id,score')
  const finals = finalsFromSchedule(schedule, season)
  console.log(`${season}: ${finals.length} finals on the schedule`)

  const client = dryRun ? null : new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
  await client?.connect()
  const stored = new Set()
  if (client) {
    const { rows } = await client.query('select game_pk from public.mlb_games where season = $1', [season])
    for (const r of rows) stored.add(r.game_pk)
  }
  const recentFrom = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10)
  const due = finals
    .filter(g => all || !stored.has(g.game_pk) || g.game_date >= recentFrom)
    .sort((a, b) => (a.game_date < b.game_date ? -1 : a.game_date > b.game_date ? 1 : a.game_pk - b.game_pk))
    .slice(0, limit)
  console.log(`${stored.size} stored, ${due.length} to read`)

  const latest = new Map()
  const failed = []
  let written = 0, batting = 0, pitching = 0

  /** Read one batch's box scores, CONCURRENCY at a time. */
  async function readBatch(games) {
    const read = []
    let next = 0
    async function worker() {
      while (next < games.length) {
        const game = games[next++]
        try {
          const lines = linesFromBox(await getJson(`${API}/game/${game.game_pk}/boxscore`), game.game_pk)
          // A final with no lines on a side is a box score StatsAPI has not filled yet, not a game
          // nobody played in. Writing it would publish an empty game; the next pass retries.
          if (!lines.batting.length || !lines.pitching.length) throw new Error('empty box score')
          read.push({ game, lines })
        } catch (e) {
          failed.push(`${game.game_pk} (${game.game_date}): ${e.message}`)
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    return read
  }

  for (let i = 0; i < due.length; i += BATCH_GAMES) {
    const batch = await readBatch(due.slice(i, i + BATCH_GAMES))
    if (client && batch.length) await writeBatch(client, batch)
    for (const { game, lines } of batch) {
      for (const p of lines.players) {
        const prev = latest.get(p.player_id)
        if (!prev || game.game_date >= prev.team_as_of) latest.set(p.player_id, { ...p, team_as_of: game.game_date })
      }
      written++; batting += lines.batting.length; pitching += lines.pitching.length
    }
    console.log(`  ${Math.min(i + BATCH_GAMES, due.length)}/${due.length}`)
  }
  if (client && latest.size) await writePlayers(client, latest)
  await client?.end()

  console.log(`${written} games written (${batting} batting, ${pitching} pitching lines), ${latest.size} players`)
  if (failed.length) {
    console.error(`${failed.length} failed:\n  ${failed.join('\n  ')}`)
    process.exit(1)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1) })
}

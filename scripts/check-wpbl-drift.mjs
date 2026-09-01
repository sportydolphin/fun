#!/usr/bin/env node
/**
 * check-wpbl-drift.mjs: prove the mirror still matches the league feed, and repair it if not.
 *
 * WHY THIS EXISTS. `wpbl-ingest` stops re-reading a game once it is stored final. Two gates
 * currently re-open it, and neither is about corrections:
 *
 *   • `force`, which nothing scheduled ever passes, and
 *   • the late-TrackMan backfill, which re-fetches finals under 21 days old that still have
 *     zero tracking rows.
 *
 * So every correction that has reached us so far arrived as a SIDE EFFECT of the league's
 * pitch tracking being stalled. That is not a mechanism, it is a coincidence with an expiry
 * date: the day tracking resumes, a game stops qualifying the moment its rows land, and past
 * 21 days nothing re-reads it at all.
 *
 * The league revises box scores long after the fact. Measured Sep 1, 2026: an Aug 3 game
 * carried `source_updated_at` of Aug 21, an Aug 8 game Aug 24. Sixteen days is comfortably
 * outside the backfill window that happens to be catching them.
 *
 * AND THE GAMES LIST WILL NOT TELL YOU. `GET /v1/games` publishes an `updated_at` per game,
 * which looks like exactly the revision stamp this needs. It is not: on a completed game it
 * equals `completed_at` and never moves again, while the boxscore's own `source_updated_at`
 * marches on for weeks. The only way to learn that a game changed is to fetch its boxscore
 * and compare, which is what this does.
 *
 * WHAT IT COMPARES, and why it is not just the score. A score correction DOES propagate on
 * its own, because the games list carries `presto_data.score` and the ingest folds that onto
 * the row every pass. The box score behind it does not. That combination is the worst case
 * rather than the harmless one: the scoreboard moves, the line score and player lines under
 * it do not, and the game page contradicts itself. So this checks the whole payload the
 * boxscore owns: line-score totals, play count, and the batting and pitching lines, both as
 * team totals and as a sorted multiset of the individual lines, which is what catches a hit
 * moved from one player to another without changing the team's total.
 *
 * Usage:
 *   node --env-file=.env scripts/check-wpbl-drift.mjs
 *   node --env-file=.env scripts/check-wpbl-drift.mjs --repair
 *   node --env-file=.env scripts/check-wpbl-drift.mjs --json
 *
 * Needs SUPABASE_DB_URL. --repair also needs SUPABASE_URL (or VITE_SUPABASE_URL) and
 * SUPABASE_SERVICE_ROLE_KEY, and re-ingests ONE GAME PER CALL (`{ gameId }`) rather than
 * passing `force`: a force pass walks every final in a single edge-function invocation, and
 * the season is heading for sixty of them. If that ever runs past the wall clock it dies at
 * the same place every night, and the games after that place are never swept at all.
 *
 * Exits 1 if drift remains (so the nightly job goes red only when repair failed, which is
 * the one case that needs a person). npm script: npm run check-drift
 */

import pg from 'pg'
import { pathToFileURL } from 'node:url'

const FEED = 'https://stats.womensprobaseballleague.com/v1'
const JSON_OUT = process.argv.includes('--json')
const REPAIR = process.argv.includes('--repair')

const n = (v) => Number(v ?? 0) || 0
const s = (v) => (v == null ? '' : String(v))
// "2.2" innings → outs. Mirrors ipToOuts in the ingest; keep the two in step.
const ipToOuts = (ip) => {
  const t = s(ip).trim()
  if (!t) return 0
  const [w, f] = t.split('.')
  return n(w) * 3 + Math.min(n(f), 2)
}
// Timestamps come back from Postgres and from the feed in different spellings of the same
// instant. Compare them as instants, not as strings.
const instant = (v) => {
  const t = Date.parse(s(v))
  return Number.isFinite(t) ? t : null
}

/** Everything the boxscore owns, reduced to comparable primitives. Built the same way from
 *  the feed's payload and from our rows, so a mismatch is drift rather than a shape
 *  difference. */
export function fingerprintFeed(box) {
  const sides = {}
  const bat = [], pit = []
  for (const team of box.teams ?? []) {
    const side = s(team.side)
    const tot = team.totals ?? {}
    sides[side] = { runs: n(tot.runs), hits: n(tot.hits), errors: n(tot.errors) }
    for (const pl of team.players ?? []) {
      const h = pl.hitting, p = pl.pitching
      // The same admission test the ingest applies, or every bench player who never came up
      // reads as a line we are missing.
      if (h && (n(pl.spot) || n(h.ab) || n(h.h) || n(h.bb) || n(h.r) || n(h.rbi) || n(h.hbp) || n(h.so))) {
        bat.push([n(h.ab), n(h.r), n(h.h), n(h.rbi), n(h.bb), n(h.so), n(h.hr), n(h.double), n(h.triple), n(h.sb)].join('-'))
      }
      if (p) {
        pit.push([ipToOuts(p.ip), n(p.h), n(p.r), n(p.er), n(p.bb), n(p.so), n(p.hr)].join('-'))
      }
    }
  }
  return {
    away_score: n(sides.away?.runs), home_score: n(sides.home?.runs),
    away_hits: n(sides.away?.hits), home_hits: n(sides.home?.hits),
    away_errors: n(sides.away?.errors), home_errors: n(sides.home?.errors),
    plays: (box.plays ?? []).length,
    batting: bat.sort().join(' '), pitching: pit.sort().join(' '),
    source_updated_at: instant(box.source_updated_at),
  }
}

export function fingerprintOurs(row) {
  return {
    away_score: n(row.away_score), home_score: n(row.home_score),
    away_hits: n(row.away_hits), home_hits: n(row.home_hits),
    away_errors: n(row.away_errors), home_errors: n(row.home_errors),
    plays: n(row.plays),
    batting: (row.batting ?? []).slice().sort().join(' '),
    pitching: (row.pitching ?? []).slice().sort().join(' '),
    source_updated_at: instant(row.source_updated_at),
  }
}

/** The comparison itself, kept pure so it can be tested without a feed or a database.
 *  Returns one entry per field that disagrees. */
export function diffGame(box, row) {
  const feed = fingerprintFeed(box)
  const held = fingerprintOurs(row)
  const diffs = []
  for (const k of Object.keys(feed)) {
    if (String(feed[k]) !== String(held[k])) {
      const fmt = (v) => (k === 'source_updated_at' && v ? new Date(v).toISOString() : v)
      diffs.push({ field: k, feed: fmt(feed[k]), ours: fmt(held[k]) })
    }
  }
  // The boxscore only reaches this function once the feed calls it complete, so anything we
  // still hold as live or scheduled is drift in the field readers notice first.
  if (row.status !== 'final') diffs.push({ field: 'status', feed: 'final', ours: row.status })
  return diffs
}

const OURS_SQL = `
  select g.id, g.api_game_id, g.game_date::text as game_date, g.status,
         g.away_team_id, g.home_team_id,
         g.away_score, g.home_score, g.away_hits, g.home_hits, g.away_errors, g.home_errors,
         g.source_updated_at,
         (select count(*) from wpbl_game_plays p where p.game_id = g.id) as plays,
         (select array_agg(b.ab||'-'||b.r||'-'||b.h||'-'||b.rbi||'-'||b.bb||'-'||b.so||'-'||b.hr||'-'||b.doubles||'-'||b.triples||'-'||b.sb)
            from wpbl_batting_lines b where b.game_id = g.id) as batting,
         (select array_agg(p.outs||'-'||p.h||'-'||p.r||'-'||p.er||'-'||p.bb||'-'||p.so||'-'||p.hr)
            from wpbl_pitching_lines p where p.game_id = g.id) as pitching
  from wpbl_games g`

async function readOurs(url) {
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const { rows } = await client.query(OURS_SQL)
    return rows
  } finally {
    await client.end().catch(() => {})
  }
}

/** Re-ingest one game. The edge function owns every rule about how a game becomes rows;
 *  repairing by writing to the tables directly would fork that logic, and `wpbl_game_plays`
 *  is a mirror that the next ingest pass would overwrite anyway. */
async function reingest(apiGameId) {
  const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) throw new Error('--repair needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  const res = await fetch(`${base.replace(/\/$/, '')}/functions/v1/wpbl-ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ gameId: apiGameId }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.ok === false) throw new Error(`ingest ${apiGameId}: ${res.status} ${JSON.stringify(body)}`)
  return body
}

async function scan(ours) {
  const byApi = new Map(ours.map(r => [r.api_game_id, r]))

  const listRes = await fetch(`${FEED}/games?limit=500`)
  if (!listRes.ok) throw new Error(`games list → ${listRes.status}`)
  const list = await listRes.json()
  const feedGames = list.games ?? []
  // The list caps silently and reports the real total beside the short array. A partial
  // schedule would make missing games look like games the league never played.
  if (Number.isFinite(Number(list.count)) && feedGames.length < Number(list.count)) {
    throw new Error(`feed /games truncated: ${feedGames.length} of ${list.count}`)
  }

  const drift = [], missing = []
  let checked = 0
  for (const fg of feedGames) {
    const apiGameId = s(fg.game_id)
    if (!apiGameId) continue
    const res = await fetch(`${FEED}/games/${apiGameId}/boxscore`)
    if (!res.ok) continue
    const box = (await res.json()).boxscore
    if (!box?.status?.complete) continue
    checked++

    const mine = byApi.get(apiGameId)
    if (!mine) {
      // Not necessarily a fault: the feed carries timezone twins and stale never-played
      // copies, and the ingest deliberately suppresses those. A COMPLETED copy we hold no
      // row for is the shape that matters, so report it and let a person judge.
      missing.push({ api_game_id: apiGameId, scheduled_start: s(fg.scheduled_start) })
      continue
    }

    const diffs = diffGame(box, mine)
    if (diffs.length) {
      drift.push({
        api_game_id: apiGameId, game_date: mine.game_date,
        matchup: `${mine.away_team_id}@${mine.home_team_id}`, diffs,
      })
    }
  }
  return { checked, drift, missing }
}

async function main() {
  const url = process.env.SUPABASE_DB_URL
  if (!url) {
    console.error('SUPABASE_DB_URL is not set. Run with: node --env-file=.env scripts/check-wpbl-drift.mjs')
    process.exit(2)
  }

  let { checked, drift, missing } = await scan(await readOurs(url))

  const repaired = []
  if (REPAIR && drift.length) {
    for (const g of drift) {
      try {
        await reingest(g.api_game_id)
        repaired.push(g.api_game_id)
      } catch (err) {
        console.error(`  repair failed: ${err.message}`)
      }
    }
    // Re-read rather than assume. A repair that ran without error but left the row unchanged
    // is the interesting case: it means the disagreement is not something re-ingesting fixes.
    ;({ checked, drift, missing } = await scan(await readOurs(url)))
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ generated_at: new Date().toISOString(), checked, repaired, drift, missing }, null, 2))
  } else {
    console.log(`Checked ${checked} completed games against the feed.`)
    if (repaired.length) console.log(`Re-ingested ${repaired.length}: ${repaired.join(', ')}`)
    for (const m of missing) console.log(`  NOT MIRRORED  ${m.scheduled_start}  ${m.api_game_id}`)
    for (const g of drift) {
      console.log(`\n  DRIFT  ${g.game_date}  ${g.matchup}  (${g.api_game_id})`)
      for (const d of g.diffs) console.log(`    ${d.field}: feed=${d.feed} ours=${d.ours}`)
    }
    if (!drift.length && !missing.length) console.log('In sync: no drift.')
  }
  process.exit(drift.length || missing.length ? 1 : 0)
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(err); process.exit(2) })
}

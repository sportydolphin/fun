#!/usr/bin/env node
/**
 * backfill-wpbl-pitching-sacrifices.mjs: fill `ab`, `sh` and `sf` on the pitching lines written
 * before the ingest stored them (migration 20261123090000).
 *
 * WHY A BACKFILL AND NOT A RE-INGEST. A re-ingest rewrites the whole game (lines, plays, the
 * mirror), and a final the league is still editing would come back with its new scoring and no
 * revision recorded; check-wpbl-drift.mjs is the one path allowed to do that. This touches three
 * new columns and nothing else, so it cannot move any figure the site already prints except the
 * one that was wrong (pitcher BABIP).
 *
 * CHECKED BEFORE IT WRITES. Every game's sacrifice bunts against each club's pitchers must sum to
 * the other club's batters' `sh`, which our box score already holds. A game that disagrees is
 * reported and skipped, so a mismatched player cannot write a wrong count.
 *
 * Usage:
 *   node --env-file=.env scripts/backfill-wpbl-pitching-sacrifices.mjs           # dry run: report only
 *   node --env-file=.env scripts/backfill-wpbl-pitching-sacrifices.mjs --write   # apply
 *
 * Needs SUPABASE_DB_URL. Safe to re-run: it only ever sets the three columns to the feed's values.
 */
import pg from 'pg'

const FEED = 'https://stats.womensprobaseballleague.com/v1'
const WRITE = process.argv.includes('--write')
const n = (v) => (v == null || v === '' ? 0 : Number(v) || 0)

const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('SUPABASE_DB_URL is not set. Run with: node --env-file=.env scripts/backfill-wpbl-pitching-sacrifices.mjs')
  process.exit(2)
}

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()
try {
  const games = (await db.query(
    `select id, api_game_id, game_date::text as game_date, home_team_id, away_team_id from wpbl_games
     where status = 'final' and api_game_id is not null order by game_date`)).rows
  const players = (await db.query('select id, api_id, api_ids from wpbl_players')).rows
  const byApi = new Map()
  for (const p of players) for (const a of [p.api_id, ...(p.api_ids ?? [])]) if (a) byApi.set(String(a), p.id)
  const lines = (await db.query('select id, game_id, player_id, team_id, ab, sh, sf from wpbl_pitching_lines')).rows
  const lineOf = new Map(lines.map(l => [`${l.game_id}|${l.player_id}`, l]))
  const batSh = new Map((await db.query(
    'select game_id, team_id, sum(sh)::int as sh from wpbl_batting_lines group by 1, 2')).rows
    .map(r => [`${r.game_id}|${r.team_id}`, r.sh]))

  let updates = 0, unchanged = 0, skipped = 0
  for (const g of games) {
    const res = await fetch(`${FEED}/games/${g.api_game_id}/boxscore`)
    if (!res.ok) { console.log(`  SKIP ${g.game_date} ${g.away_team_id}@${g.home_team_id}: box score ${res.status}`); skipped++; continue }
    const box = (await res.json()).boxscore
    const sides = { home: g.home_team_id, away: g.away_team_id }
    const writes = []
    const problems = []
    for (const team of box?.teams ?? []) {
      const ours = sides[team.side]
      const opp = team.side === 'home' ? g.away_team_id : g.home_team_id
      let sh = 0
      for (const pl of team.players ?? []) {
        const pit = pl.pitching
        if (!pit) continue
        const playerId = byApi.get(String(pl.id))
        const line = playerId ? lineOf.get(`${g.id}|${playerId}`) : null
        if (!line) { problems.push(`no line for ${pl.name} (${pl.id})`); continue }
        sh += n(pit.sha)
        writes.push({ line, ab: n(pit.ab), sh: n(pit.sha), sf: n(pit.sfa) })
      }
      // The free cross-check: bunts against this club's pitchers are the other club's bunts.
      const theirs = batSh.get(`${g.id}|${opp}`) ?? 0
      if (sh !== theirs) problems.push(`${ours} pitchers faced ${sh} sacrifice bunts, ${opp} batters laid down ${theirs}`)
    }
    if (problems.length) {
      console.log(`  SKIP ${g.game_date} ${g.away_team_id}@${g.home_team_id}: ${problems.join('; ')}`)
      skipped++
      continue
    }
    for (const w of writes) {
      if (w.line.ab === w.ab && w.line.sh === w.sh && w.line.sf === w.sf) { unchanged++; continue }
      updates++
      if (WRITE) {
        await db.query('update wpbl_pitching_lines set ab = $1, sh = $2, sf = $3 where id = $4', [w.ab, w.sh, w.sf, w.line.id])
      }
    }
  }
  console.log(`${games.length} finals: ${updates} line(s) ${WRITE ? 'written' : 'to write'}, ${unchanged} already current, ${skipped} game(s) skipped.`)
  if (!WRITE && updates) console.log('Dry run. Pass --write to apply.')
  process.exit(skipped ? 1 : 0)
} finally {
  await db.end().catch(() => {})
}

#!/usr/bin/env node
/**
 * update-prediction-boards.mjs — Nightly windowed prediction leaderboards.
 *
 * The all-time board is a live read of prediction_stats. The weekly/monthly cuts
 * can't be, because correctness isn't stored per pick — it's derived from the
 * StatsAPI schedule. So this job pulls the last 30 days of picks, grades them
 * against the day's results, tallies each user's record in the 7- and 30-day
 * windows, ranks by Wilson lower bound (same as the live board), and writes one
 * jsonb row per window into prediction_boards. The client reads a single row.
 *
 * Usage (local):
 *   node scripts/update-prediction-boards.mjs --dry-run
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/update-prediction-boards.mjs
 *
 * npm script: npm run pred-boards
 */

import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

const DRY_RUN = process.argv.includes('--dry-run')

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running (or use --dry-run)')
  process.exit(1)
}

// Windows are last N calendar days ending today (inclusive), keyed by game_date.
const WINDOWS = [
  { key: 'week',  days: 7  },
  { key: 'month', days: 30 },
]
const MAX_DAYS = Math.max(...WINDOWS.map(w => w.days))

// ─── Helpers ────────────────────────────────────────────────────────────────

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Wilson score lower bound (95%) — identical to the client's ranking key so the
// windowed boards order picks the same way the all-time board does.
function wilsonLowerBound(correct, total) {
  if (total === 0) return 0
  const z = 1.96, z2 = z * z
  const p = correct / total
  return (p + z2 / (2 * total) - z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / (1 + z2 / total)
}

async function fetchJson(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json()
}

// gamePk → winnerId (finalized games only) across the whole window, one call.
async function fetchResults(startDate, endDate) {
  const d = await fetchJson(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}&gameType=R` +
    `&fields=dates,date,games,gamePk,status,abstractGameState,teams,home,away,team,id,isWinner`
  )
  const out = new Map()
  for (const dateObj of d.dates ?? []) {
    for (const g of dateObj.games ?? []) {
      if (g.status?.abstractGameState !== 'Final') continue
      const homeId = Number(g.teams?.home?.team?.id ?? 0)
      const awayId = Number(g.teams?.away?.team?.id ?? 0)
      const winnerId = g.teams?.home?.isWinner ? homeId
        : g.teams?.away?.isWinner ? awayId : null
      if (winnerId != null) out.set(Number(g.gamePk), winnerId)
    }
  }
  return out
}

// All picks with game_date in [since, today]. Paginated — a busy month easily
// clears Supabase's 1000-row default, and a missed page would drop a whole user.
async function fetchPredictionsSince(supabase, since) {
  const rows = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('game_predictions')
      .select('user_id, game_date, game_pk, predicted_team_id')
      .gte('game_date', since)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`game_predictions read failed: ${error.message}`)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return rows
}

// user_id → best display name: current username, else the stored stats name.
async function fetchNames(supabase, userIds) {
  const names = new Map()
  if (userIds.length === 0) return names
  const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o }
  for (const ids of chunk(userIds, 200)) {
    const [{ data: stats }, { data: unames }] = await Promise.all([
      supabase.from('prediction_stats').select('user_id, display_name').in('user_id', ids),
      supabase.from('usernames').select('user_id, username').in('user_id', ids),
    ])
    for (const s of stats ?? []) if (s.display_name) names.set(s.user_id, s.display_name)
    for (const u of unames ?? []) if (u.username) names.set(u.user_id, u.username)   // username wins
  }
  return names
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n📊 Prediction boards${DRY_RUN ? ' (dry run)' : ''}\n`)

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  })

  const now   = new Date()
  const today = ymd(now)
  const since = ymd(new Date(now.getTime() - (MAX_DAYS - 1) * 86400000))

  const [preds, results] = await Promise.all([
    fetchPredictionsSince(supabase, since),
    fetchResults(since, today),
  ])
  console.log(`  ${preds.length} picks since ${since} · ${results.size} finalized games`)

  // Per-window tally: userId → { correct, total }
  const tallies = new Map(WINDOWS.map(w => [w.key, new Map()]))
  const cutoffs = new Map(WINDOWS.map(w => [w.key, ymd(new Date(now.getTime() - (w.days - 1) * 86400000))]))

  for (const p of preds) {
    const winnerId = results.get(Number(p.game_pk))
    if (winnerId == null) continue                       // not finalized → not scored
    const correct = winnerId === Number(p.predicted_team_id)
    for (const w of WINDOWS) {
      if (p.game_date < cutoffs.get(w.key)) continue
      const board = tallies.get(w.key)
      const cur = board.get(p.user_id) ?? { correct: 0, total: 0 }
      cur.total++
      if (correct) cur.correct++
      board.set(p.user_id, cur)
    }
  }

  // Names for everyone who appears in any window
  const userIds = [...new Set(WINDOWS.flatMap(w => [...tallies.get(w.key).keys()]))]
  const names = await fetchNames(supabase, userIds)

  const boards = WINDOWS.map(w => {
    const entries = [...tallies.get(w.key)]
      .map(([userId, s]) => ({
        userId,
        displayName: names.get(userId) ?? 'Anonymous',
        correct:     s.correct,
        total:       s.total,
        accuracy:    Math.round((s.correct / s.total) * 100),
        _score:      wilsonLowerBound(s.correct, s.total),
      }))
      .sort((a, b) => b._score - a._score || b.total - a.total)
      .map(({ _score, ...e }) => e)
    return { key: w.key, entries }
  })

  for (const b of boards) {
    console.log(`\n  ${b.key} (${b.entries.length} predictors):`)
    for (const e of b.entries.slice(0, 5)) {
      console.log(`    ${e.displayName.padEnd(20)} ${e.correct}/${e.total} (${e.accuracy}%)`)
    }
  }

  if (DRY_RUN) { console.log('\n✅  Dry run complete — nothing written\n'); return }

  for (const b of boards) {
    const { error } = await supabase
      .from('prediction_boards')
      .upsert({ window: b.key, data: { entries: b.entries }, computed_at: new Date().toISOString() }, { onConflict: 'window' })
    if (error) {
      console.error(`\n❌  Upsert failed for ${b.key}: ${error.message}`)
      console.error('    Make sure you ran scripts/create_prediction_boards.sql first.')
      process.exit(1)
    }
  }
  console.log(`\n✅  Wrote ${boards.length} windowed boards\n`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })

#!/usr/bin/env node
/**
 * update-prediction-boards.mjs — Nightly prediction leaderboards (all-time + windows).
 *
 * The board can't be a plain SQL read of prediction_stats: that table only gets a row
 * when a user opens My Stats (or nightly for bots), so anyone who predicted but never
 * viewed their stats is missing. And correctness isn't stored per pick anyway — it's
 * derived from the StatsAPI schedule. So this job grades every pick against results and
 * writes one jsonb row per window (all / week / month) covering every predictor. The
 * client reads a single row, falling back to the live prediction_stats read only if the
 * all-time board hasn't been computed yet.
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

// Each board is the last N calendar days ending today (inclusive), keyed by game_date.
// days === null means all-time (no cutoff).
const WINDOWS = [
  { key: 'all',   days: null },
  { key: 'month', days: 30 },
  { key: 'week',  days: 7 },
]

// ─── Helpers ────────────────────────────────────────────────────────────────

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Wilson score lower bound (95%) — identical to the client's ranking key so every board
// orders picks the same way, small samples penalised until the volume backs them up.
function wilsonLowerBound(correct, total) {
  if (total === 0) return 0
  const z = 1.96, z2 = z * z
  const p = correct / total
  return (p + z2 / (2 * total) - z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / (1 + z2 / total)
}

function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

async function fetchJson(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json()
}

// gamePk → winnerId (finalized games only) across the whole span, one call.
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

// Every pick, all users, all time. Paginated — a season easily clears Supabase's
// 1000-row default, and a missed page would drop a whole user from the board.
async function fetchAllPredictions(supabase) {
  const rows = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('game_predictions')
      .select('user_id, game_date, game_pk, predicted_team_id')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`game_predictions read failed: ${error.message}`)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return rows
}

// user_id → best display name: current username > auth display name (covers users who
// never opened My Stats) > stored stats name > Anonymous.
async function fetchNames(supabase, userIds) {
  const names = new Map()
  if (userIds.length === 0) return names
  const want = new Set(userIds)

  // Auth metadata — the fallback for predictors with no stats row yet.
  try {
    const { data } = await supabase.auth.admin.listUsers({ perPage: 1000 })
    for (const u of data?.users ?? []) {
      if (!want.has(u.id)) continue
      const nm = u.user_metadata?.display_name || (u.email ? u.email.split('@')[0] : null)
      if (nm) names.set(u.id, nm)
    }
  } catch { /* admin API unavailable — fall back to db names below */ }

  // Stored stats name (usually the same), then the live username, which wins.
  for (const ids of chunk(userIds, 200)) {
    const [{ data: stats }, { data: unames }] = await Promise.all([
      supabase.from('prediction_stats').select('user_id, display_name').in('user_id', ids),
      supabase.from('usernames').select('user_id, username').in('user_id', ids),
    ])
    for (const s of stats ?? []) if (s.display_name) names.set(s.user_id, s.display_name)
    for (const u of unames ?? []) if (u.username) names.set(u.user_id, u.username)
  }
  return names
}

// Owner-deactivated user_ids (is_deleted on usernames). Returns an empty set if the
// column isn't migrated yet, so the script keeps working pre-migration.
async function fetchDeactivated(supabase, userIds) {
  const out = new Set()
  if (userIds.length === 0) return out
  for (const ids of chunk(userIds, 200)) {
    const { data, error } = await supabase
      .from('usernames').select('user_id').eq('is_deleted', true).in('user_id', ids)
    if (error) return new Set()   // column missing / query failed → enforce nothing
    for (const r of data ?? []) out.add(r.user_id)
  }
  return out
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

  const preds = await fetchAllPredictions(supabase)
  if (preds.length === 0) { console.log('  No predictions yet — nothing to do\n'); return }

  // Grade every pick, then bucket by user in chronological order (for streaks).
  const minDate = preds.reduce((m, p) => (p.game_date < m ? p.game_date : m), preds[0].game_date)
  const results = await fetchResults(minDate, today)
  console.log(`  ${preds.length} picks since ${minDate} · ${results.size} finalized games`)

  const byUser = new Map()   // userId → [{ date, pk, correct }]
  for (const p of preds) {
    const winnerId = results.get(Number(p.game_pk))
    if (winnerId == null) continue                       // not finalized → not scored
    if (!byUser.has(p.user_id)) byUser.set(p.user_id, [])
    byUser.get(p.user_id).push({ date: p.game_date, pk: Number(p.game_pk), correct: winnerId === Number(p.predicted_team_id) })
  }

  const cutoff = new Map(WINDOWS.map(w => [w.key, w.days == null ? '' : ymd(new Date(now.getTime() - (w.days - 1) * 86400000))]))
  const names  = await fetchNames(supabase, [...byUser.keys()])

  // Drop owner-deactivated accounts so they never make it onto a stored board.
  const deactivated = await fetchDeactivated(supabase, [...byUser.keys()])
  for (const id of deactivated) byUser.delete(id)

  // Per user: window tallies + all-time streak, from their sorted graded picks.
  const perUser = new Map()
  for (const [userId, picks] of byUser) {
    picks.sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.pk - b.pk))
    const tally = new Map(WINDOWS.map(w => [w.key, { correct: 0, total: 0 }]))
    let currentStreak = 0
    for (const g of picks) {
      currentStreak = g.correct ? currentStreak + 1 : 0   // ends on the latest pick, so this is the current streak
      for (const w of WINDOWS) {
        if (w.days != null && g.date < cutoff.get(w.key)) continue
        const t = tally.get(w.key)
        t.total++
        if (g.correct) t.correct++
      }
    }
    perUser.set(userId, { tally, currentStreak })
  }

  // Build a Wilson-ranked entry list per window.
  const boards = WINDOWS.map(w => {
    const entries = [...perUser]
      .map(([userId, u]) => ({ userId, s: u.tally.get(w.key), currentStreak: u.currentStreak }))
      .filter(e => e.s.total > 0)
      .map(e => ({
        userId:        e.userId,
        displayName:   names.get(e.userId) ?? 'Anonymous',
        correct:       e.s.correct,
        total:         e.s.total,
        accuracy:      Math.round((e.s.correct / e.s.total) * 100),
        currentStreak: w.key === 'all' ? e.currentStreak : 0,   // streak is an all-time notion
        _score:        wilsonLowerBound(e.s.correct, e.s.total),
      }))
      .sort((a, b) => b._score - a._score || b.total - a.total)
      .map(({ _score, ...e }) => e)
    return { key: w.key, entries }
  })

  for (const b of boards) {
    console.log(`\n  ${b.key} (${b.entries.length} predictors):`)
    for (const e of b.entries.slice(0, 5)) {
      const heat = e.currentStreak >= 3 ? ` 🔥${e.currentStreak}` : ''
      console.log(`    ${e.displayName.padEnd(20)} ${e.correct}/${e.total} (${e.accuracy}%)${heat}`)
    }
  }

  if (DRY_RUN) { console.log('\n✅  Dry run complete — nothing written\n'); return }

  for (const b of boards) {
    const { error } = await supabase
      .from('prediction_boards')
      .upsert({ window_key: b.key, data: { entries: b.entries }, computed_at: new Date().toISOString() }, { onConflict: 'window_key' })
    if (error) {
      console.error(`\n❌  Upsert failed for ${b.key}: ${error.message}`)
      console.error('    Make sure you ran scripts/create_prediction_boards.sql first.')
      process.exit(1)
    }
  }
  console.log(`\n✅  Wrote ${boards.length} boards (all / month / week)\n`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })

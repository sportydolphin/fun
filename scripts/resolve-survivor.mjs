#!/usr/bin/env node
/**
 * resolve-survivor.mjs — Nightly grader for the Streak Survivor game.
 *
 * Streak Survivor: each player picks one hitter a day. A hit that day extends
 * their streak; an 0-fer resets it to 0; a day the player didn't bat is voided
 * (streak preserved, à la Beat the Streak). Picks are written from the browser
 * as `pending`; this job is the sole authority on the result.
 *
 * What it does:
 *   1. Pull every pending pick whose day is fully over (game_date < today UTC).
 *   2. Group by player, fetch each hitter's game log once, and grade each pick:
 *      • ≥1 hit that date            → 'hit'
 *      • batted (≥1 AB) with no hit  → 'miss'
 *      • didn't bat / no game        → 'void'
 *   3. Rewalk each affected user's full pick history and upsert their running
 *      current/longest streak into `survivor_stats` (one cheap read for the
 *      client leaderboard, same pattern as prediction_stats).
 *
 * Usage (local):
 *   node scripts/resolve-survivor.mjs --dry-run     # grade + print, no writes
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/resolve-survivor.mjs
 */

import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

// ─── Config ───────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run')

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running')
  process.exit(1)
}

const FETCH_CONCURRENCY = 6   // polite parallelism for the game-log fetches

// Today in UTC as YYYY-MM-DD. A pick's day counts as over once the calendar has
// rolled past it everywhere — the 06:00 UTC run is already ~1am ET, so the prior
// ET day's west-coast finals are long in.
function utcToday() {
  return new Date().toISOString().slice(0, 10)
}

// ─── StatsAPI ─────────────────────────────────────────────────────────────────

// Player's hitting game log for a season, as { 'YYYY-MM-DD': {hits, atBats} }
// summed across any games that date (doubleheaders count as one day: a hit in
// either game is a hit).
async function fetchGameLogByDate(playerId, season) {
  const r = await fetch(
    `https://statsapi.mlb.com/api/v1/people/${playerId}/stats` +
    `?stats=gameLog&group=hitting&season=${season}`
  )
  const d = await r.json()
  const splits = d.stats?.[0]?.splits ?? []
  const byDate = {}
  for (const s of splits) {
    const date = s.date
    if (!date) continue
    const st = s.stat ?? {}
    const cur = byDate[date] ?? { hits: 0, atBats: 0 }
    cur.hits   += Number(st.hits ?? 0)
    cur.atBats += Number(st.atBats ?? 0)
    byDate[date] = cur
  }
  return byDate
}

function gradePick(dayStat) {
  if (!dayStat || dayStat.atBats === 0) return 'void'  // DNP or pinch-run/walk-only day
  return dayStat.hits >= 1 ? 'hit' : 'miss'
}

// Run an async mapper over items with bounded concurrency.
async function mapPool(items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx], idx)
    }
  }))
  return out
}

// ─── Streak walk ────────────────────────────────────────────────────────────

// Given a user's picks oldest-first, compute their current and longest hit streak.
// Only graded picks move the streak: 'hit' extends, 'miss' resets to 0, 'void' and
// 'pending' are skipped (day preserved). current = trailing run at the latest
// graded pick.
function walkStreak(resultsOldestFirst) {
  let current = 0, longest = 0, hits = 0, graded = 0
  for (const res of resultsOldestFirst) {
    if (res === 'hit') { current++; hits++; graded++; if (current > longest) longest = current }
    else if (res === 'miss') { current = 0; graded++ }
    // 'void' / 'pending' — no effect
  }
  return { current, longest, totalHits: hits, totalPicks: graded }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  })

  const today = utcToday()
  console.log(`\n🎯 Streak Survivor resolver — grading picks before ${today}${DRY_RUN ? ' (dry run)' : ''}\n`)

  // 1. Pending picks whose day is over.
  const { data: pending, error: pErr } = await supabase
    .from('survivor_picks')
    .select('user_id, game_date, player_id, player_name, result')
    .eq('result', 'pending')
    .lt('game_date', today)
  if (pErr) { console.error(`❌  Could not read picks: ${pErr.message}`); process.exit(1) }

  if (!pending?.length) {
    console.log('  No pending picks to grade.\n')
  } else {
    console.log(`  ${pending.length} pending pick(s) to grade`)

    // 2. Fetch each distinct player's game log once (keyed by player + season).
    const jobs = new Map()  // `${playerId}:${season}` → {playerId, season}
    for (const p of pending) {
      const season = Number(p.game_date.slice(0, 4))
      jobs.set(`${p.player_id}:${season}`, { playerId: Number(p.player_id), season })
    }
    const jobList = [...jobs.values()]
    const logs = new Map()
    await mapPool(jobList, FETCH_CONCURRENCY, async (j) => {
      try { logs.set(`${j.playerId}:${j.season}`, await fetchGameLogByDate(j.playerId, j.season)) }
      catch { logs.set(`${j.playerId}:${j.season}`, {}) }
    })

    // 3. Grade and write each pick's result. Freshly-graded results are also kept
    // in-memory (keyed by user|date) so the streak recompute below reflects them
    // even in dry run, where nothing was persisted.
    const affectedUsers = new Set()
    const freshResult = new Map()  // `${userId}|${game_date}` → result
    let hitN = 0, missN = 0, voidN = 0
    for (const p of pending) {
      const season  = Number(p.game_date.slice(0, 4))
      const byDate  = logs.get(`${p.player_id}:${season}`) ?? {}
      const result  = gradePick(byDate[p.game_date])
      if (result === 'hit') hitN++; else if (result === 'miss') missN++; else voidN++
      affectedUsers.add(p.user_id)
      freshResult.set(`${p.user_id}|${p.game_date}`, result)
      console.log(`    ${p.game_date}  ${p.player_name.padEnd(22)} → ${result}`)

      if (!DRY_RUN) {
        const { error } = await supabase
          .from('survivor_picks')
          .update({ result, resolved_at: new Date().toISOString() })
          .eq('user_id', p.user_id)
          .eq('game_date', p.game_date)
        if (error) console.error(`      ⚠️  write failed: ${error.message}`)
      }
    }
    console.log(`\n  Graded: ${hitN} hit · ${missN} miss · ${voidN} void · ${affectedUsers.size} user(s) affected\n`)

    // 4. Recompute streaks for affected users and upsert survivor_stats.
    for (const userId of affectedUsers) {
      const { data: allPicks } = await supabase
        .from('survivor_picks')
        .select('game_date, result')
        .eq('user_id', userId)
        .order('game_date', { ascending: true })

      // Overlay this run's fresh grades so both live and dry-run see final results.
      const rows = (allPicks ?? []).map(row => ({
        game_date: row.game_date,
        result:    freshResult.get(`${userId}|${row.game_date}`) ?? row.result,
      }))
      const s = walkStreak(rows.map(r => r.result))

      // Resolve the display name: a chosen username wins, else keep whatever name
      // is already stored (bots seed their own "🤖 … Bot" name when they pick, and
      // usernames has no row for them), else Anonymous.
      let displayName = null
      const { data: nameRow } = await supabase.from('usernames').select('username').eq('user_id', userId).maybeSingle()
      if (nameRow?.username) {
        displayName = nameRow.username
      } else {
        const { data: existing } = await supabase.from('survivor_stats').select('display_name').eq('user_id', userId).maybeSingle()
        displayName = existing?.display_name ?? 'Anonymous'
      }

      const lastDate = rows.filter(r => r.result === 'hit' || r.result === 'miss').at(-1)?.game_date ?? null

      console.log(`    stats ${userId.slice(0, 8)}…  current ${s.current} · longest ${s.longest}`)
      if (!DRY_RUN) {
        const { error } = await supabase.from('survivor_stats').upsert({
          user_id: userId, display_name: displayName,
          current_streak: s.current, longest_streak: s.longest,
          total_hits: s.totalHits, total_picks: s.totalPicks,
          last_result_date: lastDate, updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' })
        if (error) console.error(`      ⚠️  stats write failed: ${error.message}`)
      }
    }
  }

  console.log(DRY_RUN ? '✅  Dry run complete — nothing written\n' : '✅  Resolve complete\n')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })

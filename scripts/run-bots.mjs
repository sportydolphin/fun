#!/usr/bin/env node
/**
 * run-bots.mjs — Daily MLB prediction bot runner
 *
 * Bots:
 *   🤖 Coin Flip       — randomly picks home or away for each game
 *   🚂 Bandwagon Bot   — picks the team with the better win% (home team breaks ties)
 *   🤖 Homer Bot       — always picks the home team
 *   🧠 Sabermetric Bot — Pythagorean expectation (runs scored/allowed) resolved by
 *                        log5 with a home-field edge; the one that's hard to beat
 *
 * Bot users are created as real Supabase auth accounts on first run so they
 * satisfy FK constraints and appear on the leaderboard like any other user.
 * Their UUIDs are logged and stored — subsequent runs look them up by email.
 *
 * Usage (local):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/run-bots.mjs
 *
 * Or via npm script:
 *   npm run bots
 *
 * Required env vars:
 *   SUPABASE_URL               — your project URL (or VITE_SUPABASE_URL as fallback)
 *   SUPABASE_SERVICE_ROLE_KEY  — service role key (NEVER the anon key)
 */

import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

// ─── Setup ────────────────────────────────────────────────────────────────────

const SUPABASE_URL  = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws },
})

const CURRENT_SEASON = new Date().getFullYear()

/** Bot definitions — emails are never used for real login, just as unique keys */
const BOTS = [
  { email: 'bot-coinflip@mlbpicks.internal',    displayName: '🤖 Coin Flip' },
  { email: 'bot-betterrecord@mlbpicks.internal', displayName: '🚂 Bandwagon Bot' },
  { email: 'bot-hometeam@mlbpicks.internal',    displayName: '🤖 Homer Bot' },
  { email: 'bot-pythag@mlbpicks.internal',      displayName: '🧠 Sabermetric Bot' },
]

// ─── Date helper ─────────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ─── Bot user management ──────────────────────────────────────────────────────

/**
 * Returns the existing user ID for the bot email, or creates a new auth user
 * and returns its UUID. The password is random and never used — bots only write
 * through the service role key.
 */
async function getOrCreateBotUser(email, displayName) {
  // listUsers returns up to 1000 by default; fine for a small project
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  if (listErr) throw new Error(`listUsers failed: ${listErr.message}`)

  const existing = list?.users?.find(u => u.email === email)
  if (existing) return existing.id

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password:       `bot-${Math.random().toString(36).slice(2)}-${Date.now()}`,
    email_confirm:  true,
    user_metadata:  { display_name: displayName, is_bot: true },
  })
  if (error) throw new Error(`createUser(${email}) failed: ${error.message}`)
  console.log(`  ✅ Created bot auth user: ${displayName} → ${data.user.id}`)
  return data.user.id
}

// ─── MLB API ──────────────────────────────────────────────────────────────────

async function fetchGamesForDate(date) {
  const res = await fetch(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&gameType=R` +
    `&fields=dates,games,gamePk,status,abstractGameState,teams,home,away,team,id`
  )
  const d = await res.json()
  const games = []
  for (const dateObj of d.dates ?? []) {
    for (const g of dateObj.games ?? []) {
      const raw = g.status?.abstractGameState ?? 'Preview'
      games.push({
        gamePk: g.gamePk,
        homeId: Number(g.teams?.home?.team?.id ?? 0),
        awayId: Number(g.teams?.away?.team?.id ?? 0),
        state:  raw === 'Final' ? 'final' : raw === 'Live' ? 'live' : 'preview',
      })
    }
  }
  return games
}

/** Per-team record + run totals, keyed by teamId: { winPct, rs, ra } */
async function fetchStandings() {
  const res = await fetch(
    `https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=${CURRENT_SEASON}` +
    `&standingsTypes=regularSeason&fields=records,teamRecords,team,id,wins,losses,runsScored,runsAllowed`
  )
  const d = await res.json()
  const out = {}
  for (const record of d.records ?? []) {
    for (const tr of record.teamRecords ?? []) {
      const id = Number(tr.team?.id ?? 0)
      const w  = tr.wins   ?? 0
      const l  = tr.losses ?? 0
      out[id]  = {
        winPct: w / (w + l || 1),
        rs:     Number(tr.runsScored  ?? 0),
        ra:     Number(tr.runsAllowed ?? 0),
      }
    }
  }
  return out
}

// ─── Prediction logic ─────────────────────────────────────────────────────────

function coinFlipPick(game) {
  return Math.random() < 0.5 ? game.homeId : game.awayId
}

function betterRecordPick(game, standings) {
  const home = standings[game.homeId]?.winPct ?? 0
  const away = standings[game.awayId]?.winPct ?? 0
  return home >= away ? game.homeId : game.awayId   // home team breaks ties
}

function homeTeamPick(game) {
  return game.homeId   // bet on home-field advantage, every time
}

// Pythagorean win expectation — a team's "deserved" win rate from runs scored/allowed,
// which sees through a lucky or unlucky W-L record. Exponent 1.83 is the classic MLB fit.
function pythagExpectation(t) {
  const rs = t?.rs ?? 0, ra = t?.ra ?? 0
  if (rs <= 0 && ra <= 0) return 0.5
  const rsE = Math.pow(rs, 1.83), raE = Math.pow(ra, 1.83)
  return rsE / (rsE + raE || 1)
}

// Smart bot: rate each team by Pythagorean expectation, resolve the matchup with the
// log5 formula, then hand the home side a small real-world edge. Because it trusts run
// differential over a possibly-lucky record, it should sit a notch above Bandwagon.
const HOME_EDGE = 0.04
function pythagPick(game, standings) {
  const pH = pythagExpectation(standings[game.homeId])
  const pA = pythagExpectation(standings[game.awayId])
  const denom = pH * (1 - pA) + pA * (1 - pH)          // log5 denominator
  const neutral = denom > 0 ? (pH * (1 - pA)) / denom : 0.5
  const homeWinProb = Math.min(1, Math.max(0, neutral + HOME_EDGE))
  return homeWinProb >= 0.5 ? game.homeId : game.awayId
}

// ─── Stats computation ────────────────────────────────────────────────────────

/**
 * Reads all of a bot's predictions from the DB, fetches all game results in
 * one batched MLB API call, computes accuracy, then upserts to prediction_stats.
 */
async function computeAndUpsertStats(userId, displayName) {
  const { data: rows } = await supabase
    .from('game_predictions')
    .select('game_date, game_pk, predicted_team_id')
    .eq('user_id', userId)

  if (!rows || rows.length === 0) return

  const dates   = rows.map(r => r.game_date).sort()
  const minDate = dates[0]
  const maxDate = dates[dates.length - 1]

  // One batched call for all results in range
  const gameMap = {}
  try {
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1` +
      `&startDate=${minDate}&endDate=${maxDate}&gameType=R` +
      `&fields=dates,date,games,gamePk,status,abstractGameState,teams,home,away,team,id,isWinner`
    )
    const d = await res.json()
    for (const dateObj of d.dates ?? []) {
      for (const g of dateObj.games ?? []) {
        if (g.status?.abstractGameState !== 'Final') continue
        const homeId   = Number(g.teams?.home?.team?.id ?? 0)
        const awayId   = Number(g.teams?.away?.team?.id ?? 0)
        const winnerId = g.teams?.home?.isWinner ? homeId
          : g.teams?.away?.isWinner ? awayId : null
        gameMap[g.gamePk] = { winnerId }
      }
    }
  } catch { /* best effort */ }

  // Chronological order so the streaks below track the real sequence of results.
  const sorted = [...rows].sort((a, b) =>
    a.game_date !== b.game_date ? a.game_date.localeCompare(b.game_date) : a.game_pk - b.game_pk)

  let finalizedCount = 0, correctPredictions = 0
  const finalizedResults = []
  for (const row of sorted) {
    const game = gameMap[row.game_pk]
    if (!game || game.winnerId === null || game.winnerId === undefined) continue
    finalizedCount++
    const isCorrect = game.winnerId === Number(row.predicted_team_id)
    if (isCorrect) correctPredictions++
    finalizedResults.push(isCorrect)
  }

  if (finalizedCount === 0) return

  const accuracyPct = Math.round(correctPredictions / finalizedCount * 100)

  // Current streak = trailing correct from the latest result; best streak = longest ever.
  let currentStreak = 0
  for (let i = finalizedResults.length - 1; i >= 0 && finalizedResults[i]; i--) currentStreak++
  let bestStreak = 0, run = 0
  for (const r of finalizedResults) { run = r ? run + 1 : 0; if (run > bestStreak) bestStreak = run }

  const { error } = await supabase.from('prediction_stats').upsert({
    user_id:             userId,
    display_name:        displayName,
    correct_predictions: correctPredictions,
    total_predictions:   finalizedCount,
    accuracy_pct:        accuracyPct,
    current_streak:      currentStreak,
    best_streak:         bestStreak,
    updated_at:          new Date().toISOString(),
  }, { onConflict: 'user_id' })

  if (error) {
    console.warn(`  ⚠️  Stats upsert skipped (${error.message}) — run the prediction_stats SQL migrations first`)
  } else {
    const heat = currentStreak >= 3 ? ` 🔥${currentStreak}` : ''
    console.log(`  📊 ${displayName}: ${correctPredictions}/${finalizedCount} correct (${accuracyPct}%)${heat}`)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const date = todayStr()
  console.log(`\n🤖 MLB Bot Runner — ${date}\n`)

  // ── 1. Get or create bot auth users ────────────────────────────────────────
  console.log('👤 Resolving bot users…')
  const [coinFlipId, betterRecordId, homerId, pythagId] = await Promise.all([
    getOrCreateBotUser(BOTS[0].email, BOTS[0].displayName),
    getOrCreateBotUser(BOTS[1].email, BOTS[1].displayName),
    getOrCreateBotUser(BOTS[2].email, BOTS[2].displayName),
    getOrCreateBotUser(BOTS[3].email, BOTS[3].displayName),
  ])
  console.log(`  🤖 Coin Flip ID:     ${coinFlipId}`)
  console.log(`  📊 Better Record ID: ${betterRecordId}`)
  console.log(`  🏠 Homer Bot ID:     ${homerId}`)
  console.log(`  🧠 Sabermetric ID:   ${pythagId}`)

  // ── 2. Fetch today's games ─────────────────────────────────────────────────
  console.log(`\n📅 Fetching games for ${date}…`)
  const allGames   = await fetchGamesForDate(date)
  const preview    = allGames.filter(g => g.state === 'preview')
  console.log(`  ${allGames.length} total games, ${preview.length} not yet started`)

  // ── 3. Make picks for upcoming games only ──────────────────────────────────
  if (preview.length > 0) {
    console.log('\n🎯 Making picks…')
    const standings = await fetchStandings()

    const coinFlipRows = preview.map(g => ({
      user_id:           coinFlipId,
      game_date:         date,
      game_pk:           g.gamePk,
      predicted_team_id: coinFlipPick(g),
    }))

    const betterRecordRows = preview.map(g => ({
      user_id:           betterRecordId,
      game_date:         date,
      game_pk:           g.gamePk,
      predicted_team_id: betterRecordPick(g, standings),
    }))

    const homerRows = preview.map(g => ({
      user_id:           homerId,
      game_date:         date,
      game_pk:           g.gamePk,
      predicted_team_id: homeTeamPick(g),
    }))

    const pythagRows = preview.map(g => ({
      user_id:           pythagId,
      game_date:         date,
      game_pk:           g.gamePk,
      predicted_team_id: pythagPick(g, standings),
    }))

    // ignoreDuplicates: true → first pick wins, don't overwrite if already set
    const { error: cfErr } = await supabase
      .from('game_predictions')
      .upsert(coinFlipRows, { onConflict: 'user_id,game_pk', ignoreDuplicates: true })
    if (cfErr) console.error(`  ❌ Coin Flip insert failed: ${cfErr.message}`)
    else console.log(`  🤖 Coin Flip: ${coinFlipRows.length} picks saved`)

    const { error: brErr } = await supabase
      .from('game_predictions')
      .upsert(betterRecordRows, { onConflict: 'user_id,game_pk', ignoreDuplicates: true })
    if (brErr) console.error(`  ❌ Better Record insert failed: ${brErr.message}`)
    else console.log(`  📊 Better Record: ${betterRecordRows.length} picks saved`)

    const { error: hmErr } = await supabase
      .from('game_predictions')
      .upsert(homerRows, { onConflict: 'user_id,game_pk', ignoreDuplicates: true })
    if (hmErr) console.error(`  ❌ Homer Bot insert failed: ${hmErr.message}`)
    else console.log(`  🏠 Homer Bot: ${homerRows.length} picks saved`)

    const { error: pyErr } = await supabase
      .from('game_predictions')
      .upsert(pythagRows, { onConflict: 'user_id,game_pk', ignoreDuplicates: true })
    if (pyErr) console.error(`  ❌ Sabermetric Bot insert failed: ${pyErr.message}`)
    else console.log(`  🧠 Sabermetric Bot: ${pythagRows.length} picks saved`)
  } else {
    console.log('  No upcoming games — skipping picks')
  }

  // ── 4. Recompute and upsert all-time stats ─────────────────────────────────
  console.log('\n📈 Updating leaderboard stats…')
  await computeAndUpsertStats(coinFlipId,     BOTS[0].displayName)
  await computeAndUpsertStats(betterRecordId, BOTS[1].displayName)
  await computeAndUpsertStats(homerId,        BOTS[2].displayName)
  await computeAndUpsertStats(pythagId,       BOTS[3].displayName)

  console.log('\n✅ Done\n')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })

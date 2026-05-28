#!/usr/bin/env node
/**
 * run-bots.mjs — Daily MLB prediction bot runner
 *
 * Bots:
 *   🤖 Coin Flip     — randomly picks home or away for each game
 *   📊 Better Record — picks the team with the better win% (home team breaks ties)
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

// ─── Setup ────────────────────────────────────────────────────────────────────

const SUPABASE_URL  = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const CURRENT_SEASON = new Date().getFullYear()

/** Bot definitions — emails are never used for real login, just as unique keys */
const BOTS = [
  { email: 'bot-coinflip@mlbpicks.internal',    displayName: '🤖 Coin Flip' },
  { email: 'bot-betterrecord@mlbpicks.internal', displayName: '📊 Better Record' },
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

/** Returns win% keyed by teamId */
async function fetchStandings() {
  const res = await fetch(
    `https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=${CURRENT_SEASON}` +
    `&standingsTypes=regularSeason&fields=records,teamRecords,team,id,wins,losses`
  )
  const d = await res.json()
  const out = {}
  for (const record of d.records ?? []) {
    for (const tr of record.teamRecords ?? []) {
      const id = Number(tr.team?.id ?? 0)
      const w  = tr.wins   ?? 0
      const l  = tr.losses ?? 0
      out[id]  = w / (w + l || 1)
    }
  }
  return out
}

// ─── Prediction logic ─────────────────────────────────────────────────────────

function coinFlipPick(game) {
  return Math.random() < 0.5 ? game.homeId : game.awayId
}

function betterRecordPick(game, winPct) {
  const home = winPct[game.homeId] ?? 0
  const away = winPct[game.awayId] ?? 0
  return home >= away ? game.homeId : game.awayId   // home team breaks ties
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

  let finalizedCount = 0, correctPredictions = 0
  for (const row of rows) {
    const game = gameMap[row.game_pk]
    if (!game || game.winnerId === null || game.winnerId === undefined) continue
    finalizedCount++
    if (game.winnerId === Number(row.predicted_team_id)) correctPredictions++
  }

  if (finalizedCount === 0) return

  const accuracyPct = Math.round(correctPredictions / finalizedCount * 100)

  const { error } = await supabase.from('prediction_stats').upsert({
    user_id:             userId,
    display_name:        displayName,
    correct_predictions: correctPredictions,
    total_predictions:   finalizedCount,
    accuracy_pct:        accuracyPct,
    updated_at:          new Date().toISOString(),
  }, { onConflict: 'user_id' })

  if (error) {
    console.warn(`  ⚠️  Stats upsert skipped (${error.message}) — run the prediction_stats SQL migration first`)
  } else {
    console.log(`  📊 ${displayName}: ${correctPredictions}/${finalizedCount} correct (${accuracyPct}%)`)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const date = todayStr()
  console.log(`\n🤖 MLB Bot Runner — ${date}\n`)

  // ── 1. Get or create bot auth users ────────────────────────────────────────
  console.log('👤 Resolving bot users…')
  const [coinFlipId, betterRecordId] = await Promise.all([
    getOrCreateBotUser(BOTS[0].email, BOTS[0].displayName),
    getOrCreateBotUser(BOTS[1].email, BOTS[1].displayName),
  ])
  console.log(`  🤖 Coin Flip ID:     ${coinFlipId}`)
  console.log(`  📊 Better Record ID: ${betterRecordId}`)

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
  } else {
    console.log('  No upcoming games — skipping picks')
  }

  // ── 4. Recompute and upsert all-time stats ─────────────────────────────────
  console.log('\n📈 Updating leaderboard stats…')
  await computeAndUpsertStats(coinFlipId,     BOTS[0].displayName)
  await computeAndUpsertStats(betterRecordId, BOTS[1].displayName)

  console.log('\n✅ Done\n')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })

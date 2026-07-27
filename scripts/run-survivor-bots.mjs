#!/usr/bin/env node
/**
 * run-survivor-bots.mjs — Daily Streak Survivor bot picks.
 *
 * Each bot picks one hitter for today whose team hasn't played yet, so the
 * leaderboard has rivals from day one. Picks are written as `pending`; the nightly
 * resolver (resolve-survivor.mjs) grades them and maintains the streaks like it
 * does for human players.
 *
 * Bots (all prefixed with a robot emoji, all named "… Bot"):
 *   🤖 Streak Bot    — the hitter on the longest active hitting streak today
 *   🤖 Chalk Bot     — the highest batting-average qualified hitter today
 *   🤖 Coin Flip Bot — a random qualified hitter playing today
 *
 * Bot users are the same kind of real Supabase auth accounts the prediction bots
 * use (is_bot metadata, looked up by email key). Reuses that plumbing.
 *
 * Usage (local):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/run-survivor-bots.mjs
 *
 * npm script: npm run survivor-bots
 */

import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws },
})

const SEASON = new Date().getFullYear()

const BOTS = {
  streak: { email: 'survivor-bot-streak@mlbpicks.internal',   displayName: '🤖 Streak Bot' },
  chalk:  { email: 'survivor-bot-chalk@mlbpicks.internal',    displayName: '🤖 Chalk Bot' },
  coin:   { email: 'survivor-bot-coinflip@mlbpicks.internal', displayName: '🤖 Coin Flip Bot' },
}

// Today's calendar day in ET, matching the app + resolver (game_date is the ET day).
function todayStr() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

// ─── Bot user management (same pattern as run-bots.mjs) ───────────────────────

async function getOrCreateBotUser(email, displayName) {
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  if (listErr) throw new Error(`listUsers failed: ${listErr.message}`)
  const existing = list?.users?.find(u => u.email === email)
  if (existing) return existing.id

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password:      `bot-${Math.random().toString(36).slice(2)}-${Date.now()}`,
    email_confirm: true,
    user_metadata: { display_name: displayName, is_bot: true },
  })
  if (error) throw new Error(`createUser(${email}) failed: ${error.message}`)
  console.log(`  ✅ Created bot auth user: ${displayName} → ${data.user.id}`)
  return data.user.id
}

// ─── Candidate data ───────────────────────────────────────────────────────────

// Teams whose game today hasn't started yet — the only valid teams to pick from.
async function fetchPreviewTeams(date) {
  const res = await fetch(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&gameType=R` +
    `&fields=dates,games,gamePk,status,abstractGameState,teams,home,away,team,id`
  )
  const d = await res.json()
  const teams = new Set()
  for (const dateObj of d.dates ?? []) {
    for (const g of dateObj.games ?? []) {
      if ((g.status?.abstractGameState ?? 'Preview') !== 'Preview') continue
      const h = Number(g.teams?.home?.team?.id ?? 0)
      const a = Number(g.teams?.away?.team?.id ?? 0)
      if (h) teams.add(h)
      if (a) teams.add(a)
    }
  }
  return teams
}

// Qualified hitters ranked by batting average, best first.
async function fetchAvgPool(season) {
  const res = await fetch(
    `https://statsapi.mlb.com/api/v1/stats/leaders?leaderCategories=battingAverage` +
    `&season=${season}&sportId=1&statGroup=hitting&leaderGameTypes=R&limit=150`
  )
  const d = await res.json()
  const out = []
  for (const cat of d.leagueLeaders ?? []) {
    for (const l of cat.leaders ?? []) {
      const playerId = Number(l.person?.id ?? 0)
      const teamId   = Number(l.team?.id ?? 0)
      if (!playerId || !teamId) continue
      out.push({ playerId, playerName: l.person?.fullName ?? 'Unknown', teamId, avg: Number(l.value) || 0 })
    }
  }
  // Already rank-ordered, but sort defensively by avg desc.
  return out.sort((a, b) => b.avg - a.avg)
}

// Active hitting-streak board from the nightly precompute (streak_leaders table).
async function fetchStreakBoard(season) {
  try {
    const { data } = await supabase.from('streak_leaders').select('data').eq('season', season).limit(1)
    const hitting = data?.[0]?.data?.hitting ?? []
    return hitting
      .map(s => ({ playerId: Number(s.playerId), playerName: s.playerName, teamId: Number(s.teamId), streak: Number(s.value) || 0 }))
      .filter(s => s.playerId && s.teamId)
  } catch { return [] }
}

// ─── Pick strategies ──────────────────────────────────────────────────────────

function pickStreak(previewTeams, streakBoard, avgPool) {
  return streakBoard.find(s => previewTeams.has(s.teamId))
      ?? avgPool.find(p => previewTeams.has(p.teamId))
      ?? null
}

function pickChalk(previewTeams, avgPool) {
  return avgPool.find(p => previewTeams.has(p.teamId)) ?? null
}

function pickCoin(previewTeams, avgPool) {
  const pool = avgPool.filter(p => previewTeams.has(p.teamId))
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null
}

// ─── Writes ─────────────────────────────────────────────────────────────────

async function savePick(userId, displayName, date, pick, label) {
  if (!pick) { console.log(`  ${label}: no eligible hitter today — skipped`); return }

  // ignoreDuplicates → the first pick of the day wins; a re-run never overwrites.
  const { error: pErr } = await supabase.from('survivor_picks').upsert({
    user_id: userId, game_date: date,
    player_id: pick.playerId, player_name: pick.playerName, team_id: pick.teamId,
    result: 'pending',
  }, { onConflict: 'user_id,game_date', ignoreDuplicates: true })
  if (pErr) { console.error(`  ${label}: pick insert failed: ${pErr.message}`); return }

  // Seed the display name so the resolver/leaderboard shows the bot's name (bots
  // have no `usernames` row). Only these two columns are written, so an existing
  // streak row is left untouched.
  const { error: sErr } = await supabase.from('survivor_stats').upsert(
    { user_id: userId, display_name: displayName },
    { onConflict: 'user_id' },
  )
  if (sErr) console.warn(`  ${label}: name seed skipped (${sErr.message})`)

  console.log(`  ${label}: ${pick.playerName}`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const date = todayStr()
  console.log(`\n🎯 Streak Survivor bots — ${date}\n`)

  console.log('👤 Resolving bot users…')
  const [streakId, chalkId, coinId] = await Promise.all([
    getOrCreateBotUser(BOTS.streak.email, BOTS.streak.displayName),
    getOrCreateBotUser(BOTS.chalk.email,  BOTS.chalk.displayName),
    getOrCreateBotUser(BOTS.coin.email,   BOTS.coin.displayName),
  ])

  console.log(`\n📅 Loading today's slate + candidates…`)
  const [previewTeams, avgPool, streakBoard] = await Promise.all([
    fetchPreviewTeams(date), fetchAvgPool(SEASON), fetchStreakBoard(SEASON),
  ])
  console.log(`  ${previewTeams.size} team(s) not yet started · ${avgPool.length} qualified hitters · ${streakBoard.length} on the streak board`)

  if (previewTeams.size === 0) { console.log('\n  No upcoming games — nothing to pick.\n'); return }

  console.log('\n🤖 Making picks…')
  await savePick(streakId, BOTS.streak.displayName, date, pickStreak(previewTeams, streakBoard, avgPool), '🤖 Streak Bot')
  await savePick(chalkId,  BOTS.chalk.displayName,  date, pickChalk(previewTeams, avgPool),               '🤖 Chalk Bot')
  await savePick(coinId,   BOTS.coin.displayName,   date, pickCoin(previewTeams, avgPool),                '🤖 Coin Flip Bot')

  console.log('\n✅ Done\n')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })

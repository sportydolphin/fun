#!/usr/bin/env node
/**
 * update-streaks.mjs — Nightly precompute of the active-streak leader boards
 * (hitting streaks, hitless slumps, scoreless-inning streaks) behind the
 * player report cards in Visualize.
 *
 * Port of computeStreakLeaders in src/mlb/api.ts: same candidate pool (top 50
 * hitters by games played + top 50 pitchers by innings pitched) and the same
 * streak rules, but the ~100 game-log fetches happen here once a night instead
 * of in every visitor's browser. The result is upserted as one jsonb row per
 * season into `streak_leaders`; the client falls back to computing live when
 * the row is missing or stale. Keep the two implementations in sync.
 *
 * Usage (local):
 *   node scripts/update-streaks.mjs --dry-run        # compute + print, no Supabase needed
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/update-streaks.mjs
 *
 * npm script: npm run streaks
 */

import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

// ─── Config ───────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run')

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error('❌  Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running (or use --dry-run)')
  process.exit(1)
}

const SEASON = new Date().getFullYear()
const STREAK_CANDIDATES = 50
const FETCH_CONCURRENCY = 8   // polite parallelism for the ~100 game-log fetches

// Fallback when a season-stats split lacks team.abbreviation
const TEAM_ABBR = {
  108: 'LAA', 109: 'ARI', 110: 'BAL', 111: 'BOS', 112: 'CHC',
  113: 'CIN', 114: 'CLE', 115: 'COL', 116: 'DET', 117: 'HOU',
  118: 'KC',  119: 'LAD', 120: 'WSH', 121: 'NYM', 133: 'OAK',
  134: 'PIT', 135: 'SD',  136: 'SEA', 137: 'SF',  138: 'STL',
  139: 'TB',  140: 'TEX', 141: 'TOR', 142: 'MIN', 143: 'PHI',
  144: 'ATL', 145: 'CWS', 146: 'MIA', 147: 'NYY', 158: 'MIL',
}

// ─── StatsAPI helpers (mirror src/mlb/api.ts) ────────────────────────────────

function fetchSeasonPlayerStats(group, season) {
  return fetch(`https://statsapi.mlb.com/api/v1/stats?stats=season&group=${group}&season=${season}&sportId=1&limit=2000&playerPool=All`)
    .then(r => r.json())
    .then(d => d.stats?.[0]?.splits ?? [])
    .catch(() => [])
}

function fetchGameLog(id, group, season) {
  return fetch(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=gameLog&group=${group}&season=${season}&sportId=1`)
    .then(r => r.json())
    .then(d => {
      const splits = (d.stats?.[0]?.splits ?? []).filter(s => s.gameType === 'R')
      splits.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
      return splits
    })
    .catch(() => [])
}

// "5.1" innings → 16 outs. StatsAPI encodes thirds of an inning as .1 / .2.
function ipToOuts(ip) {
  const [whole, frac] = String(ip ?? '0').split('.')
  return (Number(whole) || 0) * 3 + (Number(frac) || 0)
}

// Run fn over items with at most `limit` in flight
async function mapPool(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++
      out[idx] = await fn(items[idx])
    }
  }))
  return out
}

// ─── Streak computation (port of computeStreakLeaders) ───────────────────────

async function computeStreakLeaders(season) {
  const meta = s => ({
    playerId: Number(s.player?.id),
    playerName: s.player?.fullName ?? '—',
    teamAbbr: s.team?.abbreviation ?? TEAM_ABBR[s.team?.id] ?? '—',
    teamId: Number(s.team?.id) || 0,
    value: 0,
  })

  const [hitters, pitchers] = await Promise.all([
    fetchSeasonPlayerStats('hitting', season),
    fetchSeasonPlayerStats('pitching', season),
  ])
  if (hitters.length === 0 || pitchers.length === 0) {
    throw new Error(`Empty season stats pools (hitters ${hitters.length}, pitchers ${pitchers.length})`)
  }

  const hitCandidates = [...hitters]
    .filter(s => Number(s.stat?.atBats ?? 0) > 0 && Number(s.player?.id) > 0)
    .sort((a, b) => Number(b.stat?.gamesPlayed ?? 0) - Number(a.stat?.gamesPlayed ?? 0))
    .slice(0, STREAK_CANDIDATES)
  const pitchCandidates = [...pitchers]
    .filter(s => Number(s.player?.id) > 0)
    .sort((a, b) => parseFloat(b.stat?.inningsPitched ?? '0') - parseFloat(a.stat?.inningsPitched ?? '0'))
    .slice(0, STREAK_CANDIDATES)

  const hitLogs = await mapPool(hitCandidates, FETCH_CONCURRENCY,
    c => fetchGameLog(Number(c.player.id), 'hitting', season).then(log => ({ m: meta(c), log })))
  const pitchLogs = await mapPool(pitchCandidates, FETCH_CONCURRENCY,
    c => fetchGameLog(Number(c.player.id), 'pitching', season).then(log => ({ m: meta(c), log })))

  const hitting = []
  const hitless = []
  for (const { m, log } of hitLogs) {
    let mode = null   // 'hit' | 'hitless'
    let games = 0     // consecutive games in the streak
    let pa = 0        // plate appearances across those games (for the hitless board)
    for (let i = log.length - 1; i >= 0; i--) {
      const ab = Number(log[i].stat?.atBats ?? 0)
      if (ab === 0) continue   // no official at-bat: never extends or breaks a streak
      const got = Number(log[i].stat?.hits ?? 0) > 0
      const gamePa = Number(log[i].stat?.plateAppearances ?? ab)
      if (mode === null) { mode = got ? 'hit' : 'hitless'; games = 1; pa = gamePa; continue }
      if ((got && mode === 'hit') || (!got && mode === 'hitless')) { games++; pa += gamePa }
      else break
    }
    // Hitting streaks are measured in games; hitless droughts in plate appearances.
    if (mode === 'hit' && games >= 2) hitting.push({ ...m, value: games })
    else if (mode === 'hitless' && games >= 2) hitless.push({ ...m, value: pa })
  }

  const scoreless = []
  for (const { m, log } of pitchLogs) {
    let outs = 0
    for (let i = log.length - 1; i >= 0; i--) {
      if (Number(log[i].stat?.runs ?? 0) === 0) outs += ipToOuts(log[i].stat?.inningsPitched)
      else break
    }
    if (outs >= 3) scoreless.push({ ...m, value: outs })   // at least one full scoreless inning
  }

  const byValue = (a, b) => b.value - a.value
  return {
    hitting: hitting.sort(byValue).slice(0, 25),
    hitless: hitless.sort(byValue).slice(0, 25),
    scoreless: scoreless.sort(byValue).slice(0, 25),
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔥 Streak Leaders — ${SEASON} season${DRY_RUN ? ' (dry run)' : ''}\n`)

  const data = await computeStreakLeaders(SEASON)

  const show = (label, rows, unit) => {
    console.log(`  ${label}`)
    for (const r of rows.slice(0, 5)) {
      console.log(`    ${String(r.value).padStart(3)} ${unit}  ${r.playerName} (${r.teamAbbr})`)
    }
  }
  show('🔥 Hitting streaks', data.hitting, 'G ')
  show('🥶 Hitless slumps', data.hitless, 'PA')
  show('🧊 Scoreless streaks', data.scoreless, 'out')
  console.log(`\n  Rows: hitting ${data.hitting.length} · hitless ${data.hitless.length} · scoreless ${data.scoreless.length}`)

  // Never overwrite a good row with an empty one on a bad StatsAPI day
  if (data.hitting.length + data.hitless.length + data.scoreless.length === 0) {
    console.error('\n❌  All boards empty — aborting upsert')
    process.exit(1)
  }

  if (DRY_RUN) {
    console.log('\n✅  Dry run complete — nothing written\n')
    return
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  })

  const { error } = await supabase
    .from('streak_leaders')
    .upsert({ season: SEASON, data, computed_at: new Date().toISOString() }, { onConflict: 'season' })

  if (error) {
    console.error(`\n❌  Supabase upsert failed: ${error.message}`)
    console.error('    Make sure you ran scripts/create_streak_leaders.sql first.')
    process.exit(1)
  }

  console.log(`\n✅  Upserted streak leaders for ${SEASON}\n`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })

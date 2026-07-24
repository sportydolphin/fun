#!/usr/bin/env node
/**
 * update-streaks.mjs — Nightly precompute of the active-streak leader boards
 * (hitting streaks, hitless slumps, scoreless-inning streaks, games-played
 * streaks) behind the player report cards in Visualize.
 *
 * Port of computeStreakLeaders in src/mlb/api.ts: same eligibility rule and the
 * same streak rules, but the game-log fetches happen here once a night instead
 * of in every visitor's browser. The result is upserted as one jsonb row per
 * season into `streak_leaders`; the client falls back to computing live when
 * the row is missing or stale. Keep the two implementations in sync.
 *
 * The one deliberate difference is STREAK_CANDIDATES: generous here (CI, once a
 * night), much smaller in the browser fallback. This board is the authoritative
 * one — the client's live fallback is a best-effort approximation.
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

// Eligibility thresholds — see the long note in src/mlb/api.ts. Ranking by raw
// volume (the old "top 50 by games played / innings pitched") silently excluded
// catchers, platoon bats, IL returnees and *every* reliever. These scale with
// season progress instead.
const STREAK_MIN_GP_PCT = 0.5
const STREAK_MIN_IP_PCT = 0.2
const STREAK_MIN_GP     = 10
const STREAK_MIN_IP     = 5

// Generous cap: this runs once a night on CI, so a few hundred extra game-log
// fetches are cheap. The client's fallback uses a much smaller cap.
const STREAK_CANDIDATES = 600
const FETCH_CONCURRENCY = 8   // polite parallelism for the game-log fetches

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

// ─── Games-played (iron man) streaks — see the long note in src/mlb/api.ts ────
// A consecutive-games-played streak is broken by a game the player *isn't* in,
// which his own game log can't show, so the team's schedule is the spine and his
// appearances are mapped to positions in it. Seasons concatenate per team, so a
// streak carries across years without any date arithmetic.

const IRONMAN_SEASONS_BACK = 4
const IRONMAN_MIN_GAMES    = 10

const scheduleCache = new Map()

function fetchSeasonSchedule(season) {
  if (!scheduleCache.has(season)) {
    scheduleCache.set(season, (async () => {
      const byTeam = new Map()
      try {
        const r = await fetch(
          `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${season}-01-01&endDate=${season}-12-31` +
          `&gameType=R&fields=dates,date,games,gamePk,status,codedGameState,teams,home,away,team,id`
        )
        const d = await r.json()
        // A suspended game is listed twice, on the date it started and again on
        // the date it finished, but a player's game log only records the original
        // date. Keep the first listing of each gamePk so the two line up; the
        // phantom second listing would otherwise read as a game everyone missed.
        const seen = new Set()
        for (const day of d.dates ?? []) {
          for (const g of day.games ?? []) {
            const state = g.status?.codedGameState
            if (state !== 'F' && state !== 'O') continue
            const pk = Number(g.gamePk)
            if (!pk || seen.has(pk)) continue
            seen.add(pk)
            for (const side of ['away', 'home']) {
              const tid = Number(g.teams?.[side]?.team?.id)
              if (!tid) continue
              const arr = byTeam.get(tid)
              if (arr) arr.push(pk); else byTeam.set(tid, [pk])
            }
          }
        }
      } catch { /* empty map: board comes back empty rather than wrong */ }
      return byTeam
    })())
  }
  return scheduleCache.get(season)
}

function buildScheduleIndex(byTeam) {
  const index = new Map()
  for (const [teamId, pks] of byTeam) {
    const m = new Map()
    pks.forEach((pk, i) => m.set(pk, i))
    index.set(teamId, m)
  }
  return index
}

function walkGamesPlayedStreak(played, byTeam, index) {
  if (played.length === 0) return { games: 0, open: false }
  const posOf = g => index.get(g.teamId)?.get(g.gamePk)

  const latest = played[played.length - 1]
  const latestPos = posOf(latest)
  const teamGames = byTeam.get(latest.teamId)
  if (latestPos == null || !teamGames || latestPos !== teamGames.length - 1) {
    return { games: 0, open: false }   // sat out his team's latest game
  }

  let games = 1
  for (let i = played.length - 1; i > 0; i--) {
    const later = played[i], earlier = played[i - 1]
    if (later.teamId === earlier.teamId) {
      const lp = posOf(later), ep = posOf(earlier)
      if (lp == null || ep == null || lp - ep !== 1) return { games, open: false }
    }
    // Different teams: traded mid-streak, which doesn't end it.
    games++
  }
  return { games, open: posOf(played[0]) === 0 }
}

async function computeGamesPlayedBoard(season, entries) {
  const toPlayed = log =>
    log.map(s => ({ gamePk: Number(s.game?.gamePk) || 0, teamId: Number(s.team?.id) || 0 }))
       .filter(g => g.gamePk > 0 && g.teamId > 0)

  const byTeam = new Map()
  const prependSeason = older => {
    for (const [tid, pks] of older) {
      const existing = byTeam.get(tid)
      byTeam.set(tid, existing ? [...pks, ...existing] : [...pks])
    }
  }

  prependSeason(await fetchSeasonSchedule(season))
  let index = buildScheduleIndex(byTeam)

  const state = entries.map(e => ({ m: e.m, played: toPlayed(e.log), games: 0, open: false }))
  const rewalk = () => {
    for (const s of state) {
      const r = walkGamesPlayedStreak(s.played, byTeam, index)
      s.games = r.games
      s.open  = r.open
    }
  }
  rewalk()

  for (let back = 1; back <= IRONMAN_SEASONS_BACK; back++) {
    const stillOpen = state.filter(s => s.open)
    if (stillOpen.length === 0) break
    const prev = season - back
    console.log(`    reaching back to ${prev} for ${stillOpen.length} player(s) still unbroken`)
    const [older, logs] = await Promise.all([
      fetchSeasonSchedule(prev),
      mapPool(stillOpen, FETCH_CONCURRENCY, s => fetchGameLog(s.m.playerId, 'hitting', prev)),
    ])
    if (older.size === 0) break
    prependSeason(older)
    stillOpen.forEach((s, i) => { s.played = [...toPlayed(logs[i]), ...s.played] })
    index = buildScheduleIndex(byTeam)
    rewalk()
  }

  return state
    .filter(s => s.games >= IRONMAN_MIN_GAMES)
    .map(s => ({ ...s.m, value: s.games, ...(s.open ? { capped: true } : {}) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 25)
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

  // Scale eligibility off the current leaders, so the same rule works in April
  // and in September.
  const maxGP = Math.max(...hitters.map(s => Number(s.stat?.gamesPlayed ?? 0)), 1)
  const maxIP = Math.max(...pitchers.map(s => parseFloat(s.stat?.inningsPitched ?? '0')), 1)
  const minGP = Math.max(STREAK_MIN_GP, Math.round(maxGP * STREAK_MIN_GP_PCT))
  const minIP = Math.max(STREAK_MIN_IP, maxIP * STREAK_MIN_IP_PCT)

  const hitCandidates = [...hitters]
    .filter(s => Number(s.stat?.atBats ?? 0) > 0 && Number(s.player?.id) > 0)
    .filter(s => Number(s.stat?.gamesPlayed ?? 0) >= minGP)
    .sort((a, b) => Number(b.stat?.gamesPlayed ?? 0) - Number(a.stat?.gamesPlayed ?? 0))
    .slice(0, STREAK_CANDIDATES)
  const pitchCandidates = [...pitchers]
    .filter(s => Number(s.player?.id) > 0)
    .filter(s => parseFloat(s.stat?.inningsPitched ?? '0') >= minIP)
    .sort((a, b) => parseFloat(b.stat?.inningsPitched ?? '0') - parseFloat(a.stat?.inningsPitched ?? '0'))
    .slice(0, STREAK_CANDIDATES)

  console.log(`  Candidate pool: ${hitCandidates.length} hitters (≥${minGP} G) · ${pitchCandidates.length} pitchers (≥${minIP.toFixed(1)} IP)`)

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

  // Reuses the hitter game logs already fetched above, so this only adds the
  // schedule request(s).
  const gamesPlayed = await computeGamesPlayedBoard(season, hitLogs)

  const byValue = (a, b) => b.value - a.value
  return {
    hitting: hitting.sort(byValue).slice(0, 25),
    hitless: hitless.sort(byValue).slice(0, 25),
    scoreless: scoreless.sort(byValue).slice(0, 25),
    gamesPlayed,
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
  show('🦾 Games-played streaks', data.gamesPlayed, 'G ')
  console.log(`\n  Rows: hitting ${data.hitting.length} · hitless ${data.hitless.length} · scoreless ${data.scoreless.length} · gamesPlayed ${data.gamesPlayed.length}`)

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

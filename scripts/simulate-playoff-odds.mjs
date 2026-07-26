#!/usr/bin/env node
/**
 * simulate-playoff-odds.mjs — Nightly Monte Carlo of the remaining schedule to
 * estimate each team's playoff / division odds.
 *
 * Model (deliberately simple but credible):
 *   • Team strength = Pythagorean win% from runs scored/allowed (exp 1.83),
 *     regressed toward .500 by REGRESS_G games so April extremes don't dominate.
 *     By late summer the regression barely moves a 120-game sample.
 *   • Per-game win prob via the log5 formula + a fixed home-field edge.
 *   • Simulate every remaining regular-season game N times; each sim decides
 *     division winners (best record per division) and 3 wild cards per league
 *     (2022+ format: 6 clubs per league). Ties broken by a per-sim random jitter.
 *
 * Output is one jsonb row per season into `playoff_odds` (mirrors the
 * streak_leaders precompute): the client reads one row and renders all 30 teams.
 *
 * Usage (local):
 *   node scripts/simulate-playoff-odds.mjs --dry-run          # compute + print, no Supabase
 *   node scripts/simulate-playoff-odds.mjs --dry-run --sims=20000
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/simulate-playoff-odds.mjs
 */

import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

// ─── Config ───────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run')
const simsArg = process.argv.find(a => a.startsWith('--sims='))
const N_SIMS  = simsArg ? Math.max(1000, Number(simsArg.split('=')[1]) || 0) : 10000

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error('❌  Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running (or use --dry-run)')
  process.exit(1)
}

const SEASON = new Date().getFullYear()

const PYTH_EXP  = 1.83   // standard MLB Pythagorean exponent
const REGRESS_G = 40     // games of .500 regression mixed into every team's strength
const HFA       = 0.035  // home-field bump added to the home team's log5 win prob
const AL = 103, NL = 104

const DIVISION_NAMES = {
  200: 'AL West', 201: 'AL East', 202: 'AL Central',
  203: 'NL West', 204: 'NL East', 205: 'NL Central',
}

const TEAM_ABBR = {
  108: 'LAA', 109: 'ARI', 110: 'BAL', 111: 'BOS', 112: 'CHC',
  113: 'CIN', 114: 'CLE', 115: 'COL', 116: 'DET', 117: 'HOU',
  118: 'KC',  119: 'LAD', 120: 'WSH', 121: 'NYM', 133: 'OAK',
  134: 'PIT', 135: 'SD',  136: 'SEA', 137: 'SF',  138: 'STL',
  139: 'TB',  140: 'TEX', 141: 'TOR', 142: 'MIN', 143: 'PHI',
  144: 'ATL', 145: 'CWS', 146: 'MIA', 147: 'NYY', 158: 'MIL',
}

// ─── StatsAPI ─────────────────────────────────────────────────────────────────

async function fetchStandings(season) {
  const r = await fetch(
    `https://statsapi.mlb.com/api/v1/standings?leagueId=${AL},${NL}&season=${season}&standingsTypes=regularSeason`
  )
  const d = await r.json()
  const teams = []
  for (const rec of d.records ?? []) {
    const divisionId = Number(rec.division?.id)
    const leagueId   = Number(rec.league?.id)
    for (const t of rec.teamRecords ?? []) {
      const teamId = Number(t.team?.id)
      if (!teamId) continue
      teams.push({
        teamId,
        teamName: t.team?.name ?? '—',
        abbr: TEAM_ABBR[teamId] ?? (t.team?.abbreviation ?? '—'),
        divisionId,
        leagueId,
        wins: Number(t.wins ?? 0),
        losses: Number(t.losses ?? 0),
        runsScored: Number(t.runsScored ?? 0),
        runsAllowed: Number(t.runsAllowed ?? 0),
      })
    }
  }
  return teams
}

// Every remaining regular-season game as [homeTeamId, awayTeamId]. A game counts
// as remaining if it isn't Final yet (scheduled, pre-game, or in progress).
async function fetchRemainingGames(season) {
  const r = await fetch(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${season}-01-01&endDate=${season}-12-31` +
    `&gameType=R&fields=dates,games,gamePk,status,abstractGameState,detailedState,teams,home,away,team,id`
  )
  const d = await r.json()
  const games = []
  const seen = new Set()
  for (const day of d.dates ?? []) {
    for (const g of day.games ?? []) {
      const state = g.status?.abstractGameState
      if (state === 'Final') continue
      if (g.status?.detailedState === 'Postponed') continue   // gets rescheduled onto another date
      const pk = Number(g.gamePk)
      if (!pk || seen.has(pk)) continue
      const home = Number(g.teams?.home?.team?.id)
      const away = Number(g.teams?.away?.team?.id)
      if (!home || !away) continue
      seen.add(pk)
      games.push([home, away])
    }
  }
  return games
}

// ─── Model ────────────────────────────────────────────────────────────────────

// Pythagorean win% regressed toward .500, so a hot 20-game start doesn't read as a
// true-talent .700 club.
function strengthOf(t) {
  const rs = t.runsScored, ra = t.runsAllowed
  const gp = t.wins + t.losses
  let pyth = 0.5
  if (rs > 0 || ra > 0) {
    const rsE = Math.pow(rs, PYTH_EXP), raE = Math.pow(ra, PYTH_EXP)
    pyth = rsE / (rsE + raE)
  }
  return (pyth * gp + 0.5 * REGRESS_G) / (gp + REGRESS_G)
}

// log5: probability team A (strength a) beats team B (strength b), both expressed
// as win prob vs a league-average team.
function log5(a, b) {
  const denom = a + b - 2 * a * b
  return denom <= 0 ? 0.5 : (a - a * b) / denom
}

// ─── Simulation ───────────────────────────────────────────────────────────────

function simulate(teams, games) {
  const n = teams.length
  const idxOf = new Map(teams.map((t, i) => [t.teamId, i]))
  const strength = teams.map(strengthOf)
  const baseWins = teams.map(t => t.wins)
  const remainingCount = new Array(n).fill(0)

  // Precompute each remaining game's home-win probability once (it's identical
  // across every sim), so the hot loop is just a compare + increment.
  const homeIdx = new Int16Array(games.length)
  const awayIdx = new Int16Array(games.length)
  const pHome   = new Float64Array(games.length)
  for (let g = 0; g < games.length; g++) {
    const hi = idxOf.get(games[g][0]), ai = idxOf.get(games[g][1])
    if (hi == null || ai == null) { homeIdx[g] = -1; continue }
    homeIdx[g] = hi; awayIdx[g] = ai
    pHome[g] = Math.min(0.99, Math.max(0.01, log5(strength[hi], strength[ai]) + HFA))
    remainingCount[hi]++; remainingCount[ai]++
  }

  // Divisions and leagues, as index lists.
  const divisions = new Map()   // divisionId -> team indices
  const leagues   = new Map()   // leagueId  -> team indices
  teams.forEach((t, i) => {
    if (!divisions.has(t.divisionId)) divisions.set(t.divisionId, [])
    if (!leagues.has(t.leagueId))     leagues.set(t.leagueId, [])
    divisions.get(t.divisionId).push(i)
    leagues.get(t.leagueId).push(i)
  })

  const madePlayoffs = new Float64Array(n)
  const wonDivision  = new Float64Array(n)
  const sumWins      = new Float64Array(n)

  const wins = new Float64Array(n)
  const rank = new Float64Array(n)      // wins + per-sim jitter, for tie-breaking
  const isDivWinner = new Uint8Array(n)

  for (let s = 0; s < N_SIMS; s++) {
    for (let i = 0; i < n; i++) wins[i] = baseWins[i]
    for (let g = 0; g < games.length; g++) {
      if (homeIdx[g] < 0) continue
      if (Math.random() < pHome[g]) wins[homeIdx[g]]++
      else wins[awayIdx[g]]++
    }
    // Integer wins + [0,1) jitter: more wins always ranks higher; exact ties fall
    // to the jitter (a random-but-consistent stand-in for real tiebreakers).
    for (let i = 0; i < n; i++) { rank[i] = wins[i] + Math.random(); sumWins[i] += wins[i]; isDivWinner[i] = 0 }

    // Division winners
    for (const members of divisions.values()) {
      let best = members[0]
      for (const i of members) if (rank[i] > rank[best]) best = i
      isDivWinner[best] = 1
      wonDivision[best]++
      madePlayoffs[best]++
    }
    // Three wild cards per league among the non-winners
    for (const members of leagues.values()) {
      const contenders = members.filter(i => !isDivWinner[i]).sort((a, b) => rank[b] - rank[a])
      for (let k = 0; k < 3 && k < contenders.length; k++) madePlayoffs[contenders[k]]++
    }
  }

  return teams.map((t, i) => {
    const totalGames = baseWins[i] + t.losses + remainingCount[i]
    const projWins = sumWins[i] / N_SIMS
    return {
      teamId: t.teamId,
      abbr: t.abbr,
      teamName: t.teamName,
      divisionId: t.divisionId,
      divisionName: DIVISION_NAMES[t.divisionId] ?? `Division ${t.divisionId}`,
      leagueId: t.leagueId,
      wins: t.wins,
      losses: t.losses,
      remaining: remainingCount[i],
      strength: Number(strength[i].toFixed(4)),
      makePlayoffs: madePlayoffs[i] / N_SIMS,
      winDivision:  wonDivision[i] / N_SIMS,
      projWins:  Math.round(projWins),
      projLosses: Math.round(totalGames - projWins),
    }
  })
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n📊 Playoff Odds — ${SEASON} · ${N_SIMS.toLocaleString()} sims${DRY_RUN ? ' (dry run)' : ''}\n`)

  const [teams, games] = await Promise.all([fetchStandings(SEASON), fetchRemainingGames(SEASON)])
  if (teams.length < 30) throw new Error(`Expected 30 teams, got ${teams.length}`)
  console.log(`  ${teams.length} teams · ${games.length} remaining games`)

  const avgGames = teams.reduce((s, t) => s + t.wins + t.losses, 0) / teams.length
  console.log(`  Avg games played: ${avgGames.toFixed(1)} (${(162 - avgGames).toFixed(1)} to go per team)\n`)

  const rows = simulate(teams, games)

  // Print each league sorted by playoff odds
  for (const [lg, name] of [[AL, 'American League'], [NL, 'National League']]) {
    console.log(`  ${name}`)
    const lgRows = rows.filter(r => r.leagueId === lg).sort((a, b) => b.makePlayoffs - a.makePlayoffs)
    for (const r of lgRows) {
      const pct = (r.makePlayoffs * 100).toFixed(1).padStart(5)
      const div = (r.winDivision * 100).toFixed(1).padStart(5)
      console.log(`    ${r.abbr.padEnd(3)} ${String(r.projWins).padStart(3)}-${String(r.projLosses).padEnd(3)}  playoffs ${pct}%  ·  division ${div}%`)
    }
    console.log('')
  }

  const anyOdds = rows.some(r => r.makePlayoffs > 0)
  if (!anyOdds) { console.error('❌  All odds zero — aborting'); process.exit(1) }

  if (DRY_RUN) { console.log('✅  Dry run complete — nothing written\n'); return }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  })
  const { error } = await supabase
    .from('playoff_odds')
    .upsert({ season: SEASON, data: rows, computed_at: new Date().toISOString() }, { onConflict: 'season' })
  if (error) {
    console.error(`\n❌  Supabase upsert failed: ${error.message}`)
    console.error('    Make sure you ran scripts/create_playoff_odds.sql first.')
    process.exit(1)
  }
  console.log(`✅  Upserted playoff odds for ${SEASON}\n`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })

#!/usr/bin/env node
/**
 * update-payrolls.mjs — Fetches team payroll estimates *and* player contracts
 * from FanGraphs Roster Resource, upserting them into the Supabase
 * `team_payrolls` and `player_contracts` tables.
 *
 * FanGraphs uses Next.js SSR — the full data is embedded in __NEXT_DATA__ JSON
 * in the initial HTML response, so no headless browser is needed.
 * We extract dataOverall[season].estPayroll for the current season.
 *
 * ── Why contracts live in this script rather than their own ──
 * Both datasets arrive in the *same* HTTP response: `dataContract` sits right
 * beside `dataOverall` in that blob. A separate script would double our request
 * volume against FanGraphs for data we already have in hand — and FanGraphs
 * answering with a 403 is this scraper's known failure mode, so halving the
 * exposure matters more than the tidiness of one job per table.
 *
 * The two upserts are independent: contracts failing never blocks payrolls.
 *
 * Usage (local):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/update-payrolls.mjs
 *   OR: node --env-file=.env scripts/update-payrolls.mjs  (needs SERVICE_ROLE_KEY set)
 *
 * npm script: npm run payrolls
 */

import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running')
  process.exit(1)
}

const SEASON = new Date().getFullYear()

// MLB team ID → FanGraphs roster-resource URL slug (all 30 teams)
const TEAM_SLUGS = {
  108: 'angels',        109: 'diamondbacks',  110: 'orioles',
  111: 'red-sox',       112: 'cubs',          113: 'reds',
  114: 'guardians',     115: 'rockies',       116: 'tigers',
  117: 'astros',        118: 'royals',        119: 'dodgers',
  120: 'nationals',     121: 'mets',          133: 'athletics',
  134: 'pirates',       135: 'padres',        136: 'mariners',
  137: 'giants',        138: 'cardinals',     139: 'rays',
  140: 'rangers',       141: 'blue-jays',     142: 'twins',
  143: 'phillies',      144: 'braves',        145: 'white-sox',
  146: 'marlins',       147: 'yankees',       158: 'brewers',
}

// ─── Fetch + parse one team page ─────────────────────────────────────────────

async function fetchTeamPage(teamId, slug) {
  const url = `https://www.fangraphs.com/roster-resource/payroll/${slug}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120',
      'Accept':     'text/html,application/xhtml+xml',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const html = await res.text()

  // FanGraphs is Next.js SSR — full data is in __NEXT_DATA__ JSON
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
  if (!match) throw new Error('No __NEXT_DATA__ found in HTML')

  const nextData   = JSON.parse(match[1])
  const queryData  = nextData?.props?.pageProps?.dehydratedState?.queries?.[0]?.state?.data
  const dataOverall = queryData?.dataOverall

  if (!Array.isArray(dataOverall)) throw new Error('dataOverall missing from __NEXT_DATA__')

  const row = dataOverall.find(r => r.Season === SEASON)
  if (!row) throw new Error(`No dataOverall entry for season ${SEASON}`)

  // estPayroll is the best field: guaranteed + arb + pre-arb estimates
  const payrollDollars = row.estPayroll ?? row.TotalPayroll
  if (!payrollDollars || payrollDollars <= 0) throw new Error(`No valid payroll figure (got ${payrollDollars})`)

  const payrollM = Math.round(payrollDollars / 1_000_000 * 100) / 100
  if (payrollM < 40 || payrollM > 700) throw new Error(`Suspicious value: $${payrollM}M`)

  return {
    teamId:    Number(teamId),
    payroll:   payrollM,
    // Contracts are best-effort: a parse failure here must not cost us the
    // payroll figure we already validated above.
    contracts: parseContracts(queryData, Number(teamId)),
  }
}

// ─── Contracts ────────────────────────────────────────────────────────────────

/**
 * Collapse FanGraphs' free-text year label into a small enum the UI can style.
 *
 * The raw vocabulary is inconsistent and sometimes truncated at the source —
 * "PRE-ARB" vs "Pre-ARB", "FREE AGENT (DISPLAYED)", "CLUB OPTION (NON-GUARANT" —
 * so this normalises once here rather than making every consumer re-learn it.
 * The original string is kept alongside for tooltips.
 */
function normaliseYearType(raw) {
  const t = String(raw ?? '').trim().toUpperCase()
  if (!t)                     return 'other'
  if (t.startsWith('FREE AGENT')) return 'free-agent'
  if (t.includes('OPT'))          return 'option'      // OPT OUT, CLUB/MUTUAL/VESTING OPTION
  if (t.includes('PRE-ARB'))      return 'pre-arb'
  if (t.startsWith('ARB'))        return 'arb'
  if (t.startsWith('GUARANTEED')) return 'guaranteed'
  return 'other'                                        // NOT 40 MAN, placeholders
}

/**
 * Per-player contract rows out of the same payload.
 *
 * `contractYears` is the valuable part and runs past the guaranteed money: for a
 * pre-arb player it still lists the ARB 1/2/3 seasons and the FREE AGENT season
 * beyond them. That's what lets the app show team control, not just salary — the
 * thing a fan actually wants to know about a minimum-salary player.
 */
function parseContracts(queryData, teamId) {
  const out = []
  for (const c of queryData?.dataContract ?? []) {
    const s = c?.contractSummary
    const mlbamId = Number(s?.MLBAMID)
    // No MLBAM id means we could never join it to a player page — skip rather
    // than fall back to name matching.
    if (!mlbamId || !s?.playerName) continue

    const years = (c.contractYears ?? [])
      .map(y => ({
        season: Number(y.Season),
        kind:   normaliseYearType(y.Type),
        label:  String(y.Type ?? '').trim() || 'Unknown',
        salary: Number(y.Salary ?? 0) || 0,
      }))
      .filter(y => Number.isFinite(y.season) && y.season > 0)
      .sort((a, b) => a.season - b.season)

    out.push({
      mlbam_id:          mlbamId,
      player_name:       s.playerName,
      team_id:           teamId,
      contract_type:     s.ContractType ?? null,
      years_total:       Number(s.YearsTotal) || null,
      total_value:       Math.round(Number(s.ContractTotal) || 0) || null,
      aav:               Number(s.AAV) > 0 ? Math.round(Number(s.AAV) * 100) / 100 : null,
      start_season:      Number(s.startSeason) || null,
      end_season:        Number(s.endSeason) || null,
      service_time:      s.servicetime ?? null,
      // Null when the deal ends on an option year — the market date then depends
      // on whether the option is picked up, so there is no honest answer to show.
      free_agent_season: years.find(y => y.kind === 'free-agent')?.season ?? null,
      description:       c.description ?? null,
      years,
      updated_at:        new Date().toISOString(),
    })
  }
  return out
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n💰 Payroll Updater — ${SEASON} season\n`)

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  })

  const rows   = []
  const failed = []
  // Keyed by MLBAM id: a player traded mid-season is listed on both his old and
  // new team's page, and Postgres rejects an upsert whose batch touches the same
  // primary key twice ("cannot affect row a second time"). Later team wins, which
  // is also the more current one.
  const contractsById = new Map()

  for (const [teamId, slug] of Object.entries(TEAM_SLUGS)) {
    try {
      const { teamId: id, payroll, contracts } = await fetchTeamPage(teamId, slug)
      rows.push({
        team_id:    id,
        season:     SEASON,
        payroll_m:  payroll,
        updated_at: new Date().toISOString(),
      })
      for (const c of contracts) contractsById.set(c.mlbam_id, c)
      console.log(`  ✓  ${slug.padEnd(16)}  $${String(payroll).padEnd(7)}  ${contracts.length} contracts`)
    } catch (err) {
      console.warn(`  ✗  ${slug.padEnd(16)}  ${err.message}`)
      failed.push(slug)
    }

    // Small delay — polite to FanGraphs
    await new Promise(r => setTimeout(r, 200))
  }

  console.log(`\n  Parsed ${rows.length}/30 teams  (${failed.length} failed)`)

  if (rows.length < 20) {
    console.error('\n❌  Too many failures — aborting upsert')
    process.exit(1)
  }

  const { error } = await supabase
    .from('team_payrolls')
    .upsert(rows, { onConflict: 'team_id,season' })

  if (error) {
    console.error(`\n❌  Supabase upsert failed: ${error.message}`)
    console.error('    Make sure you ran scripts/create_team_payrolls.sql first.')
    process.exit(1)
  }

  console.log(`\n✅  Upserted ${rows.length} teams to team_payrolls`)

  // ── Contracts ───────────────────────────────────────────────────────────────
  // Deliberately after the payroll upsert and non-fatal: payrolls are the older,
  // load-bearing dataset (the Home leaderboards read them), so a contracts
  // problem must never take them down with it.
  const contracts = [...contractsById.values()]
  if (contracts.length < 500) {
    // 30 teams × ~30 players ≈ 900. Well under that means the shape changed.
    console.warn(`\n⚠️   Only ${contracts.length} contracts parsed — skipping upsert (expected ~900)`)
  } else {
    const { error: cErr } = await supabase
      .from('player_contracts')
      .upsert(contracts, { onConflict: 'mlbam_id' })

    if (cErr) {
      console.error(`\n⚠️   player_contracts upsert failed: ${cErr.message}`)
      console.error('    Make sure you ran scripts/create_player_contracts.sql first.')
    } else {
      console.log(`✅  Upserted ${contracts.length} players to player_contracts`)
    }
  }

  if (failed.length > 0) {
    console.warn(`\n⚠️   Failed teams: ${failed.join(', ')}`)
  }
  console.log()
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })

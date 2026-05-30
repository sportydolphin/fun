#!/usr/bin/env node
/**
 * update-payrolls.mjs — Fetches team payroll estimates from FanGraphs
 * Roster Resource and upserts them into the Supabase `team_payrolls` table.
 *
 * FanGraphs uses Next.js SSR — the full data is embedded in __NEXT_DATA__ JSON
 * in the initial HTML response, so no headless browser is needed.
 * We extract dataOverall[season].estPayroll for the current season.
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

async function fetchTeamPayroll(teamId, slug) {
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

  return { teamId: Number(teamId), payroll: payrollM }
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

  for (const [teamId, slug] of Object.entries(TEAM_SLUGS)) {
    try {
      const { teamId: id, payroll } = await fetchTeamPayroll(teamId, slug)
      rows.push({
        team_id:    id,
        season:     SEASON,
        payroll_m:  payroll,
        updated_at: new Date().toISOString(),
      })
      console.log(`  ✓  ${slug.padEnd(16)}  $${payroll}M`)
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

  if (failed.length > 0) {
    console.warn(`\n⚠️   Failed teams: ${failed.join(', ')}`)
  }

  console.log(`\n✅  Upserted ${rows.length} teams to team_payrolls\n`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })

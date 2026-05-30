#!/usr/bin/env node
/**
 * update-payrolls.mjs — Scrapes 2026 team payroll estimates from FanGraphs
 * Roster Resource and upserts them into the Supabase `team_payrolls` table.
 *
 * Runs server-side (no CORS restriction) so plain fetch() works fine.
 * FanGraphs uses server-side rendering — payroll totals are in the initial HTML.
 *
 * Usage (local):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/update-payrolls.mjs
 *
 * Or via npm script:
 *   npm run payrolls
 *
 * Required env vars:
 *   SUPABASE_URL               — your project URL (or VITE_SUPABASE_URL as fallback)
 *   SUPABASE_SERVICE_ROLE_KEY  — service role key (NEVER the anon key)
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

// ─── Parse payroll from HTML ──────────────────────────────────────────────────

/**
 * Extracts the total estimated payroll (in $M) from a FanGraphs payroll page.
 * Handles both abbreviated ("$196M") and full ("$196,327,167") dollar amounts.
 */
function parsePayroll(html) {
  // Strip tags and normalise whitespace so the text is easy to regex
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')  // drop JS blocks
    .replace(/<style[\s\S]*?<\/style>/gi, '')     // drop CSS blocks
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')

  // Find "payroll" in text, then look for the nearest dollar amount after it
  const payrollIdx = text.toLowerCase().indexOf('payroll')
  if (payrollIdx === -1) return null

  // Search in the 300-char window that follows "payroll"
  const window = text.slice(payrollIdx, payrollIdx + 300)

  // Match $NNN,NNN,NNN or $NNNm (case insensitive M suffix)
  const match = window.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(M|B)?(?!\d)/i)
  if (!match) return null

  const raw    = parseFloat(match[1].replace(/,/g, ''))
  const suffix = (match[2] ?? '').toUpperCase()

  let millions
  if (suffix === 'B')         millions = raw * 1_000
  else if (suffix === 'M')    millions = raw
  else if (raw > 10_000_000)  millions = raw / 1_000_000   // full dollar amount
  else if (raw > 1_000)       millions = raw / 1_000        // thousands?
  else                        millions = raw                 // already millions

  return Math.round(millions * 100) / 100   // 2 decimal places
}

// ─── Fetch one team page ──────────────────────────────────────────────────────

async function fetchTeamPayroll(teamId, slug) {
  const url = `https://www.fangraphs.com/roster-resource/payroll/${slug}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      'Accept':     'text/html,application/xhtml+xml',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()
  const payroll = parsePayroll(html)
  if (payroll === null) throw new Error('Could not find payroll figure in HTML')
  if (payroll < 40 || payroll > 600) throw new Error(`Suspicious payroll value: ${payroll}M`)
  return { teamId: Number(teamId), payroll }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n💰 Payroll Updater — ${SEASON} season\n`)

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  })

  const rows = []
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

    // Small delay — polite to FanGraphs, prevents rate-limiting
    await new Promise(r => setTimeout(r, 200))
  }

  console.log(`\n  Parsed ${rows.length}/30 teams  (${failed.length} failed)`)

  if (rows.length < 20) {
    console.error('\n❌  Too many failures — aborting upsert (check FanGraphs HTML structure)')
    process.exit(1)
  }

  const { error } = await supabase
    .from('team_payrolls')
    .upsert(rows, { onConflict: 'team_id,season' })

  if (error) {
    console.error(`\n❌  Supabase upsert failed: ${error.message}`)
    console.error('    Make sure you ran scripts/create_team_payrolls.sql in the Supabase SQL editor first.')
    process.exit(1)
  }

  if (failed.length > 0) {
    console.warn(`\n⚠️  Failed teams: ${failed.join(', ')}`)
  }

  console.log(`\n✅  Upserted ${rows.length} teams to team_payrolls\n`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })

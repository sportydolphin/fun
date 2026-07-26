// Payroll, player contracts, and top-salary data (FanGraphs → Supabase, updated
// by scripts/update-payrolls.mjs). Split out of api.ts; re-exported from there.

import { PlayerContract, ContractYear } from './types'
import { TEAM_ABBR } from './constants'
import { supabase } from '../lib/supabase'

// ─── Payroll data (sourced from FanGraphs via daily GH Actions job) ──────────

/**
 * Fetches team payrolls for the given season from the Supabase `team_payrolls`
 * table (updated daily by scripts/update-payrolls.mjs).
 *
 * Returns a Record<teamId, payrollInMillions> or an empty object on failure
 * (caller should fall back to the hardcoded TEAM_PAYROLLS_2026 constant).
 */
export async function fetchTeamPayrolls(season: number): Promise<Record<number, number>> {
  const { data, error } = await supabase
    .from('team_payrolls')
    .select('team_id, payroll_m')
    .eq('season', season)

  if (error || !data?.length) return {}
  return Object.fromEntries(data.map(r => [Number(r.team_id), Number(r.payroll_m)]))
}

// ─── Player contracts ─────────────────────────────────────────────────────────
// Sourced from FanGraphs Roster Resource by scripts/update-payrolls.mjs (see
// scripts/create_player_contracts.sql). Scraped server-side into Supabase rather
// than fetched here: FanGraphs serves HTML with no CORS headers, so the browser
// can't read it directly even if we wanted to parse it client-side.

const contractCache = new Map<number, Promise<PlayerContract | null>>()

/** One player's contract, or null when we have no row for them (minor leaguers, etc). */
export function fetchPlayerContract(mlbamId: number): Promise<PlayerContract | null> {
  if (!contractCache.has(mlbamId)) {
    // async IIFE, not a .then chain: the Supabase builder is a thenable, not a
    // real Promise, so it has no .catch to hang the failure path on.
    const p = (async (): Promise<PlayerContract | null> => {
      try {
        const { data, error } = await supabase
          .from('player_contracts')
          .select('*')
          .eq('mlbam_id', mlbamId)
          .maybeSingle()
        if (error || !data) return null
        return {
          mlbamId:         Number(data.mlbam_id),
          playerName:      data.player_name,
          teamId:          Number(data.team_id),
          contractType:    data.contract_type ?? null,
          yearsTotal:      data.years_total ?? null,
          totalValue:      data.total_value != null ? Number(data.total_value) : null,
          aav:             data.aav != null ? Number(data.aav) : null,
          startSeason:     data.start_season ?? null,
          endSeason:       data.end_season ?? null,
          serviceTime:     data.service_time ?? null,
          freeAgentSeason: data.free_agent_season ?? null,
          description:     data.description ?? null,
          years:           Array.isArray(data.years) ? (data.years as ContractYear[]) : [],
          updatedAt:       data.updated_at ?? null,
        }
      } catch {
        // A missing table (migration not run yet) must not break the player page.
        return null
      }
    })()
    contractCache.set(mlbamId, p)
  }
  return contractCache.get(mlbamId)!
}

// ─── Top salaries (from the same player_contracts table) ─────────────────────

export interface SalaryRow {
  playerId:   number
  playerName: string
  teamId:     number
  teamAbbr:   string
  salary:     number   // this season's salary line, whole dollars
}

const salaryCache = new Map<number, Promise<SalaryRow[]>>()

/**
 * The highest-paid players for a season, ranked descending.
 *
 * Reads the same `player_contracts` rows the player page uses (scraped from
 * FanGraphs Roster Resource by scripts/update-payrolls.mjs). Each contract's
 * `years[]` carries a per-season salary line, so we pull the entry for `season`
 * rather than the deal's AAV: this is the money actually paid that year, which a
 * backloaded or deferred contract can push well above or below its average.
 *
 * Contracts are only scraped for the live season, so — like team payrolls — this
 * is meaningful for the current year only. Returns [] on any failure (missing
 * table before the migration runs, FanGraphs 403 leaving the table empty, etc).
 */
export function fetchTopSalaries(season: number): Promise<SalaryRow[]> {
  if (!salaryCache.has(season)) salaryCache.set(season, loadTopSalaries(season))
  return salaryCache.get(season)!
}

async function loadTopSalaries(season: number): Promise<SalaryRow[]> {
  try {
    const { data, error } = await supabase
      .from('player_contracts')
      .select('mlbam_id, player_name, team_id, years')
    if (error || !data) return []

    const rows: SalaryRow[] = []
    for (const r of data) {
      const years  = Array.isArray(r.years) ? (r.years as ContractYear[]) : []
      const salary = years.find(y => Number(y.season) === season)?.salary ?? 0
      const teamId = Number(r.team_id) || 0
      const playerId = Number(r.mlbam_id) || 0
      // Skip rows with no salary line for this season — pre-arb minors, future
      // arb/FA years that aren't negotiated yet (recorded as 0), or stale rows.
      if (playerId > 0 && salary > 0) {
        rows.push({
          playerId,
          playerName: r.player_name ?? '—',
          teamId,
          teamAbbr:   TEAM_ABBR[teamId] ?? '—',
          salary,
        })
      }
    }
    return rows.sort((a, b) => b.salary - a.salary).slice(0, 25)
  } catch {
    return []
  }
}


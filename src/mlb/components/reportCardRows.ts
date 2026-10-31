// ─── Report Card row builders: each turns raw data into a fully-sorted,
// display-ready row array for one leaderboard board. No JSX lives here; the
// card components that render these rows are in ./leaderboards.

import { TeamSummary, SosEntry, StandingsDivision } from '../types'
import { TEAM_ABBR } from '../constants'
import type { StreakRow, PitchPaLeaders, SalaryRow } from '../api'
import type { LbRow, PlayerLbRow } from './leaderboards'
import { outsToIp } from '../../league/innings'

export interface AgeEntry { teamId: number; abbr: string; avgAge: number }

// ─── Streak row builder: StreakRow[] (from the API) → display PlayerLbRow[] ───

export function buildStreakRows(rows: StreakRow[], kind: 'hitting' | 'hitless' | 'scoreless' | 'gamesPlayed'): PlayerLbRow[] {
  if (!rows.length) return []
  const max = rows[0].value || 1   // API returns each board pre-sorted desc by value
  return rows.map(r => ({
    playerId: r.playerId,
    playerName: r.playerName,
    teamId: r.teamId,
    teamAbbr: r.teamAbbr,
    // A "+" marks a games-played streak that was still alive at the oldest season
    // searched, so its true length runs even longer than the number shown.
    value: kind === 'scoreless' ? `${outsToIp(r.value)} IP`
      : kind === 'hitless' ? `${r.value} PA`
      : kind === 'gamesPlayed' ? `${r.value}${r.capped ? '+' : ''} G`
      : `${r.value} G`,
    barFraction: r.value / max,
  }))
}

// ─── Pitches-per-PA row builder ───────────────────────────────────────────────

export function buildPitchPaRows(data: PitchPaLeaders | null, kind: 'most' | 'fewest'): PlayerLbRow[] {
  const rows = kind === 'most' ? data?.most : data?.fewest
  if (!data || !rows?.length) return []
  const spread = (data.max - data.min) || 1

  return rows.map(r => ({
    playerId: r.playerId,
    playerName: r.playerName,
    teamId: r.teamId,
    teamAbbr: r.teamAbbr,
    value: `${r.value.toFixed(2)} P/PA`,
    // Scaled across the qualified league's range rather than from zero: every
    // regular sees somewhere between ~3.1 and ~4.4 pitches a trip, so zero-based
    // bars would be indistinguishable. Each board's leader fills its bar, and the
    // far end of the league sits near empty.
    barFraction: 0.12 + 0.88 * ((kind === 'most' ? r.value - data.min : data.max - r.value) / spread),
  }))
}

// ─── Salary row builder ───────────────────────────────────────────────────────

function fmtSalary(dollars: number): string {
  return dollars >= 1_000_000
    ? `$${(dollars / 1_000_000).toFixed(1)}M`
    : `$${Math.round(dollars / 1_000)}K`
}

export function buildSalaryRows(rows: SalaryRow[]): PlayerLbRow[] {
  if (!rows.length) return []
  const max = rows[0].salary || 1   // fetchTopSalaries returns rows pre-sorted desc
  return rows.map(r => ({
    playerId: r.playerId,
    playerName: r.playerName,
    teamId: r.teamId,
    teamAbbr: r.teamAbbr,
    value: fmtSalary(r.salary),
    barFraction: r.salary / max,
  }))
}

// ─── Team row builders, one per board, each producing a fully-sorted LbRow[] ──

export function buildFraudRows(data: TeamSummary[], nameMap: Map<number, string>, type: 'fraud' | 'cursed'): LbRow[] {
  const isFraud = type === 'fraud'
  const withScores = data
    .filter(d => !isNaN(d.rs) && !isNaN(d.ra) && d.wins + d.losses > 0)
    .map(d => {
      const e = 1.83
      const pythPct = d.ra > 0 ? Math.pow(d.rs, e) / (Math.pow(d.rs, e) + Math.pow(d.ra, e)) : 0.99
      const games = d.wins + d.losses
      const pythWins = Math.round(pythPct * games)
      const delta = d.wins - pythWins
      const winPct = d.wins / games
      return { ...d, delta, winPct }
    })
    .filter(t => isFraud ? t.delta > 0 : t.delta < 0)
    // RANKED BY THE NUMBER ON THE ROW. Until Oct 21, 2026 this sorted on the gap times win%, so a
    // contender ranked above a worse club with a bigger gap, and the board read Rays +8 over Reds
    // +10: a list that looks unsorted to anyone who cannot see the hidden score. Win% now only
    // breaks a tie, the contender first above and the worse club first below.
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || (isFraud ? b.winPct - a.winPct : a.winPct - b.winPct))

  const maxGap = Math.max(...withScores.map(t => Math.abs(t.delta)), 1)

  return withScores.map(t => ({
    teamId: t.id,
    abbr: t.abbr,
    name: nameMap.get(t.id) ?? t.abbr,
    sub: `${t.wins}–${t.losses}`,
    value: `${t.delta > 0 ? '+' : t.delta < 0 ? '−' : ''}${Math.abs(t.delta)} wins`,
    barFraction: Math.abs(t.delta) / maxGap,
  }))
}

export function buildAgeRows(entries: AgeEntry[], nameMap: Map<number, string>, type: 'oldest' | 'youngest'): LbRow[] {
  if (!entries.length) return []
  const isOldest = type === 'oldest'
  const sorted = isOldest ? entries : [...entries].reverse()
  const minAge = entries[entries.length - 1].avgAge
  const maxAge = entries[0].avgAge
  const range = maxAge - minAge || 0.1

  return sorted.map(t => {
    const norm = (t.avgAge - minAge) / range
    return {
      teamId: t.teamId,
      abbr: t.abbr,
      name: nameMap.get(t.teamId) ?? t.abbr,
      value: `${t.avgAge.toFixed(1)} yrs`,
      barFraction: isOldest ? norm : 1 - norm,
    }
  })
}

export function buildPayrollRows(payrolls: Record<number, number>, nameMap: Map<number, string>, direction: 'highest' | 'lowest'): LbRow[] {
  const entries = Object.entries(payrolls).map(([idStr, amount]) => {
    const id = Number(idStr)
    return { teamId: id, abbr: TEAM_ABBR[id] ?? '?', name: nameMap.get(id) ?? '', amount }
  }).filter(e => e.name)
  const sorted = [...entries].sort((a, b) => direction === 'highest' ? b.amount - a.amount : a.amount - b.amount)
  const max = sorted[0]?.amount ?? 1
  const min = sorted[sorted.length - 1]?.amount ?? 0
  const range = max - min || 1
  return sorted.map(e => ({
    teamId: e.teamId, abbr: e.abbr, name: e.name,
    value: `$${e.amount}M`,
    barFraction: direction === 'highest' ? (e.amount - min) / range : (max - e.amount) / range,
  }))
}

// ─── Boards that need a finished season ───────────────────────────────────────

const clubs = (divisions: StandingsDivision[]) => divisions.flatMap(d => d.teams)

/** Wins against the season before. A club with no row last year (none today) is left out. */
export function buildWinChangeRows(now: StandingsDivision[], before: StandingsDivision[], nameMap: Map<number, string>, direction: 'up' | 'down'): LbRow[] {
  const last = new Map(clubs(before).map(t => [t.teamId, t.wins]))
  const rows = clubs(now)
    .filter(t => last.has(t.teamId))
    .map(t => ({ t, delta: t.wins - last.get(t.teamId)! }))
    .filter(r => (direction === 'up' ? r.delta > 0 : r.delta < 0))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.t.wins - a.t.wins)
  const max = Math.max(...rows.map(r => Math.abs(r.delta)), 1)
  return rows.map(({ t, delta }) => ({
    teamId: t.teamId, abbr: t.abbr, name: nameMap.get(t.teamId) ?? t.abbr,
    sub: `${t.wins}–${t.losses}`,
    value: `${delta > 0 ? '+' : '−'}${Math.abs(delta)} wins`,
    barFraction: Math.abs(delta) / max,
  }))
}

/** Payroll over wins, in millions a win. Bars fill toward the board's own end, as the payroll boards do. */
export function buildCostPerWinRows(now: StandingsDivision[], payrolls: Record<number, number>, nameMap: Map<number, string>, direction: 'cheapest' | 'priciest'): LbRow[] {
  const rows = clubs(now)
    .filter(t => t.wins > 0 && payrolls[t.teamId] != null)
    .map(t => ({ t, cost: payrolls[t.teamId] / t.wins }))
    .sort((a, b) => (direction === 'cheapest' ? a.cost - b.cost : b.cost - a.cost))
  if (!rows.length) return []
  const costs = rows.map(r => r.cost)
  const min = Math.min(...costs), max = Math.max(...costs), range = max - min || 1
  return rows.map(({ t, cost }) => ({
    teamId: t.teamId, abbr: t.abbr, name: nameMap.get(t.teamId) ?? t.abbr,
    sub: `${t.wins}–${t.losses}`,
    value: `$${cost.toFixed(1)}M`,
    barFraction: direction === 'priciest' ? (cost - min) / range : (max - cost) / range,
  }))
}

/** `final`: the entries are the whole season played (fetchStrengthOfSchedule's `final`). */
export function buildSosRows(entries: SosEntry[], direction: 'hardest' | 'easiest', final = false): LbRow[] {
  if (!entries.length) return []
  const isHardest = direction === 'hardest'
  const sorted = isHardest ? entries : [...entries].reverse()
  const minPct = Math.min(...entries.map(e => e.oppWinPct))
  const maxPct = Math.max(...entries.map(e => e.oppWinPct))
  const range = maxPct - minPct || 0.001

  return sorted.map(e => {
    const norm = (e.oppWinPct - minPct) / range
    const pctStr = '.' + Math.round(e.oppWinPct * 1000).toString().padStart(3, '0')
    return {
      teamId: e.teamId,
      abbr: e.abbr,
      name: e.teamName,
      // Every club played 162 (161 after a cancellation), so a season's count says nothing.
      sub: final ? `${e.wins}–${e.losses}` : `${e.wins}–${e.losses} · ${e.games}G left`,
      value: pctStr,
      barFraction: isHardest ? norm : 1 - norm,
    }
  })
}

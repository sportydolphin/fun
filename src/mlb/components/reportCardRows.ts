// ─── Report Card row builders — each turns raw data into a fully-sorted,
// display-ready row array for one leaderboard board. No JSX lives here; the
// card components that render these rows are in ./leaderboards.

import { TeamSummary, SosEntry } from '../types'
import { TEAM_ABBR } from '../constants'
import type { StreakRow, PitchPaLeaders, SalaryRow } from '../api'
import type { LbRow, PlayerLbRow } from './leaderboards'

export interface AgeEntry { teamId: number; abbr: string; avgAge: number }

// ─── Streak row builder — StreakRow[] (from the API) → display PlayerLbRow[] ───

const HIT_STREAK_LABELS = ['ON FIRE', 'LOCKED IN', 'HEATING UP']
const HITLESS_LABELS    = ['ICE COLD', 'LOST IT', 'IN A FUNK']
const SCORELESS_LABELS  = ['NASTY', 'DEALING', 'FILTHY']
const IRONMAN_LABELS    = ['IRON MAN', 'NEVER SITS', 'ALWAYS IN']

function outsToIp(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`
}

export function buildStreakRows(rows: StreakRow[], kind: 'hitting' | 'hitless' | 'scoreless' | 'gamesPlayed'): PlayerLbRow[] {
  if (!rows.length) return []
  const max = rows[0].value || 1   // API returns each board pre-sorted desc by value
  const labels = kind === 'hitting' ? HIT_STREAK_LABELS
    : kind === 'hitless' ? HITLESS_LABELS
    : kind === 'scoreless' ? SCORELESS_LABELS
    : IRONMAN_LABELS
  return rows.map((r, idx) => ({
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
    label: idx < labels.length ? labels[idx] : undefined,
  }))
}

// ─── Pitches-per-PA row builder ───────────────────────────────────────────────

const GRINDER_LABELS = ['GRINDER', 'PEST', 'PATIENT']
const HACKER_LABELS  = ['FREE SWINGER', 'HACKER', 'FIRST PITCH']

export function buildPitchPaRows(data: PitchPaLeaders | null, kind: 'most' | 'fewest'): PlayerLbRow[] {
  const rows = kind === 'most' ? data?.most : data?.fewest
  if (!data || !rows?.length) return []
  const spread = (data.max - data.min) || 1
  const labels = kind === 'most' ? GRINDER_LABELS : HACKER_LABELS

  return rows.map((r, idx) => ({
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
    label: idx < labels.length ? labels[idx] : undefined,
  }))
}

// ─── Salary row builder ───────────────────────────────────────────────────────

const SALARY_LABELS = ['STUPID RICH', 'THE BAG', 'CHA-CHING']

function fmtSalary(dollars: number): string {
  return dollars >= 1_000_000
    ? `$${(dollars / 1_000_000).toFixed(1)}M`
    : `$${Math.round(dollars / 1_000)}K`
}

export function buildSalaryRows(rows: SalaryRow[]): PlayerLbRow[] {
  if (!rows.length) return []
  const max = rows[0].salary || 1   // fetchTopSalaries returns rows pre-sorted desc
  return rows.map((r, idx) => ({
    playerId: r.playerId,
    playerName: r.playerName,
    teamId: r.teamId,
    teamAbbr: r.teamAbbr,
    value: fmtSalary(r.salary),
    barFraction: r.salary / max,
    label: idx < SALARY_LABELS.length ? SALARY_LABELS[idx] : undefined,
  }))
}

// ─── Team row builders — one per board, each producing a fully-sorted LbRow[] ──

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
      const fraudScore = delta > 0 ? delta * winPct : 0
      const cursedScore = delta < 0 ? (-delta) * (1 - winPct) : 0
      return { ...d, delta, winPct, fraudScore, cursedScore }
    })
    .filter(t => isFraud ? t.delta > 0 : t.delta < 0)
    .sort((a, b) => isFraud ? b.fraudScore - a.fraudScore : b.cursedScore - a.cursedScore)

  const maxScore = Math.max(...withScores.map(t => isFraud ? t.fraudScore : t.cursedScore), 1)

  const getLabel = (score: number) => isFraud
    ? score >= 4.0 ? 'CONFIRMED FRAUD' : score >= 2.5 ? 'FRAUD ALERT' : score >= 1.5 ? 'SUS' : 'A LIL SUS'
    : score >= 4.0 ? 'TRULY CURSED' : score >= 2.5 ? 'BIG MAD' : score >= 1.5 ? 'ROBBED' : 'UNLUCKY'

  return withScores.map(t => {
    const score = isFraud ? t.fraudScore : t.cursedScore
    return {
      teamId: t.id,
      abbr: t.abbr,
      name: nameMap.get(t.id) ?? t.abbr,
      sub: `${t.wins}–${t.losses}`,
      value: `${t.delta > 0 ? '+' : ''}${t.delta} wins`,
      barFraction: score / maxScore,
      label: getLabel(score),
    }
  })
}

const OLDEST_LABELS   = ['ULTRA UNC', 'GRAMPS', 'SENIOR DISCOUNT']
const YOUNGEST_LABELS = ['LITERAL TODDLERS', 'BABY-FACED', 'YOUNG GUNS']

export function buildAgeRows(entries: AgeEntry[], nameMap: Map<number, string>, type: 'oldest' | 'youngest'): LbRow[] {
  if (!entries.length) return []
  const isOldest = type === 'oldest'
  const sorted = isOldest ? entries : [...entries].reverse()
  const minAge = entries[entries.length - 1].avgAge
  const maxAge = entries[0].avgAge
  const range = maxAge - minAge || 0.1
  const labels = isOldest ? OLDEST_LABELS : YOUNGEST_LABELS

  return sorted.map((t, idx) => {
    const norm = (t.avgAge - minAge) / range
    return {
      teamId: t.teamId,
      abbr: t.abbr,
      name: nameMap.get(t.teamId) ?? t.abbr,
      value: `${t.avgAge.toFixed(1)} yrs`,
      barFraction: isOldest ? norm : 1 - norm,
      label: idx < labels.length ? labels[idx] : undefined,
    }
  })
}

const HIGHEST_PAYROLL_LABELS = ['GOING ALL IN', 'SPENDING UP', 'BIG DOLLARS']
const LOWEST_PAYROLL_LABELS  = ['BUDGET SQUAD', 'POCKET CHANGE', 'WHO TF R U']

export function buildPayrollRows(payrolls: Record<number, number>, nameMap: Map<number, string>, direction: 'highest' | 'lowest'): LbRow[] {
  const entries = Object.entries(payrolls).map(([idStr, amount]) => {
    const id = Number(idStr)
    return { teamId: id, abbr: TEAM_ABBR[id] ?? '?', name: nameMap.get(id) ?? '', amount }
  }).filter(e => e.name)
  const sorted = [...entries].sort((a, b) => direction === 'highest' ? b.amount - a.amount : a.amount - b.amount)
  const max = sorted[0]?.amount ?? 1
  const min = sorted[sorted.length - 1]?.amount ?? 0
  const range = max - min || 1
  const labels = direction === 'highest' ? HIGHEST_PAYROLL_LABELS : LOWEST_PAYROLL_LABELS
  return sorted.map((e, idx) => ({
    teamId: e.teamId, abbr: e.abbr, name: e.name,
    value: `$${e.amount}M`,
    barFraction: direction === 'highest' ? (e.amount - min) / range : (max - e.amount) / range,
    label: idx < labels.length ? labels[idx] : undefined,
  }))
}

const HARDEST_LABELS = ['GOOD LUCK LOL', 'UPHILL BATTLE', 'ROUGH PATCH']
const EASIEST_LABELS = ['VACATION MODE', 'EASY STREET', 'BIG CHILLING']

export function buildSosRows(entries: SosEntry[], direction: 'hardest' | 'easiest'): LbRow[] {
  if (!entries.length) return []
  const isHardest = direction === 'hardest'
  const sorted = isHardest ? entries : [...entries].reverse()
  const minPct = Math.min(...entries.map(e => e.oppWinPct))
  const maxPct = Math.max(...entries.map(e => e.oppWinPct))
  const range = maxPct - minPct || 0.001
  const labels = isHardest ? HARDEST_LABELS : EASIEST_LABELS

  return sorted.map((e, idx) => {
    const norm = (e.oppWinPct - minPct) / range
    const pctStr = '.' + Math.round(e.oppWinPct * 1000).toString().padStart(3, '0')
    return {
      teamId: e.teamId,
      abbr: e.abbr,
      name: e.teamName,
      sub: `${e.wins}–${e.losses} · ${e.remainingGames}G left`,
      value: pctStr,
      barFraction: isHardest ? norm : 1 - norm,
      label: idx < labels.length ? labels[idx] : undefined,
    }
  })
}

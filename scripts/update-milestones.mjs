#!/usr/bin/env node
/**
 * update-milestones.mjs — Nightly precompute of Milestone Watch: active players
 * closing in on career round numbers, single-season marks, and all-time records.
 *
 * Career/season totals barely move day to day, so this runs once a night and the
 * client reads one row, same template as streak_leaders / playoff_odds.
 *
 * How it gathers totals cheaply:
 *   1. Pull all 30 active rosters (~30 requests).
 *   2. Batch career + season stats through the people endpoint's hydrate in chunks
 *      of 40 (people?personIds=…&hydrate=stats(group=…,type=career)). Position
 *      players get hitting, pitchers get pitching. ~60 requests total.
 *   3. Compare each total against the catalog below; keep anyone within the
 *      per-stat watch window. Upsert one jsonb row per season into milestone_watch.
 *
 * Usage (local):
 *   node scripts/update-milestones.mjs --dry-run
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/update-milestones.mjs
 *
 * npm script: npm run milestones
 */

import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

const DRY_RUN = process.argv.includes('--dry-run')

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error('❌  Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running (or use --dry-run)')
  process.exit(1)
}

const SEASON = new Date().getFullYear()
const FETCH_CONCURRENCY = 5

// How long a just-reached milestone stays in the "recently reached" list. Each run
// snapshots totals; the next run diffs them to catch a crossing, then the item lingers
// this many days so it's still visible for players who don't check daily.
const RECENT_DAYS = 7
const TODAY = new Date().toISOString().slice(0, 10)

const TEAM_ABBR = {
  108: 'LAA', 109: 'ARI', 110: 'BAL', 111: 'BOS', 112: 'CHC',
  113: 'CIN', 114: 'CLE', 115: 'COL', 116: 'DET', 117: 'HOU',
  118: 'KC',  119: 'LAD', 120: 'WSH', 121: 'NYM', 133: 'OAK',
  134: 'PIT', 135: 'SD',  136: 'SEA', 137: 'SF',  138: 'STL',
  139: 'TB',  140: 'TEX', 141: 'TOR', 142: 'MIN', 143: 'PHI',
  144: 'ATL', 145: 'CWS', 146: 'MIA', 147: 'NYY', 158: 'MIL',
}
const TEAM_IDS = Object.keys(TEAM_ABBR).map(Number)

// ─── Milestone catalog ────────────────────────────────────────────────────────
// Each stat lists round-number thresholds and a "watch window" — how close a
// player must be for it to count as a live chase. `label` is the noun shown in the
// card ("12 HR from 500"). Windows scale with how fast the stat accrues.

const CAREER_HITTING = {
  homeRuns:    { label: 'HR',          thresholds: [100, 200, 300, 400, 500, 600, 700, 762], window: 12 },
  hits:        { label: 'hits',        thresholds: [500, 1000, 1500, 2000, 2500, 3000],      window: 60 },
  rbi:         { label: 'RBI',         thresholds: [500, 1000, 1500, 1750, 2000],            window: 40 },
  runs:        { label: 'runs',        thresholds: [1000, 1500, 2000],                       window: 40 },
  doubles:     { label: 'doubles',     thresholds: [300, 400, 500, 600],                     window: 25 },
  triples:     { label: 'triples',     thresholds: [100, 150],                               window: 10 },
  stolenBases: { label: 'steals',      thresholds: [300, 400, 500, 600],                     window: 12 },
  baseOnBalls: { label: 'walks',       thresholds: [1000, 1250, 1500],                       window: 40 },
  totalBases:  { label: 'total bases', thresholds: [3000, 4000, 5000],                       window: 60 },
}
const CAREER_PITCHING = {
  wins:       { label: 'wins',        thresholds: [100, 150, 200, 250, 300],            window: 8 },
  strikeOuts: { label: 'strikeouts',  thresholds: [1000, 1500, 2000, 2500, 3000, 3500], window: 60 },
  saves:      { label: 'saves',       thresholds: [200, 300, 400, 500],                 window: 15 },
  inningsPitched: { label: 'innings', thresholds: [2000, 2500, 3000],                   window: 40 },
}
const SEASON_HITTING = {
  homeRuns:    { label: 'HR',      thresholds: [30, 40, 50, 60], window: 8 },
  hits:        { label: 'hits',    thresholds: [200],            window: 15 },
  rbi:         { label: 'RBI',     thresholds: [100, 120, 150],  window: 15 },
  runs:        { label: 'runs',    thresholds: [100, 120],       window: 12 },
  stolenBases: { label: 'steals',  thresholds: [30, 40, 50, 60, 70], window: 8 },
  doubles:     { label: 'doubles', thresholds: [50],             window: 8 },
}
const SEASON_PITCHING = {
  wins:       { label: 'wins',       thresholds: [15, 20],       window: 4 },
  strikeOuts: { label: 'strikeouts', thresholds: [200, 250, 300], window: 25 },
  saves:      { label: 'saves',      thresholds: [30, 40, 50],   window: 8 },
}

// Career values that are the actual all-time record — flagged as a record chase.
const RECORDS = {
  homeRuns: 762, hits: 4256, rbi: 2297, runs: 2295,
  stolenBases: 1406, wins: 511, strikeOuts: 5714, saves: 652,
}

// Marquee career milestones that should surface even a bit further out.
const MARQUEE = { homeRuns: 500, hits: 3000, strikeOuts: 3000, wins: 300, saves: 500 }

// ─── Fetch helpers ──────────────────────────────────────────────────────────

async function fetchJson(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json()
}

async function mapPool(items, limit, fn) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx]) }
  }))
}

function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

// playerId → { teamId, isPitcher, name }
async function fetchActivePlayers() {
  const players = new Map()
  await mapPool(TEAM_IDS, FETCH_CONCURRENCY, async (teamId) => {
    try {
      const d = await fetchJson(`https://statsapi.mlb.com/api/v1/teams/${teamId}/roster?rosterType=active`)
      for (const r of d.roster ?? []) {
        const id = Number(r.person?.id)
        if (!id) continue
        players.set(id, {
          teamId,
          name: r.person?.fullName ?? 'Unknown',
          isPitcher: (r.position?.type ?? r.position?.code) === 'Pitcher' || r.position?.code === '1',
        })
      }
    } catch { /* skip a team that failed */ }
  })
  return players
}

// Batch stat lookup: playerId → stat object, for one group + type.
async function fetchStats(ids, group, type) {
  const typeParam = type === 'season' ? `type=season,season=${SEASON}` : 'type=career'
  const out = new Map()
  const chunks = chunk(ids, 40)
  await mapPool(chunks, FETCH_CONCURRENCY, async (ids40) => {
    try {
      const d = await fetchJson(
        `https://statsapi.mlb.com/api/v1/people?personIds=${ids40.join(',')}` +
        `&hydrate=stats(group=${group},${typeParam})`
      )
      for (const p of d.people ?? []) {
        const s = (p.stats ?? []).find(x => x.group?.displayName === group && x.type?.displayName === type)
        const stat = s?.splits?.[0]?.stat
        if (stat) out.set(Number(p.id), stat)
      }
    } catch { /* skip a failed chunk */ }
  })
  return out
}

// ─── Milestone matching ───────────────────────────────────────────────────────

// Closest threshold strictly above `current`, if within the window.
function nextMilestone(current, def) {
  for (const t of def.thresholds) {
    if (t > current) return current >= t - def.window ? { target: t, remaining: t - current } : null
  }
  return null
}

// innings pitched come as a "123.1" string (thirds); other stats are numbers.
function statValue(stat, key) {
  const v = stat?.[key]
  if (v == null) return 0
  if (key === 'inningsPitched') return Math.floor(Number(v)) // whole innings is close enough for a milestone
  return Number(v) || 0
}

function collectItems(player, playerId, stat, catalog, kind) {
  const items = []
  for (const [statKey, def] of Object.entries(catalog)) {
    const current = statValue(stat, statKey)
    if (current <= 0) continue
    const hit = nextMilestone(current, def)
    if (!hit) continue
    const isRecord = kind === 'career' && RECORDS[statKey] === hit.target
    items.push({
      playerId,
      playerName: player.name,
      teamId: player.teamId,
      teamAbbr: TEAM_ABBR[player.teamId] ?? '—',
      group: catalog === CAREER_PITCHING || catalog === SEASON_PITCHING ? 'pitching' : 'hitting',
      statKey,
      statLabel: def.label,
      current,
      target: hit.target,
      remaining: hit.remaining,
      kind: isRecord ? 'record' : kind,
    })
  }
  return items
}

// True if `current` sits within `window` of any threshold, on either side — the player
// is either chasing a milestone or has just passed one. We snapshot these totals each
// run so the next run can tell a fresh crossing from an old one, without storing a value
// for every player (only the few in contention).
function withinWatch(current, def) {
  return def.thresholds.some(t => current >= t - def.window && current <= t + def.window)
}

// The highest threshold crossed since the previous snapshot (prev < t <= current). Null
// when there's no previous value (first run) or nothing was crossed.
function crossedThreshold(current, prev, def) {
  if (prev == null) return null
  let crossed = null
  for (const t of def.thresholds) if (prev < t && current >= t) crossed = t
  return crossed
}

// Walk a player's stats: snapshot the totals worth watching, and emit an "achieved" item
// for any threshold crossed since prevTotals. Mirrors collectItems but for the recent side.
function collectProgress(player, playerId, stat, catalog, kind, prevTotals) {
  const totals = {}
  const achieved = []
  for (const [statKey, def] of Object.entries(catalog)) {
    const current = statValue(stat, statKey)
    if (current <= 0 || !withinWatch(current, def)) continue
    const key = `${playerId}:${kind}:${statKey}`
    totals[key] = current
    const target = crossedThreshold(current, prevTotals[key], def)
    if (target == null) continue
    const isRecord = kind === 'career' && RECORDS[statKey] === target
    achieved.push({
      playerId,
      playerName: player.name,
      teamId: player.teamId,
      teamAbbr: TEAM_ABBR[player.teamId] ?? '—',
      group: catalog === CAREER_PITCHING || catalog === SEASON_PITCHING ? 'pitching' : 'hitting',
      statKey,
      statLabel: def.label,
      current,
      target,
      remaining: 0,
      kind: isRecord ? 'record' : kind,
      achievedOn: TODAY,
    })
  }
  return { totals, achieved }
}

// Records first, then marquee milestones, then everything by closeness.
function priority(item) {
  if (item.kind === 'record') return 0
  if (item.kind === 'career' && MARQUEE[item.statKey] === item.target) return 1
  return 2
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🏆 Milestone Watch — ${SEASON}${DRY_RUN ? ' (dry run)' : ''}\n`)

  // Reuse one client for the read-before / write-after. Created up front (when creds
  // exist) so even a dry run can preview crossings against the last snapshot.
  const supabase = (SUPABASE_URL && SERVICE_KEY)
    ? createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
        realtime: { transport: ws },
      })
    : null

  let prevTotals = {}
  let prevRecent = []
  if (supabase) {
    try {
      const { data } = await supabase.from('milestone_watch').select('data').eq('season', SEASON).limit(1)
      const pd = data?.[0]?.data
      if (pd) { prevTotals = pd.totals ?? {}; prevRecent = pd.recent ?? [] }
    } catch { /* first run or missing table — no previous snapshot */ }
  }

  const players = await fetchActivePlayers()
  console.log(`  ${players.size} active players`)
  if (players.size < 100) throw new Error(`Only ${players.size} players — roster fetch likely failed`)

  const hitterIds  = [...players].filter(([, p]) => !p.isPitcher).map(([id]) => id)
  const pitcherIds = [...players].filter(([, p]) =>  p.isPitcher).map(([id]) => id)

  const [hitCareer, hitSeason, pitCareer, pitSeason] = await Promise.all([
    fetchStats(hitterIds,  'hitting',  'career'),
    fetchStats(hitterIds,  'hitting',  'season'),
    fetchStats(pitcherIds, 'pitching', 'career'),
    fetchStats(pitcherIds, 'pitching', 'season'),
  ])

  const items = []
  const totals = {}          // this run's snapshot, written back for the next diff
  const achievedNew = []     // thresholds crossed since the previous run
  const record = ({ totals: t, achieved }) => { Object.assign(totals, t); achievedNew.push(...achieved) }
  for (const [id, player] of players) {
    if (player.isPitcher) {
      if (pitCareer.has(id)) { const s = pitCareer.get(id); items.push(...collectItems(player, id, s, CAREER_PITCHING, 'career')); record(collectProgress(player, id, s, CAREER_PITCHING, 'career', prevTotals)) }
      if (pitSeason.has(id)) { const s = pitSeason.get(id); items.push(...collectItems(player, id, s, SEASON_PITCHING, 'season')); record(collectProgress(player, id, s, SEASON_PITCHING, 'season', prevTotals)) }
    } else {
      if (hitCareer.has(id)) { const s = hitCareer.get(id); items.push(...collectItems(player, id, s, CAREER_HITTING, 'career')); record(collectProgress(player, id, s, CAREER_HITTING, 'career', prevTotals)) }
      if (hitSeason.has(id)) { const s = hitSeason.get(id); items.push(...collectItems(player, id, s, SEASON_HITTING, 'season')); record(collectProgress(player, id, s, SEASON_HITTING, 'season', prevTotals)) }
    }
  }

  items.sort((a, b) => priority(a) - priority(b) || a.remaining - b.remaining)

  // Carry forward still-recent crossings, fold in the new ones, dedupe (new wins), and
  // keep them newest-first. A crossing is only detected once (prev < t), so the merge
  // just extends each item's visible life to RECENT_DAYS.
  const cutoff = Date.now() - RECENT_DAYS * 86400e3
  const seen = new Set()
  const recent = [...achievedNew, ...prevRecent]
    .filter(it => { const t = new Date(it.achievedOn).getTime(); return Number.isFinite(t) && t >= cutoff })
    .filter(it => { const k = `${it.playerId}:${it.kind}:${it.statKey}:${it.target}`; if (seen.has(k)) return false; seen.add(k); return true })
    .sort((a, b) => (a.achievedOn < b.achievedOn ? 1 : a.achievedOn > b.achievedOn ? -1 : priority(a) - priority(b)))
    .slice(0, 30)

  console.log(`  ${items.length} live milestone chases · ${recent.length} recently reached (${achievedNew.length} new)\n`)
  for (const it of items.slice(0, 25)) {
    const tag = it.kind === 'record' ? ' (record)' : it.kind === 'season' ? ' (season)' : ''
    console.log(`    ${it.playerName.padEnd(22)} ${String(it.remaining).padStart(3)} ${it.statLabel} from ${it.target}${tag}`)
  }
  if (recent.length) {
    console.log('\n  Recently reached:')
    for (const it of recent) console.log(`    ${it.playerName.padEnd(22)} reached ${it.target} ${it.statLabel} (${it.achievedOn})`)
  }
  console.log('')

  if (DRY_RUN) { console.log('✅  Dry run complete — nothing written\n'); return }
  if (!supabase) { console.error('❌  No Supabase client — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }

  const { error } = await supabase
    .from('milestone_watch')
    .upsert({ season: SEASON, data: { items, recent, totals }, computed_at: new Date().toISOString() }, { onConflict: 'season' })
  if (error) {
    console.error(`\n❌  Supabase upsert failed: ${error.message}`)
    console.error('    Make sure you ran scripts/create_milestone_watch.sql first.')
    process.exit(1)
  }
  console.log(`✅  Upserted ${items.length} chases + ${recent.length} recent for ${SEASON}\n`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })

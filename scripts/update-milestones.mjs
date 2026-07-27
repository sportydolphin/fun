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

// Records first, then marquee milestones, then everything by closeness.
function priority(item) {
  if (item.kind === 'record') return 0
  if (item.kind === 'career' && MARQUEE[item.statKey] === item.target) return 1
  return 2
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🏆 Milestone Watch — ${SEASON}${DRY_RUN ? ' (dry run)' : ''}\n`)

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
  for (const [id, player] of players) {
    if (player.isPitcher) {
      if (pitCareer.has(id)) items.push(...collectItems(player, id, pitCareer.get(id), CAREER_PITCHING, 'career'))
      if (pitSeason.has(id)) items.push(...collectItems(player, id, pitSeason.get(id), SEASON_PITCHING, 'season'))
    } else {
      if (hitCareer.has(id)) items.push(...collectItems(player, id, hitCareer.get(id), CAREER_HITTING, 'career'))
      if (hitSeason.has(id)) items.push(...collectItems(player, id, hitSeason.get(id), SEASON_HITTING, 'season'))
    }
  }

  items.sort((a, b) => priority(a) - priority(b) || a.remaining - b.remaining)

  console.log(`  ${items.length} live milestone chases\n`)
  for (const it of items.slice(0, 25)) {
    const tag = it.kind === 'record' ? ' (record)' : it.kind === 'season' ? ' (season)' : ''
    console.log(`    ${it.playerName.padEnd(22)} ${String(it.remaining).padStart(3)} ${it.statLabel} from ${it.target}${tag}`)
  }
  console.log('')

  if (DRY_RUN) { console.log('✅  Dry run complete — nothing written\n'); return }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  })
  const { error } = await supabase
    .from('milestone_watch')
    .upsert({ season: SEASON, data: { items }, computed_at: new Date().toISOString() }, { onConflict: 'season' })
  if (error) {
    console.error(`\n❌  Supabase upsert failed: ${error.message}`)
    console.error('    Make sure you ran scripts/create_milestone_watch.sql first.')
    process.exit(1)
  }
  console.log(`✅  Upserted ${items.length} milestone chases for ${SEASON}\n`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })

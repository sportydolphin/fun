#!/usr/bin/env node
/**
 * fix-milestone-dates.mjs: one-off repair of the dates on milestone_watch's reached archive.
 *
 * update-milestones.mjs stamped a crossing with the date the job RAN, which is 07:00 UTC the morning
 * after the games it diffed, so every reached milestone in the 2026 archive carried the day after
 * the game. That job now stamps Eastern "yesterday", but it only writes a date once, at detection,
 * and every later run carries the archive forward untouched, so the stored dates stay wrong unless
 * something rewrites them.
 *
 * NOT A BLANKET "MINUS ONE DAY". The lag was one day only when the nightly run happened on schedule;
 * a skipped or late run makes it two. So each date is recomputed from the player's own game log:
 * walk the season's games back from the current total and find the game where the total crossed the
 * mark. Regular-season games only, the same as the totals the milestones are measured on. An item
 * this cannot place is left exactly as it is and reported.
 *
 * Usage:
 *   node --env-file=.env scripts/fix-milestone-dates.mjs            (dry run: prints every change)
 *   node --env-file=.env scripts/fix-milestone-dates.mjs --apply    (writes them)
 *   add --season 2025 for another year (default: this year)
 *
 * Needs SUPABASE_DB_URL. Safe to rerun: a date already right is left alone.
 */

import pg from 'pg'

const APPLY = process.argv.includes('--apply')
const seasonArg = process.argv.indexOf('--season')
const SEASON = seasonArg > 0 ? Number(process.argv[seasonArg + 1]) : new Date().getFullYear()
const CONN = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
if (!CONN) { console.error('✖ SUPABASE_DB_URL is not set'); process.exit(1) }

const API = 'https://statsapi.mlb.com/api/v1'
async function json(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json()
}

// Innings are counted in outs so "6.1" adds up exactly; the milestone itself is whole innings.
const outs = ip => { const [w = '0', f = '0'] = String(ip ?? '0').split('.'); return Number(w) * 3 + Number(f) }
const amount = (stat, key) => key === 'inningsPitched' ? outs(stat?.[key]) : Number(stat?.[key] ?? 0)
const targetAmount = (key, target) => key === 'inningsPitched' ? target * 3 : target

const logCache = new Map()
async function seasonLog(playerId, group) {
  const k = `${playerId}:${group}`
  if (!logCache.has(k)) {
    logCache.set(k, json(`${API}/people/${playerId}/stats?stats=gameLog&group=${group}&season=${SEASON}&gameType=R`)
      .then(d => (d.stats?.[0]?.splits ?? []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))))
  }
  return logCache.get(k)
}
async function total(playerId, group, type) {
  const d = await json(`${API}/people/${playerId}/stats?stats=${type === 'season' ? 'season' : 'career'}&group=${group}&season=${SEASON}&gameType=R`)
  return d.stats?.[0]?.splits?.[0]?.stat ?? null
}

/** The date of the game in which the total reached `target`, or null if the log cannot place it. */
async function crossingDate(it) {
  const type = it.kind === 'season' ? 'season' : 'career'
  const [log, tot] = await Promise.all([seasonLog(it.playerId, it.group), total(it.playerId, it.group, type)])
  if (!tot || !log.length) return null
  const need = targetAmount(it.statKey, it.target)
  let after = amount(tot, it.statKey)
  for (let i = log.length - 1; i >= 0; i--) {
    const before = after - amount(log[i].stat, it.statKey)
    if (before < need && after >= need) return String(log[i].date).slice(0, 10)
    after = before
  }
  return null
}

const client = new pg.Client({ connectionString: CONN, ssl: /@(localhost|127\.0\.0\.1)/.test(CONN) ? false : { rejectUnauthorized: false } })
await client.connect()
try {
  await client.query('begin')
  // Locked for the length of the read-and-write, so a nightly run landing mid-repair waits rather
  // than being overwritten by an archive read before it.
  const { rows } = await client.query('select data from milestone_watch where season = $1 for update', [SEASON])
  if (!rows.length) { console.log(`No milestone_watch row for ${SEASON}.`); await client.query('rollback'); process.exit(0) }
  const data = rows[0].data
  const reached = data.reached ?? []

  const fixed = new Map()   // "<player>:<kind>:<stat>:<target>" -> new date
  const key = it => `${it.playerId}:${it.kind}:${it.statKey}:${it.target}`
  let unchanged = 0
  const unplaced = []
  for (const it of reached) {
    let when = null
    try { when = await crossingDate(it) } catch (e) { unplaced.push(`${it.playerName} ${it.target} ${it.statLabel} (${e.message})`); continue }
    if (!when) { unplaced.push(`${it.playerName} ${it.target} ${it.statLabel}`); continue }
    if (when === it.achievedOn) { unchanged++; continue }
    fixed.set(key(it), when)
    console.log(`  ${it.playerName.padEnd(24)} ${String(it.target).padStart(5)} ${it.statLabel.padEnd(12)} ${it.achievedOn} → ${when}`)
  }
  console.log(`\n${fixed.size} to correct, ${unchanged} already right, ${unplaced.length} left as they are`)
  for (const u of unplaced) console.log(`  could not place: ${u}`)

  if (!APPLY) { console.log('\nDry run. Rerun with --apply to write.'); await client.query('rollback') }
  else if (!fixed.size) { console.log('\nNothing to write.'); await client.query('rollback') }
  else {
    const patch = list => (list ?? []).map(it => fixed.has(key(it)) ? { ...it, achievedOn: fixed.get(key(it)) } : it)
    // Newest first, as update-milestones keeps it. `recent` is rebuilt from `reached` every night, so
    // patching it too only keeps the two agreeing until then.
    const order = (a, b) => (a.achievedOn < b.achievedOn ? 1 : a.achievedOn > b.achievedOn ? -1 : 0)
    const next = { ...data, reached: patch(data.reached).sort(order), recent: patch(data.recent).sort(order) }
    await client.query('update milestone_watch set data = $2 where season = $1', [SEASON, next])
    await client.query('commit')
    console.log(`\nWrote ${fixed.size} corrected dates.`)
  }
} catch (e) {
  await client.query('rollback').catch(() => {})
  console.error(e)
  process.exitCode = 1
} finally {
  await client.end()
}

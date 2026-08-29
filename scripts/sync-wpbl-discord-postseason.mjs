#!/usr/bin/env node
/**
 * sync-wpbl-discord-postseason.mjs — keep the postseason watch-party events honest.
 *
 * The bracket's watch parties have to be created BEFORE anyone knows who is in them: the
 * semifinals start three days after the last regular-season game, and a Discord scheduled
 * event people can RSVP to is worth more than a correctly-titled one posted the morning of.
 * So they go up as placeholders ("Semifinal A Game 1", "Championship Game 5") and this
 * script does the three things that placeholder then needs, every few hours:
 *
 *   1. NAMES  — rewrites each one to "<round> Game N: Away vs Home" once the clubs are
 *               known, matching the "Los Angeles vs New York" shape of the regular-season
 *               events. Home/away comes from the published game row; between the last
 *               semifinal out and the league publishing the final's schedule it falls back
 *               to the two winners, and corrects itself when the real row lands.
 *   2. TIMES  — moves an event whose game has been rescheduled, which the postseason does
 *               far more than the regular season. This also keeps the board's event map
 *               matchable, since that matches on start time.
 *   3. DELETE — removes the games a clinched series will never play. A best-of-3 that goes
 *               2-0 otherwise leaves a Game 3 event sitting in the server with an RSVP
 *               list, above the games that ARE happening, and Discord will happily remind
 *               everyone about it.
 *
 * It also merges the postseason entries into scripts/wpbl-event-urls.json (the board's
 * game → event link map) rather than making someone re-run the mapper by hand mid-series.
 * The merge is additive: it writes only the entries for events it just reconciled, and
 * drops the one for an event it just deleted. It never rewrites the file wholesale, which
 * is map-wpbl-discord-events.mjs's job.
 *
 * WHY IT ONLY TOUCHES EVENTS WHOSE NAME PARSES AS A SLOT: the round and game number are
 * read back out of the event's own name (SLOT_RE), and the rename keeps that prefix in
 * front for exactly that reason. It means a regular-season watch party, a mod's AMA, any
 * event this script has never seen, cannot be renamed or deleted by it, and it means the
 * events can be deleted and recreated in Discord with no file to update. Do not "tidy" the
 * prefix out of the names.
 *
 * Usage (local, from repo root):
 *   npm run discord-postseason               # dry run: prints every change it would make
 *   npm run discord-postseason -- --apply    # actually writes to Discord
 *
 * Required env: DISCORD_BOT_TOKEN (the app must be IN the guild, with Manage Events),
 * DISCORD_GUILD_ID, SUPABASE_URL, and a Supabase key (anon is enough — reads only).
 *
 * planPostseasonSync() below is pure and exported: every decision this script makes is
 * decided there and covered by src/wpbl/__tests__/postseasonEvents.test.ts, because the
 * one action here that cannot be undone (a deleted event takes its RSVPs with it) must not
 * rest on a rule nobody can exercise without a live bracket.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * The bracket, as a fact about the season rather than something inferred. Reading the
 * series length off "how many Game N events exist" would work exactly once: the first
 * deletion shortens the list and the next run would compute a best-of-2.
 * 2026: four clubs, both semifinals best-of-3, the championship best-of-5.
 */
export const ROUNDS = Object.freeze([
  { key: 'semi-a', label: 'Semifinal A', bestOf: 3 },
  { key: 'semi-b', label: 'Semifinal B', bestOf: 3 },
  { key: 'final', label: 'Championship', bestOf: 5 },
])
const ROUND_BY_KEY = new Map(ROUNDS.map(r => [r.key, r]))

const SLOT_RE = /^\s*(?:(semifinal)\s+([ab])|(championship))\s+game\s+([1-9])\b/i

// A series is matched to the round whose Game 1 event is nearest in time. The two
// semifinals open 24 hours apart, so anything looser could hand series B's games to round
// A; assignment is greedy from the closest pair outward, so the tight one wins first.
const ROUND_MATCH_TOLERANCE_MS = 20 * 60 * 60 * 1000
// Retime an event only when the published first pitch has moved by more than this. Smaller
// drift is the feed rounding, and every PATCH re-notifies everyone who RSVP'd.
const RETIME_THRESHOLD_MS = 15 * 60 * 1000
// How far either side of the bracket's own events a game still counts as postseason.
const WINDOW_PAD_MS = 36 * 60 * 60 * 1000

const WPBL_TZ = 'America/Chicago'
const EVENT_STATUS_SCHEDULED = 1

// ─── Pure helpers ────────────────────────────────────────────────────────────

/** True UTC instant of first pitch: the feed's "H:MM AM/PM" is a flat Central wall clock. */
export function gameStartMs(gameDate, startTime) {
  if (!startTime || !gameDate) return null
  const m = String(startTime).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!m) return null
  let h = parseInt(m[1], 10) % 12
  if (/pm/i.test(m[3])) h += 12
  const [y, mo, d] = String(gameDate).split('-').map(Number)
  const naive = Date.UTC(y, mo - 1, d, h, parseInt(m[2], 10))
  const ref = new Date(naive)
  const offset = new Date(ref.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
    - new Date(ref.toLocaleString('en-US', { timeZone: WPBL_TZ })).getTime()
  return naive + offset
}

/** { roundKey, game } for an event named like a bracket slot, else null. */
export function parseSlot(name) {
  const m = SLOT_RE.exec(name ?? '')
  if (!m) return null
  const key = m[3] ? 'final' : `semi-${m[2].toLowerCase()}`
  return ROUND_BY_KEY.has(key) ? { roundKey: key, game: parseInt(m[4], 10) } : null
}

/** Both clubs of a game, order-independent, so the two ends of a series group together. */
function seriesKey(game) {
  return [game.home_team_id, game.away_team_id].sort().join('|')
}

function iso(ms) { return new Date(ms).toISOString() }

// ─── The decision ────────────────────────────────────────────────────────────

/**
 * Work out what the bracket's events should look like. Pure: takes the guild's events, the
 * whole games table and the club cities, returns the actions to run and the lines to log.
 *
 * Actions are { kind: 'delete' | 'patch' | 'link' | 'unlink' } and are already in the order
 * they should be applied.
 */
export function planPostseasonSync({ events = [], games = [], cities = new Map(), now = Date.now() } = {}) {
  const notes = []
  const actions = []
  const cityOf = id => cities.get(id) ?? id ?? '???'

  const slots = []
  for (const ev of events) {
    const slot = parseSlot(ev.name)
    if (slot) slots.push({ ...slot, ev, startMs: Date.parse(ev.scheduled_start_time) })
  }
  if (!slots.length) return { slots, actions, notes, postseasonGames: 0 }
  slots.sort((a, b) => a.startMs - b.startMs)

  // The window the bracket lives in, taken from the events themselves rather than from a
  // hardcoded date, so this still works the year the postseason moves.
  const windowFrom = slots[0].startMs - WINDOW_PAD_MS
  const windowTo = slots[slots.length - 1].startMs + WINDOW_PAD_MS

  /**
   * Postseason on POSITIVE evidence only, the same reasoning as countsInStandings(): a
   * game the feed labels in some way we do not recognise stays a regular-season game,
   * which is visibly wrong rather than invisibly wrong. The date window is positive
   * evidence too: it comes from the bracket's own events, and no regular-season game is
   * played inside it.
   */
  const withStart = games.map(g => ({ ...g, _startMs: gameStartMs(g.game_date, g.start_time) }))
  const isPostseason = g =>
    g.counts_in_standings === false
    || /post|playoff|semi|champ|final|wild|division/i.test(String(g.game_type ?? ''))
    || (g._startMs != null && g._startMs >= windowFrom && g._startMs <= windowTo)

  const postGames = withStart.filter(g => g._startMs != null && isPostseason(g))

  // Regular-season record, used only to guess who hosts when the bracket is set but the
  // league has not published the schedule yet.
  const record = new Map()
  for (const g of withStart) {
    if (isPostseason(g) || g.status !== 'final') continue
    if (g.home_score == null || g.away_score == null) continue
    const homeWon = g.home_score > g.away_score
    for (const [team, won] of [[g.home_team_id, homeWon], [g.away_team_id, !homeWon]]) {
      const r = record.get(team) ?? { w: 0, l: 0 }
      r[won ? 'w' : 'l'] += 1
      record.set(team, r)
    }
  }
  const winPct = team => {
    const r = record.get(team)
    return r && r.w + r.l ? r.w / (r.w + r.l) : 0
  }

  // ── Group the published postseason games into series, one per pair of clubs ──
  const series = new Map()
  for (const g of postGames) {
    const key = seriesKey(g)
    if (!series.has(key)) series.set(key, { key, games: [] })
    series.get(key).games.push(g)
  }
  for (const s of series.values()) {
    s.games.sort((a, b) => a._startMs - b._startMs)
    s.firstMs = s.games[0]._startMs
    s.wins = new Map()
    s.played = 0
    for (const g of s.games) {
      if (g.status !== 'final' || g.home_score == null || g.away_score == null) continue
      s.played += 1
      const winner = g.home_score > g.away_score ? g.home_team_id : g.away_team_id
      s.wins.set(winner, (s.wins.get(winner) ?? 0) + 1)
    }
    s.teams = [...new Set(s.games.flatMap(g => [g.home_team_id, g.away_team_id]))]
  }

  // ── Assign each series to a round, closest Game 1 first ──
  const game1 = new Map()
  for (const s of slots) if (s.game === 1) game1.set(s.roundKey, s.startMs)
  const pairs = []
  for (const s of series.values()) {
    for (const [roundKey, ms] of game1) pairs.push({ s, roundKey, diff: Math.abs(s.firstMs - ms) })
  }
  pairs.sort((a, b) => a.diff - b.diff)
  const roundSeries = new Map()
  const seriesRound = new Map()
  for (const { s, roundKey, diff } of pairs) {
    if (roundSeries.has(roundKey) || seriesRound.has(s.key) || diff > ROUND_MATCH_TOLERANCE_MS) continue
    roundSeries.set(roundKey, s)
    seriesRound.set(s.key, roundKey)
    const round = ROUND_BY_KEY.get(roundKey)
    notes.push(`${round.label.padEnd(13)} ← ${s.teams.map(cityOf).join(' / ')}  (${s.games.length} game row(s), ${s.played} played)`)
  }
  for (const s of series.values()) {
    if (!seriesRound.has(s.key)) {
      notes.push(`⚠️  ${s.teams.map(cityOf).join(' / ')} starting ${iso(s.firstMs)} matched no round. Left alone.`)
    }
  }

  /** The club that has already won the series, or null while it is still live. */
  const clinched = s => {
    if (!s) return null
    const bestOf = ROUND_BY_KEY.get(seriesRound.get(s.key))?.bestOf ?? 0
    if (!bestOf) return null
    const need = Math.floor(bestOf / 2) + 1
    for (const [team, w] of s.wins) if (w >= need) return { team, need }
    return null
  }

  /**
   * Who is in the championship before its schedule exists. Certain (they are the two
   * semifinal winners), unlike the seeding of the semifinals themselves, which is a format
   * guess and so is never made here. Home/away IS a guess, taken from the better
   * regular-season record, and it is overwritten the moment the league publishes the games.
   */
  let provisional = null
  if (!roundSeries.has('final')) {
    const a = clinched(roundSeries.get('semi-a'))
    const b = clinched(roundSeries.get('semi-b'))
    if (a && b && a.team !== b.team) {
      const [home, away] = [a.team, b.team].sort((x, y) => winPct(y) - winPct(x))
      provisional = { home, away }
    }
  }

  // ── Reconcile every slot ──
  for (const slot of slots) {
    const round = ROUND_BY_KEY.get(slot.roundKey)
    const label = `${round.label} Game ${slot.game}`
    const s = roundSeries.get(slot.roundKey)
    const game = s?.games[slot.game - 1] ?? null

    if (slot.ev.status !== EVENT_STATUS_SCHEDULED) {
      notes.push(`${label}: event is ${slot.ev.status === 2 ? 'live' : 'over or cancelled'}. Skipped.`)
      continue
    }

    // 1. A series that can no longer reach this game. Only a game that has not started,
    //    and only against a series we positively matched to this round.
    const decided = clinched(s)
    if (decided && slot.game > s.played && slot.startMs > now) {
      actions.push({
        kind: 'delete',
        eventId: slot.ev.id,
        label,
        why: `${cityOf(decided.team)} already has ${decided.need} win(s) in ${s.played} game(s)`,
      })
      continue
    }

    // 2. The name. From the published row when there is one, from the semifinal winners
    //    for a championship the league has not scheduled yet, and otherwise left as the
    //    placeholder: an unknown matchup is not something to invent.
    let away = null, home = null, source = ''
    if (game) {
      away = game.away_team_id
      home = game.home_team_id
      source = 'schedule'
    } else if (slot.roundKey === 'final' && provisional) {
      away = provisional.away
      home = provisional.home
      source = 'provisional (semifinal winners, host club a guess)'
    }

    const body = {}
    const desiredName = away && home ? `${label}: ${cityOf(away)} vs ${cityOf(home)}` : slot.ev.name
    if (desiredName !== slot.ev.name) body.name = desiredName

    // 3. The time. A postseason game moves, and the board's map matches on start time, so
    //    an event left behind is unfindable as well as wrong.
    if (game && Math.abs(game._startMs - slot.startMs) > RETIME_THRESHOLD_MS && game._startMs > now) {
      body.scheduled_start_time = iso(game._startMs)
      // An event carrying an end time must keep it after the start: shift it the same way.
      if (slot.ev.scheduled_end_time) {
        body.scheduled_end_time = iso(Date.parse(slot.ev.scheduled_end_time) + (game._startMs - slot.startMs))
      }
    }

    if (Object.keys(body).length) {
      actions.push({ kind: 'patch', eventId: slot.ev.id, label, body, source, was: slot.ev.name })
    }

    // 4. The board's link for this game, so a series does not wait on someone re-running
    //    the mapper by hand.
    if (game?.api_game_id) {
      actions.push({ kind: 'link', eventId: slot.ev.id, label, gameId: game.api_game_id })
    }
  }

  return { slots, actions, notes, postseasonGames: postGames.length }
}

// ─── I/O ─────────────────────────────────────────────────────────────────────

const MAP_PATH = join(HERE, 'wpbl-event-urls.json')

/**
 * The /events/ form rather than an invite: an invite carries a scheduled event only while
 * the invite's channel IS the event's channel, and the watch parties have already moved
 * channels once mid-season, which silently stripped the event off every link on the board.
 * A guild event link survives that.
 */
const eventUrl = (guildId, eventId) => `https://discord.com/events/${guildId}/${eventId}`

async function main() {
  const APPLY = process.argv.includes('--apply')
  const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
    ?? process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''
  const BOT_TOKEN = (process.env.DISCORD_BOT_TOKEN ?? '').trim()
  const GUILD_ID = (process.env.DISCORD_GUILD_ID ?? '').trim()

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌  Set SUPABASE_URL (or VITE_SUPABASE_URL) and a Supabase key (VITE_SUPABASE_ANON_KEY)')
    process.exit(1)
  }
  if (!BOT_TOKEN || !GUILD_ID) {
    console.error('❌  Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID. Scheduled events have no public write API.')
    process.exit(1)
  }

  const { createClient } = await import('@supabase/supabase-js')
  const { default: ws } = await import('ws')
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  })

  async function discord(path, init = {}) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`https://discord.com/api/v10${path}`, {
        ...init,
        headers: {
          Authorization: `Bot ${BOT_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'wpbl-postseason-sync/1.0',
          ...(init.headers ?? {}),
        },
      })
      if (res.status === 429) {
        const retryAfter = Number((await res.json().catch(() => ({}))).retry_after ?? 1)
        await new Promise(r => setTimeout(r, Math.ceil(retryAfter * 1000) + 250))
        continue
      }
      if (!res.ok) {
        // A 403 here is almost always the one setup step that is invisible from the code:
        // LISTING a guild's scheduled events needs nothing special, so a token that can
        // read the whole bracket fine still cannot rename or delete any of it.
        const hint = res.status === 403 ? ' (does the bot role have Manage Events?)' : ''
        throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}${hint}: ${await res.text()}`)
      }
      return res.status === 204 ? null : res.json()
    }
    throw new Error(`${init.method ?? 'GET'} ${path} → rate limited four times running`)
  }

  /**
   * Every game, paged. A bare .select() stops at 1000 rows with no error, and this one
   * feeds both the series win counts and each club's regular-season record, so a silent
   * prefix would decide a series that is still being played (see CLAUDE.md).
   */
  async function fetchAllGames() {
    const out = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('wpbl_games')
        .select('api_game_id, game_date, start_time, status, game_type, counts_in_standings, home_team_id, away_team_id, home_score, away_score')
        .order('game_date', { ascending: true })
        .order('start_time', { ascending: true })
        .order('api_game_id', { ascending: true })
        .range(from, from + 999)
      if (error) throw new Error(`Loading games failed: ${error.message}`)
      out.push(...(data ?? []))
      if ((data?.length ?? 0) < 1000) return out
    }
  }

  console.log(APPLY
    ? '\n⚾ WPBL postseason event sync (APPLY)\n'
    : '\n⚾ WPBL postseason event sync (dry run: pass --apply to write)\n')

  const events = await discord(`/guilds/${GUILD_ID}/scheduled-events`)
  const games = await fetchAllGames()
  const { data: teams, error: tErr } = await supabase.from('wpbl_teams').select('id, city')
  if (tErr) throw new Error(`Loading teams failed: ${tErr.message}`)
  const cities = new Map((teams ?? []).map(t => [t.id, t.city]))

  const plan = planPostseasonSync({ events, games, cities })
  console.log(`Found ${plan.slots.length} postseason event(s) among ${events.length} in the guild.`)
  console.log(`${plan.postseasonGames} postseason game row(s) published so far.`)
  for (const note of plan.notes) console.log(`   ${note}`)
  if (!plan.slots.length) return

  const urlMap = (() => {
    try { return JSON.parse(readFileSync(MAP_PATH, 'utf8')) } catch { return {} }
  })()
  let mapDirty = false
  const counts = { delete: 0, patch: 0 }

  for (const action of plan.actions) {
    if (action.kind === 'delete') {
      console.log(`\n🗑  ${action.label}: ${action.why}. Deleting the event.`)
      if (APPLY) await discord(`/guilds/${GUILD_ID}/scheduled-events/${action.eventId}`, { method: 'DELETE' })
      counts.delete += 1
      for (const [gameId, url] of Object.entries(urlMap)) {
        if (url.includes(action.eventId)) { delete urlMap[gameId]; mapDirty = true }
      }
    } else if (action.kind === 'patch') {
      if (action.body.name) console.log(`\n✏️  ${action.label}: "${action.was}" → "${action.body.name}"  [${action.source}]`)
      if (action.body.scheduled_start_time) console.log(`\n🕑 ${action.label}: start → ${action.body.scheduled_start_time}`)
      if (APPLY) {
        await discord(`/guilds/${GUILD_ID}/scheduled-events/${action.eventId}`, {
          method: 'PATCH',
          body: JSON.stringify(action.body),
        })
      }
      counts.patch += 1
    } else if (action.kind === 'link') {
      const url = eventUrl(GUILD_ID, action.eventId)
      if (urlMap[action.gameId] !== url) {
        urlMap[action.gameId] = url
        mapDirty = true
        console.log(`\n🔗 ${action.label}: board link for ${action.gameId}`)
      }
    }
  }

  if (mapDirty) {
    if (APPLY) writeFileSync(MAP_PATH, JSON.stringify(urlMap, null, 2) + '\n')
    console.log(`\n💾 ${APPLY ? 'Wrote' : 'Would write'} ${Object.keys(urlMap).length} mapping(s) to ${MAP_PATH}`)
  }

  console.log(`\n${APPLY ? '✅' : '📝'} ${counts.patch} update(s), ${counts.delete} deletion(s).`
    + `${APPLY ? '' : ' Nothing written: re-run with --apply.'}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}

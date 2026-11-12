/**
 * Watches the league's Instagram and the four clubs' for 2027 re-signings, records every post,
 * and sends each re-signing to Discord once.
 *
 * WHY INSTAGRAM. The league announces re-signings there and nowhere else: the feed has no
 * transactions endpoint, and there is no press release. The first two (Ashton Lansdell, Nov 10,
 * and Alexia Jorge, Nov 11, 2026) were posted by the CLUB accounts, not wpbl_official, which is
 * why all five are read. A collab post shows on both grids but the API lists it only under the
 * account that made it.
 *
 * HOW. Meta's Business Discovery API: a professional Instagram account we own may read the
 * public posts of any other professional account. One call per account per run. It needs a
 * user token from our "wpbl watcher" Meta app with instagram_basic, instagram_manage_insights,
 * pages_read_engagement and pages_show_list; without instagram_manage_insights every call
 * answers "(#10) Application does not have permission", which reads like an app-review problem
 * and is not one. Stories are not in any API, so a re-signing posted only as a story is missed.
 *
 * THE TOKEN LAPSES. A long-lived user token says "expires never", but Meta withdraws its data
 * access 90 days after the owner last approved the app (data_access_expires_at). The run reads
 * that date every time and warns in Discord, once a day, from a week before. The fix is to
 * generate a new token in the Graph API Explorer, extend it, and replace META_ACCESS_TOKEN.
 *
 * WHAT COUNTS AS A RE-SIGNING. Re-signing wording AND a rostered player's full name. Wording
 * alone is not enough: the league's "Who do you hope to see re-signed??" has it and names
 * nobody. A name alone is not enough either: every birthday post has one. Banana Ball signings
 * ("signed with the Party Animals for 2027") are a different league and are refused outright.
 * Every post is stored either way (kind 'other'), so a matcher that missed one can be fixed and
 * re-run over the rows instead of a feed that only serves the latest posts.
 *
 * IT WRITES THE ROSTERS. A re-signing goes into wpbl_roster_moves, which Home's rosters card and
 * the rosters page read, so it is on the site within the edge cache's slow window. Until Nov 11,
 * 2026 those rows were entered by hand from /admin, and that path stays: anything the rules in
 * plannedMoves refuse is announced with the reason, for a person to record or ignore, and a wrong
 * row is deleted from /admin the same way.
 *
 * Usage:
 *   npm run instagram-watch                 # read, record, announce what is due
 *   npm run instagram-watch -- --dry-run    # read and classify; writes nothing, posts nothing
 *   npm run instagram-watch -- --test-post  # post a sample to the webhook, then stop
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, META_ACCESS_TOKEN, META_IG_USER_ID
 * (our own professional account's Instagram id, the 17-digit one starting 1784, not the
 * Facebook Page's id).
 *   DISCORD_RESIGN_WEBHOOK_URL  where re-signings go. Falls back to DISCORD_ALERTS_WEBHOOK_URL
 *                               so the job is useful before its own channel exists.
 *   DISCORD_RESIGN_MENTION      optional user or role mention, e.g. "<@123…>".
 */

import { createClient } from '@supabase/supabase-js'
// supabase-js builds a realtime client even though nothing here subscribes, and needs `ws`
// handed to it outside a browser. Same line, same reason, as the sibling cron scripts.
import ws from 'ws'
import { pathToFileURL } from 'node:url'
import { runWithHeartbeat } from '../shared/heartbeat.js'
// The league's own 2026 rosters and the window, from the module the rosters page draws with.
// Imported, not copied: a re-signing the watcher records and the page then ignores (a player
// it thinks is on another club) would be a row on the site that shows nowhere. Node 24 strips
// the types itself; the module has no runtime imports, so nothing else comes with it.
import { ROSTERS_2026, ROSTER_SEASON, RESIGN_WINDOW, MAX_RESIGNED, club2026 } from '../src/wpbl/offseason2027.ts'

// Run only when invoked directly; the tests import the matcher and the message builder.
const IS_ENTRYPOINT = process.argv[1] != null
  && import.meta.url === pathToFileURL(process.argv[1]).href

// ─── Config ─────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')
const TEST_POST = args.has('--test-post')

// A dry run only reads wpbl_players, which every visitor can read, so it falls back to the
// anon key and works from a laptop whose .env has no service-role key.
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || (DRY_RUN ? process.env.VITE_SUPABASE_ANON_KEY : '') || ''
const TOKEN = (process.env.META_ACCESS_TOKEN ?? '').trim()
const IG_USER_ID = (process.env.META_IG_USER_ID ?? '').trim()
const WEBHOOK = (process.env.DISCORD_RESIGN_WEBHOOK_URL || process.env.DISCORD_ALERTS_WEBHOOK_URL || '').trim()
const MENTION = (process.env.DISCORD_RESIGN_MENTION ?? '').trim()

// Pinned rather than "latest": Meta retires a version two years after release and changes
// field behavior between them, and a silent change in what business_discovery returns is the
// one failure this job could not notice by itself.
const GRAPH = 'https://graph.facebook.com/v27.0'

/**
 * Whose posts are read, and which club each one speaks for. The handles were found by asking
 * Business Discovery directly (Nov 11, 2026); `thelaqueens` is an unrelated account with
 * sixteen followers, which is why a guessed handle is never good enough here.
 */
export const ACCOUNTS = [
  { handle: 'wpbl_official', team_id: null },
  { handle: 'wpbl_hunters', team_id: 'BOS' },
  { handle: 'wpbl_queens', team_id: 'LA' },
  { handle: 'wpbl_heights', team_id: 'NY' },
  { handle: 'wpbl_firebells', team_id: 'SF' },
]

// Copied from src/wpbl/constants.ts rather than imported: that module pulls in logo images
// and is client code. Four names that have not changed since July.
export const TEAM_NAMES = {
  BOS: 'Boston Hunters', LA: 'Los Angeles Queens', NY: 'New York Heights', SF: 'San Francisco Firebells',
}

// Twenty-five per account per run. Runs are fifteen minutes apart and the busiest account
// posts a few times a day, so this is the whole gap with room for a day of missed runs.
const PER_ACCOUNT = 25

// A re-signing older than this is recorded but never announced. Seven days covers the whole
// first run (which reads back past both Nov 10 and 11) without replaying a stale backlog if
// the job is ever re-pointed at a new account.
const STALE_DAYS = 7

// Six hours blind before saying so, the same threshold as the mention and shop watchers.
const ERROR_QUIET_HOURS = 6

// Warn about the token this long before its data access lapses, and no oftener than this.
const TOKEN_WARN_DAYS = 7
const TOKEN_WARN_EVERY_HOURS = 20

const FETCH_TIMEOUT_MS = 20_000

const supabase = SUPABASE_URL && SERVICE_KEY
  ? createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
    realtime: { transport: ws },
  })
  : null

export const hoursSince = (iso, now = Date.now()) =>
  iso ? (now - new Date(iso).getTime()) / 3_600_000 : Infinity

// ─── Matching ───────────────────────────────────────────────────────────────

/**
 * Lowercase, accents off, and everything that is not a letter or digit removed. A caption
 * tags a player by handle ("Captain ashtonlansdell is running it back") as often as by name,
 * and the folded handle and folded name are the same string.
 */
export const fold = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '')

// Each tested on the caption with curly apostrophes straightened and case folded.
const RESIGN_WORDING = [
  /\bre-?sign(ed|ing|s)?\b/,
  /\brunning it back\b/,
  /\b(is|are|will be) (back|returning)\b/,
  /\breturns? (to|with|for)\b/,
]

// A different league's contracts, announced by the same accounts in the same words
// ("Denae is returning to Bananaland!"). Refused whatever else the caption says.
const NOT_OURS = /\bbanana ?(ball|land)|bananaland|world tour\b/

/**
 * Builds the name index once per run: folded full name to the players who carry it. Names
 * shorter than eight folded letters are left out, since a short one could sit inside a longer
 * word of the folded caption.
 */
export function playerIndex(players) {
  const byName = new Map()
  for (const p of players) {
    const key = fold(p.name)
    if (key.length < 8) continue
    const entry = byName.get(key) ?? { name: p.name, ids: [] }
    entry.ids.push(p.id)
    byName.set(key, entry)
  }
  // One id per name. wpbl_players can hold two rows for one person until they are merged, and
  // the one on the league's 2026 list is the one the rosters page knows.
  for (const entry of byName.values()) {
    entry.id = entry.ids.find(id => ROSTER_IDS.has(id)) ?? entry.ids[0]
  }
  return byName
}

/**
 * 'resign' with the players it names, or 'other'. Pure, and the reason the tests exist.
 */
export function classifyCaption(caption, index) {
  const text = String(caption ?? '').replace(/[‘’]/g, "'").toLowerCase()
  const none = { kind: 'other', player_ids: [], player_names: [] }
  if (!text || NOT_OURS.test(text)) return none
  if (!RESIGN_WORDING.some(re => re.test(text))) return none
  const folded = fold(text)
  const named = [...index.entries()].filter(([key]) => folded.includes(key)).map(([, v]) => v)
  if (!named.length) return none
  return {
    kind: 'resign',
    player_ids: named.map(n => n.id),
    player_names: named.map(n => n.name),
  }
}

/** Every player on a 2026 roster, by id. A re-signing can only be of one of these. */
export const ROSTER_IDS = new Set(Object.values(ROSTERS_2026).flat())

/** The post's day in the league's time zone, which is the day the rosters page shows. */
export const etDate = (iso) =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

/**
 * The wpbl_roster_moves rows a re-signing post earns, and why any named player got none.
 *
 * The rosters on Home and the rosters page read that table, so a row here is public the moment
 * it is written. Each rule below is a way a right-looking caption could still put a wrong name on
 * the site, and a player who fails one is announced in Discord for a person to record by hand:
 *   - the post falls outside the re-signing window (a "running it back" in March is something else);
 *   - the player is not on a 2026 roster, or not on the posting club's (the league account may post
 *     for any club, a club only for its own);
 *   - the player is already recorded (by hand, or by an earlier run);
 *   - the club already has its ten.
 * Pure: `existing` is this season's re-signings, passed in so the tests need no database.
 */
export function plannedMoves(row, existing) {
  const moves = []
  const skipped = []
  const already = []
  const at = Date.parse(row.posted_at)
  const inWindow = at >= RESIGN_WINDOW.opens && at <= RESIGN_WINDOW.closes
  const counts = {}
  for (const m of existing) counts[m.team_id] = (counts[m.team_id] ?? 0) + 1
  row.player_ids.forEach((id, i) => {
    const name = row.player_names[i] ?? id
    const team = club2026(id)
    if (existing.some(m => m.player_id === id)) return already.push(name)
    if (!inWindow) return skipped.push(`${name}: posted outside the re-signing window`)
    if (!team) return skipped.push(`${name}: not on a 2026 roster`)
    if (row.team_id && row.team_id !== team) return skipped.push(`${name}: on ${team}'s 2026 roster, posted by ${row.account}`)
    if ((counts[team] ?? 0) >= MAX_RESIGNED) return skipped.push(`${name}: ${team} already has ${MAX_RESIGNED}`)
    counts[team] = (counts[team] ?? 0) + 1
    moves.push({
      season: ROSTER_SEASON,
      kind: 're-signed',
      player_id: id,
      player_name: null,
      team_id: team,
      announced_on: etDate(row.posted_at),
      source_url: row.permalink,
    })
  })
  return { moves, skipped, already }
}

/** The account's posts as table rows, classified. Pure. */
export function toRows(account, media, index) {
  return media.map(m => ({
    media_id: m.id,
    account: account.handle,
    team_id: account.team_id,
    permalink: m.permalink,
    caption: m.caption ?? null,
    media_type: m.media_type ?? null,
    posted_at: m.timestamp,
    ...classifyCaption(m.caption, index),
  }))
}

// ─── Messages ───────────────────────────────────────────────────────────────

/**
 * One line per player and the link. Discord unfurls an Instagram permalink into the photo,
 * so the post itself does the rest. Labels, not narration (the house rule for copy).
 */
export function resignMessage(row, { recorded = [], skipped = [], already = [] } = {}) {
  const team = row.team_id ? TEAM_NAMES[row.team_id] : null
  const names = row.player_names.join(', ')
  const lines = [`✍️ **Re-signed: ${names}**${team ? `, ${team}` : ''}`]
  if (recorded.length) lines.push(`Added to the 2027 rosters: ${recorded.join(', ')}`)
  if (already.length) lines.push(`Already on the 2027 rosters: ${already.join(', ')}`)
  // Said plainly, because each of these is a re-signing the site does not show until a person
  // records it from /admin (or confirms it was already there).
  if (skipped.length) lines.push(`Not added: ${skipped.join('; ')}`)
  lines.push(row.permalink)
  return lines.join('\n')
}

export function tokenWarning(daysLeft) {
  const when = daysLeft <= 0 ? 'has lapsed' : `lapses in ${Math.ceil(daysLeft)} day${Math.ceil(daysLeft) === 1 ? '' : 's'}`
  return `⚠️ Instagram watcher: the Meta token's data access ${when}. Generate a new token in the Graph API Explorer (wpbl watcher app), extend it in the Access Token Debugger, and replace META_ACCESS_TOKEN in GitHub secrets.`
}

// ─── I/O ────────────────────────────────────────────────────────────────────

async function graph(path) {
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${GRAPH}/${path}${sep}access_token=${encodeURIComponent(TOKEN)}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  const body = await res.json().catch(() => ({}))
  // Meta's error text never contains the token, so it is safe to log and store.
  if (body.error) throw new Error(`${body.error.code ?? res.status}: ${body.error.message}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return body
}

async function readAccount(handle) {
  const fields = `business_discovery.username(${handle}){media.limit(${PER_ACCOUNT}){id,caption,timestamp,permalink,media_type}}`
  const body = await graph(`${IG_USER_ID}?fields=${encodeURIComponent(fields)}`)
  return body.business_discovery?.media?.data ?? []
}

/** Days until the token's data access lapses, or null if Meta will not say. */
async function tokenDaysLeft() {
  const body = await graph(`debug_token?input_token=${encodeURIComponent(TOKEN)}`)
  const at = body.data?.data_access_expires_at
  return at ? (at * 1000 - Date.now()) / 86_400_000 : null
}

async function post(content, mention = '') {
  if (DRY_RUN) {
    console.log(`\n─── would post ───\n${content}\n──────────────────\n`)
    return
  }
  if (!WEBHOOK) { console.warn('⚠️   No webhook configured; skipping.'); return }
  const res = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: mention ? `${mention}\n${content}` : content,
      // Only the configured mention may ping. A caption can carry "@everyone" as text, and a
      // webhook would otherwise honor it.
      allowed_mentions: mention ? { parse: ['users', 'roles'] } : { parse: [] },
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text().catch(() => '')}`)
}

// "Every row" needs paging and an order: PostgREST stops at 1000 without saying so.
async function loadPlayers() {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('wpbl_players')
      .select('id, name').order('id').range(from, from + 999)
    if (error) throw new Error(`Loading players: ${error.message}`)
    rows.push(...data)
    if (data.length < 1000) return rows
  }
}

async function knownIds(ids) {
  if (!ids.length) return new Set()
  const { data, error } = await supabase.from('wpbl_instagram_posts').select('media_id').in('media_id', ids)
  if (error) throw new Error(`Reading known posts: ${error.message}`)
  return new Set(data.map(r => r.media_id))
}

async function recordRun(row) {
  if (DRY_RUN) return
  const { error } = await supabase.from('wpbl_instagram_watch_runs').insert(row)
  if (error) console.error(`   Could not record the run: ${error.message}`)
}

async function lastGoodRun() {
  const { data } = await supabase.from('wpbl_instagram_watch_runs')
    .select('ran_at').eq('ok', true).order('ran_at', { ascending: false }).limit(1)
  return data?.[0] ?? null
}

async function warnedRecently() {
  const since = new Date(Date.now() - TOKEN_WARN_EVERY_HOURS * 3_600_000).toISOString()
  const { data } = await supabase.from('wpbl_instagram_watch_runs')
    .select('id').eq('token_warned', true).gte('ran_at', since).limit(1)
  return Boolean(data?.length)
}

// ─── Run ────────────────────────────────────────────────────────────────────

async function main() {
  if (TEST_POST) {
    await post(resignMessage({
      team_id: 'LA', player_names: ['Test Player'], permalink: 'https://www.instagram.com/wpbl_queens/',
    }) + '\n_Test post from the Instagram watcher._', MENTION)
    console.log('Test post sent.')
    return
  }
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
  if (!TOKEN || !IG_USER_ID) throw new Error('META_ACCESS_TOKEN and META_IG_USER_ID are required.')

  const index = playerIndex(await loadPlayers())
  const rows = []
  const errors = []
  for (const account of ACCOUNTS) {
    try {
      rows.push(...toRows(account, await readAccount(account.handle), index))
    } catch (e) {
      errors.push(`${account.handle}: ${e.message}`)
    }
  }
  console.log(`Read ${rows.length} posts from ${ACCOUNTS.length - errors.length} of ${ACCOUNTS.length} accounts.`)
  for (const e of errors) console.error(`   ${e}`)

  if (errors.length === ACCOUNTS.length) {
    // Every account failing is a token or app problem, not five outages at once. Said out loud
    // once it has lasted six hours; exit 0 either way, since a red X every fifteen minutes
    // teaches everyone to ignore the job.
    const blindFor = DRY_RUN ? 0 : hoursSince((await lastGoodRun())?.ran_at)
    if (blindFor >= ERROR_QUIET_HOURS) {
      await post(`⚠️ Instagram watcher has read nothing for six hours.\n\`${errors[0].slice(0, 300)}\``)
        .catch(e => console.error(`   Could not post the outage notice either: ${e.message}`))
    }
    await recordRun({ ok: false, error: errors.join(' | ').slice(0, 500) })
    // Red on /admin (and a page) only past the same six hours: a short Meta outage heals itself.
    return { ok: blindFor < ERROR_QUIET_HOURS, detail: `No account readable: ${errors[0]}` }
  }

  const known = DRY_RUN ? new Set() : await knownIds(rows.map(r => r.media_id))
  const fresh = rows.filter(r => !known.has(r.media_id))
  const resigns = rows.filter(r => r.kind === 'resign')
  console.log(`New: ${fresh.length}. Re-signings in view: ${resigns.length}.`)
  for (const r of resigns) console.log(`   ${r.posted_at.slice(0, 10)} ${r.account}: ${r.player_names.join(', ')}`)

  // Recorded before anything is announced. A crash between the two delays an alert; the other
  // order could send one twice.
  if (!DRY_RUN && rows.length) {
    // Upsert so an edited caption is re-read and re-classified. seen_at and announced_at are not
    // in the payload, so the conflict path leaves them alone.
    const { error } = await supabase.from('wpbl_instagram_posts').upsert(rows, { onConflict: 'media_id' })
    if (error) throw new Error(`Saving posts: ${error.message}`)
  }

  const cutoff = new Date(Date.now() - STALE_DAYS * 86_400_000).toISOString()
  let due = resigns.filter(r => r.posted_at >= cutoff)
  if (!DRY_RUN) {
    const { data, error } = await supabase.from('wpbl_instagram_posts')
      .select('media_id, account, team_id, permalink, player_ids, player_names, posted_at')
      .eq('kind', 'resign').is('announced_at', null).gte('posted_at', cutoff)
      .order('posted_at', { ascending: true })
    if (error) throw new Error(`Reading the queue: ${error.message}`)
    due = data
  }

  // This season's re-signings, read once and grown as the loop records more, so two posts about
  // one player in a run record one row.
  const existing = []
  {
    const { data, error } = await supabase.from('wpbl_roster_moves')
      .select('player_id, team_id').eq('season', ROSTER_SEASON).eq('kind', 're-signed')
    if (error) throw new Error(`Reading roster moves: ${error.message}`)
    existing.push(...data)
  }

  let announced = 0
  for (const row of due) {
    const { moves, skipped, already } = plannedMoves(row, existing)
    if (moves.length && !DRY_RUN) {
      // A plain insert, not an upsert: the unique index on (season, kind, player_id) is partial,
      // which PostgREST's on_conflict cannot name. `existing` already rules out the duplicate.
      const { error } = await supabase.from('wpbl_roster_moves').insert(moves)
      if (error) throw new Error(`Recording ${row.player_names.join(', ')}: ${error.message}`)
    }
    existing.push(...moves)
    const byId = new Map(row.player_ids.map((id, i) => [id, row.player_names[i]]))
    await post(resignMessage(row, { recorded: moves.map(m => byId.get(m.player_id)), skipped, already }), MENTION)
    if (!DRY_RUN) {
      // One at a time, so a webhook failure halfway leaves the rest queued, not lost.
      const { error } = await supabase.from('wpbl_instagram_posts')
        .update({ announced_at: new Date().toISOString() }).eq('media_id', row.media_id)
      if (error) throw new Error(`Marking ${row.media_id} announced: ${error.message}`)
    }
    announced++
  }
  if (announced) console.log(`Announced ${announced}.`)

  let token_warned = false
  try {
    const days = await tokenDaysLeft()
    if (days != null) console.log(`Token data access: ${days.toFixed(1)} days left.`)
    if (days != null && days <= TOKEN_WARN_DAYS && (DRY_RUN || !(await warnedRecently()))) {
      await post(tokenWarning(days), MENTION)
      token_warned = true
    }
  } catch (e) {
    console.error(`   Could not read the token's expiry: ${e.message}`)
  }

  await recordRun({
    ok: true,
    seen: rows.length,
    new_posts: fresh.length,
    announced,
    token_warned,
    error: errors.length ? errors.join(' | ').slice(0, 500) : null,
  })
  if (DRY_RUN) console.log('\nDry run: nothing written, nothing sent.')
  return { detail: `${rows.length} posts, ${announced} re-signing${announced === 1 ? '' : 's'} announced` }
}

if (IS_ENTRYPOINT) {
  runWithHeartbeat(supabase, 'wpbl-instagram-watch', main, { skip: DRY_RUN || TEST_POST || !process.env.SUPABASE_SERVICE_ROLE_KEY }).catch(err => {
    console.error(`❌  ${err?.stack ?? err}`)
    process.exit(1)
  })
}

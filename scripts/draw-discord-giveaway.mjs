#!/usr/bin/env node
/**
 * draw-discord-giveaway.mjs — freeze a giveaway entry list, then draw (and re-draw) from it.
 *
 * Two steps, deliberately separate:
 *
 *   1. FREEZE — the moment you hit the member count, snapshot everyone who reacted with the
 *      entry emoji to a local file. That file is the entry list. Reactions added after this
 *      never count, and reactions removed after this don't take anyone out.
 *   2. DRAW — pick a winner from the frozen file. Run it again and it draws a *replacement*:
 *      anyone already drawn is excluded automatically, so an unresponsive winner just means
 *      running the same command again. Every draw is appended to the file's history.
 *
 * It only READS Discord. Nothing is posted, no reaction is touched — winners are printed
 * here for you to announce yourself.
 *
 * Usage:
 *   # See which reactions are on the message (gives you the exact --emoji to pass)
 *   npm run giveaway -- <message-link>
 *
 *   # At 500 members: freeze the entry list
 *   npm run giveaway -- <message-link> --emoji wpbl_pride:123456789 --freeze
 *
 *   # Draw a winner from the frozen list
 *   npm run giveaway -- --draw
 *
 *   # Winner never replied? Same command again — they're excluded, someone else is drawn
 *   npm run giveaway -- --draw
 *
 *   # See the frozen list and every draw so far
 *   npm run giveaway -- --status
 *
 * The message link is Discord's "Copy Message Link" (right-click the message). Instead of a
 * link you can pass --channel <id> --message <id>.
 *
 * Flags:
 *   --freeze           Snapshot the reactors to the pool file. This is the entry deadline.
 *   --draw             Draw from the frozen pool, excluding anyone drawn before.
 *   --status           Print the frozen pool and the draw history. Changes nothing.
 *   --emoji <e>        Entry reaction: unicode (🎉) or custom as name:id. Freeze only.
 *   --winners <n>      How many to draw this time (default 1).
 *   --exclude <ids>    Comma-separated user ids to hold out (staff, yourself, the sponsor).
 *   --pool <path>      Pool file (default giveaway-data/pool.json).
 *   --refreeze         Overwrite an existing pool file. Refused without this, on purpose.
 *
 * Required env: DISCORD_BOT_TOKEN. Optional: DISCORD_GUILD_ID (used to drop reactors who
 * already left; also read out of the message link when you pass one).
 *
 * The bot must be IN the server and able to see the channel — "View Channel" plus "Read
 * Message History". No privileged intents, no gateway, just REST.
 *
 * The pool file holds hundreds of real usernames and user ids, so it is written to
 * giveaway-data/, which is gitignored. Don't move it somewhere this public repo tracks.
 */

import { randomInt } from 'node:crypto'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const BOT_TOKEN = (process.env.DISCORD_BOT_TOKEN ?? '').trim()
const API = 'https://discord.com/api/v10'

// ─── Args ───────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const flag = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const has = (name) => argv.includes(`--${name}`)

const link = argv.find((a) => a.startsWith('http'))
// .../channels/<guild>/<channel>/<message> — the guild slot is "@me" in a DM, hence [^/]+.
const parts = link?.match(/channels\/([^/]+)\/(\d+)\/(\d+)/)

const GUILD_ID   = (flag('guild')   || parts?.[1] || process.env.DISCORD_GUILD_ID || '').trim()
const CHANNEL_ID = (flag('channel') || parts?.[2] || '').trim()
const MESSAGE_ID = (flag('message') || parts?.[3] || '').trim()
const EMOJI      = flag('emoji')
const WINNERS    = Math.max(1, Number(flag('winners', '1')) || 1)
const EXCLUDE    = new Set(flag('exclude').split(',').map((s) => s.trim()).filter(Boolean))
const POOL_FILE  = flag('pool') || 'giveaway-data/pool.json'

const FREEZE = has('freeze')
const DRAW   = has('draw')
const STATUS = has('status')

if (!BOT_TOKEN) {
  console.error('❌  Set DISCORD_BOT_TOKEN (Developer Portal → your app → Bot → Reset Token).')
  process.exit(1)
}

// ─── Discord REST ───────────────────────────────────────────────────────────

/**
 * One GET, with the one retry that actually matters here: 429. Walking a few hundred
 * reactors is enough calls to hit the bucket limit, and Discord tells us exactly how long
 * to wait, so honour it rather than failing the freeze halfway through.
 */
async function discord(path, { allow404 = false } = {}) {
  for (;;) {
    const res = await fetch(`${API}${path}`, { headers: { authorization: `Bot ${BOT_TOKEN}` } })
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after') ?? 1)
      await new Promise((r) => setTimeout(r, (retry + 0.1) * 1000))
      continue
    }
    if (res.status === 404 && allow404) return null
    if (!res.ok) {
      // Discord's errors are specific and worth reading verbatim: 401 = bad token,
      // 403 = the bot can't see that channel, 10004/10008 = it isn't in the server or
      // the message id is wrong.
      throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`)
    }
    return res.json()
  }
}

/** Custom emoji are addressed as name:id; unicode just needs percent-encoding. */
const emojiPath = (e) => encodeURIComponent(e.replace(/^:|:$/g, ''))

/** Every user who used one reaction, 100 at a time (Discord's page size). */
async function fetchReactors(emoji) {
  const out = []
  let after = ''
  for (;;) {
    const page = await discord(
      `/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}/reactions/${emojiPath(emoji)}`
      + `?limit=100${after ? `&after=${after}` : ''}`,
    )
    out.push(...page)
    if (page.length < 100) break
    after = page[page.length - 1].id
  }
  return out
}

// ─── Pool file ──────────────────────────────────────────────────────────────

const readPool = () => {
  if (!existsSync(POOL_FILE)) {
    console.error(`❌  No frozen pool at ${POOL_FILE}. Run --freeze first.`)
    process.exit(1)
  }
  return JSON.parse(readFileSync(POOL_FILE, 'utf8'))
}
const writePool = (pool) => {
  mkdirSync(dirname(POOL_FILE), { recursive: true })
  writeFileSync(POOL_FILE, `${JSON.stringify(pool, null, 2)}\n`)
}

const slim = (u) => ({ id: u.id, username: u.username, global_name: u.global_name ?? null })
const label = (u) => (u.global_name ? `${u.global_name} (@${u.username})` : `@${u.username}`)

// ─── Modes ──────────────────────────────────────────────────────────────────

/** No mode flag: show what's on the message so you can pick the right --emoji. */
async function listReactions() {
  const message = await discord(`/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}`)
  console.log(`\n"${(message.content ?? '').replace(/\s+/g, ' ').slice(0, 100)}…"\n`)
  const reactions = message.reactions ?? []
  if (!reactions.length) { console.log('No reactions on this message.\n'); return }
  console.log('Reactions:')
  for (const r of reactions) {
    const e = r.emoji.id ? `${r.emoji.name}:${r.emoji.id}` : r.emoji.name
    console.log(`  ${String(r.count).padStart(4)}  ${r.emoji.name}   --emoji '${e}'`)
  }
  console.log('\nRe-run with --emoji <e> --freeze to lock the entry list in.\n')
}

async function freeze() {
  if (existsSync(POOL_FILE) && !has('refreeze')) {
    // Silently overwriting would destroy the frozen list — the one thing this file exists
    // to protect — and take the draw history with it.
    const old = JSON.parse(readFileSync(POOL_FILE, 'utf8'))
    console.error(`❌  ${POOL_FILE} already holds a pool frozen at ${old.frozenAt}`)
    console.error(`    (${old.entrants.length} entrants, ${old.draws.length} draw(s) so far).`)
    console.error('    Re-freezing replaces the entry list and wipes the draw history.')
    console.error('    If that is really what you want: --refreeze')
    process.exit(1)
  }

  console.log(`\nFreezing ${EMOJI} on message ${MESSAGE_ID}…`)
  const reactors = await fetchReactors(EMOJI)
  console.log(`  ${reactors.length} reacted`)

  const rejected = []
  let entrants = []
  for (const u of reactors) {
    if (u.bot) { rejected.push({ ...slim(u), why: 'bot' }); continue }
    if (EXCLUDE.has(u.id)) { rejected.push({ ...slim(u), why: 'excluded' }); continue }
    entrants.push(slim(u))
  }

  // Preflight: if the bot can't see the guild at all, every member lookup below 404s and
  // the "still a member" check would silently reject every single entrant. Establish that
  // the guild is reachable FIRST, and skip the check rather than emptying the pool.
  const guild = GUILD_ID
    ? await discord(`/guilds/${GUILD_ID}?with_counts=true`, { allow404: true })
    : null
  if (GUILD_ID && !guild) {
    console.log(`  ⚠️  can't read guild ${GUILD_ID} — is the bot actually in the server?`)
    console.log('      Skipping the "still a member" check; entrants kept as-is.')
  }

  // Someone who already left can't be given anything, so drop them at freeze time rather
  // than discovering it when you go to DM the winner.
  if (guild) {
    process.stdout.write(`  checking ${entrants.length} are still in the server…`)
    const here = []
    for (const u of entrants) {
      const member = await discord(`/guilds/${GUILD_ID}/members/${u.id}`, { allow404: true })
      if (member) here.push(u)
      else rejected.push({ ...u, why: 'left the server' })
    }
    entrants = here
    console.log(' done')
  } else if (!GUILD_ID) {
    console.log('  ⚠️  no DISCORD_GUILD_ID — skipping the "still a member" check')
  }

  for (const r of rejected) console.log(`  – ${label(r)} — ${r.why}`)
  if (!entrants.length) { console.error('\n❌  Nobody eligible. Nothing frozen.'); process.exit(1) }

  writePool({
    frozenAt: new Date().toISOString(),
    source: { guild: GUILD_ID, channel: CHANNEL_ID, message: MESSAGE_ID, emoji: EMOJI },
    // Recorded so you can say "frozen at N members" later without trusting a screenshot.
    memberCountAtFreeze: guild?.approximate_member_count ?? null,
    entrants,
    rejected,
    draws: [],
  })

  console.log(`\n🔒  Entry list frozen: ${entrants.length} entrants`)
  if (guild) console.log(`    Server was at ${guild.approximate_member_count} members.`)
  console.log(`    Written to ${POOL_FILE}`)
  console.log('\n    Reactions from here on do not count. Draw with:  npm run giveaway -- --draw\n')
}

/** Fisher–Yates over a copy, but only far enough to fill the winners we need. */
function pick(pool, n) {
  const a = [...pool]
  const out = []
  for (let i = 0; i < Math.min(n, a.length); i++) {
    const j = i + randomInt(a.length - i)   // uniform in [i, a.length)
    ;[a[i], a[j]] = [a[j], a[i]]
    out.push(a[i])
  }
  return out
}

async function draw() {
  const pool = readPool()
  const alreadyDrawn = new Set(pool.draws.flatMap((d) => d.winners.map((w) => w.id)))
  const remaining = pool.entrants.filter((u) => !alreadyDrawn.has(u.id))

  console.log(`\nFrozen ${pool.frozenAt} · ${pool.entrants.length} entrants`)
  if (alreadyDrawn.size) {
    console.log(`  ${alreadyDrawn.size} already drawn and excluded → ${remaining.length} left`)
  }
  if (!remaining.length) {
    console.error('\n❌  Everyone in the frozen pool has been drawn already.\n')
    process.exit(1)
  }
  if (remaining.length < WINNERS) console.log(`\n⚠️  Only ${remaining.length} left for ${WINNERS} spots.`)

  const winners = pick(remaining, WINNERS)

  // The pool is frozen by design, so leaving isn't a disqualification — but you want to
  // know before you spend a day waiting on a DM to an account that's gone.
  if (GUILD_ID && await discord(`/guilds/${GUILD_ID}`, { allow404: true })) {
    for (const w of winners) {
      const member = await discord(`/guilds/${GUILD_ID}/members/${w.id}`, { allow404: true })
      if (!member) console.log(`  ⚠️  ${label(w)} has left the server since the freeze.`)
    }
  }

  pool.draws.push({
    at: new Date().toISOString(),
    drawnFrom: remaining.length,
    winners: winners.map(slim),
  })
  writePool(pool)

  const n = pool.draws.length
  console.log(`\n🎉  Draw #${n}${n > 1 ? ' (replacement)' : ''} — from ${remaining.length} eligible:\n`)
  for (const w of winners) console.log(`    ${label(w)}   <@${w.id}>`)
  console.log('\n    Nothing was posted to Discord — announce it yourself.')
  console.log('    No reply? Run the same command again for a replacement.\n')
}

function status() {
  const pool = readPool()
  const drawn = pool.draws.flatMap((d) => d.winners)
  console.log(`\n🔒  Frozen ${pool.frozenAt}`)
  console.log(`    ${pool.entrants.length} entrants · ${pool.rejected.length} rejected`
    + `${pool.memberCountAtFreeze ? ` · server at ${pool.memberCountAtFreeze} members` : ''}`)
  console.log(`    Reaction: ${pool.source.emoji} on message ${pool.source.message}`)
  if (!pool.draws.length) { console.log('\n    No draws yet.\n'); return }
  console.log(`\n    ${pool.draws.length} draw(s):`)
  for (const [i, d] of pool.draws.entries()) {
    console.log(`      #${i + 1}  ${d.at}  (from ${d.drawnFrom})`)
    for (const w of d.winners) console.log(`           ${label(w)}   <@${w.id}>`)
  }
  console.log(`\n    ${pool.entrants.length - drawn.length} still undrawn.\n`)
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (STATUS) return status()
  if (DRAW) return draw()

  if (!CHANNEL_ID || !MESSAGE_ID) {
    console.error('❌  Pass the message link (right-click the message → Copy Message Link),')
    console.error('    or --channel <id> --message <id>.')
    console.error('    To draw from an already-frozen list: --draw')
    process.exit(1)
  }
  if (FREEZE && !EMOJI) {
    console.error('❌  --freeze needs --emoji. Run without it first to see what is on the message.')
    process.exit(1)
  }
  return FREEZE ? freeze() : listReactions()
}

main().catch((err) => { console.error(`\n❌  ${err.message}\n`); process.exit(1) })

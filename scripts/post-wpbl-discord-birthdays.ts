#!/usr/bin/env node
/**
 * post-wpbl-discord-birthdays.ts: posts one message a day naming whoever on the WPBL
 * roster has a birthday, and says nothing at all on the days nobody does.
 *
 * The silence is the feature. The league's feed carries `age` and never a date, so the dates
 * come from the community birthdays doc, with the BDay sheet as the fallback, via
 * scripts/ingest-wpbl-birthdays.mjs. 105 of the 118 players have a date settled enough to
 * greet and they land on 92 distinct days, so the channel hears from this job roughly every
 * fourth morning. A job that greeted the channel daily, birthday or not, would be muted
 * inside a week.
 *
 * Why a webhook (not a bot): send-only HTTP, no token, no gateway, nothing to keep running.
 * Same reasoning as the board, recap and highlight posters. This one posts to its own
 * channel, so it takes its own webhook URL (DISCORD_BIRTHDAY_WEBHOOK_URL).
 *
 * Why TypeScript: the message itself is built by src/wpbl/derive/discordBirthdays.ts, which
 * is where the two calls worth testing live (who gets greeted, and whether an age is
 * trustworthy enough to print). That module is pure TS, so this script is bundled with
 * esbuild before it runs, exactly like the recap poster.
 *
 * There is nothing to backfill and nothing to edit. A birthday is one day, so a run that
 * misses its window has missed it: the next day's run does not go looking for yesterday,
 * because a late birthday post is worse than none. And a birthday is never revised the way
 * a box score is, so the message is posted once and left alone.
 *
 * What stops a double post is wpbl_discord_birthday_posts, keyed by player and date. Rows
 * are claimed before the message is sent, so a second copy of the job (a manual re-run on
 * top of the schedule) finds the day taken and stops.
 *
 * Usage:
 *   npm run discord-birthdays -- --dry-run              # render to stdout, post nothing
 *   npm run discord-birthdays                           # post today's birthdays, if any
 *   npm run discord-birthdays -- --date=2026-08-12      # pretend it is that day (dry-run only)
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DISCORD_BIRTHDAY_WEBHOOK_URL. The
 * service-role key is required to post: the roster it reads is public, but
 * wpbl_discord_birthday_posts is service-role only and any other key reads it as empty,
 * which this job would take to mean "not posted yet". --dry-run sends nothing, so it runs
 * on the anon key and says what it cannot see.
 */
import { createClient } from '@supabase/supabase-js'
// @ts-expect-error: no types installed for `ws`; it is only handed to supabase-js below.
import ws from 'ws'
import { birthdaysOn, buildBirthdayMessage } from '../src/wpbl/derive/discordBirthdays'
import type { BirthdayPlayer } from '../src/wpbl/derive/discordBirthdays'
import type { WpblTeam } from '../src/wpbl/types'

// ─── Config ─────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const SUPABASE_KEY = SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const WEBHOOK_URL = (process.env.DISCORD_BIRTHDAY_WEBHOOK_URL ?? '').trim()

// The league plays out of a single Central-time hub and the server's readers follow it, so
// "today" is a Central day. Left as a knob because the answer is a judgement call, not a
// fact: whoever reads the channel from Tokyo would say the day turned hours ago.
const TIME_ZONE = process.env.WPBL_BIRTHDAY_TZ ?? 'America/Chicago'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const DATE_ARG = args.find(a => a.startsWith('--date='))?.slice('--date='.length) ?? ''

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌  Set SUPABASE_URL (or VITE_SUPABASE_URL) and a Supabase key before running')
  process.exit(1)
}
if (!WEBHOOK_URL && !DRY_RUN) {
  console.error('❌  Set DISCORD_BIRTHDAY_WEBHOOK_URL (the full https://discord.com/api/webhooks/<id>/<token> for the birthdays channel)')
  process.exit(1)
}
// The posts table has RLS on and no policies, so a non-service key does not get an error
// from it, it gets an empty result. That is indistinguishable from "nothing posted yet",
// and a real run reading it that way would post a second copy of a message already in the
// channel. A dry run is welcome to the anon key; it just has to say what it cannot see.
if (!SERVICE_KEY && !DRY_RUN) {
  console.error('❌  Posting needs SUPABASE_SERVICE_ROLE_KEY: wpbl_discord_birthday_posts is service-role only, and with any other key this job cannot tell whether it has already posted today.')
  process.exit(1)
}
if (!SERVICE_KEY) {
  console.warn('⚠️   No service-role key, so wpbl_discord_birthday_posts is invisible: today will read as unposted whatever is actually in the channel.')
}
// Only ever a rehearsal. Posting a date the calendar does not agree with is how a greeting
// lands three days late, so the override cannot reach the webhook.
if (DATE_ARG && !DRY_RUN) {
  console.error('❌  --date is for --dry-run only. A real run posts today or nothing.')
  process.exit(1)
}
if (DATE_ARG && !/^\d{4}-\d{2}-\d{2}$/.test(DATE_ARG)) {
  console.error('❌  --date wants YYYY-MM-DD')
  process.exit(1)
}

// No session handling in CI, and `ws` for realtime because supabase-js builds a client for
// it even though nothing here subscribes (Node < 22 has no global WebSocket). Same line,
// same reason, as the sibling Discord scripts.
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws },
})

// ─── Today ──────────────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' in TIME_ZONE. 'en-CA' formats as ISO, which saves reassembling the parts. */
function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

// ─── Discord ────────────────────────────────────────────────────────────────

async function discord(path: string, init: RequestInit): Promise<Response> {
  const res = await fetch(`${WEBHOOK_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (res.status === 429) {
    const retryMs = Math.min(10_000, Number((await res.clone().json().catch(() => ({}))).retry_after ?? 1) * 1000)
    console.warn(`⚠️   Rate limited, waiting ${retryMs}ms`)
    await new Promise(r => setTimeout(r, retryMs))
    return discord(path, init)
  }
  return res
}

/** `?wait=true` makes Discord return the created message, which is how we learn its id. */
async function createMessage(payload: unknown): Promise<{ id: string }> {
  const res = await discord('?wait=true', { method: 'POST', body: JSON.stringify(payload) })
  if (!res.ok) throw new Error(`Post failed (${res.status}): ${await res.text()}`)
  return await res.json() as { id: string }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const today = DATE_ARG || todayIso()

  const { data: playerRows, error: playerErr } = await supabase
    .from('wpbl_players')
    .select('id, name, team_id, position, birth_date, birth_date_source, age, active')
    .not('birth_date', 'is', null)
  if (playerErr) throw new Error(`Loading wpbl_players failed: ${playerErr.message}`)

  const celebrating = birthdaysOn((playerRows ?? []) as BirthdayPlayer[], today)
  if (!celebrating.length) {
    // The common case, and not a problem: most days nobody has a birthday.
    console.log(`No WPBL birthdays on ${today}. Nothing to post.`)
    return
  }

  const { data: postedRows, error: postedErr } = await supabase
    .from('wpbl_discord_birthday_posts')
    .select('player_id')
    .eq('birthday_on', today)
    .in('player_id', celebrating.map(p => p.id))
  if (postedErr) {
    // A dry run is the thing you want to do BEFORE applying the migration: it sends
    // nothing, so it can report the day as unposted. A real run cannot.
    if (!DRY_RUN) throw new Error(`Reading wpbl_discord_birthday_posts failed (has the migration run?): ${postedErr.message}`)
    console.warn(`⚠️   No wpbl_discord_birthday_posts yet (${postedErr.message}), treating today as unposted.`)
  }
  const posted = new Set((postedRows ?? []).map(r => r.player_id as string))
  const toGreet = celebrating.filter(p => !posted.has(p.id))
  if (!toGreet.length) {
    console.log(`${celebrating.length} birthday(s) on ${today}, all already posted. Nothing to do.`)
    return
  }

  const { data: teamRows, error: teamErr } = await supabase.from('wpbl_teams').select('*')
  if (teamErr) throw new Error(`Loading wpbl_teams failed: ${teamErr.message}`)
  const teams = new Map(((teamRows ?? []) as WpblTeam[]).map(t => [t.id, t]))

  const message = buildBirthdayMessage(toGreet, teams, today)
  if (!message) return   // unreachable: toGreet came out of birthdaysOn for this same day

  if (DRY_RUN) {
    console.log(`\n── ${today}  [WOULD POST]`)
    console.log(message.content)
    console.log('\n(dry run, nothing was sent)')
    return
  }

  // Claim first, post second. The primary key is (player_id, birthday_on), so a second copy
  // of the job racing this one fails here and stops, rather than putting the same greeting
  // in the channel twice. The cost of that order is a claimed row with no message behind it
  // if Discord then refuses, which loses one day's post: quieter than a double post, and
  // the run fails loudly enough to see.
  const claim = toGreet.map(p => ({ player_id: p.id, birthday_on: today }))
  const { error: claimErr } = await supabase.from('wpbl_discord_birthday_posts').insert(claim)
  if (claimErr) throw new Error(`Claiming today's birthdays failed (another run may have it): ${claimErr.message}`)

  const sent = await createMessage(message)

  // Best effort: the claim is what prevents a repost, so a failed update here is worth a
  // warning and not a failed run. The id is only ever used for debugging.
  const { error: idErr } = await supabase
    .from('wpbl_discord_birthday_posts')
    .update({ message_id: sent.id })
    .eq('birthday_on', today)
    .in('player_id', toGreet.map(p => p.id))
  if (idErr) console.warn(`⚠️   Posted, but recording the message id failed: ${idErr.message}`)

  console.log(`✅  Posted ${toGreet.length} birthday(s) for ${today}: ${toGreet.map(p => p.name).join(', ')}`)
}

main().catch(err => { console.error('❌ ', err.message); process.exit(1) })

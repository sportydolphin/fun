/**
 * sync-wpbl-discord-awards.ts — the fan awards ballot as a reaction poll in Discord.
 *
 * WHAT THIS IS. One message per fan-vote question in a channel of its own, each carrying the
 * same four names the site offers, numbered. A reader reacts; this job reads the reactions every
 * few minutes and writes them into `wpbl_award_votes` under `discord:<user id>`, which is the
 * same table and the same tally the site counts. Voting in both places is allowed and is the
 * point: it is a bonus for being in the Discord, not a loophole to close.
 *
 * BATCHED, NOT LIVE, AND THAT IS THE DESIGN RATHER THAN A COMPROMISE. A reaction is not a
 * request to us: catching one as it happens means a gateway connection held open forever, which
 * is a daemon this project does not have and does not want (the tracking listener is the one
 * socket here, and it exists because tracking arrives live or never). A poll every few minutes
 * costs one HTTP call per option and cannot miss anything, because a reaction is STATE and not an
 * event: whatever is on the message when we look is the whole truth, however long ago it was
 * added. A run that fails changes nothing and the next one sees the same reactions.
 *
 * WHAT THE READER SEES THAT THE SITE HIDES. Reaction counts are public, so a Discord voter sees
 * the running tally before answering, which is exactly what `withWriteIns` and the site's
 * results-after-you-vote rule refuse to do. There is no way around it with reactions: the count
 * is drawn by Discord. It is the price of the simplest ballot box that works in a chat client,
 * and it is worth naming rather than pretending the two surfaces behave the same.
 *
 * THE CHANNEL ASKS MORE THAN THE SITE DOES. Besides the site's five, it carries whatever is in
 * scripts/wpbl-discord-questions.ts: hand-written questions with typed-out options, asked only
 * here. They travel the same road as the rest, into the same table under a `discord:2026:` id, so
 * the tally, the withdrawal rule and the deadline are one implementation rather than two. What
 * they do NOT get is a shortlist computed from the season, because the reason a question is
 * Discord-only is usually that no season can answer it.
 *
 * THE SHORTLIST IS FROZEN, which is what makes a stored emoji-to-key map safe. Every one of these
 * awards is seeded off the regular season, and the regular season ended Sep 6: the four names
 * cannot change under a reaction already cast. `wpbl_award_discord_polls` records the mapping at
 * post time and is never rebuilt from a fresh ballot.
 *
 * ONE REACTION PER QUESTION. Two on the same message is not a vote for two people, it is an
 * unanswered question, and it is counted as nothing until the reader takes one off. Removing
 * every reaction withdraws the vote, the same as "Take it back" on the site.
 *
 * IT DOES NOT WRITE VOTES DIRECTLY. Casting goes through `wpbl_cast_award_vote`, the same
 * security-definer function the browser uses, so there is exactly one writer of that table and
 * the key-length rules are enforced in one place. See CLAUDE.md on why the votes table has no
 * SELECT policy and why an upsert from the browser was refused before that function existed.
 *
 * Usage:
 *   npm run discord-awards -- --dry-run     # say what it would post and cast, write nothing
 *   npm run discord-awards                  # post any missing polls, then cast the reactions
 *   npm run discord-awards -- --repost      # rebuild every message (a new channel, say)
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY for the poll registry and
 * the vote read-back, VITE_SUPABASE_ANON_KEY for the cast (the same call the browser makes),
 * DISCORD_BOT_TOKEN, and DISCORD_AWARDS_CHANNEL_ID for the channel to post in.
 */

import { createClient } from '@supabase/supabase-js'
import { fanVoteAwards, AWARDS_CLOSE_AT, AWARDS_CLOSE_LABEL, type WpblAward } from '../src/wpbl/awards'
import { buildAwardBallot, type AwardCandidate } from '../src/wpbl/derive/awards'
import { buildRunExpectancy, playRunValues } from '../src/wpbl/derive/runExpectancy'
import { mvpRace } from '../src/wpbl/derive/mvpRace'
import { WPBL_DISCORD_QUESTIONS, type DiscordQuestion } from './wpbl-discord-questions'
import type {
  WpblBattingLine, WpblFieldingLine, WpblGame, WpblGamePlay, WpblPitchingLine, WpblPlayer, WpblTeam,
} from '../src/wpbl/types'

const DRY_RUN = process.argv.includes('--dry-run')
const REPOST = process.argv.includes('--repost')

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN ?? ''
const CHANNEL_ID = process.env.DISCORD_AWARDS_CHANNEL_ID ?? ''

const SITE = 'https://sportydolphin.fun/wpbl/awards'

/** The reaction for each slot, in order. Ten is more than any slate offers (four). */
const SLOT_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']

/** Just enough of the client to page a public table. Typing this structurally rather than as
 *  `SupabaseClient` keeps the anon client and the service client interchangeable here, which is
 *  the whole point: the ballot is read with the key a reader already has. */
interface SupabaseLike {
  from(table: string): {
    select(columns: string): {
      order(column: string): { range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> }
    }
  }
}

interface PollOption { emoji: string; key: string; name: string; team: string | null }

/**
 * A question ready to post, from either source.
 *
 * The site's awards and the Discord-only questions differ in exactly two places: where the
 * options come from, and whether the footer points at the site. Everything after this shape is
 * one path, which is why the tally, the one-reaction rule and the deadline cannot drift between
 * the two halves of the ballot.
 */
interface Askable {
  id: string
  emoji: string
  title: string
  blurb: string
  closesAt: string
  options: PollOption[]
  /** False for a question that exists only here, so the footer does not send a reader to a page
   *  that has never heard of it. */
  onSite: boolean
}

/** A hand-written question as something the poster can ask. */
export function askableFromQuestion(q: DiscordQuestion, closesAt: string): Askable {
  return {
    id: q.id, emoji: q.emoji, title: q.title, blurb: q.blurb ?? '',
    closesAt: q.closesAt ?? closesAt,
    onSite: false,
    options: q.options.slice(0, SLOT_EMOJI.length).map((o, i) => ({
      emoji: SLOT_EMOJI[i], key: o.key, name: o.label, team: null, note: o.note,
    })) as PollOption[],
  }
}
interface PollRow { category: string; channel_id: string; message_id: string; options: PollOption[] }

// ─── Discord ──────────────────────────────────────────────────────────────────

async function discord(path: string, init: RequestInit = {}): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://discord.com/api/v10${path}`, {
      ...init,
      headers: {
        Authorization: `Bot ${BOT_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'wpbl-award-poll/1.0',
        ...(init.headers ?? {}),
      },
    })
    if (res.status === 429) {
      const retryAfter = Number((await res.json().catch(() => ({}))).retry_after ?? 1)
      await new Promise(r => setTimeout(r, Math.ceil(retryAfter * 1000) + 250))
      continue
    }
    if (!res.ok) {
      // The two that are invisible from the code: posting needs Send Messages in that channel,
      // and seeding the numbers needs Add Reactions. Reading them back needs neither.
      const hint = res.status === 403
        ? ' (does the bot role have Send Messages and Add Reactions in that channel?)' : ''
      throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}${hint}: ${await res.text()}`)
    }
    return res.status === 204 ? null : res.json()
  }
  throw new Error(`${init.method ?? 'GET'} ${path} → rate limited four times running`)
}

/**
 * Everyone who put this emoji on this message.
 *
 * PAGED, because the endpoint caps at 100 per call and says nothing about it, which is the same
 * shape of trap as the feed's game list and PostgREST's 1000 rows. A hundred reactions on one
 * option is a good problem and would otherwise silently throw away every vote past the first
 * hundred.
 */
async function reactors(channelId: string, messageId: string, emoji: string): Promise<string[]> {
  const out: string[] = []
  let after = ''
  for (;;) {
    const page: { id: string; bot?: boolean }[] = await discord(
      `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}?limit=100${after ? `&after=${after}` : ''}`,
    )
    for (const u of page) if (!u.bot) out.push(u.id)
    if (page.length < 100) return out
    after = page[page.length - 1].id
  }
}

// ─── The message ──────────────────────────────────────────────────────────────

/**
 * One question as a message.
 *
 * The stat line under each name is the same figures the tile on the site shows, in the same
 * order, so a reader moving between the two is comparing like with like. Discord has no room
 * for a portrait and no need of one.
 */
export function pollMessage(ask: Askable, candidates: AwardCandidate[] = []): string {
  const byKey = new Map(candidates.map(c => [c.key, c]))
  // Separated by a middle dot rather than a dash: the house rule bans the em dash in copy a
  // reader sees, and this line is read in a chat client where a hyphen would look like a minus.
  const lines = ask.options.map(o => {
    const c = byKey.get(o.key)
    // A seeded candidate brings the tile's own figures; a hand-written option brings whatever
    // half-line the question wrote for it, and most bring neither.
    const detail = (c?.stats ?? []).slice(0, 3).map(s => `${s.value} ${s.label}`).join(' · ')
      || (o as { note?: string }).note || ''
    const where = o.team ? ` (${o.team})` : ''
    return `${o.emoji}  **${o.name}**${where}${detail ? ` · ${detail}` : ''}`
  })
  return [
    `${ask.emoji} **${ask.title}**`,
    ...(ask.blurb ? [`_${ask.blurb}_`] : []),
    '',
    ...lines,
    '',
    `React with one number. Change it any time until the final starts on ${AWARDS_CLOSE_LABEL}.`,
    ask.onSite
      ? `Your Discord vote counts alongside the site, so you can vote in both: <${SITE}>`
      : 'This one is asked here and nowhere else.',
  ].join('\n')
}

// ─── The rules, as arithmetic ─────────────────────────────────────────────────

export interface ResolvedVotes {
  /** Voters whose reaction differs from what is recorded. */
  cast: { voterKey: string; choice: string }[]
  /** Voters recorded on this question who have taken every reaction off. */
  clear: string[]
  /** Readers holding more than one reaction on one question. Counted as nothing. */
  ambiguous: number
}

/**
 * What one question's reactions mean, against what is already recorded.
 *
 * PURE, because this is the whole of the job's judgement and none of it needs a network to be
 * wrong. Three rules:
 *
 *   ONE reaction is a vote. It is written only when it differs from the recorded answer, so a
 *   run over an unchanged channel writes nothing at all.
 *
 *   TWO or more is an unanswered question, not a vote for two people. Discord has no way to
 *   refuse the second reaction, so the arithmetic has to: counting either one would be picking
 *   for the reader, and counting both would give one person two votes in a poll where everyone
 *   else has one.
 *
 *   NONE, from somebody we have recorded, is a withdrawal. That is the same act as "Take it
 *   back" on the site and it deserves the same answer.
 */
export function resolveVotes({ options, reactions, recorded }: {
  options: PollOption[]
  /** emoji -> the user ids holding it. */
  reactions: Map<string, string[]>
  /** voter key -> the choice already stored for THIS category. */
  recorded: Map<string, string>
}): ResolvedVotes {
  const picks = new Map<string, string[]>()
  for (const o of options) {
    for (const userId of reactions.get(o.emoji) ?? []) {
      const key = `discord:${userId}`
      ;(picks.get(key) ?? picks.set(key, []).get(key)!).push(o.key)
    }
  }
  const out: ResolvedVotes = { cast: [], clear: [], ambiguous: 0 }
  for (const [voterKey, keys] of picks) {
    if (keys.length !== 1) { out.ambiguous++; continue }
    if (recorded.get(voterKey) === keys[0]) continue
    out.cast.push({ voterKey, choice: keys[0] })
  }
  for (const voterKey of recorded.keys()) {
    // A reader holding two reactions has not withdrawn, they have not answered: their recorded
    // vote stands until they take one off, which is the kinder reading of an accident.
    if (!picks.has(voterKey)) out.clear.push(voterKey)
  }
  return out
}

// ─── The ballot ───────────────────────────────────────────────────────────────

/**
 * Everything `buildAwardBallot` needs for the five questions the fan vote runs.
 *
 * Read with the ANON key, deliberately: every table here is one the site reads on a cold load,
 * so the job asks for nothing a reader does not already have, and a dry run works with the two
 * variables `npm run dev` needs. The service role is spent only on the poll registry and on
 * reading back votes, neither of which is public.
 */
async function loadBallot(db: SupabaseLike) {
  const page = async <T>(table: string, select: string, order: string): Promise<T[]> => {
    const out: T[] = []
    for (let from = 0; ; from += 1000) {
      // A bare select stops at 1000 rows with no error, and an ordered range is the only read
      // that cannot repeat or skip a row. CLAUDE.md, and it is the same helper the app uses.
      const { data, error } = await db.from(table).select(select).order(order).range(from, from + 999)
      if (error) throw new Error(`${table}: ${error.message}`)
      out.push(...(data as T[]))
      if ((data?.length ?? 0) < 1000) return out
    }
  }
  const [teams, games, players, batting, pitching, fielding, plays] = await Promise.all([
    page<WpblTeam>('wpbl_teams', '*', 'id'),
    page<WpblGame>('wpbl_games', '*', 'game_date'),
    page<WpblPlayer>('wpbl_players', '*', 'id'),
    page<WpblBattingLine>('wpbl_batting_lines', '*', 'id'),
    page<WpblPitchingLine>('wpbl_pitching_lines', '*', 'id'),
    page<WpblFieldingLine>('wpbl_fielding_lines', '*', 'id'),
    page<WpblGamePlay>('wpbl_game_plays', '*', 'id'),
  ])
  // The same two passes Home makes, in the same order: the run-expectancy table off our own
  // plays, then every play priced against it. Both filter the postseason out themselves.
  const race = plays.length && players.length
    ? mvpRace(playRunValues(plays, games, buildRunExpectancy(plays, games)), players, games)
    : null
  return { teams, games, players, batting, pitching, fielding, mvp: race }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

async function main() {
  // A DRY RUN NEEDS ONLY WHAT THE SITE NEEDS. It renders the messages and prints the votes it
  // would write, and neither the registry nor Discord is touched, so the two Supabase URLs are
  // enough to try this before any secret exists. A real run needs the rest.
  const required = DRY_RUN
    ? { SUPABASE_URL, VITE_SUPABASE_ANON_KEY: ANON_KEY }
    : {
      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, VITE_SUPABASE_ANON_KEY: ANON_KEY,
      DISCORD_BOT_TOKEN: BOT_TOKEN, DISCORD_AWARDS_CHANNEL_ID: CHANNEL_ID,
    }
  for (const [name, value] of Object.entries(required)) {
    if (!value) { console.error(`❌  Set ${name}.`); process.exit(1) }
  }

  const pub = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const db = SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } }) : null
  const closed = Date.now() >= Date.parse(AWARDS_CLOSE_AT)

  const { data: existing } = db ? await db.from('wpbl_award_discord_polls').select('*') : { data: [] }
  const polls = new Map<string, PollRow>((existing ?? []).map((r: any) => [r.category, r as PollRow]))

  // ── Post whatever is missing ────────────────────────────────────────────────
  //
  // The site's questions and the Discord-only ones are decided together and posted together, in
  // that order, so the channel reads top to bottom as one ballot rather than two lists that
  // happen to share a room.
  const unposted = (id: string) => REPOST || !polls.has(id) || polls.get(id)!.channel_id !== CHANNEL_ID
  const extras = WPBL_DISCORD_QUESTIONS.filter(q => unposted(q.id))
  const awards = fanVoteAwards().filter(a => unposted(a.id))
  const missing = awards.length + extras.length

  if (missing && closed) {
    console.log(`Voting closed on ${AWARDS_CLOSE_LABEL}; not posting ${missing} new question(s).`)
  } else if (missing) {
    const asks: { ask: Askable; candidates: AwardCandidate[] }[] = []

    if (awards.length) {
      // The heavy read happens only when a SEEDED question is missing. A run that is posting
      // nothing but hand-written questions never touches the play log.
      const input = await loadBallot(pub)
      const ballot = buildAwardBallot(input as any)
      for (const award of awards) {
        const entry = ballot.find(e => e.award.id === award.id)
        if (!entry || !entry.candidates.length) { console.log(`  ${award.id}: no shortlist yet, skipping`); continue }
        asks.push({
          candidates: entry.candidates,
          ask: {
            id: award.id, emoji: award.emoji, title: award.title, blurb: award.blurb,
            closesAt: award.closesAt, onSite: true,
            options: entry.candidates.slice(0, SLOT_EMOJI.length).map((c, i) => ({
              emoji: SLOT_EMOJI[i], key: c.key, name: c.name, team: c.teamId,
            })),
          },
        })
      }
    }
    for (const q of extras) {
      if (!q.options.length) { console.log(`  ${q.id}: no options written, skipping`); continue }
      asks.push({ ask: askableFromQuestion(q, AWARDS_CLOSE_AT), candidates: [] })
    }

    for (const { ask, candidates } of asks) {
      const content = pollMessage(ask, candidates)
      if (DRY_RUN) {
        console.log(`\n─── would post (${ask.id}) ───\n${content}\n`)
        continue
      }
      const msg = await discord(`/channels/${CHANNEL_ID}/messages`, {
        method: 'POST', body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      })
      // One at a time: Discord rate-limits reaction adds hard, and a numbered list that arrives
      // out of order reads as a different ballot.
      for (const o of ask.options) {
        await discord(`/channels/${CHANNEL_ID}/messages/${msg.id}/reactions/${encodeURIComponent(o.emoji)}/@me`, { method: 'PUT' })
      }
      await db!.from('wpbl_award_discord_polls').upsert({
        category: ask.id, channel_id: CHANNEL_ID, message_id: msg.id,
        options: ask.options, updated_at: new Date().toISOString(),
      })
      polls.set(ask.id, { category: ask.id, channel_id: CHANNEL_ID, message_id: msg.id, options: ask.options })
      console.log(`Posted ${ask.id} (${ask.options.length} options).`)
    }
  }

  // ── Read the reactions and cast them ────────────────────────────────────────
  if (closed) { console.log(`Voting closed on ${AWARDS_CLOSE_LABEL}. Nothing cast.`); return }
  // A hand-written question may set its own close. Read here rather than at post time, because
  // the deadline that matters is the one in force when a reaction is counted.
  const closesAt = new Map(WPBL_DISCORD_QUESTIONS.map(q => [q.id, Date.parse(q.closesAt ?? AWARDS_CLOSE_AT)]))
  if (!polls.size) { console.log('No polls posted yet.'); return }

  // What Discord voters have already been recorded as choosing, so a run that changes nothing
  // calls nothing. The whole table is a few hundred rows; a filter would cost more than it saves.
  const { data: voteRows } = db
    ? await db.from('wpbl_award_votes').select('category,voter_key,choice').like('voter_key', 'discord:%')
    : { data: [] }

  let cast = 0, cleared = 0, ambiguous = 0
  for (const poll of polls.values()) {
    if ((closesAt.get(poll.category) ?? Infinity) <= Date.now()) continue
    const reactions = new Map<string, string[]>()
    for (const o of poll.options) {
      reactions.set(o.emoji, await reactors(poll.channel_id, poll.message_id, o.emoji))
    }
    const recorded = new Map(
      (voteRows ?? []).filter((v: any) => v.category === poll.category).map((v: any) => [v.voter_key, v.choice]),
    )
    const verdict = resolveVotes({ options: poll.options, reactions, recorded })
    ambiguous += verdict.ambiguous
    for (const { voterKey, choice } of verdict.cast) {
      if (DRY_RUN) console.log(`  would cast ${poll.category} ${voterKey} -> ${choice}`)
      else await rpc('wpbl_cast_award_vote', { p_category: poll.category, p_voter_key: voterKey, p_choice: choice })
      cast++
    }
    for (const voterKey of verdict.clear) {
      if (DRY_RUN) console.log(`  would clear ${poll.category} ${voterKey}`)
      else await rpc('wpbl_clear_award_vote', { p_category: poll.category, p_voter_key: voterKey })
      cleared++
    }
  }
  console.log(`${polls.size} question(s) · ${cast} vote(s) written · ${cleared} withdrawn`
    + (ambiguous ? ` · ${ambiguous} reader(s) with more than one reaction, counted as nothing` : '')
    + (DRY_RUN ? ' (dry run: nothing written)' : ''))
}

/** The cast goes through the same security-definer function the browser calls, with the same anon
 *  key. Nothing here needs more than a reader of the site already has. */
async function rpc(fn: string, args: Record<string, string>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`${fn} → ${res.status}: ${await res.text()}`)
}

// Imported by src/__tests__/discordAwardPoll.test.ts for `pollMessage` and `resolveVotes`, which
// are the two halves worth pinning; importing must not start a run.
if (process.argv[1] && process.argv[1].includes('wpbl-discord-awards')) {
  main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
}

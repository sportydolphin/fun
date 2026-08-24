#!/usr/bin/env node
/**
 * post-wpbl-bluesky-recaps.ts: posts a WPBL final to Bluesky: the recap as text, and the box
 * score as an image, because Bluesky cannot render a table.
 *
 * WHY THIS IS NOT THE DISCORD JOB WITH A DIFFERENT URL. Three things differ, and each one
 * changes the design rather than the transport.
 *
 * 1. THERE IS NO EDIT. Discord's recap job re-renders every recent final on every run and
 *    PATCHes the ones whose text changed, so a late scoring correction fixes itself in the
 *    channel and nobody sees it happen. On Bluesky a post is published or deleted, in public,
 *    with nothing in between. So this job never re-sends, and instead WAITS: a game is posted
 *    only once it has been final, in our hands, for SETTLE_MINUTES. wpbl_play_corrections
 *    exists because the league's scoring has errors in it, and the recap wording is derived and
 *    has changed under us before. Publishing the instant a game ends is how you end up with a
 *    permanent public post of a box score the site itself no longer agrees with.
 *
 * 2. A POST IS CAPPED AT 300 GRAPHEMES and the server rejects anything longer, so the text is
 *    trimmed by `buildBlueskyPost` rather than by hope. Every link also needs a facet carrying
 *    UTF-8 BYTE offsets, which is its own trap; see `linkFacets`.
 *
 * 3. THE BOX SCORE HAS TO BE AN IMAGE. Discord's version is a space-padded table inside a code
 *    fence; Bluesky has no monospace and no fences, so the same string is ragged nonsense. The
 *    card is drawn as SVG by `boxScoreCard` (pure, tested) and rasterised here.
 *
 * IT NEVER BACKFILLS. The first run against an empty table records every existing final as
 * handled and publishes nothing, so switching it on does not put a season on the timeline. Only
 * games that go final afterwards are posted.
 *
 * THE CREDENTIAL IS THE MENTION WATCHER'S, deliberately shared: both are the sportydolphin
 * account, which is the brand rather than a person. Note this is the one job in the repo that
 * PUBLISHES to a third-party platform. The mention watcher's rule still stands and is not
 * softened by this: it finds threads and never replies to them. Posting our own recaps to our
 * own timeline is not that, and nothing here may ever reply, quote, or mention anybody.
 *
 * Usage:
 *   npm run bluesky-recaps -- --dry-run    # render text + card to disk, publish nothing
 *   npm run bluesky-recaps                 # publish whatever is due
 *   npm run bluesky-recaps -- --seed       # record every final as handled, publish nothing
 *   npm run bluesky-recaps -- --now        # ignore the settle window (for a deliberate catch-up)
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BLUESKY_IDENTIFIER,
 * BLUESKY_APP_PASSWORD. The service-role key is required to publish: wpbl_bluesky_recap_posts
 * is RLS'd with no policies, so any other key reads it as empty, which this job would take to
 * mean "nothing has been posted" and republish the lot.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
// @ts-expect-error: no types installed for `ws`; it is only handed to supabase-js below.
import ws from 'ws'
import { Resvg } from '@resvg/resvg-js'
import subsetFont from 'subset-font'
import { buildRecap, leagueRecapContext } from '../src/wpbl/derive/recap'
import { buildBlueskyPost, boxScoreCard, cardCharset, linkFacets, graphemes } from '../src/wpbl/derive/blueskyRecap'
import type { WpblGame, WpblTeam, WpblBattingLine, WpblPitchingLine, WpblGamePlay } from '../src/wpbl/types'

// ─── Config ─────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const SUPABASE_KEY = SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const BSKY_ID = (process.env.BLUESKY_IDENTIFIER ?? '').trim()
const BSKY_PASSWORD = (process.env.BLUESKY_APP_PASSWORD ?? '').trim()

const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')
const SEED = args.has('--seed')
const NOW = args.has('--now')

// How long a game must have been final, in our hands, before it is published. Long enough for
// the ingest to have re-read the box score and for the nightly play validation to have run at
// least once against it; short enough that the post still lands the same evening.
const SETTLE_MINUTES = 45

// How far back a final is still worth posting. Past this it is history, and a timeline that
// suddenly emits three-day-old scores looks broken rather than thorough.
const WINDOW_HOURS = 36

// One game at a time, with a gap. A doubleheader is the busiest this ever gets.
const SEND_GAP_MS = 2_000

const FONT_SRC = 'scripts/fonts/InterVariable-full.woff2'

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌  Set SUPABASE_URL and a Supabase key before running.')
  process.exit(1)
}
// Same reasoning as the Discord recap job: the posts table is invisible to the anon key, and
// "invisible" and "empty" are the same reading. A real run on that would republish everything.
if (!SERVICE_KEY && !DRY_RUN) {
  console.error('❌  Publishing needs SUPABASE_SERVICE_ROLE_KEY: wpbl_bluesky_recap_posts is service-role only, and with any other key this job cannot tell what it has already posted.')
  process.exit(1)
}
if ((!BSKY_ID || !BSKY_PASSWORD) && !DRY_RUN && !SEED) {
  console.error('❌  Set BLUESKY_IDENTIFIER (the full handle, no @) and BLUESKY_APP_PASSWORD (an App Password from Settings, never the account password).')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws },
})

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const minutesSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 60_000

// ─── Rendering the card ─────────────────────────────────────────────────────

/**
 * The card as a PNG.
 *
 * The font is built per card, subset to exactly the characters that card draws, at the three
 * weights it uses. Two reasons it is done here rather than shipped as an asset: resvg reads
 * ttf/otf and the repo's Inter is woff2, and a glyph missing from a subset renders as NOTHING
 * AT ALL rather than as a box, so an accented name would silently vanish from a card that
 * otherwise looked perfect. Subsetting from the card's own text makes that impossible.
 */
async function renderCard(svg: string): Promise<Buffer> {
  const source = await readFile(FONT_SRC)
  const charset = cardCharset(svg)
  const files: string[] = []
  for (const weight of [400, 600, 700]) {
    const ttf = await subsetFont(source, charset, { targetFormat: 'truetype', variationAxes: { wght: weight } })
    const path = `node_modules/.cache/wpbl-card-${weight}.ttf`
    await writeFile(path, ttf)
    files.push(path)
  }
  return Buffer.from(new Resvg(svg, {
    // No system fonts: CI's font set is not this machine's, and a card that renders in Inter
    // locally and in DejaVu on Actions is a card nobody checked.
    font: { fontFiles: files, loadSystemFonts: false, defaultFontFamily: 'Inter' },
  }).render().asPng())
}

// ─── Bluesky ────────────────────────────────────────────────────────────────

interface Session { jwt: string; did: string }

async function login(): Promise<Session> {
  const res = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: BSKY_ID, password: BSKY_PASSWORD }),
  })
  const body = await res.json().catch(() => null) as any
  if (!res.ok) throw new Error(`Bluesky refused the session (${res.status}) ${body?.error ?? ''}: ${body?.message ?? ''}`)
  return { jwt: body.accessJwt, did: body.did }
}

/** The card, uploaded as a blob and referenced by the post. Blobs expire if nothing references
 *  them, so this must be followed by the post that uses it. */
async function uploadCard(session: Session, png: Buffer): Promise<unknown> {
  const res = await fetch('https://bsky.social/xrpc/com.atproto.repo.uploadBlob', {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${session.jwt}` },
    body: png,
  })
  const body = await res.json().catch(() => null) as any
  if (!res.ok) throw new Error(`Bluesky refused the image (${res.status}): ${body?.message ?? ''}`)
  return body.blob
}

async function publish(session: Session, post: { text: string; alt: string; url: string }, blob: unknown) {
  const record = {
    $type: 'app.bsky.feed.post',
    text: post.text,
    createdAt: new Date().toISOString(),
    langs: ['en'],
    facets: linkFacets(post.text, post.url),
    embed: {
      $type: 'app.bsky.embed.images',
      // Alt text is not optional here. The image carries the entire box score, so a card with
      // no description is the whole game hidden from anybody using a screen reader.
      images: [{ alt: post.alt, image: blob, aspectRatio: { width: 1200, height: 600 } }],
    },
  }
  const res = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.jwt}` },
    body: JSON.stringify({ repo: session.did, collection: 'app.bsky.feed.post', record }),
  })
  const body = await res.json().catch(() => null) as any
  if (!res.ok) throw new Error(`Bluesky refused the post (${res.status}): ${body?.message ?? JSON.stringify(body)}`)
  return { uri: body.uri as string, cid: body.cid as string }
}

// ─── Data ───────────────────────────────────────────────────────────────────

const groupBy = <T extends { game_id: string }>(rows: T[]) => {
  const m = new Map<string, T[]>()
  for (const r of rows) m.set(r.game_id, [...(m.get(r.game_id) ?? []), r])
  return m
}

async function main() {
  const sinceIso = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString().slice(0, 10)

  const [{ data: games }, { data: teamRows }, { data: players }] = await Promise.all([
    supabase.from('wpbl_games').select('*').order('game_date'),
    supabase.from('wpbl_teams').select('*'),
    supabase.from('wpbl_players').select('id, name'),
  ])
  if (!games?.length) { console.log('No games.'); return }

  const teams = new Map<string, WpblTeam>((teamRows ?? []).map((t: WpblTeam) => [t.id, t]))
  const nameById = new Map<string, string>((players ?? []).map((p: any) => [p.id, p.name]))
  const ctx = leagueRecapContext(games as WpblGame[])

  const { data: known, error: knownErr } = await supabase
    .from('wpbl_bluesky_recap_posts').select('game_id, first_final_at, posted_at, skipped_reason')
  if (knownErr) throw new Error(`Reading wpbl_bluesky_recap_posts failed (has the migration run?): ${knownErr.message}`)
  const rows = new Map((known ?? []).map((r: any) => [r.game_id, r]))

  const finals = (games as WpblGame[]).filter(g =>
    g.status === 'final' && g.home_score != null && g.away_score != null && g.home_score !== g.away_score)

  // Switching the job on must not publish a season. Anything already final the first time this
  // runs is closed as handled, in one write, and never posted.
  const firstRun = rows.size === 0
  if (firstRun || SEED) {
    const seeded = finals.filter(g => !rows.has(g.id)).map(g => ({
      game_id: g.id, posted_at: new Date().toISOString(), skipped_reason: SEED ? 'seeded' : 'existing when the job was switched on',
    }))
    if (!DRY_RUN && seeded.length) {
      const { error } = await supabase.from('wpbl_bluesky_recap_posts').upsert(seeded, { onConflict: 'game_id' })
      if (error) throw new Error(`Could not record the existing finals: ${error.message}`)
    }
    console.log(`${DRY_RUN ? 'Would record' : 'Recorded'} ${seeded.length} existing final(s) as handled without posting.`)
    if (SEED || !DRY_RUN) return
  }

  // Anything final, recent, and not yet resolved either way.
  const candidates = finals
    .filter(g => g.game_date >= sinceIso)
    .filter(g => { const r = rows.get(g.id); return !r?.posted_at && !r?.skipped_reason })

  if (!candidates.length) { console.log('Nothing waiting.'); return }

  // Phase one: note that we have seen it. Phase two, on a later run, publishes it. The gap is
  // what lets a scoring correction land before the post exists, and a Bluesky post cannot be
  // corrected afterwards.
  const unseen = candidates.filter(g => !rows.has(g.id))
  if (unseen.length && !DRY_RUN) {
    const { error } = await supabase.from('wpbl_bluesky_recap_posts')
      .upsert(unseen.map(g => ({ game_id: g.id })), { onConflict: 'game_id', ignoreDuplicates: true })
    if (error) throw new Error(`Could not record the new finals: ${error.message}`)
    for (const g of unseen) rows.set(g.id, { game_id: g.id, first_final_at: new Date().toISOString() })
  }
  if (unseen.length) console.log(`Saw ${unseen.length} new final(s); they settle for ${SETTLE_MINUTES} min before posting.`)

  const due = candidates.filter(g => {
    if (NOW || DRY_RUN) return true
    const seenAt = rows.get(g.id)?.first_final_at
    return seenAt != null && minutesSince(seenAt) >= SETTLE_MINUTES
  })
  if (!due.length) { console.log('Nothing settled yet.'); return }

  const ids = due.map(g => g.id)
  const [{ data: batting }, { data: pitching }, { data: plays }] = await Promise.all([
    supabase.from('wpbl_batting_lines').select('*').in('game_id', ids),
    supabase.from('wpbl_pitching_lines').select('*').in('game_id', ids),
    supabase.from('wpbl_game_plays').select('game_id, sequence, inning, half, team_id, event_type').in('game_id', ids).order('sequence'),
  ])
  const bat = groupBy((batting ?? []) as (WpblBattingLine & { game_id: string })[])
  const pit = groupBy((pitching ?? []) as (WpblPitchingLine & { game_id: string })[])
  const pbp = groupBy((plays ?? []) as (WpblGamePlay & { game_id: string })[])

  const session = DRY_RUN ? null : await login()

  for (const game of due) {
    const recap = buildRecap(
      game, teams, bat.get(game.id) ?? [], pit.get(game.id) ?? [], (pbp.get(game.id) ?? []) as any,
      (id: string) => nameById.get(id) ?? 'Unknown', ctx)
    if (!recap) { console.warn(`⚠️   ${game.id}: no recap could be built, skipping.`); continue }

    const post = buildBlueskyPost(game, recap, teams)
    const png = await renderCard(boxScoreCard(game, recap, teams))

    if (DRY_RUN) {
      const path = `node_modules/.cache/wpbl-bluesky-${game.game_date}-${recap.winner.abbr ?? 'x'}.png`
      await writeFile(path, png)
      console.log(`\n─── would post (${graphemes(post.text)}/300) ───\n${post.text}\n\nalt: ${post.alt}\ncard: ${path}\n`)
      continue
    }

    const blob = await uploadCard(session!, png)
    const { uri, cid } = await publish(session!, post, blob)
    const { error } = await supabase.from('wpbl_bluesky_recap_posts')
      .upsert({ game_id: game.id, posted_at: new Date().toISOString(), post_uri: uri, post_cid: cid }, { onConflict: 'game_id' })
    // The post exists whatever happens next. Failing to record it would republish the game on
    // the next run, so this is loud rather than swallowed.
    if (error) console.error(`❌  Posted ${uri} but could not record it, which means the next run would post it AGAIN: ${error.message}`)
    console.log(`✅  Posted ${recap.headline}: ${uri}`)
    await sleep(SEND_GAP_MS)
  }
}

main().catch(err => {
  console.error(`❌  ${err?.stack ?? err}`)
  process.exit(1)
})

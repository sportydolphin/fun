// Turning one writer's Substack into rows the section can render: which posts are about
// this league, and which players, clubs and games each one is actually about.
//
// Pure and testable on purpose. Everything here is a judgement call about someone else's
// prose, and every one of those calls is wrong occasionally: a name that is also a common
// word, a city that is a tournament venue rather than a club, a headline score that belongs
// to a different game. The bias throughout is towards saying nothing. A post that fails to
// link to a player is a small loss; a post about the Women's Baseball World Cup wired onto
// Denae Benites' player page is a bug a reader will notice and not forgive.
//
// The sync that uses this is scripts/sync-wpbl-substack.ts.

import type { WpblGame, WpblPlayer, WpblTeam } from '../types'

/** Her publication. Note this is the PUBLICATION subdomain, not the author handle: the
 *  handle (dijondarling) resolves to a Substack profile page with no feed on it. */
export const SUBSTACK_HOST = 'towardsamoreperfectgame.substack.com'
/** Substack rejects a `limit` above 50 with a 400, so the archive is read a page at a
 *  time. She is at 23 posts today, which is one page, but the job should not quietly start
 *  losing her back catalogue on the day she passes fifty. */
export const ARCHIVE_PAGE_SIZE = 50
export const archiveUrl = (offset: number) =>
  `https://${SUBSTACK_HOST}/api/v1/archive?sort=new&limit=${ARCHIVE_PAGE_SIZE}&offset=${offset}`
export const FEED_URL = `https://${SUBSTACK_HOST}/feed`
export const PUBLICATION_URL = `https://${SUBSTACK_HOST}`
/** Her own styling of both, lowercase. Left as she writes them rather than title-cased to
 *  match our headings: it is her name and her masthead, not a field in our design system. */
export const AUTHOR_NAME = 'mary mustard'
export const PUBLICATION_NAME = 'towards a more perfect game'
/** Her self-description, first sentence, verbatim. Her words about herself beat any summary
 *  we would write of her. The rest of the bio goes on to mention the World Cup, which this
 *  section deliberately does not carry, so quoting further would promise coverage we drop. */
export const AUTHOR_BIO = 'I am a writer and amateur baseball player from Albany.'

/** Her profile photo, resized by Substack's CDN.
 *
 *  The size matters more than it looks: the original is 2848x2846 and **2.77 MB**, which is
 *  an absurd thing to download for a 44px avatar and would be the heaviest asset on Home by
 *  a wide margin. The same image through the CDN at 96px is 4 KB. Ask for twice the display
 *  size so it stays sharp on a 2x screen, and no more. */
const AUTHOR_PHOTO_SOURCE =
  'https://substack-post-media.s3.amazonaws.com/public/images/de58ebf7-12be-47cf-af91-33dd25fa92ac_2848x2846.jpeg'
export const authorPhoto = (px: number) =>
  `https://substackcdn.com/image/fetch/w_${px},h_${px},c_fill,f_auto,q_auto:good/` +
  encodeURIComponent(AUTHOR_PHOTO_SOURCE)

// ─── Topic ──────────────────────────────────────────────────────────────────────

// Roughly half of what she writes is about the Women's Baseball World Cup, which this
// section knows nothing about: no teams, no players, no games to hang it on. Those posts
// are not mirrored at all, so the rail stays a WPBL surface and never shows a card whose
// every link would be dead.
//
// Tags rather than inference, because she applies them herself and a human's own filing is
// more reliable than anything we would guess from the prose. A post carrying both tags (she
// has written at least one) counts as WPBL: the league tag is the inclusive signal.
const WPBL_TAGS = new Set(['wpbl', "women's pro baseball league"])
const WORLD_CUP_TAG = "women's baseball world cup"

/**
 * Is this post about the league, by her own tagging?
 *
 * The World Cup tag EXCLUDES, even alongside a WPBL tag. She has one post tagged both
 * ("The Women's Baseball World Cup Group Stages are set") and it is a World Cup post that
 * happens to mention the league, so the inclusive reading of the WPBL tag lets exactly the
 * wrong thing through. Untagged posts are excluded too: every post in the archive carries
 * at least one tag today, so an untagged one is new behaviour worth a look rather than a
 * guess.
 */
export function isWpblPost(tags: readonly string[]): boolean {
  const lower = tags.map(t => t.trim().toLowerCase())
  if (lower.includes(WORLD_CUP_TAG)) return false
  return lower.some(t => WPBL_TAGS.has(t))
}

// ─── Read time ──────────────────────────────────────────────────────────────────

/**
 * Effective reading rate, in words per minute.
 *
 * Slower than the ~240wpm figure the research gives for average adult non-fiction reading,
 * and deliberately so. This is not a stopwatch on the prose, it is an estimate of how long
 * the post will actually take, and hers are dense: stat lines you stop and re-read, a
 * scoreline you check against the box score, and a photo or two to look at along the way.
 * At 220 the estimates read as optimistic against the real thing.
 *
 * Note this rate is doing the work that a separate per-image allowance would otherwise do.
 * That was measured before being folded in rather than assumed: across her feed the posts
 * average 1.4 images and 4.8 caption words each, so images cost seconds, not minutes, and
 * are not worth a column in the table and a migration to carry them. If she ever files a
 * photo essay this will read low, and that is the point to add a real image count.
 */
const WORDS_PER_MINUTE = 200

/**
 * Seconds allowed for each baseball clip embedded in a post.
 *
 * Her posts are not only prose: she embeds YouTube clips of the plays she is describing, and
 * the WPBL ones carry up to five. Counting only the words made a short video-heavy post read
 * as far quicker than it is. "I Cannot Overstate... Denae Benites" is 722 words and three
 * clips, so the words alone said 4 minutes for something nearer 6.
 *
 * 30 seconds is the allowance because of HOW she embeds them. Most carry a `?start=` deep
 * link into a longer highlight reel or broadcast, so the reader is being pointed at one
 * play rather than a whole video: they watch the thing described and read on. A baseball
 * play runs 15 to 30 seconds, and this leans to the long end for the same reason the
 * rounding does, below.
 */
const SECONDS_PER_VIDEO = 30

/**
 * "N min read": the words, plus time to watch whatever is embedded in them.
 *
 * `videoCount` is null for a post old enough to have left the RSS window, since the archive
 * API carries no body to count embeds in. Null is treated as zero here, which under-counts
 * rather than inventing a number for something we cannot see.
 *
 * Rounds UP. A read-time badge is a promise about someone's next few minutes, and the two
 * directions of error are not equal: over-promising and finishing early is a small pleasant
 * surprise, while under-promising leaves a reader who trusted the number stranded mid-piece.
 * Floored at 1 so a short post, or one whose word count never reached us, never advertises
 * "0 min read".
 */
export function readMinutes(
  wordCount: number | null | undefined,
  videoCount?: number | null,
): number {
  const words = wordCount && wordCount > 0 ? wordCount : 0
  const videos = videoCount && videoCount > 0 ? videoCount : 0
  const minutes = words / WORDS_PER_MINUTE + (videos * SECONDS_PER_VIDEO) / 60
  return Math.max(1, Math.ceil(minutes))
}

/**
 * How many video embeds a post's HTML carries.
 *
 * Every embed in her feed today is a YouTube iframe (Substack uses the privacy-mode
 * `youtube-nocookie` host, the same one our own highlights lightbox uses). Matching on the
 * host rather than on `<iframe>` alone matters: Substack also injects iframes of its own for
 * subscribe widgets and post embeds, and counting those as baseball would inflate the
 * estimate on exactly the posts that have no video in them at all.
 */
export function countVideos(html: string): number {
  const iframes = html.match(/<iframe\b[^>]*>/gi) ?? []
  return iframes.filter(tag => /youtube(-nocookie)?\.com|youtu\.be/i.test(tag)).length
}

// ─── RSS parsing ────────────────────────────────────────────────────────────────
// Same reasoning as sync-wpbl-youtube.mjs: the feed is small, well-formed RSS with a fixed
// shape, so scoped regexes beat adding an XML parser dependency. We read it for one reason
// only: the article body, so names can be found in it. That body is never stored.

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    // Ampersand last, so "&amp;lt;" doesn't decode twice into a tag.
    .replace(/&amp;/g, '&')
}

function tagText(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`))
  return m ? m[1] : ''
}

export interface FeedPost {
  /** The post's URL, which is how a feed item is matched to its archive-API row. */
  link: string
  title: string
  /** The article body as plain text. Held in memory for matching, never persisted. */
  text: string
  /** Embedded baseball clips, counted from the markup before it was stripped. The count is
   *  kept; the markup it came from is not. */
  videos: number
}

/** Pull each item's link, title and de-tagged body out of the RSS feed. */
export function parseFeed(xml: string): FeedPost[] {
  const out: FeedPost[] = []
  for (const raw of xml.split('<item>').slice(1)) {
    const block = raw.split('</item>')[0]
    const link = decodeEntities(tagText(block, 'link')).trim()
    if (!link) continue
    const html = tagText(block, 'content:encoded')
    out.push({
      link,
      title: decodeEntities(tagText(block, 'title')).trim(),
      // Strip markup, then collapse whitespace, so a name split across an <em> or a line
      // break still reads as "First Last" to the matcher below.
      text: decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(),
      // Counted from the markup, which is the only place the embeds exist: stripping tags
      // for `text` above throws every iframe away.
      videos: countVideos(html),
    })
  }
  return out
}

// ─── Entity matching ────────────────────────────────────────────────────────────

// Curly apostrophes, accents and casing all differ between her prose and our roster rows,
// and any one of them silently costs a match. Normalise both sides the same way once.
function normalize(s: string): string {
  return s
    // Decompose, then drop the combining marks, so "Geldenhuís" and "Geldenhuis" agree.
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u02bc]/g, "'")   // curly + modifier apostrophes -> plain
    .replace(/[\u2010-\u2015]/g, '-')         // every dash Substack emits -> hyphen
    .toLowerCase()
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Does `haystack` contain `phrase` as whole words? Deliberately not a substring test:
 *  without the boundaries, the roster's "Frank" would match "frankly". */
function containsPhrase(haystack: string, phrase: string): boolean {
  if (!phrase) return false
  return new RegExp(`(?<![\\w'])${escapeRe(phrase)}(?![\\w'])`, 'i').test(haystack)
}

/**
 * Which rostered players this post names, by FULL name only.
 *
 * Surname-only matching was measured on the live feed and adds two to six more hits per
 * post, but it cannot tell one Moore from another, and the surfaces this feeds are a
 * player's own page and a "written about" list. There, a confident wrong link is worse than
 * an honest gap: the reader has no way to tell it is wrong except by reading the piece and
 * finding themselves somewhere else. So: full names, or nothing.
 */
export function matchPlayers(text: string, players: readonly WpblPlayer[]): string[] {
  const hay = normalize(text)
  const ids: string[] = []
  for (const p of players) {
    const name = normalize(p.name ?? '')
    // A single-token name has no surname to disambiguate it, so it is exactly the case
    // full-name matching is meant to exclude.
    if (!name || !name.includes(' ')) continue
    if (containsPhrase(hay, name)) ids.push(p.id)
  }
  return ids
}

/**
 * How many times a club has to be named in the body before the post counts as being ABOUT
 * that club rather than merely mentioning it.
 *
 * Measured, not guessed. Across her live feed the two populations barely overlap: a club
 * the post is actually about is named 8 to 15 times, and a passing nod on the way to
 * somewhere else is named 1 to 3. Four sits in the empty space between them.
 *
 * This matters because of where team_ids is rendered: the club badges on an article card,
 * in the rail and in the archive. Those badges answer "who is this about" at a glance, and
 * a post that mentions the Hunters once in a paragraph about someone else is not about the
 * Hunters. Without the threshold one essay carried all four badges, which tells the reader
 * nothing and crowds out the date and the read time beside it.
 *
 * (The threshold was originally introduced for a "written about this club" list on the team
 * page. That surface has since been removed, but the rule earns its place on the badges.)
 */
export const TEAM_BODY_MENTIONS = 4

/** How many times `phrase` appears in `haystack` as whole words. */
function countPhrase(haystack: string, phrase: string): number {
  if (!phrase) return 0
  return haystack.match(new RegExp(`(?<![\\w'])${escapeRe(phrase)}(?![\\w'])`, 'gi'))?.length ?? 0
}

/**
 * Which clubs this post is about.
 *
 * Three ways a club qualifies, and each covers a case the others miss:
 *
 * 1. **Named in the headline.** If she put the club in the title, the post is about the
 *    club, however few times the body then repeats the name.
 * 2. **Named repeatedly in the body**, at or above TEAM_BODY_MENTIONS.
 * 3. **The club of a player named in the headline.** A profile is about that player's team
 *    whether or not it keeps saying so. "I Cannot Overstate to You How Good Denae Benites is
 *    Playing WPBL Baseball Right Now" is 722 words of New York Heights baseball that happens
 *    to say "Heights" exactly once, so rules 1 and 2 both passed it over and its card showed
 *    no club badge at all.
 *
 * Nicknames and city+nickname only, never a bare city. This is the trap a test run against
 * the live feed walked straight into: her World Cup coverage mentions Boston and San
 * Francisco as places where tournament baseball is played, and bare-city matching filed
 * four tournament essays under WPBL clubs. Nicknames ("Hunters", "Heights", "Queens") are
 * unambiguous in a baseball context; cities are not.
 *
 * Rule 3 is deliberately limited to the HEADLINE. Extending it to every player named
 * anywhere in the body would undo rule 2 entirely: her game write-ups name a dozen players
 * from both clubs plus a few from elsewhere, so every post would claim every team again.
 * A name in the headline is the piece announcing its own subject.
 */
export function matchTeams(
  title: string,
  body: string,
  teams: readonly WpblTeam[],
  players: readonly WpblPlayer[] = [],
): string[] {
  const head = normalize(title)
  const hay = normalize(body)

  // Rule 3, resolved first so it can be folded in below rather than appended out of order.
  const featuredTeams = new Set(
    matchPlayers(title, players)
      .map(id => players.find(p => p.id === id)?.team_id)
      .filter((t): t is string => !!t),
  )

  const ids: string[] = []
  for (const t of teams) {
    const nickname = normalize(t.name ?? '')
    const full = normalize(`${t.city ?? ''} ${t.name ?? ''}`.trim())
    if (!nickname) continue
    const inTitle = containsPhrase(head, full) || containsPhrase(head, nickname)
    // Count the nickname only. "Boston Hunters" contains "Hunters", so counting both would
    // double every full-name mention and halve the effective threshold.
    const mentions = countPhrase(hay, nickname)
    if (inTitle || mentions >= TEAM_BODY_MENTIONS || featuredTeams.has(t.id)) ids.push(t.id)
  }
  return ids
}

// ─── Game matching ──────────────────────────────────────────────────────────────

/** How long after a game she might still be filing the recap of it. She writes the morning
 *  after a night game, so a day and a half covers the real cases without reaching so far
 *  forward that it catches the NEXT meeting of the same two clubs. */
const RECAP_WINDOW_MS = 48 * 60 * 60 * 1000

/** Pull "10-8" (or "10–8", en dash) out of a headline as a sorted high-low pair. */
export function parseTitleScore(title: string): [number, number] | null {
  const m = title.match(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})\b/)
  if (!m) return null
  const a = Number(m[1]), b = Number(m[2])
  if (a === b) return null   // a tie is not a final score, so this is some other number pair
  return a > b ? [a, b] : [b, a]
}

/**
 * The game this post recaps, or null.
 *
 * Requires all three signals to agree: exactly two clubs named, a publish time within the
 * recap window of a game between them, and a score in the headline matching that game's
 * final. Any one alone is far too loose: she writes about the Hunters constantly, and most
 * of those posts are not recaps of a particular night.
 *
 * The score requirement is what makes this safe, and it is also why this stays best-effort:
 * a recap headlined without the score simply doesn't link, which is the intended failure.
 */
export function matchGame(
  opts: { title: string; publishedAt: string; teamIds: readonly string[] },
  games: readonly WpblGame[],
): string | null {
  if (opts.teamIds.length !== 2) return null
  const score = parseTitleScore(opts.title)
  if (!score) return null
  const at = Date.parse(opts.publishedAt)
  if (Number.isNaN(at)) return null
  const pair = new Set(opts.teamIds)

  const hits = games.filter(g => {
    if (g.status !== 'final') return false
    if (!pair.has(g.home_team_id) || !pair.has(g.away_team_id)) return false
    if (g.home_team_id === g.away_team_id) return false
    if (g.home_score == null || g.away_score == null) return false
    const hi = Math.max(g.home_score, g.away_score)
    const lo = Math.min(g.home_score, g.away_score)
    if (hi !== score[0] || lo !== score[1]) return false
    // The game must precede the post: a scheduled-date parse gives midnight local, so allow
    // the post to land any time from that morning up to the window's end.
    const start = Date.parse(`${g.game_date}T00:00:00Z`)
    if (Number.isNaN(start)) return false
    return at >= start && at - start <= RECAP_WINDOW_MS
  })

  // Two candidates means a doubleheader or an identical score in the same window, and we
  // cannot tell which she wrote about. Say nothing.
  return hits.length === 1 ? hits[0].id : null
}

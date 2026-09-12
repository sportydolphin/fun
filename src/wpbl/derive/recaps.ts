/**
 * This is Women's Baseball: their game recaps, resolved to our games.
 *
 * They write one recap per WPBL game and gave us explicit permission to link to them. What this
 * module does is the only hard part of that: their posts carry no game id, no date field beyond
 * a publication timestamp, and a headline written for a reader rather than for us. Deciding
 * which of our 33 games a given headline is about is a judgement call, and this is where every
 * one of those calls lives, pure and testable.
 *
 * WHAT WE KEEP IS A LINK. A headline, their picture, the date, their name. The feed offers the
 * lede as well and we decline it: on recaps this short it is close to half the article. The
 * table has no column for prose at all, which is the same enforcement docs/READING.md uses for
 * the other source. See docs/RECAPS.md.
 *
 * Pure: a feed and a schedule in, matches out. No supabase, no React, no fetch.
 */

/** Their site, and the name that goes under every card. Their own styling, from the masthead
 *  and the `author` meta on every post. There is no personal byline anywhere on the site, so
 *  the publication IS the credit; do not invent one from the contact address. */
export const PUBLICATION_NAME = 'This is Women’s Baseball'
export const PUBLICATION_URL = 'https://thisiswomensbaseball.com'
export const FEED_URL = 'https://thisiswomensbaseball.com/f.rss'
/**
 * Every post they have published, which the feed does not give you.
 *
 * The feed stops at 50 items and ignores `?page=`, `?limit=` and `?offset=` alike, so it is a
 * window rather than an archive. It reaches back to March today and covers every recap of the
 * season; it will not once they have published fifty more. Nothing reads this yet, and it is
 * here so that the day the window closes over the back catalogue, the fix is known.
 */
export const SITEMAP_URL = 'https://thisiswomensbaseball.com/sitemap.blog.xml'

/**
 * Central, restated rather than imported.
 *
 * `WPBL_TZ` in constants.ts is the same string, and importing it would pull the team logos in
 * as Vite assets, which is exactly why `outsToIp` lives in innings.ts. This module is bundled
 * for Node by the sync job, where that import is at best dead weight and at worst a build error.
 */
const CENTRAL = 'America/Chicago'

/** One post, as the feed describes it. */
export interface FeedRecap {
  title: string
  url: string
  publishedAt: Date
  /** Their title image, absolute. Null for a post that has none. */
  coverUrl: string | null
}

/** What the matcher needs to know about one of our games. A structural type, so a caller can
 *  hand it a `WpblGame` or the four columns it read out of the database. */
export interface RecapGame {
  id: string
  /** Central calendar date, `YYYY-MM-DD`, exactly as `wpbl_games.game_date` stores it. */
  game_date: string
  home_team_id: string
  away_team_id: string
  home_score: number | null
  away_score: number | null
}

// ─── Reading the feed ────────────────────────────────────────────────────────

const unwrap = (s: string | null | undefined): string => (s ?? '')
  .replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, '\'')
  // Last, so an entity that encodes an ampersand ("&amp;quot;") cannot be unescaped twice.
  .replace(/&amp;/g, '&')
  .trim()

const field = (item: string, name: string): string | null => {
  const m = item.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`))
  return m ? unwrap(m[1]) : null
}

/**
 * Their RSS into the four things we keep.
 *
 * THE COVER IMAGE IS THE FIRST `<img>` IN THE BODY, which sounds fragile and is not: their
 * publishing tool puts the title card there on every post, and the same URL is the page's own
 * `og:image`, so the two independent places they state it agree. A post with no image yields
 * null rather than a guess.
 *
 * Hand-rolled rather than an XML library because this runs in a bundled Node script and the
 * shape is four fields of one flat element. A malformed item yields nothing and is skipped,
 * which is the right failure: a feed we cannot read should cost us a night's recap, not a job.
 */
export function parseRecapFeed(xml: string): FeedRecap[] {
  const items = [...(xml ?? '').matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1])
  const out: FeedRecap[] = []
  for (const item of items) {
    const title = field(item, 'title')
    const url = field(item, 'link') ?? field(item, 'guid')
    const pub = field(item, 'pubDate')
    if (!title || !url || !pub) continue
    const at = new Date(pub)
    if (Number.isNaN(at.getTime())) continue
    const body = field(item, 'content:encoded') ?? ''
    const img = body.match(/<img[^>]+src="([^"]+)"/)
    out.push({ title, url, publishedAt: at, coverUrl: img ? unwrap(img[1]) : null })
  }
  return out
}

/**
 * Their title card at the size we actually draw it.
 *
 * Their CDN takes isteam transforms, and it is worth the two lines: the Sep 11 card is 248 KB
 * at source and 18 KB at `rs=w:320`. A card 108px wide on a 2x screen wants 320 and no more.
 *
 * ONLY EVER ON THEIR OWN HOST. A `cover_url` is a string out of a database, and appending
 * transform parameters to an arbitrary URL is how you end up "resizing" somebody's tracking
 * pixel. Anything that is not their image CDN is returned untouched.
 *
 * Their CDN rejects `fmt=webp` in every position tried, which is why this asks only for a
 * width: a 400 there would mean no image at all rather than a larger one.
 */
export function recapThumb(coverUrl: string | null | undefined, width = 320): string | null {
  if (!coverUrl) return null
  if (!/^https:\/\/img\d*\.wsimg\.com\//.test(coverUrl)) return coverUrl
  if (coverUrl.includes('/:/')) return coverUrl   // already transformed, leave it alone
  return `${coverUrl}/:/rs=w:${Math.round(width)}`
}

// ─── Which game a headline is about ──────────────────────────────────────────

/**
 * Every word they use for each club.
 *
 * Nicknames and cities both, because they alternate freely inside one week: "Firebells hold off
 * Hunters" and "Los Angeles rallies late for 8-6 win over Boston" are the same kind of headline.
 */
export const CLUB_WORDS: Readonly<Record<string, readonly string[]>> = {
  SF: ['firebells', 'san francisco'],
  BOS: ['hunters', 'boston'],
  NY: ['heights', 'new york'],
  LA: ['queens', 'los angeles'],
}

/** The clubs a headline names, by our team id. */
export function clubsNamed(title: string): string[] {
  const t = (title ?? '').toLowerCase()
  return Object.keys(CLUB_WORDS).filter(id => CLUB_WORDS[id].some(w => t.includes(w)))
}

/**
 * The Central calendar date an instant falls on.
 *
 * `Intl` rather than subtracting five hours, which is what the first draft did. The season ends
 * in September so the offset happens to be constant through it, and a constant that is only
 * right until November is the kind that is wrong in the spring with nobody watching.
 */
export function centralDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CENTRAL, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at)
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** The two numbers a headline offers as a final score, high first, or null. */
export function scoreNamed(title: string): [number, number] | null {
  const m = (title ?? '').match(/\b(\d{1,2})\s*-\s*(\d{1,2})\b/)
  if (!m) return null
  const a = Number(m[1]), b = Number(m[2])
  return a >= b ? [a, b] : [b, a]
}

const sameScore = (a: [number, number] | null, b: [number, number] | null): boolean =>
  !!a && !!b && a[0] === b[0] && a[1] === b[1]

/** How a recap was placed. Stored, because these are judgement calls about someone else's
 *  headline and the day one is wrong the first question is which rule made it. */
export type RecapMatchKind =
  | 'both clubs' | 'clubs+score' | 'club played once' | 'one club+score'
  | 'no club, sole game' | 'next night'

export interface RecapMatch {
  gameId: string
  post: FeedRecap
  how: RecapMatchKind
}

/**
 * Their recaps, placed against our schedule.
 *
 * TWO PHASES, AND THE ORDER IS THE DESIGN. Every tight same-night match is made first, across
 * all games, before anything is allowed to reach into the following night. A draft that widened
 * the window to a day either side for every game at once scored WORSE than the tight rule alone
 * (31 of 33 down to 23), because a recap posted the next night competes with the game that night
 * actually had, and both end up ambiguous. Phase two only ever sees a game nothing claimed and a
 * post nothing claimed.
 *
 * THE RULES, IN DESCENDING CONFIDENCE. All of them are same-night except the last:
 *
 *   both clubs          the headline names both of these clubs and only these  (21 of 33)
 *   clubs+score         two such headlines, and one carries this game's score
 *   club played once    one club named, and that club played exactly ONE game that day, so the
 *                       post cannot be about any other  (10 of 33)
 *   one club+score      one club named and the headline's score is this game's
 *   no club, sole game  a headline naming a player and no club, on a single-game night   (1)
 *   next night          phase two: both clubs AND the exact score, for a recap filed late   (1)
 *
 * "Club played once" replaced "only one game was played that day", which is the same thing on a
 * quiet night and gives up on a two-game night where each club still played once. That cost one
 * game: Aug 8 had two, and "Hunters Erase Six-Run Deficit for First Win" names one club that
 * played one game and is therefore unambiguous.
 *
 * THE BIAS IS TOWARDS SAYING NOTHING, exactly as derive/articles.ts puts it. An unmatched game
 * shows no card, which is a small loss; a recap of somebody else's game shown under this one is
 * a mistake a reader notices and does not forgive. Measured Sep 12, 2026: 33 of 33 games placed,
 * nothing ambiguous, every recap-era post claimed exactly once.
 */
export function matchRecaps(posts: readonly FeedRecap[], games: readonly RecapGame[]): RecapMatch[] {
  const played = games.filter(g => g.home_score != null && g.away_score != null)
  const claimed = new Set<string>()
  const out: RecapMatch[] = []

  const gamesOn = (date: string) => played.filter(g => g.game_date === date)
  /** Did every club this headline names play exactly once that day? Then it cannot be about
   *  another game, whatever else was on. */
  const playedOnce = (ids: readonly string[], date: string) => ids.length > 0 &&
    ids.every(id => gamesOn(date).filter(g => g.home_team_id === id || g.away_team_id === id).length === 1)

  const take = (gameId: string, post: FeedRecap, how: RecapMatchKind) => {
    claimed.add(post.url)
    out.push({ gameId, post, how })
  }

  // ── phase 1: the night of the game ─────────────────────────────────────────
  for (const g of played) {
    const want = new Set([g.home_team_id, g.away_team_id])
    const score = scoreNamed(`${g.home_score}-${g.away_score}`)
    const tonight = posts.filter(p => !claimed.has(p.url) && centralDate(p.publishedAt) === g.game_date)

    const both = tonight.filter(p => {
      const named = new Set(clubsNamed(p.title))
      return [...want].every(x => named.has(x))
    })
    // Names one of ours, and nobody else's: a headline naming a third club is about another game.
    const one = tonight.filter(p => {
      const named = clubsNamed(p.title)
      return named.length > 0 && named.some(x => want.has(x)) && named.every(x => want.has(x))
    })
    const silent = tonight.filter(p => clubsNamed(p.title).length === 0)

    if (both.length === 1) { take(g.id, both[0], 'both clubs'); continue }
    if (both.length > 1) {
      const byScore = both.filter(p => sameScore(scoreNamed(p.title), score))
      if (byScore.length === 1) take(g.id, byScore[0], 'clubs+score')
      continue
    }
    if (one.length === 1 && playedOnce(clubsNamed(one[0].title), g.game_date)) {
      take(g.id, one[0], 'club played once'); continue
    }
    if (one.length === 1 && sameScore(scoreNamed(one[0].title), score)) {
      take(g.id, one[0], 'one club+score'); continue
    }
    if (one.length === 0 && silent.length === 1 && gamesOn(g.game_date).length === 1) {
      take(g.id, silent[0], 'no club, sole game')
    }
  }

  // ── phase 2: a recap filed the following night ─────────────────────────────
  // The strongest evidence there is, and nothing less: both clubs named and the score agreeing.
  // Anything weaker would start pulling the next day's recaps onto the previous day's games.
  const done = new Set(out.map(m => m.gameId))
  for (const g of played) {
    if (done.has(g.id)) continue
    const want = new Set([g.home_team_id, g.away_team_id])
    const score = scoreNamed(`${g.home_score}-${g.away_score}`)
    const late = posts.filter(p => {
      if (claimed.has(p.url) || centralDate(p.publishedAt) !== addDays(g.game_date, 1)) return false
      const named = new Set(clubsNamed(p.title))
      return [...want].every(x => named.has(x)) && sameScore(scoreNamed(p.title), score)
    })
    if (late.length === 1) take(g.id, late[0], 'next night')
  }

  return out
}

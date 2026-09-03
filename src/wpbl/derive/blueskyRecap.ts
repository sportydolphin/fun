// What a finished WPBL game looks like on Bluesky: one post, and a box-score card drawn as
// an image.
//
// Pure, and beside the recap engine it renders, for the same reasons discordRecap.ts is:
// what gets published to a public timeline is worth unit testing, and the sender exits on
// missing env at import time, so a test cannot load it.
//
// TWO THINGS ABOUT BLUESKY SHAPE EVERYTHING HERE, and neither applies to Discord.
//
// 1. A POST IS CAPPED AT 300 GRAPHEMES, counted the way `Intl.Segmenter` counts, not the way
//    `String.length` does. An accented name or an emoji costs one, not two. The cap is
//    enforced by the server, so a post that overruns is rejected outright rather than clipped.
//
// 2. THERE IS NO MONOSPACE AND NO CODE BLOCK. Discord's box score works because
//    `lineScoreBlock` wraps a space-padded table in a fence; the identical string in Bluesky's
//    proportional font is ragged nonsense. So the box score is not a smaller version of the
//    Discord one, it is an image, and the text post carries only what reads as prose.
import type { WpblGame, WpblTeam } from '../types'
import type { GameRecap } from './recap'
import { lineScoreGrid } from './discordRecap.ts'

const SITE = 'sportydolphin.fun'

/** Bluesky counts graphemes. "Maïka" is 5 here and 6 to `String.length`, and a post measured
 *  the wrong way is one the server refuses. */
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
export const graphemes = (s: string): number => [...segmenter.segment(s)].length

/** The first `n` graphemes, with an ellipsis, never splitting a character in half. */
export function clip(s: string, n: number): string {
  const units = [...segmenter.segment(s)].map(g => g.segment)
  return units.length <= n ? s : `${units.slice(0, Math.max(0, n)).join('').trimEnd()}…`
}

export const POST_LIMIT = 300

export interface BlueskyPost {
  text: string
  /** Alt text for the card. Not optional: an image carrying the entire box score with no
   *  description is the whole game hidden from anybody using a screen reader. */
  alt: string
  url: string
}

/** "F", or "F/8" when it went past regulation, which is how a score line says extras. */
export function finalTag(recap: GameRecap): string {
  return recap.innings === 7 ? 'F' : `F/${recap.innings}`
}

/**
 * The post, trimmed to fit.
 *
 * Assembled in priority order and shortened from the BOTTOM, because the parts are not equally
 * worth keeping: the score and the link have to survive, the narrative is what makes it worth
 * reading, and the star line is the first thing anybody would drop. Measured on the finished
 * string rather than estimated, since the trim changes the string it is measuring.
 *
 * On the 20 finals to Aug 23 the untrimmed post ran 228 to 308 graphemes, so this fires rarely
 * and matters absolutely when it does: over the cap is not a long post, it is no post.
 */
export function buildBlueskyPost(game: WpblGame, recap: GameRecap, teams: Map<string, WpblTeam>, gameUrl: string): BlueskyPost {
  // Required, and passed in rather than built here, for the reasons on buildRecapMessage.
  // It matters more on this side: these posts are public and crawlable, so each one is an
  // inbound link to a distinct page, and inbound links are the one thing the section cannot
  // ship its way out of. Pointed at the legacy `?game=` spelling they all land on a 301.
  const url = gameUrl
  const score = `${recap.winner.name} ${recap.winnerScore}, ${recap.loser.name} ${recap.loserScore} (${finalTag(recap)})`
  const stars = recap.stars.slice(0, 2).map(s => `${s.name} ${s.statline}`)

  // Longest first, then progressively less. The last entry keeps only what cannot be dropped.
  const candidates = [
    [score, recap.blurb, stars.join(' · '), url],
    [score, recap.blurb, stars[0] ?? '', url],
    [score, recap.blurb, '', url],
  ]
  // Note there is deliberately no "score and link only" candidate. Dropping the sentence is
  // always worse than shortening it, and having that option here would make the clip below
  // unreachable.
  const render = (parts: string[]) => parts.filter(Boolean).join('\n\n')
  const fitted = candidates.map(render).find(t => graphemes(t) <= POST_LIMIT)
  // Last resort, and only reachable if the narrative alone is enormous: keep it and cut it,
  // rather than publishing a bare score with no sentence. Cut by GRAPHEME, since slicing a
  // string mid-character is how a name like Maïka becomes a replacement glyph in public.
  const text = fitted
    ?? render([score, clip(recap.blurb, POST_LIMIT - graphemes(render([score, '', '', url])) - 3), '', url])

  return { text, alt: boxScoreAlt(game, recap, teams), url }
}

/**
 * The card described in words, for anybody who cannot see it.
 *
 * Reads the same grid the picture does, so the two cannot disagree, and spells the innings out
 * in order rather than saying "a box score", which describes nothing.
 */
export function boxScoreAlt(game: WpblGame, recap: GameRecap, teams: Map<string, WpblTeam>): string {
  const { innings, rows } = lineScoreGrid(game, recap, teams)
  const line = rows.map(r =>
    `${r.abbr} ${r.cells.join(' ')}, ${r.r} runs, ${r.h} hits, ${r.e} errors`).join('. ')
  return `Box score, innings 1 to ${innings}. ${line}.`
}

/**
 * The rich-text facet that makes the link in the post clickable.
 *
 * BLUESKY INDEXES FACETS BY UTF-8 BYTE OFFSET, not by JavaScript string index, and the two
 * differ the moment anything non-ASCII appears earlier in the post. Our recaps are full of
 * names like Maïka Dumais and of "·" separators, each of which is one JS character and two
 * UTF-8 bytes. Get this wrong and the post still publishes, with the underline sitting a few
 * characters to the left of the URL and part of a player's name inside the link. Nothing
 * errors; it just looks broken to everybody but us.
 *
 * Returns [] when the url is not in the text, rather than a facet pointing at nothing.
 */
export function linkFacets(text: string, url: string): unknown[] {
  const at = text.indexOf(url)
  if (at < 0) return []
  const enc = new TextEncoder()
  const byteStart = enc.encode(text.slice(0, at)).length
  const byteEnd = byteStart + enc.encode(url).length
  return [{
    index: { byteStart, byteEnd },
    // The text says "sportydolphin.fun/..." with no scheme, because it reads better; the
    // target still needs one or the client will not open it.
    features: [{ $type: 'app.bsky.richtext.facet#link', uri: url.startsWith('http') ? url : `https://${url}` }],
  }]
}

// ── The card ────────────────────────────────────────────────────────────────────────────────

const CARD = { w: 1200, h: 600, pad: 64 }
const INK = { bg: '#0f1218', panel: '#171b23', text: '#f3f5f8', dim: '#9aa4b2', rule: '#2a303b' }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * "2026-08-22" as "Aug 22, 2026", by string surgery and never through `new Date`.
 *
 * A bare date parsed as a Date is treated as midnight UTC and then printed in the local zone,
 * which in every American timezone is the evening BEFORE. A card that labels a Saturday game
 * as Friday is wrong in a way nobody reports; they just quietly stop trusting it.
 */
export function cardDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''))
  if (!m) return String(value ?? '')
  const [, y, mm, dd] = m
  return `${MONTHS[Number(mm) - 1] ?? mm} ${Number(dd)}, ${y}`
}

const esc = (s: string) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A team's brand colour when it is a usable hex, and the neutral otherwise. Straight from the
 *  feed, so it is checked rather than trusted. */
export function accentOf(team: WpblTeam | undefined): string {
  const hex = (team?.color ?? '').replace('#', '').trim()
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex}` : '#e8412c'
}

/**
 * The box score as an SVG, which the sender rasterises.
 *
 * SVG rather than a drawing API because it is a string: it is pure, it diffs, and it can be
 * asserted on in a test without a native renderer or a font on the machine running the test.
 * The rasteriser is the sender's problem.
 *
 * The columns are placed by ARITHMETIC, not by padding, which is the whole reason this exists
 * rather than a text post. Every cell is centred in its own fixed-width column, so the grid
 * lines up no matter what the glyphs are.
 */
export function boxScoreCard(game: WpblGame, recap: GameRecap, teams: Map<string, WpblTeam>): string {
  const { innings, rows } = lineScoreGrid(game, recap, teams)
  const accent = accentOf(teams.get(recap.winner.id))

  const nameX = CARD.pad
  const nameW = 150
  const colW = 62
  const gridX = nameX + nameW
  // R, H and E sit past a divider, with a gap so they read as a summary rather than as three
  // more innings.
  const summaryX = gridX + innings * colW + 34
  const headY = 300
  const rowY = (i: number) => headY + 60 + i * 58

  const t = (x: number, y: number, s: string, o: { size?: number; fill?: string; weight?: number; anchor?: string } = {}) =>
    `<text x="${x}" y="${y}" font-family="Inter" font-size="${o.size ?? 34}" font-weight="${o.weight ?? 400}" fill="${o.fill ?? INK.text}" text-anchor="${o.anchor ?? 'start'}">${esc(s)}</text>`

  const parts: string[] = [
    `<rect width="${CARD.w}" height="${CARD.h}" fill="${INK.bg}"/>`,
    `<rect x="0" y="0" width="${CARD.w}" height="10" fill="${accent}"/>`,
    t(CARD.pad, 108, `WPBL · ${cardDate(game.game_date)}`, { size: 30, fill: INK.dim, weight: 600 }),
    t(CARD.pad, 186, recap.headline, { size: 62, weight: 700 }),
    t(CARD.pad, 240, `${recap.winnerScore}-${recap.loserScore}${recap.innings === 7 ? '' : ` · ${recap.innings} innings`}`,
      { size: 34, fill: INK.dim, weight: 600 }),
    `<rect x="${CARD.pad}" y="${headY - 44}" width="${CARD.w - CARD.pad * 2}" height="${58 * rows.length + 74}" rx="18" fill="${INK.panel}"/>`,
  ]

  // Inning numbers, then R H E.
  for (let i = 0; i < innings; i++) {
    parts.push(t(gridX + i * colW + colW / 2, headY, String(i + 1), { size: 28, fill: INK.dim, weight: 600, anchor: 'middle' }))
  }
  ;['R', 'H', 'E'].forEach((k, i) => {
    parts.push(t(summaryX + i * colW + colW / 2, headY, k, { size: 28, fill: INK.dim, weight: 700, anchor: 'middle' }))
  })
  parts.push(`<line x1="${CARD.pad + 16}" y1="${headY + 22}" x2="${CARD.w - CARD.pad - 16}" y2="${headY + 22}" stroke="${INK.rule}" stroke-width="2"/>`)

  rows.forEach((r, ri) => {
    const y = rowY(ri)
    const won = r.teamId === recap.winner.id
    parts.push(t(nameX + 16, y, r.abbr, { size: 38, weight: 700, fill: won ? INK.text : INK.dim }))
    r.cells.forEach((c, i) => {
      parts.push(t(gridX + i * colW + colW / 2, y, String(c), { size: 34, fill: INK.text, anchor: 'middle' }))
    })
    ;[r.r, r.h, r.e].forEach((v, i) => {
      parts.push(t(summaryX + i * colW + colW / 2, y, String(v), {
        size: 34, weight: i === 0 ? 700 : 400, fill: i === 0 ? INK.text : INK.dim, anchor: 'middle',
      }))
    })
  })

  const decisions = recap.decisions.map(d => `${d.key} ${d.name}`).join('  ·  ')
  if (decisions) parts.push(t(CARD.pad, CARD.h - 96, decisions, { size: 28, fill: INK.dim, weight: 600 }))
  parts.push(t(CARD.pad, CARD.h - 44, SITE, { size: 28, fill: INK.dim, weight: 600 }))

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.w}" height="${CARD.h}" viewBox="0 0 ${CARD.w} ${CARD.h}">${parts.join('')}</svg>`
}

/** Every character the card will draw, so the sender can subset the font to exactly that.
 *  Missing one renders as nothing at all, silently, which is how an accented name disappears
 *  from a card that otherwise looks perfect. */
export function cardCharset(svg: string): string {
  const text = svg.match(/>([^<]*)</g)?.join('') ?? ''
  return [...new Set(text.replace(/[<>]/g, ''))].join('')
}

// ─── When a game is allowed to be posted ────────────────────────────────────

/**
 * Whether a final has settled long enough to publish.
 *
 * THE WINDOW IS MEASURED FROM THE LEAGUE'S CLOCK, NOT FROM WHEN WE NOTICED. It used to run
 * from `first_final_at`, the moment the poster's own cron first saw the game final, and that
 * quietly turned 45 minutes into most of a night. Two reasons, and only the second is obvious:
 *
 *   1. GitHub does not run the workflow when it is asked to. Over the thirty scheduled runs
 *      before Sep 3, 2026, gaps against a cron asking for every 15 minutes ran from 130 to 452
 *      minutes, and the repo's DAILY jobs landed four to eleven hours late as well, so this is
 *      the whole repository's scheduling being deprioritised rather than anything about this
 *      job. "When we first saw it" therefore means "whenever a runner happened to wake up".
 *
 *   2. A run that first sees a game can never also publish it, because it writes
 *      `first_final_at = now()` and then measures zero minutes against it. So a post always
 *      cost TWO of those gaps. Observed lag from final to post: 5.4, 5.7, 6.6, 9.8 and 12.2
 *      hours, for a window that says 45 minutes.
 *
 * `source_updated_at` is when the FEED last touched the game, so on a final it is when the
 * league finalised it or last corrected it, which is the exact event the window exists to wait
 * out. One run can now both see a game and publish it, and a late correction pushes the post
 * back rather than racing it.
 *
 * NEVER fall back to `updated_at`: that is our mirror's write time, and the nightly drift check
 * re-touches every game, so a game's window would restart every night and the settle could
 * never expire.
 */
export function isSettled(
  game: Pick<WpblGame, 'source_updated_at'>,
  firstFinalAt: string | null | undefined,
  settleMinutes: number,
  now: number = Date.now(),
): boolean {
  // The feed's stamp when there is one; otherwise the only other honest answer we hold.
  const basis = game.source_updated_at ?? firstFinalAt
  if (!basis) return false
  const at = new Date(basis).getTime()
  if (Number.isNaN(at)) return false
  return (now - at) / 60_000 >= settleMinutes
}

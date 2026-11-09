// newsWatch.js: the pure half of scripts/watch-wpbl-news.mjs, kept free of I/O so the rules that
// decide what reaches the owner's phone are unit-tested (src/__tests__/newsWatch.test.ts).
//
// WHY THIS EXISTS. Between seasons the league announces things in places the ingest never reads:
// a WordPress post (the 2027 roster explainer, Nov 8, 2026), a new page (the 2027 draft
// application, the same day), a player record whose status flips on a re-signing, a YouTube
// Short (2027 confirmed, Nov 7). Each was found by a person happening to look. The stats feed
// itself will carry the 2027 season one day with no announcement at all. This watches every one.
//
// THE MODEL. Each source yields items: { key, fingerprint, title, url, loud?, note? }. The store
// remembers (source, key) -> fingerprint. A key never seen is "added"; a key whose fingerprint
// moved is "changed". Nothing is ever reported twice, because the store moves with the report.
//
// A SOURCE NEVER SEEN BEFORE SEEDS SILENTLY. With no "before", every post the league has ever
// written would read as news. Adding a source later therefore costs nothing either.

/** Sources whose news goes to the phone. Everything else is a quiet Discord digest. */
export const LOUD_SOURCES = new Set([
  // The stats feed: a new season, club or game here means the ingest is about to change shape.
  'feed-season', 'feed-team', 'feed-game',
  // The league's own club and venue records: a new club is expansion, a new venue is where the
  // next season is played. Both are rare and both change what the site may say.
  'site-team', 'site-venue',
])

/**
 * Compare one source's items against what the store holds for it.
 *
 * @param {Map<string, string>} prev  key -> fingerprint, as stored. Empty means never seen.
 * @param {Array<{key: string, fingerprint: string, title: string, url?: string, loud?: boolean, note?: string}>} items
 * @param {{ seeded: boolean }} opts  seeded: the store has a record of this source at all
 * @returns {{ added: object[], changed: object[], seeding: boolean }}
 */
export function diffSource(prev, items, { seeded }) {
  const added = []
  const changed = []
  for (const item of items) {
    const before = prev.get(item.key)
    if (before === undefined) added.push(item)
    else if (before !== item.fingerprint) changed.push({ ...item, before })
  }
  if (!seeded) return { added: [], changed: [], seeding: true }
  return { added, changed, seeding: false }
}

/** Whether a reported item belongs on the phone. A source can also mark one item loud. */
export function isLoud(source, item) {
  return LOUD_SOURCES.has(source) || item.loud === true
}

/**
 * A calendar event or game counts as next-season news when it starts in a later year than the
 * season the site already knows. Pure so the year boundary is tested, not trusted.
 */
export function isNextSeasonDate(iso, knownSeasonYear) {
  const ms = Date.parse(iso ?? '')
  if (!Number.isFinite(ms)) return false
  return new Date(ms).getUTCFullYear() > knownSeasonYear
}

/** "&#8217;" and friends, as WordPress renders titles. Only the handful the league's titles use. */
export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .trim()
}

/** One line per report, for Discord and the run log. */
export function describe(source, kind, item) {
  const verb = kind === 'added' ? 'New' : 'Changed'
  const note = item.note ? `: ${item.note}` : ''
  return `${verb} ${SOURCE_LABELS[source] ?? source}: ${item.title}${note}`
}

export const SOURCE_LABELS = {
  'feed-season':      'feed season',
  'feed-team':        'feed club',
  'feed-game':        'feed game',
  'site-post':        'league post',
  'site-page':        'league page',
  'site-transaction': 'league transaction',
  'site-player':      'league player',
  'site-team':        'league club',
  'site-venue':       'league venue',
  'site-calendar':    'league calendar game',
  'site-game':        'league game page',
  'site-promo':       'league promo',
  'site-partner':     'league partner',
  'site-video':       'league site video',
  'youtube':          'league YouTube upload',
  'news':             'news story',
}

/**
 * Split lines into Discord messages under its 2000-character cap, never breaking a line.
 * A line longer than the cap on its own is cut, since Discord would refuse the whole message.
 */
export function chunkLines(header, lines, cap = 1900) {
  const out = []
  let cur = header
  for (const raw of lines) {
    const line = raw.length > cap - header.length - 2 ? raw.slice(0, cap - header.length - 3) + '…' : raw
    if (cur.length + 1 + line.length > cap) { out.push(cur); cur = header }
    cur += '\n' + line
  }
  if (cur !== header) out.push(cur)
  return out
}

/**
 * The phone's text: one push per run however many loud items, so a newly published season (one
 * season, four clubs, forty games at once) is one buzz, not forty-five.
 */
export function pushSummary(loud) {
  if (loud.length === 0) return null
  const first = loud[0]
  const title = loud.length === 1
    ? `WPBL: ${first.kind === 'added' ? 'new' : 'changed'} ${SOURCE_LABELS[first.source] ?? first.source}`
    : `WPBL: ${loud.length} new league data items`
  const body = loud.slice(0, 4).map(r => r.item.title).join(' · ') +
    (loud.length > 4 ? ` and ${loud.length - 4} more` : '')
  return { title, body }
}

/**
 * When a source's failures stop being weather. One bad read is the internet; this many in a row
 * (a day at the 3-hour cadence) means the source moved or broke, and the run goes red so
 * workflow-failure-alert pages it. Below it the run stays green and the failure is only logged.
 */
export const FAILURES_BEFORE_RED = 8

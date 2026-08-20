#!/usr/bin/env node
/**
 * sync-wpbl-commons.mjs: mirror freely licensed women's baseball photography from
 * Wikimedia Commons into the `wpbl_photos` table.
 *
 * WHY THIS EXISTS. Everything else under /wpbl dies with the league's feed on Sep 6. This is
 * the one surface that does not need a live game: the deep photographic record of women's
 * baseball, which Commons holds and almost nobody looks at. See the migration for the survey
 * that ruled out the obvious version of this feature (photos of *current* WPBL players:
 * Commons has essentially none, and will not have any this season).
 *
 * WHAT IT WRITES, AND WHAT IT REFUSES TO TOUCH. Rows land with `approved = false` and stay
 * invisible until a human says otherwise. The upsert payload deliberately omits `approved`,
 * `caption` and `sort_order`: PostgREST builds its ON CONFLICT SET list from the payload's
 * keys, so a column that is not in the payload is left alone on update. That is what stops a
 * weekly re-sync from unpublishing a curated caption or resurrecting a rejected photo. If you
 * ever add a column here, decide which side of that line it is on before adding it to `row`.
 *
 * THE USER-AGENT IS NOT OPTIONAL. Wikimedia's API throttles and then blocks anonymous
 * datacenter traffic without a contact-carrying UA (this was found the hard way: a bare
 * per-file sweep hit a "You are making too many requests" wall within two minutes). The same
 * finding is why this walks categories with a *generator*, fifty files per request, rather
 * than looking each file up on its own.
 *
 * Usage (local):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/sync-wpbl-commons.mjs
 *   node scripts/sync-wpbl-commons.mjs --dry-run     # read + report, write nothing
 *
 * Required env: SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY, which is how
 *               CI runs it. Failing those it falls back to SUPABASE_DB_URL, the connection
 *               string `npm run migrate` already uses, so a laptop needs no service-role key.
 *               None of the three is read under --dry-run.
 * Optional env: WPBL_COMMONS_DEPTH (default 1), WPBL_COMMONS_CONTACT (the UA's contact URL).
 */

import { createClient } from '@supabase/supabase-js'

// ─── Config ─────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run')

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

/**
 * The direct Postgres connection string, used only as a LOCAL fallback for the write.
 *
 * CI has the service-role key and takes the PostgREST path below; a laptop usually has this
 * instead, because it is what `npm run migrate` already needs. Without the fallback the only
 * way to seed the table by hand was to put a service-role key in `.env`, which is a worse
 * thing to leave sitting on a development machine than a password already in there.
 *
 * This is not a third write path in the sense CLAUDE.md warns about. It is the same actor as
 * the PostgREST branch, a privileged server-side job, reaching the same table over a different
 * wire. That rule protects the browser/service-role split, and nothing here touches the
 * browser's RLS path.
 */
const SUPABASE_DB_URL = (process.env.SUPABASE_DB_URL ?? '').trim()

const API = 'https://commons.wikimedia.org/w/api.php'

// Wikimedia's UA policy asks for a name and a way to reach whoever is running the job. The
// contact is overridable so a fork does not sit behind this site's address.
const CONTACT = (process.env.WPBL_COMMONS_CONTACT || '').trim() || 'https://sportydolphin.fun'
const USER_AGENT = `sportydolphin-wpbl-photos/1.0 (${CONTACT})`

/**
 * Where the walk starts. Deliberately a short hand-picked list rather than a broad search:
 * "baseball" on Commons is a hundred thousand files of men, and the surface this feeds is
 * about the other record.
 *
 * Sized as of Aug 2026 (files at depth 0): the WPBL category held 8, the AAGPBL 33, and
 * women's baseball 56, with roughly 250 reachable once subcategories are included. If that
 * pool ever grows enough to be a problem, tighten it here rather than in the filter.
 */
const SEED_CATEGORIES = [
  // The current league. Nearly empty today and listed first anyway: this is the category
  // that grows if the league's photography ever reaches Commons, and the walk should pick
  // that up on the next Sunday without anyone remembering to come back here.
  "Category:Women's Pro Baseball League",
  // The AAGPBL, 1943 to 1954. The bulk of what makes this feature worth having, and mostly
  // public domain via the Library of Congress, Florida Memory and archive Flickr streams.
  'Category:All-American Girls Professional Baseball League',
  // The wider record: the World Cup, national teams, players with no league category.
  "Category:Women's baseball",
]

/**
 * Subcategories the walk refuses to descend into.
 *
 * Not a substitute for the approval gate, which is what actually decides what ships. This is
 * only for whole subcategories that are reliably, categorically not photographs: the AAGPBL
 * logo category is twenty club wordmarks, and letting it through put twenty guaranteed
 * rejections into the review queue every week for no reason. Add to this only when a
 * category is wrong in its entirety, never to express taste about individual files.
 */
const SKIP_CATEGORIES = new Set([
  'Category:All-American Girls Professional Baseball League logos',
])

// How many levels of subcategory to follow. One is enough to reach the per-player categories
// (Betsy Jochum, Pat Scott) that hold the actual photographs, while staying clear of the
// places Commons' category graph wanders off to. Commons categories form a graph and not a
// tree, so the walk carries a visited set regardless.
const DEPTH = Number(process.env.WPBL_COMMONS_DEPTH || '1')

/**
 * The licence allow-list, tested against extmetadata's machine-readable `License` slug rather
 * than the human-readable name, which is free text and inconsistent.
 *
 * Commons is NOT uniformly free: it hosts non-free logos, fair-use claims and files whose
 * permission never actually arrived. Anything not matched here is dropped without being
 * written, so an unreviewed row can never be a licensing problem, only a taste one.
 *
 * `pd*` covers pd, pd-us, pd-old-70 and the rest of the public-domain family. GFDL-only files
 * are excluded on purpose: free, but the licence obliges us to reproduce its full text beside
 * the image, and no photograph here is worth that.
 */
const ALLOWED_LICENCE = /^(pd(-|$)|cc0(-|$)|cc-by-\d|cc-by-sa-\d)/i

/**
 * What a browser can display directly, and so what may be used as a fallback when a file has
 * no thumbnail (which happens for anything smaller than the size we asked for).
 *
 * SVG is excluded along with PDF and video: the seed categories' SVGs are club logos and a
 * locator map, which are not what a photo gallery is for.
 */
const WEB_NATIVE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

/**
 * What Commons will render a JPEG thumbnail of, which is a wider set than the browser can
 * open. Sixteen photographs in this pool are archival TIFF scans, and Commons serves those as
 * `lossy-page1-<W>px-<name>.tif.jpg`. Dropping them would lose some of the best material in
 * the archive for no reason other than the container.
 *
 * A TIFF has no fallback: its own URL is a .tif that no browser will paint, so a TIFF without
 * a thumbnail is skipped rather than linked.
 */
const RENDERABLE_MIME = new Set([...WEB_NATIVE_MIME, 'image/tiff'])

/**
 * Card and lightbox render widths, and they are NOT free choices.
 *
 * Wikimedia restricts its thumbnailer to a fixed ladder of widths and answers anything else
 * with `400 Use thumbnail sizes listed on …`. Probed Aug 19, 2026, the ladder is:
 *
 *   20 · 40 · 60 · 120 · 250 · 500 · 960 · 1280 · 1920 · 3840
 *
 * and it is the same for a JPEG and for a TIFF's JPEG render. 640 and 1600 are both rejected,
 * which is how this was found: the first version of this script picked those two, and every
 * image would have shipped broken.
 *
 * Both values below are on the ladder. **Do not change either to a width that is not**, and do
 * not assume the list above is permanent: it is Wikimedia's operational decision, not an API
 * contract, and it tightened at some point before this was written.
 */
const THUMB_W = 500
const FULL_W = 1280

// ─── Commons API ────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/**
 * One API call, with retries.
 *
 * 429 is the response that matters here, and it is retried with a widening backoff: a weekly
 * job that gave up on the first throttle would leave the table half-written, which looks
 * exactly like a curation decision and is not one.
 */
async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`
  let last = ''
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } })
    if (res.ok) {
      const json = await res.json().catch(() => null)
      if (json && !json.error) return json
      last = json?.error?.info ?? 'unparseable response'
    } else {
      last = `HTTP ${res.status} ${res.statusText}`
    }
    if (attempt < 4) {
      console.warn(`   ${last}, retrying (${attempt}/3)`)
      await sleep(2000 * attempt)
    }
  }
  throw new Error(`Commons API failed after retries: ${last}`)
}

/** Subcategory titles of one category. */
async function subcategories(category) {
  const out = []
  let cont
  do {
    const json = await api({
      action: 'query', list: 'categorymembers', cmtitle: category,
      cmtype: 'subcat', cmlimit: '500', ...(cont ? { cmcontinue: cont } : {}),
    })
    for (const m of json.query?.categorymembers ?? []) out.push(m.title)
    cont = json.continue?.cmcontinue
  } while (cont)
  return out
}

/** One paginated walk of a category's files, asking for a render at `width`. */
async function walkFiles(category, width) {
  const out = []
  let cont
  do {
    const json = await api({
      action: 'query', generator: 'categorymembers',
      gcmtitle: category, gcmtype: 'file', gcmlimit: '50',
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata',
      iiextmetadatafilter: 'License|LicenseShortName|LicenseUrl|Artist|Credit|ImageDescription|DateTimeOriginal|Categories',
      iiurlwidth: String(width),
      ...(cont ? { gcmcontinue: cont } : {}),
    })
    for (const p of json.query?.pages ?? []) out.push(p)
    cont = json.continue?.gcmcontinue
    // Politeness between pages. The API is free and the job runs weekly; there is no reason
    // to be the traffic Wikimedia writes its rate-limit page about.
    if (cont) await sleep(400)
  } while (cont)
  return out
}

/**
 * Every file in one category, with both render URLs the UI needs.
 *
 * TWO PASSES, ONE PER WIDTH, AND ON PURPOSE. The obvious version of this asks once and derives
 * the second URL by swapping the width in the filename. That does not work: Commons serves
 * thumbnails only at a fixed ladder of widths (see FULL_W), it refuses to upscale, and the
 * cases interact: a 700px original has a 500px thumbnail but no 1280px one, so the response
 * for the larger size is the original's URL, with no `/thumb/` segment and no width to swap.
 * Every rule about which URL exists for which file lives on Wikimedia's side, so the API is
 * asked both questions rather than being second-guessed on either.
 *
 * The cost is one extra request per fifty files, on a job that runs once a week.
 */
async function filesIn(category) {
  const full = await walkFiles(category, FULL_W)
  await sleep(400)
  const small = await walkFiles(category, THUMB_W)
  const smallByPageId = new Map()
  for (const p of small) smallByPageId.set(p.pageid, p.imageinfo?.[0]?.thumburl ?? null)
  // The larger pass carries the metadata; the smaller one contributes only its URL. A page
  // missing from the second pass (a deletion between the two calls) falls back to the large
  // render in buildRow rather than dropping the photograph.
  for (const p of full) p.smallThumbUrl = smallByPageId.get(p.pageid) ?? null
  return full
}

// ─── Row building ───────────────────────────────────────────────────────────

/** extmetadata values are `{ value, source }` wrappers; unset fields are simply absent. */
function meta(em, key) {
  const v = em?.[key]?.value
  if (v == null) return ''
  return typeof v === 'string' ? v : String(v)
}

/**
 * Commons markup to plain text.
 *
 * Artist, Credit and ImageDescription all come back as HTML written by whoever uploaded the
 * file. We keep the words and throw the markup away rather than sanitising it, because there
 * is nothing in the markup we want: the attribution these licences require is a name plus a
 * link to the file page, and the file page is already its own column.
 */
/** Trim to a length a card can hold, on a whole character rather than mid-entity. */
function clip(text, limit) {
  if (!text) return null
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text
}

function plain(html, limit = 600) {
  const text = String(html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|tr)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return clip(text, limit)
}

/**
 * The archive-catalogue field labels that show up inside Commons descriptions.
 *
 * Photographs digitised by an institution keep the institution's catalogue record as their
 * description, so the "description" of a 1948 press photo is genuinely this:
 *
 *   Local call number: c009836 Title: [Fort Wayne Daisies player, Marie Wegman … arguing
 *   with umpire Norris Ward : Opalocka, Florida] Date: Photographed on April 22, 1948.
 *   Physical descrip: 1 photoprint : b&w ; 5 x 4 in. Series Title: (Department of Commerce
 *   collection.) General Note: Accompanying note: "Umpire-Player Argument: …
 *
 * Two of the largest contributors in this pool (Florida Memory and the Center for Jewish
 * History) file everything this way, so leaving it alone would mean nearly every card on the
 * rail opening with a call number.
 */
const CATALOGUE_FIELDS = [
  'Local call number', 'Series Title', 'Title', 'Description', 'Physical descrip',
  'General Note', 'Date', 'Creator', 'Medium', 'Collection', 'Repository',
  'Rights Information', 'Subjects', 'Subject', 'Genre', 'Format', 'Persistent URL',
]
const FIELD_SPLIT = new RegExp(`\\b(${CATALOGUE_FIELDS.join('|')})\\s*:\\s*`, 'g')

/**
 * The one sentence worth putting under a photograph.
 *
 * Pulls the caption out of a catalogue record when the text is one, and otherwise returns the
 * description untouched: plenty of Commons descriptions are already a plain sentence
 * ("Betsy Jochum during the 1947 Season") and reformatting those would only damage them.
 *
 * `Description` is preferred over `Title` where a record carries both, because a cataloguer's
 * Title is an identifier and the Description is the thing a reader wants ("Tiby Eisen swings
 * a baseball bat" beats "Thelma 'Tiby' Eisen").
 *
 * This is a good default, not a substitute for the `caption` column. It cannot rescue a
 * record with no usable field in it, and a curator overriding it is expected rather than a
 * sign this failed.
 */
/**
 * A cataloguer's title, in the shape a reader expects.
 *
 * Library cataloguing has conventions that are load-bearing in a catalogue and noise under a
 * photograph. Square brackets mark a title the cataloguer supplied rather than transcribed
 * from the object; " : " separates the title proper from what the rules call other title
 * information; and a trailing "[graphic]" is the general material designation, which is to
 * say "this is a picture", which the reader can see.
 *
 * The leading-bracket case is matched before the whole-string one because the two appear
 * together: "[Dick Bass with the Fort Wayne Daisies : Opa-locka, Florida] [graphic]".
 */
function tidyCatalogueTitle(value) {
  const lead = value.match(/^\[([^\][]+)\]/)
  return (lead ? lead[1] : value.replace(/^\[(.*)\]$/s, '$1'))
    .replace(/\s*\[(graphic|picture|photograph|electronic resource)\]\s*\.?/gi, '')
    .replace(/\s+:\s+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
}

function deriveCaption(description) {
  if (!description) return null
  // Files imported from Flickr and institutional archives commonly prefix the whole
  // description with "From source:", which is a note about where the text came from and not
  // part of the caption. Stripped before the field split so it cannot be mistaken for one.
  description = description.replace(/^From source:\s*/i, '').trim()
  if (!description) return null
  const parts = description.split(FIELD_SPLIT)
  // A split with no delimiters returns one element: not a catalogue record, leave it alone.
  if (parts.length < 3) return description
  const fields = new Map()
  for (let i = 1; i < parts.length; i += 2) {
    const value = (parts[i + 1] ?? '').trim()
    // First occurrence wins. "Title" and "Series Title" both end up keyed separately, and a
    // record that repeats a label means the later one is nested inside a note.
    if (value && !fields.has(parts[i])) fields.set(parts[i], value)
  }
  for (const key of ['Description', 'Title']) {
    const value = fields.get(key)
    if (!value) continue
    const cleaned = tidyCatalogueTitle(value)
    if (cleaned.length >= 12) return cleaned
  }
  return description
}

/**
 * A Commons URL as it should be stored.
 *
 * Only the query string comes off. Commons appends its own `utm_*` analytics parameters to
 * every URL served through imageinfo, and those have no business being baked into our rows.
 *
 * Deliberately does NOT touch the width in the path. See filesIn() for why the width in a
 * Commons thumbnail URL is not ours to edit.
 */
function bareUrl(url) {
  return String(url).split('?')[0]
}

/** A `wpbl_photos` row, or a `skip` reason if the file does not belong in the table. */
function buildRow(page, sourceCategory) {
  const ii = page.imageinfo?.[0]
  if (!ii) return { skip: 'no imageinfo' }
  if (!RENDERABLE_MIME.has(ii.mime)) return { skip: `mime ${ii.mime}` }

  const em = ii.extmetadata ?? {}
  const slug = meta(em, 'License').toLowerCase()
  if (!ALLOWED_LICENCE.test(slug)) return { skip: `licence ${slug || '(none)'}` }

  // A TIFF's own URL is a .tif no browser will paint, so it may only be used through its
  // JPEG render. Web-native formats can fall back to the original, which is what happens for
  // anything already smaller than the width we asked for.
  const rendered = ii.thumburl || (WEB_NATIVE_MIME.has(ii.mime) ? ii.url : null)
  if (!rendered || !ii.descriptionurl) return { skip: `no renderable url (${ii.mime})` }

  return {
    row: {
      page_id: page.pageid,
      title: page.title,
      // Clipped AFTER the caption is derived, not before: a catalogue record runs to well
      // over a card's worth of text, and truncating first can cut the Title field in half
      // before deriveCaption ever sees it.
      description: clip(deriveCaption(plain(meta(em, 'ImageDescription'), 4000)), 600),
      file_url: bareUrl(rendered),
      // Falls back to the large render when the small pass had no thumbnail for this file,
      // which is the correct answer for an original that is already smaller than a card.
      thumb_url: bareUrl(page.smallThumbUrl ?? rendered),
      width: ii.width ?? null,
      height: ii.height ?? null,
      description_url: ii.descriptionurl,
      artist: plain(meta(em, 'Artist'), 200),
      credit: plain(meta(em, 'Credit'), 200),
      license_short: meta(em, 'LicenseShortName') || slug,
      license_slug: slug,
      license_url: meta(em, 'LicenseUrl') || null,
      date_original: plain(meta(em, 'DateTimeOriginal'), 60),
      categories: meta(em, 'Categories').split('|').filter(Boolean),
      source_category: sourceCategory,
      updated_at: new Date().toISOString(),
      // approved / caption / sort_order are absent on purpose. See the file header.
    },
  }
}

// ─── Writing ────────────────────────────────────────────────────────────

// The columns the upsert writes, in one place, because BOTH writers have to agree on the list
// and because the list is a decision rather than a detail: `approved`, `caption` and
// `sort_order` are absent so a re-sync leaves a curated row alone. See the file header.
const WRITE_COLUMNS = [
  'page_id', 'title', 'description', 'file_url', 'thumb_url', 'width', 'height',
  'description_url', 'artist', 'credit', 'license_short', 'license_slug', 'license_url',
  'date_original', 'categories', 'source_category', 'updated_at',
]

/** The upsert over PostgREST, as CI runs it. Returns how many rows are publicly visible. */
async function writeViaPostgrest(rows) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await supabase.from('wpbl_photos').upsert(rows, { onConflict: 'page_id' })
  if (error) throw new Error(`Upsert failed: ${error.message}`)
  const { count } = await supabase.from('wpbl_photos')
    .select('page_id', { count: 'exact', head: true }).eq('approved', true)
  return count ?? 0
}

/**
 * The same upsert over Postgres, for a machine with no service-role key.
 *
 * `pg` is imported dynamically so the dependency is only needed on the path that uses it. The
 * GitHub workflow installs `@supabase/supabase-js` alone, and adding `pg` to that line to
 * serve a branch CI never takes would be paying for the fallback everywhere.
 *
 * The DO UPDATE list is built from WRITE_COLUMNS rather than from the table, which is what
 * makes this branch behave identically to the PostgREST one: both leave every column they do
 * not name exactly as it was.
 */
async function writeViaPostgres(rows) {
  const { default: pg } = await import('pg')
  const isLocal = /@(localhost|127\.0\.0\.1)/.test(SUPABASE_DB_URL)
  const client = new pg.Client({
    connectionString: SUPABASE_DB_URL,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    const cols = WRITE_COLUMNS.join(', ')
    const placeholders = WRITE_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
    // page_id is the conflict target, so it is the one column not worth reassigning.
    const updates = WRITE_COLUMNS.filter(c => c !== 'page_id')
      .map(c => `${c} = excluded.${c}`).join(', ')
    const sql = `insert into public.wpbl_photos (${cols}) values (${placeholders})
                 on conflict (page_id) do update set ${updates}`
    // One statement per row, inside a transaction. A single multi-row insert would be fewer
    // round trips, but a couple of hundred rows once a week is not worth hand-rolling the
    // parameter numbering for, and the transaction means a failure halfway through leaves no
    // half-written backlog behind.
    await client.query('begin')
    for (const row of rows) await client.query(sql, WRITE_COLUMNS.map(c => row[c] ?? null))
    await client.query('commit')
    const { rows: [{ count }] } = await client.query(
      'select count(*)::int as count from public.wpbl_photos where approved')
    return count
  } catch (e) {
    await client.query('rollback').catch(() => { /* the error above is the one that matters */ })
    throw e
  } finally {
    await client.end()
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const canWrite = (SUPABASE_URL && SUPABASE_KEY) || SUPABASE_DB_URL
  if (!DRY_RUN && !canWrite) {
    console.error('❌  No way to write. Set either SUPABASE_URL (or VITE_SUPABASE_URL) plus\n' +
      '   SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_DB_URL (the same connection string that\n' +
      '   `npm run migrate` uses). Or pass --dry-run, which needs neither.')
    process.exit(1)
  }

  // Breadth-first from the seeds. `visited` is load-bearing rather than defensive: Commons
  // categories form a graph, and "Women's baseball" contains the AAGPBL category that is
  // also a seed, so a tree walk would read the larger half of this twice.
  const visited = new Set()
  const queue = SEED_CATEGORIES.map(c => ({ category: c, depth: 0, seed: c }))
  const byPageId = new Map()
  const skips = new Map()

  while (queue.length > 0) {
    const { category, depth, seed } = queue.shift()
    if (visited.has(category)) continue
    visited.add(category)

    const pages = await filesIn(category)
    let kept = 0
    for (const page of pages) {
      // First category to reach a file wins its `source_category`. Seeds are queued before
      // anything they contain, so that is the nearest seed rather than an arbitrary parent.
      if (byPageId.has(page.pageid)) continue
      const { row, skip } = buildRow(page, seed)
      if (skip) { skips.set(skip, (skips.get(skip) ?? 0) + 1); continue }
      byPageId.set(page.pageid, row)
      kept++
    }
    console.log(`📁  ${category}  (depth ${depth})  ${pages.length} files, ${kept} kept`)

    if (depth < DEPTH) {
      for (const sub of await subcategories(category)) {
        if (!visited.has(sub) && !SKIP_CATEGORIES.has(sub)) queue.push({ category: sub, depth: depth + 1, seed })
      }
    }
    await sleep(400)
  }

  const rows = [...byPageId.values()]
  console.log(`\n🖼️   ${rows.length} photographs across ${visited.size} categories`)
  for (const [reason, n] of [...skips].sort((a, b) => b[1] - a[1])) console.log(`   skipped ${n}: ${reason}`)

  if (rows.length === 0) { console.log('Nothing to upsert.'); return }

  if (DRY_RUN) {
    // The caption is what a reviewer is actually judging, so it leads. The file name is the
    // thing you can always go and look up; whether the card will read as a sentence is not.
    for (const r of rows.slice(0, 25)) {
      console.log(`  • ${clip(r.description, 110) ?? '(no description)'}`)
      console.log(`      ${r.artist ?? 'unknown'} · ${r.license_short} · ${r.title}`)
    }
    if (rows.length > 25) console.log(`  … and ${rows.length - 25} more`)
    console.log('\n(dry run, nothing written)')
    return
  }

  // Prefer PostgREST when the service-role key is present, which it always is in CI.
  const approved = (SUPABASE_URL && SUPABASE_KEY)
    ? await writeViaPostgrest(rows)
    : await writeViaPostgres(rows)

  // What is actually visible, which is the number worth printing: a run that adds thirty
  // photographs to the backlog changes nothing anyone can see until someone approves them.
  console.log(`✅  Upserted ${rows.length} photographs, ${approved} approved and live`)
  if (approved === 0) {
    console.log('   Nothing is approved yet, so the rail still renders nothing. Review the ' +
      'backlog and set approved = true on what belongs.')
  }
}

main().catch(err => { console.error('❌ ', err.message); process.exit(1) })

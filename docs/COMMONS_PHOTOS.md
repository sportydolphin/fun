# The archive gallery (Wikimedia Commons)

The "From the archive" rail on the WPBL home screen, and the gallery behind its "See all".
Freely licensed photographs of women's baseball, mirrored from Wikimedia Commons into
`wpbl_photos` by [`scripts/sync-wpbl-commons.mjs`](../scripts/sync-wpbl-commons.mjs) on a
weekly GitHub Actions cron.

**Read this before approving anything.** The sync is the easy half. Everything that decides
what a visitor actually sees happens in the review pass below.

## Why this is history and not this season

The obvious version of this feature was photographs of current WPBL players. Commons cannot
support it. Surveyed Aug 18, 2026:

| Query | Files |
|---|---|
| `Category:Women's Pro Baseball League` | **8** (two of one player, two SVGs, four city shots) |
| All 118 rostered players, searched on Commons by name | **0** real matches |
| `Category:All-American Girls Professional Baseball League` | 33 |
| `Category:Women's baseball` | 56 |

What Commons does hold is the deep record: the AAGPBL, the World Cup, the pioneers, largely
public domain through Florida Memory, the Library of Congress and institutional Flickr
streams. The sync currently keeps **227** files, reachable from the three seed categories at depth 1.

That turned out to be the more useful feature. Every other surface under `/wpbl` goes blank
when the league's feed stops on Sep 6, 2026. This one does not know the difference, which is
the whole argument for it (see ROADMAP-WPBL.md, "The clock").

The WPBL category is still seeded first, and still walked every week. If the league's own
photography ever reaches Commons, the job picks it up without anyone editing the seed list.

## Nothing renders until someone approves it

Rows land with `approved = false`, and the RLS `select` policy is `using (approved)`. The
unreviewed backlog is unreachable from the browser, not merely unrendered: `fetchWpblPhotos`
deliberately does **not** filter on `approved`, so that nobody can copy a query that looks
like it is the thing keeping the backlog private.

Two reasons the gate is not optional:

1. **Category membership on Commons is crowd-maintained.** The query returns whatever somebody
   filed there. `Category:Women's baseball` currently reaches 67 photos of one Japanese high
   school exhibition game and 27 Victorian cigarette cards. All legitimately in the category;
   none of them belong on a rail on the WPBL home screen.
2. **A photograph of a person is not automatically ours to publish.** A free licence covers
   copyright. It says nothing about whether the subject expected to appear on a sports site.

### The review query

```sql
select page_id, description, artist, license_short, source_category, description_url
from wpbl_photos
where not approved
order by created_at desc;
```

Open `description_url` for anything you are unsure about: the file page carries the full
provenance, the categories, and any restriction templates the uploader added.

To publish, in the order the gallery should read:

```sql
update wpbl_photos set approved = true, sort_order = 10 where page_id = 17537442;
```

`sort_order` is the gallery's order, nulls last. Leave gaps (10, 20, 30) so a later photograph
can be slotted between two without renumbering the set.

### Captions

`description` is derived from Commons and `caption` overrides it. Set `caption` whenever the
derived line is wrong or reads badly; it is expected, not a failure.

The sync already unpicks library cataloguing, which is what most of this pool has instead of a
caption. A Florida Memory record arrives as:

> Local call number: c009836 Title: [Fort Wayne Daisies player, Marie Wegman, of the All
> American Girls Professional Baseball League arguing with umpire Norris Ward : Opalocka,
> Florida] Date: Photographed on April 22, 1948. Physical descrip: 1 photoprint …

and `deriveCaption()` reduces it to the title, unbracketed, with the cataloguer's " : " turned
into a comma. It prefers a `Description` field over a `Title` field where a record has both,
because a cataloguer's title is an identifier and the description is the sentence a reader
wants. What it cannot do is invent a caption for a record that has no usable field in it.

## Attribution is not a footer

Most of the pool is public domain, but a real share is CC BY or CC BY-SA, which oblige us to
name the creator and the licence and to point at the source. So the credit line is on **every
card, in every surface**, not tucked behind a click: a CC BY-SA photograph is published the
moment the rail paints, whether or not anyone opens it.

If a layout change ever makes the credit hard to place, the photograph comes out. Not the
credit.

## What the sync will not do

- **Write `approved`, `caption` or `sort_order`.** Those three columns are absent from the
  upsert payload. PostgREST builds its `ON CONFLICT … SET` list from the payload's keys, so a
  column that is not in the payload is untouched on update. That is what stops a weekly
  re-sync from discarding a curated caption or resurrecting a rejected photo. **If you add a
  column, decide which side of that line it is on before adding it to the payload.**
- **Keep anything that is not clearly free.** The licence allow-list tests extmetadata's
  machine-readable `License` slug: public domain, CC0, CC BY and CC BY-SA only. Commons is not
  uniformly free; it hosts non-free logos and fair-use claims. GFDL-only files are excluded
  deliberately, because that licence wants its full text reproduced beside the image.
- **Store anything as HTML.** Commons serves descriptions and attribution as markup written by
  whoever uploaded the file. The sync strips it to plain text, and
  [`src/wpbl/Photos.tsx`](../src/wpbl/Photos.tsx) only ever puts those strings in a text node.
  No `dangerouslySetInnerHTML`, and nothing on `WpblPhoto` may be rendered as markup.
- **Hotlink an original.** Both stored URLs are Commons thumbnailer renders. Originals in this
  pool run to several megabytes at 4000px. A file narrower than the requested width has no
  thumbnail and Commons returns the original's URL, so both columns can legitimately hold the
  same small image.
- **Descend into `SKIP_CATEGORIES`.** One entry today, the AAGPBL logo category: twenty club
  wordmarks that were twenty guaranteed rejections in the queue every week. Add to it only
  when a whole category is wrong, never to express taste about individual files.

## Thumbnail widths are not ours to choose

**Wikimedia serves thumbnails only at a fixed ladder of widths** and answers anything else with
`400 Use thumbnail sizes listed on …`. Probed Aug 19, 2026:

```
20 · 40 · 60 · 120 · 250 · 500 · 960 · 1280 · 1920 · 3840
```

The same ladder applies to a JPEG and to a TIFF's JPEG render. The sync uses **500** for cards
and **1280** for the lightbox, both on the list. The first version of this script picked 640 and
1600, and every single image would have shipped broken.

Do not assume the ladder is permanent. It is an operational decision on Wikimedia's side rather
than an API contract, and it tightened at some point before this was written.

**This is why the sync asks the API twice, once per width, instead of swapping the number in one
URL.** Constructing thumbnail URLs means reimplementing rules that live on Wikimedia's side, and
they are worse than the ladder alone:

- **No upscaling.** A 700px original has a 500px thumbnail and no 1280px one, so the response
  for the larger size is the original's URL, with no `/thumb/` segment and no width to swap.
- **Long filenames get renamed.** Past a length limit the render is not
  `500px-<filename>.jpg` but literally `500px-thumbnail.jpg`. Several files in this pool are
  long enough to hit it, and a naive width swap silently produces a URL that 404s.
- **TIFFs carry a prefix.** Their renders are `lossy-page1-<W>px-<name>.tif.jpg`.

Two requests per fifty files, on a weekly job, buys out all of that.

TIFF is accepted for exactly this reason: sixteen photographs in the pool are archival TIFF
scans, and Commons renders them to JPEG. A TIFF has no fallback, though. Its own URL is a `.tif`
no browser will paint, so a TIFF with no thumbnail is skipped rather than linked.

## Rate limits

Wikimedia throttles anonymous datacenter traffic hard, and a user-agent carrying a contact is
required rather than polite. This was found the hard way: a sweep that looked up 118 player
names one request at a time hit "You are making too many requests" within two minutes.

That is also why the sync walks categories with a **generator** (fifty files and their full
imageinfo per request) rather than per file, sleeps between pages, and retries a throttle with
a widening backoff instead of giving up. A job that bailed on the first 429 would leave the
table half-written, which looks exactly like a curation decision and is not one.

Override the contact with the `WPBL_COMMONS_CONTACT` repo variable; it defaults to the site's
address.

## Running it

```bash
node scripts/sync-wpbl-commons.mjs --dry-run
```

Reads Commons and prints the caption, creator, licence and file name of everything it would
write. Needs no credentials, so it is the way to check a seed-list or caption change.

```bash
node scripts/sync-wpbl-commons.mjs
```

The real thing. Needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Prints how many rows are
approved and live afterwards, which is the only number that describes what changed for a
visitor.

From the Actions tab, `WPBL Commons Photo Sync` takes a `dry_run` input and defaults it to
`true`, so a manual run cannot write by accident.

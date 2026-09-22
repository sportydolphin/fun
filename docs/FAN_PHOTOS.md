# Fan photographs, tagged by who is in them

**Plan of record.** Scoped Sep 21, 2026. Like [`ANDROID.md`](ANDROID.md) and
[`IOS.md`](IOS.md), this is a design that has been argued through rather than a description of
something running.

**Built so far (Sep 21, 2026):** the four tables and their RLS, migration
`20260922020815_add_wpbl_fan_photos_tables.sql`, applied; `wpbl_merge_players` extended to
repoint tags. The client read layer: `fetchWpblFanPhotos` / `fetchWpblFanPhotoSubjects` /
`fetchWpblFanPhotoFigures` and `fetchWpblFanPhotoIndex` in [`api.ts`](../src/wpbl/api.ts),
paged and ordered, with `buildFanPhotoIndex` (the pure join) in
[`fanPhotos.ts`](../src/wpbl/fanPhotos.ts), pinned by
`src/wpbl/__tests__/fanPhotos.test.ts`. The local ingest pass:
[`scripts/prepare-fan-photos.py`](../scripts/prepare-fan-photos.py) (`npm run
prepare-fan-photos`), which hashes the original, strips ALL EXIF, emits the two webp renders
and writes a manifest, verified end-to-end (GPS and device tags confirmed gone from the
renders). The upload + insert half:
[`scripts/ingest-fan-photos.mjs`](../scripts/ingest-fan-photos.mjs) (`npm run
ingest-fan-photos`), which uploads both renders to R2 (via `aws4fetch`, content-addressed keys)
and upserts the rows `approved = false`, with a credential-free `--dry-run`. Its DO UPDATE list
omits every curator-owned column and coalesces `taken_on`, both validated against the live
schema; only the R2 `PUT` itself is unexercised until the bucket exists. R2 bucket
`sportydolphin-wpbl-photos`, custom domain `photos.sportydolphin.fun`, CORS, and the
worker-route carve-out, all live (Sep 21, 2026). The curation tool
[`AdminPhotos.tsx`](../src/wpbl/AdminPhotos.tsx), a Photos group on `/admin`: queue, subject
type-ahead, caption, approve, all through the `is_site_owner()` RLS. **The web upload** (Sep 22,
2026): an Upload panel in that same tool plus [`fanPhotoUpload.ts`](../src/wpbl/fanPhotoUpload.ts)
(canvas resize + webp + sha256, EXIF dropped by the canvas) and the owner-gated
[`functions/api/fan-photo.ts`](../functions/api/fan-photo.ts) that puts the bytes in R2, so a
photo can be uploaded from a phone with the same duplicate check as the CLI. **The reader-facing
surfaces** (Sep 22, 2026), in [`FanPhotoViews.tsx`](../src/wpbl/FanPhotoViews.tsx): the player-page
strip (`FanPhotoPlayerStrip`, in all three of PlayerDetail's layouts), the `/wpbl/photos` gallery
([`PhotosGalleryPage.tsx`](../src/wpbl/PhotosGalleryPage.tsx), a standalone sibling route wired
through routes/seo/_redirects/sitemap/footer and pinned in `routes.test.ts`), and the **Home card**
(`FanPhotoHomeCard`, year-round once `HOME_MIN_PHOTOS` = 12 published, above "The league").
The offseason Home is previewable in dev: the season-finale simulator plus a "Fan photos on Home
(mock)" toggle ([`dev/devFanPhotos.ts`](../src/wpbl/dev/devFanPhotos.ts)) that pads the card. The
fan-awards results give up their Home slot at `AWARDS_RESULTS_UNTIL` (end of Sep). **Deliberately
NOT built:** Game Center "from this game" — the photos are not reliably matched to games, so the
`game_id` column stays but no surface reads it. **The reader surfaces are committed on the
`wpbl-fan-photos` branch and held unpushed** until a real batch is curated; the owner tools (ingest,
upload, curation) are already live on `main`.

### The web upload's server env (owner)

The `/api/fan-photo` endpoint is the only place the R2 keys live at the edge, and they are not
there yet: they are in the local `.env` for the CLI, but a Cloudflare function reads the
CLOUDFLARE environment. Add these to the Pages/Workers project env (dashboard), the same store
that already holds `VITE_SUPABASE_URL` and the service-role key: `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE`. Until they are set the
endpoint returns 500 and the web upload cannot work, while the CLI keeps working off `.env`. The
owner check needs nothing new: the function calls the DB's own `is_site_owner()` with the
caller's Supabase token, so there is no second definition of "who is the owner" and no JWT secret
to store.

### The R2 bucket, the one manual step (owner)

Everything above is code; this is Cloudflare setup, done once, and the ingest is blocked on it:

### The R2 bucket, the one manual step (owner)

Everything above is code; this is Cloudflare setup, done once, and the ingest is blocked on it:

1. Create an R2 bucket (Cloudflare dashboard → R2). Name it, e.g. `sportydolphin-fan-photos`.
2. Bind a **custom domain** to it (bucket → Settings → Custom Domains), e.g.
   `photos.sportydolphin.fun`. Not the `r2.dev` subdomain: Cloudflare rate-limits it and
   documents it as development-only, and a bound subdomain also puts the images behind the cache.
3. Add a **CORS policy** allowing the site origin (`https://sportydolphin.fun`) with `GET`, so
   the future share card can draw a fan photo into a canvas without tainting it.
4. Create an **R2 API token** (S3-compatible) with object read/write on that bucket; keep its
   access key id and secret.
5. Put these in `.env` (never committed): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and `R2_PUBLIC_BASE=https://photos.sportydolphin.fun`.

Then a batch is: drop photos into `scripts/fan-photos-drop/<contributor>/` with a
`contributor.json`, `npm run prepare-fan-photos`, `npm run ingest-fan-photos -- --dry-run` to
check, then `npm run ingest-fan-photos`.

The feature: fans send photographs they took, with explicit permission. We tag each one with
who is in it and surface them on the player pages, so looking up a player shows every photo of
her. Subjects are people and characters, so managers, coaches, broadcasters, staff and mascots
(Gladys the Goose) are taggable on the same footing as a rostered player.

## Why this is not the archive gallery

[`COMMONS_PHOTOS.md`](COMMONS_PHOTOS.md) describes `wpbl_photos`, which looks like the same
feature and is not. That table exists **because** Commons has essentially no photography of the
current league: it is the deep historical record, the AAGPBL and the pioneers, and its whole
argument is that it does not go stale when the feed stops. This is the opposite, and it is the
thing that was originally asked for and could not be built: this season, these players, by name.

Three reasons they stay separate tables rather than one.

1. **`wpbl_photos` is Commons-shaped down to its primary key.** It is keyed on Commons'
   `page_id`, a bigint nobody else mints, and `description_url`, `license_slug` and
   `source_category` are all `not null`. A fan photo has none of those and never will.
2. **The Commons sync depends on an invariant a second writer would break.** PostgREST builds
   its `ON CONFLICT … SET` list from the payload's keys, so `approved`, `caption` and
   `sort_order` survive a weekly re-sync only because they are absent from the payload. That is
   load-bearing and it is documented per column. Putting a second, differently-shaped writer
   into the same table means reasoning about that rule twice.
3. **"From the archive" means something.** The rail is titled and captioned as history. Folding
   this season's fan photographs into it does not extend the feature, it replaces it.

What this feature **does** copy from that one, deliberately and in full:

- The approval gate lives in RLS, not in the query, and the client query must NOT also filter
  on `approved`. That is not belt-and-braces, it is the opposite: a filter in the query reads as
  though it were the protection, and the next person writing a query copies it and believes it
  is enough.
- Every string is plain text and nothing is ever rendered as markup.
- The credit is on every card in every surface, not behind a click.

## Where it surfaces, in priority order

**The player page is the feature.** The traffic read in [ROADMAP-WPBL.md](../ROADMAP-WPBL.md)
settles this: opening a player page is the retention event (7.8% return having opened neither it
nor Game Center, 76.5% having opened both), while the media shelf that holds the archive rail
drew 3 photo opens across the whole fortnight, against 575 browsers who saw its Reading
segment and 39 who clicked one of those through. A photo strip on a player page and a photo rail on Home are not the same
bet, and only one of them is aimed at a number that moved.

1. **A strip on the player page.** The whole point. Photos of her, on her page.
2. **`/wpbl/photos`**, the gallery, filterable by subject. A sibling page on the same footing as
   `/wpbl/league`, `/wpbl/glossary`, `/wpbl/sources`, `/wpbl/season` and `/wpbl/scorigami`:
   a real indexed path, linked from the footer, absent from `WPBL_NAV` so the pills do not grow
   a destination this has not earned from the events.
3. **Game Center, "from this game"**, where `game_id` is set. Nearly free once the column
   exists, which is the whole reason the column exists from day one (below).
4. **A Home rail, last or never.** The archive rail's numbers are the prior here.

No route per subject. A figure is a filter inside the gallery, not a page: a new page costs four
places (below), and a mascot has not earned one.

## The tables

### `wpbl_photo_contributors`, owner-only

The permission record, and the first thing to exist. Not publicly readable at all: the public
credit is denormalized onto the photo row, so no reader ever queries this table and there is no
column-privilege puzzle to get wrong (RLS is row-level and cannot hide a column, so a private
field on a publicly-readable row is a leak, not a precaution).

- `display_name` as they want to be credited, `contact`, and how to reach them
- `permission_granted_on` and `permission_evidence`: where the grant is actually recorded, a
  link to the Discord message or the email. A permission nobody can produce later is not one.
- `permission_scope`: what they agreed to. Site display is not the same as social sharing, and
  neither is print.
- `withdrawn_on`. **This is the takedown path**, and it is one column because it has to be one
  update: a contributor who changes their mind should not require finding their photographs by
  memory.

### `wpbl_fan_photos`

- `sha256` of the ORIGINAL bytes, unique. This is what makes the ingest idempotent and collapses
  two fans sending the same shot into one row. Without it, running the script twice over a drop
  folder duplicates the batch, and the duplicate is not visibly a duplicate once captions differ.
- `storage_path`, content-addressed, so re-uploading a photo overwrites rather than orphaning.
- `card_url` and `full_url`, the two renders.
- `width` / `height` of the **published** render, not the original's. This is the one place to
  diverge from `wpbl_photos`, which stores the original's dimensions because Commons makes the
  thumbnails and we do not. Here we make them, so the number that reserves layout space should
  be the number actually served.
- `caption`, and `credit` denormalized from the contributor.
- `taken_on`, curated. EXIF seeds it and does not settle it, though a phone photograph from this
  season is far more trustworthy here than the Commons `date_original` field is.
- `game_id`, nullable, referencing `wpbl_games`. **Store it from day one even though the Game
  Center surface is fourth on the list.** It costs nothing now and a backfill later means
  re-identifying every photograph by eye.
- `approved bool not null default false`, `sort_order`.

No club column. A photo's club comes from the game or the date, for the reason in the traps below.

### `wpbl_photo_subjects`

The tags, many to many. `player_id` as a real foreign key to `wpbl_players`, plus a nullable
`figure_key`, with a check constraint that exactly one is non-null.

The FK is not decoration: it is what lets `wpbl_merge_players` repoint tags, and forgetting it
is trap 1.

### `wpbl_photo_figures`

The non-player subjects, so they have names and slugs: `key`, `name`, `kind`, `blurb`, optional
team. `mgr:<slug>` in [`awards.ts`](../src/wpbl/awards.ts) is the existing convention for naming
a human the feed does not roster, and four manager portraits are already bundled.

`kind` covers mascot, manager, coach, broadcaster, staff and umpire, and **deliberately does not
cover places.** Every tag is therefore a person or a character, so `wpbl_photo_subjects` answers
exactly one question: who is in this photograph. A future "photos of the ballpark" wants its own
column rather than a second meaning for this one.

## Traps, each inherited from something already in this repo

1. **`wpbl_merge_players` hand-lists every table holding a `player_id`, and does not discover
   them.** Read it: forty lines of explicit `update … set player_id = keep`. A tag table it has
   not been taught about either errors on the foreign key or silently orphans every tag on the
   merged player, and merges happen for real (Diana Ibarra, Suzu Narasaki). **The migration that
   creates `wpbl_photo_subjects` must also extend that function, in the same migration**, because
   the two are one change and splitting them means shipping the half that breaks.
2. **PostgREST silently caps a bare `.select()` at 1000 rows.** Four hundred photographs at three
   subjects each is already 1,200 tag rows, so this feature crosses the cap during its first real
   batch. Any read meaning "all of them" pages with `fetchAllPaged` and carries a deterministic
   `.order()`. The failure is a short array with no error: player pages quietly stop showing
   photographs, starting with whichever players sort last.
3. **A player's `team_id` means "now", never "then".** A photo taken in July of a player who
   changed clubs in August must not be captioned with her current cap. The club comes from
   `game_id`'s box-score line, or from the date, both of which record where she actually was.
4. **A new page needs four places, three of which cannot fail locally.** `/wpbl/photos` wants an
   entry in [`routes.ts`](../src/wpbl/routes.ts) and [`seo.ts`](../src/seo.ts), two lines in
   `public/_redirects` (a 200 rewrite plus the 301 folding the trailing slash), and the sitemap.
   `routes.test.ts` pins them together. Vite serves the shell for everything, so `npm run dev`
   will never show the omission; verify with `npx wrangler pages dev dist`.
5. **A fixed px in `/wpbl` is one of three things.** A box reserving room for a caption goes in
   `rem` or it clips when a reader enlarges the text; structure goes through `chromePx()`;
   ornament stays raw. `tsc` sees none of it and the page looks right until someone changes their
   text size.
6. **Curator notes cannot live on the photo row.** RLS cannot hide a column. They go in a
   separate owner-only table.

## The bytes: Cloudflare R2

Chosen over Supabase Storage because egress is free and unmetered. Storage was never the
constraint; egress is. Four hundred photographs at roughly 850KB across both renders is about
340MB, comfortable on either service's free tier, but at the traffic this section already sees
(548 browsers on its biggest day, each loading several cards) Supabase's 5GB monthly egress is
the ceiling that arrives first, and it arrives as a bill or a throttle rather than as a bug.
Bundling in the repo was the other candidate: free egress via Pages, no new service, and several
hundred megabytes of binaries in git forever plus a deploy to publish one photograph.

Two things to set when the bucket is created, both much cheaper now than later:

- **A custom domain, not `r2.dev`.** Cloudflare documents the `r2.dev` subdomain as
  development-only and rate-limits it. A subdomain bound to the bucket also puts the images
  behind the normal cache.
- **A CORS policy allowing the site's origin, and `crossOrigin="anonymous"` on the images.**
  This repo captures DOM to canvas in production: [`awardShareCard.tsx`](../src/wpbl/awardShareCard.tsx)
  draws faces as plain `<img>`s through html2canvas. Every image it draws today is a bundled
  same-origin portrait, so CORS has never come up. The first time a fan photograph is drawn into
  a share card, a cross-origin image without the header either taints the canvas so `toDataURL`
  throws, or is silently dropped and the card publishes with a hole in it. The share card is a
  likely second version of this feature, so assume it.

**The site Worker's route catches the R2 subdomain, and the R2 domain reading "Active" does not
mean it is serving.** The `fun` Worker (the whole site) is bound to `*.sportydolphin.fun/*`, a
Worker Route that matches EVERY subdomain, `photos.` included. A Worker Route runs at the edge
before the proxied R2 origin is ever reached, so `photos.sportydolphin.fun` returned the SPA's
`index.html` with `content-type: text/html` (and no CORS header, because the request never
touched R2) while R2's own custom-domain page showed the domain green and Active: Active only
means R2 provisioned its cert, not that anything routes to it. The DNS was correct the whole
time (a proxied `R2` CNAME on `photos`). The fix is a MORE-SPECIFIC Worker Route
`photos.sportydolphin.fun/*` assigned to **None**, added on the ZONE's Workers Routes page (the
Worker's own "Add Route" only binds `fun` and offers no None); the specific route wins over the
wildcard and the request falls through to R2. Confirmed serving `image/webp` with the CORS
header on Sep 21, 2026. **Any future subdomain that must NOT be the site** (a second bucket, a
status page) needs the same carve-out, for the same reason.

## Ingest, in two passes

Split because the repo already has both halves of it, and because the pixel pass should not hold
credentials.

**`scripts/prepare-fan-photos.py`**, local, no credentials. Pillow, like every other image
script here (`make-brand-icons.py`, `cut-out-wpbl-portraits.py`, `make-wpbl-share-cards.py`,
`make-wpbl-portrait-thumbs.py`). Reads the drop folder and writes a staging folder plus a
manifest: hash the original, **strip all EXIF**, emit the two webp renders. Adding `sharp` to a
project with ten runtime dependencies to do what Pillow already does here is the wrong trade.

EXIF stripping is not tidiness. A phone photograph carries GPS coordinates and device
identifiers belonging to the fan who took it, and neither is ours to republish.

**`scripts/ingest-fan-photos.mjs`**, service-role. Uploads the staging folder to R2 and inserts
the rows `approved = false`. `--dry-run` that needs no credentials, on the Commons sync's shape,
because that is what makes a manifest change checkable. It never writes `approved`, `caption` or
`sort_order` on update, for exactly the reason the Commons sync does not.

The manifest carries **only what the CLI actually knows**: the contributor, the permission
evidence, and whatever the fan said about the photo as a note for the curator. Subjects and
captions come from the review UI, because that is the tool built for them.

## Curation: a tool under `/admin`

The review UI is what decides whether this survives its first real batch. Five hundred
photographs at a caption and roughly three tags each is about two thousand curation actions, and
in SQL that is four statements apiece. The queue, a thumbnail, a type-ahead subject picker over
`fetchWpblAllPlayers` and the figures table, a caption field and an approve toggle is a morning's
work that pays for itself on the first batch.

It writes through the `is_site_owner()` policy, which is **not a new write path**: owner writes
to WPBL tables already exist and `wpbl_photos` carries exactly this pair of policies. The public
`select using (approved)` and the owner `for all using (is_site_owner())` are permissive policies
and OR together, which is what lets the owner read the unapproved queue the public cannot.

It never touches R2. Bytes arrive by CLI; the UI only tags, captions and approves.

**Tagging is the one job here that genuinely wants delegating**, and `SITE_ROLES` already exists,
so a `curator` role for a fan who knows the faces better than the owner does is a row rather than
a deploy. Worth keeping in mind while writing the policies, even if the first version is
owner-only.

## Deliberately not building

- **No fan-facing upload.** Fans sending photographs directly keeps the abuse surface, the
  storage quota and the moderation queue at zero, and avoids a fourth write path to the database.
  There are three and there is a reason there are three.
- No face detection or auto-tagging.
- No route per figure.
- No print or merchandise rights. The permission being collected is for the site.

## The two parts that are not code

**Terms says nothing about third-party content.** The only relevant line today forbids abusive
submissions through the feedback form. Publishing other people's photographs of identifiable
people needs a stated takedown route for a photographer and for a subject, and a line saying
whose photographs these are. `/wpbl/sources` is the natural place for the credit half.

**A review rule about crowds.** A rostered player at bat in a public ballpark is ordinary
editorial use and is fine. A clear foreground photograph of members of the public, including
children, is a different question, and the answer is that it does not go up. This belongs in the
review checklist beside the caption field, not in someone's memory.

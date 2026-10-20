# Public photo tagging: anyone names who is in a fan photo

**A plan, not built** (Oct 16, 2026). Written as a plan of record first, like
[`FAN_PHOTOS.md`](FAN_PHOTOS.md), so the reasoning reads as a design argued through. Read that file
first: this one extends its tables and inherits its traps.

## What the queue actually is

Measured against the live database on Oct 16, 2026: **every untagged fan photo is unpublished.**
115 photos have no subject and no category, and all 115 are `approved = false`: 112 from 1221
Photography and 2 from Jason Powell (both uploaded Sep 24), 1 from This Is Women's Baseball
(Sep 29). None carries a `taken_on`, a `game_id` or a caption. Every published photo already has a
subject or a category.

So the feature is not "let fans tag the gallery". It is "show unpublished photographs to anyone,
so they can say who is in them", and every decision below follows from that.

## Scope

In, for the first version:

- `/wpbl/photos/tag`: one photo at a time, pick who is in it from a closed list (the 118 players,
  the figures, the clubs), submit, next. No sign-in.
- Picks land as **suggestions, never tags.** The owner confirms each in `/admin`.
- An owner gate, `open_for_tagging`: a screen, not a publish.
- A report button on every photo in the queue.

Out, each on purpose:

- **Free-text names.** A closed vocabulary means there is nothing to moderate and nothing that can
  be rendered as markup.
- **Auto-accept by consensus.** Wait for the per-suggester accept rate (below) to say whether it
  is safe.
- **Tagging published photos** ("missing someone?"). Nothing published is untagged today.
- **Face boxes**, where in the frame a person stands.
- **Credit or a leaderboard for taggers.**
- **The crowd suggesting the date or the game.** The obvious second version: all 115 lack both.

## Decisions

1. **The public read goes through a security-definer function, and the table's RLS does not
   change.** The gallery, the player strips and the Home card read `wpbl_fan_photos` without
   filtering on `approved`, on purpose: the gate is `select using (approved)`, and FAN_PHOTOS.md
   explains why the client query must not repeat it. Widening that policy to
   `approved or open_for_tagging` would therefore publish all 115 photos, unnamed, in the gallery
   the moment the first one was opened. The queue is readable only through
   `wpbl_photos_to_tag()`, which returns a narrow column list.
2. **Opening a photo for tagging is, in effect, publishing its image.** The R2 renders are public
   to anyone holding the URL, and the tag page hands out the URL. So the screen before opening is
   the screen before publishing: the crowd and children rule from FAN_PHOTOS.md, and the
   contributor's `permission_scope`. It is still far quicker than tagging: a bulk open over the
   batch, minus whatever fails the screen.
3. **Signed-out is right here, though the award ballot moved to sign-in.** The ballot moved
   because its tally was published back, and a key in localStorage is minted again by every
   private window, so the number shown to readers was only as honest as the least patient person
   looking at it (`awardVotes.ts`). Here nothing a suggester does reaches a reader until the owner
   accepts it. A forgeable key costs review noise and inflates the "how many agree" count the
   owner sees, nothing more.
4. **Identity is a random per-browser id in localStorage**, on the pattern of the analytics
   session id in [`src/lib/analytics.ts`](../src/lib/analytics.ts). A signed-in suggester's
   `user_id` is stored beside it, so a later trust rule has something durable to key on.
5. **This is not a fourth write path.** The browser writing its own rows through a definer
   function is the first of the three in
   [`scripts/migrations/CLAUDE.md`](../scripts/migrations/CLAUDE.md), the same footing as the
   award votes. The suggestions table has no SELECT policy for the browser, so it cannot be
   upserted into directly (the trap in that file); the writer function is the only door.

## Schema, one migration

```sql
alter table public.wpbl_fan_photos
  add column open_for_tagging bool not null default false;

create table public.wpbl_photo_tag_suggestions (
  id            uuid primary key default gen_random_uuid(),
  photo_id      uuid not null references public.wpbl_fan_photos (id) on delete cascade,
  player_id     uuid references public.wpbl_players (id) on delete cascade,
  figure_key    text references public.wpbl_photo_figures (key) on delete cascade,
  team_id       text references public.wpbl_teams (id) on delete cascade,
  suggester_key text not null check (char_length(suggester_key) between 8 and 64),
  user_id       uuid,
  status        text not null default 'pending'
                check (status in ('pending', 'accepted', 'rejected')),
  created_at    timestamptz not null default now(),
  check (num_nonnulls(player_id, figure_key, team_id) = 1)
);
-- One row per (photo, suggester, subject): an expression unique index, the same shape as the
-- partial unique indexes on wpbl_photo_subjects.
-- RLS on; one owner-only `for all` policy; NO policy for anon or authenticated.

create table public.wpbl_photo_reports (
  id            uuid primary key default gen_random_uuid(),
  photo_id      uuid not null references public.wpbl_fan_photos (id) on delete cascade,
  suggester_key text not null,
  reason        text not null check (reason in ('private_person', 'child', 'not_wpbl', 'other')),
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);
-- RLS on; owner-only.
```

**The same migration extends `wpbl_merge_players`** to repoint the suggestions' `player_id`,
deleting a dupe's row first where the kept player already has the same suggestion from the same
key. This is FAN_PHOTOS.md's trap 1: the function hand-lists every table holding a `player_id`,
and a table it has not been taught about silently loses the merged player's rows. The two are one
change; splitting them ships the half that breaks.

ARCHITECTURE.md gains both tables and the three functions.

## The three functions

All `security definer`, `set search_path = ''`, granted to `anon, authenticated`.

- **`wpbl_photos_to_tag(p_key text, p_limit int)`.** Photos that are `open_for_tagging`, have no
  subject and no category, carry no unresolved report, and that this key has not already
  answered. Returns `id, card_url, full_url, width, height, credit` and the queue's progress
  (open, named), never `contributor_id`, `storage_path` or anything else on the row. Ordered by
  distinct suggesters ascending, random among ties, so effort spreads across the queue instead of
  piling onto the first photo. A photo leaves the queue the moment the owner confirms a subject.
- **`wpbl_suggest_photo_tags(p_photo uuid, p_key text, p_subjects jsonb)`.** At most ten subjects
  per call. Checks the photo is still open and every subject exists, inserts with
  `on conflict do nothing`, and caps a key at about 300 rows an hour. Returns false rather than
  raising, like `wpbl_cast_award_vote`, so the page can say it did not record something instead of
  parsing an exception.
- **`wpbl_report_photo(p_photo uuid, p_key text, p_reason text)`.** One report takes the photo
  out of the queue until the owner resolves it. One person can therefore hide a photo from
  tagging, which is cheap to undo, and can never publish one.

Verify each as `anon` (`set local role anon; select ...`), the way the vote writer was verified.
**None goes on the edge-cache list** in [`src/lib/edgeTables.ts`](../src/lib/edgeTables.ts):
every answer depends on the caller's key, and a cached one would hand one browser's queue to the
next.

## The public page

`src/wpbl/api/photoTagging.ts` wraps the three calls and mints the key.

`PhotoTagPage.tsx`:

- The photo contained on black, as in admin Tag mode, capped near 50vh so the controls start above
  the fold on a phone.
- "Who's in this photo?": MUI Autocomplete rather than admin's `SubjectPicker`, which is not a
  real combobox and would fail axe on a public page. Each option shows the portrait, jersey number
  and club, because a number and a cap are how a fan recognizes a player in a photo. Names go
  through `NameText`, so a long one shortens to "F. Last", never cut mid-name.
- Club chips to narrow the list, and the reader's recent picks as one-tap chips.
- **Submit & next**, **Skip**, **I don't recognize anyone** (a skip, recorded only as an event),
  and **Report** behind a menu.
- A progress line ("38 of 115 photos have a name") and a finished state pointing to the gallery.
- A loading state that is the loaded page drawn empty, measured with `npm run sweep -- --shift`.

The route, in the four places FAN_PHOTOS.md's trap 4 names: [`routes.ts`](../src/wpbl/routes.ts),
[`seo.ts`](../src/seo.ts) with `noindex` and no sitemap entry (it is a work queue, not content),
the two `public/_redirects` lines, and `routes.test.ts`. The page makes a new query, so the pull
request carries `npm run sweep:record -- --merge --routes /wpbl/photos/tag` and its fixtures.

Entry points: a card on `/wpbl/photos` beside "Your photos", drawn only while the queue is
non-empty; optionally a Home card in the offseason; and a Discord or Bluesky post, which belongs
on the promotion list.

Analytics events: page opened, picks submitted, skipped, reported, queue finished.

## The owner's side, in `AdminPhotos.tsx`

- An **Open for tagging** toggle per photo, and a bulk action over the current filter.
- In `TagFields`, suggestions as ghost chips with their agreement count ("K. Whitmore ×3"): ✓
  inserts the subject and marks the suggestion accepted, ✕ marks it rejected.
- Filters **Has suggestions (n)** and **Reported (n)**; a sort **Most agreed**.
- **Accept all with 2+ agreeing**, the bulk action that makes a batch of 112 a short session.
- **Discard everything from this suggester**, for junk.
- The suggestions read pages with `fetchAllPaged` and a deterministic `.order()`: 115 photos at a
  few suggestions each crosses PostgREST's silent 1000-row cap almost at once (FAN_PHOTOS.md trap
  2), and the failure is suggestions that simply never appear.
- Each key's accept rate (accepted over decided), recorded from day one. It is the only evidence
  that could ever justify auto-accepting.

## Abuse and privacy

Nothing goes public without the owner. There is no free text. Each key is capped and repeats are
ignored. A report pulls a photo at once. Junk clears in one action per key. The realistic worst
case is noise in a review queue.

Terms and `/wpbl/sources` need a line on fan-suggested tags and how to report a photo, which also
closes the takedown gap FAN_PHOTOS.md lists under "The two parts that are not code".

## Phases

1. **Migration and functions**, `wpbl_merge_players` included, verified as `anon`.
2. **The owner's side**: the open toggle, suggestion review, reports. Ships before any public
   traffic, so review works from the first suggestion.
3. **The public page**: route, sweep fixtures, a component test of the flow against mocked RPCs,
   the route tests.
4. **Launch**: entry points, changelog, a section in FAN_PHOTOS.md (its "Curation" section
   anticipates a signed-in curator role; this replaces that idea), the ROADMAP-WPBL entry, then
   screen and open the 1221 Photography batch.

## Open questions for the owner

- Does 1221 Photography's `permission_scope` cover showing their unpublished shots in a public
  tagging queue?
- Keep the tag page out of search? The plan says yes.
- Auto-accept at consensus one day? Only once the accept-rate data supports it.

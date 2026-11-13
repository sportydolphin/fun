# Fan uploads: fans send their own photos

**Planned Nov 12, 2026.** Today a fan sends photos by email (the "Your photos" panel under the
gallery) and the owner uploads them. A fan asked to upload them directly. Read
[`FAN_PHOTOS.md`](FAN_PHOTOS.md) and [`PHOTO_TAGGING.md`](PHOTO_TAGGING.md) first: this extends
both, and reverses FAN_PHOTOS.md's "No fan-facing upload".

That line kept the abuse surface, the storage bill and the moderation queue at zero. Every decision
below exists to keep those three small now that strangers can send images.

## The owner's decisions (Nov 12, 2026)

- **A fan's photo always waits for the owner.** Only the owner's own uploads publish on arrival
  (the trigger in `20261113080000`). An approved fan earns no auto-publish later.
- **Permission is for this website only.** No social sharing, no print. The checkbox says so and
  the stored grant records it.
- **A fan can say who is in their photo.** Those picks land as suggestions in
  `wpbl_photo_tag_suggestions`, reviewed like anyone's, never as tags.
- **Minimum age 13.** As young as is reasonable: under 13, COPPA requires verified parental
  consent before collecting an account or a photo, which this site cannot do. The terms say so.
- **Storage stays on R2,** with a monitor in `/admin` (below). Alternatives were weighed: B2 is
  cheaper per GB past 10 GB but the gap is cents at this size and moving costs a migration;
  Supabase Storage's 1 GB free egress is the ceiling that ruled it out in FAN_PHOTOS.md; Bunny
  bills egress; Cloudflare Images bills from the first photo.

## The flow

1. `/wpbl/photos/submit`. Signed in (required), the fan picks up to 10 photos, sets the name to be
   credited as, optionally names who is in each one, and ticks the permission box.
2. The browser shrinks each photo and makes the two webp renders, as the owner's uploader does
   (`fanPhotoUpload.ts`), and sends them to `/api/fan-submission`.
3. The renders go to a **private** bucket and a row to `wpbl_photo_submissions`. Nothing is public.
4. The owner opens "Submitted" in `/admin`: approve, reject with a reason, or block the uploader.
5. Approving re-renders the photo in the owner's browser from the private copy, uploads it to the
   public bucket through the existing `/api/fan-photo`, and calls `wpbl_approve_photo_submission`,
   which creates the contributor (once per fan), the photo row and the fan's suggestions.
6. The fan is notified: published, or not, with the reason. "Your submissions" on the submit page
   lists each with its state and a Remove button.

## Decisions

1. **Sign-in is required, though tagging is signed-out.** A suggestion is text the owner reads;
   an upload is bytes we store and an image we may be legally answerable for. Every upload needs
   an account to cap, block and trace.
2. **Pending images live in a private bucket.** The public bucket serves every object to anyone
   holding its URL through `photos.sportydolphin.fun`, so a pending image there would already be
   published. A second bucket with no public domain is the only way an unreviewed image is
   unreachable. The owner views pending ones through an owner-gated read in the endpoint.
3. **The published bytes are always made in the owner's browser.** The fan's client strips EXIF
   in a canvas, but a modified client could skip that. Re-rendering at approval, the way a crop
   already works (FAN_PHOTOS.md, "Crops"), means GPS and device tags never reach the public bucket
   whatever the fan's browser did.
4. **The permission record writes itself.** The submission stores the checkbox's exact wording,
   its version (`FAN_UPLOAD_TERMS_VERSION`), the time and the account. Approval turns that into a
   `wpbl_photo_contributors` row (`permission_evidence` = "Uploaded by account <id>, terms vN, at
   <time>", `permission_scope` = 'site display'), linked by `user_id` so a fan's second approval
   reuses it.
5. **Not a fourth write path.** The browser writes its own submission rows through a definer
   function (the first path in [`scripts/migrations/CLAUDE.md`](../scripts/migrations/CLAUDE.md)),
   and the bytes go through a Pages Function like the owner's uploader. The submissions table has
   no browser SELECT policy beyond the fan's own rows, read through a definer function.
6. **The fan can always take a photo down.** Remove on a pending one deletes it; on a published
   one it unpublishes it (sets `approved = false`, the same thing a withdrawal does). Deleting the
   account does both for every photo of theirs, in `delete-account`, and marks their contributor
   record withdrawn.
7. **Limits:** 20 photos a day per account, 300 a day across the site, 8 MB per render (the
   endpoint's existing cap), the sha256 duplicate check against both the library and pending
   submissions, and `wpbl_photo_upload_blocks` by account. A blocked account is told its upload
   worked, as the tagging blocks do.
8. **Pending objects expire.** An R2 lifecycle rule on the private bucket deletes objects after 30
   days, so a rejected or abandoned upload cannot sit in storage forever. Approval copies the
   photo out before then; the review queue shows each one's age.

## Storage and its monitor

R2's free tier, per month: 10 GB stored, 1 million Class A operations (writes), 10 million Class
B (reads), and free egress. Past it: $0.015 per GB-month, $4.50 per million writes, $0.36 per
million reads. On Nov 12, 2026 the 263 photos were about 225 MB, about 2% of the free storage. R2
has no spending cap, so the risk is a burst of uploads, not running out; the limits above are the
guard, and the monitor is the net.

- **`scripts/watch-r2-storage.mjs`**, daily (`r2-storage-watch.yml`), reads every bucket's size,
  object count and the month's operations from Cloudflare's GraphQL analytics API
  (`r2StorageAdaptiveGroups`, `r2OperationsAdaptiveGroups`) and writes one row per bucket per day
  to `r2_storage_snapshots` (owner-only). The math is in [`shared/r2Usage.js`](../shared/r2Usage.js),
  beside its tests.
- **It pushes to the owner** the first time in a month the account crosses 80% of any free
  allowance, once per allowance per month (`r2_usage_alerts`).
- **`/admin` → Photos → Storage** shows each bucket, the account against the free tier, and the
  30-day trend.
- **Credentials:** a Cloudflare API token with Account Analytics Read only, stored as the GitHub
  secret `CLOUDFLARE_ANALYTICS_TOKEN`, plus `CLOUDFLARE_ACCOUNT_ID`. The token never reaches the
  browser, which is why this is a job and not a live call from `/admin`.

## The owner's setup (not code)

1. Create the private bucket `sportydolphin-wpbl-photo-submissions`, with no custom domain and no
   public access. Add an object lifecycle rule: delete objects after 30 days.
2. Add `R2_SUBMISSIONS_BUCKET` to the Cloudflare Pages env beside the other R2 keys. The existing
   R2 token must be allowed to write the new bucket (or make a second token for it).
3. Create a Cloudflare API token, Account Analytics Read, and add `CLOUDFLARE_ANALYTICS_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID` as GitHub Actions secrets.
4. Turn on Cloudflare's CSAM Scanning Tool for the zone (Caching → Configuration), which needs a
   reporting email. Once strangers can upload images it is the minimum net. It scans what the zone
   serves, so it covers published photos; the private bucket is covered by review.

## Phases

1. **This plan and the storage monitor.** The table, the job, the `/admin` card, the 80% push.
   Ships first because it is useful already and needs nothing from the phases after.
   *Shipped Nov 13, 2026.*
2. **The database and the owner's review queue.** `wpbl_photo_submissions`, the blocks, the
   writer, the fan's own read, approve and reject (definer, owner-checked), the endpoint
   (`/api/fan-submission`, signed-in, private bucket, owner read), "Submitted" in `/admin`.
   Verified as `anon` and as a plain signed-in user, as the tagging functions were.
   *Built Nov 13, 2026* (`20261113170000_fan_photo_submissions.sql`, `functions/api/fan-submission.ts`,
   `AdminPhotoSubmissions.tsx`). The permission wording is a row in `wpbl_photo_upload_terms`, not
   a constant in code. Approving drops a pick whose player was merged away while the photo waited:
   the picks are ids inside jsonb, which `wpbl_merge_players` cannot see. **`delete-account` is not
   taught about submissions yet** (phase 4): the rows cascade with the account, but an approved
   photo stays up under a contributor whose `user_id` goes null. *Closed in phase 3.*
3. **The public page.** `/wpbl/photos/submit` (the four places a route needs), the permission
   text, "Your submissions" with Remove, the gallery panel pointing to it instead of email, sweep
   fixtures, and component tests against mocked calls.
   *Built Nov 13, 2026* (`PhotoSubmitPage.tsx`), together with phase 4's terms, privacy and
   `delete-account`, since the page could not go live without them. The picker is
   `PhotoSubjectPicker.tsx`, shared with the tagging page. The gallery panel links the page first
   and keeps the email for a fan who would rather not make an account.
4. **Launch.** Terms (the license a fan grants, content rules, age 13, takedown), privacy (what is
   stored), `delete-account`, the two notifications (to the owner on a submission, to the fan on a
   decision), the changelog, and the setup steps above. *Terms, privacy and `delete-account`
   shipped with phase 3; the notifications are what is left.* `delete-account` marks the fan's
   contributor record withdrawn (unlinking the account) and unpublishes their photos, and deletes
   their submissions.

## Out, each on purpose

- **Auto-publish for trusted fans.** The owner's call: every fan photo is reviewed.
- **Video.** A different size, a different moderation problem.
- **Uploads without an account.**
- **Captions and dates from the fan as published text.** A fan's note rides to the owner as a
  review note (plain text, never rendered as markup); the owner writes the caption.

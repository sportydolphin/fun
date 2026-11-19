-- instagram posts flagged for review
-- Created 2026-11-19. Applied by scripts/migrate.mjs.
--
-- During the re-signing window the watcher also sends Discord every post it is unsure of, for a
-- person to look at (scripts/watch-wpbl-instagram.mjs, needsReview). This is when it did, so it
-- does so once. Kept apart from announced_at on purpose: a flagged post whose caption is later
-- edited into a clear re-signing must still be recorded and announced, and announced_at set
-- here would stop that.

alter table public.wpbl_instagram_posts add column if not exists flagged_at timestamptz;

-- Every post already stored was read by a person on Nov 19, 2026, when the two misses were
-- found. Without this the first run would flag them all again.
update public.wpbl_instagram_posts set flagged_at = now() where flagged_at is null;

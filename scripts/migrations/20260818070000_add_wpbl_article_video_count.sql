-- wpbl_articles.video_count: how many baseball clips are embedded in a post.
--
-- Her posts are not only prose. She embeds YouTube clips of the plays she is describing,
-- often deep-linked to the exact moment (`?start=91`), and the WPBL posts carry up to five
-- of them. Reading one of those is watching as much as reading, and the read-time estimate
-- was counting only the words, so a short video-heavy post read as far quicker than it is.
--
-- Nullable on purpose, and NULL means "we have not been able to look", not "zero". The sync
-- can only count embeds for posts still inside the RSS window that carries article bodies;
-- older posts reach us through the archive API, which has no body in it. See the sync for
-- how a row with no readable body keeps the counts it already had instead of being reset.

alter table public.wpbl_articles
  add column if not exists video_count int;

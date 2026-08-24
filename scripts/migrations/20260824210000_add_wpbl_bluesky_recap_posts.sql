-- wpbl_bluesky_recap_posts: which finished games have been posted to Bluesky, and when we
-- first saw each one go final.
--
-- WHY THIS IS NOT A COPY OF wpbl_discord_recap_posts. Discord messages can be EDITED, and the
-- Discord job leans on that: it re-renders every recent final on every run and PATCHes the ones
-- whose text changed, so a late scoring correction quietly fixes itself in the channel.
--
-- BLUESKY HAS NO EDIT. A post is published or deleted, in public, and nothing in between. That
-- single difference changes the whole design:
--
--   * There is no content hash here, because there is nothing to compare it against. Once a
--     game is posted it is finished, correct or not.
--
--   * So the job must not post a game the moment it goes final. wpbl_play_corrections exists
--     precisely because the league's scoring has errors in it, and the recap wording itself is
--     derived and has changed under us before. first_final_at records when we FIRST saw the
--     game final; the job posts it on a later run, once it has been settled for a while. Two
--     phases, one row: seeing and publishing are separate, the same way the mention watcher
--     separates seeing and announcing, and for the same reason.
--
--   * posted_at with a null post_uri and a skipped_reason is a game deliberately never posted.
--     That is how switching the job on records a season of history as handled instead of
--     publishing all of it at once.
create table if not exists public.wpbl_bluesky_recap_posts (
  game_id        uuid primary key references public.wpbl_games (id) on delete cascade,
  -- When this job first observed the game as final. NOT the game's own timestamp: the point is
  -- how long WE have held it, which is what the settle window is measured against.
  first_final_at timestamptz not null default now(),
  posted_at      timestamptz,
  -- The at:// uri and cid of the published post, kept so it can be found and deleted by hand if
  -- a game turns out to have been posted with wrong numbers. Without the uri there is no way
  -- back to a post except scrolling the timeline.
  post_uri       text,
  post_cid       text,
  -- Set when a row is closed without publishing: 'seeded' for the backfill guard, and whatever
  -- else a future rule needs. A row with this set is never posted.
  skipped_reason text
);

-- The job's one hot query: games seen final, not yet resolved either way.
create index if not exists wpbl_bluesky_recap_posts_pending_idx
  on public.wpbl_bluesky_recap_posts (first_final_at)
  where posted_at is null and skipped_reason is null;

comment on table public.wpbl_bluesky_recap_posts is
  'Which WPBL finals have been posted to Bluesky, written by '
  'scripts/post-wpbl-bluesky-recaps.ts. Bluesky posts cannot be edited, so unlike the Discord '
  'equivalent there is no content hash and nothing is ever re-sent: first_final_at exists so a '
  'game is published only after it has been settled long enough for corrections to land.';

-- Server-only bookkeeping, same as every other posting job: RLS on, no policies, so the anon
-- and authenticated keys read it as empty. The job uses the service role and bypasses it.
alter table public.wpbl_bluesky_recap_posts enable row level security;

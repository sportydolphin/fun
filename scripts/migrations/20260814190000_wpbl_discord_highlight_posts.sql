-- One row per YouTube highlight reel that the Discord highlights poster has handled.
--
-- scripts/post-wpbl-discord-highlights.mjs watches the wpbl_videos rows that
-- scripts/sync-wpbl-youtube.mjs mirrors from the league's channel, and posts each new
-- game highlight into the fan server's highlights channel. It needs exactly one thing
-- remembered per video: have we already sent it. Keyed by the YouTube video id, which is
-- the same natural key wpbl_videos uses.
--
-- Unlike the recap poster's table there is no content hash here, because there is nothing
-- to re-render: a highlight message is a link that Discord unfurls into its own player,
-- and the league does not revise an upload the way it revises a box score. Post once,
-- remember, never touch again.
--
-- message_id null means "handled, deliberately never posted" — what the first run writes
-- for every reel older than the newest one, so switching the job on puts a single video
-- in the channel instead of the whole season's back catalogue.
create table if not exists public.wpbl_discord_highlight_posts (
  video_id   text primary key references public.wpbl_videos (video_id) on delete cascade,
  message_id text,
  -- Kept for debugging only: which game the video was matched to (if any) and what the
  -- title read at the time we posted. Neither is used to decide anything.
  game_id    uuid references public.wpbl_games (id) on delete set null,
  title      text,
  posted_at  timestamptz not null default now()
);

-- Bookkeeping for a CI job, not public data: the anon key can't see it, and the poster
-- runs with the service role (which bypasses RLS). No policies on purpose — same shape as
-- wpbl_discord_recap_posts.
alter table public.wpbl_discord_highlight_posts enable row level security;

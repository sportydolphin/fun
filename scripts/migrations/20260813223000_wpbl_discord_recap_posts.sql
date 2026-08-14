-- One row per WPBL final that the Discord recap poster has handled.
--
-- scripts/post-wpbl-discord-recaps.ts posts a box score when a game goes final and then
-- edits that same message if the stats are later corrected, so it has to remember two
-- things per game: which message is ours, and what we last rendered into it. The hash is
-- what keeps a quiet run quiet — the job re-renders every recent final each pass and only
-- calls Discord when the rendered message actually differs.
--
-- message_id null means "handled, deliberately never posted" — what the first run writes
-- for every final older than the newest one, so switching the job on puts a single game in
-- the channel instead of a season.
create table if not exists public.wpbl_discord_recap_posts (
  game_id      uuid primary key references public.wpbl_games (id) on delete cascade,
  message_id   text,
  content_hash text not null,
  posted_at    timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Bookkeeping for a CI job, not public data: the anon key can't see it, and the poster
-- runs with the service role (which bypasses RLS). No policies on purpose.
alter table public.wpbl_discord_recap_posts enable row level security;

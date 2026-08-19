-- One row per player birthday that the Discord birthday poster has handled.
--
-- scripts/post-wpbl-discord-birthdays.ts runs once a morning, finds whoever on the roster
-- has a birthday that day, and posts a single message naming all of them. It needs exactly
-- one thing remembered: which birthdays are already in the channel. Keyed by player and by
-- the date the birthday fell on, so the same player is greeted again next year and never
-- twice in one year, however many times the job runs.
--
-- The date, not the year, is the second half of the key: it reads the way the job thinks
-- ("has 2026-08-18 been posted for this player"), and it keeps the row useful as a record
-- of what was said when.
--
-- message_id is the Discord message all of that day's birthdays share, since one message
-- covers however many people had a birthday. It is kept for debugging only: nothing edits
-- a birthday post afterwards. A birthday is not revised the way a box score is.
create table if not exists public.wpbl_discord_birthday_posts (
  player_id   uuid not null references public.wpbl_players (id) on delete cascade,
  birthday_on date not null,
  message_id  text,
  posted_at   timestamptz not null default now(),
  primary key (player_id, birthday_on)
);

-- Bookkeeping for a CI job, not public data: the anon key cannot see it, and the poster
-- runs with the service role (which bypasses RLS). No policies on purpose, same shape as
-- wpbl_discord_recap_posts and wpbl_discord_highlight_posts.
alter table public.wpbl_discord_birthday_posts enable row level security;

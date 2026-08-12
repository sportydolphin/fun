-- wpbl_discord_board_state — remembers which Discord message the board writer owns,
-- so it EDITS that one message every run instead of posting a new board each time.
-- Previously this id lived in a GitHub Actions repo variable that a human had to copy
-- in by hand after the first run; any scheduled run that fired before that happened saw
-- an empty id and posted a duplicate. Persisting it here makes the script self-seed on
-- its first run and self-heal if the message is ever deleted. Run once in the Supabase
-- SQL editor before the next scheduled run (see scripts/update-wpbl-discord-board.mjs).

create table if not exists public.wpbl_discord_board_state (
  id         text primary key,   -- constant key ('board'); one row per board
  message_id text not null,
  updated_at timestamptz not null default now()
);

-- Server-only bookkeeping: the board writer uses the service role key (bypasses RLS).
-- Enabling RLS with no client policies means signed-in users can't read or write it.
alter table public.wpbl_discord_board_state enable row level security;

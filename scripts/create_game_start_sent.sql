-- game_start_sent — one row per (user, game) game-start push already delivered.
-- The sender (scripts/send-game-start.mjs) runs every few minutes; this log is
-- how it fires each reminder exactly once instead of on every pass. Run once in
-- the Supabase SQL editor before scheduling the workflow.

create table if not exists public.game_start_sent (
  user_id   uuid   not null references auth.users(id) on delete cascade,
  game_pk   bigint not null,
  game_date date   not null,
  sent_at   timestamptz not null default now(),
  primary key (user_id, game_pk)
);

create index if not exists game_start_sent_date_idx
  on public.game_start_sent (game_date);

-- Server-only bookkeeping: the sender uses the service role key (bypasses RLS).
-- Enabling RLS with no client policies means signed-in users can't read or write
-- it, which is what we want.
alter table public.game_start_sent enable row level security;

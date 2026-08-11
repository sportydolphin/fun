-- WPBL game-start reminders — the "notify me before this game" opt-in behind the
-- bell on the WPBL Home next-game card. Two tables, mirroring the MLB game-start
-- setup (add_game_start_prefs.sql + create_game_start_sent.sql) but keyed on WPBL's
-- own uuid game ids rather than a StatsAPI gamePk.
--
-- Run once in the Supabase SQL editor before shipping the toggle. Both tables
-- degrade gracefully: until this runs, the client's opt-in write fails softly and
-- the toggle simply reports it couldn't save.

-- ─── wpbl_game_reminders ────────────────────────────────────────────────────────
-- One row per (user, game) a signed-in fan has opted into. The row IS the opt-in —
-- counting rows (or distinct user_ids) tells you how many people turned reminders
-- on, so this doubles as the durable "account info" record alongside the analytics
-- event the client also fires. Deleting the row is how a user opts back out.
create table if not exists public.wpbl_game_reminders (
  user_id    uuid not null references auth.users (id) on delete cascade,
  game_id    uuid not null references public.wpbl_games (id) on delete cascade,
  game_date  date not null,
  lead_min   integer not null default 30,   -- heads-up window before first pitch
  created_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

create index if not exists wpbl_game_reminders_game_idx
  on public.wpbl_game_reminders (game_id);
create index if not exists wpbl_game_reminders_date_idx
  on public.wpbl_game_reminders (game_date);

alter table public.wpbl_game_reminders enable row level security;

-- A signed-in user can see, add, and remove only their own reminders. The server
-- sender uses the service role key, which bypasses RLS.
drop policy if exists "own wpbl reminders - select" on public.wpbl_game_reminders;
create policy "own wpbl reminders - select" on public.wpbl_game_reminders
  for select using (auth.uid() = user_id);

drop policy if exists "own wpbl reminders - insert" on public.wpbl_game_reminders;
create policy "own wpbl reminders - insert" on public.wpbl_game_reminders
  for insert with check (auth.uid() = user_id);

drop policy if exists "own wpbl reminders - update" on public.wpbl_game_reminders;
create policy "own wpbl reminders - update" on public.wpbl_game_reminders
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own wpbl reminders - delete" on public.wpbl_game_reminders;
create policy "own wpbl reminders - delete" on public.wpbl_game_reminders
  for delete using (auth.uid() = user_id);

-- ─── wpbl_game_start_sent ───────────────────────────────────────────────────────
-- One row per (user, game) reminder already delivered. The sender
-- (scripts/send-wpbl-game-start.mjs) runs every few minutes; this log is how it
-- fires each reminder exactly once instead of on every pass.
create table if not exists public.wpbl_game_start_sent (
  user_id   uuid not null references auth.users (id) on delete cascade,
  game_id   uuid not null references public.wpbl_games (id) on delete cascade,
  game_date date not null,
  sent_at   timestamptz not null default now(),
  primary key (user_id, game_id)
);

create index if not exists wpbl_game_start_sent_date_idx
  on public.wpbl_game_start_sent (game_date);

-- Server-only bookkeeping: the sender uses the service role key (bypasses RLS).
-- Enabling RLS with no client policies keeps signed-in users out entirely.
alter table public.wpbl_game_start_sent enable row level security;

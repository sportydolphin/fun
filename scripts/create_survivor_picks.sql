-- Run this once in your Supabase SQL editor (Dashboard → SQL Editor)
--
-- Streak Survivor: pick one hitter a day. A hit extends your streak; an 0-fer
-- resets it to 0. Days the player doesn't play are voided (streak preserved).
--
-- Two tables, same split as the predictions game:
--   • survivor_picks  — the source of truth, one row per user per day
--   • survivor_stats  — per-user current/longest streak, maintained by the nightly
--                       resolver so the leaderboard is a single cheap read instead
--                       of re-walking everyone's pick history in the browser.

-- ─── Picks ──────────────────────────────────────────────────────────────────

create table if not exists survivor_picks (
  user_id     text not null,
  game_date   date not null,                 -- the day the pick is for (local ET day)
  player_id   integer not null,
  player_name text not null,
  team_id     integer not null,
  result      text not null default 'pending' -- pending | hit | miss | void
    check (result in ('pending', 'hit', 'miss', 'void')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (user_id, game_date)            -- one pick per user per day
);

-- Resolver scans by date + pending status.
create index if not exists survivor_picks_pending_idx
  on survivor_picks (game_date) where result = 'pending';

alter table survivor_picks enable row level security;

-- Anyone can read picks (leaderboard drill-downs, crowd "most-picked" later).
create policy "Public read survivor_picks"
  on survivor_picks for select using (true);

-- A signed-in user may write only their own rows. The client blocks edits once
-- the player's game has started; the nightly resolver (service-role key, bypasses
-- RLS) is the authority on result. Result is *not* protected here, so keep the
-- client from writing anything but 'pending' — resolution happens server-side.
create policy "Users manage own survivor_picks"
  on survivor_picks for all
  using  (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);

-- ─── Stats (resolver-maintained) ────────────────────────────────────────────

create table if not exists survivor_stats (
  user_id        text primary key,
  display_name   text not null default 'Anonymous',
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  total_hits     integer not null default 0,
  total_picks    integer not null default 0,  -- resolved picks (hit + miss), excludes void/pending
  last_result_date date,
  updated_at     timestamptz not null default now()
);

alter table survivor_stats enable row level security;

-- Public read for the leaderboard (names resolved from `usernames` at read time).
create policy "Public read survivor_stats"
  on survivor_stats for select using (true);

-- Only the resolver (service role) writes this table, so no write policy for
-- regular users — RLS with no permissive policy denies client writes by default.

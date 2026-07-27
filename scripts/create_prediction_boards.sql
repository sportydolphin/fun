-- Run this once in your Supabase SQL editor (Dashboard → SQL Editor)
--
-- Windowed prediction leaderboards (last 7 days, last 30 days). Correctness is
-- derived from the StatsAPI schedule, not stored per pick, so a windowed board
-- can't be a SQL aggregate — a nightly job (scripts/update-prediction-boards.mjs)
-- tallies each user's record in the window and writes one jsonb row per window.
-- The all-time board stays a live read of prediction_stats.

create table if not exists prediction_boards (
  window      text primary key,                 -- 'week' | 'month'
  data        jsonb not null,                    -- { entries: { userId, displayName, correct, total, accuracy }[] }
  computed_at timestamptz not null default now()
);

-- Anyone can read (same as streak_leaders / milestone_watch)
alter table prediction_boards enable row level security;

create policy "Public read prediction_boards"
  on prediction_boards for select using (true);

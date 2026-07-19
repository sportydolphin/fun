-- Run this once in your Supabase SQL editor (Dashboard → SQL Editor)

create table if not exists streak_leaders (
  season      integer primary key,
  data        jsonb not null,                    -- { hitting: StreakRow[], hitless: StreakRow[], scoreless: StreakRow[] }
  computed_at timestamptz not null default now()
);

-- Anyone can read (same as team_payrolls)
alter table streak_leaders enable row level security;

create policy "Public read streak_leaders"
  on streak_leaders for select using (true);

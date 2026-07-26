-- Run this once in your Supabase SQL editor (Dashboard → SQL Editor)

create table if not exists playoff_odds (
  season      integer primary key,
  data        jsonb not null,                    -- OddsRow[] (one entry per team: makePlayoffs, winDivision, projWins, ...)
  computed_at timestamptz not null default now()
);

-- Anyone can read (same as streak_leaders / team_payrolls)
alter table playoff_odds enable row level security;

create policy "Public read playoff_odds"
  on playoff_odds for select using (true);

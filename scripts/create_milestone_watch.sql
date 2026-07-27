-- Run this once in your Supabase SQL editor (Dashboard → SQL Editor)

create table if not exists milestone_watch (
  season      integer primary key,
  data        jsonb not null,                    -- { items: MilestoneItem[] } — active players near career/season/record milestones
  computed_at timestamptz not null default now()
);

-- Anyone can read (same as playoff_odds / streak_leaders)
alter table milestone_watch enable row level security;

create policy "Public read milestone_watch"
  on milestone_watch for select using (true);

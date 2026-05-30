-- Run this once in your Supabase SQL editor (Dashboard → SQL Editor)

create table if not exists team_payrolls (
  team_id    integer not null,
  season     integer not null,
  payroll_m  numeric(8, 2) not null,           -- millions, e.g. 196.33
  updated_at timestamptz not null default now(),
  primary key (team_id, season)
);

-- Anyone can read (same as standings / team stats)
alter table team_payrolls enable row level security;

create policy "Public read team_payrolls"
  on team_payrolls for select using (true);

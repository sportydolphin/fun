-- Run this once in your Supabase SQL editor (Dashboard → SQL Editor)
--
-- Player contract + team-control data, scraped alongside team payrolls by
-- scripts/update-payrolls.mjs (both come out of the same FanGraphs response).
--
-- Keyed by MLBAM id — the same player id StatsAPI uses everywhere else in the
-- app — so the player page joins straight to it with no name matching.

create table if not exists player_contracts (
  mlbam_id           integer not null primary key,
  player_name        text    not null,
  team_id            integer not null,          -- MLB team id (not FanGraphs')
  contract_type      text,                      -- Extension / Free Agent / Arbitration / Pre-Arbitration
  years_total        integer,
  total_value        bigint,                    -- whole dollars, e.g. 170000000
  aav                numeric(14, 2),
  start_season       integer,
  end_season         integer,
  service_time       text,                      -- "5.028" = 5 years, 28 days
  free_agent_season  integer,                   -- first season they can hit the market
  description        text,                      -- FanGraphs' own summary line
  -- [{ season, type, salary }] through free agency, including future arb years
  -- for pre-arb players. Small (5-10 entries) and always read whole.
  years              jsonb   not null default '[]'::jsonb,
  updated_at         timestamptz not null default now()
);

-- Player pages are looked up one player at a time.
create index if not exists player_contracts_team_idx on player_contracts (team_id);

-- Anyone can read (same as team_payrolls / standings)
alter table player_contracts enable row level security;

create policy "Public read player_contracts"
  on player_contracts for select using (true);

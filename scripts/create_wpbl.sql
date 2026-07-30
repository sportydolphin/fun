-- Run this once in your Supabase SQL editor (Dashboard → SQL Editor).
--
-- WPBL (Women's Pro Baseball League) — the schema for the new /wpbl site section.
-- Unlike the MLB app (read-only against StatsAPI), WPBL has no public data feed, so
-- Supabase IS the source of truth: the site owner enters data, the public reads it.
--
-- Access model (mirrors scripts/create_feedback.sql):
--   * Reads  — open to everyone (anon + authenticated). The section is public.
--   * Writes — owner-only, gated server-side by public.is_site_owner() (non-spoofable;
--              reads the confirmed email from auth.users by the caller's verified
--              auth.uid()). The client-side ADMIN_EMAIL check in App.tsx is cosmetic.
--
-- This script only creates the tables + RLS. Static seed data (the 4 teams, rosters,
-- and the schedule) loads separately via scripts/seed_wpbl.sql. The batting/pitching
-- line tables are defined here even though box-score entry is a later phase, so we
-- don't need a second hand-run migration once that work starts.

-- ─── Owner gate ───────────────────────────────────────────────────────────────
-- Non-spoofable owner check (see scripts/harden_admin_gate.sql for the rationale).
-- Defined create-or-replace so this script is safe to run alongside the others that
-- also define it.
create or replace function public.is_site_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid() and email = 'snichols246@gmail.com' and email_confirmed_at is not null
  );
$$;
revoke all on function public.is_site_owner() from public;
grant execute on function public.is_site_owner() to authenticated;

-- ─── Teams ──────────────────────────────────────────────────────────────────
-- id is a short human-readable slug/abbr (e.g. 'BOS', 'LA') rather than a generated
-- uuid: there are only four teams, they never change, and a readable id makes URLs,
-- the color map, and foreign keys easy to eyeball. Colors + logo are ours to host
-- (there is no mlbstatic.com equivalent for this league).
create table if not exists wpbl_teams (
  id              text primary key,          -- short abbr/slug, e.g. 'BOS'
  city            text not null,             -- 'Boston'
  name            text not null,             -- nickname, 'Hunters'
  abbr            text not null,             -- display abbr, 'BOS'
  color           text,                      -- primary team color, hex
  color_secondary text,                      -- optional secondary, hex
  logo_url        text,                      -- hosted logo asset
  sort_order      int  not null default 0,   -- stable display ordering
  created_at      timestamptz not null default now()
);

-- ─── Players ────────────────────────────────────────────────────────────────
-- No external id source, so uuid PK. team_id may be null (unassigned / free agent),
-- and rosters can be partial early — nothing here requires a full roster.
create table if not exists wpbl_players (
  id            uuid primary key default gen_random_uuid(),
  team_id       text references wpbl_teams (id) on delete set null,
  name          text not null,
  position      text,                        -- 'P', 'C', '1B', 'OF', ...
  bats          text,                        -- 'L' | 'R' | 'S'
  throws        text,                        -- 'L' | 'R'
  jersey_number text,                        -- text: preserves leading zeros (unused for now)
  age           int,
  hometown      text,
  status        text,                        -- 'Signed' | 'Drafted'
  draft_round   int,
  draft_pick    int,
  bio           text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists wpbl_players_team_idx on wpbl_players (team_id);
-- Natural key so roster seeds can `on conflict (team_id, name) do nothing`.
create unique index if not exists wpbl_players_team_name_idx on wpbl_players (team_id, name);

-- ─── Games ──────────────────────────────────────────────────────────────────
-- status: 'scheduled' → 'live' → 'final'. Scores are null until played; a game can
-- exist with a final score but no box-score lines yet (the section must render that
-- gracefully). innings tracks the length for extra-inning display (e.g. Final/10).
create table if not exists wpbl_games (
  id           uuid primary key default gen_random_uuid(),
  game_date    date not null,
  start_time   text,                          -- free-form local start, e.g. '5:00 PM'
  home_team_id text not null references wpbl_teams (id),
  away_team_id text not null references wpbl_teams (id),
  venue        text,
  status       text not null default 'scheduled'
               check (status in ('scheduled', 'live', 'final')),
  home_score   int,
  away_score   int,
  innings      int,                           -- scheduled/played innings (extras > 7/9)
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists wpbl_games_date_idx on wpbl_games (game_date desc);

-- ─── Batting lines (one row per player per game) ──────────────────────────────
-- Phase 1 entry; defined now to avoid a second migration. team_id is denormalized
-- for easy per-side grouping without a join back through the game.
create table if not exists wpbl_batting_lines (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references wpbl_games (id) on delete cascade,
  player_id     uuid not null references wpbl_players (id) on delete cascade,
  team_id       text references wpbl_teams (id) on delete set null,
  batting_order int,                          -- 1-9 (null = did not start / sub)
  position      text,
  ab            int not null default 0,
  r             int not null default 0,
  h             int not null default 0,
  doubles       int not null default 0,
  triples       int not null default 0,
  hr            int not null default 0,
  rbi           int not null default 0,
  bb            int not null default 0,
  so            int not null default 0,
  hbp           int not null default 0,
  sb            int not null default 0,
  cs            int not null default 0,
  created_at    timestamptz not null default now(),
  unique (game_id, player_id)
);
create index if not exists wpbl_batting_game_idx  on wpbl_batting_lines (game_id);
create index if not exists wpbl_batting_player_idx on wpbl_batting_lines (player_id);

-- ─── Pitching lines (one row per pitcher per game) ────────────────────────────
-- Innings pitched are stored as `outs` (integer) rather than the "5.2" decimal form,
-- so season ERA/WHIP totals aggregate cleanly (1 inning = 3 outs). The UI converts
-- outs → the familiar IP display. decision = 'W' | 'L' | 'S' | 'H' | null.
create table if not exists wpbl_pitching_lines (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references wpbl_games (id) on delete cascade,
  player_id     uuid not null references wpbl_players (id) on delete cascade,
  team_id       text references wpbl_teams (id) on delete set null,
  outs          int not null default 0,       -- innings pitched, in outs
  bf            int,                           -- batters faced
  h             int not null default 0,
  r             int not null default 0,
  er            int not null default 0,
  bb            int not null default 0,
  so            int not null default 0,
  hr            int not null default 0,
  pitches       int,
  decision      text check (decision in ('W', 'L', 'S', 'H')),
  created_at    timestamptz not null default now(),
  unique (game_id, player_id)
);
create index if not exists wpbl_pitching_game_idx   on wpbl_pitching_lines (game_id);
create index if not exists wpbl_pitching_player_idx on wpbl_pitching_lines (player_id);

-- ─── RLS: public read, owner-only write (every table) ─────────────────────────
alter table wpbl_teams          enable row level security;
alter table wpbl_players        enable row level security;
alter table wpbl_games          enable row level security;
alter table wpbl_batting_lines  enable row level security;
alter table wpbl_pitching_lines enable row level security;

-- Public read.
create policy "WPBL teams are public"          on wpbl_teams          for select using (true);
create policy "WPBL players are public"        on wpbl_players        for select using (true);
create policy "WPBL games are public"          on wpbl_games          for select using (true);
create policy "WPBL batting lines are public"  on wpbl_batting_lines  for select using (true);
create policy "WPBL pitching lines are public" on wpbl_pitching_lines for select using (true);

-- Owner-only writes (insert / update / delete) on every table.
create policy "Owner writes WPBL teams"          on wpbl_teams          for all using (public.is_site_owner()) with check (public.is_site_owner());
create policy "Owner writes WPBL players"        on wpbl_players        for all using (public.is_site_owner()) with check (public.is_site_owner());
create policy "Owner writes WPBL games"          on wpbl_games          for all using (public.is_site_owner()) with check (public.is_site_owner());
create policy "Owner writes WPBL batting lines"  on wpbl_batting_lines  for all using (public.is_site_owner()) with check (public.is_site_owner());
create policy "Owner writes WPBL pitching lines" on wpbl_pitching_lines for all using (public.is_site_owner()) with check (public.is_site_owner());

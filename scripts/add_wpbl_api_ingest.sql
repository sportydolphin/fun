-- Run this once in your Supabase SQL editor (Dashboard → SQL Editor), AFTER
-- scripts/create_wpbl.sql and scripts/add_wpbl_live.sql. Safe to re-run (everything is
-- guarded with `if not exists` / create-or-replace).
--
-- WPBL OFFICIAL FEED INGESTION (Phase: API mirror) — the league now publishes a public
-- JSON API at https://stats.womensprobaseballleague.com/v1, so Supabase flips from a
-- HAND-ENTRY source of truth to a MIRROR of the official feed. The `wpbl-ingest` Edge
-- Function pulls the feed on a schedule and upserts into these tables; the public reads
-- them exactly as before. The old hand-entry / live-scoring path is retired (its tables
-- — wpbl_batting_lines / wpbl_pitching_lines / wpbl_plays — are reused where they fit,
-- extended here to hold everything the feed provides).
--
-- Identity: the feed has its own opaque ids for teams, players, and games. We keep our
-- readable team slugs ('BOS') and existing player uuids, and add an `api_id` on each so
-- ingestion can reconcile without fragile name matching. Games gain `api_game_id` and
-- become owned by the feed (upserted on that key).
--
-- Access mirrors create_wpbl.sql: public read; writes are owner-only via is_site_owner()
-- for the dashboard, and the Edge Function writes with the service-role key (which
-- bypasses RLS), so no extra write policy is needed for ingestion.

-- ─── Teams: API id + seed the 4 mappings ──────────────────────────────────────
alter table wpbl_teams add column if not exists api_id text;
create unique index if not exists wpbl_teams_api_id_idx on wpbl_teams (api_id) where api_id is not null;

update wpbl_teams set api_id = '9f08or2mffx81409' where id = 'BOS' and api_id is distinct from '9f08or2mffx81409';
update wpbl_teams set api_id = 'v4gisr4rbgmn67b0' where id = 'LA'  and api_id is distinct from 'v4gisr4rbgmn67b0';
update wpbl_teams set api_id = 'fttth861nft1j2s7' where id = 'NY'  and api_id is distinct from 'fttth861nft1j2s7';
update wpbl_teams set api_id = 'vhubhz8li07tmgq8' where id = 'SF'  and api_id is distinct from 'vhubhz8li07tmgq8';

-- ─── Players: API id for robust reconciliation ────────────────────────────────
-- Ingestion resolves a boxscore player by api_id first; on a miss it matches by
-- (team_id, normalized name) and backfills api_id; on a total miss it inserts a new
-- roster row (feed-only players with no seeded bio). uniform/bats/throws come from the
-- feed and are kept fresh.
alter table wpbl_players add column if not exists api_id text;
create unique index if not exists wpbl_players_api_id_idx on wpbl_players (api_id) where api_id is not null;

-- ─── Games: feed ownership + line score / R-H-E-LOB ───────────────────────────
-- api_game_id is the upsert key (unique). The line score for each side is stored as a
-- jsonb array of {inning, runs} — there is exactly one consumer (the box score header),
-- so a small denormalized blob beats a join table. status_detail preserves the feed's
-- richer text ("Final - Weather Delay") while status stays the app's enum.
alter table wpbl_games add column if not exists api_game_id  text;
alter table wpbl_games add column if not exists season_id    text;
alter table wpbl_games add column if not exists game_type    text;      -- 'regular' | ...
alter table wpbl_games add column if not exists status_detail text;     -- verbatim feed status
alter table wpbl_games add column if not exists counts_in_standings boolean;
alter table wpbl_games add column if not exists home_hits    int;
alter table wpbl_games add column if not exists away_hits    int;
alter table wpbl_games add column if not exists home_errors  int;
alter table wpbl_games add column if not exists away_errors  int;
alter table wpbl_games add column if not exists home_lob     int;
alter table wpbl_games add column if not exists away_lob     int;
alter table wpbl_games add column if not exists home_line    jsonb;     -- [{inning,runs}, ...]
alter table wpbl_games add column if not exists away_line    jsonb;
alter table wpbl_games add column if not exists source_updated_at timestamptz;
-- FULL (non-partial) unique index: the ingest upserts with ON CONFLICT (api_game_id),
-- and Postgres will not infer a *partial* index for ON CONFLICT. NULLs are still allowed
-- and treated as distinct, so manually-added rows without a feed id are unaffected.
drop index if exists wpbl_games_api_id_idx;
create unique index if not exists wpbl_games_api_id_idx on wpbl_games (api_game_id);

-- ─── Batting lines: the fields the feed adds ──────────────────────────────────
-- doubles/triples/hr/hbp/sb/cs/so already exist (create_wpbl.sql). Add the rest the feed
-- reports so season rate stats (OBP with sac flies, etc.) are exact.
alter table wpbl_batting_lines add column if not exists sf   int not null default 0;   -- sac fly
alter table wpbl_batting_lines add column if not exists sh   int not null default 0;   -- sac hit / bunt
alter table wpbl_batting_lines add column if not exists ibb  int not null default 0;   -- intentional walk
alter table wpbl_batting_lines add column if not exists gdp  int not null default 0;   -- grounded into DP
alter table wpbl_batting_lines add column if not exists tb   int not null default 0;   -- total bases (feed-computed)
alter table wpbl_batting_lines add column if not exists lob  int not null default 0;   -- left on base

-- ─── Pitching lines: the fields the feed adds ─────────────────────────────────
-- outs / bf / h / r / er / bb / so / hr / pitches / decision already exist. IP arrives as
-- "2.2" and is converted to outs by the ingest. gs marks a start (for GS/CG later).
alter table wpbl_pitching_lines add column if not exists gs      int not null default 0;   -- 1 if started
alter table wpbl_pitching_lines add column if not exists hbp     int not null default 0;
alter table wpbl_pitching_lines add column if not exists ibb     int not null default 0;
alter table wpbl_pitching_lines add column if not exists wp      int not null default 0;   -- wild pitch
alter table wpbl_pitching_lines add column if not exists bk      int not null default 0;   -- balk
alter table wpbl_pitching_lines add column if not exists strikes int not null default 0;   -- strikes thrown
alter table wpbl_pitching_lines add column if not exists doubles int not null default 0;   -- 2B allowed
alter table wpbl_pitching_lines add column if not exists triples int not null default 0;

-- ─── Fielding lines (one row per player per game) ─────────────────────────────
create table if not exists wpbl_fielding_lines (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references wpbl_games (id) on delete cascade,
  player_id  uuid not null references wpbl_players (id) on delete cascade,
  team_id    text references wpbl_teams (id) on delete set null,
  po         int not null default 0,   -- putouts
  a          int not null default 0,   -- assists
  e          int not null default 0,   -- errors
  pb         int not null default 0,   -- passed balls
  sba        int not null default 0,   -- stolen bases allowed (catcher)
  ci         int not null default 0,   -- catcher's interference
  dp         int not null default 0,   -- double plays turned (feed 'indp')
  created_at timestamptz not null default now()
);
create unique index if not exists wpbl_fielding_game_player_idx on wpbl_fielding_lines (game_id, player_id);
create index        if not exists wpbl_fielding_player_idx      on wpbl_fielding_lines (player_id);

-- ─── Play-by-play (feed-shaped) ───────────────────────────────────────────────
-- Distinct from wpbl_plays (the retired live-scorer's outcome-code log). This mirrors
-- the feed's play objects: a human narrative plus structured fields for filtering
-- (event_type, is_hit, is_scoring_play) and a jsonb of the pitch-by-pitch events.
-- batter_id/pitcher_id are resolved to our player uuids when the name matches (null if
-- unresolved — the name is always kept so the feed still renders).
create table if not exists wpbl_game_plays (
  id               uuid primary key default gen_random_uuid(),
  game_id          uuid not null references wpbl_games (id) on delete cascade,
  sequence         int  not null,
  inning           int  not null,
  half             text not null check (half in ('top', 'bottom')),
  team_id          text references wpbl_teams (id) on delete set null,   -- batting side (slug)
  batter_name      text,
  batter_id        uuid references wpbl_players (id) on delete set null,
  pitcher_name     text,
  pitcher_id       uuid references wpbl_players (id) on delete set null,
  outs             int  not null default 0,
  first_base       text,      -- runner name on base per feed (may be '')
  second_base      text,
  third_base       text,
  bases_loaded     boolean not null default false,
  narrative        text not null default '',
  event_type       text,      -- 'strikeout' | 'single' | 'groundout' | ...
  is_hit           boolean not null default false,
  is_scoring_play  boolean not null default false,
  runs_scored      int  not null default 0,
  pitch_sequence   text,      -- e.g. 'KFBS'
  balls            int  not null default 0,
  strikes          int  not null default 0,
  fouls            int  not null default 0,
  pitch_events     jsonb,     -- [{sequence,code,type,description}, ...]
  created_at       timestamptz not null default now()
);
create unique index if not exists wpbl_game_plays_game_seq_idx on wpbl_game_plays (game_id, sequence);

-- ─── Pitch tracking (TrackMan) ────────────────────────────────────────────────
-- One row per tracked pitch/hit event. The high-value numeric fields are promoted to
-- columns for charting; the whole feed object is retained in `raw` so nothing is lost.
-- activity_id is the feed's stable per-event key (used for idempotent upserts).
create table if not exists wpbl_pitch_tracking (
  activity_id           text primary key,
  game_id               uuid not null references wpbl_games (id) on delete cascade,
  play_id               text,
  session_id            text,
  kind                  text,        -- 'pitch' | 'hit' | ...
  event_type            text,
  sequence              int,
  occurred_at           timestamptz,
  release_speed         numeric,
  speed_unit            text,
  spin_rate_rpm         numeric,
  extension             numeric,
  vertical_break        numeric,
  horizontal_break      numeric,
  plate_location_height numeric,
  raw                   jsonb not null,
  created_at            timestamptz not null default now()
);
create index if not exists wpbl_pitch_tracking_game_idx on wpbl_pitch_tracking (game_id);

-- ─── RLS: public read on the new tables (writes via service role bypass RLS) ───
alter table wpbl_fielding_lines enable row level security;
alter table wpbl_game_plays     enable row level security;
alter table wpbl_pitch_tracking enable row level security;

do $$ begin
  create policy "WPBL fielding lines are public" on wpbl_fielding_lines for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "WPBL game plays are public" on wpbl_game_plays for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "WPBL pitch tracking is public" on wpbl_pitch_tracking for select using (true);
exception when duplicate_object then null; end $$;

-- Owner-only writes (dashboard edits). Ingestion uses the service role, which bypasses
-- RLS entirely, so these exist only for manual owner corrections.
do $$ begin
  create policy "Owner writes WPBL fielding lines" on wpbl_fielding_lines for all
    using (public.is_site_owner()) with check (public.is_site_owner());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Owner writes WPBL game plays" on wpbl_game_plays for all
    using (public.is_site_owner()) with check (public.is_site_owner());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Owner writes WPBL pitch tracking" on wpbl_pitch_tracking for all
    using (public.is_site_owner()) with check (public.is_site_owner());
exception when duplicate_object then null; end $$;

-- ─── Realtime: push live updates to viewers ───────────────────────────────────
-- Add the feed-driven tables to the realtime publication (guarded). The client also
-- polls, so this is an enhancement.
do $$
declare t text;
begin
  foreach t in array array['wpbl_fielding_lines', 'wpbl_game_plays'] loop
    begin execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null; when undefined_object then null; end;
  end loop;
end $$;

-- ─── One-time cleanup of the hand-seeded schedule ─────────────────────────────
-- The feed now owns the schedule (games are upserted on api_game_id). Any pre-existing
-- rows from scripts/seed_wpbl.sql have no api_game_id and would double up alongside the
-- feed's rows. This clears ONLY those un-ingested seed rows (api_game_id is null) and
-- their dependent lines/plays cascade. Feed-ingested rows are untouched, so this is safe
-- to leave in place across re-runs.
delete from wpbl_games where api_game_id is null;

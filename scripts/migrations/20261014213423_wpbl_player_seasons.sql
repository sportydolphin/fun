-- wpbl player seasons
-- Created 2026-10-14. Applied by scripts/migrate.mjs.
--
-- wpbl_player_seasons: every player's season, totalled once on a schedule instead of in every
-- reader's browser.
--
-- WHY. The Stats tab's Players and Leaders boards, its Overall (WAR) side and the search box's
-- answers (src/wpbl/searchAnswers.ts) each downloaded every box-score line (about 340KB of JSON,
-- 73KB gzipped), and WAR and WPA also downloaded the play log, the section's slowest read, and ran
-- the whole WAR engine on the reader's device. The season is over and the answers almost never
-- change. scripts/compute-wpbl-player-seasons.ts runs the browser's own code over the browser's own
-- inputs (src/wpbl/derive/playerSeasons.ts) and stores the result here, the pattern
-- wpbl_run_environment set.
--
-- ONE ROW PER (season, scope, player). Scope is 'regular' or 'postseason'; the Stats tab's third
-- slice, "Both", is the two added together by the reader, since every stored figure is a count.
-- `batting` and `pitching` hold the counting stats only, never rates and never printed strings: the
-- reader rebuilds the rates with the functions every sum already ends in, so the reader's ERA basis
-- still applies at display. `value` is WAR and its parts as the engine's own floats (regular season
-- only, like every engine it is built from). `position` is the box score's primary position, for the
-- sublabels. One more row per season and scope, player_id 'league', holds the whole league's line
-- and, on the regular row, the season's wOBA and FIP weights.
--
-- WHAT "CURRENT" MEANS, WHICH IS THE HARD PART. Three options were weighed:
--
--   (a) a stamp of the finals count plus the newest wpbl_game_revisions and wpbl_play_corrections
--       rows. It misses changes that leave no revision: a box score landing after its game went
--       final (the count already moved, the lines had not), and every late-TrackMan backfill
--       re-read. Each would serve a WRONG number, not a slow one.
--   (b) trust the rows while no game is live and rerun the job after every repair and correction.
--       Wrong for exactly as long as a rerun is late or forgotten, and corrections are made by hand.
--   (c) a version table the ingest and the drift job bump. Needs every writer, including the
--       hand-deployed wpbl-ingest, to remember it, and one that forgets is silent.
--
-- CHOSEN: (d), a fingerprint of the inputs themselves, computed by the database on demand. The view
-- wpbl_player_season_stamp hashes exactly what the job reads: the schedule columns the engines read,
-- every box-score line, every play, every correction, and the roster columns the engines read. The
-- job reads the stamp BEFORE it reads anything, and writes it on every row. A reader reads the stamp
-- beside the rows and uses them only when the two agree, every row carries the same stamp and
-- version, and none is missing (`season_rows`); otherwise it reads the lines and plays exactly as it
-- did before this table existed. Taking the stamp first is what makes a race safe: anything that
-- changes during or after the job's read moves the live stamp away from the stored one. So a change
-- from ANY writer, by any path, can cost a reader speed until the next run, and never a wrong number.
--
-- Two exclusions keep the stamp from churning for nothing. A play's id and created_at are left out,
-- because wpbl-ingest deletes and reinserts a game's plays with new ids and identical content; the
-- reader orders plays by (game_id, sequence), so the id never reaches a figure. A line's id is KEPT:
-- lines are read in id order, and WAR's float sums move in their last bit with the order, so new ids
-- must count as a change. Volatile game columns (scores mid-game aside) are left out because the
-- engines do not read them.
--
-- The job refuses to write while a game is live, and runs hourly and again right after the nightly
-- drift check repairs a game (.github/workflows/wpbl-player-seasons.yml).
--
-- Written by the job with the service role; read by everyone, like the lines it summarises.

create table if not exists public.wpbl_player_seasons (
  season       integer not null,
  scope        text not null check (scope in ('regular', 'postseason')),
  player_id    text not null,           -- a wpbl_players id, or 'league'
  batting      jsonb,
  pitching     jsonb,
  value        jsonb,
  position     jsonb,
  weights      jsonb,
  season_rows  integer not null,
  stamp        text not null,
  version      integer not null,
  computed_at  timestamptz not null default now(),
  primary key (season, scope, player_id)
);

alter table public.wpbl_player_seasons enable row level security;

drop policy if exists "WPBL player seasons are public" on public.wpbl_player_seasons;
create policy "WPBL player seasons are public" on public.wpbl_player_seasons for select using (true);

-- The inputs' fingerprint. security_invoker, so it reads the tables under the caller's own RLS,
-- every one of which is public-read; a definer view would quietly read past them.
create or replace view public.wpbl_player_season_stamp with (security_invoker = true) as
select md5(concat_ws('|',
  (select md5(coalesce(string_agg(x, ',' order by x), '')) from (
    select jsonb_build_array(id, game_date, start_time, status, status_detail, game_type, counts_in_standings,
      home_team_id, away_team_id, home_score, away_score, innings, live_state)::text as x
    from public.wpbl_games) g),
  (select md5(coalesce(string_agg(x, ',' order by x), '')) from (
    select (to_jsonb(l) - 'created_at')::text as x from public.wpbl_batting_lines l) b),
  (select md5(coalesce(string_agg(x, ',' order by x), '')) from (
    select (to_jsonb(l) - 'created_at')::text as x from public.wpbl_pitching_lines l) p),
  (select md5(coalesce(string_agg(x, ',' order by x), '')) from (
    select (to_jsonb(pl) - 'id' - 'created_at')::text as x from public.wpbl_game_plays pl) y),
  (select md5(coalesce(string_agg(x, ',' order by x), '')) from (
    select (to_jsonb(c) - 'id' - 'created_at')::text as x from public.wpbl_play_corrections c) c),
  (select md5(coalesce(string_agg(x, ',' order by x), '')) from (
    select jsonb_build_array(id, name, team_id, position)::text as x from public.wpbl_players) r)
)) as stamp;

grant select on public.wpbl_player_season_stamp to anon, authenticated;

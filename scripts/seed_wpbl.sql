-- Run this once in your Supabase SQL editor, AFTER scripts/create_wpbl.sql.
--
-- Seeds the static, publicly-known WPBL 2026 data: the four teams and the full
-- 30-game regular-season schedule (Aug 1 – Sep 6, 2026, all at Robin Roberts Stadium
-- in Springfield, IL — each team plays 15 games). Schedule cross-checked against the
-- official league site and independent trackers; the league notes dates/times are
-- "subject to change," so re-running this is safe (see the idempotency notes below).
--
-- NOT seeded here: rosters (full team-by-team player lists aren't reliably published
-- yet) and real team colors/logos. Team colors below are PROVISIONAL placeholders that
-- match src/wpbl/constants.ts — update both together once the real palette is known.
-- A roster-insert template is included, commented out, at the bottom.
--
-- Start times are local (Central, the venue's zone). Game length/innings is left null
-- and gets set when a final result is entered.

-- ─── Teams ──────────────────────────────────────────────────────────────────
-- Upsert on the text id so re-running refreshes colors/names without duplicating.
insert into wpbl_teams (id, city, name, abbr, color, sort_order) values
  ('BOS', 'Boston',        'Hunters',   'BOS', '#2e5e3a', 1),
  ('LA',  'Los Angeles',   'Queens',    'LA',  '#6b2fa0', 2),
  ('NY',  'New York',      'Heights',   'NY',  '#1d3461', 3),
  ('SF',  'San Francisco', 'Firebells', 'SF',  '#c8402b', 4)
on conflict (id) do update set
  city = excluded.city, name = excluded.name, abbr = excluded.abbr,
  color = excluded.color, sort_order = excluded.sort_order;

-- ─── Schedule ────────────────────────────────────────────────────────────────
-- Idempotency: a unique index on the natural key lets the inserts below no-op on a
-- re-run instead of duplicating, and (unlike a delete+reinsert) never touches any
-- box-score lines already entered for a game once the season is underway.
create unique index if not exists wpbl_games_natural_idx
  on wpbl_games (game_date, home_team_id, away_team_id, start_time);

insert into wpbl_games (game_date, start_time, home_team_id, away_team_id, venue, status) values
  ('2026-08-01', '5:00 PM', 'NY',  'LA',  'Robin Roberts Stadium', 'scheduled'),
  ('2026-08-02', '6:30 PM', 'BOS', 'SF',  'Robin Roberts Stadium', 'scheduled'),
  ('2026-08-05', '6:30 PM', 'LA',  'BOS', 'Robin Roberts Stadium', 'scheduled'),
  ('2026-08-06', '6:30 PM', 'SF',  'NY',  'Robin Roberts Stadium', 'scheduled'),
  ('2026-08-07', '6:30 PM', 'LA',  'SF',  'Robin Roberts Stadium', 'scheduled'),
  ('2026-08-08', '1:00 PM', 'NY',  'BOS', 'Robin Roberts Stadium', 'scheduled'),
  ('2026-08-08', '6:30 PM', 'SF',  'LA',  'Robin Roberts Stadium', 'scheduled'),
  ('2026-08-09', '6:30 PM', 'BOS', 'NY',  'Robin Roberts Stadium', 'scheduled'),
  ('2026-08-12', '6:30 PM', 'SF',  'LA',  'Robin Roberts Stadium', 'scheduled'),
  ('2026-08-13', '6:30 PM', 'NY',  'BOS', 'Robin Roberts Stadium', 'scheduled'),
  ('2026-08-14', '6:30 PM', 'SF',  'LA',  'Robin Roberts Stadium', 'scheduled'),
  ('2026-08-15', '1:00 PM', 'NY',  'SF',  'Robin Roberts Stadium', 'scheduled'),
  ('2026-08-15', '6:30 PM', 'BOS', 'LA',  'Robin Roberts Stadium', 'scheduled'),
  ('2026-08-16', '6:30 PM', 'NY',  'BOS', 'Robin Roberts Stadium', 'scheduled'),
  ('2026-08-19', '6:30 PM', 'SF',  'NY',  'Robin Roberts Stadium', 'scheduled'),
  ('2026-08-20', '6:30 PM', 'BOS', 'NY',  'Robin Roberts Stadium', 'scheduled'),
  ('2026-08-21', '6:30 PM', 'LA',  'SF',  'Robin Roberts Stadium', 'scheduled'),
  ('2026-08-22', '1:00 PM', 'BOS', 'SF',  'Robin Roberts Stadium', 'scheduled'),
  ('2026-08-22', '6:30 PM', 'LA',  'NY',  'Robin Roberts Stadium', 'scheduled'),
  ('2026-08-23', '6:30 PM', 'BOS', 'LA',  'Robin Roberts Stadium', 'scheduled'),
  ('2026-08-26', '6:30 PM', 'LA',  'BOS', 'Robin Roberts Stadium', 'scheduled'),
  ('2026-08-27', '6:30 PM', 'NY',  'LA',  'Robin Roberts Stadium', 'scheduled'),
  ('2026-08-28', '6:30 PM', 'SF',  'BOS', 'Robin Roberts Stadium', 'scheduled'),
  ('2026-08-29', '6:30 PM', 'LA',  'NY',  'Robin Roberts Stadium', 'scheduled'),
  ('2026-08-30', '6:30 PM', 'SF',  'NY',  'Robin Roberts Stadium', 'scheduled'),
  ('2026-09-02', '6:30 PM', 'BOS', 'SF',  'Robin Roberts Stadium', 'scheduled'),
  ('2026-09-03', '6:30 PM', 'LA',  'NY',  'Robin Roberts Stadium', 'scheduled'),
  ('2026-09-04', '6:30 PM', 'NY',  'SF',  'Robin Roberts Stadium', 'scheduled'),
  ('2026-09-05', '6:30 PM', 'BOS', 'LA',  'Robin Roberts Stadium', 'scheduled'),
  ('2026-09-06', '6:30 PM', 'SF',  'BOS', 'Robin Roberts Stadium', 'scheduled')
on conflict (game_date, home_team_id, away_team_id, start_time) do nothing;

-- ─── Rosters (template — fill in once player lists are known) ──────────────────
-- Players use a generated uuid id, so re-running plain inserts would duplicate. When
-- you have real rosters, either run this block exactly once, or add a natural-key
-- unique index first (e.g. on (team_id, name)) and switch to `on conflict do nothing`.
--
-- insert into wpbl_players (team_id, name, position, bats, throws, jersey_number) values
--   ('BOS', 'Player Name', 'P',  'R', 'R', '21'),
--   ('LA',  'Player Name', 'OF', 'L', 'L', '7');

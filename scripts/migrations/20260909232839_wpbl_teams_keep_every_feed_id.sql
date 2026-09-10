-- wpbl teams keep every feed id
-- Created 2026-09-09. Applied by scripts/migrate.mjs.

-- The league runs the postseason as a SEPARATE presto season ("Womens Pro Baseball League
-- Playoffs 2026"), which mints a new team id per club exactly as a player gets a new one on
-- changing club. Boston is 9f08or2mffx81409 all regular season and rknw1oz8pl20apx4 in the
-- bracket; same name, same club, both live in the feed at once. `api_id` holds one id, so
-- wpbl-ingest could map neither postseason team and dropped all four bracket games with
-- "unmapped team in <game>". Those are logged, but the run still reports ok, so the site
-- simply showed no playoffs while Game 1 was being played on Sep 9, 2026.
--
-- Same shape as wpbl_players.api_ids and the same fix: keep EVERY id a club has held and
-- match on any of them. api_id stays as the seed/current key for anything reading a scalar.
alter table wpbl_teams add column if not exists api_ids text[] not null default '{}';

-- Existing scalar first, so a fresh database that has only run the seed still maps.
update wpbl_teams
   set api_ids = array[api_id]
 where api_id is not null and api_ids = '{}';

-- The 2026 postseason ids, read off GET /v1/games on Sep 9, 2026.
update wpbl_teams set api_ids = (
  select array_agg(distinct a) from unnest(api_ids || array[v.feed_id]) a
) from (values
  ('BOS', 'rknw1oz8pl20apx4'),
  ('SF',  'r622khgeymi55fwo'),
  ('NY',  '07xl5m9s98ckxth4'),
  ('LA',  'e1u35z4hgkmddl84')
) as v(team_id, feed_id)
where wpbl_teams.id = v.team_id and not (v.feed_id = any (wpbl_teams.api_ids));

-- The ingest looks up a feed id here on every pass.
create index if not exists wpbl_teams_api_ids_idx on wpbl_teams using gin (api_ids);

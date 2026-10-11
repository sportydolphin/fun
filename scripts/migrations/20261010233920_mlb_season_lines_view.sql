-- mlb_season_lines: a whole MLB season's games, lines and names, packed into one row per season.
--
-- WHY A VIEW AND NOT THE TABLES. The Bests and Find boards run WPBL's engines (src/league/) in the
-- browser, over every line of a season: about 50,000 batting and 21,000 pitching lines for 2026.
-- Read from the tables that is 71 pages of PostgREST's 1,000-row cap and 12 MB of JSON, because
-- every row repeats every column name. Packed here as one row per season, each set a list of
-- column names and a list of arrays, it is one request of about 3.6 MB that compresses to roughly
-- half a megabyte.
--
-- AND IT IS CACHEABLE. A signed-out read of a table or view goes through Cloudflare's edge
-- (src/lib/edgeTables.ts, `slow` tier), which serves only `/rest/v1/<name>` paths, not RPCs. The
-- packing runs in Postgres on a cache miss; between misses nobody pays for it.
--
-- THE COLUMN NAMES TRAVEL WITH THE DATA (`cols` beside `rows`), so the client maps by name and a
-- column added here cannot silently shift every number one place along.
--
-- security_invoker so the view reads under the caller's RLS, which on these tables is "public".
-- Created 2026-10-10. Applied by scripts/migrate.mjs.

create or replace view public.mlb_season_lines with (security_invoker = true) as
select
  s.season,
  (select json_build_object(
     'cols', json_build_array('game_pk', 'game_date', 'game_type', 'counts_in_standings', 'status',
       'home_team_id', 'away_team_id', 'home_score', 'away_score'),
     'rows', coalesce(json_agg(json_build_array(g.game_pk, g.game_date, g.game_type,
       g.counts_in_standings, g.status, g.home_team_id, g.away_team_id, g.home_score, g.away_score)
       order by g.game_date, g.game_pk), '[]'::json))
   from public.mlb_games g where g.season = s.season) as games,
  (select json_build_object(
     'cols', json_build_array('game_pk', 'player_id', 'team_id', 'ab', 'r', 'h', 'doubles', 'triples',
       'hr', 'rbi', 'bb', 'so', 'hbp', 'sb', 'cs', 'sf', 'sh', 'gdp', 'tb'),
     'rows', coalesce(json_agg(json_build_array(b.game_pk, b.player_id, b.team_id, b.ab, b.r, b.h,
       b.doubles, b.triples, b.hr, b.rbi, b.bb, b.so, b.hbp, b.sb, b.cs, b.sf, b.sh, b.gdp, b.tb)
       order by b.game_pk, b.player_id), '[]'::json))
   from public.mlb_batting_lines b join public.mlb_games g using (game_pk) where g.season = s.season) as batting,
  (select json_build_object(
     'cols', json_build_array('game_pk', 'player_id', 'team_id', 'outs', 'bf', 'h', 'r', 'er', 'bb',
       'so', 'hr', 'pitches', 'strikes', 'hbp', 'wp', 'bk'),
     'rows', coalesce(json_agg(json_build_array(p.game_pk, p.player_id, p.team_id, p.outs, p.bf, p.h,
       p.r, p.er, p.bb, p.so, p.hr, p.pitches, p.strikes, p.hbp, p.wp, p.bk)
       order by p.game_pk, p.player_id), '[]'::json))
   from public.mlb_pitching_lines p join public.mlb_games g using (game_pk) where g.season = s.season) as pitching,
  -- Everyone with a line in the season, with the club they are on now. A name only, deliberately:
  -- a board row needs nothing else, and the player card it opens reads StatsAPI as it always has.
  (select json_build_object(
     'cols', json_build_array('player_id', 'name', 'team_id'),
     'rows', coalesce(json_agg(json_build_array(pl.player_id, pl.name, pl.team_id) order by pl.player_id), '[]'::json))
   from public.mlb_players pl
   where pl.player_id in (
     select b.player_id from public.mlb_batting_lines b join public.mlb_games g using (game_pk) where g.season = s.season
     union
     select p.player_id from public.mlb_pitching_lines p join public.mlb_games g using (game_pk) where g.season = s.season)) as players,
  (select max(g.synced_at) from public.mlb_games g where g.season = s.season) as synced_at
from (select distinct season from public.mlb_games) s;

grant select on public.mlb_season_lines to anon, authenticated;

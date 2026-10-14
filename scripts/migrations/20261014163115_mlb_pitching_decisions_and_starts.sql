-- mlb_pitching_lines gains gs and decision: who started, and who got the win, loss, save or hold.
--
-- WHY. The Find board's season totals ask "10 wins", "20 saves", "ERA under 3 among starters", and
-- a single game asks "10 strikeouts in a win". WPBL's lines have carried both since the start; the
-- MLB mirror skipped them because Bests and Find did not read them yet. Every StatsAPI box score
-- has them per pitcher (gamesStarted, wins, losses, saves, holds), so this is the columns plus a
-- re-read of the stored seasons: `node scripts/sync-mlb-lines.mjs --season <year> --all`.
--
-- THE SAME COLUMNS AS WPBL'S, so the engines read both leagues alike (src/league/types.ts):
-- `gs` is 1 for the starter, and `decision` is one letter, W, L, S or H. One letter is enough
-- because the rules give a pitcher at most one of the four in a game: a hold cannot go to the
-- winning pitcher, and a pitcher who left with the lead cannot be charged the loss.
--
-- NULL is no decision, as on WPBL's table, which means a row the re-read has not reached yet reads
-- as no decision too. So every stored season is re-read in the same change that ships the boards
-- reading these: a season half re-read would show half its wins as nobody's, and nothing errors.
-- Created 2026-10-14. Applied by scripts/migrate.mjs.

alter table public.mlb_pitching_lines add column if not exists gs smallint;
alter table public.mlb_pitching_lines add column if not exists decision text
  check (decision is null or decision in ('W', 'L', 'S', 'H'));

-- The season view, with the two new columns in the pitching set. Otherwise as created in
-- 20261010233920_mlb_season_lines_view.sql, where the reasons for packing it are written down.
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
       'so', 'hr', 'pitches', 'strikes', 'hbp', 'wp', 'bk', 'gs', 'decision'),
     'rows', coalesce(json_agg(json_build_array(p.game_pk, p.player_id, p.team_id, p.outs, p.bf, p.h,
       p.r, p.er, p.bb, p.so, p.hr, p.pitches, p.strikes, p.hbp, p.wp, p.bk, p.gs, p.decision)
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

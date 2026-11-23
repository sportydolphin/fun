-- drop dead wpbl tables
-- Created 2026-11-07. Applied by scripts/migrate.mjs.
--
-- wpbl_plays was the retired live scorer's outcome-code log (scripts/add_wpbl_live.sql). The
-- league feed's play-by-play lives in wpbl_game_plays, nothing in src/, supabase/, functions/,
-- shared/ or the cron scripts reads or writes wpbl_plays, and it has 0 rows. Its only live
-- reference was wpbl_merge_players, which re-pointed its six player columns on every merge.
--
-- wpbl_award_discord_polls was the Discord award poll's message map. The poll was reverted off
-- main on Sep 9, 2026 (be77ec17): its workflow and sync script are gone from every branch, the
-- 2026 award votes are closed (20261101190000_close_finished_award_votes.sql), and it has 0 rows.
-- A Discord poll for a later ballot would need new code anyway, and can recreate the table from
-- 20260909202103_wpbl_award_discord_polls.sql.

-- 1. wpbl_merge_players first. plpgsql resolves table names when a statement runs, so dropping
-- wpbl_plays under the old body would not fail here: it would fail the next merge, with
-- `relation "wpbl_plays" does not exist`, and roll the whole merge back. The body below is the
-- live one minus those six updates. `create or replace` keeps its grants (postgres and
-- service_role only), where drop and create would hand EXECUTE back to anon.
create or replace function public.wpbl_merge_players(keep uuid, dupe uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if keep = dupe then
    raise exception 'wpbl_merge_players: keep and dupe are the same row (%)', keep;
  end if;
  if not exists (select 1 from wpbl_players where id = keep) then
    raise exception 'wpbl_merge_players: keep row % does not exist', keep;
  end if;
  if not exists (select 1 from wpbl_players where id = dupe) then
    raise exception 'wpbl_merge_players: dupe row % does not exist', dupe;
  end if;

  delete from wpbl_batting_lines d
   where d.player_id = dupe
     and exists (select 1 from wpbl_batting_lines k where k.player_id = keep and k.game_id = d.game_id);
  delete from wpbl_pitching_lines d
   where d.player_id = dupe
     and exists (select 1 from wpbl_pitching_lines k where k.player_id = keep and k.game_id = d.game_id);
  delete from wpbl_fielding_lines d
   where d.player_id = dupe
     and exists (select 1 from wpbl_fielding_lines k where k.player_id = keep and k.game_id = d.game_id);

  update wpbl_batting_lines  set player_id = keep where player_id = dupe;
  update wpbl_pitching_lines set player_id = keep where player_id = dupe;
  update wpbl_fielding_lines set player_id = keep where player_id = dupe;

  update wpbl_game_plays set batter_id  = keep where batter_id  = dupe;
  update wpbl_game_plays set pitcher_id = keep where pitcher_id = dupe;

  update wpbl_games set home_pitcher_id = keep where home_pitcher_id = dupe;
  update wpbl_games set away_pitcher_id = keep where away_pitcher_id = dupe;
  update wpbl_games set runner_first    = keep where runner_first    = dupe;
  update wpbl_games set runner_second   = keep where runner_second   = dupe;
  update wpbl_games set runner_third    = keep where runner_third    = dupe;

  delete from wpbl_discord_birthday_posts d
   where d.player_id = dupe
     and exists (select 1 from wpbl_discord_birthday_posts k
                  where k.player_id = keep and k.birthday_on = d.birthday_on);
  update wpbl_discord_birthday_posts set player_id = keep where player_id = dupe;

  -- Unique on (player_id, game_id, from_team_id, to_team_id) since the Sep 1 dedupe, so
  -- re-pointing the duplicate's rows can now COLLIDE with the kept player's: both logging the
  -- same move out of the same box score is precisely what a mergeable pair looks like. Same
  -- shape as the birthday block above, and for the same reason: an unmergeable pair is worse
  -- than losing a log line that says what a surviving line already says.
  delete from wpbl_player_team_changes d
   where d.player_id = dupe
     and exists (select 1 from wpbl_player_team_changes k
                  where k.player_id = keep
                    and k.game_id is not distinct from d.game_id
                    and k.from_team_id is not distinct from d.from_team_id
                    and k.to_team_id = d.to_team_id);
  update wpbl_player_team_changes set player_id = keep where player_id = dupe;

  -- Photo tags are unique on (photo_id, player_id): if both rows tag the same photo, drop the
  -- duplicate before repointing, the same shape as the box-score lines above. Miss this block
  -- and a merge orphans every fan photo of the merged player.
  delete from wpbl_photo_subjects d
   where d.player_id = dupe
     and exists (select 1 from wpbl_photo_subjects k where k.player_id = keep and k.photo_id = d.photo_id);
  update wpbl_photo_subjects set player_id = keep where player_id = dupe;

  update wpbl_articles
     set player_ids = (select array_agg(distinct x) from unnest(array_replace(player_ids, dupe, keep)) x)
   where player_ids @> array[dupe];

  -- Clip tags hold players in an array, like wpbl_articles above. Miss this and a merge leaves
  -- the merged player's clips pointing at a row that no longer exists: gone from the player page
  -- and the clips filter until the next --relink rebuilds them, and a manual tag never comes back.
  update wpbl_video_tags
     set player_ids = (select array_agg(distinct x) from unnest(array_replace(player_ids, dupe, keep)) x)
   where player_ids @> array[dupe];

  delete from wpbl_photo_tag_suggestions d
   where d.player_id = dupe
     and exists (select 1 from wpbl_photo_tag_suggestions k
                  where k.player_id = keep and k.photo_id = d.photo_id and k.suggester_key = d.suggester_key);
  update wpbl_photo_tag_suggestions set player_id = keep where player_id = dupe;

  update wpbl_players k
     set api_ids = (select coalesce(array_agg(distinct a), '{}'::text[])
                      from unnest(k.api_ids || d.api_ids || array[k.api_id, d.api_id]) a
                     where a is not null and a <> ''),
         position          = coalesce(k.position,          d.position),
         bats              = coalesce(k.bats,              d.bats),
         throws            = coalesce(k.throws,            d.throws),
         jersey_number     = coalesce(k.jersey_number,     d.jersey_number),
         age               = coalesce(k.age,               d.age),
         hometown          = coalesce(k.hometown,          d.hometown),
         bio               = coalesce(k.bio,               d.bio),
         birth_date        = coalesce(k.birth_date,        d.birth_date),
         birth_date_source = coalesce(k.birth_date_source, d.birth_date_source),
         draft_round       = coalesce(k.draft_round,       d.draft_round),
         draft_pick        = coalesce(k.draft_pick,        d.draft_pick)
    from wpbl_players d
   where k.id = keep and d.id = dupe;

  delete from wpbl_players where id = dupe;
end;
$function$;

-- 2. No cascade: nothing depends on either table, and if something has started to since this
-- was written the migration should stop and say so rather than drop it too. Dropping a table
-- also takes it out of the supabase_realtime publication and drops its policies.
drop table if exists public.wpbl_plays;
drop table if exists public.wpbl_award_discord_polls;

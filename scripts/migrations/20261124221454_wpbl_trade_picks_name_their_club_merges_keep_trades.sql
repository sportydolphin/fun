-- wpbl_roster_moves: a traded pick names whose pick it is, and a player merge keeps every trade.
--
-- PICK_TEAM_ID. A pick row said only "a 6th-round pick, from Boston to New York". Once a club holds
-- two picks in one round (its own and one it traded for), that cannot say which one it gave up, and
-- pickHolders had to guess the giver's own. The guess is wrong whenever a club passes on a pick it
-- acquired, and the draft board would then show the wrong club picking. Every pick row now names the
-- club the pick originally belonged to. The one pick traded so far was Boston's own 6th, and every
-- earlier pick row was the giver's own (the admin form could record nothing else), so the backfill
-- is the giving club.
--
-- THE MERGE. wpbl_merge_players dropped the duplicate's roster moves whenever the kept player had a
-- move of the same kind in the same season. That is right for re-signings (one per player per season,
-- so a second is the same fact twice), but trades are exempt from that index: a player can be traded
-- twice in one offseason, so the duplicate's trade is a different trade and was being deleted, and
-- the delete fired the undo trigger as well. Trades are now repointed, never dropped. `create or
-- replace` keeps the function's grants (postgres and service_role only). Copied from the live
-- definition (identical to 20261109120000) with the one condition added.

alter table public.wpbl_roster_moves
  add column if not exists pick_team_id text references public.wpbl_teams(id);

update public.wpbl_roster_moves
   set pick_team_id = from_team_id
 where kind = 'traded' and player_id is null and nullif(trim(player_name), '') is null
   and draft_round is not null and pick_team_id is null;

-- A pick row always names the pick's club; nothing else carries one.
alter table public.wpbl_roster_moves drop constraint if exists wpbl_roster_moves_pick_team_check;
alter table public.wpbl_roster_moves add constraint wpbl_roster_moves_pick_team_check
  check ((pick_team_id is not null) = (kind = 'traded' and draft_round is not null
         and player_id is null and nullif(trim(player_name), '') is null));

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

  -- Unique on (season, kind, player_id): both rows recorded as re-signed is what a mergeable pair
  -- looks like, so drop the duplicate's copy before repointing, as with the photo tags above.
  delete from wpbl_roster_moves d
   where d.player_id = dupe
     and exists (select 1 from wpbl_roster_moves k
                  where k.player_id = keep and k.season = d.season and k.kind = d.kind)
     -- Trades are not unique per player and season: the duplicate's is another trade, so it moves.
     and d.kind <> 'traded';
  update wpbl_roster_moves set player_id = keep where player_id = dupe;

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

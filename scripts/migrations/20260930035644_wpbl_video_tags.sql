-- wpbl_video_tags: which game, at-bat, players and club each YouTube Short shows.
--
-- WHY. None of the league's 291 Shorts names its game in the title, so the Watch page files them
-- by date only. scripts/sync-wpbl-youtube.mjs now reads the title for a player and an event
-- ("GIANELLONI GRAND SLAM") and finds the play in wpbl_game_plays, which pins about a quarter of
-- them to the exact at-bat, and most of the rest to a player or a club. That lets a clip appear
-- on its game, on its player's page, and under a club filter.
--
-- ONE ROW PER VIDEO, because a clip shows at most one game. Players are an array because a title
-- can name two ("BACK TO BACK HOME RUNS" does not, but a relay or a double play could).
--
-- THE PLAY IS (game_id, play_sequence), NEVER A PLAY'S UUID: wpbl-ingest deletes and reinserts
-- every play of a game on each pass, so a uuid stored here would dangle within two minutes.
-- inning and half are copied off the play for the clip's label ("top 3rd"), so the Watch page does
-- not have to read 3,700 plays to print one line.
--
-- method says how sure: 'play' (player and event confirmed against one play), 'game' (the game,
-- not the at-bat), 'player' (a player, no game), 'team' (a club only), 'manual' (set by hand,
-- which the sync never overwrites or deletes).
--
-- Written by the sync with the service role; read by everyone, like wpbl_videos.

create table if not exists public.wpbl_video_tags (
  video_id       text primary key references public.wpbl_videos(video_id) on delete cascade,
  game_id        uuid references public.wpbl_games(id) on delete set null,
  play_sequence  integer,
  inning         integer,
  half           text,
  team_id        text,
  player_ids     uuid[] not null default '{}',
  method         text not null check (method in ('play', 'game', 'player', 'team', 'manual')),
  matched_at     timestamptz not null default now()
);

create index if not exists wpbl_video_tags_game_idx    on public.wpbl_video_tags (game_id);
create index if not exists wpbl_video_tags_players_idx on public.wpbl_video_tags using gin (player_ids);

alter table public.wpbl_video_tags enable row level security;

drop policy if exists "WPBL video tags are public" on public.wpbl_video_tags;
create policy "WPBL video tags are public" on public.wpbl_video_tags for select using (true);

drop policy if exists "Owner writes WPBL video tags" on public.wpbl_video_tags;
create policy "Owner writes WPBL video tags" on public.wpbl_video_tags
  for all using (public.is_site_owner()) with check (public.is_site_owner());

-- ─── Extend wpbl_merge_players to repoint clip tags ────────────────────────────
-- MUST ship with the table: wpbl_merge_players hand-lists every table that holds a player id.
-- Copied from the live definition (identical to 20260922020815) with one block added.

CREATE OR REPLACE FUNCTION public.wpbl_merge_players(keep uuid, dupe uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  update wpbl_plays set batter_id           = keep where batter_id           = dupe;
  update wpbl_plays set pitcher_id          = keep where pitcher_id          = dupe;
  update wpbl_plays set runner_id           = keep where runner_id           = dupe;
  update wpbl_plays set runner_first_after  = keep where runner_first_after  = dupe;
  update wpbl_plays set runner_second_after = keep where runner_second_after = dupe;
  update wpbl_plays set runner_third_after  = keep where runner_third_after  = dupe;

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

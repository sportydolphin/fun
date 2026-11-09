-- wpbl_roster_moves: each club's moves toward its next roster, one row per player per move.
--
-- WHY BY HAND. The league opened its re-signing window on Nov 9, 2026 (clubs keep up to 10 of their
-- 2026 players until Nov 20, then a 10-round draft, then free agency) and publishes the moves
-- nowhere a script can read: its transactions collection is empty, and a player record's status
-- field holds only the 2026 draft values. The news watch (scripts/watch-wpbl-news.mjs) tells the
-- owner something moved; the owner records it here from /admin, with the link that says so.
--
-- source_url IS REQUIRED. A move on the site is a claim about a real person's job; every row has
-- to point at where the league or the club said it, or it does not go in.
--
-- player_id is null only for someone not yet in wpbl_players (a draft pick who has never played
-- here); player_name carries the name then. A re-signing always names a 2026 player, so it always
-- has an id.
--
-- Public read (every reader sees the same rows, so it sits on the edge cache's slow list); writes
-- are the owner's alone, the same footing as wpbl_video_tags.

create table if not exists public.wpbl_roster_moves (
  id           bigint generated always as identity primary key,
  season       integer not null check (season between 2027 and 2100),
  kind         text not null check (kind in ('re-signed', 'drafted', 'signed', 'released')),
  player_id    uuid references public.wpbl_players(id),
  player_name  text,
  team_id      text not null references public.wpbl_teams(id),
  draft_round  integer check (draft_round > 0),
  draft_pick   integer check (draft_pick > 0),
  announced_on date not null,
  source_url   text not null check (source_url ~ '^https://'),
  created_at   timestamptz not null default now(),
  check (player_id is not null or nullif(trim(player_name), '') is not null),
  check (kind <> 're-signed' or player_id is not null)
);

-- One move of a kind per player per season: recording a re-signing twice is a mistake, not news.
create unique index if not exists wpbl_roster_moves_one_per_player
  on public.wpbl_roster_moves (season, kind, player_id) where player_id is not null;

alter table public.wpbl_roster_moves enable row level security;

drop policy if exists "WPBL roster moves are public" on public.wpbl_roster_moves;
create policy "WPBL roster moves are public" on public.wpbl_roster_moves for select using (true);

drop policy if exists "Owner writes WPBL roster moves" on public.wpbl_roster_moves;
create policy "Owner writes WPBL roster moves" on public.wpbl_roster_moves
  for all using (public.is_site_owner()) with check (public.is_site_owner());

-- ─── Extend wpbl_merge_players to repoint roster moves ─────────────────────────
-- MUST ship with the table: wpbl_merge_players hand-lists every table that holds a player id, and
-- the foreign key above would make a merge of a re-signed player fail outright. Copied from the live
-- definition (identical to 20261107201930) with one block added. `create or replace` keeps its
-- grants (postgres and service_role only).
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
                  where k.player_id = keep and k.season = d.season and k.kind = d.kind);
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

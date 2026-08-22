-- Trades: one person, one row, however many ids the feed gives them.
--
-- WHAT BROKE. The league feed issues a NEW player_id when a player changes club. Diana
-- Ibarra is `moizfkn9dtrm4vno` on New York and `27svefz41ds4k58k` on Los Angeles, both
-- flagged ACTIVE, with an empty `career_id` on each: nothing in the feed says they are the
-- same person. wpbl-ingest's PlayerResolver matches by api_id and then only WITHIN one team,
-- so the LA id matched nothing and fell through to "insert a new roster row". The result was
-- two Diana Ibarras, eight games of season on one and one game on the other, her name
-- ambiguous enough that wpblPlayerSlug stopped issuing /wpbl/players/diana-ibarra and started
-- 404ing it, and the Discord bot's /player offering a disambiguation list for a player who
-- exists once.
--
-- WHAT THIS ADDS.
--
--   api_ids     every feed id ever seen for this person, api_id being the current one.
--               A merged player has to keep the old id because wpbl_pitch_tracking is keyed
--               on the FEED id, not ours: drop it and her pre-trade pitches become
--               unreachable with nothing logged.
--
--   team_as_of  the date of the latest game that placed her on team_id. The ingest re-reads
--               old box scores (corrections, the TrackMan backfill, mode 'all'), and every
--               one of those is evidence of the team she was on THEN. Without a date guard a
--               July re-ingest would move her back to New York and the next pass would move
--               her to Los Angeles again, so her club would depend on which game the loop
--               happened to touch last. With it the update is idempotent and
--               order-independent.
--
--   wpbl_player_team_changes
--               every move the ingest makes on its own. The name match that recognises a
--               trade is a heuristic, and a heuristic that runs unattended needs a paper
--               trail: this is how you find out that it fired, on whom, and off which game,
--               without diffing backups.
alter table public.wpbl_players
  add column if not exists api_ids    text[] not null default '{}',
  add column if not exists team_as_of date;

comment on column public.wpbl_players.api_ids is
  'Every official-feed player_id this person has held. The feed mints a new one per club, so '
  'a traded player has more than one and pitch tracking (keyed on the feed id) needs all of '
  'them. api_id is the current one and is always also a member of this array.';

comment on column public.wpbl_players.team_as_of is
  'Game date of the most recent box score that placed this player on team_id. The ingest only '
  'moves a player forward in time, so re-reading an old game cannot undo a trade.';

-- Backfill: every existing row has exactly one feed id, or none.
update public.wpbl_players
   set api_ids = case when api_id is null then '{}'::text[] else array[api_id] end
 where api_ids = '{}'::text[];

create table if not exists public.wpbl_player_team_changes (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid not null references public.wpbl_players(id) on delete cascade,
  from_team_id text references public.wpbl_teams(id),
  to_team_id   text not null references public.wpbl_teams(id),
  -- The box score that revealed the move, and its date. Not the date of the trade itself,
  -- which the feed never states: the first game she played for the new club is the earliest
  -- moment this data can know about it.
  game_id      uuid references public.wpbl_games(id) on delete set null,
  game_date    date,
  -- The feed id carried in that box score. Different from the old one on a real trade, equal
  -- to it if the feed ever starts reusing ids, which is worth being able to tell apart.
  feed_api_id  text,
  -- 'feed-id' when a feed id we already knew simply showed up under a new club, 'name-match'
  -- when a NEW feed id was recognised as an existing player by name. The second is the
  -- heuristic one and the only one worth auditing by eye.
  reason       text not null,
  detected_at  timestamptz not null default now()
);

create index if not exists wpbl_player_team_changes_player_idx
  on public.wpbl_player_team_changes (player_id, detected_at desc);

alter table public.wpbl_player_team_changes enable row level security;

-- Readable by anyone, like the rest of the mirrored WPBL data. Written only by the
-- service-role ingest, which bypasses RLS, so there is no insert policy to write.
drop policy if exists "wpbl_player_team_changes readable" on public.wpbl_player_team_changes;
create policy "wpbl_player_team_changes readable"
  on public.wpbl_player_team_changes for select using (true);

-- ─── merge tool ───────────────────────────────────────────────────────────────
-- Fold `dupe` into `keep` and delete it. A function rather than a one-off script because this
-- is not the last time: names.ts already documents the non-prefix nicknames (Gabby/Gabriella,
-- Kate/Katherine) that no automatic rule will ever match, and every one of those lands here.
-- Missing a referencing column leaves orphaned stats that surface months later looking like a
-- scoring error, so the list of them lives in exactly one place.
--
-- Deliberately not forgiving: it raises if either id is missing, so a mistyped uuid fails
-- loudly instead of quietly merging nothing.
create or replace function public.wpbl_merge_players(keep uuid, dupe uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
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

  -- Box-score lines are unique on (game_id, player_id). Both rows holding a line for the SAME
  -- game would mean the feed listed the player twice in one box score, which is a feed bug
  -- rather than a trade; drop the duplicate instead of failing, because an unmergeable pair is
  -- worse than losing a line that should not exist.
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

  -- wpbl_game_plays is a mirror that wpbl-ingest rewrites, so these two are cosmetic until
  -- the next pass. Done anyway, so the table is right in the meantime and so merging a player
  -- whose games will never be re-ingested still lands.
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

  -- Primary-keyed on (player_id, birthday_on): a greeting already posted under the kept row
  -- on the same day wins, so a merge can never make the bot post twice.
  delete from wpbl_discord_birthday_posts d
   where d.player_id = dupe
     and exists (select 1 from wpbl_discord_birthday_posts k
                  where k.player_id = keep and k.birthday_on = d.birthday_on);
  update wpbl_discord_birthday_posts set player_id = keep where player_id = dupe;

  update wpbl_player_team_changes set player_id = keep where player_id = dupe;

  -- Article tagging is an array, so swap the element and de-duplicate.
  update wpbl_articles
     set player_ids = (select array_agg(distinct x) from unnest(array_replace(player_ids, dupe, keep)) x)
   where player_ids @> array[dupe];

  -- Absorb the duplicate's identity. Every feed id it held comes across (that is the whole
  -- point: pitch tracking is keyed on them), and any field the kept row is missing is taken
  -- from it rather than lost.
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
$fn$;

comment on function public.wpbl_merge_players(uuid, uuid) is
  'Fold a duplicate player row into the one to keep: repoint every stat, play and article '
  'reference, absorb its feed ids and any field the kept row is missing, then delete it. For '
  'the duplicates no automatic rule can catch (non-prefix nicknames, or a trade the ingest '
  'saw before it knew what one was).';
